// Radiant Pokémon, drawn: an etched silver lattice with a wider diamond grid.
//
// The sources name the finish and the area, and neither the spacing nor a repeat:
//
//   Bulbapedia Rarity — Radiant Pokémon "have a special holofoil layer".
//   A collector foil guide — "etched, embossed silver foil covering the entire card".
//   A second account — textured foil on the Pokémon figure with a geometric pattern
//   running through the card body.
//
// So this module DRAWS that: two families of diagonal ridges crossing into a lattice,
// a fine etch (16px) inside a coarser diamond grid (128px), over a field bright enough
// that the silver never reads as a dark marked paper. No scan or photograph of the
// paper exists in this repository, `textureVerified` is false, and the generated index
// says so.
//
// Three properties are measured rather than asserted, and the suite pins them:
//   - the FIELD NEVER GOES DARK. A mirror's floor is load-bearing for the same reason:
//     this is silver foil, so a bare field has to keep reflecting.
//   - it TILES EXACTLY. Every value depends on (x ± y) mod period, and both periods
//     divide the sheet, so the step across the wrap is one pixel of a smooth function.
//   - it is DETERMINISTIC. There is no random source here at all: the same seedless
//     render is the same bytes every time, because the pattern must not move under
//     tilt and must not differ between frames.

export const RADIANT_ETCHED_SHEET_SIZE = 1024

/** Fine etch pitch, in sheet pixels. Divides the sheet exactly. */
export const RADIANT_ETCHED_FINE_PERIOD = 16
/** Coarse diamond grid pitch, in sheet pixels. Divides the sheet exactly. */
export const RADIANT_ETCHED_COARSE_PERIOD = 128

/** Ridge widths, in pixels: the fine etch is a hairline, the grid is a wider groove. */
export const RADIANT_ETCHED_FINE_WIDTH = 1.7
export const RADIANT_ETCHED_COARSE_WIDTH = 3.2

/**
 * Ink floor, and the gains each family adds on top of it.
 *
 * The ETCH is the paper's main mark, so it carries the larger gain: a fine ridge alone
 * has to clear the mark line, otherwise only the diamonds read and the paper looks like
 * Crosshatch rather than etched silver. The coarse grid brightens the crossings.
 */
export const RADIANT_ETCHED_FLOOR = 0.36
export const RADIANT_ETCHED_FINE_GAIN = 0.3
export const RADIANT_ETCHED_COARSE_GAIN = 0.16
export const RADIANT_ETCHED_PEAK = 0.82

/** Ink at or above this is a mark, for the coverage measurement. */
export const RADIANT_ETCHED_MARK_LINE = 0.52

/** A Gaussian ridge: 1 on the line, falling away smoothly to either side. */
export function etchedRidge(distance: number, width: number): number {
  const d = distance / width
  return Math.exp(-d * d)
}

/** Distance to the nearest ridge of a family, on a line that wraps. */
function wrapDistance(t: number, period: number): number {
  const m = ((t % period) + period) % period
  return Math.min(m, period - m)
}

/**
 * Alpha at one sheet pixel. Both families run along BOTH diagonals, so a point's ink
 * depends only on (x + y) and (x − y) modulo their periods — which is exactly why
 * translating by a period leaves the value unchanged and the sheet tiles.
 */
export function radiantEtchedInkAt(x: number, y: number): number {
  const fine =
    etchedRidge(wrapDistance(x + y, RADIANT_ETCHED_FINE_PERIOD), RADIANT_ETCHED_FINE_WIDTH) +
    etchedRidge(wrapDistance(x - y, RADIANT_ETCHED_FINE_PERIOD), RADIANT_ETCHED_FINE_WIDTH)
  const coarse =
    etchedRidge(wrapDistance(x + y, RADIANT_ETCHED_COARSE_PERIOD), RADIANT_ETCHED_COARSE_WIDTH) +
    etchedRidge(wrapDistance(x - y, RADIANT_ETCHED_COARSE_PERIOD), RADIANT_ETCHED_COARSE_WIDTH)
  const ink =
    RADIANT_ETCHED_FLOOR +
    RADIANT_ETCHED_FINE_GAIN * Math.min(1, fine) +
    RADIANT_ETCHED_COARSE_GAIN * Math.min(1, coarse)
  return Math.min(RADIANT_ETCHED_PEAK, Math.max(RADIANT_ETCHED_FLOOR, ink))
}

export type RadiantEtchedSheet = {
  size: number
  rgba: Uint8ClampedArray
  /** Fraction of pixels above the mid-ink line: how much of the sheet is a mark. */
  coverage: number
  peak: number
  floor: number
  mean: number
}

export function renderRadiantEtchedSheet(size = RADIANT_ETCHED_SHEET_SIZE): RadiantEtchedSheet {
  const rgba = new Uint8ClampedArray(size * size * 4)
  const scale = size / RADIANT_ETCHED_SHEET_SIZE
  let peak = 0
  let floor = 1
  let sum = 0
  let marked = 0
  const markLine = RADIANT_ETCHED_MARK_LINE

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ink = radiantEtchedInkAt(x / scale, y / scale)
      const p = (y * size + x) * 4
      // Neutral: luminance only, so the sheet can never tint a card.
      rgba[p] = 255
      rgba[p + 1] = 255
      rgba[p + 2] = 255
      rgba[p + 3] = Math.round(ink * 255)
      if (ink > peak) peak = ink
      if (ink < floor) floor = ink
      if (ink >= markLine) marked++
      sum += ink
    }
  }

  return { size, rgba, coverage: marked / (size * size), peak, floor, mean: sum / (size * size) }
}

/**
 * Discontinuity across the two edges that meet when the sheet wraps: the mean alpha
 * step over adjacent pixels either side of the seam. Small means the sheet tiles; a
 * large number means the sampler would have to clamp.
 */
export function radiantEtchedSeamMismatch(rgba: Uint8ClampedArray | Uint8Array, size: number): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < size; y++) {
    sum += Math.abs(rgba[(y * size + (size - 1)) * 4 + 3] - rgba[(y * size) * 4 + 3]) / 255
    sum += Math.abs(rgba[((size - 1) * size + y) * 4 + 3] - rgba[y * 4 + 3]) / 255
    n += 2
  }
  return n ? sum / n : 0
}
