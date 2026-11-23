import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { markCatalogChanged, onDerivedDataChanged } from '../lib/derived-cache'
import { valueOf, firstEditionValueOf, round2 } from './market'
import * as sealed from './sealed'
import { mixedPackSpec, sealedEvidenceFor } from '../catalog/sealed-evidence'
import * as dailydeals from './dailydeals'
import * as vault from './vault'
import { rollMiniPack } from './gmpacks'
import { planFor, profileFor, eraOf, SET_UPGRADE_OVERRIDE, SET_SIR_OVERRIDE, invalidatePackOdds, isAllSubset, weightedAvg, secondSlotOdds, secondSlotUpgradeOdds, isSecondSlotRarity, subsetChanceFor, subsetMiss, SUBSET_TIER_ODDS, HOST_SUBSETS, type SecondSlotOutcome } from './packodds'
import { rareVariantFor } from './finish-odds'
import { ascendedVariantFor } from '../../src/foil/ball-stamps'
import {
  BALL_VARIANTS,
  ENERGY_REVERSE_VARIANT,
  ballEligible,
  ballVariantFor,
  energyReverseEligible,
  hasEnergyReverse,
  isSpecialSet,
  specialBallFor,
  specialSlotChancesFor,
} from './special-reverse'

// Migration: pull_history rows written before the owner column existed are all
// attributable by session-id convention — stamp the known NPC shapes (live-wing
// host rips except packs the player personally won and ripped, battle
// opponents, break spots) so the record endpoints can trust the column
// immediately on existing saves. Everything else was the player's.
try {
  db.exec(`ALTER TABLE pull_history ADD COLUMN owner TEXT NOT NULL DEFAULT 'player'`)
} catch { /* column already exists */ }
// The owner index lives here rather than schema.sql: on legacy saves the table
// predates the column, and a CREATE INDEX in schema.sql would fire before the
// ALTER above and abort boot with 'no such column: owner'.
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pulls_owner ON pull_history (owner)`)
} catch { /* non-fatal */ }
db.exec(
  `UPDATE pull_history SET owner = 'other'
   WHERE (substr(session_id, 1, 5) = 'live_'
           AND session_id NOT LIKE '%rios_you_%')
      OR substr(session_id, 1, 16) = 'battle_opponent_'
      OR substr(session_id, 1, 6) = 'break_'`,
)

// Pre-split tournaments wrote plain tourney_<timestamp> session ids — no side
// marker — so the generic backfill leaves them 'player' and an old save's
// tournament history pollutes the records with NPC rips (40 of 60 rows on the
// first save that hit this). The saved bracket is ground truth: every played
// slot records aTotal/bTotal and each side's per-pack sessions sum to that
// total exactly. Reconstruct ownership from it: for each slot, find disjoint
// unclaimed session subsets matching both sides' cent-exact totals, claim the
// __you__ side (leave it 'player'), and stamp every other matched session
// 'other'. Runs once per save (meta flag), then never again.
try {
  if (getMeta('pulls:tourneySelfHeal') !== '1') {
    type Pool = { session_id: string; total: number }
    const pool = db.prepare(
      `SELECT session_id, ROUND(SUM(value), 2) AS total FROM pull_history
       WHERE owner = 'player' AND session_id GLOB 'tourney_[0-9]*'
       GROUP BY session_id`,
    ).all() as Pool[]
    if (pool.length > 0) {
      const rows = db.prepare('SELECT id, bracket FROM tournaments').all() as { id: number; bracket: string | null }[]
      type Slot = { a?: string; b?: string; aTotal?: number; bTotal?: number }
      const stamped: string[] = []
      const claimed = new Set<string>()
      // Smallest exact-sum subset of unclaimed sessions (packs per side ≤ 3,
      // so subset size ≤ 4 is generous). Returns null when nothing matches.
      const matchSubset = (target: number): string[] | null => {
        const avail = pool.filter((p) => !claimed.has(p.session_id))
        for (let k = 1; k <= 4 && k <= avail.length; k++) {
          const idx: number[] = []
          const walk = (start: number, sum: number): string[] | null => {
            if (idx.length === k) return Math.abs(sum - target) < 0.005 ? idx.map((i) => avail[i].session_id) : null
            for (let i = start; i <= avail.length - (k - idx.length); i++) {
              idx.push(i)
              const hit = walk(i + 1, sum + avail[i].total)
              idx.pop()
              if (hit) return hit
            }
            return null
          }
          const hit = walk(0, 0)
          if (hit) return hit
        }
        return null
      }
      for (const t of rows) {
        let rounds: unknown
        try { rounds = JSON.parse(t.bracket ?? 'null') } catch { continue }
        if (!Array.isArray(rounds)) continue
        for (const round of rounds) {
          if (!Array.isArray(round)) continue
          for (const s of round as Slot[]) {
            if (!s || typeof s !== 'object') continue
            const sides: [string | undefined, number | undefined][] = [[s.a, s.aTotal], [s.b, s.bTotal]]
            const sidesWithTotals = sides.filter(([, tot]) => typeof tot === 'number').length
            const claimedNow: string[] = []
            const stampNow: string[] = []
            let resolvedSides = 0
            for (const [who, total] of sides) {
              if (typeof total !== 'number') continue
              const hit = matchSubset(total)
              if (!hit) continue
              resolvedSides++
              for (const sid of hit) claimed.add(sid)
              claimedNow.push(...hit)
              if (who !== '__you__') stampNow.push(...hit)
            }
            // Only commit when BOTH sides resolved — one side matching alone
            // could grab the wrong pack on a cent-tie.
            if (resolvedSides === sidesWithTotals) {
              stamped.push(...stampNow)
            } else {
              for (const sid of claimedNow) claimed.delete(sid)
            }
          }
        }
      }
      if (stamped.length > 0) {
        const upd = db.prepare('UPDATE pull_history SET owner = \'other\' WHERE session_id = ?')
        const tx = db.transaction(() => { for (const sid of stamped) upd.run(sid) })
        tx()
        console.warn(`[migrate] tournaments: reconstructed ownership for ${stamped.length} pre-split pull rows from saved brackets`)
      }
    }
    setMeta('pulls:tourneySelfHeal', '1')
  }
} catch (e) {
  console.warn('[migrate] tournament pull-ownership self-heal skipped:', e instanceof Error ? e.message : e)
}

// ---------------------------------------------------------------------------
// Real sealed-product catalog (MSRP from official Pokemon Center retail)
// ---------------------------------------------------------------------------

type ProductDef = { setId: string; kind: string; name: string; msrp: number; packs: number; cardsPerPack: number }

export const PRODUCTS: ProductDef[] = [
  { setId: 'sv3pt5', kind: 'booster', name: 'Scarlet & Violet—151 Booster Pack', msrp: 4.49, packs: 1, cardsPerPack: 10 },
  { setId: 'sv3pt5', kind: 'bundle', name: 'Scarlet & Violet—151 Booster Bundle', msrp: 26.99, packs: 6, cardsPerPack: 10 },
  { setId: 'sv3pt5', kind: 'etb', name: 'Scarlet & Violet—151 Elite Trainer Box', msrp: 54.99, packs: 9, cardsPerPack: 10 },
  { setId: 'sv8', kind: 'booster', name: 'Surging Sparks Booster Pack', msrp: 4.49, packs: 1, cardsPerPack: 10 },
  { setId: 'sv8', kind: 'etb', name: 'Surging Sparks Elite Trainer Box', msrp: 54.99, packs: 9, cardsPerPack: 10 },
  { setId: 'sv8', kind: 'display', name: 'Surging Sparks Booster Display (36 packs)', msrp: 161.64, packs: 36, cardsPerPack: 10 },
  { setId: 'sv8.5', kind: 'booster', name: 'Prismatic Evolutions Booster Pack', msrp: 4.99, packs: 1, cardsPerPack: 10 },
  { setId: 'sv8.5', kind: 'etb', name: 'Prismatic Evolutions Elite Trainer Box', msrp: 59.99, packs: 9, cardsPerPack: 10 },
  { setId: 'sv8.5', kind: 'special', name: 'Prismatic Evolutions Premium Collection', msrp: 79.99, packs: 15, cardsPerPack: 10 },
  { setId: 'sv4pt5', kind: 'booster', name: 'Paldean Fates Booster Pack', msrp: 4.49, packs: 1, cardsPerPack: 10 },
  { setId: 'sv4pt5', kind: 'etb', name: 'Paldean Fates Elite Trainer Box', msrp: 54.99, packs: 9, cardsPerPack: 10 },
]

// ---------------------------------------------------------------------------
// Pull table construction — built ONLY from the set's real rarity distribution
// ---------------------------------------------------------------------------

// Every rarity label the catalog uses. Anything missing here fell through to
// rank 1 and dealt like a Common — which is exactly why a 'Pikachu Rare' was as
// common as a Vulpix, a 'LEGEND' reprint was bulk, and the Trainer Gallery was
// invisible. Rank 3 = plain rare / rare holo (the holo slot); 4-7 = the special
// ladder in the hit slot, weighted by TIER_ODDS; 8 = phantom, rolled on its own.
const RARITY_RANK: Record<string, number> = {
  'Common': 1, 'Uncommon': 2,
  'Rare': 3, 'Rare Holo': 3,
  'Double Rare': 4, 'Rare Holo V': 4, 'Rare Break': 4, 'Rare BREAK': 4,
  'Rare Holo VMAX': 5, 'Rare Holo VSTAR': 5, 'Rare Holo EX': 5, 'Rare Holo GX': 5,
  'Rare Holo LV.X': 5, 'Rare Holo ex': 5, 'Rare Prime': 5, 'LEGEND': 5,
  'Illustration Rare': 5, 'Ultra Rare': 5, 'Rare Ultra': 5,
  'Rare Shiny': 5, 'Shiny Rare': 5, 'Rare Shining': 5, 'Rare Prism Star': 5,
  'Rare ACE': 5, 'ACE SPEC Rare': 5, 'Amazing Rare': 5, 'Radiant Rare': 5,
  'Trainer Gallery Rare Holo': 5,
  // TCGplayer spells the same tier "Secret Rare"; Celebrations' gold Mew is
  // labelled that way, and without this line the label fell through to rank 1
  // and filed a 1-in-150 card in the common pool.
  'Special Illustration Rare': 6, 'Rare SECRET': 6, 'Rare Secret': 6, 'Secret Rare': 6,
  'Rare Rainbow': 6, 'Rare Shiny GX': 6, 'Shiny Ultra Rare': 6, 'Rare Holo Star': 6,
  'Hyper Rare': 7, 'Mega Hyper Rare': 7, 'MEGA_ATTACK_RARE': 7, 'Black White Rare': 7,
  'Futuristic Rare': 7,
  'Pikachu Rare': 7, 'Classic Collection': 7, // guaranteed-subset tiers
  'RGB Rare': 8,
}

/** Tiers that fill their own guaranteed slot: the 30 Pikachus in 30th
 *  Celebration and Celebrations' classic reprint subset. They never appear in
 *  the ordinary rare ladder — every 30C pack ends in one of the 30 Pikachus. */
const SUBSET_RARITIES = new Set(['Pikachu Rare', 'Classic Collection'])

/**
 * Real per-pack tier odds, used as relative weights inside the hit slot so a
 * Special Illustration Rare stays genuinely rarer than a Double Rare instead
 * of one-in-forty-two like every other hit. The 30C figures come from
 * TCGplayer's 3,000-pack study (Double Rare 21%, Illustration Rare 19.7%,
 * SIR 4.9%, Futuristic Rare 0.83%); the rest are era-typical estimates.
 */
export const TIER_ODDS: Record<string, number> = {
  'Double Rare': 0.20, 'Illustration Rare': 0.19, 'Special Illustration Rare': 0.049,
  'Ultra Rare': 0.06, 'Rare Ultra': 0.05, 'Rare SECRET': 0.02, 'Rare Secret': 0.02, 'Secret Rare': 0.02,
  'Rare Rainbow': 0.015, 'Hyper Rare': 0.02, 'Mega Hyper Rare': 0.02, 'MEGA_ATTACK_RARE': 0.02,
  'Black White Rare': 0.01, 'Futuristic Rare': 0.008,
  'Rare Holo EX': 0.06, 'Rare Holo GX': 0.06, 'Rare Holo V': 0.06,
  'Rare Holo VMAX': 0.03, 'Rare Holo VSTAR': 0.03, 'Rare Holo LV.X': 0.02, 'Rare Holo ex': 0.02,
  'Rare Prime': 0.05, 'LEGEND': 0.03, 'Rare Break': 0.03, 'Rare BREAK': 0.03,
  'Rare Shining': 0.03, 'Rare Shiny': 0.05, 'Shiny Rare': 0.05, 'Rare Shiny GX': 0.02,
  'Shiny Ultra Rare': 0.02, 'Rare Holo Star': 0.01, 'Rare Prism Star': 0.02,
  'Rare ACE': 0.02, 'ACE SPEC Rare': 0.02, 'Amazing Rare': 0.05, 'Radiant Rare': 0.05,
  'Trainer Gallery Rare Holo': 0.10,
}

/** A tier name with case and separators flattened, for label matching. */
const tierKey = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim()

/**
 * The per-pack odds a set deals a hit tier at, and where the figure comes from.
 *
 * `set` is a measured row for this set, `era` its era profile, `table` the
 * legacy table (real, but not this set's own figure) and `generic` the 1-in-50
 * last resort. Every caller reads the figure here.
 *
 * The labels are written by hand and by the local release files, so exact
 * matching silently lost researched figures: the catalogue says "Rare Holo EX"
 * where the era profile said "Rare Holo ex", and Ascended Heroes' new tier
 * arrives as "MEGA_ATTACK_RARE" against an override that spells it out. Both
 * were dealt at the legacy table instead of the rate someone had counted, so
 * matching now ignores case and separators.
 */
export type TierOddsKind = 'set' | 'era' | 'table' | 'generic'

export function tierOddsSource(setId: string, rarity: string): { odds: number; kind: TierOddsKind } {
  const want = tierKey(rarity)
  // A set's own SIR figure outranks its other rows, which is the order
  // `upgradeOdds` merges them in.
  const sir = SET_SIR_OVERRIDE[setId]
  if (sir !== undefined && want === tierKey('Special Illustration Rare')) return { odds: sir, kind: 'set' }
  // Highest authority first. The table that names the tier answers with its rate
  // AND its name in the same step, so the figure cannot be resolved from one
  // table and attributed to another.
  const sources: [TierOddsKind, Record<string, number>][] = [
    ['set', SET_UPGRADE_OVERRIDE[setId] ?? {}],
    ['era', profileFor(setId).upgrade],
    ['table', TIER_ODDS],
  ]
  for (const [kind, rows] of sources) {
    for (const [name, odds] of Object.entries(rows)) if (tierKey(name) === want) return { odds, kind }
  }
  return { odds: 0.02, kind: 'generic' }
}

// Structure and hit odds live in packodds.ts, so the roller, the shop's
// ESTIMATE line and the sealed-price anchor all read one table.
export { planFor, packSlots } from './packodds'
export type { PackSlot, PackSlotInfo, SlotPlan } from './packodds'

// Rarities at or above this rank don't share the rare slot — they have their
// own dice (see PHANTOM_ODDS), because a ~1-in-12,000 card cannot be expressed
// as a share of a slot that appears in every pack.
const PHANTOM_RANK = 8
/** 30th Celebration RGB Mews: ~1 in 12,000 packs per colour (community estimate). */
const PHANTOM_PER_CARD_ODDS = 1 / 12_000

function rarityRank(r: string | null): number {
  if (!r) return 0
  return RARITY_RANK[r] ?? (r.startsWith('Rare') ? 3 : 1)
}

export function buildPullTable(setId: string, cardsPerPack = 10) {
  const cards = db
    // Trainers and Energy print in the same packs — leaving them out made
    // whole slots impossible to fill for sets whose commons are mostly items.
    .prepare(`SELECT id, name, rarity, supertype, number FROM cards WHERE set_id = ?`)
    .all(setId) as { id: string; name: string; rarity: string | null; supertype: string; number: string }[]

  // A bonus subset prints inside this set's packs, not in a product of its own.
  const bonusSetId = HOST_SUBSETS[setId]
  const bonus = bonusSetId
    ? (db
        .prepare(`SELECT id, name, rarity, supertype, number FROM cards WHERE set_id = ?`)
        .all(bonusSetId) as typeof cards)
    : []

  if (cards.length === 0) return

  const commons: typeof cards = []
  const uncommons: typeof cards = []
  const holos: typeof cards = []
  const hits: typeof cards = []
  // Scarlet & Violet's second reverse slot, not the rare slot, prints the
  // Illustration and Special Illustration Rares.
  const reverse2Hits: typeof cards = []
  const phantoms: typeof cards = []
  const subsets: typeof cards = []
  const energies: typeof cards = []

  // Classic Collection keeps each reprint's original rarity label, so the only
  // honest classification is "every card in this set is the subset".
  const allSubset = isAllSubset(setId)
  const svEra = eraOf(setId) === 'sv'

  for (const c of cards) {
    if (allSubset) {
      subsets.push(c)
      continue
    }
    // Every Dragon Vault card — the three unlabelled Trainers included — was
    // printed Holofoil, so the whole set fills the foil pool and a five-card
    // pack can draw any of it.
    if (setId === 'dv1') {
      holos.push(c)
      continue
    }
    const rank = rarityRank(c.rarity)
    // Word-boundary tokens: 'ex'/'V'/'GX' are named suffixes, not substrings
    // (Vulpix, Eevee, Exeggcute and Venusaur all contain v/x letters).
    // Bracketed segments are form/letter labels — 'Unown [V]' is a common, not
    // a special-art V.
    const special = /\b(ex|v|gx|vmax|vstar|v-union)\b/i.test(c.name.replace(/\[[^\]]*\]/g, ' '))
    // Basic Energy is its own card in the pack, never a common: energy sitting
    // in the common pool is how a pack ended up holding two of them.
    if (c.supertype === 'Energy' && rank <= 1) energies.push(c)
    else if (SUBSET_RARITIES.has(c.rarity ?? '')) subsets.push(c)
    else if (rank >= PHANTOM_RANK) phantoms.push(c)
    else if (rank <= 1 && !special) commons.push(c)
    else if (rank === 2) uncommons.push(c)
    else if (rank === 3) holos.push(c)
    else if (svEra && isSecondSlotRarity(c.rarity)) reverse2Hits.push(c)
    else hits.push(c)
  }
  // The subset's cards are the pack's guaranteed bonus card, never a common or
  // a rare pull of the host set, whatever rarity label the subset prints.
  for (const c of bonus) subsets.push(c)

  const clear = db.prepare('DELETE FROM pack_product_cards WHERE pack_product_id = ?')
  const insert = db.prepare(
    'INSERT OR IGNORE INTO pack_product_cards (pack_product_id, card_id, slot, weight) VALUES (?, ?, ?, ?)',
  )

  // The era's real rare split and upgrade odds, for this set.
  const profile = profileFor(setId)

  db.transaction(() => {
    // Every set rips from its own booster table — kind products (bundle/ETB/
    // display) all roll the same table via rollPack(set_id).
    const pid = `${setId}-booster`
    clear.run(pid)
    estimateCache.delete(setId)
    sealed.invalidateDerivedPrices(setId)
    invalidatePackOdds(setId)
    const wCommon = commons.length ? 1 / commons.length : 0
    for (const c of commons) insert.run(pid, c.id, 'common', wCommon)
    const wUncommon = uncommons.length ? 1 / Math.max(1, uncommons.length) : 0
    for (const c of uncommons) insert.run(pid, c.id, 'uncommon', wUncommon)
    // Rare slot: the era's real split between plain rares and holo rares.
    const plainRares = holos.filter((c) => !/holo/i.test(c.rarity ?? ''))
    const holoRares = holos.filter((c) => /holo/i.test(c.rarity ?? ''))
    for (const c of plainRares) insert.run(pid, c.id, 'holo', profile.rare.plain / plainRares.length)
    for (const c of holoRares) insert.run(pid, c.id, 'holo', profile.rare.holo / holoRares.length)
    // The final card is the only place a hit comes from, so every card carries
    // its tier's REAL per-pack odds divided by how many cards share that tier.
    // Summed, the pool is the pack's upgrade chance — an SIR at 1 in 36 stays
    // 1 in 36 instead of being a share of an always-hit slot.
    const tierCount = new Map<string, number>()
    for (const c of hits) tierCount.set(c.rarity ?? '', (tierCount.get(c.rarity ?? '') ?? 0) + 1)
    for (const c of hits) {
      const tier = c.rarity ?? ''
      insert.run(pid, c.id, 'hit', tierOddsSource(setId, tier).odds / (tierCount.get(tier) ?? 1))
    }
    // The IR/SIR pool rides in the second reverse slot at that slot's own
    // per-pack rates, so the rare slot's summed weights no longer include them.
    const secondOdds = new Map(secondSlotUpgradeOdds(setId).map((u) => [u.rarity.toLowerCase(), u.odds]))
    const secondCount = new Map<string, number>()
    for (const c of reverse2Hits) {
      const tier = (c.rarity ?? '').toLowerCase()
      secondCount.set(tier, (secondCount.get(tier) ?? 0) + 1)
    }
    for (const c of reverse2Hits) {
      const tier = (c.rarity ?? '').toLowerCase()
      insert.run(pid, c.id, 'reverse2hit', (secondOdds.get(tier) ?? 0) / (secondCount.get(tier) ?? 1))
    }
    // Basic Energy ships as the pack's final card — at most one per pack.
    // Bulk-weighted like a common: basic Energy is set completion, not chase.
    const wEnergy = energies.length ? 1 / Math.max(1, commons.length + uncommons.length + energies.length) : 0
    for (const c of energies) insert.run(pid, c.id, 'energy', wEnergy)
    // The bonus subset's own tier structure. A named rarity keeps its researched
    // per-pack odds and the rest of the subset shares what remains, because the
    // flat pool handed a gallery's four secrets the same chance as its cheapest
    // card: a $290 Giratina pulled as often as a $2 Thievul.
    const subsetTiers = SUBSET_TIER_ODDS[setId]
    if (subsetTiers && subsets.length > 0) {
      const named = subsets.filter((c) => subsetTiers[c.rarity ?? ''] !== undefined)
      const rest = subsets.filter((c) => subsetTiers[c.rarity ?? ''] === undefined)
      const namedTotal = Object.values(subsetTiers).reduce((a, n) => a + n, 0)
      const restTotal = Math.max(0, subsetChanceFor(setId) - namedTotal)
      const namedCount = new Map<string, number>()
      for (const c of named) namedCount.set(c.rarity ?? '', (namedCount.get(c.rarity ?? '') ?? 0) + 1)
      for (const c of named) insert.run(pid, c.id, 'subset', subsetTiers[c.rarity ?? ''] / (namedCount.get(c.rarity ?? '') ?? 1))
      if (rest.length > 0) for (const c of rest) insert.run(pid, c.id, 'subset', restTotal / rest.length)
    } else {
      const wSubset = subsets.length ? 1 / subsets.length : 0
      for (const c of subsets) insert.run(pid, c.id, 'subset', wSubset)
    }
    const wPhantom = phantoms.length ? 1 / phantoms.length : 0
    for (const c of phantoms) insert.run(pid, c.id, 'phantom', wPhantom)
  })()
  markCatalogChanged()
}

/**
 * Subset-only wrappers that ship INSIDE a box instead of on a shelf: the 30th
 * Celebration Ultra-Premium Collection holds one three-card Classic Collection
 * pack. The subset has no product row of its own (SUBSET_ONLY_SETS — it was
 * never sold alone), so nothing else builds its table, and without one the
 * box's last wrapper would abort the whole rip as "Pull table missing".
 */
export const IN_BOX_SUBSET_PACKS: Readonly<Record<string, number>> = { me55c: 3 }

/**
 * Those wrappers are real printed packs with real packaging, so the ceremony
 * wears the photo. TCGplayer lists the 30th Celebration one as its own product
 * ("30th Celebration Classic Collection Pack", 704192) — gold wrapper, the
 * Classic Collection pack strip, "3 additional game cards" — even though no shop
 * sells it alone. Anything not listed here still falls back to foil + symbol.
 */
const IN_BOX_SUBSET_ART: Readonly<Record<string, string>> = {
  me55c: 'https://tcgplayer-cdn.tcgplayer.com/product/704192_in_400x400.jpg',
}

/** Build the pull table a subset wrapper needs to be dealt. Idempotent. */
export function buildInBoxSubsetTables(): number {
  let built = 0
  // pack_product_cards carries a foreign key to pack_products, so the wrapper
  // needs a row to point at even though no shelf ever sold it. It stays hidden
  // (SUBSET_ONLY_SETS) and the prune keeps it as a pull-table host.
  const host = db.prepare(
    `INSERT OR IGNORE INTO pack_products (id, set_id, name, kind, msrp, market_price, packs, cards_per_pack, release_date, description, image_url)
     SELECT ?, s.id, s.name || ' Pack', 'booster', 0, NULL, 1, ?, s.release_date, NULL, ? FROM sets s WHERE s.id = ?`,
  )
  // INSERT OR IGNORE leaves an existing host row alone, so art added later has
  // to be filled in on the rows that are already there.
  const missingArt = db.prepare("UPDATE pack_products SET image_url = ? WHERE id = ? AND (image_url IS NULL OR image_url = '')")
  for (const [setId, cards] of Object.entries(IN_BOX_SUBSET_PACKS)) {
    const have = (db.prepare('SELECT COUNT(*) AS n FROM cards WHERE set_id = ?').get(setId) as { n: number }).n
    if (have === 0) continue
    const art = IN_BOX_SUBSET_ART[setId] ?? null
    host.run(`${setId}-booster`, cards, art, setId)
    if (art) missingArt.run(art, `${setId}-booster`)
    buildPullTable(setId, cards)
    built++
  }
  return built
}

function productId(p: ProductDef): string {
  return `${p.setId}-${p.kind}`
}

// ---------------------------------------------------------------------------
// Pack value estimation (for the shop UI, labeled ESTIMATED)
// ---------------------------------------------------------------------------

type PackEstimate = { avg: number; p50: number; p90: number; topChases: { id: string; name: string; rarity: string; value: number }[] }

// Memoized per set — the simulation is too heavy to recompute on every shop
// request (502 sets × 300 packs × per-card price lookups). Cleared whenever
// that set's pull table is rebuilt.
const estimateCache = new Map<string, PackEstimate>()

export function estimatePackValue(setId: string): PackEstimate {
  const hit = estimateCache.get(setId)
  if (hit) return hit
  // The rare slot prices each card at the finish it pulls as: a holo rare is a
  // foil card, so its value is the holo printing's, not the plain one's.
  const finishVariant = (slot: string, cardId: string) =>
    slot === 'holo' || slot === 'hit'
      ? setId === 'dv1'
        ? 'holofoil'
        : rareVariantFor(setId, cardMeta(cardId).rarity)
      : 'normal'
  const loadPool = (slot: string, variant?: string) =>
    (db.prepare(`SELECT card_id, weight FROM pack_product_cards WHERE pack_product_id = ? AND slot = ?`).all(`${setId}-booster`, slot) as { card_id: string; weight: number }[])
      .map((r) => ({ ...r, v: valueOf(r.card_id, variant ?? finishVariant(slot, r.card_id)) }))
  // The same plan the roll uses: the era's ten game cards — commons, 3
  // uncommons, reverse holo(s), and one rare-or-hit that upgrades at the era's
  // real odds. A subset-only blueprint still adds its subset slot.
  // A wrapper that holds fewer than ten cards is estimated on its own shape: the
  // Classic Collection pack is three reprints, not ten (ten would price a
  // three-card wrapper at more than a display box).
  const slots = planFor(setId, IN_BOX_SUBSET_PACKS[setId] ?? 10)
  if (loadPool('subset').length > 0 && !slots.some((s) => s.slot === 'subset')) slots.push({ slot: 'subset', count: 1 })
  const reverse = [
    ...loadPool('common', 'reverseHolofoil'),
    ...loadPool('uncommon', 'reverseHolofoil'),
    ...(isSpecialSet(setId) ? loadPool('holo', 'reverseHolofoil') : []),
  ]
  const energy = loadPool('energy')
  const hitPool = loadPool('hit')
  const reverse2HitPool = loadPool('reverse2hit')
  // Ascended Heroes stamps the drawn card with its own paper, so its slot value
  // is the weighted average of each eligible card printed with that card's paper.
  const assignedPool = reverse
    .filter((r) => ascendedVariantFor(r.card_id))
    .map((r) => ({ ...r, v: valueOf(r.card_id, ascendedVariantFor(r.card_id)!) }))
  const ballPools = new Map<keyof typeof BALL_VARIANTS, { weight: number; v: number }[]>()
  const ballPool = (ball: keyof typeof BALL_VARIANTS) => {
    const cached = ballPools.get(ball)
    if (cached) return cached
    const rows = reverse
      .filter((r) => ballEligible(ball, cardMeta(r.card_id)))
      .map((r) => ({ ...r, v: valueOf(r.card_id, BALL_VARIANTS[ball]) }))
    ballPools.set(ball, rows)
    return rows
  }
  const upgradePools = new Map<string, { weight: number; v: number }[]>()
  const upgradePool = (rarity: string) => {
    const key = rarity.toLowerCase()
    const cached = upgradePools.get(key)
    if (cached) return cached
    const rows = [...hitPool, ...reverse2HitPool].filter((r) => (cardMeta(r.card_id).rarity ?? '').toLowerCase() === key)
    upgradePools.set(key, rows)
    return rows
  }
  const avgOr = (rows: { weight: number; v: number }[], fallback: number) => (rows.length > 0 ? weightedAvg(rows) : fallback)
  const reverseValue = weightedAvg(reverse)
  // What a missed subset card is replaced by, priced by the same rule the
  // roller deals.
  const subsetMissValue = subsetMiss(reverse.length > 0, { reverse: reverseValue, holo: weightedAvg(loadPool('holo')) }).pick
  const chance = Math.min(0.85, hitPool.reduce((a, r) => a + Math.max(0, r.weight), 0))
  const draw = (rows: { weight: number; v: number }[]) => {
    let total = 0
    for (const r of rows) if (r.weight > 0) total += r.weight
    if (total <= 0) return rows.length ? rows[Math.floor(Math.random() * rows.length)].v : 0
    let roll = Math.random() * total
    for (const r of rows) {
      if (r.weight <= 0) continue
      roll -= r.weight
      if (roll <= 0) return r.v
    }
    return rows[rows.length - 1].v
  }
  const drawSlot = (slot: 'first' | 'second') => {
    if (slot === 'second') {
      const table = secondSlotOdds(setId)
      if (!table) return draw(reverse)
      let roll = Math.random()
      for (const { outcome, odds } of table) {
        roll -= odds
        if (roll > 0) continue
        if (outcome.kind === 'ball') return draw(ballPool(outcome.ball))
        if (outcome.kind === 'assigned') return draw(assignedPool)
        if (outcome.kind === 'upgrade') return draw(upgradePool(outcome.rarity))
        return draw(reverse)
      }
      return draw(reverse)
    }
    const chances = specialSlotChancesFor(setId, slot)
    if (!chances) return draw(reverse)
    const roll = Math.random()
    let acc = 0
    for (const ball of chances.balls) {
      acc += ball.odds
      if (roll < acc) return draw(ballPool(ball.ball))
    }
    if (chances.assigned > 0) {
      acc += chances.assigned
      if (roll < acc) return draw(assignedPool)
    }
    for (const upgrade of chances.upgrades) {
      acc += upgrade.odds
      if (roll < acc) return draw(upgradePool(upgrade.rarity))
    }
    return draw(reverse)
  }
  const slotValue = (slot: 'first' | 'second') => {
    if (slot === 'second') {
      const table = secondSlotOdds(setId)
      if (!table) return reverseValue
      let value = 0
      for (const { outcome, odds } of table) {
        if (outcome.kind === 'ball') value += odds * avgOr(ballPool(outcome.ball), reverseValue)
        else if (outcome.kind === 'assigned') value += odds * avgOr(assignedPool, reverseValue)
        else if (outcome.kind === 'upgrade') value += odds * avgOr(upgradePool(outcome.rarity), reverseValue)
        else value += odds * reverseValue
      }
      return value
    }
    const chances = specialSlotChancesFor(setId, slot)
    if (!chances) return reverseValue
    let value = chances.reverse * reverseValue
    for (const ball of chances.balls) value += ball.odds * avgOr(ballPool(ball.ball), reverseValue)
    value += chances.assigned * avgOr(assignedPool, reverseValue)
    for (const upgrade of chances.upgrades) value += upgrade.odds * avgOr(upgradePool(upgrade.rarity), reverseValue)
    return value
  }
  const slotEv = (slot: string) => {
    if (slot === 'reverse') return slotValue('first')
    if (slot === 'reverse2') return slotValue('second')
    // The rare slot upgrades at the set's odds, else it is the plain/holo rare.
    if (slot === 'hit') return chance * weightedAvg(hitPool) + (1 - chance) * weightedAvg(loadPool('holo'))
    // A subset card occupies the reverse-holo position at the set's own rate —
    // or, in a pack with no reverse printing (Celebrations), the plain foil rare.
    if (slot === 'subset') {
      const p = subsetChanceFor(setId)
      return p * weightedAvg(loadPool('subset')) + (1 - p) * subsetMissValue
    }
    return weightedAvg(loadPool(slot))
  }
  const expected = slots.reduce((acc, s) => acc + s.count * slotEv(s.slot), 0)

  // The simulation draws the same pools 300 times, so price each slot's pool
  // ONCE. Re-querying and re-pricing it per iteration cost ~30k valueOf() calls
  // on a 200-card set (22s), and the shop prices every set in one request.
  const simPools = new Map<string, { weight: number; v: number }[]>()
  const simPool = (slot: string) => {
    const hit = simPools.get(slot)
    if (hit) return hit
    const rows = loadPool(slot)
    simPools.set(slot, rows)
    return rows
  }
  const subsetMissRows = subsetMiss(reverse.length > 0, { reverse, holo: simPool('holo') }).pick

  // Simulate 300 packs to estimate p50/p90 outcomes.
  const sims: number[] = []
  for (let i = 0; i < 300; i++) {
    let v = 0
    for (const s of slots) {
      for (let k = 0; k < s.count; k++) {
        if (s.slot === 'hit') {
          const rares = simPool('holo')
          v += Math.random() < chance && hitPool.length > 0 ? draw(hitPool) : rares.length > 0 ? draw(rares) : draw(reverse)
        } else if (s.slot === 'reverse' || s.slot === 'reverse2') {
          v += drawSlot(s.slot === 'reverse2' ? 'second' : 'first')
        } else if (s.slot === 'subset') {
          v += Math.random() < subsetChanceFor(setId) ? draw(simPool('subset')) : draw(subsetMissRows)
        } else {
          const rows = simPool(s.slot)
          if (rows.length > 0) v += draw(rows)
        }
      }
    }
    sims.push(v)
  }
  sims.sort((a, b) => a - b)
  const p = (q: number) => round2(sims[Math.floor(q * (sims.length - 1))])

  const chases = (
    db
      .prepare(
        `SELECT c.id, c.name, c.rarity FROM pack_product_cards ppc
         JOIN cards c ON c.id = ppc.card_id
         WHERE ppc.pack_product_id = ? AND ppc.slot IN ('hit', 'reverse2hit', 'phantom')`,
      )
      .all(`${setId}-booster`) as { id: string; name: string; rarity: string }[]
  )
    .map((c) => ({ ...c, market: valueOf(c.id) }))
    .filter((c) => c.market > 0)
    .sort((a, b) => b.market - a.market)
    .slice(0, 5)

  const result: PackEstimate = {
    avg: round2(expected),
    p50: p(0.5),
    p90: p(0.9),
    topChases: chases.map((c) => ({ id: c.id, name: c.name, rarity: c.rarity, value: round2(c.market) })),
  }
  estimateCache.set(setId, result)
  return result
}

export function invalidatePackEstimate(setId: string) {
  estimateCache.delete(setId)
}

// ---------------------------------------------------------------------------
// Pull rolling
// ---------------------------------------------------------------------------


const cardMetaCache = new Map<string, { rarity: string | null; supertype: string; subtypes: string }>()

// A price or catalogue change invalidates both the estimate and the card facts
// (rarity decides the finish a rare slot is priced as).
onDerivedDataChanged(() => {
  estimateCache.clear()
  cardMetaCache.clear()
})

/** Rarity, supertype + subtypes for a card, cached — the roller asks once per card.
 * Subtypes decide ball eligibility: 'ex' and 'ACE SPEC' are excluded by name. */
function cardMeta(cardId: string): { rarity: string | null; supertype: string; subtypes: string } {
  const hit = cardMetaCache.get(cardId)
  if (hit) return hit
  const row = db.prepare('SELECT rarity, supertype, subtypes FROM cards WHERE id = ?').get(cardId) as { rarity: string | null; supertype: string; subtypes: string } | undefined
  const meta = { rarity: row?.rarity ?? null, supertype: row?.supertype ?? '', subtypes: row?.subtypes ?? '' }
  cardMetaCache.set(cardId, meta)
  return meta
}

// Delta Reign's Legendary Stadiums are two-card Stadiums: a booster that carries
// one half carries the matching half as well — it is the same Stadium, not two
// separate cards. So the six halves are not dealt as ordinary uncommons (that
// had a Stadium in two of every three packs): they are kept out of the slot
// pools and one pair is dealt on its own roll, then this pass keeps the pair
// whole — both halves or neither, never the same half twice, and never the two
// of them side by side, where the shared artwork and shared name read as one
// card dealt twice.
/** The Legendary Stadium halves a set's packs can hold; they never enter a pool. */
export function stadiumHalvesFor(setId: string): string[] {
  return (LEGENDARY_STADIUMS[setId] ?? []).flat()
}

/** How many of a set's packs carry a Legendary Stadium pair (0: none do). */
export function stadiumPairOddsFor(setId: string): number {
  return LEGENDARY_STADIUM_PACK_ODDS[setId] ?? 0
}

const LEGENDARY_STADIUMS: Record<string, [string, string][]> = {
  me6: [
    ['me6-94', 'me6-95'],
    ['me6-96', 'me6-97'],
    ['me6-98', 'me6-99'],
  ],
}

type RolledCard = { cardId: string; variant: string; value: number; rarity: string | null; supertype: string; isHit: boolean }

// No source publishes the rate: tcgtalk's 252-pack Delta Reign sample only notes
// that a floor-only pack may hold a "connecting art" Stadium half in its rare
// slot. One in twelve packs — about three per 36-pack box, in line with the set's
// illustration-rare cadence — is this build's choice, and the changelog says so.
const LEGENDARY_STADIUM_PACK_ODDS: Record<string, number> = { me6: 1 / 12 }

function stadiumCard(id: string): RolledCard {
  const meta = cardMeta(id)
  return { cardId: id, variant: 'normal', value: valueOf(id), rarity: meta.rarity, supertype: meta.supertype, isHit: false }
}

/** One Stadium, both halves, in the place of two ordinary non-hit cards. */
function dealLegendaryStadium(setId: string, picked: RolledCard[]): void {
  const pairs = LEGENDARY_STADIUMS[setId]
  const odds = LEGENDARY_STADIUM_PACK_ODDS[setId]
  if (!pairs || !odds || Math.random() >= odds) return
  const open = picked.map((card, i) => (card.isHit ? -1 : i)).filter((i) => i >= 0)
  if (open.length < 2) return
  const [left, right] = pairs[Math.floor(Math.random() * pairs.length)]
  const first = open[Math.floor(Math.random() * open.length)]
  const rest = open.filter((i) => i !== first)
  const second = rest[Math.floor(Math.random() * rest.length)]
  picked[first] = stadiumCard(left)
  picked[second] = stadiumCard(right)
}

function pairLegendaryStadiums(setId: string, picked: RolledCard[], rows: { card_id: string; weight: number }[]): void {
  const pairs = LEGENDARY_STADIUMS[setId]
  if (!pairs) return
  const size = picked.length
  const halves = new Set(pairs.flat())
  const asCard = stadiumCard
  // The card a Stadium half can take the place of: a repeat if the pack has one
  // (a Stadium is not a second copy of something already in the pack), else the
  // last card that is neither the pack's hit nor another Stadium half.
  const spareSlot = (): number => {
    const counts = new Map<string, number>()
    for (const card of picked) counts.set(card.cardId, (counts.get(card.cardId) ?? 0) + 1)
    for (let i = 0; i < picked.length; i++) {
      const card = picked[i]
      if (card.isHit || halves.has(card.cardId)) continue
      if ((counts.get(card.cardId) ?? 0) > 1) return i
    }
    for (let i = picked.length - 1; i >= 0; i--) {
      const card = picked[i]
      if (card.isHit || halves.has(card.cardId)) continue
      return i
    }
    return -1
  }
  for (const [left, right] of pairs) {
    // A pack carries each half once: a repeat of one half is that half again,
    // not the other half of the Stadium, so it becomes the partner when the
    // partner is what is missing.
    for (const [id, partner] of [[left, right], [right, left]]) {
      const first = picked.findIndex((c) => c.cardId === id)
      for (let i = first + 1; i < picked.length; i++) {
        if (picked[i].cardId !== id) continue
        if (!picked.some((c) => c.cardId === partner)) picked[i] = asCard(partner)
        else {
          picked.splice(i, 1)
          i--
        }
      }
    }
    const carriesLeft = picked.some((c) => c.cardId === left)
    const carriesRight = picked.some((c) => c.cardId === right)
    if (carriesLeft === carriesRight) continue
    const spare = spareSlot()
    if (spare >= 0) picked[spare] = asCard(carriesLeft ? right : left)
  }
  // The pass never changes how many cards the pack holds.
  while (picked.length < size) {
    const have = new Set(picked.map((c) => c.cardId))
    const spare = rows.filter((r) => !have.has(r.card_id) && !halves.has(r.card_id))
    if (spare.length === 0) break
    picked.push(asCard(weightedPick(spare)))
  }
  // Never back to back: the later half moves to the place farthest from its
  // partner, and the pass repeats because that move can park another pair's half
  // beside its own.
  for (let guard = 0; guard < 32; guard++) {
    let moved = false
    for (const [left, right] of pairs) {
      const a = picked.findIndex((c) => c.cardId === left)
      const b = picked.findIndex((c) => c.cardId === right)
      if (a < 0 || b < 0 || Math.abs(a - b) !== 1) continue
      const anchor = Math.min(a, b)
      const from = Math.max(a, b)
      let to = from
      for (let j = 0; j < picked.length; j++) {
        if (Math.abs(j - anchor) > Math.abs(to - anchor)) to = j
      }
      if (to === from) continue
      const held = picked[from]
      picked[from] = picked[to]
      picked[to] = held
      moved = true
    }
    if (!moved) break
  }
}

export function rollPack(setId: string, sessionId: string, productKind = 'booster', cardsPerPack = 10, owner: 'player' | 'other' = 'player') {
  const pid = `${setId}-booster`
  const rows = db.prepare('SELECT card_id, weight, slot FROM pack_product_cards WHERE pack_product_id = ?').all(pid) as { card_id: string; weight: number; slot: string }[]
  if (rows.length === 0) return null
  // The Legendary Stadium halves stay out of the ordinary pools; dealLegendaryStadium
  // is the only thing that puts one in a pack, and it always puts in both.
  const stadiumHalves = new Set((LEGENDARY_STADIUMS[setId] ?? []).flat())
  const poolRows = stadiumHalves.size > 0 ? rows.filter((r) => !stadiumHalves.has(r.card_id)) : rows

  const pool = (slot: string) => poolRows.filter((r) => r.slot === slot)
  const commonPool = pool('common')
  const uncommonPool = pool('uncommon')
  // A special set's ordinary reverse paper covers Rare cards too, and
  // Prismatic's second reverse slot is a real slot, so both the pool and the
  // slot list have to widen for these sets.
  const reversePool = [...commonPool, ...uncommonPool, ...(isSpecialSet(setId) ? pool('holo') : [])]
  const hitPool = pool('hit')
  const reverse2HitPool = pool('reverse2hit')
  const energyPool = pool('energy')
  // A pack's upgrade chance IS the sum of its pool's per-pack weights, so a
  // tier this set never prints cannot inflate the tiers it does print.
  const hitChance = Math.min(0.85, hitPool.reduce((a, r) => a + Math.max(0, r.weight), 0))

  // Structure comes from the set's blueprint (30C closes on a guaranteed
  // Pikachu, Classic Collection is all subset) or the era's ten game cards:
  // commons, 3 uncommons, reverse holo(s), one rare-or-hit. Empty pools drop
  // out rather than padding the pack with repeats of nothing.
  const slots = planFor(setId, cardsPerPack).filter((s) => {
    if (s.slot === 'holo') return holosCount(setId) > 0
    if (s.slot === 'uncommon') return uncommonPool.length > 0
    if (s.slot === 'reverse' || s.slot === 'reverse2') return reversePool.length > 0
    if (s.slot === 'energy') return energyPool.length > 0
    return true
  })
  if (pool('subset').length > 0 && !slots.some((s) => s.slot === 'subset')) {
    slots.push({ slot: 'subset', count: 1 })
  }

  const ghost = GHOST_SETS[setId] ?? null
  type Picked = { cardId: string; variant: string; value: number; rarity: string | null; supertype: string; isHit: boolean }
  const picked: Picked[] = []

  // One roll decides the second reverse slot: a stamp where the set prints one,
  // an IR/SIR where it prints those, otherwise an ordinary reverse.
  const secondTable = secondSlotOdds(setId)
  const rollSecondSlot = (): SecondSlotOutcome | null => {
    if (!secondTable) return null
    let roll = Math.random()
    for (const { outcome, odds } of secondTable) {
      roll -= odds
      if (roll <= 0) return outcome
    }
    return { kind: 'reverse' }
  }

  const take = (from: { card_id: string; weight: number }[], slot: string, isHit = false) => {
    if (from.length === 0) return
    // Ascended Heroes' second reverse slot is not always a ball: its measured
    // IR/SIR replacements take the slot instead. Resolve the outcome before
    // choosing a card so an upgrade draws from the named rarity, not from the
    // ordinary reverse pool.
    const outcome = slot === 'reverse2' ? rollSecondSlot() : null
    let upgrade = outcome?.kind === 'upgrade' ? outcome.rarity : null
    let source = from
    if (upgrade) {
      const wanted = upgrade.toLowerCase()
      const pool = reverse2HitPool.filter((r) => (cardMeta(r.card_id).rarity ?? '').toLowerCase() === wanted)
      if (pool.length > 0) source = pool
      else upgrade = null
    }
    // Ascended Heroes' second slot carries the card's OWN paper, so the slot has
    // to draw a card that was assigned one. A Pokémon ex never carries a reverse,
    // so it is excluded by the assignment table rather than by a second rule.
    if (outcome?.kind === 'assigned') {
      const assigned = source.filter((r) => ascendedVariantFor(r.card_id))
      if (assigned.length > 0) source = assigned
    }
    // Ascended Heroes' first reverse slot is the Energy-pattern printing, and
    // only a regular Pokémon carries it. Draw from eligible cards so a Trainer
    // cannot displace the stamp; if the set has no eligible card in the pool,
    // fall back to the ordinary reverse below.
    const energySlot = slot === 'reverse' && hasEnergyReverse(setId)
    if (energySlot) {
      const eligible = source.filter((r) => energyReverseEligible(cardMeta(r.card_id)))
      if (eligible.length > 0) source = eligible
    }
    let cardId = weightedPick(source)
    let meta = cardMeta(cardId)
    // WotC-era ghost: this card prints with the 1st Edition stamp.
    const stamp = ghost && Math.random() < ghost.perSlot ? ghostValue(setId, cardId, slot) : null
    // The reverse slot(s) of a special set roll their ball papers; every other
    // slot (including the final-card fallback) stays an ordinary printing, so a
    // pack can only hold the balls its real slots allow. An IR/SIR upgrade is a
    // normal hit printing, not a reverse printing.
    let variant = stamp
      ? stamp.variant
      : upgrade
        ? 'normal'
        : outcome?.kind === 'ball'
          ? BALL_VARIANTS[outcome.ball]
          : outcome?.kind === 'assigned'
            ? ascendedVariantFor(cardId) ?? 'reverseHolofoil'
            : slot === 'reverse' && hasEnergyReverse(setId)
            ? energyReverseEligible(meta)
              ? ENERGY_REVERSE_VARIANT
              : 'reverseHolofoil'
            : slot === 'reverse'
              // An ordinary set has no ball/assigned slot, so its reverse slot is
              // a plain reverse printing — never a normal one.
              ? ballVariantFor(setId, 'first', Math.random, cardId) ?? 'reverseHolofoil'
              : slot === 'reverse2'
              ? 'reverseHolofoil'
              // The rare slot is one card that either upgrades or is the rare the
              // set prints, and a holo rare is a foil card: it pulls and prices as
              // 'holofoil', never as the plain printing of its number.
              : slot === 'rare' || slot === 'hit' || slot === 'holo'
              ? setId === 'dv1'
                ? 'holofoil'
                : rareVariantFor(setId, meta.rarity)
              : 'normal'
    // The stamp is a per-pack roll, so when it lands the slot must hold a card
    // that can carry it: a Master Ball is never printed on a Trainer or Energy.
    const ball = specialBallFor(variant)
    if (ball && !ballEligible(ball, meta, cardId)) {
      const eligible = from.filter((r) => ballEligible(ball, cardMeta(r.card_id), r.card_id))
      if (eligible.length === 0) {
        variant = 'reverseHolofoil'
      } else {
        cardId = weightedPick(eligible)
        meta = cardMeta(cardId)
      }
    }
    picked.push({
      cardId,
      variant,
      value: stamp ? stamp.value : valueOf(cardId, variant),
      rarity: meta.rarity,
      supertype: meta.supertype,
      isHit: isHit || !!upgrade,
    })
  }

  // A missed subset card is replaced by the slot's ordinary printing, by the
  // rule packodds names once: a reverse holo in a set that prints them, or the
  // plain foil rare in a pack with no reverse at all (Celebrations).
  const subsetFallback = subsetMiss(reversePool.length > 0, { reverse: reversePool, holo: pool('holo') })

  for (const { slot, count } of slots) {
    if (slot === 'hit') {
      // The final card: a hit at the era's real odds, otherwise the pack's
      // basic Energy (or a second reverse holo in a set that prints none).
      for (let i = 0; i < count; i++) {
        // One rare-or-hit card: the hit replaces the rare at the era's real
        // odds, and a miss deals the plain/holo rare the set prints.
        if (hitPool.length > 0 && Math.random() < hitChance) take(hitPool, 'hit', true)
        else if (pool('holo').length > 0) take(pool('holo'), 'rare')
        else if (energyPool.length > 0) take(energyPool, 'energy')
        else take(reversePool, 'reverse-fallback')
      }
      continue
    }
    // A subset card fills its slot only when the pack prints one: Crown Zenith's
    // Galarian Gallery lands in 35.2% of packs, so a miss deals the ordinary
    // reverse holo rather than a second gallery card.
    const missedSubset = slot === 'subset' && Math.random() >= subsetChanceFor(setId)
    const from = missedSubset ? subsetFallback.pick : slot === 'reverse' || slot === 'reverse2' ? reversePool : pool(slot)
    for (let i = 0; i < count; i++) take(from, missedSubset ? subsetFallback.slot : slot, slot === 'subset' && !missedSubset)
  }

  // Never hand back an empty rip: a gallery-only set has no commons to pad
  // with, so one card out of its own pool is the whole pack.
  if (picked.length === 0) take(hitPool.length > 0 ? hitPool : poolRows, 'hit', hitPool.length > 0)

  // One BASIC Energy per pack, full stop. The guard covers only the energy
  // slot's own cards: sets like Neo Genesis print Darkness and Metal Energy at
  // Rare, and those are a legitimate rare-slot pull, not a second basic Energy.
  const basicEnergyIds = new Set(energyPool.map((r) => r.card_id))
  let energySeen = 0
  for (const card of picked) {
    if (card.supertype !== 'Energy' || !basicEnergyIds.has(card.cardId)) continue
    energySeen++
    if (energySeen <= 1) continue
    const nonEnergy = reversePool.filter((r) => cardMeta(r.card_id).supertype !== 'Energy')
    const swapTo = weightedPick(nonEnergy.length > 0 ? nonEnergy : reversePool)
    const meta = cardMeta(swapTo)
    card.cardId = swapTo
    // A reverse-slot Energy stays a reverse printing when it is redrawn as a
    // Pokémon/Trainer; a ball can never land here because Energy is ineligible.
    card.value = valueOf(swapTo, card.variant === 'reverseHolofoil' ? 'reverseHolofoil' : 'normal')
    card.rarity = meta.rarity
    card.supertype = meta.supertype
    card.isHit = false
  }

  dealLegendaryStadium(setId, picked)
  pairLegendaryStadiums(setId, picked, poolRows)

  const insertPull = db.prepare(
    `INSERT INTO pull_history (session_id, pack_product_id, card_id, variant, value, rarity, is_hit, opened_at, owner)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const at = nowIso()
  const tx = db.transaction(() => {
    for (const card of picked) {
      insertPull.run(sessionId, pid, card.cardId, card.variant, card.value, card.rarity, card.isHit ? 1 : 0, at, owner)
    }
    // Phantom tier — the 30th Celebration RGB Mews. No published rate exists;
    // ~1 in 12,000 packs per colour is the community estimate, so a 36-pack
    // display very rarely holds one. It rides on top of the pack rather than
    // taking the rare slot, matching how these appear in real openings.
    const phantomPool = pool('phantom')
    if (phantomPool.length > 0 && Math.random() < phantomPool.length * PHANTOM_PER_CARD_ODDS) {
      const cardId = weightedPick(phantomPool)
      const meta = cardMeta(cardId)
      const value = valueOf(cardId)
      insertPull.run(sessionId, pid, cardId, 'normal', value, meta.rarity, 1, at, owner)
      picked.push({ cardId, variant: 'normal', value, rarity: meta.rarity, supertype: meta.supertype, isHit: true })
    }
  })
  tx()

  return picked.map((card) => ({ cardId: card.cardId, isHit: card.isHit, value: card.value, variant: card.variant }))
}

