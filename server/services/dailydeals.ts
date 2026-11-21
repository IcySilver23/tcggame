import { db } from '../lib/db'
import { gameDayEnd, gameDayKey } from '../lib/gameday'
import * as sealed from './sealed'

/**
 * The Pack Shop's daily deals.
 *
 * The selection is deterministic for a game day: the same save sees the same
 * three products from the moment the day rolls until the next boundary, even
 * after a restart. One product comes from each shelf lane — a single pack, a
 * box and a collection — so the deal board is not three copies of the same
 * kind. The discount is derived from the same day key, so it cannot drift
 * between the shelf response and the till.
 *
 * A deal is a one-per-game-day offer: the claim lives in the save, keyed by the
 * game-day key and the product, so a restart cannot reset it and a hand-rolled
 * request cannot buy a second one.
 *
 * Each board is also snapshotted into daily_deal_history the first time it is
 * built. The snapshot keeps the product name, set, discount and prices as they
 * were, so a later catalogue change cannot rewrite what the player missed.
 */
export type DailyDeal = {
  discountPct: number
  endsAt: string
  claimed: boolean
}

export type PastDailyDeal = {
  dayKey: string
  productId: string
  productName: string
  setName: string
  kind: string
  discountPct: number
  basePrice: number
  dealPrice: number
  bought: boolean
}

export type DailyDealHistoryDay = {
  dayKey: string
  deals: PastDailyDeal[]
}

type DealTerms = Omit<DailyDeal, 'claimed'>

type ProductRow = { id: string; set_id: string; kind: string }

const LANES = ['pack', 'box', 'collection'] as const
type Lane = (typeof LANES)[number]

// schema.sql carries the same DDL for fresh saves; this keeps existing saves
// working without a migration step.
db.exec(`CREATE TABLE IF NOT EXISTS daily_deal_purchases (
  day_key TEXT NOT NULL,
  product_id TEXT NOT NULL,
  purchased_at TEXT NOT NULL,
  PRIMARY KEY (day_key, product_id)
)`)
db.exec(`CREATE TABLE IF NOT EXISTS daily_deal_history (
  day_key TEXT NOT NULL,
  product_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  set_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  discount_pct INTEGER NOT NULL,
  base_price REAL NOT NULL,
  deal_price REAL NOT NULL,
  ends_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (day_key, product_id)
)`)

let cache: { key: string; deals: ReadonlyMap<string, DealTerms> } | null = null
// The history insert is idempotent, but checking this first keeps a shop page
// load from doing three price reads and three ignored inserts every time.
let recordedKey: string | null = null

function laneOf(kind: string): Lane {
  if (kind === 'booster') return 'pack'
  if (kind === 'bundle' || kind === 'etb' || kind === 'display') return 'box'
  return 'collection'
}

