// Ball stamps, and the one set that assigns them per card.
//
// Prismatic Evolutions and Black Bolt / White Flare print ONE ball paper each
// (plus a Master Ball upgrade), so their variant token alone decides the paper.
// Ascended Heroes does not work that way: every regular Pokémon carries one
// specific ball, printed for that card and shared with its evolution line. The
// table below is the whole assignment, keyed by collector number, and it is the
// authority for both the renderer (which pattern a card wears) and the game
// (which variant a pack stores).
//
// Sources: the PokeBeach set guide names the five ball papers and the Team
// Rocket "R" replacement; Ninth Pocket's checklist names the ball on each card
// row. The per-stamp counts those rows produce — 34 Poké Ball, 25 Love Ball,
// 23 Friend Ball, 22 Quick Ball, 26 Dusk Ball, 10 Team Rocket — are checked
// against the published breakdown in tmp/check-ascended-balls.ts, so a row that
// moves would fail rather than quietly repaint a card.
//
// Team Rocket's Pokémon replace the ball with an "R", so that stamp is not a
// ball and must never be modelled as one.

import type { FoilPatternId } from './patterns'

export const ASCENDED_SET_ID = 'me2pt5'
/** The main set: Pokémon 1–179, Trainers 180–215, Energy 216–217. */
export const ASCENDED_MAIN_SET_END = 179

export type SpecialStampId =
  | 'pokeball'
  | 'masterball'
  | 'loveball'
  | 'friendball'
  | 'quickball'
  | 'duskball'
  | 'teamrocket'

export type BallStamp = {
  label: string
  /** Explicit variant token; a plain reverse keeps the set's ordinary paper. */
  variant: string
  /** The one-large paper this stamp is drawn on. */
  pattern: FoilPatternId
  /** The mark drawn inside the ball (see scripts/reverse-special-foil.ts). */
  mark: 'none' | 'm' | 'heart' | 'flower' | 'bolt' | 'crescent' | 'r'
}

export const BALL_STAMPS: Record<SpecialStampId, BallStamp> = {
  // Ascended Heroes' Poké Ball is its own printing, not Prismatic's: the same
  // design, but a different set with its own measured geometry (see
  // ASCENDED_BALL_GEOMETRY), so it gets its own sheet.
  pokeball: {
    label: 'Poké Ball', variant: 'reverseHolofoilPokeBall',
    pattern: 'reverse-pokeball-assigned-large', mark: 'none',
  },
  masterball: {
    label: 'Master Ball', variant: 'reverseHolofoilMasterBall',
    pattern: 'reverse-masterball-large', mark: 'm',
  },
  loveball: {
    label: 'Love Ball', variant: 'reverseHolofoilLoveBall',
    pattern: 'reverse-loveball-large', mark: 'heart',
  },
  friendball: {
    label: 'Friend Ball', variant: 'reverseHolofoilFriendBall',
    pattern: 'reverse-friendball-large', mark: 'flower',
  },
  quickball: {
    label: 'Quick Ball', variant: 'reverseHolofoilQuickBall',
    pattern: 'reverse-quickball-large', mark: 'bolt',
  },
  duskball: {
    label: 'Dusk Ball', variant: 'reverseHolofoilDuskBall',
    pattern: 'reverse-duskball-large', mark: 'crescent',
  },
  teamrocket: {
    label: 'Team Rocket', variant: 'reverseHolofoilTeamRocket',
    pattern: 'reverse-teamrocket-large', mark: 'r',
  },
}

export const STAMP_IDS = Object.keys(BALL_STAMPS) as SpecialStampId[]

export const STAMP_VARIANTS = Object.fromEntries(
  STAMP_IDS.map((id) => [id, BALL_STAMPS[id].variant]),
) as Record<SpecialStampId, string>

/**
 * The Ascended Heroes assignment, as collector numbers. Read as data, not as a
 * rule: a number is here because a checklist row names its ball, and a number
 * absent from all six lists is a card with no assigned stamp (Trainers, Energy,
 * and the Pokémon ex that never received a reverse).
 */
const ASSIGNED_NUMBERS: Record<SpecialStampId, number[]> = {
  // Standard Poké Ball: the Gym Leader / Trainer's Pokémon lines, Mythical and
  // other Trainer-owned Pokémon that the set gives the default ball.
  pokeball: [
    1, 2, 4, 5, 6, 7, 23, 24, 32, 33, 49, 50, 51, 69, 71, 72, 95, 96, 109, 110,
    133, 136, 141, 143, 154, 155, 163, 168, 169, 170, 173, 174, 175, 177,
  ],
  // No Ascended Heroes card prints a Master Ball reverse; the column exists so
  // the stamp vocabulary is one union, and it stays empty on purpose.
  masterball: [],
  loveball: [
    11, 12, 13, 14, 15, 39, 40, 46, 74, 75, 80, 81, 82, 87, 88, 93, 94, 115,
    117, 140, 150, 151, 165, 166, 178,
  ],
  friendball: [
    8, 9, 16, 20, 21, 29, 30, 36, 37, 41, 42, 52, 53, 54, 55, 56, 83, 112,
    122, 153, 156, 157, 176,
  ],
  quickball: [
    17, 25, 27, 28, 34, 35, 59, 60, 62, 63, 64, 65, 66, 67, 103, 104, 134,
    146, 147, 148, 158, 159,
  ],
  duskball: [
    44, 45, 85, 86, 90, 91, 92, 98, 99, 102, 105, 106, 108, 118, 119, 120,
    123, 124, 128, 129, 130, 131, 132, 138, 144, 171,
  ],
  // Team Rocket's Pokémon: "R" in place of the ball, never a ball paper.
  teamrocket: [18, 19, 77, 78, 97, 100, 101, 126, 127, 161],
}