// ---------------------------------------------------------------------------
// WotC ghost pulls — early print runs carried the 1st Edition stamp, and
// unlimited packs could still contain them until the stamp ran out.
// ---------------------------------------------------------------------------

const GHOST_SETS: Record<string, { perSlot: number }> = {
  base1: { perSlot: 0.028 },
  base2: { perSlot: 0.014 },
  base3: { perSlot: 0.022 },
  gym1: { perSlot: 0.02 },
  gym2: { perSlot: 0.02 },
  neo1: { perSlot: 0.018 },
  neo2: { perSlot: 0.016 },
  neo3: { perSlot: 0.016 },
  neo4: { perSlot: 0.014 },
  base5: { perSlot: 0.012 },
}

/** Resolve the real value + variant of a ghosted card given its slot. */
export function ghostValue(setId: string, cardId: string, slot: string): { variant: string; value: number } | null {
  if (!GHOST_SETS[setId]) return null
  const holo = slot === 'holo' || slot === 'hit' || slot === 'rare'
  const value = firstEditionValueOf(cardId, holo)
  if (value <= 0) return null
  return { variant: '1stEdition' + (holo ? 'Holofoil' : 'Normal'), value }
}

function holosCount(setId: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM pack_product_cards WHERE pack_product_id = ? AND slot = 'holo'`).get(`${setId}-booster`) as { n: number }).n
}

function weightedPick(pool: { card_id: string; weight: number }[]): string {
  // Weights are real: within a tier the cards are uniform, but the tiers are
  // not. Flat picks here would undo the whole rarity ladder.
  let total = 0
  for (const p of pool) if (p.weight > 0) total += p.weight
  if (total <= 0) return pool[Math.floor(Math.random() * pool.length)].card_id
  let roll = Math.random() * total
  for (const p of pool) {
    if (p.weight <= 0) continue
    roll -= p.weight
    if (roll <= 0) return p.card_id
  }
  return pool[pool.length - 1].card_id
}

// ---------------------------------------------------------------------------
// Sealed inventory
// ---------------------------------------------------------------------------

export function buySealed(productId: string, qty: number) {
  const product = db.prepare('SELECT * FROM pack_products WHERE id = ?').get(productId) as { id: string; set_id: string; msrp: number; market_price: number | null; name: string } | undefined
  if (!product) throw new Error('Unknown product')
  // A subset-only set has no wrapper to sell (its cards came inside another
  // set's packs); its shelf rows survive only so owned stock still resolves.
  if (!sealed.sellsProduct(product.id, product.set_id)) throw new Error('That product is not sold')
  // Buy at what the shop actually charges — the market price (appreciation
  // included), falling back to MSRP only for brand-new catalog rows. Today's
  // daily deal is applied on the server, not trusted from the shelf response.
  const base = sealed.priceOf(productId).market || product.msrp
  const deal = dailydeals.dealForToday(productId)
  // A daily deal is one unit, once per game day: bulk lots cannot be used to
  // turn a single discounted offer into ten discounted packs.
  if (deal && qty > 1) throw new Error('Daily deals are limited to one per game day')
  // A deal on a day a paid pass opened pays its own resale margin on top of its
  // discounted price — the ticket is flat, the board is what pays for itself,
  // and only when it is used. The result is exactly what the resale desk pays.
  const unit = round2(deal && base > 0 ? dailydeals.discountedPrice(base, deal.discountPct) + deal.surcharge : base)
  const cost = round2(unit * qty)
  const purchase = db.transaction(() => {
    // The claim and the charge commit together: if the claim is already taken,
    // no cash moves and no stock is added. A restart cannot clear it, and the
    // product cannot be bought again at full price until the next game day.
    if (deal && !dailydeals.claimDealToday(productId)) {
      throw new Error('That daily deal is already claimed for this game day')
    }
    const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
    if (state.cash < cost) throw new Error('Not enough cash')
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(cost)
    // Fresh off the distributor's truck — futures desk stamps case-fresh.
    db.prepare('INSERT INTO sealed_inventory (product_id, quantity, cost, condition, acquired_at) VALUES (?, ?, ?, ?, ?)')
      .run(productId, qty, unit, 'fresh', nowIso())
    logActivity('buy', `Bought ${qty}× ${product.name} for $${cost.toFixed(2)} — kept sealed${deal?.surcharge ? ` (includes $${deal.surcharge.toFixed(2)} day-pass share)` : ''}`, -cost)
    return { cost }
  })
  return purchase()
}

/**
 * Roll one wrapper of a product, honoring a box that mixes expansions. A box
 * whose packs are all from one set resolves to that set unchanged; a mixed box
 * such as the ETB Plus or a multi-set UPC walks its recorded segments instead.
 */
export function rollProductPack(
  product: { id: string; set_id: string },
  index: number,
  sessionId: string,
  cardsPerPack: number,
  owner: 'player' | 'other' = 'player',
) {
  const spec = mixedPackSpec(product.id, index)
  const setId = spec?.setId ?? product.set_id
  // A mixed box can hold a wrapper of a different size: the 30th UPC's last
  // pack is the three-card Classic Collection pack.
  const per = spec?.cardsPerPack ?? cardsPerPack
  return rollPack(setId, sessionId, 'booster', per, owner)
}

export function openSealed(productId: string) {
  // Rip the oldest FREE box (loan collateral sits escrowed in the vault —
  // see sealedfutures.ts).
  const row = db.prepare('SELECT * FROM sealed_inventory WHERE product_id = ? AND (escrow_loan IS NULL) ORDER BY acquired_at ASC LIMIT 1').get(productId) as { id: number; product_id: string; cost: number; quantity: number } | undefined
  if (!row) {
    const anyLeft = db.prepare('SELECT COUNT(*) AS n FROM sealed_inventory WHERE product_id = ? AND quantity > 0').get(productId) as { n: number }
    throw new Error(anyLeft.n > 0 ? 'That stock is posted as loan collateral — redeem it from the futures desk first' : 'No sealed product in inventory')
  }
  const product = db.prepare('SELECT * FROM pack_products WHERE id = ?').get(row.product_id) as { id: string; set_id: string; cards_per_pack: number; name: string; kind: string; packs: number | null; release_date: string | null } | undefined
  if (!product) throw new Error('Product missing')

  // A bundle/ETB/display is a BOX of packs — ripping it opens every pack
  // inside (each with its own session id, so the pack-total record stays a
  // per-pack number). Boosters (and anything unlabeled) are one pack.
  const packsInBox = product.kind === 'booster' || !product.packs ? 1 : Math.max(1, product.packs)
  const perPackCost = round2(row.cost / packsInBox)

  // The whole box leaves the shelf on rip — multi-pack buys deplete their
  // quantity instead of vanishing with the first rip.
  if (row.quantity > 1) {
    db.prepare('UPDATE sealed_inventory SET quantity = quantity - 1 WHERE id = ?').run(row.id)
  } else {
    db.prepare('DELETE FROM sealed_inventory WHERE id = ?').run(row.id)
  }

  // The promo sealed beside the packs goes into the binder before the rip, the
  // same as the box ceremony: a box opened whole must not lose its promo.
  const promos = grantPromo(product)

  // Rip every pack in the box. A missing pull table aborts the box — the
  // caller's catch leaves the box in inventory (nothing was inserted yet).
  type OpenedCard = { cardId: string; isHit: boolean; value: number; variant?: string; setName?: string; rarity?: string | null; image?: string | null; isNew?: boolean }
  const sessions: { sessionId: string; cards: OpenedCard[]; totalValue: number; spent: number }[] = []
  const cards: OpenedCard[] = []
  let totalValue = 0
  for (let i = 0; i < packsInBox; i++) {
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    // A General Mills mini pack rolls its own researched composition (one
    // Sequin card + reprints); everything else rolls the set's booster table.
    const packCards = rollMiniPack(product.id, sessionId) ?? rollProductPack(product, i, sessionId, product.cards_per_pack)
    if (!packCards) {
      if (sessions.length === 0) throw new Error('Pull table missing — sync this set first')
      break
    }
    cards.push(...packCards)
    totalValue += packCards.reduce((a, c) => a + c.value, 0)
    sessions.push({ sessionId, cards: packCards, totalValue: round2(packCards.reduce((a, c) => a + c.value, 0)), spent: perPackCost })
  }
  totalValue = round2(totalValue)
  // NEW-to-the-binder tag: a pull is "new" when you owned zero copies of that
  // card before this rip. Computed BEFORE the inventory insert below, and
  // within one rip only the FIRST copy of a double-printed card wears the
  // tag — the second is a dupe of the first, not a new find.
  const ownedBefore = db.prepare('SELECT COALESCE(SUM(quantity), 0) AS n FROM inventory WHERE card_id = ?')
  const seenInRip = new Map<string, number>()
  for (const c of cards) {
    const prior = (ownedBefore.get(c.cardId) as { n: number }).n + (seenInRip.get(c.cardId) ?? 0)
    if (prior === 0) c.isNew = true
    seenInRip.set(c.cardId, (seenInRip.get(c.cardId) ?? 0) + 1)
  }
  // Storage & the vault: make room per the overflow policy — the rest of the
  // rip stays in the wrapper (counted in the session total but never inserted).
  const keepCount = vault.makeRoomFor(cards.length, 'Pack rip')
  // Add to player inventory with per-unit cost = box cost / cards.
  // Variants are honored — a 1st Edition ghost keeps its stamp in your binder.
  const perCardCost = round2(row.cost / Math.max(1, cards.length))
  const addInv = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
     VALUES (?, ?, 'NM', 1, 'collection', 'pack', ?, ?)`,
  )
  for (const c of cards.slice(0, keepCount)) addInv.run(c.cardId, c.variant || 'normal', perCardCost, nowIso())
  if (keepCount < cards.length) {
    logActivity('storage', `${product.name}: the shelf is full — ${cards.length - keepCount} of the ${cards.length} pulls stayed in the wrapper. Rent a locker before the next rip.`, 0)
  }
  logActivity('pack', `Opened ${product.name}${packsInBox > 1 ? ` (${packsInBox} packs)` : ''} — ${cards.length} cards, value ≈ $${totalValue.toFixed(2)}`, -row.cost)
  return {
    sessionId: sessions[0].sessionId,
    sessionIds: sessions.map((s) => s.sessionId),
    cards,
    totalValue,
    spent: row.cost,
    packsInBox,
    packsOpened: sessions.length,
    perPack: sessions,
    promo: promos[0] ?? null,
    promos,
  }
}

