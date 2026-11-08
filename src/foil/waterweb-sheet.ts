// Water Web, drawn: wavy bands that flow like water.
//
// The sources are thin, and that matters for what this module may claim:
//
//   Bulbapedia, Holofoil — "Water Web Holofoil is the standard Holofoil pattern used for
//   cards from Sun & Moon expansion to Cosmic Eclipse. It consists of a wavy pattern
//   similar to flowing water."
//   Bulbapedia, Rarity — "These cards refract light in a wave-like pattern in all
//   releases. However, only the Japanese releases cover the border with the pattern."
//   Bleeding Cool (2021) — "a series of wavey lines that almost look like psychedelic
//   water stains … when moving the card around, the pattern moves like waves crashing on
//   a beach shore."
//
// No source gives a band count, a wave amplitude or a repeat, and no scan or photograph
// of the sheet is in this repository. So this module DRAWS wavy bands — eight of them
// across the sheet, each undulating as it runs down the card — and says so. The pitch,
// the amplitude and the swell are this build's choices, `textureVerified` is false, and
// the generated index records the measured field.
//
// Two properties are load-bearing:
//   - the bands are WAVY, not ruled. A straight vertical paper is Line, and a sheet whose
//     crest sits at the same column on every row would be the wrong paper.
//   - the foil between the crests still reflects (valley 0.30). Water Web is a continuous
//     foil with waves in it, not bright ribbons on a black field.
//
// The field TILES: every term in the phase is an integer multiple of a full turn in u and
// in v, so the edges meet and a card may sample any window. Whether the real paper
// repeated is undocumented; the wrap is this build's disclosed choice.
//
// Every pixel is neutral: ink is luminance x alpha, so the sheet cannot tint a card.

const TAU = Math.PI * 2

export const WATERWEB_SHEET_SIZE = 1024

/** Bands across the sheet width. Divides the sheet's own phase cycle. */
export const WATERWEB_WAVES = 8

/** How many times a band undulates on its way down the sheet. */
export const WATERWEB_VERTICAL_CYCLES = 2

/** Sideways swing of a band, in band units (1 = one full band spacing). */
export const WATERWEB_AMPLITUDE = 0.55

/** Darkest point between two crests. A continuous foil never goes black. */
export const WATERWEB_VALLEY = 0.3

/** Brightest crest at its most lit point. */
export const WATERWEB_PEAK = 0.96

/** Ink at or above this counts as a crest for the coverage measurement. */
export const WATERWEB_MARK_LINE = 0.5

/**
 * Where a point sits between two crests, in band units. Periodic in u and v with period
 * 1, which is what lets the sheet wrap: every term is a whole number of turns.
 */
export function waterwebPhase(u: number, v: number): number {
  const uu = u - Math.floor(u)
  const vv = v - Math.floor(v)
  const wiggle = WATERWEB_AMPLITUDE * Math.sin(TAU * (WATERWEB_VERTICAL_CYCLES * vv + 0.35 * Math.sin(TAU * uu)))
  return WATERWEB_WAVES * uu + wiggle
}

/** Ink at one sheet pixel. Exposed so the suite can measure the waves exactly. */
export function waterwebInkAt(x: number, y: number, size = WATERWEB_SHEET_SIZE): number {
  const u = x / size
  const v = y / size
  const crest = Math.pow(0.5 + 0.5 * Math.cos(TAU * waterwebPhase(u, v)), 1.25)
  // A slow swell so the field reads as water rather than as a printed screen.
  const swell = 0.9 + 0.1 * Math.sin(TAU * (3 * u + 2 * v))
  return Math.min(1, WATERWEB_VALLEY + (WATERWEB_PEAK * swell - WATERWEB_VALLEY) * crest)
}

export type WaterwebSheet = {
  size: number
  waves: number
  rgba: Uint8ClampedArray
  coverage: number
  peak: number
  valley: number
  mean: number
}

export function renderWaterwebSheet(size = WATERWEB_SHEET_SIZE): WaterwebSheet {
  const rgba = new Uint8ClampedArray(size * size * 4)
  let peak = 0
  let valley = 1
  let sum = 0
  let marked = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ink = waterwebInkAt(x, y, size)
      const p = (y * size + x) * 4
      rgba[p] = 255
      rgba[p + 1] = 255
      rgba[p + 2] = 255
      rgba[p + 3] = Math.round(ink * 255)
      if (ink > peak) peak = ink
      if (ink < valley) valley = ink
      if (ink >= WATERWEB_MARK_LINE) marked++
      sum += ink
    }
  }
  return { size, waves: WATERWEB_WAVES, rgba, coverage: marked / (size * size), peak, valley, mean: sum / (size * size) }
}

/**
 * Discontinuity across the two edges that meet when the sheet wraps: the mean alpha step
 * over adjacent pixels either side of the seam.
 */
export function waterwebSeamMismatch(rgba: Uint8ClampedArray | Uint8Array, size: number): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < size; y++) {
    sum += Math.abs(rgba[(y * size + (size - 1)) * 4 + 3] - rgba[(y * size) * 4 + 3]) / 255
    sum += Math.abs(rgba[((size - 1) * size + y) * 4 + 3] - rgba[y * 4 + 3]) / 255
    n += 2
  }
  return n ? sum / n : 0
}

/**
 * Mean alpha step between neighbouring columns inside the sheet: what one pixel of a
 * band's own slope costs. The wrap step must be no larger than this.
 */
export function waterwebInternalStep(rgba: Uint8ClampedArray | Uint8Array, size: number): number {
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
