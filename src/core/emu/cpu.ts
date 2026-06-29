import type { Memory } from "../memory.ts";
import type { AddressingMode } from "../types.ts";
import { getOpcode } from "../opcodes.ts";

// Status flag bit masks.
const C = 0x01;
const Z = 0x02;
const I = 0x04;
const D = 0x08;
const B = 0x10;
const U = 0x20;
const V = 0x40;
const N = 0x80;

const RESET_VECTOR = 0xfffc;
const NMI_VECTOR = 0xfffa;
const IRQ_VECTOR = 0xfffe;

// Read instructions that incur a +1 cycle penalty when an indexed address
// crosses a page boundary.
const PAGE_CROSS_OPS = new Set([
  "LDA",
  "LDX",
  "LDY",
  "EOR",
  "AND",
  "ORA",
  "ADC",
  "SBC",
  "CMP",
  "NOP",
  "LAX",
  "LAS",
]);

export interface CpuState {
  a: number;
  x: number;
  y: number;
  sp: number;
  pc: number;
  p: number;
  cycles: number;
}

/**
 * A 6502 (NES 2A03 variant: no decimal mode) CPU core. It executes against any
 * {@link Memory} bus, so it drives both the emulator and can be single-stepped
 * by debugging tools.
 */
export class Cpu {
  a = 0;
  x = 0;
  y = 0;
  sp = 0xfd;
  pc = 0;
  p = U | I;
  cycles = 0;
  jammed = false;

  private extraCycles = 0;
  private pendingNmi = false;
  private pendingIrq = false;

  constructor(private readonly bus: Memory) {}

  reset(): void {
    this.sp = 0xfd;
    this.p = U | I;
    this.pc = this.read16(RESET_VECTOR);
    this.cycles = 7;
    this.jammed = false;
    this.pendingNmi = false;
    this.pendingIrq = false;
  }

  state(): CpuState {
    return {
      a: this.a,
      x: this.x,
      y: this.y,
      sp: this.sp,
      pc: this.pc,
      p: this.p,
      cycles: this.cycles,
    };
  }

  /** Request a non-maskable interrupt (PPU vblank). */
  requestNmi(): void {
    this.pendingNmi = true;
  }

  /** Request a maskable interrupt (APU / mapper). Honoured unless I is set. */
  requestIrq(): void {
    this.pendingIrq = true;
  }

  private getFlag(mask: number): boolean {
    return (this.p & mask) !== 0;
  }

  private setFlag(mask: number, value: boolean): void {
    if (value) this.p |= mask;
    else this.p &= ~mask;
  }

  private setZN(value: number): void {
    this.setFlag(Z, (value & 0xff) === 0);
    this.setFlag(N, (value & 0x80) !== 0);
  }

  private read(addr: number): number {
    return this.bus.read(addr & 0xffff) & 0xff;
  }

  private write(addr: number, value: number): void {
    this.bus.write(addr & 0xffff, value & 0xff);
  }

  private read16(addr: number): number {
    return this.read(addr) | (this.read(addr + 1) << 8);
  }

  private read16ZeroPage(addr: number): number {
    const lo = this.read(addr & 0xff);
    const hi = this.read((addr + 1) & 0xff);
    return lo | (hi << 8);
  }

  private push(value: number): void {
    this.write(0x0100 + this.sp, value);
    this.sp = (this.sp - 1) & 0xff;
  }

  private pull(): number {
    this.sp = (this.sp + 1) & 0xff;
    return this.read(0x0100 + this.sp);
  }

  private push16(value: number): void {
    this.push((value >> 8) & 0xff);
    this.push(value & 0xff);
  }

  private pull16(): number {
    const lo = this.pull();
    const hi = this.pull();
    return lo | (hi << 8);
  }

  private nmi(): void {
    this.push16(this.pc);
    this.push((this.p & ~B) | U);
    this.setFlag(I, true);
    this.pc = this.read16(NMI_VECTOR);
    this.cycles += 7;
  }

  private irq(): void {
    this.push16(this.pc);
    this.push((this.p & ~B) | U);
    this.setFlag(I, true);
    this.pc = this.read16(IRQ_VECTOR);
    this.cycles += 7;
  }

