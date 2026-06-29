import type { NesRom } from "../rom.ts";

export type MirrorMode = "horizontal" | "vertical" | "single0" | "single1" | "four";

export interface Mapper {
  cpuRead(addr: number): number;
  cpuWrite(addr: number, value: number): void;
  ppuRead(addr: number): number;
  ppuWrite(addr: number, value: number): void;
  mirrorMode(): MirrorMode;
  /** Called once per rendered scanline; used by mappers with a scanline IRQ. */
  onScanlineTick?(): void;
  /** True while the mapper is asserting an IRQ (level-triggered). */
  irqPending?(): boolean;
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
  protected readonly fourScreen: boolean;

  constructor(protected readonly rom: NesRom) {
    this.prg = rom.prg;
    this.chrIsRam = rom.usesChrRam;
    this.chr = rom.usesChrRam ? new Uint8Array(0x2000) : Uint8Array.from(rom.chr);
    this.mirror = initialMirror(rom);
    this.fourScreen = rom.mirroring === "four-screen";
  }

  protected get prgBanks8k(): number {
    return Math.max(1, this.prg.length >> 13);
  }
  protected get prgBanks16k(): number {
    return Math.max(1, this.prg.length >> 14);
  }
  protected get prgBanks32k(): number {
    return Math.max(1, this.prg.length >> 15);
  }
  protected get chrBanks8k(): number {
    return Math.max(1, this.chr.length >> 13);
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

  protected chrByte(offset: number): number {
    return this.chr[offset % this.chr.length] ?? 0;
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

/** Mapper 2 — UxROM. */
class UxRomMapper extends BaseMapper {
  private bank = 0;

  cpuRead(addr: number): number {
    if (addr >= 0xc000) {
      return this.prg[(this.prgBanks16k - 1) * 0x4000 + (addr - 0xc000)] ?? 0;
    }
    if (addr >= 0x8000) return this.prg[this.bank * 0x4000 + (addr - 0x8000)] ?? 0;
    if (addr >= 0x6000) return this.readPrgRam(addr);
    return 0;
  }

  cpuWrite(addr: number, value: number): void {
    if (addr >= 0x8000) this.bank = value % this.prgBanks16k;
    else if (addr >= 0x6000) this.writePrgRam(addr, value);
  }
}

/** Mapper 71 — Camerica/Codemasters (UxROM-like). */
class CamericaMapper extends BaseMapper {
  private bank = 0;

  cpuRead(addr: number): number {
    if (addr >= 0xc000) {
      return this.prg[(this.prgBanks16k - 1) * 0x4000 + (addr - 0xc000)] ?? 0;
    }
    if (addr >= 0x8000) return this.prg[this.bank * 0x4000 + (addr - 0x8000)] ?? 0;
    if (addr >= 0x6000) return this.readPrgRam(addr);
    return 0;
  }

  cpuWrite(addr: number, value: number): void {
    if (addr >= 0xc000) this.bank = value % this.prgBanks16k;
    else if (addr >= 0x6000 && addr < 0x8000) this.writePrgRam(addr, value);
  }
}

/** Mapper 3 — CNROM. */
class CnRomMapper extends BaseMapper {
  private chrBank = 0;

  override ppuRead(addr: number): number {
    return this.chrByte(this.chrBank * 0x2000 + (addr & 0x1fff));
  }

  cpuRead(addr: number): number {
    if (addr >= 0x8000) return this.prg[(addr - 0x8000) % this.prg.length] ?? 0;
    if (addr >= 0x6000) return this.readPrgRam(addr);
    return 0;
  }

  cpuWrite(addr: number, value: number): void {
    if (addr >= 0x8000) this.chrBank = (value & 0x03) % this.chrBanks8k;
    else if (addr >= 0x6000) this.writePrgRam(addr, value);
  }
}

/** Mapper 11 — Color Dreams (PRG 32K + CHR 8K bank select). */
class ColorDreamsMapper extends BaseMapper {
  private prgBank = 0;
  private chrBank = 0;

  override ppuRead(addr: number): number {
    return this.chrByte(this.chrBank * 0x2000 + (addr & 0x1fff));
  }

  cpuRead(addr: number): number {
    if (addr >= 0x8000) return this.prg[this.prgBank * 0x8000 + (addr - 0x8000)] ?? 0;
    if (addr >= 0x6000) return this.readPrgRam(addr);
    return 0;
  }

  cpuWrite(addr: number, value: number): void {
    if (addr >= 0x8000) {
      this.prgBank = (value & 0x03) % this.prgBanks32k;
      this.chrBank = ((value >> 4) & 0x0f) % this.chrBanks8k;
    } else if (addr >= 0x6000) {
      this.writePrgRam(addr, value);
    }
  }
}

/** Mapper 66 — GxROM (PRG 32K + CHR 8K bank select). */
class GxRomMapper extends BaseMapper {
  private prgBank = 0;
  private chrBank = 0;

  override ppuRead(addr: number): number {
    return this.chrByte(this.chrBank * 0x2000 + (addr & 0x1fff));
  }

  cpuRead(addr: number): number {
    if (addr >= 0x8000) return this.prg[this.prgBank * 0x8000 + (addr - 0x8000)] ?? 0;
    if (addr >= 0x6000) return this.readPrgRam(addr);
    return 0;
  }

  cpuWrite(addr: number, value: number): void {
    if (addr >= 0x8000) {
      this.prgBank = ((value >> 4) & 0x03) % this.prgBanks32k;
      this.chrBank = (value & 0x03) % this.chrBanks8k;
    } else if (addr >= 0x6000) {
      this.writePrgRam(addr, value);
    }
  }
}

/** Mapper 7 — AxROM (32K PRG bank + single-screen mirroring). */
class AxRomMapper extends BaseMapper {
  private bank = 0;

  constructor(rom: NesRom) {
    super(rom);
    this.mirror = "single0";
  }

  cpuRead(addr: number): number {
    if (addr >= 0x8000) return this.prg[this.bank * 0x8000 + (addr - 0x8000)] ?? 0;
    if (addr >= 0x6000) return this.readPrgRam(addr);
    return 0;
  }

  cpuWrite(addr: number, value: number): void {
    if (addr >= 0x8000) {
      this.bank = (value & 0x07) % this.prgBanks32k;
      this.mirror = (value & 0x10) !== 0 ? "single1" : "single0";
    } else if (addr >= 0x6000) {
      this.writePrgRam(addr, value);
    }
  }
}

/** Mapper 1 — MMC1. */
class Mmc1Mapper extends BaseMapper {
  private shift = 0x10;
  private control = 0x0c;
  private chrBank0 = 0;
  private chrBank1 = 0;
  private prgBank = 0;

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
    return this.chrByte(this.chrBankAddr(a));
  }

  override ppuWrite(addr: number, value: number): void {
    if (this.chrIsRam) this.chr[addr & 0x1fff] = value & 0xff;
  }

  private prgBankAddr(addr: number): number {
    const mode = (this.control >> 2) & 0x03;
    const last = this.prgBanks16k - 1;
    if (mode === 0 || mode === 1) {
      const bank = this.prgBank & 0xfe;
      return bank * 0x4000 + (addr - 0x8000);
    }
    if (mode === 2) {
      if (addr < 0xc000) return addr - 0x8000;
      return this.prgBank * 0x4000 + (addr - 0xc000);
    }
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
    else this.prgBank = data % this.prgBanks16k;
    this.shift = 0x10;

    if (!this.fourScreen) {
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
}

/** Mappers 9 & 10 — MMC2 / MMC4 (CHR latch). */
class Mmc2Mapper extends BaseMapper {
  private prgBank = 0;
  private readonly chrFd = [0, 0];
  private readonly chrFe = [0, 0];
  private readonly latch = [0xfe, 0xfe]; // 0xFD or 0xFE per 4K window
  private readonly is16kPrg: boolean;

  constructor(rom: NesRom) {
    super(rom);
    this.is16kPrg = rom.mapper === 10; // MMC4 = 16K PRG, MMC2 = 8K PRG
  }

  override ppuRead(addr: number): number {
    const a = addr & 0x1fff;
    const window = a < 0x1000 ? 0 : 1;
    const useFd = this.latch[window] === 0xfd;
    const bank = useFd ? (this.chrFd[window] ?? 0) : (this.chrFe[window] ?? 0);
    const value = this.chrByte(bank * 0x1000 + (a & 0x0fff));
    // Update latches based on the fetched address (covers MMC2 exact $0FD8/$0FE8
    // and MMC4 ranges $0FD8-$0FDF / $0FE8-$0FEF).
    if (a >= 0x0fd8 && a <= 0x0fdf) this.latch[0] = 0xfd;
    else if (a >= 0x0fe8 && a <= 0x0fef) this.latch[0] = 0xfe;
    else if (a >= 0x1fd8 && a <= 0x1fdf) this.latch[1] = 0xfd;
    else if (a >= 0x1fe8 && a <= 0x1fef) this.latch[1] = 0xfe;
    return value;
  }

  cpuRead(addr: number): number {
    if (addr >= 0x6000 && addr < 0x8000) return this.readPrgRam(addr);
    if (addr < 0x8000) return 0;
    if (this.is16kPrg) {
      if (addr >= 0xc000) {
        return this.prg[(this.prgBanks16k - 1) * 0x4000 + (addr - 0xc000)] ?? 0;
      }
      return this.prg[this.prgBank * 0x4000 + (addr - 0x8000)] ?? 0;
    }
    if (addr >= 0xa000) {
      const fixed = this.prgBanks8k - 3;
      const slot = (addr - 0xa000) >> 13;
      return this.prg[(fixed + slot) * 0x2000 + (addr & 0x1fff)] ?? 0;
    }
    return this.prg[this.prgBank * 0x2000 + (addr - 0x8000)] ?? 0;
  }

  cpuWrite(addr: number, value: number): void {
    if (addr < 0x6000) return;
    if (addr < 0x8000) {
      this.writePrgRam(addr, value);
      return;
    }
    const range = addr & 0xf000;
    switch (range) {
      case 0xa000:
        this.prgBank = value % (this.is16kPrg ? this.prgBanks16k : this.prgBanks8k);
        break;
      case 0xb000:
        this.chrFd[0] = value & 0x1f;
        break;
      case 0xc000:
        this.chrFe[0] = value & 0x1f;
        break;
      case 0xd000:
        this.chrFd[1] = value & 0x1f;
        break;
      case 0xe000:
        this.chrFe[1] = value & 0x1f;
        break;
      case 0xf000:
        if (!this.fourScreen) this.mirror = (value & 1) !== 0 ? "horizontal" : "vertical";
        break;
      default:
        break;
    }
  }
}

/** Mapper 4 — MMC3 (banking + scanline IRQ). */
class Mmc3Mapper extends BaseMapper {
  private bankSelect = 0;
  private readonly r = [0, 0, 0, 0, 0, 0, 0, 0];
  private irqLatch = 0;
  private irqCounter = 0;
  private irqReload = false;
  private irqEnable = false;
  private irqFlag = false;

  constructor(rom: NesRom) {
    super(rom);
    if (!this.fourScreen) this.mirror = "vertical";
  }

  private prgOffset(addr: number): number {
    const banks = this.prgBanks8k;
    const last = banks - 1;
    const secondLast = banks - 2;
    const slot = (addr - 0x8000) >> 13;
    const mode = (this.bankSelect & 0x40) !== 0;
    let bank: number;
    if (slot === 0) bank = mode ? secondLast : (this.r[6] ?? 0);
    else if (slot === 1) bank = this.r[7] ?? 0;
    else if (slot === 2) bank = mode ? (this.r[6] ?? 0) : secondLast;
    else bank = last;
    return (bank % banks) * 0x2000 + (addr & 0x1fff);
  }

  private chrOffset(addr: number): number {
    const slot = (addr >> 10) & 0x07;
    const mode = (this.bankSelect & 0x80) !== 0;
    const r = this.r;
    const r0 = (r[0] ?? 0) & 0xfe;
    const r1 = (r[1] ?? 0) & 0xfe;
    const big = [r0, r0 | 1, r1, r1 | 1];
    const small = [r[2] ?? 0, r[3] ?? 0, r[4] ?? 0, r[5] ?? 0];
    const lo = mode ? small : big;
    const hi = mode ? big : small;
    const bank1k = (slot < 4 ? lo[slot] : hi[slot - 4]) ?? 0;
    return bank1k * 0x400 + (addr & 0x3ff);
  }

  override ppuRead(addr: number): number {
    return this.chrByte(this.chrOffset(addr & 0x1fff));
  }

  override ppuWrite(addr: number, value: number): void {
    if (this.chrIsRam) this.chr[this.chrOffset(addr & 0x1fff) % this.chr.length] = value & 0xff;
  }

  cpuRead(addr: number): number {
    if (addr >= 0x8000) return this.prg[this.prgOffset(addr) % this.prg.length] ?? 0;
    if (addr >= 0x6000) return this.readPrgRam(addr);
    return 0;
  }

  cpuWrite(addr: number, value: number): void {
    if (addr < 0x6000) return;
    if (addr < 0x8000) {
      this.writePrgRam(addr, value);
      return;
    }
    const even = (addr & 1) === 0;
    const range = addr & 0xe000;
    if (range === 0x8000) {
      if (even) this.bankSelect = value;
      else this.r[this.bankSelect & 0x07] = value;
    } else if (range === 0xa000) {
      if (even && !this.fourScreen) {
        this.mirror = (value & 1) !== 0 ? "horizontal" : "vertical";
      }
    } else if (range === 0xc000) {
      if (even) this.irqLatch = value;
      else this.irqReload = true;
    } else {
      if (even) {
        this.irqEnable = false;
        this.irqFlag = false;
      } else {
        this.irqEnable = true;
      }
    }
  }

  onScanlineTick(): void {
    if (this.irqCounter === 0 || this.irqReload) {
      this.irqCounter = this.irqLatch;
      this.irqReload = false;
    } else {
      this.irqCounter -= 1;
    }
    if (this.irqCounter === 0 && this.irqEnable) this.irqFlag = true;
  }

  irqPending(): boolean {
    return this.irqFlag;
  }
}

export const SUPPORTED_MAPPERS = [0, 1, 2, 3, 4, 7, 9, 10, 11, 66, 71];

export function isMapperSupported(mapper: number): boolean {
  return SUPPORTED_MAPPERS.includes(mapper);
}

export function createMapper(rom: NesRom): Mapper {
  switch (rom.mapper) {
    case 1:
      return new Mmc1Mapper(rom);
    case 2:
      return new UxRomMapper(rom);
    case 3:
      return new CnRomMapper(rom);
    case 4:
      return new Mmc3Mapper(rom);
    case 7:
      return new AxRomMapper(rom);
    case 9:
    case 10:
      return new Mmc2Mapper(rom);
    case 11:
      return new ColorDreamsMapper(rom);
    case 66:
      return new GxRomMapper(rom);
    case 71:
      return new CamericaMapper(rom);
    case 0:
    default:
      // Unimplemented mappers fall back to NROM behaviour.
      return new NromMapper(rom);
  }
}
