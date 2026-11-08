// ---------------------------------------------------------------------------
// General Mills mini packs — the three cereal-box products the Sequin paper
// shipped in, as sealed products.
// ---------------------------------------------------------------------------
//
// What the sources say, and what this build has to model:
//
// - Sun & Moon Mini Packs (from 2017-08-22): "Each of these packs contained
//   three cards instead of the ten in regular booster packs" — two straight
//   reprints plus one Sequin Holofoil promo. The source names the Sequin cards
//   (SM01/02/03/04/06, SM40/42/86) and never names which reprints ride along,
//   so those two slots draw from the host expansion's own pool.
// - Let's Go, Kanto! Mini Packs (from 2019-01-15): "Each Let's Go, Kanto! Mini
//   Pack included three cards sourced from an early Sun & Moon Series
//   expansion—two of these were straight reprints, while the third featured a
//   Sequin Holofoil pattern." The Sequin slice is the five Kanto reprints the
//   Sequin table names for this product.
// - 25th Anniversary Mini Packs (from 2021-02-27): three cards, and the Sequin
//   Pikachu SWSH039 "was available in every General Mills 25th Anniversary Mini
//   Pack". The other two slots come from the promotion's own pool — the five
//   remaining Sequin SWSH promos and the eight named Sword & Shield reprints
//   (six swsh1 commons and two Rebel Clash uncommons, the latter absent from
//   this catalogue and recorded in `absent`).
//
// The pools are declared here rather than in `pack_product_cards`, because that
// table has no variant column: a Sequin card and the plain promo of the same
// number are different physical printings, and the pack must hand out the
// Sequin one. Keeping the composition in code keeps the two inseparable.
//
// Prices are this build's shelf price for a cereal promo that never had a
// retail one; it is the Sequin paper's own market band, not a sourced MSRP.
// Each is set from its own median rip so the shop's typical-return sticker lands
// in the 70–85% band (`tmp/gm-p50.ts` measures it over 20,000 draws): $3.02 /
// $2.51 / $14.73 medians against $3.99 / $3.29 / $19.99. The 25th pack's median
// steps up to $16.75 on some draws, so it is priced from the high side of that
// step — a flat cereal-box price made it a 169% return, i.e. a money printer.

import { SEQUIN_PRINTINGS, SEQUIN_PRODUCTS, SEQUIN_VARIANT } from '../../src/foil/printing-db'

export type MiniPoolEntry = {
  cardId: string
  variant: string
  /** Relative weight inside the slot's pool. */
  weight: number
}

export type MiniSlot = {
  slot: string
  count: number
  /** Cards the sources name for this slot. */
  entries: MiniPoolEntry[]
  /** Also draw from the host expansion's booster commons/uncommons. */
  hostFill?: boolean
}

export type MiniPackDef = {
  id: string
  /** The expansion the reprints are drawn from. */
  setId: string
  name: string
  /** Shelf price when no real sealed listing is stored. */
  msrp: number
  releaseDate: string
  description: string
  slots: MiniSlot[]
  /** Cards the promotion held that this catalogue cannot ship. */
  absent?: { cardId: string; why: string }[]
  source: string
}

const SOURCE_SM = 'https://bulbapedia.bulbagarden.net/wiki/Sun_%26_Moon_TCG_Series_merchandise'
const SOURCE_SWSH = 'https://bulbapedia.bulbagarden.net/wiki/Sword_%26_Shield_TCG_Series_merchandise'

/** The Sequin printings a product's own row of Bulbapedia's tables names. */
const sequinFor = (product: string): MiniPoolEntry[] =>
  SEQUIN_PRINTINGS.filter((p) => p.product === product).map((p) => ({
    cardId: p.cardId,
    variant: SEQUIN_VARIANT,
    weight: 1,
  }))

const SEQUIN_25 = sequinFor(SEQUIN_PRODUCTS.anniversary)
const PIKACHU_25 = 'swshp-SWSH039'

/** The eight Sword & Shield reprints the 25th-anniversary promotion names. */
const REPRINTS_25: { cardId: string; name: string }[] = [
  { cardId: 'swsh1-63', name: 'Snom' },
  { cardId: 'swsh1-73', name: 'Yamper' },
  { cardId: 'swsh1-89', name: 'Sinistea' },
  { cardId: 'swsh1-117', name: 'Galarian Zigzagoon' },
  { cardId: 'swsh1-127', name: 'Galarian Meowth' },
  { cardId: 'swsh1-136', name: 'Cufant' },
  { cardId: 'rcl-89', name: 'Dreepy' },
  { cardId: 'rcl-94', name: "Galarian Farfetch'd" },
]

export const MINI_PACKS: MiniPackDef[] = [
  {
    id: 'gm-sunmoon-mini',
    setId: 'sm1',
    name: 'General Mills Sun & Moon Mini Pack',
    msrp: 3.99,
    releaseDate: '2017-08-22',
    description:
      'Three cards from a cereal box: two Sun & Moon reprints and one Sequin Holofoil promo (SM01, 02, 03, 04, 06, 40, 42 or 86).',
    slots: [
      { slot: 'sequin', count: 1, entries: sequinFor(SEQUIN_PRODUCTS.sunMoon) },
      { slot: 'reprint', count: 2, entries: [], hostFill: true },
    ],
    source: SOURCE_SM,
  },
  {
    id: 'gm-letsgo-mini',
    setId: 'sm1',
    name: "General Mills Let's Go, Kanto! Mini Pack",
    msrp: 3.29,
    releaseDate: '2019-01-15',
    description:
      'Three cards: two early Sun & Moon reprints and one Sequin Holofoil Kanto reprint (Eevee, Charmander, Cubone, Bulbasaur or Pikachu).',
    slots: [
      { slot: 'sequin', count: 1, entries: sequinFor(SEQUIN_PRODUCTS.letsGo) },
      { slot: 'reprint', count: 2, entries: [], hostFill: true },
    ],
    source: SOURCE_SM,
  },
  {
    id: 'gm-25th-mini',
    setId: 'swsh1',
    name: 'General Mills 25th Anniversary Mini Pack',
    msrp: 19.99,
    releaseDate: '2021-02-27',
    description:
      'Three cards: the stamped Sequin Pikachu SWSH039 in every pack, plus two from the promotion’s other Sequin promos and named reprints.',
    slots: [
      {
        slot: 'pikachu',
        count: 1,
        entries: [{ cardId: PIKACHU_25, variant: SEQUIN_VARIANT, weight: 1 }],
      },
      {
        slot: 'extra',
        count: 2,
        entries: [
          ...SEQUIN_25.filter((e) => e.cardId !== PIKACHU_25),
          ...REPRINTS_25.filter((r) => r.cardId !== 'rcl-89' && r.cardId !== 'rcl-94').map((r) => ({
            cardId: r.cardId,
            variant: 'normal',
            weight: 1,
          })),
        ],
      },
    ],
    absent: [
      { cardId: 'rcl-89', why: 'Dreepy — Rebel Clash is not in this catalogue' },
      { cardId: 'rcl-94', why: "Galarian Farfetch'd — Rebel Clash is not in this catalogue" },
    ],
    source: SOURCE_SWSH,
  },
]

export function miniPackFor(productId: string): MiniPackDef | null {
  return MINI_PACKS.find((p) => p.id === productId) ?? null
}
