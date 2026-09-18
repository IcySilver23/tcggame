import { db, nowIso, getMeta, setMeta, logActivity } from '../lib/db'
import { estimatePrice } from './estimates'

// ---------------------------------------------------------------------------
// Conditions & variants
// ---------------------------------------------------------------------------

export const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DM'] as const
export type Condition = (typeof CONDITIONS)[number]

// Multipliers of Near-Mint value — labeled ESTIMATED in the UI.
export const CONDITION_MULT: Record<Condition, number> = { NM: 1, LP: 0.8, MP: 0.65, HP: 0.5, DM: 0.35 }

export const VARIANT_LABELS: Record<string, string> = {
  normal: 'Normal',
  holofoil: 'Holofoil',
  reverseHolofoil: 'Reverse Holofoil',
  '1stEditionNormal': '1st Edition (Normal)',
  '1stEditionHolofoil': '1st Edition (Holo)',
}

// ---------------------------------------------------------------------------
// Price resolution
// ---------------------------------------------------------------------------

export type ResolvedPrice = {
  usd: number | null
  source: 'live' | 'last' | 'estimated' | 'model'
  retrievedAt: string | null
  kind: string | null // 'tcgplayer' | 'cardmarket' | 'estimated'
  variant: string
  low: number | null
  high: number | null
}

/**
 * Resolve a USD value for a card variant. Anchored on the REAL TCGplayer
 * `market` price for the requested variant (or holofoil/normal fallbacks for
 * older sets). Every other tier is a transparent multiplier, labeled estimated.
 */