// ---------------------------------------------------------------------------
// Opening a box, one pack at a time
// ---------------------------------------------------------------------------
// A bundle/ETB/display is a box of packs, so it opens like one: the box comes
// off the shelf once, the promo sealed beside the packs goes into the binder
// first, and every wrapper after that is its own rip. sealed_box_open holds
// what is left, so a reload mid-box resumes at the next pack.

type BoxRow = {
  id: number
  product_id: string
  set_id: string
  cards_per_pack: number
  packs_left: number
  packs_total: number
  per_pack_cost: number
  total_cost: number
}

export type BoxPromo = { cardId: string; name: string; image: string | null; value: number }

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/** The promo set that shipped alongside a set's ETBs, by era. */
function promoSetForYear(year: number): string | null {
  if (year >= 2023) return 'svp'
  if (year >= 2020) return 'swshp'
  if (year >= 2017) return 'smp'
  if (year >= 2014) return 'xyp'
  if (year >= 2011) return 'bwp'
  return null
}

/**
 * The promo card sealed beside an ETB's packs. Real ETBs carry one specific
 * promo; the catalog doesn't map set → promo, so this picks one from that
 * era's promo set deterministically per product — the same box always gives
 * the same card — and only cards with a live price qualify, so it is never a
 * $0 phantom.
 */
