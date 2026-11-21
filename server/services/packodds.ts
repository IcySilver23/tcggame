import { db } from '../lib/db'
import { onDerivedDataChanged } from '../lib/derived-cache'
import { valueOf, round2 } from './market'
import { ascendedVariantFor } from '../../src/foil/ball-stamps'
import { holoFinishFor, rareVariantFor } from './finish-odds'
import type { FinishId } from '../../src/foil/finishes'
import { BALL_VARIANTS, ballEligible, isSpecialSet, specialSlotChancesFor } from './special-reverse'

// ---------------------------------------------------------------------------
// Real pack structure and hit odds, by era
// ---------------------------------------------------------------------------
// The Pokémon Company has never published English pull rates, so every number
// here is reverse-engineered from community samples — the same data the hobby
// runs on. Each profile carries the sample it came from; eras with no large
// public study are era-typical estimates and are labelled as such.
//
// The pack this game rips is the physical ten GAME cards:
//   commons · 3 uncommons · reverse holo(s) · 1 rare-or-hit · (WotC: 1 Energy)
// The rare slot is the ONLY place a hit can come from: it upgrades at the real
// per-pack odds below, otherwise it is the plain/holo rare the era's split
// describes. A hit replaces the rare — it is not an extra card. Modern packs
// carry a Basic Energy (and a code card) on top of the ten game cards; that
// extra card is not one of the ten, so it is not dealt here, and the WotC
// eleven-card pack is dealt as ten with one of its two Energies dropped.
// Card order is the physical order (see planFor).

export type EraKey = 'wotc' | 'ex' | 'dp' | 'bw' | 'sm' | 'swsh' | 'sv'

export type EraProfile = {
  label: string
  /** Per-pack split of the single rare slot: plain rare vs holo rare. */
  rare: { plain: number; holo: number }
  /** Real per-pack odds of each upgrade tier that can fill the final card. */
  upgrade: Record<string, number>
  /** True when packs of this era shipped a basic Energy as the final card. */
  energyInPack: boolean
  /** Where the numbers come from, in plain words. */
  source: string
}

export const ERA_PROFILES: Record<EraKey, EraProfile> = {
  // WotC: 19 holos at 1 in 3 packs, 11-12 holos per box (pokegym's box study).
  // Neo-era shinings and the one-per-print-run secrets are the era's upgrade,
  // and a real pack carried one basic Energy as its eleventh card.
  wotc: {
    label: 'Wizards of the Coast (1999–2002)',
    rare: { plain: 0.66, holo: 0.34 },
    upgrade: { 'Rare Shining': 0.03, 'Rare Secret': 0.012 },
    energyInPack: true,
    source: 'holo rare 1 in 3 packs (pokegym box study); shinings/secrets era estimate',
  },
  // EX series: 1 in 3 holo rares, ex cards roughly 1 in 18 packs. Packs still
  // shipped a basic Energy.
  ex: {
    label: 'EX series (2003–2006)',
    rare: { plain: 0.66, holo: 0.34 },
    upgrade: { 'Rare Holo ex': 0.055, 'Rare Holo Star': 0.004, 'Rare Secret': 0.012 },
    // Bulbapedia: e-Card through EX packs are 9 cards (5 common, 2 uncommon,
    // reverse holo, rare) and carry no Energy. The game deals ten, so the
    // ninth card becomes a third uncommon rather than a card the pack lacks.
    energyInPack: false,
    source: 'era-typical estimate (no large public sample)',
  },
  // Diamond & Pearl / HGSS: LV.X and LEGEND/Prime were the chase tiers, and
  // the pack still carried a basic Energy.
  dp: {
    label: 'Diamond & Pearl – HGSS (2007–2010)',
    rare: { plain: 0.66, holo: 0.34 },
    upgrade: { 'Rare Holo LV.X': 0.055, 'LEGEND': 0.02, 'Rare Prime': 0.055, 'Rare Secret': 0.01 },
    // Bulbapedia: "Since the release of the first Diamond & Pearl expansion,
    // these consistently had 10 cards" — and the Basic Energy only starts with
    // Sun & Moon, as an extra card beyond those ten.
    energyInPack: false,
    source: 'era-typical estimate (no large public sample)',
  },
  // Black & White – XY: full arts and rainbow/secret rares enter the ladder.
  // From here the tenth card is a second reverse holo, not an Energy.
  bw: {
    label: 'Black & White – XY (2011–2016)',
    rare: { plain: 0.62, holo: 0.38 },
    upgrade: { 'Rare Holo EX': 0.055, 'Rare Ultra': 0.03, 'Rare Rainbow': 0.012, 'Rare Secret': 0.018 },
    energyInPack: false,
    source: 'era-typical estimate (no large public sample)',
  },
  // Sun & Moon: measured — S&M base n=7,020: GX 11.15%, Ultra 4.22%,
  // Rainbow 1.47%, Secret 0.81%; any hit 17.65% (1 in 5.67 packs).
  sm: {
    label: 'Sun & Moon (2017–2019)',
    rare: { plain: 0.66, holo: 0.34 },
    upgrade: {
      'Rare Holo GX': 0.111,
      'Rare Ultra': 0.042,
      'Rare Rainbow': 0.015,
      'Rare Secret': 0.008,
      'Rare Prism Star': 0.07,
      'Rare Shiny': 0.087,
      'Rare Shiny GX': 0.02,
    },
    // Sun & Moon packs hold 5 commons, 3 uncommons, a reverse holo and a rare,
    // plus a Basic Energy and a code card as EXTRA cards. The ten game cards
    // are what this game deals, so no Energy slot.
    energyInPack: false,
    source: 'Elite Fourum pack study (Sun & Moon base, n=7,020 packs)',
  },
  // Sword & Shield: holo rare 1 in 2.7 packs, V/VMAX/full-art ladder on top.
  swsh: {
    label: 'Sword & Shield (2020–2022)',
    rare: { plain: 0.63, holo: 0.37 },
    upgrade: {
      'Rare Holo V': 0.19,
      'Rare Holo VMAX': 0.055,
      'Rare Holo VSTAR': 0.03,
      'Rare Ultra': 0.03,
      'Rare Rainbow': 0.012,
      'Rare Secret': 0.009,
      'Rare Shiny': 0.09,
    },
    // 5 commons, 3 uncommons, reverse holo, rare — plus the extra Energy (or a
    // VSTAR marker from Brilliant Stars to Crown Zenith) and a code card.
    energyInPack: false,
    source: 'Elite Fourum SWSH study + TCGplayer set articles',
  },
  // Scarlet & Violet: Double Rare ~1 in 5, Ultra ~1 in 9, IR ~1 in 11,
  // Hyper Rare ~1 in 100, ACE SPEC ~1 in 11 in sets that print them. SIR is
  // set-specific (1 in 32 on loaded sets, 1 in 85 on tight ones) — see
  // SET_SIR_OVERRIDE.
  sv: {
    label: 'Scarlet & Violet (2023–)',
    rare: { plain: 0.62, holo: 0.38 },
    upgrade: {
      'Double Rare': 0.20,
      'Ultra Rare': 0.11,
      'Illustration Rare': 0.09,
      'Special Illustration Rare': 0.028,
      'Hyper Rare': 0.011,
      'ACE SPEC Rare': 0.05,
      'Shiny Rare': 0.09,
      'Trainer Gallery Rare Holo': 0.09,
    },
    // Scarlet & Violet packs: 4 common, 3 uncommon, 2 reverse holos, a holo —
    // the ten game cards — plus a Basic Energy and a code card outside them.
    // Illustration/Special Illustration Rare replace the second reverse holo
    // in the real product; this build keeps them in the rare slot instead,
    // which is the simplification the changelog admits.
    energyInPack: false,
    source: 'TCGplayer set studies + Pullmarket community averages',
  },
}

