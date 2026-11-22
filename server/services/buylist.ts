import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayMs } from '../lib/gameday'
import { valueOf, round2, resolvePrice, gradedPriceOf, type Condition } from './market'
import { marketFactor } from './substats'
import { presentationFactor } from './supplies'
import { factor as regimeFactor } from './regimes'
import * as pnl from './pnl'
import * as vault from './vault'

// ---------------------------------------------------------------------------
// THE BUYLIST — NPC shops that buy your cards outright, like Card Kingdom /
// TCGplayer's vendor network in real life. Where the street pays you liquidity
// (auctions, listings) the buylist pays you NOW, for a haircut:
//
//   • Payout 55–75% of market anchor depending on the shop's greed. Their
//     margin IS the service: instant cash, no listing risk, no sell fee.
//   • Rotating specialty wants: each shop posts 4 cards it's actively hunting;
//     want targets pay a premium up to +40% of raw market — sell into demand,
//     not into a discount.
//   • Trade-in store credit: take part of the payout as store credit and that
//     shop pays a bonus rate on it. Credit buys from their shelf of in-demand
//     stock (list price, no auction wait). Credit is shop-siloed.
//   • Their shelf restocks weekly with cards near your collection's bands —
//     occasionally an undervalued row worth spotting.
// ---------------------------------------------------------------------------

// Migration: buylist tables (existing DBs predate them; db.ts only execs
// schema.sql on first boot, so the service guarantees its own tables).
db.exec(`CREATE TABLE IF NOT EXISTS buylist_wants (
  shop_id INTEGER NOT NULL,
  card_id TEXT NOT NULL REFERENCES cards(id),
  premium REAL NOT NULL DEFAULT 0.15
);
CREATE TABLE IF NOT EXISTS buylist_shelf (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  card_id TEXT NOT NULL REFERENCES cards(id),
  variant TEXT NOT NULL DEFAULT 'normal',
  condition TEXT NOT NULL DEFAULT 'NM',
  price REAL NOT NULL,
  listed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS buylist_credit_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  delta REAL NOT NULL,
  created_at TEXT NOT NULL,
  note TEXT NOT NULL
);`)

export interface BuyShop {
  id: number
  name: string
  blurb: string
  greed: number          // 0.25 (generous) .. 0.45 (ruthless) -> payout 55..75%
  wantCount: number
  bonusRate: number      // extra payout points paid in store credit
}

export const SHOPS: BuyShop[] = [
  { id: 1, name: 'Card Kingdom West', blurb: 'The friendly giant. Buylist rates everyone quotes against.', greed: 0.25, wantCount: 4, bonusRate: 0.08 },
  { id: 2, name: 'Gnome Games',       blurb: 'Family store vibes, fair offers, strong credit bonus.',   greed: 0.30, wantCount: 4, bonusRate: 0.10 },
  { id: 3, name: 'CoolStuff HQ',      blurb: 'Big online buylister. Volume over niceties.',              greed: 0.34, wantCount: 4, bonusRate: 0.06 },
  { id: 4, name: 'TradeHQ Buylist',   blurb: 'Corporate spreadsheet energy. Competitive rates, thin bonuses.', greed: 0.32, wantCount: 4, bonusRate: 0.05 },
  { id: 5, name: 'Star City Singles', blurb: 'Pays up for modern meta. Wants rotate with the scene.',    greed: 0.38, wantCount: 4, bonusRate: 0.07 },
  { id: 6, name: 'Shady Pete’s Counter', blurb: 'Cash, no questions. Brutal rates, weird wants.',        greed: 0.45, wantCount: 4, bonusRate: 0.12 },
]

const BASE_PCT = (shop: BuyShop) => 1 - shop.greed // 55% .. 75%

const TIER_BANDS: { tier: string; min: number; max: number; weight: number }[] = [
  { tier: 'bulk',      min: 0,    max: 1,    weight: 2 },
  { tier: 'playset',   min: 1,    max: 5,    weight: 4 },
  { tier: 'chase',     min: 5,    max: 25,   weight: 3 },
  { tier: 'grail',     min: 25,   max: 9999, weight: 1 },
]

const CONDITION_DISCOUNT: Record<Condition, number> = { NM: 0, LP: 0.07, MP: 0.16, HP: 0.3, DM: 0.55 }
const WANT_PREMIUM_CAP = 0.4
const WANTS_DAYS = 7
const SHELF_DAYS = 7
const SHELF_SIZE = 6

function wantsStamp(shopId: number) { return `buylist:wants:${shopId}` }
function shelfStamp(shopId: number) { return `buylist:shelf:${shopId}` }