function promoForProduct(product: { id: string; set_id: string; kind: string; release_date: string | null }): BoxPromo[] | null {
  // ETBs and the special collections both seal a promo beside the packs. A
  // special product's promo list is sourced product by product, so it gets no
  // era-synthetic fallback: a named promo the catalogue does not hold grants
  // nothing rather than an unrelated card.
  if (product.kind !== 'etb' && product.kind !== 'special') return null
  const named = namedPromoFor(product.id)
  if (named !== undefined) return named
  if (product.kind === 'special') return null
  type Cand = { id: string; name: string; image_small: string | null }
  let pool = db
    .prepare("SELECT id, name, image_small FROM cards WHERE set_id = ? AND rarity LIKE '%romo%'")
    .all(product.set_id) as Cand[]
  if (pool.length === 0) {
    const promoSet = promoSetForYear(Number((product.release_date || '').slice(0, 4)))
    if (promoSet) {
      pool = db
        .prepare("SELECT id, name, image_small FROM cards WHERE set_id = ? AND rarity LIKE '%romo%'")
        .all(promoSet) as Cand[]
    }
  }
  const priced = pool
    .map((c) => ({ cardId: c.id, name: c.name, image: c.image_small, value: round2(Number(valueOf(c.id)) || 0) }))
    .filter((c) => c.value > 0)
    .sort((a, b) => a.cardId.localeCompare(b.cardId))
  // ETB promos are the ordinary, everywhere kind — a promo box is not a grail
  // ticket. Pick inside the normal band; if a promo set is all grails, take
  // its cheapest card rather than handing out a four-figure freebie.
  const band = priced.filter((c) => c.value >= 0.75 && c.value <= 25)
  const candidates = band.length > 0 ? band : [...priced].sort((a, b) => a.value - b.value)
  if (candidates.length === 0) return null
  return [candidates[hashStr(product.id) % candidates.length]]
}

