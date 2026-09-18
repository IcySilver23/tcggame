import { db, getMeta, setMeta, getSetting, nowIso, logActivity } from '../lib/db'
import { fetchJson } from '../lib/http'

// ---------------------------------------------------------------------------
// External real-market price sources
//
// When TCGplayer data is absent for a card (2026 sets, novelty promos), we pull
// REAL prices from other marketplaces instead of modeling them:
//
//   • PriceCharting — raw card price ("loose-price"), paid API (token), 1 call/sec
//   • eBay          — median of active fixed-price listings via the Browse API
//                     (OAuth client credentials)
//
// Prices are stored in price_records with kind 'pricecharting' | 'ebay' and
// flow through resolvePrice exactly like TCGplayer data. Cards without BOTH
// TCGplayer and external data still fall back to the model estimate.
//
// GRADED prices: PriceCharting exposes PSA/BGS/CGC/SGC grade columns (kind
// 'pc-graded'). When a card has no PC data (or PC has no price for that grade),
// we compute an eBay comp: the median of active fixed-price listings whose
// titles mention the card AND the grade (kind 'ebay-graded').
// ---------------------------------------------------------------------------

export type ExternalSource = 'pricecharting' | 'ebay'

// PriceCharting card-grade keys (their Prices API key table):
//   loose-price        = ungraded
//   manual-only-price  = PSA 10
//   graded-price       = PSA 9
//   new-price          = PSA 8
//   cib-price          = PSA 7
//   bgs-10-price       = BGS 10
//   condition-17-price = CGC 10
//   condition-18-price = SGC 10
export type PcGrades = Partial<Record<'PSA10' | 'PSA9' | 'PSA8' | 'PSA7' | 'BGS10' | 'CGC10' | 'SGC10', number>>
const PC_GRADE_KEYS = ['manual-only-price', 'graded-price', 'new-price', 'cib-price', 'bgs-10-price', 'condition-17-price', 'condition-18-price'] as const
const PC_GRADE_NAMES = ['PSA10', 'PSA9', 'PSA8', 'PSA7', 'BGS10', 'CGC10', 'SGC10'] as const

export function pricechartingToken(): string | null {
  return process.env.PRICECHARTING_TOKEN || getSetting('pricechartingToken') || null
}

export function ebayConfig(): { id: string; secret: string } | null {
  const id = process.env.EBAY_CLIENT_ID || getSetting('ebayClientId') || ''
  const secret = process.env.EBAY_CLIENT_SECRET || getSetting('ebayClientSecret') || ''
  return id && secret ? { id, secret } : null
}

export function sourcesConfigured(): { pricecharting: boolean; ebay: boolean } {
  return { pricecharting: Boolean(pricechartingToken()), ebay: Boolean(ebayConfig()) }
}

type CardRef = { id: string; name: string; number: string; set_name: string; ptcgo_code: string | null }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// PriceCharting
// ---------------------------------------------------------------------------

type PcProducts = { status: string; products?: { id: string; 'product-name': string; 'console-name': string }[]; 'error-message'?: string }
type PcProduct = { status: string; 'loose-price'?: number; 'graded-price'?: number; 'product-name'?: string; 'error-message'?: string } & Partial<Record<(typeof PC_GRADE_KEYS)[number], number>>

function pcQuery(card: CardRef): string {
  // PriceCharting titles products with the human set name (e.g. "151", "McDonald's Collection 2017"),
  // so prefer it over the PTCGO code.
  const set = card.set_name || card.ptcgo_code || ''
  return `${card.name} ${set} ${card.number}`.toLowerCase()
}

function scorePcProduct(p: { 'product-name': string; 'console-name': string }, card: CardRef): number {
  const name = p['product-name'].toLowerCase()
  const console_ = p['console-name'].toLowerCase()
  let score = 0
  if (!name.includes(card.name.toLowerCase())) return -1 // hard requirement
  if (/pokemon/.test(console_)) score += 2
  if (name.includes(`#${card.number.toLowerCase()}`)) score += 2
  if (name.includes(card.number.toLowerCase())) score += 1
  if (name.includes((card.ptcgo_code || card.set_name).toLowerCase())) score += 1
  return score
}

