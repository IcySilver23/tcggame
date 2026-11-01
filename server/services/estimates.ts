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

// ---------------------------------------------------------------------------
// Researched anchors
//
// Hand-checked market values for the cards the comparable model cannot price
// honestly: collector pieces whose nearest comparables are bulk printings, and
// phantom secret rares that no comparable set has ever contained. Each entry
// carries the month it was researched, so a stale number is obvious instead of
// silently wrong.
//
// Sources: TCGplayer market via Scrydex / Sparkl / PokeScope / Dittobase, eBay
// solds, PriceCharting, and Rare Candy's October 2026 RGB Mew write-up.
// ---------------------------------------------------------------------------

type Researched = { usd: number; asOf: string; note: string }

const RESEARCHED: Record<string, Researched> = {
  // 30th Celebration (me55) — the undocumented "RGB Rare" Mew trio: no set
  // symbol, collector numbers R/G/B, ~1 in 12,000 packs per colour by
  // community estimate (TPCi published no rate). Mid-October hype peaked near
  // $6,000 and has been falling since; these are late-Oct/Nov 2026 raw NM
  // levels, with blue ≥ red ≥ green by a small margin.
  'me55-R': { usd: 3850, asOf: '2026-11', note: 'RGB Mew (red), raw NM — $3.25k–$4.68k across trackers, down from ~$6k' },
  'me55-G': { usd: 3450, asOf: '2026-11', note: 'RGB Mew (green), raw NM — $3.09k–$3.58k' },
  'me55-B': { usd: 3950, asOf: '2026-11', note: 'RGB Mew (blue), raw NM — $3.75k–$4.10k' },

  // Worlds / event promos. The comparable model collapses these toward the
  // cheapest printing that shares their name, which undersells every one.
  'dpp-DP25': { usd: 795, asOf: '2026-11', note: 'Tropical Wind (2008 Worlds promo), ungraded ~$830' },
  'dpp-DP54': { usd: 12, asOf: '2026-11', note: 'Beginning Door promo — no quote on Scrydex/PokeScope, event-awarded, thin market' },
  'dpp-DP55': { usd: 95, asOf: '2026-11', note: 'Ultimate Zone promo — ~£79 in the UK, no US TCGplayer quote' },
  'bwp-BW77': { usd: 14, asOf: '2026-11', note: 'Pikachu BW77 — never sold at retail (cancelled product); eBay raw asks median ~$10' },
  'bwp-BW78': { usd: 12, asOf: '2026-11', note: 'Raichu BW78 — no sales history anywhere; illiquid, priced off its twin above' },

  // Chaos Rising (me4) energies and Emma printings: the set's own commons are
  // cheaper than the cross-set commodity pool the fallback reaches for.
  'me4-86': { usd: 0.19, asOf: '2026-11', note: 'Nitro Fire Energy holo — TCGplayer market $0.19' },
  'me4-84': { usd: 0.17, asOf: '2026-11', note: 'Bubbly Water Energy — $0.16–$0.19' },
  'me4-107': { usd: 2.05, asOf: '2026-11', note: 'Emma (Ultra Rare) — TCGplayer market $2.11–$2.14' },
  'me4-77': { usd: 0.25, asOf: '2026-11', note: 'Emma (Uncommon) — bulk trainer, ~$0.10–$0.50' },

  // Vintage/mid singles mispriced by rarity matching.
  'ecard2-103': { usd: 6.5, asOf: '2026-11', note: 'Porygon, Aquapolis #103 — 103a ~$4.78–$7.00, 103b ~$10.07' },
  'xy8-146a': { usd: 2, asOf: '2026-11', note: "Professor's Letter #146a — ~$0.95–$5.63 depending on finish" },
  'xy9-98a': { usd: 0.31, asOf: '2026-11', note: 'Delinquent #98a (regular print; the $52 card is the full art 98b)' },
}

/** A researched value for this card, if we have one. */
export function researchedAnchor(cardId: string): number | null {
  const hit = RESEARCHED[cardId]
  return hit ? hit.usd : null
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

  const curated = researchedAnchor(cardId)
  if (curated != null) return curated

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

  // A phantom tier can never be bulk, whatever its comparables say — if a
  // researched value ever goes missing this floor keeps it a chase card.
  const phantomFloor = /rgb rare/i.test(card.rarity ?? '') ? 1500 : 0

  return roundEstimate(Math.max(floor, est * factor, phantomFloor))
}
