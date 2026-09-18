import { db, nowIso, logActivity } from '../lib/db'
import { valueOf, round2, type Condition } from './market'
import * as finance from './finance'
import * as staff from './staff'
import * as bulk from './bulk'
import * as grabbags from './grabbags'
import * as pnl from './pnl'
import * as salesTax from './salestax'
import { isNonprofit, NONPROFIT_TRAFFIC_FACTOR, NONPROFIT_SPEND_FACTOR } from './tax'
import * as shopstats from './shopstats'

// ---------------------------------------------------------------------------
// The Card Shop — a permanent storefront (Phase 4). Daily rent, display cases
// stocked from your own collection, walk-in customers whose traffic follows
// the time of day, your prices vs real market, and your shop's reputation.
// Stocked cards live in inventory with status 'in_case' (ask in listing_price),
// so binders/listings/graders/vendor tables can't touch them while displayed.
// ---------------------------------------------------------------------------

// Migrations for databases created before the shop existed.
try { db.exec(`ALTER TABLE shop ADD COLUMN today_customers INTEGER NOT NULL DEFAULT 0`) } catch { /* exists */ }
try { db.exec(`ALTER TABLE shop ADD COLUMN today_revenue REAL NOT NULL DEFAULT 0`) } catch { /* exists */ }
try { db.exec(`ALTER TABLE shop ADD COLUMN no_sale_streak INTEGER NOT NULL DEFAULT 0`) } catch { /* exists */ }

export type ShopTier = 'hole-in-the-wall' | 'storefront' | 'flagship'

const TIERS: { id: ShopTier; label: string; blurb: string; deposit: number; rent: number }[] = [
  { id: 'hole-in-the-wall', label: 'Hole-in-the-wall', blurb: 'A narrow slot between a laundromat and a phone repair kiosk.', deposit: 250, rent: 12 },
  { id: 'storefront', label: 'Storefront', blurb: 'Real windows, real sign, a door that opens with intention.', deposit: 900, rent: 45 },
  { id: 'flagship', label: 'Flagship', blurb: 'The corner location everyone in the scene knows by name.', deposit: 3000, rent: 140 },
]

const BUYER_NAMES = ['Kyle', 'Amara', 'Theo', 'Sofia', 'Dev', 'Nina', 'Marcus', 'Ellie', 'Raj', 'June', 'Wes', 'Cora']

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

type ShopRow = {
  id: 1
  name: string
  tier: ShopTier
  opened_at: string
  last_rent_day: string | null
  reputation: number
  lifetime_revenue: number
  lifetime_cost: number
  customer_count: number
  today_customers: number
  today_revenue: number
  no_sale_streak: number
}

export function getShop(): ShopRow | undefined {
  return db.prepare(`SELECT * FROM shop WHERE id = 1`).get() as ShopRow | undefined
}

function dayKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Rent — charged once per UTC day on the first tick that crosses midnight.
// Rent only bites while you're actually stocked; empty cases earn a waiver.
// ---------------------------------------------------------------------------

export function settleRent() {
  const shop = getShop()
  if (!shop) return
  const today = dayKey()
  if (shop.last_rent_day === today) return
  const stocked = (db.prepare(`SELECT COALESCE(SUM(i.quantity),0) AS n FROM shop_case_cards scc JOIN inventory i ON i.id = scc.inventory_id`).get() as { n: number }).n
  const tier = TIERS.find((t) => t.id === shop.tier)!
  const rent = tier.rent
  db.prepare(`UPDATE shop SET today_customers = 0, today_revenue = 0, last_rent_day = ? WHERE id = 1`).run(today)
  if (stocked === 0) {
    const streak = shop.no_sale_streak + 1
    db.prepare(`UPDATE shop SET no_sale_streak = ? WHERE id = 1`).run(streak)
    logActivity('shop', `New day at ${shop.name} — cases empty, landlord skipped the rent (day ${streak} dark). Don't make a habit of it.`, 0)
    return
  }
  db.prepare(`UPDATE shop SET no_sale_streak = 0 WHERE id = 1`).run()
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  let overdrafted = false
  if (state.cash < rent) {
    // Cash-flow pressure: the bank auto-drafts what you're short (at a painful
    // rate). No credit left? The draft bounces and the bank keeps score.
    const covered = finance.draftRent(rent)
    if (!covered) return
    overdrafted = true
  }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(rent)
  pnl.append('rent', -rent, overdrafted ? 'paid via overdraft' : '')
  // Payroll drafts alongside rent and books its own ledger line.
  staff.payRollDay(true)
  logActivity('shop', `Rent day at ${shop.name}: -$${rent.toFixed(2)} (${stocked} cards on display)`, -rent)
}

