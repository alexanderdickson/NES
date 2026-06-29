import type { NesRom } from "../core/rom.ts";
import type { Button } from "../core/emu/controller.ts";
import { Nes } from "../core/emu/nes.ts";

const SAMPLE_RATE = 44100;
const AUDIO_BUFFER = 1024;

const KEY_MAP: Record<string, Button> = {
  KeyZ: "a",
  KeyX: "b",
  Enter: "start",
  ShiftRight: "select",
  ShiftLeft: "select",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

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

  constructor(public rom: NesRom) {
    this.nes = new Nes(rom, SAMPLE_RATE);
    this.keyDown = (e) => this.handleKey(e, true);
    this.keyUp = (e) => this.handleKey(e, false);
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    this.loop = this.loop.bind(this);
    this.rafId = requestAnimationFrame(this.loop);
  }

  private handleKey(e: KeyboardEvent, pressed: boolean): void {
    const button = KEY_MAP[e.code];
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
    this.nes = new Nes(this.rom, SAMPLE_RATE);
    this.lastError = null;
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