/** Per-set Special Illustration Rare odds where a big sample exists. */
export const SET_SIR_OVERRIDE: Record<string, number> = {
  sv3pt5: 1 / 32, // 151 — cardtracker sample: 1 in 12 IR, SIR ~1 in 32
  sv8: 1 / 85, // Surging Sparks — the tight end of the modern band
  sv8pt5: 1 / 45, // Prismatic Evolutions — TCGplayer 1,200-pack sample
  sv4pt5: 1 / 40, // Paldean Fates — shiny-loaded special set
}

/**
 * Per-set tier odds where a big enough sample exists to replace the era's.
 *
 * Delta Reign is the first Mega Evolution set whose whole ladder has been
 * counted: Double Rare ~1 in 5 packs, Illustration Rare ~1 in 9, Ultra Rare
 * ~1 in 12, Special Illustration Rare ~1 in 80, and the gold Mega Hyper Rare
 * ~1 in 1,000 (Drip Shop's launch count, and the same shape TCGplayer's
 * 4,000-pack study gave Pitch Black). The era profile has no Mega Hyper Rare
 * tier at all, so that card used to fall through to the generic 1-in-50 hit
 * weight — which valued a Delta Reign pack at twice what the market charges.
 *
 * The pre-release sample that disagrees (152 packs: 2.0% SIR, 0.66% MHR) is
 * three SIR pulls and a single gold Rayquaza — the hot end of the same range,
 * not a second measurement, so these figures stay on the documented side.
 */
export const SET_UPGRADE_OVERRIDE: Record<string, Record<string, number>> = {
  // The whole Mega Evolution line was counted by the TCGplayer Authentication
  // Centre, one sample per set. Mega Hyper Rare is the tier this table exists
  // for: no era profile carries it, so before these rows the gold cards were
  // dealt at the generic 1-in-50 hit weight — twenty to thirty times their
  // measured frequency, and enough to price each of these sets' packs at
  // roughly twice what they trade for.
  me1: { 'Mega Hyper Rare': 1 / 1260 }, // 5,000+ packs, Sept 2025
  me2: { 'Mega Hyper Rare': 1 / 1260 }, // Phantasmal Flames, Nov 2025
  // Ascended Heroes is the one set with its own tier: a Mega Attack Rare takes
  // the Ultra Rare's place in the pack, so Ultra Rare falls to 1 in 21 and the
  // new tier sits at 1 in 29 (2,000+ packs, Feb 2026).
  me2pt5: { 'Ultra Rare': 0.0481, 'Mega Attack Rare': 1 / 29, 'Mega Hyper Rare': 1 / 540 },
  me3: { 'Mega Hyper Rare': 1 / 1786 }, // Perfect Order, 3,500 packs, Apr 2026
  me4: { 'Mega Hyper Rare': 1 / 956 }, // Chaos Rising, Jun 2026
  me5: { 'Mega Hyper Rare': 1 / 1081 }, // Pitch Black, 4,000 packs, Jul 2026
  // Paldean Fates is shiny-loaded and was measured on its own sample, so its
  // whole hit ladder is the set's rather than the era's. Shiny Ultra Rare is
  // the tier that used to fall through to a 1-in-50 table value: it really
  // lands 1 in 13 packs, alongside a Shiny Rare in every fourth pack.
  sv4pt5: {
    'Double Rare': 0.1589,
    'Ultra Rare': 0.0661,
    'Illustration Rare': 0.0722,
    'Special Illustration Rare': 0.0172,
    'Shiny Rare': 0.2544,
    'Shiny Ultra Rare': 0.0772,
    'Hyper Rare': 0.0161,
  },
  // Crown Zenith's secret rares are 1 in 133 packs (0.75%) and its Galarian
  // Gallery secrets 1 in 125 — nowhere near the 1-in-50 table fallback.
  swsh12pt5: { 'Rare Secret': 1 / 133 },
  // The gallery-only table (never sold; kept for owned stock) carries the same
  // measured gallery rate as the host pack's subset slot: 35.2% per pack, not
  // the era profile's 9% and not a certainty.
  swsh12pt5gg: { 'Rare Secret': 1 / 133, 'Trainer Gallery Rare Holo': 0.352 },
  // Prismatic Evolutions was measured over 1,200 packs (TCGplayer, Jan 2025):
  // Double Rare 1 in 6, Ultra Rare 1 in 13, ACE SPEC 1 in 21, Hyper Rare 1 in 180.
  // Its 32 art rares are all SIRs, and it prints no Illustration Rare, Shiny or
  // Trainer Gallery card, so those tiers are zero rather than the era's share.
  sv8pt5: {
    'Double Rare': 0.1651,
    'Ultra Rare': 0.0746,
    'ACE SPEC Rare': 0.0468,
    'Hyper Rare': 0.0056,
    'Illustration Rare': 0,
    'Shiny Rare': 0,
    'Trainer Gallery Rare Holo': 0,
  },
  // Black Bolt and White Flare were counted together (TCGplayer's 700+ pack
  // study, July 2025): Double Rare 1 in 5, Ultra Rare 1 in 17, Illustration Rare
  // 1 in 6, Special Illustration Rare 1 in 80. Black White Rare never appeared in
  // that sample, so its 1-in-496 rate is the community estimate and is disclosed
  // as an estimate rather than presented as a count; it matters because the tier
  // holds the two ~$700 Victini cards.
  rsv10pt5: {
    'Double Rare': 0.2111,
    'Ultra Rare': 0.0583,
    'Illustration Rare': 0.1639,
    'Special Illustration Rare': 1 / 80,
    'Black White Rare': 1 / 496,
  },
  zsv10pt5: {
    'Double Rare': 0.2111,
    'Ultra Rare': 0.0583,
    'Illustration Rare': 0.1639,
    'Special Illustration Rare': 1 / 80,
    'Black White Rare': 1 / 496,
  },
  me6: {
    'Double Rare': 1 / 5,
    'Illustration Rare': 1 / 9,
    'Ultra Rare': 1 / 12,
    'Special Illustration Rare': 1 / 80,
    'Mega Hyper Rare': 1 / 1000,
  },
}

