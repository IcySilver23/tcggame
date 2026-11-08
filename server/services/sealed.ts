import { db, nowIso, getMeta, setMeta, logActivity } from '../lib/db'
import { round2 } from './market'
import { fetchPriceCharting, pcAuthFailed, markPcAuthFailure } from './pricesources'
import { sealedFactor } from './demographics'
import { expectedPackValue, planFor } from './packodds'
import { miniPackFor } from '../catalog/general-mills'

// ---------------------------------------------------------------------------
// Sealed catalog for EVERY set. WotC sets get boosters + 36-pack displays;
// modern sets get the full line (booster, bundle, ETB, display). Prices come
// from PriceCharting's real sealed listings (the same token already used for
// graded comps), falling back to a derived estimate until that product's
// lookup lands. The backfill paces itself at PC's 1-call/second limit.
// ---------------------------------------------------------------------------

const DISPLAY_PACKS = 36
const BUNDLE_PACKS = 6
const ETB_PACKS = 9

type EraProducts = { kinds: { kind: string; name: string; msrp: number; packs: number }[] }

function seriesEra(series: string, releaseDate: string): 'wotc' | 'modern' | 'none' {
  const year = Number((releaseDate || '').slice(0, 4))
  if (year >= 2011) return 'modern'
  if (year >= 1998 && year <= 2010) return 'wotc'
  // Series-name fallbacks for odd rows without dates.
  const s = series.toLowerCase()
  if (/(sword|scarlet|sun & moon|xy|black & white)/.test(s)) return 'modern'
  if (/(base|jungle|fossil|neo|gym|e-card|ex|team rocket|diamond|platinum|heartgold|legendary|call of legends|pop|wizards)/.test(s)) return 'wotc'
  return 'none'
}

function isSpecialSet(setId: string): boolean {
  // Half sets (sv3pt5, swsh4.5,…) and promo-ish sets don't get displays.
  return setId.includes('.5') || setId.endsWith('pt5') || /(p|sm\d+p)$/.test(setId) === false && /(mcp|swshp|smp|xyp|dpp|hgssp|bwp|xy\d*p|sm\d*p)$/.test(setId)
}

function promoLike(setId: string): boolean {
  return /(^|)(mcp|swshp|smp|xyp|pop\d*|bwp|dpp|hgssp)$/.test(setId) || setId.endsWith('p') && setId.length <= 6
}

/**
 * Sets that only ever came inside another set's packs: Shiny Vault (Hidden Fates,
 * Shining Fates), the four Trainer Galleries, Crown Zenith's Galarian Gallery,
 * and the Basic Energy set. None has a wrapper of its own on a real shelf, and
 * their catalogue is pure chase cards, so a ten-card pack is either a lie (one
 * card dealt) or a money printer (a $4 wrapper worth hundreds). No sealed
 * product is sold for them; their cards stay in the catalogue.
 *
 * The two Classic Collection subsets belong here too: their cards came inside
 * 30th Celebration and Celebrations packs, never in a wrapper of their own.
 */
export const SUBSET_ONLY_SETS = new Set([
  'sma',
  'swsh45sv',
  'swsh9tg',
  'swsh10tg',
  'swsh11tg',
  'swsh12tg',
  'swsh12pt5gg',
  'sve',
  'cel25c',
  'me55c',
])

/**
 * Sets whose cards never shipped in a randomised booster of their own. These
 * are not subset-only — each is a set with its own name — but a ten-card
 * wrapper over them is still fabricated: the cards came in decks, promo
 * giveaways, a fixed binder, or one per toy. Their rows stay so owned stock
 * resolves; the shop, pack battles and live shows refuse them.
 */
export const NO_BOOSTER_SETS = new Set([
  'si1', // English Southern Islands: a fixed 18-card binder plus 3 boosters from other sets
  'xy0', // Kalos Starter Set: three theme decks, no booster
  'tk1a', // EX Trainer Kit Latias: a fixed two-deck kit
  'tk1b', // EX Trainer Kit Latios
  'tk2a', // EX Trainer Kit 2 Plusle
  'tk2b', // EX Trainer Kit 2 Minun
  'fut20', // Pokémon Futsal: promotional cards, never a pack
  'ru1', // Pokémon Rumble: promotional cards, never a booster
  // 2011–2019 McDonald's cards came one per toy. Only 2021 and 2022 shipped
  // the four-card Happy Meal pack.
  'mcd11',
  'mcd12',
  'mcd14',
  'mcd15',
  'mcd16',
  'mcd17',
  'mcd18',
  'mcd19',
])

