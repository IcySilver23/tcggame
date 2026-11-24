// Per-product evidence for modern sealed products.
//
// The generated sealed catalogue knows an era's *format* (a bundle is six
// packs, an ETB is nine, a display is thirty-six); it does not know which of
// those products actually shipped for a given set, which ETB promo was inside,
// or when a product was never printed at all. This table supplies that answer
// product by product, and the manifest/opener read it before falling back to the
// generated format.
//
// A row here is a claim about a physical product. `packs` is the wrapper count
// on the shelf; `promos` names the card(s) sealed in the box, never a synthetic
// pick from the era's promo set. `promoSet` is the catalogue set the opener may
// resolve a name against, and is omitted when the named promo is not catalogued.
//
// The standard Scarlet & Violet line is well documented: every set from sv1
// through sv10 uses 9-pack ETBs and 6-pack bundles, and the regular sets use
// 36-pack displays. Special sets keep the ETB but have no 36-pack display;
// six of them shipped a 6-pack bundle. Crown Zenith is the exception at 10
// packs per ETB. The per-set promo names below are the published ETB promos.

import { BUILD_BATTLE_BOXES } from './build-battle'
import { COLLECTIONS } from './collections'

export type EvidenceSource = {
  label: string
  url: string | null
}

/** Where a shelf quote came from, so a secondary source is never reported as TCGplayer. */
export type ShelfPriceSource = 'tcgplayer' | 'pricecharting' | 'pokeinvest'

export type SealedEvidence = {
  /** Physical packs in the product. */
  packs: number
  /** Physical cards in one wrapper; the game may deal a different count. */
  cardsPerPack?: number
  /** Named promo cards sealed in the box, in source order. */
  promos: string[]
  /** Exact catalogue ids for the named promos, in the same order, where known. */
  promoIds?: string[]
  /** Catalogue set to resolve a promo name against, when it is catalogued. */
  promoSet?: string
  /**
   * How the named promos relate to the box. 'one-of' (the default) means the
   * box held one of them; 'all' means every named promo is inside. It is stated
   * rather than inferred from the name count, because a blister and a UPC both
   * list two names and only the UPC puts both in the box.
   */
  promoPolicy?: 'one-of' | 'all'
  source: EvidenceSource
  note: string
}

const SV_MERCH: EvidenceSource = {
  label: 'Bulbapedia — Scarlet & Violet TCG Series merchandise',
  url: 'https://bulbapedia.bulbagarden.net/wiki/Scarlet_%26_Violet_TCG_Series_merchandise',
}

const SV_BLACK_WHITE: EvidenceSource = {
  label: 'Pokémon TCG — Black Bolt & White Flare expansions',
  url: 'https://tcg.pokemon.com/en-us/expansions/black-white/',
}

const CROWN_ZENITH: EvidenceSource = {
  label: 'Pokémon TCG — Crown Zenith Elite Trainer Box',
  url: 'https://www.pokemon.com/us/pokemon-tcg/product-gallery/crown-zenith-elite-trainer-box',
}

/** Standard sets whose 9-pack ETB, 6-pack bundle and 36-pack display shipped. */
const STANDARD_SETS = ['sv1', 'sv2', 'sv3', 'sv4', 'sv5', 'sv6', 'sv7', 'sv8', 'sv9', 'sv10'] as const

/**
 * Published ETB promos. A pair means the box held one of the two, so neither
 * name is individually guaranteed.
 */
const ETB_PROMOS: Record<string, string[]> = {
  sv1: ['Koraidon', 'Miraidon'],
  sv2: ['Pikachu'],
  sv3: ['Charmander'],
  sv3pt5: ['Snorlax'],
  sv4: ['Scream Tail', 'Iron Bundle'],
  sv4pt5: ['Mimikyu'],
  sv5: ['Flutter Mane', 'Iron Thorns'],
  sv6: ['Teal Mask Ogerpon'],
  sv6pt5: ['Pecharunt'],
  sv7: ['Noctowl'],
  sv8: ['Magneton'],
  sv8pt5: ['Eevee'],
  sv9: ["N's Zorua"],
  sv10: ["Team Rocket's Wobbuffet"],
  rsv10pt5: ['Tornadus'],
  zsv10pt5: ['Thundurus'],
}

/**
 * ETB promo numbers, so a name with several printings resolves to the box card.
 * Prismatic Evolutions is the case that matters here: Eevee also has SVP 043, but
 * the ETB promo is SVP 173. Black Bolt's box seals Thundurus (SVP 209) and White
 * Flare's seals Tornadus (SVP 210); upstream has not published those rows, so
 * catalog/promo-cards.ts seeds them and these ids point at them.
 */
const ETB_PROMO_IDS: Record<string, string[]> = {
  sv1: ['svp-14', 'svp-13'],
  sv2: ['svp-27'],
  sv3: ['svp-44'],
  sv3pt5: ['svp-51'],
  sv4: ['svp-65', 'svp-58'],
  sv4pt5: ['svp-75'],
  sv5: ['svp-97', 'svp-98'],
  sv6: ['svp-123'],
  sv6pt5: ['svp-129'],
  sv7: ['svp-141'],
  sv8: ['svp-153'],
  sv8pt5: ['svp-173'],
  sv9: ['svp-189'],
  sv10: ['svp-203'],
  rsv10pt5: ['svp-210'],
  zsv10pt5: ['svp-209'],
}

/** Special sets that actually shipped a six-pack Booster Bundle. */
export const SPECIAL_BUNDLE_SETS = new Set(['sv3pt5', 'sv4pt5', 'sv6pt5', 'sv8pt5', 'rsv10pt5', 'zsv10pt5', 'me2pt5'])

/** Special sets with an ETB and bundle but no 36-pack Booster Display. */
export const NO_DISPLAY_SETS = new Set(['me2pt5', 'me55'])

const evidence: Record<string, SealedEvidence> = {}

for (const setId of STANDARD_SETS) {
  evidence[`${setId}-bundle`] = {
    packs: 6,
    cardsPerPack: 10,
    promos: [],
    source: SV_MERCH,
    note: 'Standard Scarlet & Violet Booster Bundle: six packs, no promo.',
  }
  evidence[`${setId}-display`] = {
    packs: 36,
    cardsPerPack: 10,
    promos: [],
    source: SV_MERCH,
    note: 'Standard Scarlet & Violet Booster Display: thirty-six packs, no promo.',
  }
}

for (const setId of [...STANDARD_SETS, ...SPECIAL_BUNDLE_SETS]) {
  const promos = ETB_PROMOS[setId] ?? []
  evidence[`${setId}-etb`] = {
    packs: 9,
    cardsPerPack: 10,
    promos,
    promoIds: ETB_PROMO_IDS[setId],
    promoSet: 'svp',
    source: setId === 'rsv10pt5' || setId === 'zsv10pt5' ? SV_BLACK_WHITE : SV_MERCH,
    note: promos.length === 0
      ? 'Nine-pack Elite Trainer Box; no promo is documented here.'
      : promos.length === 1
        ? `Nine-pack Elite Trainer Box with the ${promos[0]} promo.`
        : `Nine-pack Elite Trainer Box; the box held either ${promos.join(' or ')}.`,
  }
}

for (const setId of SPECIAL_BUNDLE_SETS) {
  evidence[`${setId}-bundle`] = {
    packs: 6,
    cardsPerPack: 10,
    promos: [],
    source: setId === 'rsv10pt5' || setId === 'zsv10pt5' ? SV_BLACK_WHITE : SV_MERCH,
    note: 'Special-set Booster Bundle: six packs, no promo, and no 36-pack display.',
  }
}

evidence['swsh12pt5-etb'] = {
  packs: 10,
  cardsPerPack: 10,
  promos: ['Lucario VSTAR'],
  // SWSH291, the etched foil promo printed for this box. SWSH214 is a different
  // Lucario VSTAR promo and was being granted here by mistake.
  promoIds: ['swshp-SWSH291'],
  promoSet: 'swshp',
  source: CROWN_ZENITH,
  note: 'Crown Zenith Elite Trainer Box: ten packs and the Lucario VSTAR promo.',
}

// ---------------------------------------------------------------------------
// Sword & Shield Elite Trainer Boxes
// ---------------------------------------------------------------------------
//
// Eight packs, not nine. Bulbapedia's composition table gives 8 for the main
// expansions from Plasma Blast through Silver Tempest, and the Silver Tempest
// box's own product copy says "8 packs". The special expansions are the
// exception at ten, and both carried a promo: Champion's Path a full-art
// Charizard V (SWSH050), Shining Fates an Eevee VMAX (SWSH087). No main-line
// Sword & Shield box had one. Crown Zenith's ten-pack row above is the era's
// last set and keeps its own Lucario VSTAR.
const SWSH_ETB_SOURCE: EvidenceSource = {
  label: 'Bulbapedia — Elite Trainer Box (TCG); Pokémon TCG product pages',
  url: 'https://bulbapedia.bulbagarden.net/wiki/Elite_Trainer_Box_(TCG)',
}

const SWSH_ETB: Record<string, { packs: number; promos: string[]; promoIds?: string[] }> = {
  swsh1: { packs: 8, promos: [] },
  swsh2: { packs: 8, promos: [] },
  swsh3: { packs: 8, promos: [] },
  swsh4: { packs: 8, promos: [] },
  swsh5: { packs: 8, promos: [] },
  swsh6: { packs: 8, promos: [] },
  swsh7: { packs: 8, promos: [] },
  swsh8: { packs: 8, promos: [] },
  swsh9: { packs: 8, promos: [] },
  swsh10: { packs: 8, promos: [] },
  swsh11: { packs: 8, promos: [] },
  swsh12: { packs: 8, promos: [] },
  swsh35: { packs: 10, promos: ['Charizard V'], promoIds: ['swshp-SWSH050'] },
  swsh45: { packs: 10, promos: ['Eevee VMAX'], promoIds: ['swshp-SWSH087'] },
}

for (const [setId, info] of Object.entries(SWSH_ETB)) {
  evidence[`${setId}-etb`] = {
    packs: info.packs,
    cardsPerPack: 10,
    promos: info.promos,
    promoIds: info.promoIds,
    promoSet: info.promoIds ? 'swshp' : undefined,
    source: SWSH_ETB_SOURCE,
    note: info.promos.length === 0
      ? `${info.packs}-pack Elite Trainer Box, no promo.`
      : `${info.packs}-pack Elite Trainer Box with the ${info.promos[0]} promo.`,
  }
}

// ---------------------------------------------------------------------------
// Sun & Moon Elite Trainer Boxes
// ---------------------------------------------------------------------------
//
// Eight packs, not nine. Bulbapedia's composition table gives 8 for the main
// expansions from Plasma Blast through Silver Tempest, and the era's own product
// copy agrees (Sun & Moon, Ultra Prism and Lost Thunder each say eight). No
// main-line Sun & Moon box carried a promo. The three special expansions are
// the exception at ten, and each carried one: Shining Legends a Shining Ho-Oh
// (SM70), Dragon Majesty a Naganadel-GX (SM125) and Hidden Fates a Moltres &
// Zapdos & Articuno-GX (SM210). Detective Pikachu never had an ETB at all —
// its four-card packs came inside the Case Files and collections.
const SM_ETB_SOURCE: EvidenceSource = {
  label: 'Bulbapedia — Elite Trainer Box (TCG); Pokémon TCG product pages',
  url: 'https://bulbapedia.bulbagarden.net/wiki/Elite_Trainer_Box_(TCG)',
}

const SM_ETB: Record<
  string,
  { packs: number; promos: string[]; promoIds?: string[]; market: number; productId: number; note?: string }
> = {
  sm1: { packs: 8, promos: [], market: 248.05, productId: 126089, note: 'The box shipped as Solgaleo and Lunala versions; $248.05 is the Solgaleo quote and the Lunala box last traded at $246.84.' },
  sm2: { packs: 8, promos: [], market: 470.96, productId: 129890 },
  sm3: { packs: 8, promos: [], market: 346.28, productId: 133776 },
  sm4: { packs: 8, promos: [], market: 216.68, productId: 149377 },
  sm5: { packs: 8, promos: [], market: 780.99, productId: 155663, note: 'The box shipped as Dawn Wings and Dusk Mane Necrozma versions; $780.99 is the Dawn Wings quote and the Dusk Mane box last traded at $760.77.' },
  sm6: { packs: 8, promos: [], market: 689.62, productId: 164303 },
  sm7: { packs: 8, promos: [], market: 2091.3, productId: 170277 },
  sm8: { packs: 8, promos: [], market: 729.8, productId: 175511 },
  sm9: { packs: 8, promos: [], market: 4000, productId: 181704 },
  sm10: { packs: 8, promos: [], market: 1899.99, productId: 185719 },
  sm11: { packs: 8, promos: [], market: 1719.9, productId: 193052 },
  sm12: { packs: 8, promos: [], market: 1874.5, productId: 199308 },
  sm35: { packs: 10, promos: ['Shining Ho-Oh'], promoIds: ['smp-SM70'], market: 1199.66, productId: 145847 },
  sm75: {
    packs: 10,
    promos: ['Naganadel-GX'],
    promoIds: ['smp-SM125'],
    market: 1228.24,
    productId: 173393,
    note: 'TCGplayer’s product metadata says nine packs; Bulbapedia’s composition table and the published box copy both say ten, so ten is what this row opens.',
  },
  sm115: { packs: 10, promos: ['Moltres & Zapdos & Articuno-GX'], promoIds: ['smp-SM210'], market: 548.78, productId: 194729 },
}

for (const [setId, info] of Object.entries(SM_ETB)) {
  evidence[`${setId}-etb`] = {
    packs: info.packs,
    cardsPerPack: 10,
    promos: info.promos,
    promoIds: info.promoIds,
    promoSet: info.promoIds ? 'smp' : undefined,
    source: SM_ETB_SOURCE,
    note: `${info.promos.length === 0 ? `${info.packs}-pack Elite Trainer Box, no promo` : `${info.packs}-pack Elite Trainer Box with the ${info.promos[0]} promo`}. TCGplayer’s market for the exact box was $${info.market.toFixed(2)} on 8 November 2026.${info.note ? ` ${info.note}` : ''}`,
  }
}

/**
 * Real shelf quotes for the era's Elite Trainer Boxes, keyed by catalogue row.
 * They exist because a sticker price from 2017–2019 is not today's price: the
 * base set's box trades near $248 and Team Up's near $4,000. `productId` is the
 * TCGplayer listing the quote came from, which is also the box photo.
 */
export const ETB_SHELF: Readonly<Record<string, { market: number; productId: number }>> = Object.fromEntries(
  Object.entries(SM_ETB).map(([setId, info]) => [`${setId}-etb`, { market: info.market, productId: info.productId }]),
)

// ---------------------------------------------------------------------------
// XY Elite Trainer Boxes
// ---------------------------------------------------------------------------
// The XY ETB held eight packs, not the nine the generic era line assumed.
// Pokémon.com's own box copy says eight for XY, Primal Clash and BREAKthrough,
// and Bulbapedia's composition table gives eight across the era. No XY ETB
// carried a promo except Generations, whose ten-pack box added Shaymin-EX.
const XY_ETB_SOURCE: EvidenceSource = {
  label: 'Pokémon.com — XY Elite Trainer Box product pages; Bulbapedia',
  url: 'https://www.pokemon.com/us/pokemon-tcg/product-gallery/xy-elite-trainer-box',
}
const XY_PRIMAL_CLASH_SOURCE: EvidenceSource = {
  label: 'Pokémon.com — XY Primal Clash Elite Trainer Box',
  url: 'https://www.pokemon.com/us/pokemon-tcg/product-gallery/xy-primal-clash-elite-trainer-box',
}
const XY_BREAKTHROUGH_SOURCE: EvidenceSource = {
  label: 'Pokémon.com — XY BREAKthrough Elite Trainer Box',
  url: 'https://www.pokemon.com/us/pokemon-tcg/product-gallery/xy-breakthrough-elite-trainer-box',
}

export const XY_ETB_SHELF: Readonly<Record<string, { market: number; productId: number }>> = {
  'xy6-etb': { market: 7899.99, productId: 98028 },
  'xy9-etb': { market: 1099.99, productId: 111280 },
  'xy11-etb': { market: 1800, productId: 120697 },
}

// Six early Elite Trainer Boxes never received a TCGplayer market at all.
// PriceCharting prices each exact box from sold listings, so these are
// sold-based values rather than a model of the packs inside. They were read on
// 13 November 2026. The XY base set split its box across two arts, so those two
// quotes carry their own price fields in DUAL_ART_ETBS rather than sitting here.
const SECONDARY_ETB_AS_OF = '2026-11-13'
const SECONDARY_ETB_SHELF: Readonly<Record<string, { market: number; label: string; page: string }>> = {
  'bw8-etb': {
    market: 16225.09, label: 'Plasma Storm Elite Trainer Box',
    page: 'https://www.pricecharting.com/game/pokemon-plasma-storm/elite-trainer-box',
  },
  'bw10-etb': {
    market: 7193.29, label: 'Plasma Blast Elite Trainer Box',
    page: 'https://www.pricecharting.com/game/pokemon-plasma-blast/elite-trainer-box',
  },
  'xy3-etb': {
    market: 4750, label: 'Furious Fists Elite Trainer Box',
    page: 'https://www.pricecharting.com/game/pokemon-furious-fists/elite-trainer-box',
  },
  'xy4-etb': {
    market: 5873.07, label: 'Phantom Forces Elite Trainer Box',
    page: 'https://www.pricecharting.com/game/pokemon-phantom-forces/elite-trainer-box',
  },
  'xy7-etb': {
    market: 3751.45, label: 'Ancient Origins Elite Trainer Box',
    page: 'https://www.pricecharting.com/game/pokemon-ancient-origins/elite-trainer-box',
  },
  'xy10-etb': {
    market: 1149.24, label: 'Fates Collide Elite Trainer Box',
    page: 'https://www.pricecharting.com/game/pokemon-fates-collide/elite-trainer-box',
  },
}

// Every XY booster pack and the displays whose TCGplayer listing publishes a
// market price. The pack quotes were read through tcgcsv on 8 November 2026;
// the displays are listed again in BUNDLE_DISPLAY_SHELF with the 13 November
// reading. Displays that return a null market deliberately stay on the model
// rather than borrowing a price: XY base, Flashfire, Phantom Forces and
// BREAKpoint. A pack's quote is the collector market for one wrapper, not a
// retail sticker.
// Black & White booster packs with a published TCGplayer market, read through
// tcgcsv on 8 November 2026. Their displays all return a null market, so the
// 36-pack boxes stay modelled rather than borrowing a pack-derived price.
export const BW_BOOSTER_SHELF: Readonly<Record<string, { market: number; productId: number; product: string }>> = {
  'bw1-booster': { market: 187.99, productId: 98553, product: 'Black and White Booster Pack' },
  'bw2-booster': { market: 110, productId: 98549, product: 'Emerging Powers Booster Pack' },
  'bw3-booster': { market: 168.87, productId: 98570, product: 'Noble Victories Booster Pack' },
  'bw4-booster': { market: 383.04, productId: 98538, product: 'Next Destinies Booster Pack' },
  'bw5-booster': { market: 396.63, productId: 98521, product: 'Dark Explorers Booster Pack' },
  'bw8-booster': { market: 651.13, productId: 98526, product: 'Plasma Storm Booster Pack' },
  'bw9-booster': { market: 329.09, productId: 98517, product: 'Plasma Freeze Booster Pack' },
  'bw10-booster': { market: 275.45, productId: 98573, product: 'Plasma Blast Booster Pack' },
  'bw11-booster': { market: 392.43, productId: 98581, product: 'Legendary Treasures Booster Pack' },
}

export const XY_BOOSTER_SHELF: Readonly<Record<string, { market: number; productId: number; product: string }>> = {
  // Packs
  'xy1-booster': { market: 136.67, productId: 91602, product: 'XY Booster Pack' },
  'xy2-booster': { market: 160.96, productId: 91595, product: 'Flashfire Booster Pack' },
  'xy3-booster': { market: 81.36, productId: 92169, product: 'Furious Fists Booster Pack' },
  'xy4-booster': { market: 229.72, productId: 94622, product: 'XY Phantom Forces Booster Pack' },
  'xy5-booster': { market: 92.43, productId: 97751, product: 'XY Primal Clash Booster Pack' },
  'xy6-booster': { market: 87.16, productId: 129906, product: 'Roaring Skies Booster Pack' },
  'xy7-booster': { market: 150.7, productId: 100490, product: 'XY Ancient Origins Booster Pack' },
  'xy8-booster': { market: 66.54, productId: 107666, product: 'XY BREAKthrough Booster Pack' },
  'xy9-booster': { market: 51.35, productId: 111279, product: 'XY BREAKpoint Booster Pack' },
  'xy10-booster': { market: 45.8, productId: 168114, product: 'XY Fates Collide Booster Pack' },
  'xy11-booster': { market: 33.65, productId: 130013, product: 'Steam Siege Booster Pack' },
  'xy12-booster': { market: 71.48, productId: 129907, product: 'Evolutions Booster Pack' },
  // Displays with a published market; the five without one are not listed here.
  'xy3-display': { market: 4717.5, productId: 92168, product: 'Furious Fists Booster Box' },
  'xy6-display': { market: 4768.42, productId: 98026, product: 'XY Roaring Skies Booster Box' },
  'xy7-display': { market: 9807.99, productId: 100489, product: 'XY Ancient Origins Booster Box' },
  'xy8-display': { market: 3265.81, productId: 107101, product: 'XY BREAKthrough Booster Box' },
  'xy10-display': { market: 2754.99, productId: 117478, product: 'XY Fates Collide Booster Box' },
  'xy11-display': { market: 1436.99, productId: 120076, product: 'Steam Siege Booster Box' },
  'xy12-display': { market: 2707.61, productId: 123446, product: 'XY Evolutions Booster Box' },
}

