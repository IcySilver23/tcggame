import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import * as shipsvc from './shipping'
import * as deliveries from './deliveries'
import { valueOf, resolvePrice, liquidityFactor, round2, CONDITION_MULT, type Condition } from './market'
import { cleanupSlotsForInventory } from './binders'
import { append as pnlAppend } from './pnl'

// ---------------------------------------------------------------------------
// 📦 BidBay (Phase 5) — the online storefront. List anything from the binder
// at any price; NPC bargain hunters browse a live feed and snipe underpriced
// listings. ~13% seller fees, a shipping cost per order, and a feedback
// rating that feeds sales speed. Listings price off the same real-market
// ladder as the rest of the game, and your walk-in shop competes for the
// same eyeballs: every live BidBay listing quietly siphons shop traffic
// (channel conflict, faithfully simulated).
// ---------------------------------------------------------------------------

const FEE_RATE = 0.13
const MIN_DISCOUNT = 0.06 // snipers only pounce at 6%+ under market
const EPS = 1e-9 // FP guard: an ask at exactly the 6% line must still sell (1 - 9.4/10 = 0.05999999…)
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const U = (a: number, b: number): number => a + Math.random() * (b - a)
const BUYER_NAMES = ['Kyle', 'Amara', 'Theo', 'Sofia', 'Dev', 'Nina', 'Marcus', 'Ellie', 'Raj', 'June', 'Wes', 'Cora', 'Priya', 'Omar', 'Lena', 'Tash']
const HAPPY = [
  'Exactly as described. A+',
  'Fast shipper, card was mint.',
  'Great price, would buy again!',
  'Packed well, arrived safe.',
  'Smooth transaction, thanks!',
]
const NEUTRAL = ['Card as listed.', 'OK deal.', 'Shipping took a bit.', 'As expected.']
const UNHAPPY = ['Overpaid, saw it cheaper later.', 'Shipping was slow.', 'Seller priced this way over market.', 'Meh.']

export type EbayListingRow = {
  id: number
  inventory_id: number
  card_id: string
  variant: string
  condition: string
  quantity: number
  ask: number
  market_at_list: number
  status: string
  views: number
  watchers: number
  buyer: string | null
  sold_price: number | null
  fee: number | null
  shipping: number | null
  net: number | null
  paid: number
  promoted_ticks: number
  listed_at: string
  sold_at: string | null
  ships_at: string | null
  name?: string
  image_small?: string | null
  set_name?: string | null
}

type ListingRow = EbayListingRow

/** Seller feedback average — 5.0 until the first sale, 0 stars cost you dearly. */
export function feedback(): { avg: number; count: number } {
  const row = db.prepare(`SELECT AVG(stars) AS avg, COUNT(*) AS count FROM ebay_feedback`).get() as { avg: number | null; count: number }
  return { avg: row.avg != null ? Math.round(row.avg * 10) / 10 : 5.0, count: row.count }
}

/** Traffic multiplier from feedback: 0.55 at 3.0★, 1.0 at 4.5★, up to 1.25 at a perfect 5.0★. */
function feedbackMult(avg: number): number {
  return Math.max(0.55, Math.min(1.25, 0.55 + ((avg - 3) / 2) * 0.7))
}

export function status() {
  const live = db
    .prepare(
      `SELECT e.*, c.name, c.image_small, s.name AS set_name
       FROM ebay_listings e JOIN cards c ON c.id = e.card_id LEFT JOIN sets s ON s.id = c.set_id
       WHERE e.status = 'live' ORDER BY e.listed_at DESC`,
    )
    .all() as ListingRow[]
  const sold = db
    .prepare(
      `SELECT e.*, c.name, c.image_small, s.name AS set_name
       FROM ebay_listings e JOIN cards c ON c.id = e.card_id LEFT JOIN sets s ON s.id = c.set_id
       WHERE e.status = 'sold' ORDER BY e.sold_at DESC LIMIT 30`,
    )
    .all() as ListingRow[]
  const fees = db.prepare(`SELECT COALESCE(SUM(fee),0) AS n FROM ebay_listings WHERE paid = 1`).get() as { n: number }
  const ship = db.prepare(`SELECT COALESCE(SUM(shipping),0) AS n FROM ebay_listings WHERE paid = 1`).get() as { n: number }
  return { live, sold, feedback: feedback(), feesPaid: round2(fees.n), shippingPaid: round2(ship.n), feeRate: FEE_RATE, promoRate: { flat: 2, pct: 0.02, ticks: PROMOTE_TICKS }, watches: watches() }
}

/** Live listings feed, cheapest per unit first — what the snipers see. */
function sniperFeed() {
  return db
    .prepare(
      `SELECT e.*, (SELECT market FROM price_records pr WHERE pr.card_id = e.card_id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY pr.retrieved_at DESC LIMIT 1) AS m
       FROM ebay_listings e WHERE e.status = 'live'`,
    )
    .all() as (ListingRow & { m: number | null })[]
}

/** List N copies from the binder at a per-unit ask. The binder row stays one
 *  row (quantity is decremented on sale) — matching shop-case semantics. */