/** True when this set has sealed product of its own to sell. */
export function sellsOwnPacks(setId: string): boolean {
  return !SUBSET_ONLY_SETS.has(setId) && !NO_BOOSTER_SETS.has(setId)
}

export function productsForSet(setId: string, setName: string, series: string, releaseDate: string): EraProducts['kinds'] {
  if (!sellsOwnPacks(setId)) return []
  if (promoLike(setId)) return []
  const era = seriesEra(series, releaseDate)
  if (era === 'none') return []
  const year = Number((releaseDate || '').slice(0, 4))
  const boosterMsrp = year >= 2020 ? 4.49 : year >= 2011 ? 3.99 : 3.29
  const etbMsrp = year >= 2020 ? 54.99 : year >= 2011 ? 39.99 : 0
  const kinds: EraProducts['kinds'] = [
    { kind: 'booster', name: `${setName} Booster Pack`, msrp: boosterMsrp, packs: 1 },
  ]
  if (era === 'wotc') {
    kinds.push({ kind: 'display', name: `${setName} Booster Display (36 packs)`, msrp: round2(boosterMsrp * DISPLAY_PACKS), packs: DISPLAY_PACKS })
  } else {
    const special = setId.includes('.5') || setId.endsWith('pt5')
    if (!special) kinds.push({ kind: 'bundle', name: `${setName} Booster Bundle`, msrp: 26.99, packs: BUNDLE_PACKS })
    kinds.push({ kind: 'etb', name: `${setName} Elite Trainer Box`, msrp: etbMsrp, packs: ETB_PACKS })
    if (!special) kinds.push({ kind: 'display', name: `${setName} Booster Display (36 packs)`, msrp: round2(boosterMsrp * DISPLAY_PACKS), packs: DISPLAY_PACKS })
  }
  return kinds
}

/** Seed pack_products for every synced set that lacks products (INSERT OR IGNORE keeps existing rows). */
export function ensureFullCatalog(): number {
  const sets = db
    .prepare(
      `SELECT s.id, s.name, s.series, s.release_date,
              (SELECT COUNT(*) FROM cards c WHERE c.set_id = s.id) AS n
       FROM sets s WHERE s.id IN (SELECT DISTINCT set_id FROM cards)`,
    )
    .all() as { id: string; name: string; series: string; release_date: string; n: number }[]
  const insert = db.prepare(
    `INSERT OR IGNORE INTO pack_products (id, set_id, name, kind, msrp, market_price, packs, cards_per_pack, release_date, description)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)`,
  )
  // A product's card count is the plan the roller deals, not a fixed ten:
  // Celebrations' real pack is four. Existing rows are corrected too, so a
  // save that seeded them as ten stops advertising a pack it never deals.
  const updatePerPack = db.prepare('UPDATE pack_products SET cards_per_pack = ? WHERE id = ? AND cards_per_pack <> ?')
  let added = 0
  const tx = db.transaction(() => {
    for (const s of sets) {
      if (s.n === 0) continue // no synced cards → nothing to rip
      const perPack = planFor(s.id, 10).reduce((a, slot) => a + slot.count, 0)
      for (const k of productsForSet(s.id, s.name, s.series, s.release_date)) {
        const id = `${s.id}-${k.kind}`
        const r = insert.run(id, s.id, k.name, k.kind, k.msrp, k.packs, perPack, s.release_date)
        added += r.changes
        if (r.changes === 0) updatePerPack.run(perPack, id, perPack)
      }
    }
  })
  tx()
  return added
}

// ---------------------------------------------------------------------------
// Pricing: sealed_prices holds real lookups; pack_products.market_price is
// refreshed from it. Fallback = derived per-pack value from the set's pulls.
// ---------------------------------------------------------------------------

type SealedPriceRow = { market: number; source: string; retrieved_at: string }

