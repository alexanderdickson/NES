import type { NesRom, Region } from "../rom.ts";
import type { Button } from "./controller.ts";
import type { Mapper } from "./mappers.ts";
import { createMapper } from "./mappers.ts";
import { Ppu } from "./ppu.ts";
import { Apu } from "./apu.ts";
import { Controller } from "./controller.ts";
import { Bus } from "./bus.ts";
import { Cpu } from "./cpu.ts";

// PPU pre-render scanline (last line of the frame) per region.
const PRE_RENDER_LINE: Record<Region, number> = { ntsc: 261, pal: 311 };

/**
 * A complete NES console: wires the mapper, PPU, APU, controllers, bus and CPU
 * together and advances them in lockstep. Each CPU cycle drives the APU once and
 * the PPU 3 dots on NTSC, or 3.2 dots on PAL (averaged via a 3,3,3,3,4 pattern).
 * Call {@link runFrame} once per displayed frame (~60 Hz NTSC / ~50 Hz PAL).
 */
export class Nes {
  readonly ppu: Ppu;
  readonly apu: Apu;
  readonly cpu: Cpu;
  readonly controller1 = new Controller();
  readonly controller2 = new Controller();
  readonly region: Region;
  private readonly bus: Bus;
  private readonly mapper: Mapper;
  private palDotCounter = 0;

  constructor(rom: NesRom, sampleRate = 44100, region: Region = rom.region) {
    this.region = region;
    this.mapper = createMapper(rom);
    this.ppu = new Ppu(this.mapper, PRE_RENDER_LINE[region]);
    this.apu = new Apu(sampleRate, region);
    this.bus = new Bus(this.mapper, this.ppu, this.apu, this.controller1, this.controller2);
    this.apu.setDmcReader((addr) => this.bus.read(addr));
    this.cpu = new Cpu(this.bus);
    this.cpu.reset();
    this.ppu.reset();
    this.apu.reset();
  }

  setButton(button: Button, pressed: boolean, player: 1 | 2 = 1): void {
    const pad = player === 1 ? this.controller1 : this.controller2;
    pad.setButton(button, pressed);
  }

  private tick(): void {
    let cycles: number;
    if (this.bus.dmaStallCycles > 0) {
      cycles = this.bus.dmaStallCycles;
      this.bus.dmaStallCycles = 0;
    } else {
      cycles = this.cpu.step();
    }

    const pal = this.region === "pal";
    for (let i = 0; i < cycles; i++) {
      let dots = 3;
      if (pal) {
        this.palDotCounter += 1;
        if (this.palDotCounter === 5) {
          dots = 4;
          this.palDotCounter = 0;
        }
      }
      for (let d = 0; d < dots; d++) this.ppu.step();
      this.apu.step();
    }

    if (this.ppu.takeNmi()) this.cpu.requestNmi();
    if (this.apu.irqPending() || this.mapper.irqPending?.()) this.cpu.requestIrq();
  }

  /** Run a single CPU instruction (and the dependent PPU/APU cycles). */
  stepInstruction(): void {
    this.tick();
  }

  /** Run until the PPU completes one frame. Returns the RGBA framebuffer. */
  runFrame(): Uint8ClampedArray {
    this.ppu.frameComplete = false;
    let guard = 0;
    while (!this.ppu.frameComplete && guard < 200000) {
      this.tick();
      guard += 1;
    }
    return this.ppu.frame;
  }
}
