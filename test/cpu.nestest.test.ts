import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Memory } from "../src/core/memory.ts";
import { Cpu } from "../src/core/emu/cpu.ts";

/**
 * CPU correctness via the canonical **nestest** ROM and its reference log.
 *
 * `nestest` (by kevtris, freely distributable for emulator testing) executes
 * ~9000 instructions covering every documented and undocumented 6502 opcode and
 * all addressing modes. The reference log records the CPU state *before* each
 * instruction, so comparing our state to every line verifies registers, flags,
 * the stack pointer and the cumulative cycle count at each step. The program
 * also writes a result code to $0002/$0003 ($00/$00 = all sub-tests passed).
 */

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** Minimal NROM bus: 2 KiB RAM (mirrored) + the 16 KiB PRG mapped at $8000/$C000. */
function createBus(prg: Uint8Array): { bus: Memory; ram: Uint8Array } {
  const ram = new Uint8Array(0x800);
  const bus: Memory = {
    read(addr: number): number {
      addr &= 0xffff;
      if (addr < 0x2000) return ram[addr & 0x7ff] ?? 0;
      if (addr >= 0x8000) return prg[(addr - 0x8000) % prg.length] ?? 0;
      return 0;
    },
    write(addr: number, value: number): void {
      addr &= 0xffff;
      if (addr < 0x2000) ram[addr & 0x7ff] = value & 0xff;
    },
    readWord(addr: number): number {
      return (this.read(addr) | (this.read(addr + 1) << 8)) & 0xffff;
    },
  };
  return { bus, ram };
}

interface Expected {
  pc: number;
  a: number;
  x: number;
  y: number;
  p: number;
  sp: number;
  cyc: number;
}

const LINE_RE =
  /^([0-9A-F]{4}).*A:([0-9A-F]{2}) X:([0-9A-F]{2}) Y:([0-9A-F]{2}) P:([0-9A-F]{2}) SP:([0-9A-F]{2}).*CYC:(\d+)/;

function parseLog(text: string): Expected[] {
  const out: Expected[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    out.push({
      pc: parseInt(m[1] as string, 16),
      a: parseInt(m[2] as string, 16),
      x: parseInt(m[3] as string, 16),
      y: parseInt(m[4] as string, 16),
      p: parseInt(m[5] as string, 16),
      sp: parseInt(m[6] as string, 16),
      cyc: parseInt(m[7] as string, 10),
    });
  }
  return out;
}

const hex = (n: number, w: number): string => n.toString(16).toUpperCase().padStart(w, "0");

describe("CPU — nestest golden trace", () => {
  const rom = new Uint8Array(readFileSync(fixture("nestest.nes")));
  const prg = rom.subarray(16, 16 + 16384);
  const golden = parseLog(gunzipSync(readFileSync(fixture("nestest.log.gz"))).toString("utf8"));

  it("loads a golden log with thousands of instructions", () => {
    expect(golden.length).toBeGreaterThan(8000);
  });

  it("matches register, flag, stack and cycle state at every instruction", () => {
    const { bus, ram } = createBus(prg);
    const cpu = new Cpu(bus);
    cpu.reset();
    // nestest's automated entry point and documented power-on state.
    cpu.pc = 0xc000;
    cpu.cycles = 7;

    for (let i = 0; i < golden.length; i++) {
      const exp = golden[i] as Expected;
      const got = {
        pc: cpu.pc,
        a: cpu.a,
        x: cpu.x,
        y: cpu.y,
        p: cpu.p,
        sp: cpu.sp,
        cyc: cpu.cycles,
      };
      const same =
        got.pc === exp.pc &&
        got.a === exp.a &&
        got.x === exp.x &&
        got.y === exp.y &&
        got.p === exp.p &&
        got.sp === exp.sp &&
        got.cyc === exp.cyc;
      if (!same) {
        const fmt = (s: Expected): string =>
          `PC=${hex(s.pc, 4)} A=${hex(s.a, 2)} X=${hex(s.x, 2)} Y=${hex(s.y, 2)} P=${hex(s.p, 2)} SP=${hex(s.sp, 2)} CYC=${String(s.cyc)}`;
        throw new Error(
          `Divergence at instruction ${String(i + 1)}:\n  expected ${fmt(exp)}\n  actual   ${fmt(got)}`,
        );
      }
      cpu.step();
    }

    // After the full run, nestest reports its verdict in zero page.
    expect(ram[0x02]).toBe(0x00);
    expect(ram[0x03]).toBe(0x00);
  });
});