/** No set is a 100% hit machine: upgrades cap here even if the tiers sum past it. */
const MAX_UPGRADE_CHANCE = 0.85

export type PackSlot = 'common' | 'uncommon' | 'holo' | 'hit' | 'reverse' | 'reverse2' | 'energy' | 'subset' | 'phantom'
export type SlotPlan = { slot: PackSlot; count: number }

/**
 * Documented pack structures that are not the standard ten-card shape:
 * 30th Celebration (2 commons + 1 flex + 1 rare + a guaranteed Pikachu + a
 * foil Basic Energy in six cards, stretched to this game's ten) and the two
 * all-reprint subsets, where every card is a classic.
 */
/**
 * Bonus subsets that print inside another set's packs, mapped to their host.
 * The subset never has a wrapper of its own (SUBSET_ONLY_SETS in sealed.ts), so
 * its cards ride in the host pack's reverse-holo position: Shiny Vault in Hidden
 * Fates and Shining Fates, the four Trainer Galleries in their Sword & Shield
 * sets, and the Galarian Gallery in Crown Zenith.
 */
export const HOST_SUBSETS: Record<string, string> = {
  sm115: 'sma',
  swsh45: 'swsh45sv',
  swsh9: 'swsh9tg',
  swsh10: 'swsh10tg',
  swsh11: 'swsh11tg',
  swsh12: 'swsh12tg',
  swsh12pt5: 'swsh12pt5gg',
}