/** FNV-1a: stable across processes and platforms, unlike a seeded PRNG. */
function hash(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** The shelf price after a deal, rounded to cents. */
export function discountedPrice(base: number, discountPct: number): number {
  return Math.round(base * (1 - discountPct / 100) * 100) / 100
}

function buildDeals(): ReadonlyMap<string, DealTerms> {
  const key = gameDayKey()
  if (cache?.key === key) return cache.deals

  const rows = db
    .prepare('SELECT id, set_id, kind FROM pack_products')
    .all() as ProductRow[]
  const pool = rows.filter((r) => sealed.sellsProduct(r.id, r.set_id))
  const chosen: ProductRow[] = []

  for (const lane of LANES) {
    const pick = pool
      .filter((r) => laneOf(r.kind) === lane && !chosen.some((c) => c.id === r.id))
      .sort((a, b) => hash(`${key}:${lane}:${b.id}`) - hash(`${key}:${lane}:${a.id}`) || a.id.localeCompare(b.id))[0]
    if (pick) chosen.push(pick)
  }

  // A catalogue missing a lane still gets three deals: fill from anything left,
  // ranked by the same day key so the extra picks are just as stable.
  if (chosen.length < 3) {
    const rest = pool
      .filter((r) => !chosen.some((c) => c.id === r.id))
      .sort((a, b) => hash(`${key}:extra:${b.id}`) - hash(`${key}:extra:${a.id}`) || a.id.localeCompare(b.id))
    for (const row of rest) {
      if (chosen.length >= 3) break
      chosen.push(row)
    }
  }

  const endsAt = gameDayEnd().toISOString()
  const deals = new Map<string, DealTerms>()
  for (const row of chosen) {
    deals.set(row.id, {
      discountPct: 10 + (hash(`${key}:${row.id}:pct`) % 21),
      endsAt,
    })
  }
  cache = { key, deals }
  return deals
}

/**
 * Write today's board into the history once per process. The prices are read
 * from the same resolver the shop uses, and the rows are INSERT OR IGNORE so a
 * restart cannot replace the price a player actually saw that day.
 */
function recordDeals(deals: ReadonlyMap<string, DealTerms>): void {
  const key = cache?.key
  if (!key || recordedKey === key || deals.size === 0) return
  let recorded = false
  try {
    const ids = [...deals.keys()]
    const marks = ids.map(() => '?').join(',')
    const products = db.prepare(`
      SELECT p.id, p.name, p.kind, s.name AS set_name
      FROM pack_products p JOIN sets s ON s.id = p.set_id
      WHERE p.id IN (${marks})
    `).all(...ids) as { id: string; name: string; kind: string; set_name: string }[]
    const byId = new Map(products.map((p) => [p.id, p]))
    const insert = db.prepare(`
      INSERT OR IGNORE INTO daily_deal_history
        (day_key, product_id, slot, product_name, set_name, kind, discount_pct, base_price, deal_price, ends_at, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const recordedAt = new Date().toISOString()
    const write = db.transaction(() => {
      let slot = 0
      for (const [productId, deal] of deals) {
        const product = byId.get(productId)
        if (!product) continue
        const base = sealed.priceOf(productId).market
        if (!(base > 0)) continue
        insert.run(
          key,
          productId,
          slot++,
          product.name,
          product.set_name,
          product.kind,
          deal.discountPct,
          base,
          discountedPrice(base, deal.discountPct),
          deal.endsAt,
          recordedAt,
        )
      }
    })
    write()
    recorded = true
  } catch {
    // A history row must never keep the shop from opening or a deal from being
    // bought. The next process gets another chance to write the snapshot.
  }
  if (recorded) recordedKey = key
}

function claimedProductIds(): Set<string> {
  const rows = db
    .prepare('SELECT product_id FROM daily_deal_purchases WHERE day_key = ?')
    .all(gameDayKey()) as { product_id: string }[]
  return new Set(rows.map((r) => r.product_id))
}

function isClaimedToday(productId: string): boolean {
  return Boolean(db
    .prepare('SELECT 1 FROM daily_deal_purchases WHERE day_key = ? AND product_id = ?')
    .get(gameDayKey(), productId))
}

/**
 * The daily-deal half of the shelf cache key: the game day plus today's claims.
 * A new day changes the board; a claim changes its `claimed` flag. The count
 * and newest timestamp also catch a restored save that rewinds claims.
 */
export function shelfRevision(): string {
  const day = gameDayKey()
  const row = db
    .prepare('SELECT COUNT(*) AS n, MAX(purchased_at) AS at FROM daily_deal_purchases WHERE day_key = ?')
    .get(day) as { n: number; at: string | null }
  return `${day}|${row.n}|${row.at ?? ''}`
}

/** Every product on today's deal board, keyed by product id. */
export function dealsForToday(): ReadonlyMap<string, DailyDeal> {
  const terms = buildDeals()
  recordDeals(terms)
  const claimed = claimedProductIds()
  const deals = new Map<string, DailyDeal>()
  for (const [id, deal] of terms) deals.set(id, { ...deal, claimed: claimed.has(id) })
  return deals
}

/** The deal for one product, or null when it is not on today's board. */
export function dealForToday(productId: string): DailyDeal | null {
  const terms = buildDeals()
  recordDeals(terms)
  const deal = terms.get(productId)
  if (!deal) return null
  return { ...deal, claimed: isClaimedToday(productId) }
}

/** Daily heartbeat hook: record today's board even if the shop is never opened. */
export function ensureTodayRecorded(): void {
  recordDeals(buildDeals())
}

/** The last few past boards, newest first, with claimed items marked. */
export function historyForPlayer(days = 3): DailyDealHistoryDay[] {
  const rows = db.prepare(`
    SELECT h.day_key, h.product_id, h.product_name, h.set_name, h.kind,
           h.discount_pct, h.base_price, h.deal_price,
           CASE WHEN c.product_id IS NULL THEN 0 ELSE 1 END AS bought
    FROM daily_deal_history h
    LEFT JOIN daily_deal_purchases c
      ON c.day_key = h.day_key AND c.product_id = h.product_id
    WHERE h.day_key <> ?
    ORDER BY h.day_key DESC, h.slot ASC
  `).all(gameDayKey()) as {
    day_key: string
    product_id: string
    product_name: string
    set_name: string
    kind: string
    discount_pct: number
    base_price: number
    deal_price: number
    bought: number
  }[]

  const out: DailyDealHistoryDay[] = []
  for (const row of rows) {
    let day = out.find((d) => d.dayKey === row.day_key)
    if (!day) {
      if (out.length >= days) break
      day = { dayKey: row.day_key, deals: [] }
      out.push(day)
    }
    day.deals.push({
      dayKey: row.day_key,
      productId: row.product_id,
      productName: row.product_name,
      setName: row.set_name,
      kind: row.kind,
      discountPct: row.discount_pct,
      basePrice: row.base_price,
      dealPrice: row.deal_price,
      bought: row.bought === 1,
    })
  }
  return out
}

/**
 * Claim a daily deal for this save and game day. Returns false when another
 * purchase already claimed it. Call this inside the purchase transaction: the
 * row and the charge commit together or not at all.
 */
export function claimDealToday(productId: string): boolean {
  const result = db
    .prepare('INSERT OR IGNORE INTO daily_deal_purchases (day_key, product_id, purchased_at) VALUES (?, ?, ?)')
    .run(gameDayKey(), productId, new Date().toISOString())
  return result.changes > 0
}

/** Test hook: forget the cached day so a copied save can be checked at once. */
export function resetDailyDealsCache(): void {
  cache = null
  recordedKey = null
}
