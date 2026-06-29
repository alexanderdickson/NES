import type { ViewRenderer } from "./context.ts";
import { hex4 } from "../core/disassembler.ts";
import { renderTileSheet, tileCount, TILE_SIZE } from "../core/ppu.ts";
import { clear, el } from "./dom.ts";

const TILES_PER_ROW = 16;
let zoom = 3;
let region = 0; // 0 = all, 1 = pattern table 0, 2 = pattern table 1

export const renderTiles: ViewRenderer = (container, ctx) => {
  clear(container);
  const { rom, palettes, activePalette } = ctx;
  const chr = rom.chr;
  const total = tileCount(chr);

  if (rom.usesChrRam) {
    container.append(
      el("p", {
        class: "hint",
        text: "This ROM uses CHR-RAM (no CHR-ROM in the file). Showing the empty 8 KiB CHR window.",
      }),
    );
  }

  const palette = palettes[activePalette] ?? palettes[0] ?? [0x0f, 0x00, 0x10, 0x30];

  let startTile = 0;
  let count = total;
  if (region === 1) {
    startTile = 0;
    count = Math.min(256, total);
  } else if (region === 2) {
    startTile = 256;
    count = Math.max(0, Math.min(256, total - 256));
  }

  const sheet = renderTileSheet(chr, palette, TILES_PER_ROW, startTile, count);
  const off = el("canvas");
  off.width = sheet.width;
  off.height = sheet.height;
  const offCtx = off.getContext("2d");
  if (offCtx) {
    const imageData = offCtx.createImageData(sheet.width, sheet.height);
    imageData.data.set(sheet.data);
    offCtx.putImageData(imageData, 0, 0);
  }

  const canvas = el("canvas", { class: "tile-canvas" });
  canvas.width = sheet.width * zoom;
  canvas.height = sheet.height * zoom;
  const cctx = canvas.getContext("2d");
  if (cctx) {
    cctx.imageSmoothingEnabled = false;
    cctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  const info = el("span", { class: "hint", text: `${String(count)} tiles` });
  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / (TILE_SIZE * zoom));
    const y = Math.floor((event.clientY - rect.top) / (TILE_SIZE * zoom));
    const tile = startTile + y * TILES_PER_ROW + x;
    if (tile >= startTile && tile < startTile + count) {
      info.textContent = `tile #${String(tile)} · CHR $${hex4(tile * 16)}`;
    }
  });

  const regionSel = el("select", {
    onchange: (event) => {
      region = Number((event.target as HTMLSelectElement).value);
      renderTiles(container, ctx);
    },
  });
  for (const [value, label] of [
    [0, "All CHR"],
    [1, "Pattern table 0"],
    [2, "Pattern table 1"],
  ] as const) {
    const opt = el("option", { value: String(value), text: label });
    if (value === region) opt.selected = true;
    regionSel.append(opt);
  }

  const paletteSel = el("select", {
    onchange: (event) => {
      ctx.setActivePalette(Number((event.target as HTMLSelectElement).value));
      renderTiles(container, ctx);
    },
  });
  palettes.forEach((_, i) => {
    const opt = el("option", { value: String(i), text: `Palette ${String(i)}` });
    if (i === activePalette) opt.selected = true;
    paletteSel.append(opt);
  });

  const zoomSel = el("select", {
    onchange: (event) => {
      zoom = Number((event.target as HTMLSelectElement).value);
      renderTiles(container, ctx);
    },
  });
  for (const z of [1, 2, 3, 4, 6, 8]) {
    const opt = el("option", { value: String(z), text: `${String(z)}×` });
    if (z === zoom) opt.selected = true;
    zoomSel.append(opt);
  }

  const toolbar = el("div", { class: "toolbar" }, [
    el("label", { text: "Region:" }),
    regionSel,
    el("label", { text: "Palette:" }),
    paletteSel,
    el("label", { text: "Zoom:" }),
    zoomSel,
    info,
  ]);

  container.append(toolbar, el("div", { class: "canvas-host" }, [canvas]));
};