export const BLUEPRINTS: Record<string, SlotPlan[]> = {
  me55: [
    // Real 30C pack: 2 commons + a flex card + a rare/hit + a guaranteed
    // Pikachu, with the foil Basic Energy outside those game cards — so the
    // ten dealt here are the commons, the rare-or-hit and the Pikachu. The
    // rare and the hit are ONE card (the old shape dealt both).
    { slot: 'common', count: 8 },
    { slot: 'hit', count: 1 },
    { slot: 'subset', count: 1 },
  ],
  me55c: [{ slot: 'subset', count: 10 }],
  cel25c: [{ slot: 'subset', count: 10 }],
  // Celebrations' real pack is four cards, so it deals four of its own: its
  // table holds rares and hits but no commons or reverses for the era's shape.
  // The subset-only sets (Shiny Vault, the galleries, Basic Energy) are not sold
  // at all — see SUBSET_ONLY_SETS in sealed.ts — so they get no blueprint.
  cel25: [
    { slot: 'holo', count: 3 },
    { slot: 'hit', count: 1 },
  ],
  // McDonald's 2021 and 2022 are the two Happy Meal promotions that shipped a
  // real four-card pack: one Confetti holo and three non-holo. The catalogue
  // holds one row per card with no rarity split, so all four draw from the
  // same pool; the guaranteed foil is not modelled here.
  mcd21: [{ slot: 'common', count: 4 }],
  mcd22: [{ slot: 'common', count: 4 }],
  // Detective Pikachu's wrapper is four cards: three commons and one rare.
  det1: [
    { slot: 'common', count: 3 },
    { slot: 'hit', count: 1 },
  ],
  // Dragon Vault's wrapper is five Holofoil cards, and every card in the set is
  // foil; buildPullTable files all 21 in the holo pool so any of them can come
  // out of the five.
  dv1: [{ slot: 'holo', count: 5 }],
  // Host sets with a bonus subset: the subset card takes the reverse-holo
  // position, so the pack is still ten cards and the rare odds are untouched.
  // The physical order is the era's: commons, the reverse position, the rare,
  // then the uncommons.
  sm115: [
    { slot: 'common', count: 5 },
    { slot: 'subset', count: 1 },
    { slot: 'hit', count: 1 },
    { slot: 'uncommon', count: 3 },
  ],
  swsh45: [
    { slot: 'common', count: 5 },
    { slot: 'subset', count: 1 },
    { slot: 'hit', count: 1 },
    { slot: 'uncommon', count: 3 },
  ],
  swsh9: [
    { slot: 'common', count: 5 },
    { slot: 'subset', count: 1 },
    { slot: 'hit', count: 1 },
    { slot: 'uncommon', count: 3 },
  ],
  swsh10: [
    { slot: 'common', count: 5 },
    { slot: 'subset', count: 1 },
    { slot: 'hit', count: 1 },
    { slot: 'uncommon', count: 3 },
  ],
  swsh11: [
    { slot: 'common', count: 5 },
    { slot: 'subset', count: 1 },
    { slot: 'hit', count: 1 },
    { slot: 'uncommon', count: 3 },
  ],
  swsh12: [
    { slot: 'common', count: 5 },
    { slot: 'subset', count: 1 },
    { slot: 'hit', count: 1 },
    { slot: 'uncommon', count: 3 },
  ],
  swsh12pt5: [
    { slot: 'common', count: 5 },
    { slot: 'subset', count: 1 },
    { slot: 'hit', count: 1 },
    { slot: 'uncommon', count: 3 },
  ],
  // Prismatic Evolutions really has two reverse slots (Poké Ball first, Master
  // Ball second) and one rare-or-hit card, so its ten cards are 4 common + 3
  // uncommon + 2 reverse + 1 final. The separate guaranteed-rare slot is gone;
  // a final-slot miss draws a plain Rare from the holo pool.
  sv8pt5: [
    { slot: 'common', count: 4 },
    { slot: 'uncommon', count: 3 },
    { slot: 'reverse', count: 1 },
    { slot: 'reverse2', count: 1 },
    { slot: 'hit', count: 1 },
  ],
  // Ascended Heroes also opens two reverse slots: the first Energy-pattern
  // reverse, the second its assigned Poké Ball reverse (or an IR/SIR in that
  // slot). Four commons + three uncommons + the two reverses + the rare-or-hit
  // card make the ten-card pack.
  me2pt5: [
    { slot: 'common', count: 4 },
    { slot: 'uncommon', count: 3 },
    { slot: 'reverse', count: 1 },
    { slot: 'reverse2', count: 1 },
    { slot: 'hit', count: 1 },
  ],
}

/**
 * English packs carried a reverse holo from Legendary Collection (2002) on.
 * The date matters, not the year: Neo Destiny shipped in February 2002, before
 * Legendary Collection introduced the reverse printing in May.
 */
export function reverseInPack(setId: string): boolean {
  const row = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(setId) as
    | { release_date: string | null }
    | undefined
  const date = (row?.release_date ?? '').slice(0, 10)
  // No release date in the catalog: assume the modern shape rather than strip
  // a reverse slot a real pack had.
  return date === '' || date >= '2002/05/24'
}

/**
 * Did this set print a Basic Energy a WotC pack could carry? The catalogue
 * prices Basic Energy with no rarity; the special Energy cards (Neo Genesis's
 * Darkness/Metal, Team Rocket's Rainbow) are rare pulls and do not fill the
 * energy slot. Asking this before reserving the slot is what stops a pack
 * advertising a card its set's table cannot supply.
 */
const basicEnergyCache = new Map<string, boolean>()
function printsBasicEnergy(setId: string): boolean {
  const hit = basicEnergyCache.get(setId)
  if (hit !== undefined) return hit
  const row = db
    .prepare(`SELECT 1 AS n FROM cards WHERE set_id = ? AND supertype = 'Energy' AND (rarity IS NULL OR rarity = 'Common') LIMIT 1`)
    .get(setId)
  const prints = !!row
  basicEnergyCache.set(setId, prints)
  return prints
}

/**
 * How often a bonus subset fills its pack slot.
 *
 * A host set normally prints one gallery or shiny card in every pack, so its
 * subset slot is certain. Crown Zenith is the exception: its Galarian Gallery
 * lands in 35.2% of packs (TCGplayer's per-rarity count), so a miss has to deal
 * the ordinary reverse holo instead of a second gallery card.
 */
export const SUBSET_CHANCE: Record<string, number> = {
  swsh12pt5: 0.352,
  // Hidden Fates: one Shiny Vault card in about three packs, not every pack.
  // Pokecompare's Elite Fourum figures are 21.20% baby shinies, 10.19% Shiny
  // GX, 3.42% full-art Trainers and 1.01% gold, summing to 35.8%.
  sm115: 0.3582,
  // Shining Fates: ThePriceDex's per-rarity sample — Shiny Rare 1 in 4.4 packs,
  // Shiny V 1 in 19.8, Shiny VMAX 1 in 25.5, SV Secret 1 in 109.9 — sums to
  // 32.6%, matching the community figure of one Vault card in about three.
  swsh45: 0.3261,
  // A Trainer Gallery card fills the reverse-holo slot in about one pack in
  // eight. TCGplayer counted 12.31% on Lost Origin; the Trainer Gallery run
  // from Vivid Voltage to Lost Origin shares the shape, and none of the other
  // three has a published per-tier table here, so the same slot rate is used.
  swsh9: 0.1231,
  swsh10: 0.1231,
  swsh11: 0.1231,
  swsh12: 0.1241,
}

/**
 * How a bonus subset's slot rate splits between its rarities.
 *
 * The gallery's total is TCGplayer's per-pack count; how it divides inside the
 * subset is published for one tier only. ThePriceDex lists Giratina VSTAR
 * GG69, Arceus GG70, Dialga GG68 and Palkia GG67 at 1 in 500 packs each, which
 * is 0.8% of packs and agrees with TCGplayer's 0.75–0.80% Secret Rare rate.
 * The other 66 cards share what is left of the 35.2% evenly — that split is
 * this build's distribution, not a measured one, but it is the shape the flat
 * pool got wrong: a $290 Giratina cannot pull as often as a $2 Thievul.
 */
