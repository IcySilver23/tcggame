// Phase 12 identification: the shiny tier's papers, named from sources before any of
// them is painted.
//
// Three families arrive under three similar words and turn out to be four different
// papers:
//
//   Shining Pokémon         Neo Revelation's two English cards were Cosmos holofoils.
//                           Neo Destiny replaced that with "a unique metallic sheen
//                           covering the Pokémon itself", and Shining Legends repeated
//                           that look in 2017. The 2021/2026 reprints are separate
//                           products again.
//   Pokémon ★ (Gold Star)   introduced in EX Team Rocket Returns: "Golden tinges and
//                           holographic shadows are added to various parts of the card".
//   Radiant Pokémon         Astral Radiance onward: "a special holofoil layer", etched
//                           silver over the whole card. NOT Radiant Collection (2013).
//   Shiny Vault / Shiny Rare  a documented finish and no documented repeat.
//
// Nothing here paints. `printing-db.ts` reads this table at branch 1g, so a claim here is
// what the renderer resolves to: a claim with a `pattern` uses it, a verified claim whose
// paper no source names uses `special-treatment`, and an unresolved one uses `unresolved`.
// Both of the last two ship no texture, so those cards draw plain foil rather than a
// borrowed sheet. `reports/shiny-printings.md` compares the two files row for row.
//
// One rule carried over from every other paper in this build: a pattern is named only
// when a source names it, and a sheet is borrowed never. The Shiny Vault rows in
// particular must not inherit `starlight` — that is the 1999 Base/Jungle/Fossil paper,
// and a star-like look is not evidence of the same sheet twenty years later.

import type { PrintingRule, PrintingStatus } from './printing-db'
import type { FoilPatternId } from './patterns'

export type ShinyFamily = 'shining' | 'gold-star' | 'radiant-pokemon' | 'shiny-vault'

export const SHINY_FAMILY_LABEL: Record<ShinyFamily, string> = {
  shining: 'Shining Pokémon',
  'gold-star': 'Pokémon ★ (Gold Star)',
  'radiant-pokemon': 'Radiant Pokémon (2022)',
  'shiny-vault': 'Shiny Vault / Shiny Rare',
}

/**
 * Where the foil lands, in the sources' own terms.
 *
 * `pokemon-only` is a real area this build cannot cut: it needs the subject segmented out
 * of the illustration, which no mask here does. Naming it is still worth doing — it stops
 * the illustration window from being assumed, and it is the same gap the EX-era reverse
 * papers disclose as `approximated`.
 */
export type ShinyArea = 'art-window' | 'pokemon-only' | 'whole-card' | 'various-parts' | 'unspecified'

export type ShinyClaim = {
  id: string
  family: ShinyFamily
  label: string
  /** Catalogue set ids this claim covers. */
  sets: readonly string[]
  /** Rarity strings that select the family inside those sets, when the set is not enough. */
  rarities?: readonly string[]
  /** Name filter for reprint sets, where one card is the only member. */
  namePattern?: RegExp
  /** Explicit card ids, so a claim resolves even when the caller passes no card name. */
  cardIds?: readonly string[]
  /** Rows `data/tcglife.db` holds for this claim; asserted by `tmp/check-shiny.ts`. */
  expected: number
  /** What the sources call the foil, in their words, plus what they leave unnamed. */
  paper: string
  /** A registry row when a source names a paper this build knows; null when it names none. */
  pattern: FoilPatternId | null
  area: ShinyArea
  /** True only when a source describes the foil's AREA for this printing. */
  areaVerified: boolean
  status: PrintingStatus
  matchedRule: PrintingRule
  source: string
  note: string
}

const BULBA_RARITY = 'https://bulbapedia.bulbagarden.net/wiki/Rarity'
const BULBA_SHINING = 'https://bulbapedia.bulbagarden.net/wiki/Shining_Pok%C3%A9mon_(TCG)'
const BULBA_COSMOS = 'https://bulbapedia.bulbagarden.net/wiki/Cosmos_Holofoil_(TCG)'
const FLIPSIDE =
  'https://flipsidegaming.com/blogs/pokemon-blog/shining-bright-like-a-diamond-the-return-of-shining-pokemon'
