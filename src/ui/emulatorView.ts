import type { ViewRenderer } from "./context.ts";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../core/emu/ppu.ts";
import { ensureEngine } from "./emuEngine.ts";
import { clear, el } from "./dom.ts";

let scale = 2;
let unsubscribe: (() => void) | null = null;

export const renderEmulator: ViewRenderer = (container, ctx) => {
  unsubscribe?.();
  clear(container);

  const engine = ensureEngine(ctx.rom);

  const canvas = el("canvas", { class: "emu-canvas" });
  canvas.width = SCREEN_WIDTH * scale;
  canvas.height = SCREEN_HEIGHT * scale;
  const cctx = canvas.getContext("2d");

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
    el("label", { text: "Scale:" }),
    scaleSel,
    status,
  ]);

  const help = el("p", {
    class: "hint",
    text: "Controls: arrows = D-pad · Z = A · X = B · Enter = Start · Shift = Select. Click Enable audio (browsers require a gesture).",
  });

  container.append(toolbar, el("div", { class: "canvas-host" }, [canvas]), help);
  draw();
};
