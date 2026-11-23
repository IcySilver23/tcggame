import { db } from '../lib/db'
import { miniPackFor, miniSequinOdds } from './gmpacks'
import { holoFinishFor } from './finish-odds'
import {
  eraOf,
  packSlots,
  profileFor,
  secondSlotUpgradeOdds,
  upgradeOdds,
} from './packodds'
import { sellsProduct } from './sealed'
import { packMixFor, sealedEvidenceFor, unsellableReason } from '../catalog/sealed-evidence'

// ---------------------------------------------------------------------------
// Per-product manifests
// ---------------------------------------------------------------------------
//
// The shop's rows answer "what can I buy?"; they do not answer "what is inside,
// and how sure are we?". This module is the second answer.
//
// A product is described in five sections — pack counts, layout, promos, hit
// tiers and foil guarantees — and every section is a ManifestField with its own
// status:
//
//   verified    a source names this product or the physical rule it follows;
//   inferred    a verified set/era rule applied to a product no source names;
//   modelled    this build's own choice, disclosed as such;
//   unverified  no source here, and NO value is claimed.
//
// The last rule is load-bearing: an unverified field always has value null. A
// generic ETB's promo is the clearest example. The opener still synthesises one
// so the box has the right beat, but the manifest does not pretend the catalogue
// knows that set's promo; it says so and leaves the value empty.
//
// This is deliberately not a second roller. The layout and hit tiers are read
// from `packodds`, the mini-pack composition from `general-mills`, and the
// product rows from `pack_products`, so the manifest cannot drift from what the
// opener deals without the audit noticing.

export type ManifestStatus = 'verified' | 'inferred' | 'modelled' | 'unverified'
export type ManifestVerdict = 'verified' | 'inferred' | 'modelled' | 'partial' | 'unsourced'
export type ManifestFieldName = 'counts' | 'layout' | 'promos' | 'hitTiers' | 'foil'

export type SourceRef = {
  label: string
  /** Null when the evidence is a local file or a build decision, not a public page. */
  url: string | null
}

export type ManifestField<T> = {
  value: T | null
  status: ManifestStatus
  note: string
  sources: SourceRef[]
}

export type ManifestCounts = {
  /** Wrappers the product opens. A booster is one; a display is its pack count. */
  packs: number
  /** Cards the game deals from one wrapper. */
  cardsPerPack: number
  /** Cards in the physical wrapper, when a source states it. */
  physicalCardsPerPack: number | null
  /** Game cards in the whole product. */
  totalCards: number
  /** Physical cards in the whole product, including a component the game omits. */
  physicalTotalCards: number | null
}

export type ManifestLayout = {
  perPack: { slot: string; count: number; label: string; detail: string }[]
  packs: number
  totalCards: number
  /** Physical components the current opener does not deal. */
  omitted: string[]
}

export type ManifestPromo = {
  name: string
  cardId: string | null
  guaranteed: boolean
  /** Chance this named promo is in one rip, 0–1. */
  chance: number
  note: string
}

export type ManifestHitTier = {
  name: string
  odds: number
  basis: 'pack'
  slot: 'rare-or-hit' | 'second-reverse'
  note: string
}

export type ManifestFoil = {
  label: string
  guarantee: 'every-pack' | 'chance' | 'none'
  odds: number | null
  note: string
}

export type ProductManifest = {
  productId: string
  setId: string
  setName: string
  name: string
  kind: string
  releaseDate: string | null
  sold: boolean
  status: ManifestVerdict
  coverage: Record<ManifestStatus, number>
  counts: ManifestField<ManifestCounts>
  layout: ManifestField<ManifestLayout>
  promos: ManifestField<ManifestPromo[]>
  hitTiers: ManifestField<ManifestHitTier[]>
  foil: ManifestField<ManifestFoil[]>
  limitations: string[]
  sources: SourceRef[]
}