const POKEGACHA = 'https://pokegacha.net/guides/holo-types'
const PKMN_SHINING_LEGENDS =
  'https://www.pokemon.com/us/pokemon-tcg/product-gallery/shining-legends-super-premium-collection-featuring-ho-oh'
const BULBA_HIDDEN_FATES = 'https://bulbapedia.bulbagarden.net/wiki/Hidden_Fates_(TCG)'
const BULBA_SHINING_FATES = 'https://bulbapedia.bulbagarden.net/wiki/Shining_Fates_(TCG)'
const POKEBEACH_PALDEAN_FATES =
  'https://www.pokebeach.com/2024/01/paldean-fates-set-guide-card-list-secret-rares-cut-cards-products-and-more'
const BLEEDINGCOOL_PALDEAN_FATES =
  'https://bleedingcool.com/games/the-english-language-pokemon-tcg-finally-out-foiled-japan'
const CARDVEIL_HOLO = 'https://www.cardveil.com/resources/pokemon-holo-patterns'
const BULBA_CLASSIC_COLLECTION = 'https://bulbapedia.bulbagarden.net/wiki/Classic_Collection_(TCG)'

/** Every rarity string the shiny families use. Also the sweep `unclaimed` rows are found by. */
export const SHINY_RARITIES: readonly string[] = [
  'Rare Shining',
  'Rare Holo Star',
  'Radiant Rare',
  'Rare Shiny',
  'Rare Shiny GX',
  'Shiny Rare',
  'Shiny Ultra Rare',
]

/**
 * The Shiny Vault search, recorded once because all three printings share it.
 *
 * The question was asked directly of the sources: does anything name a paper for the
 * embossed/etched finish? Bulbapedia opens its Cosmos page "often referred to as Galaxy
 * Holofoil"; folio.fyi's pattern guide answers that galaxy is another name for Cosmos and
 * files "textured or etched" as relief pressed into the card, "not a fourteenth pattern".
 * So the one name collectors use for Shiny Vault foil is the Cosmos nickname, and the
 * finish itself is a treatment rather than a sheet. The family is refused a paper, not
 * lent one — and a source that ever names a distinct stock would reopen it.
 */
const SHINY_VAULT_UNNAMED =
  'The search for a named paper is recorded: Bulbapedia opens its Cosmos page "often referred to as Galaxy Holofoil", and folio.fyi\'s pattern guide answers that galaxy is "another name for Cosmos" while filing "textured or etched" as relief "not a fourteenth pattern". So the one name offered for this finish is the Cosmos nickname, and the finish is a treatment rather than a sheet; borrowing Cosmos would put a 2011 paper on a 2019 card. What the finish does earn is relief: `surface-textures.ts` routes these rarities to their own granular `sparkle` normal map, so the card renders embossed while no sheet is borrowed.'

