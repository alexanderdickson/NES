import type { AppContext, ViewRenderer } from "./context.ts";
import type { NesRom } from "../core/rom.ts";
import type { DisassemblyResult } from "../core/disassembler.ts";
import type { Palette } from "../core/ppu.ts";
import { parseRom, RomParseError } from "../core/rom.ts";
import { AddressSpace } from "../core/memory.ts";
import { disassemble } from "../core/disassembler.ts";
import { buildDemoRom } from "../core/emu/demoRom.ts";
import { isMapperSupported } from "../core/emu/mappers.ts";
import { DEFAULT_PALETTES } from "../core/ppu.ts";
import { clear, el } from "./dom.ts";
import { renderEmulator } from "./emulatorView.ts";
import { renderApu } from "./apuView.ts";
import { renderDisassembly } from "./disassemblyView.ts";
import { renderMemory } from "./memoryView.ts";
import { renderTiles } from "./tilesView.ts";
import { renderPalettes } from "./palettesView.ts";

interface Loaded {
  rom: NesRom;
  mem: AddressSpace;
  disasm: DisassemblyResult;
}

const clonePalette = (p: Palette): Palette => [p[0], p[1], p[2], p[3]];

const TABS: ReadonlyArray<{ id: string; label: string; render: ViewRenderer }> = [
  { id: "emulator", label: "Emulator", render: renderEmulator },
  { id: "disasm", label: "Disassembly", render: renderDisassembly },
  { id: "memory", label: "Memory (peek/poke)", render: renderMemory },
  { id: "tiles", label: "Tiles", render: renderTiles },
  { id: "palettes", label: "Palettes", render: renderPalettes },
  { id: "audio", label: "Audio", render: renderApu },
];

export function mountApp(root: HTMLElement): void {
  let loaded: Loaded | null = null;
  let activeTab = "emulator";
  const palettes: Palette[] = DEFAULT_PALETTES.map(clonePalette);
  let activePalette = 0;

  clear(root);

  const fileInput = el("input", { type: "file", class: "file-input" });
  fileInput.accept = ".nes";

  const status = el("span", { class: "status" });
  const infoPanel = el("div", { class: "info-panel" });
  const tabBar = el("div", { class: "tabs" });
  const content = el("div", { class: "content" });

  const buildContext = (data: Loaded): AppContext => ({
    rom: data.rom,
    mem: data.mem,
    disasm: data.disasm,
    palettes,
    activePalette,
    setActivePalette: (index) => {
      activePalette = index;
    },
    setPaletteColor: (paletteIndex, slot, master) => {
      const current = palettes[paletteIndex];
      if (!current) return;
      const next = [...current] as [number, number, number, number];
      next[slot] = master;
      palettes[paletteIndex] = next;
    },
    reDisassemble: () => {
      data.disasm = disassemble(data.mem, data.rom.prg.length);
    },
  });

  const renderContent = (): void => {
    clear(content);
    if (!loaded) {
      content.append(
        el("div", { class: "empty" }, [
          el("p", { text: "Load a .nes ROM to begin, or try the sample ROM." }),
        ]),
      );
      return;
    }
    const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0];
    if (tab) tab.render(content, buildContext(loaded));
  };

  const renderTabs = (): void => {
    clear(tabBar);
    for (const tab of TABS) {
      tabBar.append(
        el("button", {
          class: tab.id === activeTab ? "tab active" : "tab",
          text: tab.label,
          onclick: () => {
            activeTab = tab.id;
            renderTabs();
            renderContent();
          },
        }),
      );
    }
  };

  const renderInfo = (): void => {
    clear(infoPanel);
    if (!loaded) return;
    const { rom } = loaded;
    const facts: Array<[string, string]> = [
      [
        "Mapper",
        `${String(rom.mapper)}${isMapperSupported(rom.mapper) ? "" : " (unsupported → NROM)"}`,
      ],
      ["PRG-ROM", `${String(rom.prgBanks16k)} × 16 KiB (${String(rom.prg.length)} B)`],
      [
        "CHR",
        rom.usesChrRam
          ? "CHR-RAM"
          : `${String(rom.chrBanks8k)} × 8 KiB (${String(rom.chr.length)} B)`,
      ],
      ["Mirroring", rom.mirroring],
      ["Region", rom.region.toUpperCase()],
      ["Battery", rom.hasBattery ? "yes" : "no"],
      ["Trainer", rom.hasTrainer ? "yes" : "no"],
    ];
    for (const [label, value] of facts) {
      infoPanel.append(
        el("div", { class: "fact" }, [
          el("span", { class: "fact-label", text: label }),
          el("span", { class: "fact-value", text: value }),
        ]),
      );
    }
  };

  const load = (bytes: Uint8Array, name: string): void => {
    try {
      const rom = parseRom(bytes);
      const mem = new AddressSpace(rom);
      const disasm = disassemble(mem, rom.prg.length);
      loaded = { rom, mem, disasm };
      status.textContent = `Loaded ${name} (${String(bytes.length)} bytes)`;
      status.className = "status ok";
    } catch (error) {
      const message = error instanceof RomParseError ? error.message : String(error);
      status.textContent = `Error: ${message}`;
      status.className = "status error";
      loaded = null;
    }
    renderInfo();
    renderTabs();
    renderContent();
  };

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void file.arrayBuffer().then((buffer) => {
      load(new Uint8Array(buffer), file.name);
    });
  });

  const sampleBtn = el("button", {
    text: "Load demo ROM",
    class: "primary",
    onclick: () => {
      load(buildDemoRom(), "demo.nes");
    },
  });

  const header = el("header", { class: "app-header" }, [
    el("div", { class: "title-row" }, [
      el("h1", { text: "NES Emulator & Toolkit" }),
      el("span", {
        class: "subtitle",
        text: "emulation · audio · disassembly · peek/poke · CHR & palette · APU monitor",
      }),
    ]),
    el("div", { class: "controls" }, [
      el("label", { class: "file-label" }, ["Open .nes", fileInput]),
      sampleBtn,
      status,
    ]),
  ]);

  renderTabs();
  renderContent();
  root.append(header, infoPanel, tabBar, content);

  // Start with the demo ROM so the emulator and tools are immediately usable.
  load(buildDemoRom(), "demo.nes");
}
