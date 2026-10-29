import { db } from '../lib/db'

// ---------------------------------------------------------------------------
// Comparable-based value model
//
// For cards with NO market data, estimate a value from comparable cards that DO
// have data: the median real TCGplayer market price of the same rarity tier in
// the same set era, adjusted by supertype (Pokémon / Trainer / Energy).
//
// These estimates are clearly labeled in the UI (EST · MODEL / "~$0.25") and
// never presented as live market data. They are replaced automatically the
// moment real price data arrives via sync/backfill.
// ---------------------------------------------------------------------------

type Tier = 'common' | 'uncommon' | 'rare' | 'rare_holo' | 'double' | 'ur' | 'ir' | 'sir' | 'unknown'
export type Era = 'vintage' | 'mid' | 'modern'

export function tierOf(rarity: string | null | undefined): Tier {
  const r = (rarity ?? '').toLowerCase()
  if (/special illustration|hyper rare|secret rare|gold/.test(r)) return 'sir'
  if (/illustration rare/.test(r)) return 'ir'
  if (/ultra rare|full art/.test(r)) return 'ur'
  if (/double rare/.test(r)) return 'double'
  if (/mega/.test(r)) return 'ur' // 2026 Mega rarities: closest comparable tier
  if (/rare holo|holo rare|shiny/.test(r)) return 'rare_holo'
  if (/rare/.test(r)) return 'rare'
  if (/uncommon/.test(r)) return 'uncommon'
  if (/common/.test(r)) return 'common'
  return 'unknown' // null rarity (trainer kits, promos) → uncommon-ish
}

export function eraOf(year: number | null): Era {
  if (year == null) return 'modern'
  if (year <= 2007) return 'vintage'
  if (year <= 2015) return 'mid'
  return 'modern'
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

type Model = {
  builtAt: number
  byBucket: Map<string, number> // `${tier}|${era}` -> median
  byTier: Map<Tier, number>
  global: number
}

let cache: Model | null = null
const MODEL_TTL_MS = 10 * 60 * 1000

function buildModel(): Model {
  const rows = db
    .prepare(
      `WITH latest AS (
         SELECT card_id, market,
                ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY retrieved_at DESC) rn
         FROM price_records WHERE market IS NOT NULL AND kind != 'simulated'
       )
       SELECT c.rarity, c.supertype, substr(s.release_date, 1, 4) AS yr, l.market
       FROM latest l
       JOIN cards c ON c.id = l.card_id
       JOIN sets s ON s.id = c.set_id
       WHERE l.rn = 1`,
    )
    .all() as { rarity: string | null; supertype: string; yr: string | null; market: number }[]

  const buckets = new Map<string, number[]>()
  const tiers = new Map<Tier, number[]>()
  const all: number[] = []
  for (const r of rows) {
    const tier = tierOf(r.rarity)
    const era = eraOf(r.yr ? Number(r.yr) : null)
    const bk = `${tier}|${era}`
    if (!buckets.has(bk)) buckets.set(bk, [])
    buckets.get(bk)!.push(r.market)
    if (!tiers.has(tier)) tiers.set(tier, [])
    tiers.get(tier)!.push(r.market)
    all.push(r.market)
  }

  const byBucket = new Map<string, number>()
  for (const [k, v] of buckets) byBucket.set(k, median(v) ?? 0)
  const byTier = new Map<Tier, number>()
  for (const [k, v] of tiers) byTier.set(k, median(v) ?? 0)
  return { builtAt: Date.now(), byBucket, byTier, global: median(all) ?? 0.1 }
}

function getModel(): Model {
  if (!cache || Date.now() - cache.builtAt > MODEL_TTL_MS) cache = buildModel()
  return cache
}

/** Sensible rounding so estimates look like real shop prices. */
function roundEstimate(n: number): number {
  if (n < 1) return Math.round(n * 20) / 20 // nickels
  if (n < 20) return Math.round(n * 4) / 4 // quarters
  if (n < 100) return Math.round(n)
  return Math.round(n / 5) * 5
}

/** Estimated NM value for a card, or null if the model has no data at all. */
export function estimatePrice(cardId: string): number | null {
  const card = db
    .prepare(
      `SELECT c.rarity, c.supertype, substr(s.release_date, 1, 4) AS yr
       FROM cards c JOIN sets s ON s.id = c.set_id WHERE c.id = ?`,
    )
    .get(cardId) as { rarity: string | null; supertype: string; yr: string | null } | undefined
  if (!card) return null

  const m = getModel()
  const tier = tierOf(card.rarity)
  const era = eraOf(card.yr ? Number(card.yr) : null)

  // Comparable chain: tier×era → tier×any-era → any-tier×era → tier → global
  const est =
    m.byBucket.get(`${tier}|${era}`) ??
    m.byTier.get(tier) ??
    m.byBucket.get(`unknown|${era}`) ??
    m.global

  // Supertype adjustment: Trainers and basic energies move differently from Pokémon.
  let factor = 1
  let floor = 0.02
  if (/^energy$/i.test(card.supertype)) {
    factor = 1
    floor = 0.1 // basic energies have a stable real-world floor
  } else if (/^trainer$/i.test(card.supertype)) {
    factor = 0.6
  }

  return roundEstimate(Math.max(floor, est * factor))
}