// ---------------------------------------------------------------------------
// Leasing
// ---------------------------------------------------------------------------

export function lease(name: string, tier: ShopTier) {
  if (getShop()) return { ok: false as const, error: 'You already run a card shop' }
  const t = TIERS.find((x) => x.id === tier)
  if (!t) return { ok: false as const, error: 'Unknown shop tier' }
  const clean = (name ?? '').trim().slice(0, 40)
  if (!clean) return { ok: false as const, error: 'Give the shop a name' }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < t.deposit) return { ok: false as const, error: `Lease deposit is $${t.deposit.toFixed(2)} — not enough cash` }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(t.deposit)
  db.prepare(`INSERT INTO shop (id, name, tier, opened_at, last_rent_day) VALUES (1, ?, ?, ?, ?)`).run(clean, t.id, nowIso(), dayKey())
  logActivity('shop', `Signed the lease on "${clean}" (${t.label}) — $${t.deposit.toFixed(2)} deposit, $${t.rent.toFixed(2)}/day. Time to stock some cases.`, -t.deposit)
  return { ok: true as const, name: clean, tier: t.id, deposit: t.deposit }
}

export function closeShop() {
  const shop = getShop()
  if (!shop) return { ok: false as const, error: 'No shop to close' }
  const cased = db.prepare(`SELECT inventory_id FROM shop_case_cards`).all() as { inventory_id: number }[]
  db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL WHERE status = 'in_case'`).run()
  db.prepare(`DELETE FROM shop_case_cards`).run()
  const caseKeys = (db.prepare(`SELECT key FROM meta WHERE key LIKE 'shopCase:%'`).all() as { key: string }[]).map((k) => k.key)
  for (const k of caseKeys) db.prepare(`DELETE FROM meta WHERE key = ?`).run(k)
  db.prepare(`DELETE FROM shop WHERE id = 1`).run()
  const profit = round2(shop.lifetime_revenue - shop.lifetime_cost)
  logActivity('shop', `Closed ${shop.name}. ${cased.length} card${cased.length === 1 ? '' : 's'} back in the binder. Lifetime: $${shop.lifetime_revenue.toFixed(2)} revenue over ${shop.customer_count} sales (${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} net of goods).`)
  return { ok: true as const }
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export function caseList() {
  const rows = db.prepare(`SELECT * FROM shop_cases ORDER BY price`).all() as { id: number; tier: string; label: string; blurb: string; price: number; slots: number }[]
  const tierOrder: ShopTier[] = ['hole-in-the-wall', 'storefront', 'flagship']
  const shop = getShop()
  return rows.map((c) => {
    const marker = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(`shopCase:${c.id}`)
    const used = (db.prepare(`SELECT COUNT(*) AS n FROM shop_case_cards WHERE case_id = ?`).get(c.id) as { n: number }).n
    return {
      ...c,
      owned: Boolean(marker),
      used,
      locked: shop ? tierOrder.indexOf(c.tier as ShopTier) > tierOrder.indexOf(shop.tier) : false,
    }
  })
}

export function buyCase(caseId: number) {
  const shop = getShop()
  if (!shop) return { ok: false as const, error: 'Lease a shop first' }
  const c = db.prepare(`SELECT * FROM shop_cases WHERE id = ?`).get(caseId) as { id: number; tier: string; label: string; price: number; slots: number } | undefined
  if (!c) return { ok: false as const, error: 'No such case' }
  const tierOrder: ShopTier[] = ['hole-in-the-wall', 'storefront', 'flagship']
  if (tierOrder.indexOf(c.tier as ShopTier) > tierOrder.indexOf(shop.tier)) {
    return { ok: false as const, error: `${c.label} needs a ${c.tier} lease` }
  }
  const marker = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(`shopCase:${caseId}`)
  if (marker) return { ok: false as const, error: `${c.label} is already on the floor` }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < c.price) return { ok: false as const, error: `${c.label} costs $${c.price.toFixed(2)} — not enough cash` }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(c.price)
  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(`shopCase:${caseId}`, nowIso())
  logActivity('shop', `Bought the ${c.label} (${c.slots} slots) for $${c.price.toFixed(2)} — installed and ready to stock.`, -c.price)
  return { ok: true as const, label: c.label }
}

// ---------------------------------------------------------------------------
// Stocking — from your own collection, at your own ask
// ---------------------------------------------------------------------------

export function stock(caseId: number, inventoryId: number, ask: number) {
  const shop = getShop()
  if (!shop) return { ok: false as const, error: 'Lease a shop first' }
  const marker = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(`shopCase:${caseId}`)
  if (!marker) return { ok: false as const, error: 'Buy that case first' }
  if (!ask || ask <= 0) return { ok: false as const, error: 'Set a real price' }
  const c = db.prepare(`SELECT slots FROM shop_cases WHERE id = ?`).get(caseId) as { slots: number } | undefined
  if (!c) return { ok: false as const, error: 'No such case' }
  const used = (db.prepare(`SELECT COUNT(*) AS n FROM shop_case_cards WHERE case_id = ?`).get(caseId) as { n: number }).n
  if (used >= c.slots) return { ok: false as const, error: 'That case is full' }
  const row = db
    .prepare(`SELECT id, card_id, status, graded_grade FROM inventory WHERE id = ?`)
    .get(inventoryId) as { id: number; card_id: string; status: string; graded_grade: string | null } | undefined
  if (!row) return { ok: false as const, error: 'Card not found' }
  if (row.status !== 'collection') return { ok: false as const, error: 'Only cards sitting in your collection can go in a case' }
  if (row.graded_grade) return { ok: false as const, error: 'Slabs only go in the Locked slab tower — buy that case first' }
  // A card can only live in one display at a time: stocking frees any binder pocket.
  import('./binders').then((b) => b.cleanupSlotsForInventory([inventoryId])).catch(() => {})
  db.prepare(`UPDATE inventory SET status = 'in_case', listing_price = ?, listed_at = ? WHERE id = ?`).run(round2(ask), nowIso(), inventoryId)
  db.prepare(`INSERT INTO shop_case_cards (case_id, inventory_id) VALUES (?, ?)`).run(caseId, inventoryId)
  const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(row.card_id) as { name: string }).name
  logActivity('shop', `Displayed ${name} in the case at $${ask.toFixed(2)}`)
  return { ok: true as const }
}

export function unstock(inventoryId: number) {
  const shop = getShop()
  if (!shop) return { ok: false as const, error: 'No shop' }
  const row = db.prepare(`SELECT case_id FROM shop_case_cards WHERE inventory_id = ?`).get(inventoryId) as { case_id: number } | undefined
  if (!row) return { ok: false as const, error: 'That card is not displayed' }
  db.prepare(`DELETE FROM shop_case_cards WHERE inventory_id = ?`).run(inventoryId)
  db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL WHERE id = ?`).run(inventoryId)
  return { ok: true as const }
}