export function resolvePrice(cardId: string, variant = 'normal', condition: Condition = 'NM'): ResolvedPrice {
  const rows = db
    .prepare(
      `SELECT kind, variant, low, mid, high, market, retrieved_at
       FROM price_records WHERE card_id = ? AND kind = 'tcgplayer' ORDER BY retrieved_at DESC`,
    )
    .all(cardId) as { kind: string; variant: string; low: number | null; mid: number | null; high: number | null; market: number | null; retrieved_at: string }[]

  const pick =
    rows.find((r) => r.variant === variant && r.market != null) ??
    rows.find((r) => r.variant === 'holofoil' && r.market != null) ??
    rows.find((r) => r.variant === 'normal' && r.market != null) ??
    rows.find((r) => r.market != null)

  if (!pick || pick.market == null) {
    // No TCGplayer data: try REAL prices we synced from other marketplaces
    // (PriceCharting raw price, eBay active-listings median) before falling
    // back to the comparable model estimate.
    const ext = db
      .prepare(
        `SELECT kind, market, low, high, retrieved_at FROM price_records
         WHERE card_id = ? AND kind IN ('pricecharting', 'ebay') AND market IS NOT NULL
         ORDER BY CASE kind WHEN 'pricecharting' THEN 0 ELSE 1 END, retrieved_at DESC
         LIMIT 1`,
      )
      .get(cardId) as { kind: string; market: number; low: number | null; high: number | null; retrieved_at: string } | undefined
    if (ext) {
      const mult = CONDITION_MULT[condition] ?? 1
      return {
        usd: round2(ext.market * mult),
        source: 'live',
        retrievedAt: ext.retrieved_at,
        kind: ext.kind,
        variant,
        low: ext.low != null ? round2(ext.low * mult) : null,
        high: ext.high != null ? round2(ext.high * mult) : null,
      }
    }
    // Nothing real anywhere: comparable-based model estimate, clearly labeled
    // kind 'model' (EST · MODEL in the UI) — never presented as live data.
    const est = estimatePrice(cardId)
    if (est != null) {
      const mult = CONDITION_MULT[condition] ?? 1
      return { usd: round2(est * mult), source: 'model', retrievedAt: null, kind: 'model', variant, low: null, high: null }
    }
    return { usd: null, source: 'estimated', retrievedAt: null, kind: 'estimated', variant, low: null, high: null }
  }

  const mult = CONDITION_MULT[condition] ?? 1
  const isAnchor = condition === 'NM'
  return {
    usd: round2(pick.market * mult),
    source: isAnchor ? 'live' : 'estimated',
    retrievedAt: pick.retrieved_at,
    kind: 'tcgplayer',
    variant: pick.variant,
    low: pick.low != null ? round2(pick.low * mult) : null,
    high: pick.high != null ? round2(pick.high * mult) : null,
  }
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Best-effort USD value used for inventory math. 0 when no data exists yet. */
export function valueOf(cardId: string, variant = 'normal', condition: Condition = 'NM'): number {
  return resolvePrice(cardId, variant, condition).usd ?? 0
}

// ---------------------------------------------------------------------------
// Graded prices (real PriceCharting PSA/BGS/CGC/SGC data)
// ---------------------------------------------------------------------------

export type GradedQuote = { grade: string; usd: number; retrievedAt: string; source: 'pc-graded' | 'ebay-graded' }

const GRADE_ORDER = ['PSA10', 'BGS10', 'CGC10', 'SGC10', 'PSA9', 'PSA8', 'PSA7']

/** Latest real graded prices for a card (PriceCharting + eBay comps), best grade first. */
export function gradedPrices(cardId: string): GradedQuote[] {
  const rows = db
    .prepare(
      `SELECT kind, variant, market, retrieved_at FROM price_records
       WHERE card_id = ? AND kind IN ('pc-graded', 'ebay-graded') AND market IS NOT NULL
       AND retrieved_at = (SELECT MAX(p2.retrieved_at) FROM price_records p2
                           WHERE p2.card_id = price_records.card_id AND p2.kind = price_records.kind AND p2.variant = price_records.variant)`,
    )
    .all(cardId) as { kind: string; variant: string; market: number; retrieved_at: string }[]
  // One row per grade: PriceCharting wins when both sources have the same grade.
  const best = new Map<string, { grade: string; usd: number; retrievedAt: string; source: 'pc-graded' | 'ebay-graded' }>()
  for (const r of rows) {
    const q = { grade: r.variant, usd: r.market, retrievedAt: r.retrieved_at, source: r.kind as 'pc-graded' | 'ebay-graded' }
    const existing = best.get(r.variant)
    if (!existing || (existing.source === 'ebay-graded' && q.source === 'pc-graded')) best.set(r.variant, q)
  }
  return [...best.values()].sort((a, b) => {
    const ia = GRADE_ORDER.indexOf(a.grade)
    const ib = GRADE_ORDER.indexOf(b.grade)
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    return b.usd - a.usd
  })
}

/** Value of a graded card: real PriceCharting grade price, then real eBay graded comp, else a raw-value multiplier (labeled estimated). */
export function gradedPriceOf(cardId: string, grade: string | null): { usd: number; source: 'live' | 'estimated'; kind: 'pc-graded' | 'ebay-graded' | null } {
  const row = db
    .prepare(
      `SELECT kind, market, retrieved_at FROM price_records
       WHERE card_id = ? AND kind IN ('pc-graded', 'ebay-graded') AND variant = ? AND market IS NOT NULL
       ORDER BY CASE kind WHEN 'pc-graded' THEN 0 ELSE 1 END, retrieved_at DESC
       LIMIT 1`,
    )
    .get(cardId, grade ?? '') as { kind: 'pc-graded' | 'ebay-graded'; market: number; retrieved_at: string } | undefined
  if (row) return { usd: row.market, source: 'live', kind: row.kind }
  // No real grade data anywhere: transparent multiplier of the raw value (PSA10 3.5×, PSA9 1.6×, PSA8 1.15×, PSA7 0.8×)
  const mult: Record<string, number> = { PSA10: 3.5, BGS10: 4, CGC10: 3, SGC10: 2.5, PSA9: 1.6, PSA8: 1.15, PSA7: 0.8 }
  return { usd: round2(valueOf(cardId) * (mult[grade ?? ''] ?? 1)), source: 'estimated', kind: null }
}

/** Resolve value for one inventory row — graded rows use their grade's real price. */
export function valueOfRow(r: { card_id: string; variant: string; condition: string; graded_grade: string | null }): number {
  if (r.graded_grade) return gradedPriceOf(r.card_id, r.graded_grade).usd
  return valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
}

// ---------------------------------------------------------------------------
// First Edition pricing — real rows where TCGplayer tracks the variant
// ('1stEdition' / '1stEditionHolofoil'), else a labeled multiplier of the
// unlimited value (WotC 1st Ed stamps trade at a large premium).
// ---------------------------------------------------------------------------

const FIRST_ED_MULT = 3.2
const FIRST_ED_HOLO_MULT = 4.5

export function firstEditionValueOf(cardId: string, holo: boolean): number {
  const want = holo ? '1stEditionHolofoil' : '1stEdition'
  const rows = db
    .prepare(
      `SELECT market FROM price_records
       WHERE card_id = ? AND kind = 'tcgplayer' AND variant = ? AND market IS NOT NULL
       ORDER BY retrieved_at DESC LIMIT 1`,
    )
    .get(cardId, want) as { market: number } | undefined
  if (rows?.market) return round2(rows.market)
  const base = resolvePrice(cardId, holo ? 'holofoil' : 'normal').usd ?? 0
  if (base <= 0) return 0
  return round2(base * (holo ? FIRST_ED_HOLO_MULT : FIRST_ED_MULT))
}

// ---------------------------------------------------------------------------
// Price history (snapshots we take over time)
// ---------------------------------------------------------------------------

export function priceHistory(cardId: string, variant = 'normal') {
  return db
    .prepare(
      `SELECT market, retrieved_at FROM price_records
       WHERE card_id = ? AND variant = ? AND market IS NOT NULL
       ORDER BY retrieved_at ASC`,
    )
    .all(cardId, variant) as { market: number; retrieved_at: string }[]
}

export function takeSnapshot() {
  const at = nowIso()
  const info = db
    .prepare(
      `INSERT INTO price_records (card_id, kind, variant, low, mid, high, market, direct_low, retrieved_at)
       SELECT card_id, kind, variant, low, mid, high, market, direct_low, ?
       FROM price_records
       WHERE retrieved_at = (SELECT MAX(retrieved_at) FROM price_records p2 WHERE p2.card_id = price_records.card_id AND p2.kind = price_records.kind AND p2.variant = price_records.variant)`,
    )
    .run(at)
  setMeta('lastSnapshotAt', at)
  return info.changes
}

// ---------------------------------------------------------------------------
// Simulated marketplace feed
// ---------------------------------------------------------------------------

const SELLER_NAMES = [
  'PikachuPlaza', 'CharizardCentral', 'HoloHaven', 'TheCharizardCave', 'PackRipperPro',
  'GradeGeekCards', 'VintageVaultTCG', 'ShinyHunterHQ', 'DragonVaultCards', 'SetCompleteTCG',
  'MintConditionMike', 'BoosterBoxBros', 'EliteDrawCollect', 'TrainerTrevor', 'RainbowRareRick',
]

const FIRST_NAMES = ['Alex', 'Sam', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Taylor', 'Quinn', 'Avery', 'Blake']

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function generateListings(count: number): number {
  const at = nowIso()
  // Favor somewhat popular cards: join with value so we only list cards with data.
  const candidates = db
    .prepare(
      `WITH latest AS (
         SELECT card_id, variant, market, low, high,
                ROW_NUMBER() OVER (PARTITION BY card_id, variant ORDER BY retrieved_at DESC) rn
         FROM price_records WHERE kind = 'tcgplayer' AND market IS NOT NULL
       )
       SELECT c.id, c.name, l.variant, l.market, l.low, l.high
       FROM latest l JOIN cards c ON c.id = l.card_id
       WHERE rn = 1 ORDER BY RANDOM() LIMIT ?`,
    )
    .all(Math.max(count * 2, 40)) as { id: string; name: string; variant: string; market: number; low: number | null; high: number | null }[]

  if (candidates.length === 0) return 0
  const insert = db.prepare(
    `INSERT OR REPLACE INTO listings (id, card_id, variant, condition, price, shipping, seller_name, seller_rating, seller_sales, eta_days, listed_at, expires_at, deal_score, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'npc')`,
  )
  const tx = db.transaction(() => {
    for (let i = 0; i < count && candidates.length > 0; i++) {
      const c = pick(candidates)
      const roll = Math.random()
      // Deal distribution: ~18% below market, ~55% at market, ~27% above.
      let mult: number
      if (roll < 0.18) mult = rand(0.62, 0.9)
      else if (roll < 0.73) mult = rand(0.95, 1.08)
      else mult = rand(1.1, 1.45)
      const condition = pick(CONDITIONS.filter((x) => x !== 'DM') as unknown as Condition[])
      const condMult = CONDITION_MULT[condition]
      const marketAtCondition = c.market * condMult
      const price = Math.max(0.35, round2(marketAtCondition * mult))
      const id = `${c.id}:${variantKey(c.variant)}:${condition}:${Date.now()}:${i}`
      const eta = Math.round(rand(2, 10))
      insert.run(
        id, c.id, c.variant, condition, price,
        Math.random() < 0.5 ? 0 : round2(rand(0.99, 4.99)),
        Math.random() < 0.6 ? pick(SELLER_NAMES) : `${pick(FIRST_NAMES)}${Math.floor(rand(10, 99))}`,
        round2(rand(95, 100)), Math.floor(rand(12, 4200)),
        eta, at,
        new Date(Date.now() + rand(20, 90) * 60_000).toISOString(),
        c.market > 0 ? marketAtCondition / (price + 0.01) : 1,
      )
    }
  })
  tx()
  setMeta('listingsGeneratedAt', at)
  return count
}

function variantKey(v: string) {
  return v.replace(/[^a-z0-9]/gi, '')
}

/** Remove expired listings and simulate other buyers snatching good deals. */
export function cullListings(): number {
  const at = nowIso()
  // Other NPC buyers take the best deals over time.
  const taken = db
    .prepare(`DELETE FROM listings WHERE deal_score > 1.12 AND expires_at > ? AND RANDOM() < 0.15`)
    .run(at)
  const expired = db.prepare(`DELETE FROM listings WHERE expires_at <= ?`).run(at)
  return taken.changes + expired.changes
}

export function ensureMarketFeed() {
  const c = (db.prepare('SELECT COUNT(*) AS n FROM listings').get() as { n: number }).n
  if (c < 220) generateListings(Math.min(320 - c, 120))
}

// ---------------------------------------------------------------------------
// Sales resolution — NPC buyers purchase the player's listings
// ---------------------------------------------------------------------------

// Binders cleanup is imported lazily to keep module load order simple.
import { cleanupSlotsForInventory } from './binders'

// Graded-sale resolution — graded cards sell at their (real) graded value
export function resolveGradedSales(): number {
  const rows = db
    .prepare(`SELECT * FROM inventory WHERE status = 'listed' AND graded_grade IS NOT NULL`)
    .all() as { id: number; card_id: string; variant: string; condition: string; quantity: number; listing_price: number | null; listed_at: string; cost_basis: number; graded_grade: string | null }[]
  if (rows.length === 0) return 0

  let total = 0
  const sellRow = db.prepare(`UPDATE inventory SET status = 'sold', quantity = 0 WHERE id = ?`)
  const insertSale = db.prepare(
    `INSERT INTO sale_history (inventory_id, card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'graded', ?)`,
  )
  for (const row of rows) {
    if (!row.listing_price || !row.listed_at) continue
    const anchor = gradedPriceOf(row.card_id, row.graded_grade).usd
    const ratio = anchor > 0 ? row.listing_price / anchor : 1
    const expectedMs = Math.max(15_000, 60_000 * ratio * ratio)
    const hazard = ((Date.now() - new Date(row.listed_at).getTime()) / expectedMs) * 0.35
    if (Math.random() < Math.min(0.9, hazard)) {
      const fee = round2(row.listing_price * 0.1)
      const proceeds = round2(row.listing_price - fee)
      const cost = round2(row.cost_basis * row.quantity)
      const profit = round2(proceeds - cost)
      total += proceeds
      sellRow.run(row.id)
      cleanupSlotsForInventory([row.id])
      insertSale.run(row.id, row.card_id, row.variant, row.condition, row.quantity, proceeds, cost, fee, profit, pick(FIRST_NAMES), nowIso())
      const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(row.card_id) as { name: string } | undefined)?.name ?? row.card_id
      logActivity('sale', `${name} (${row.graded_grade}) sold for $${proceeds.toFixed(2)} after 10% fee`, proceeds)
    }
  }
  if (total > 0) db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(round2(total))
  return rows.length
}

export function resolveSales(): number {
  const rows = db
    .prepare(`SELECT * FROM inventory WHERE status = 'listed' AND graded_grade IS NULL`)
    .all() as {
    id: number; card_id: string; variant: string; condition: string; quantity: number
    listing_price: number | null; listed_at: string; cost_basis: number
  }[]
  if (rows.length === 0) return 0

  const state = getGameState()
  let total = 0
  const sellRow = db.prepare(`UPDATE inventory SET status = 'sold', quantity = 0 WHERE id = ?`)
  const insertSale = db.prepare(
    `INSERT INTO sale_history (inventory_id, card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'listing', ?)`,
  )

  for (const row of rows) {
    if (!row.listing_price || !row.listed_at) continue
    const listedMs = Date.now() - new Date(row.listed_at).getTime()
    const market = valueOf(row.card_id, row.variant, 'NM')
    const ratio = market > 0 ? row.listing_price / market : 1
    // Pacing: 1 game-tick = 45s. A market-priced listing typically sells within a
    // few minutes of active play; undercutting sells faster, overpricing drags.
    const expectedMs = Math.max(15_000, 60_000 * ratio * ratio)
    const hazard = (listedMs / expectedMs) * 0.35
    if (Math.random() < Math.min(0.9, hazard)) {
      const fee = round2(row.listing_price * 0.1)
      const proceeds = round2(row.listing_price - fee)
      const cost = round2(row.cost_basis * row.quantity)
      const profit = round2(proceeds - cost)
      total += proceeds
      sellRow.run(row.id)
      cleanupSlotsForInventory([row.id])
      insertSale.run(row.id, row.card_id, row.variant, row.condition, row.quantity, proceeds, cost, fee, profit, pick(FIRST_NAMES), nowIso())
      const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(row.card_id) as { name: string } | undefined)?.name ?? row.card_id
      logActivity('sale', `${name} sold for $${proceeds.toFixed(2)} (after 10% fee)`, proceeds)
    }
  }
  if (total > 0) {
    db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(round2(total))
  }
  return rows.length
}

