// Mirage, drawn: a smooth sheen that travels horizontally.
//
// The source is Bulbapedia's Holofoil page, and it describes light rather than marks:
//
//   "Mirage Holofoil was introduced with the Scarlet & Violet Series. It is visually
//   similar to the Sheen Holofoil used during the XY Series, but refracts light
//   horizontally rather than diagonally. Standard Holo cards also have Holofoil silver
//   borders. The effect can be difficult to see clearly in photographs because its
//   appearance depends on reflected light."
//
// PokéBeach's Scarlet & Violet set guide (the wiki's citation) calls it a "horizontal
// sheen", and a collector guide calls it "a smooth horizontal sweep of light".
//
// There is nothing here to scatter: no dots, stars or lines. So the sheet is a uniform
// field modulated along one axis, exactly as the Mirror/Sheen paper is modulated along its
// diagonal — this is that paper rotated, which is what the source says.
//
// Two readings are this build's and are disclosed wherever they matter:
//
//   - THE BANDS RUN VERTICALLY; WHICH WAY THEY TRAVEL IS NOT CLAIMED. The source names the
//     direction the light travels (horizontally) and not the orientation of the bands. This
//     build reads "refracts horizontally" literally as the AXIS the field varies on: the
//     field varies with x, so a band crosses the card from top to bottom. The clips cannot
//     settle the direction of travel (see `MIRAGE_MEASURED.direction`) — they rock the card,
//     and the band's card-relative drift does not agree in sign across them.
//   - THE CONTRAST AND THE BAND COUNT are ours, but they are measured rather than guessed.
//     Two bands across the sheet is what the real cards say: across three tilt-run clips
//     the median band spacing is 0.656 card widths, and two waves put 0.69 here, while the
//     first drawing's three waves sat at 0.46 — 30% too tight (see MIRAGE_MEASURED). The
//     contrast needed no change: the clips read 1.60-1.66x, and this pipeline's own
//     control under-reads by 7%, so 1.73x stands. The floor stays high, because a sheen
//     never stops reflecting; a low floor would read as printed banding.
//
// One sourced fact is deliberately NOT modelled here: "Standard Holo cards also have
// Holofoil silver borders". The mask in this build is the illustration window, so the
// border is left flat; the report states that rather than implying the card is complete.
//
// The field TILES — every value depends on x mod size — so a card may sample any window.
//
// Every pixel is neutral: ink is luminance x alpha, so the sheet cannot tint a card.

const TAU = Math.PI * 2

export const MIRAGE_SHEET_SIZE = 1024

/** Contrast floor. A sheen always reflects, so the field never goes dark. */
export const MIRAGE_FLOOR = 0.55

/** Peak of the sweep. */
export const MIRAGE_PEAK = 0.95

/** Broad bands across the sheet: two, because that is what the real cards measure. */
export const MIRAGE_WAVES = 2

/** Ink at or above this counts as a lit part of the sweep, for the coverage measure. */
export const MIRAGE_MARK_LINE = 0.8

/**
 * What the real paper measured, from the reveal tilt runs (tmp/measure-mirage-ratio.py).
 *
 * The instrument is a ratio between two frames of the same card, which divides the
 * artwork out and leaves the sheen. It is validated on a synthetic tilt run of this same
 * sheet before it is trusted: that control recovers the drawn period to 0% and the drawn
 * contrast to 7%, and reads the bands as columns.
 *
 * The first drawing of this paper put three bands across the sheet, i.e. 0.46 card widths
 * apart. The clips say 0.656, so the drawing was too tight by a third and was retuned to
 * two bands (0.69 card widths) rather than left as a plausible-looking guess.
 *
 * A single frame cannot confirm that number, and the attempt is recorded rather than
 * reported as a confirmation: one broad band across the face fits 0.656 and the drawn 0.687
 * equally well (tmp/measure-mirage-single.py reports a plateau, not a point, and the stills'
 * plateaus span both). So `period` is a property of the moving reflection as the ratio
 * measures it, not evidence about a printed repeat.
 */