function stampIsStale(key: string, days: number): boolean {
  const at = getMeta(key)
  if (!at) return true
  return Date.now() - new Date(at).getTime() >= days * gameDayMs() // want rotation runs on 12h game-days
}

// --- Want selection: real catalog cards in the shop's value bands ------------

function drawWantCardIds(count: number): { card_id: string; market: number }[] {
  // Sample from the tcgplayer price table (the game's stable market anchors),
  // weighted toward cheaper tiers, with a hard recency cutoff.
  const tier = TIER_BANDS[Math.floor(Math.random() * TIER_BANDS.length)]
  let rows = db.prepare(`
    SELECT p.card_id, p.market FROM price_records p
    WHERE p.kind = 'tcgplayer' AND p.variant = 'normal' AND p.market > 0
      AND p.market >= ? AND p.market < ?
      AND p.card_id IN (SELECT id FROM cards)
    ORDER BY RANDOM() LIMIT ?`).all(tier.min, tier.max, count * 6) as { card_id: string; market: number }[]
  if (rows.length < count) {
    rows = db.prepare(`
      SELECT p.card_id, p.market FROM price_records p
      WHERE p.kind = 'tcgplayer' AND p.variant = 'normal' AND p.market > 0
        AND p.card_id IN (SELECT id FROM cards)
      ORDER BY RANDOM() LIMIT ?`).all(count) as { card_id: string; market: number }[]
  }
  return rows.slice(0, count)
}

export function refreshWants(shopId: number): void {
  const shop = SHOPS.find((s) => s.id === shopId)
  if (!shop) return
  db.prepare('DELETE FROM buylist_wants WHERE shop_id = ?').run(shopId)
  const picks = drawWantCardIds(shop.wantCount)
  const ins = db.prepare('INSERT INTO buylist_wants (shop_id, card_id, premium) VALUES (?, ?, ?)')
  for (const p of picks) {
    const premium = Math.min(WANT_PREMIUM_CAP, 0.1 + Math.random() * 0.3)
    ins.run(shopId, p.card_id, round2(premium * 100) / 100)
  }
  setMeta(wantsStamp(shopId), nowIso())
}

export function refreshShelf(shopId: number): void {
  // Shelf stock leans toward what the shop wants (they stock to their buylist
  // demand), plus generic mid-tier singles. Prices are list — market x 1.0,
  // with an occasional 15% mispriced row worth spotting.
  db.prepare('DELETE FROM buylist_shelf WHERE shop_id = ?').run(shopId)
  const wants = db.prepare('SELECT card_id FROM buylist_wants WHERE shop_id = ?').all(shopId) as { card_id: string }[]
  const wantPicks = wants.sort(() => Math.random() - 0.5).slice(0, 2)
  const generic = drawWantCardIds(SHELF_SIZE - wantPicks.length)
  const ins = db.prepare('INSERT INTO buylist_shelf (shop_id, card_id, variant, condition, price, listed_at) VALUES (?, ?, ?, ?, ?, ?)')
  for (const c of [...wantPicks, ...generic]) {
    const variant = Math.random() < 0.15 ? 'holo' : 'normal'
    const condition = Math.random() < 0.6 ? 'NM' : Math.random() < 0.7 ? 'LP' : 'MP'
    const mispriced = Math.random() < 0.15
    const anchor = valueOf(c.card_id, variant, condition as Condition)
    if (anchor <= 0) continue
    const price = round2(anchor * (mispriced ? 0.85 : 1.0))
    if (price <= 0) continue
    ins.run(shopId, c.card_id, variant, condition, price, nowIso())
  }
  setMeta(shelfStamp(shopId), nowIso())
}

function ensureFresh(shopId: number): void {
  if (stampIsStale(wantsStamp(shopId), WANTS_DAYS)) refreshWants(shopId)
  if (stampIsStale(shelfStamp(shopId), SHELF_DAYS)) refreshShelf(shopId)
}

export function ensureAllFresh(): void {
  for (const s of SHOPS) ensureFresh(s.id)
}

// --- Offer math ---------------------------------------------------------------

export interface Offer {
  inventoryId: number
  cardId: string
  name: string
  variant: string
  condition: Condition
  market: number
  payoutCash: number
  payoutCredit: number
  want: boolean
  wantPremium: number
  /** True when the row is raw and unprotected — the counter pays under a sleeved copy. */
  bare: boolean
}

