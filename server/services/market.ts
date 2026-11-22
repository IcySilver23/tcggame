import { db, nowIso, getMeta, setMeta, logActivity } from '../lib/db'
import { gameDayKey } from '../lib/gameday'
import { estimatePrice } from './estimates'
import { generateSimPrices, quotaState } from './simmarket'
import { factor as regimeFactor } from './regimes'
import { eraSupply } from './demographics'
import { copyMultiplier, revealWithRead, marketFactor } from './substats'
import { slabPremium } from './psarush'
import { BALL_VALUE_MULT, isEnergyReverseVariant, specialBallFor } from './special-reverse'

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
  reverseHolofoilPokeBall: 'Poké Ball Reverse Holofoil',
  reverseHolofoilMasterBall: 'Master Ball Reverse Holofoil',
  reverseHolofoilLoveBall: 'Love Ball Reverse Holofoil',
  reverseHolofoilFriendBall: 'Friend Ball Reverse Holofoil',
  reverseHolofoilQuickBall: 'Quick Ball Reverse Holofoil',
  reverseHolofoilDuskBall: 'Dusk Ball Reverse Holofoil',
  reverseHolofoilTeamRocket: 'Team Rocket Reverse Holofoil',
  reverseHolofoilEnergy: 'Energy Reverse Holofoil',
  sequinHolofoil: 'Sequin Holofoil',
  '1stEditionNormal': '1st Edition (Normal)',
  '1stEditionHolofoil': '1st Edition (Holo)',
}

// Cardmarket trend prices arrive in EUR (pokemontcg.io relays cardmarket.com's
// European market data). Convert to the game's USD economy. Tunable in Settings
// (stored in meta, validated on save); clamps keep a typo from corrupting prices.
const EUR_USD_KEY = 'eurUsdRate'
const EUR_USD_DEFAULT = 1.17
export function eurUsdRate(): number {
  const v = Number(getMeta(EUR_USD_KEY) ?? '')
  return Number.isFinite(v) && v >= 0.5 && v <= 3 ? v : EUR_USD_DEFAULT
}
export function setEurUsdRate(v: number): boolean {
  if (!(Number.isFinite(v) && v >= 0.5 && v <= 3)) return false
  setMeta(EUR_USD_KEY, String(Math.round(v * 1000) / 1000))
  return true
}

// ---------------------------------------------------------------------------
// Price resolution
// ---------------------------------------------------------------------------

export type ResolvedPrice = {
  usd: number | null
  source: 'live' | 'last' | 'estimated' | 'model' | 'simulated'
  retrievedAt: string | null
  kind: string | null // 'tcgplayer' | 'cardmarket' | 'pricecharting' | 'ebay' | 'simulated' | 'model' | 'estimated'
  variant: string
  low: number | null
  high: number | null
}

/**
 * Resolve a USD value for a card variant. Anchored on the REAL TCGplayer
 * `market` price for the requested variant (or holofoil/normal fallbacks for
 * older sets). Every other tier is a transparent multiplier, labeled estimated.
 *
 * A ball reverse prices from the same card's ordinary reverse row and then a
 * LABELLED premium (1.5x Poké Ball, 8x Master Ball). The anchor is real; the
 * premium is this build's flat model, so the result is reported as estimated.
 *
 * An Energy-pattern reverse has no researched premium here, so it prices at the
 * same card's ordinary reverse anchor and keeps its own variant token.
 */
type TcgPriceRecord = {
  card_id: string
  variant: string
  low: number | null
  high: number | null
  market: number | null
  retrieved_at: string
}

// The light inventory route asks for every collection row at once. Without
// this, resolveBasePrice runs one price_records query per row; with it, one
// query loads the whole batch and each row resolves against the in-memory rows.
// Only the TCGplayer tier is batched — a row that falls through to the other
// sources keeps the existing per-card fallback path below.
let tcgPriceCache: Map<string, TcgPriceRecord[]> | null = null

function pickTcgPrice(rows: TcgPriceRecord[], variant: string): TcgPriceRecord | undefined {
  return (
    rows.find((r) => r.variant === variant && r.market != null) ??
    rows.find((r) => r.variant === 'holofoil' && r.market != null) ??
    rows.find((r) => r.variant === 'normal' && r.market != null) ??
    rows.find((r) => r.market != null)
  )
}

function tcgBasePrice(
  cardId: string,
  pick: TcgPriceRecord & { market: number },
  condition: Condition,
  variant: string,
): ResolvedPrice {
  const mult = CONDITION_MULT[condition] ?? 1
  const isAnchor = condition === 'NM'
  const regime = regimeFactor(cardId)
  return {
    usd: round2(pick.market * mult * regime),
    source: isAnchor ? 'live' : 'estimated',
    retrievedAt: pick.retrieved_at,
    kind: 'tcgplayer',
    variant: pick.variant,
    low: pick.low != null ? round2(pick.low * mult * regime) : null,
    high: pick.high != null ? round2(pick.high * mult * regime) : null,
  }
}

