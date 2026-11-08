// Mirror, drawn: a uniform mirror modulated along one diagonal.
//
// Bulbapedia names the paper and its direction — "international releases ... the
// direction is from bottom right to top left" — and describes no marks at all. So
// there is nothing here to scatter: the sheet is a single smooth band travelling
// along (x − y), with a floor high enough that the surface never stops reflecting.
//
// No scan, photograph or asset pack of a Mirror sheet exists in this repository, so
// this module DRAWS one from that sentence. It is a reconstruction:
// `textureVerified` is false, and the generated index says so.
//
// Two measured properties matter and neither is asserted from the source:
//   - the field TILES. Every value depends on (x − y) mod size, so the step across
//     the edges that meet is one pixel of a smooth function, not a discontinuity;
//     a card may sample any window.
//   - the CONTRAST is bounded and never reaches zero, so the sheen reads as a
//     mirror catching light rather than as a pattern of bright marks on dark foil.

import { MIRROR_FLOOR, MIRROR_PEAK, MIRROR_WAVES, mirrorSheenAt } from './mirror-sheen'

export { MIRROR_FLOOR, MIRROR_PEAK, MIRROR_WAVES, mirrorSheenAt }

export const MIRROR_SHEET_SIZE = 1024

export type MirrorSheet = {
  size: number
  rgba: Uint8ClampedArray
  /** Every pixel carries ink: the foil is uniform, only its brightness varies. */
  coverage: number
  peak: number
  floor: number
  mean: number
}

export function renderMirrorSheet(size = MIRROR_SHEET_SIZE): MirrorSheet {
  const rgba = new Uint8ClampedArray(size * size * 4)
  let peak = 0
  let floor = 1
  let sum = 0

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ink = mirrorSheenAt((x - y) / size)
      const p = (y * size + x) * 4
      // Neutral: the sheet carries luminance only, so it cannot tint a card.
      rgba[p] = 255
      rgba[p + 1] = 255
      rgba[p + 2] = 255
      rgba[p + 3] = Math.round(ink * 255)
      if (ink > peak) peak = ink
      if (ink < floor) floor = ink
      sum += ink
    }
  }

  return { size, rgba, coverage: 1, peak, floor, mean: sum / (size * size) }
}

/**
 * Discontinuity across the two edges that meet when the sheet wraps: the mean
 * alpha step over adjacent pixels either side of the seam. Small means the field
 * tiles; a large number means a sampler must clamp instead.
 */
export function mirrorSeamMismatch(rgba: Uint8ClampedArray | Uint8Array, size: number): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < size; y++) {
    sum += Math.abs(rgba[(y * size + (size - 1)) * 4 + 3] - rgba[(y * size) * 4 + 3]) / 255
    sum += Math.abs(rgba[((size - 1) * size + y) * 4 + 3] - rgba[y * 4 + 3]) / 255
    n += 2
  }
  return n ? sum / n : 0
}