function offerFor(shop: BuyShop, row: { id: number; card_id: string; variant: string; condition: string; graded_grade: string | null; protection?: string | null; fake_revealed?: number }, wantRow?: { premium: number }): Offer {
  const isGraded = row.graded_grade != null
  // AUTH META: a revealed counterfeit has exactly one market — the training
  // wall. The shop pays the flat dollar for it and keeps it behind glass.
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(row.card_id) as { name: string } | undefined)?.name ?? row.card_id
  if (row.fake_revealed) {
    return { inventoryId: row.id, cardId: row.card_id, name, variant: row.variant, condition: row.condition as Condition, market: 1, payoutCash: 1, payoutCredit: 1, want: false, wantPremium: 0, bare: false }
  }
  // CONDITION WARS: buylist appraisers grade the copy on the counter — an
  // inspected copy (read published) is paid for its sub-grade, unseen copies
  // get the band. They don't pay for information they can't verify.
  const market = isGraded
    ? gradedPriceOf(row.card_id, row.graded_grade).usd
    : valueOf(row.card_id, row.variant, row.condition as Condition) * (marketFactor(row.id))
  const condDiscount = isGraded ? 0 : CONDITION_DISCOUNT[row.condition as Condition] ?? 0
  let pct = BASE_PCT(shop) * (1 - condDiscount)
  let want = false
  let wantPremium = 0
  if (wantRow) {
    want = true
    wantPremium = wantRow.premium
    pct = Math.min(1.15, pct * (1 + wantPremium))
  }
  // A bare card is the same card handed over worse: they bid under a sleeved
  // copy, on both payout legs. `market` stays the real market — the sheet shows
  // that column honestly and the haircut lives in the rate.
  const factor = presentationFactor(row.protection, isGraded)
  const cash = round2(market * pct * factor)
  const credit = round2(market * Math.min(1.2, pct + shop.bonusRate) * factor)
  return { inventoryId: row.id, cardId: row.card_id, name, variant: row.variant, condition: row.condition as Condition, market: round2(market), payoutCash: cash, payoutCredit: credit, want, wantPremium, bare: factor < 1 }
}

function wantMap(shopId: number): Map<string, { premium: number }> {
  const rows = db.prepare('SELECT card_id, premium FROM buylist_wants WHERE shop_id = ?').all(shopId) as { card_id: string; premium: number }[]
  return new Map(rows.map((r) => [r.card_id, { premium: r.premium }]))
}

/** Whole-collection offer from one shop, sorted by margin. */
export function collectionOffer(shopId: number): { shop: BuyShop; offers: Offer[]; totals: { cash: number; credit: number } } {
  const shop = SHOPS.find((s) => s.id === shopId)!
  ensureFresh(shopId)
  const wm = wantMap(shopId)
  const rows = db.prepare(`SELECT id, card_id, variant, condition, graded_grade, protection, fake_revealed FROM inventory WHERE status = 'collection'`).all() as { id: number; card_id: string; variant: string; condition: string; graded_grade: string | null; protection: string | null; fake_revealed: number }[]
  const offers = rows
    .map((r) => offerFor(shop, r, wm.get(r.card_id)))
    .filter((o) => o.market > 0)
    .sort((a, b) => (b.payoutCash - b.market * 0.5) - (a.payoutCash - a.market * 0.5)) // best relative deals first
  return { shop, offers, totals: { cash: round2(offers.reduce((s, o) => s + o.payoutCash, 0)), credit: round2(offers.reduce((s, o) => s + o.payoutCredit, 0)) } }
}

// --- Selling ------------------------------------------------------------------

function removeFromCollection(inventoryIds: number[]): void {
  if (inventoryIds.length === 0) return
  db.prepare(`DELETE FROM binder_slots WHERE inventory_id IN (${inventoryIds.map(() => '?').join(',')})`).run(...inventoryIds)
  const qs = inventoryIds.map(() => '?').join(',')
  db.prepare(`DELETE FROM inventory WHERE id IN (${qs})`).run(...inventoryIds)
}

