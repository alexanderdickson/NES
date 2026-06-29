import type { NesRom } from "../rom.ts";

export type MirrorMode = "horizontal" | "vertical" | "single0" | "single1" | "four";

export interface Mapper {
  cpuRead(addr: number): number;
  cpuWrite(addr: number, value: number): void;
  ppuRead(addr: number): number;
  ppuWrite(addr: number, value: number): void;
  mirrorMode(): MirrorMode;
}

function initialMirror(rom: NesRom): MirrorMode {
  if (rom.mirroring === "four-screen") return "four";
  return rom.mirroring === "vertical" ? "vertical" : "horizontal";
}

abstract class BaseMapper implements Mapper {
  protected readonly prg: Uint8Array;
  protected readonly chr: Uint8Array;
  protected readonly chrIsRam: boolean;
  protected readonly prgRam = new Uint8Array(0x2000);
  protected mirror: MirrorMode;

  constructor(protected readonly rom: NesRom) {
    this.prg = rom.prg;
    this.chrIsRam = rom.usesChrRam;
    this.chr = rom.usesChrRam ? new Uint8Array(0x2000) : Uint8Array.from(rom.chr);
    this.mirror = initialMirror(rom);
  }

  mirrorMode(): MirrorMode {
    return this.mirror;
  }

  ppuRead(addr: number): number {
    return this.chr[addr & 0x1fff] ?? 0;
  }

  ppuWrite(addr: number, value: number): void {
    if (this.chrIsRam) this.chr[addr & 0x1fff] = value & 0xff;
  }

  protected readPrgRam(addr: number): number {
    return this.prgRam[addr - 0x6000] ?? 0;
  }

  protected writePrgRam(addr: number, value: number): void {
    this.prgRam[addr - 0x6000] = value & 0xff;
  }

  abstract cpuRead(addr: number): number;
  abstract cpuWrite(addr: number, value: number): void;
}

/** Mapper 0 — NROM. */
class NromMapper extends BaseMapper {
  cpuRead(addr: number): number {
    if (addr >= 0x8000) return this.prg[(addr - 0x8000) % this.prg.length] ?? 0;
    if (addr >= 0x6000) return this.readPrgRam(addr);
    return 0;
  }

  cpuWrite(addr: number, value: number): void {
    if (addr >= 0x6000 && addr < 0x8000) this.writePrgRam(addr, value);
  }
}

/** Mapper 2 — UxROM (switchable 16 KiB PRG bank + fixed last bank, CHR-RAM). */
class UxRomMapper extends BaseMapper {
  private bank = 0;
  private readonly banks = Math.max(1, this.prg.length >> 14);

  cpuRead(addr: number): number {
    if (addr >= 0xc000) {
      return this.prg[(this.banks - 1) * 0x4000 + (addr - 0xc000)] ?? 0;
    }
    if (addr >= 0x8000) return this.prg[this.bank * 0x4000 + (addr - 0x8000)] ?? 0;
    if (addr >= 0x6000) return this.readPrgRam(addr);
    return 0;
  }

  cpuWrite(addr: number, value: number): void {
    if (addr >= 0x8000) this.bank = value % this.banks;
    else if (addr >= 0x6000) this.writePrgRam(addr, value);
  }
}

/** Mapper 3 — CNROM (fixed PRG, switchable 8 KiB CHR bank). */
class CnRomMapper extends BaseMapper {
  private chrBank = 0;
  private readonly chrBanks = Math.max(1, this.chr.length >> 13);

  override ppuRead(addr: number): number {
    return this.chr[this.chrBank * 0x2000 + (addr & 0x1fff)] ?? 0;
  }

  cpuRead(addr: number): number {
    if (addr >= 0x8000) return this.prg[(addr - 0x8000) % this.prg.length] ?? 0;
    if (addr >= 0x6000) return this.readPrgRam(addr);
    return 0;
  }

