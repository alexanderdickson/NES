import type { AddressingMode, Opcode } from "./types.ts";
import { OPERAND_BYTES } from "./types.ts";

// Compact source-of-truth for the 6502 opcode matrix. Each entry is
// "MNEMONIC mode cycles"; undocumented (illegal) opcodes are prefixed with "*".
// Index in the array equals the opcode byte (0x00..0xFF). Cycle counts are the
// base values; the CPU core applies page-cross / branch-taken penalties.
// prettier-ignore
const TABLE: readonly string[] = [
  // 0x00
  "BRK imp 7", "ORA izx 6", "*KIL imp 0", "*SLO izx 8", "*NOP zp 3", "ORA zp 3", "ASL zp 5", "*SLO zp 5",
  "PHP imp 3", "ORA imm 2", "ASL acc 2", "*ANC imm 2", "*NOP abs 4", "ORA abs 4", "ASL abs 6", "*SLO abs 6",
  // 0x10
  "BPL rel 2", "ORA izy 5", "*KIL imp 0", "*SLO izy 8", "*NOP zpx 4", "ORA zpx 4", "ASL zpx 6", "*SLO zpx 6",
  "CLC imp 2", "ORA aby 4", "*NOP imp 2", "*SLO aby 7", "*NOP abx 4", "ORA abx 4", "ASL abx 7", "*SLO abx 7",
  // 0x20
  "JSR abs 6", "AND izx 6", "*KIL imp 0", "*RLA izx 8", "BIT zp 3", "AND zp 3", "ROL zp 5", "*RLA zp 5",
  "PLP imp 4", "AND imm 2", "ROL acc 2", "*ANC imm 2", "BIT abs 4", "AND abs 4", "ROL abs 6", "*RLA abs 6",
  // 0x30
  "BMI rel 2", "AND izy 5", "*KIL imp 0", "*RLA izy 8", "*NOP zpx 4", "AND zpx 4", "ROL zpx 6", "*RLA zpx 6",
  "SEC imp 2", "AND aby 4", "*NOP imp 2", "*RLA aby 7", "*NOP abx 4", "AND abx 4", "ROL abx 7", "*RLA abx 7",
  // 0x40
  "RTI imp 6", "EOR izx 6", "*KIL imp 0", "*SRE izx 8", "*NOP zp 3", "EOR zp 3", "LSR zp 5", "*SRE zp 5",
  "PHA imp 3", "EOR imm 2", "LSR acc 2", "*ALR imm 2", "JMP abs 3", "EOR abs 4", "LSR abs 6", "*SRE abs 6",
  // 0x50
  "BVC rel 2", "EOR izy 5", "*KIL imp 0", "*SRE izy 8", "*NOP zpx 4", "EOR zpx 4", "LSR zpx 6", "*SRE zpx 6",
  "CLI imp 2", "EOR aby 4", "*NOP imp 2", "*SRE aby 7", "*NOP abx 4", "EOR abx 4", "LSR abx 7", "*SRE abx 7",
  // 0x60
  "RTS imp 6", "ADC izx 6", "*KIL imp 0", "*RRA izx 8", "*NOP zp 3", "ADC zp 3", "ROR zp 5", "*RRA zp 5",
  "PLA imp 4", "ADC imm 2", "ROR acc 2", "*ARR imm 2", "JMP ind 5", "ADC abs 4", "ROR abs 6", "*RRA abs 6",
  // 0x70
  "BVS rel 2", "ADC izy 5", "*KIL imp 0", "*RRA izy 8", "*NOP zpx 4", "ADC zpx 4", "ROR zpx 6", "*RRA zpx 6",
  "SEI imp 2", "ADC aby 4", "*NOP imp 2", "*RRA aby 7", "*NOP abx 4", "ADC abx 4", "ROR abx 7", "*RRA abx 7",
  // 0x80
  "*NOP imm 2", "STA izx 6", "*NOP imm 2", "*SAX izx 6", "STY zp 3", "STA zp 3", "STX zp 3", "*SAX zp 3",
  "DEY imp 2", "*NOP imm 2", "TXA imp 2", "*XAA imm 2", "STY abs 4", "STA abs 4", "STX abs 4", "*SAX abs 4",
  // 0x90
  "BCC rel 2", "STA izy 6", "*KIL imp 0", "*AHX izy 6", "STY zpx 4", "STA zpx 4", "STX zpy 4", "*SAX zpy 4",
  "TYA imp 2", "STA aby 5", "TXS imp 2", "*TAS aby 5", "*SHY abx 5", "STA abx 5", "*SHX aby 5", "*AHX aby 5",
  // 0xA0
  "LDY imm 2", "LDA izx 6", "LDX imm 2", "*LAX izx 6", "LDY zp 3", "LDA zp 3", "LDX zp 3", "*LAX zp 3",
  "TAY imp 2", "LDA imm 2", "TAX imp 2", "*LAX imm 2", "LDY abs 4", "LDA abs 4", "LDX abs 4", "*LAX abs 4",
  // 0xB0
  "BCS rel 2", "LDA izy 5", "*KIL imp 0", "*LAX izy 5", "LDY zpx 4", "LDA zpx 4", "LDX zpy 4", "*LAX zpy 4",
  "CLV imp 2", "LDA aby 4", "TSX imp 2", "*LAS aby 4", "LDY abx 4", "LDA abx 4", "LDX aby 4", "*LAX aby 4",
  // 0xC0
  "CPY imm 2", "CMP izx 6", "*NOP imm 2", "*DCP izx 8", "CPY zp 3", "CMP zp 3", "DEC zp 5", "*DCP zp 5",
  "INY imp 2", "CMP imm 2", "DEX imp 2", "*AXS imm 2", "CPY abs 4", "CMP abs 4", "DEC abs 6", "*DCP abs 6",
  // 0xD0
  "BNE rel 2", "CMP izy 5", "*KIL imp 0", "*DCP izy 8", "*NOP zpx 4", "CMP zpx 4", "DEC zpx 6", "*DCP zpx 6",
  "CLD imp 2", "CMP aby 4", "*NOP imp 2", "*DCP aby 7", "*NOP abx 4", "CMP abx 4", "DEC abx 7", "*DCP abx 7",
  // 0xE0
  "CPX imm 2", "SBC izx 6", "*NOP imm 2", "*ISC izx 8", "CPX zp 3", "SBC zp 3", "INC zp 5", "*ISC zp 5",
  "INX imp 2", "SBC imm 2", "NOP imp 2", "*SBC imm 2", "CPX abs 4", "SBC abs 4", "INC abs 6", "*ISC abs 6",
  // 0xF0
  "BEQ rel 2", "SBC izy 5", "*KIL imp 0", "*ISC izy 8", "*NOP zpx 4", "SBC zpx 4", "INC zpx 6", "*ISC zpx 6",
  "SED imp 2", "SBC aby 4", "*NOP imp 2", "*ISC aby 7", "*NOP abx 4", "SBC abx 4", "INC abx 7", "*ISC abx 7",
];

function parseEntry(entry: string): Opcode {
  const official = !entry.startsWith("*");
  const cleaned = official ? entry : entry.slice(1);
  const [mnemonic, mode, cycles] = cleaned.split(" ") as [string, AddressingMode, string];
  return { mnemonic, mode, official, cycles: Number(cycles) };
}

export const OPCODES: readonly Opcode[] = TABLE.map(parseEntry);

export function getOpcode(byte: number): Opcode {
  const op = OPCODES[byte & 0xff];
  // Table is exhaustive (256 entries) so this is always defined.
  return op ?? { mnemonic: "???", mode: "imp", official: false, cycles: 0 };
}

/** Total instruction length in bytes (opcode + operands). */
export function instructionLength(op: Opcode): number {
  return 1 + OPERAND_BYTES[op.mode];
}
