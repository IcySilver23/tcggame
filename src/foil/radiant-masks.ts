// Where the foil physically is on a Radiant Collection printing.
//
// The concept pack ships no masks at all — every README says the physical card
// has not been verified — so this module is where that research lives, kept out
// of the texture pipeline on purpose. A texture and a coverage mask are two
// different claims and must be able to fail independently.
//
// What the sources actually say (checked for this work):
//
//   - Legendary Treasures (2013, bw11): the RC cards are holo over the whole
//     card face, not just the illustration. Bulbapedia describes the subset as
//     having "a special coating and foil patterns"; an owner describing RC7 in
//     hand notes "there is only one version of this card in English, which is
//     holo on the entire card, and has holo Pikachu logos, hearts, lightning
//     bolts, and stars in the description".
//     https://bulbapedia.bulbagarden.net/wiki/Legendary_Treasures_(TCG)
//     https://www.elitefourum.com/t/legendary-treasures-regular-vs-reverse-holo-cards/58864
//
//   - Generations (2016, g1): the COMMONS are printed with no foil at all; the
//     uncommons and above are foil. This is the one hard rule the sources state
//     outright, and it is why thirteen g1 RC cards must not light up.
//     https://www.elitefourum.com/t/generations-radiant-collection-some-non-holo-radiant/14203
//     https://pullrates.com/set/generations
//
//   - Generations foam geometry (art window vs whole face) is NOT documented.
//     RC16 has a scan in this project showing the yellow frame outside the foil,
//     and RC6 has reference photographs showing an edge-to-edge sheet. Every
//     other Generations RC card is a guess between those two, so it is marked
//     unverified and the debug panel repeats that.
//
// The reverse-holo flag is deliberately ignored for RC cards: the subset was
// never printed reverse-holo, and marketplaces that mark RC rows "Reverse Holo"
// are using the flag loosely.

import type { FoilMaskKind } from './mask'

/** The only mask shapes an RC printing can resolve to. */
export type RadiantCoverageKind = Extract<FoilMaskKind, 'full' | 'art' | 'fullArt'>

export type RadiantCoverage = {
  kind: RadiantCoverageKind
  /** True only where a source describes this printing's actual foil area. */
  verified: boolean
  evidence: string
}

/** 'g1-RC6' → 'RC6'; 'base1-4' → '4'. */
function numberIn(cardId: string): string {
  const cut = cardId.lastIndexOf('-')
  return cut > 0 ? cardId.slice(cut + 1).toUpperCase() : ''
}

function setIdIn(cardId: string): string {
  const cut = cardId.lastIndexOf('-')
  return cut > 0 ? cardId.slice(0, cut) : ''
}

const FULL_BW11: RadiantCoverage = {
  kind: 'full',
  verified: true,
  evidence: 'bw11 RC: holo across the entire card face — Bulbapedia "special coating and foil patterns", plus an owner description of RC7 as "holo on the entire card".',
}

const UNVERIFIED_G1: RadiantCoverage = {
  kind: 'art',
  verified: false,
  evidence: 'g1 RC: holo is confirmed but the foil boundary is not documented. Modelled as the art window because RC16 is the only card in the group with a scan, and it shows a plain yellow frame.',
}

/**
 * Per-card overrides, where the evidence is better than the group rule. Card id
 * first, because a Collector number alone is ambiguous across the two sets.
 */
const OVERRIDES: Record<string, RadiantCoverage> = {
  'g1-RC6': {
    kind: 'full',
    verified: true,
    evidence: 'g1-RC6 reference photographs: foil sheet runs edge to edge under the text panel (same treatment as the full-art print).',
  },
  'g1-RC16': {
    kind: 'art',
    verified: true,
    evidence: 'g1-RC16 scan: foil confined to the illustration window inside the yellow frame.',
  },
}

/**
 * The coverage for a Radiant Collection card, or null when that printing has no
 * foil at all. Null is a real answer here: a Generations RC common is a plain
 * card, and drawing anything on it would be less accurate than drawing nothing.
 */
export function radiantCoverage(input: {
  cardId?: string | null
  rarity?: string | null
}): RadiantCoverage | null {
  const cardId = input.cardId
  if (!cardId) return null
  const number = numberIn(cardId)
  if (!number.startsWith('RC')) return null
  const setId = setIdIn(cardId)
  const rarity = input.rarity ?? ''

  // Generations RC commons are non-foil printings. This is the strongest single
  // statement the sources make, so it beats every geometry guess below.
  if (setId === 'g1' && /^common$/i.test(rarity)) return null

  const override = OVERRIDES[cardId]
  if (override) return override

  if (setId === 'bw11') return FULL_BW11

  // A Generations full-art RC card is foiled over the whole layout; the art is
  // the card. Still unverified as to its exact boundary.
  if (setId === 'g1' && /\bex\b|ultra|full art/i.test(rarity)) {
    return {
      kind: 'fullArt',
      verified: false,
      evidence: 'g1 RC full-art: modelled as a full-art foil field; the exact boundary is not documented for any of RC28–RC32.',
    }
  }

  return UNVERIFIED_G1
}