export function list(inventoryId: number, ask: number): { ok: boolean; error?: string } {
  markTaught()
  const row = db.prepare(`SELECT * FROM inventory WHERE id = ? AND status = 'collection'`).get(inventoryId) as
    | { id: number; card_id: string; variant: string; condition: string; quantity: number; graded_grade: string | null }
    | undefined
  if (!row) return { ok: false, error: 'Card is not in your collection' }
  if (row.graded_grade) return { ok: false, error: 'Graded slabs sell at the auction house — BidBay is for raw cardboard' }
  // AUTH META: known fakes trade nowhere but the training wall.
  const fakeErr = (db.prepare('SELECT fake_revealed FROM inventory WHERE id = ?').get(inventoryId) as { fake_revealed: number } | undefined)?.fake_revealed
    ? 'Known counterfeit — buylist shops pay $1 flat for it (Inventory → 🛡 Authentication)'
    : null
  if (fakeErr) return { ok: false, error: fakeErr }
  if (!ask || ask <= 0) return { ok: false, error: 'Set a per-unit price first' }
  const price = resolvePrice(row.card_id, row.variant || 'normal', (row.condition as Condition) || 'NM')
  if (price.usd == null) return { ok: false, error: 'No market data for that card yet — buyers can\'t judge it' }
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM ebay_listings WHERE inventory_id = ? AND status = 'live'`).get(inventoryId) as { n: number }
  if (existing.n > 0) return { ok: false, error: 'That card already has a live listing' }
  const onBlock = db.prepare(`SELECT COUNT(*) AS n FROM ebay_auctions WHERE inventory_id = ? AND status = 'live'`).get(inventoryId) as { n: number }
  if (onBlock.n > 0) return { ok: false, error: 'That card is on the auction block — pull the lot or wait for the hammer' }
  db.prepare(
    `INSERT INTO ebay_listings (inventory_id, card_id, variant, condition, quantity, ask, market_at_list, listed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.card_id, row.variant || 'normal', row.condition, row.quantity, round2(ask), price.usd, nowIso())
  cleanupSlotsForInventory([row.id]) // listed online frees its binder pocket
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(row.card_id) as { name: string }).name
  logActivity('ebay', `Listed ${row.quantity > 1 ? `${row.quantity}× ` : ''}${name} on BidBay at $${round2(ask).toFixed(2)}/ea`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Promoted listings — pay upfront, buy the feed's eyes for a window of ticks.
// ---------------------------------------------------------------------------

/** Upfront cost of one promotion window: $2 flat + 2% of the per-unit ask
 *  (promoting a grail costs more than promoting a common, like real ad spend). */
export function promoteCost(ask: number): number {
  return round2(2 + ask * 0.02)
}

const PROMOTE_TICKS = 20

/** Buy a promotion window for a live listing. The fee is sunk immediately —
 *  like real ad spend, there's no refund if the card doesn't sell. */
export function promote(id: number): { ok: boolean; error?: string } {
  const l = db.prepare(`SELECT * FROM ebay_listings WHERE id = ? AND status = 'live'`).get(id) as ListingRow | undefined
  if (!l) return { ok: false, error: 'Listing is not live' }
  if (l.promoted_ticks > 0) return { ok: false, error: 'That listing is already promoted' }
  const cost = promoteCost(l.ask)
  const cash = (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash
  if (cash < cost) return { ok: false, error: `Not enough cash — promotion costs $${cost.toFixed(2)}` }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(cost)
  db.prepare(`UPDATE ebay_listings SET promoted_ticks = ? WHERE id = ?`).run(PROMOTE_TICKS, id)
  pnlAppend('overhead', -cost, 'BidBay promotion')
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(l.card_id) as { name: string }).name
  logActivity('ebay', `Promoted ${name} on BidBay for ${PROMOTE_TICKS} ticks — $${cost.toFixed(2)} ad spend.`)
  return { ok: true }
}

export function cancel(id: number): { ok: boolean; error?: string } {
  const row = db.prepare(`SELECT * FROM ebay_listings WHERE id = ? AND status = 'live'`).get(id) as ListingRow | undefined
  if (!row) return { ok: false, error: 'Listing is not live' }
  db.prepare(`UPDATE ebay_listings SET status = 'cancelled' WHERE id = ?`).run(id)
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(row.card_id) as { name: string }).name
  logActivity('ebay', `Cancelled the BidBay listing for ${name}.`)
  return { ok: true }
}

/** The market tick: sniper purchases, escrow payouts, views/watchers. */
// ---------------------------------------------------------------------------
// NPC sellers — the hunt. Rotating NPC stock on the same feed, so the player
// can be the sniper. Rival bot buyers ("resellers") compete for the deals.
// ---------------------------------------------------------------------------

const SELLERS = ['bulk_cards_88', 'PokéMom_Closet', 'BinderBarn', 'midwest_pulls', 'CardKraken', 'tagteam_tcg', 'AtticFindz', 'packfresh_pro', 'HobbyHollow', 'dragonvault']
const MARKET_SIZE = 10
const MARKET_TTL_MS = 8 * 3600_000 // listings rotate out after ~a play session or two

/** Current public feed of NPC stock, most desirable first. Legacy rows
 *  (spawned before condition-aware pricing, when market_at_list was the NM
 *  price for every condition) are re-anchored to the card's CURRENT real
 *  market at this condition on the way out — the displayed delta is then
 *  honest no matter when the row was born. */
export function marketFeed() {
  db.prepare(`DELETE FROM ebay_market WHERE expires_at <= ?`).run(nowIso())
  const rows = db
    .prepare(
      `SELECT em.*, c.name, c.image_small, s.name AS set_name
       FROM ebay_market em JOIN cards c ON c.id = em.card_id LEFT JOIN sets s ON s.id = c.set_id
       ORDER BY em.ask / MAX(em.market_at_list, 0.01) ASC, em.listed_at DESC`,
    )
    .all() as MarketRow[]
  for (const r of rows) {
    const cond = ((r.condition as Condition) || 'NM')
    const condMult = CONDITION_MULT[cond] ?? 1
    const anchor = resolvePrice(r.card_id, 'normal', cond).usd
    if (anchor != null && anchor > 0) r.market_at_list = round2(anchor)
  }
  return rows
}

type MarketRow = {
  id: number
  card_id: string
  variant: string
  condition: string
  quantity: number
  ask: number
  market_at_list: number
  seller: string
  listed_at: string
  expires_at: string
  name?: string
  image_small?: string | null
  set_name?: string | null
}

/** Rival bots: two scans per tick, each goes for the single best deal on the
 *  feed (a rival sniped the deal you slept on). Feedback scales their speed —
 *  it's the same buyChance kernel as the snipers that hunt YOU. */
function rivalTick() {
  const feed = db.prepare(`SELECT * FROM ebay_market WHERE expires_at > ?`).all(nowIso()) as MarketRow[]
  if (feed.length === 0) return
  const fb = feedback()
  const scanMult = feedbackMult(fb.avg)
  for (let scan = 0; scan < 2; scan++) {
    const current = db.prepare(`SELECT * FROM ebay_market WHERE expires_at > ?`).all(nowIso()) as MarketRow[]
    if (current.length === 0) break
    const best = current.slice().sort((a, b) => a.ask / Math.max(a.market_at_list, 0.01) - b.ask / Math.max(b.market_at_list, 0.01))[0]
    if (!best) break
    const discount = best.market_at_list > 0 ? 1 - best.ask / best.market_at_list : 0
    if (discount + EPS < MIN_DISCOUNT) continue // bots ignore fairly-priced stock too
    const liq = 1 / liquidityFactor(best.market_at_list)
    if (Math.random() >= Math.min(0.75, discount * 1.9 * liq * scanMult)) continue
    db.prepare(`DELETE FROM ebay_market WHERE id = ?`).run(best.id)
    logActivity('ebay', `A rival buyer grabbed ${best.quantity > 1 ? `${best.quantity}× ` : ''}${(db.prepare('SELECT name FROM cards WHERE id = ?').get(best.card_id) as { name: string }).name} from ${best.seller} at $${best.ask.toFixed(2)}/ea.`)
  }
}

/** Seed the NPC feed up to size, drawn from real-priced cards (junk-biased
 *  like real marketplace tables, with occasional mid-range collections). */
