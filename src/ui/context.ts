import type { NesRom } from "../core/rom.ts";
import type { AddressSpace } from "../core/memory.ts";
import type { DisassemblyResult } from "../core/disassembler.ts";
import type { Palette } from "../core/ppu.ts";

export interface AppContext {
  readonly rom: NesRom;
  readonly mem: AddressSpace;
  readonly disasm: DisassemblyResult;
  readonly palettes: Palette[];
  readonly activePalette: number;
  setActivePalette(index: number): void;
  setPaletteColor(paletteIndex: number, slot: number, master: number): void;
  /** Re-run the recursive scan (e.g. after poking PRG-ROM). */
  reDisassemble(): void;
  /** Load a different ROM from raw bytes (rebuilds all views). */
  loadRom(bytes: Uint8Array, name: string): void;
}

export type ViewRenderer = (container: HTMLElement, ctx: AppContext) => void;