export const SHINY_CLAIMS: readonly ShinyClaim[] = [
  {
    id: 'shining-neo-revelation',
    family: 'shining',
    label: 'Shining · Neo Revelation',
    sets: ['neo3'],
    rarities: ['Rare Shining'],
    expected: 2,
    paper: 'Cosmos Holofoil, in the illustration window',
    pattern: 'cosmos-retro',
    area: 'art-window',
    areaVerified: true,
    status: 'verified',
    matchedRule: 'explicit',
    source: BULBA_COSMOS,
    note: 'Bulbapedia names Shining Gyarados and Shining Magikarp as Cosmos holofoils, and a standard Cosmos holo rare foils the illustration window. These are the English printings: the Japanese versions carried a full-card foil pattern, which is a different physical card and belongs to the language axis, not to this row.',
  },
  {
    id: 'shining-neo-destiny',
    family: 'shining',
    label: 'Shining · Neo Destiny',
    sets: ['neo4'],
    rarities: ['Rare Shining'],
    expected: 8,
    paper: 'A metallic sheen over the Pokémon itself — the sheet is unnamed',
    pattern: null,
    area: 'pokemon-only',
    areaVerified: true,
    status: 'verified',
    matchedRule: 'explicit',
    source: FLIPSIDE,
    note: 'Bulbapedia: the artwork carries "a reflective foil treatment on the Pokémon itself". Flipside Gaming describes the set replacing Neo Revelation\'s full-card pattern with "a unique metallic sheen covering the Pokémon itself". The area is documented and the paper is not, so no sheet is borrowed — and the 2002 Cosmos era rule must not answer here, because the foil is the Pokémon rather than the window.',
  },
  {
    id: 'shining-legends',
    family: 'shining',
    label: 'Shining · Shining Legends',
    sets: ['sm35'],
    rarities: ['Rare Shining'],
    expected: 6,
    paper: 'The Neo Destiny sheen repeated, described as special textured foil',
    pattern: null,
    area: 'pokemon-only',
    areaVerified: true,
    status: 'verified',
    matchedRule: 'explicit',
    source: FLIPSIDE,
    note: 'Flipside Gaming: the Neo Destiny look "was replicated in the Shining Legends expansion". Bulbapedia: their holographic pattern "is similar to the ones released in Neo Destiny". A card-list site calls the finish "special textured foil", which is appearance rather than a named sheet, so the paper stays unnamed and no texture is borrowed.',
  },
  {
    id: 'shining-celebrations-magikarp',
    family: 'shining',
    label: 'Shining · Celebrations reprint',
    sets: ['cel25c'],
    namePattern: /^Shining /,
    cardIds: ['cel25c-66_A'],
    expected: 1,
    paper: 'Special textured foil treatment; the area is not restated',
    pattern: null,
    area: 'unspecified',
    areaVerified: false,
    status: 'verified',
    matchedRule: 'explicit',
    source: BULBA_SHINING,
    note: 'Bulbapedia: Shining Magikarp "was re-released with a Pokémon 25th Anniversary stamp and special textured foil treatment in the Celebrations special expansion as a Classic Collection retro card." The finish is named, the area is not, so this row claims no mask rather than inheriting Neo Destiny\'s.',
  },
  {
    id: 'shining-30th-celebi',
    family: 'shining',
    label: 'Shining · 30th Celebration reprint',
    sets: ['me55c'],
    namePattern: /^Shining /,
    cardIds: ['me55c-106'],
    expected: 1,
    paper: 'Textured confetti Holofoil — the Classic Collection paper',
    pattern: 'confetti',
    area: 'unspecified',
    areaVerified: false,
    status: 'verified',
    matchedRule: 'explicit',
    source: BULBA_CLASSIC_COLLECTION,
    note: 'Bulbapedia on this printing: "The 30th Celebration reprint features a gold border, a glittery Holofoil finish, and the Pokémon 30th Anniversary logo", and on the subset: "Classic Collection cards have a textured confetti holofoil pattern", with a golden border in the Mega Evolution Series. That is the registry row this build files as Pixel / Confetti, so the paper is named rather than inherited from Neo Destiny or Celebrations. No source states which cells of the face carry it, so no area is claimed, and the HD Cosmos the database used to guess for this set is gone.',
  },
  {
    id: 'shining-sm-promos',
    family: 'shining',
    label: 'Shining · SM Black Star Promos',
    sets: ['smp'],
    namePattern: /^Shining /,
    cardIds: ['smp-SM70', 'smp-SM79', 'smp-SM82'],
    expected: 3,
    paper: '"Foil promo card" — neither paper nor area is named',
    pattern: null,
    area: 'unspecified',
    areaVerified: false,
    status: 'verified',
    matchedRule: 'explicit',
    source: PKMN_SHINING_LEGENDS,
    note: 'Shining Ho-Oh (SM70), Shining Celebi (SM79) and Shining Lugia (SM82) shipped in the Shining Legends Super-Premium Collection: "a never-before-seen foil promo card featuring Shining Ho-Oh" and "2 never-before-seen foil promo cards featuring Shining Lugia and Shining Celebi". "Foil" is the whole of the product copy\'s claim, so the paper and its area stay unnamed.',
  },
  {
    id: 'gold-star',
    family: 'gold-star',
    label: 'Pokémon ★ · EX era',
    sets: ['ex7', 'ex8', 'ex10', 'ex11', 'ex12', 'ex13', 'ex14', 'ex15', 'ex16'],
    rarities: ['Rare Holo Star'],
    expected: 25,
    paper: 'Gold-tinted holo — "golden tinges and holographic shadows" on various parts',
    pattern: 'special-treatment',
    area: 'various-parts',
    areaVerified: false,
    status: 'verified',
    matchedRule: 'explicit',
    source: BULBA_RARITY,
    note: 'Bulbapedia on Pokémon ★: "Golden tinges and holographic shadows are added to various parts of the card", under the rarity rare Holo ☆. "Various parts" is not a rectangle, so no mask is claimed — the illustration window must not be assumed. `special-treatment` is the registry row for an identified paper with no sheet; it ships no texture, so these cards render plain foil instead of borrowing an era paper.',
  },
  {
    id: 'radiant-pokemon',
    family: 'radiant-pokemon',
    label: 'Radiant Pokémon · Astral Radiance onward',
    sets: ['swsh10', 'swsh11', 'swsh12', 'swsh12pt5', 'pgo'],
    rarities: ['Radiant Rare'],
    expected: 15,
    paper: 'Etched, embossed silver foil over the whole card, with a textured figure',
    pattern: 'radiant-etched',
    area: 'whole-card',
    areaVerified: true,
    status: 'verified',
    matchedRule: 'explicit',
    source: BULBA_RARITY,
    note: 'Bulbapedia: Radiant Pokémon "have a special holofoil layer" and the rarity Radiant rare, introduced in Astral Radiance. A collector guide describes the finish as "etched, embossed silver foil covering the entire card"; a second account puts textured foil on the Pokémon figure with a geometric pattern running through the card body. The area is the whole face on two sources. The paper is now painted: `radiant-etched` samples a procedural etched lattice written to `public/foil/radiant-etched/sheet.png`, and `textureVerified` is false there, so the identification and the reproduction stay separate claims. NOT Radiant Collection: that is the 2013 Legendary Treasures / Generations RC subset with one motif per card (`radiant`), and the two must never share a lookup.',
  },
  {
    id: 'shiny-vault-hidden-fates',
    family: 'shiny-vault',
    label: 'Shiny Vault · Hidden Fates',
    sets: ['sma'],
    rarities: ['Rare Shiny', 'Rare Shiny GX'],
    expected: 80,
    paper: 'A special embossed Holofoil treatment — the repeat is unnamed',
    pattern: null,
    area: 'unspecified',
    areaVerified: false,
    status: 'verified',
    matchedRule: 'explicit',
    source: BULBA_HIDDEN_FATES,
    note: 'Shiny Vault is the Shiny Pokémon subset: 45 Rare Shiny cards and 35 shiny printings of GX Pokémon under Rare Shiny GX, and Bulbapedia says of the subset that "All have a special embossed Holofoil treatment." The finish is documented; the repeat is not, and no source states the foil area, so this row claims no pattern and no mask. Two collector guides call the look "Galaxy holo", but that label is documented as another name for Cosmos — the 2000-2011 sheet — so adopting it would put a 2011 paper on a 2019 card. ' + SHINY_VAULT_UNNAMED,
  },
  {
    id: 'shiny-vault-shining-fates',
    family: 'shiny-vault',
    label: 'Shiny Vault · Shining Fates',
    sets: ['swsh45sv'],
    rarities: ['Rare Shiny'],
    expected: 104,
    paper: 'The same special embossed Holofoil treatment, described as etched',
    pattern: null,
    area: 'unspecified',
    areaVerified: false,
    status: 'verified',
    matchedRule: 'explicit',
    source: BULBA_SHINING_FATES,
    note: 'Bulbapedia: the Shiny Rare rarity "was introduced in Shining Fates" and "is used for all cards in the Shiny Vault subset", and the set page says those Shiny Pokémon "have a special embossed Holofoil treatment" while the product copy promises "beautiful etched cards". The finish is documented; the repeat and the foil area are not, so no sheet and no mask are claimed. "Galaxy holo" is documented as another name for Cosmos, not a 2021 paper. ' + SHINY_VAULT_UNNAMED,
  },
  {
    id: 'shiny-vault-paldean-fates',
    family: 'shiny-vault',
    label: 'Shiny Vault · Paldean Fates',
    sets: ['sv4pt5'],
    rarities: ['Shiny Rare', 'Shiny Ultra Rare'],
    expected: 132,
    paper: 'A holographic silver textured foil border, with textured artwork',
    pattern: null,
    area: 'unspecified',
    areaVerified: false,
    status: 'verified',
    matchedRule: 'explicit',
    source: POKEBEACH_PALDEAN_FATES,
    note: 'Bulbapedia: "Paldean Fates introduces a second rendition of Shiny Rare ... It uses a single hollow gold star", and Shiny Ultra Rare marks shiny printings of normally Ultra Rare cards. The finish is documented outside Bulbapedia: Bleeding Cool reports that the "Baby Shiny" cards carry a "holographic, silver, textured foil border" which Japan did not get, and PokéBeach confirms that "The shiny Pokemon in our set have holo borders ... Both feature textured artwork." So the treatment is identified while the repeat is not, and a border plus textured artwork is not a mask this build can cut, so the area stays unclaimed. "Galaxy holo" is refused for the same reason: it is another name for Cosmos. ' + SHINY_VAULT_UNNAMED,
  },
]

