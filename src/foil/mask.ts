// Foil COVERAGE, and nothing else.
//
// This module answers exactly one question: where does holographic foil
// physically exist on this printing? It does not know about patterns, colours,
// reflection, texture or animation, and nothing here touches the card image.
//
// The mask is grayscale by definition:
//   0    no foil
//   255  foil
//   1-254  partial coverage (rounded corners, edge anti-aliasing)
//
// Geometry is expressed as fractions of the card box so a mask drawn at any
// resolution lands on the same place in the artwork.

import { holoFor, setIdOf } from '../holo'
import { radiantCoverage } from './radiant-masks'
import { printingFor } from './printing-db'
import { isSpecialReversePattern, specialReverseFor } from './reverse-special'
import { ascendedArtRectFor } from './ball-stamps'

export type FoilMaskKind = 'full' | 'art' | 'fullArt' | 'outsideArt' | 'border' | 'artBorder'

export type FoilRect = { x: number; y: number; w: number; h: number }

export type FoilMaskSpec = {
  cardId: string | null
  kind: FoilMaskKind
  /** Masked area, as fractions of the card box. */
  rect: FoilRect
  /** Corner radius, as a fraction of card width. */
  radius: number
  verified: boolean
  evidence: string
}

/**
 * Card layout geometry. These are the only numbers in the system that decide
 * where foil is allowed, and each one is checkable against a scan.
 */
const LAYOUT = {
  // Standard printing: the illustration sits in a window under the name bar,
  // above the attack text. Measured on the base1-4 scan.
  standardArt: { x: 0.081, y: 0.116, w: 0.838, h: 0.448 },
  // Full-art: illustration runs under a translucent text wash.
  fullArt: { x: 0.050, y: 0.032, w: 0.900, h: 0.775 },
  // Full bleed: printing runs to the card edge (RC EX cards, some promos).
  full: { x: 0, y: 0, w: 1, h: 1 },
} as const

export const CARD_RADIUS = 0.042
const RADIUS = CARD_RADIUS

export function foilMaskFor(input: {
  cardId?: string | null
  rarity?: string | null
  variant?: string | null
}): FoilMaskSpec | null {
  // Whether a card is foil at all is decided in one place, by printing.
  const holo = holoFor(input)
  if (!holo) return null

  const cardId = input.cardId ?? null
  const setId = setIdOf(cardId)
  const rarity = input.rarity ?? ''
  const variant = (input.variant ?? '').toLowerCase()
  const reverse = variant.includes('reverse')
  const number = setId && cardId ? cardId.slice(setId.length + 1).toUpperCase() : ''
  const base = { cardId, radius: RADIUS }

  // Radiant Collection: coverage is researched per printing, and one of the
  // answers is "no foil at all" — the Generations RC commons — so this branch is
  // allowed to return null. Note the reverse flag is not consulted at all: the
  // subset had no reverse printing (see radiant-masks.ts).
  if (number.startsWith('RC')) {
    const cov = radiantCoverage({ cardId, rarity })
    if (!cov) return null
    const rect = cov.kind === 'full' ? LAYOUT.full : cov.kind === 'fullArt' ? LAYOUT.fullArt : LAYOUT.standardArt
    return { ...base, kind: cov.kind, rect, verified: cov.verified, evidence: cov.evidence }
  }

  // A stamped reverse (a ball paper or the Ascended Heroes Energy paper) foils
  // the body around the set's own illustration window. This runs before the
  // printing database because that table's reverse row describes the set's
  // ORDINARY reverse paper, and Ascended Heroes' window sits higher than the
  // shared one — using it here would clip the stamp's lower edge.
  if (holo.pattern && isSpecialReversePattern(holo.pattern)) {
    const row = specialReverseFor(setId, input.variant)
    return {
      ...base, kind: 'outsideArt',
      rect: ascendedArtRectFor(holo.pattern) ?? row?.artRect ?? LAYOUT.standardArt,
      verified: true,
      evidence: 'Stamped reverse holo: foil covers the card body and text box, with the illustration window matte.',
    }
  }

  // The printing database decides coverage for every printing it knows, which
  // includes Cosmos holo rares, Pokémon-ex, LEGEND and the reverse papers. Its
  // mask is the researched area; its status says how well evidenced that is.
  const printing = printingFor({ cardId, rarity, variant })
  if (printing) {
    const kind: FoilMaskKind = printing.mask === 'art' ? 'art'
      : printing.mask === 'art-border' ? 'artBorder'
      : printing.mask === 'full' ? 'full'
      : printing.mask === 'outside-art' ? 'outsideArt'
      : 'fullArt'
    const rect = printing.artRect ?? (kind === 'full' ? LAYOUT.full : kind === 'fullArt' ? LAYOUT.fullArt : LAYOUT.standardArt)
    return { ...base, kind, rect, verified: printing.maskVerified, evidence: `${printing.printingId} — ${printing.note}` }
  }

  if (reverse) {
    return {
      ...base, kind: 'outsideArt', rect: LAYOUT.standardArt, verified: true,
      evidence: 'Reverse holo: foil covers the card except the illustration window.',
    }
  }

  if (/special illustration|illustration rare|full art|ultra rare/i.test(rarity)) {
    return {
      ...base, kind: 'fullArt', rect: LAYOUT.fullArt, verified: false,
      evidence: 'Full-art layout: illustration area foiled under the text wash. Geometry unverified for this print.',
    }
  }

  return {
    ...base, kind: 'art', rect: LAYOUT.standardArt, verified: true,
    evidence: 'Standard holo: foil confined to the illustration window.',
  }
}

