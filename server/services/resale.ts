import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { valueOf, valueOfRow, round2, type Condition } from './market'
import { cleanupSlotsForInventory } from './binders'
import * as vault from './vault'

// ---------------------------------------------------------------------------
// Phase 4 — Reselling operation. Sellers with real cards message you offers;
// the ask deviates from true market value (their noise is your margin). Buy a
// lot and it lands in your inventory as flip stock; flip it by instant dealer
// offer (fast cash below market) or by listing at market like everything else.
// The ledger tracks capital deployed, realized P&L, and ROI per deal.
// ---------------------------------------------------------------------------

type SellerProfile = {
  type: string
  label: string
  minV: number
  maxV: number
  /** Ask as a multiple of true value. */
  askLow: number
  askHigh: number
  minCards: number
  maxCards: number
  blurb: string[]
}

const SELLERS: SellerProfile[] = [
  {
    type: 'collection', label: 'Collection Seller', minV: 1, maxV: 400, askLow: 0.45, askHigh: 0.85, minCards: 4, maxCards: 12,
    blurb: ['Selling the collection, no time wasters please.', 'Everything must go this weekend.', 'Prices are firm-ish. Bring cash vibes.'],
  },
  {
    type: 'dupes', label: 'Bulk Dupes Seller', minV: 0.3, maxV: 15, askLow: 0.3, askHigh: 0.7, minCards: 8, maxCards: 25,
    blurb: ['Got doubles of loads of these.', 'Bulk box cleanup — take the lot.', 'These were spares in my dupes binder.'],
  },
  {
    type: 'chase', label: 'Chase Chaser', minV: 30, maxV: 600, askLow: 0.65, askHigh: 1.1, minCards: 1, maxCards: 3,
    blurb: ['Need gone ASAP, priced to move.', 'You know what this is. Cash only.', 'Might regret selling this tomorrow.'],
  },
  {
    type: 'storage', label: 'Storage Unit Find', minV: 0.5, maxV: 200, askLow: 0.25, askHigh: 0.6, minCards: 10, maxCards: 30,
    blurb: ['Unit cleared out, boxes of cards inside.', 'No idea what these are worth.', 'Take it all, it is taking up my garage.'],
  },
]

const SELLER_NAMES = [
  'Dave M.', 'Karen O.', 'Luis G.', 'Priya S.', 'Marcus T.', 'Ellen W.', 'Toby H.', 'Rosa D.',
  'Chen W.', 'Big Mike', 'Sam P.', 'Nadia K.', 'Grumpy Gary', 'Honest Helen', 'Fast Freddie',
]

type DealRow = {
  id: number
  seller: string
  seller_type: string
  message: string
  ask: number
  true_value: number
  haggled: number
  status: string
  created_at: string
  expires_at: string
}

type LotCard = { cardId: string; name: string; image: string | null; setName: string; condition: Condition; market: number }

const nameStmt = db.prepare('SELECT name, set_id FROM cards WHERE id = ?')
const setStmt = db.prepare('SELECT name FROM sets WHERE id = ?')

function cardMeta(cardId: string): { name: string; setName: string } {
  const c = nameStmt.get(cardId) as { name: string; set_id: string } | undefined
  const s = c ? (setStmt.get(c.set_id) as { name: string } | undefined) : undefined
  return { name: c?.name ?? cardId, setName: s?.name ?? '' }
}

const imgStmt = db.prepare(`SELECT image_small FROM cards WHERE id = ?`)
function cardImage(cardId: string): string | null {
  return (imgStmt.get(cardId) as { image_small: string | null } | undefined)?.image_small ?? null
}

function sampleLotCards(profile: SellerProfile): { cardId: string; condition: Condition; market: number }[] {
  const n = profile.minCards + Math.floor(Math.random() * (profile.maxCards - profile.minCards + 1))
  // Sample from the SAME price the player realizes: kind='tcgplayer' with a
  // 'normal' variant row. Sampling any kind (simulated rows included) valued
  // holo-only promos at a fraction of their real holofoil ask and handed the
  // desk a 2.4× windfall the sellers never actually offered.
  const rows = db
    .prepare(
      `SELECT c.id, pr.market
       FROM cards c
       JOIN price_records pr ON pr.card_id = c.id AND pr.variant = 'normal' AND pr.kind = 'tcgplayer'
       WHERE c.supertype = 'Pokémon' AND pr.market IS NOT NULL AND pr.market >= ? AND pr.market <= ?
       ORDER BY RANDOM() LIMIT ?`,
    )
    .all(profile.minV, profile.maxV, n * 2) as { id: string; market: number }[]
  const usable = rows.filter((r) => r.market != null).slice(0, n)
  const conditions: Condition[] = ['NM', 'NM', 'NM', 'LP', 'LP', 'MP', 'HP', 'DM']
  return usable.map((r) => {
    const condition = conditions[Math.floor(Math.random() * conditions.length)]
    const mult = condition === 'NM' ? 1 : condition === 'LP' ? 0.8 : condition === 'MP' ? 0.65 : condition === 'HP' ? 0.5 : 0.35
    return { cardId: r.id, condition, market: round2(r.market * mult) }
  })
}

