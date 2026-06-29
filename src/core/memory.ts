import type { NesRom } from "./rom.ts";

/**
 * A simplified CPU address-space model used for static analysis, peeking and
 * poking. It is accurate for NROM and a reasonable approximation for larger
 * PRG layouts (the last 32 KiB is mapped into $8000-$FFFF).
 *
 * Layout:
 *   $0000-$1FFF  2 KiB internal RAM, mirrored every $0800
 *   $2000-$401F  PPU / APU / IO registers (modeled as a flat editable buffer)
 *   $4020-$7FFF  expansion / PRG-RAM (flat editable buffer)
 *   $8000-$FFFF  PRG-ROM (mapped from the cartridge)
 */
export class AddressSpace {
  private readonly ram = new Uint8Array(0x0800);
  private readonly io = new Uint8Array(0x2020); // $2000-$401F
  private readonly expansion = new Uint8Array(0x4000); // $4020-$7FFF
  private readonly prg: Uint8Array;
  private readonly prgWindowBase: number;

  constructor(rom: NesRom) {
    this.prg = rom.prg;
    // Map the last 32 KiB (or the whole PRG if smaller) into $8000-$FFFF.
    const window = Math.min(this.prg.length, 0x8000);
    this.prgWindowBase = Math.max(0, this.prg.length - window);
  }

  /** Translate a CPU address in $8000-$FFFF to a PRG-ROM offset, or -1. */
  prgOffsetForAddress(addr: number): number {
    if (addr < 0x8000 || this.prg.length === 0) return -1;
    if (this.prg.length === 0x4000) {
      // 16 KiB NROM mirrors $8000-$BFFF into $C000-$FFFF.
      return (addr - 0x8000) & 0x3fff;
    }
    const offset = this.prgWindowBase + (addr - 0x8000);
    return offset < this.prg.length ? offset : -1;
  }

  read(addr: number): number {
    const a = addr & 0xffff;
    if (a < 0x2000) return this.ram[a & 0x07ff] ?? 0;
    if (a < 0x4020) return this.io[a - 0x2000] ?? 0;
    if (a < 0x8000) return this.expansion[a - 0x4020] ?? 0;
    const off = this.prgOffsetForAddress(a);
    return off >= 0 ? (this.prg[off] ?? 0) : 0;
  }

  /** Read a little-endian 16-bit word. */
  readWord(addr: number): number {
    return this.read(addr) | (this.read(addr + 1) << 8);
  }

  /**
   * Write a byte. Writing into the PRG window pokes the underlying ROM buffer,
   * which is intentional so that the disassembly can be experimented with.
   */
  write(addr: number, value: number): void {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x2000) {
      this.ram[a & 0x07ff] = v;
    } else if (a < 0x4020) {
      this.io[a - 0x2000] = v;
    } else if (a < 0x8000) {
      this.expansion[a - 0x4020] = v;
    } else {
      const off = this.prgOffsetForAddress(a);
      if (off >= 0) this.prg[off] = v;
    }
  }

  get resetVector(): number {
    return this.readWord(0xfffc);
  }
  get nmiVector(): number {
    return this.readWord(0xfffa);
  }
  get irqVector(): number {
    return this.readWord(0xfffe);
  }
}
