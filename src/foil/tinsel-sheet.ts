// Tinsel, drawn: horizontal stripes across the image.
//
// Bulbapedia's Rarity page is the source, and it is a set-level statement:
// "For all sets in Generation V (from Black and White to Legendary Treasures), the
// holofoil pattern is named 'Tinsel Holofoil', and consists of horizontal stripes
// across the image."
//
// No scan, photograph or asset pack of that sheet exists in this repository, so
// this module DRAWS one from that sentence: bright horizontal ribbons of differing
// intensity, each broken into a few segments, with a soft edge and a slow shimmer
// along the line. It is a reconstruction, and `textureVerified` is false.
//
// Two choices are this build's own, and both are disclosed where they are load-
// bearing rather than buried in a comment:
//   - the stripes TILE. The pitch divides the sheet exactly and the segment breaks
//     wrap toroidally, so a card may sample any window. Whether the real paper
//     repeated is undocumented; tiling is the disclosed choice, as it is for
//     Cracked Ice's fracture.
//   - the pitch is ours. The sources name the pattern's orientation, not a line
//     count per card, so the sheet is drawn at a pitch that reads as banding at
//     card scale and is checked by the suite rather than presented as measured.
//
// The vocabulary is deliberately narrow: every pixel is neutral. Ink is luminance
// x alpha, so the sheet cannot tint a card — hue belongs to iridescence alone.

import { tinselInkAt, type TinselGap, type TinselLine } from './tinsel-lines'

export { tinselInkAt }
export type { TinselGap, TinselLine }

export const TINSEL_SHEET_SIZE = 1024
export const TINSEL_SEED = 0x71a5e1
/** Sheet rows per stripe. Divides the sheet, which is what makes the field tile. */
export const TINSEL_PERIOD = 16
export const TINSEL_STRIPES = TINSEL_SHEET_SIZE / TINSEL_PERIOD

const TAU = Math.PI * 2

export type TinselSheet = {
  size: number
  period: number
  stripes: number
  rgba: Uint8ClampedArray
  coverage: number
  peak: number
  lines: TinselLine[]
}

/** Small deterministic PRNG; the sheet must be byte-identical for a seed. */
export function tinselRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * Ink across a stripe, as a function of distance from the line's centre.
 * `band` is 0 at the centre and 1 at the midpoint between two lines. The core is
 * flat, then a smooth shoulder — a ruled grid (hard edges) would read as a wire
 * mesh rather than foil.
 */
export function tinselProfile(band: number): number {
  const core = 0.3
  const edge = 0.46
  if (band >= edge) return 0
  if (band <= core) return 1
  const t = (band - core) / (edge - core)
  return 1 - t * t * (3 - 2 * t)
}

/** Shortest distance around a wrap of `size`. */
export function torusDistance(a: number, b: number, size: number): number {
  const d = Math.abs(a - b) % size
  return Math.min(d, size - d)
}

export function renderTinselSheet(size = TINSEL_SHEET_SIZE, seed = TINSEL_SEED): TinselSheet {
  const rand = tinselRandom(seed)
  const period = Math.max(4, Math.round(size / (TINSEL_SHEET_SIZE / TINSEL_PERIOD)))
  const stripes = Math.round(size / period)
  const half = period / 2

  const lines: TinselLine[] = []
  for (let i = 0; i < stripes; i++) {
    const gaps: TinselGap[] = []
    const gapCount = 2 + Math.floor(rand() * 4)
    for (let g = 0; g < gapCount; g++) {
      gaps.push({ start: rand() * size, width: size * (0.02 + rand() * 0.07) })
    }
    lines.push({
      index: i,
      ink: 0.62 + rand() * 0.38,
      gaps,
      shimmer: { cycles: 2 + Math.floor(rand() * 5), phase: rand(), depth: 0.1 + rand() * 0.12 },
    })
  }

  const rgba = new Uint8ClampedArray(size * size * 4)
  let peak = 0
  let inked = 0

  for (let y = 0; y < size; y++) {
    const i = Math.floor(y / period) % stripes
    const line = lines[i]
    const dy = y - (i * period + half)
    const profile = tinselProfile(Math.min(1, Math.abs(dy) / half))
    for (let x = 0; x < size; x++) {
      // A little light between the lines, slowly varying, so the bare field is
      // not a dead zero — ALPHA_FLOOR turns a dead field into a hard edge.
      const between = 0.02 + 0.03 * (0.5 + 0.5 * Math.sin(TAU * (3 * (x / size) + y / size)))
      const ink = Math.min(1, between + profile * tinselInkAt(line, x, size))
      const p = (y * size + x) * 4
      rgba[p] = 255
      rgba[p + 1] = 255
      rgba[p + 2] = 255
      rgba[p + 3] = Math.round(ink * 255)
      if (ink > peak) peak = ink
      if (ink > 0.1) inked++
    }
  }

  return { size, period, stripes, rgba, coverage: inked / (size * size), peak, lines }
}

/**
 * Discontinuity across the two edges that meet when the sheet wraps: the mean
 * alpha step over adjacent pixels either side of the seam. Small means the field
 * tiles; a large number means a sampler must clamp instead.
 */
export function tinselSeamMismatch(rgba: Uint8ClampedArray | Uint8Array, size: number): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < size; y++) {
    sum += Math.abs(rgba[(y * size + (size - 1)) * 4 + 3] - rgba[(y * size) * 4 + 3]) / 255
    sum += Math.abs(rgba[((size - 1) * size + y) * 4 + 3] - rgba[(y) * 4 + 3]) / 255
    n += 2
  }
  return n ? sum / n : 0
}