function seedMarket() {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM ebay_market WHERE expires_at > ?`).get(nowIso()) as { n: number }).n
  if (n >= MARKET_SIZE) return
  for (let i = n; i < MARKET_SIZE; i++) {
    const roll = Math.random()
    const ceiling = roll < 0.85 ? 2 : 20 // mostly junk drawers, sometimes a nicer binder
    const rows = db
      .prepare(
        `SELECT c.id, pr.market FROM cards c
         JOIN price_records pr ON pr.card_id = c.id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL
         WHERE pr.market BETWEEN 0.03 AND ?
         ORDER BY RANDOM() LIMIT 1`,
      )
      .all(ceiling) as { id: string; market: number }[]
    if (rows.length === 0) return
    const pickRow = rows[0]
    const m = pickRow.market
    const rollAsk = Math.random()
    const factor = rollAsk < 0.25 ? 0.5 + Math.random() * 0.35 // a genuine deal
      : rollAsk < 0.75 ? 0.9 + Math.random() * 0.3 // fair-ish
      : 1.3 + Math.random() * 0.9 // hopeful pricing
    const qty = Math.random() < 0.12 ? 2 + Math.floor(Math.random() * 4) : 1
    const condition = pick<Condition>(['NM', 'NM', 'NM', 'LP', 'LP', 'MP'])
    // Condition-aware pricing: the factor rolls against THIS condition's
    // market (LP 0.8×, MP 0.65× of NM), and market_at_list stores the same
    // anchor. Anchoring LP/MP stock to the NM price manufactured fake DEALs
    // (a fair MP ask read as "-35% DEAL") and fake MARKETs on overpriced LPs.
    const condMult = CONDITION_MULT[condition] ?? 1
    const marketAtCondition = m * condMult
    const seller = pick(SELLERS)
    const ask = round2(Math.max(0.03, marketAtCondition * factor))
    db.prepare(
      `INSERT INTO ebay_market (card_id, variant, condition, quantity, ask, market_at_list, seller, listed_at, expires_at)
       VALUES (?, 'normal', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(pickRow.id, condition, qty, ask, round2(marketAtCondition), seller, nowIso(), new Date(Date.now() + MARKET_TTL_MS).toISOString())
  }
}

/** Buy from an NPC seller. Priced at the real ask; condition and cost basis
 *  are exactly what the listing claims. The parcel rides the auction-house
 *  shipping network for 1–2 game-days before it lands in the vault. */
export function buyMarket(id: number): { ok: boolean; error?: string } {
  const l = db.prepare(`SELECT * FROM ebay_market WHERE id = ?`).get(id) as MarketRow | undefined
  if (!l) return { ok: false, error: 'That listing is gone' }
  const gross = round2(l.ask * l.quantity)
  const cash = (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash
  if (cash < gross) return { ok: false, error: `Not enough cash — ${l.quantity > 1 ? `${l.quantity}× ` : ''}the lot costs $${gross.toFixed(2)}` }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(gross)
  const etaDays = 1 + (Math.random() < 0.4 ? 1 : 0)
  deliveries.schedule({ cardId: l.card_id, variant: l.variant, condition: l.condition, quantity: l.quantity, costBasis: gross, via: 'ebay', seller: l.seller, etaDays })
  db.prepare(`DELETE FROM ebay_market WHERE id = ?`).run(l.id)
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(l.card_id) as { name: string }).name
  logActivity('ebay', `You sniped ${l.quantity > 1 ? `${l.quantity}× ` : ''}${name} from ${l.seller} at $${l.ask.toFixed(2)}/ea ($${gross.toFixed(2)}) — lands in ~${etaDays} game-day${etaDays === 1 ? '' : 's'}.`, -gross)
  return { ok: true }
}

export function ebayTick() {
  payOutShipped()
  payOutAuctionShipped()
  shipsvc.shipmentTick()
  seedMarket()
  rivalTick()
  ebayAuctionTick()
  seedNpcAuctions()
  npcAuctionTick()
  watchTick()
  const live = sniperFeed()
  if (live.length === 0) return
  // Browsers: every listing collects eyes each tick; watchers skew toward
  // deals (under-market asks attract watchers, over-market ones repel them).
  // Promoted listings buy the top of the feed: 3× the eyeballs while active.
  for (const l of live) {
    const ratio = l.m && l.m > 0 ? l.ask / l.m : 1
    const v = Math.floor(Math.random() * 4) * (l.promoted_ticks > 0 ? 3 : 1)
    const w = Math.random() < Math.max(0, 0.4 - ratio * 0.25) ? 1 : 0
    db.prepare(`UPDATE ebay_listings SET views = views + ?, watchers = MAX(0, watchers + ?) WHERE id = ?`).run(v, w, l.id)
    if (l.promoted_ticks > 0) db.prepare(`UPDATE ebay_listings SET promoted_ticks = promoted_ticks - 1 WHERE id = ?`).run(l.id)
  }
  // Snipers: ~2 scans per tick, each picks the single most underpriced live
  // listing they can see and rolls to buy it. Sniping is about PRICE, not
  // value — a $4,000 grail at 20% off draws the same crowd as a $2 common,
  // but at a slower rate (huge tickets move like grails, not commons).
  const fb = feedback()
  const scanMult = feedbackMult(fb.avg)
  for (let scan = 0; scan < 2; scan++) {
    // Promoted listings get a dedicated featured scan before the organic one:
    // the best-discounted ACTIVE promotion is examined first, every tick.
    const current = sniperFeed()
    if (current.length === 0) break
    const scored = current
      .map((l) => {
        const market = l.m && l.m > 0 ? l.m : l.market_at_list
        return { l, discount: market > 0 ? 1 - l.ask / market : 0 }
      })
      .sort((a, b) => b.discount - a.discount)
    if (scan === 0) {
      const featured = scored.find((s) => s.l.promoted_ticks > 0)
      if (featured && featured.discount + EPS >= MIN_DISCOUNT) {
        const perUnit = featured.l.m ?? featured.l.market_at_list
        const liq = 1 / liquidityFactor(perUnit)
        const buyChance = Math.min(0.75, featured.discount * 1.9 * liq * scanMult)
        if (Math.random() < buyChance) {
          buyOut(featured.l)
          continue
        }
      }
    }
    const best = scored[0]
    if (!best || best.discount + EPS < MIN_DISCOUNT) continue // nothing underpriced enough to bother
    // Liquidity gates how fast pricey cards move, exactly like market listings.
    const perUnit = best.l.m ?? best.l.market_at_list
    const liq = 1 / liquidityFactor(perUnit)
    const buyChance = Math.min(0.75, best.discount * 1.9 * liq * scanMult)
    if (Math.random() >= buyChance) continue
    buyOut(best.l)
  }
}

