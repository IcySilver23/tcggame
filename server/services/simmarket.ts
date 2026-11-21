import { db, getMeta, setMeta, nowIso, logActivity } from '../lib/db'
import { markPricesChanged } from '../lib/derived-cache'
import { estimatePrice, researchedAnchor } from './estimates'

// ---------------------------------------------------------------------------
// API quota budget + simulated-market fallback
//
// Limited sources (PriceCharting, eBay) have hard daily quotas:
//   • PriceCharting: 1,000 calls/day (non-subscribed tokens), 1 call/sec pace
//   • eBay:          5,000 calls/day (production keys)
//
// The backfill consumes quota ONLY for unpriced cards, so free users never
// waste calls on refreshes. When a source runs out (HTTP 429/403-quota, or the
// local budget hits 0), the app does NOT hard-fail: price resolution degrades
// to a clearly-labeled SIM · MARKET simulated price — a plausible synthetic
// value derived from whatever real anchor the card already has (any price row,
// else the model estimate) — until the quota resets and real data flows again.
// Real prices always win: resolvePrice prefers live rows whenever they exist,
// so recovery is automatic with zero extra code.
// ---------------------------------------------------------------------------

const PC_BUDGET_KEY = 'pcQuotaBudget'
const EBAY_BUDGET_KEY = 'ebayQuotaBudget'
const QUOTA_RESET_KEY = 'quotaResetAt'
const DAY_MS = 24 * 3600_000

export function pcDailyLimit(): number {
  return Number(getMeta('pcQuotaLimit') ?? '1000')
}
export function ebayDailyLimit(): number {
  return Number(getMeta('ebayQuotaLimit') ?? '5000')
}

function resetAt(): number {
  const raw = getMeta(QUOTA_RESET_KEY)
  const at = raw ? new Date(raw).getTime() : 0
  if (Date.now() >= at) {
    // New day → refresh budgets and clear the pause state.
    setMeta(PC_BUDGET_KEY, String(pcDailyLimit()))
    setMeta(EBAY_BUDGET_KEY, String(ebayDailyLimit()))
    setMeta(QUOTA_RESET_KEY, new Date(Date.now() + DAY_MS).toISOString())
    setMeta('pcQuotaExhaustedAt', '')
    setMeta('ebayQuotaExhaustedAt', '')
    return Date.now() + DAY_MS
  }
  return at
}

export function pcBudget(): number {
  resetAt()
  return Number(getMeta(PC_BUDGET_KEY) ?? pcDailyLimit())
}

export function ebayBudget(): number {
  resetAt()
  return Number(getMeta(EBAY_BUDGET_KEY) ?? ebayDailyLimit())
}

/** Charge one API call. Returns false when the budget is gone. */
export function chargePc(): boolean {
  const b = pcBudget()
  if (b <= 0) return false
  setMeta(PC_BUDGET_KEY, String(b - 1))
  return true
}

export function chargeEbay(): boolean {
  const b = ebayBudget()
  if (b <= 0) return false
  setMeta(EBAY_BUDGET_KEY, String(b - 1))
  return true
}

/** Called when an API responds 429 / quota-exhausted — stop using it for the day. */
export function markQuotaExhausted(source: 'pc' | 'ebay', retryAfterMs?: number): void {
  setMeta(source === 'pc' ? PC_BUDGET_KEY : EBAY_BUDGET_KEY, '0')
  setMeta(source === 'pc' ? 'pcQuotaExhaustedAt' : 'ebayQuotaExhaustedAt', nowIso())
  if (retryAfterMs && retryAfterMs > 0 && retryAfterMs < DAY_MS) {
    const cur = new Date(getMeta(QUOTA_RESET_KEY) ?? 0).getTime()
    const next = Date.now() + retryAfterMs
    if (next > cur) setMeta(QUOTA_RESET_KEY, new Date(next).toISOString())
  }
  const label = source === 'pc' ? 'PriceCharting' : 'eBay'
  console.warn(`[simmarket] ${label} daily quota exhausted — falling back to simulated prices until reset.`)
  logActivity('system', `${label} daily API quota used up — prices switch to simulated market data until the quota resets.`)
}

export function quotaState(): {
  pc: { budget: number; limit: number; exhaustedAt: string | null }
  ebay: { budget: number; limit: number; exhaustedAt: string | null }
  resetsAt: string
} {
  resetAt()
  const at = getMeta(QUOTA_RESET_KEY) ?? new Date(Date.now() + DAY_MS).toISOString()
  return {
    pc: { budget: pcBudget(), limit: pcDailyLimit(), exhaustedAt: getMeta('pcQuotaExhaustedAt') || null },
    ebay: { budget: ebayBudget(), limit: ebayDailyLimit(), exhaustedAt: getMeta('ebayQuotaExhaustedAt') || null },
    resetsAt: at,
  }
}