export function sell(
  shopId: number,
  inventoryIds: number[],
  creditSplit: number, // 0..1 portion of payout taken as store credit
  body?: { expectedCash?: number },
): { ok: true; cash: number; credit: number } | { ok: false; error: string } {
  const shop = SHOPS.find((s) => s.id === shopId)
  if (!shop) return { ok: false, error: 'Unknown shop' }
  if (inventoryIds.length === 0) return { ok: false, error: 'Nothing selected' }
  if (creditSplit < 0 || creditSplit > 1) return { ok: false, error: 'Credit split must be 0..1' }
  const offer = collectionOffer(shopId)
  const chosen = offer.offers.filter((o) => inventoryIds.includes(o.inventoryId))
  if (chosen.length === 0) return { ok: false, error: 'No sellable cards in selection' }
  const grossCash = round2(chosen.reduce((s, o) => s + o.payoutCash, 0))
  // Guard the quote: the offer sheet is computed on demand, and a want-list
  // rotation or a re-graded copy can move a payout between "here's the quote"
  // and "sold" — the toast then names a different number than the sheet did.
  // If the client pinned what it expected, the shop re-checks its sheet and
  // refuses the stale quote instead of quietly paying something else.
  if (body?.expectedCash != null) {
    const expect = round2(Number(body.expectedCash))
    if (Math.abs(expect - grossCash) > 0.02) {
      return { ok: false, error: `Sheet moved since you picked — ${shop.name} now offers $${grossCash.toFixed(2)} for these ${chosen.length} card${chosen.length === 1 ? '' : 's'}. Refreshed.` }
    }
  }
  const grossCredit = round2(chosen.reduce((s, o) => s + o.payoutCredit, 0))
  // Split model: the CASH payout is divided by your split, the CREDIT payout
  // fills the rest — so taking credit literally moves payout from cash to the
  // higher-rate credit leg.
  const cashPaid = round2(grossCash * (1 - creditSplit))
  const creditPaid = round2(grossCredit * creditSplit)
  const creditKey = `buylist:credit:${shopId}`
  const prevCredit = Number(getMeta(creditKey) ?? 0)
  // Record in sale_history so buylist sales count toward unlocks/achievements
  // like every other sell channel (this was silently missing before).
  const saleIns = db.prepare(`INSERT INTO sale_history (inventory_id, card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'instant', ?)`)
  const costOf = db.prepare('SELECT cost_basis FROM inventory WHERE id = ?')
  const grossCashSafe = Math.max(0.01, grossCash)
  for (const o of chosen) {
    const cost = (costOf.get(o.inventoryId) as { cost_basis: number } | undefined)?.cost_basis ?? 0
    saleIns.run(o.inventoryId, o.cardId, o.variant, o.condition, 1, o.payoutCash, cost, round2(o.payoutCash - cost), shop.name, nowIso())
  }
  removeFromCollection(chosen.map((o) => o.inventoryId))
  if (creditPaid > 0) {
    db.prepare('INSERT INTO buylist_credit_history (shop_id, delta, created_at, note) VALUES (?, ?, ?, ?)')
      .run(shopId, creditPaid, nowIso(), `Sold ${chosen.length} card${chosen.length === 1 ? '' : 's'} (partial credit)`)
  }
  setMeta(creditKey, String(round2(prevCredit + creditPaid)))
  if (cashPaid > 0) {
    db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(cashPaid)
    pnl.append('bulk', cashPaid, `Buylist sale to ${shop.name}: ${chosen.length} cards`)
  }
  if (getMeta('tut:buylist') !== '1') setMeta('tut:buylist', '1')
  const wants = chosen.filter((o) => o.want).length
  logActivity('market', `Buylist: ${shop.name} paid $${cashPaid.toFixed(2)} cash${creditPaid > 0 ? ` + $${creditPaid.toFixed(2)} store credit` : ''} for ${chosen.length} card${chosen.length === 1 ? '' : 's'}${wants > 0 ? ` (${wants} on their want list)` : ''}.`)
  return { ok: true, cash: cashPaid, credit: creditPaid }
}

// --- Credit -------------------------------------------------------------------

export function creditBalance(shopId: number): number {
  return round2(Number(getMeta(`buylist:credit:${shopId}`) ?? 0))
}

export function creditHistory(shopId: number): { delta: number; created_at: string; note: string }[] {
  return db.prepare('SELECT delta, created_at, note FROM buylist_credit_history WHERE shop_id = ? ORDER BY id DESC LIMIT 25').all(shopId) as { delta: number; created_at: string; note: string }[]
}

// --- Shelf (spending credit / cash) -------------------------------------------

export function shelf(shopId: number): { shop: BuyShop; rows: { id: number; cardId: string; name: string; variant: string; condition: Condition; price: number; market: number; wantStock: boolean }[] } {
  const shop = SHOPS.find((s) => s.id === shopId)!
  ensureFresh(shopId)
  const wants = new Set((db.prepare('SELECT card_id FROM buylist_wants WHERE shop_id = ?').all(shopId) as { card_id: string }[]).map((r) => r.card_id))
  const rows = db.prepare('SELECT id, card_id, variant, condition, price FROM buylist_shelf WHERE shop_id = ? ORDER BY price DESC').all(shopId) as { id: number; card_id: string; variant: string; condition: Condition; price: number }[]
  return {
    shop,
    rows: rows.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      name: (db.prepare('SELECT name FROM cards WHERE id = ?').get(r.card_id) as { name: string } | undefined)?.name ?? r.card_id,
      variant: r.variant,
      condition: r.condition,
      price: r.price,
      market: round2(valueOf(r.card_id, r.variant, r.condition)),
      wantStock: wants.has(r.card_id),
    })),
  }
}

