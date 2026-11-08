// The printing database: which physical card wears which foil.
//
// This answers one question per printing — "what foil is on THIS card?" — and
// keeps the answer's evidence attached. Everything downstream (holo.ts,
// mask.ts, mark-field.ts, the overlay) reads it instead of guessing from set and
// rarity alone, which is what the earlier era heuristic did.
//
// Three rules govern the data, and they are the whole reason this file exists:
//
//  1. A set-level rule is used only where a source states it. Bulbapedia says
//     Cosmos was the default Holofoil for all Holo cards from Base Set 2 (Feb
//     2000) to Call of Legends (Feb 2011), replaced by Tinsel with Black & White.
//     That licenses a set table for those expansions — and nothing more.
//  2. A promo needs its own evidence. "Cosmos is common on promos" does not say
//     which promo, so promo sets are NOT blanket-assigned: each entry below comes
//     from a catalogue that names the card and its product.
//  3. An explicit printing beats a set rule, and anything unresolved stays
//     unresolved. The database is allowed to say "I do not know".
//
// Status vocabulary:
//   verified    a source names this printing (or its set rule) and its foil
//   inferred    a verified set rule extended to a card the source did not name
//   modelled    this build's own choice, with no external source (disclosed)
//   unresolved  the foil is genuinely unknown here — and no Cosmos is applied
//
// A separate `maskVerified` records whether the foil AREA is documented, because
// "this card is Cosmos" and "the foil covers this rectangle" are different
// claims with different evidence. Promos are commonly verified for the first and
// not the second.
//
// Sources:
//   https://bulbapedia.bulbagarden.net/wiki/Cosmos_Holofoil_(TCG)
//   https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)
//   https://pokumon.com/holofoil/cosmos/
//   https://sleevenocardbehind.com/pokemon-151-secret-variants/

import type { CosmosVariantId } from './cosmos-index'
import type { FoilPatternId } from './patterns'
import { isCosmosPattern } from './patterns'
import { TINSEL_SETS } from './tinsel-index'
import { DELTA_SPECIES_HOLO_RARES } from './delta-species-index'
import { PROMO_CATALOGUE, promoClaimFor } from './promo-db'
import {
  PROMO_BUCKET_SETS,
  promoBucketClaimFor,
  type PromoTreatment,
} from './promo-buckets-db'
import { shinyClaimFor, shinyPatternFor } from './shiny-db'
import { energyReverseFor } from './reverse-energy-large-db'
import { reverseConfigFor, reverseEligible, reversePatternFor } from './reverse-db'

export const PRINTING_DB_VERSION = 1

export const SOURCES = {
  bulbapediaCosmos: 'https://bulbapedia.bulbagarden.net/wiki/Cosmos_Holofoil_(TCG)',
  bulbapediaHolofoil: 'https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)',
  bulbapediaRarity: 'https://bulbapedia.bulbagarden.net/wiki/Rarity',
  pokumon: 'https://pokumon.com/holofoil/cosmos/',
  sleevenocardbehind: 'https://sleevenocardbehind.com/pokemon-151-secret-variants/',
} as const

export type PrintingLanguage = 'en' | 'ja' | 'ko' | 'zh' | 'fr' | 'de' | 'it' | 'es' | 'pt'

/** Only English is catalogued. Other languages make no claim rather than a guess. */
export const CATALOGUED_LANGUAGES: PrintingLanguage[] = ['en']

/**
 * The physical versions this database distinguishes. `promo` is its own
 * variant because a promotional printing is a different product even when the
 * foil matches an expansion card. Alternate, stamped, textured, full-art and
 * special-illustration printings are currently separated by pattern, mask and
 * product; they get their own values only when a catalogue identifies one.
 */
export type PrintingVariant = 'holo' | 'reverse' | 'non-holo' | 'promo' | 'special' | 'sequin'

/** The two Cosmos papers, and the texture this build reproduces each with. */
export type CosmosPaperId = 'cosmos-retro' | 'cosmos-hd'
export const COSMOS_TEXTURE_FOR: Record<CosmosPaperId, CosmosVariantId> = {
  'cosmos-retro': 'classic_dense',
  'cosmos-hd': 'modern_fine',
}
export type PrintingStatus = 'verified' | 'inferred' | 'modelled' | 'unresolved'

/** How each promotional-bucket treatment is named, and the pattern it resolves to. */
const BUCKET_PATTERN: Record<Exclude<PromoTreatment, 'non-holo'>, FoilPatternId> = {
  cosmos: 'cosmos-retro',
  tinsel: 'tinsel',
  'cracked-ice': 'crackedice',
  crosshatch: 'crosshatch',
  mirror: 'mirror',
  textured: 'textured-full-art',
  // The Poké Ball reverse is documented but this build ships no BW-era ball sheet,
  // so it is named as a special treatment rather than borrowing the EX-era paper.
  'pokeball-reverse': 'special-treatment',
}

const BUCKET_TREATMENT: Record<PromoTreatment, string> = {
  cosmos: 'Cosmos Holofoil',
  tinsel: 'Tinsel Holofoil, the Generation V paper',
  'cracked-ice': 'Cracked Ice Holofoil',
  crosshatch: 'Crosshatch Holofoil',
  mirror: 'Mirror Holofoil',
  textured: 'a textured full-art foil',
  'pokeball-reverse': 'a Poké Ball reverse paper',
  'non-holo': 'a non-holo printing',
}

/**
 * Which level of the assignment hierarchy produced a printing. The order is the
 * roadmap's: an explicit printing beats an expansion rule, which beats the era
 * rule; `modelled` is this build's own disclosed choice and `unresolved` is the
 * documented fallback. Nothing resolved is ever labelled `unresolved`.
 */
export type PrintingRule = 'explicit' | 'expansion' | 'era' | 'modelled' | 'unresolved'
export type PrintingMask = 'art' | 'art-border' | 'full' | 'outside-art' | 'full-art'

export type FoilPrinting = {
  /** Stable id: card, language, variant. */
  printingId: string
  cardId: string
  setId: string
  number: string
  language: PrintingLanguage
  variant: PrintingVariant
  /** What the card was sold in: booster, blister, box, promo programme. */
  product: string
  pattern: FoilPatternId
  mask: PrintingMask
  /** True only when a source describes this printing's foil area. */
  maskVerified: boolean
  status: PrintingStatus
  /** The hierarchy level that answered, for auditing the precedence order. */
  matchedRule: PrintingRule
  source: string
  /** Why this printing got this answer, in one sentence the inspector can show. */
  note: string
  /** Cosmos paper, for Cosmos patterns. */
  paper?: CosmosVariantId
  /** Papers this printing is found on, when more than one is documented. */
  paperVariants?: CosmosVariantId[]
  /** Card name, only when the caller supplies its row; never inferred. */
  name?: string
  /** Release year, only where a catalogue in this repo records one. */
  year?: number
  /** Normal-map id for embossed printings. Null: none ships yet. */
  surfaceTexture: string | null
  /**
   * Measured artwork window for this printing, as card fractions. Absent means
   * use the shared layout; modern cards have a shorter window than the base-set
   * geometry the default was measured on.
   */
  artRect?: { x: number; y: number; w: number; h: number }
}

export type PrintingInput = {
  cardId?: string | null
  rarity?: string | null
  /** Card name from the caller's row, carried onto the printing record. */
  name?: string | null
  variant?: string | null
  language?: string | null
  /** Pin a copy's swirl without inventing a new printing. */
  copySeed?: string | number
}

// ---------------------------------------------------------------------------
// Id parsing (local, so this module never imports holo.ts and cannot cycle)
// ---------------------------------------------------------------------------

function setOf(cardId: string): string {
  const cut = cardId.lastIndexOf('-')
  return cut > 0 ? cardId.slice(0, cut) : ''
}

function numberOf(cardId: string): string {
  const cut = cardId.lastIndexOf('-')
  return cut > 0 ? cardId.slice(cut + 1) : ''
}

function normalizeLanguage(language: string | null | undefined): PrintingLanguage {
  const raw = (language ?? 'en').toLowerCase().slice(0, 2)
  const known: PrintingLanguage[] = ['en', 'ja', 'ko', 'zh', 'fr', 'de', 'it', 'es', 'pt']
  return (known.includes(raw as PrintingLanguage) ? raw : 'en') as PrintingLanguage
}

// ---------------------------------------------------------------------------
// 1. The verified era rule
// ---------------------------------------------------------------------------

/**
 * English expansions whose standard Holo cards were printed on Cosmos, per
 * Bulbapedia: "introduced for all Holo cards in Base Set 2 and ... used for all
 * Holo cards until Call of Legends". Legendary Collection (base6) sits inside
 * that run and is included by the same sentence.
 */
const ERA_SETS: string[] = [
  'base4', 'base5', 'base6',
  'gym1', 'gym2',
  'neo1', 'neo2', 'neo3', 'neo4',
  'ecard1', 'ecard2', 'ecard3',
  ...Array.from({ length: 16 }, (_, i) => `ex${i + 1}`),
  ...Array.from({ length: 7 }, (_, i) => `dp${i + 1}`),
  ...Array.from({ length: 4 }, (_, i) => `pl${i + 1}`),
  ...Array.from({ length: 4 }, (_, i) => `hgss${i + 1}`),
  'col1',
]

