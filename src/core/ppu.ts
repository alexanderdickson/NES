// Standard NES master palette (64 entries) as [r, g, b]. This is the common
// "2C02" approximation used by many emulators.
export const NES_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [84, 84, 84],
  [0, 30, 116],
  [8, 16, 144],
  [48, 0, 136],
  [68, 0, 100],
  [92, 0, 48],
  [84, 4, 0],
  [60, 24, 0],
  [32, 42, 0],
  [8, 58, 0],
  [0, 64, 0],
  [0, 60, 0],
  [0, 50, 60],
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [152, 150, 152],
  [8, 76, 196],
  [48, 50, 236],
  [92, 30, 228],
  [136, 20, 176],
  [160, 20, 100],
  [152, 34, 32],
  [120, 60, 0],
  [84, 90, 0],
  [40, 114, 0],
  [8, 124, 0],
  [0, 118, 40],
  [0, 102, 120],
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [236, 238, 236],
  [76, 154, 236],
  [120, 124, 236],
  [176, 98, 236],
  [228, 84, 236],
  [236, 88, 180],
  [236, 106, 100],
  [212, 136, 32],
  [160, 170, 0],
  [116, 196, 0],
  [76, 208, 32],
  [56, 204, 108],
  [56, 180, 204],
  [60, 60, 60],
  [0, 0, 0],
  [0, 0, 0],
  [236, 238, 236],
  [168, 204, 236],
  [188, 188, 236],
  [212, 178, 236],
  [236, 174, 236],
  [236, 174, 212],
  [236, 180, 176],
  [228, 196, 144],
  [204, 210, 120],
  [180, 222, 120],
  [168, 226, 144],
  [152, 226, 180],
  [160, 214, 228],
  [160, 162, 160],
  [0, 0, 0],
  [0, 0, 0],
];

export const TILE_SIZE = 8;
export const TILE_BYTES = 16;

/** A 4-color palette expressed as indices into NES_PALETTE. */
export type Palette = readonly [number, number, number, number];

/** Sensible default palettes (index into the master palette). */
export const DEFAULT_PALETTES: readonly Palette[] = [
  [0x0f, 0x00, 0x10, 0x30], // grayscale
  [0x0f, 0x06, 0x16, 0x26], // reds
  [0x0f, 0x09, 0x19, 0x29], // greens
  [0x0f, 0x02, 0x12, 0x22], // blues
];

export function tileCount(chr: Uint8Array): number {
  return Math.floor(chr.length / TILE_BYTES);
}

/**
 * Decode a single 8x8 tile into 64 pixel values in the range 0..3.
 */
export function decodeTile(chr: Uint8Array, tileIndex: number): Uint8Array {
  const out = new Uint8Array(TILE_SIZE * TILE_SIZE);
  const base = tileIndex * TILE_BYTES;
  for (let y = 0; y < TILE_SIZE; y++) {
    const plane0 = chr[base + y] ?? 0;
    const plane1 = chr[base + y + TILE_SIZE] ?? 0;
    for (let x = 0; x < TILE_SIZE; x++) {
      const bit = 7 - x;
      const lo = (plane0 >> bit) & 1;
      const hi = (plane1 >> bit) & 1;
      out[y * TILE_SIZE + x] = lo | (hi << 1);
    }
  }
  return out;
}

/**
 * Render a range of CHR tiles into an RGBA buffer arranged as a grid.
 * Returns the pixel buffer plus its dimensions.
 */
export function renderTileSheet(
  chr: Uint8Array,
  palette: Palette,
  tilesPerRow: number,
  startTile = 0,
  count = tileCount(chr),
): { data: Uint8ClampedArray; width: number; height: number } {
  const cols = Math.max(1, tilesPerRow);
  const rows = Math.max(1, Math.ceil(count / cols));
  const width = cols * TILE_SIZE;
  const height = rows * TILE_SIZE;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < count; i++) {
    const tile = decodeTile(chr, startTile + i);
    const tileX = (i % cols) * TILE_SIZE;
    const tileY = Math.floor(i / cols) * TILE_SIZE;
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const value = tile[y * TILE_SIZE + x] ?? 0;
        const masterIndex = palette[value] ?? 0;
        const rgb = NES_PALETTE[masterIndex] ?? [0, 0, 0];
        const px = ((tileY + y) * width + (tileX + x)) * 4;
        data[px] = rgb[0];
        data[px + 1] = rgb[1];
        data[px + 2] = rgb[2];
        data[px + 3] = 255;
      }
    }
  }
  return { data, width, height };
}
