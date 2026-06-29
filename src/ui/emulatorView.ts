import type { ViewRenderer } from "./context.ts";
import type { Button } from "../core/emu/controller.ts";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../core/emu/ppu.ts";
import { BUTTONS, ensureEngine } from "./emuEngine.ts";
import { clear, el } from "./dom.ts";

type ScanlineMode = "off" | "light" | "medium" | "heavy";

const SCANLINE_ALPHA: Record<ScanlineMode, number> = {
  off: 0,
  light: 0.18,
  medium: 0.32,
  heavy: 0.5,
};

const BUTTON_LABELS: Record<Button, string> = {
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  a: "A",
  b: "B",
  start: "Start",
  select: "Select",
};

let scale = 2;
let scanlines: ScanlineMode = "off";
let unsubscribe: (() => void) | null = null;

function keyLabel(code: string): string {
  if (!code) return "—";
  return code
    .replace(/^Key/, "")
    .replace(/^Digit/, "")
    .replace(/^Arrow/, "")
    .replace(/Left$/, " L")
    .replace(/Right$/, " R");
}

function scanlineStyle(mode: ScanlineMode): string {
  const alpha = SCANLINE_ALPHA[mode];
  if (alpha === 0) return "display:none";
  const period = Math.max(2, scale);
  return [
    "display:block",
    "position:absolute",
    "inset:0",
    "pointer-events:none",
    `background-image:repeating-linear-gradient(to bottom,` +
      `rgba(0,0,0,0) 0,rgba(0,0,0,0) ${String(period - 1)}px,` +
      `rgba(0,0,0,${String(alpha)}) ${String(period - 1)}px,` +
      `rgba(0,0,0,${String(alpha)}) ${String(period)}px)`,
  ].join(";");
}

