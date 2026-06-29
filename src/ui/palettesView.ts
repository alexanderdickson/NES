import type { ViewRenderer } from "./context.ts";
import { hex2 } from "../core/disassembler.ts";
import { NES_PALETTE } from "../core/ppu.ts";
import { clear, el } from "./dom.ts";

let selectedMaster = 0x0f;

const rgbCss = (index: number): string => {
  const rgb = NES_PALETTE[index] ?? [0, 0, 0];
  return `rgb(${String(rgb[0])}, ${String(rgb[1])}, ${String(rgb[2])})`;
};

export const renderPalettes: ViewRenderer = (container, ctx) => {
  clear(container);

  container.append(
    el("p", {
      class: "hint",
      text: "Click a master color to select it, then click a palette slot to assign it. Edited palettes drive the Tiles view.",
    }),
  );

  // Master palette grid (64 colors).
  const master = el("div", { class: "master-grid" });
  for (let i = 0; i < NES_PALETTE.length; i++) {
    const swatch = el(
      "button",
      {
        class: i === selectedMaster ? "swatch selected" : "swatch",
        title: `$${hex2(i)}`,
        style: { background: rgbCss(i) },
        onclick: () => {
          selectedMaster = i;
          renderPalettes(container, ctx);
        },
      },
      [el("span", { class: "swatch-label", text: hex2(i) })],
    );
    master.append(swatch);
  }

  // Editable palettes.
  const editor = el("div", { class: "palette-editor" });
  ctx.palettes.forEach((palette, pIndex) => {
    const row = el("div", { class: "palette-row" }, [
      el("span", { class: "palette-name", text: `Palette ${String(pIndex)}` }),
    ]);
    palette.forEach((masterIndex, slot) => {
      const slotEl = el(
        "button",
        {
          class: "slot",
          title: `slot ${String(slot)} → $${hex2(masterIndex)}`,
          style: { background: rgbCss(masterIndex) },
          onclick: () => {
            ctx.setPaletteColor(pIndex, slot, selectedMaster);
            renderPalettes(container, ctx);
          },
        },
        [el("span", { class: "swatch-label", text: hex2(masterIndex) })],
      );
      row.append(slotEl);
    });
    editor.append(row);
  });

  container.append(
    el("h3", { text: "Master palette" }),
    master,
    el("h3", { text: "Working palettes" }),
    editor,
  );
};
