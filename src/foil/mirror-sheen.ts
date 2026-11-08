// The Mirror / Sheen finish, described as light rather than as marks.
//
// Bulbapedia's Holofoil page is the only description of this paper in reach:
//
//   "Sheen Holofoil is used for all Holo cards from XY, and on various
//    promotional cards. There are differences in the pattern depending on the
//    language of the card; Japanese Holofoil cards refract light in a diagonal
//    direction from bottom left to top right across the entire card; Korean
//    Holofoil cards have the same effect and direction, but only cover the image
//    of the Pokémon; and international releases have the same effect as Japanese
//    cards, but only cover the image, and the direction is from bottom right to
//    top left."
//
// Bulbapedia's Mega Evolution set page calls the same paper by its other name:
// it "reintroduces Mirror Holofoil variants of cards, last seen during the Black
// & White Series" — which is the treatment Pokumon records on nine BW Black Star
// Promos here. So one finish has two names: the BW cards are Mirror, the XY-and-
// later cards are Sheen, and this build names the pattern `mirror`.
//
// What the sentence gives is a DIRECTION, not a set of marks. There is no dot,
// star or stripe to draw: a mirror is a smooth surface, so the faithful texture is
// a uniform field modulated gently along the diagonal the source names. Three
// things in that sentence are this build's own and are disclosed wherever they are
// load-bearing rather than buried here:
//
//   - the CONTRAST and the pitch (how many bands cross the sheet) are ours: the
//     source names an orientation, not a contrast or a repeat;
//   - the DIRECTION is the international one, because this catalogue holds English
//     printings. A Japanese card would run the other way, and that axis is not
//     modelled;
//   - an angle-dependent glare is reproduced here as a fixed anisotropic ramp,
//     which is what a foil's own grain does and what a mark field can honestly be.
//
// The vocabulary stays narrow: every value is neutral luminance. The sheet cannot
// tint a card — hue belongs to iridescence alone.

export const MIRROR_DIRECTION = 'bottom right → top left (international printings)'

/**
 * Contrast floor. A mirror always reflects, so the field never goes dark — and the
 * floor stays high on purpose: a 0.30 trough would read as banding the print does
 * not have, while 0.55 is a soft sheen over foil that is otherwise continuous.
 */
export const MIRROR_FLOOR = 0.55
/** Peak of the sheen band. */
export const MIRROR_PEAK = 0.95
/** Bands across the sheet. The source names a direction, not a count. */
export const MIRROR_WAVES = 3

const TAU = Math.PI * 2

/**
 * Ink at a diagonal coordinate, 0..1 of the sheet along (x − y). Wrapped, so the
 * field continues across the sheet edge and a card may sample any window.
 *
 * The primary band is a cosine — smooth in both directions, with no edge to read
 * as a printed line. A slow second harmonic at low weight keeps the band from
 * looking like a machine-straight gradient; it is deliberately too weak to take
 * the ink below `MIRROR_FLOOR`.
 */
export function mirrorSheenAt(s: number, waves = MIRROR_WAVES): number {
  const w = s - Math.floor(s)
  const primary = 0.5 + 0.5 * Math.cos(TAU * (w * waves))
  const secondary = 0.5 + 0.5 * Math.cos(TAU * (w + 0.37))
  const t = 0.82 * primary + 0.18 * secondary
  return MIRROR_FLOOR + (MIRROR_PEAK - MIRROR_FLOOR) * t
}
