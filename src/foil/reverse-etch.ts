// The etched field on a modern ball reverse.
//
// The printed finish and the ball foil are two different layers. The ball is a
// reverse-holo stamp on the frame and text box; the fine crosshatched etch crosses
// the artwork and body as well. Drawing both through one coverage mask would either
// put the ball inside the picture (wrong) or lose the etch over it (also wrong).
//
// So this module owns only the etch's mask: full card, including the illustration.
// The ball keeps its `outsideArt` mask in reverse-special.ts. The engine applies
// the relief through this mask and the foil through the other, on one layer.
//
// The relief is the shipped fine etched lattice, reused as the nearest model. The
// printed etch is a photographed feature, but its exact spacing and depth are not
// measured here; `SPECIAL_REVERSE_TEXTURE_VERIFIED` stays false and this surface is
// disclosed as modelled.

import { CARD_RADIUS, type FoilMaskSpec } from './mask'
import { specialReverseFor } from './reverse-special'

/** The fine modern lattice is the closest shipped relief to the printed etch. */
export const SPECIAL_REVERSE_ETCH_SURFACE = 'etched' as const

/** Lighter than a full-art emboss: the etch reads as a faint field on the photos. */
export const SPECIAL_REVERSE_ETCH_STRENGTH = 0.32

/** True only for a set/ball printing that this build actually resolves. */
export function specialReverseEtchFor(
  setId: string | null | undefined,
  variant: string | null | undefined,
): boolean {
  return specialReverseFor(setId, variant) !== null
}

/**
 * The etch's coverage is the whole card silhouette, not the ball's foil mask.
 * The area is documented by the photographs; the relief drawn inside it is not.
 */
export function specialReverseEtchMaskFor(cardId: string | null): FoilMaskSpec {
  return {
    cardId,
    kind: 'full',
    rect: { x: 0, y: 0, w: 1, h: 1 },
    radius: CARD_RADIUS,
    verified: true,
    evidence: 'Prismatic ball reverse: the printed etched field crosses the artwork and body; the ball foil itself stays outside the artwork.',
  }
}