// Scarlet & Violet reverse paper: nested rounded tiles, each ring carrying the
// type symbol at its own size.
//
// Described as an intricate tile design with type symbols of different sizes. The
// lattice and glyphs are PROCEDURAL RECONSTRUCTIONS; the identity of the paper is
// the documented part. Kept apart from the sampler so the generator can draw the
// sheets before any index exists.

import { glyphInk, type GlyphId } from './type-glyph'

export const REVERSE_TILE_INTRICATE_SIZE = 768

const wrap = (t: number) => t - Math.floor(t)

export type ReverseTileIntricateSheet = {
  glyph: GlyphId
  size: number
  rgba: Uint8ClampedArray
  coverage: number
  peak: number
  seam: number
}

/** Nested rounded squares: outer ring dim, inner core bright, glyph in the core. */
const RINGS = [
  { half: 0.46, radius: 0.17, alpha: 0.10 },
  { half: 0.35, radius: 0.15, alpha: 0.18 },
  { half: 0.25, radius: 0.13, alpha: 0.26 },
  { half: 0.15, radius: 0.11, alpha: 0.34 },
]

function inRounded(dx: number, dy: number, half: number, radius: number): boolean {
  if (dx > half || dy > half) return false
  if (dx > half - radius && dy > half - radius) {
    const qx = dx - (half - radius)
    const qy = dy - (half - radius)
    return qx * qx + qy * qy <= radius * radius
  }
  return true
}

function intricateAlpha(glyph: GlyphId, u: number, v: number, rows: number): number {
  const x = u * rows
  const y = v * rows
  const row = Math.floor(y)
  const cx = wrap(x + (row % 2) * 0.5)
  const cy = wrap(y)
  const dx = Math.abs(cx - 0.5)
  const dy = Math.abs(cy - 0.5)
  let a = 0
  for (const ring of RINGS) if (inRounded(dx, dy, ring.half, ring.radius)) a = ring.alpha
  if (a === 0) return 0
  // One large glyph in the core, plus four small ones on the middle ring, so the
  // symbol appears at more than one size exactly as the paper describes.
  if (glyphInk(glyph, (cx - 0.5) / 0.135, (cy - 0.5) / 0.135)) return 0.95
  const ox = Math.abs(dx - 0.30)
  const oy = Math.abs(dy - 0.30)
  if (ox < 0.05 && oy < 0.05 && inRounded(ox, oy, 0.05, 0.02)) {
    if (glyphInk(glyph, (dx - 0.30) / 0.045, (dy - 0.30) / 0.045)) return 0.90
    if (glyphInk(glyph, -(dx - 0.30) / 0.045, (dy - 0.30) / 0.045)) return 0.90
  }
  return a
}

export function renderReverseTileIntricateSheet(
  glyph: GlyphId,
  size = REVERSE_TILE_INTRICATE_SIZE,
): ReverseTileIntricateSheet {
  const rows = 4
  const alpha = new Float32Array(size * size)
  let covered = 0
  let peak = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = intricateAlpha(glyph, (x + 0.5) / size, (y + 0.5) / size, rows)
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
  let seamSum = 0
  let insideSum = 0
  for (let i = 0; i < size; i++) {
    seamSum += Math.abs(alpha[i] - alpha[(size - 1) * size + i])
    seamSum += Math.abs(alpha[i * size] - alpha[i * size + size - 1])
    insideSum += alpha[Math.floor(size / 3) * size + i]
  }
  return { glyph, size, rgba, coverage: covered / (size * size), peak, seam: seamSum / Math.max(1e-6, insideSum) }
}