function ensureOpenDeal() {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM resale_deals WHERE status = 'open'`).get() as { n: number }).n
  if (n >= 3) return
  const profile = SELLERS[Math.floor(Math.random() * SELLERS.length)]
  const cards = sampleLotCards(profile)
  if (cards.length < profile.minCards) return
  const trueValue = round2(cards.reduce((a, c) => a + c.market, 0))
  if (trueValue < 2) return
  const noise = profile.askLow + Math.random() * (profile.askHigh - profile.askLow)
  const ask = Math.max(1, round2(trueValue * noise))
  const seller = SELLER_NAMES[Math.floor(Math.random() * SELLER_NAMES.length)]
  const message = profile.blurb[Math.floor(Math.random() * profile.blurb.length)]
  const info = db
    .prepare(
      `INSERT INTO resale_deals (seller, seller_type, message, ask, true_value, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
    )
    // ISO, not datetime('now','+2 hours'): every reader compares expires_at to
    // nowIso() with plain string ordering, and SQLite format (' 20:26') sorts
    // BELOW ISO ('T20:26') on the same date — deals died the tick they were
    // created, which made ensureOpenDeal re-run its full price_records sample
    // on every tick (server-wide CPU peg) while the inbox showed nothing.
    .run(seller, profile.type, message, ask, trueValue, nowIso(), new Date(Date.now() + 2 * 3600_000).toISOString())
  const dealId = Number(info.lastInsertRowid)
  const ins = db.prepare(`INSERT INTO resale_deal_cards (deal_id, card_id, condition, position) VALUES (?, ?, ?, ?)`)
  cards.forEach((c, i) => ins.run(dealId, c.cardId, c.condition, i))
}

export function inbox() {
  // Marketplace churn keeps the inbox alive; generated on read like other NPC systems.
  if (Math.random() < 0.4) ensureOpenDeal()
  const rows = db
    .prepare(`SELECT * FROM resale_deals WHERE status = 'open' AND expires_at > ? ORDER BY id DESC`)
    .all(nowIso()) as DealRow[]
  return rows.map((d) => {
    const cards = dealCards(d.id)
    const margin = d.ask > 0 ? (d.true_value - d.ask) / d.ask : 0
    return {
      id: d.id,
      seller: d.seller,
      sellerType: d.seller_type,
      message: d.message,
      ask: d.ask,
      cards: cards.length,
      preview: cards.slice(0, 6),
      trueValueKnown: d.haggled > 0,
      estTrueValue: d.haggled > 0 ? d.true_value : round2(d.ask * (0.9 + Math.random() * 0.5)),
      margin: Math.round(margin * 100),
      expiresAt: d.expires_at,
    }
  })
}

function dealCards(dealId: number): LotCard[] {
  const rows = db
    .prepare(`SELECT card_id, condition FROM resale_deal_cards WHERE deal_id = ? ORDER BY position`)
    .all(dealId) as { card_id: string; condition: Condition }[]
  return rows.map((r) => {
    const mult = r.condition === 'NM' ? 1 : r.condition === 'LP' ? 0.8 : r.condition === 'MP' ? 0.65 : r.condition === 'HP' ? 0.5 : 0.35
    const market = round2(valueOf(r.card_id) * mult)
    const meta = cardMeta(r.card_id)
    return { cardId: r.card_id, name: meta.name, image: cardImage(r.card_id), setName: meta.setName, condition: r.condition, market }
  })
}

export function inspectDeal(id: number) {
  const d = db.prepare(`SELECT * FROM resale_deals WHERE id = ? AND status = 'open'`).get(id) as DealRow | undefined
  if (!d) return { ok: false as const, error: 'Deal not found or gone' }
  return { ok: true as const, cards: dealCards(id), ask: d.ask, trueValue: d.true_value, count: dealCards(id).length }
}

