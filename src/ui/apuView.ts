import type { ViewRenderer } from "./context.ts";
import type { ChannelName } from "../core/emu/apu.ts";
import { ensureEngine } from "./emuEngine.ts";
import { clear, el } from "./dom.ts";

let unsubscribe: (() => void) | null = null;

const CHANNELS: { id: ChannelName; label: string }[] = [
  { id: "pulse1", label: "Pulse 1" },
  { id: "pulse2", label: "Pulse 2" },
  { id: "triangle", label: "Triangle" },
  { id: "noise", label: "Noise" },
  { id: "dmc", label: "DMC" },
];

export const renderApu: ViewRenderer = (container, ctx) => {
  unsubscribe?.();
  clear(container);

  const engine = ensureEngine(ctx.rom);

  container.append(
    el("p", {
      class: "hint",
      text: "Live APU monitor. Bars show each channel's current output; the scope shows the mixed waveform. Mute channels to isolate them — run the emulator (and enable audio) to hear them.",
    }),
  );

  const bars: Record<string, HTMLElement> = {};
  const meterRows = CHANNELS.map(({ id, label }) => {
    const fill = el("div", { class: "meter-fill" });
    bars[id] = fill;
    const muteBox = el("input", { type: "checkbox" });
    muteBox.checked = engine.nes.apu.mute[id];
    muteBox.addEventListener("change", () => {
      engine.nes.apu.mute[id] = muteBox.checked;
    });
    return el("div", { class: "meter-row" }, [
      el("span", { class: "meter-label", text: label }),
      el("div", { class: "meter" }, [fill]),
      el("label", { class: "mute-label" }, [muteBox, "mute"]),
    ]);
  });

  const scope = el("canvas", { class: "scope" });
  scope.width = 512;
  scope.height = 160;
  const sctx = scope.getContext("2d");

  const draw = (): void => {
    const levels = engine.nes.apu.levels();
    for (const { id } of CHANNELS) {
      const fill = bars[id];
      if (fill) fill.style.width = `${String(Math.round((levels[id] ?? 0) * 100))}%`;
    }
    if (!sctx) return;
    const data = engine.nes.apu.scope;
    sctx.fillStyle = "#0b0d11";
    sctx.fillRect(0, 0, scope.width, scope.height);
    sctx.strokeStyle = "#6ea8fe";
    sctx.lineWidth = 1;
    sctx.beginPath();
    const mid = scope.height / 2;
    for (let i = 0; i < data.length; i++) {
      const x = (i / data.length) * scope.width;
      const y = mid - (data[i] ?? 0) * mid * 4;
      if (i === 0) sctx.moveTo(x, y);
      else sctx.lineTo(x, y);
    }
    sctx.stroke();
  };
  unsubscribe = engine.subscribe(draw);

  container.append(
    el("div", { class: "meters" }, meterRows),
    el("h3", { text: "Oscilloscope (mixed output)" }),
    el("div", { class: "canvas-host" }, [scope]),
  );
  draw();
};