  /** Execute one instruction; returns the number of cycles consumed. */
  step(): number {
    if (this.pendingNmi) {
      this.pendingNmi = false;
      this.nmi();
      return 7;
    }
    if (this.pendingIrq) {
      this.pendingIrq = false;
      if (!this.getFlag(I)) {
        this.irq();
        return 7;
      }
    }
    if (this.jammed) {
      this.cycles += 1;
      return 1;
    }

    const start = this.cycles;
    this.extraCycles = 0;

    const opByte = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    const op = getOpcode(opByte);
    const { addr, pageCrossed } = this.resolve(op.mode);

    this.execute(op.mnemonic, op.mode, addr, pageCrossed);

    let used = op.cycles + this.extraCycles;
    if (pageCrossed && PAGE_CROSS_OPS.has(op.mnemonic) && this.isIndexed(op.mode)) {
      used += 1;
    }
    this.cycles = start + used;
    return used;
  }

  private isIndexed(mode: AddressingMode): boolean {
    return mode === "abx" || mode === "aby" || mode === "izy";
  }

  private resolve(mode: AddressingMode): { addr: number; pageCrossed: boolean } {
    switch (mode) {
      case "imp":
      case "acc":
        return { addr: 0, pageCrossed: false };
      case "imm": {
        const addr = this.pc;
        this.pc = (this.pc + 1) & 0xffff;
        return { addr, pageCrossed: false };
      }
      case "zp": {
        const addr = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xffff;
        return { addr, pageCrossed: false };
      }
      case "zpx": {
        const addr = (this.read(this.pc) + this.x) & 0xff;
        this.pc = (this.pc + 1) & 0xffff;
        return { addr, pageCrossed: false };
      }
      case "zpy": {
        const addr = (this.read(this.pc) + this.y) & 0xff;
        this.pc = (this.pc + 1) & 0xffff;
        return { addr, pageCrossed: false };
      }
      case "abs": {
        const addr = this.read16(this.pc);
        this.pc = (this.pc + 2) & 0xffff;
        return { addr, pageCrossed: false };
      }
      case "abx": {
        const base = this.read16(this.pc);
        this.pc = (this.pc + 2) & 0xffff;
        const addr = (base + this.x) & 0xffff;
        return { addr, pageCrossed: (base & 0xff00) !== (addr & 0xff00) };
      }
      case "aby": {
        const base = this.read16(this.pc);
        this.pc = (this.pc + 2) & 0xffff;
        const addr = (base + this.y) & 0xffff;
        return { addr, pageCrossed: (base & 0xff00) !== (addr & 0xff00) };
      }
      case "izx": {
        const ptr = (this.read(this.pc) + this.x) & 0xff;
        this.pc = (this.pc + 1) & 0xffff;
        return { addr: this.read16ZeroPage(ptr), pageCrossed: false };
      }
      case "izy": {
        const ptr = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xffff;
        const base = this.read16ZeroPage(ptr);
        const addr = (base + this.y) & 0xffff;
        return { addr, pageCrossed: (base & 0xff00) !== (addr & 0xff00) };
      }
      case "ind": {
        const ptr = this.read16(this.pc);
        this.pc = (this.pc + 2) & 0xffff;
        // 6502 indirect JMP page-wrap bug.
        const lo = this.read(ptr);
        const hi = this.read((ptr & 0xff00) | ((ptr + 1) & 0xff));
        return { addr: lo | (hi << 8), pageCrossed: false };
      }
      case "rel": {
        const offset = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xffff;
        const signed = (offset << 24) >> 24;
        const addr = (this.pc + signed) & 0xffff;
        return { addr, pageCrossed: (this.pc & 0xff00) !== (addr & 0xff00) };
      }
      default:
        return { addr: 0, pageCrossed: false };
    }
  }

  private branch(addr: number, take: boolean): void {
    if (!take) return;
    this.extraCycles += (this.pc & 0xff00) !== (addr & 0xff00) ? 2 : 1;
    this.pc = addr;
  }

  private compare(reg: number, value: number): void {
    const t = (reg - value) & 0x1ff;
    this.setFlag(C, reg >= value);
    this.setZN(t & 0xff);
  }

  private adc(value: number): void {
    const a = this.a;
    const c = this.getFlag(C) ? 1 : 0;
    const sum = a + value + c;
    this.setFlag(C, sum > 0xff);
    this.setFlag(V, ((a ^ sum) & (value ^ sum) & 0x80) !== 0);
    this.a = sum & 0xff;
    this.setZN(this.a);
  }

  private sbc(value: number): void {
    this.adc(value ^ 0xff);
  }