export async function fetchPriceCharting(card: CardRef): Promise<{ market: number; low: number | null; high: number | null; grades: PcGrades | null } | null> {
  const t = pricechartingToken()
  if (!t) return null
  await sleep(1100) // PriceCharting hard limit: 1 call/sec
  const search = await fetchJson<PcProducts>(
    `https://www.pricecharting.com/api/products?t=${encodeURIComponent(t)}&q=${encodeURIComponent(pcQuery(card))}`,
  )
  if (search.status !== 'success' || !search.products?.length) return null
  const ranked = search.products
    .map((p) => ({ p, score: scorePcProduct(p, card) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]?.p
  if (!best) return null
  await sleep(1100)
  const product = await fetchJson<PcProduct>(`https://www.pricecharting.com/api/product?t=${encodeURIComponent(t)}&id=${best.id}`)
  if (product.status !== 'success' || product['loose-price'] == null) return null
  const grades: PcGrades = {}
  for (let i = 0; i < PC_GRADE_KEYS.length; i++) {
    const pennies = product[PC_GRADE_KEYS[i]]
    if (typeof pennies === 'number' && pennies > 0) grades[PC_GRADE_NAMES[i]] = Math.round(pennies) / 100
  }
  return { market: product['loose-price'] / 100, low: null, high: null, grades: Object.keys(grades).length ? grades : null }
}

// ---------------------------------------------------------------------------
// eBay Browse API
// ---------------------------------------------------------------------------

type EbayToken = { value: string; expiresAt: number }
let ebayTokenCache: EbayToken | null = null

async function ebayAccessToken(): Promise<string | null> {
  const cfg = ebayConfig()
  if (!cfg) return null
  if (ebayTokenCache && Date.now() < ebayTokenCache.expiresAt) return ebayTokenCache.value
  const basic = Buffer.from(`${cfg.id}:${cfg.secret}`).toString('base64')
  try {
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error(`eBay OAuth HTTP ${res.status}`)
    const data = (await res.json()) as { access_token: string; expires_in: number }
    ebayTokenCache = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 }
    return ebayTokenCache.value
  } catch (e) {
    console.warn('[pricesources] eBay token failed:', e instanceof Error ? e.message : e)
    return null
  }
}

type EbaySearch = { itemSummaries?: { title: string; price?: { value: string } }[] }

// ---------------------------------------------------------------------------
// eBay graded comps — real asking prices for a specific grade
// ---------------------------------------------------------------------------

// Grade → title patterns, ordered most-specific first. A listing must match the
// card name (checked separately) AND one of the grade's patterns.
const GRADE_PATTERNS: Record<string, RegExp[]> = {
  PSA10: [/psa\s*10/, /gem\s*mint/, /psa\s*gem/i],
  PSA9: [/psa\s*9(?![\.\d])/], // 9 but not 9.x / 9.8 etc.
  PSA8: [/psa\s*8(?![\.\d])/],
  PSA7: [/psa\s*7(?![\.\d])/],
  BGS10: [/bgs\s*10/, /black\s*label/i],
  CGC10: [/cgc\s*10/],
  SGC10: [/sgc\s*10/],
}

export async function fetchEbayGraded(card: CardRef, grade: string): Promise<{ market: number; low: number | null; high: number | null; comps: number } | null> {
  const token = await ebayAccessToken()
  if (!token) return null
  const patterns = GRADE_PATTERNS[grade]
  if (!patterns) return null
  const q = `${card.name} ${card.set_name} ${card.number} ${grade.startsWith('PSA') ? 'PSA' : grade.slice(0, 3)}`
  const url =
    `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}` +
    `&limit=40&filter=buyingOptions:{FIXED_PRICE},itemLocationCountry:US`
  let data: EbaySearch
  try {
    data = await fetchJson<EbaySearch>(url, { Authorization: `Bearer ${token}` }, { attempts: 2 })
  } catch {
    return null
  }
  const name = card.name.toLowerCase()
  const prices = (data.itemSummaries ?? [])
    .map((i) => ({ title: i.title.toLowerCase(), price: Number(i.price?.value) }))
    .filter((i) => Number.isFinite(i.price) && i.price > 0 && i.title.includes(name))
    .filter((i) => patterns.some((p) => p.test(i.title)) && !/raw|ungraded/.test(i.title))
    .map((i) => i.price as number)
    .sort((a, b) => a - b)
  if (prices.length < 3) return null // too few graded comps to trust
  // Trim 10% outliers each side before the median so one wild listing doesn't anchor the price.
  const trim = Math.floor(prices.length * 0.1)
  const core = prices.slice(trim, prices.length - trim)
  const mid = Math.floor(core.length / 2)
  const median = core.length % 2 ? core[mid] : (core[mid - 1] + core[mid]) / 2
  return { market: Math.round(median * 100) / 100, low: prices[0], high: prices[prices.length - 1], comps: prices.length }
}

const insertEbayGraded = db.prepare(
  `INSERT INTO price_records (card_id, kind, variant, low, mid, high, market, direct_low, avg1, avg7, avg30, retrieved_at)
   VALUES (?, 'ebay-graded', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
)

export function storeEbayGrades(cardId: string, grade: string, p: { market: number; low: number | null; high: number | null }): boolean {
  if (alreadyStoredToday.get(cardId, 'ebay-graded', grade)) return false
  insertEbayGraded.run(cardId, grade, p.low, p.market, p.high, p.market, nowIso())
  return true
}

/**
 * Ensure a REAL price exists for card+grade: PriceCharting first (their grade
 * columns, if a token is configured), then an eBay graded comp. Returns the
 * kind that satisfied it, or null.
 */
export async function ensureGradedComp(cardId: string, grade: string): Promise<'pc-graded' | 'ebay-graded' | null> {
  const have = db
    .prepare(
      `SELECT kind FROM price_records WHERE card_id = ? AND kind IN ('pc-graded', 'ebay-graded') AND variant = ? AND market IS NOT NULL LIMIT 1`,
    )
    .get(cardId, grade) as { kind: string } | undefined
  if (have) return have.kind as 'pc-graded' | 'ebay-graded'
  const card = db
    .prepare(
      `SELECT c.id, c.name, c.number, s.name AS set_name, s.ptcgo_code
       FROM cards c JOIN sets s ON s.id = c.set_id WHERE c.id = ?`,
    )
    .get(cardId) as CardRef | undefined
  if (!card) return null
  if (pricechartingToken()) {
    try {
      const res = await fetchPriceCharting(card)
      if (res?.grades?.[grade as keyof PcGrades]) {
        storePriceCharting(cardId, res)
        return 'pc-graded'
      }
    } catch { /* fall through to eBay */ }
  }
  if (ebayConfig()) {
    try {
      const comp = await fetchEbayGraded(card, grade)
      if (comp && storeEbayGrades(cardId, grade, comp)) return 'ebay-graded'
    } catch { /* give up for now */ }
  }
  return null
}

export async function fetchEbay(card: CardRef): Promise<{ market: number; low: number | null; high: number | null } | null> {
  const token = await ebayAccessToken()
  if (!token) return null
  const q = `${card.name} ${card.set_name} ${card.number}`
  const url =
    `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}` +
    `&limit=12&filter=buyingOptions:{FIXED_PRICE},itemLocationCountry:US`
  let data: EbaySearch
  try {
    data = await fetchJson<EbaySearch>(url, { Authorization: `Bearer ${token}` }, { attempts: 2 })
  } catch {
    return null
  }
  const items = (data.itemSummaries ?? [])
    .map((i) => ({ title: i.title.toLowerCase(), price: Number(i.price?.value) }))
    .filter((i) => Number.isFinite(i.price) && i.price > 0 && i.title.includes(card.name.toLowerCase()))
  if (items.length < 3) return null // too few comparable listings to trust
  const prices = items.map((i) => i.price as number).sort((a, b) => a - b)
  const mid = Math.floor(prices.length / 2)
  const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2
  return { market: Math.round(median * 100) / 100, low: prices[0], high: prices[prices.length - 1] }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const alreadyStoredToday = db.prepare(
  `SELECT 1 FROM price_records WHERE card_id = ? AND kind = ? AND variant = ? AND retrieved_at >= date('now') LIMIT 1`,
)
const insertPrice = db.prepare(
  `INSERT INTO price_records (card_id, kind, variant, low, mid, high, market, direct_low, avg1, avg7, avg30, retrieved_at)
   VALUES (?, ?, 'normal', ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
)
// Graded price rows: variant holds the grade label (PSA10, BGS10, …) on kind 'pc-graded'.
const insertGraded = db.prepare(
  `INSERT INTO price_records (card_id, kind, variant, low, mid, high, market, direct_low, avg1, avg7, avg30, retrieved_at)
   VALUES (?, 'pc-graded', ?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
)

function storeExternal(cardId: string, kind: ExternalSource, p: { market: number; low: number | null; high: number | null }): boolean {
  if (alreadyStoredToday.get(cardId, kind, 'normal')) return false
  insertPrice.run(cardId, kind, p.low, p.market, p.high, p.market, nowIso())
  return true
}

export function storeGrades(cardId: string, grades: PcGrades): number {
  let n = 0
  for (const [grade, usd] of Object.entries(grades)) {
    if (typeof usd !== 'number' || usd <= 0) continue
    if (alreadyStoredToday.get(cardId, 'pc-graded', grade)) continue
    insertGraded.run(cardId, grade, usd, usd, usd, nowIso())
    n++
  }
  return n
}

/** Store a full PriceCharting result (raw + grades) in one go. */
export function storePriceCharting(cardId: string, p: { market: number; low: number | null; high: number | null; grades: PcGrades | null }): boolean {
  const raw = storeExternal(cardId, 'pricecharting', p)
  const graded = p.grades ? storeGrades(cardId, p.grades) : 0
  return raw || graded > 0
}

/**
 * Ensure graded prices exist for the given cards: PriceCharting grade columns
 * first, then eBay graded comps for any grades PC doesn't cover.
 * Rate: ~1 card/2.2s (PC's 1-call/sec limit × 2 calls/card).
 */
export async function ensureGradedPrices(cardIds: string[]): Promise<{ fetched: number; stored: number }> {
  if (!pricechartingToken() && !ebayConfig()) return { fetched: 0, stored: 0 }
  let fetched = 0
  let stored = 0
  for (const cardId of cardIds) {
    const missing = (['PSA10', 'PSA9', 'PSA8', 'PSA7'] as const).filter(
      (g) => !db.prepare(`SELECT 1 FROM price_records WHERE card_id = ? AND kind = 'pc-graded' AND variant = ? LIMIT 1`).get(cardId, g),
    )
    if (missing.length === 0) continue
    const card = db
      .prepare(
        `SELECT c.id, c.name, c.number, s.name AS set_name, s.ptcgo_code
         FROM cards c JOIN sets s ON s.id = c.set_id WHERE c.id = ?`,
      )
      .get(cardId) as CardRef | undefined
    if (!card) continue
    try {
      const res = await fetchPriceCharting(card)
      fetched++
      if (res) {
        storePriceCharting(card.id, res)
        stored++
      }
    } catch (e) {
      console.warn(`[pricesources] graded fetch ${cardId} failed:`, e instanceof Error ? e.message : e)
    }
  }
  return { fetched, stored }
}

// ---------------------------------------------------------------------------
// Backfill loop — prices cards that have NO market data at all
// ---------------------------------------------------------------------------

type BfProgress = { running: boolean; done: number; total: number; priced: number; lastSource: ExternalSource | null; lastError: string | null; startedAt: string | null }

const bf: BfProgress = { running: false, done: 0, total: 0, priced: 0, lastSource: null, lastError: null, startedAt: null }

export function getBackfillProgress(): BfProgress & { sources: ReturnType<typeof sourcesConfigured> } {
  return { ...bf, sources: sourcesConfigured() }
}

const unpricedCards = db.prepare(
  `SELECT c.id, c.name, c.number, s.name AS set_name, s.ptcgo_code
   FROM cards c JOIN sets s ON s.id = c.set_id
   WHERE c.id NOT IN (SELECT card_id FROM price_records WHERE market IS NOT NULL)
   ORDER BY s.release_date DESC, c.position ASC`,
)

let loopStarted = false

/** Kick off the external-price backfill (no-op while running or when unconfigured). */
export function startPriceBackfill(force = false): { started: boolean; reason?: string } {
  const src = sourcesConfigured()
  if (!src.pricecharting && !src.ebay) return { started: false, reason: 'No price source configured — add a PriceCharting token or eBay credentials in Settings.' }
  if (bf.running) return { started: false, reason: 'Backfill already running.' }
  if (loopStarted && !force) return { started: false, reason: 'Backfill loop already active.' }
  loopStarted = true
  void (async () => {
    await runBackfill()
    startGradedCompPass() // pass 2: fill missing grade prices for owned slabs
  })()
  return { started: true }
}

async function runBackfill() {
  const src = sourcesConfigured()
  const cards = unpricedCards.all() as CardRef[]
  bf.running = true
  bf.total = cards.length
  bf.done = 0
  bf.priced = 0
  bf.lastError = null
  bf.lastSource = null
  bf.startedAt = nowIso()
  setMeta('priceBackfillStartedAt', bf.startedAt)
  console.log(`[pricesources] backfill: ${cards.length} unpriced cards (pricecharting=${src.pricecharting} ebay=${src.ebay})`)
  try {
    for (const card of cards) {
      try {
        let got: { market: number; low: number | null; high: number | null } | null = null
        if (src.pricecharting) {
          got = await fetchPriceCharting(card)
          if (got) bf.lastSource = 'pricecharting'
        }
        if (!got && src.ebay) {
          got = await fetchEbay(card)
          if (got) bf.lastSource = 'ebay'
        }
        if (got && storePriceCharting(card.id, { market: got.market, low: got.low, high: got.high, grades: (got as { grades?: PcGrades | null }).grades ?? null })) {
          bf.priced++
          if (bf.priced % 25 === 0) setMeta('priceBackfillPriced', String(bf.priced))
        }
      } catch (e) {
        bf.lastError = e instanceof Error ? e.message : String(e)
        console.warn(`[pricesources] ${card.id} failed:`, bf.lastError)
      }
      bf.done++
      if (bf.done % 10 === 0) setMeta('priceBackfillDone', String(bf.done))
    }
    logActivity('system', `External price sync finished — ${bf.priced} cards now priced from PriceCharting/eBay.`)
  } finally {
    bf.running = false
    setMeta('priceBackfillFinishedAt', nowIso())
    console.log(`[pricesources] backfill done: ${bf.priced}/${bf.total} priced`)
  }
}

// ---------------------------------------------------------------------------
// Graded-price pass — fill missing grade prices (PriceCharting → eBay comps)
// ---------------------------------------------------------------------------

const gradedCompQueue = db.prepare(
  `SELECT DISTINCT card_id, variant AS grade FROM (
     SELECT c.id AS card_id, g.grade AS variant
     FROM inventory i
     JOIN cards c ON c.id = i.card_id
     JOIN (SELECT 'PSA10' AS grade UNION SELECT 'PSA9' UNION SELECT 'PSA8' UNION SELECT 'PSA7'
                UNION SELECT 'BGS10' UNION SELECT 'CGC10' UNION SELECT 'SGC10') g
     WHERE i.graded_grade IS NOT NULL
   ) WHERE card_id || ':' || variant NOT IN (
     SELECT card_id || ':' || variant FROM price_records WHERE kind IN ('pc-graded', 'ebay-graded') AND market IS NOT NULL
   )
   LIMIT 200`,
)

let gradedPassRunning = false

/** Backfill pass 2: ensure every owned graded card has a real price for each major grade. */
export function startGradedCompPass(): boolean {
  if (gradedPassRunning) return false
  if (!pricechartingToken() && !ebayConfig()) return false
  const queue = gradedCompQueue.all() as { card_id: string; grade: string }[]
  if (queue.length === 0) return false
  gradedPassRunning = true
  console.log(`[pricesources] graded-comp pass: ${queue.length} card/grade pairs to fill`)
  void (async () => {
    try {
      for (const { card_id, grade } of queue) {
        try {
          await ensureGradedComp(card_id, grade)
        } catch { /* keep going */ }
        await sleep(300) // be gentle with the APIs
      }
      console.log('[pricesources] graded-comp pass done')
    } finally {
      gradedPassRunning = false
    }
  })()
  return true
}
