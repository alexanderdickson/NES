import type { Mapper } from "./mappers.ts";
import { NES_PALETTE } from "../ppu.ts";

export const SCREEN_WIDTH = 256;
export const SCREEN_HEIGHT = 240;

const DOTS_PER_SCANLINE = 341;
const NTSC_PRE_RENDER_LINE = 261;

function paletteIndex(addr: number): number {
  let i = addr & 0x1f;
  if (i >= 0x10 && (i & 0x03) === 0) i -= 0x10;
  return i;
}

/**
 * NTSC 2C02 PPU. Steps one dot at a time (three dots per CPU cycle) and renders
 * background + sprites into an RGBA framebuffer suitable for `putImageData`.
 */
export class Ppu {
  readonly frame = new Uint8ClampedArray(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
  /** Per-pixel NES colour index (0-63) for the most recent frame (debug use). */
  readonly frameIndices = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  frameCount = 0;
  frameComplete = false;

  private readonly nametables = new Uint8Array(0x1000);
  private readonly palette = new Uint8Array(0x20);
  private readonly oam = new Uint8Array(0x100);
  private readonly secondaryOam = new Uint8Array(0x20);
  private readonly spriteIsZero = Array.from({ length: 8 }, () => false);
  private spriteCount = 0;

  private ctrl = 0;
  private mask = 0;
  private status = 0;
  private oamAddr = 0;
  private v = 0;
  private t = 0;
  private fineX = 0;
  private writeToggle = 0;
  private readBuffer = 0;

  private scanline: number;
  private dot = 0;
  private nmiOutput = false;
  private readonly preRenderLine: number;

  private ntLatch = 0;
  private atLatch = 0;
  private bgLoLatch = 0;
  private bgHiLatch = 0;
  private bgShiftLo = 0;
  private bgShiftHi = 0;
  private atShiftLo = 0;
  private atShiftHi = 0;

  constructor(
    private readonly mapper: Mapper,
    preRenderLine: number = NTSC_PRE_RENDER_LINE,
  ) {
    this.preRenderLine = preRenderLine;
    this.scanline = preRenderLine;
  }

  reset(): void {
    this.ctrl = 0;
    this.mask = 0;
    this.scanline = this.preRenderLine;
    this.dot = 0;
    this.frameComplete = false;
  }

  takeNmi(): boolean {
    if (this.nmiOutput) {
      this.nmiOutput = false;
      return true;
    }
    return false;
  }

  // --- CPU-facing register access ($2000-$2007) ---

  readRegister(reg: number): number {
    switch (reg & 7) {
      case 2: {
        const value = (this.status & 0xe0) | (this.readBuffer & 0x1f);
        this.status &= ~0x80;
        this.writeToggle = 0;
        return value;
      }
      case 4:
        return this.oam[this.oamAddr] ?? 0;
      case 7: {
        let value = this.busRead(this.v);
        if ((this.v & 0x3fff) < 0x3f00) {
          const buffered = this.readBuffer;
          this.readBuffer = value;
          value = buffered;
        } else {
          this.readBuffer = this.busRead((this.v & 0x3fff) - 0x1000);
        }
        this.v = (this.v + this.addrIncrement()) & 0x7fff;
        return value;
      }
      default:
        return this.readBuffer & 0xff;
    }
  }

  writeRegister(reg: number, value: number): void {
    const v = value & 0xff;
    switch (reg & 7) {
      case 0: {
        const prev = this.ctrl;
        this.ctrl = v;
        this.t = (this.t & 0xf3ff) | ((v & 0x03) << 10);
        if ((v & 0x80) !== 0 && (prev & 0x80) === 0 && (this.status & 0x80) !== 0) {
          this.nmiOutput = true;
        }
        break;
      }
      case 1:
        this.mask = v;
        break;
      case 3:
        this.oamAddr = v;
        break;
      case 4:
        this.oam[this.oamAddr] = v;
        this.oamAddr = (this.oamAddr + 1) & 0xff;
        break;
      case 5:
        if (this.writeToggle === 0) {
          this.fineX = v & 0x07;
          this.t = (this.t & 0xffe0) | (v >> 3);
          this.writeToggle = 1;
        } else {
          this.t = (this.t & 0x8fff) | ((v & 0x07) << 12);
          this.t = (this.t & 0xfc1f) | ((v & 0xf8) << 2);
          this.writeToggle = 0;
        }
        break;
      case 6:
        if (this.writeToggle === 0) {
          this.t = (this.t & 0x80ff) | ((v & 0x3f) << 8);
          this.writeToggle = 1;
        } else {
          this.t = (this.t & 0xff00) | v;
          this.v = this.t;
          this.writeToggle = 0;
        }
        break;
      case 7:
        this.busWrite(this.v, v);
        this.v = (this.v + this.addrIncrement()) & 0x7fff;
        break;
      default:
        break;
    }
  }

  writeOamByte(value: number): void {
    this.oam[this.oamAddr] = value & 0xff;
    this.oamAddr = (this.oamAddr + 1) & 0xff;
  }

  private addrIncrement(): number {
    return (this.ctrl & 0x04) !== 0 ? 32 : 1;
  }

  // --- PPU bus ($0000-$3FFF) ---

  private mirrorNametable(addr: number): number {
    const index = addr & 0x0fff;
    const table = (index >> 10) & 0x03;
    const offset = index & 0x03ff;
    let bank = 0;
    switch (this.mapper.mirrorMode()) {
      case "vertical":
        bank = table & 1;
        break;
      case "horizontal":
        bank = (table >> 1) & 1;
        break;
      case "single0":
        bank = 0;
        break;
      case "single1":
        bank = 1;
        break;
      case "four":
        bank = table;
        break;
      default:
        bank = 0;
        break;
    }
    return bank * 0x0400 + offset;
  }

  busRead(addr: number): number {
    const a = addr & 0x3fff;
    if (a < 0x2000) return this.mapper.ppuRead(a);
    if (a < 0x3f00) return this.nametables[this.mirrorNametable(a)] ?? 0;
    return this.palette[paletteIndex(a)] ?? 0;
  }

  busWrite(addr: number, value: number): void {
    const a = addr & 0x3fff;
    const v = value & 0xff;
    if (a < 0x2000) this.mapper.ppuWrite(a, v);
    else if (a < 0x3f00) this.nametables[this.mirrorNametable(a)] = v;
    else this.palette[paletteIndex(a)] = v;
  }

  // --- Rendering pipeline ---

  private renderingEnabled(): boolean {
    return (this.mask & 0x18) !== 0;
  }

  private incrementHorizontal(): void {
    if ((this.v & 0x001f) === 31) {
      this.v &= ~0x001f;
      this.v ^= 0x0400;
    } else {
      this.v += 1;
    }
  }

  private incrementVertical(): void {
    if ((this.v & 0x7000) !== 0x7000) {
      this.v += 0x1000;
    } else {
      this.v &= ~0x7000;
      let y = (this.v & 0x03e0) >> 5;
      if (y === 29) {
        y = 0;
        this.v ^= 0x0800;
      } else if (y === 31) {
        y = 0;
      } else {
        y += 1;
      }
      this.v = (this.v & ~0x03e0) | (y << 5);
    }
  }

  private transferX(): void {
    this.v = (this.v & ~0x041f) | (this.t & 0x041f);
  }

  private transferY(): void {
    this.v = (this.v & ~0x7be0) | (this.t & 0x7be0);
  }

  private loadShifters(): void {
    this.bgShiftLo = (this.bgShiftLo & 0xff00) | this.bgLoLatch;
    this.bgShiftHi = (this.bgShiftHi & 0xff00) | this.bgHiLatch;
    this.atShiftLo = (this.atShiftLo & 0xff00) | (this.atLatch & 1 ? 0xff : 0x00);
    this.atShiftHi = (this.atShiftHi & 0xff00) | (this.atLatch & 2 ? 0xff : 0x00);
  }

  private fetchTile(): void {
    switch (this.dot & 0x07) {
      case 1:
        this.loadShifters();
        this.ntLatch = this.busRead(0x2000 | (this.v & 0x0fff));
        break;
      case 3: {
        const attrAddr =
          0x23c0 | (this.v & 0x0c00) | ((this.v >> 4) & 0x38) | ((this.v >> 2) & 0x07);
        const shift = ((this.v >> 4) & 4) | (this.v & 2);
        this.atLatch = (this.busRead(attrAddr) >> shift) & 0x03;
        break;
      }
      case 5: {
        const fineY = (this.v >> 12) & 0x07;
        const base = (this.ctrl & 0x10) !== 0 ? 0x1000 : 0x0000;
        this.bgLoLatch = this.busRead(base + this.ntLatch * 16 + fineY);
        break;
      }
      case 7: {
        const fineY = (this.v >> 12) & 0x07;
        const base = (this.ctrl & 0x10) !== 0 ? 0x1000 : 0x0000;
        this.bgHiLatch = this.busRead(base + this.ntLatch * 16 + fineY + 8);
        break;
      }
      case 0:
        this.incrementHorizontal();
        break;
      default:
        break;
    }
  }

  private evaluateSprites(): void {
    this.spriteCount = 0;
    const height = (this.ctrl & 0x20) !== 0 ? 16 : 8;
    const line = this.scanline;
    for (let i = 0; i < 64; i++) {
      const y = this.oam[i * 4] ?? 0xff;
      const row = line - y;
      if (row < 0 || row >= height) continue;
      if (this.spriteCount < 8) {
        const base = this.spriteCount * 4;
        this.secondaryOam[base] = y;
        this.secondaryOam[base + 1] = this.oam[i * 4 + 1] ?? 0;
        this.secondaryOam[base + 2] = this.oam[i * 4 + 2] ?? 0;
        this.secondaryOam[base + 3] = this.oam[i * 4 + 3] ?? 0;
        // Stash the original OAM index in the unused high bits via a parallel marker.
        this.spriteIsZero[this.spriteCount] = i === 0;
        this.spriteCount += 1;
      } else {
        this.status |= 0x20; // sprite overflow (approximate)
        break;
      }
    }
  }

  private spritePixel(x: number): { color: number; priorityFront: boolean; isZero: boolean } {
    if ((this.mask & 0x10) === 0) return { color: 0, priorityFront: false, isZero: false };
    if (x < 8 && (this.mask & 0x04) === 0) {
      return { color: 0, priorityFront: false, isZero: false };
    }
    const height = (this.ctrl & 0x20) !== 0 ? 16 : 8;
    for (let s = 0; s < this.spriteCount; s++) {
      const base = s * 4;
      const sx = this.secondaryOam[base + 3] ?? 0;
      const dx = x - sx;
      if (dx < 0 || dx >= 8) continue;
      const y = this.secondaryOam[base] ?? 0;
      const tile = this.secondaryOam[base + 1] ?? 0;
      const attr = this.secondaryOam[base + 2] ?? 0;
      let row = this.scanline - y;
      let col = dx;
      if ((attr & 0x40) !== 0) col = 7 - col; // horizontal flip
      if ((attr & 0x80) !== 0) row = height - 1 - row; // vertical flip

      let patternAddr: number;
      if (height === 16) {
        const table = (tile & 1) * 0x1000;
        const tileIndex = (tile & 0xfe) + (row >= 8 ? 1 : 0);
        patternAddr = table + tileIndex * 16 + (row & 7);
      } else {
        const table = (this.ctrl & 0x08) !== 0 ? 0x1000 : 0x0000;
        patternAddr = table + tile * 16 + row;
      }
      const lo = this.busRead(patternAddr);
      const hi = this.busRead(patternAddr + 8);
      const bit = 7 - col;
      const pixel = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
      if (pixel === 0) continue;
      const paletteSel = 0x10 + (attr & 0x03) * 4 + pixel;
      return {
        color: this.palette[paletteIndex(0x3f00 + paletteSel)] ?? 0,
        priorityFront: (attr & 0x20) === 0,
        isZero: this.spriteIsZero[s] ?? false,
      };
    }
    return { color: 0, priorityFront: false, isZero: false };
  }

  private renderPixel(): void {
    const x = this.dot - 1;
    const y = this.scanline;

    let bgPixel = 0;
    let bgPalette = 0;
    if ((this.mask & 0x08) !== 0 && !(x < 8 && (this.mask & 0x02) === 0)) {
      const bitMux = 0x8000 >> this.fineX;
      const p0 = (this.bgShiftLo & bitMux) !== 0 ? 1 : 0;
      const p1 = (this.bgShiftHi & bitMux) !== 0 ? 1 : 0;
      bgPixel = p0 | (p1 << 1);
      const a0 = (this.atShiftLo & bitMux) !== 0 ? 1 : 0;
      const a1 = (this.atShiftHi & bitMux) !== 0 ? 1 : 0;
      bgPalette = a0 | (a1 << 1);
    }

    const sprite = this.spritePixel(x);

    let colorIndex: number;
    if (bgPixel === 0 && sprite.color === 0) {
      colorIndex = this.palette[0] ?? 0;
    } else if (bgPixel === 0) {
      colorIndex = sprite.color;
    } else if (sprite.color === 0) {
      colorIndex = this.palette[paletteIndex(0x3f00 + bgPalette * 4 + bgPixel)] ?? 0;
    } else {
      if (sprite.isZero && x < 255 && (this.mask & 0x18) === 0x18) {
        this.status |= 0x40; // sprite 0 hit
      }
      colorIndex = sprite.priorityFront
        ? sprite.color
        : (this.palette[paletteIndex(0x3f00 + bgPalette * 4 + bgPixel)] ?? 0);
    }

    let nesColor = colorIndex & 0x3f;
    if ((this.mask & 0x01) !== 0) nesColor &= 0x30; // greyscale
    const rgb = NES_PALETTE[nesColor] ?? [0, 0, 0];
    const offset = (y * SCREEN_WIDTH + x) * 4;
    this.frame[offset] = rgb[0];
    this.frame[offset + 1] = rgb[1];
    this.frame[offset + 2] = rgb[2];
    this.frame[offset + 3] = 255;
    this.frameIndices[y * SCREEN_WIDTH + x] = nesColor;
  }

  private updateShifters(): void {
    if ((this.mask & 0x08) === 0) return;
    this.bgShiftLo = (this.bgShiftLo << 1) & 0xffff;
    this.bgShiftHi = (this.bgShiftHi << 1) & 0xffff;
    this.atShiftLo = (this.atShiftLo << 1) & 0xffff;
    this.atShiftHi = (this.atShiftHi << 1) & 0xffff;
  }

  /** Advance one PPU dot. */
  step(): void {
    const visible = this.scanline < SCREEN_HEIGHT;
    const preRender = this.scanline === this.preRenderLine;

    if ((visible || preRender) && this.renderingEnabled()) {
      if ((this.dot >= 1 && this.dot <= 256) || (this.dot >= 321 && this.dot <= 336)) {
        this.updateShifters();
        this.fetchTile();
      }
      if (this.dot === 256) this.incrementVertical();
      if (this.dot === 257) this.transferX();
      if (preRender && this.dot >= 280 && this.dot <= 304) this.transferY();
      // Approximate MMC3-style scanline IRQ clock once per line.
      if (this.dot === 260) this.mapper.onScanlineTick?.();
    }

    if (visible && this.dot === 257 && this.renderingEnabled()) {
      this.evaluateSprites();
    }

    if (visible && this.dot >= 1 && this.dot <= 256) {
      this.renderPixel();
    }

    if (this.scanline === 241 && this.dot === 1) {
      this.status |= 0x80; // set vblank
      if ((this.ctrl & 0x80) !== 0) this.nmiOutput = true;
    }

    if (preRender && this.dot === 1) {
      this.status &= ~0x80; // clear vblank
      this.status &= ~0x40; // clear sprite 0 hit
      this.status &= ~0x20; // clear overflow
    }

    this.dot += 1;
    if (this.dot >= DOTS_PER_SCANLINE) {
      this.dot = 0;
      this.scanline += 1;
      if (this.scanline > this.preRenderLine) {
        this.scanline = 0;
        this.frameCount += 1;
        this.frameComplete = true;
      }
    }
  }
}