  private asl(value: number): number {
    this.setFlag(C, (value & 0x80) !== 0);
    const r = (value << 1) & 0xff;
    this.setZN(r);
    return r;
  }

  private lsr(value: number): number {
    this.setFlag(C, (value & 0x01) !== 0);
    const r = value >> 1;
    this.setZN(r);
    return r;
  }

  private rol(value: number): number {
    const carry = this.getFlag(C) ? 1 : 0;
    this.setFlag(C, (value & 0x80) !== 0);
    const r = ((value << 1) | carry) & 0xff;
    this.setZN(r);
    return r;
  }

  private ror(value: number): number {
    const carry = this.getFlag(C) ? 0x80 : 0;
    this.setFlag(C, (value & 0x01) !== 0);
    const r = (value >> 1) | carry;
    this.setZN(r);
    return r;
  }

  private rmw(mode: AddressingMode, addr: number, fn: (value: number) => number): number {
    if (mode === "acc") {
      this.a = fn(this.a);
      return this.a;
    }
    const result = fn(this.read(addr));
    this.write(addr, result);
    return result;
  }

  // eslint-disable-next-line complexity
  private execute(
    mnemonic: string,
    mode: AddressingMode,
    addr: number,
    _pageCrossed: boolean,
  ): void {
    const M = (): number => this.read(addr);
    switch (mnemonic) {
      // Loads / stores
      case "LDA":
        this.a = M();
        this.setZN(this.a);
        break;
      case "LDX":
        this.x = M();
        this.setZN(this.x);
        break;
      case "LDY":
        this.y = M();
        this.setZN(this.y);
        break;
      case "STA":
        this.write(addr, this.a);
        break;
      case "STX":
        this.write(addr, this.x);
        break;
      case "STY":
        this.write(addr, this.y);
        break;

      // Transfers
      case "TAX":
        this.x = this.a;
        this.setZN(this.x);
        break;
      case "TAY":
        this.y = this.a;
        this.setZN(this.y);
        break;
      case "TXA":
        this.a = this.x;
        this.setZN(this.a);
        break;
      case "TYA":
        this.a = this.y;
        this.setZN(this.a);
        break;
      case "TSX":
        this.x = this.sp;
        this.setZN(this.x);
        break;
      case "TXS":
        this.sp = this.x;
        break;

      // Stack
      case "PHA":
        this.push(this.a);
        break;
      case "PHP":
        this.push(this.p | B | U);
        break;
      case "PLA":
        this.a = this.pull();
        this.setZN(this.a);
        break;
      case "PLP":
        this.p = (this.pull() & ~B) | U;
        break;

      // Logic
      case "AND":
        this.a &= M();
        this.setZN(this.a);
        break;
      case "ORA":
        this.a |= M();
        this.setZN(this.a);
        break;
      case "EOR":
        this.a ^= M();
        this.setZN(this.a);
        break;
      case "BIT": {
        const v = M();
        this.setFlag(Z, (this.a & v) === 0);
        this.setFlag(V, (v & 0x40) !== 0);
        this.setFlag(N, (v & 0x80) !== 0);
        break;
      }

      // Arithmetic
      case "ADC":
        this.adc(M());
        break;
      case "SBC":
        this.sbc(M());
        break;
      case "CMP":
        this.compare(this.a, M());
        break;
      case "CPX":
        this.compare(this.x, M());
        break;
      case "CPY":
        this.compare(this.y, M());
        break;

      // Inc / dec
      case "INC": {
        const r = (M() + 1) & 0xff;
        this.write(addr, r);
        this.setZN(r);
        break;
      }
      case "DEC": {
        const r = (M() - 1) & 0xff;
        this.write(addr, r);
        this.setZN(r);
        break;
      }
      case "INX":
        this.x = (this.x + 1) & 0xff;
        this.setZN(this.x);
        break;
      case "INY":
        this.y = (this.y + 1) & 0xff;
        this.setZN(this.y);
        break;
      case "DEX":
        this.x = (this.x - 1) & 0xff;
        this.setZN(this.x);
        break;
      case "DEY":
        this.y = (this.y - 1) & 0xff;
        this.setZN(this.y);
        break;

      // Shifts / rotates
      case "ASL":
        this.rmw(mode, addr, (v) => this.asl(v));
        break;
      case "LSR":
        this.rmw(mode, addr, (v) => this.lsr(v));
        break;
      case "ROL":
        this.rmw(mode, addr, (v) => this.rol(v));
        break;
      case "ROR":
        this.rmw(mode, addr, (v) => this.ror(v));
        break;

      // Jumps / calls
      case "JMP":
        this.pc = addr;
        break;
      case "JSR":
        this.push16((this.pc - 1) & 0xffff);
        this.pc = addr;
        break;
      case "RTS":
        this.pc = (this.pull16() + 1) & 0xffff;
        break;
      case "RTI":
        this.p = (this.pull() & ~B) | U;
        this.pc = this.pull16();
        break;

      // Branches
      case "BCC":
        this.branch(addr, !this.getFlag(C));
        break;
      case "BCS":
        this.branch(addr, this.getFlag(C));
        break;
      case "BEQ":
        this.branch(addr, this.getFlag(Z));
        break;
      case "BNE":
        this.branch(addr, !this.getFlag(Z));
        break;
      case "BMI":
        this.branch(addr, this.getFlag(N));
        break;
      case "BPL":
        this.branch(addr, !this.getFlag(N));
        break;
      case "BVC":
        this.branch(addr, !this.getFlag(V));
        break;
      case "BVS":
        this.branch(addr, this.getFlag(V));
        break;

      // Flags
      case "CLC":
        this.setFlag(C, false);
        break;
      case "SEC":
        this.setFlag(C, true);
        break;
      case "CLI":
        this.setFlag(I, false);
        break;
      case "SEI":
        this.setFlag(I, true);
        break;
      case "CLD":
        this.setFlag(D, false);
        break;
      case "SED":
        this.setFlag(D, true);
        break;
      case "CLV":
        this.setFlag(V, false);
        break;

      case "BRK":
        this.pc = (this.pc + 1) & 0xffff;
        this.push16(this.pc);
        this.push(this.p | B | U);
        this.setFlag(I, true);
        this.pc = this.read16(IRQ_VECTOR);
        break;

      case "NOP":
        break;

      // Undocumented (commonly used, stable)
      case "LAX":
        this.a = M();
        this.x = this.a;
        this.setZN(this.a);
        break;
      case "SAX":
        this.write(addr, this.a & this.x);
        break;
      case "DCP": {
        const r = (M() - 1) & 0xff;
        this.write(addr, r);
        this.compare(this.a, r);
        break;
      }
      case "ISC": {
        const r = (M() + 1) & 0xff;
        this.write(addr, r);
        this.sbc(r);
        break;
      }
      case "SLO": {
        const r = this.rmw(mode, addr, (v) => this.asl(v));
        this.a |= r;
        this.setZN(this.a);
        break;
      }
      case "RLA": {
        const r = this.rmw(mode, addr, (v) => this.rol(v));
        this.a &= r;
        this.setZN(this.a);
        break;
      }
      case "SRE": {
        const r = this.rmw(mode, addr, (v) => this.lsr(v));
        this.a ^= r;
        this.setZN(this.a);
        break;
      }
      case "RRA": {
        const r = this.rmw(mode, addr, (v) => this.ror(v));
        this.adc(r);
        break;
      }
      case "ANC":
        this.a &= M();
        this.setZN(this.a);
        this.setFlag(C, this.getFlag(N));
        break;
      case "ALR":
        this.a &= M();
        this.a = this.lsr(this.a);
        break;
      case "ARR": {
        this.a &= M();
        this.a = this.ror(this.a);
        this.setFlag(C, (this.a & 0x40) !== 0);
        this.setFlag(V, (((this.a >> 6) ^ (this.a >> 5)) & 1) !== 0);
        break;
      }
      case "AXS": {
        const t = (this.a & this.x) - M();
        this.setFlag(C, (t & 0x100) === 0);
        this.x = t & 0xff;
        this.setZN(this.x);
        break;
      }
      case "XAA":
        this.a = this.x & M();
        this.setZN(this.a);
        break;
      case "LAS": {
        const r = M() & this.sp;
        this.a = r;
        this.x = r;
        this.sp = r;
        this.setZN(r);
        break;
      }
      case "AHX":
        this.write(addr, this.a & this.x & ((addr >> 8) + 1));
        break;
      case "SHX":
        this.write(addr, this.x & ((addr >> 8) + 1));
        break;
      case "SHY":
        this.write(addr, this.y & ((addr >> 8) + 1));
        break;
      case "TAS":
        this.sp = this.a & this.x;
        this.write(addr, this.sp & ((addr >> 8) + 1));
        break;

      case "KIL":
        this.jammed = true;
        break;

      default:
        break;
    }
  }
}