/**
 * Resolve a named ETB promo from the product evidence. A named promo that the
 * catalogue does not hold returns null rather than falling back to an unrelated
 * card from the era's promo set: a wrong promo is worse than no promo.
 */
function namedPromoFor(productId: string): BoxPromo[] | null | undefined {
  const evidence = sealedEvidenceFor(productId)
  if (!evidence) return undefined
  if (evidence.promos.length === 0) return null
  type Cand = { id: string; name: string; image_small: string | null }
  const candidates: BoxPromo[] = []
  if (evidence.promoIds?.length) {
    for (const id of evidence.promoIds) {
      const hit = db
        .prepare('SELECT id, name, image_small FROM cards WHERE id = ?')
        .get(id) as Cand | undefined
      if (!hit) continue
      const value = round2(Number(valueOf(hit.id)) || 0)
      if (value > 0) candidates.push({ cardId: hit.id, name: hit.name, image: hit.image_small, value })
    }
  } else if (evidence.promoSet) {
    for (const name of evidence.promos) {
      const hit = db
        .prepare('SELECT id, name, image_small FROM cards WHERE set_id = ? AND name = ? ORDER BY id LIMIT 1')
        .get(evidence.promoSet, name) as Cand | undefined
      if (!hit) continue
      const value = round2(Number(valueOf(hit.id)) || 0)
      if (value > 0) candidates.push({ cardId: hit.id, name: hit.name, image: hit.image_small, value })
    }
  }
  if (candidates.length === 0) return null
  // A box documented to hold every named promo hands over all of them; the
  // ordinary case is one of them, picked deterministically per product.
  if (evidence.promoPolicy === 'all') return candidates
  return [candidates[hashStr(productId) % candidates.length]]
}

