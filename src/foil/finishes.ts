// Generic foil finishes, on purpose.
//
// `printing-db.ts` answers "what paper is on THIS card?" with per-card evidence.
// That is the long-term record, and it is more than a pack needs: at pull time a
// booster only has to know that a card came out foil and which family of paper
// it wears. This module is that coarse vocabulary — plain, holo, reverse,
// cosmos, cracked ice and friends — with every finish pointing at the pattern
// the renderer already draws and the price key a pulled copy uses.
//
// The rules for using it:
//   - a finish is a FAMILY, not a printing. "Cosmos" here means the retro paper
//     a 2004 holo rare wears, not a claim about that card's exact sheet.
//   - the specific printing database still wins when something asks card by
//     card; this layer never contradicts it, it just speaks less precisely.
//   - a finish with no shipped texture is still listed, because a paper can be
//     identified before it is painted, and the renderer must be able to say so.

import { PATTERNS, type FoilPatternId } from './patterns'

export type FinishId =
  | 'plain'
  | 'holo'
  | 'reverse'
  | 'starlight'
  | 'cosmos'
  | 'tinsel'
  | 'mirror'
  | 'waterweb'
  | 'line'
  | 'mirage'
  | 'crackedice'
  | 'crosshatch'
  | 'confetti'
  | 'sequin'

export type FinishGroup = 'plain' | 'holo' | 'reverse'

/** The price variant a pulled copy of this finish is valued at. */
export type FinishPriceKey = 'normal' | 'holofoil' | 'reverseHolofoil'

export type Finish = {
  id: FinishId
  label: string
  group: FinishGroup
  /** The registered pattern this finish draws, when this build paints it. */
  pattern: FoilPatternId | null
  /** Same-origin sheet, read from the pattern registry so the two cannot drift. */
  sheet: string | null
  priceKey: FinishPriceKey
  note: string
}

const define = (
  id: FinishId,
  label: string,
  group: FinishGroup,
  pattern: FoilPatternId | null,
  priceKey: FinishPriceKey,
  note: string,
): Finish => ({
  id,
  label,
  group,
  pattern,
  sheet: pattern ? PATTERNS[pattern]?.texture ?? null : null,
  priceKey,
  note,
})

export const FINISHES: Record<FinishId, Finish> = {
  plain: define(
    'plain', 'Plain', 'plain', null, 'normal',
    'No foil at all. A non-holo card keeps its scan and nothing is drawn over it.',
  ),
  holo: define(
    'holo', 'Holo', 'holo', 'plain-holo', 'holofoil',
    'Foil with no printed pattern: the paper reflects as uniform light. This is the fallback for a holo whose paper no source names, and it is deliberately not a stand-in for Cosmos.',
  ),
  reverse: define(
    'reverse', 'Reverse holo', 'reverse', 'reverse-flat', 'reverseHolofoil',
    'The set’s reverse paper: foil around the illustration window rather than inside it. Stamped papers (Poké Ball, Master Ball, Energy) are reverse finishes too; their own variant tokens name the stamp.',
  ),
  starlight: define(
    'starlight', 'Starlight', 'holo', 'starlight', 'holofoil',
    'Four-point starbursts across the image — the 1999 paper for Base, Jungle and Fossil. The sheet here is a drawing, not a scan.',
  ),
  cosmos: define(
    'cosmos', 'Cosmos', 'holo', 'cosmos-retro', 'holofoil',
    'Printed orbs, speckle and small stars: the English holo paper from Base Set 2 (2000) to Call of Legends (2011). The retro sheet is the one used; the HD paper is a later promo variant of the same family.',
  ),
  tinsel: define(
    'tinsel', 'Tinsel', 'holo', 'tinsel', 'holofoil',
    'Horizontal stripes across the image — the Generation V paper (Black & White to Legendary Treasures). The stripe pitch is this build’s choice.',
  ),
  mirror: define(
    'mirror', 'Mirror / Sheen', 'holo', 'mirror', 'holofoil',
    'Smooth, mark-free foil refracting diagonally: the BW-era Mirror promos and the XY-onward Sheen paper, one finish here.',
  ),
  waterweb: define(
    'waterweb', 'Water Web', 'holo', 'waterweb', 'holofoil',
    'Wavy bands like flowing water — the Sun & Moon to Cosmic Eclipse paper. The wave geometry is drawn, not scanned.',
  ),
  line: define(
    'line', 'Line', 'holo', 'line', 'holofoil',
    'Thin vertical lines refracting down the image — the Sword & Shield to Crown Zenith paper. The pitch is this build’s choice.',
  ),
  mirage: define(
    'mirage', 'Mirage', 'holo', 'mirage', 'holofoil',
    'A smooth horizontal sheen: the Scarlet & Violet onward paper. The sweep is drawn from tilt footage; the silver border is not modelled.',
  ),
  crackedice: define(
    'crackedice', 'Cracked Ice', 'holo', 'crackedice', 'holofoil',
    'Shattered-glass facets with bright cracks — a promo and blister paper. Registered so a set can roll it; no set rolls it yet.',
  ),
  crosshatch: define(
    'crosshatch', 'Crosshatch', 'holo', 'crosshatch', 'holofoil',
    'A reflective lattice over the card body — the Play! Pokémon award paper. Registered; no set rolls it yet.',
  ),
  confetti: define(
    'confetti', 'Confetti', 'holo', 'confetti', 'holofoil',
    'Small blocky reflective chips — the McDonald’s and Celebrations Classic Collection paper. Registered for later assignment.',
  ),
  sequin: define(
    'sequin', 'Sequin', 'holo', 'sequin', 'holofoil',
    'Many small reflective polygons — the General Mills promo paper. Its own inventory variant (sequinHolofoil) already names it, so a sequin copy resolves to this finish.',
  ),
}

export const FINISH_IDS = Object.keys(FINISHES) as FinishId[]

export function finish(id: FinishId): Finish {
  return FINISHES[id]
}

export function isFoilFinish(id: FinishId): boolean {
  return FINISHES[id].group !== 'plain'
}

/** The stored variant token for a finish, used when a pull is priced. */
export function finishVariant(id: FinishId): FinishPriceKey {
  return FINISHES[id].priceKey
}

/**
 * Which generic finish a stored variant represents.
 *
 * Returns null for a token this build does not know, rather than guessing: a
 * variant nobody can name is not evidence that the card is plain.
 */
export function finishForVariant(variant?: string | null): FinishId | null {
  if (!variant) return null
  if (variant === 'normal' || variant === '1stEditionNormal') return 'plain'
  if (variant === 'holofoil' || variant === '1stEditionHolofoil') return 'holo'
  if (/^reverseHolofoil/i.test(variant)) return 'reverse'
  if (variant === 'sequinHolofoil') return 'sequin'
  return null
}