export const renderEmulator: ViewRenderer = (container, ctx) => {
  unsubscribe?.();
  clear(container);

  const engine = ensureEngine(ctx.rom);

  const canvas = el("canvas", { class: "emu-canvas" });
  canvas.width = SCREEN_WIDTH * scale;
  canvas.height = SCREEN_HEIGHT * scale;
  const cctx = canvas.getContext("2d");

  const overlay = el("div", { class: "scanline-overlay" });
  overlay.setAttribute("style", scanlineStyle(scanlines));

  const off = document.createElement("canvas");
  off.width = SCREEN_WIDTH;
  off.height = SCREEN_HEIGHT;
  const offCtx = off.getContext("2d");
  const image = offCtx?.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT) ?? null;

  const status = el("span", { class: "hint" });

  const draw = (): void => {
    if (offCtx && image && cctx) {
      image.data.set(engine.nes.ppu.frame);
      offCtx.putImageData(image, 0, 0);
      cctx.imageSmoothingEnabled = false;
      cctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    }
    status.textContent = engine.lastError
      ? `Error: ${engine.lastError}`
      : `${engine.running ? "running" : "paused"} · ${engine.fps.toFixed(0)} fps · frame ${String(engine.nes.ppu.frameCount)}`;
  };
  unsubscribe = engine.subscribe(draw);

  const runBtn = el("button", {
    class: "primary",
    text: engine.running ? "Pause" : "Run",
    onclick: () => {
      engine.toggle();
      runBtn.textContent = engine.running ? "Pause" : "Run";
    },
  });

  const audioBtn = el("button", {
    text: engine.audioEnabled ? "Audio on" : "Enable audio",
    onclick: () => {
      void engine.enableAudio().then(() => {
        audioBtn.textContent = "Audio on";
      });
    },
  });

  const romInput = el("input", { type: "file", class: "file-input" });
  romInput.accept = ".nes";
  romInput.addEventListener("change", () => {
    const file = romInput.files?.[0];
    if (!file) return;
    void file.arrayBuffer().then((buffer) => {
      ctx.loadRom(new Uint8Array(buffer), file.name);
    });
  });
  const romPicker = el("label", { class: "file-label" }, ["Load ROM…", romInput]);

  const scaleSel = el("select", {
    onchange: (event) => {
      scale = Number((event.target as HTMLSelectElement).value);
      renderEmulator(container, ctx);
    },
  });
  for (const s of [1, 2, 3, 4]) {
    const opt = el("option", { value: String(s), text: `${String(s)}×` });
    if (s === scale) opt.selected = true;
    scaleSel.append(opt);
  }

  const scanlineSel = el("select", {
    onchange: (event) => {
      scanlines = (event.target as HTMLSelectElement).value as ScanlineMode;
      overlay.setAttribute("style", scanlineStyle(scanlines));
    },
  });
  for (const [value, label] of [
    ["off", "Off"],
    ["light", "Light"],
    ["medium", "Medium"],
    ["heavy", "Heavy"],
  ] as Array<[ScanlineMode, string]>) {
    const opt = el("option", { value, text: label });
    if (value === scanlines) opt.selected = true;
    scanlineSel.append(opt);
  }

  const regionSel = el("select", {
    onchange: (event) => {
      const value = (event.target as HTMLSelectElement).value;
      engine.setRegion(value === "auto" ? null : (value as "ntsc" | "pal"));
      draw();
    },
  });
  const currentRegion = engine.regionOverride ?? "auto";
  const regionOptions: Array<[string, string]> = [
    ["auto", `Auto (${ctx.rom.region.toUpperCase()})`],
    ["ntsc", "NTSC"],
    ["pal", "PAL"],
  ];
  for (const [value, label] of regionOptions) {
    const opt = el("option", { value, text: label });
    if (value === currentRegion) opt.selected = true;
    regionSel.append(opt);
  }

  const toolbar = el("div", { class: "toolbar" }, [
    runBtn,
    el("button", { text: "Step frame", onclick: () => engine.stepFrame() }),
    el("button", {
      text: "Reset",
      onclick: () => {
        engine.reset();
        draw();
      },
    }),
    audioBtn,
    romPicker,
    el("label", { text: "Scale:" }),
    scaleSel,
    el("label", { text: "Scanlines:" }),
    scanlineSel,
    el("label", { text: "Region:" }),
    regionSel,
    status,
  ]);

  // --- Input configuration ----------------------------------------------
  const bindGrid = el("div", { class: "bind-grid" });
  let listeningFor: Button | null = null;

  const refreshBindings = (): void => {
    clear(bindGrid);
    const bindings = engine.getBindings();
    for (const button of BUTTONS) {
      const isListening = listeningFor === button;
      const keyBtn = el("button", {
        class: isListening ? "bind-key listening" : "bind-key",
        text: isListening ? "Press a key…" : keyLabel(bindings[button]),
        onclick: () => startRebind(button),
      });
      bindGrid.append(
        el("div", { class: "bind-row" }, [
          el("span", { class: "bind-label", text: BUTTON_LABELS[button] }),
          keyBtn,
        ]),
      );
    }
  };

  const startRebind = (button: Button): void => {
    listeningFor = button;
    refreshBindings();
    const capture = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener("keydown", capture, true);
      listeningFor = null;
      if (e.code !== "Escape") engine.setBinding(button, e.code);
      refreshBindings();
    };
    window.addEventListener("keydown", capture, true);
  };

  refreshBindings();

  const inputConfig = el("details", { class: "input-config" }, [
    el("summary", { text: "Configure controls" }),
    el("p", {
      class: "hint",
      text: "Click a key, then press the keyboard key to assign (Esc cancels).",
    }),
    bindGrid,
    el("button", {
      text: "Reset to defaults",
      onclick: () => {
        engine.resetBindings();
        refreshBindings();
      },
    }),
  ]);

  const help = el("p", {
    class: "hint",
    text: "Defaults: arrows = D-pad · Z = A · X = B · Enter = Start · Right Shift = Select. Click Enable audio (browsers require a gesture).",
  });

  container.append(
    toolbar,
    el("div", { class: "canvas-host" }, [el("div", { class: "emu-screen" }, [canvas, overlay])]),
    inputConfig,
    help,
  );
  draw();
};