// ---------------------------------------------------------------------------
// Simulated anchor
//
// Derived deterministically per day from the card's best anchor (latest real
// price row of any kind), perturbed ±12% with a stable per-card seed so values
// don't visibly jitter between UI refreshes but still drift day to day like a
// living market.
// ---------------------------------------------------------------------------

const ANY_ANCHOR = db.prepare(
  `SELECT market FROM price_records
   WHERE card_id = ? AND market IS NOT NULL AND kind != 'simulated'
   ORDER BY retrieved_at DESC LIMIT 1`,
)

/**
 * Fallback anchors for cards with no price row of their own, probed in order
 * after ANY_ANCHOR misses:
 *   1. Variant sibling — `xy9-98a` anchors to the base printing `xy9-98`.
 *   2. Cheapest same-name sibling in the same set — promo-pack stamps
 *      (`me55-R`) anchor to the plain printing of the same card, not to an
 *      expensive stamped collector piece sharing the name.
 *   3. Commodity twin — basic energies and repeatedly-printed trainers have
 *      one fungible market: the MEDIAN price of same-name, same-rarity
 *      printings across sets. Median (not latest) so a full-art or
 *      Worlds-stamped outlier can't become the anchor; rarity-matched so
 *      plain commons don't inherit secret-rare prices.
 */
function siblingAnchor(cardId: string): number | null {
  const dash = cardId.lastIndexOf('-')
  if (dash < 0) return null
  const setPart = cardId.slice(0, dash)
  const numPart = cardId.slice(dash + 1)
  const numMatch = /^(\d+)([A-Za-z]+)$/.exec(numPart)
  if (numMatch) {
    const r = ANY_ANCHOR.get(`${setPart}-${numMatch[1]}`) as { market: number } | undefined
    if (r?.market) return r.market
  }
  const nameRow = db.prepare('SELECT name, set_id FROM cards WHERE id = ?').get(cardId) as { name: string; set_id: string } | undefined
  if (!nameRow) return null
  // Energies sit this one out: the only same-set sibling an unpriced energy
  // usually has is its own secret-rare printing — a $10 collector piece that
  // shares nothing with the $0.30 bulk card. Energies are commodities; the
  // era-windowed median below prices them honestly.
  const sup = db.prepare('SELECT supertype FROM cards WHERE id = ?').get(cardId) as { supertype: string } | undefined
  if (/^energy$/i.test(sup?.supertype ?? '')) return null
  // Same card, another printing in the same set — prefer the CHEAPEST real
  // sibling price (the plain printing a stamp rides on; also a deterministic
  // pick, since "latest" ties when siblings were synced in one batch), and
  // only then accept a sibling's simulated row (itself anchored to something
  // sane) over falling through to the blunt tier model. This resolves chains
  // like two unpriced Emma printings: the second one anchors to the first.
  const real = db
    .prepare(
      `SELECT MIN(p.market) AS market FROM price_records p JOIN cards c ON c.id = p.card_id
       WHERE c.set_id = ? AND c.name = ? AND c.id != ? AND p.market IS NOT NULL AND p.kind != 'simulated'`,
    )
    .get(nameRow.set_id, nameRow.name, cardId) as { market: number | null } | undefined
  if (real?.market != null) return real.market
  const sim = db
    .prepare(
      `SELECT p.market FROM price_records p JOIN cards c ON c.id = p.card_id
       WHERE c.set_id = ? AND c.name = ? AND c.id != ? AND p.market IS NOT NULL AND p.kind = 'simulated'
       ORDER BY p.retrieved_at DESC LIMIT 1`,
    )
    .get(nameRow.set_id, nameRow.name, cardId) as { market: number } | undefined
  return sim?.market ?? null
}

function commodityAnchor(cardId: string): number | null {
  const c = db.prepare('SELECT name, supertype, rarity FROM cards WHERE id = ?').get(cardId) as { name: string; supertype: string; rarity: string | null } | undefined
  if (!c || !/^(energy|trainer)$/i.test(c.supertype)) return null
  // Same name, comparable printing, median across sets. Variant-filtered (a
  // reverse-holo energy is a different market than the plain printing) and
  // era-windowed (±5 release years — a 1999 vintage common and a 2017 bulk
  // common share a name but not a market), with an all-era fallback when the
  // window is empty. MIN per card dedupes multi-sync price rows so one card
  // can't weight the median by how many times it was synced.
  const yearRow = db
    .prepare(
      `SELECT CAST(substr(s.release_date, 1, 4) AS INTEGER) AS yr FROM cards c JOIN sets s ON s.id = c.set_id WHERE c.id = ?`,
    )
    .get(cardId) as { yr: number | null } | undefined
  const yr = yearRow?.yr ?? null
  const pool = (withRarity: boolean, withEra: boolean) =>
    db
      .prepare(
        `SELECT MIN(p.market) AS market FROM price_records p
         JOIN cards c2 ON c2.id = p.card_id
         JOIN sets s2 ON s2.id = c2.set_id
         WHERE c2.name = ? AND c2.supertype = ? AND c2.id != ?
           AND p.market IS NOT NULL AND p.kind != 'simulated' AND p.variant = 'normal'
           ${withRarity && c.rarity ? 'AND c2.rarity = ?' : ''}
           ${withEra && yr ? 'AND ABS(CAST(substr(s2.release_date, 1, 4) AS INTEGER) - ?) <= 5' : ''}
         GROUP BY c2.id ORDER BY market`,
      )
      .all(...(withRarity && c.rarity ? [c.name, c.supertype, c.rarity, cardId] : [c.name, c.supertype, cardId]), ...(withEra && yr ? [yr] : [])) as { market: number }[]
  let rows = pool(true, true)
  if (rows.length === 0) rows = pool(true, false)
  if (rows.length === 0) rows = pool(false, true)
  if (rows.length === 0) rows = pool(false, false)
  if (rows.length === 0) return null
  return rows[Math.floor(rows.length / 2)].market
}