type ProductRow = {
  id: string
  set_id: string
  name: string
  kind: string
  packs: number | null
  cards_per_pack: number
  release_date: string | null
  description: string | null
  set_name: string
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const S = {
  booster: {
    label: 'Bulbapedia — Booster pack (TCG)',
    url: 'https://bulbapedia.bulbagarden.net/wiki/Booster_pack_(TCG)',
  },
  holofoil: {
    label: 'Bulbapedia — Holofoil',
    url: 'https://bulbapedia.bulbagarden.net/wiki/Holofoil',
  },
  packStructure: {
    label: 'server/services/packodds.ts — documented pack blueprint and era structure',
    url: null,
  },
  sealedFormat: {
    label: 'server/services/sealed.ts — generated bundle/ETB/display format',
    url: null,
  },
  localRelease: {
    label: 'server/catalog/local-releases.json — published product copy',
    url: null,
  },
  miniSunMoon: {
    label: 'Bulbapedia — Sun & Moon TCG Series merchandise',
    url: 'https://bulbapedia.bulbagarden.net/wiki/Sun_%26_Moon_TCG_Series_merchandise',
  },
  miniSwordShield: {
    label: 'Bulbapedia — Sword & Shield TCG Series merchandise',
    url: 'https://bulbapedia.bulbagarden.net/wiki/Sword_%26_Shield_TCG_Series_merchandise',
  },
  noWrapper: {
    label: 'server/services/sealed.ts — subset-only and no-booster set lists',
    url: null,
  },
  productAvailability: {
    label: 'server/catalog/sealed-evidence.ts — product-level availability',
    url: null,
  },
} as const satisfies Record<string, SourceRef>

// ---------------------------------------------------------------------------
// Product-specific evidence that is not in the database
// ---------------------------------------------------------------------------

/**
 * Published product copy names these promos. The catalogue has no set → promo
 * foreign key, and most of these cards are not in the catalogued set, so the
 * manifest records the name and leaves the card id null rather than guessing.
 */
const NAMED_PROMOS: Record<string, { names: string[]; source: SourceRef }> = {
  'me6-etb': { names: ['Kyogre'], source: S.localRelease },
  'me55-upc-day': { names: ['Pikachu ex', 'Espeon ex'], source: S.localRelease },
  'me55-upc-night': { names: ['Pikachu ex', 'Umbreon ex'], source: S.localRelease },
  'me55-ditto-premium': { names: ['Ditto'], source: S.localRelease },
  'me55-figure-mew': { names: ['Mew'], source: S.localRelease },
  'me55-figure-mewtwo': { names: ['Mewtwo'], source: S.localRelease },
}

/** Products whose local-release row is the product-level source, not a generated row. */
const LOCAL_RELEASE_PRODUCTS = new Set([
  'me6-booster',
  'me6-bundle',
  'me6-etb',
  'me6-display',
  'me55-upc-day',
  'me55-upc-night',
  'me55-ditto-premium',
  'me55-figure-mew',
  'me55-figure-mewtwo',
])

/**
 * Physical wrapper counts that the renderer's pack model documents. They are
 * separate from `cards_per_pack`, which is what the game deals: the game keeps
 * ten cards where the physical e-Card/EX wrapper held nine, and it stretches
 * 30th Celebration's six-card wrapper to ten.
 */
function physicalCardsFor(setId: string): { count: number | null; source: SourceRef } {
  if (setId === 'me55') return { count: 6, source: S.packStructure }
  if (setId === 'cel25') return { count: 4, source: S.booster }
  if (setId === 'mcd21' || setId === 'mcd22' || setId === 'det1') return { count: 4, source: S.booster }
  if (setId === 'dv1') return { count: 5, source: S.booster }
  if (setId === 'base6' || setId.startsWith('ecard') || setId.startsWith('ex')) {
    return { count: 9, source: S.booster }
  }
  const era = eraOf(setId)
  if (era === 'wotc') return { count: 11, source: S.booster }
  if (era === 'ex') return { count: 9, source: S.booster }
  return { count: 10, source: S.booster }
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function field<T>(
  value: T | null,
  status: ManifestStatus,
  note: string,
  sources: SourceRef[] = [],
): ManifestField<T> {
  if (value === null && status !== 'unverified') {
    throw new Error('A manifest field with no value must be unverified')
  }
  return { value, status, note, sources }
}

function unverified<T>(note: string, sources: SourceRef[] = []): ManifestField<T> {
  return { value: null, status: 'unverified', note, sources }
}

function pct(odds: number): string {
  return `${(odds * 100).toFixed(1).replace(/\.0$/, '')}%`
}

function present(sources: (SourceRef | null)[]): SourceRef[] {
  return sources.filter((s): s is SourceRef => s !== null)
}

function uniqueSources(sources: SourceRef[]): SourceRef[] {
  const seen = new Set<string>()
  return sources.filter((s) => {
    const key = `${s.label}|${s.url ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function zeroCoverage(): Record<ManifestStatus, number> {
  return { verified: 0, inferred: 0, modelled: 0, unverified: 0 }
}

// ---------------------------------------------------------------------------
// Manifest construction
// ---------------------------------------------------------------------------

export function productManifest(productId: string): ProductManifest | null {
  const row = db
    .prepare(
      `SELECT p.id, p.set_id, p.name, p.kind, p.packs, p.cards_per_pack, p.release_date,
              p.description, s.name AS set_name
       FROM pack_products p JOIN sets s ON s.id = p.set_id
       WHERE p.id = ?`,
    )
    .get(productId) as ProductRow | undefined
  if (!row) return null
  return buildManifest(row)
}

export function allProductManifests(): ProductManifest[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.set_id, p.name, p.kind, p.packs, p.cards_per_pack, p.release_date,
              p.description, s.name AS set_name
       FROM pack_products p JOIN sets s ON s.id = p.set_id
       ORDER BY p.set_id, p.kind, p.id`,
    )
    .all() as ProductRow[]
  return rows.map(buildManifest)
}

function buildManifest(row: ProductRow): ProductManifest {
  const sold = sellsProduct(row.id, row.set_id)
  const evidence = sealedEvidenceFor(row.id)
  const mini = miniPackFor(row.id)
  const miniSource = mini ? (row.id === 'gm-25th-mini' ? S.miniSwordShield : S.miniSunMoon) : null
  const local = LOCAL_RELEASE_PRODUCTS.has(row.id) ? S.localRelease : null
  const gamePacks = evidence?.packs ?? (row.kind === 'booster' || !row.packs ? 1 : Math.max(1, row.packs))
  const gameCards = Math.max(1, row.cards_per_pack)
  const physical = physicalCardsFor(row.set_id)
  const physicalPer = mini ? 3 : physical.count
  const extraPhysical = row.id.startsWith('me55-upc-') ? 3 : 0
  const physicalTotal = physicalPer == null ? null : gamePacks * physicalPer + extraPhysical
  const perPack = mini
    ? mini.slots.map((s) => ({
        slot: s.slot,
        count: s.count,
        label: s.slot === 'sequin'
          ? 'Sequin Holofoil'
          : s.slot === 'pikachu'
            ? 'Guaranteed Sequin Pikachu'
            : s.slot === 'reprint'
              ? 'Reprints'
              : 'Extra draws',
        detail: s.hostFill
          ? 'host expansion commons and uncommons'
          : s.entries.every((e) => e.variant !== 'normal')
            ? 'Sequin Holofoil printing'
            : 'the promotion’s own pool',
      }))
    : packSlots(row.set_id, gameCards)
  const hasHitSlot = perPack.some((s) => s.slot === 'hit')
  const hasReverseSlot = perPack.some((s) => s.slot === 'reverse' || s.slot === 'reverse2')
  const hasHoloSlot = perPack.some((s) => s.slot === 'holo')
  const limitations: string[] = []
  const mix = packMixFor(row.id)
  if (mix) {
    const names = mix.map((segment) => {
      const name = (db.prepare('SELECT name FROM sets WHERE id = ?').get(segment.setId) as { name: string } | undefined)?.name ?? segment.setId
      return `${segment.packs} pack${segment.packs === 1 ? '' : 's'} of ${name}`
    })
    limitations.push(`This box spans ${mix.length} expansions: ${names.join(', ')}. The opener deals them in that order, segment by segment.`)
  }

  if (!sold) {
    const unavailable = unsellableReason(row.id)
    const reason = unavailable ?? 'This row is kept only as an internal catalogue host; it is not offered for sale.'
    const source = unavailable ? S.productAvailability : S.noWrapper
    return {
      productId: row.id,
      setId: row.set_id,
      setName: row.set_name,
      name: row.name,
      kind: row.kind,
      releaseDate: row.release_date,
      sold: false,
      status: 'unsourced',
      coverage: zeroCoverage(),
      counts: unverified(reason, [source]),
      layout: unverified(reason, [source]),
      promos: unverified(reason, [source]),
      hitTiers: unverified(reason, [source]),
      foil: unverified(reason, [source]),
      limitations: [reason],
      sources: [source],
    }
  }

  // ---- package counts -----------------------------------------------------
  let countsStatus: ManifestStatus
  let countsNote: string
  if (evidence) {
    const evidenceCards = evidence.cardsPerPack
    const physicalMismatch = evidenceCards != null && evidenceCards !== gameCards
    countsStatus = physicalMismatch ? 'modelled' : 'verified'
    countsNote = `Published product copy names ${gamePacks} pack${gamePacks === 1 ? '' : 's'}${evidence.promos.length ? ` and the ${evidence.promos.join(' or ')} promo` : ' and no promo'}.${physicalMismatch ? ` The physical wrapper holds ${evidenceCards}; the game deals ${gameCards}.` : ''}`
  } else if (mini) {
    countsStatus = 'verified'
    countsNote = `The source states a three-card cereal pack; this product opens ${gamePacks} pack of ${gameCards} cards.`
  } else if (local && row.kind === 'special') {
    countsStatus = physicalPer != null && physicalPer !== gameCards ? 'modelled' : 'inferred'
    countsNote = `Published product copy names the contents; the game deals ${gameCards} cards per pack${physicalPer != null && physicalPer !== gameCards ? ` where the physical wrapper holds ${physicalPer}` : ''}.`
  } else if (local) {
    countsStatus = physicalPer != null && physicalPer !== gameCards ? 'modelled' : 'inferred'
    countsNote = `Published product copy names the pack count; the game deals ${gameCards} cards per pack${physicalPer != null && physicalPer !== gameCards ? ` where the physical wrapper holds ${physicalPer}` : ''}.`
  } else if (row.kind === 'booster') {
    countsStatus = physicalPer != null && physicalPer !== gameCards ? 'modelled' : 'inferred'
    countsNote = physicalPer != null && physicalPer !== gameCards
      ? `The physical wrapper holds ${physicalPer} cards; the game deals ${gameCards}. The difference is the ten-card abstraction, not a claim about the wrapper.`
      : `One wrapper; the game deals ${gameCards} cards.`
  } else if (row.kind === 'etb') {
    countsStatus = 'modelled'
    countsNote = `The catalogue applies a ${gamePacks}-pack ETB format to this set. ETB pack counts have varied by product, and no per-product ETB manifest is stored.`
  } else if (row.kind === 'bundle') {
    countsStatus = 'modelled'
    countsNote = `The catalogue applies a ${gamePacks}-pack bundle format to this set. No per-product bundle manifest is stored.`
  } else if (row.kind === 'display') {
    countsStatus = 'modelled'
    countsNote = `The catalogue applies a ${gamePacks}-pack display format to this set. Display counts have varied by product, and no per-product display manifest is stored.`
  } else {
    countsStatus = physicalPer != null && physicalPer !== gameCards ? 'modelled' : 'inferred'
    countsNote = `The game opens ${gamePacks} pack${gamePacks === 1 ? '' : 's'} of ${gameCards} cards.`
  }
  if (countsStatus !== 'verified') limitations.push(countsNote)

  const counts = field<ManifestCounts>(
    {
      packs: gamePacks,
      cardsPerPack: gameCards,
      physicalCardsPerPack: physicalPer,
      totalCards: gamePacks * gameCards,
      physicalTotalCards: physicalTotal,
    },
    countsStatus,
    countsNote,
    uniqueSources(present([local, evidence ? evidence.source : null, miniSource, mini ? null : physical.source, countsStatus === 'modelled' ? S.sealedFormat : null])),
  )

  // ---- layout -------------------------------------------------------------
  const omitted: string[] = []
  const layoutStatus: ManifestStatus = mini
    ? 'verified'
    : row.set_id === 'me55'
      ? 'modelled'
      : 'inferred'
  const layoutNote = mini
    ? 'The mini pack is one Sequin slot plus reprint draws; the exact trapped pool is modelled from the host expansion.'
    : row.set_id === 'me55'
      ? 'The physical 30th Celebration wrapper is six cards. The game stretches it to ten, so this is the game layout, not a 1:1 wrapper.'
      : row.id.startsWith('me55-upc-')
        ? 'The set layout repeats across the 29 Celebration packs; the box closes with the three-card Classic Collection pack, whose three cards are all from that subset.'
        : row.kind === 'booster'
          ? 'The set-level slot plan; the game deals this exact split.'
          : `The set-level slot plan repeated across ${gamePacks} packs.`
  if (layoutStatus !== 'verified') limitations.push(layoutNote)
  if (omitted.length) limitations.push(`Not opened: ${omitted.join('; ')}.`)

  const layout = field<ManifestLayout>(
    { perPack, packs: gamePacks, totalCards: gamePacks * gameCards, omitted },
    layoutStatus,
    layoutNote,
    uniqueSources(mini ? present([miniSource]) : present([S.booster, S.packStructure, local])),
  )

  // ---- promos -------------------------------------------------------------
  let promos: ManifestField<ManifestPromo[]>
  if (mini) {
    const odds = miniSequinOdds(row.id)
    const entries: ManifestPromo[] = (odds?.cards ?? []).map((c) => ({
      name: c.name,
      cardId: c.id,
      guaranteed: odds?.guaranteed.includes(c.id) ?? false,
      chance: c.chance,
      note: odds?.guaranteed.includes(c.id)
        ? 'Named as present in every pack.'
        : 'One draw from the pack’s named Sequin pool; not guaranteed.',
    }))
    promos = field(
      entries,
      'verified',
      entries.length > 0
        ? 'The source names the Sequin cards; the exact reprint slots are modelled from the host set.'
        : 'The source names a Sequin card, but this catalogue cannot resolve its pool.',
      present([miniSource]),
    )
  } else if (evidence && evidence.promos.length > 0) {
    // A box that holds every named promo is not a one-of draw: each is certain.
    const all = evidence.promoPolicy === 'all'
    const chance = all ? 1 : 1 / evidence.promos.length
    const mapped = evidence.promoIds?.length === evidence.promos.length
    promos = field(
      evidence.promos.map((name, i) => ({
        name,
        cardId: evidence.promoIds?.[i] ?? null,
        guaranteed: all || evidence.promos.length === 1,
        chance,
        note: all
          ? 'Named in published product copy as one of the promos in the box; every one of them is inside.'
          : evidence.promos.length === 1
            ? 'Named in published product copy as the box promo.'
            : 'Named in published product copy as one of the box’s possible promos.',
      })),
      'verified',
      evidence.promos.length === 1
        ? `Published product copy names ${evidence.promos[0]} as the box promo.${mapped ? ' The catalogue maps it to its printing.' : ' The catalogue does not map the promo id, so the manifest names it without inventing a card id.'}`
        : all
          ? `Published product copy names ${evidence.promos.join(', ')}; all of them are in the box.${mapped ? ' The catalogue maps each to its printing.' : ' The catalogue does not map the promo ids.'}`
          : `Published product copy names ${evidence.promos.join(' or ')}; one is in the box, so neither is individually guaranteed.${mapped ? ' The catalogue maps each to its printing.' : ' The catalogue does not map the promo ids.'}`,
      [evidence.source],
    )
  } else if (evidence) {
    // A sourced box can legitimately carry no card promo — a binder's sticker
    // sheet is not a card, and a Sword & Shield Elite Trainer Box really had no
    // promo — so an empty list from the evidence is the answer rather than the
    // generic "no mapping stored" line below.
    promos = field(
      [] as ManifestPromo[],
      'verified',
      `Published product copy names no promo card for this product. ${evidence.note}`,
      [evidence.source],
    )
  } else if (NAMED_PROMOS[row.id]) {
    const named = NAMED_PROMOS[row.id]
    promos = field(
      named.names.map((name) => ({
        name,
        cardId: null,
        guaranteed: true,
        chance: 1,
        note: 'Named in published product copy; the catalogue has no card-id mapping for this promo.',
      })),
      'inferred',
      `Published product copy names ${named.names.join(' and ')}. The card id is not mapped, so the manifest names the promo but does not invent one.`,
      [named.source],
    )
  } else if (row.kind === 'etb') {
    promos = unverified(
      'No set → ETB promo mapping is stored. The opener synthesises a deterministic promo from the era’s promo pool, but this manifest does not claim that is the real box promo.',
      [S.sealedFormat],
    )
    limitations.push('The ETB promo is synthetic and explicitly unverified.')
  } else {
    promos = field([] as ManifestPromo[], 'verified', 'No promo is part of a booster, bundle or display.', [S.sealedFormat])
  }

  // ---- hit tiers ----------------------------------------------------------
  let hitTiers: ManifestField<ManifestHitTier[]>
  if (mini) {
    const odds = miniSequinOdds(row.id)
    hitTiers = field(
      odds
        ? [{
            name: 'Sequin Holofoil',
            odds: odds.anyChance,
            basis: 'pack' as const,
            slot: 'rare-or-hit' as const,
            note: `${pct(odds.anyChance)} of rips hold at least one Sequin card.`,
          }]
        : [],
      'inferred',
      'The Sequin chance is derived from the sourced composition; the host reprint pool is modelled.',
      present([miniSource]),
    )
  } else if (!hasHitSlot) {
    hitTiers = field([] as ManifestHitTier[], 'verified', 'This product has no rare-or-hit slot in its layout.', [S.packStructure])
  } else {
    // The second reverse slot carries IR/SIR in the sets that print it. Do not
    // list those tiers in the rare slot as well, and do not invent a second
    // slot for a blueprint (30C) that has none.
    const secondTiers = perPack.some((s) => s.slot === 'reverse2') ? secondSlotUpgradeOdds(row.set_id) : []
    const secondNames = new Set(secondTiers.map((t) => t.rarity))
    const tiers: ManifestHitTier[] = Object.entries(upgradeOdds(row.set_id))
      .filter(([name]) => secondNames.size === 0 || !secondNames.has(name))
      .map(([name, odds]) => ({
        name,
        odds,
        basis: 'pack' as const,
        slot: 'rare-or-hit' as const,
        note: `The rare slot upgrades to ${name} in ${pct(odds)} of packs.`,
      }))
    for (const tier of secondTiers) {
      tiers.push({
        name: tier.rarity,
        odds: tier.odds,
        basis: 'pack' as const,
        slot: 'second-reverse' as const,
        note: `The second reverse slot upgrades to ${tier.rarity} in ${pct(tier.odds)} of packs.`,
      })
    }
    const profile = profileFor(row.set_id)
    const estimated = /estimate/i.test(profile.source)
    const note = row.set_id === 'me55'
      ? `The set uses the Scarlet & Violet era model; there is no measured 30th Celebration sample here. ${profile.source}.`
      : estimated
        ? `Era-typical estimate, not a measured per-set sample: ${profile.source}.`
        : `Community sample: ${profile.source}.`
    hitTiers = field(
      tiers,
      estimated || row.set_id === 'me55' ? 'modelled' : 'inferred',
      note,
      [S.packStructure],
    )
    if (estimated || row.set_id === 'me55') limitations.push(note)
  }

  // ---- foil guarantees ----------------------------------------------------
  const foil: ManifestFoil[] = []
  let foilStatus: ManifestStatus = 'inferred'
  if (mini) {
    const odds = miniSequinOdds(row.id)
    const chance = odds?.anyChance ?? 0
    foil.push({
      label: 'Sequin Holofoil',
      guarantee: chance >= 1 ? 'every-pack' : 'chance',
      odds: chance,
      note: chance >= 1 ? 'One Sequin Holofoil card in every pack.' : `${pct(chance)} of packs hold at least one Sequin Holofoil card.`,
    })
    foilStatus = 'verified'
  } else if (hasReverseSlot) {
    foil.push({
      label: 'Reverse holo',
      guarantee: 'every-pack',
      odds: 1,
      note: row.set_id === 'sv'
        ? 'Every pack has a first parallel; a second-slot upgrade can replace the second parallel.'
        : 'Every pack has a reverse-holo slot, from Legendary Collection onward.',
    })
    foilStatus = 'verified'
  }

  if (row.set_id === 'dv1') {
    foil.push({
      label: 'Holofoil',
      guarantee: 'every-pack',
      odds: 1,
      note: 'Every card in a Dragon Vault pack is Holofoil.',
    })
    foilStatus = 'verified'
  }

  if (row.set_id === 'me55') {
    foil.push({
      label: 'Guaranteed 30th Celebration Pikachu',
      guarantee: 'every-pack',
      odds: 1,
      note: 'The game’s 30C blueprint reserves the subset slot for the guaranteed Pikachu.',
    })
    foilStatus = 'modelled'
  }

  if (hasHoloSlot && row.set_id !== 'dv1') {
    const profile = profileFor(row.set_id)
    const odds = eraOf(row.set_id) === 'sv' ? 1 : profile.rare.holo
    const label = row.set_id === 'cel25' ? 'Confetti Holofoil' : `${holoFinishFor(row.set_id)} holo paper`
    foil.push({
      label,
      guarantee: 'chance',
      odds,
      note: row.set_id === 'cel25'
        ? 'Celebrations uses Confetti Holofoil; the era helper alone would name the Sword & Shield paper, so this row names the set’s actual paper.'
        : `The rare slot prints on the era’s ${holoFinishFor(row.set_id)} paper when it is foil; plain rares stay non-holo before Scarlet & Violet.`,
    })
    if (/estimate/i.test(profile.source)) foilStatus = 'modelled'
  }

  if (row.set_id === 'mcd21' || row.set_id === 'mcd22') {
    foil.push({
      label: 'Confetti Holofoil',
      guarantee: 'chance',
      odds: null,
      note: 'The real four-card Happy Meal pack guarantees one Confetti holo; this build’s four-card roll does not, so no guarantee is claimed.',
    })
    foilStatus = 'modelled'
  }

  if (foil.length === 0) {
    foil.push({
      label: 'No guaranteed foil',
      guarantee: 'none',
      odds: 0,
      note: 'This product’s layout has no reverse, holo or hit guarantee.',
    })
    foilStatus = 'verified'
  }

  if (foilStatus !== 'verified') limitations.push('One or more foil claims are modelled or unverified; see the foil entries.')

  const foilField = field(
    foil,
    foilStatus,
    foilStatus === 'verified' ? 'These guarantees follow the layout and the named paper.' : 'These guarantees are the build’s model; read the per-entry notes.',
    mini ? present([miniSource]) : [S.holofoil, S.packStructure],
  )

  const fields = [counts, layout, promos, hitTiers, foilField]
  const coverage = zeroCoverage()
  for (const f of fields) coverage[f.status] += 1
  let status: ManifestVerdict
  if (coverage.unverified > 0) status = 'partial'
  else if (coverage.modelled > 0) status = 'modelled'
  else if (coverage.inferred > 0) status = 'inferred'
  else status = 'verified'

  return {
    productId: row.id,
    setId: row.set_id,
    setName: row.set_name,
    name: row.name,
    kind: row.kind,
    releaseDate: row.release_date,
    sold: true,
    status,
    coverage,
    counts,
    layout,
    promos,
    hitTiers,
    foil: foilField,
    limitations: [...new Set(limitations)],
    sources: uniqueSources(fields.flatMap((f) => f.sources)),
  }
}

export type ManifestSummary = {
  products: number
  sold: number
  hidden: number
  verdicts: Record<ManifestVerdict, number>
  fields: Record<ManifestFieldName, Record<ManifestStatus, number>>
}

export function manifestSummary(manifests: ProductManifest[]): ManifestSummary {
  const verdicts: Record<ManifestVerdict, number> = {
    verified: 0,
    inferred: 0,
    modelled: 0,
    partial: 0,
    unsourced: 0,
  }
  const fields: Record<ManifestFieldName, Record<ManifestStatus, number>> = {
    counts: zeroCoverage(),
    layout: zeroCoverage(),
    promos: zeroCoverage(),
    hitTiers: zeroCoverage(),
    foil: zeroCoverage(),
  }
  for (const m of manifests) {
    verdicts[m.status] += 1
    for (const name of Object.keys(fields) as ManifestFieldName[]) fields[name][m[name].status] += 1
  }
  return {
    products: manifests.length,
    sold: manifests.filter((m) => m.sold).length,
    hidden: manifests.filter((m) => !m.sold).length,
    verdicts,
    fields,
  }
}