export const SUBSET_TIER_ODDS: Record<string, Record<string, number>> = {
  swsh12pt5: { 'Rare Secret': 0.008 },
  // Hidden Fates, per Pokecompare's Elite Fourum table: baby shinies 21.20%,
  // Shiny GX 10.19%, full-art Trainers 3.42%, gold 1.01%.
  sm115: { 'Rare Shiny': 0.212, 'Rare Shiny GX': 0.1019, 'Rare Ultra': 0.0342, 'Rare Secret': 0.0101 },
  // Shining Fates, per ThePriceDex: Shiny Rare 1 in 4.4 packs, Shiny V 1 in
  // 19.8, Shiny VMAX 1 in 25.5, SV Secret 1 in 109.9.
  swsh45: { 'Rare Shiny': 1 / 4.4, 'Rare Holo V': 1 / 19.8, 'Rare Holo VMAX': 1 / 25.5, 'Rare Secret': 1 / 109.9 },
  // Lost Origin's Trainer Gallery, per ThePriceDex's per-card figures: TG Rare
  // Holo 1 in 128.2, TG Rare Holo V 1 in 577.4, TG VMAX 1 in 577.4, TG Ultra
  // Rare 1 in 577.4, TG Secret Rare 1 in 218.2. Summed they give 12.4% of
  // packs, which is TCGplayer's own 12.31% Trainer Gallery count.
  swsh12: {
    'Trainer Gallery Rare Holo': 1 / 11.7,
    'Rare Holo V': 1 / 82.5,
    'Rare Holo VMAX': 1 / 144.3,
    'Rare Ultra': 1 / 96.2,
    'Rare Secret': 1 / 109.1,
  },
}

export function subsetChanceFor(setId: string): number {
  const chance = SUBSET_CHANCE[setId]
  return chance === undefined ? 1 : Math.max(0, Math.min(1, chance))
}

export function planFor(setId: string, cardsPerPack = 10): SlotPlan[] {
  const bp = BLUEPRINTS[setId]
  if (bp) return bp.map((s) => ({ ...s }))
  const era = eraOf(setId)
  const year = releaseYearOf(setId)
  // Legendary Collection and Expedition are WotC-era sets that DO carry a
  // reverse slot; Neo Destiny is the same year but predates the introduction.
  const reverse = reverseInPack(setId) ? (era === 'sv' ? 2 : 1) : 0
  // The game deals the ten game cards. e-Card/EX packs are nine cards and carry
  // no Basic Energy, so reserving a 2002 energy slot would invent a card the
  // real wrapper never held. Older WotC packs still get their Energy slot.
  const energy = profileFor(setId).energyInPack && year > 0 && year < 2002 && printsBasicEnergy(setId) ? 1 : 0
  const uncommon = 3
  const rare = 1
  const common = Math.max(1, cardsPerPack - (uncommon + rare + reverse + energy))
  // The order is the physical one, because the pack is revealed in order:
  //   1999–2001  commons, Energy, rare, uncommons   (Base Set's documented order)
  //   2002       commons, reverse holo, rare, uncommons
  //   2002–2022  commons, reverse holo, rare, uncommons
  //   2023–      commons, uncommons, two reverse holos, rare
  //              (PokeBeach: "each pack will now be ordered with the rarest
  //              cards in the back"; the Basic Energy sits after the ten)
  // The rare slot upgrades at the set's real odds rather than adding a card.
  const slots: SlotPlan[] = [{ slot: 'common', count: common }]
  if (era === 'sv') {
    slots.push({ slot: 'uncommon', count: uncommon })
    for (let i = 0; i < reverse; i++) slots.push({ slot: i === 0 ? 'reverse' : 'reverse2', count: 1 })
    slots.push({ slot: 'hit', count: rare })
    return slots
  }
  if (era === 'wotc') {
    if (reverse) slots.push({ slot: 'reverse', count: reverse })
    if (energy) slots.push({ slot: 'energy', count: 1 })
    slots.push({ slot: 'hit', count: rare })
    slots.push({ slot: 'uncommon', count: uncommon })
    return slots
  }
  if (reverse) slots.push({ slot: 'reverse', count: reverse })
  slots.push({ slot: 'hit', count: rare })
  slots.push({ slot: 'uncommon', count: uncommon })
  if (energy) slots.push({ slot: 'energy', count: 1 })
  return slots
}

/** A pack's slot as the shelf prints it: how many cards, and what fills them. */
export type PackSlotInfo = { slot: PackSlot; count: number; label: string; detail: string }

const SLOT_LABEL: Record<PackSlot, string> = {
  common: 'Commons',
  uncommon: 'Uncommons',
  holo: 'Rare',
  hit: 'Rare or better',
  reverse: 'Reverse holo',
  reverse2: 'Second reverse holo',
  energy: 'Basic Energy',
  subset: 'Guaranteed classic',
  phantom: 'Phantom chase',
}

const slotCache = new Map<string, PackSlotInfo[]>()

/**
 * The share of packs whose rare slot actually upgrades, read from the pool the
 * roller draws — the same number, not the profile's theoretical ceiling.
 */
function hitShare(setId: string): number {
  const row = db
    .prepare(`SELECT SUM(weight) AS w FROM pack_product_cards WHERE pack_product_id = ? AND slot = 'hit'`)
    .get(`${setId}-booster`) as { w: number | null } | undefined
  const pool = Math.min(MAX_UPGRADE_CHANCE, row?.w ?? 0)
  return pool > 0 ? pool : upgradeChance(setId)
}

/**
 * The era's slot breakdown, for the shelf.
 *
 * This is the very plan the roller deals (`planFor`), so the label and the pull
 * cannot disagree. The detail sentence names what fills the slot in this set's
 * era; it never promises a specific card, because a slot is a rule, not a
 * guarantee.
 */