// What a LOOSE wrapper of an out-of-print set actually costs. This is the
// honest per-pack reference a display has to be judged against: the pack model
// below prices an OOP wrapper off the cards it holds, which for a collector set
// is a fraction of what the wrapper trades for — Evolving Skies' model says
// $9.60 while a single sealed pack sells for $44.12. Comparing a real box quote
// to that model is what made the band say a $2,179 box was wrong.
//
// Read from TCGplayer's market for the exact single-pack listing on
// 22 November 2026, via Pitt PokeResearch's per-set pack tables. Only sets whose
// wrappers trade separately are here; a set with no loose-pack row keeps its
// modelled pack and gets no band (see capDisplayPerPack).
export const LOOSE_PACK_SHELF: Readonly<Record<string, { market: number; productId: number }>> = {
  'bw1-booster': { market: 187.99, productId: 98553 },
  'bw10-booster': { market: 273.56, productId: 98573 },
  'bw11-booster': { market: 392.43, productId: 98581 },
  'bw2-booster': { market: 121.38, productId: 98549 },
  'bw3-booster': { market: 168.71, productId: 98570 },
  'bw4-booster': { market: 383.04, productId: 98538 },
  'bw5-booster': { market: 396.63, productId: 98521 },
  'bw7-booster': { market: 246.11, productId: 98554 },
  'bw8-booster': { market: 720.9, productId: 98526 },
  'sm1-booster': { market: 21.63, productId: 129385 },
  'sm10-booster': { market: 67.77, productId: 185718 },
  'sm2-booster': { market: 37.95, productId: 129889 },
  'sm4-booster': { market: 19.75, productId: 146996 },
  'sm6-booster': { market: 52.12, productId: 164297 },
  'sm7-booster': { market: 73.89, productId: 170274 },
  'sm8-booster': { market: 55.13, productId: 175510 },
  'sm9-booster': { market: 325.17, productId: 181699 },
  'sv2-booster': { market: 14.86, productId: 493976 },
  'sv8-booster': { market: 9.03, productId: 565604 },
  'swsh11-booster': { market: 18.64, productId: 277325 },
  'swsh12-booster': { market: 14.68, productId: 283388 },
  'swsh7-booster': { market: 44.12, productId: 244337 },
  'xy1-booster': { market: 154.74, productId: 91602 },
  'xy10-booster': { market: 48.75, productId: 168114 },
  'xy12-booster': { market: 71.16, productId: 129907 },
  'xy2-booster': { market: 164.1, productId: 91595 },
  'xy3-booster': { market: 83.04, productId: 92169 },
  'xy5-booster': { market: 102.71, productId: 97751 },
  'xy6-booster': { market: 91.31, productId: 129906 },
  'xy7-booster': { market: 153.14, productId: 100490 },
}

// Booster bundles and 36-pack displays whose TCGplayer listing publishes a
// market price. The sealed catalogue had been modelling every one of these from
// the packs inside, so an in-print bundle and an out-of-print display could be
// priced off the same curve. Each quote below is the exact listing's market,
// read through the tcgcsv mirror on 13 November 2026. The older displays whose
// listings publish no market are deliberately absent and stay on the model.
export const BUNDLE_DISPLAY_SHELF: Readonly<Record<string, { market: number; productId: number; product: string }>> = {
  'me1-bundle': { market: 66.55, productId: 644362, product: 'Mega Evolution Booster Bundle' },
  'me1-display': { market: 300.72, productId: 644298, product: 'Mega Evolution Booster Box' },
  'me2-bundle': { market: 73.03, productId: 654160, product: 'Phantasmal Flames Booster Bundle' },
  'me2-display': { market: 382.39, productId: 654137, product: 'Phantasmal Flames Booster Box' },
  'me2pt5-bundle': { market: 77.91, productId: 668541, product: 'Ascended Heroes Booster Bundle' },
  'me3-bundle': { market: 37.93, productId: 672396, product: 'Perfect Order Booster Bundle' },
  'me3-display': { market: 171.85, productId: 672394, product: 'Perfect Order Booster Box' },
  'me4-bundle': { market: 37.09, productId: 684456, product: 'Chaos Rising Booster Bundle' },
  'me4-display': { market: 183.96, productId: 684444, product: 'Chaos Rising Booster Box' },
  'me5-bundle': { market: 37.78, productId: 692942, product: 'Pitch Black Booster Bundle' },
  'me5-display': { market: 173.83, productId: 692939, product: 'Pitch Black Booster Box' },
  'me6-bundle': { market: 38.1, productId: 712097, product: 'Delta Reign Booster Bundle' },
  'me6-display': { market: 187.23, productId: 712094, product: 'Delta Reign Booster Box' },
  'rsv10pt5-bundle': { market: 92.15, productId: 630696, product: 'White Flare Booster Bundle' },
  'sm10-display': { market: 2724.4, productId: 185717, product: 'Unbroken Bonds Booster Box' },
  'sm11-display': { market: 3376.76, productId: 191882, product: 'Unified Minds Booster Box' },
  'sm12-display': { market: 4216.67, productId: 199261, product: 'Cosmic Eclipse Booster Box' },
  'sm2-display': { market: 1881.33, productId: 129888, product: 'Guardians Rising Booster Box' },
  'sm3-display': { market: 1297.1, productId: 133773, product: 'Burning Shadows Booster Box' },
  'sm4-display': { market: 671.59, productId: 146995, product: 'Crimson Invasion Booster Box' },
  'sm5-display': { market: 1612.68, productId: 155661, product: 'Ultra Prism Booster Box' },
  'sm6-display': { market: 1649.98, productId: 164296, product: 'Forbidden Light Booster Box' },
  'sm7-display': { market: 2676.74, productId: 170273, product: 'Celestial Storm Booster Box' },
  'sm8-display': { market: 1629.37, productId: 175509, product: 'Lost Thunder Booster Box' },
  'sm9-display': { market: 12389.94, productId: 181698, product: 'Team Up Booster Box' },
  'sv1-bundle': { market: 102.96, productId: 478258, product: 'Scarlet & Violet Booster Bundle' },
  'sv1-display': { market: 298.51, productId: 476452, product: 'Scarlet & Violet Booster Box' },
  'sv10-bundle': { market: 64.57, productId: 625670, product: 'Destined Rivals Booster Bundle' },
  'sv10-display': { market: 380.24, productId: 624679, product: 'Destined Rivals Booster Box' },
  'sv2-bundle': { market: 123.74, productId: 496914, product: 'Paldea Evolved Booster Bundle' },
  'sv2-display': { market: 464.86, productId: 493975, product: 'Paldea Evolved Booster Box' },
  'sv3-bundle': { market: 122.47, productId: 501263, product: 'Obsidian Flames Booster Bundle' },
  'sv3-display': { market: 382.41, productId: 501257, product: 'Obsidian Flames Booster Box' },
  'sv3pt5-bundle': { market: 165.76, productId: 502000, product: '151 Booster Bundle' },
  'sv4-bundle': { market: 95.06, productId: 512820, product: 'Paradox Rift Booster Bundle' },
  'sv4-display': { market: 281.61, productId: 512821, product: 'Paradox Rift Booster Box' },
  'sv4pt5-bundle': { market: 167.68, productId: 528771, product: 'Paldean Fates Booster Bundle' },
  'sv5-bundle': { market: 87.38, productId: 541017, product: 'Temporal Forces Booster Bundle' },
  'sv5-display': { market: 323.98, productId: 536225, product: 'Temporal Forces Booster Box' },
  'sv6-bundle': { market: 77.14, productId: 543852, product: 'Twilight Masquerade Booster Bundle' },
  'sv6-display': { market: 334.53, productId: 543846, product: 'Twilight Masquerade Booster Box' },
  'sv6pt5-bundle': { market: 56.49, productId: 553031, product: 'Shrouded Fable Booster Bundle' },
  'sv7-bundle': { market: 68.3, productId: 557345, product: 'Stellar Crown Booster Bundle' },
  'sv7-display': { market: 310.99, productId: 557354, product: 'Stellar Crown Booster Box' },
  'sv8-bundle': { market: 69.48, productId: 565629, product: 'Surging Sparks Booster Bundle (LGS)' },
  'sv8-display': { market: 302.72, productId: 565606, product: 'Surging Sparks Booster Box' },
  'sv8pt5-bundle': { market: 73.87, productId: 600518, product: 'Prismatic Evolutions Booster Bundle' },
  'sv9-bundle': { market: 39.13, productId: 610953, product: 'Journey Together Booster Bundle' },
  'sv9-display': { market: 203.3, productId: 610931, product: 'Journey Together Booster Box' },
  'swsh1-display': { market: 692.76, productId: 206027, product: 'Sword & Shield Booster Box' },
  'swsh10-display': { market: 411.39, productId: 265519, product: 'Astral Radiance Booster Box' },
  'swsh11-bundle': { market: 199.06, productId: 278819, product: 'Lost Origin Booster Bundle' },
  'swsh11-display': { market: 732.8, productId: 277324, product: 'Lost Origin Booster Box' },
  'swsh12-bundle': { market: 113.2, productId: 283396, product: 'Silver Tempest Booster Bundle' },
  'swsh12-display': { market: 496.01, productId: 283389, product: 'Silver Tempest Booster Box' },
  'swsh12pt5-bundle': { market: 217.25, productId: 527562, product: 'Crown Zenith Booster Bundle' },
  'swsh2-display': { market: 483.32, productId: 210561, product: 'Rebel Clash Booster Box' },
  'swsh3-display': { market: 344.08, productId: 216853, product: 'Darkness Ablaze Booster Box' },
  'swsh4-display': { market: 320.23, productId: 221313, product: 'Vivid Voltage Booster Box' },
  'swsh5-display': { market: 290.84, productId: 229277, product: 'Battle Styles Booster Box' },
  'swsh6-display': { market: 463.77, productId: 236258, product: 'Chilling Reign Booster Box' },
  'swsh7-display': { market: 2190.2, productId: 242436, product: 'Evolving Skies Booster Box' },
  'swsh8-display': { market: 1007.74, productId: 247654, product: 'Fusion Strike Booster Box' },
  'swsh9-display': { market: 560.76, productId: 256141, product: 'Brilliant Stars Booster Box' },
  'xy10-display': { market: 2754.99, productId: 117478, product: 'XY Fates Collide Booster Box' },
  'xy11-display': { market: 1436.99, productId: 120076, product: 'Steam Siege Booster Box' },
  'xy12-display': { market: 2747.49, productId: 123446, product: 'XY Evolutions Booster Box' },
  'xy3-display': { market: 4717.5, productId: 92168, product: 'Furious Fists Booster Box' },
  'xy5-display': { market: 4066.66, productId: 97750, product: 'XY Primal Clash Booster Box' },
  'xy6-display': { market: 4768.42, productId: 98026, product: 'XY Roaring Skies Booster Box' },
  'xy7-display': { market: 9807.99, productId: 100489, product: 'XY Ancient Origins Booster Box' },
  'xy8-display': { market: 3265.81, productId: 107101, product: 'XY BREAKthrough Booster Box' },
  'zsv10pt5-bundle': { market: 96.71, productId: 630431, product: 'Black Bolt Booster Bundle' },
}

// Flashfire is deliberately absent: the early ETB line shipped one box every
// other expansion, and Bulbapedia names Flashfire (with Plasma Freeze and
// Legendary Treasures) as the sets it skipped. The catalogue still holds a
// hidden `xy2-etb` row so stock from an older save resolves, but no evidence
// row may claim that box existed.
const XY_ETB_SETS = ['xy1', 'xy3', 'xy4', 'xy5', 'xy6', 'xy7', 'xy8', 'xy9', 'xy10', 'xy11', 'xy12']
for (const setId of XY_ETB_SETS) {
  const quote = XY_ETB_SHELF[`${setId}-etb`]
  const secondary = SECONDARY_ETB_SHELF[`${setId}-etb`]
  evidence[`${setId}-etb`] = {
    packs: 8,
    cardsPerPack: 10,
    promos: [],
    source: XY_ETB_SOURCE,
    note: secondary
      ? `Eight-pack Elite Trainer Box. $${secondary.market.toFixed(2)} is PriceCharting's sold-based value for this box, read 13 November 2026. No promo is documented for this box.`
      : `Eight-pack Elite Trainer Box${quote ? `, $${quote.market.toFixed(2)} on TCGplayer on 8 November 2026` : ''}. No promo is documented for this box.`,
  }
}

// Detective Pikachu was never a normal booster set: its packs held four cards
// and were only sold inside Case Files and collections, so the pack row records
// the four-card wrapper it actually was.
const DETECTIVE_SOURCE: EvidenceSource = {
  label: 'Serebii — Detective Pikachu set; Pokémon Center product pages',
  url: 'https://www.serebii.net/card/pokemondetectivepikachu/',
}

evidence['det1-booster'] = {
  packs: 1,
  cardsPerPack: 4,
  promos: [],
  source: DETECTIVE_SOURCE,
  note: 'Detective Pikachu booster pack: four cards, sold inside the Case Files and collections rather than from a booster box.',
}

// ---------------------------------------------------------------------------
// Mega Evolution and 30th Celebration
// ---------------------------------------------------------------------------

const MEGA_SOURCE = (name: string, slug: string): EvidenceSource => ({
  label: `Pokémon TCG — ${name} expansion`,
  url: `https://tcg.pokemon.com/en-us/expansions/${slug}/`,
})

const LOCAL_RELEASE: EvidenceSource = {
  label: 'server/catalog/local-releases.json — published product copy',
  url: null,
}

const THIRTIETH: EvidenceSource = {
  label: 'Pokémon TCG — 30th Celebration product showcase',
  url: 'https://www.pokemon.com/us/news/pokemon-tcg-30th-celebration-product-showcase',
}

type MegaSet = {
  promos: string[]
  /** Exact catalogue ids for the named promos, where a source names the printing. */
  promoIds?: string[]
  promoSet?: string
  source: EvidenceSource
  cardsPerPack?: number
  bundle: boolean
  display: boolean
}

// The ETB promo numbers come from Bulbapedia's MEP Black Star Promos table,
// whose Promotion column files each card with the product that carried it:
// 009 Alakazam with the Mega Gardevoir box, 010 Riolu with the Mega Lucario box,
// 022 Charcadet with Phantasmal Flames, 070 Tyrunt with Perfect Order, 080
// Fennekin with Chaos Rising and 088 Zarude with Pitch Black. MEP 003 Alakazam
// is the Build & Battle Box printing, and MEP 059 Fennekin is a different
// promotion, so neither is the ETB card. Mega Evolution's box shipped in two
// versions, so its row lists both and the opener hands over one of them.
const MEGA_SETS: Record<string, MegaSet> = {
  me1: { promos: ['Riolu', 'Alakazam'], promoIds: ['mep-010', 'mep-009'], promoSet: 'mep', source: MEGA_SOURCE('Mega Evolution', 'mega-evolution'), bundle: true, display: true },
  me2: { promos: ['Charcadet'], promoIds: ['mep-022'], promoSet: 'mep', source: MEGA_SOURCE('Phantasmal Flames', 'phantasmal-flames'), bundle: true, display: true },
  me3: { promos: ['Tyrunt'], promoIds: ['mep-070'], promoSet: 'mep', source: MEGA_SOURCE('Perfect Order', 'perfect-order'), bundle: true, display: true },
  me4: { promos: ['Fennekin'], promoIds: ['mep-080'], promoSet: 'mep', source: MEGA_SOURCE('Chaos Rising', 'chaos-rising'), bundle: true, display: true },
  me5: { promos: ['Zarude'], promoIds: ['mep-088'], promoSet: 'mep', source: MEGA_SOURCE('Pitch Black', 'pitch-black'), bundle: true, display: true },
  me2pt5: { promos: ["N's Zekrom"], promoIds: ['mep-031'], promoSet: 'mep', source: MEGA_SOURCE('Ascended Heroes', 'ascended-heroes'), bundle: true, display: false },
  // Delta Reign's ETB promo is MEP 117 — the Kyogre illustration rare the
  // English set left out (Japanese Storm Emeralda 080's artwork), not the set's
  // own Kyogre 26/103. That one is the separate $15 store promo: a standard
  // frame with the anniversary logo, which is the wrong card to seal in a box.
  me6: { promos: ['Kyogre'], promoIds: ['mep-117'], promoSet: 'mep', source: LOCAL_RELEASE, bundle: true, display: true },
  me55: { promos: ['Nidorina'], promoIds: ['mep-101'], promoSet: 'mep', source: THIRTIETH, cardsPerPack: 6, bundle: true, display: false },
}

for (const [setId, info] of Object.entries(MEGA_SETS)) {
  const cardsPerPack = info.cardsPerPack ?? 10
  evidence[`${setId}-booster`] = {
    packs: 1,
    cardsPerPack,
    promos: [],
    source: info.source,
    note: `One booster wrapper holding ${cardsPerPack} cards; no promo.`,
  }
  if (info.bundle) {
    evidence[`${setId}-bundle`] = {
      packs: 6,
      cardsPerPack,
      promos: [],
      source: info.source,
      note: 'Six-pack Booster Bundle; no promo.',
    }
  }
  if (info.display) {
    evidence[`${setId}-display`] = {
      packs: 36,
      cardsPerPack,
      promos: [],
      source: info.source,
      note: 'Thirty-six-pack Booster Display; no promo.',
    }
  }
  evidence[`${setId}-etb`] = {
    packs: 9,
    cardsPerPack,
    promos: info.promos,
    promoIds: info.promoIds,
    promoSet: info.promoSet,
    source: info.source,
    note: info.promos.length === 1
      ? `Nine-pack Elite Trainer Box with the ${info.promos[0]} promo.`
      : `Nine-pack Elite Trainer Box; the box held either ${info.promos.join(' or ')}.`,
  }
}


// The regular Scarlet & Violet and Mega Evolution boxes also shipped in two
// arts. Unlike the one-of-two rows above, each art pins a single promo, so the
// base id keeps the first art and the twin gets its own evidence row.
evidence['sv1-etb'] = {
  packs: 9,
  cardsPerPack: 10,
  promos: ['Koraidon'],
  promoIds: ['svp-14'],
  promoSet: 'svp',
  source: SV_MERCH,
  note: 'Koraidon art. Nine-pack Elite Trainer Box with the Koraidon promo; the box shipped in Koraidon and Miraidon versions, and the art pins which promo is inside.',
}
evidence['sv1-etb-miraidon'] = {
  packs: 9,
  cardsPerPack: 10,
  promos: ['Miraidon'],
  promoIds: ['svp-13'],
  promoSet: 'svp',
  source: SV_MERCH,
  note: 'Miraidon art. Nine-pack Elite Trainer Box with the Miraidon promo; the box shipped in Koraidon and Miraidon versions, and the art pins which promo is inside.',
}
evidence['me1-etb'] = {
  packs: 9,
  cardsPerPack: 10,
  promos: ['Riolu'],
  promoIds: ['mep-010'],
  promoSet: 'mep',
  source: MEGA_SETS.me1.source,
  note: 'Mega Lucario art. Nine-pack Elite Trainer Box with the Riolu promo; the box shipped in Mega Lucario and Mega Gardevoir versions, and the art pins which promo is inside.',
}
evidence['me1-etb-gardevoir'] = {
  packs: 9,
  cardsPerPack: 10,
  promos: ['Alakazam'],
  promoIds: ['mep-009'],
  promoSet: 'mep',
  source: MEGA_SETS.me1.source,
  note: 'Mega Gardevoir art. Nine-pack Elite Trainer Box with the Alakazam promo; the box shipped in Mega Lucario and Mega Gardevoir versions, and the art pins which promo is inside.',
}

// 30th Celebration's collections are product-level claims from the published
// copy. The UPC holds thirty wrappers — 29 Celebration packs plus the separate
// three-card Classic Collection pack — and its promo pair differs by Day/Night.
const THIRTIETH_COLLECTIONS: Record<string, { packs: number; promos: string[]; promoIds?: string[]; promoPolicy?: 'one-of' | 'all'; note: string }> = {
  'me55-upc-day': {
    packs: 30,
    promos: ['Pikachu ex', 'Espeon ex'],
    promoIds: ['mep-107', 'mep-108'],
    promoPolicy: 'all',
    note: '29 Celebration packs plus one three-card Classic Collection pack. The box deals the Celebration packs first and the Classic Collection wrapper last, three reprints, all from the subset.',
  },
  'me55-upc-night': {
    packs: 30,
    promos: ['Pikachu ex', 'Umbreon ex'],
    promoIds: ['mep-109', 'mep-110'],
    promoPolicy: 'all',
    note: '29 Celebration packs plus one three-card Classic Collection pack. The box deals the Celebration packs first and the Classic Collection wrapper last, three reprints, all from the subset.',
  },
  'me55-ditto-premium': {
    packs: 8,
    promos: ['Ditto'],
    promoIds: ['mep-106'],
    note: 'Eight Celebration packs, a Ditto promo and an acrylic card display.',
  },
  'me55-figure-mew': {
    packs: 5,
    promos: ['Mew'],
    promoIds: ['mep-105'],
    note: 'Five Celebration packs, a Mew foil promo and oversize card, and a sculpted figure.',
  },
  'me55-figure-mewtwo': {
    packs: 5,
    promos: ['Mewtwo'],
    promoIds: ['mep-104'],
    note: 'Five Celebration packs, a Mewtwo foil promo and oversize card, and a sculpted figure.',
  },
}

for (const [id, info] of Object.entries(THIRTIETH_COLLECTIONS)) {
  evidence[id] = {
    packs: info.packs,
    cardsPerPack: 6,
    promos: info.promos,
    promoIds: info.promoIds,
    promoPolicy: info.promoPolicy,
    promoSet: info.promoIds ? 'mep' : undefined,
    source: LOCAL_RELEASE,
    note: info.note,
  }
}

// One wrapper, no promo, for every modern booster row that is actually sold.
const BOOSTER_SETS = [...STANDARD_SETS, ...SPECIAL_BUNDLE_SETS, 'swsh12pt5']
for (const setId of BOOSTER_SETS) {
  if (setId === 'me2pt5') continue
  evidence[`${setId}-booster`] = {
    packs: 1,
    cardsPerPack: 10,
    promos: [],
    source: setId === 'rsv10pt5' || setId === 'zsv10pt5'
      ? SV_BLACK_WHITE
      : setId === 'swsh12pt5'
        ? CROWN_ZENITH
        : SV_MERCH,
    note: 'One ten-card booster wrapper; no promo is part of the product.',
  }
}

export type SpecialProductRow = {
  id: string
  setId: string
  name: string
  msrp: number
  packs: number
  cardsPerPack: number
  /**
   * The physical format this row is. Everything here is 'special' (a collection,
   * tin or box) except the display variants: the Enhanced Booster Display is a
   * 36-pack display and the half displays are 18-pack ones, so they must keep
   * the display kind for battle and catalogue maths to read them correctly.
   */
  kind?: 'special' | 'display' | 'etb' | 'bundle'
  releaseDate: string
  description: string
  promos: string[]
  promoSet?: string
  promoIds?: string[]
  /** 'all' when the box holds every named promo; 'one-of' (default) otherwise. */
  promoPolicy?: 'one-of' | 'all'
  /**
   * A real marketplace quote for the product itself, where a source publishes
   * one. `priceDetail` uses it in place of the modelled shelf price.
   */
  shelf?: { market: number; source: EvidenceSource; asOf: string; kind?: ShelfPriceSource }
  /**
   * Real box art. These rows are not the set's generic wrapper, so the tcgcsv
   * image matcher never picks them and the shop would draw the set symbol.
   */
  image?: string
  source: EvidenceSource
  note: string
}