/** Stable 0..1 hash of cardId + day, so values are smooth within a day. */
function dailySeed(cardId: string): number {
  const day = Math.floor(Date.now() / DAY_MS)
  let h = 2166136261 ^ day
  for (let i = 0; i < cardId.length; i++) {
    h ^= cardId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

export function simJitter(cardId: string): number {
  return 0.88 + dailySeed(cardId) * 0.24 // ±12% band
}

/**
 * Simulated NM anchor for a card: its best real price row perturbed by the
 * daily drift, else (no real data at all) the model estimate perturbed.
 * Only consulted when REAL sources are unavailable — real rows always take
 * precedence in resolvePrice.
 */
export function simulatedAnchor(cardId: string): number | null {
  // Hand-researched values outrank every inference below. The sibling anchor
  // happily drags a $3,850 phantom Mew down to the $0.35 common it shares a
  // name with, which is the exact failure this table exists to correct.
  const curated = researchedAnchor(cardId)
  if (curated != null) return Math.round(curated * simJitter(cardId) * 100) / 100
  const row = ANY_ANCHOR.get(cardId) as { market: number } | undefined
  let base = row?.market ?? null
  let commodity = false
  if (base == null) {
    base = siblingAnchor(cardId)
  }
  if (base == null) {
    base = commodityAnchor(cardId)
    commodity = base != null // cross-set pools can carry collector-piece outliers
  }
  if (base == null) base = estimatePrice(cardId)
  else if (commodity) {
    // Sanity cap for cross-set inference only: the only priced "Tropical
    // Wind" printings can be Worlds-stamped collectibles. Same-set siblings
    // are exempt — a set's own prices are internally consistent, and the
    // blunt tier model would wrongly cap a stamp toward its median.
    const est = estimatePrice(cardId)
    if (est != null) base = Math.min(base, Math.max(est * 4, 0.5))
  }
  if (base != null && base > 0) return Math.round(base * simJitter(cardId) * 100) / 100
  return null
}

const simStoredToday = db.prepare(
  `SELECT 1 FROM price_records WHERE card_id = ? AND kind = 'simulated' AND retrieved_at >= date('now') LIMIT 1`,
)
const insertSim = db.prepare(
  `INSERT INTO price_records (card_id, kind, variant, low, mid, high, market, direct_low, avg1, avg7, avg30, retrieved_at)
   VALUES (?, 'simulated', 'normal', ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
)
const cardsWithoutRealPrice = db.prepare(
  `SELECT c.id FROM cards c
   WHERE c.id NOT IN (SELECT card_id FROM price_records WHERE market IS NOT NULL AND kind != 'simulated')`,
)

/**
 * Store a simulated market price (kind 'simulated') for every card that has no
 * REAL price. These rows are what resolvePrice serves while quotas are out —
 * and they are automatically outranked the moment a real row (TCGplayer,
 * PriceCharting, eBay) lands. Returns the number of rows written.
 */
export function generateSimPrices(): number {
  // Housekeeping: simulated rows are useless once a REAL price exists for the
  // card (resolvePrice always prefers real rows) — drop the shadows.
  db.prepare(
    `DELETE FROM price_records WHERE kind = 'simulated' AND card_id IN
     (SELECT DISTINCT card_id FROM price_records WHERE market IS NOT NULL AND kind != 'simulated')`,
  ).run()
  const cards = cardsWithoutRealPrice.all() as { id: string }[]
  let n = 0
  const tx = db.transaction(() => {
    for (const c of cards) {
      if (simStoredToday.get(c.id)) continue
      const anchor = simulatedAnchor(c.id)
      if (anchor == null) continue
      const v = Math.max(0.05, anchor)
      insertSim.run(c.id, Math.round(v * 0.85 * 100) / 100, v, Math.round(v * 1.25 * 100) / 100, v, nowIso())
      n++
    }
  })
  tx()
  if (n > 0) {
    markPricesChanged()
    console.log(`[simmarket] simulated prices written for ${n} card(s) while real sources are unavailable`)
  }
  return n
}