export function packSlots(setId: string, cardsPerPack = 10): PackSlotInfo[] {
  const key = `${setId}:${cardsPerPack}`
  const cached = slotCache.get(key)
  if (cached) return cached
  const era = eraOf(setId)
  const chance = hitShare(setId)
  const pct = (n: number) => `${(n * 100).toFixed(1).replace(/\.0$/, '')}%`
  const paper = holoFinishFor(setId)
  const hostSubset = HOST_SUBSETS[setId]
  const hostSubsetName = hostSubset
    ? (db.prepare('SELECT name FROM sets WHERE id = ?').get(hostSubset) as { name: string } | undefined)?.name ?? hostSubset
    : null
  const out = planFor(setId, cardsPerPack).map(({ slot, count }): PackSlotInfo => {
    let detail: string
    switch (slot) {
      case 'common':
        detail = 'the body of the pack'
        break
      case 'uncommon':
        detail = 'three in every pack'
        break
      case 'reverse':
        detail = era === 'sv' ? 'first parallel' : 'a reverse printing of a common, uncommon or rare'
        break
      case 'reverse2': {
        const upgrades = secondSlotUpgradeOdds(setId)
        detail = upgrades.length > 0
          ? `second parallel — ${upgrades.map((u) => `${pct(u.odds)} ${u.rarity}`).join(', ')} replace${upgrades.length === 1 ? 's' : ''} it`
          : 'second parallel'
        break
      }
      case 'hit':
        detail = chance > 0 ? `upgrades to a hit in ${pct(chance)} of packs, else the ${paper} rare` : `the ${paper} rare`
        break
      case 'holo':
        detail = setId === 'dv1' ? 'every card in a Dragon Vault pack is Holofoil' : `the ${paper} rare`
        break
      case 'energy':
        detail = 'one Basic Energy'
        break
      case 'subset': {
        const subsetChance = subsetChanceFor(setId)
        detail = hostSubsetName
          ? subsetChance < 1
            ? `one ${hostSubsetName} card in ${pct(subsetChance)} of packs, else the reverse holo`
            : `one ${hostSubsetName} card in the reverse-holo position`
          : setId === 'me55'
            ? 'one 30th Celebration Pikachu'
            : count > 1
              ? `all ${count} cards come from this set's own pool`
              : 'a guaranteed classic reprint'
        break
      }
      case 'phantom':
        detail = 'an RGB Mew, about 1 in 12,000 packs'
        break
      default:
        detail = ''
    }
    // A card-by-card subset pack is not "guaranteed classic" — Shiny Vault and
    // the galleries are not reprints — so the label follows the shape.
    const label = setId === 'dv1' && slot === 'holo'
      ? 'Holofoil'
      : slot === 'subset'
        ? hostSubsetName ? 'Bonus subset' : count > 1 ? 'Subset cards' : SLOT_LABEL[slot]
        : SLOT_LABEL[slot]
    return { slot, count, label, detail }
  })
  slotCache.set(key, out)
  return out
}

const yearCache = new Map<string, number>()

/** Release year for a set (0 when the catalog has no date). */
export function releaseYearOf(setId: string): number {
  const hit = yearCache.get(setId)
  if (hit !== undefined) return hit
  const row = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(setId) as { release_date: string | null } | undefined
  const year = Number((row?.release_date ?? '').slice(0, 4)) || 0
  yearCache.set(setId, year)
  return year
}

export function eraOf(setId: string): EraKey {
  const year = releaseYearOf(setId)
  if (year === 0) return 'sv'
  if (year <= 2002) return 'wotc'
  if (year <= 2006) return 'ex'
  if (year <= 2010) return 'dp'
  if (year <= 2016) return 'bw'
  if (year <= 2019) return 'sm'
  if (year <= 2022) return 'swsh'
  return 'sv'
}

export function profileFor(setId: string): EraProfile {
  return ERA_PROFILES[eraOf(setId)]
}

/**
 * The generic finish a slot rolls, with its odds.
 *
 * The rare slot's split is the era's own: an older set's plain Rare is non-holo,
 * everything else is the era's foil paper, and Scarlet & Violet made every Rare
 * foil. A hit is always foil and a reverse slot always prints the reverse paper,
 * so those two are certain. This is the coarse odds model the pull roller and
 * the finish layer share — it never claims a specific sheet for a specific card.
 */
export function finishOddsFor(setId: string, slot: 'rare' | 'hit' | 'reverse'): { finish: FinishId; odds: number }[] {
  if (slot === 'reverse') return [{ finish: 'reverse', odds: 1 }]
  if (slot === 'hit') return [{ finish: holoFinishFor(setId), odds: 1 }]
  const holo = eraOf(setId) === 'sv' ? 1 : profileFor(setId).rare.holo
  return [
    { finish: 'plain', odds: Math.max(0, 1 - holo) },
    { finish: holoFinishFor(setId), odds: Math.max(0, holo) },
  ]
}

/** The tier odds a set actually rolls, with its own SIR figure applied. */
export function upgradeOdds(setId: string): Record<string, number> {
  const odds = { ...profileFor(setId).upgrade, ...SET_UPGRADE_OVERRIDE[setId] }
  const sir = SET_SIR_OVERRIDE[setId]
  if (sir !== undefined && 'Special Illustration Rare' in odds) odds['Special Illustration Rare'] = sir
  return odds
}

/** Chance the final card upgrades into a hit at all (per pack). */
export function upgradeChance(setId: string): number {
  const total = Object.values(upgradeOdds(setId)).reduce((a, v) => a + v, 0)
  return Math.min(MAX_UPGRADE_CHANCE, total)
}

