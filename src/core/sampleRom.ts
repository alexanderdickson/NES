// Builds a tiny but valid iNES (NROM, mapper 0) ROM with a small 6502 program
// and a generated CHR tile sheet, so the tool can be exercised without any
// copyrighted game ROM.

const PRG_SIZE = 0x4000; // 16 KiB
const CHR_SIZE = 0x2000; // 8 KiB

// 16 KiB PRG maps to $C000-$FFFF, so a CPU address translates directly.
const toOffset = (cpuAddr: number): number => cpuAddr - 0xc000;

function buildPrg(): Uint8Array {
  const prg = new Uint8Array(PRG_SIZE);

  // reset @ $C000
  const code = [
    0x78, // SEI
    0xd8, // CLD
    0xa2,
    0xff, // LDX #$FF
    0x9a, // TXS
    0xa9,
    0x00, // LDA #$00
    // loop @ $C007
    0x8d,
    0x00,
    0x20, // STA $2000
    0xe8, // INX
    0x20,
    0x11,
    0xc0, // JSR sub ($C011)
    0x4c,
    0x07,
    0xc0, // JMP loop ($C007)
    // sub @ $C011
    0xa0,
    0x08, // LDY #$08
    0x60, // RTS
    // nmi @ $C014
    0x40, // RTI
    // irq @ $C015
    0x40, // RTI
  ];
  prg.set(code, 0);

  // A small block of obvious data so the listing shows a `.byte` region.
  const data = [0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0x12, 0x34];
  prg.set(data, toOffset(0xc016));

  const setWord = (cpuAddr: number, value: number): void => {
    prg[toOffset(cpuAddr)] = value & 0xff;
    prg[toOffset(cpuAddr) + 1] = (value >> 8) & 0xff;
  };
  setWord(0xfffa, 0xc014); // NMI
  setWord(0xfffc, 0xc000); // RESET
  setWord(0xfffe, 0xc015); // IRQ
  return prg;
}

function buildChr(): Uint8Array {
  const chr = new Uint8Array(CHR_SIZE);
  const tiles = CHR_SIZE / 16;
  for (let t = 0; t < tiles; t++) {
    const base = t * 16;
    for (let y = 0; y < 8; y++) {
      const border = y === 0 || y === 7 ? 0xff : 0x81;
      const diagonal = 0x80 >> ((y + t) & 7);
      chr[base + y] = border; // plane 0
      chr[base + y + 8] = diagonal; // plane 1
    }
  }
  return chr;
}

export function buildSampleRom(): Uint8Array {
  const header = new Uint8Array(16);
  header.set([0x4e, 0x45, 0x53, 0x1a]); // "NES\x1a"
  header[4] = PRG_SIZE / 0x4000; // PRG banks (16 KiB)
  header[5] = CHR_SIZE / 0x2000; // CHR banks (8 KiB)

  const rom = new Uint8Array(header.length + PRG_SIZE + CHR_SIZE);
  rom.set(header, 0);
  rom.set(buildPrg(), header.length);
  rom.set(buildChr(), header.length + PRG_SIZE);
  return rom;
}