function loadTcgPriceRecords(cardIds: string[]): Map<string, TcgPriceRecord[]> {
  const out = new Map<string, TcgPriceRecord[]>()
  const ids = [...new Set(cardIds)]
  // Stay below SQLite's default variable limit while keeping one query per
  // up-to-800 cards rather than one per card.
  for (let i = 0; i < ids.length; i += 800) {
    const chunk = ids.slice(i, i + 800)
    const rows = db
      .prepare(
        `SELECT card_id, variant, low, high, market, retrieved_at
         FROM price_records
         WHERE kind = 'tcgplayer' AND card_id IN (${chunk.map(() => '?').join(',')})
         ORDER BY card_id, retrieved_at DESC`,
      )
      .all(...chunk) as TcgPriceRecord[]
    for (const row of rows) {
      const list = out.get(row.card_id)
      if (list) list.push(row)
      else out.set(row.card_id, [row])
    }
  }
  return out
}

export function resolvePrice(cardId: string, variant = 'normal', condition: Condition = 'NM'): ResolvedPrice {
  const ball = specialBallFor(variant)
  const energy = isEnergyReverseVariant(variant)
  // A General Mills Sequin copy is its own printing but has no price row of its own, and no
  // source read here measures a premium for it, so it anchors on the same card's ordinary
  // price — exactly the policy the Energy-pattern reverse follows — and keeps its token so
  // the copy stays identifiable.
  const sequin = /sequin/i.test(variant)
  const base = resolveBasePrice(cardId, ball || energy ? 'reverseHolofoil' : variant, condition)
  if (energy || sequin) return { ...base, variant }
  if (!ball) return base
  const mult = BALL_VALUE_MULT[ball]
  return {
    ...base,
    usd: base.usd != null ? round2(base.usd * mult) : null,
    low: base.low != null ? round2(base.low * mult) : null,
    high: base.high != null ? round2(base.high * mult) : null,
    source: 'estimated',
    kind: 'model',
    variant,
  }
}

function resolveBasePrice(cardId: string, variant: string, condition: Condition): ResolvedPrice {
  const cached = tcgPriceCache?.get(cardId)
  const cachedPick = cached ? pickTcgPrice(cached, variant) : undefined
  if (cachedPick && cachedPick.market != null) {
    return tcgBasePrice(cardId, cachedPick as TcgPriceRecord & { market: number }, condition, variant)
  }

  const rows = db
    .prepare(
      `SELECT card_id, kind, variant, low, mid, high, market, retrieved_at
       FROM price_records WHERE card_id = ? AND kind = 'tcgplayer' ORDER BY retrieved_at DESC`,
    )
    .all(cardId) as { card_id: string; kind: string; variant: string; low: number | null; mid: number | null; high: number | null; market: number | null; retrieved_at: string }[]

  const pick = pickTcgPrice(rows, variant)

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
        usd: round2(ext.market * mult * regimeFactor(cardId)),
        source: 'live',
        retrievedAt: ext.retrieved_at,
        kind: ext.kind,
        variant,
        low: ext.low != null ? round2(ext.low * mult * regimeFactor(cardId)) : null,
        high: ext.high != null ? round2(ext.high * mult * regimeFactor(cardId)) : null,
      }
    }
    // Still nothing from the US-centric sources: real Cardmarket trend data
    // (European market, synced with every card refresh), converted to USD.
    // A genuine market price — outranks the simulated market and model estimates.
    const cm = db
      .prepare(
        `SELECT market, retrieved_at FROM price_records
         WHERE card_id = ? AND kind = 'cardmarket' AND market IS NOT NULL
         ORDER BY retrieved_at DESC LIMIT 1`,
      )
      .get(cardId) as { market: number; retrieved_at: string } | undefined
    if (cm) {
      const mult = CONDITION_MULT[condition] ?? 1
      return {
        usd: round2(cm.market * eurUsdRate() * mult * regimeFactor(cardId)),
        source: 'live',
        retrievedAt: cm.retrieved_at,
        kind: 'cardmarket',
        variant,
        low: null,
        high: null,
      }
    }
    // No real marketplace data available right now (external quotas exhausted
    // or not yet synced): serve the SIMULATED MARKET price — a plausible,
    // clearly-labeled value generated from the card's last real anchor. It is
    // outranked automatically the moment any real price row lands.
    const sim = db
      .prepare(
        `SELECT market, low, high, retrieved_at FROM price_records
         WHERE card_id = ? AND kind = 'simulated' AND market IS NOT NULL
         ORDER BY retrieved_at DESC LIMIT 1`,
      )
      .get(cardId) as { market: number; low: number | null; high: number | null; retrieved_at: string } | undefined
    if (sim) {
      const mult = CONDITION_MULT[condition] ?? 1
      return {
        usd: round2(sim.market * mult * regimeFactor(cardId)),
        source: 'simulated',
        retrievedAt: sim.retrieved_at,
        kind: 'simulated',
        variant,
        low: sim.low != null ? round2(sim.low * mult * regimeFactor(cardId)) : null,
        high: sim.high != null ? round2(sim.high * mult * regimeFactor(cardId)) : null,
      }
    }
    // Nothing real anywhere: comparable-based model estimate, clearly labeled
    // kind 'model' (EST · MODEL in the UI) — never presented as live data.
    const est = estimatePrice(cardId)
    if (est != null) {
      const mult = CONDITION_MULT[condition] ?? 1
      return { usd: round2(est * mult * regimeFactor(cardId)), source: 'model', retrievedAt: null, kind: 'model', variant, low: null, high: null }
    }
    return { usd: null, source: 'estimated', retrievedAt: null, kind: 'estimated', variant, low: null, high: null }
  }

  // Market regimes: real data stays real underneath — the economy breathes
  // around it via the bull/bear drift, the card's stable wobble, and any
  // live reprint shock (see regimes.ts).
  return tcgBasePrice(cardId, pick as TcgPriceRecord & { market: number }, condition, variant)
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * CONDITION WARS — resolve the value of ONE COPY whose condition sub-grade is
 * public. `known` = the copy has been inspected and its read published (listed,
 * stocked, offered): buyers then pay the copy's drift (±8% around the band),
 * because two "NM" copies of the same card are not the same card and comps
 * don't apply to a copy everyone has seen under the light. Unseen copies price
 * exactly at the band — the information IS the value.
 */