// ---------------------------------------------------------------------------
// The second reverse slot is where Scarlet & Violet prints its Illustration
// and Special Illustration Rares. The rare slot keeps the Double Rare, Ultra,
// Hyper, ACE SPEC and shiny tiers; the IR/SIR tier's per-pack odds move with
// the card into slot two, so a pack can print an ex and an illustration rare
// side by side, exactly as the wrapper does.
// ---------------------------------------------------------------------------
export const SECOND_SLOT_RARITIES = ['Illustration Rare', 'Special Illustration Rare'] as const

export type SecondSlotOutcome =
  | { kind: 'ball'; ball: 'pokeball' | 'masterball' }
  | { kind: 'assigned' }
  | { kind: 'upgrade'; rarity: string }
  | { kind: 'reverse' }

/** True for the two tiers Scarlet & Violet prints in the second reverse slot. */
export function isSecondSlotRarity(rarity: string | null | undefined): boolean {
  return !!rarity && SECOND_SLOT_RARITIES.some((r) => r.toLowerCase() === rarity.toLowerCase())
}

/**
 * The second reverse slot's outcomes and their per-pack odds.
 *
 * A fixed-stamp set rolls its ball first (Prismatic's Master Ball is 5%), a set
 * whose second slot is an assigned paper keeps its measured IR/SIR rates, and
 * every other Scarlet & Violet set uses the era's IR/SIR rates, with the SIR
 * figure replaced by the set's own measure where one exists. Prismatic
 * Evolutions prints no Illustration Rares at all (its 32 art rares are all
 * SIRs), so that tier is dropped for it and the share falls to the reverse.
 * Whatever is not taken by an upgrade or a stamp is an ordinary reverse
 * printing. Returns null for an era that has no second slot.
 */
const secondCache = new Map<string, { outcome: SecondSlotOutcome; odds: number }[] | null>()
const tierCache = new Map<string, boolean>()

/** Whether the catalogue actually holds a card of this rarity for the set. */
function setPrintsTier(setId: string, rarity: string): boolean {
  const key = `${setId}:${rarity.toLowerCase()}`
  const hit = tierCache.get(key)
  if (hit !== undefined) return hit
  const row = db.prepare(`SELECT 1 AS ok FROM cards WHERE set_id = ? AND lower(rarity) = lower(?) LIMIT 1`).get(setId, rarity)
  tierCache.set(key, !!row)
  return !!row
}

export function secondSlotOdds(setId: string): { outcome: SecondSlotOutcome; odds: number }[] | null {
  const cached = secondCache.get(setId)
  if (cached !== undefined) return cached
  if (eraOf(setId) !== 'sv') {
    secondCache.set(setId, null)
    return null
  }
  const chances = specialSlotChancesFor(setId, 'second')
  const out: { outcome: SecondSlotOutcome; odds: number }[] = []
  // A tier the catalogue does not hold for this set cannot be drawn: its share
  // falls through to the ordinary reverse rather than being promised and lost.
  if (chances?.assigned) {
    // Ascended Heroes measured this slot: 11.25% IR, 1.44% SIR, the rest the
    // card's own assigned stamp. Its numbers are the slot's, not the era's.
    for (const u of chances.upgrades) {
      if (isSecondSlotRarity(u.rarity) && setPrintsTier(setId, u.rarity)) out.push({ outcome: { kind: 'upgrade', rarity: u.rarity }, odds: u.odds })
    }
    if (chances.assigned > 0.0001) out.push({ outcome: { kind: 'assigned' }, odds: chances.assigned })
  } else {
    for (const ball of chances?.balls ?? []) out.push({ outcome: { kind: 'ball', ball: ball.ball }, odds: ball.odds })
    const era = upgradeOdds(setId)
    for (const rarity of SECOND_SLOT_RARITIES) {
      const odds = era[rarity]
      if (odds !== undefined && odds > 0 && setPrintsTier(setId, rarity)) out.push({ outcome: { kind: 'upgrade', rarity }, odds })
    }
  }
  const used = out.reduce((a, o) => a + o.odds, 0)
  if (used < 1 - 0.0001) out.push({ outcome: { kind: 'reverse' }, odds: 1 - used })
  secondCache.set(setId, out)
  return out
}

/** The IR/SIR rates the second slot rolls, for its pool and the shelf. */
export function secondSlotUpgradeOdds(setId: string): { rarity: string; odds: number }[] {
  return (secondSlotOdds(setId) ?? []).flatMap((o) => (o.outcome.kind === 'upgrade' ? [{ rarity: o.outcome.rarity, odds: o.odds }] : []))
}

// ---------------------------------------------------------------------------
// Pack expected value — the shop's ESTIMATE line and the sealed-price anchor
// ---------------------------------------------------------------------------

type PoolRow = {
  card_id: string
  weight: number
  slot: string
  rarity: string | null
  supertype: string | null
  subtypes: string | null
}
const evCache = new Map<string, number>()

export function invalidatePackOdds(setId?: string) {
  if (setId) {
    evCache.delete(setId)
    yearCache.delete(setId)
    secondCache.delete(setId)
    basicEnergyCache.delete(setId)
    for (const key of [...tierCache.keys()]) if (key.startsWith(`${setId}:`)) tierCache.delete(key)
    for (const key of [...slotCache.keys()]) if (key.startsWith(`${setId}:`)) slotCache.delete(key)
  } else {
    evCache.clear()
    yearCache.clear()
    secondCache.clear()
    basicEnergyCache.clear()
    tierCache.clear()
    slotCache.clear()
  }
}

// Expected value, slot plans and basic-Energy presence all depend on the same
// price/catalogue snapshot.
onDerivedDataChanged(() => invalidatePackOdds())

function weightedAvg(rows: { weight: number; v: number }[]): number {
  let total = 0
  for (const r of rows) if (r.weight > 0) total += r.weight
  if (total <= 0) return rows.length ? rows.reduce((a, r) => a + r.v, 0) / rows.length : 0
  return rows.reduce((acc, r) => acc + r.v * (Math.max(0, r.weight) / total), 0)
}

export { weightedAvg }