/** Bank the promo before a single wrapper opens. */
function grantPromo(product: { id: string; set_id: string; kind: string; release_date: string | null; name: string }): BoxPromo[] {
  const promos = promoForProduct(product) ?? []
  if (promos.length === 0) return []
  const add = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
     VALUES (?, 'normal', 'NM', 1, 'collection', 'promo', 0, ?)`,
  )
  for (const promo of promos) {
    add.run(promo.cardId, nowIso())
    logActivity('pack', `${product.name} promo: ${promo.name} — it was in the box before you tore a wrapper`, 0)
  }
  return promos
}

/** Roll one pack out of a box and count it down. */
function ripNextPack(box: BoxRow) {
  const product = db.prepare('SELECT id, name FROM pack_products WHERE id = ?').get(box.product_id) as { id: string; name: string } | undefined
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const packCards =
    rollMiniPack(box.product_id, sessionId) ??
    rollProductPack(
      { id: box.product_id, set_id: box.set_id },
      box.packs_total - box.packs_left,
      sessionId,
      box.cards_per_pack,
    )
  if (!packCards) throw new Error('Pull table missing — sync this set first')

  type OpenedCard = { cardId: string; isHit: boolean; value: number; variant?: string; setName?: string; rarity?: string | null; image?: string | null; isNew?: boolean }
  const ownedBefore = db.prepare('SELECT COALESCE(SUM(quantity), 0) AS n FROM inventory WHERE card_id = ?')
  const seen = new Map<string, number>()
  for (const c of packCards) {
    const prior = (ownedBefore.get(c.cardId) as { n: number }).n + (seen.get(c.cardId) ?? 0)
    if (prior === 0) (c as OpenedCard).isNew = true
    seen.set(c.cardId, (seen.get(c.cardId) ?? 0) + 1)
  }
  const keepCount = vault.makeRoomFor(packCards.length, 'Pack rip')
  const perCardCost = round2(box.per_pack_cost / Math.max(1, packCards.length))
  const addInv = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
     VALUES (?, ?, 'NM', 1, 'collection', 'pack', ?, ?)`,
  )
  for (const c of packCards.slice(0, keepCount)) addInv.run(c.cardId, c.variant || 'normal', perCardCost, nowIso())
  if (keepCount < packCards.length) {
    logActivity('storage', `${product?.name ?? 'Box'}: the shelf is full — ${packCards.length - keepCount} of the ${packCards.length} pulls stayed in the wrapper. Rent a locker before the next rip.`, 0)
  }

  const packIndex = box.packs_total - box.packs_left + 1
  // Which wrapper this is, so the ceremony wears the right name and art: a
  // mixed box's last pack is a different expansion's wrapper (the 30th UPC's
  // Classic Collection pack).
  const packSetId = mixedPackSpec(box.product_id, packIndex - 1)?.setId ?? box.set_id
  // That wrapper's own row gives the ceremony its name and symbol. It has to
  // ride along because the shop never lists it (no shelf ever sold it), so the
  // client's product list cannot look it up.
  const wrapper = packSetId === box.set_id
    ? undefined
    : (db
        .prepare('SELECT p.name, p.image_url, s.symbol_url FROM pack_products p LEFT JOIN sets s ON s.id = p.set_id WHERE p.id = ?')
        .get(`${packSetId}-booster`) as { name: string; image_url: string | null; symbol_url: string | null } | undefined)
  const packsLeft = box.packs_left - 1
  if (packsLeft <= 0) db.prepare('DELETE FROM sealed_box_open WHERE id = ?').run(box.id)
  else db.prepare('UPDATE sealed_box_open SET packs_left = ? WHERE id = ?').run(packsLeft, box.id)

  const totalValue = round2(packCards.reduce((a, c) => a + c.value, 0))
  logActivity('pack', `Opened ${product?.name ?? 'a pack'} — pack ${packIndex} of ${box.packs_total}: ${packCards.length} cards, value ≈ $${totalValue.toFixed(2)}`, -box.per_pack_cost)

  return {
    sessionId,
    cards: packCards,
    totalValue,
    spent: box.per_pack_cost,
    boxId: box.id,
    productId: box.product_id,
    productName: product?.name ?? 'Sealed box',
    packSetId,
    packName: wrapper?.name ?? null,
    packSymbol: wrapper?.symbol_url ?? null,
    packArt: wrapper?.image_url ?? null,
    packIndex,
    packsTotal: box.packs_total,
    packsLeft,
    done: packsLeft <= 0,
  }
}