// ---------------------------------------------------------------------------
// Out-of-print appreciation. Real sealed product leaves print roughly 12–24
// months after a set's release, and boxes only climb from there — supply
// shrinks while collectors keep ripping. The curve below models the real
// shape: slow growth while in print, inflection at OOP, strongest gains in
// the first years, then a long taper (vintage boxes keep compounding, but
// modestly — their price is already high).
// ---------------------------------------------------------------------------

const PRINT_RUN_MONTHS = 24
const SPECIAL_PRINT_RUN_MONTHS = 10

/**
 * Months since this set's product left print (≥0 = out of print). Half/special
 * sets (.5/pt5) get the shorter print run their product line always implied —
 * they exist to be scalped — identified by setId since kinds are era-generic.
 */
export function monthsOutOfPrint(releaseDate: string, kind: string, setId?: string): number {
  const release = new Date(releaseDate)
  if (Number.isNaN(release.getTime())) return 0
  const isSpecial = setId != null ? setId.includes('.5') || setId.endsWith('pt5') : kind === 'special'
  const runMonths = isSpecial ? SPECIAL_PRINT_RUN_MONTHS : PRINT_RUN_MONTHS
  const eop = new Date(release)
  eop.setMonth(eop.getMonth() + runMonths)
  return Math.max(0, (Date.now() - eop.getTime()) / (1000 * 60 * 60 * 24 * 30.44))
}