/**
 * Expected cash value of one booster pack, using the same structure and odds
 * the roller uses: the final card is an upgrade with `upgradeChance`, else a
 * basic Energy (or a second reverse holo when the set prints no Energy).
 */
export function expectedPackValue(setId: string, cardsPerPack = 10): number {
  const cached = evCache.get(setId)
  if (cached !== undefined) return cached
  const rows = db
    .prepare(
      `SELECT p.card_id, p.weight, p.slot, c.rarity, c.supertype, c.subtypes
       FROM pack_product_cards p JOIN cards c ON c.id = p.card_id
       WHERE p.pack_product_id = ?`,
    )
    .all(`${setId}-booster`) as PoolRow[]
  if (rows.length === 0) return 0
  // A rare-slot card is priced at the finish it pulls as: holo rares are foil.
  const withValue = (slot: string, variant?: string) =>
    rows
      .filter((r) => r.slot === slot)
      .map((r) => ({
        weight: r.weight,
        v: valueOf(r.card_id, variant ?? (slot === 'holo' || slot === 'hit' ? rareVariantFor(setId, r.rarity) : 'normal')),
      }))
  const common = withValue('common')
  const uncommon = withValue('uncommon')
  const hitPool = withValue('hit')
  const energy = withValue('energy')
  const reverseRows = [
    ...rows.filter((r) => r.slot === 'common' || r.slot === 'uncommon'),
    ...(isSpecialSet(setId) ? rows.filter((r) => r.slot === 'holo') : []),
  ]
  const reverseValue = weightedAvg(reverseRows.map((r) => ({ weight: r.weight, v: valueOf(r.card_id, 'reverseHolofoil') })))
  const avgOr = (rows: { weight: number; v: number }[], fallback: number) => (rows.length > 0 ? weightedAvg(rows) : fallback)
  const ballValue = (ball: keyof typeof BALL_VARIANTS) =>
    avgOr(
      reverseRows
        .filter((r) => ballEligible(ball, r, r.card_id))
        .map((r) => ({ weight: r.weight, v: valueOf(r.card_id, BALL_VARIANTS[ball]) })),
      reverseValue,
    )
  // Ascended Heroes prints one assigned paper per card, so the slot is worth the
  // weighted average of each eligible card stamped with its own paper.
  const assignedValue = () =>
    avgOr(
      reverseRows
        .filter((r) => ascendedVariantFor(r.card_id))
        .map((r) => ({ weight: r.weight, v: valueOf(r.card_id, ascendedVariantFor(r.card_id)!) })),
      reverseValue,
    )
  const upgradeValue = (rarity: string) =>
    avgOr(
      rows
        .filter((r) => (r.slot === 'hit' || r.slot === 'reverse2hit') && (r.rarity ?? '').toLowerCase() === rarity.toLowerCase())
        .map((r) => ({ weight: r.weight, v: valueOf(r.card_id) })),
      reverseValue,
    )
  const firstSlotValue = () => {
    const chances = specialSlotChancesFor(setId, 'first')
    if (!chances) return reverseValue
    let value = chances.reverse * reverseValue
    for (const ball of chances.balls) value += ball.odds * ballValue(ball.ball)
    value += chances.assigned * assignedValue()
    for (const upgrade of chances.upgrades) value += upgrade.odds * upgradeValue(upgrade.rarity)
    return value
  }
  // The second reverse slot carries a ball or an assigned stamp where the set
  // prints one, otherwise the era's IR/SIR, otherwise an ordinary reverse.
  const secondSlotValue = () => {
    const table = secondSlotOdds(setId)
    if (!table) return reverseValue
    let value = 0
    for (const { outcome, odds } of table) {
      if (outcome.kind === 'ball') value += odds * ballValue(outcome.ball)
      else if (outcome.kind === 'assigned') value += odds * assignedValue()
      else if (outcome.kind === 'upgrade') value += odds * upgradeValue(outcome.rarity)
      else value += odds * reverseValue
    }
    return value
  }
  // Same rule as the roller: the pool's summed weights ARE the per-pack odds.
  // The rare slot upgrades at those odds and otherwise draws the plain/holo
  // rare the era's split describes — one card, not two.
  const chance = Math.min(0.85, hitPool.reduce((a, r) => a + Math.max(0, r.weight), 0))
  const finalValue = chance * weightedAvg(hitPool) + (1 - chance) * weightedAvg(withValue('holo'))
  let total = 0
  for (const s of planFor(setId, cardsPerPack)) {
    if (s.slot === 'common') total += s.count * weightedAvg(common)
    else if (s.slot === 'uncommon') total += s.count * weightedAvg(uncommon)
    else if (s.slot === 'holo') total += s.count * weightedAvg(withValue('holo'))
    else if (s.slot === 'reverse') total += s.count * firstSlotValue()
    else if (s.slot === 'reverse2') total += s.count * secondSlotValue()
    else if (s.slot === 'hit') total += s.count * finalValue
    else if (s.slot === 'energy') total += s.count * weightedAvg(energy)
    else if (s.slot === 'subset') {
      // The subset card takes the reverse-holo position, so a pack that misses
      // the measured subset rate deals a reverse holo in its place.
      const p = subsetChanceFor(setId)
      total += s.count * (p * weightedAvg(withValue('subset')) + (1 - p) * reverseValue)
    }
    else if (s.slot === 'phantom') total += s.count * weightedAvg(withValue('phantom'))
  }
  const result = round2(total)
  evCache.set(setId, result)
  return result
}

/**
 * True for blueprint sets whose every slot is the subset pool: the all-reprint
 * Classic Collection, and the gallery/Shiny Vault sets that are sold as their own
 * pack. Their whole catalogue is a bonus subset, so the classifier routes every
 * card there instead of guessing a rarity ladder the set never printed.
 */
export function isAllSubset(setId: string): boolean {
  const bp = BLUEPRINTS[setId]
  return !!bp && bp.every((s) => s.slot === 'subset')
}
