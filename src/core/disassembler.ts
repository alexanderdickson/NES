import type { AddressSpace } from "./memory.ts";
import type { Opcode } from "./types.ts";
import { getOpcode, instructionLength } from "./opcodes.ts";
import { OPERAND_BYTES } from "./types.ts";

export const hex2 = (n: number): string => (n & 0xff).toString(16).toUpperCase().padStart(2, "0");
export const hex4 = (n: number): string => (n & 0xffff).toString(16).toUpperCase().padStart(4, "0");

const BRANCHES = new Set(["BPL", "BMI", "BVC", "BVS", "BCC", "BCS", "BNE", "BEQ"]);
const TERMINATORS = new Set(["RTS", "RTI", "BRK", "KIL"]);

export interface Instruction {
  readonly address: number;
  readonly bytes: readonly number[];
  readonly opcode: Opcode;
  readonly length: number;
  readonly operand: number | undefined;
  /** Resolved control-flow target (for branches / JSR / absolute JMP). */
  readonly target: number | undefined;
}

export type LabelKind = "reset" | "nmi" | "irq" | "sub" | "loc";

export interface ListingLine {
  readonly address: number;
  readonly kind: "label" | "instruction" | "data";
  readonly label?: string;
  readonly bytes?: readonly number[];
  readonly text?: string;
  readonly comment?: string;
}

export interface DisassemblyResult {
  readonly lines: readonly ListingLine[];
  readonly instructions: ReadonlyMap<number, Instruction>;
  readonly labels: ReadonlyMap<number, string>;
  readonly start: number;
  readonly end: number;
  readonly stats: {
    readonly instructionCount: number;
    readonly codeBytes: number;
    readonly dataBytes: number;
  };
}

function decodeAt(mem: AddressSpace, addr: number): Instruction {
  const opByte = mem.read(addr);
  const opcode = getOpcode(opByte);
  const length = instructionLength(opcode);
  const bytes: number[] = [];
  for (let i = 0; i < length; i++) bytes.push(mem.read(addr + i));

  const operandSize = OPERAND_BYTES[opcode.mode];
  let operand: number | undefined;
  if (operandSize === 1) operand = mem.read(addr + 1);
  else if (operandSize === 2) operand = mem.read(addr + 1) | (mem.read(addr + 2) << 8);

  let target: number | undefined;
  if (opcode.mode === "rel" && operand !== undefined) {
    target = (addr + length + ((operand << 24) >> 24)) & 0xffff;
  } else if ((opcode.mnemonic === "JMP" || opcode.mnemonic === "JSR") && opcode.mode === "abs") {
    target = operand;
  }

  return { address: addr, bytes, opcode, length, operand, target };
}

interface ScanState {
  readonly instructions: Map<number, Instruction>;
  readonly jsrTargets: Set<number>;
  readonly branchTargets: Set<number>;
}

function inRange(addr: number, start: number, end: number): boolean {
  return addr >= start && addr <= end;
}

function recursiveScan(
  mem: AddressSpace,
  entries: readonly number[],
  start: number,
  end: number,
): ScanState {
  const instructions = new Map<number, Instruction>();
  const jsrTargets = new Set<number>();
  const branchTargets = new Set<number>();
  const queue: number[] = [...entries];

  while (queue.length > 0) {
    let addr = queue.pop() as number;

    while (inRange(addr, start, end) && !instructions.has(addr)) {
      const instr = decodeAt(mem, addr);
      instructions.set(addr, instr);

      const { mnemonic, mode } = instr.opcode;
      const target = instr.target;

      if (BRANCHES.has(mnemonic) && target !== undefined) {
        branchTargets.add(target);
        if (inRange(target, start, end)) queue.push(target);
        addr += instr.length; // conditional: fall through too
        continue;
      }

      if (mnemonic === "JSR" && target !== undefined) {
        jsrTargets.add(target);
        if (inRange(target, start, end)) queue.push(target);
        addr += instr.length;
        continue;
      }

      if (mnemonic === "JMP") {
        if (mode === "abs" && target !== undefined) {
          branchTargets.add(target);
          if (inRange(target, start, end)) queue.push(target);
        }
        break; // unconditional (or unresolvable indirect): stop linear flow
      }

      if (TERMINATORS.has(mnemonic)) break;

      addr += instr.length;
    }
  }

  return { instructions, jsrTargets, branchTargets };
}

