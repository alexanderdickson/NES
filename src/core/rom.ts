export type Mirroring = "horizontal" | "vertical" | "four-screen";
export type Region = "ntsc" | "pal";

export interface NesRom {
  readonly prg: Uint8Array;
  readonly chr: Uint8Array;
  readonly mapper: number;
  readonly mirroring: Mirroring;
  readonly region: Region;
  readonly hasBattery: boolean;
  readonly hasTrainer: boolean;
  /** CHR is RAM (no CHR-ROM present in the file) when true. */
  readonly usesChrRam: boolean;
  readonly prgBanks16k: number;
  readonly chrBanks8k: number;
}

const INES_MAGIC = [0x4e, 0x45, 0x53, 0x1a]; // "NES\x1a"
const HEADER_SIZE = 16;
const TRAINER_SIZE = 512;
const PRG_BANK = 0x4000; // 16 KiB
const CHR_BANK = 0x2000; // 8 KiB

export class RomParseError extends Error {}

export function parseRom(bytes: Uint8Array): NesRom {
  if (bytes.length < HEADER_SIZE) {
    throw new RomParseError("File is too small to be an iNES ROM.");
  }
  for (let i = 0; i < INES_MAGIC.length; i++) {
    if (bytes[i] !== INES_MAGIC[i]) {
      throw new RomParseError('Missing iNES magic number ("NES\\x1a").');
    }
  }

  const prgBanks16k = bytes[4] ?? 0;
  const chrBanks8k = bytes[5] ?? 0;
  const flags6 = bytes[6] ?? 0;
  const flags7 = bytes[7] ?? 0;

  const hasTrainer = (flags6 & 0b0000_0100) !== 0;
  const hasBattery = (flags6 & 0b0000_0010) !== 0;
  const fourScreen = (flags6 & 0b0000_1000) !== 0;
  const verticalMirror = (flags6 & 0b0000_0001) !== 0;
  const mirroring: Mirroring = fourScreen
    ? "four-screen"
    : verticalMirror
      ? "vertical"
      : "horizontal";

  const mapper = (flags7 & 0xf0) | (flags6 >> 4);

  // Region: iNES byte 9 bit0 (0=NTSC, 1=PAL); byte 10 bits1-0 (2 or 3 => PAL)
  // is also honoured as a fallback since byte 9 is often left zero.
  const flags9 = bytes[9] ?? 0;
  const flags10 = bytes[10] ?? 0;
  const isPal = (flags9 & 0x01) !== 0 || (flags10 & 0x03) === 2 || (flags10 & 0x03) === 3;
  const region: Region = isPal ? "pal" : "ntsc";

  const prgSize = prgBanks16k * PRG_BANK;
  const chrSize = chrBanks8k * CHR_BANK;

  let offset = HEADER_SIZE + (hasTrainer ? TRAINER_SIZE : 0);

  if (offset + prgSize > bytes.length) {
    throw new RomParseError(
      `Declared PRG-ROM size (${String(prgSize)} bytes) exceeds file length.`,
    );
  }

  const prg = bytes.slice(offset, offset + prgSize);
  offset += prgSize;

  const usesChrRam = chrSize === 0;
  // If the file is truncated, fall back to what is actually present.
  const availableChr = Math.max(0, Math.min(chrSize, bytes.length - offset));
  const chr = usesChrRam
    ? new Uint8Array(CHR_BANK) // expose an 8 KiB CHR-RAM window
    : bytes.slice(offset, offset + availableChr);

  return {
    prg,
    chr,
    mapper,
    mirroring,
    region,
    hasBattery,
    hasTrainer,
    usesChrRam,
    prgBanks16k,
    chrBanks8k,
  };
}
