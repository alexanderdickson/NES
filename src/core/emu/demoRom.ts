// Builds a valid NROM ROM whose program initialises the PPU palette, fills the
// nametable with coloured tile stripes, enables rendering, and starts a square
// wave on APU pulse 1. It exercises CPU + PPU + APU end-to-end and doubles as a
// non-trivial disassembly sample. No copyrighted content is used.

const BASE = 0xc000; // 16 KiB PRG maps to $C000-$FFFF

interface Assembler {
  code: number[];
  labels: Record<string, number>;
  branchFixups: { pos: number; label: string }[];
  absFixups: { pos: number; label: string }[];
}

function buildProgram(): { code: number[]; labels: Record<string, number> } {
  const a: Assembler = { code: [], labels: {}, branchFixups: [], absFixups: [] };
  const emit = (...bytes: number[]): void => {
    for (const b of bytes) a.code.push(b & 0xff);
  };
  const label = (name: string): void => {
    a.labels[name] = a.code.length;
  };
  const branch = (op: number, name: string): void => {
    emit(op, 0);
    a.branchFixups.push({ pos: a.code.length - 1, label: name });
  };
  const abs2 = (op: number, name: string): void => {
    emit(op, 0, 0);
    a.absFixups.push({ pos: a.code.length - 2, label: name });
  };

  emit(0x78); // SEI
  emit(0xd8); // CLD
  emit(0xa2, 0xff); // LDX #$FF
  emit(0x9a); // TXS
  emit(0xa9, 0x00); // LDA #$00
  emit(0x8d, 0x00, 0x20); // STA $2000
  emit(0x8d, 0x01, 0x20); // STA $2001

  label("wait1");
  emit(0x2c, 0x02, 0x20); // BIT $2002
  branch(0x10, "wait1"); // BPL wait1
  label("wait2");
  emit(0x2c, 0x02, 0x20); // BIT $2002
  branch(0x10, "wait2"); // BPL wait2

  emit(0xad, 0x02, 0x20); // LDA $2002 (reset latch)
  emit(0xa9, 0x3f); // LDA #$3F
  emit(0x8d, 0x06, 0x20); // STA $2006
  emit(0xa9, 0x00); // LDA #$00
  emit(0x8d, 0x06, 0x20); // STA $2006
  emit(0xa2, 0x00); // LDX #$00
  label("palloop");
  abs2(0xbd, "palette"); // LDA palette,X
  emit(0x8d, 0x07, 0x20); // STA $2007
  emit(0xe8); // INX
  emit(0xe0, 0x20); // CPX #$20
  branch(0xd0, "palloop"); // BNE palloop

  emit(0xa9, 0x20); // LDA #$20
  emit(0x8d, 0x06, 0x20); // STA $2006
  emit(0xa9, 0x00); // LDA #$00
  emit(0x8d, 0x06, 0x20); // STA $2006
  emit(0xa2, 0x04); // LDX #$04 (4 pages of 256 = 1024 bytes)
  emit(0xa0, 0x00); // LDY #$00
  label("fill");
  emit(0x98); // TYA
  emit(0x29, 0x03); // AND #$03  -> tile = Y & 3
  emit(0x8d, 0x07, 0x20); // STA $2007
  emit(0xc8); // INY
  branch(0xd0, "fill"); // BNE fill
  emit(0xca); // DEX
  branch(0xd0, "fill"); // BNE fill

  emit(0xa9, 0x1e); // LDA #$1E
  emit(0x8d, 0x01, 0x20); // STA $2001 (show bg + sprites)
  emit(0xa9, 0x80); // LDA #$80
  emit(0x8d, 0x00, 0x20); // STA $2000 (enable NMI)

  emit(0xa9, 0x01); // LDA #$01
  emit(0x8d, 0x15, 0x40); // STA $4015 (enable pulse 1)
  emit(0xa9, 0xbf); // LDA #$BF (duty 50%, halt, constant vol 15)
  emit(0x8d, 0x00, 0x40); // STA $4000
  emit(0xa9, 0x00); // LDA #$00
  emit(0x8d, 0x01, 0x40); // STA $4001
  emit(0xa9, 0xfd); // LDA #$FD (timer low ~ A4)
  emit(0x8d, 0x02, 0x40); // STA $4002
  emit(0xa9, 0x08); // LDA #$08 (length load, timer high 0)
  emit(0x8d, 0x03, 0x40); // STA $4003

  label("forever");
  abs2(0x4c, "forever"); // JMP forever

  label("nmi");
  emit(0x40); // RTI
  label("irq");
  emit(0x40); // RTI

  label("palette");
  // 16 background + 16 sprite palette bytes (universal bg = $0F black).
  const palette = [
    0x0f, 0x16, 0x2a, 0x12, 0x0f, 0x27, 0x1a, 0x21, 0x0f, 0x16, 0x2a, 0x12, 0x0f, 0x27, 0x1a, 0x21,
    0x0f, 0x16, 0x2a, 0x12, 0x0f, 0x27, 0x1a, 0x21, 0x0f, 0x16, 0x2a, 0x12, 0x0f, 0x27, 0x1a, 0x21,
  ];
  emit(...palette);

  for (const fix of a.branchFixups) {
    const target = a.labels[fix.label] ?? 0;
    a.code[fix.pos] = (target - (fix.pos + 1)) & 0xff;
  }
  for (const fix of a.absFixups) {
    const target = BASE + (a.labels[fix.label] ?? 0);
    a.code[fix.pos] = target & 0xff;
    a.code[fix.pos + 1] = (target >> 8) & 0xff;
  }
  return { code: a.code, labels: a.labels };
}

function buildChr(): Uint8Array {
  const chr = new Uint8Array(0x2000);
  const setTile = (index: number, plane0: number, plane1: number): void => {
    const base = index * 16;
    for (let y = 0; y < 8; y++) {
      chr[base + y] = plane0;
      chr[base + y + 8] = plane1;
    }
  };
  setTile(0, 0x00, 0x00); // colour 0 (background)
  setTile(1, 0xff, 0x00); // colour 1
  setTile(2, 0x00, 0xff); // colour 2
  setTile(3, 0xff, 0xff); // colour 3
  for (let t = 4; t < 512; t++) {
    const base = t * 16;
    for (let y = 0; y < 8; y++) {
      chr[base + y] = y === 0 || y === 7 ? 0xff : 0x81;
      chr[base + y + 8] = 0x80 >> ((y + t) & 7);
    }
  }
  return chr;
}

export function buildDemoRom(): Uint8Array {
  const PRG_SIZE = 0x4000;
  const prg = new Uint8Array(PRG_SIZE);
  const { code, labels } = buildProgram();
  prg.set(code, 0);

  const setWord = (cpuAddr: number, value: number): void => {
    const off = cpuAddr - BASE;
    prg[off] = value & 0xff;
    prg[off + 1] = (value >> 8) & 0xff;
  };
  setWord(0xfffa, BASE + (labels["nmi"] ?? 0)); // NMI
  setWord(0xfffc, BASE); // RESET → start of program
  setWord(0xfffe, BASE + (labels["irq"] ?? 0)); // IRQ

  const header = new Uint8Array(16);
  header.set([0x4e, 0x45, 0x53, 0x1a]);
  header[4] = 1; // 1 x 16 KiB PRG
  header[5] = 1; // 1 x 8 KiB CHR

  const rom = new Uint8Array(header.length + PRG_SIZE + 0x2000);
  rom.set(header, 0);
  rom.set(prg, header.length);
  rom.set(buildChr(), header.length + PRG_SIZE);
  return rom;
}