const THIRTIETH_POSTER: EvidenceSource = {
  label: 'Pokémon TCG — 30th Celebration Poster Collection',
  url: 'https://www.pokemon.com/us/pokemon-tcg/product-gallery/30th-celebration-poster-collection',
}
const THIRTIETH_TECH: EvidenceSource = {
  label: 'Pokémon TCG — 30th Celebration Tech Sticker Collection',
  url: 'https://www.pokemon.com/us/pokemon-tcg/product-gallery/30th-celebration-tech-sticker-collection',
}
const THIRTIETH_BINDER: EvidenceSource = {
  label: 'Pokémon TCG — 30th Celebration Binder Collection',
  url: 'https://www.pokemon.com/us/pokemon-tcg/product-gallery/30th-celebration-binder-collection',
}
const THIRTIETH_TIN: EvidenceSource = {
  label: 'Pokémon TCG — 30th Celebration Mini Tin',
  url: 'https://www.pokemon.com/us/pokemon-tcg/product-gallery/30th-celebration-mini-tin',
}
const SVP_BLISTERS: EvidenceSource = {
  label: 'Bulbapedia — SVP Black Star Promos (blister promotions)',
  url: 'https://bulbapedia.bulbagarden.net/wiki/SVP_Black_Star_Promos_(TCG)',
}
const MEP_BLISTERS: EvidenceSource = {
  label: 'Bulbapedia — MEP Black Star Promos (blister promotions)',
  url: 'https://bulbapedia.bulbagarden.net/wiki/MEP_Black_Star_Promos_(TCG)',
}
/** A TCGplayer market quote for the sealed product itself, read through tcgcsv. */
const TCGPLAYER_SHELF = (label: string, productId: number): EvidenceSource => ({
  label: `TCGplayer — ${label} (market, via the tcgcsv mirror)`,
  url: `https://www.tcgplayer.com/product/${productId}`,
})
const POKEINVEST_SHELF = (label: string, url: string): EvidenceSource => ({
  label: `PokeInvest — ${label} (sealed-sale value)`,
  url,
})
const PRICECHARTING_SHELF = (label: string, url: string): EvidenceSource => ({
  label: `PriceCharting — ${label} (sold-price value)`,
  url,
})
const PRISMATIC_BLISTER: EvidenceSource = {
  label: 'Bulbapedia — Eevee (Pokémon Day 2025 Cosmos Parallel Holofoil)',
  url: 'https://bulbapedia.bulbagarden.net/wiki/Eevee_(SVP_Promo_173)',
}
const ASCENDED_BLISTER: EvidenceSource = {
  label: 'Pokémon TCG — Mega Evolution Ascended Heroes Collection—Erika / Larry (product copy)',
  url: 'https://www.midwestcards.com/pokemon-non-sports-cards/pokemon-mega-evolution-ascended-heroes-2-pack-blister',
}
const THIRTIETH_BLISTER: EvidenceSource = {
  label: "Bill's Archive — 30th Celebration English products (2-Pack Blister)",
  url: 'https://billsarchive.com/30th-celebration.html',
}
const THIRTIETH_KNOCKOUT: EvidenceSource = {
  label: 'Bulbapedia — Pokémon 30th Anniversary (card 116/128 [Cosmos Holofoil])',
  url: 'https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_30th_Anniversary',
}
const THIRTIETH_SHOWCASE: EvidenceSource = {
  label: 'Pokémon TCG — 30th Celebration product showcase',
  url: 'https://www.pokemon.com/us/news/pokemon-tcg-30th-celebration-product-showcase',
}
const ASCENDED_TECH: EvidenceSource = {
  label: 'Pokémon TCG — Ascended Heroes Tech Sticker Collection',
  url: 'https://www.pokemon.com/us/pokemon-tcg/product-gallery/mega-evolution-ascended-heroes-tech-sticker-collection',
}
const ASCENDED_TIN: EvidenceSource = {
  label: 'Pokémon TCG — Ascended Heroes Mini Tin',
  url: 'https://www.pokemon.com/us/pokemon-tcg/product-gallery/mega-evolution-ascended-heroes-mini-tin',
}
const ASCENDED_POSTER: EvidenceSource = {
  label: 'Pokémon TCG — Ascended Heroes Premium Poster Collection',
  url: 'https://www.pokemon.com/us/pokemon-tcg/product-gallery/mega-evolution-ascended-heroes-premium-poster-collection-mega-lucario-mega-evolution-ascended-heroes-premium-poster-collection-mega-gardevoir',
}
const ASCENDED_SHOWCASE: EvidenceSource = {
  label: 'Pokémon TCG — Ascended Heroes product showcase',
  url: 'https://www.pokemon.com/us/news/pokemon-tcg-mega-evolution-ascended-heroes-product-showcase',
}
const JOURNEY_TOGETHER_MERCH: EvidenceSource = {
  label: 'Bulbapedia — Journey Together (Enhanced Booster Display Box)',
  url: 'https://bulbapedia.bulbagarden.net/wiki/Journey_Together_(TCG)',
}

/**
 * Regular Elite Trainer Boxes that shipped in two arts. TCGplayer lists each
 * art as its own product, and the art is what separates two boxes on a shelf,
 * so each is its own SKU here. The original `-etb` id keeps the first art,
 * because that is what stock already held in a save belongs to. A box's promo
 * is named only where the art pins it; the eras whose product copy says "one of
 * two" keep both cards in the evidence rather than inventing a pairing.
 */
export type DualArtEtbBox = {
  id: string
  art: string
  /** Null when no source publishes a market price for this art. */
  market: number | null
  /** TCGplayer's listing id, which also supplies the box photo. */
  productId: number
  promo?: string
  promoId?: string
  /** Catalogue set for the promo id, when it is not an SVP promo. */
  promoSet?: string
  /** Full, sourced contents list for a box whose evidence is stronger than the era rule. */
  contents?: string
  /** The official product page the contents came from. */
  contentsSource?: EvidenceSource
  /** A price source other than the TCGplayer listing (PokeInvest, PriceCharting). */
  priceSource?: EvidenceSource
  priceKind?: ShelfPriceSource
  /** How the quote is described in the product note. */
  priceLabel?: string
  /** The day the secondary quote was read; defaults to the TCGplayer reading. */
  priceAsOf?: string
}

export const DUAL_ART_ETBS: Readonly<Record<string, {
  name: string
  packs: number
  msrp: number
  releaseDate: string
  boxes: DualArtEtbBox[]
}>> = {
  sm1: {
    name: 'Sun & Moon', packs: 8, msrp: 39.99, releaseDate: '2017/02/03',
    boxes: [
      { id: 'sm1-etb', art: 'Solgaleo', market: 248.05, productId: 126089 },
      { id: 'sm1-etb-lunala', art: 'Lunala', market: 246.84, productId: 126091 },
    ],
  },
  sm5: {
    name: 'Ultra Prism', packs: 8, msrp: 39.99, releaseDate: '2018/02/02',
    boxes: [
      { id: 'sm5-etb', art: 'Dawn Wings Necrozma', market: 780.99, productId: 155663 },
      { id: 'sm5-etb-dusk-mane', art: 'Dusk Mane Necrozma', market: 760.77, productId: 155664 },
    ],
  },
  swsh1: {
    name: 'Sword & Shield', packs: 8, msrp: 54.99, releaseDate: '2020/02/07',
    boxes: [
      { id: 'swsh1-etb', art: 'Zacian', market: 179.88, productId: 206038 },
      { id: 'swsh1-etb-zamazenta', art: 'Zamazenta', market: 173.07, productId: 206039 },
    ],
  },
  swsh5: {
    name: 'Battle Styles', packs: 8, msrp: 54.99, releaseDate: '2021/03/19',
    boxes: [
      { id: 'swsh5-etb', art: 'Single Strike Urshifu', market: 132.77, productId: 229284 },
      { id: 'swsh5-etb-rapid-strike', art: 'Rapid Strike Urshifu', market: 127.54, productId: 229285 },
    ],
  },
  swsh6: {
    name: 'Chilling Reign', packs: 8, msrp: 54.99, releaseDate: '2021/06/18',
    boxes: [
      { id: 'swsh6-etb', art: 'Ice Rider Calyrex', market: 143.42, productId: 236260 },
      { id: 'swsh6-etb-shadow-rider', art: 'Shadow Rider Calyrex', market: 148.6, productId: 236261 },
    ],
  },
  swsh7: {
    name: 'Evolving Skies', packs: 8, msrp: 54.99, releaseDate: '2021/08/27',
    boxes: [
      { id: 'swsh7-etb', art: 'Flareon, Jolteon, Umbreon, Leafeon', market: 546.57, productId: 242434 },
      { id: 'swsh7-etb-glaceon', art: 'Glaceon, Vaporeon, Sylveon, Espeon', market: 456.06, productId: 242443 },
    ],
  },
  sv1: {
    name: 'Scarlet & Violet', packs: 9, msrp: 54.99, releaseDate: '2023/03/31',
    boxes: [
      { id: 'sv1-etb', art: 'Koraidon', market: 131.73, productId: 478335, promo: 'Koraidon', promoId: 'svp-14' },
      { id: 'sv1-etb-miraidon', art: 'Miraidon', market: 144.8, productId: 478336, promo: 'Miraidon', promoId: 'svp-13' },
    ],
  },
  sv4: {
    name: 'Paradox Rift', packs: 9, msrp: 54.99, releaseDate: '2023/11/03',
    boxes: [
      { id: 'sv4-etb', art: 'Iron Valiant', market: 135.65, productId: 512813, promo: 'Iron Bundle', promoId: 'svp-58' },
      { id: 'sv4-etb-roaring-moon', art: 'Roaring Moon', market: 133.84, productId: 512815, promo: 'Scream Tail', promoId: 'svp-65' },
    ],
  },
  sv5: {
    name: 'Temporal Forces', packs: 9, msrp: 54.99, releaseDate: '2024/03/22',
    boxes: [
      { id: 'sv5-etb', art: 'Walking Wake', market: 145.45, productId: 532845, promo: 'Flutter Mane', promoId: 'svp-97' },
      { id: 'sv5-etb-iron-leaves', art: 'Iron Leaves', market: 126.82, productId: 532848, promo: 'Iron Thorns', promoId: 'svp-98' },
    ],
  },
  me1: {
    name: 'Mega Evolution', packs: 9, msrp: 54.99, releaseDate: '2025/09/26',
    boxes: [
      { id: 'me1-etb', art: 'Mega Lucario', market: 114.85, productId: 648394, promo: 'Riolu', promoId: 'mep-010', promoSet: 'mep' },
      { id: 'me1-etb-gardevoir', art: 'Mega Gardevoir', market: 112.42, productId: 644279, promo: 'Alakazam', promoId: 'mep-009', promoSet: 'mep' },
    ],
  },
  xy1: {
    name: 'XY', packs: 8, msrp: 39.99, releaseDate: '2014/02/05',
    boxes: [
      {
        id: 'xy1-etb', art: 'Xerneas', market: 4320.61, productId: 97747,
        priceSource: PRICECHARTING_SHELF('XY Elite Trainer Box: Xerneas', 'https://www.pricecharting.com/game/pokemon-xy/elite-trainer-box-xerneas'),
        priceKind: 'pricecharting',
        priceLabel: "PriceCharting's sold-based value for this exact art, read 13 November 2026",
        priceAsOf: '2026-11-13',
      },
      {
        id: 'xy1-etb-yveltal', art: 'Yveltal', market: 4558.22, productId: 97748,
        priceSource: PRICECHARTING_SHELF('XY Elite Trainer Box: Yveltal', 'https://www.pricecharting.com/game/pokemon-xy/elite-trainer-box-yveltal'),
        priceKind: 'pricecharting',
        priceLabel: "PriceCharting's sold-based value for this exact art, read 13 November 2026",
        priceAsOf: '2026-11-13',
      },
    ],
  },
  xy5: {
    name: 'Primal Clash', packs: 8, msrp: 39.99, releaseDate: '2015/02/04',
    boxes: [
      {
        id: 'xy5-etb', art: 'Primal Groudon', market: 7168.38, productId: 97762,
        contents: "Primal Groudon art: eight Primal Clash packs; 65 sleeves featuring Primal Groudon-EX; 45 Energy cards; the Primal Clash player's guide; six damage-counter dice; one coin-flip die; two acrylic condition markers; a collector's box with four dividers; and a TCGO code card. No promo card.",
        contentsSource: XY_PRIMAL_CLASH_SOURCE,
        priceSource: POKEINVEST_SHELF('Primal Clash Elite Trainer Box [Groudon]', 'https://www.pokeinvest.io/sealed/primal-clash'),
        priceKind: 'pokeinvest',
        priceLabel: "PokeInvest's sealed-sale value for this exact art on 8 November 2026",
      },
      {
        id: 'xy5-etb-kyogre', art: 'Primal Kyogre', market: 7500, productId: 97763,
        contents: "Primal Kyogre art: eight Primal Clash packs; 65 sleeves featuring Primal Kyogre-EX; 45 Energy cards; the Primal Clash player's guide; six damage-counter dice; one coin-flip die; two acrylic condition markers; a collector's box with four dividers; and a TCGO code card. No promo card.",
        contentsSource: XY_PRIMAL_CLASH_SOURCE,
        priceSource: POKEINVEST_SHELF('Primal Clash Elite Trainer Box [Kyogre]', 'https://www.pokeinvest.io/sealed/primal-clash'),
        priceKind: 'pokeinvest',
        priceLabel: "PokeInvest's sealed-sale value for this exact art on 8 November 2026",
      },
    ],
  },
  xy8: {
    name: 'BREAKthrough', packs: 8, msrp: 39.99, releaseDate: '2015/11/04',
    boxes: [
      {
        id: 'xy8-etb', art: 'Mewtwo X', market: 1598.41, productId: 107106,
        contents: "Mega Mewtwo X art: eight BREAKthrough packs; 65 sleeves featuring Mega Mewtwo X; 45 Energy cards; the BREAKthrough player's guide; six damage-counter dice; one coin-flip die; two acrylic condition markers; a collector's box with four dividers; and a TCGO code card. No promo card.",
        contentsSource: XY_BREAKTHROUGH_SOURCE,
        priceSource: PRICECHARTING_SHELF('BREAKthrough Elite Trainer Box: Mewtwo X', 'https://www.pricecharting.com/game/pokemon-breakthrough/elite-trainer-box-mewtwo-x'),
        priceKind: 'pricecharting',
        priceLabel: "PriceCharting's sold-based value for this exact art; its last sale was $1,600.00 on 31 October 2026",
      },
      {
        id: 'xy8-etb-mewtwo-y', art: 'Mewtwo Y', market: 1499, productId: 107107,
        contents: "Mega Mewtwo Y art: eight BREAKthrough packs; 65 sleeves featuring Mega Mewtwo Y; 45 Energy cards; the BREAKthrough player's guide; six damage-counter dice; one coin-flip die; two acrylic condition markers; a collector's box with four dividers; and a TCGO code card. No promo card.",
        contentsSource: XY_BREAKTHROUGH_SOURCE,
        priceKind: 'tcgplayer',
      },
    ],
  },
  xy12: {
    name: 'Evolutions', packs: 8, msrp: 39.99, releaseDate: '2016/11/02',
    boxes: [
      { id: 'xy12-etb', art: 'Mega Charizard Y', market: 871.23, productId: 123447 },
      { id: 'xy12-etb-blastoise', art: 'Mega Blastoise', market: 802.28, productId: 123448 },
    ],
  },
}

export const DUAL_ART_ETB_ROWS: SpecialProductRow[] = Object.entries(DUAL_ART_ETBS).flatMap(([setId, info]) =>
  info.boxes.map((box): SpecialProductRow => {
    const listing = TCGPLAYER_SHELF(`${info.name} Elite Trainer Box [${box.art}]`, box.productId)
    const source = box.contentsSource ?? listing
    const priceSource = box.priceSource ?? listing
    const priceNote = box.market === null
      ? 'TCGplayer lists the box but publishes no market price, so it stays on the modelled price.'
      : `$${box.market.toFixed(2)} is ${box.priceLabel ?? 'the TCGplayer market for this exact box on 8 November 2026'}.`
    return {
      id: box.id,
      setId,
      name: `${info.name} Elite Trainer Box (${box.art})`,
      msrp: info.msrp,
      kind: 'etb',
      packs: info.packs,
      cardsPerPack: 10,
      releaseDate: info.releaseDate,
      description: `${info.packs} packs and the ${box.art} art of the box.`,
      promos: box.promo ? [box.promo] : [],
      promoIds: box.promoId ? [box.promoId] : undefined,
      promoSet: box.promoSet ?? (box.promoId ? 'svp' : undefined),
      source,
      shelf: box.market === null ? undefined : { market: box.market, source: priceSource, asOf: box.priceAsOf ?? '2026-11-08', kind: box.priceKind ?? 'tcgplayer' },
      image: `https://tcgplayer-cdn.tcgplayer.com/product/${box.productId}_in_400x400.jpg`,
      note: box.contents
        ? `${box.contents} ${priceNote}`
        : `${box.art} art. ${info.packs} packs${box.promo ? `, with the ${box.promo} promo` : ', no promo'}. ${priceNote}`,
    }
  }),
)

const BUILD_BATTLE_SOURCE: EvidenceSource = {
  label: 'Bulbapedia — Build & Battle Box (list of boxes)',
  url: 'https://bulbapedia.bulbagarden.net/wiki/Build_%26_Battle_Box_(TCG)',
}

/**
 * Build & Battle Boxes: a product line, not a set rule. It began with Fates
 * Collide in 2016 and shipped with every main expansion after it, so the rows
 * come from the published list rather than from an era template. Each box is
 * four packs and one of four prerelease promos; the 40-card evolution deck is
 * printed matter the pack opener has no equivalent for and is not modelled.
 */
export const BUILD_BATTLE_PRODUCTS: SpecialProductRow[] = BUILD_BATTLE_BOXES.map((box) => {
  const name = `${box.expansion} Build & Battle Box`
  const listing = box.productId === null ? null : TCGPLAYER_SHELF(name, box.productId)
  const priceNote = box.market === null || !listing
    ? 'TCGplayer does not list this box, so the shelf price is modelled from the four packs and the promo.'
    : `$${box.market.toFixed(2)} is the TCGplayer market for this box on 9 November 2026.`
  return {
    id: `${box.setId}-build-battle`,
    setId: box.setId,
    name,
    msrp: 19.99,
    packs: 4,
    cardsPerPack: 10,
    releaseDate: box.releaseDate,
    description: 'Four booster packs, a 40-card evolution deck and one of four prerelease promos.',
    promos: box.promos,
    promoIds: box.promoIds,
    promoSet: box.promoSet,
    source: BUILD_BATTLE_SOURCE,
    shelf: box.market === null || !listing
      ? undefined
      : { market: box.market, source: listing, asOf: '2026-11-09', kind: 'tcgplayer' },
    image: box.image ?? undefined,
    note: `Four packs and one of four prerelease promos (${box.promos.join(', ')}); the box's 40-card evolution deck is not modelled, so the opener deals the four packs. ${priceNote}`,
  }
})

for (const row of BUILD_BATTLE_PRODUCTS) {
  evidence[row.id] = {
    packs: row.packs,
    cardsPerPack: 10,
    promos: row.promos,
    promoIds: row.promoIds,
    promoSet: row.promoSet,
    source: BUILD_BATTLE_SOURCE,
    note: `Build & Battle Box: four packs and one of four prerelease promos (${row.promos.join(', ')}). The 40-card evolution deck is not modelled.`,
  }
}

const COLLECTIONS_SOURCE: EvidenceSource = {
  label: 'Pokémon product galleries and press releases — collection contents',
  url: 'https://www.pokemon.com/us/pokemon-tcg/product-gallery',
}

/**
 * Collection products for the special sets whose lineups the era template
 * cannot describe: a poster, binder, tech sticker, premium, illustration,
 * ultra-premium or figure collection is a named product with its own pack
 * count and promos, so every row carries its researched contents instead of a
 * set-level guess. Where the catalogue does not hold one of a product's promos,
 * the row names it but does not claim it, so the opener never substitutes an
 * unrelated printing.
 */
export const COLLECTION_PRODUCTS: SpecialProductRow[] = COLLECTIONS.map((c) => ({
  id: c.id,
  setId: c.setId,
  name: c.name,
  msrp: c.msrp,
  packs: c.packs,
  cardsPerPack: 10,
  releaseDate: c.releaseDate,
  description: c.description,
  promos: c.promos,
  promoIds: c.promoIds.length ? c.promoIds : undefined,
  promoSet: c.promoIds.length ? c.promoIds[0].split('-')[0] : undefined,
  promoPolicy: c.promoPolicy,
  source: COLLECTIONS_SOURCE,
  shelf: { market: c.market, source: TCGPLAYER_SHELF(c.name, c.productId), asOf: '2026-11-09', kind: 'tcgplayer' },
  image: `https://tcgplayer-cdn.tcgplayer.com/product/${c.productId}_in_400x400.jpg`,
  note: c.note ?? '',
}))

for (const row of COLLECTION_PRODUCTS) {
  evidence[row.id] = {
    packs: row.packs,
    cardsPerPack: 10,
    promos: row.promos,
    promoIds: row.promoIds,
    promoSet: row.promoSet,
    promoPolicy: row.promoPolicy,
    source: COLLECTIONS_SOURCE,
    note: row.note,
  }
}

/** Products that are not the set's ordinary booster, bundle, ETB or display. */
/** The Mythical Pokémon Collection product page for one box. */
const MYTHICAL_COLLECTION = (slug: string, name: string): EvidenceSource => ({
  label: `Pokémon TCG — Mythical Pokémon Collection—${name}`,
  url: `https://www.pokemon.com/us/pokemon-tcg/product-gallery/mythical-pokemon-collection-${slug}`,
})
/** The Red & Blue Collection product page for one box. */
const RED_BLUE_COLLECTION = (slug: string, name: string): EvidenceSource => ({
  label: `Pokémon TCG — Red & Blue Collection—${name}`,
  url: `https://www.pokemon.com/us/pokemon-tcg/product-gallery/red-blue-collection-${slug}`,
})