function buyOut(l: ListingRow) {
  const inv = db.prepare(`SELECT * FROM inventory WHERE id = ? AND status = 'collection'`).get(l.inventory_id) as
    | { id: number; quantity: number }
    | undefined
  if (!inv) {
    // The binder row moved on (sold/graded elsewhere) — the listing is stale.
    db.prepare(`UPDATE ebay_listings SET status = 'cancelled' WHERE id = ?`).run(l.id)
    return
  }
  const qty = Math.min(l.quantity, inv.quantity)
  const gross = round2(l.ask * qty)
  const fee = round2(gross * FEE_RATE)
  // Placeholder until the seller picks real postage at ship time (shipping.ts
  // overwrites the listing's shipping/net with the booked values).
  const shipping = shippingCost(gross)
  const net = round2(gross - fee - shipping)
  const buyer = pick(BUYER_NAMES)
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(l.card_id) as { name: string }).name
  db.prepare(
    `UPDATE ebay_listings SET status = 'sold', buyer = ?, sold_price = ?, fee = ?, shipping = ?, net = ?, sold_at = ?, quantity = ? WHERE id = ?`,
  ).run(buyer, l.ask, fee, shipping, net, nowIso(), qty, l.id)
  if (qty >= inv.quantity) {
    db.prepare(`UPDATE inventory SET status = 'sold', quantity = 0 WHERE id = ?`).run(inv.id)
  } else {
    db.prepare(`UPDATE inventory SET quantity = quantity - ? WHERE id = ?`).run(qty, inv.id)
  }
  // Feedback: the discount the buyer caught drives the stars — a deep cut is
  // a 5-star event, overpaying earns grumbles even when they chose to buy.
  const market = l.market_at_list
  const paidRatio = market > 0 ? l.ask / market : 1
  const stars = paidRatio <= 0.75 ? 5 : paidRatio <= 0.95 ? pick([4, 5]) : paidRatio <= 1.1 ? pick([3, 4]) : pick([1, 2, 3])
  const comment = stars >= 4 ? pick(HAPPY) : stars === 3 ? pick(NEUTRAL) : pick(UNHAPPY)
  db.prepare(`INSERT INTO ebay_feedback (listing_id, buyer, stars, comment, created_at) VALUES (?, ?, ?, ?, ?)`).run(l.id, buyer, stars, comment, nowIso())
  logActivity('ebay', `BidBay: ${qty > 1 ? `${qty}× ` : ''}${name} SNIPED by ${buyer} at $${gross.toFixed(2)} (fee $${fee.toFixed(2)}) — waiting on the seller to ship.`, gross)
  // The money waits in escrow until the seller packs and ships (see shipping.ts).
  shipsvc.ensureForSale({ kind: 'fixed', id: l.id }, l.card_id, qty, gross, fee, net, buyer)
}

/** Shipping: flat $1 base + 4% of the order (bigger orders cost more to move). */
function shippingCost(gross: number): number {
  return round2(1 + gross * 0.04)
}

function payOutShipped() {
  const rows = db.prepare(`SELECT * FROM ebay_listings WHERE status = 'sold' AND paid = 0 AND ships_at IS NOT NULL AND ships_at <= ?`).all(nowIso()) as ListingRow[]
  for (const l of rows) {
    db.prepare(`UPDATE ebay_listings SET paid = 1 WHERE id = ?`).run(l.id)
    db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(l.net ?? 0)
    pnlAppend('overhead', -(l.fee ?? 0), 'BidBay seller fees')
    pnlAppend('overhead', -(l.shipping ?? 0), 'BidBay shipping')
    const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(l.card_id) as { name: string }).name
    logActivity('ebay', `BidBay payout: $${(l.net ?? 0).toFixed(2)} for ${name} (after $${(l.fee ?? 0).toFixed(2)} fee + $${(l.shipping ?? 0).toFixed(2)} shipping)`, l.net ?? 0)
  }
}

// ---------------------------------------------------------------------------
// Channel conflict — BidBay listings siphon walk-in traffic from the shop.
// ---------------------------------------------------------------------------

/** Multiplier the shop tick applies to walk-in chances: ~0.55 with a wall of
 *  online listings, 1.0 with none. Deliberately blunt: every live listing
 *  competes for the same local collectors, whatever it's priced at. */
