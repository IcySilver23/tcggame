// Ascended Heroes' Energy-pattern reverse sheet: one large type glyph.
//
// The reference is a real Snorunt Energy-pattern reverse: one large Water Energy
// symbol sits behind the attack text, roughly centred across the card and about
// 0.45 card widths across, with the illustration window matte. The symbol is the
// card's own type, not a set-level glyph.
//
// This module reuses the stylised type drawings from type-glyph.ts. They are
// geometric approximations, not official icon artwork, and the sheet is a
// PROCEDURAL RECONSTRUCTION: no scan or clean photograph of the sheet is bundled
// here. The reference fixes the single-stamp layout and its approximate size; it
// does not verify the strokes. Every asset therefore records `verified: false`.
//
// The glyph is drawn in the centre of a square sheet. The sampler maps a 0.95
// window around that centre to a target at (0.5, 0.675) on the card. Every glyph
// is fitted into the same measured 0.45 x 0.43 card stamp box, so a diagonal leaf
// cannot become wider than Water's droplet; that normalisation is this build's
// disclosed choice, not a property of the print.

import {
  GLYPH_IDS,
  glyphInk,
  TYPE_SYMBOL_SEED,
  typeSymbolRandom,
  type GlyphId,
} from './type-glyph'

export const ENERGY_REVERSE_SHEET_SIZE = 512
export const ENERGY_REVERSE_SEED = TYPE_SYMBOL_SEED
/** Measured from the real Snorunt Energy reverse, in card fractions. */
export const ENERGY_REVERSE_STAMP_WIDTH = 0.45
export const ENERGY_REVERSE_STAMP_HEIGHT = 0.43
/** The sampler maps this much of the sheet across the card. */
export const ENERGY_REVERSE_WINDOW = 0.95

export type EnergyReverseGlyph = Exclude<GlyphId, 'trainer'>

export const ENERGY_REVERSE_GLYPHS: EnergyReverseGlyph[] = GLYPH_IDS.filter(
  (id): id is EnergyReverseGlyph => id !== 'trainer',
)

export type EnergyReverseSheet = {
  glyph: EnergyReverseGlyph
  size: number
  seed: number
  rgba: Uint8ClampedArray
  coverage: number
  peak: number
  /** Glyph centre as a fraction of the sheet, for the sampler's anchor. */
  centerU: number
  centerV: number
}

type GlyphBounds = { minX: number; maxX: number; minY: number; maxY: number }

/** The glyph's own ink bounds, sampled once so every type can fill the stamp box. */
function glyphBounds(glyph: EnergyReverseGlyph, steps = 256): GlyphBounds {
  let minX = 1, maxX = -1, minY = 1, maxY = -1
  for (let iy = 0; iy < steps; iy++) {
    const y = -1 + ((iy + 0.5) / steps) * 2
    for (let ix = 0; ix < steps; ix++) {
      const x = -1 + ((ix + 0.5) / steps) * 2
      if (!glyphInk(glyph, x, y)) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { minX, maxX, minY, maxY }
}

/**
 * Draw one large glyph in the middle of a blank sheet. The glyph keeps its own
 * seed per type, so regenerating the assets is deterministic. Its own ink bounds
 * are stretched to fill the measured stamp box, which keeps every type the same
 * apparent size.
 */
export function renderEnergyReverseSheet(
  glyph: EnergyReverseGlyph,
  size = ENERGY_REVERSE_SHEET_SIZE,
  seed = ENERGY_REVERSE_SEED,
): EnergyReverseSheet {
  const rand = typeSymbolRandom(seed + GLYPH_IDS.indexOf(glyph) * 131071)
  const cx = size * (0.5 + (rand() - 0.5) * 0.012)
  const cy = size * (0.5 + (rand() - 0.5) * 0.012)
  const stampW = size * (ENERGY_REVERSE_STAMP_WIDTH / ENERGY_REVERSE_WINDOW)
  const stampH = size * (ENERGY_REVERSE_STAMP_HEIGHT / ENERGY_REVERSE_WINDOW)
  const bounds = glyphBounds(glyph)
  const alpha = new Float32Array(size * size)

  const x0 = Math.max(0, Math.floor(cx - stampW / 2) - 1)
  const x1 = Math.min(size - 1, Math.ceil(cx + stampW / 2) + 1)
  const y0 = Math.max(0, Math.floor(cy - stampH / 2) - 1)
  const y1 = Math.min(size - 1, Math.ceil(cy + stampH / 2) + 1)

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const tx = (x + 0.5 - (cx - stampW / 2)) / stampW
      const ty = (y + 0.5 - (cy - stampH / 2)) / stampH
      if (tx < 0 || tx > 1 || ty < 0 || ty > 1) continue
      const nx = bounds.minX + tx * (bounds.maxX - bounds.minX)
      const ny = bounds.minY + ty * (bounds.maxY - bounds.minY)
      if (!glyphInk(glyph, nx, ny)) continue
      alpha[y * size + x] = 0.95
    }
  }

  const rgba = new Uint8ClampedArray(size * size * 4)
  let covered = 0
  let peak = 0
  for (let i = 0, n = size * size; i < n; i++) {
    const a = alpha[i]
    rgba[i * 4] = 255
    rgba[i * 4 + 1] = 255
    rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = Math.round(a * 255)
    if (a > 0.1) covered++
    if (a > peak) peak = a
  }

  return {
    glyph,
    size,
    seed,
    rgba,
    coverage: covered / (size * size),
    peak,
    centerU: cx / size,
    centerV: cy / size,
  }
}