  cpuWrite(addr: number, value: number): void {
    if (addr >= 0x8000) this.chrBank = (value & 0x03) % this.chrBanks;
    else if (addr >= 0x6000) this.writePrgRam(addr, value);
  }
}

/** Mapper 1 — MMC1 (serial shift register). */
class Mmc1Mapper extends BaseMapper {
  private shift = 0x10;
  private control = 0x0c;
  private chrBank0 = 0;
  private chrBank1 = 0;
  private prgBank = 0;
  private readonly prgBanks = Math.max(1, this.prg.length >> 14);

  private chrBankAddr(addr: number): number {
    const chrMode4k = (this.control & 0x10) !== 0;
    if (chrMode4k) {
      const bank = addr < 0x1000 ? this.chrBank0 : this.chrBank1;
      return bank * 0x1000 + (addr & 0x0fff);
    }
    return (this.chrBank0 & 0x1e) * 0x1000 + (addr & 0x1fff);
  }

  override ppuRead(addr: number): number {
    const a = addr & 0x1fff;
    if (this.chrIsRam) return this.chr[a] ?? 0;
    return this.chr[this.chrBankAddr(a) % Math.max(1, this.chr.length)] ?? 0;
  }

  override ppuWrite(addr: number, value: number): void {
    if (this.chrIsRam) this.chr[addr & 0x1fff] = value & 0xff;
  }

  private prgBankAddr(addr: number): number {
    const mode = (this.control >> 2) & 0x03;
    const last = this.prgBanks - 1;
    if (mode === 0 || mode === 1) {
      // 32 KiB switch.
      const bank = this.prgBank & 0xfe;
      return bank * 0x4000 + (addr - 0x8000);
    }
    if (mode === 2) {
      // Fixed first bank at $8000, switch at $C000.
      if (addr < 0xc000) return addr - 0x8000;
      return this.prgBank * 0x4000 + (addr - 0xc000);
    }
    // mode 3: switch at $8000, fixed last bank at $C000.
    if (addr < 0xc000) return this.prgBank * 0x4000 + (addr - 0x8000);
    return last * 0x4000 + (addr - 0xc000);
  }

  cpuRead(addr: number): number {
    if (addr >= 0x8000) return this.prg[this.prgBankAddr(addr) % this.prg.length] ?? 0;
    if (addr >= 0x6000) return this.readPrgRam(addr);
    return 0;
  }

  cpuWrite(addr: number, value: number): void {
    if (addr < 0x6000) return;
    if (addr < 0x8000) {
      this.writePrgRam(addr, value);
      return;
    }
    if ((value & 0x80) !== 0) {
      this.shift = 0x10;
      this.control |= 0x0c;
      return;
    }
    const complete = (this.shift & 1) === 1;
    this.shift = (this.shift >> 1) | ((value & 1) << 4);
    if (!complete) return;

    const data = this.shift & 0x1f;
    const reg = (addr >> 13) & 0x03;
    if (reg === 0) this.control = data;
    else if (reg === 1) this.chrBank0 = data;
    else if (reg === 2) this.chrBank1 = data;
    else this.prgBank = data % this.prgBanks;
    this.shift = 0x10;

    switch (this.control & 0x03) {
      case 0:
        this.mirror = "single0";
        break;
      case 1:
        this.mirror = "single1";
        break;
      case 2:
        this.mirror = "vertical";
        break;
      default:
        this.mirror = "horizontal";
        break;
    }
  }
}

export function createMapper(rom: NesRom): Mapper {
  switch (rom.mapper) {
    case 1:
      return new Mmc1Mapper(rom);
    case 2:
      return new UxRomMapper(rom);
    case 3:
      return new CnRomMapper(rom);
    case 0:
      return new NromMapper(rom);
    default:
      // Fall back to NROM-like behaviour for unimplemented mappers.
      return new NromMapper(rom);
  }
}

export const SUPPORTED_MAPPERS = [0, 1, 2, 3];