export function shopTrafficFactor(): number {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM ebay_listings WHERE status = 'live'`).get() as { n: number }).n
  return Math.max(0.55, 1 - n * 0.03)
}

/** Tutorial gate: first real listing flips the /api/state flag. */
function markTaught() {
  if (getMeta('tut:ebay') !== '1') setMeta('tut:ebay', '1')
}

// ---------------------------------------------------------------------------
// Auction mode — put a card on the block and let the room fight over it.
// NPC bidders escalate on hot cards; every bid raises the "heat" and invites
// one more bidder. The snipe guard (house rules) applies here too.
// ---------------------------------------------------------------------------

const BIDDER_NAMES = ['Grady', 'Marge', 'Ollie', 'Petra', 'Silas', 'Nadia', 'Gus', 'Winnie', 'Hank', 'Dee', 'Rufus', 'Lola', 'Casper', 'Mabel']
const EA_AUCTION_MS = 240_000 // ~12 market ticks — enough room for a real war
const EA_FEE_RATE = 0.15 // auction houses take a bigger cut than fixed-price

export type EbayAuctionRow = {
  id: number
  inventory_id: number
  card_id: string
  condition: string
  quantity: number
  start: number
  market_at_list: number
  current_bid: number
  bid_count: number
  leader: string | null
  extended: number
  status: string
  fee: number | null
  shipping: number | null
  net: number | null
  paid: number
  closes_at: string
  ships_at: string | null
  name?: string
  image_small?: string | null
  set_name?: string | null
}

/** Put a card (or a ×N stack) on the block. Opening bid: 25–45% of market —
 *  the gamble is the whole point. */
export function startAuction(inventoryId: number, startBid?: number): { ok: boolean; error?: string; start?: number } {
  markTaught()
  const row = db.prepare(`SELECT * FROM inventory WHERE id = ? AND status = 'collection'`).get(inventoryId) as
    | { id: number; card_id: string; variant: string; condition: string; quantity: number; graded_grade: string | null }
    | undefined
  if (!row) return { ok: false, error: 'Card is not in your collection' }
  if (row.graded_grade) return { ok: false, error: 'Graded slabs belong at the auction house — BidBay is raw cardboard' }
  // AUTH META: known fakes trade nowhere but the training wall.
  const fakeErr = (db.prepare('SELECT fake_revealed FROM inventory WHERE id = ?').get(inventoryId) as { fake_revealed: number } | undefined)?.fake_revealed
    ? 'Known counterfeit — buylist shops pay $1 flat for it (Inventory → 🛡 Authentication)'
    : null
  if (fakeErr) return { ok: false, error: fakeErr }
  const open = db.prepare(`SELECT COUNT(*) AS n FROM ebay_auctions WHERE inventory_id = ? AND status = 'live'`).get(inventoryId) as { n: number }
  if (open.n > 0) return { ok: false, error: 'That card is already on the block' }
  const fixed = db.prepare(`SELECT COUNT(*) AS n FROM ebay_listings WHERE inventory_id = ? AND status = 'live'`).get(inventoryId) as { n: number }
  if (fixed.n > 0) return { ok: false, error: `Cancel the fixed-price listing first — a card can't be in two sales at once` }
  const m = resolvePrice(row.card_id, row.variant || 'normal', (row.condition as Condition) || 'NM').usd
  if (m == null) return { ok: false, error: 'No market data for that card yet' }
  const market = round2(m)
  const auto = round2(market * (0.25 + Math.random() * 0.2))
  const start = startBid != null && startBid > 0 ? round2(startBid) : auto
  if (start >= market * 0.8) return { ok: false, error: `Opening bid too greedy — keep it under ~$${round2(market * 0.8).toFixed(2)} or just list it fixed-price` }
  db.prepare(
    `INSERT INTO ebay_auctions (inventory_id, card_id, variant, condition, quantity, start, market_at_list, listed_at, closes_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.card_id, row.variant || 'normal', row.condition, row.quantity, start, market, nowIso(), new Date(Date.now() + EA_AUCTION_MS).toISOString())
  cleanupSlotsForInventory([row.id])
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(row.card_id) as { name: string }).name
  logActivity('ebay', `🔨 ${row.quantity > 1 ? `${row.quantity}× ` : ''}${name} on the BidBay block — opening $${start.toFixed(2)} (market $${market.toFixed(2)}). The room is warming up…`, 0)
  return { ok: true, start }
}

/** Live auctions feed for the UI, soonest hammer first, plus recently settled lots. */
export function listEbayAuctions() {
  db.prepare(`UPDATE ebay_auctions SET status = 'expired' WHERE status = 'live' AND closes_at <= ? AND bid_count = 0`).run(nowIso())
  const live = db
    .prepare(
      `SELECT ea.*, c.name, c.image_small, s.name AS set_name
       FROM ebay_auctions ea JOIN cards c ON c.id = ea.card_id LEFT JOIN sets s ON s.id = c.set_id
       WHERE ea.status = 'live' ORDER BY ea.closes_at ASC`,
    )
    .all() as EbayAuctionRow[]
  const recent = db
    .prepare(
      `SELECT ea.*, c.name, c.image_small, s.name AS set_name
       FROM ebay_auctions ea JOIN cards c ON c.id = ea.card_id LEFT JOIN sets s ON s.id = c.set_id
       WHERE ea.status IN ('sold', 'expired') ORDER BY COALESCE(ea.sold_at, ea.closes_at) DESC LIMIT 8`,
    )
    .all() as EbayAuctionRow[]
  return { live, recent }
}

export function cancelEbayAuction(id: number): { ok: boolean; error?: string } {
  const a = db.prepare(`SELECT * FROM ebay_auctions WHERE id = ? AND status = 'live'`).get(id) as EbayAuctionRow | undefined
  if (!a) return { ok: false, error: 'Lot is not live' }
  if (a.bid_count > 0) return { ok: false, error: `${a.leader ?? 'A bidder'} is already in at $${a.current_bid.toFixed(2)} — no pulling the lot now` }
  db.prepare(`UPDATE ebay_auctions SET status = 'cancelled' WHERE id = ?`).run(id)
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(a.card_id) as { name: string }).name
  logActivity('ebay', `Pulled ${name} from the block before the first bid.`)
  return { ok: true }
}

/** The room: each tick, bidders weigh in. Heat — momentum from recent bids —
 *  drives how many raise, how aggressively they jump, and recruits one more
 *  bidder per fresh bid. A card the room wants can run well past market. */
function ebayAuctionTick() {
  const live = db.prepare(`SELECT * FROM ebay_auctions WHERE status = 'live' AND closes_at > ?`).all(nowIso()) as EbayAuctionRow[]
  for (const a of live) {
    if (a.bid_count === 0) {
      // Cold room: nothing until someone cracks and takes the opening bid.
      if (Math.random() < 0.28) {
        const openBidder = pick(BIDDER_NAMES)
        db.prepare(`UPDATE ebay_auctions SET current_bid = ?, bid_count = 1, leader = ? WHERE id = ?`).run(a.start, openBidder, a.id)
        bidChatter(a, null, openBidder, a.start, true)
      }
      continue
    }
    const heat = Math.min(2.5, 0.6 + a.bid_count * 0.18)
    const market = a.market_at_list * a.quantity
    const roomCap = market * (1.1 + Math.random() * 0.7) // the room's collective ceiling tonight
    const current = a.current_bid
    if (current >= roomCap) continue // the room has spent what it will spend
    const increment = Math.max(0.25, round2(current * (0.04 + Math.random() * 0.05) * heat))
    const next = round2(Math.min(current + increment, roomCap))
    if (next <= current) continue
    // Bidder count grows with heat: each fresh bid recruits one more looker.
    const activeBidders = Math.min(BIDDER_NAMES.length, 2 + Math.floor(a.bid_count * 0.7))
    const raiseChance = Math.min(0.9, 0.45 * heat * (0.8 + activeBidders * 0.05))
    if (Math.random() >= raiseChance) continue
    let newLeader = a.leader
    for (let tries = 0; tries < 4 && newLeader === a.leader; tries++) newLeader = pick(BIDDER_NAMES)
    if (newLeader === a.leader || newLeader == null) continue
    // House snipe guard: a late bid extends the lot once, exactly like the house.
    const msLeft = new Date(a.closes_at).getTime() - Date.now()
    let closes = a.closes_at
    if (msLeft < 30_000 && !a.extended) {
      closes = new Date(Date.now() + 30_000).toISOString()
      db.prepare(`UPDATE ebay_auctions SET extended = 1 WHERE id = ?`).run(a.id)
      bidChatter(a, a.leader, newLeader, next, false, true)
    }
    db.prepare(`UPDATE ebay_auctions SET current_bid = ?, bid_count = bid_count + 1, leader = ?, closes_at = ? WHERE id = ?`).run(next, newLeader, closes, a.id)
    if (closes === a.closes_at) bidChatter(a, a.leader, newLeader, next, false)
  }
  // Hammer: settle live lots whose clock ran out (bid or no bid).
  const done = db.prepare(`SELECT * FROM ebay_auctions WHERE status = 'live' AND closes_at <= ?`).all(nowIso()) as EbayAuctionRow[]
  for (const a of done) {
    if (a.bid_count === 0) {
      db.prepare(`UPDATE ebay_auctions SET status = 'expired' WHERE id = ?`).run(a.id)
      const nm = (db.prepare('SELECT name FROM cards WHERE id = ?').get(a.card_id) as { name: string }).name
      logActivity('ebay', `🔨 ${nm} expired unsold at $${a.start.toFixed(2)} — the room passed.`)
      continue
    }
    hammerFall(a)
  }
}

function bidChatter(a: EbayAuctionRow, from: string | null, to: string, amount: number, opening = false, extended = false) {
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(a.card_id) as { name: string }).name
  const verb = opening ? 'opens at' : 'raises to'
  const fromTxt = from ? ` over ${from}` : ''
  const ext = extended ? ' ⏱️ extended 30s!' : ''
  logActivity('ebay', `🔨 ${to} ${verb} $${amount.toFixed(2)}${fromTxt} on ${a.quantity > 1 ? `${a.quantity}× ` : ''}${name}.${ext}`, 0)
}

/** Hammer falls with a winner: fee (15%), shipping delay, payout — like every
 *  BidBay sale, but the price was decided by a room full of people. */
function hammerFall(a: EbayAuctionRow) {
  const gross = round2(a.current_bid)
  const fee = round2(gross * EA_FEE_RATE)
  const shipping = shippingCost(gross)
  const net = round2(gross - fee - shipping)
  const winner = a.leader ?? pick(BIDDER_NAMES)
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(a.card_id) as { name: string }).name
  db.prepare(`UPDATE ebay_auctions SET status = 'sold', fee = ?, shipping = ?, net = ?, paid = 0, sold_at = ?, leader = ? WHERE id = ?`).run(fee, shipping, net, nowIso(), winner, a.id)
  // The card leaves the binder at hammer time.
  const inv = db.prepare(`SELECT * FROM inventory WHERE id = ? AND status = 'collection'`).get(a.inventory_id) as { id: number; quantity: number } | undefined
  if (inv) {
    if (a.quantity >= inv.quantity) db.prepare(`UPDATE inventory SET status = 'sold', quantity = 0 WHERE id = ?`).run(inv.id)
    else db.prepare(`UPDATE inventory SET quantity = quantity - ? WHERE id = ?`).run(a.quantity, inv.id)
  }
  const vs = gross / Math.max(a.market_at_list * a.quantity, 0.01) - 1
  logActivity('ebay', `🔨 HAMMER: ${a.quantity > 1 ? `${a.quantity}× ` : ''}${name} to ${winner} at $${gross.toFixed(2)} (${vs >= 0 ? '+' : ''}${(vs * 100).toFixed(0)}% vs market) — fee $${fee.toFixed(2)}, waiting on the seller to ship.`, 0)
  // The money waits in escrow until the seller packs and ships (see shipping.ts).
  shipsvc.ensureForSale({ kind: 'auction', id: a.id }, a.card_id, a.quantity, gross, fee, net, winner)
}

/** Escrowed auction payouts land after the envelope "arrives." */
function payOutAuctionShipped() {
  const rows = db.prepare(`SELECT * FROM ebay_auctions WHERE status = 'sold' AND paid = 0 AND ships_at IS NOT NULL AND ships_at <= ?`).all(nowIso()) as EbayAuctionRow[]
  for (const a of rows) {
    db.prepare(`UPDATE ebay_auctions SET paid = 1 WHERE id = ?`).run(a.id)
    db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(a.net ?? 0)
    pnlAppend('overhead', -(a.fee ?? 0), 'BidBay auction fee')
    pnlAppend('overhead', -(a.shipping ?? 0), 'BidBay shipping')
    const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(a.card_id) as { name: string }).name
    logActivity('ebay', `BidBay auction payout: $${(a.net ?? 0).toFixed(2)} for ${name} (after $${(a.fee ?? 0).toFixed(2)} house fee + $${(a.shipping ?? 0).toFixed(2)} shipping)`, a.net ?? 0)
  }
}

// ---------------------------------------------------------------------------
// NPC-run auctions on the hunt — you bid against rival bots for hot cards.
// Proxy bidding: your max is escrowed and hidden; the price only rises one
// increment over the challenger. Outbid = instant refund. No buyer's premium.
// ---------------------------------------------------------------------------

const NPC_AUCTION_CAP = 3
const NPC_AUCTION_MS = 150_000

export type NpcAuctionRow = {
  id: number
  card_id: string
  condition: string
  quantity: number
  market_at_list: number
  current_bid: number
  min_next: number
  leader: string | null
  my_escrow: number
  my_max: number
  bid_count: number
  status: string
  hammer: number | null
  winner: string | null
  closes_at: string
  name?: string
  image_small?: string | null
  set_name?: string | null
}

/** Seed up to cap live NPC lots: hot cards (market ≥ $3) at 40–60% of market. */
function seedNpcAuctions() {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM ebay_npc_auctions WHERE status = 'live'`).get() as { n: number }).n
  if (n >= NPC_AUCTION_CAP) return
  if (Math.random() > 0.5) return
  const rows = db
    .prepare(
      `SELECT c.id, pr.market FROM cards c
       JOIN price_records pr ON pr.card_id = c.id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL
       WHERE pr.market >= 3
       AND c.id NOT IN (SELECT card_id FROM ebay_npc_auctions WHERE status = 'live')
       ORDER BY RANDOM() LIMIT ?`,
    )
    .all(NPC_AUCTION_CAP - n) as { id: string; market: number }[]
  for (const r of rows) {
    const market = round2(r.market)
    const open = round2(market * (0.4 + Math.random() * 0.2))
    db.prepare(
      `INSERT INTO ebay_npc_auctions (card_id, condition, quantity, market_at_list, current_bid, min_next, listed_at, closes_at)
       VALUES (?, 'NM', 1, ?, ?, ?, ?, ?)`,
    ).run(r.id, market, open, round2(open), nowIso(), new Date(Date.now() + NPC_AUCTION_MS).toISOString())
    const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(r.id) as { name: string }).name
    logActivity('ebay', `🔨 ${name} is on the block at $${open.toFixed(2)} (market $${market.toFixed(2)}) — bidding is open.`, 0)
  }
}