export const MIRAGE_MEASURED = {
  source: 'the reveal tilt-run GIFs of the Scarlet & Violet promos 013/198, 036/198 and 052/198 (PokéBeach, Dec 2022)',
  instrument: 'frame-to-frame ratio, artwork divided out; control = a synthetic tilt of this sheet',
  control: 'recovers the drawn period to 0%, the contrast to 7%, and reads the band as a column',
  clips: [
    { card: 'Sprigatito 013/198', period: 0.721, contrast: 1.6, vertical: 0.63 },
    { card: 'Fuecoco 036/198', period: 0.516, contrast: 1.66, vertical: 0.7 },
    { card: 'Quaxly 052/198', period: 0.656, contrast: 1.6, vertical: 0.77 },
  ],
  /** Median band spacing across the three clips, in card widths. */
  period: 0.656,
  /** Median measured contrast; the instrument under-reads, see `control`. */
  contrast: 1.62,
  /** Median row-to-row correlation: the bands are columns, though hand motion blurs it. */
  vertical: 0.7,
  /**
   * Which way the band travels across the card — and why this build does not claim one.
   *
   * `tmp/measure-mirage-direction.py` registers every frame on the card's PRINTED detail
   * before it measures anything, because a column profile in frame coordinates cannot tell
   * the hand moving the card from the sheen moving on it. Its controls: a band drawn moving
   * right reads right, one drawn moving left reads left, and a STILL band under a rocking
   * card reads +0.27 per 1000 frames — the instrument's own leak, and the floor below which
   * a reading is silence.
   *
   * The clips give -5.35, -0.09 and +2.71 per 1000 frames: two drift left, one drifts right,
   * and Sprigatito's own halves disagree (-12.74 then -1.56), which is a rock rather than a
   * sweep. Total motion stays under one card width in all three (-0.48, +0.02, +1.01). So the
   * source's "refracts horizontally" is taken as the axis the field varies on, and the
   * direction of travel is left unclaimed rather than asserted from footage that has no
   * consistent sign.
   */
  direction: {
    claim: 'not established',
    note: 'the reveal runs rock the card; the band drifts without a consistent sign',
    control: 'a still band under a rocking card reads +0.27 per 1000 frames (the leak)',
    clips: [
      { card: 'Sprigatito 013/198', drift: -5.35, total: -0.48, halves: '-12.74 then -1.56' },
      { card: 'Fuecoco 036/198', drift: -0.09, total: 0.02, halves: '+1.48 then -0.08' },
      { card: 'Quaxly 052/198', drift: 2.71, total: 1.01, halves: '+5.13 then +3.89' },
    ],
  },
} as const

/**
 * Ink at a horizontal coordinate, 0..1 of the sheet. Wrapped, so the field continues
 * across the sheet edge and a card may sample any window.
 *
 * The primary band is a cosine — smooth, with no edge to read as a printed line. A slow
 * secondary wave bends the middle of the sweep so it does not read as a machine-straight
 * gradient. That bend is windowed by `sin(π · primary)`, which is zero at both ends of the
 * band, so the floor and the peak stay exactly where they are declared and the bend can
 * never take the ink outside the band: for a fixed secondary value the result is monotonic
 * in the primary, from 0 at p = 0 to 1 at p = 1.
 */
export function mirageSheenAt(u: number, waves = MIRAGE_WAVES): number {
  const w = u - Math.floor(u)
  const primary = 0.5 + 0.5 * Math.cos(TAU * w * waves)
  const bend = Math.sin(Math.PI * primary) * Math.cos(TAU * (w + 0.37))
  const t = primary + 0.12 * bend
  return MIRAGE_FLOOR + (MIRAGE_PEAK - MIRAGE_FLOOR) * t
}

/** Ink at one sheet pixel. Depends only on x: the sheen travels horizontally. */
export function mirageInkAt(x: number, y: number, size = MIRAGE_SHEET_SIZE): number {
  void y
  return mirageSheenAt(x / size)
}

export type MirageSheet = {
  size: number
  rgba: Uint8ClampedArray
  /** Every pixel carries ink: the foil is uniform, only its brightness varies. */
  coverage: number
  peak: number
  floor: number
  mean: number
}

export function renderMirageSheet(size = MIRAGE_SHEET_SIZE): MirageSheet {
  const rgba = new Uint8ClampedArray(size * size * 4)
  let peak = 0
  let floor = 1
  let sum = 0
  let marked = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ink = mirageInkAt(x, y, size)
      const p = (y * size + x) * 4
      rgba[p] = 255
      rgba[p + 1] = 255
      rgba[p + 2] = 255
      rgba[p + 3] = Math.round(ink * 255)
      if (ink > peak) peak = ink
      if (ink < floor) floor = ink
      if (ink >= MIRAGE_MARK_LINE) marked++
      sum += ink
    }
  }
  return { size, rgba, coverage: marked / (size * size), peak, floor, mean: sum / (size * size) }
}

/**
 * Discontinuity across the two edges that meet when the sheet wraps: the mean alpha step
 * over adjacent pixels either side of the seam.
 */
export function mirageSeamMismatch(rgba: Uint8ClampedArray | Uint8Array, size: number): number {
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
 * Mean alpha step between neighbouring columns inside the sheet: what one pixel of the
 * sweep's own slope costs. The wrap step must be no larger than this.
 */
export function mirageInternalStep(rgba: Uint8ClampedArray | Uint8Array, size: number): number {
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