/** Collection rows eligible for cases: raw, unlisted, with a market value to price against. */
export function stockableInventory() {
  const rows = db
    .prepare(
      `SELECT i.id, i.card_id, i.variant, i.condition, i.quantity, i.cost_basis,
              c.name, c.image_small, c.rarity, c.number, s.name AS set_name
       FROM inventory i JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
       WHERE i.status = 'collection' AND i.graded_grade IS NULL
       ORDER BY i.favorite DESC, i.acquired_at DESC LIMIT 200`,
    )
    .all() as { id: number; card_id: string; variant: string; condition: string; quantity: number; cost_basis: number; name: string; image_small: string | null; rarity: string | null; number: string; set_name: string }[]
  const out = rows.map((r) => {
    const anchor = valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
    return { ...r, anchor, suggestedAsk: round2(anchor) }
  })
  return { ok: true as const, rows: out }
}

// ---------------------------------------------------------------------------
// Walk-in customers — the heartbeat of a real shop
// ---------------------------------------------------------------------------

/** 0..1 hour-of-day curve: dead overnight, lunch bump, evening peak. */
function hourCurve(): number {
  const h = new Date().getHours()
  if (h >= 0 && h < 8) return 0.02
  if (h < 11) return 0.35
  if (h < 14) return 0.75 // lunch bump
  if (h < 16) return 0.55
  if (h < 20) return 1.0 // evening peak
  if (h < 22) return 0.5
  return 0.1
}