/** The last expansion on Cosmos; Black & White moved to Tinsel. */
export const COSMOS_ERA = { first: 'base4', last: 'col1', from: '2000-02-24', to: '2011-04-25' }

/**
 * Sets that look like they might be Cosmos and are deliberately NOT resolved:
 * promo and special sets whose individual printings the era sentence does not
 * name. They stay unresolved, with a reason, so the report can show them instead
 * of quietly foiling whatever happens to be in the set.
 */
const UNRESOLVED_SETS: Record<string, string> = {
  basep: 'Wizards Black Star Promos are classified card by card from Pokumon’s treatment catalogues; the cards neither catalogue lists make no claim.',
  si1: 'Southern Islands is a promo set outside the expansion rule; no source read here documents its Holo finish.',
  np: 'Nintendo Black Star Promos are classified card by card from Pokumon’s treatment catalogues; the cards neither catalogue lists make no claim.',
  dpp: 'DP Black Star Promos are classified card by card from Pokumon’s treatment catalogues; the cards neither catalogue lists make no claim.',
  hsp: 'HGSS Black Star Promos are classified card by card from Pokumon’s treatment catalogues; the cards neither catalogue lists make no claim.',
  bp: 'Best of Game promos are classified card by card: Bulbapedia states the reverse-holographic treatment and names the four cards that stayed plain.',
  bwp: 'BW Black Star Promos are classified card by card from Pokumon’s treatment taxonomy, corroborated by Bulbapedia’s variant tags; a card neither source answers makes no claim.',
  ru1: 'Pokémon Rumble cards are classified card by card: the product copy names three all-foil cards, and two price catalogues name the same three.',
}

// ---------------------------------------------------------------------------
// 2c. POP Series: the base printings are NON-HOLO
// ---------------------------------------------------------------------------
//
// Every POP Series page names the holographic versions as separate products —
// "All of the rare cards have holographic versions and were available through
// several waves of promotional items, such as Value Packs and Collector's Tins"
// (POP1–3), and then an Additional cards table giving each one's carrier:
// "Cosmos Holo DP Gift Packs", "Cracked Ice Reverse Holo - Showdown Collection
// box", and so on. The card in the POP booster is the NON-HOLO printing, which is
// why this is a verified non-holo claim and not a Cosmos one: no POP Series set is
// on Cosmos paper, and the era sentence covers expansion Holo cards, not promos.
//
// A non-holo printing has no pattern and no mask, so it is its own record type
// rather than a FoilPrinting with an empty pattern.
export type NonHoloPrinting = {
  printingId: string
  cardId: string
  setId: string
  number: string
  variant: 'non-holo'
  product: string
  status: 'verified'
  /** `expansion` for a set-level claim, `explicit` for a card named by a catalogue. */
  matchedRule: 'expansion' | 'explicit'
  source: string
  note: string
}

/** Sets whose ordinary printings are verified non-holo, with the source per set. */
export const POP_NON_HOLO_SETS: Record<string, string> = {
  pop1: 'POP Series 1: "All of the rare cards have holographic versions and were available through several waves of promotional items" — so the pack card is non-holo.',
  pop2: 'POP Series 2: "All of the rare cards have holographic versions"; the pack card is non-holo.',
  pop3: 'POP Series 3: "All of the rare cards have holographic versions"; the pack card is non-holo.',
  pop4: 'POP Series 4: the rares and four lower-rarity cards "have holographic versions and were available in Value Packs"; the pack card is non-holo.',
  pop5: 'POP Series 5: Ho-Oh, Lugia, Mew δ and three commons "were released in holographic versions ... available in Value Packs"; the pack card is non-holo.',
  pop6: 'POP Series 6: Chimchar, Piplup and Turtwig "received holographic versions ... available in value packs"; the pack card is non-holo.',
  pop7: 'POP Series 7: six rares and Kirlia "received holographic versions"; the pack card is non-holo.',
  pop8: 'POP Series 8: several cards "also had Cosmos holographic versions" in named products; the pack card is non-holo.',
  pop9: 'POP Series 9: Rotom, Raichu, Regigigas, Manaphy and Lopunny had holographic versions in named blisters; the pack card is non-holo.',
}

const POP_SOURCE = 'https://bulbapedia.bulbagarden.net/wiki/POP_Series_1_(TCG)'

/**
 * The named holographic versions, as separate printings of the same card id. They
 * are resolved only when the caller says the copy is the holo one — a POP card row
 * alone cannot distinguish them, and the base printing is non-holo.
 */
type PopHoloEntry = {
  setId: string
  number: string
  name: string
  pattern: FoilPatternId
  reverse: boolean
  product: string
  source: string
  note: string
}

