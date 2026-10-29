import { db, getMeta, setMeta, getSetting, nowIso, logActivity } from '../lib/db'
import { fetchJson } from '../lib/http'
import { syncAllTcgcsv } from './tcgcsv'
import { chargePc, chargeEbay, markQuotaExhausted, pcBudget, ebayBudget, generateSimPrices } from './simmarket'

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

export function sourcesConfigured(): { pricecharting: boolean; ebay: boolean; tcgcsv: boolean } {
  // TCGcsv (free TCGplayer mirror) is always available — no key, no quota.
  return { pricecharting: Boolean(pricechartingToken()), ebay: Boolean(ebayConfig()), tcgcsv: true }
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

// Set when PriceCharting rejects our token: it answers HTTP 200 with {"error":"Unknown
// access token"}, so the body must be inspected. Once set, remaining calls short-circuit
// instead of burning one failed request (plus 1.1s) per card.
let pcAuthFailure: string | null = null
export function resetPcAuthFailure(): void {
  pcAuthFailure = null
}
/** Record an auth-shaped PriceCharting error message (shared with the sealed backfill). */
export function markPcAuthFailure(msg: string | undefined): void {
  if (msg && /token|access|auth/i.test(msg)) pcAuthFailure = `PriceCharting rejected the API token (${msg}) — fix it in Settings.`
}
/** True once PriceCharting has rejected our token — callers skip further PC requests. */
export function pcAuthFailed(): boolean {
  return pcAuthFailure !== null
}

// Same treatment for eBay: an OAuth 401 means the saved credentials are bad —
// stop churning the backlog (all 980 cards would otherwise fail one by one).
let ebayAuthFailure: string | null = null
export function resetEbayAuthFailure(): void {
  ebayAuthFailure = null
}
export function ebayAuthFailed(): boolean {
  return ebayAuthFailure !== null
}
function markEbayAuthFailure(status: number): void {
  if (status === 401 || status === 403) {
    ebayAuthFailure = `eBay rejected the API credentials (HTTP ${status}) — check the App ID / Cert ID in Settings.`
    console.warn('[pricesources]', ebayAuthFailure)
  }
}

export async function fetchPriceCharting(card: CardRef): Promise<{ market: number; low: number | null; high: number | null; grades: PcGrades | null } | null> {
  const t = pricechartingToken()
  if (!t) return null
  if (pcAuthFailure) return null // token known-bad — don't re-test it on every card
  if (pcBudget() <= 0) return null // out of quota for today
  await sleep(1100) // PriceCharting hard limit: 1 call/sec
  if (!chargePc()) return null // budget ran dry during the sleep
  const search = await fetchJson<PcProducts>(
    `https://www.pricecharting.com/api/products?t=${encodeURIComponent(t)}&q=${encodeURIComponent(pcQuery(card))}`,
  )
  if (search.status === 'error') {
    markPcAuthFailure(search['error-message'] || 'unknown error')
    return null
  }
  if (!search.products?.length) return null
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
    if (res.status === 401 || res.status === 403) markEbayAuthFailure(res.status)
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
  if (ebayAuthFailure) return null // credentials known-bad — don't re-test per card
  if (ebayBudget() <= 0) return null // out of quota for today
  const token = await ebayAccessToken()
  if (!token) return null
  if (!chargeEbay()) return null // budget ran dry between check and call
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

/** Store an eBay median result under its own kind (NOT mislabeled as PriceCharting). */
function storeEbayExternal(cardId: string, p: { market: number; low: number | null; high: number | null }): boolean {
  return storeExternal(cardId, 'ebay', p)
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
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[pricesources] graded fetch ${cardId} failed:`, msg)
      if (/HTTP 40[13]\b/.test(msg)) markPcAuthFailure('access denied')
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
   WHERE c.id NOT IN (SELECT card_id FROM price_records WHERE market IS NOT NULL AND kind != 'simulated')
   ORDER BY s.release_date DESC, c.position ASC`,
)
// "Unpriced" = no REAL market price yet — simulated placeholder rows don't count.
const unpricedCountStmt = db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE id NOT IN (SELECT card_id FROM price_records WHERE market IS NOT NULL AND kind != 'simulated')`)

export function countUnpriced(): number {
  return (unpricedCountStmt.get() as { n: number }).n
}

let loopStarted = false

/** Kick off the external-price backfill (no-op while running or when unconfigured). */
export function startPriceBackfill(force = false): { started: boolean; reason?: string } {
  const src = sourcesConfigured()
  if (!src.pricecharting && !src.ebay && !src.tcgcsv) {
    return { started: false, reason: 'No price source configured — add a PriceCharting token or eBay credentials in Settings.' }
  }
  if (bf.running) return { started: false, reason: 'Backfill already running.' }
  if (loopStarted && !force) return { started: false, reason: 'Backfill loop already active.' }
  loopStarted = true
  void (async () => {
    await runBackfill(force)
    startGradedCompPass() // pass 2: fill missing grade prices for owned slabs
  })()
  return { started: true }
}

/**
 * Boot-time starter: only runs when a source is configured AND cards are missing
 * prices. A 72h cooldown after each completed run keeps server restarts from
 * re-checking the hundreds of cards PriceCharting's catalog simply doesn't carry.
 */
export function autoStartPriceBackfill(): void {
  const src = sourcesConfigured()
  if (!src.pricecharting && !src.ebay && !src.tcgcsv) return
  if (bf.running) return
  const missing = countUnpriced()
  if (missing === 0) return
  // The 72h miss-cooldown exists so restarts don't re-ask PAYLAODED sources
  // about hundreds of cards they simply don't carry. It must be keyed to the
  // source configuration that produced the miss: adding the free TCGcsv
  // mirror (or new credentials) resets it — a stale cooldown from an older
  // source set must never block a newly-available source.
  const srcKey = JSON.stringify([src.pricecharting, src.ebay])
  const lastMissAt = getMeta('priceBackfillMissAt')
  const lastMissCount = Number(getMeta('priceBackfillMissCount') ?? '0')
  const lastMissKey = getMeta('priceBackfillMissSrcKey')
  const cooldownFresh = lastMissAt && Date.now() - new Date(lastMissAt).getTime() < 72 * 3600_000
  if (lastMissKey === srcKey && cooldownFresh && lastMissCount >= missing) return
  startPriceBackfill()
}

async function runBackfill(force: boolean) {
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
  console.log(`[pricesources] backfill: ${cards.length} unpriced cards (pricecharting=${src.pricecharting} ebay=${src.ebay} tcgcsv=${src.tcgcsv})`)
  try {
    // ---- Pass 0: the FREE mirror first -------------------------------------
    // tcgcsv.com re-publishes TCGplayer's own prices daily with no key and no
    // quota. It's bulk (2 requests per set), so it usually prices most of the
    // 2026 backlog without spending a single budgeted PC/eBay call.
    try {
      const mirror = await syncAllTcgcsv(force)
      if (mirror.ok) console.log(`[pricesources] tcgcsv mirror pass: ${mirror.cardsPriced} cards priced across ${mirror.setsSynced} set(s)`)
      else if (mirror.error && !/cooldown|already running/.test(mirror.error)) console.warn('[pricesources] tcgcsv mirror pass failed:', mirror.error)
    } catch (e) {
      console.warn('[pricesources] tcgcsv mirror pass failed:', e instanceof Error ? e.message : e)
    }
    // Refresh the queue — the mirror may have priced most of it already.
    cards.length = 0
    cards.push(...(unpricedCards.all() as CardRef[]))
    bf.total = cards.length
    bf.done = 0
    bf.priced = 0
    let ebay429Streak = 0
    let netFailures = 0 // consecutive network-level failures (fetchJson throws after its retries)
    for (const card of cards) {
      const pcDead = Boolean(pcAuthFailure) || pcBudget() <= 0
      const ebayDead = Boolean(ebayAuthFailure) || ebayBudget() <= 0
      if ((pcDead || !src.pricecharting) && (ebayDead || !src.ebay)) {
        if (pcAuthFailure) bf.lastError = pcAuthFailure
        else if (ebayAuthFailure) bf.lastError = ebayAuthFailure
        else if (pcDead || ebayDead) bf.lastError = 'All configured price sources are out of daily quota — simulated market prices are served until the quota resets.'
        break // every configured source is dead — stop instead of churning the list
      }
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
        if (got) {
          const stored = (got as { grades?: PcGrades | null }).grades
            ? storePriceCharting(card.id, { market: got.market, low: got.low, high: got.high, grades: (got as { grades?: PcGrades | null }).grades ?? null })
            : storeEbayExternal(card.id, got)
          if (stored) {
            bf.priced++
            if (bf.priced % 25 === 0) setMeta('priceBackfillPriced', String(bf.priced))
          }
        }
        netFailures = 0 // this card completed without a network-level failure
        bf.lastError = null // recovered — clear any earlier transient failure
      } catch (e) {
        bf.lastError = e instanceof Error ? e.message : String(e)
        console.warn(`[pricesources] ${card.id} failed:`, bf.lastError)
        const isEbayErr = /api\.ebay\.com/.test(bf.lastError)
        const isPcErr = /pricecharting\.com/.test(bf.lastError)
        if (/HTTP 40[13]\b/.test(bf.lastError)) {
          if (isEbayErr) markEbayAuthFailure(Number(/HTTP (40[13])/.exec(bf.lastError)?.[1] ?? 401))
          else markPcAuthFailure('access denied') // PC rejects bad tokens at the HTTP level too
        }
        if (/HTTP 429\b/.test(bf.lastError)) {
          // fetchJson already retried 429s 5× with backoff before surfacing it —
          // the source is truly rate-limited for now.
          if (isEbayErr) {
            if (++ebay429Streak >= 3) markQuotaExhausted('ebay')
          } else if (isPcErr) {
            markQuotaExhausted('pc')
          }
        }
        if (++netFailures >= 5) {
          bf.lastError = `Stopped after ${netFailures} consecutive failures — ${bf.lastError}`
          break // network is down; don't churn through the rest of the list
        }
      }
      bf.done++
      if (bf.done % 10 === 0) setMeta('priceBackfillDone', String(bf.done))
    }
    logActivity(
      'system',
      bf.lastError
        ? `External price sync stopped early — ${bf.priced} cards priced, ${bf.total - bf.done} not checked (${bf.lastError})`
        : `External price sync finished — ${bf.priced} cards now priced from PriceCharting/eBay.`,
    )
  } finally {
    bf.running = false
    loopStarted = false // allow future manual/boot runs once this one completes
    setMeta('priceBackfillFinishedAt', nowIso())
    // Miss-cooldown bookkeeping — only for runs that completed without an abort,
    // so auth/network failures retry on the next boot instead of waiting 72h.
    if (!bf.lastError) {
      setMeta('priceBackfillMissAt', nowIso())
      setMeta('priceBackfillMissCount', String(countUnpriced()))
      const s = sourcesConfigured()
      setMeta('priceBackfillMissSrcKey', JSON.stringify([s.pricecharting, s.ebay]))
    }
    // Quotas out (or sources not configured)? Fill the gap with clearly-labeled
    // SIM · MARKET prices so the market never goes blank. Real rows outrank
    // these automatically the moment real data lands.
    try {
      generateSimPrices()
    } catch (e) {
      console.warn('[pricesources] sim generation failed:', e instanceof Error ? e.message : e)
    }
    console.log(`[pricesources] backfill done: ${bf.priced}/${bf.total} priced${bf.lastError ? ` — ${bf.lastError}` : ''}`)
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