export function resolvePriceCopy(
  cardId: string,
  variant = 'normal',
  condition: Condition = 'NM',
  inventoryId: number,
  known: boolean,
  /** An already-resolved band for this card, so a caller that has one does not
   *  look the same price up twice. */
  base?: ResolvedPrice,
): ResolvedPrice & { copyKnown: boolean; copyFactor: number } {
  const resolved = base ?? resolvePrice(cardId, variant, condition)
  const f = known ? copyMultiplier(inventoryId) : 1
  return {
    ...resolved,
    usd: resolved.usd != null ? round2(resolved.usd * f) : null,
    low: resolved.low != null ? round2(resolved.low * f) : null,
    high: resolved.high != null ? round2(resolved.high * f) : null,
    copyKnown: known,
    copyFactor: f,
  }
}

/** Best-effort USD value used for inventory math. 0 when no data exists yet. */
// A shop request asks for the same card+variant from the pack EV model, the
// sealed EV model and the shelf price. Memoizing valueOf for the duration of
// one request removes those duplicate lookups without freezing prices across
// requests or market ticks.
let priceMemo: Map<string, number> | null = null

export function withPriceMemo<T>(fn: () => T): T {
  const previous = priceMemo
  priceMemo = new Map()
  try {
    return fn()
  } finally {
    priceMemo = previous
  }
}

export function valueOf(cardId: string, variant = 'normal', condition: Condition = 'NM'): number {
  const key = `${cardId}|${variant}|${condition}`
  const hit = priceMemo?.get(key)
  if (hit !== undefined) return hit
  const value = resolvePrice(cardId, variant, condition).usd ?? 0
  priceMemo?.set(key, value)
  return value
}

// ---------------------------------------------------------------------------
// Graded prices (real PriceCharting PSA/BGS/CGC/SGC data)
// ---------------------------------------------------------------------------

export type ValueBasis = 'sold' | 'asking' | 'estimated'

export type GradedQuote = { grade: string; usd: number; retrievedAt: string; source: 'pc-graded' | 'ebay-graded'; basis: ValueBasis }

/** How a quote was established. PriceCharting's BGS 10 Black column can be an
 * estimate even without a Black Label sale, and eBay Browse returns active
 * listings rather than completed sales. */
function basisFor(kind: string, grade: string): ValueBasis {
  if (kind === 'ebay-graded') return 'asking'
  if (grade === 'BGS10BL') return 'estimated'
  return 'sold'
}