export function getGameState() {
  return db.prepare('SELECT * FROM game_state WHERE id = 1').get() as { cash: number; created_at: string; last_tick_at: string | null }
}

// ---------------------------------------------------------------------------
// Clock / tick
// ---------------------------------------------------------------------------

export function tick() {
  const state = getGameState()
  const last = state.last_tick_at ?? new Date(Date.now() - 60_000).toISOString()
  const elapsed = Date.now() - new Date(last).getTime()
  if (elapsed < 20_000) return // tick at most every 20s (UI polls every 15s)
  setMeta('lastTickAt', nowIso())
  db.prepare('UPDATE game_state SET last_tick_at = ? WHERE id = 1').run(nowIso())
  cullListings()
  ensureMarketFeed()
  resolveSales()
  resolveGradedSales()
  // NPC trading — lazy import to avoid a market ↔ trading cycle
  import('./trading').then((t) => t.tradeTick()).catch(() => {})
  // Conventions — shows open, close, and get shopped on the game clock
  import('./conventions').then((cv) => cv.conventionTick()).catch(() => {})
  // Vendor tables — NPC walk-up buyers hit the player's rented table
  import('./vendor').then((v) => v.vendorTick()).catch(() => {})
  // The card shop — walk-in customers browse the display cases
  import('./shop').then((s) => s.shopTick()).catch(() => {})
  // Advanced finance — daily interest accrual on outstanding loans
  import('./finance').then((f) => f.accrueDaily()).catch(() => {})
  // Polish — wishlist price alerts and the weekly market digest
  import('./polish').then((p) => { p.checkAlerts(); p.digestTick() }).catch(() => {})
  // Tax season — files last month's return on the first tick of a new month
  import('./tax').then((t) => t.taxTick()).catch(() => {})
  // Sales tax — remits settled months to the city once a day
  import('./salestax').then((s) => s.taxRemitTick()).catch(() => {})
  // Auction house — lots settle, new lots spawn, NPC wars rage
  import('./auctions').then((a) => a.auctionTick()).catch(() => {})
}