export function buyFromShelf(shopId: number, shelfRowId: number, payCredit: boolean): { ok: true; paid: number; method: 'cash' | 'credit' } | { ok: false; error: string } {
  const shop = SHOPS.find((s) => s.id === shopId)
  if (!shop) return { ok: false, error: 'Unknown shop' }
  const row = db.prepare('SELECT id, card_id, variant, condition, price FROM buylist_shelf WHERE id = ? AND shop_id = ?').get(shelfRowId, shopId) as { id: number; card_id: string; variant: string; condition: Condition; price: number } | undefined
  if (!row) return { ok: false, error: 'Row already sold' }
  // Storage & the vault: the shop won't sell you cardboard you can't carry home.
  const admit = vault.admitRawFor(1, `${shop.name} shelf`)
  if (!admit.ok) return { ok: false, error: admit.error }
  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (payCredit) {
    const bal = creditBalance(shopId)
    if (bal < row.price) return { ok: false, error: `Not enough store credit (have $${bal.toFixed(2)}, need $${row.price.toFixed(2)})` }
    setMeta(`buylist:credit:${shopId}`, String(round2(bal - row.price)))
    db.prepare('INSERT INTO buylist_credit_history (shop_id, delta, created_at, note) VALUES (?, ?, ?, ?)')
      .run(shopId, -row.price, nowIso(), `Bought ${(db.prepare('SELECT name FROM cards WHERE id = ?').get(row.card_id) as { name: string }).name} from ${shop.name} shelf`)
  } else {
    if (state.cash < row.price) return { ok: false, error: 'Not enough cash' }
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(row.price)
    pnl.append('cases', -row.price, `Shelf buy from ${shop.name}`)
  }
  db.prepare('DELETE FROM buylist_shelf WHERE id = ?').run(shelfRowId)
  db.prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, cost_basis, acquired_via, acquired_ref, acquired_at)
              VALUES (?, ?, ?, 1, 'collection', ?, 'npc_shop', ?, ?)`)
    .run(row.card_id, row.variant, row.condition, row.price, `${shop.name} shelf`, nowIso())
  logActivity('market', `Bought ${(db.prepare('SELECT name FROM cards WHERE id = ?').get(row.card_id) as { name: string }).name} (${row.condition}) off ${shop.name}'s shelf for $${row.price.toFixed(2)}${payCredit ? ' store credit' : ''}.`)
  return { ok: true, paid: row.price, method: payCredit ? 'credit' : 'cash' }
}

// --- Read models (API) ---------------------------------------------------------

export function section(): unknown {
  ensureAllFresh()
  const shops = SHOPS.map((s) => ({
    id: s.id,
    name: s.name,
    blurb: s.blurb,
    basePct: round2(BASE_PCT(s) * 100),
    bonusRate: round2(s.bonusRate * 100),
    credit: creditBalance(s.id),
    wants: (db.prepare('SELECT card_id, premium FROM buylist_wants WHERE shop_id = ?').all(s.id) as { card_id: string; premium: number }[]).map((w) => ({
      cardId: w.card_id,
      name: (db.prepare('SELECT name FROM cards WHERE id = ?').get(w.card_id) as { name: string } | undefined)?.name ?? w.card_id,
      market: round2(valueOf(w.card_id, 'normal', 'NM')),
      premium: round2(w.premium * 100),
    })),
  }))
  const offers = SHOPS.map((s) => {
    const o = collectionOffer(s.id)
    return { shopId: s.id, totals: o.totals, count: o.offers.length }
  })
  return { shops, offers }
}

export function offersFor(shopId: number): unknown {
  const o = collectionOffer(shopId)
  return { shopId, shop: o.shop, offers: o.offers, totals: o.totals }
}

export function shelfSection(shopId: number): unknown {
  const sh = shelf(shopId)
  return { shopId, shop: sh.shop, rows: sh.rows, credit: creditBalance(shopId), history: creditHistory(shopId) }
}

// --- Tick ---------------------------------------------------------------------

export function buylistTick(): void {
  for (const s of SHOPS) {
    if (stampIsStale(wantsStamp(s.id), WANTS_DAYS)) {
      refreshWants(s.id)
      logActivity('market', `${s.name} posted a new want list — check the buylist before you sell.`)
    }
    if (stampIsStale(shelfStamp(s.id), SHELF_DAYS)) refreshShelf(s.id)
  }
}