export const SPECIAL_PRODUCTS: SpecialProductRow[] = [
  ...BUILD_BATTLE_PRODUCTS,
  ...COLLECTION_PRODUCTS,
  // Single and Three Pack Blisters. The promo in each is the one Bulbapedia's
  // promo table files with that product; a set whose promo numbers the sources
  // do not state gets no row rather than a guessed one. A single blister has no
  // published MSRP, so it is priced from the pack's MSRP with the promo added
  // by the price model; three-pack blisters sell at the published $13.99.
  {
    id: 'sv1-single-blister', setId: 'sv1', name: 'Scarlet & Violet Single Pack Blister', msrp: 4.49,
    packs: 1, cardsPerPack: 10, releaseDate: '2023/03/31',
    description: 'One Scarlet & Violet pack and one of two promo cards, with a coin.',
    promos: ['Spidops', 'Espathra'], promoIds: ['svp-9', 'svp-10'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Single Pack Blister: one pack and one promo. Bulbapedia files Spidops (SVP 009) and Espathra (SVP 010) with this blister. The blister has no published MSRP, so the shelf price is the pack MSRP plus the promo.',
  },
  {
    id: 'sv1-triple-blister', setId: 'sv1', name: 'Scarlet & Violet Three Pack Blister', msrp: 13.99,
    packs: 3, cardsPerPack: 10, releaseDate: '2023/03/31',
    description: 'Three Scarlet & Violet packs and one of two promo cards.',
    promos: ['Arcanine', 'Dondozo'], promoIds: ['svp-11', 'svp-12'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Three Pack Blister: three packs and one promo, $13.99. Bulbapedia files Arcanine (SVP 011) and Dondozo (SVP 012) with this blister.',
  },
  {
    id: 'sv2-single-blister', setId: 'sv2', name: 'Paldea Evolved Single Pack Blister', msrp: 4.49,
    packs: 1, cardsPerPack: 10, releaseDate: '2023/06/09',
    description: 'One Paldea Evolved pack and one of two promo cards.',
    promos: ['Smoliv', 'Growlithe'], promoIds: ['svp-23', 'svp-24'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Single Pack Blister: one pack and one promo. Bulbapedia files Smoliv (SVP 023) and Growlithe (SVP 024) with this blister; the shelf price is the pack MSRP plus the promo.',
  },
  {
    id: 'sv2-triple-blister', setId: 'sv2', name: 'Paldea Evolved Three Pack Blister', msrp: 13.99,
    packs: 3, cardsPerPack: 10, releaseDate: '2023/06/09',
    description: 'Three Paldea Evolved packs and one of two promo cards.',
    promos: ['Tinkatink', 'Varoom'], promoIds: ['svp-25', 'svp-26'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Three Pack Blister: three packs and one promo, $13.99. Bulbapedia files Tinkatink (SVP 025) and Varoom (SVP 026) with this blister.',
  },
  {
    id: 'sv3-single-blister', setId: 'sv3', name: 'Obsidian Flames Single Pack Blister', msrp: 4.49,
    packs: 1, cardsPerPack: 10, releaseDate: '2023/08/11',
    description: 'One Obsidian Flames pack and one of two promo cards.',
    promos: ['Pawmi', 'Paldean Wooper'], promoIds: ['svp-40', 'svp-41'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Single Pack Blister: one pack and one promo. Bulbapedia files Pawmi (SVP 040) and Paldean Wooper (SVP 041) with this blister; the shelf price is the pack MSRP plus the promo.',
  },
  {
    id: 'sv3-triple-blister', setId: 'sv3', name: 'Obsidian Flames Three Pack Blister', msrp: 13.99,
    packs: 3, cardsPerPack: 10, releaseDate: '2023/08/11',
    description: 'Three Obsidian Flames packs and one of two promo cards.',
    promos: ['Houndstone', 'Eevee'], promoIds: ['svp-42', 'svp-43'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Three Pack Blister: three packs and one promo, $13.99. Bulbapedia files Houndstone (SVP 042) and Eevee (SVP 043) with this blister.',
  },
  {
    id: 'sv4-single-blister', setId: 'sv4', name: 'Paradox Rift Single Pack Blister', msrp: 4.49,
    packs: 1, cardsPerPack: 10, releaseDate: '2023/11/03',
    description: 'One Paradox Rift pack and one of two promo cards.',
    promos: ['Pineco', 'Sinistea'], promoIds: ['svp-61', 'svp-62'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Single Pack Blister: one pack and one promo. Bulbapedia files Pineco (SVP 061) and Sinistea (SVP 062) with this blister; the shelf price is the pack MSRP plus the promo.',
  },
  {
    id: 'sv4-triple-blister', setId: 'sv4', name: 'Paradox Rift Three Pack Blister', msrp: 13.99,
    packs: 3, cardsPerPack: 10, releaseDate: '2023/11/03',
    description: 'Three Paradox Rift packs and one of two promo cards.',
    promos: ['Cetitan', 'Arctibax'], promoIds: ['svp-63', 'svp-64'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Three Pack Blister: three packs and one promo, $13.99. Bulbapedia files Cetitan (SVP 063) and Arctibax (SVP 064) with this blister.',
  },
  {
    id: 'sv5-single-blister', setId: 'sv5', name: 'Temporal Forces Single Pack Blister', msrp: 4.49,
    packs: 1, cardsPerPack: 10, releaseDate: '2024/03/22',
    description: 'One Temporal Forces pack, one of two promo cards and a Pawmi coin.',
    promos: ['Carvanha', 'Bellibolt'], promoIds: ['svp-93', 'svp-94'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Single Pack Blister: one pack and one promo, with a Pawmi coin. Bulbapedia files Carvanha (SVP 093) and Bellibolt (SVP 094) with this blister; the shelf price is the pack MSRP plus the promo.',
  },
  {
    id: 'sv5-triple-blister', setId: 'sv5', name: 'Temporal Forces Three Pack Blister', msrp: 13.99,
    packs: 3, cardsPerPack: 10, releaseDate: '2024/03/22',
    description: 'Three Temporal Forces packs and one of two promo cards.',
    promos: ['Cleffa', 'Cyclizar'], promoIds: ['svp-95', 'svp-96'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Three Pack Blister: three packs and one promo, $13.99. Bulbapedia files Cleffa (SVP 095) and Cyclizar (SVP 096) with this blister.',
  },
  {
    id: 'sv6-single-blister', setId: 'sv6', name: 'Twilight Masquerade Single Pack Blister', msrp: 4.49,
    packs: 1, cardsPerPack: 10, releaseDate: '2024/05/24',
    description: 'One Twilight Masquerade pack and one of two promo cards.',
    promos: ['Toxel', 'Pupitar'], promoIds: ['svp-119', 'svp-120'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Single Pack Blister: one pack and one promo. Bulbapedia files Toxel (SVP 119) and Pupitar (SVP 120) with this blister; the shelf price is the pack MSRP plus the promo.',
  },
  {
    id: 'sv6-triple-blister', setId: 'sv6', name: 'Twilight Masquerade Three Pack Blister', msrp: 13.99,
    packs: 3, cardsPerPack: 10, releaseDate: '2024/05/24',
    description: 'Three Twilight Masquerade packs and one of two promo cards.',
    promos: ['Revavroom', 'Snorlax'], promoIds: ['svp-121', 'svp-122'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Three Pack Blister: three packs and one promo, $13.99. Bulbapedia files Revavroom (SVP 121) and Snorlax (SVP 122) with this blister.',
  },
  {
    id: 'sv7-single-blister', setId: 'sv7', name: 'Stellar Crown Single Pack Blister', msrp: 4.49,
    packs: 1, cardsPerPack: 10, releaseDate: '2024/09/13',
    description: 'One Stellar Crown pack and one of two promo cards.',
    promos: ['Horsea', 'Porygon2'], promoIds: ['svp-137', 'svp-138'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Single Pack Blister: one pack and one promo. Bulbapedia files Horsea (SVP 137) and Porygon2 (SVP 138) with this blister; the shelf price is the pack MSRP plus the promo.',
  },
  {
    id: 'sv7-triple-blister', setId: 'sv7', name: 'Stellar Crown Three Pack Blister', msrp: 13.99,
    packs: 3, cardsPerPack: 10, releaseDate: '2024/09/13',
    description: 'Three Stellar Crown packs and one of two promo cards.',
    promos: ['Latias', 'Tinkaton'], promoIds: ['svp-139', 'svp-140'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Three Pack Blister: three packs and one promo, $13.99. Bulbapedia files Latias (SVP 139) and Tinkaton (SVP 140) with this blister.',
  },
  {
    id: 'sv8-single-blister', setId: 'sv8', name: 'Surging Sparks Single Pack Blister', msrp: 4.49,
    packs: 1, cardsPerPack: 10, releaseDate: '2024/11/08',
    description: 'One Surging Sparks pack and one of two promo cards.',
    promos: ['Wooper', 'Pachirisu'], promoIds: ['svp-155', 'svp-158'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Single Pack Blister: one pack and one promo. Bulbapedia files Wooper (SVP 155) and Pachirisu (SVP 158) with this blister, the two singles in the set range; the shelf price is the pack MSRP plus the promo.',
  },
  {
    id: 'sv8-triple-blister', setId: 'sv8', name: 'Surging Sparks Three Pack Blister', msrp: 13.99,
    packs: 3, cardsPerPack: 10, releaseDate: '2024/11/08',
    description: 'Three Surging Sparks packs and one of two promo cards.',
    promos: ['Quagsire', 'Zapdos'], promoIds: ['svp-156', 'svp-157'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Three Pack Blister: three packs and one promo, $13.99. Bulbapedia files Quagsire (SVP 156) and Zapdos (SVP 157) with this blister.',
  },
  {
    id: 'sv10-single-blister', setId: 'sv10', name: 'Destined Rivals Single Pack Blister', msrp: 4.49,
    packs: 1, cardsPerPack: 10, releaseDate: '2025/05/30',
    description: 'One Destined Rivals pack and one of two promo cards.',
    promos: ['Zarude', 'Eevee'], promoIds: ['svp-199', 'svp-200'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Single Pack Blister: one pack and one promo. Bulbapedia files Zarude (SVP 199) and Eevee (SVP 200) with this blister; the shelf price is the pack MSRP plus the promo.',
  },
  {
    id: 'sv10-triple-blister', setId: 'sv10', name: 'Destined Rivals Three Pack Blister', msrp: 13.99,
    packs: 3, cardsPerPack: 10, releaseDate: '2025/05/30',
    description: 'Three Destined Rivals packs and one of two promo cards.',
    promos: ['Zebstrika', 'Kangaskhan'], promoIds: ['svp-201', 'svp-202'], promoSet: 'svp', source: SVP_BLISTERS,
    note: 'Three Pack Blister: three packs and one promo, $13.99. Bulbapedia files Zebstrika (SVP 201) and Kangaskhan (SVP 202) with this blister.',
  },
  {
    id: 'me1-single-blister', setId: 'me1', name: 'Mega Evolution Single Pack Blister', msrp: 4.49,
    packs: 1, cardsPerPack: 10, releaseDate: '2025/09/26',
    description: 'One Mega Evolution pack, one of two promos on Cosmos Holofoil and a coin.',
    promos: ['Drifloon', 'Drifblim'], promoIds: ['mep-005', 'mep-006'], promoSet: 'mep', source: MEP_BLISTERS,
    note: 'Single Pack Blister: one pack and one promo, both on Cosmos Holofoil. Bulbapedia files Drifloon (MEP 005) and Drifblim (MEP 006) with this blister; the shelf price is the pack MSRP plus the promo.',
  },
  {
    id: 'me1-triple-blister', setId: 'me1', name: 'Mega Evolution Three Pack Blister', msrp: 13.99,
    packs: 3, cardsPerPack: 10, releaseDate: '2025/09/26',
    description: 'Three Mega Evolution packs and one of two Cosmos Holofoil promos.',
    promos: ['Psyduck', 'Golduck'], promoIds: ['mep-007', 'mep-008'], promoSet: 'mep', source: MEP_BLISTERS,
    note: 'Three Pack Blister: three packs and one promo, $13.99. Bulbapedia files Psyduck (MEP 007) and Golduck (MEP 008) with this blister.',
  },
  {
    id: 'me2-single-blister', setId: 'me2', name: 'Phantasmal Flames Single Pack Blister', msrp: 4.49,
    packs: 1, cardsPerPack: 10, releaseDate: '2025/11/14',
    description: 'One Phantasmal Flames pack and one of two Smooth Cosmos Holofoil promos.',
    promos: ['Cottonee', 'Whimsicott'], promoIds: ['mep-018', 'mep-019'], promoSet: 'mep', source: MEP_BLISTERS,
    note: 'Single Pack Blister: one pack and one promo on Smooth Cosmos Holofoil. Bulbapedia files Cottonee (MEP 018) and Whimsicott (MEP 019) with this blister; the shelf price is the pack MSRP plus the promo.',
  },
  {
    id: 'me2-triple-blister', setId: 'me2', name: 'Phantasmal Flames Three Pack Blister', msrp: 13.99,
    packs: 3, cardsPerPack: 10, releaseDate: '2025/11/14',
    description: 'Three Phantasmal Flames packs and one of two Smooth Cosmos Holofoil promos.',
    promos: ['Sneasel', 'Weavile'], promoIds: ['mep-020', 'mep-021'], promoSet: 'mep', source: MEP_BLISTERS,
    note: 'Three Pack Blister: three packs and one promo, $13.99. Bulbapedia files Sneasel (MEP 020) and Weavile (MEP 021) with this blister.',
  },
  {
    id: 'me4-single-blister', setId: 'me4', name: 'Chaos Rising Single Pack Blister', msrp: 4.49,
    packs: 1, cardsPerPack: 10, releaseDate: '2026/05/22',
    description: 'One Chaos Rising pack and a Toxel promo.',
    promos: ['Toxel'], promoIds: ['mep-078'], promoSet: 'mep', source: MEP_BLISTERS,
    note: 'Single Pack Blister: one pack and the Toxel promo (MEP 078). The shelf price is the pack MSRP plus the promo.',
  },
  {
    id: 'me4-triple-blister', setId: 'me4', name: 'Chaos Rising Three Pack Blister', msrp: 13.99,
    packs: 3, cardsPerPack: 10, releaseDate: '2026/05/22',
    description: 'Three Chaos Rising packs and a Charmeleon promo.',
    promos: ['Charmeleon'], promoIds: ['mep-079'], promoSet: 'mep', source: MEP_BLISTERS,
    note: 'Three Pack Blister: three packs and the Charmeleon promo (MEP 079), $13.99.',
  },
  // Delta Reign. Bulbapedia files the blister promos as MEP 115 (Spritzee) and
  // MEP 116 (Seel) on Pixel Cosmos Holofoil, but both promo pages redirect to the
  // set printings they reprint, so the box hands over that set card — the same
  // answer the Knock Out Collection's Eevee gets. The Pixel Cosmos paper is not
  // modelled as a separate printing. The blisters below were cross-checked
  // against the tcgcsv mirror, which read the same listings on 22 November at
  // $9.51 and $21.17 against this $8.99 and $22.46, and the Pokémon Center ETB
  // at $132.56 against $141.44 — 4–6% apart across nine and fourteen days, so
  // the dated reads stand.
  {
    id: 'me6-single-blister', setId: 'me6', name: 'Delta Reign Single Pack Blister', msrp: 4.49,
    packs: 1, cardsPerPack: 10, releaseDate: '2026/11/06',
    description: 'One Delta Reign pack and a Spritzee promo on Pixel Cosmos Holofoil.',
    promos: ['Spritzee'], promoIds: ['me3-35'], promoSet: 'me3', source: MEP_BLISTERS,
    shelf: { market: 8.99, source: TCGPLAYER_SHELF('Delta Reign Single Pack Blister [Spritzee]', 712108), asOf: '2026-11-13' },
    note: 'Single Pack Blister: one pack and the Spritzee promo Bulbapedia files as MEP 115, a Pixel Cosmos Holo exclusive. That promo page redirects to Spritzee (Perfect Order 35), so the box hands over that set card. It sells at its own listing, $8.99 on 13 November 2026, not at pack MSRP plus a promo.',
  },
  {
    id: 'me6-triple-blister', setId: 'me6', name: 'Delta Reign Three Pack Blister', msrp: 13.99,
    packs: 3, cardsPerPack: 10, releaseDate: '2026/11/06',
    description: 'Three Delta Reign packs and a Seel promo on Pixel Cosmos Holofoil.',
    promos: ['Seel'], promoIds: ['me3-18'], promoSet: 'me3', source: MEP_BLISTERS,
    shelf: { market: 22.46, source: TCGPLAYER_SHELF('Delta Reign 3 Pack Blister [Seel]', 712093), asOf: '2026-11-13' },
    note: 'Three Pack Blister: three packs and the Seel promo Bulbapedia files as MEP 116, a Pixel Cosmos Holo exclusive, $13.99 sticker. That promo page redirects to Seel (Perfect Order 18), so the box hands over that set card. It trades at $22.46 on 13 November 2026.',
  },
  // Prismatic Evolutions
  {
    id: 'sv8pt5-2pack-blister', setId: 'sv8pt5', name: 'Prismatic Evolutions 2-Pack Blister', msrp: 9.99,
    packs: 2, cardsPerPack: 10, releaseDate: '2025/02/21',
    description: 'Two Prismatic Evolutions packs, a foil Eevee promo with the Pokémon Day 2025 logo and a metallic coin.',
    promos: ['Eevee'], promoIds: ['sv8pt5-74'], promoSet: 'sv8pt5', source: PRISMATIC_BLISTER,
    note: 'Two Pack Blister: two packs, the stamped Eevee promo and a metallic coin, $9.99 at release. Bulbapedia dates it to 21 February 2025 and calls the card a Cosmos Parallel Holofoil variant of the Prismatic Evolutions Eevee 074/131 with the Pokémon Day 2025 stamp, so the catalogue holds that set card; the parallel and the stamp are not modelled as a separate printing.',
  },
  // 30th Celebration
  {
    id: 'me55-poster', setId: 'me55', name: '30th Celebration Poster Collection', msrp: 14.99,
    packs: 3, cardsPerPack: 6, releaseDate: '2026/09/16',
    description: 'Three 30th Celebration packs, Articuno/Zapdos/Moltres promos and a double-sided poster.',
    promos: ['Articuno', 'Zapdos', 'Moltres'], promoIds: ['mep-097', 'mep-098', 'mep-096'], promoSet: 'mep', promoPolicy: 'all', source: THIRTIETH_POSTER,
    note: 'Poster Collection: three packs and three Legendary Bird promos.',
  },
  {
    id: 'me55-2pack-blister', setId: 'me55', name: '30th Celebration 2-Pack Blister', msrp: 9.99,
    packs: 2, cardsPerPack: 6, releaseDate: '2026/09/16',
    description: 'Two 30th Celebration packs, a foil Eevee promo and a plastic coin.',
    promos: ['Eevee'], promoIds: ['me55-116'], promoSet: 'me55', source: THIRTIETH_BLISTER,
    note: '2-Pack Blister: two packs, the 116/128 Eevee promo and a plastic coin. It carries the same Cosmos Holofoil Eevee as the Knock Out Collection (Bulbapedia\'s 30th Anniversary table), not a Black Star Promo; the catalogue holds that card, though the stamp and its cosmos paper are not modelled as a separate printing.',
  },
  {
    id: 'me55-tech-sticker', setId: 'me55', name: '30th Celebration Tech Sticker Collection', msrp: 14.99,
    packs: 3, cardsPerPack: 6, releaseDate: '2026/09/16',
    description: 'Three 30th Celebration packs, one Alolan Exeggutor or Lucario promo and a tech sticker sheet.',
    promos: ['Alolan Exeggutor', 'Lucario'], promoIds: ['mep-094', 'mep-095'], promoSet: 'mep', source: THIRTIETH_TECH,
    note: 'Tech Sticker Collection: three packs and one of two promos.',
  },
  {
    id: 'me55-binder', setId: 'me55', name: '30th Celebration Binder Collection', msrp: 31.99,
    packs: 5, cardsPerPack: 6, releaseDate: '2026/12/04',
    description: 'A 30th Celebration nine-pocket binder and five booster packs.',
    promos: [], source: THIRTIETH_BINDER,
    note: 'Binder Collection: five packs and a binder, no promo.',
  },
  {
    id: 'me55-mini-tin', setId: 'me55', name: '30th Celebration Mini Tin', msrp: 9.99,
    packs: 2, cardsPerPack: 6, releaseDate: '2026/10/02',
    description: 'Two 30th Celebration packs, a sticker sheet and an art card.',
    promos: [], source: THIRTIETH_TIN,
    note: 'Mini Tin: two packs; the sticker sheet and art card are not cards.',
  },
  {
    id: 'me55-knockout', setId: 'me55', name: '30th Celebration Knock Out Collection', msrp: 9.99,
    packs: 2, cardsPerPack: 6, releaseDate: '2026/09/16',
    description: 'Two 30th Celebration packs, an Eevee promo and a plastic coin.',
    promos: ['Eevee'], promoIds: ['me55-116'], promoSet: 'me55', source: THIRTIETH_KNOCKOUT,
    note: 'Knock Out Collection: two packs and an Eevee promo. It is not a Black Star Promo: Bulbapedia\'s 30th Anniversary table lists it as 116/128 Eevee [Cosmos Holofoil], the numbered set card, and the 2-Pack Blister carries the same card. The catalogue holds that card; the stamp and its cosmos paper are not modelled as a separate printing.',
  },
  {
    id: 'me55-sylveon-ex-box', setId: 'me55', name: '30th Celebration Sylveon ex Box', msrp: 21.99,
    packs: 4, cardsPerPack: 6, releaseDate: '2026/09/16',
    description: 'Four 30th Celebration packs, a Sylveon ex foil promo and an oversize card.',
    promos: ['Sylveon ex'], promoIds: ['mep-100'], promoSet: 'mep', source: THIRTIETH_SHOWCASE,
    note: 'Sylveon ex Box: four packs and a Sylveon ex promo.',
  },
  {
    id: 'me55-greninja-ex-box', setId: 'me55', name: '30th Celebration Greninja ex Box', msrp: 21.99,
    packs: 4, cardsPerPack: 6, releaseDate: '2026/09/16',
    description: 'Four 30th Celebration packs, a Greninja ex foil promo and an oversize card.',
    promos: ['Greninja ex'], promoIds: ['mep-099'], promoSet: 'mep', source: THIRTIETH_SHOWCASE,
    note: 'Greninja ex Box: four packs and a Greninja ex promo.',
  },

  // Ascended Heroes
  {
    id: 'me2pt5-tech-sticker', setId: 'me2pt5', name: 'Ascended Heroes Tech Sticker Collection', msrp: 15.99,
    packs: 3, cardsPerPack: 10, releaseDate: '2026/01/30',
    description: 'Three Ascended Heroes packs, a Charmander or Gastly promo and a tech sticker sheet.',
    promos: ['Charmander', 'Gastly'], promoIds: ['me2pt5-20', 'me2pt5-123'], promoSet: 'me2pt5', source: ASCENDED_TECH,
    note: 'Tech Sticker Collection: three packs and one of two promos. The box promos are the Ascended Heroes set cards 020 and 123 on Pixel Cosmos Holofoil; the catalogue holds those cards, though the Pixel Cosmos paper itself is not modelled.',
  },
  {
    id: 'me2pt5-2pack-blister', setId: 'me2pt5', name: 'Ascended Heroes 2-Pack Blister', msrp: 12.99,
    packs: 2, cardsPerPack: 10, releaseDate: '2026/02/20',
    description: 'Two Ascended Heroes packs, an Erika\'s Tangela or Larry\'s Komala promo and a metallic Gym Leader coin.',
    promos: ["Erika's Tangela", "Larry's Komala"], promoIds: ['me2pt5-7', 'me2pt5-175'], promoSet: 'me2pt5', source: ASCENDED_BLISTER,
    note: 'Two packs, one of two Trainer\'s Pokémon promos and a metallic coin featuring Erika or Larry. The promos carry the set numbering — Erika\'s Tangela 007/217 and Larry\'s Komala 175/217 — so they resolve to those set cards rather than a black-star promo. No published MSRP was found; $12.99 is the retail price Academy listed, and retailers show a release around 20 February 2026 after an earlier 30 January pre-order date. It sells at its own listings\' mean, $29.10 on 22 November 2026 — Erika $28.99, Larry $29.21.',
  },
  {
    id: 'me2pt5-mini-tin', setId: 'me2pt5', name: 'Ascended Heroes Mini Tin', msrp: 9.99,
    packs: 2, cardsPerPack: 10, releaseDate: '2026/02/20',
    description: 'Two Ascended Heroes packs, a sticker sheet and an art card.',
    promos: [], source: ASCENDED_TIN,
    note: 'Mini Tin: two packs; the sticker sheet and art card are not cards.',
  },
  {
    id: 'me2pt5-premium-poster', setId: 'me2pt5', name: 'Ascended Heroes Premium Poster Collection', msrp: 64.99,
    packs: 10, cardsPerPack: 10, releaseDate: '2026/03/20',
    description: 'Ten Ascended Heroes packs, a Mega Lucario ex or Mega Gardevoir ex promo and a poster.',
    promos: ['Mega Lucario ex', 'Mega Gardevoir ex'], promoIds: ['mep-033', 'mep-032'], promoSet: 'mep', source: ASCENDED_POSTER,
    note: 'Premium Poster Collection: ten packs and one of two Mega Evolution promos. It sells at its own listings\' mean, $136.93 on 22 November 2026 — Mega Lucario $140.08, Mega Gardevoir $133.77 — not at the $64.99 sticker.',
  },
  {
    id: 'me2pt5-first-partners-pin', setId: 'me2pt5', name: 'Ascended Heroes First Partners Deluxe Pin Collection', msrp: 24.99,
    packs: 5, cardsPerPack: 10, releaseDate: '2026/03/20',
    description: 'Five Ascended Heroes packs, Chikorita/Tepig/Totodile promos and a deluxe pin.',
    promos: ['Chikorita', 'Tepig', 'Totodile'], promoIds: ['me2pt5-8', 'me2pt5-29', 'me2pt5-41'], promoSet: 'me2pt5', promoPolicy: 'all', source: ASCENDED_SHOWCASE,
    note: 'First Partners Deluxe Pin Collection: five packs and three promos. The box promos are the Ascended Heroes set cards 008, 029 and 041 on Pixel Cosmos Holofoil; the catalogue holds those cards, though the Pixel Cosmos paper itself is not modelled.',
  },
  {
    id: 'me2pt5-mega-meganium-box', setId: 'me2pt5', name: 'Ascended Heroes Mega Meganium ex Box', msrp: 21.99,
    packs: 4, cardsPerPack: 10, releaseDate: '2026/04/24',
    description: 'Four Ascended Heroes packs, a Mega Meganium ex promo and an oversize lenticular card.',
    promos: ['Mega Meganium ex'], promoIds: ['mep-034'], promoSet: 'mep', source: ASCENDED_SHOWCASE,
    note: 'Mega ex Box: four packs and a Mega Meganium ex promo.',
  },
  {
    id: 'me2pt5-mega-emboar-box', setId: 'me2pt5', name: 'Ascended Heroes Mega Emboar ex Box', msrp: 21.99,
    packs: 4, cardsPerPack: 10, releaseDate: '2026/04/24',
    description: 'Four Ascended Heroes packs, a Mega Emboar ex promo and an oversize lenticular card.',
    promos: ['Mega Emboar ex'], promoIds: ['mep-035'], promoSet: 'mep', source: ASCENDED_SHOWCASE,
    note: 'Mega ex Box: four packs and a Mega Emboar ex promo.',
  },
  {
    id: 'me2pt5-mega-feraligatr-box', setId: 'me2pt5', name: 'Ascended Heroes Mega Feraligatr ex Box', msrp: 21.99,
    packs: 4, cardsPerPack: 10, releaseDate: '2026/04/24',
    description: 'Four Ascended Heroes packs, a Mega Feraligatr ex promo and an oversize lenticular card.',
    promos: ['Mega Feraligatr ex'], promoIds: ['mep-036'], promoSet: 'mep', source: ASCENDED_SHOWCASE,
    note: 'Mega ex Box: four packs and a Mega Feraligatr ex promo.',
  },
  // Journey Together is the one Scarlet & Violet set that shipped an Enhanced
  // Booster Display: the same 36 packs as the ordinary box plus a Box Topper,
  // a specially stamped variant of the in-set N's Reshiram illustration rare
  // 116/159. It was a separate SKU sold through Pokémon Center and by Play!
  // Pokémon retailers; the regular display has no topper. The stamp is not a
  // separate catalogued paper, so the box hands over the set card itself.
  {
    id: 'sv9-display-enhanced', setId: 'sv9', name: 'Journey Together Enhanced Booster Display (36 packs + promo)', msrp: 161.64,
    kind: 'display', packs: 36, cardsPerPack: 10, releaseDate: '2025/03/28',
    description: 'Thirty-six Journey Together packs plus the stamped N\'s Reshiram Box Topper.',
    promos: ["N's Reshiram"], promoIds: ['sv9-116'], promoSet: 'sv9', source: JOURNEY_TOGETHER_MERCH,
    shelf: { market: 225.73, source: TCGPLAYER_SHELF('Journey Together Enhanced Booster Box', 623628), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/623628_in_400x400.jpg',
    note: 'Enhanced Booster Display: thirty-six packs and one bonus illustration-rare-style promo, the in-set N\'s Reshiram 116/159 with a Journey Together stamp. Bulbapedia records it as a separate product from the regular display and says Pokémon Center sold it while Play! Pokémon retailers could order either; the stamp is not modelled as its own printing, so the box hands over the set card. The $225.73 price is the TCGplayer market for the exact product read on 8 November 2026.',
  },
  // The 18-pack half displays are the European-market configuration: Bulbapedia
  // records the Twilight Masquerade boxes, and TCGplayer lists all five sets as
  // Half Booster Box. Three carry a live quote; the other two are modelled.
  {
    id: 'sv6-half-display', setId: 'sv6', name: 'Twilight Masquerade Half Booster Display (18 packs)', msrp: 80.82,
    kind: 'display', packs: 18, cardsPerPack: 10, releaseDate: '2024/05/24',
    description: 'Eighteen Twilight Masquerade packs in the half-size display.',
    promos: [], source: SV_MERCH,
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/649421_in_400x400.jpg',
    note: 'Half display: eighteen packs, no promo. Bulbapedia records that smaller boxes of eighteen Twilight Masquerade packs were also sold in the European markets TPCi oversaw; TCGplayer lists the product but publishes no market price here, so the $80.82 shelf price is half a display\'s MSRP and the pack-EV floor applies.',
  },
  {
    id: 'sv7-half-display', setId: 'sv7', name: 'Stellar Crown Half Booster Display (18 packs)', msrp: 80.82,
    kind: 'display', packs: 18, cardsPerPack: 10, releaseDate: '2024/09/13',
    description: 'Eighteen Stellar Crown packs in the half-size display.',
    promos: [], source: SV_MERCH,
    shelf: { market: 253.23, source: TCGPLAYER_SHELF('Stellar Crown Half Booster Box', 649420), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/649420_in_400x400.jpg',
    note: 'Half display: eighteen packs, no promo. TCGplayer lists it as the Half Booster Box and quotes $253.23 on 8 November 2026; that quote is the shelf price rather than the modelled half-display estimate.',
  },
  {
    id: 'sv8-half-display', setId: 'sv8', name: 'Surging Sparks Half Booster Display (18 packs)', msrp: 80.82,
    kind: 'display', packs: 18, cardsPerPack: 10, releaseDate: '2024/11/08',
    description: 'Eighteen Surging Sparks packs in the half-size display.',
    promos: [], source: SV_MERCH,
    shelf: { market: 193.27, source: TCGPLAYER_SHELF('Surging Sparks Half Booster Box', 646039), asOf: '2026-11-08' },
    note: 'Half display: eighteen packs, no promo. TCGplayer lists it as the Half Booster Box and quotes $193.27 on 8 November 2026; that quote is the shelf price rather than the modelled half-display estimate.',
  },
  {
    id: 'sv9-half-display', setId: 'sv9', name: 'Journey Together Half Booster Display (18 packs)', msrp: 80.82,
    kind: 'display', packs: 18, cardsPerPack: 10, releaseDate: '2025/03/28',
    description: 'Eighteen Journey Together packs in the half-size display.',
    promos: [], source: SV_MERCH,
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/649492_in_400x400.jpg',
    note: 'Half display: eighteen packs, no promo. TCGplayer quotes it as the Half Booster Box at $333.33 on 22 November 2026 — the same way the Destined Rivals half display is quoted — rather than at the $80.82 half-display sticker.',
  },
  {
    id: 'sv10-half-display', setId: 'sv10', name: 'Destined Rivals Half Booster Display (18 packs)', msrp: 80.82,
    kind: 'display', packs: 18, cardsPerPack: 10, releaseDate: '2025/05/30',
    description: 'Eighteen Destined Rivals packs in the half-size display.',
    promos: [], source: SV_MERCH,
    shelf: { market: 317.5, source: TCGPLAYER_SHELF('Destined Rivals Half Booster Box', 624681), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/624681_in_400x400.jpg',
    note: 'Half display: eighteen packs, no promo. TCGplayer lists it as the Half Booster Box and quotes $317.50 on 8 November 2026; that quote is the shelf price rather than the modelled half-display estimate.',
  },

  // Sword & Shield: the six-pack bundle did not exist before Lost Origin, and
  // Crown Zenith closed the era with one. Its quote is real, so the row sells at
  // the marketplace rather than at the era's $26.99 sticker.
  {
    id: 'swsh12pt5-bundle', setId: 'swsh12pt5', name: 'Crown Zenith Booster Bundle', msrp: 26.99,
    kind: 'bundle', packs: 6, cardsPerPack: 10, releaseDate: '2023/01/20',
    description: 'Six Crown Zenith packs in the booster bundle.',
    promos: [], source: TCGPLAYER_SHELF('Crown Zenith Booster Bundle', 527562),
    shelf: { market: 217.13, source: TCGPLAYER_SHELF('Crown Zenith Booster Bundle', 527562), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/527562_in_400x400.jpg',
    note: 'Booster Bundle: six packs, no promo. The bundle first appeared with Lost Origin, and Crown Zenith got one as the Sword & Shield era closed; $217.13 is the TCGplayer market for the exact box on 8 November 2026.',
  },
  // The two European eighteen-pack boxes of the era. TCGplayer lists both but
  // publishes no market price, so they price like the Scarlet & Violet half
  // displays: half a display's MSRP, floored by what eighteen packs realize.
  {
    id: 'swsh7-half-display', setId: 'swsh7', name: 'Evolving Skies Half Booster Display (18 packs)', msrp: 80.82,
    kind: 'display', packs: 18, cardsPerPack: 10, releaseDate: '2021/08/27',
    description: 'Eighteen Evolving Skies packs in the half-size display.',
    promos: [], source: SWSH_ETB_SOURCE,
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/641794_in_400x400.jpg',
    note: 'Half display: eighteen packs, no promo. TCGplayer lists the Evolving Skies Half Booster Box but publishes no market price here, so the $80.82 shelf price is half a display\'s MSRP and the pack-EV floor applies.',
  },
  {
    id: 'swsh10-half-display', setId: 'swsh10', name: 'Astral Radiance Half Booster Display (18 packs)', msrp: 80.82,
    kind: 'display', packs: 18, cardsPerPack: 10, releaseDate: '2022/05/27',
    description: 'Eighteen Astral Radiance packs in the half-size display.',
    promos: [], source: SWSH_ETB_SOURCE,
    note: 'Half display: eighteen packs, no promo. TCGplayer lists the Astral Radiance Half Booster Box but publishes no market price here, so the $80.82 shelf price is half a display\'s MSRP and the pack-EV floor applies.',
  },

  // Sword & Shield Pokémon Center ETBs, sold only through Pokémon Center from
  // Chilling Reign onward and carrying two more packs than the regular box.
  // Bulbapedia records Chilling Reign's at eight packs because of a printing
  // error, and Crown Zenith's "Plus" at twelve; none of them includes a second
  // stamped promo, which began with Scarlet & Violet. Each quote is TCGplayer's
  // market for the exact box read on 8 November 2026, so the price is the
  // marketplace's rather than a model's.
  {
    id: 'swsh6-etb-pc', setId: 'swsh6', name: 'Chilling Reign Pokémon Center Elite Trainer Box (Ice Rider Calyrex)', msrp: 49.99,
    kind: 'etb', packs: 8, cardsPerPack: 10, releaseDate: '2021/06/18',
    description: 'Eight packs and the Ice Rider art of the Pokémon Center box.',
    promos: [], source: TCGPLAYER_SHELF('Chilling Reign Pokémon Center Elite Trainer Box [Ice Rider Calyrex] (Exclusive)', 247281),
    shelf: { market: 209.63, source: TCGPLAYER_SHELF('Chilling Reign Pokémon Center Elite Trainer Box [Ice Rider Calyrex] (Exclusive)', 247281), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/247281_in_400x400.jpg',
    note: 'Ice Rider Calyrex art. Eight packs, an extra set of sleeves and a metallic coin; Bulbapedia records eight rather than the ten the later Pokémon Center boxes carried, and blames a packaging error. $209.63 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'swsh6-etb-pc-shadow', setId: 'swsh6', name: 'Chilling Reign Pokémon Center Elite Trainer Box (Shadow Rider Calyrex)', msrp: 49.99,
    kind: 'etb', packs: 8, cardsPerPack: 10, releaseDate: '2021/06/18',
    description: 'Eight packs and the Shadow Rider art of the Pokémon Center box.',
    promos: [], source: TCGPLAYER_SHELF('Chilling Reign Pokémon Center Elite Trainer Box [Shadow Rider Calyrex] (Exclusive)', 247282),
    shelf: { market: 191.93, source: TCGPLAYER_SHELF('Chilling Reign Pokémon Center Elite Trainer Box [Shadow Rider Calyrex] (Exclusive)', 247282), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/247282_in_400x400.jpg',
    note: 'Shadow Rider Calyrex art, sold as its own box. Eight packs and the extra sleeves and metallic coin; $191.93 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'swsh7-etb-pc', setId: 'swsh7', name: 'Evolving Skies Pokémon Center Elite Trainer Box (Jolteon, Flareon, Umbreon, Leafeon)', msrp: 49.99,
    kind: 'etb', packs: 10, cardsPerPack: 10, releaseDate: '2021/08/27',
    description: 'Ten packs and the Jolteon, Flareon, Umbreon and Leafeon art of the Pokémon Center box.',
    promos: [], source: TCGPLAYER_SHELF('Evolving Skies Pokémon Center Elite Trainer Box [Jolteon/Flareon/Umbreon/Leafeon] (Exclusive)', 245376),
    shelf: { market: 1087.99, source: TCGPLAYER_SHELF('Evolving Skies Pokémon Center Elite Trainer Box [Jolteon/Flareon/Umbreon/Leafeon] (Exclusive)', 245376), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/245376_in_400x400.jpg',
    note: 'Jolteon, Flareon, Umbreon and Leafeon art. Ten packs, two more than the regular eight-pack box; $1087.99 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'swsh7-etb-pc-glaceon', setId: 'swsh7', name: 'Evolving Skies Pokémon Center Elite Trainer Box (Glaceon, Vaporeon, Sylveon, Espeon)', msrp: 49.99,
    kind: 'etb', packs: 10, cardsPerPack: 10, releaseDate: '2021/08/27',
    description: 'Ten packs and the Glaceon, Vaporeon, Sylveon and Espeon art of the Pokémon Center box.',
    promos: [], source: TCGPLAYER_SHELF('Evolving Skies Pokémon Center Elite Trainer Box [Glaceon/Vaporeon/Sylveon/Espeon] (Exclusive)', 245352),
    shelf: { market: 1127.56, source: TCGPLAYER_SHELF('Evolving Skies Pokémon Center Elite Trainer Box [Glaceon/Vaporeon/Sylveon/Espeon] (Exclusive)', 245352), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/245352_in_400x400.jpg',
    note: 'Glaceon, Vaporeon, Sylveon and Espeon art, sold as its own box. Ten packs and the extra sleeves and metallic coin; $1127.56 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'swsh8-etb-pc', setId: 'swsh8', name: 'Fusion Strike Pokémon Center Elite Trainer Box', msrp: 49.99,
    kind: 'etb', packs: 10, cardsPerPack: 10, releaseDate: '2021/11/12',
    description: 'Ten packs and the extra sleeves and metallic coin of the Pokémon Center box.',
    promos: [], source: TCGPLAYER_SHELF('Fusion Strike Pokémon Center Elite Trainer Box', 247673),
    shelf: { market: 461.76, source: TCGPLAYER_SHELF('Fusion Strike Pokémon Center Elite Trainer Box', 247673), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/247673_in_400x400.jpg',
    note: 'Pokémon Center Elite Trainer Box: ten packs and no promo. $461.76 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'swsh9-etb-pc', setId: 'swsh9', name: 'Brilliant Stars Pokémon Center Elite Trainer Box', msrp: 49.99,
    kind: 'etb', packs: 10, cardsPerPack: 10, releaseDate: '2022/02/25',
    description: 'Ten packs and the extra sleeves and metallic coin of the Pokémon Center box.',
    promos: [], source: TCGPLAYER_SHELF('Brilliant Stars Pokémon Center Elite Trainer Box', 256140),
    shelf: { market: 244.41, source: TCGPLAYER_SHELF('Brilliant Stars Pokémon Center Elite Trainer Box', 256140), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/256140_in_400x400.jpg',
    note: 'Pokémon Center Elite Trainer Box: ten packs and no promo. $244.41 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'swsh10-etb-pc', setId: 'swsh10', name: 'Astral Radiance Pokémon Center Elite Trainer Box', msrp: 49.99,
    kind: 'etb', packs: 10, cardsPerPack: 10, releaseDate: '2022/05/27',
    description: 'Ten packs and the extra sleeves and metallic coin of the Pokémon Center box.',
    promos: [], source: TCGPLAYER_SHELF('Astral Radiance Pokémon Center Elite Trainer Box', 265528),
    shelf: { market: 182.26, source: TCGPLAYER_SHELF('Astral Radiance Pokémon Center Elite Trainer Box', 265528), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/265528_in_400x400.jpg',
    note: 'Pokémon Center Elite Trainer Box: ten packs and no promo. $182.26 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'swsh11-etb-pc', setId: 'swsh11', name: 'Lost Origin Pokémon Center Elite Trainer Box', msrp: 49.99,
    kind: 'etb', packs: 10, cardsPerPack: 10, releaseDate: '2022/09/09',
    description: 'Ten packs and the extra sleeves and metallic coin of the Pokémon Center box.',
    promos: [], source: TCGPLAYER_SHELF('Lost Origin Pokémon Center Elite Trainer Box', 277336),
    shelf: { market: 372.75, source: TCGPLAYER_SHELF('Lost Origin Pokémon Center Elite Trainer Box', 277336), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/277336_in_400x400.jpg',
    note: 'Pokémon Center Elite Trainer Box: ten packs and no promo. $372.75 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'swsh12-etb-pc', setId: 'swsh12', name: 'Silver Tempest Pokémon Center Elite Trainer Box', msrp: 49.99,
    kind: 'etb', packs: 10, cardsPerPack: 10, releaseDate: '2022/11/11',
    description: 'Ten packs and the extra sleeves and metallic coin of the Pokémon Center box.',
    promos: [], source: TCGPLAYER_SHELF('Silver Tempest Pokémon Center Elite Trainer Box', 285860),
    shelf: { market: 377.92, source: TCGPLAYER_SHELF('Silver Tempest Pokémon Center Elite Trainer Box', 285860), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/285860_in_400x400.jpg',
    note: 'Pokémon Center Elite Trainer Box: ten packs, two more than the regular eight-pack box, plus a second set of sleeves and a metallic coin. Bulbapedia dates the extra-pack Pokémon Center boxes from Evolving Skies. $377.92 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'swsh12pt5-etb-pc', setId: 'swsh12pt5', name: 'Crown Zenith Pokémon Center Elite Trainer Box Plus', msrp: 49.99,
    kind: 'etb', packs: 12, cardsPerPack: 10, releaseDate: '2023/01/20',
    description: 'Twelve Crown Zenith packs and the extra sleeves and metallic coin of the Pokémon Center box.',
    promos: [], source: TCGPLAYER_SHELF('Crown Zenith Pokémon Center Elite Trainer Box Plus', 454246),
    shelf: { market: 536.98, source: TCGPLAYER_SHELF('Crown Zenith Pokémon Center Elite Trainer Box Plus', 454246), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/454246_in_400x400.jpg',
    note: 'Pokémon Center Elite Trainer Box Plus: twelve packs, the most of any Sword & Shield box, plus an extra set of sleeves and a metallic coin. No promo is claimed here because the product copy read for this row does not name one.',
  },

  // A two-art Pokémon Center box is two products, not one row naming the other's
  // price: the art determines which promo is sealed inside, so each variant now
  // has its own row, quote and photo. The original id keeps the first art, which
  // is what stock already held in a save belongs to.
  {
    id: 'sv1-etb-pc', setId: 'sv1', name: 'Scarlet & Violet Pokémon Center Elite Trainer Box (Koraidon)', msrp: 59.99,
    kind: 'etb', packs: 11, cardsPerPack: 10, releaseDate: '2023/03/31',
    description: 'Eleven packs and the Koraidon art of the Pokémon Center box.',
    promos: ['Koraidon'], promoIds: ['svp-14'], promoSet: 'svp',
    source: TCGPLAYER_SHELF('Scarlet & Violet Pokémon Center Elite Trainer Box [Koraidon] (Exclusive)', 478758),
    shelf: { market: 286.56, source: TCGPLAYER_SHELF('Scarlet & Violet Pokémon Center Elite Trainer Box [Koraidon] (Exclusive)', 478758), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/478758_in_400x400.jpg',
    note: 'Koraidon art. The box carries the Koraidon promo twice, one plain and one with the Pokémon Center logo; the stamp is not a separate catalogue paper, so the box hands the card over once. $286.56 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'sv1-etb-pc-miraidon', setId: 'sv1', name: 'Scarlet & Violet Pokémon Center Elite Trainer Box (Miraidon)', msrp: 59.99,
    kind: 'etb', packs: 11, cardsPerPack: 10, releaseDate: '2023/03/31',
    description: 'Eleven packs and the Miraidon art of the Pokémon Center box.',
    promos: ['Miraidon'], promoIds: ['svp-13'], promoSet: 'svp',
    source: TCGPLAYER_SHELF('Scarlet & Violet Pokémon Center Elite Trainer Box [Miraidon] (Exclusive)', 478756),
    shelf: { market: 316.89, source: TCGPLAYER_SHELF('Scarlet & Violet Pokémon Center Elite Trainer Box [Miraidon] (Exclusive)', 478756), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/478756_in_400x400.jpg',
    note: 'Miraidon art, sold as its own box. The box carries the Miraidon promo twice, one plain and one with the Pokémon Center logo; the stamp is not a separate catalogue paper, so the box hands the card over once. $316.89 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'sv4-etb-pc', setId: 'sv4', name: 'Paradox Rift Pokémon Center Elite Trainer Box (Iron Valiant)', msrp: 59.99,
    kind: 'etb', packs: 11, cardsPerPack: 10, releaseDate: '2023/11/03',
    description: 'Eleven packs and the Iron Valiant art of the Pokémon Center box.',
    promos: ['Iron Bundle'], promoIds: ['svp-58'], promoSet: 'svp',
    source: TCGPLAYER_SHELF('Paradox Rift Pokémon Center Elite Trainer Box [Iron Valiant] (Exclusive)', 512801),
    shelf: { market: 188.73, source: TCGPLAYER_SHELF('Paradox Rift Pokémon Center Elite Trainer Box [Iron Valiant] (Exclusive)', 512801), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/512801_in_400x400.jpg',
    note: 'Iron Valiant art, which seals the Iron Bundle promo. The box carries it twice, one plain and one with the Pokémon Center logo; the stamp is not a separate catalogue paper, so the box hands the card over once. $188.73 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'sv4-etb-pc-roaring-moon', setId: 'sv4', name: 'Paradox Rift Pokémon Center Elite Trainer Box (Roaring Moon)', msrp: 59.99,
    kind: 'etb', packs: 11, cardsPerPack: 10, releaseDate: '2023/11/03',
    description: 'Eleven packs and the Roaring Moon art of the Pokémon Center box.',
    promos: ['Scream Tail'], promoIds: ['svp-65'], promoSet: 'svp',
    source: TCGPLAYER_SHELF('Paradox Rift Pokémon Center Elite Trainer Box [Roaring Moon] (Exclusive)', 512809),
    shelf: { market: 205.75, source: TCGPLAYER_SHELF('Paradox Rift Pokémon Center Elite Trainer Box [Roaring Moon] (Exclusive)', 512809), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/512809_in_400x400.jpg',
    note: 'Roaring Moon art, which seals the Scream Tail promo. Carried twice, plain and stamped; the stamp is not a separate catalogue paper, so the box hands the card over once. $205.75 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'sv5-etb-pc', setId: 'sv5', name: 'Temporal Forces Pokémon Center Elite Trainer Box (Iron Leaves)', msrp: 59.99,
    kind: 'etb', packs: 11, cardsPerPack: 10, releaseDate: '2024/03/22',
    description: 'Eleven packs and the Iron Leaves art of the Pokémon Center box.',
    promos: ['Iron Thorns'], promoIds: ['svp-98'], promoSet: 'svp',
    source: TCGPLAYER_SHELF('Temporal Forces Pokémon Center Elite Trainer Box [Iron Leaves] (Exclusive)', 532853),
    shelf: { market: 197.48, source: TCGPLAYER_SHELF('Temporal Forces Pokémon Center Elite Trainer Box [Iron Leaves] (Exclusive)', 532853), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/532853_in_400x400.jpg',
    note: 'Iron Leaves art, which seals the Iron Thorns promo. Carried twice, plain and stamped; the stamp is not a separate catalogue paper, so the box hands the card over once. $197.48 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'sv5-etb-pc-walking-wake', setId: 'sv5', name: 'Temporal Forces Pokémon Center Elite Trainer Box (Walking Wake)', msrp: 59.99,
    kind: 'etb', packs: 11, cardsPerPack: 10, releaseDate: '2024/03/22',
    description: 'Eleven packs and the Walking Wake art of the Pokémon Center box.',
    promos: ['Flutter Mane'], promoIds: ['svp-97'], promoSet: 'svp',
    source: TCGPLAYER_SHELF('Temporal Forces Pokémon Center Elite Trainer Box [Walking Wake] (Exclusive)', 538775),
    shelf: { market: 212.81, source: TCGPLAYER_SHELF('Temporal Forces Pokémon Center Elite Trainer Box [Walking Wake] (Exclusive)', 538775), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/538775_in_400x400.jpg',
    note: 'Walking Wake art, which seals the Flutter Mane promo. Carried twice, plain and stamped; the stamp is not a separate catalogue paper, so the box hands the card over once. $212.81 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'me1-etb-pc', setId: 'me1', name: 'Mega Evolution Pokémon Center Elite Trainer Box (Mega Gardevoir)', msrp: 59.99,
    kind: 'etb', packs: 11, cardsPerPack: 10, releaseDate: '2025/09/26',
    description: 'Eleven packs and the Mega Gardevoir art of the Pokémon Center box.',
    promos: ['Alakazam'], promoIds: ['mep-009'], promoSet: 'mep',
    source: TCGPLAYER_SHELF('Mega Evolution Pokémon Center Elite Trainer Box [Mega Gardevoir] (Exclusive)', 648415),
    shelf: { market: 177.19, source: TCGPLAYER_SHELF('Mega Evolution Pokémon Center Elite Trainer Box [Mega Gardevoir] (Exclusive)', 648415), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/648415_in_400x400.jpg',
    note: 'Mega Gardevoir art, which seals the Alakazam promo twice, one plain and one with the Pokémon Center logo; the stamp is not a separate catalogue paper, so the box hands the card over once. $177.19 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'me1-etb-pc-lucario', setId: 'me1', name: 'Mega Evolution Pokémon Center Elite Trainer Box (Mega Lucario)', msrp: 59.99,
    kind: 'etb', packs: 11, cardsPerPack: 10, releaseDate: '2025/09/26',
    description: 'Eleven packs and the Mega Lucario art of the Pokémon Center box.',
    promos: ['Riolu'], promoIds: ['mep-010'], promoSet: 'mep',
    source: TCGPLAYER_SHELF('Mega Evolution Pokémon Center Elite Trainer Box [Mega Lucario] (Exclusive)', 644282),
    shelf: { market: 194.26, source: TCGPLAYER_SHELF('Mega Evolution Pokémon Center Elite Trainer Box [Mega Lucario] (Exclusive)', 644282), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/644282_in_400x400.jpg',
    note: 'Mega Lucario art, which seals the Riolu promo twice, one plain and one with the Pokémon Center logo; the stamp is not a separate catalogue paper, so the box hands the card over once. $194.26 is the TCGplayer market on 8 November 2026.',
  },

  // The Sword & Shield Elite Trainer Box Plus: twelve packs split three each
  // across the first four expansions of the era, with a gold Zacian V or
  // Zamazenta V and metal dice, coin and markers. North America got the
  // combined Ultra-Premium Collection instead; outside it the box was sold in
  // two arts, so both are rows here. It is also the one box in the catalogue
  // whose packs come from more than one set, which PACK_MIX below records.
  {
    id: 'swsh1-etb-plus', setId: 'swsh1', name: 'Sword & Shield Elite Trainer Box Plus (Zacian)', msrp: 59.99,
    kind: 'etb', packs: 12, cardsPerPack: 10, releaseDate: '2020/11/20',
    description: 'Twelve packs — three each of Sword & Shield, Rebel Clash, Darkness Ablaze and Vivid Voltage — with the gold Zacian V.',
    promos: ['Zacian V'], promoIds: ['swshp-SWSH076'], promoSet: 'swshp',
    source: TCGPLAYER_SHELF('Sword & Shield Elite Trainer Box Plus [Zacian]', 222987),
    shelf: { market: 235.67, source: TCGPLAYER_SHELF('Sword & Shield Elite Trainer Box Plus [Zacian]', 222987), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/222987_in_400x400.jpg',
    note: 'Zacian art. Twelve packs, three each from Sword & Shield, Rebel Clash, Darkness Ablaze and Vivid Voltage, plus the gold full-art Zacian V (SWSH076). The metal dice, coin and markers are accessories and are not modelled. $235.67 is the TCGplayer market on 8 November 2026.',
  },
  {
    id: 'swsh1-etb-plus-zamazenta', setId: 'swsh1', name: 'Sword & Shield Elite Trainer Box Plus (Zamazenta)', msrp: 59.99,
    kind: 'etb', packs: 12, cardsPerPack: 10, releaseDate: '2020/11/20',
    description: 'Twelve packs — three each of Sword & Shield, Rebel Clash, Darkness Ablaze and Vivid Voltage — with the gold Zamazenta V.',
    promos: ['Zamazenta V'], promoIds: ['swshp-SWSH077'], promoSet: 'swshp',
    source: TCGPLAYER_SHELF('Sword & Shield Elite Trainer Box Plus [Zamazenta]', 222986),
    shelf: { market: 240.64, source: TCGPLAYER_SHELF('Sword & Shield Elite Trainer Box Plus [Zamazenta]', 222986), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/222986_in_400x400.jpg',
    note: 'Zamazenta art. Twelve packs, three each from Sword & Shield, Rebel Clash, Darkness Ablaze and Vivid Voltage, plus the gold full-art Zamazenta V (SWSH077). The metal dice, coin and markers are accessories and are not modelled. $240.64 is the TCGplayer market on 8 November 2026.',
  },

  // Generations is a special expansion: its packs were never sold individually
  // or in a 36-pack display, only inside Mythical/Red & Blue collections, and
  // its one ETB held ten packs plus the Shaymin-EX promo.
  {
    id: 'g1-etb', setId: 'g1', name: 'Generations Elite Trainer Box', msrp: 39.99,
    kind: 'etb', packs: 10, cardsPerPack: 10, releaseDate: '2016/07/01',
    description: 'Ten Generations packs and the Shaymin-EX promo.',
    promos: ['Shaymin-EX'], promoIds: ['xyp-XY148'], promoSet: 'xyp',
    source: TCGPLAYER_SHELF('Generations Elite Trainer Box', 123741),
    shelf: { market: 3833.33, source: TCGPLAYER_SHELF('Generations Elite Trainer Box', 123741), asOf: '2026-11-08' },
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/123741_in_400x400.jpg',
    note: 'Ten Generations packs, not eight: this was the 20th-anniversary box and it added the Shaymin-EX promo (XY148). Generations never had a booster display or a six-pack bundle — its packs came inside the Mythical Pokémon and Red & Blue collections. $3,833.33 is the TCGplayer market on 8 November 2026, on a thin listing.',
  },

// Generations packs came inside 20th-anniversary boxes and nowhere else:
  // eleven Mythical Pokémon Collections (two packs, a full-art promo and a
  // pin, $12.99) and four Red & Blue Collections (four packs, a full-art promo
  // and a figure, $24.99), plus the ten-pack ETB above. Their promo numbers run
  // XY110–XY120 for the Mythicals and XY121–XY124 for Red & Blue, and all of
  // them are in this catalogue. Packs still cannot be bought on their own.
  {
    id: 'g1-mythical-mew', setId: 'g1', name: 'Mythical Pokémon Collection—Mew', msrp: 12.99,
    kind: 'special', packs: 2, cardsPerPack: 10, releaseDate: '2016/02/22',
    description: 'Two Generations packs, the full-art Mew promo and its pin.',
    promos: ['Mew'], promoIds: ['xyp-XY110'], promoSet: 'xyp',
    source: MYTHICAL_COLLECTION('mew', 'Mew'),
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/113774_in_400x400.jpg',
    shelf: { market: 743.27, source: TCGPLAYER_SHELF('Mythical Pokemon Collection Box [Mew]', 113774), asOf: '2026-11-23' },
    note: 'Mythical Pokémon Collection—Mew: two Generations booster packs, a full-art Mew promo (XY110) and a Mew pin. Generations packs were never sold on their own, so this box is one of the only ways a wrapper exists. The pin and the code card are accessories and are not modelled. The $743.27 shelf price is the TCGplayer market on 23 November 2026.',
  },
  {
    id: 'g1-mythical-celebi', setId: 'g1', name: 'Mythical Pokémon Collection—Celebi', msrp: 12.99,
    kind: 'special', packs: 2, cardsPerPack: 10, releaseDate: '2016/03/16',
    description: 'Two Generations packs, the full-art Celebi promo and its pin.',
    promos: ['Celebi'], promoIds: ['xyp-XY111'], promoSet: 'xyp',
    source: MYTHICAL_COLLECTION('celebi', 'Celebi'),
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/114525_in_400x400.jpg',
    note: 'Mythical Pokémon Collection—Celebi: two Generations booster packs, a full-art Celebi promo (XY111) and a Celebi pin. Generations packs were never sold on their own, so this box is one of the only ways a wrapper exists. The pin and the code card are accessories and are not modelled. No marketplace quote for this box was read here, so the shelf price is modelled from the published $12.99 retail price with the packs\' pull value as its floor.',
  },
  {
    id: 'g1-mythical-jirachi', setId: 'g1', name: 'Mythical Pokémon Collection—Jirachi', msrp: 12.99,
    kind: 'special', packs: 2, cardsPerPack: 10, releaseDate: '2016/04/13',
    description: 'Two Generations packs, the full-art Jirachi promo and its pin.',
    promos: ['Jirachi'], promoIds: ['xyp-XY112'], promoSet: 'xyp',
    source: MYTHICAL_COLLECTION('jirachi', 'Jirachi'),
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/116999_in_400x400.jpg',
    note: 'Mythical Pokémon Collection—Jirachi: two Generations booster packs, a full-art Jirachi promo (XY112) and a Jirachi pin. Generations packs were never sold on their own, so this box is one of the only ways a wrapper exists. The pin and the code card are accessories and are not modelled. No marketplace quote for this box was read here, so the shelf price is modelled from the published $12.99 retail price with the packs\' pull value as its floor.',
  },
  {
    id: 'g1-mythical-darkrai', setId: 'g1', name: 'Mythical Pokémon Collection—Darkrai', msrp: 12.99,
    kind: 'special', packs: 2, cardsPerPack: 10, releaseDate: '2016/05/18',
    description: 'Two Generations packs, the full-art Darkrai promo and its pin.',
    promos: ['Darkrai'], promoIds: ['xyp-XY114'], promoSet: 'xyp',
    source: MYTHICAL_COLLECTION('darkrai', 'Darkrai'),
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/118342_in_400x400.jpg',
    note: 'Mythical Pokémon Collection—Darkrai: two Generations booster packs, a full-art Darkrai promo (XY114) and a Darkrai pin. Generations packs were never sold on their own, so this box is one of the only ways a wrapper exists. The pin and the code card are accessories and are not modelled. No marketplace quote for this box was read here, so the shelf price is modelled from the published $12.99 retail price with the packs\' pull value as its floor.',
  },
  {
    id: 'g1-mythical-manaphy', setId: 'g1', name: 'Mythical Pokémon Collection—Manaphy', msrp: 12.99,
    kind: 'special', packs: 2, cardsPerPack: 10, releaseDate: '2016/06/15',
    description: 'Two Generations packs, the full-art Manaphy promo and its pin.',
    promos: ['Manaphy'], promoIds: ['xyp-XY113'], promoSet: 'xyp',
    source: MYTHICAL_COLLECTION('manaphy', 'Manaphy'),
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/118796_in_400x400.jpg',
    note: 'Mythical Pokémon Collection—Manaphy: two Generations booster packs, a full-art Manaphy promo (XY113) and a Manaphy pin. Generations packs were never sold on their own, so this box is one of the only ways a wrapper exists. The pin and the code card are accessories and are not modelled. No marketplace quote for this box was read here, so the shelf price is modelled from the published $12.99 retail price with the packs\' pull value as its floor.',
  },
  {
    id: 'g1-mythical-shaymin', setId: 'g1', name: 'Mythical Pokémon Collection—Shaymin', msrp: 12.99,
    kind: 'special', packs: 2, cardsPerPack: 10, releaseDate: '2016/07/13',
    description: 'Two Generations packs, the full-art Shaymin promo and its pin.',
    promos: ['Shaymin'], promoIds: ['xyp-XY115'], promoSet: 'xyp',
    source: MYTHICAL_COLLECTION('shaymin', 'Shaymin'),
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/120114_in_400x400.jpg',
    shelf: { market: 650, source: TCGPLAYER_SHELF('Mythical Pokemon Collection Box [Shaymin]', 120114), asOf: '2026-11-23' },
    note: 'Mythical Pokémon Collection—Shaymin: two Generations booster packs, a full-art Shaymin promo (XY115) and a Shaymin pin. Generations packs were never sold on their own, so this box is one of the only ways a wrapper exists. The pin and the code card are accessories and are not modelled. The $650 shelf price is the TCGplayer market on 23 November 2026.',
  },
  {
    id: 'g1-mythical-arceus', setId: 'g1', name: 'Mythical Pokémon Collection—Arceus', msrp: 12.99,
    kind: 'special', packs: 2, cardsPerPack: 10, releaseDate: '2016/08/17',
    description: 'Two Generations packs, the full-art Arceus promo and its pin.',
    promos: ['Arceus'], promoIds: ['xyp-XY116'], promoSet: 'xyp',
    source: MYTHICAL_COLLECTION('arceus', 'Arceus'),
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/121363_in_400x400.jpg',
    shelf: { market: 788.3, source: TCGPLAYER_SHELF('Mythical Pokemon Collection Box [Arceus]', 121363), asOf: '2026-11-23' },
    note: 'Mythical Pokémon Collection—Arceus: two Generations booster packs, a full-art Arceus promo (XY116) and a Arceus pin. Generations packs were never sold on their own, so this box is one of the only ways a wrapper exists. The pin and the code card are accessories and are not modelled. The $788.3 shelf price is the TCGplayer market on 23 November 2026.',
  },
  {
    id: 'g1-mythical-victini', setId: 'g1', name: 'Mythical Pokémon Collection—Victini', msrp: 12.99,
    kind: 'special', packs: 2, cardsPerPack: 10, releaseDate: '2016/09/14',
    description: 'Two Generations packs, the full-art Victini promo and its pin.',
    promos: ['Victini'], promoIds: ['xyp-XY117'], promoSet: 'xyp',
    source: MYTHICAL_COLLECTION('victini', 'Victini'),
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/123433_in_400x400.jpg',
    note: 'Mythical Pokémon Collection—Victini: two Generations booster packs, a full-art Victini promo (XY117) and a Victini pin. Generations packs were never sold on their own, so this box is one of the only ways a wrapper exists. The pin and the code card are accessories and are not modelled. No marketplace quote for this box was read here, so the shelf price is modelled from the published $12.99 retail price with the packs\' pull value as its floor.',
  },
  {
    id: 'g1-mythical-keldeo', setId: 'g1', name: 'Mythical Pokémon Collection—Keldeo', msrp: 12.99,
    kind: 'special', packs: 2, cardsPerPack: 10, releaseDate: '2016/10/12',
    description: 'Two Generations packs, the full-art Keldeo promo and its pin.',
    promos: ['Keldeo'], promoIds: ['xyp-XY118'], promoSet: 'xyp',
    source: MYTHICAL_COLLECTION('keldeo', 'Keldeo'),
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/123740_in_400x400.jpg',
    note: 'Mythical Pokémon Collection—Keldeo: two Generations booster packs, a full-art Keldeo promo (XY118) and a Keldeo pin. Generations packs were never sold on their own, so this box is one of the only ways a wrapper exists. The pin and the code card are accessories and are not modelled. No marketplace quote for this box was read here, so the shelf price is modelled from the published $12.99 retail price with the packs\' pull value as its floor.',
  },
  {
    id: 'g1-mythical-genesect', setId: 'g1', name: 'Mythical Pokémon Collection—Genesect', msrp: 12.99,
    kind: 'special', packs: 2, cardsPerPack: 10, releaseDate: '2016/11/16',
    description: 'Two Generations packs, the full-art Genesect promo and its pin.',
    promos: ['Genesect'], promoIds: ['xyp-XY119'], promoSet: 'xyp',
    source: MYTHICAL_COLLECTION('genesect', 'Genesect'),
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/126569_in_400x400.jpg',
    note: 'Mythical Pokémon Collection—Genesect: two Generations booster packs, a full-art Genesect promo (XY119) and a Genesect pin. Generations packs were never sold on their own, so this box is one of the only ways a wrapper exists. The pin and the code card are accessories and are not modelled. No marketplace quote for this box was read here, so the shelf price is modelled from the published $12.99 retail price with the packs\' pull value as its floor.',
  },
  {
    id: 'g1-mythical-meloetta', setId: 'g1', name: 'Mythical Pokémon Collection—Meloetta', msrp: 12.99,
    kind: 'special', packs: 2, cardsPerPack: 10, releaseDate: '2016/12/07',
    description: 'Two Generations packs, the full-art Meloetta promo and its pin.',
    promos: ['Meloetta'], promoIds: ['xyp-XY120'], promoSet: 'xyp',
    source: MYTHICAL_COLLECTION('meloetta', 'Meloetta'),
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/126568_in_400x400.jpg',
    note: 'Mythical Pokémon Collection—Meloetta: two Generations booster packs, a full-art Meloetta promo (XY120) and a Meloetta pin. Generations packs were never sold on their own, so this box is one of the only ways a wrapper exists. The pin and the code card are accessories and are not modelled. No marketplace quote for this box was read here, so the shelf price is modelled from the published $12.99 retail price with the packs\' pull value as its floor.',
  },
  {
    id: 'g1-red-blue-charizard-ex', setId: 'g1', name: 'Red & Blue Collection—Charizard-EX', msrp: 24.99,
    kind: 'special', packs: 4, cardsPerPack: 10, releaseDate: '2016/03/16',
    description: 'Four Generations packs, the full-art Charizard-EX promo and its figure.',
    promos: ['Charizard-EX'], promoIds: ['xyp-XY121'], promoSet: 'xyp',
    source: RED_BLUE_COLLECTION('charizard-ex', 'Charizard-EX'),
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/115598_in_400x400.jpg',
    shelf: { market: 1800.88, source: TCGPLAYER_SHELF('Red & Blue Collection [Charizard EX]', 115598), asOf: '2026-11-23' },
    note: 'Red & Blue Collection—Charizard-EX: four Generations booster packs, a full-art Charizard-EX promo (XY121) and a Charizard-EX figure. The published price was $24.99 (PokéBeach\'s 20th-anniversary lineup). The figure and the card holder are accessories and are not modelled. The $1800.88 shelf price is the TCGplayer market on 23 November 2026.',
  },
  {
    id: 'g1-red-blue-blastoise-ex', setId: 'g1', name: 'Red & Blue Collection—Blastoise-EX', msrp: 24.99,
    kind: 'special', packs: 4, cardsPerPack: 10, releaseDate: '2016/05/18',
    description: 'Four Generations packs, the full-art Blastoise-EX promo and its figure.',
    promos: ['Blastoise-EX'], promoIds: ['xyp-XY122'], promoSet: 'xyp',
    source: RED_BLUE_COLLECTION('blastoise-ex', 'Blastoise-EX'),
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/118795_in_400x400.jpg',
    note: 'Red & Blue Collection—Blastoise-EX: four Generations booster packs, a full-art Blastoise-EX promo (XY122) and a Blastoise-EX figure. The published price was $24.99 (PokéBeach\'s 20th-anniversary lineup). The figure and the card holder are accessories and are not modelled. No marketplace quote for this box was read here, so the shelf price is modelled from that retail price with the packs\' pull value as its floor.',
  },
  {
    id: 'g1-red-blue-venusaur-ex', setId: 'g1', name: 'Red & Blue Collection—Venusaur-EX', msrp: 24.99,
    kind: 'special', packs: 4, cardsPerPack: 10, releaseDate: '2016/07/13',
    description: 'Four Generations packs, the full-art Venusaur-EX promo and its figure.',
    promos: ['Venusaur-EX'], promoIds: ['xyp-XY123'], promoSet: 'xyp',
    source: RED_BLUE_COLLECTION('venusaur-ex', 'Venusaur-EX'),
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/120700_in_400x400.jpg',
    note: 'Red & Blue Collection—Venusaur-EX: four Generations booster packs, a full-art Venusaur-EX promo (XY123) and a Venusaur-EX figure. The published price was $24.99 (PokéBeach\'s 20th-anniversary lineup). The figure and the card holder are accessories and are not modelled. No marketplace quote for this box was read here, so the shelf price is modelled from that retail price with the packs\' pull value as its floor.',
  },
  {
    id: 'g1-red-blue-pikachu-ex', setId: 'g1', name: 'Red & Blue Collection—Pikachu-EX', msrp: 24.99,
    kind: 'special', packs: 4, cardsPerPack: 10, releaseDate: '2016/09/14',
    description: 'Four Generations packs, the full-art Pikachu-EX promo and its figure.',
    promos: ['Pikachu-EX'], promoIds: ['xyp-XY124'], promoSet: 'xyp',
    source: RED_BLUE_COLLECTION('pikachu-ex', 'Pikachu-EX'),
    image: 'https://tcgplayer-cdn.tcgplayer.com/product/123432_in_400x400.jpg',
    shelf: { market: 2995.99, source: TCGPLAYER_SHELF('Red & Blue Collection [Pikachu EX]', 123432), asOf: '2026-11-23' },
    note: 'Red & Blue Collection—Pikachu-EX: four Generations booster packs, a full-art Pikachu-EX promo (XY124) and a Pikachu-EX figure. The published price was $24.99 (PokéBeach\'s 20th-anniversary lineup). The figure and the card holder are accessories and are not modelled. The $2995.99 shelf price is the TCGplayer market on 23 November 2026.',
  },

  // Double Crisis was only sold as a four-pack blister of seven-card packs.
  // The generic booster/display/ETB rows are refused; this row is the product
  // that existed, so the wrapper can actually be opened. TCGplayer lists the
  // single seven-card pack at $428.88 and no blister quote, so the shelf price
  // is four times that — a derived number, not a listing.
  {
    id: 'dc1-blister', setId: 'dc1', name: 'Double Crisis Blister (4 packs)', msrp: 15.96,
    kind: 'special', packs: 4, cardsPerPack: 7, releaseDate: '2015/03/25',
    description: 'Four seven-card Double Crisis packs, the only way the mini-set was sold.',
    promos: [], source: TCGPLAYER_SHELF('Double Crisis Booster Pack', 229226),
    shelf: { market: 1715.52, source: TCGPLAYER_SHELF('Double Crisis Booster Pack', 229226), asOf: '2026-11-08' },
    note: 'Double Crisis was sold only as a four-pack blister; each pack held seven cards. The wrapper is modelled as those four packs. TCGplayer publishes no blister quote, so the $1,715.52 shelf price is four times the single pack\'s $428.88 market on 8 November 2026 and is derived rather than listed.',
  },

  // Dragon Vault was a special expansion sold only as a three-pack blister of
  // five-card packs. Its generic booster/display/ETB/bundle rows are refused;
  // this row is the product that existed, so the packs can be opened.
  {
    id: 'dv1-blister', setId: 'dv1', name: 'Dragon Vault Blister (3 packs)', msrp: 11.97,
    kind: 'special', packs: 3, cardsPerPack: 5, releaseDate: '2012/10/05',
    description: 'Three five-card Dragon Vault packs, the only way the mini-set was sold.',
    promos: [], source: TCGPLAYER_SHELF('Dragon Vault 3 Pack Blister', 98947),
    shelf: { market: 1995.9, source: TCGPLAYER_SHELF('Dragon Vault 3 Pack Blister', 98947), asOf: '2026-11-08' },
    note: 'Dragon Vault was sold only as a three-pack blister; each pack held five cards. The blister added one of five possible Mirror Holofoil variant cards, which is a random accessory rather than a fixed promo, so it is not handed over. The $1,995.90 shelf price is the TCGplayer market for the exact blister on 8 November 2026.',
  },

  // Eight regular ETBs shipped in two arts, each listed as its own box. The
  // original id keeps the first art; the second is a new SKU with its own art,
  // quote and photo.
  ...DUAL_ART_ETB_ROWS,
]

/**
 * Boxes whose wrappers do not all come from one expansion. The opener walks the
 * list in order, so a box deals the mix it really held instead of filling every
 * wrapper from the product's anchor set. Segment counts always sum to the
 * product's `packs` count.
 */
export type PackMix = ReadonlyArray<{
  setId: string
  packs: number
  /** A wrapper of a different size: the UPC's Classic Collection pack holds three. */
  cardsPerPack?: number
}>

export const PACK_MIX: Readonly<Record<string, PackMix>> = {
  'swsh1-etb-plus': [
    { setId: 'swsh1', packs: 3 },
    { setId: 'swsh2', packs: 3 },
    { setId: 'swsh3', packs: 3 },
    { setId: 'swsh4', packs: 3 },
  ],
  'swsh1-etb-plus-zamazenta': [
    { setId: 'swsh1', packs: 3 },
    { setId: 'swsh2', packs: 3 },
    { setId: 'swsh3', packs: 3 },
    { setId: 'swsh4', packs: 3 },
  ],
  // Owner's opening of the box: four each of the first four Sword & Shield
  // sets. https://www.reddit.com/r/PokemonTCG/comments/ju5w1c/
  'swsh1-upc-zacian-zamazenta': [
    { setId: 'swsh1', packs: 4 },
    { setId: 'swsh2', packs: 4 },
    { setId: 'swsh3', packs: 4 },
    { setId: 'swsh4', packs: 4 },
  ],
  // The Hobby Bin's review lists the sixteen wrappers segment by segment.
  // https://thehobbybin.com/blogs/product-reviews/charizard-ultra-premium-collection-review
  'swsh11-upc-charizard': [
    { setId: 'swsh7', packs: 3 },
    { setId: 'swsh8', packs: 3 },
    { setId: 'swsh10', packs: 3 },
    { setId: 'swsh9', packs: 3 },
    { setId: 'swsh11', packs: 2 },
    { setId: 'swsh4', packs: 1 },
    { setId: 'swsh3', packs: 1 },
  ],
  // An opening of the box deals four Paldea Evolved, two Paradox Rift, two
  // Temporal Forces, four Twilight Masquerade and four Stellar Crown.
  // https://www.youtube.com/watch?v=y-lbrQ3MeHI
  'sv6-upc-greninja': [
    { setId: 'sv2', packs: 4 },
    { setId: 'sv4', packs: 2 },
    { setId: 'sv5', packs: 2 },
    { setId: 'sv6', packs: 4 },
    { setId: 'sv7', packs: 4 },
  ],
  // TCG Protectors' observed opening. TPCi publishes the eighteen-pack total,
  // not this split, so the note calls it an observed composition.
  // https://tcgprotectors.com/blogs/pokemon-blog/guide-mega-charizard-x-ex-ultra-premium-collection
  'me2-upc-mega-charizard-x': [
    { setId: 'me2', packs: 4 },
    { setId: 'me1', packs: 4 },
    { setId: 'sv10', packs: 4 },
    { setId: 'sv9', packs: 4 },
    { setId: 'sv8', packs: 2 },
  ],
  // 30th Celebration's Ultra-Premium Collection: the product copy lists 29
  // Celebration packs plus one three-card Classic Collection pack, so the box
  // deals those 29 wrappers and then the subset's own three-card wrapper. The
  // Classic Collection set never had a shelf wrapper (SUBSET_ONLY_SETS), which
  // is why this is a mix and not a set-level rule.
  'me55-upc-day': [
    { setId: 'me55', packs: 29 },
    { setId: 'me55c', packs: 1, cardsPerPack: 3 },
  ],
  'me55-upc-night': [
    { setId: 'me55', packs: 29 },
    { setId: 'me55c', packs: 1, cardsPerPack: 3 },
  ],
  // The box-back pack list. Some write-ups print 3/3/3 for the last three
  // Scarlet & Violet groups, which only totals seventeen; the box back's
  // 2/2/2/2/4/4/2 is the eighteen-pack list used here.
  // https://thehobbybin.com/blogs/pokemon-tcg-guides/moltres-upc-revealed
  'sv10-upc-moltres': [
    { setId: 'sv10', packs: 2 },
    { setId: 'sv9', packs: 2 },
    { setId: 'sv5', packs: 2 },
    { setId: 'sv4', packs: 2 },
    { setId: 'sv3', packs: 4 },
    { setId: 'sv2', packs: 4 },
    { setId: 'sv1', packs: 2 },
  ],
  // The Pikachu V-UNION Special Collection holds six wrappers, not four: four
  // four-card Celebrations packs plus the "2 additional Pokémon TCG boosters,
  // each containing 10 cards and 1 basic Energy" on the box. Published copy
  // never names those two expansions, so the box deals the pair that was on
  // shelves when it shipped in October 2021 — one Chilling Reign and one
  // Evolving Skies wrapper, at the ordinary ten cards each rather than the
  // Celebrations four the rest of the box deals.
  'cel25-pikachu-v-union': [
    { setId: 'cel25', packs: 4 },
    { setId: 'swsh6', packs: 1, cardsPerPack: 10 },
    { setId: 'swsh7', packs: 1, cardsPerPack: 10 },
  ],
  // Every other Celebrations collection has the same split between the four-card
  // packs the set was sold in and the ordinary ten-card boosters its contents
  // list only calls "additional". Published counts: Dragapult Prime 2 + 1,
  // Deluxe Pin 4 + 2, V Memories 6 + 2, Premium Figure 8 + 3, Ultra-Premium
  // 17 + 8. No listing names which expansions the extras came from, so they are
  // dealt Chilling Reign, then Evolving Skies, Battle Styles and Vivid Voltage —
  // the sets on shelves when these boxes shipped in October 2021 — and each
  // product's note says the pick is this build's. The Ultra-Premium Collection's
  // eight extras split two apiece; Fusion Strike shipped after the box, so it is
  // not in the pool.
  'cel25-dragapult-prime': [
    { setId: 'cel25', packs: 2 },
    { setId: 'swsh6', packs: 1, cardsPerPack: 10 },
  ],
  'cel25-deluxe-pin': [
    { setId: 'cel25', packs: 4 },
    { setId: 'swsh6', packs: 1, cardsPerPack: 10 },
    { setId: 'swsh7', packs: 1, cardsPerPack: 10 },
  ],
  'cel25-v-memories': [
    { setId: 'cel25', packs: 6 },
    { setId: 'swsh6', packs: 1, cardsPerPack: 10 },
    { setId: 'swsh7', packs: 1, cardsPerPack: 10 },
  ],
  'cel25-premium-figure': [
    { setId: 'cel25', packs: 8 },
    { setId: 'swsh6', packs: 1, cardsPerPack: 10 },
    { setId: 'swsh7', packs: 1, cardsPerPack: 10 },
    { setId: 'swsh5', packs: 1, cardsPerPack: 10 },
  ],
  'cel25-upc': [
    { setId: 'cel25', packs: 17 },
    { setId: 'swsh6', packs: 2, cardsPerPack: 10 },
    { setId: 'swsh7', packs: 2, cardsPerPack: 10 },
    { setId: 'swsh5', packs: 2, cardsPerPack: 10 },
    { setId: 'swsh4', packs: 2, cardsPerPack: 10 },
  ],
}

export function packMixFor(productId: string): PackMix | null {
  return PACK_MIX[productId] ?? null
}

/** Which expansion — and how many cards — the Nth wrapper of a mixed box holds. */
export function mixedPackSpec(productId: string, index: number): { setId: string; cardsPerPack?: number } | null {
  const mix = PACK_MIX[productId]
  if (!mix) return null
  let i = Math.max(0, Math.floor(index))
  for (const segment of mix) {
    if (i < segment.packs) return { setId: segment.setId, cardsPerPack: segment.cardsPerPack }
    i -= segment.packs
  }
  const last = mix[mix.length - 1]
  return { setId: last.setId, cardsPerPack: last.cardsPerPack }
}

/** Which expansion the Nth wrapper of a mixed box comes from (0-based). */
export function mixedPackSetId(productId: string, index: number): string | null {
  return mixedPackSpec(productId, index)?.setId ?? null
}

// ---------------------------------------------------------------------------
// Pokémon Center Elite Trainer Boxes
// ---------------------------------------------------------------------------
//
// Bulbapedia's Elite Trainer Box page names the format — "11 (PC Scarlet &
// Violet onwards)" packs and "a second Pokémon Center-stamped promo card (PC
// Scarlet & Violet onwards)" — and the Pokémon Center product page for every set
// below prints the same pair: the set's ETB promo and a stamped copy of it, for
// $59.99. The stamp is not a separate catalogue paper, so the box hands the card
// over once, the same simplification the Prismatic Eevee and the Journey
// Together N's Reshiram carry.
const PC_ETB: EvidenceSource = {
  label: 'Bulbapedia — Elite Trainer Box (TCG); Pokémon Center product pages',
  url: 'https://bulbapedia.bulbagarden.net/wiki/Elite_Trainer_Box_(TCG)',
}

/** Every set in this catalogue whose Pokémon Center Elite Trainer Box a source documents. */
export const PC_ETB_SETS: ReadonlySet<string> = new Set([
  ...STANDARD_SETS,
  ...SPECIAL_BUNDLE_SETS,
  ...Object.keys(MEGA_SETS),
])

for (const setId of PC_ETB_SETS) {
  const mega = MEGA_SETS[setId]
  const promos = mega ? mega.promos : ETB_PROMOS[setId] ?? []
  const promoIds = mega ? mega.promoIds : ETB_PROMO_IDS[setId]
  const promoSet = mega ? mega.promoSet : 'svp'
  const cardsPerPack = mega ? mega.cardsPerPack ?? 10 : 10
  evidence[`${setId}-etb-pc`] = {
    packs: 11,
    cardsPerPack,
    promos,
    promoIds,
    promoSet,
    source: PC_ETB,
    note: promos.length === 0
      ? 'Pokémon Center Elite Trainer Box: eleven packs, no promo documented here.'
      : `Pokémon Center Elite Trainer Box: eleven packs and the ${promos.join(' or ')} promo twice — one plain, one with the Pokémon Center logo. The stamp is not a separate catalogue paper, so the box hands the card over once.`,
  }
}

// The Elite Trainer Box line began with Plasma Storm, which held seven packs;
// Plasma Blast added the eighth pack and the sleeves. Plasma Freeze and
// Legendary Treasures explicitly did not receive one, and neither did any
// earlier Black & White expansion.
const BW_ETB_SOURCE: EvidenceSource = {
  label: 'Bulbapedia — Elite Trainer Box (Composition and Black & White list); Plasma Storm and Plasma Blast box copy',
  url: 'https://bulbapedia.bulbagarden.net/wiki/Elite_Trainer_Box_(TCG)',
}
evidence['bw8-etb'] = {
  packs: 7,
  cardsPerPack: 10,
  promos: [],
  source: BW_ETB_SOURCE,
  note: `Plasma Storm Elite Trainer Box: seven packs, the first ETB ever released. It carried no promo card. $${SECONDARY_ETB_SHELF['bw8-etb'].market.toFixed(2)} is PriceCharting's sold-based value for this box, read 13 November 2026.`,
}
evidence['bw10-etb'] = {
  packs: 8,
  cardsPerPack: 10,
  promos: [],
  source: BW_ETB_SOURCE,
  note: `Plasma Blast Elite Trainer Box: eight packs, one more than Plasma Storm and the format every later ETB followed. It carried no promo card. $${SECONDARY_ETB_SHELF['bw10-etb'].market.toFixed(2)} is PriceCharting's sold-based value for this box, read 13 November 2026.`,
}

for (const p of SPECIAL_PRODUCTS) {
  evidence[p.id] = {
    packs: p.packs,
    cardsPerPack: p.cardsPerPack,
    promos: p.promos,
    promoSet: p.promoSet,
    promoIds: p.promoIds,
    promoPolicy: p.promoPolicy,
    source: p.source,
    note: p.note,
  }
}

// The Pokémon Center ETBs the per-set rows generate get their own TCGplayer
// quote, keyed by the box's listing id. Before this table they were the one
// cohort still priced from the pulls inside them, which put Paldea Evolved at
// $104 when its box actually traded near $590. The quote is the marketplace's
// number, not a model's, and every one was read on 8 November 2026.
const PC_SHELF_SOURCE: EvidenceSource = {
  label: 'TCGplayer — Pokémon Center Elite Trainer Box listings',
  url: 'https://www.tcgplayer.com/search/pokemon/product?q=pokemon%20center%20elite%20trainer%20box',
}

export const PC_ETB_SHELF: Readonly<Record<string, { market: number; productId: number }>> = {
  'sv2-etb-pc': { market: 590.13, productId: 493973 },
  'sv3-etb-pc': { market: 616.07, productId: 501266 },
  'sv3pt5-etb-pc': { market: 1152.26, productId: 501999 },
  'sv4pt5-etb-pc': { market: 542.07, productId: 528039 },
  'sv6-etb-pc': { market: 186.2, productId: 543844 },
  'sv6pt5-etb-pc': { market: 160.07, productId: 552998 },
  'sv7-etb-pc': { market: 182.43, productId: 557340 },
  'sv8-etb-pc': { market: 243.74, productId: 565632 },
  'sv8pt5-etb-pc': { market: 381.8, productId: 593324 },
  'sv9-etb-pc': { market: 192.29, productId: 610929 },
  'sv10-etb-pc': { market: 402.8, productId: 624675 },
  'rsv10pt5-etb-pc': { market: 240.97, productId: 630688 },
  'zsv10pt5-etb-pc': { market: 261.05, productId: 630687 },
  'me2-etb-pc': { market: 271.3, productId: 654135 },
  'me2pt5-etb-pc': { market: 323.18, productId: 668497 },
  'me3-etb-pc': { market: 118.33, productId: 672404 },
  'me4-etb-pc': { market: 120.9, productId: 684452 },
  'me5-etb-pc': { market: 114.83, productId: 692949 },
  // The Nov-12 mirror read ($198.20) sat 40% over the Nov-13 marketplace market
  // for the same listing, which is the drift a launch-week read produces; the
  // later, per-product read wins here.
  'me6-etb-pc': { market: 141.44, productId: 712104 },
}

// Regular Elite Trainer Boxes whose real TCGplayer market was never entered.
// They had all fallen through to the model's $32 ETB floor, which made an
// out-of-print Silver Tempest box and an in-print Paldea Evolved box look
// identical. These are exact plain-ETB listing quotes from the TCGcsv mirror's
// 12 November 2026 update; the productId is the same listing the box photo uses.
const REGULAR_ETB_SHELF_SOURCE: EvidenceSource = {
  label: 'TCGplayer — Elite Trainer Box listings (market, via the tcgcsv mirror)',
  url: 'https://www.tcgplayer.com/search/pokemon/product?q=elite%20trainer%20box',
}

export const REGULAR_ETB_SHELF: Readonly<Record<string, { market: number; productId: number }>> = {
  'cel25-etb': { market: 308.25, productId: 242811 },
  'me2-etb': { market: 134.73, productId: 654136 },
  'me2pt5-etb': { market: 124.79, productId: 668496 },
  'me3-etb': { market: 72.16, productId: 672401 },
  'me4-etb': { market: 67.8, productId: 684450 },
  'me5-etb': { market: 71.39, productId: 692947 },
  'me6-etb': { market: 81.96, productId: 712102 },
  'pgo-etb': { market: 166.24, productId: 270708 },
  'rsv10pt5-etb': { market: 143.26, productId: 630689 },
  'sv2-etb': { market: 202.05, productId: 493974 },
  'sv3-etb': { market: 267.7, productId: 501264 },
  'sv3pt5-etb': { market: 492.26, productId: 503313 },
  'sv4pt5-etb': { market: 431.92, productId: 528040 },
  'sv6-etb': { market: 104.17, productId: 543845 },
  'sv6pt5-etb': { market: 112.71, productId: 552999 },
  'sv7-etb': { market: 160.97, productId: 557350 },
  'sv8-etb': { market: 115.75, productId: 565630 },
  'sv8pt5-etb': { market: 114.61, productId: 593355 },
  'sv9-etb': { market: 132.93, productId: 610930 },
  'sv10-etb': { market: 107.02, productId: 624676 },
  'swsh2-etb': { market: 321.17, productId: 210572 },
  'swsh3-etb': { market: 128.43, productId: 216856 },
  'swsh4-etb': { market: 141.64, productId: 221752 },
  'swsh8-etb': { market: 332.39, productId: 247671 },
  'swsh9-etb': { market: 169.64, productId: 256138 },
  'swsh10-etb': { market: 124.29, productId: 265527 },
  'swsh11-etb': { market: 193.31, productId: 277335 },
  'swsh12-etb': { market: 155.92, productId: 283401 },
  'swsh12pt5-etb': { market: 314.66, productId: 453470 },
  'swsh35-etb': { market: 208.75, productId: 218791 },
  'swsh45-etb': { market: 142.89, productId: 228821 },
  'zsv10pt5-etb': { market: 152.85, productId: 630686 },
}

// One snapshot, one provenance, one rule for everything still in print: a pack,
// blister or box sells at TCGplayer's market for that exact listing on
// 13 November 2026, read per product through RiftCompare's TCGplayer feeds.
// Boosters were the odd ones out — the rest of the shelf was quoted while packs
// came from the game's per-pack EV, a model of what the pack holds — so two
// packs on one shelf were answering different questions. Multivariant products
// (sets that shipped several blisters, the five Ascended Heroes mini tins) carry
// the mean of their variants and say so. RiftCompare left three rows unpriced;
// they are read from the tcgcsv mirror in MIRROR_SHELF below, so as of
// 22 November 2026 nothing in print is modelled.
const PACK_SHELF_AS_OF = '2026-11-13'
const PACK_SHELF_SOURCE: EvidenceSource = {
  label: 'TCGplayer market for the exact listing (via RiftCompare)',
  url: 'https://riftcompare.com/pokemon/sets',
}
// 30th Celebration had almost no shelf evidence: its collections fell through
// the 'special' rule, so a mini tin, a poster collection and a premium box all
// carried their own sticker floored by the packs inside, and the two
// Ultra-Premium Collections were a model guess at $311 and $337.
const SNAPSHOT_SHELF: Readonly<Record<string, number>> = {
  'me55-bundle': 60.11,
  'me55-etb': 109.08,
  'me55-etb-pc': 253.93,
  'me55-upc-day': 338.42,
  'me55-upc-night': 376.99,
  'me55-ditto-premium': 81.55,
  'me55-figure-mew': 67.25,
  'me55-figure-mewtwo': 60.28,
  'me55-poster': 28.78,
  'me55-tech-sticker': 33.68,
  'me55-binder': 94.67,
  // The ten mini-tin designs trade $21.58–$25.69; this is their mean.
  'me55-mini-tin': 23.67,
  'me55-knockout': 20.99,
  'me55-sylveon-ex-box': 43.88,
  'me55-greninja-ex-box': 39.9,
  // Two packs for the price of six is what the wrapper really trades at: both
  // sources read it near $60, because the blister itself is the scarce thing.
  'me55-2pack-blister': 61.49,

  // Booster packs — the single-pack market, one rule for the whole shelf.
  'me1-booster': 9.18,
  'me2-booster': 11.92,
  'me2pt5-booster': 10.54,
  'me3-booster': 5.53,
  'me4-booster': 5.32,
  'me5-booster': 5.73,
  'me6-booster': 5.91,
  'me55-booster': 9.28,
  'sv9-booster': 6.76,
  'sv10-booster': 8.13,
  // Single-pack blisters (mean where a set shipped several promos).
  'me1-single-blister': 14.05,
  'me2-single-blister': 13.1,
  'me4-single-blister': 6.85,
  'sv10-single-blister': 10.94,
  // Three-pack blisters (mean where a set shipped several promos).
  'me1-triple-blister': 39.26,
  'me2-triple-blister': 42.39,
  'me4-triple-blister': 21.22,
  'sv10-triple-blister': 40.08,
  // Ascended Heroes' boxes and the five mini tins (the ex tins are other rows).
  'me2pt5-first-partners-pin': 59.67,
  'me2pt5-mega-emboar-box': 50.49,
  'me2pt5-mega-feraligatr-box': 53.11,
  'me2pt5-mega-meganium-box': 47.38,
  'me2pt5-mini-tin': 32.79,
  'me2pt5-tech-sticker': 32.77,
}

// The three rows RiftCompare could not price, read from the tcgcsv mirror —
// TCGplayer's own catalog feed, no key — on 22 November 2026. Two are
// multivariant and carry the mean of their variants, like the rows above.
const MIRROR_AS_OF = '2026-11-22'
const MIRROR_SHELF_SOURCE: EvidenceSource = {
  label: 'TCGplayer market for the exact listing (via the tcgcsv mirror)',
  url: 'https://tcgcsv.com/tcgplayer/3/groups',
}
const MIRROR_SHELF: Readonly<Record<string, number>> = {
  // Collection—Erika's Tangela $28.99 and Collection—Larry's Komala $29.21.
  'me2pt5-2pack-blister': 29.1,
  // Premium Poster Collection: Mega Lucario $140.08, Mega Gardevoir $133.77.
  'me2pt5-premium-poster': 136.93,
  // Journey Together Half Booster Box — the only listing that carries a price.
  'sv9-half-display': 333.33,
}

/** Shelf quotes are keyed by product id; most special products have none. */
const SHELF_PRICES = new Map<string, { market: number; source: EvidenceSource; asOf: string; kind?: ShelfPriceSource }>([
  ...SPECIAL_PRODUCTS.filter((p) => p.shelf).map((p) => [p.id, p.shelf!] as const),
  ...Object.entries(ETB_SHELF).map(
    ([id, q]) => [id, { market: q.market, source: SM_ETB_SOURCE, asOf: '2026-11-08' }] as const,
  ),
  ...Object.entries(PC_ETB_SHELF).map(
    ([id, q]) => [id, { market: q.market, source: PC_SHELF_SOURCE, asOf: '2026-11-08' }] as const,
  ),
  ...Object.entries(REGULAR_ETB_SHELF).map(
    ([id, q]) => [id, { market: q.market, source: REGULAR_ETB_SHELF_SOURCE, asOf: '2026-11-12' }] as const,
  ),
  ...Object.entries(XY_ETB_SHELF).map(
    ([id, q]) => [id, { market: q.market, source: XY_ETB_SOURCE, asOf: '2026-11-08' }] as const,
  ),
  ...Object.entries(SECONDARY_ETB_SHELF).map(
    ([id, q]) =>
      [id, {
        market: q.market,
        source: { label: `PriceCharting — ${q.label} (sold-price value)`, url: q.page },
        asOf: SECONDARY_ETB_AS_OF,
        kind: 'pricecharting' as const,
      }] as const,
  ),
  ...Object.entries(XY_BOOSTER_SHELF).map(
    ([id, q]) =>
      [id, { market: q.market, source: TCGPLAYER_SHELF(q.product, q.productId), asOf: '2026-11-08' }] as const,
  ),
  ...Object.entries(BW_BOOSTER_SHELF).map(
    ([id, q]) =>
      [id, { market: q.market, source: TCGPLAYER_SHELF(q.product, q.productId), asOf: '2026-11-08' }] as const,
  ),
  ...Object.entries(LOOSE_PACK_SHELF).map(
    ([id, q]) =>
      [id, {
        market: q.market,
        source: TCGPLAYER_SHELF(`Loose booster pack (${id.replace('-booster', '')})`, q.productId),
        asOf: '2026-11-22',
        kind: 'tcgplayer' as const,
      }] as const,
  ),
  ...Object.entries(BUNDLE_DISPLAY_SHELF).map(
    ([id, q]) =>
      [id, {
        market: q.market,
        source: TCGPLAYER_SHELF(q.product, q.productId),
        asOf: '2026-11-13',
        kind: 'tcgplayer' as const,
      }] as const,
  ),
  // Last, so the modern snapshot above wins over the older ETB/bundle reads it
  // replaces for the same products.
  ...Object.entries(SNAPSHOT_SHELF).map(
    ([id, market]) => [id, { market, source: PACK_SHELF_SOURCE, asOf: PACK_SHELF_AS_OF, kind: 'tcgplayer' as const }] as const,
  ),
  ...Object.entries(MIRROR_SHELF).map(
    ([id, market]) => [id, { market, source: MIRROR_SHELF_SOURCE, asOf: MIRROR_AS_OF, kind: 'tcgplayer' as const }] as const,
  ),
])

export function shelfPriceFor(productId: string): { market: number; source: EvidenceSource; asOf: string; kind?: ShelfPriceSource } | null {
  return SHELF_PRICES.get(productId) ?? null
}

// Give the evidence note the same provenance the shelf carries. Some older
// displays have no evidence row at all; they keep their generated note and
// still show the source through the shelf price.
for (const [id, quote] of Object.entries(BUNDLE_DISPLAY_SHELF)) {
  const row = evidence[id]
  if (!row) continue
  const kind = id.endsWith('-bundle') ? 'bundle' : 'display'
  row.note += ` $${quote.market.toFixed(2)} is the TCGplayer market for the exact ${kind} listing on 13 November 2026.`
}

export const SEALED_EVIDENCE: Readonly<Record<string, SealedEvidence>> = evidence

export function sealedEvidenceFor(productId: string): SealedEvidence | null {
  return evidence[productId] ?? null
}

/**
 * Catalogue rows that must never be offered for sale even though their set
 * does sell packs. They survive because an old save may already own stock.
 */
/**
 * Rows whose box art genuinely does not exist. TCGplayer lists the Surging
 * Sparks half box but publishes no photo for it: tcgrate states "No image
 * published for this product" and every TCGplayer CDN size answers 403. The
 * shop draws the set symbol for that one rather than borrowing the 36-pack
 * display's picture, and a stale URL from an earlier pass is cleared.
 */
export const ART_LESS_PRODUCTS: Readonly<Record<string, string>> = {
  'sv8-half-display': 'TCGplayer publishes no photo for the Surging Sparks Half Booster Box; its CDN 403s at every size.',
  'swsh10-half-display': 'TCGplayer lists the Astral Radiance Half Booster Box but serves no photo; every CDN size answers 403. The shop draws the set symbol rather than borrowing the full display picture.',
}

/**
 * Sealed rows whose photo is an exact TCGplayer listing the generic pack-art
 * matcher cannot reach. The matcher only knows the four ordinary product kinds;
 * these are collections, tins, blisters and one local-release wave. The value is
 * the TCGplayer product id, not a URL, so the CDN address stays in one place.
 *
 * Where a product shipped in several arts or promos, the catalogue row is one
 * product with a one-of promo list; the photo below is one of those real
 * listings, never a different product with the same set name.
 */
export const PRODUCT_IMAGE_PRODUCT_IDS: Readonly<Record<string, number>> = {
  // 30th Celebration (local release), including both UPCs.
  'me55-upc-day': 704190,
  'me55-upc-night': 704191,
  'me55-ditto-premium': 704189,
  'me55-figure-mew': 704193,
  'me55-figure-mewtwo': 704194,
  'me55-poster': 704153,
  'me55-tech-sticker': 704145,
  'me55-binder': 704169,
  'me55-mini-tin': 704176,
  'me55-knockout': 704152,
  'me55-sylveon-ex-box': 704155,
  'me55-greninja-ex-box': 704168,
  'me55-2pack-blister': 704148,

  // Blisters for Mega Evolution, Chaos Rising and Delta Reign.
  'me1-single-blister': 644358,
  'me1-triple-blister': 644356,
  'me2-single-blister': 654150,
  'me2-triple-blister': 654154,
  'me4-single-blister': 684457,
  'me4-triple-blister': 684458,
  'me6-single-blister': 712108,
  'me6-triple-blister': 712093,

  // Ascended Heroes collections and boxes.
  'me2pt5-tech-sticker': 666908,
  'me2pt5-mini-tin': 668531,
  'me2pt5-premium-poster': 668536,
  'me2pt5-first-partners-pin': 672391,
  'me2pt5-mega-meganium-box': 672733,
  'me2pt5-mega-emboar-box': 672734,
  'me2pt5-mega-feraligatr-box': 672735,
  'me2pt5-2pack-blister': 666906,

  // Scarlet & Violet blister rows, one photo per product family.
  'sv1-single-blister': 478765,
  'sv1-triple-blister': 478761,
  'sv2-single-blister': 493999,
  'sv2-triple-blister': 493997,
  'sv3-single-blister': 501262,
  'sv3-triple-blister': 501260,
  'sv4-single-blister': 514224,
  'sv4-triple-blister': 513434,
  'sv5-single-blister': 536284,
  'sv5-triple-blister': 536227,
  'sv6-single-blister': 544179,
  'sv6-triple-blister': 544171,
  'sv7-single-blister': 557338,
  'sv7-triple-blister': 557334,
  'sv8-single-blister': 565636,
  'sv8-triple-blister': 565634,
  'sv8pt5-2pack-blister': 609716,
  'sv10-single-blister': 633105,
  'sv10-triple-blister': 625683,

  // Older special products whose exact listing exists on TCGplayer.
  'dc1-blister': 97764,
  'dv1-blister': 98947,
  // The 2022 McDonald's pack is listed as the "Match & Battle Pack"; its CDN
  // photo is the sealed wrapper, not a card.
  'mcd22-booster': 282530,
}

/**
 * Product photos that are stable local assets rather than a marketplace CDN.
 * The five products below are real sealed products whose TCGplayer listings
 * carry no image; PriceCharting's product photos are copied into `public/` so
 * the shelf keeps the same picture when the marketplace URL changes.
 */
export const LOCAL_PRODUCT_IMAGES: Readonly<Record<string, string>> = {
  'bw8-etb': '/product-art/bw8-etb.jpg',
  'bw10-etb': '/product-art/bw10-etb.jpg',
  'ecard3-display': '/product-art/ecard3-display.jpg',
  'ecard2-display': '/product-art/ecard2-display.jpg',
  'neo2-display': '/product-art/neo2-display.jpg',
}

/** Product-image URL for a catalogue row, when one is known. */
export function productImageFor(productId: string): string | null {
  const local = LOCAL_PRODUCT_IMAGES[productId]
  if (local) return local
  const imageId = PRODUCT_IMAGE_PRODUCT_IDS[productId]
  return imageId ? `https://tcgplayer-cdn.tcgplayer.com/product/${imageId}_in_400x400.jpg` : null
}

/**
 * Rows whose photo must be exactly the quote's listing, not merely filled in
 * when empty. A two-art box is told apart by its art, so a stale generic photo
 * would undo the split the rows exist to make.
 */
export const ART_EXACT: ReadonlySet<string> = new Set([
  'swsh6-etb-pc', 'swsh6-etb-pc-shadow', 'swsh7-etb-pc', 'swsh7-etb-pc-glaceon',
  'sv1-etb-pc', 'sv1-etb-pc-miraidon', 'sv4-etb-pc', 'sv4-etb-pc-roaring-moon',
  'sv5-etb-pc', 'sv5-etb-pc-walking-wake', 'me1-etb-pc', 'me1-etb-pc-lucario',
  'sm1-etb', 'sm1-etb-lunala', 'sm5-etb', 'sm5-etb-dusk-mane',
  'xy1-etb', 'xy1-etb-yveltal', 'xy5-etb', 'xy5-etb-kyogre',
  'xy8-etb', 'xy8-etb-mewtwo-y', 'xy12-etb', 'xy12-etb-blastoise',
  'swsh1-etb', 'swsh1-etb-zamazenta', 'swsh5-etb', 'swsh5-etb-rapid-strike',
  'swsh6-etb', 'swsh6-etb-shadow-rider', 'swsh7-etb', 'swsh7-etb-glaceon',
  'sv4-etb', 'sv4-etb-roaring-moon', 'sv5-etb', 'sv5-etb-iron-leaves',
  'sv1-etb', 'sv1-etb-miraidon', 'me1-etb', 'me1-etb-gardevoir',
])

const SWSH_NO_BUNDLE = 'Sword & Shield did not ship a six-pack Booster Bundle before Lost Origin; the bundles in this era began with that set.'

const SM_NO_BUNDLE = 'Sun & Moon did not ship a six-pack Booster Bundle; the era sold packs, 36-pack displays and Elite Trainer Boxes.'

const XY_NO_BUNDLE = 'XY did not ship a six-pack Booster Bundle; TCGplayer lists no bundle for any XY expansion, only packs, 36-pack displays and Elite Trainer Boxes.'
const XY_BUNDLE_LESS = ['xy0', 'xy1', 'xy2', 'xy3', 'xy4', 'xy5', 'xy6', 'xy7', 'xy8', 'xy9', 'xy10', 'xy11', 'xy12', 'g1', 'dc1']

const BW_NO_BUNDLE = 'Black & White did not ship a six-pack Booster Bundle; TCGplayer lists no bundle for any expansion in the era.'
const BW_BUNDLE_LESS = ['bw1', 'bw2', 'bw3', 'bw4', 'bw5', 'bw6', 'bw7', 'bw8', 'bw9', 'bw10', 'bw11', 'dv1']
const BW_NO_ETB = 'The Elite Trainer Box line began with Plasma Storm; this Black & White expansion never shipped one.'
const SM_SPECIAL_NO_DISPLAY = (name: string, detail: string) =>
  `${name} never shipped a 36-pack Booster Display; it was sold in its ten-pack Elite Trainer Box and ${detail}.`

/**
 * Products no shelf ever carried. The catalogue no longer generates these
 * rows, and `ensureFullCatalog()` deletes any a legacy save still holds: a
 * product that was never printed does not belong in a product table, even
 * hidden. The reasons stay here because they are what blocks regeneration.
 */
export const UNSELLABLE_PRODUCTS: Readonly<Record<string, string>> = {
  'sv3pt5-display': 'Scarlet & Violet—151 never shipped a 36-pack Booster Display; the set was sold in packs, bundles, ETBs and collection products.',
  'me55-display': '30th Celebration never shipped a 36-pack Booster Display; the official product showcase lists packs, bundles, ETBs, collections and mini tins instead.',
  // Sword & Shield: no bundle before Lost Origin, and the two special sets had
  // only an ETB — no bundle and no 36-pack display.
  'swsh1-bundle': SWSH_NO_BUNDLE,
  'swsh2-bundle': SWSH_NO_BUNDLE,
  'swsh3-bundle': SWSH_NO_BUNDLE,
  'swsh4-bundle': SWSH_NO_BUNDLE,
  'swsh5-bundle': SWSH_NO_BUNDLE,
  'swsh6-bundle': SWSH_NO_BUNDLE,
  'swsh7-bundle': SWSH_NO_BUNDLE,
  'swsh8-bundle': SWSH_NO_BUNDLE,
  'swsh9-bundle': SWSH_NO_BUNDLE,
  'swsh10-bundle': SWSH_NO_BUNDLE,
  'swsh35-bundle': SWSH_NO_BUNDLE,
  'swsh45-bundle': SWSH_NO_BUNDLE,
  'swsh35-display': 'Champion\'s Path never shipped a 36-pack Booster Display; the set was sold in packs, the ETB and the Gym pin collections.',
  'swsh45-display': 'Shining Fates never shipped a 36-pack Booster Display; the set was sold in packs, the ETB, tins and the Mad Party pin collections.',

  // Sun & Moon: no six-pack bundle anywhere in the era, no display for the
  // three special expansions, and Detective Pikachu was never a booster set at
  // all — its four-card packs came inside Case Files and collections.
  ...Object.fromEntries(
    ['sm1', 'sm2', 'sm3', 'sm4', 'sm5', 'sm6', 'sm7', 'sm8', 'sm9', 'sm10', 'sm11', 'sm12', 'sm35', 'sm75', 'sm115', 'det1'].map(
      (setId) => [`${setId}-bundle`, SM_NO_BUNDLE],
    ),
  ),
  'sm35-display': SM_SPECIAL_NO_DISPLAY('Shining Legends', 'its collection and pin boxes'),
  'sm75-display': SM_SPECIAL_NO_DISPLAY('Dragon Majesty', 'its collection and pin boxes'),
  'sm115-display': SM_SPECIAL_NO_DISPLAY('Hidden Fates', 'its tins and collection boxes'),
  'det1-display': 'Detective Pikachu never shipped a 36-pack Booster Display; its four-card packs were sold inside Case Files and collections.',
  'det1-etb': 'Detective Pikachu never shipped an Elite Trainer Box; the set’s packs came inside the Case Files, tins and collections.',

  // XY: no six-pack bundle anywhere in the era. Kalos Starter Set was three
  // 39-card decks with no boosters at all; Generations packs only came inside
  // collections and its ETB, never a display; Double Crisis was seven-card
  // packs sold only in four-pack blisters, a shape this build does not model.
  ...Object.fromEntries(XY_BUNDLE_LESS.map((setId) => [`${setId}-bundle`, XY_NO_BUNDLE])),
  'xy0-booster': 'Kalos Starter Set was sold as three 39-card decks; it never had booster packs.',
  'xy0-display': 'Kalos Starter Set never shipped a 36-pack display; it was sold as three 39-card decks.',
  'xy0-etb': 'Kalos Starter Set never shipped an Elite Trainer Box; it was sold as three 39-card decks.',
  'g1-booster': 'Generations packs were not sold individually; they came inside Mythical Pokémon and Red & Blue collections.',
  'g1-display': 'Generations never shipped a 36-pack display; its packs came inside collections and the ten-pack ETB.',
  'dc1-booster': 'Double Crisis packs were only sold inside four-pack blisters; this build does not model that blister.',
  'dc1-display': 'Double Crisis never shipped a 36-pack display; its seven-card packs came only in four-pack blisters.',
  'dc1-etb': 'Double Crisis never shipped an Elite Trainer Box; its packs came only in four-pack blisters.',

  // Black & White: no bundles anywhere, and only Plasma Storm and Plasma Blast
  // shipped an ETB. Dragon Vault existed only as a three-pack blister of
  // five-card packs, which is modelled as its own row.
  ...Object.fromEntries(BW_BUNDLE_LESS.map((setId) => [`${setId}-bundle`, BW_NO_BUNDLE])),
  ...Object.fromEntries(
    ['bw1', 'bw2', 'bw3', 'bw4', 'bw5', 'bw6', 'bw7', 'bw9', 'bw11', 'dv1'].map((setId) => [`${setId}-etb`, BW_NO_ETB]),
  ),
  'dv1-booster': 'Dragon Vault packs were only sold inside three-pack blisters; the set never had a standalone booster pack.',
  'dv1-display': 'Dragon Vault never shipped a 36-pack display; its five-card packs came only in three-pack blisters.',

  // Hidden Fates' Shiny Vault is a subset that only exists inside Hidden Fates
  // packs, so none of the four generic rows was ever a real product.
  'sma-booster': 'Hidden Fates Shiny Vault was never sold as a booster pack; its cards only came inside Hidden Fates packs.',
  'sma-bundle': 'Hidden Fates Shiny Vault never shipped a Booster Bundle; its cards only came inside Hidden Fates packs.',
  'sma-display': 'Hidden Fates Shiny Vault never shipped a Booster Display; its cards only came inside Hidden Fates packs.',
  'sma-etb': 'Hidden Fates Shiny Vault never shipped an Elite Trainer Box; its cards only came inside Hidden Fates packs.',

  // Products the era template generated that no source can back. Three line
  // facts decide them: the Elite Trainer Box line began with Plasma Storm in
  // 2013 and shipped one box every other expansion at first; a six-pack
  // Booster Bundle first appeared with Lost Origin in 2022; and a special set
  // was sold through ETBs, tins and collections, never a 36-pack display.
  // Call of Legends is the oldest set the modern era rule touches, so it
  // inherited all three shapes it predates.
  'col1-etb': 'Call of Legends shipped in 2011, before the Elite Trainer Box line began with Plasma Storm; no box was printed.',
  'col1-bundle': 'Call of Legends predates the Booster Bundle, which first shipped with Lost Origin in 2022.',
  'xy2-etb': 'Flashfire did not receive an Elite Trainer Box; the early line shipped one box every other expansion and skipped it, as it had Plasma Freeze and Legendary Treasures.',

  // Detective Pikachu was a movie mini-set sold only inside Case Files and a
  // Collector Chest, each holding four-card packs. Its ETB and display rows are
  // already refused above; the bundle is the remaining generated shape.
  'det1-bundle': 'Detective Pikachu was sold as Case Files and a Collector Chest, never a Booster Bundle.',

  // Celebrations and Pokémon GO are special sets: their official product lists
  // name collections, tins, an ETB and a UPC, or packs, an ETB, tins and
  // collections. Neither ever shipped a booster box, and neither had a bundle.
  'cel25-bundle': "Celebrations' product line was collections, mini tins, an Elite Trainer Box and the Ultra-Premium Collection; no Booster Bundle was made.",
  'cel25-display': 'Celebrations packs were only sold inside collections, so the set never had a 36-pack Booster Display.',
  'pgo-bundle': 'Pokémon GO never shipped a Booster Bundle; that product first appeared with Lost Origin.',
  'pgo-display': 'Pokémon GO was a special set sold in packs, an Elite Trainer Box, tins and collections; it never had a 36-pack Booster Display.',

  // The McDonald's promotions were four-card Happy Meal packs. No year shipped
  // a bundle, display or Elite Trainer Box around them.
  'mcd21-bundle': 'McDonald’s Collection 2021 was four-card Happy Meal packs; the promotion never shipped a Booster Bundle.',
  'mcd21-display': 'McDonald’s Collection 2021 was four-card Happy Meal packs; the promotion never shipped a 36-pack display.',
  'mcd21-etb': 'McDonald’s Collection 2021 was four-card Happy Meal packs; the promotion never shipped an Elite Trainer Box.',
  'mcd22-bundle': 'McDonald’s Collection 2022 was four-card Happy Meal packs; the promotion never shipped a Booster Bundle.',
  'mcd22-display': 'McDonald’s Collection 2022 was four-card Happy Meal packs; the promotion never shipped a 36-pack display.',
  'mcd22-etb': 'McDonald’s Collection 2022 was four-card Happy Meal packs; the promotion never shipped an Elite Trainer Box.',
}

export function unsellableReason(productId: string): string | null {
  return UNSELLABLE_PRODUCTS[productId] ?? null
}