/** Collector number → stamp. One row per card; a duplicate would be a bug. */
export const ASCENDED_ASSIGNMENTS: ReadonlyMap<number, SpecialStampId> = new Map(
  (Object.keys(ASSIGNED_NUMBERS) as SpecialStampId[]).flatMap((stamp) =>
    ASSIGNED_NUMBERS[stamp].map((n) => [n, stamp] as const),
  ),
)

/** The published per-stamp breakdown this table has to reproduce. */
export const ASCENDED_PUBLISHED_COUNTS: Record<SpecialStampId, number> = {
  pokeball: 34,
  masterball: 0,
  loveball: 25,
  friendball: 23,
  quickball: 22,
  duskball: 26,
  teamrocket: 10,
}

export function assignedNumbers(stamp: SpecialStampId): readonly number[] {
  return ASSIGNED_NUMBERS[stamp]
}

/** The collector number inside a card id, or null when it is not Ascended Heroes. */
export function ascendedNumberFor(cardId: string | null | undefined): number | null {
  if (!cardId) return null
  const prefix = `${ASCENDED_SET_ID}-`
  if (!cardId.startsWith(prefix)) return null
  const raw = cardId.slice(prefix.length)
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return n > 0 && n <= ASCENDED_MAIN_SET_END ? n : null
}

/** The stamp this card was printed with, or null for a card with none. */
export function ascendedStampFor(cardId: string | null | undefined): SpecialStampId | null {
  const n = ascendedNumberFor(cardId)
  return n === null ? null : ASCENDED_ASSIGNMENTS.get(n) ?? null
}

/** The explicit variant token for this card's assigned paper, or null. */
export function ascendedVariantFor(cardId: string | null | undefined): string | null {
  const stamp = ascendedStampFor(cardId)
  return stamp ? BALL_STAMPS[stamp].variant : null
}

/** The pattern this card's assigned paper is drawn with, or null. */
export function ascendedPatternFor(cardId: string | null | undefined): FoilPatternId | null {
  const stamp = ascendedStampFor(cardId)
  return stamp ? BALL_STAMPS[stamp].pattern : null
}

/** The stamp an explicit variant token names, or null for an ordinary printing. */
export function stampForVariant(variant: string | null | undefined): SpecialStampId | null {
  const v = (variant ?? '').toLowerCase()
  if (!v) return null
  for (const id of STAMP_IDS) {
    if (v === BALL_STAMPS[id].variant.toLowerCase()) return id
  }
  return null
}

/**
 * The modern illustration window, measured from the Ascended Heroes scan. The
 * set's reverse papers — the Energy stamp and every assigned ball — foil the
 * body around this window, which ends higher than the base-set one.
 */
export const ASCENDED_ART_RECT = { x: 0.083, y: 0.094, w: 0.838, h: 0.375 } as const

/**
 * The one-large stamp's measured geometry on an Ascended Heroes paper, in card
 * fractions. Measured from a real Snorunt Poké Ball reverse photograph (the same
 * card the Energy paper was established from), by fitting the ball's ring on a
 * high-pass image: its outer ring is 0.434 of the card's width across, centred
 * about (0.50, 0.675) — the placement the Prismatic photo already gave, kept
 * because the two agree within the photo's error. The same photo puts the button
 * at about a third of the ring's radius, which is what the sheet draws.
 *
 * The four other assigned papers are the same print design, so they share this
 * geometry; only the mark inside the ball differs. The marks themselves are still
 * drawings — this photo is of a Poké Ball paper, which has none.
 */
export const ASCENDED_BALL_GEOMETRY = { diameter: 0.434, centerU: 0.5, centerV: 0.675 } as const

/**
 * The art window for an Ascended Heroes reverse paper, or null for a paper from
 * another set (those keep the shared base-set window).
 */
export function ascendedArtRectFor(
  pattern: FoilPatternId | null | undefined,
): { x: number; y: number; w: number; h: number } | null {
  if (!pattern) return null
  if (pattern === 'reverse-energy-large') return ASCENDED_ART_RECT
  return STAMP_IDS.some((id) => BALL_STAMPS[id].pattern === pattern) ? ASCENDED_ART_RECT : null
}

/** Every Ascended Heroes reverse-paper pattern, ball and Energy alike. */
export const ASCENDED_REVERSE_PATTERNS: FoilPatternId[] = [
  'reverse-energy-large',
  ...STAMP_IDS.map((id) => BALL_STAMPS[id].pattern),
]