function buildLabels(
  mem: AddressSpace,
  scan: ScanState,
  start: number,
  end: number,
): Map<number, string> {
  const labels = new Map<number, string>();
  const named = (addr: number, kind: LabelKind): void => {
    if (!inRange(addr, start, end)) return;
    if (kind === "reset" || kind === "nmi" || kind === "irq") {
      labels.set(addr, kind);
      return;
    }
    if (labels.has(addr)) return;
    labels.set(addr, `${kind}_${hex4(addr)}`);
  };

  for (const t of scan.jsrTargets) named(t, "sub");
  for (const t of scan.branchTargets) named(t, "loc");
  // Vector names take precedence.
  named(mem.resetVector, "reset");
  named(mem.nmiVector, "nmi");
  named(mem.irqVector, "irq");
  return labels;
}

function formatOperand(instr: Instruction, labels: ReadonlyMap<number, string>): string {
  const { opcode, operand, target } = instr;
  const mode = opcode.mode;
  if (operand === undefined) return mode === "acc" ? "A" : "";

  const labelOrAbs = (addr: number): string => labels.get(addr) ?? `$${hex4(addr)}`;

  switch (mode) {
    case "imm":
      return `#$${hex2(operand)}`;
    case "zp":
      return `$${hex2(operand)}`;
    case "zpx":
      return `$${hex2(operand)},X`;
    case "zpy":
      return `$${hex2(operand)},Y`;
    case "izx":
      return `($${hex2(operand)},X)`;
    case "izy":
      return `($${hex2(operand)}),Y`;
    case "abs":
      return target !== undefined ? labelOrAbs(target) : `$${hex4(operand)}`;
    case "abx":
      return `$${hex4(operand)},X`;
    case "aby":
      return `$${hex4(operand)},Y`;
    case "ind":
      return `($${hex4(operand)})`;
    case "rel":
      return target !== undefined ? labelOrAbs(target) : `$${hex4(operand)}`;
    default:
      return "";
  }
}

function buildListing(
  mem: AddressSpace,
  scan: ScanState,
  labels: ReadonlyMap<number, string>,
  start: number,
  end: number,
): { lines: ListingLine[]; codeBytes: number; dataBytes: number } {
  const lines: ListingLine[] = [];
  let codeBytes = 0;
  let dataBytes = 0;
  let dataRun: { address: number; bytes: number[] } | null = null;

  const flushData = (): void => {
    if (!dataRun) return;
    lines.push({
      address: dataRun.address,
      kind: "data",
      bytes: dataRun.bytes,
      text: `.byte ${dataRun.bytes.map((b) => `$${hex2(b)}`).join(", ")}`,
    });
    dataRun = null;
  };

  let addr = start;
  while (addr <= end) {
    const label = labels.get(addr);
    if (label) {
      flushData();
      lines.push({ address: addr, kind: "label", label });
    }

    const instr = scan.instructions.get(addr);
    if (instr) {
      flushData();
      const operandText = formatOperand(instr, labels);
      const text = operandText ? `${instr.opcode.mnemonic} ${operandText}` : instr.opcode.mnemonic;
      lines.push({
        address: addr,
        kind: "instruction",
        bytes: instr.bytes,
        text,
        ...(instr.opcode.official ? {} : { comment: "undocumented" }),
      });
      codeBytes += instr.length;
      addr += instr.length;
    } else {
      if (!dataRun || dataRun.bytes.length >= 8) {
        flushData();
        dataRun = { address: addr, bytes: [] };
      }
      dataRun.bytes.push(mem.read(addr));
      dataBytes += 1;
      addr += 1;
    }
  }
  flushData();
  return { lines, codeBytes, dataBytes };
}

export function disassemble(mem: AddressSpace, prgLength: number): DisassemblyResult {
  const window = Math.min(prgLength, 0x8000);
  const start = 0x10000 - window;
  const end = 0xffff;

  const entries = [mem.resetVector, mem.nmiVector, mem.irqVector].filter((a) =>
    inRange(a, start, end),
  );

  const scan = recursiveScan(mem, entries, start, end);
  const labels = buildLabels(mem, scan, start, end);
  const { lines, codeBytes, dataBytes } = buildListing(mem, scan, labels, start, end);

  return {
    lines,
    instructions: scan.instructions,
    labels,
    start,
    end,
    stats: {
      instructionCount: scan.instructions.size,
      codeBytes,
      dataBytes,
    },
  };
}