function repMultiplier(rep: number): number {
  // 1.0 at neutral, ±25% across the working reputation band.
  return Math.max(0.55, 1 + rep / 100)
}

export function shopTick() {
  const shop = getShop()
  if (!shop) return
  settleRent()
  // Staff do their work on the same clock as the customers.
  try { import('./staff').then((s) => s.staffTick()).catch(() => {}) } catch { /* non-fatal */ }
  // Dollar-bin pickers dig between the case browsers; gamblers eye the bags.
  try { bulk.bulkTick() } catch { /* non-fatal */ }
  try { grabbags.bagTick() } catch { /* non-fatal */ }
  // Daily rollup for the dashboard captures after the day's money events.
  try { shopstats.captureDaily() } catch { /* non-fatal */ }


  const displayed = db
    .prepare(
      `SELECT scc.case_id, i.id, i.card_id, i.variant, i.condition, i.quantity, i.listing_price, i.cost_basis
       FROM shop_case_cards scc JOIN inventory i ON i.id = scc.inventory_id`,
    )
    .all() as { case_id: number; id: number; card_id: string; variant: string; condition: string; quantity: number; listing_price: number | null; cost_basis: number }[]
  if (displayed.length === 0) return

  const hour = hourCurve()
  const rep = repMultiplier(shop.reputation)
  // A nonprofit's customers browse with good intentions and thinner wallets.
  const nonprofit = isNonprofit()
  // Counter help keeps browsers at the register longer.
  let counter = 1
  try { counter = staff.counterBoost() } catch { /* non-fatal */ }
  const insertSale = db.prepare(
    `INSERT INTO shop_sales (case_id, inventory_id, card_id, quantity, price, cost_basis, buyer, sold_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  let cashIn = 0
  let costOut = 0
  let sales = 0

  for (const r of displayed) {
    const ask = r.listing_price ?? 0
    if (ask <= 0) continue
    const anchor = valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
    if (anchor <= 0) continue // no market data — walk-ins can't judge it
    const ratio = ask / anchor
    // Shops live on trust: fair prices move steadily, gouging gets ignored,
    // deals build a crowd. (Slightly friendlier than the convention table.)
    const priceFactor = Math.min(1.5, Math.max(0.02, 1.45 - ratio))
    let chance = Math.min(0.26, 0.05 * hour * rep * counter * priceFactor)
    if (nonprofit) chance *= NONPROFIT_TRAFFIC_FACTOR
    if (Math.random() >= chance) continue
    const buyer = pick(BUYER_NAMES)
    const cost = round2(r.cost_basis * r.quantity)
    const profit = round2(ask - cost)
    const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(r.card_id) as { name: string }).name
    insertSale.run(r.case_id, r.id, r.card_id, r.quantity, ask, r.cost_basis, buyer, nowIso())
    db.prepare(`UPDATE inventory SET status = 'sold', quantity = 0 WHERE id = ?`).run(r.id)
    db.prepare(`DELETE FROM shop_case_cards WHERE inventory_id = ?`).run(r.id)
    db.prepare(
      `INSERT INTO sale_history (inventory_id, card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'shop', ?)`,
    ).run(r.id, r.card_id, r.variant, r.condition, r.quantity, ask, cost, profit, buyer, nowIso())
    cashIn += ask
    costOut += cost
    sales++
    // Reputation: fair deals earn word-of-mouth, gouging quietly costs you.
    const repDelta = ratio < 0.9 ? 1 : ratio > 1.2 ? -1 : 0
    if (repDelta !== 0) db.prepare(`UPDATE shop SET reputation = reputation + ? WHERE id = 1`).run(repDelta)
    logActivity(
      'shop',
      `Shop sale: ${name} → ${buyer} for $${ask.toFixed(2)} (${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} vs cost${ratio < 0.9 ? ' — word of mouth building' : ratio > 1.2 ? ' — overpriced, rep slipping' : ''})`,
      ask,
    )
  }

  if (cashIn > 0) {
    const take = nonprofit ? round2(cashIn * NONPROFIT_SPEND_FACTOR) : round2(cashIn)
    db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(take)
    db.prepare(
      `UPDATE shop SET lifetime_revenue = lifetime_revenue + ?, lifetime_cost = lifetime_cost + ?, customer_count = customer_count + ?, today_customers = today_customers + ?, today_revenue = today_revenue + ? WHERE id = 1`,
    ).run(take, round2(costOut), sales, sales, take)
    pnl.append('cases', take, nonprofit ? `${sales} case sale${sales === 1 ? '' : 's'} (donation-framed)` : `${sales} case sale${sales === 1 ? '' : 's'}`)
    // Nonprofits are exempt at the register — the mission covers the tax.
    if (!nonprofit) salesTax.collect('cases', cashIn, `${sales} sale${sales === 1 ? '' : 's'} at the register`)
    // Attribute the sale to counter staff when they're on duty.
    try { db.prepare(`UPDATE shop_employees SET sales_lift = sales_lift + ? WHERE role = 'counter'`).run(sales) } catch { /* non-fatal */ }
  }
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export function status() {
  const shop = getShop()
  if (!shop) {
    return { open: false as const, tiers: TIERS }
  }
  const cases = caseList().map((c) => {
    const cards = db
      .prepare(
        `SELECT i.id, i.card_id, i.variant, i.condition, i.quantity, i.listing_price, i.cost_basis,
                c.name, c.image_small, s.name AS set_name
         FROM shop_case_cards scc JOIN inventory i ON i.id = scc.inventory_id
         JOIN cards c ON c.id = i.card_id JOIN sets s ON s.id = c.set_id
         WHERE scc.case_id = ?`,
      )
      .all(c.id) as { id: number; card_id: string; variant: string; condition: string; quantity: number; listing_price: number | null; cost_basis: number; name: string; image_small: string | null; set_name: string }[]
    return {
      ...c,
      cards: cards.map((r) => {
        const ask = r.listing_price ?? 0
        const anchor = valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
        return { ...r, ask, anchor, delta: anchor > 0 ? ask / anchor - 1 : null }
      }),
    }
  })
  const recent = db
    .prepare(`SELECT ss.*, c.name FROM shop_sales ss JOIN cards c ON c.id = ss.card_id ORDER BY ss.id DESC LIMIT 12`)
    .all() as { id: number; card_id: string; quantity: number; price: number; cost_basis: number; buyer: string; sold_at: string; name: string }[]
  const boxes = bulk.status()
  const bags = grabbags.status()
  const tier = TIERS.find((t) => t.id === shop.tier)!
  const displayedUnits = cases.reduce((a, c) => a + c.cards.reduce((b, r) => b + r.quantity, 0), 0)
  return {
    open: true as const,
    shop: {
      name: shop.name,
      tier: shop.tier,
      tierLabel: tier.label,
      rent: tier.rent,
      reputation: shop.reputation,
      lifetimeRevenue: round2(shop.lifetime_revenue),
      lifetimeCost: round2(shop.lifetime_cost),
      customerCount: shop.customer_count,
      todayCustomers: shop.today_customers,
      todayRevenue: round2(shop.today_revenue),
      displayedUnits,
      bulkCards: boxes.reduce((a, b) => a + b.count, 0),
      bagsInShop: bags.bags.length,
    },
    cases,
    boxes,
    bags: bags.bags,
    bagHistory: bags.history,
    bagPrices: bags.prices,
    bagHitMultiplier: bags.hitMultiplier,
    recent: recent.map((r) => ({ ...r, profit: round2(r.price - r.cost_basis * r.quantity) })),
    salesTax: salesTax.status(),
  }
}
