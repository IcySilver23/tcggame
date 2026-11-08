// Line, drawn: thin vertical lines that refract light down the image.
//
// The source is Bulbapedia's Holofoil page, and it is a set-level statement:
//
//   "Line Holofoil was used for standard Holo cards from Sword & Shield through Crown
//   Zenith. The pattern consists of thin vertical lines that refract light from the top
//   to the bottom of the Pokémon's image. Japanese cards using the pattern also have
//   Holofoil borders, while international releases retained their yellow borders."
//
// PokéBeach's January 2020 report, which the wiki cites, called it "a vertical 'line'
// pattern like in Japan", and Bulbapedia's Rarity page describes the same "series of thin
// vertical stripes".
//
// No scan, photograph or asset pack of the sheet exists in this repository, so this
// module DRAWS one from those sentences: a ruled foil of thin vertical ridges, each
// ridge's brightness drifting slowly from the top of the sheet to the bottom. Three
// choices are this build's own and are disclosed wherever they matter:
//
//   - THE PITCH IS OURS. The sources name the orientation and the fineness, not a line
//     count, so the sheet is drawn at 8px (128 lines), which reads as fine striping at
//     card scale.
//   - IT IS A RULED FOIL, NOT A MARKED PAPER. A Line card seen from across a table looks
//     like a vertical sheen, not like bright marks on black, so the valleys stay bright
//     (0.34) instead of falling toward zero the way Crosshatch's field does. The ridge
//     is what catches light; the foil between ridges still reflects.
//   - THE SHEET TILES. The pitch divides the sheet and every drift is periodic in the
//     sheet height, so the edges meet; whether the real paper repeated is undocumented.
//
// Every pixel is neutral. Ink is luminance x alpha, so the sheet cannot tint a card.

const TAU = Math.PI * 2

export const LINE_SHEET_SIZE = 1024

/** Column pitch. 8px gives 128 lines and divides the sheet exactly. */
export const LINE_PITCH = 8

export const LINE_SEED = 0x11ae0

/** Darkest point of a valley. A ruled foil never goes black. */
export const LINE_VALLEY = 0.34

/** Brightest ridge at its most lit point down the sheet. */
export const LINE_PEAK = 0.97

/** Ink at or above this counts as ridge for the coverage measurement. */
export const LINE_MARK_LINE = 0.5

/** 32-bit integer hash → 0..1, so the sheet is byte-identical on every run. */
function hash32(x: number, salt: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(salt, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967295
}

export type LineStripe = {
  index: number
  /** Peak ink of this ridge before the top-to-bottom drift. */
  ink: number
  /** How many times the drift repeats down the sheet. Integer, so it wraps. */
  cycles: number
  phase: number
  /** How far the drift dims the ridge at its trough. */
  depth: number
}

/** The ridge at a sheet column. Deterministic in the column index. */
export function lineStripeFor(index: number): LineStripe {
  return {
    index,
    ink: 0.62 + hash32(index, 1) * 0.35,
    cycles: 1 + Math.floor(hash32(index, 2) * 3),
    phase: hash32(index, 3),
    depth: 0.06 + hash32(index, 4) * 0.1,
  }
}

/** Ridge weight across the pitch: 1 on the line, 0 midway between two lines. */
export function lineProfile(band: number): number {
  const t = Math.min(1, Math.max(0, band))
  return 0.5 + 0.5 * Math.cos(Math.PI * t)
}

/** How much this ridge is lit at a sheet row, before the profile. */
export function lineDrift(stripe: LineStripe, y: number, size: number): number {
  return 1 - stripe.depth * (0.5 - 0.5 * Math.cos(TAU * (stripe.cycles * (y / size) + stripe.phase)))
}

/** Ink at one sheet pixel. Exposed so the suite can check the lattice exactly. */
export function lineInkAt(x: number, y: number, size = LINE_SHEET_SIZE): number {
  const pitch = Math.max(2, Math.round((size / LINE_SHEET_SIZE) * LINE_PITCH))
  const stripes = Math.round(size / pitch)
  const half = pitch / 2
  // Ridge centres sit ON multiples of the pitch, not half a pitch off them, so x = 0 is a
  // centre exactly as x = size is. That is what lets the last column meet the first: with
  // the centres offset by half, the sheet's left edge was a valley and its right edge a
  // flank, which measured as a 2.1% step.
  const nearest = Math.round(x / pitch)
  const centre = nearest * pitch
  const raw = Math.abs(x - centre)
  const d = Math.min(raw, Math.abs(size - raw))
  const index = ((nearest % stripes) + stripes) % stripes
  const band = Math.min(1, d / half)
  const stripe = lineStripeFor(index)
  const peak = stripe.ink * lineDrift(stripe, y, size)
  return Math.min(1, LINE_VALLEY + (peak - LINE_VALLEY) * lineProfile(band))
}

export type LineSheet = {
  size: number
  pitch: number
  stripes: number
  rgba: Uint8ClampedArray
  coverage: number
  peak: number
  floor: number
  mean: number
}

export function renderLineSheet(size = LINE_SHEET_SIZE): LineSheet {
  const pitch = Math.max(2, Math.round((size / LINE_SHEET_SIZE) * LINE_PITCH))
  const stripes = Math.round(size / pitch)
  const rgba = new Uint8ClampedArray(size * size * 4)
  let peak = 0
  let floor = 1
  let sum = 0
  let marked = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ink = lineInkAt(x, y, size)
      const p = (y * size + x) * 4
      rgba[p] = 255
      rgba[p + 1] = 255
      rgba[p + 2] = 255
      rgba[p + 3] = Math.round(ink * 255)
      if (ink > peak) peak = ink
      if (ink < floor) floor = ink
      if (ink >= LINE_MARK_LINE) marked++
      sum += ink
    }
  }
  return { size, pitch, stripes, rgba, coverage: marked / (size * size), peak, floor, mean: sum / (size * size) }
}

/**
 * Discontinuity across the two edges that meet when the sheet wraps: the mean alpha
 * step over adjacent pixels either side of the seam. Small means the sheet tiles.
 */
/**
 * Mean alpha step between neighbouring columns: what one pixel of a ridge's own slope
 * costs. The wrap step must be no larger than this, or the sheet was stitched wrong.
 */
export function lineInternalStep(rgba: Uint8ClampedArray | Uint8Array, size: number): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < size; y += 8) {
    for (let x = 0; x < size - 1; x++) {
      sum += Math.abs(rgba[(y * size + x + 1) * 4 + 3] - rgba[(y * size + x) * 4 + 3]) / 255
      n++
    }
  }
  return n ? sum / n : 0
}

export function lineSeamMismatch(rgba: Uint8ClampedArray | Uint8Array, size: number): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < size; y++) {
    sum += Math.abs(rgba[(y * size + (size - 1)) * 4 + 3] - rgba[(y * size) * 4 + 3]) / 255
    sum += Math.abs(rgba[((size - 1) * size + y) * 4 + 3] - rgba[y * 4 + 3]) / 255
    n += 2
  }
  return n ? sum / n : 0
}
