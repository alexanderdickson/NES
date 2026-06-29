import type { Memory } from "../memory.ts";
import type { Mapper } from "./mappers.ts";
import type { Ppu } from "./ppu.ts";
import type { Apu } from "./apu.ts";
import type { Controller } from "./controller.ts";

/**
 * The CPU-visible system bus. Implements the same {@link Memory} interface the
 * disassembler and debugging tools use, so those tools work against the live
 * machine, while reads/writes here dispatch to the PPU, APU, controllers and
 * cartridge mapper.
 */
export class Bus implements Memory {
  private readonly ram = new Uint8Array(0x0800);
  dmaStallCycles = 0;

  constructor(
    private readonly mapper: Mapper,
    private readonly ppu: Ppu,
    private readonly apu: Apu,
    private readonly controller1: Controller,
    private readonly controller2: Controller,
  ) {}

  read(addr: number): number {
    const a = addr & 0xffff;
    if (a < 0x2000) return this.ram[a & 0x07ff] ?? 0;
    if (a < 0x4000) return this.ppu.readRegister(a & 7);
    if (a === 0x4015) return this.apu.readStatus();
    if (a === 0x4016) return this.controller1.read() | 0x40;
    if (a === 0x4017) return this.controller2.read() | 0x40;
    if (a < 0x4020) return 0;
    return this.mapper.cpuRead(a);
  }

  readWord(addr: number): number {
    return this.read(addr) | (this.read(addr + 1) << 8);
  }

  write(addr: number, value: number): void {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x2000) {
      this.ram[a & 0x07ff] = v;
    } else if (a < 0x4000) {
      this.ppu.writeRegister(a & 7, v);
    } else if (a === 0x4014) {
      this.oamDma(v);
    } else if (a === 0x4016) {
      this.controller1.write(v);
      this.controller2.write(v);
    } else if (a < 0x4018) {
      this.apu.writeRegister(a, v);
    } else if (a >= 0x4020) {
      this.mapper.cpuWrite(a, v);
    }
  }

  private oamDma(page: number): void {
    const base = page << 8;
    for (let i = 0; i < 256; i++) {
      this.ppu.writeOamByte(this.read(base + i));
    }
    this.dmaStallCycles += 513;
  }
}