/** Take a box off the shelf, bank its promo, and open the first pack. */
export function beginBox(productId: string) {
  const row = db
    .prepare('SELECT * FROM sealed_inventory WHERE product_id = ? AND (escrow_loan IS NULL) ORDER BY acquired_at ASC LIMIT 1')
    .get(productId) as { id: number; product_id: string; cost: number; quantity: number } | undefined
  if (!row) {
    const anyLeft = db.prepare('SELECT COUNT(*) AS n FROM sealed_inventory WHERE product_id = ? AND quantity > 0').get(productId) as { n: number }
    throw new Error(anyLeft.n > 0 ? 'That stock is posted as loan collateral — redeem it from the futures desk first' : 'No sealed product in inventory')
  }
  const product = db
    .prepare('SELECT id, set_id, name, kind, packs, cards_per_pack, release_date FROM pack_products WHERE id = ?')
    .get(row.product_id) as { id: string; set_id: string; name: string; kind: string; packs: number | null; cards_per_pack: number; release_date: string | null } | undefined
  if (!product) throw new Error('Product missing')

  const packsInBox = product.kind === 'booster' || !product.packs ? 1 : Math.max(1, product.packs)
  const perPackCost = round2(row.cost / packsInBox)

  if (row.quantity > 1) db.prepare('UPDATE sealed_inventory SET quantity = quantity - 1 WHERE id = ?').run(row.id)
  else db.prepare('DELETE FROM sealed_inventory WHERE id = ?').run(row.id)

  const promos = grantPromo(product)

  const info = db
    .prepare(
      `INSERT INTO sealed_box_open (product_id, set_id, cards_per_pack, packs_left, packs_total, per_pack_cost, total_cost, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(product.id, product.set_id, product.cards_per_pack, packsInBox, packsInBox, perPackCost, row.cost, nowIso())
  const box = db.prepare('SELECT * FROM sealed_box_open WHERE id = ?').get(Number(info.lastInsertRowid)) as BoxRow
  return { ...ripNextPack(box), promo: promos[0] ?? null, promos }
}

/** The next wrapper out of a box that is already open. */
export function openBoxNext(boxId: number) {
  const box = db.prepare('SELECT * FROM sealed_box_open WHERE id = ?').get(boxId) as BoxRow | undefined
  if (!box) throw new Error('That box is already empty')
  return ripNextPack(box)
}

/**
 * The skip button: rip every wrapper still in the box in one request and
 * return the combined pulls. The box is deleted by its final pack through the
 * same ripNextPack path, so inventory, vault space, records and the box-open
 * row stay consistent with packing one at a time.
 */
export function openBoxRest(boxId: number) {
  let box = db.prepare('SELECT * FROM sealed_box_open WHERE id = ?').get(boxId) as BoxRow | undefined
  if (!box) throw new Error('That box is already empty')
  const packs: ReturnType<typeof ripNextPack>[] = []
  let guard = box.packs_total + 1
  while (box && box.packs_left > 0 && guard-- > 0) {
    packs.push(ripNextPack(box))
    if (packs[packs.length - 1].packsLeft <= 0) break
    box = db.prepare('SELECT * FROM sealed_box_open WHERE id = ?').get(boxId) as BoxRow | undefined
  }
  if (packs.length === 0) throw new Error('That box is already empty')
  const last = packs[packs.length - 1]
  const cards = packs.flatMap((p) => p.cards)
  return {
    sessionId: packs[0].sessionId,
    sessionIds: packs.map((p) => p.sessionId),
    cards,
    totalValue: round2(packs.reduce((a, p) => a + p.totalValue, 0)),
    spent: round2(packs.reduce((a, p) => a + p.spent, 0)),
    boxId: last.boxId,
    productId: last.productId,
    productName: last.productName,
    packIndex: last.packIndex,
    packsTotal: last.packsTotal,
    packsLeft: last.packsLeft,
    done: last.packsLeft <= 0,
    packsOpened: packs.length,
    perPack: packs.map((p) => ({ sessionId: p.sessionId, cards: p.cards, totalValue: p.totalValue, spent: p.spent })),
  }
}

/** Boxes with wrappers still in them, for the ceremony's resume row. */
export function openBoxes() {
  return db
    .prepare(
      `SELECT b.id, b.product_id, b.packs_left, b.packs_total, p.name
       FROM sealed_box_open b LEFT JOIN pack_products p ON p.id = b.product_id
       ORDER BY b.created_at ASC`,
    )
    .all() as { id: number; product_id: string; packs_left: number; packs_total: number; name: string | null }[]
}