export function haggleDeal(id: number) {
  const d = db.prepare(`SELECT * FROM resale_deals WHERE id = ? AND status = 'open' AND haggled = 0`).get(id) as DealRow | undefined
  if (!d) return { ok: false as const, error: 'Already haggled or gone' }
  // One counteroffer: the seller meets you partway between their ask and
  // their floor (just above true value). Only worth it when the ask is high.
  const floor = d.true_value * 1.05
  const counter = round2(d.ask <= floor * 1.08 ? d.ask : floor + (d.ask - floor) * (0.35 + Math.random() * 0.3))
  db.prepare(`UPDATE resale_deals SET haggled = 1, ask = ? WHERE id = ?`).run(counter, id)
  return { ok: true as const, counter, sellerReply: 'Tell you what — ' + '$' + counter.toFixed(2) + ' and it is yours. Final offer.' }
}

export function buyDeal(id: number) {
  const d = db.prepare(`SELECT * FROM resale_deals WHERE id = ? AND status = 'open'`).get(id) as DealRow | undefined
  if (!d) return { ok: false as const, error: 'Deal not found or gone' }
  // First-use tutorial gate: buying (or trying to buy) a lot counts as taught.
  if (getMeta('tut:resale') !== '1') setMeta('tut:resale', '1')
  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < d.ask) return { ok: false as const, error: `Ask is $${d.ask.toFixed(2)} — not enough cash` }

  const cards = dealCards(d.id)
  if (cards.length === 0) return { ok: false as const, error: 'Lot is empty' }
  // Storage & the vault: make room per the overflow policy — whatever still
  // doesn't fit stays with the seller (full ask is still the price of the deal).
  const rawCount = cards.length
  const admitted = vault.makeRoomFor(rawCount, 'Resale lot')
  if (admitted <= 0) {
    return { ok: false as const, error: 'Resale lot: no room on the shelf — sell or scrap before buying another lot.' }
  }
  const perCard = round2(d.ask / rawCount)
  // Keep the card's REAL condition: the ask was discounted for LP/MP/HP copies,
  // so booking them all as NM would launder worn cardboard into near-mint (the
  // dealer desk would then pay NM rates for it).
  const ins = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at, acquired_ref)
     VALUES (?, 'normal', ?, 1, 'collection', 'resale', ?, ?, ?)`,
  )
  const added: { inventoryId: number; cardId: string; condition: string }[] = []
  const addInv = db.transaction(() => {
    for (const c of cards.slice(0, admitted)) {
      const res = ins.run(c.cardId, c.condition, perCard, nowIso(), `resale_deal:${d.id}`)
      added.push({ inventoryId: Number(res.lastInsertRowid), cardId: c.cardId, condition: c.condition })
    }
  })
  addInv()
  // Dealer lots are pre-owned cardboard of unknown provenance (auth.ts).
  import('./auth').then((a) => a.stampRiskBatch(added, 'resale')).catch(() => {})

  db.prepare(`UPDATE resale_deals SET status = 'bought' WHERE id = ?`).run(d.id)
  logActivity('resale', `Bought ${cards.length} cards from ${d.seller} for $${d.ask.toFixed(2)} (est. $${d.true_value.toFixed(2)} value).`, -d.ask)

  return { ok: true as const, bought: cards.length, spent: d.ask, estValue: d.true_value }
}

export function walkDeal(id: number) {
  db.prepare(`UPDATE resale_deals SET status = 'walked' WHERE id = ? AND status = 'open'`).run(id)
  return { ok: true as const }
}

export function expireDeals() {
  db.prepare(`UPDATE resale_deals SET status = 'expired' WHERE status = 'open' AND expires_at <= ?`).run(nowIso())
}

// ------------------------- Flip stock desk -------------------------

const DEALER_NAMES = ['QuickFlip Quinns', 'CaseFresh Cards', 'The Buylist Bin', 'WallStreet Slabs', 'Corner Shop Cards']

/** Instant dealer offers on held flip stock: 70–92% of market, cash now. */
export function flipStock() {
  const rows = db
    .prepare(`SELECT id, card_id, variant, condition, quantity, graded_grade, cost_basis, acquired_at, acquired_ref FROM inventory WHERE status = 'collection' AND acquired_via = 'resale' ORDER BY acquired_at DESC`)
    .all() as { id: number; card_id: string; variant: string; condition: string; quantity: number; graded_grade: string | null; cost_basis: number; acquired_at: string; acquired_ref: string | null }[]
  const dealer = DEALER_NAMES[Math.floor(Math.random() * DEALER_NAMES.length)]
  const lots = rows.map((r) => {
    const market = round2(valueOfRow({ card_id: r.card_id, variant: r.variant, condition: r.condition, graded_grade: r.graded_grade }))
    const basis = round2(r.cost_basis * r.quantity)
    const mult = 0.7 + Math.random() * 0.22
    const offer = round2(market * mult)
    return {
      inventoryId: r.id,
      cardId: r.card_id,
      costBasis: basis,
      market,
      offer,
      marginPct: market > 0 ? Math.round(((offer - basis) / Math.max(basis, 0.01)) * 100) : 0,
      heldSince: r.acquired_at,
    }
  })
  return { dealer, lots }
}

export function instantSell(inventoryId: number) {
  const r = db
    .prepare(`SELECT id, card_id, variant, condition, quantity, graded_grade, cost_basis, acquired_via FROM inventory WHERE id = ? AND status = 'collection'`)
    .get(inventoryId) as { id: number; card_id: string; variant: string; condition: string; quantity: number; graded_grade: string | null; cost_basis: number; acquired_via: string } | undefined
  if (!r) return { ok: false as const, error: 'Card not in stock' }
  const market = round2(valueOfRow({ card_id: r.card_id, variant: r.variant, condition: r.condition, graded_grade: r.graded_grade }))
  const mult = 0.7 + Math.random() * 0.22
  const offer = round2(market * mult)
  const fee = 0
  const proceeds = offer
  const cost = round2(r.cost_basis * r.quantity)
  const profit = round2(proceeds - cost)

  const sellRow = db.prepare(`UPDATE inventory SET status = 'sold', quantity = 0 WHERE id = ?`)
  const insertSale = db.prepare(
    `INSERT INTO sale_history (inventory_id, card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'instant', ?)`,
  )
  sellRow.run(r.id)
  cleanupSlotsForInventory([r.id])
  insertSale.run(r.id, r.card_id, r.variant, r.condition, r.quantity, proceeds, cost, fee, profit, 'Instant dealer', nowIso())
  db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(proceeds)
  const name = cardMeta(r.card_id).name
  logActivity('resale', `Instant-sold ${name} to the dealer for $${proceeds.toFixed(2)} (market $${market.toFixed(2)}). ${profit >= 0 ? 'Profit' : 'Loss'} $${Math.abs(profit).toFixed(2)}.`, proceeds)

  return { ok: true as const, proceeds, profit, market }
}

// ------------------------- Ledger -------------------------

export function ledger() {
  const deployed = db
    .prepare(`SELECT COALESCE(SUM(ask), 0) AS t FROM resale_deals WHERE status = 'bought'`)
    .get() as { t: number }
  const stock = db
    .prepare(`SELECT id, card_id, variant, condition, quantity, graded_grade, cost_basis FROM inventory WHERE status = 'collection' AND acquired_via = 'resale'`)
    .all() as { id: number; card_id: string; variant: string; condition: string; quantity: number; graded_grade: string | null; cost_basis: number }[]
  let stockValue = 0
  let stockBasis = 0
  for (const r of stock) {
    stockValue += valueOfRow({ card_id: r.card_id, variant: r.variant, condition: r.condition, graded_grade: r.graded_grade }) * r.quantity
    stockBasis += r.cost_basis * r.quantity
  }
  const realized = db
    .prepare(
      `SELECT COALESCE(SUM(sale_price), 0) AS proceeds, COUNT(*) AS n
       FROM sale_history sh JOIN inventory i ON i.id = sh.inventory_id
       WHERE sh.sale_type = 'instant' AND i.acquired_via = 'resale'`,
    )
    .get() as { proceeds: number; n: number }
  // Listed flip stock that already sold through normal market listing:
  const listedRealized = db
    .prepare(
      `SELECT COALESCE(SUM(sh.profit), 0) AS profit, COUNT(*) AS n FROM sale_history sh
       JOIN inventory i ON i.id = sh.inventory_id WHERE i.acquired_via = 'resale' AND sh.sale_type != 'instant'`,
    )
    .get() as { profit: number; n: number }

  const totalRealized = round2(listedRealized.profit + instantProfit())
  const unrealized = round2(stockValue - stockBasis)
  return {
    capitalDeployed: round2(deployed.t),
    stockCount: stock.length,
    stockValue: round2(stockValue),
    stockBasis: round2(stockBasis),
    unrealized,
    instantSales: realized.n,
    instantProceeds: round2(realized.proceeds),
    marketSales: listedRealized.n,
    realized: totalRealized,
    roiPct: deployed.t > 0 ? Math.round(((totalRealized + unrealized) / deployed.t) * 100) : 0,
  }
}

function instantProfit(): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sh.profit), 0) AS p FROM sale_history sh JOIN inventory i ON i.id = sh.inventory_id
       WHERE sh.sale_type = 'instant' AND i.acquired_via = 'resale'`,
    )
    .get() as { p: number }
  return row.p
}

export function resaleTick() {
  expireDeals()
  if (Math.random() < 0.5) ensureOpenDeal()
}