/** Live NPC lots for the UI, soonest hammer first. */
export function listNpcAuctions() {
  return db
    .prepare(
      `SELECT na.*, c.name, c.image_small, s.name AS set_name
       FROM ebay_npc_auctions na JOIN cards c ON c.id = na.card_id LEFT JOIN sets s ON s.id = c.set_id
       WHERE na.status = 'live' ORDER BY na.closes_at ASC`,
    )
    .all() as NpcAuctionRow[]
}

/** Your proxy bid: escrow the max, pay only one increment over the rival.
 *  Outbid later = instant refund. The real eBay feel. */
export function bidNpcAuction(id: number, maxBid: number): { ok: boolean; error?: string; message?: string } {
  const a = db.prepare(`SELECT * FROM ebay_npc_auctions WHERE id = ? AND status = 'live'`).get(id) as NpcAuctionRow | undefined
  if (!a) return { ok: false, error: 'That lot is gone' }
  const msLeft = new Date(a.closes_at).getTime() - Date.now()
  if (msLeft <= 0) return { ok: false, error: 'The hammer already fell' }
  const max = round2(maxBid)
  if (max < a.min_next) return { ok: false, error: `Bid at least $${a.min_next.toFixed(2)}` }

  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  const available = state.cash + a.my_escrow
  if (max > available) return { ok: false, error: `Escrow needs $${max.toFixed(2)} — you have $${available.toFixed(2)} free` }

  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(a.card_id) as { name: string }).name
  const increment = Math.max(0.25, round2(a.current_bid * 0.06))

  // Secret tiebreak: bots have hidden maxes; if the player's max beats the
  // current leader's, the price lands one increment over the loser's max.
  const botMax = a.leader === 'you' ? 0 : a.current_bid > 0 ? round2(a.current_bid + Math.random() * a.current_bid * 0.5) : 0

  if (a.leader === 'you') {
    // Raising your own max: just re-escrow the difference.
    if (max <= a.my_max) return { ok: false, error: `You already hold the lead at a $${a.my_max.toFixed(2)} max` }
    const extra = round2(max - a.my_max)
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(extra)
    db.prepare(`UPDATE ebay_npc_auctions SET my_max = ? WHERE id = ?`).run(max, a.id)
    return { ok: true, message: `Max raised to $${max.toFixed(2)} — escrow topped up $${extra.toFixed(2)}.` }
  }

  if (max > botMax) {
    // Player takes the lead: pay one increment over the runner-up (or the
    // opening price when no bot has committed yet).
    const floor = botMax > 0 ? botMax + increment : a.current_bid > 0 ? a.current_bid + increment : a.min_next
    const lead = round2(Math.min(max, Math.max(a.min_next, floor)))
    // Refund any prior escrow (outbid earlier), escrow the new lead.
    if (a.my_escrow > 0) db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(a.my_escrow)
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(lead)
    db.prepare(`UPDATE ebay_npc_auctions SET current_bid = ?, min_next = ?, leader = 'you', my_escrow = ?, my_max = ?, bid_count = bid_count + 1 WHERE id = ?`).run(lead, round2(lead + increment), lead, max, a.id)
    // Snipe guard: a late player bid extends the lot once.
    if (msLeft < 30_000 && getMeta(`npcSnipe:${a.id}`) !== '1') {
      setMeta(`npcSnipe:${a.id}`, '1')
      db.prepare(`UPDATE ebay_npc_auctions SET closes_at = ? WHERE id = ?`).run(new Date(Date.now() + 30_000).toISOString(), a.id)
      return { ok: true, message: `You lead at $${lead.toFixed(2)} — escrowed. ⏱️ Extended 30s!` }
    }
    return { ok: true, message: `You lead at $${lead.toFixed(2)} — escrowed. Rivals can still counter.` }
  }

  // Bot's hidden max is higher: counter at one increment over YOUR max.
  const counter = round2(Math.min(botMax, max + increment))
  if (a.my_escrow > 0) db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(a.my_escrow)
  db.prepare(`UPDATE ebay_npc_auctions SET current_bid = ?, min_next = ?, leader = ?, bid_count = bid_count + 1 WHERE id = ?`).run(counter, round2(counter + increment), pick(BIDDER_NAMES), a.id)
  logActivity('ebay', `Outbid on ${name} — ${'a rival'} countered at $${counter.toFixed(2)}. Escrow refunded.`, 0)
  return { ok: true, message: `Outbid instantly — a rival's hidden max is higher. $${a.my_escrow.toFixed(2)} escrow refunded.` }
}

