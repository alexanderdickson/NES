const LENGTH_TABLE = [
  10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14, 12, 16, 24, 18, 48, 20, 96, 22, 192,
  24, 72, 26, 16, 28, 32, 30,
];
const NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
const DMC_RATES = [428, 380, 340, 320, 286, 254, 226, 214, 190, 160, 142, 128, 106, 84, 72, 54];
const DUTY_SEQUENCES = [
  [0, 1, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
  [1, 0, 0, 1, 1, 1, 1, 1],
];
const TRIANGLE_SEQUENCE = [
  15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  13, 14, 15,
];

const CPU_CLOCK = 1789773;

export type ChannelName = "pulse1" | "pulse2" | "triangle" | "noise" | "dmc";

class Envelope {
  start = false;
  loop = false;
  constant = false;
  volume = 0;
  private divider = 0;
  private decay = 0;

  clock(): void {
    if (this.start) {
      this.start = false;
      this.decay = 15;
      this.divider = this.volume;
    } else if (this.divider === 0) {
      this.divider = this.volume;
      if (this.decay > 0) this.decay -= 1;
      else if (this.loop) this.decay = 15;
    } else {
      this.divider -= 1;
    }
  }

  output(): number {
    return this.constant ? this.volume : this.decay;
  }
}

class PulseChannel {
  enabled = false;
  length = 0;
  lengthHalt = false;
  private readonly env = new Envelope();
  private duty = 0;
  private seqPos = 0;
  private timer = 0;
  private timerPeriod = 0;
  private sweepEnabled = false;
  private sweepNegate = false;
  private sweepReload = false;
  private sweepPeriod = 0;
  private sweepShift = 0;
  private sweepDivider = 0;

  constructor(private readonly isPulse2: boolean) {}

  write(reg: number, value: number): void {
    switch (reg & 3) {
      case 0:
        this.duty = (value >> 6) & 3;
        this.lengthHalt = (value & 0x20) !== 0;
        this.env.loop = this.lengthHalt;
        this.env.constant = (value & 0x10) !== 0;
        this.env.volume = value & 0x0f;
        break;
      case 1:
        this.sweepEnabled = (value & 0x80) !== 0;
        this.sweepPeriod = (value >> 4) & 0x07;
        this.sweepNegate = (value & 0x08) !== 0;
        this.sweepShift = value & 0x07;
        this.sweepReload = true;
        break;
      case 2:
        this.timerPeriod = (this.timerPeriod & 0x700) | value;
        break;
      case 3:
        this.timerPeriod = (this.timerPeriod & 0xff) | ((value & 0x07) << 8);
        if (this.enabled) this.length = LENGTH_TABLE[value >> 3] ?? 0;
        this.seqPos = 0;
        this.env.start = true;
        break;
      default:
        break;
    }
  }

  private targetPeriod(): number {
    const change = this.timerPeriod >> this.sweepShift;
    if (this.sweepNegate) {
      return this.timerPeriod - change - (this.isPulse2 ? 0 : 1);
    }
    return this.timerPeriod + change;
  }

  private muted(): boolean {
    return this.timerPeriod < 8 || this.targetPeriod() > 0x7ff;
  }

  clockTimer(): void {
    if (this.timer === 0) {
      this.timer = this.timerPeriod;
      this.seqPos = (this.seqPos + 1) & 7;
    } else {
      this.timer -= 1;
    }
  }

  clockEnvelope(): void {
    this.env.clock();
  }

  clockLengthAndSweep(): void {
    if (!this.lengthHalt && this.length > 0) this.length -= 1;
    if (this.sweepDivider === 0 && this.sweepEnabled && this.sweepShift > 0 && !this.muted()) {
      this.timerPeriod = this.targetPeriod() & 0x7ff;
    }
    if (this.sweepDivider === 0 || this.sweepReload) {
      this.sweepDivider = this.sweepPeriod;
      this.sweepReload = false;
    } else {
      this.sweepDivider -= 1;
    }
  }

  output(): number {
    if (!this.enabled || this.length === 0 || this.muted()) return 0;
    if ((DUTY_SEQUENCES[this.duty]?.[this.seqPos] ?? 0) === 0) return 0;
    return this.env.output();
  }
}

class TriangleChannel {
  enabled = false;
  length = 0;
  lengthHalt = false;
  private linearCounter = 0;
  private linearReload = 0;
  private linearReloadFlag = false;
  private timer = 0;
  private timerPeriod = 0;
  private seqPos = 0;

  write(reg: number, value: number): void {
    switch (reg & 3) {
      case 0:
        this.lengthHalt = (value & 0x80) !== 0;
        this.linearReload = value & 0x7f;
        break;
      case 2:
        this.timerPeriod = (this.timerPeriod & 0x700) | value;
        break;
      case 3:
        this.timerPeriod = (this.timerPeriod & 0xff) | ((value & 0x07) << 8);
        if (this.enabled) this.length = LENGTH_TABLE[value >> 3] ?? 0;
        this.linearReloadFlag = true;
        break;
      default:
        break;
    }
  }

  clockTimer(): void {
    if (this.timer === 0) {
      this.timer = this.timerPeriod;
      if (this.length > 0 && this.linearCounter > 0) {
        this.seqPos = (this.seqPos + 1) & 0x1f;
      }
    } else {
      this.timer -= 1;
    }
  }

  clockLinear(): void {
    if (this.linearReloadFlag) this.linearCounter = this.linearReload;
    else if (this.linearCounter > 0) this.linearCounter -= 1;
    if (!this.lengthHalt) this.linearReloadFlag = false;
  }

  clockLength(): void {
    if (!this.lengthHalt && this.length > 0) this.length -= 1;
  }

  output(): number {
    if (!this.enabled || this.timerPeriod < 2) return 0;
    return TRIANGLE_SEQUENCE[this.seqPos] ?? 0;
  }
}

class NoiseChannel {
  enabled = false;
  length = 0;
  lengthHalt = false;
  private readonly env = new Envelope();
  private mode = false;
  private shiftRegister = 1;
  private timer = 0;
  private timerPeriod = 0;

  write(reg: number, value: number): void {
    switch (reg & 3) {
      case 0:
        this.lengthHalt = (value & 0x20) !== 0;
        this.env.loop = this.lengthHalt;
        this.env.constant = (value & 0x10) !== 0;
        this.env.volume = value & 0x0f;
        break;
      case 2:
        this.mode = (value & 0x80) !== 0;
        this.timerPeriod = NOISE_PERIODS[value & 0x0f] ?? 4;
        break;
      case 3:
        if (this.enabled) this.length = LENGTH_TABLE[value >> 3] ?? 0;
        this.env.start = true;
        break;
      default:
        break;
    }
  }

  clockTimer(): void {
    if (this.timer === 0) {
      this.timer = this.timerPeriod;
      const bit = this.mode ? (this.shiftRegister >> 6) & 1 : (this.shiftRegister >> 1) & 1;
      const feedback = (this.shiftRegister & 1) ^ bit;
      this.shiftRegister = (this.shiftRegister >> 1) | (feedback << 14);
    } else {
      this.timer -= 1;
    }
  }

  clockEnvelope(): void {
    this.env.clock();
  }

  clockLength(): void {
    if (!this.lengthHalt && this.length > 0) this.length -= 1;
  }

  output(): number {
    if (!this.enabled || this.length === 0 || (this.shiftRegister & 1) !== 0) return 0;
    return this.env.output();
  }
}

class DmcChannel {
  enabled = false;
  irqEnabled = false;
  irqFlag = false;
  private loop = false;
  private rate = 0;
  private timer = 0;
  output = 0;
  private sampleAddress = 0;
  private sampleLength = 0;
  private currentAddress = 0;
  bytesRemaining = 0;
  private shiftRegister = 0;
  private bitsRemaining = 0;
  private bufferEmpty = true;
  private sampleBuffer = 0;

  read: (addr: number) => number = () => 0;

  write(reg: number, value: number): void {
    switch (reg & 3) {
      case 0:
        this.irqEnabled = (value & 0x80) !== 0;
        this.loop = (value & 0x40) !== 0;
        this.rate = DMC_RATES[value & 0x0f] ?? 428;
        if (!this.irqEnabled) this.irqFlag = false;
        break;
      case 1:
        this.output = value & 0x7f;
        break;
      case 2:
        this.sampleAddress = 0xc000 | (value << 6);
        break;
      case 3:
        this.sampleLength = (value << 4) | 1;
        break;
      default:
        break;
    }
  }

  restart(): void {
    this.currentAddress = this.sampleAddress;
    this.bytesRemaining = this.sampleLength;
  }

  clockTimer(): void {
    if (this.rate === 0) return;
    if (this.bufferEmpty && this.bytesRemaining > 0) {
      this.sampleBuffer = this.read(this.currentAddress);
      this.bufferEmpty = false;
      this.currentAddress = (this.currentAddress + 1) & 0xffff;
      if (this.currentAddress === 0) this.currentAddress = 0x8000;
      this.bytesRemaining -= 1;
      if (this.bytesRemaining === 0) {
        if (this.loop) this.restart();
        else if (this.irqEnabled) this.irqFlag = true;
      }
    }
    if (this.timer === 0) {
      this.timer = this.rate;
      if (this.bitsRemaining === 0) {
        this.bitsRemaining = 8;
        if (this.bufferEmpty) {
          this.shiftRegister = 0;
        } else {
          this.shiftRegister = this.sampleBuffer;
          this.bufferEmpty = true;
        }
      }
      if (this.bitsRemaining > 0) {
        if ((this.shiftRegister & 1) !== 0) {
          if (this.output <= 125) this.output += 2;
        } else if (this.output >= 2) {
          this.output -= 2;
        }
        this.shiftRegister >>= 1;
        this.bitsRemaining -= 1;
      }
    } else {
      this.timer -= 1;
    }
  }

  outputLevel(): number {
    return this.output;
  }
}

export interface ApuChannelLevels {
  pulse1: number;
  pulse2: number;
  triangle: number;
  noise: number;
  dmc: number;
}

/**
 * NES 2A03 APU. Stepped once per CPU cycle; produces Float32 samples into a
 * ring buffer that the Web Audio layer drains, and exposes per-channel levels
 * and a mixed-output scope ring for debugging tools.
 */
export class Apu {
  private readonly pulse1 = new PulseChannel(false);
  private readonly pulse2 = new PulseChannel(true);
  private readonly triangle = new TriangleChannel();
  private readonly noise = new NoiseChannel();
  private readonly dmc = new DmcChannel();

  readonly mute: Record<ChannelName, boolean> = {
    pulse1: false,
    pulse2: false,
    triangle: false,
    noise: false,
    dmc: false,
  };

  private frameCycle = 0;
  private fiveStep = false;
  private irqInhibit = false;
  frameIrq = false;
  private evenCycle = false;

  private readonly sampleRate: number;
  private sampleAccumulator = 0;
  private readonly ring: Float32Array;
  private readonly ringSize = 16384;
  private writePtr = 0;
  private readPtr = 0;

  /** Recent mixed output for the oscilloscope (debug). */
  readonly scope = new Float32Array(1024);
  private scopePtr = 0;

  constructor(sampleRate = 44100) {
    this.sampleRate = sampleRate;
    this.ring = new Float32Array(this.ringSize);
  }

  setDmcReader(fn: (addr: number) => number): void {
    this.dmc.read = fn;
  }

  reset(): void {
    this.writePtr = 0;
    this.readPtr = 0;
  }

  irqPending(): boolean {
    return this.frameIrq || this.dmc.irqFlag;
  }

  writeRegister(addr: number, value: number): void {
    if (addr >= 0x4000 && addr <= 0x4003) this.pulse1.write(addr, value);
    else if (addr >= 0x4004 && addr <= 0x4007) this.pulse2.write(addr, value);
    else if (addr >= 0x4008 && addr <= 0x400b) this.triangle.write(addr, value);
    else if (addr >= 0x400c && addr <= 0x400f) this.noise.write(addr, value);
    else if (addr >= 0x4010 && addr <= 0x4013) this.dmc.write(addr, value);
    else if (addr === 0x4015) this.writeControl(value);
    else if (addr === 0x4017) this.writeFrameCounter(value);
  }

  readStatus(): number {
    let status = 0;
    if (this.pulse1.length > 0) status |= 0x01;
    if (this.pulse2.length > 0) status |= 0x02;
    if (this.triangle.length > 0) status |= 0x04;
    if (this.noise.length > 0) status |= 0x08;
    if (this.dmc.bytesRemaining > 0) status |= 0x10;
    if (this.frameIrq) status |= 0x40;
    if (this.dmc.irqFlag) status |= 0x80;
    this.frameIrq = false;
    return status;
  }

  private writeControl(value: number): void {
    this.pulse1.enabled = (value & 0x01) !== 0;
    this.pulse2.enabled = (value & 0x02) !== 0;
    this.triangle.enabled = (value & 0x04) !== 0;
    this.noise.enabled = (value & 0x08) !== 0;
    this.dmc.enabled = (value & 0x10) !== 0;
    if (!this.pulse1.enabled) this.pulse1.length = 0;
    if (!this.pulse2.enabled) this.pulse2.length = 0;
    if (!this.triangle.enabled) this.triangle.length = 0;
    if (!this.noise.enabled) this.noise.length = 0;
    if (this.dmc.enabled) {
      if (this.dmc.bytesRemaining === 0) this.dmc.restart();
    } else {
      this.dmc.bytesRemaining = 0;
    }
    this.dmc.irqFlag = false;
  }

  private writeFrameCounter(value: number): void {
    this.fiveStep = (value & 0x80) !== 0;
    this.irqInhibit = (value & 0x40) !== 0;
    if (this.irqInhibit) this.frameIrq = false;
    this.frameCycle = 0;
    if (this.fiveStep) {
      this.clockQuarterFrame();
      this.clockHalfFrame();
    }
  }

  private clockQuarterFrame(): void {
    this.pulse1.clockEnvelope();
    this.pulse2.clockEnvelope();
    this.noise.clockEnvelope();
    this.triangle.clockLinear();
  }

  private clockHalfFrame(): void {
    this.pulse1.clockLengthAndSweep();
    this.pulse2.clockLengthAndSweep();
    this.triangle.clockLength();
    this.noise.clockLength();
  }

  private clockFrameCounter(): void {
    this.frameCycle += 1;
    if (!this.fiveStep) {
      if (this.frameCycle === 7457) this.clockQuarterFrame();
      else if (this.frameCycle === 14913) {
        this.clockQuarterFrame();
        this.clockHalfFrame();
      } else if (this.frameCycle === 22371) this.clockQuarterFrame();
      else if (this.frameCycle === 29829) {
        this.clockQuarterFrame();
        this.clockHalfFrame();
        if (!this.irqInhibit) this.frameIrq = true;
        this.frameCycle = 0;
      }
    } else if (this.frameCycle === 7457) this.clockQuarterFrame();
    else if (this.frameCycle === 14913) {
      this.clockQuarterFrame();
      this.clockHalfFrame();
    } else if (this.frameCycle === 22371) this.clockQuarterFrame();
    else if (this.frameCycle === 37281) {
      this.clockQuarterFrame();
      this.clockHalfFrame();
      this.frameCycle = 0;
    }
  }

  /** Advance by one CPU cycle. */
  step(): void {
    this.triangle.clockTimer();
    if (this.evenCycle) {
      this.pulse1.clockTimer();
      this.pulse2.clockTimer();
      this.noise.clockTimer();
      this.dmc.clockTimer();
    }
    this.evenCycle = !this.evenCycle;
    this.clockFrameCounter();

    this.sampleAccumulator += this.sampleRate;
    if (this.sampleAccumulator >= CPU_CLOCK) {
      this.sampleAccumulator -= CPU_CLOCK;
      this.emitSample();
    }
  }

  private emitSample(): void {
    const p1 = this.mute.pulse1 ? 0 : this.pulse1.output();
    const p2 = this.mute.pulse2 ? 0 : this.pulse2.output();
    const tri = this.mute.triangle ? 0 : this.triangle.output();
    const noi = this.mute.noise ? 0 : this.noise.output();
    const d = this.mute.dmc ? 0 : this.dmc.outputLevel();

    const pulseOut = p1 + p2 === 0 ? 0 : 95.88 / (8128 / (p1 + p2) + 100);
    const tndDenom = tri / 8227 + noi / 12241 + d / 22638;
    const tndOut = tndDenom === 0 ? 0 : 159.79 / (1 / tndDenom + 100);
    const sample = pulseOut + tndOut;

    this.ring[this.writePtr] = sample;
    this.writePtr = (this.writePtr + 1) % this.ringSize;
    this.scope[this.scopePtr] = sample;
    this.scopePtr = (this.scopePtr + 1) % this.scope.length;
  }

  /** Number of samples available to drain. */
  available(): number {
    return (this.writePtr - this.readPtr + this.ringSize) % this.ringSize;
  }

  /** Drain up to out.length samples into out; remaining slots hold the last value. */
  drain(out: Float32Array): void {
    let last = 0;
    for (let i = 0; i < out.length; i++) {
      if (this.readPtr !== this.writePtr) {
        last = this.ring[this.readPtr] ?? last;
        this.readPtr = (this.readPtr + 1) % this.ringSize;
      }
      out[i] = last;
    }
  }

  levels(): ApuChannelLevels {
    return {
      pulse1: this.pulse1.output() / 15,
      pulse2: this.pulse2.output() / 15,
      triangle: this.triangle.output() / 15,
      noise: this.noise.output() / 15,
      dmc: this.dmc.outputLevel() / 127,
    };
  }
}