/** Months since the set hit shelves (used for the launch taper below). */
export function monthsSinceRelease(releaseDate: string): number {
  const release = new Date(releaseDate)
  if (Number.isNaN(release.getTime())) return 0
  return (Date.now() - release.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
}

/**
 * Launch ramp for the DERIVED estimate only: the appreciation curve models a
 * box that already trades as a collectible, so applying it to product that
 * just hit shelves instantly marks up fresh releases. Fresh sets are in print
 * and fully liquid — their estimate should sit near the retail/pull value and
 * let scarcity build. The multiplier ramps from 1 at release to the full curve
 * value across LAUNCH_RAMP_MONTHS. Real PriceCharting prices are never tapered.
 */
const LAUNCH_RAMP_MONTHS = 18
export function launchAdjustedMultiplier(mult: number, monthsSince: number): number {
  if (mult <= 1) return 1
  if (monthsSince >= LAUNCH_RAMP_MONTHS) return mult
  const t = Math.max(0, monthsSince) / LAUNCH_RAMP_MONTHS
  return 1 + (mult - 1) * t
}

/**
 * Appreciation multiplier of market value over retail-derived value for a
 * product that has been out of print for `m` months. In-print products (m=0)
 * sit at retail; the curve then climbs, strongest in the first years and
 * tapering toward a per-kind ceiling: packs get ripped so they appreciate
 * least, sealed displays are the investor grade and appreciate most.
 * Booster lands ~2.1× at 1yr OOP, ~3× at 2yr, ~4.6× at 5yr, capped at 6×.
 */
export function oopMultiplier(m: number, kind = 'booster'): number {
  if (m <= 0) return 1
  const cap = kind === 'booster' ? 6 : kind === 'bundle' ? 8 : kind === 'etb' ? 10 : 12
  return 1 + (cap - 1) * (1 - Math.exp(-m / 48))
}

/**
 * A sold sealed product may not cost less than the packs it contains are
 * expected to deal.
 *
 * In-print shelves used to sit at MSRP even when the chase EV was several
 * times higher, so a $4.49 booster could be a guaranteed money printer and a
 * six-pack bundle inherited the same gap. The floor is per-pack EV × the
 * product's real pack count, applied to stored real quotes too. It skips
 * hidden products: their rows are kept for owned stock, not sold, so
 * repricing a fabricated wrapper at its pull EV would only inflate inventory.
 * Mini packs price from their own three-card composition and return before
 * this floor is reached.
 */
function atLeastPackEv(setId: string, packs: number | null, market: number): number {
  if (!sellsOwnPacks(setId)) return market
  const n = Math.max(1, Math.floor(packs ?? 1))
  const ev = expectedPackValue(setId) * n
  return ev > market ? round2(ev) : market
}

export function priceDetail(productId: string): {
  market: number
  source: 'pricecharting' | 'estimated'
  oopMonths: number
  oop: boolean
  multiplier: number
  status: 'in print' | 'out of print'
} {
  const row = db
    .prepare(`SELECT set_id, kind, msrp, packs FROM pack_products WHERE id = ?`)
    .get(productId) as { set_id: string; kind: string; msrp: number; packs: number | null } | undefined
  if (!row) return { market: 0, source: 'estimated', oopMonths: 0, oop: false, multiplier: 1, status: 'in print' }
  // A General Mills mini pack holds three cards, not ten: the per-pack EV model
  // below is a booster's shape and would price it like a display. It sits at its
  // own shelf price, and a PriceCharting lookup is never run for it (that would
  // match some other product's listing and overwrite the price).
  const mini = miniPackFor(productId)
  if (mini) {
    const rel = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(row.set_id) as { release_date: string } | undefined
    const m = rel ? monthsOutOfPrint(rel.release_date, row.kind, row.set_id) : 0
    return { market: round2(mini.msrp), source: 'estimated', oopMonths: Math.round(m), oop: m > 0, multiplier: 1, status: m > 0 ? 'out of print' : 'in print' }
  }
  const release = db
    .prepare(`SELECT release_date FROM sets WHERE id = ?`)
    .get(row.set_id) as { release_date: string } | undefined
  const m = release ? monthsOutOfPrint(release.release_date, row.kind, row.set_id) : 0
  const mult = launchAdjustedMultiplier(oopMultiplier(m, row.kind), release ? monthsSinceRelease(release.release_date) : 999)
  // Population & meta drift: once a product is OUT of print its long-term
  // value profile is demand-driven, not a fixed curve — the set's chase/bulk
  // cohort heat, its era's taste, and any live boom scale the whole curve
  // (demographics.ts). In-print product stays at retail: the presses are
  // running, so the scene's weather can't move a shelf price.
  const scene = m > 0 ? sealedFactor(row.set_id) : 1
  const stored = storedPrice(productId)
  if (stored && stored.source === 'pricecharting' && stored.market > 0) {
    return { market: atLeastPackEv(row.set_id, row.packs, round2(stored.market * scene)), source: 'pricecharting', oopMonths: Math.round(m), oop: m > 0, multiplier: round2(mult), status: m > 0 ? 'out of print' : 'in print' }
  }
  return { market: atLeastPackEv(row.set_id, row.packs, round2(derivedPrice(row.set_id, row.kind) * scene)), source: 'estimated', oopMonths: Math.round(m), oop: m > 0, multiplier: round2(mult), status: m > 0 ? 'out of print' : 'in print' }
}

function storedPrice(productId: string): SealedPriceRow | null {
  return db
    .prepare(`SELECT market, source, retrieved_at FROM sealed_prices WHERE product_id = ?`)
    .get(productId) as SealedPriceRow | null
}

export function derivedPrice(setId: string, kind: string): number {
  // Realistic per-pack value from the set's actual pull table: weighted average
  // of a pack (5 commons + 3 uncommons + 1 holo + 1 hit), hits weighted heavy —
  // sealed boxes trade on their chase cards.
  const cacheKey = setId + '|' + kind
  const cached = derivedCache.get(cacheKey)
  if (cached !== undefined) return cached
  // Same structure and odds the roller uses: 4 commons, 3 uncommons, a rare,
  // a reverse holo, and the final card at the era's real hit odds. Sealed boxes
  // trade on the chase cards, and that is now measured rather than fudged.
  const perPack = expectedPackValue(setId)
  if (perPack <= 0) return msrpFallback(setId, kind)
  // The row's own pack count, not a kind guess: a special collection can hold
  // five, eight or twenty-nine packs instead of a display's thirty-six.
  const productRow = db.prepare(`SELECT packs FROM pack_products WHERE id = ?`).get(`${setId}-${kind}`) as { packs: number | null } | undefined
  const packs = Math.max(1, Math.floor(productRow?.packs ?? 1))
  // IN-PRINT sets sell at retail, not at chase-card EV: store shelves price a
  // pack at MSRP no matter what the hit slot comps at — the rip-risk (and the
  // rare double-hit) is the buyer's gamble, and supply is unlimited while the
  // presses run. The pull-EV floor is the exception: a wrapper may not sell
  // below the cards it is expected to deal.
  const rel = db.prepare(`SELECT release_date FROM sets WHERE id = ?`).get(setId) as { release_date: string } | undefined
  if (rel) {
    const oopNow = monthsOutOfPrint(rel.release_date, kind, setId)
    if (oopNow <= 0) return atLeastPackEv(setId, packs, msrpFallback(setId, kind))
  }
  // Anchor every kind to the booster EV, then scale with pack count. Real sealed
  // boxes trade BELOW per-pack × count (dealers discount the rip-risk), with ETBs
  // holding value best (exclusive promos) and raw boxes discounting hardest.
  // That discount cannot go below the raw content EV — see atLeastPackEv below.
  const cap = kind === 'booster' ? 30 : kind === 'bundle' ? 90 : kind === 'etb' ? 350 : 700
  const boxFactor = kind === 'booster' ? 1 : kind === 'bundle' ? 1.0 : kind === 'etb' ? 0.92 : 0.8
  // Out-of-print appreciation: sealed only gets rarer after the print run ends —
  // ramped in over the launch window so fresh releases start near retail.
  const release = db.prepare(`SELECT release_date FROM sets WHERE id = ?`).get(setId) as { release_date: string } | undefined
  const oop = release
    ? launchAdjustedMultiplier(oopMultiplier(monthsOutOfPrint(release.release_date, kind, setId), kind), monthsSinceRelease(release.release_date))
    : 1
  const est = Math.min(perPack * packs * boxFactor, cap * oop) * oop
  const floor = kind === 'booster' ? 2.5 : kind === 'bundle' ? 18 : kind === 'etb' ? 32 : 90
  const result = atLeastPackEv(setId, packs, round2(Math.max(floor, est)))
  derivedCache.set(cacheKey, result)
  return result
}

// Memoized per set+kind — `valueOf` hits the DB per card, and the shop route
// prices the whole 500-product catalog per request. Cleared when a pull table
// is rebuilt (values change).
const derivedCache = new Map<string, number>()

export function invalidateDerivedPrices(setId: string) {
  for (const k of derivedCache.keys()) if (k.startsWith(setId + '|')) derivedCache.delete(k)
}

function msrpFallback(setId: string, kind: string): number {
  const row = db.prepare(`SELECT msrp FROM pack_products WHERE id = ?`).get(`${setId}-${kind}`) as { msrp: number } | undefined
  return round2(row?.msrp ?? 4.49)
}

/** The live price of a product: stored real lookup → derived estimate. */
export function priceOf(productId: string): { market: number; source: 'pricecharting' | 'estimated' } {
  const d = priceDetail(productId)
  return { market: d.market, source: d.source }
}

// PC sealed queries: their catalog titles use human set names.
function pcSealedQuery(setName: string, kind: string): string {
  const suffix = kind === 'booster' ? 'Booster Pack' : kind === 'display' ? 'Booster Box' : kind === 'etb' ? 'Elite Trainer Box' : 'Booster Bundle'
  return `Pokemon ${setName} ${suffix}`
}

function scoreSealed(title: string, setName: string, kind: string): number {
  const t = title.toLowerCase()
  const set = setName.toLowerCase()
  if (!t.includes(set)) return -1
  let score = 1
  const want = kind === 'booster' ? ['booster pack', 'booster'] : kind === 'display' ? ['booster box'] : kind === 'etb' ? ['elite trainer box'] : ['booster bundle']
  for (const w of want) if (t.includes(w)) score += 3
  // Reject sealed products of other kinds.
  const rejects = kind === 'booster' ? ['box', 'bundle', 'etb', 'elite', 'display'] : kind === 'display' ? ['pack', 'bundle', 'etb', 'elite', 'theme'] : kind === 'etb' ? ['booster box', 'booster pack', 'bundle', 'theme'] : ['booster box', 'booster pack', 'etb', 'elite', 'theme']
  for (const r of rejects) if (t.includes(r)) score -= 4
  if (/first edition|1st edition|shadowless/.test(t)) score -= 2 // keep the common printing
  return score
}

async function lookupSealed(setName: string, kind: string): Promise<number | null> {
  const envToken = process.env.PRICECHARTING_TOKEN
  const row = envToken && envToken.trim() ? envToken : (db.prepare(`SELECT value FROM settings WHERE key = 'pricechartingToken'`).get() as { value: string } | undefined)?.value
  const token = row && row.trim() ? row.trim() : null
  if (!token) return null
  if (pcAuthFailed()) return null // token known-bad — don't re-test it on every product
  const q = pcSealedQuery(setName, kind)
  const searchUrl = `https://www.pricecharting.com/api/products?t=${encodeURIComponent(token)}&q=${encodeURIComponent(q)}`
  await sleep(1100)
  const search = await fetchJson<{ status: string; 'error-message'?: string; products?: { id: string; 'product-name': string; 'console-name': string }[] }>(searchUrl)
  if (search.status === 'error') {
    markPcAuthFailure(search['error-message'])
    return null
  }
  if (search.status !== 'success' || !search.products?.length) return null
  const ranked = search.products
    .filter((p) => /pokemon/i.test(p['console-name']))
    .map((p) => ({ p, score: scoreSealed(p['product-name'], setName, kind) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]?.p
  if (!best) return null
  await sleep(1100)
  const product = await fetchJson<{ status: string; 'loose-price'?: number }>(`https://www.pricecharting.com/api/product?t=${encodeURIComponent(token)}&id=${best.id}`)
  if (product.status !== 'success' || product['loose-price'] == null) return null
  return Math.round(product['loose-price']) / 100
}

const insertSealed = db.prepare(
  `INSERT INTO sealed_prices (product_id, market, source, retrieved_at) VALUES (?, ?, 'pricecharting', ?)
   ON CONFLICT(product_id) DO UPDATE SET market = excluded.market, source = 'pricecharting', retrieved_at = excluded.retrieved_at`,
)

export async function refreshSealedPrice(productId: string): Promise<'pricecharting' | 'unchanged'> {
  const p = db.prepare(`SELECT set_id, kind, msrp, packs FROM pack_products WHERE id = ?`).get(productId) as { set_id: string; kind: string; msrp: number; packs: number | null } | undefined
  if (!p) return 'unchanged'
  // Mini packs are a cereal promotion with no sealed listing of its own; a set
  // name + kind query would return a different product's price.
  if (miniPackFor(productId)) return 'unchanged'
  const setName = (db.prepare(`SELECT name FROM sets WHERE id = ?`).get(p.set_id) as { name: string } | undefined)?.name
  if (!setName) return 'unchanged'
  const derived = derivedPrice(p.set_id, p.kind)
  try {
    const price = await lookupSealed(setName, p.kind)
    if (price == null || price <= 0) return 'unchanged'
    // Sanity: reject wild mismatches (>30x the derived estimate) — wrong product.
    if (price > Math.max(derived * 30, 500)) return 'unchanged'
    const quoted = atLeastPackEv(p.set_id, p.packs, round2(price))
    insertSealed.run(productId, quoted, nowIso())
    db.prepare(`UPDATE pack_products SET market_price = ? WHERE id = ?`).run(quoted, productId)
    return 'pricecharting'
  } catch {
    return 'unchanged'
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Selling sealed stock — dealers rip, investors sell. The market pays what
// the product is worth today (appreciation included), minus a dealer fee.
// ---------------------------------------------------------------------------

export function sellSealed(productId: string, qty: number): { ok: true; units: number; unitPrice: number; gross: number; fee: number; proceeds: number; basis: number; profit: number } | { ok: false; error: string } {
  const n = Math.max(1, Math.floor(qty))
  // Sealed stock is stored in lot rows (quantity per row, per-unit cost) —
  // walk rows FIFO, deplete the last one partially if needed.
  const rows = db
    .prepare(`SELECT id, quantity, cost FROM sealed_inventory WHERE product_id = ? ORDER BY acquired_at ASC`)
    .all(productId) as { id: number; quantity: number; cost: number }[]
  let remaining = n
  let units = 0
  let basis = 0
  const dels: number[] = []
  const decs: { id: number; left: number }[] = []
  for (const r of rows) {
    if (remaining <= 0) break
    const take = Math.min(remaining, r.quantity)
    units += take
    basis += take * r.cost
    remaining -= take
    if (take === r.quantity) dels.push(r.id)
    else decs.push({ id: r.id, left: r.quantity - take })
  }
  if (units === 0) return { ok: false, error: 'No sealed stock of that product' }

  const unitPrice = priceOf(productId).market
  const gross = round2(unitPrice * units)
  const fee = round2(gross * 0.1)
  const proceeds = round2(gross - fee)
  basis = round2(basis)
  const profit = round2(proceeds - basis)

  const name = (db.prepare(`SELECT name FROM pack_products WHERE id = ?`).get(productId) as { name: string } | undefined)?.name ?? productId
  const del = db.prepare(`DELETE FROM sealed_inventory WHERE id = ?`)
  const dec = db.prepare(`UPDATE sealed_inventory SET quantity = ? WHERE id = ?`)
  const insertSale = db.prepare(
    `INSERT INTO sale_history (card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
     VALUES (?, NULL, 'Sealed', ?, ?, ?, ?, ?, 'Local collector', 'sealed', ?)`,
  )
  db.transaction(() => {
    for (const id of dels) del.run(id)
    for (const d of decs) dec.run(d.left, d.id)
    insertSale.run(productId, units, proceeds, basis, fee, profit, nowIso())
    db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(proceeds)
    logActivity('sale', `Sold ${units}× ${name} for $${proceeds.toFixed(2)} after 10% fee${profit >= 0 ? ` (+$${profit.toFixed(2)} vs cost)` : ` (−$${Math.abs(profit).toFixed(2)} vs cost)`}`, proceeds)
  })()

  return { ok: true, units, unitPrice, gross, fee, proceeds, basis, profit }
}

let backfillRunning = false
let backfillProgress = { done: 0, total: 0, updated: 0 }

export function backfillStatus() {
  return { running: backfillRunning, ...backfillProgress, configured: sealedTokenConfigured() }
}

function sealedTokenConfigured(): boolean {
  if (process.env.PRICECHARTING_TOKEN && process.env.PRICECHARTING_TOKEN.trim()) return true
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'pricechartingToken'`).get() as { value: string } | undefined
  return Boolean(row?.value && row.value.trim())
}

/**
 * Fetch real sealed prices for products that have none (or are stale >30 days).
 * Paced for PriceCharting's 1 req/sec — run in the background on boot.
 */
export async function backfillSealedPrices(maxProducts = 400): Promise<void> {
  if (backfillRunning) return
  if (!sealedTokenConfigured()) return
  backfillRunning = true
  try {
    const rows = db
      .prepare(
        `SELECT p.id FROM pack_products p
         LEFT JOIN sealed_prices sp ON sp.product_id = p.id
         WHERE sp.product_id IS NULL OR sp.retrieved_at < datetime('now', '-30 days')
         ORDER BY p.release_date DESC LIMIT ?`,
      )
      .all(maxProducts) as { id: string }[]
    backfillProgress = { done: 0, total: rows.length, updated: 0 }
    for (const r of rows) {
      const res = await refreshSealedPrice(r.id)
      backfillProgress.done++
      if (res === 'pricecharting') backfillProgress.updated++
    }
    setMeta('sealedBackfilledAt', nowIso())
    console.log(`[sealed] backfill complete: ${backfillProgress.updated}/${backfillProgress.total} real sealed prices`)
  } finally {
    backfillRunning = false
  }
}

/** Kick the backfill without awaiting — used on boot. */
export function startSealedBackfill() {
  ensureFullCatalog()
  void backfillSealedPrices().catch((e) => console.warn('[sealed] backfill failed:', e instanceof Error ? e.message : e))
}

// Boot-time table creation is handled by schema.sql; lazily create for older DBs here.
export function ensureSealedTable() {
  try {
    db.prepare(`SELECT 1 FROM sealed_prices LIMIT 1`).get()
  } catch {
    db.exec(`CREATE TABLE IF NOT EXISTS sealed_prices (
      product_id TEXT PRIMARY KEY,
      market REAL NOT NULL,
      source TEXT NOT NULL,
      retrieved_at TEXT NOT NULL
    )`)
  }
}

void getMeta