/** NPC auction ticks: bots pile on hot lots and the hammer falls on time. */
function npcAuctionTick() {
  const live = db.prepare(`SELECT * FROM ebay_npc_auctions WHERE status = 'live'`).all() as NpcAuctionRow[]
  for (const a of live) {
    const msLeft = new Date(a.closes_at).getTime() - Date.now()
    if (msLeft <= 0) {
      settleNpcAuction(a)
      continue
    }
    // Rival bots raise the price until near their appetite; skip if you lead
    // (your hidden max is the wall) — but bots occasionally test it anyway.
    const heat = Math.min(2.5, 0.6 + a.bid_count * 0.18)
    const roomCap = a.market_at_list * (1.05 + Math.random() * 0.5)
    if (a.current_bid >= roomCap) continue
    if (a.leader === 'you' && Math.random() > 0.25) continue // your max holds — for now
    const increment = Math.max(0.25, round2(a.current_bid * (0.05 + Math.random() * 0.06) * heat))
    if (a.leader === 'you') {
      // A challenge is a bot with a HIDDEN max, not a nibble: eBay proxy rules.
      // Otherwise any player max above ~65% of market would be unassailable
      // (the price only ever nibbled up 5-11% from a stagnant base).
      const botMax = Math.min(roomCap, round2(a.current_bid * U(1.1, 1.45)))
      if (botMax > a.my_max) {
        // Player outbid: price lands one increment over THEIR max.
        const price = round2(Math.min(botMax, a.my_max + increment))
        db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(a.my_escrow)
        db.prepare(`UPDATE ebay_npc_auctions SET current_bid = ?, min_next = ?, leader = ?, my_escrow = 0, my_max = 0, bid_count = bid_count + 1 WHERE id = ?`).run(price, round2(price + increment), pick(BIDDER_NAMES), a.id)
        const nm = (db.prepare('SELECT name FROM cards WHERE id = ?').get(a.card_id) as { name: string }).name
        logActivity('ebay', `Outbid on ${nm} — a rival's max beat yours at $${price.toFixed(2)}. $${a.my_escrow.toFixed(2)} escrow refunded.`, 0)
      } else {
        // Your proxy absorbs the challenger, but the price rises to the
        // loser's max + increment — and your escrow tops up to cover it
        // (you authorized up to your max; the hammer refunds the unused part).
        const price = round2(Math.min(a.my_max, botMax + increment))
        if (price <= a.current_bid) continue
        const topUp = round2(price - a.current_bid)
        db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(topUp)
        db.prepare(`UPDATE ebay_npc_auctions SET current_bid = ?, min_next = ?, my_escrow = ?, bid_count = bid_count + 1 WHERE id = ?`).run(price, round2(price + increment), price, a.id)
        const nm2 = (db.prepare('SELECT name FROM cards WHERE id = ?').get(a.card_id) as { name: string }).name
        logActivity('ebay', `A rival challenged ${nm2} — your proxy held at $${price.toFixed(2)} (escrow topped up $${topUp.toFixed(2)}).`, 0)
      }
      continue
    }
    const next = round2(Math.min(a.current_bid + increment, roomCap))
    if (next <= a.current_bid) continue
    db.prepare(`UPDATE ebay_npc_auctions SET current_bid = ?, min_next = ?, leader = ?, bid_count = bid_count + 1 WHERE id = ?`).run(next, round2(next + increment), pick(BIDDER_NAMES), a.id)
  }
}