/** Signed distance to a rounded rectangle, in the same units as its inputs. */
function sdRoundRect(px: number, py: number, w: number, h: number, r: number): number {
  const qx = Math.abs(px) - w + r
  const qy = Math.abs(py) - h + r
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r
}

/**
 * The card's silhouette: a rounded rectangle filling the card box. Foil is
 * applied to the card, so nothing outside this shape can be holo — the mask in
 * the reference sheet is a card shape for exactly this reason.
 */
function insideCard(u: number, v: number, aspect: number): boolean {
  return sdRoundRect((u - 0.5) * aspect, v - 0.5, aspect / 2, 0.5, RADIUS * aspect) <= 0
}

/** Area of the card silhouette as a fraction of the card box. */
export const CARD_AREA = 1 - (4 - Math.PI) * RADIUS * RADIUS

/**
 * Exact mask value at a normalized point, as 0 or 255 (no anti-aliasing — this
 * is the definition the tests check). 0 everywhere outside the card silhouette.
 */
export function maskValue(spec: FoilMaskSpec, u: number, v: number, aspect = 734 / 1024): number {
  if (!insideCard(u, v, aspect)) return 0
  const r = spec.rect
  const inW = (r.w * aspect) / 2
  const inH = r.h / 2
  const px = (u - (r.x + r.w / 2)) * aspect
  const py = v - (r.y + r.h / 2)
  const inside = sdRoundRect(px, py, inW, inH, spec.radius * aspect) <= 0
  switch (spec.kind) {
    case 'full':
      return 255
    case 'border': {
      const inset = 0.045
      const bx = (u - 0.5) * aspect
      const by = v - 0.5
      const border = sdRoundRect(bx, by, aspect / 2 - 0.001, 0.5 - 0.001, spec.radius * aspect) <= 0
      const inner = sdRoundRect(bx, by, (aspect / 2) * (1 - inset * 2), (0.5) * (1 - inset * 2), spec.radius * aspect) <= 0
      return border && !inner ? 255 : 0
    }
    case 'art':
      return inside ? 255 : 0
    case 'artBorder': {
      // Pokémon-ex: the illustration AND the border band; text panel matte.
      if (inside) return 255
      const inset = 0.045
      const bx = (u - 0.5) * aspect
      const by = v - 0.5
      const ring = sdRoundRect(bx, by, aspect / 2 - 0.001, 0.5 - 0.001, spec.radius * aspect) <= 0
      const inner = sdRoundRect(bx, by, (aspect / 2) * (1 - inset * 2), 0.5 * (1 - inset * 2), spec.radius * aspect) <= 0
      return ring && !inner ? 255 : 0
    }
    case 'fullArt':
      return inside ? 255 : 0
    case 'outsideArt':
      return inside ? 0 : 255
  }
}

/**
 * Draw the mask as pure black and white. Deliberately hard-edged: this view is
 * a diagnostic, so a half-covered pixel should be obvious rather than pretty.
 */
export function drawFoilMask(
  ctx: CanvasRenderingContext2D,
  spec: FoilMaskSpec | null,
  w: number,
  h: number,
): void {
  // Per-pixel, no anti-aliasing: the debug view is a diagnostic, so a pixel is
  // foil or it is not. maskValue is the single definition both the view and the
  // tests use, so they can never disagree.
  const img = ctx.createImageData(w, h)
  const aspect = w / h
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = spec ? maskValue(spec, (x + 0.5) / w, (y + 0.5) / h, aspect) : 0
      const i = (y * w + x) * 4
      img.data[i] = v
      img.data[i + 1] = v
      img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** How many mask pixels are white — a sanity number for the tests. */
export function coverageFraction(spec: FoilMaskSpec | null, aspect = 734 / 1024): number {
  if (!spec) return 0
  if (spec.kind === 'full') return CARD_AREA
  const r = spec.rect
  const area = r.w * r.h
  // artBorder = the window plus the border band (the card minus a 4.5% inset).
  if (spec.kind === 'artBorder') return area + CARD_AREA * (1 - (1 - 0.09) * (1 - 0.09))
  // The art window always sits inside the silhouette; the outside-art kinds
  // only get the card that exists.
  return spec.kind === 'outsideArt' ? CARD_AREA - area : area
}