const POP_HOLO_ENTRIES: PopHoloEntry[] = [
  { setId: 'pop1', number: '16', name: 'Armaldo ex', pattern: 'cosmos-retro', reverse: false, product: '2007 Spring Collector’s Tins (international)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 1 card.' },
  { setId: 'pop1', number: '17', name: 'Tyranitar ex', pattern: 'cosmos-retro', reverse: false, product: 'Target exclusive Value Box (October 2006) / 2007 Spring Collector’s Tins', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 1 card.' },
  { setId: 'pop2', number: '1', name: 'Entei', pattern: 'cosmos-retro', reverse: false, product: 'Legendary Beasts Blisters (October 2006)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 2 card.' },
  { setId: 'pop2', number: '2', name: 'Pidgeot', pattern: 'cosmos-retro', reverse: false, product: 'EX Crystal Guardians Blisters (2006)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 2 card.' },
  { setId: 'pop2', number: '17', name: 'Celebi ex', pattern: 'cosmos-retro', reverse: false, product: 'Bonus Box / Trainer’s Challenge Set / 2007 Spring Collector’s Tins', source: POP_SOURCE, note: 'Named as a Cosmos Holo version; Bulbapedia calls it the most widely distributed POP holographic variant.' },
  { setId: 'pop3', number: '1', name: 'Blastoise', pattern: 'cosmos-retro', reverse: false, product: 'Crystal Trainer Set (September 2006, Toys “R” Us exclusive)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 3 card.' },
  { setId: 'pop3', number: '2', name: 'Flareon', pattern: 'cosmos-retro', reverse: false, product: 'Eeveelutions Blisters (November 2006) / Enhanced Value Pack (June 2007)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 3 card.' },
  { setId: 'pop3', number: '3', name: 'Jolteon', pattern: 'cosmos-retro', reverse: false, product: 'Eeveelutions Blisters (November 2006) / Enhanced Value Pack (June 2007)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 3 card.' },
  { setId: 'pop3', number: '4', name: 'Minun', pattern: 'cosmos-retro', reverse: false, product: 'EX Dragon Frontiers Blisters (November 2006)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 3 card.' },
  { setId: 'pop3', number: '6', name: 'Vaporeon', pattern: 'cosmos-retro', reverse: false, product: 'Eeveelutions Blisters (November 2006) / Enhanced Value Pack (June 2007)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 3 card.' },
  { setId: 'pop3', number: '17', name: 'Ho-Oh ex', pattern: 'cosmos-retro', reverse: false, product: '2007 Spring Collector’s Tins (international)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 3 card.' },
  { setId: 'pop4', number: '2', name: 'Deoxys δ', pattern: 'cosmos-retro', reverse: false, product: 'EX Power Keepers Blisters (March 2007)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version; Bulbapedia notes it is the one δ card given the cosmic design rather than plain foil.' },
  { setId: 'pop4', number: '3', name: 'Flygon', pattern: 'cosmos-retro', reverse: false, product: 'Epic Collection Value Boxes (May 2007)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 4 card.' },
  { setId: 'pop4', number: '6', name: 'Combusken', pattern: 'cosmos-retro', reverse: false, product: 'EX Value Set (March 2007)', source: POP_SOURCE, note: 'An uncommon with a named Cosmos Holo version.' },
  { setId: 'pop4', number: '11', name: 'Mudkip', pattern: 'cosmos-retro', reverse: false, product: 'EX Value Set (March 2007)', source: POP_SOURCE, note: 'A common with a named Cosmos Holo version.' },
  { setId: 'pop4', number: '13', name: 'Pikachu', pattern: 'cosmos-retro', reverse: false, product: 'EX Dragon Frontiers Blisters (April 2007)', source: POP_SOURCE, note: 'A common with a named Cosmos Holo version.' },
  { setId: 'pop4', number: '16', name: 'Wobbuffet', pattern: 'cosmos-retro', reverse: false, product: 'EX Power Keepers Blisters 2-pack (April 2007)', source: POP_SOURCE, note: 'A common with a named Cosmos Holo version.' },
  { setId: 'pop5', number: '1', name: 'Ho-Oh', pattern: 'cosmos-retro', reverse: false, product: 'DP Gift Packs (Target & Toys R Us, October 2007)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 5 card.' },
  { setId: 'pop5', number: '2', name: 'Lugia', pattern: 'cosmos-retro', reverse: false, product: 'DP Gift Packs (Target & Toys R Us, October 2007)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 5 card.' },
  { setId: 'pop5', number: '3', name: 'Mew δ', pattern: 'cosmos-retro', reverse: false, product: 'DP Value Pack 1 (Wal-Mart & Target, September 2007)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 5 card.' },
  { setId: 'pop6', number: '3', name: 'Manaphy', pattern: 'cosmos-retro', reverse: false, product: 'Majestic Dawn Blisters (June 2008)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 6 card.' },
  { setId: 'pop6', number: '7', name: 'Gible', pattern: 'cosmos-retro', reverse: false, product: 'DP Value Pack 2 (November 2007) / Power Packs (July 2008)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 6 card.' },
  { setId: 'pop6', number: '8', name: 'Riolu', pattern: 'cosmos-retro', reverse: false, product: 'Great Encounters Blisters (March 2008)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 6 card.' },
  { setId: 'pop6', number: '15', name: 'Piplup', pattern: 'cosmos-retro', reverse: false, product: 'Starter Blisters (May 2008) / Diamond & Pearl Collection (August 2008)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 6 card.' },
  { setId: 'pop7', number: '1', name: 'Ampharos', pattern: 'cosmos-retro', reverse: false, product: 'Collector’s Box (December 2008)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 7 card.' },
  { setId: 'pop7', number: '2', name: 'Gallade', pattern: 'cosmos-retro', reverse: false, product: 'Gallade Blister Pack (March 2009)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 7 card.' },
  { setId: 'pop7', number: '3', name: 'Latias', pattern: 'cosmos-retro', reverse: false, product: 'Legends Awakened Blisters (August 2008)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 7 card.' },
  { setId: 'pop7', number: '4', name: 'Latios', pattern: 'cosmos-retro', reverse: false, product: 'Legends Awakened Blisters (August 2008)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 7 card.' },
  { setId: 'pop7', number: '5', name: 'Mothim', pattern: 'cosmos-retro', reverse: false, product: 'Legends Awakened Blisters (August 2008)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 7 card.' },
  { setId: 'pop7', number: '8', name: 'Kirlia', pattern: 'cosmos-retro', reverse: false, product: 'Collector’s Box (December 2008)', source: POP_SOURCE, note: 'An uncommon with a named Cosmos Holo version.' },
  { setId: 'pop8', number: '1', name: 'Heatran', pattern: 'cosmos-retro', reverse: false, product: 'Platinum Blisters (February 2009)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 8 card.' },
  { setId: 'pop8', number: '2', name: 'Lucario', pattern: 'cosmos-retro', reverse: false, product: 'Lucario Collector’s Tin re-issue / Collector’s Poster Box (2008)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 8 card.' },
  { setId: 'pop8', number: '5', name: 'Yanmega', pattern: 'cosmos-retro', reverse: false, product: 'Collector’s Poster Box 2 (March 2009)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 8 card.' },
  { setId: 'pop8', number: '7', name: 'Carnivine', pattern: 'crackedice', reverse: true, product: 'Showdown Collection box (KB Toys)', source: POP_SOURCE, note: 'Named as a Cracked Ice Reverse Holo printing: the Cracked Ice paper applied as a reverse finish.' },
  { setId: 'pop8', number: '12', name: 'Chimchar', pattern: 'crackedice', reverse: true, product: 'Trainer’s Challenge Box (October 2009)', source: POP_SOURCE, note: 'Named as a Cracked Ice Reverse Holo printing: the Cracked Ice paper applied as a reverse finish.' },
  { setId: 'pop8', number: '16', name: 'Riolu', pattern: 'crackedice', reverse: true, product: 'Trainer’s Challenge Box (October 2009)', source: POP_SOURCE, note: 'Named as a Cracked Ice Reverse Holo printing: the Cracked Ice paper applied as a reverse finish.' },
  { setId: 'pop9', number: '5', name: 'Rotom', pattern: 'crackedice', reverse: false, product: 'Rising Rivals Value Pack (May 2009)', source: POP_SOURCE, note: 'Named as a Cracked Ice Holo version of the POP Series 9 card.' },
  { setId: 'pop9', number: '9', name: 'Lopunny', pattern: 'cosmos-retro', reverse: false, product: 'Arceus Blisters (November 2009)', source: POP_SOURCE, note: 'Named as a Cosmos Holo version of the POP Series 9 card.' },
]

const POP_HOLO_BY_KEY = new Map(POP_HOLO_ENTRIES.map((p) => [`${p.setId}:${p.number.toUpperCase()}`, p]))

/** Exposed for the report and the suite: the named POP holographic versions. */
export const POP_HOLO_PRINTINGS: readonly PopHoloEntry[] = POP_HOLO_ENTRIES

/**
 * Named holographic versions whose foil the source does not state. They are
 * recorded so the gap is visible, and resolve nothing: guessing Cosmos here would
 * be exactly the blanket assignment this table exists to avoid.
 */
export const POP_HOLO_UNDOCUMENTED = [
  { setId: 'pop9', number: '2', name: 'Manaphy', product: 'Supreme Victors blisters', why: 'Bulbapedia records a holographic version but does not name its foil pattern.' },
  { setId: 'pop9', number: '4', name: 'Regigigas', product: 'Supreme Victors blisters', why: 'Bulbapedia records a holographic version but does not name its foil pattern.' },
  { setId: 'pop9', number: '3', name: 'Raichu', product: 'Supreme Victors Value Pack (reverse holo)', why: 'Named as a reverse holographic version; POP promos have no reverse paper documented here.' },
] as const

/**
 * A POP Series base card is a verified non-holo printing. Null for anything else,
 * and null for a reverse token: the base product had no reverse printing, so that
 * flag must not resolve to one.
 */
export function nonHoloFor(input: PrintingInput): NonHoloPrinting | null {
  const cardId = input.cardId
  if (!cardId) return null
  const setId = setOf(cardId)
  const reason = POP_NON_HOLO_SETS[setId]
  if (!reason) {
    // The four pre-2012 Black Star Promo programmes are classified card by card, so
    // a non-holo claim there is evidence about THAT card and nothing about its set.
    const promo = promoClaimFor(cardId)
    // A card catalogued in both treatments has a non-holo printing as well as its
    // Cosmos one, so the non-holo copy must still answer here.
    const nonHolo = promo?.treatment === 'non-holo' || (promo?.treatment === 'cosmos' && promo.claim.alsoNonHolo === true)
    if (!promo || !nonHolo) {
      // The four remaining promotional buckets classify card by card as well, and a
      // card the BW programme also printed plain is a non-holo printing of the same
      // card: the Cosmos row answers above, this one answers for that copy.
      const bucket = promoBucketClaimFor(cardId)
      const plain = bucket?.treatment === 'non-holo' || bucket?.alsoOn?.includes('non-holo') === true
      if (!bucket || !plain) return null
      if (!CATALOGUED_LANGUAGES.includes(normalizeLanguage(input.language))) return null
      if ((input.variant ?? '').toLowerCase().includes('reverse')) return null
      const meta = PROMO_BUCKET_SETS[bucket.setId as keyof typeof PROMO_BUCKET_SETS]
      return {
        printingId: `${cardId}:en:non-holo`,
        cardId,
        setId: bucket.setId,
        number: bucket.number,
        variant: 'non-holo',
        product: meta.name,
        status: 'verified',
        matchedRule: 'explicit',
        source: meta.source,
        note: `${meta.name}: a source classifies this card as non-holo, so a marketplace “holofoil” flag cannot invent a foil. ${meta.note}`,
      }
    }
    if (!CATALOGUED_LANGUAGES.includes(normalizeLanguage(input.language))) return null
    if ((input.variant ?? '').toLowerCase().includes('reverse')) return null
    return {
      printingId: `${cardId}:en:non-holo`,
      cardId,
      setId: promo.claim.setId,
      number: promo.claim.number,
      variant: 'non-holo',
      product: 'Black Star Promo',
      status: 'verified',
      matchedRule: 'explicit',
      source: PROMO_CATALOGUE.nonHoloSource,
      note: 'Pokumon catalogues this promo as a non-holo printing: the card in that product carries no foil, so a marketplace “holofoil” flag cannot invent one.',
    }
  }
  if (!CATALOGUED_LANGUAGES.includes(normalizeLanguage(input.language))) return null
  if ((input.variant ?? '').toLowerCase().includes('reverse')) return null
  // A named holo version of this card is a different printing; the caller has to
  // say which one it owns, and printingFor answers when it does.
  const named = POP_HOLO_BY_KEY.get(`${setId}:${numberOf(cardId).toUpperCase()}`)
  if (named && !named.reverse && (input.variant ?? '').toLowerCase().includes('holo')) return null
  return {
    printingId: `${cardId}:en:non-holo`,
    cardId,
    setId,
    number: numberOf(cardId),
    variant: 'non-holo',
    product: 'POP Series booster pack',
    status: 'verified',
    matchedRule: 'expansion',
    source: POP_SOURCE,
    note: reason,
  }
}

// ---------------------------------------------------------------------------
// 2. Named promotional printings
// ---------------------------------------------------------------------------

type PromoEntry = {
  setId: string
  number: string
  /** Guards the catalogue against an id drifting to a different card. */
  name: string
  product: string
  pattern: CosmosPaperId
  papers?: CosmosPaperId[]
  source: string
  note: string
}

const PROMO_ENTRIES: PromoEntry[] = [
  {
    setId: 'basep', number: '24', name: "_____'s Pikachu",
    product: 'Wizards Black Star Promo 24',
    pattern: 'cosmos-retro', source: SOURCES.pokumon,
    note: 'Named as Cosmos by Pokumon’s Cosmos catalogue.',
  },
  {
    setId: 'dpp', number: 'DP50', name: 'Arceus',
    product: 'DP Black Star Promo DP50',
    pattern: 'cosmos-retro', source: SOURCES.pokumon,
    note: 'Named as Cosmos by Pokumon’s Cosmos catalogue; the promo’s foil area is not documented.',
  },
  {
    setId: 'dpp', number: 'DP53', name: 'Arceus LV.X',
    product: 'DP Black Star Promo DP53',
    pattern: 'cosmos-retro', source: SOURCES.pokumon,
    note: 'Named as Cosmos by Pokumon. An explicit entry outranks the "LV.X is a special treatment" default.',
  },
  {
    setId: 'dpp', number: 'DP54', name: 'Beginning Door',
    product: 'DP Black Star Promo DP54 (French blister promotion)',
    pattern: 'cosmos-retro',
    source: 'https://bulbapedia.bulbagarden.net/wiki/Beginning_Door_(DP_Promo_54)',
    note: 'Bulbapedia: “A Cosmos Holofoil version was also later released as one of the DP Black Star Promos, exclusively in French.” The only printing of this promo is French. Pokumon tags the same card non-holo, so the sources disagree; the claim follows the one that names the paper, and TCGdex and a Cardmarket listing also describe the card as holographic.',
  },
  {
    setId: 'dpp', number: 'DP55', name: 'Ultimate Zone',
    product: 'DP Black Star Promo DP55 (French blister promotion)',
    pattern: 'cosmos-retro',
    source: 'https://bulbapedia.bulbagarden.net/wiki/Ultimate_Zone_(DP_Promo_55)',
    note: 'Bulbapedia: “A Cosmos Holofoil version of the Arceus print was also later released as one of the DP Black Star Promos, exclusively in French.” Pokumon tags the same card non-holo, so the sources disagree; the claim follows the one that names the paper.',
  },
  {
    setId: 'bwp', number: 'BW67', name: 'Ampharos',
    product: 'BW Black Star Promo BW67',
    pattern: 'cosmos-retro', source: SOURCES.pokumon,
    note: 'Named as Cosmos by Pokumon; printed in 2011, before the HD paper appears.',
  },
  {
    setId: 'xyp', number: 'XY178', name: 'Absol',
    product: 'XY Black Star Promo XY178',
    pattern: 'cosmos-hd', source: SOURCES.pokumon,
    note: 'Named as Cosmos by Pokumon; a post-2013 promo, so the HD paper.',
  },
  {
    setId: 'smp', number: 'SM43', name: 'Alolan Meowth',
    product: 'Sun & Moon Black Star Promo SM43',
    pattern: 'cosmos-hd', source: SOURCES.pokumon,
    note: 'Named as Cosmos by Pokumon.',
  },
  {
    setId: 'smp', number: 'SM51', name: 'Alolan Meowth',
    product: 'Sun & Moon Black Star Promo SM51',
    pattern: 'cosmos-hd', source: SOURCES.pokumon,
    note: 'A second Cosmos printing of the same card name in the same promo programme.',
  },
  {
    setId: 'smp', number: 'SM65', name: 'Alolan Raichu',
    product: 'Sun & Moon Black Star Promo SM65',
    pattern: 'cosmos-hd', source: SOURCES.pokumon,
    note: 'Named as Cosmos by Pokumon.',
  },
  {
    setId: 'swshp', number: 'SWSH058', name: 'Alcremie',
    product: 'Sword & Shield Black Star Promo SWSH058',
    pattern: 'cosmos-hd', source: SOURCES.pokumon,
    note: 'Named as Cosmos by Pokumon.',
  },
  {
    setId: 'svp', number: '11', name: 'Arcanine',
    product: 'Scarlet & Violet Black Star Promo SVP011',
    pattern: 'cosmos-hd', source: SOURCES.pokumon,
    note: 'Named as Cosmos by Pokumon.',
  },
  {
    setId: 'svp', number: '46', name: 'Bulbasaur',
    product: '151 Poster Collection',
    pattern: 'cosmos-hd', papers: ['cosmos-hd', 'cosmos-retro'],
    source: SOURCES.sleevenocardbehind,
    note: 'One of the six 151 promos documented in both papers: early print runs used the retro sheet.',
  },
  {
    setId: 'svp', number: '47', name: 'Charmander',
    product: '151 Poster Collection',
    pattern: 'cosmos-hd', papers: ['cosmos-hd', 'cosmos-retro'],
    source: SOURCES.sleevenocardbehind,
    note: 'Documented in both papers across print runs; the HD sheet is the default.',
  },
  {
    setId: 'svp', number: '48', name: 'Squirtle',
    product: '151 Poster Collection',
    pattern: 'cosmos-hd', papers: ['cosmos-hd', 'cosmos-retro'],
    source: SOURCES.sleevenocardbehind,
    note: 'Documented in both papers across print runs; the HD sheet is the default.',
  },
]

const PROMO_BY_KEY = new Map(PROMO_ENTRIES.map((p) => [`${p.setId}:${p.number.toUpperCase()}`, p]))

// ---------------------------------------------------------------------------
// 2b. Named Cracked Ice printings
// ---------------------------------------------------------------------------
//
// Cracked Ice is not a set rule here. Bulbapedia describes it as the foil of the
// featured card in Platinum-series theme decks and names one card whose foil AREA
// it also describes: the English Frost Rotom, "over everything but the image of
// the Pokémon". The catalogue has no Platinum/HGSS/BW theme-deck sets, so those
// printings cannot be resolved, and the one named card is an explicit entry that
// outranks its expansion's Cosmos era rule.
// The other four entries are HGSS Black Star Promos whose own card pages name a
// "Cracked Ice Holofoil HGSS Black Star Promo print". The pattern is verified there;
// no source read here states the foil AREA, so those keep the illustration-window
// default and maskVerified false rather than borrowing Frost Rotom's area claim.
type CrackedIceEntry = {
  setId: string
  number: string
  name: string
  product: string
  /** The documented area, or the modelled default where no source states one. */
  mask: 'outside-art' | 'art'
  maskVerified: boolean
  source: string
  note: string
}

const CRACKED_ICE_ENTRIES: CrackedIceEntry[] = [
  {
    setId: 'pl2', number: 'RT2', name: 'Frost Rotom',
    product: 'Rising Rivals promotional printing (blister; exact product not recorded here)',
    mask: 'outside-art', maskVerified: true,
    source: SOURCES.bulbapediaHolofoil,
    note: 'Bulbapedia names this English printing as the Cracked Ice card that foils everything but the image of the Pokémon, which verifies both the pattern and its area.',
  },
  {
    setId: 'hsp', number: 'HGSS16', name: 'Plusle',
    product: 'Undaunted Blisters (August 2010)',
    mask: 'art', maskVerified: false,
    source: 'https://bulbapedia.bulbagarden.net/wiki/Plusle_(HGSS_Promo_16)',
    note: 'Bulbapedia: “A Cracked Ice Holofoil HGSS Black Star Promo print of this card was included in the Undaunted Blisters alongside Minun in August 2010.” The pattern is named; the foil area is not.',
  },
  {
    setId: 'hsp', number: 'HGSS17', name: 'Minun',
    product: 'Undaunted Blisters (August 2010)',
    mask: 'art', maskVerified: false,
    source: 'https://bulbapedia.bulbagarden.net/wiki/Minun_(HGSS_Promo_17)',
    note: 'Bulbapedia names a Cracked Ice Holofoil HGSS Black Star Promo print of this card in the Undaunted Blisters. The pattern is named; the foil area is not.',
  },
  {
    setId: 'hsp', number: 'HGSS24', name: 'Hitmonchan',
    product: 'HGSS Black Star Promo (Cracked Ice Holofoil print of the Undaunted card)',
    mask: 'art', maskVerified: false,
    source: 'https://bulbapedia.bulbagarden.net/wiki/Hitmonchan_(HGSS_Promo_24)',
    note: 'Bulbapedia: the Undaunted print “was released again as a Cracked Ice Holofoil HGSS Black Star Promo” print. The pattern is named; the foil area is not, and this build does not record the carrier here.',
  },
  {
    setId: 'hsp', number: 'HGSS25', name: 'Hitmonlee',
    product: 'HGSS Black Star Promo (Cracked Ice Holofoil print of the Undaunted card)',
    mask: 'art', maskVerified: false,
    source: 'https://bulbapedia.bulbagarden.net/wiki/Hitmonlee_(HGSS_Promo_25)',
    note: 'Bulbapedia: the Undaunted print “was released again as a Cracked Ice Holofoil HGSS Black Star Promo” print. The pattern is named; the foil area is not, and this build does not record the carrier here.',
  },
]

const CRACKED_ICE_BY_KEY = new Map(CRACKED_ICE_ENTRIES.map((p) => [`${p.setId}:${p.number.toUpperCase()}`, p]))

// ---------------------------------------------------------------------------
// 2b-2. Named Sequin printings
// ---------------------------------------------------------------------------
//
// Sequin is exclusive to the General Mills mini packs, and Bulbapedia's Holofoil page
// answers it card by card: its Sequin section carries a table per series naming every
// card the paper printed (Sun & Moon promos, the Let's Go, Kanto! reprints, the 25th
// Anniversary SWSH promos). That is why this is a per-card table and not a set rule —
// the same promo set holds plain cards too.
//
// Each entry's `also` names the OTHER printing of the same number, because none of
// these cards was printed sequin-only: the number shipped in the Alola Collection, a
// blister or a booster first, and the General Mills pack reprint is a second copy. A
// save does not distinguish physical copies, so the row answers for the sequin one and
// every record's note says so.

type SequinEntry = {
  cardId: string
  setId: string
  number: string
  name: string
  product: string
  /** The other printing of this number, when one exists. */
  also?: string
  source: string
}

const SEQUIN_SOURCE_SM = 'https://bulbapedia.bulbagarden.net/wiki/Sun_%26_Moon_TCG_Series_merchandise'
const SEQUIN_SOURCE_SWSH = 'https://bulbapedia.bulbagarden.net/wiki/Sword_%26_Shield_TCG_Series_merchandise'
const SEQUIN_PRODUCT_SM = 'General Mills Sun & Moon Mini Packs'
const SEQUIN_PRODUCT_LGK = "General Mills Let's Go, Kanto! Mini Packs"
const SEQUIN_PRODUCT_25 = 'General Mills 25th Anniversary Mini Packs'

/** The three General Mills products, so the mini-pack catalogue cannot retype them. */
export const SEQUIN_PRODUCTS = {
  sunMoon: SEQUIN_PRODUCT_SM,
  letsGo: SEQUIN_PRODUCT_LGK,
  anniversary: SEQUIN_PRODUCT_25,
} as const
const SEQUIN_SM_PROMO = 'the SM Black Star Promo printing'
const SEQUIN_SWSH_PROMO = 'the SWSH Black Star Promo printing'

const SEQUIN_ENTRIES: SequinEntry[] = [
  { cardId: 'smp-SM01', setId: 'smp', number: 'SM01', name: 'Rowlet', product: SEQUIN_PRODUCT_SM, also: SEQUIN_SM_PROMO, source: SEQUIN_SOURCE_SM },
  { cardId: 'smp-SM02', setId: 'smp', number: 'SM02', name: 'Litten', product: SEQUIN_PRODUCT_SM, also: SEQUIN_SM_PROMO, source: SEQUIN_SOURCE_SM },
  { cardId: 'smp-SM03', setId: 'smp', number: 'SM03', name: 'Popplio', product: SEQUIN_PRODUCT_SM, also: SEQUIN_SM_PROMO, source: SEQUIN_SOURCE_SM },
  { cardId: 'smp-SM04', setId: 'smp', number: 'SM04', name: 'Pikachu', product: SEQUIN_PRODUCT_SM, also: SEQUIN_SM_PROMO, source: SEQUIN_SOURCE_SM },
  { cardId: 'smp-SM06', setId: 'smp', number: 'SM06', name: 'Rockruff', product: SEQUIN_PRODUCT_SM, also: SEQUIN_SM_PROMO, source: SEQUIN_SOURCE_SM },
  { cardId: 'smp-SM40', setId: 'smp', number: 'SM40', name: 'Jangmo-o', product: SEQUIN_PRODUCT_SM, also: SEQUIN_SM_PROMO, source: SEQUIN_SOURCE_SM },
  { cardId: 'smp-SM42', setId: 'smp', number: 'SM42', name: 'Cosmog', product: SEQUIN_PRODUCT_SM, also: SEQUIN_SM_PROMO, source: SEQUIN_SOURCE_SM },
  { cardId: 'smp-SM86', setId: 'smp', number: 'SM86', name: 'Pikachu', product: SEQUIN_PRODUCT_SM, also: SEQUIN_SM_PROMO, source: SEQUIN_SOURCE_SM },
  { cardId: 'sm1-101', setId: 'sm1', number: '101', name: 'Eevee', product: SEQUIN_PRODUCT_LGK, also: 'the Sun & Moon expansion card', source: SEQUIN_SOURCE_SM },
  { cardId: 'sm3-18a', setId: 'sm3', number: '18a', name: 'Charmander', product: SEQUIN_PRODUCT_LGK, source: SEQUIN_SOURCE_SM },
  { cardId: 'sm6-57', setId: 'sm6', number: '57', name: 'Cubone', product: SEQUIN_PRODUCT_LGK, also: 'the Forbidden Light expansion card', source: SEQUIN_SOURCE_SM },
  { cardId: 'sm35-1', setId: 'sm35', number: '1', name: 'Bulbasaur', product: SEQUIN_PRODUCT_LGK, also: 'the Shining Legends expansion card', source: SEQUIN_SOURCE_SM },
  { cardId: 'sm35-28', setId: 'sm35', number: '28', name: 'Pikachu', product: SEQUIN_PRODUCT_LGK, also: 'the Shining Legends expansion card', source: SEQUIN_SOURCE_SM },
  { cardId: 'swshp-SWSH010', setId: 'swshp', number: 'SWSH010', name: 'Gossifleur', product: SEQUIN_PRODUCT_25, also: SEQUIN_SWSH_PROMO, source: SEQUIN_SOURCE_SWSH },
  { cardId: 'swshp-SWSH011', setId: 'swshp', number: 'SWSH011', name: 'Wooloo', product: SEQUIN_PRODUCT_25, also: SEQUIN_SWSH_PROMO, source: SEQUIN_SOURCE_SWSH },
  { cardId: 'swshp-SWSH012', setId: 'swshp', number: 'SWSH012', name: 'Morpeko', product: SEQUIN_PRODUCT_25, also: SEQUIN_SWSH_PROMO, source: SEQUIN_SOURCE_SWSH },
  { cardId: 'swshp-SWSH013', setId: 'swshp', number: 'SWSH013', name: 'Galarian Ponyta', product: SEQUIN_PRODUCT_25, also: SEQUIN_SWSH_PROMO, source: SEQUIN_SOURCE_SWSH },
  { cardId: 'swshp-SWSH039', setId: 'swshp', number: 'SWSH039', name: 'Pikachu', product: SEQUIN_PRODUCT_25, also: SEQUIN_SWSH_PROMO, source: SEQUIN_SOURCE_SWSH },
  { cardId: 'swshp-SWSH040', setId: 'swshp', number: 'SWSH040', name: 'Hatenna', product: SEQUIN_PRODUCT_25, also: SEQUIN_SWSH_PROMO, source: SEQUIN_SOURCE_SWSH },
]

const SEQUIN_BY_KEY = new Map(SEQUIN_ENTRIES.map((p) => [`${p.setId}:${p.number.toUpperCase()}`, p]))

/** Exposed for the report and the suite: the named Sequin printings. */
export const SEQUIN_PRINTINGS: readonly SequinEntry[] = SEQUIN_ENTRIES

/** The explicit inventory variant a General Mills copy carries. */
export const SEQUIN_VARIANT = 'sequinHolofoil'

// ---------------------------------------------------------------------------
// 2c. Reverse-only promotional printings
// ---------------------------------------------------------------------------
//
// Three Nintendo Black Star Promos exist ONLY as reverse holos: the e-League
// Treecko (003), Torchic (008) and Mudkip (010). Their Bulbapedia pages describe the
// League release without naming a foil, but every market record that carries the
// card offers exactly one finish and calls it reverse holofoil — TCGplayer lists
// Treecko 003 only as "Reverse Holofoil", PokemonPrice files Torchic 008 as
// "[Reverse Holo]", TCGdex reports holo and normal both false with reverse true, and
// the supplied scans show a patterned sheen across the body and text box while the
// illustration window stays flat, which is the reverse layout.
//
// Because there is no plain printing, the card ROW resolves; there is no token the
// caller could use to distinguish variants. The identification is explicit, the
// paper is the EX-era reverse finish rather than a pattern a source names for these
// cards, and the area is read from a scan — so the pattern is inferred and the mask
// is modelled, not verified.
type ReversePromoEntry = {
  setId: string
  number: string
  name: string
  product: string
  source: string
}

const REVERSE_PROMO_ENTRIES: ReversePromoEntry[] = [
  {
    setId: 'np', number: '3', name: 'Treecko',
    product: 'Nintendo Black Star Promo 003 (e-League, October 2003)',
    source: 'https://www.tcgplayer.com/product/90031/pokemon-nintendo-promos-treecko-003-e-league',
  },
  {
    setId: 'np', number: '8', name: 'Torchic',
    product: 'Nintendo Black Star Promo 008 (e-League, September 2003)',
    source: 'https://pokemonprice.com/nintendo-black-star-promo/torchic-008-reverse-holo',
  },
  {
    setId: 'np', number: '10', name: 'Mudkip',
    product: 'Nintendo Black Star Promo 010 (e-League, November 2003)',
    source: 'https://tcgscreener.com/pokemon/nintendo-black-star-promos/mudkip-rev-holo-10',
  },
]

const REVERSE_PROMO_BY_KEY = new Map(REVERSE_PROMO_ENTRIES.map((p) => [`${p.setId}:${p.number.toUpperCase()}`, p]))

/** Exposed for the report and the suite: the reverse-only promo printings. */
export const REVERSE_PROMO_PRINTINGS: readonly ReversePromoEntry[] = REVERSE_PROMO_ENTRIES

/** Exposed for the report and the suite: the named Cracked Ice printings. */
export const CRACKED_ICE_PRINTINGS: readonly CrackedIceEntry[] = CRACKED_ICE_ENTRIES

/** Exposed for the report and the suite: the named promotional printings. */
export const COSMOS_PROMO_PRINTINGS: readonly PromoEntry[] = PROMO_ENTRIES

/**
 * Classic Collection reprints share one paper, and Bulbapedia names it: "Classic
 * Collection cards have a textured confetti holofoil pattern", and "In the Mega Evolution
 * Series, all Classic Collection cards have a golden card border."
 *
 * That is the registry's `confetti` row (Pixel / Confetti), which since 0.53.0 ships a
 * drawn flake sheet, so these cards sample that paper rather than borrowing the era sheet
 * their original print used — and the HD Cosmos this set was modelled as is gone, because
 * a source replaced a guess. It was the only `modelled` entry in the database.
 */
const CLASSIC_COLLECTION_SETS: Record<string, { note: string; source: string }> = {
  me55c: {
    source: 'https://bulbapedia.bulbagarden.net/wiki/Classic_Collection_(TCG)',
    note: 'Bulbapedia: "Classic Collection cards have a textured confetti holofoil pattern", and in the Mega Evolution Series "all Classic Collection cards have a golden card border". The paper is identified; no source states which cells of the face carry it, so the illustration window is an approximation, and the reprint also carries the Pokémon 30th Anniversary logo.',
  },
}

// ---------------------------------------------------------------------------
// 3. Reverse papers (documented per set range)
// ---------------------------------------------------------------------------

/**
 * Reverse Holofoil designs change by set, per Bulbapedia's reverse-holo history.
 * Reverse holos began with Legendary Collection, which is why Base Set 2 and Team
 * Rocket resolve to no reverse printing at all: a marketplace flag on those sets
 * cannot invent one.
 */
export function reversePaperFor(setId: string): FoilPatternId | null {
  return reversePatternFor(setId)
}

// 4. Resolution
// ---------------------------------------------------------------------------

function record(
  p: Omit<FoilPrinting, 'printingId' | 'surfaceTexture'> & { surfaceTexture?: string | null },
): FoilPrinting {
  // No shipped printing has a normal map, so the default is the truth, not a stub.
  return { ...p, surfaceTexture: p.surfaceTexture ?? null, printingId: `${p.cardId}:${p.language}:${p.variant}` }
}

export function isCosmosEraSet(setId: string): boolean {
  return ERA_SETS.includes(setId)
}

/** Why a set makes no Cosmos claim, or null when it is in the era table. */
export function unresolvedReason(setId: string): string | null {
  return UNRESOLVED_SETS[setId] ?? null
}

/**
 * The foil printing for a card, or null when this database has no claim.
 *
 * Null is meaningful: it hands the card back to the older era/rarity heuristics
 * (Radiant, Tinsel, Confetti, chase tiers) rather than asserting Cosmos.
 */
export function printingFor(input: PrintingInput): FoilPrinting | null {
  const resolved = resolvePrinting(input)
  if (!resolved) return null
  return {
    ...resolved,
    // Never invented: a name comes from the caller's card row, and a year only
    // from a catalogue in this repo. Absent means absent.
    name: input.name ?? resolved.name,
    year: resolved.year ?? yearForSet(resolved.setId),
  }
}

/** Release year, only where an expansion catalogue in this repo records one. */
function yearForSet(setId: string): number | undefined {
  return reverseConfigFor(setId)?.year
}

/** The δ holo rares, resolved once from the catalogue into a generated index. */
const DELTA_SPECIES_HOLO_RARE_IDS = new Set(DELTA_SPECIES_HOLO_RARES.map((r) => r.cardId))

function resolvePrinting(input: PrintingInput): FoilPrinting | null {
  const cardId = input.cardId
  if (!cardId) return null
  const setId = setOf(cardId)
  if (!setId) return null
  const number = numberOf(cardId)
  const language = normalizeLanguage(input.language)
  const rarity = input.rarity ?? ''
  const variantRaw = (input.variant ?? '').toLowerCase()
  const reverse = variantRaw.includes('reverse')

  // Only English is catalogued. Returning null here is the honest answer for a
  // Japanese or Korean card: its printing is a different physical object.
  if (!CATALOGUED_LANGUAGES.includes(language)) return null

  // 1. Cracked Ice: one named printing, and it outranks its expansion's era rule.
  const ice = CRACKED_ICE_BY_KEY.get(`${setId}:${number.toUpperCase()}`)
  if (ice) {
    if (reverse) return null // no reverse printing of this card is documented
    return record({
      cardId, setId, number, language, variant: 'promo', product: ice.product,
      matchedRule: 'explicit', pattern: 'crackedice', mask: ice.mask, maskVerified: ice.maskVerified,
      status: 'verified', source: ice.source, note: ice.note,
    })
  }

  // 1a-2. Named Sequin printings.
  //
  // The paper is exclusive to the General Mills mini packs and Bulbapedia lists the
  // cards it printed, per series, so this answers card by card. The same number also
  // exists as another printing and a save cannot tell the copies apart, so the row
  // answers for the sequin copy — which the note states rather than hides.
  const sequin = SEQUIN_BY_KEY.get(`${setId}:${number.toUpperCase()}`)
  // The campaign copy is a DIFFERENT physical printing from the plain promo or booster card
  // of the same number, so it answers only when the caller says this copy is that one — the
  // same rule POP's named holo versions follow. The plain row therefore makes no foil claim,
  // and a save can hold both copies as separate inventory rows.
  const sequinWanted = variantRaw.includes('sequin')
  if (sequin && sequinWanted) {
    if (reverse) return null // no reverse printing of these cards is documented
    return record({
      cardId, setId, number, language, variant: 'sequin', product: sequin.product,
      matchedRule: 'explicit', pattern: 'sequin', mask: 'art', maskVerified: false,
      status: 'verified', source: sequin.source,
      note: sequin.also
        ? `${sequin.product}. Bulbapedia's Sequin table names this printing, and no source states its foil area, so the illustration window is the default. The same number also exists as ${sequin.also}; this is the separate General Mills copy, and the plain one makes no foil claim.`
        : `${sequin.product}. Bulbapedia's Sequin table names this printing, and no source states its foil area, so the illustration window is the default.`,
    })
  }

  // 1b. An explicitly identified printing always wins.
  const promo = PROMO_BY_KEY.get(`${setId}:${number.toUpperCase()}`)
  if (promo) {
    if (reverse) return null // promotional printings are not shipped reverse holo
    return record({
      cardId, setId, number, language, variant: 'promo',
      product: promo.product,
      matchedRule: 'explicit',
      pattern: promo.pattern,
      mask: 'art',
      maskVerified: false,
      status: 'verified',
      source: promo.source,
      note: promo.note,
      paper: COSMOS_TEXTURE_FOR[promo.pattern],
      ...(promo.papers ? { paperVariants: promo.papers.map((p) => COSMOS_TEXTURE_FOR[p]) } : {}),
    })
  }

  // 1c. POP Series holographic versions are separate named products. They answer
  // only when the caller says the copy is the holo one (or, for the Cracked Ice
  // reverses, the reverse one); the base printing is non-holo and
  // nonHoloFor() owns that claim.
  const popHolo = POP_HOLO_BY_KEY.get(`${setId}:${number.toUpperCase()}`)
  // The holo version is a DIFFERENT product from the pack card, so it answers only
  // when the caller says this copy is the holo one. Without that, a POP card row
  // would be painted with a foil its own printing never had.
  const popWantsHolo = /holo/i.test(variantRaw)
  if (popHolo && popHolo.reverse === reverse && (popHolo.reverse || popWantsHolo)) {
    return record({
      cardId, setId, number, language,
      variant: popHolo.reverse ? 'reverse' : 'holo',
      product: popHolo.product,
      pattern: popHolo.pattern,
      mask: popHolo.reverse ? 'outside-art' : 'art',
      maskVerified: false,
      status: 'verified',
      matchedRule: 'explicit',
      source: popHolo.source,
      note: popHolo.note,
      ...(isCosmosPattern(popHolo.pattern) ? { paper: 'classic_dense' as const } : {}),
    })
  }

  // 1d. The four pre-2012 Black Star Promo programmes, classified card by card.
  // Bulbapedia's promo pages tag only the exceptional printings, so they cannot
  // answer for a whole set; Pokumon assigns a treatment to every card it lists,
  // which is what makes a per-card claim possible at all. A card in neither
  // catalogue falls through and makes no claim.
  const promoClaim = promoClaimFor(cardId)
  if (promoClaim?.treatment === 'cosmos' && !reverse) {
    return record({
      cardId, setId, number, language, variant: 'promo', product: 'Black Star Promo',
      pattern: 'cosmos-retro', mask: 'art', maskVerified: false,
      status: 'verified', matchedRule: 'explicit',
      source: PROMO_CATALOGUE.source,
      note: promoClaim.claim.alsoNonHolo
        ? 'Pokumon catalogues this promo on Cosmos; the same card also exists as a non-holo printing, which the card row cannot distinguish.'
        : 'Pokumon catalogues this promo on Cosmos. The foil AREA is not documented, so the illustration window is the default.',
      paper: 'classic_dense',
    })
  }

  // 1e. Three Nintendo promos exist only as reverse holos, so the card row itself
  // answers and no variant token is needed — or possible.
  const revPromo = REVERSE_PROMO_BY_KEY.get(`${setId}:${number.toUpperCase()}`)
  if (revPromo) {
    return record({
      cardId, setId, number, language, variant: 'reverse',
      product: revPromo.product,
      pattern: 'reverse-flat',
      mask: 'outside-art', maskVerified: false,
      status: 'inferred', matchedRule: 'explicit',
      source: revPromo.source,
      note: 'The only printing of this promo is a reverse holo: every market record sells one finish and calls it reverse holofoil, and the scan shows a patterned sheen across the body and text box with a flat illustration window. The paper is the EX-era reverse finish rather than a pattern a source names for this card, so the pattern is inferred and the area modelled.',
    })
  }

  // 1f. The four remaining promotional buckets, classified card by card.
  //
  // None of these is a set rule: Southern Islands alternates one holo card per
  // three-card scene, Rumble ships three all-foil cards among sixteen, Best of
  // Game foils five of nine, and the BW Black Star Promos change paper card by
  // card. A row no source answers is deliberately absent and makes no claim.
  const bucket = promoBucketClaimFor(cardId)
  if (bucket) {
    // A non-holo claim belongs to nonHoloFor(): a foil record with no pattern
    // would be a lie about a claim that exists.
    if (bucket.treatment === 'non-holo') return null
    // A reverse finish is the card's only printing, so the row answers with or
    // without a token; a non-reverse bucket printing has no reverse version, so a
    // marketplace flag must not invent one.
    if (reverse && !bucket.reverse) return null
    const meta = PROMO_BUCKET_SETS[bucket.setId as keyof typeof PROMO_BUCKET_SETS]
    // The status separates what a source states from what this build inferred:
    // Southern Islands names the finish but never the paper, and Rumble's product
    // copy names three all-foil cards without naming the paper either.
    const status: PrintingStatus =
      (bucket.setId === 'si1' && bucket.reverse) || (bucket.setId === 'ru1' && !bucket.reverse)
        ? 'inferred'
        : 'verified'
    // Where the foil sits. Three exceptions are documented rather than defaulted:
    // a reverse finish covers the body with the art window matte; Crosshatch is a
    // bucket paper whose AREA a source describes — "The crosshatch effect is often
    // applied to the background of the card, as in a Reverse Holo card."; and the
    // textured promos are FULL-ART printings. The last one is not a guess: the
    // catalogue scans and the BW73 seller photographs show the illustration running
    // under the text wash to the frame on BW43, BW73 and BW74, and Bleeding Cool
    // calls BW43 "This textured, Full Art card". The standard illustration window
    // (a 37.5%-tall band) would put the relief on a strip of a card whose art covers
    // the face, so these rows take the full-art layout instead. Which cells of that
    // face carry the emboss is still undocumented, so maskVerified stays false for
    // every bucket row. "All-foil" is the Rumble product copy's own term for three
    // whole cards; every other bucket card uses the illustration window.
    const mask: 'art' | 'full' | 'outside-art' | 'full-art' =
      bucket.treatment === 'textured'
        ? 'full-art'
        : bucket.treatment === 'crosshatch'
          ? 'outside-art'
          : bucket.reverse
            ? 'outside-art'
            : bucket.setId === 'ru1'
              ? 'full'
              : 'art'
    return record({
      cardId, setId, number, language,
      variant: bucket.reverse ? 'reverse' : 'promo',
      product: meta.name,
      pattern: BUCKET_PATTERN[bucket.treatment],
      mask,
      maskVerified: false,
      status,
      matchedRule: 'explicit',
      source: meta.source,
      note: `${meta.name}: ${BUCKET_TREATMENT[bucket.treatment]}${bucket.reverse ? ', applied as a reverse finish over the body and text box' : ''}. ${meta.note}${
        bucket.alsoOn?.length
          ? ` The same card was also printed as ${bucket.alsoOn.map((t) => BUCKET_TREATMENT[t]).join(' and ')}.`
          : ''
      }`,
      ...(bucket.treatment === 'cosmos' ? { paper: 'classic_dense' as const } : {}),
    })
  }

  // 1g. The shiny tier, identified per printing family in shiny-db.ts.
  //
  // The era rule cannot answer these. Neo Revelation's Shining pair IS Cosmos, but Neo
  // Destiny's eight put "a reflective foil treatment on the Pokémon itself" rather than
  // in the window, and Gold Star, Radiant Pokémon and the Shiny Vault all sit outside the
  // Cosmos run. This runs before the modelled sets because a per-card source outranks a
  // disclosed guess.
  //
  // Two areas are documented and this build cannot cut them: `pokemon-only` (the foil is
  // the Pokémon, which needs subject segmentation) and `various-parts`. Those records keep
  // the illustration window as an APPROXIMATION and say so, so `maskVerified` follows the
  // mask rather than the claim's own `areaVerified`.
  //
  // A reverse flag resolves nothing here: none of these families was printed reverse, so
  // the flag must not borrow the set's reverse paper.
  const shiny = shinyClaimFor({ cardId, setId, rarity, name: input.name ?? '' })
  if (shiny) {
    if (reverse) return null
    const pattern = shinyPatternFor(shiny)
    const areaNote =
      shiny.area === 'pokemon-only'
        ? ' The documented foil is the Pokémon only; this build cannot segment the subject, so the illustration window is an approximation.'
        : shiny.area === 'various-parts'
          ? ' The documented foil covers “various parts” of the card, which is not a rectangle; the illustration window is an approximation.'
          : ''
    const variant: PrintingVariant =
      shiny.sets.includes('smp') ? 'promo' : shiny.id === 'shining-neo-revelation' ? 'holo' : 'special'
    return record({
      cardId, setId, number, language, variant,
      product: shiny.sets.includes('smp') ? 'Black Star Promo' : 'expansion booster',
      pattern,
      mask: shiny.area === 'whole-card' ? 'full' : 'art',
      maskVerified: shiny.areaVerified && (shiny.area === 'art-window' || shiny.area === 'whole-card'),
      status: shiny.status,
      matchedRule: shiny.matchedRule,
      source: shiny.source,
      note: `${shiny.label}: ${shiny.paper}. ${shiny.note}${areaNote}`,
      ...(isCosmosPattern(pattern) ? { paper: 'classic_dense' as const } : {}),
    })
  }

  // 2. Classic Collection reprints: one shared paper, and Bulbapedia names it — a textured
  // confetti holofoil behind a golden border. That is the registry's `confetti` row, which
  // ships its own flake sheet, so the cards draw that paper instead of an era sheet they
  // never had.
  const classicCollection = CLASSIC_COLLECTION_SETS[setId]
  if (classicCollection && !reverse) {
    if (/legend/i.test(rarity)) {
      return record({
        cardId, setId, number, language, variant: 'holo', product: 'Classic Collection reprint',
        pattern: 'confetti', mask: 'full', maskVerified: false, status: 'verified',
        matchedRule: 'expansion',
        source: classicCollection.source,
        note: `LEGEND cards are printed entirely in foil, so the whole face is foiled and there are no matte cells to separate. ${classicCollection.note}`,
      })
    }
    return record({
      cardId, setId, number, language, variant: 'holo', product: 'Classic Collection reprint',
      pattern: 'confetti', mask: 'art', maskVerified: false, status: 'verified',
      matchedRule: 'expansion',
      source: classicCollection.source, note: classicCollection.note,
    })
  }

  // 3. A reverse printing carries its set's own reverse paper — never the Cosmos
  // sheet. Reverse holos exist from Legendary Collection onward, so this runs
  // before the era gate rather than inside it.
  if (reverse) {
    // Ascended Heroes' first reverse slot is its own documented paper, not the
    // set's ordinary reverse finish. The explicit variant names it; the card row
    // alone continues to resolve to the ordinary paper.
    const energy = energyReverseFor(setId, input.variant)
    if (energy) {
      if (!reverseEligible({ setId, number, rarity })) return null
      return record({
        cardId, setId, number, language, variant: 'reverse',
        product: 'expansion booster (Energy-pattern reverse slot)',
        pattern: energy.pattern,
        mask: energy.mask,
        maskVerified: true,
        status: energy.status,
        matchedRule: 'explicit',
        source: energy.source,
        note: energy.note,
        artRect: energy.artRect,
      })
    }
    const rev = reverseConfigFor(setId)
    if (!rev) return null
    if (!reverseEligible({ setId, number, rarity })) return null
    return record({
      cardId, setId, number, language, variant: 'reverse',
      product: 'expansion booster (reverse slot)',
      pattern: rev.pattern,
      mask: rev.mask,
      maskVerified: rev.status === 'verified',
      status: 'inferred',
      matchedRule: 'expansion',
      source: rev.source,
      note: `${rev.note} ${rev.maskNote}`
    })
  }

  // 3b. δ Delta Species holo rares are PLAIN foil.
  //
  // Bulbapedia gives the δ-marked holos of the Delta era a plain foil treatment rather
  // than the era's Cosmos sheet. This was recorded as an exception this build could not
  // detect (bug B3) because the marker is not in rarity or id — but it IS in the printed
  // name, which the catalogue carries, so `delta-species-index.ts` (GENERATED from the
  // catalogue) is the card-level answer. Rare Holo EX and Gold Star δ cards are different
  // treatments and are not in that index, and neither is POP4's Deoxys δ, the one δ card
  // Bulbapedia gives the cosmic design.
  if (!reverse && DELTA_SPECIES_HOLO_RARE_IDS.has(cardId)) {
    return record({
      cardId, setId, number, language, variant: 'holo', product: 'expansion booster',
      pattern: 'plain-holo', mask: 'art', maskVerified: false, status: 'verified',
      matchedRule: 'expansion',
      source: SOURCES.bulbapediaHolofoil,
      note: 'A δ Delta Species holo rare: Bulbapedia gives these a plain foil treatment instead of the era’s Cosmos paper, so the paper is uniform light and no sheet is drawn. No source read here states the foil area, so the illustration window is the modelled default.',
    })
  }

  // Phase 6: Bulbapedia names Starlight as the Holo pattern for Base, Jungle and
  // Fossil, and Fossil is the last set to use it. The printing and its mask are
  // verified here; the texture that ships (starlight.ts) is a procedural
  // RECONSTRUCTION, so identification and reproduction stay separate claims.
  if (!reverse && /^(base1|base2|base3)$/.test(setId) && /rare holo/i.test(rarity)) {
    return record({
      cardId, setId, number, language, variant: 'holo', product: 'expansion booster',
      pattern: 'starlight', mask: 'art', maskVerified: true, status: 'verified',
      matchedRule: 'era',
      source: SOURCES.bulbapediaHolofoil,
      note: 'Bulbapedia names Starlight as the Holo pattern for Base, Jungle and Fossil. This build draws the starfield procedurally; the pattern identification is verified, the texture is not a scan.',
    })
  }

  // Phase 21: Tinsel. Bulbapedia's Rarity page is a set-level statement for all
  // of Generation V: "For all sets in Generation V (from Black and White to
  // Legendary Treasures), the holofoil pattern is named 'Tinsel Holofoil', and
  // consists of horizontal stripes across the image."
  //
  // Standard Holo rares only. Rare Holo EX is a different treatment and makes no
  // claim here, and the 2025 Black Bolt & White Flare return is deliberately
  // unresolved: see TINSEL_RETURN_NOTE in tinsel-index.ts.
  if (!reverse && TINSEL_SETS.includes(setId) && /^rare holo$/i.test(rarity)) {
    return record({
      cardId, setId, number, language, variant: 'holo', product: 'expansion booster',
      pattern: 'tinsel', mask: 'art', maskVerified: true, status: 'verified',
      matchedRule: 'era',
      source: SOURCES.bulbapediaRarity,
      note: 'A Generation V holo rare: Tinsel Holofoil, “horizontal stripes across the image”. This build draws the stripes; the identification is verified, the texture is not a scan.',
    })
  }

  // Phase 21b: Dragon Vault. The set is Generation V, and Bulbapedia's Rarity
  // page names the era's paper for every set in it; the set page says the whole
  // product is foil ("ALL of them foil!", "Each booster pack contained 5 Holofoil
  // cards"). The pattern is therefore the era rule extended to a mini-set, marked
  // inferred; the foil AREA is not documented, so maskVerified stays false.
  if (!reverse && setId === 'dv1') {
    return record({
      cardId, setId, number, language, variant: 'holo', product: 'Dragon Vault 5-card booster',
      pattern: 'tinsel', mask: 'art', maskVerified: false, status: 'inferred',
      matchedRule: 'era',
      source: SOURCES.bulbapediaRarity,
      note: 'Dragon Vault is a Generation V product and every card in it is foil, so the era rule gives it Tinsel Holofoil. Bulbapedia does not state this set’s foil area, so the illustration window is the modelled default.',
    })
  }

  if (!ERA_SETS.includes(setId)) return null

  // 4. Standard Holo printings of the era.
  if (/legend/i.test(rarity)) {
    return record({
      cardId, setId, number, language, variant: 'holo', product: 'expansion booster',
      pattern: 'cosmos-retro', mask: 'full', maskVerified: true, status: 'verified',
      matchedRule: 'era',
      source: SOURCES.bulbapediaCosmos,
      note: 'LEGEND cards are “entirely holofoil” (Bulbapedia Rarity), so the foil runs edge to edge.',
      paper: 'classic_dense',
    })
  }

  if (/rare holo\s*ex\b/i.test(rarity)) {
    return record({
      cardId, setId, number, language, variant: 'holo', product: 'expansion booster',
      pattern: 'cosmos-retro', mask: 'art-border', maskVerified: true, status: 'verified',
      matchedRule: 'era',
      source: SOURCES.bulbapediaCosmos,
      note: 'Pokémon-ex carry Cosmos “in the image as well as on the border”, with the text panel matte.',
      paper: 'classic_dense',
    })
  }

  if (/lv\.x|\bstar\b|shining/i.test(rarity)) {
    return record({
      cardId, setId, number, language, variant: 'special', product: 'expansion booster',
      pattern: 'special-treatment', mask: 'art', maskVerified: false, status: 'unresolved',
      matchedRule: 'unresolved',
      source: SOURCES.bulbapediaHolofoil,
      note: 'A special treatment whose foil is not the era paper and is not documented here. No Cosmos is applied.',
    })
  }

  if (/prime/i.test(rarity)) {
    return record({
      cardId, setId, number, language, variant: 'holo', product: 'expansion booster',
      pattern: 'cosmos-retro', mask: 'art', maskVerified: true, status: 'inferred',
      matchedRule: 'era',
      source: SOURCES.bulbapediaCosmos,
      note: 'HGSS Prime cards are holofoil inside the Cosmos era; the rarity label does not say “Holo”, so the set rule is extended and marked inferred.',
      paper: 'classic_dense',
    })
  }

  if (!/rare holo/i.test(rarity)) return null

  return record({
    cardId, setId, number, language, variant: 'holo', product: 'expansion booster',
    pattern: 'cosmos-retro', mask: 'art', maskVerified: true, status: 'verified',
    matchedRule: 'era',
    source: SOURCES.bulbapediaCosmos,
    note: 'A standard Holo rare in the 2000–2011 run: Cosmos on the illustration window, matte frame and text panel.',
    paper: 'classic_dense',
  })
}

/**
 * δ Delta Species holo rares are plain foil rather than Cosmos — and they are no longer
 * an exception this build cannot detect. The marker is in the card's printed name, the
 * catalogue carries it, and `delta-species-index.ts` (GENERATED by
 * scripts/delta-species-index.ts) lists the 50 cards so the printing database can
 * answer for them everywhere, including where the renderer only has an id.
 */
export const DELTA_SPECIES_EXCEPTION =
  'EX Delta Species: δ Delta Species holo rares were given a plain foil treatment rather than Cosmos (Bulbapedia). The marker is in the printed name, so src/foil/delta-species-index.ts lists the cards and they resolve to the plain-holo paper — with POP4’s Deoxys δ the one δ card given the cosmic design.'

/** True when a row is in a Cosmos-candidate set but has no resolved printing. */
export function isUnresolvedCandidate(setId: string, rarity: string): boolean {
  if (ERA_SETS.includes(setId)) return false
  return Boolean(UNRESOLVED_SETS[setId])
}