const GRADE_ORDER = ['PSA10', 'BGS10BL', 'BGS10', 'CGC10P', 'CGC10', 'SGC10', 'PSA9', 'BGS9', 'CGC9', 'SGC9', 'PSA8', 'BGS8', 'PSA7']

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
  const best = new Map<string, GradedQuote>()
  for (const r of rows) {
    const q = {
      grade: r.variant,
      usd: r.market,
      retrievedAt: r.retrieved_at,
      source: r.kind as 'pc-graded' | 'ebay-graded',
      basis: basisFor(r.kind, r.variant),
    }
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

/** Value of a graded card: real PriceCharting grade price, then real eBay graded comp, else a raw-value multiplier (labeled estimated). Slabs ride the same regime weather. */
// Grading advice asks for the same card+grade several times per row (each
// service prices the same grade ladder). A short cache collapses that burst
// without freezing prices for long; regime and rush premiums still apply when
// the entry is rebuilt.
const GRADED_CACHE_MS = 10_000
const gradedCache = new Map<string, { at: number; value: { usd: number; source: 'live' | 'estimated'; kind: 'pc-graded' | 'ebay-graded' | null; basis: ValueBasis } }>()

export function gradedPriceOf(cardId: string, grade: string | null): { usd: number; source: 'live' | 'estimated'; kind: 'pc-graded' | 'ebay-graded' | null; basis: ValueBasis } {
  const key = `${cardId}|${grade ?? ''}`
  const hit = gradedCache.get(key)
  if (hit && Date.now() - hit.at < GRADED_CACHE_MS) return hit.value
  const value = computeGradedPriceOf(cardId, grade)
  if (gradedCache.size > 4000) gradedCache.clear()
  gradedCache.set(key, { at: Date.now(), value })
  return value
}

function computeGradedPriceOf(cardId: string, grade: string | null): { usd: number; source: 'live' | 'estimated'; kind: 'pc-graded' | 'ebay-graded' | null; basis: ValueBasis } {
  // Slabs ride the PSA rush: fresh slabs command a premium while the scene
  // competes for grades (full premium during the rush, a fading one through
  // the backlog hangover). A static import is safe here: psarush only calls
  // back into market inside its own functions, never at module load.
  const rushMult = slabPremium()
  // Black Label is a BGS 10 with four perfect subgrades. PriceCharting carries
  // a BGS 10 Black column, but it can be an estimate with no Black Label sale,
  // so that row is never labelled sold. An exact-title eBay comp is an asking
  // price. Only when neither exists do we fall back to the BGS 10 quote × 1.6.
  if (grade === 'BGS10BL') {
    const live = db
      .prepare(
        `SELECT kind, market FROM price_records
         WHERE card_id = ? AND kind IN ('pc-graded', 'ebay-graded') AND variant = 'BGS10BL' AND market IS NOT NULL
         ORDER BY CASE kind WHEN 'pc-graded' THEN 0 ELSE 1 END, retrieved_at DESC
         LIMIT 1`,
      )
      .get(cardId) as { kind: 'pc-graded' | 'ebay-graded'; market: number } | undefined
    if (live) {
      return {
        usd: round2(live.market * regimeFactor(cardId) * rushMult),
        source: 'live',
        kind: live.kind,
        basis: basisFor(live.kind, 'BGS10BL'),
      }
    }
    const base = computeGradedPriceOf(cardId, 'BGS10')
    return { usd: round2(base.usd * 1.6), source: 'estimated', kind: null, basis: 'estimated' }
  }
  // CGC Pristine 10 is a separate label and market from an ordinary CGC 10.
  // PriceCharting has no Pristine column, so an exact eBay comp wins when one
  // exists; otherwise model it as a disclosed premium over the CGC 10 quote.
  if (grade === 'CGC10P') {
    const live = db
      .prepare(
        `SELECT kind, market FROM price_records
         WHERE card_id = ? AND kind IN ('pc-graded', 'ebay-graded') AND variant = 'CGC10P' AND market IS NOT NULL
         ORDER BY CASE kind WHEN 'pc-graded' THEN 0 ELSE 1 END, retrieved_at DESC
         LIMIT 1`,
      )
      .get(cardId) as { kind: 'pc-graded' | 'ebay-graded'; market: number } | undefined
    if (live) {
      return {
        usd: round2(live.market * regimeFactor(cardId) * rushMult),
        source: 'live',
        kind: live.kind,
        basis: basisFor(live.kind, 'CGC10P'),
      }
    }
    const base = computeGradedPriceOf(cardId, 'CGC10')
    return { usd: round2(base.usd * 1.45), source: 'estimated', kind: null, basis: 'estimated' }
  }
  const row = db
    .prepare(
      `SELECT kind, market, retrieved_at FROM price_records
       WHERE card_id = ? AND kind IN ('pc-graded', 'ebay-graded') AND variant = ? AND market IS NOT NULL
       ORDER BY CASE kind WHEN 'pc-graded' THEN 0 ELSE 1 END, retrieved_at DESC
       LIMIT 1`,
    )
    .get(cardId, grade ?? '') as { kind: 'pc-graded' | 'ebay-graded'; market: number; retrieved_at: string } | undefined
  if (row) {
    return {
      usd: round2(row.market * regimeFactor(cardId) * rushMult),
      source: 'live',
      kind: row.kind,
      basis: basisFor(row.kind, grade ?? ''),
    }
  }
  // No real grade data anywhere: transparent multiplier of the raw value (PSA10 3.5×, PSA9 1.6×, PSA8 1.15×, PSA7 0.8×)
  const mult: Record<string, number> = { PSA10: 3.5, BGS10BL: 6.4, BGS10: 4, CGC10P: 4.35, CGC10: 3, SGC10: 2.5, PSA9: 1.6, BGS9: 1.45, CGC9: 1.4, SGC9: 1.35, PSA8: 1.15, BGS8: 1.05, PSA7: 0.8 }
  return { usd: round2(valueOf(cardId) * (mult[grade ?? ''] ?? 1) * rushMult), source: 'estimated', kind: null, basis: 'estimated' }
}

/** The counterfeit risk band: fakes only target cardboard worth faking, so the
 * market's uncertainty discount attaches here (auth.ts owns the desk). */
export const AUTH_THRESHOLD = 75
// Extra unvetted-haircut while a scam-accusation conviction is hot (auth.ts
// sets auth:suspicionUntil; both sides mirror this constant).
export const SUSPICION_PCT = 10

/** Resolve value for one inventory row — graded rows use their grade's real price.
 * AUTH META: rows that select the auth columns get the fake/uncertainty treatment —
 * a revealed counterfeit is worth the flat $1 the buylist wall pays, and
 * UNVETTED RAWS IN THE RISK BAND price at the auth haircut wherever a sale is
 * being priced (nobody counterfeits a $2 card, so nothing below the band is
 * discounted). Rows that don't select the columns price clean, so read-model
 * queries never leak (or trip) hidden state. */
export function valueOfRow(r: { card_id: string; variant: string; condition: string; graded_grade: string | null; fake_revealed?: number; is_fake?: number; auth_status?: string | null }, /** already-resolved raw band, when the caller has one */ rawValue?: number): number {
  if (r.fake_revealed || r.is_fake) return 1 // detected counterfeit (either flag: local corner-test or USPA verdict): the training wall pays a flat dollar
  if (r.graded_grade) return gradedPriceOf(r.card_id, r.graded_grade).usd
  const raw = rawValue ?? valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
  if (r.auth_status === undefined || r.auth_status === 'authenticated') return raw
  if (raw < AUTH_THRESHOLD) return raw
  // The street's suspicion after a scam-accusation conviction (auth.ts owns the
  // conviction window; this side mirrors it without an import cycle).
  const until = getMeta('auth:suspicionUntil')
  const suspicion = until && new Date(until).getTime() > Date.now() ? SUSPICION_PCT / 100 : 0
  return round2(raw * (1 - Number(getMeta('authDiscountPct') ?? 5) / 100 - suspicion))
}

export type InventoryValueRow = {
  card_id: string
  variant: string
  condition: string
  graded_grade: string | null
  fake_revealed?: number
  is_fake?: number
  auth_status?: string | null
}

/**
 * Value a whole picker batch with one price_records query. The per-row rules
 * stay in valueOfRow; the batch only primes the TCGplayer rows that
 * resolveBasePrice would otherwise fetch one card at a time.
 */
export function withTcgPriceCache<T>(cardIds: string[], fn: () => T): T {
  const previous = tcgPriceCache
  tcgPriceCache = loadTcgPriceRecords(cardIds)
  try {
    return fn()
  } finally {
    tcgPriceCache = previous
  }
}

export function valuesOfRows(rows: InventoryValueRow[]): number[] {
  return withTcgPriceCache(rows.map((r) => r.card_id), () => rows.map((r) => valueOfRow(r)))
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
  if (rows?.market) return round2(rows.market * regimeFactor(cardId))
  const base = resolvePrice(cardId, holo ? 'holofoil' : 'normal').usd ?? 0
  if (base <= 0) return 0
  return round2(base * (holo ? FIRST_ED_HOLO_MULT : FIRST_ED_MULT))
}

// ---------------------------------------------------------------------------
// Price history (snapshots we take over time)
// ---------------------------------------------------------------------------

export function priceHistory(cardId: string, variant = 'normal') {
  // Ball and Energy variants have no price rows of their own; their chart is the
  // same card's ordinary reverse history the premium (or anchor) is applied to.
  const lookup = specialBallFor(variant) || isEnergyReverseVariant(variant) ? 'reverseHolofoil' : variant
  return db
    .prepare(
      `SELECT market, retrieved_at FROM price_records
       WHERE card_id = ? AND variant = ? AND market IS NOT NULL AND kind != 'simulated'
       ORDER BY retrieved_at ASC`,
    )
    .all(cardId, lookup) as { market: number; retrieved_at: string }[]
}

// Snapshot retention: the price-history chart is only ever viewed for cards the
// player holds or is tracking, so those keep a deep window. Everyone else just
// needs its newest price for valuation — keeping a daily snapshot for all ~20k
// catalog cards grows price_records by ~53k rows/day, which bloats the save past
// 3M rows and makes the boot-time "unpriced" scans block the event loop for tens
// of seconds (the game appears not to launch). Capping history here keeps the
// table at ~50-150k rows no matter how many days run.
const SNAPSHOT_HISTORY_LIMIT = 90

export function takeSnapshot() {
  const at = nowIso()
  const info = db
    .prepare(
      `INSERT INTO price_records (card_id, kind, variant, low, mid, high, market, direct_low, retrieved_at)
       SELECT card_id, kind, variant, low, mid, high, market, direct_low, ?
       FROM price_records
       WHERE retrieved_at = (SELECT MAX(retrieved_at) FROM price_records p2 WHERE p2.card_id = price_records.card_id AND p2.kind = price_records.kind AND p2.variant = price_records.variant)
         AND EXISTS (SELECT 1 FROM cards c WHERE c.id = price_records.card_id)`,
    )
    .run(at)
  // Trim history back down so snapshots stay bounded. Owned + wishlisted cards
  // keep SNAPSHOT_HISTORY_LIMIT points (portfolio chart); every other card keeps
  // only its newest price. Mirrors server/scripts/repair-price-records.ts.
  db.prepare(
    `DELETE FROM price_records
     WHERE id NOT IN (
       SELECT id FROM (
         SELECT id, card_id,
                ROW_NUMBER() OVER (
                  PARTITION BY card_id, kind, variant
                  ORDER BY retrieved_at DESC, id DESC
                ) AS rn
         FROM price_records
       ) ranked
       WHERE ranked.rn <= CASE
         WHEN ranked.card_id IN (
           SELECT DISTINCT card_id FROM inventory WHERE status != 'sold'
           UNION
           SELECT DISTINCT card_id FROM wishlist
         ) THEN ?
         ELSE 1
       END
     )`,
  ).run(SNAPSHOT_HISTORY_LIMIT)
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
       SELECT c.id, c.name, l.variant, l.market, l.low, l.high, substr(s.release_date, 1, 4) AS yr
       FROM latest l JOIN cards c ON c.id = l.card_id JOIN sets s ON s.id = c.set_id
       WHERE rn = 1 ORDER BY RANDOM() LIMIT ?`,
    )
    .all(Math.max(count * 2, 40)) as { id: string; name: string; variant: string; market: number; low: number | null; high: number | null; yr: string | null }[]

  if (candidates.length === 0) return 0
  // Population & meta drift: vintage collectors age into hold-forever — the
  // hotter vintage runs, the less of it anybody lists (demographics.eraSupply).
  // The feed never starves: if drying leaves too little, fall back to the
  // full pool (the shift shows up as composition, not as an empty market).
  let pool = candidates.filter((c) => Math.random() < eraSupply(c.yr ? Number(c.yr) : null))
  if (pool.length < Math.min(20, count)) pool = candidates
  if (pool.length === 0) return 0
  const insert = db.prepare(
    `INSERT OR REPLACE INTO listings (id, card_id, variant, condition, price, shipping, seller_name, seller_rating, seller_sales, eta_days, listed_at, expires_at, deal_score, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'npc')`,
  )
  const tx = db.transaction(() => {
    for (let i = 0; i < count && pool.length > 0; i++) {
      const c = pick(pool)
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

/**
 * Liquidity penalty — expensive cardboard has fewer buyers. Expected sell time
 * for market listings scales with the card's value: junk flips in minutes, a
 * $100 card takes ~2×, a $1k grail ~5×, four-figure cards approach the ×10 cap.
 * Vendor tables deliberately waive this (shows concentrate collectors) — that's
 * their niche in the economy.
 */
export function liquidityFactor(value: number): number {
  if (value <= 0) return 1
  return Math.min(10, Math.max(1, Math.pow(value / 10, 0.35)))
}

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
    if ((row.quantity ?? 1) !== 1) {
      // Graded slabs are one card — a multi-copy row here is stale data from an
      // old save; re-home it instead of leaving it stuck listed forever.
      db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL WHERE id = ?`).run(row.id)
      continue
    }
    const anchor = gradedPriceOf(row.card_id, row.graded_grade).usd
    const ratio = anchor > 0 ? row.listing_price / anchor : 1
    // Slabs inherit the liquidity penalty at their graded value — PSA 10s of
    // expensive cards trade like the grails they are.
    const expectedMs = Math.max(15_000, 60_000 * ratio * ratio * liquidityFactor(anchor))
    const hazard = ((Date.now() - new Date(row.listed_at).getTime()) / expectedMs) * 0.35
    if (Math.random() < Math.min(0.9, hazard)) {
      const fee = round2(row.listing_price * 0.1)
      const proceeds = round2(row.listing_price - fee)
      const cost = round2(row.cost_basis * row.quantity)
      const profit = round2(proceeds - cost)
      total += proceeds
      sellRow.run(row.id)
      cleanupSlotsForInventory([row.id])
      const buyer = pick(FIRST_NAMES)
      insertSale.run(row.id, row.card_id, row.variant, row.condition, row.quantity, proceeds, cost, fee, profit, buyer, nowIso())
      const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(row.card_id) as { name: string } | undefined)?.name ?? row.card_id
      logActivity('sale', `${name} (${row.graded_grade}) sold for $${proceeds.toFixed(2)} after 10% fee`, proceeds)
      // A listed card leaving the binder is what the player has been waiting
      // on — badge it, so it is not just another line scrolling past in the feed.
      void import('./notify')
        .then((n) => n.push(
          'sale',
          `💵 ${name} (${row.graded_grade}) sold`,
          `${buyer} paid $${(row.listing_price ?? 0).toFixed(2)} — $${proceeds.toFixed(2)} to you after the 10% fee, ${profit >= 0 ? '+' : '−'}$${Math.abs(profit).toFixed(2)} against your $${cost.toFixed(2)} basis.`,
          '#/inventory',
          `sale:inv:${row.id}`,
        ))
        .catch(() => {})
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
    // CONDITION WARS: a single-copy raw listing publishes its sub-grade read —
    // buyers now price THIS copy, not the band. Stacks stay band-priced.
    const single = (row.quantity ?? 1) === 1
    if (single) revealWithRead(row.id)
    const market = valueOf(row.card_id, row.variant, 'NM') * (single ? marketFactor(row.id) : 1)
    // The ask is PER UNIT (the listing UI prices stacks at per-unit × count);
    // the NM ratio sets sell speed per card, the sale pays ask × quantity.
    const unitAsk = row.listing_price / Math.max(1, row.quantity)
    const ratio = market > 0 ? unitAsk / market : 1
    // Pacing: 1 game-tick = 45s. A market-priced listing typically sells within a
    // few minutes of active play; undercutting sells faster, overpricing drags.
    // Liquidity: expensive cards have fewer buyers — a four-figure card takes a
    // session or three to move at ask. (Conventions waive this — see vendor.ts.)
    const expectedMs = Math.max(15_000, 60_000 * ratio * ratio * liquidityFactor(market))
    const hazard = (listedMs / expectedMs) * 0.35
    if (Math.random() < Math.min(0.9, hazard)) {
      const gross = round2(row.listing_price * row.quantity)
      const fee = round2(gross * 0.1)
      const proceeds = round2(gross - fee)
      const cost = round2(row.cost_basis * row.quantity)
      const profit = round2(proceeds - cost)
      total += proceeds
      sellRow.run(row.id)
      cleanupSlotsForInventory([row.id])
      const buyer = pick(FIRST_NAMES)
      insertSale.run(row.id, row.card_id, row.variant, row.condition, row.quantity, proceeds, cost, fee, profit, buyer, nowIso())
      const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(row.card_id) as { name: string } | undefined)?.name ?? row.card_id
      logActivity('sale', `${row.quantity > 1 ? `${row.quantity}× ` : ''}${name} sold for $${proceeds.toFixed(2)} (after 10% fee)`, proceeds)
      // A listed card leaving the binder is what the player has been waiting
      // on — badge it, so it is not just another line scrolling past in the feed.
      void import('./notify')
        .then((n) => n.push(
          'sale',
          `💵 ${row.quantity > 1 ? `${row.quantity}× ` : ''}${name} sold`,
          `${buyer} paid $${gross.toFixed(2)} — $${proceeds.toFixed(2)} to you after the 10% fee, ${profit >= 0 ? '+' : '−'}$${Math.abs(profit).toFixed(2)} against your $${cost.toFixed(2)} basis.`,
          '#/inventory',
          `sale:inv:${row.id}`,
        ))
        .catch(() => {})
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

