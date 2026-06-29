import type { NesRom, Region } from "../core/rom.ts";
import type { Button } from "../core/emu/controller.ts";
import { Nes } from "../core/emu/nes.ts";

const SAMPLE_RATE = 44100;
const AUDIO_BUFFER = 1024;
const BINDINGS_KEY = "nes.bindings.v1";

/** NES buttons in the order shown by the input-config UI. */
export const BUTTONS: readonly Button[] = [
  "up",
  "down",
  "left",
  "right",
  "a",
  "b",
  "start",
  "select",
];

export type Bindings = Record<Button, string>;

const DEFAULT_BINDINGS: Bindings = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  a: "KeyZ",
  b: "KeyX",
  start: "Enter",
  select: "ShiftRight",
};

function loadBindings(): Bindings {
  try {
    const raw = localStorage.getItem(BINDINGS_KEY);
    if (!raw) return { ...DEFAULT_BINDINGS };
    const parsed = JSON.parse(raw) as Partial<Bindings>;
    const result = { ...DEFAULT_BINDINGS };
    for (const button of BUTTONS) {
      const code = parsed[button];
      if (typeof code === "string") result[button] = code;
    }
    return result;
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

type Listener = () => void;

/**
 * Owns a running {@link Nes} and drives it from a single global rAF loop so the
 * emulator keeps advancing regardless of which debug tab is visible. Views
 * subscribe to be notified each frame to redraw.
 */
class EmuEngine {
  nes: Nes;
  running = false;
  fps = 0;
  lastError: string | null = null;
  audioEnabled = false;

  private rafId = 0;
  private last = 0;
  private readonly listeners = new Set<Listener>();
  private audioCtx: AudioContext | null = null;
  private audioNode: ScriptProcessorNode | null = null;
  private readonly keyDown: (e: KeyboardEvent) => void;
  private readonly keyUp: (e: KeyboardEvent) => void;
  /** null = auto-detect from the ROM header. */
  regionOverride: Region | null = null;
  private bindings: Bindings = loadBindings();
  private keyToButton = new Map<string, Button>();

  constructor(public rom: NesRom) {
    this.nes = new Nes(rom, SAMPLE_RATE);
    this.rebuildKeyMap();
    this.keyDown = (e) => this.handleKey(e, true);
    this.keyUp = (e) => this.handleKey(e, false);
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    this.loop = this.loop.bind(this);
    this.rafId = requestAnimationFrame(this.loop);
  }

  private rebuildKeyMap(): void {
    this.keyToButton.clear();
    for (const button of BUTTONS) {
      this.keyToButton.set(this.bindings[button], button);
    }
  }

  /** Current key code bound to each NES button (a copy). */
  getBindings(): Bindings {
    return { ...this.bindings };
  }

  /** Bind a keyboard `event.code` to a button; the code is freed from any other button. */
  setBinding(button: Button, code: string): void {
    for (const b of BUTTONS) {
      if (this.bindings[b] === code) this.bindings[b] = "";
    }
    this.bindings[button] = code;
    this.persistBindings();
    this.rebuildKeyMap();
    this.notify();
  }

  resetBindings(): void {
    this.bindings = { ...DEFAULT_BINDINGS };
    this.persistBindings();
    this.rebuildKeyMap();
    this.notify();
  }

  private persistBindings(): void {
    try {
      localStorage.setItem(BINDINGS_KEY, JSON.stringify(this.bindings));
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }

  private handleKey(e: KeyboardEvent, pressed: boolean): void {
    const button = this.keyToButton.get(e.code);
    if (!button) return;
    e.preventDefault();
    this.nes.setButton(button, pressed);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start(): void {
    this.lastError = null;
    this.running = true;
  }

  pause(): void {
    this.running = false;
  }

  toggle(): void {
    if (this.running) this.pause();
    else this.start();
  }

  reset(): void {
    this.nes = new Nes(this.rom, SAMPLE_RATE, this.regionOverride ?? this.rom.region);
    this.lastError = null;
  }

  /** Force a region (or pass null to follow the ROM header) and restart. */
  setRegion(region: Region | null): void {
    this.regionOverride = region;
    this.reset();
    this.notify();
  }

  stepFrame(): void {
    this.running = false;
    this.safeRunFrame();
    this.notify();
  }

  async enableAudio(): Promise<void> {
    if (this.audioEnabled) return;
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await ctx.resume();
    const node = ctx.createScriptProcessor(AUDIO_BUFFER, 0, 1);
    node.onaudioprocess = (event) => {
      this.nes.apu.drain(event.outputBuffer.getChannelData(0));
    };
    node.connect(ctx.destination);
    this.audioCtx = ctx;
    this.audioNode = node;
    this.audioEnabled = true;
  }

  private safeRunFrame(): void {
    try {
      this.nes.runFrame();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.running = false;
    }
  }

  private loop(time: number): void {
    if (this.running) {
      this.safeRunFrame();
      const delta = time - this.last;
      if (delta > 0) this.fps = this.fps * 0.9 + (1000 / delta) * 0.1;
      this.notify();
    }
    this.last = time;
    this.rafId = requestAnimationFrame(this.loop);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    this.audioNode?.disconnect();
    void this.audioCtx?.close();
  }
}

let engine: EmuEngine | null = null;

export function ensureEngine(rom: NesRom): EmuEngine {
  if (!engine || engine.rom !== rom) {
    engine?.dispose();
    engine = new EmuEngine(rom);
  }
  return engine;
}

export function currentEngine(): EmuEngine | null {
  return engine;
}

export type { EmuEngine };
