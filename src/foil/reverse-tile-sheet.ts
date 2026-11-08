// The tile sheet itself: a staggered lattice of rounded tiles, one glyph each.
// Kept apart from the sampler so the generator can draw a sheet before any index exists.

import { glyphInk, type GlyphId } from './type-glyph'

const wrap = (t: number) => t - Math.floor(t)

export const REVERSE_TILE_SIZE = 768

export type ReverseTileSheet = {
  glyph: GlyphId
  size: number
  rgba: Uint8ClampedArray
  coverage: number
  peak: number
  seam: number
}

function tileAlpha(glyph: GlyphId, u: number, v: number, rows: number): number {
  const x = u * rows
  const y = v * rows
  const row = Math.floor(y)
  // Stagger alternate rows by half a tile; rows is even, so the wrap keeps parity.
  const cx = wrap(x + (row % 2) * 0.5)
  const cy = wrap(y)
  const dx = Math.abs(cx - 0.5)
  const dy = Math.abs(cy - 0.5)
  const half = 0.41
  const radius = 0.14
  if (dx > half || dy > half) return 0
  // Rounded-rectangle test: only the corner square needs the circle check.
  if (dx > half - radius && dy > half - radius) {
    const qx = dx - (half - radius)
    const qy = dy - (half - radius)
    if (qx * qx + qy * qy > radius * radius) return 0
  }
  const edge = Math.min(half - dx, half - dy)
  let a = edge < 0.018 ? 0.42 : 0.16
  const gx = (cx - 0.5) / 0.30
  const gy = (cy - 0.5) / 0.30
  if (glyphInk(glyph, gx, gy)) a = 0.95
  return a
}

export function renderReverseTileSheet(
  glyph: GlyphId,
  size = REVERSE_TILE_SIZE,
  seed = 0x51d3,
): ReverseTileSheet {
  const rows = 4
  const alpha = new Float32Array(size * size)
  let covered = 0
  let peak = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = tileAlpha(glyph, (x + 0.5) / size, (y + 0.5) / size, rows)
      alpha[y * size + x] = a
      if (a > 0.1) covered++
      if (a > peak) peak = a
    }
  }
  const rgba = new Uint8ClampedArray(size * size * 4)
  for (let i = 0, n = size * size; i < n; i++) {
    rgba[i * 4] = 255
    rgba[i * 4 + 1] = 255
    rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = Math.round(alpha[i] * 255)
  }
  // Measured wrap mismatch, the same gate the other reverse sheets use.
  let seamSum = 0
  let insideSum = 0
  for (let i = 0; i < size; i++) {
    seamSum += Math.abs(alpha[i] - alpha[(size - 1) * size + i])
    seamSum += Math.abs(alpha[i * size] - alpha[i * size + size - 1])
    insideSum += alpha[Math.floor(size / 3) * size + i]
  }
  const seam = seamSum / Math.max(1e-6, insideSum)
  return { glyph, size, rgba, coverage: covered / (size * size), peak, seam }
}