/**
 * The pattern a claim resolves to.
 *
 * A claim's `pattern` is what a source named. When it names none, the row still knows the
 * card is foil, so it takes the registry's honest stand-in: `special-treatment` for a
 * treatment a source describes but no sheet exists for, and `unresolved` when even the paper
 * is unknown. `printing-db.ts` and the report both call this, so they cannot disagree about
 * what "this claim resolves to" means.
 */
export function shinyPatternFor(claim: ShinyClaim): FoilPatternId {
  return claim.pattern ?? (claim.status === 'unresolved' ? 'unresolved' : 'special-treatment')
}

export type ShinyCardRow = { cardId: string; setId: string; rarity: string | null; name: string }

/** Every claim a card row satisfies. A row should satisfy exactly one. */
export function shinyClaimsFor(row: ShinyCardRow): ShinyClaim[] {
  return SHINY_CLAIMS.filter((claim) => {
    if (!claim.sets.includes(row.setId)) return false
    if (claim.rarities && !(row.rarity !== null && claim.rarities.includes(row.rarity))) return false
    if (claim.cardIds && !claim.cardIds.includes(row.cardId)) return false
    // A name is a guard, not a requirement: `printingFor` often runs without one, and the
    // claim's card ids are what select the reprint. When a name IS supplied it must agree.
    if (claim.namePattern && row.name && !claim.namePattern.test(row.name)) return false
    return true
  })
}

export function shinyClaimFor(row: ShinyCardRow): ShinyClaim | null {
  return shinyClaimsFor(row)[0] ?? null
}

/** Rows this table expects `data/tcglife.db` to hold. */
export const SHINY_ROW_TOTAL = SHINY_CLAIMS.reduce((n, claim) => n + claim.expected, 0)

/** Distinct catalogue sets the table reads. */
export const SHINY_SETS: readonly string[] = [...new Set(SHINY_CLAIMS.flatMap((claim) => claim.sets))]