/** Hammer: winner gets the card in the binder (cost basis = hammer price);
 *  if that's you, the escrow becomes the payment. Losers were refunded at
 *  outbid time — nothing left to settle. */
function settleNpcAuction(a: NpcAuctionRow) {
  if (a.bid_count === 0) {
    db.prepare(`UPDATE ebay_npc_auctions SET status = 'passed', settled_at = ? WHERE id = ?`).run(nowIso(), a.id)
    return
  }
  const winner = a.leader ?? 'a rival'
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(a.card_id) as { name: string }).name
  if (winner === 'you') {
    db.prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
                VALUES (?, 'normal', ?, 1, 'collection', 'market', ?, ?)`).run(a.card_id, a.condition, a.current_bid, nowIso())
    // The hammer is what you pay — refund whatever escrow headroom your max
    // didn't need (proxy bidding pays the runner-up's price, never your max).
    const overage = round2(a.my_escrow - a.current_bid)
    if (overage > 0) db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(overage)
    logActivity('ebay', `🔨 YOU WON ${name} at $${a.current_bid.toFixed(2)} — escrow applied${overage > 0 ? `, $${overage.toFixed(2)} overage refunded` : ''}, card in the binder.`, 0)
  } else {
    logActivity('ebay', `🔨 ${name} hammered to ${winner} at $${a.current_bid.toFixed(2)} — you weren't the highest max.`, 0)
  }
  db.prepare(`UPDATE ebay_npc_auctions SET status = 'sold', hammer = ?, winner = ?, settled_at = ? WHERE id = ?`).run(a.current_bid, winner, nowIso(), a.id)
}

// ---------------------------------------------------------------------------
// Watch-list — "tell me when X shows up on BidBay." Cursor-based: each watch
// stores the highest market/auction row id it has already considered, so a new
// listing is exactly "an id above the cursor." Fires at most once per listing
// per watch (the cursor advances), and the hunt's 8h rotation means stock
// genuinely turns over. NPC auction watches fire once per NEW lot of that
// card (the old lot is settled/dead by then — capped at 3 live at a time).
// ---------------------------------------------------------------------------

type WatchRow = { id: number; card_id: string; max_price: number | null; last_market_id: number; last_auction_id: number }

export function watch(cardId: string, maxPrice: number | null): { ok: boolean; error?: string } {
  const card = db.prepare(`SELECT name FROM cards WHERE id = ?`).get(cardId) as { name: string } | undefined
  if (!card) return { ok: false, error: 'Unknown card' }
  const capped = maxPrice != null && maxPrice > 0 ? round2(maxPrice) : null
  db.prepare(
    `INSERT INTO ebay_watches (card_id, max_price, last_market_id, last_auction_id, created_at)
     VALUES (?, ?, (SELECT COALESCE(MAX(id),0) FROM ebay_market), (SELECT COALESCE(MAX(id),0) FROM ebay_npc_auctions), ?)
     ON CONFLICT(card_id) DO UPDATE SET max_price = excluded.max_price`,
  ).run(cardId, capped, nowIso())
  return { ok: true }
}

export function unwatch(cardId: string): { ok: boolean } {
  db.prepare(`DELETE FROM ebay_watches WHERE card_id = ?`).run(cardId)
  return { ok: true }
}

export function watches() {
  return db
    .prepare(
      `SELECT w.*, c.name, c.image_small, s.name AS set_name
       FROM ebay_watches w JOIN cards c ON c.id = w.card_id LEFT JOIN sets s ON s.id = c.set_id
       ORDER BY w.created_at DESC`,
    )
    .all() as (WatchRow & { name: string; image_small: string | null; set_name: string | null })[]
}

/** Runs right after seeding in ebayTick — sees everything the seed step just
 *  inserted, before rival bots have a chance to buy it. */
export function watchTick() {
  const fire = (cardId: string, msg: string) => {
    const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(cardId) as { name: string }).name
    logActivity('ebay', msg.replace('%CARD%', name), 0)
  }
  for (const w of db.prepare(`SELECT * FROM ebay_watches`).all() as WatchRow[]) {
    // Hunt feed: every new row above the cursor, price-gated by the max.
    const hunts = db
      .prepare(`SELECT * FROM ebay_market WHERE id > ? AND card_id = ? ORDER BY id`)
      .all(w.last_market_id, w.card_id) as MarketRow[]
    for (const l of hunts) {
      const per = round2(l.ask)
      if (w.max_price == null || per <= w.max_price) {
        fire(w.card_id, `🔔 %CARD% just hit BidBay — ${l.seller} at $${per.toFixed(2)}/ea${l.quantity > 1 ? ` (${l.quantity}× lot, $${round2(l.ask * l.quantity).toFixed(2)})` : ''}${w.max_price != null ? ` — under your $${w.max_price.toFixed(2)} cap` : ''}.`)
      }
      db.prepare(`UPDATE ebay_watches SET last_market_id = ? WHERE id = ?`).run(l.id, w.id)
    }
    // NPC auctions: a NEW live lot of this card above the cursor.
    const lots = db
      .prepare(`SELECT * FROM ebay_npc_auctions WHERE id > ? AND card_id = ? AND status = 'live' ORDER BY id`)
      .all(w.last_auction_id, w.card_id) as NpcAuctionRow[]
    for (const a of lots) {
      const open = round2(a.current_bid)
      if (w.max_price == null || open <= w.max_price) {
        fire(w.card_id, `🔔 %CARD% is on the BidBay block — opening at $${open.toFixed(2)}${w.max_price != null ? ` (under your $${w.max_price.toFixed(2)} cap)` : ''} — bidding is live.`)
      }
      db.prepare(`UPDATE ebay_watches SET last_auction_id = ? WHERE id = ?`).run(a.id, w.id)
    }
  }
}