/**
 * Keep the simulated market in sync with reality: whenever real price data
 * changed since the last sim pass, (re)generate 'simulated' rows for every
 * card that still has NO real price. Called from the boot sequence and the
 * daily tick — real rows always outrank simulated ones in resolvePrice, so
 * this can never mask real data.
 */
export function refreshSimulatedMarket(): { cards: number; quota: ReturnType<typeof quotaState> } {
  const cards = generateSimPrices()
  return { cards, quota: quotaState() }
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
  // Parcels whose game-day ETA has closed land in the vault.
  import('./deliveries').then((d) => d.deliverDue()).catch(() => {})
  // NPC trading — lazy import to avoid a market ↔ trading cycle
  import('./trading').then((t) => t.tradeTick()).catch(() => {})
  // Conventions — shows open, close, and get shopped on the game clock
  import('./conventions').then((cv) => cv.conventionTick()).catch(() => {})
  // BidBay — snipers scan the feed, shipments arrive
  import('./ebay').then((e) => e.ebayTick()).catch(() => {})
  // Vendor tables — NPC walk-up buyers hit the player's rented table
  import('./vendor').then((v) => v.vendorTick()).catch(() => {})
  // Hosted card shows — resolve show day once the doors close
  import('./shows').then((s) => s.showsTick()).catch(() => {})
  // The card shop — walk-in customers browse the display cases
  import('./shop').then((s) => s.shopTick()).catch(() => {})
  // The rival across the street — spawns on your success, fights for the block
  import('./rival').then((r) => { r.rivalSpawnTick(); r.rivalTick() }).catch(() => {})
  // The chain — satellites and their district manager run on the same clock
  import('./franchise').then((f) => f.chainTick()).catch(() => {})
  // Estate & collection buyouts — new listings, NPC takeaways, expiry
  import('./estatebuyout').then((e) => e.estateBuyoutTick()).catch(() => {})
  // Market regimes — phase drift, and the rare reprint headline
  import('./regimes').then((r) => r.regimeTick()).catch(() => {})
  // Seasonal events — the hobby calendar: holiday spikes, January lull
  import('./seasonal').then((s) => s.seasonalTick()).catch(() => {})
  // Population & meta drift — era tastes, celebrity booms, set demand profiles
  import('./demographics').then((d) => d.demoTick()).catch(() => {})
  // Advanced finance — daily interest accrual on outstanding loans
  import('./finance').then((f) => f.accrueDaily()).catch(() => {})
  // Polish — wishlist price alerts and the weekly market digest
  import('./polish').then((p) => { p.checkAlerts(); p.digestTick(); p.businessDigestTick() }).catch(() => {})
  // Wishlist agents — the overnight standing-order sweep (once per game-day)
  import('./wishlistagents').then((w) => w.wishlistAgentTick()).catch(() => {})
  // PSA rush — pediment events: random $10-special weekends, backlog, slab premium
  import('./psarush').then((p) => p.psaRushTick()).catch(() => {})
  // Day recap — the morning-after feed line once the UTC day has turned
  import('./dayrecap').then((d) => d.dayRecapTick()).catch(() => {})
  // Daily deals — snapshot the board so a day is not missing from the record
  // just because the player never opened the Pack Shop.
  import('./dailydeals').then((d) => d.ensureTodayRecorded()).catch(() => {})
  // Tax season — files last month's return on the first tick of a new month
  import('./tax').then((t) => t.taxTick()).catch(() => {})
  // The accountant — Monday report, retainer, auto-estimated taxes
  import('./accountant').then((a) => a.accountantTick()).catch(() => {})
  // Sales tax — remits settled months to the city once a day
  import('./salestax').then((s) => s.taxRemitTick()).catch(() => {})
  // Supplies — bare cards wear one condition step per game day at random
  import('./supplies').then((s) => s.suppliesTick(gameDayKey())).catch(() => {})
  // Insurance — weekly premium drafts and the daily disaster roll
  import('./insurance').then((i) => i.insuranceTick(gameDayKey())).catch(() => {})
  // Achievements — unlock yesterday's milestones once, announce them once
  import('./achievements').then((a) => a.achievementsTick()).catch(() => {})
  // Rolling save backups — one snapshot per game day, the last 3 kept (Settings → Save backups)
  import('./savebackup').then((s) => s.saveBackupTick()).catch(() => {})
  // Flea markets — weekend junk bins open at 6 AM, NPC pickers drain them live
  import('./fleamarket').then((f) => f.fleaTick()).catch(() => {})
  // Auction house — lots settle, new lots spawn, NPC wars rage
  import('./auctions').then((a) => a.auctionTick()).catch(() => {})
  // Storage unit auctions — delinquent lockers hit the block, pickers prowl
  import('./storage').then((s) => s.storageTick()).catch(() => {})
  // Storage & the vault — weekly locker rent + vault rider drafts
  import('./vault').then((v) => v.vaultTick()).catch(() => {})
  // Buylist — NPC want lists rotate weekly, shelves restock
  import('./buylist').then((b) => b.buylistTick()).catch(() => {})
  // Pawn — daily interest accrual, due-date warnings, defaults to the case
  import('./pawn').then((p) => p.pawnTick()).catch(() => {})
  // Sealed futures desk — daily interest accrual on sealed-asset loans
  import('./sealedfutures').then((f) => f.sealedLoanTick()).catch(() => {})
  // Yard sales — weekend driveways spawn and pack up
  import('./yardsale').then((y) => y.yardSaleTick()).catch(() => {})
  // NPC live shopping — scheduled channels open, rips land, wars rage
  import('./liveshopping').then((l) => l.liveShoppingTick()).catch(() => {})
  // Authentication lab — verdicts arrive on the game clock
  import('./auth').then((a) => { a.authTick(); a.authDailyTick(); a.accusationResolveTick(); a.accusationTick() }).catch(() => {})
  // The community scene — forum group-buys deliver on the game clock
  import('./forum').then((f) => f.forumTick()).catch(() => {})
  // Local deals — Marketplace/Craigslist spawns, expiries, and buyer messages
  import('./local').then((l) => l.localTick()).catch(() => {})
  // Prices ride the game clock: quotes for what you own or watch, the price
  // history point, and the simulated market all advance once per game day
  // (each guarded by its own day key, so repeat ticks that day are free).
  import('./pricetick').then((p) => p.priceDayTick()).catch(() => {})
}
