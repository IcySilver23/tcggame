import { db, nowIso, logActivity } from '../lib/db'
import { gameDayMs, gameDayKey } from '../lib/gameday'
import { valueOf, liquidityFactor, round2, type Condition } from './market'
import { revealWithRead, marketFactor } from './substats'
import * as finance from './finance'
import * as staff from './staff'
import * as bulk from './bulk'
import * as grabbags from './grabbags'
import * as repacks from './repacks'
import { shopTrafficFactor } from './ebay'
import * as pnl from './pnl'
import * as salesTax from './salestax'
import * as tax from './tax'
import { isNonprofit, NONPROFIT_TRAFFIC_FACTOR, NONPROFIT_SPEND_FACTOR, roundUpsEnabled, ROUNDUP_OFFER_RATE, ROUNDUP_REP_CHANCE } from './tax'
import { rivalPoachFactor } from './rival'
import * as seasonal from './seasonal'
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
// RENT VS BUY (v0.5.97): buy the building out from under the landlord.
try { db.exec(`ALTER TABLE shop ADD COLUMN bought_at TEXT`) } catch { /* exists */ }
try { db.exec(`ALTER TABLE shop ADD COLUMN deed_price REAL`) } catch { /* exists */ }
try { db.exec(`ALTER TABLE shop ADD COLUMN last_rent_review TEXT`) } catch { /* exists */ }
try { db.exec(`ALTER TABLE shop ADD COLUMN rent_current REAL`) } catch { /* exists */ }
// Existing shops start their review clock now, so nobody gets a surprise
// increase the first time the new build boots.
try { db.prepare(`UPDATE shop SET last_rent_review = COALESCE(last_rent_review, ?)`).run(nowIso()) } catch { /* no shop yet */ }

export type ShopTier = 'hole-in-the-wall' | 'storefront' | 'flagship'

// Rents are per GAME-DAY (12 real hours) — half the old 24h-day numbers so
// real-world daily cost pressure stays where it was tuned.
const TIERS: { id: ShopTier; label: string; blurb: string; deposit: number; rent: number }[] = [
  { id: 'hole-in-the-wall', label: 'Hole-in-the-wall', blurb: 'A narrow slot between a laundromat and a phone repair kiosk.', deposit: 250, rent: 6 },
  { id: 'storefront', label: 'Storefront', blurb: 'Real windows, real sign, a door that opens with intention.', deposit: 900, rent: 22.5 },
  { id: 'flagship', label: 'Flagship', blurb: 'The corner location everyone in the scene knows by name.', deposit: 3000, rent: 70 },
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
  // RENT VS BUY (v0.5.97)
  bought_at: string | null
  deed_price: number | null
  last_rent_review: string | null
  rent_current: number | null
}

export function getShop(): ShopRow | undefined {
  return db.prepare(`SELECT * FROM shop WHERE id = 1`).get() as ShopRow | undefined
}

function dayKey(at = Date.now()): string {
  return gameDayKey(at) // shop rent is per game-day (12 real hours)
}

// ---------------------------------------------------------------------------
// Rent vs buy (v0.5.97) — the late-game decision.
//
// TENANTS: rent is charged once per game-day on the first tick that crosses the
// boundary (only while stocked — empty cases earn a waiver), and every few
// game-days the landlord reads the books. Revenue up, rent up — capped at 3×
// the tier's base so it can squeeze but never bankrupt the location.
//
// OWNERS: the deed swapped the landlord for a bank. Rent is $0 forever, and a
// mortgage drafts every game-day (stocked or not) until the balance clears —
// then the building costs nothing, permanently.
// ---------------------------------------------------------------------------

// RENT VS BUY tuning — all per game-day (12 real hours).
const REVIEW_EVERY_GAME_DAYS = 5     // landlord's review cadence
const REVIEW_UP_AT = 0.10            // revenue up ≥10% over the window → raise
const REVIEW_UP_PCT = 0.15           // ... by 15%
const REVIEW_DOWN_AT = -0.15         // revenue down ≥15% → he eases off
const REVIEW_DOWN_PCT = 0.08         // ... by 8%, never below the tier base
const RENT_CAP_MULT = 3              // a location's rent can never exceed 3× base
export const BUILDING_MULT = 400     // asking price = 400 × the tier's base rent
export const DOWN_PCT = 0.25         // cash down on the deed
export const MORTGAGE_RATE = 0.0015  // 0.15%/game-day on the balance
export const MORTGAGE_AMORT = 0.0035 // scheduled draft = 0.35% of principal/day

export function tierBaseRent(tier: ShopTier): number {
  return TIERS.find((t) => t.id === tier)?.rent ?? 0
}

/** What rent actually bites this game-day — $0 the moment you hold the deed. */
export function currentRent(s: ShopRow): number {
  if (s.bought_at != null) return 0
  return round2(s.rent_current ?? tierBaseRent(s.tier))
}

/** The landlord's cash price to sell you the building outright. */
export function buildingPrice(tier: ShopTier): number {
  return round2(BUILDING_MULT * tierBaseRent(tier))
}

type MortgageRow = {
  id: number
  kind: string
  lender: string
  principal: number
  balance: number
  rate_daily: number
  interest_paid: number
  issued_at: string
  last_accrual_day: string
  status: 'active' | 'repaid' | 'defaulted'
}

export function activeMortgage(): MortgageRow | undefined {
  return db.prepare(`SELECT * FROM loans WHERE kind = 'mortgage' AND status = 'active' ORDER BY id DESC LIMIT 1`).get() as MortgageRow | undefined
}

/** What the next mortgage draft charges: interest first, then amortized principal. */
export function mortgagePayment(m: { principal: number; balance: number; rate_daily: number }): number {
  const interest = round2(m.balance * m.rate_daily)
  const scheduled = Math.max(interest, round2(m.principal * MORTGAGE_AMORT))
  return round2(Math.min(m.balance + interest, scheduled))
}

/** Walk-in revenue inside a real-time window — what the landlord's review reads. */
function salesBetween(fromMs: number, toMs: number): number {
  const r = db
    .prepare(`SELECT COALESCE(SUM(price),0) AS t FROM shop_sales WHERE sold_at > ? AND sold_at <= ?`)
    .get(new Date(fromMs).toISOString(), new Date(toMs).toISOString()) as { t: number }
  return r.t
}

/** The landlord's review — runs after rent settles, so the new rate bites next game-day. */
function rentReview(s: ShopRow): void {
  const base = tierBaseRent(s.tier)
  const cur = s.rent_current ?? base
  const cap = round2(base * RENT_CAP_MULT)
  const win = REVIEW_EVERY_GAME_DAYS * gameDayMs()
  const now = Date.now()
  const lastMs = s.last_rent_review ? Date.parse(s.last_rent_review) : now - win
  if (now - lastMs < win) return // not due yet
  const recent = salesBetween(lastMs, now)
  const prior = salesBetween(lastMs - win, lastMs)
  const growth = prior > 0 ? (recent - prior) / prior : recent > 0 ? 1 : 0
  db.prepare(`UPDATE shop SET last_rent_review = ? WHERE id = 1`).run(nowIso())
  const pct = Math.round(growth * 100)
  if (growth >= REVIEW_UP_AT && cur < cap) {
    const next = round2(Math.min(cap, cur * (1 + REVIEW_UP_PCT)))
    if (next > cur) {
      db.prepare(`UPDATE shop SET rent_current = ? WHERE id = 1`).run(next)
      logActivity('shop', `Rent review: you moved $${recent.toFixed(2)} over ${REVIEW_EVERY_GAME_DAYS} game-days (${pct >= 0 ? '+' : ''}${pct}%), so rent goes $${cur.toFixed(2)} → $${next.toFixed(2)}/day${next >= cap ? ` — that's the ceiling for a ${s.tier}` : ''}. The landlord reads your success as his own.`, 0)
      return
    }
  }
  if (growth <= REVIEW_DOWN_AT && cur > base) {
    const next = round2(Math.max(base, cur * (1 - REVIEW_DOWN_PCT)))
    if (next < cur) {
      db.prepare(`UPDATE shop SET rent_current = ? WHERE id = 1`).run(next)
      logActivity('shop', `Rent review: sales fell ${pct}% to $${recent.toFixed(2)} over ${REVIEW_EVERY_GAME_DAYS} game-days — the landlord eased rent $${cur.toFixed(2)} → $${next.toFixed(2)}/day rather than lose the tenant.`, 0)
    }
  }
}

/** The daily mortgage draft: pay what you can, roll the rest into the balance. */
function draftMortgage(): void {
  const m = activeMortgage()
  if (!m) return
  const due = mortgagePayment(m)
  const avail = (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash
  const paid = round2(Math.min(avail, due))
  const short = round2(due - paid)
  const balance = round2(m.balance + m.balance * m.rate_daily - paid)
  if (paid > 0) {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(paid)
    pnl.append('mortgage', -paid, short > 0 ? `partial — ${short.toFixed(2)} rolled into principal` : 'daily draft')
  }
  if (balance <= 0.005) {
    db.prepare(`UPDATE loans SET balance = 0, status = 'repaid' WHERE id = ?`).run(m.id)
    logActivity('shop', `🏁 MORTGAGE PAID OFF — the last payment cleared and ${getShop()?.name ?? 'the shop'} is yours outright. No landlord, no bank, no daily rent. Every game-day from here, the overhead line reads $0.`, paid > 0 ? -paid : 0)
    return
  }
  db.prepare(`UPDATE loans SET balance = ? WHERE id = ?`).run(balance, m.id)
  if (short > 0) {
    logActivity('shop', `Mortgage draft came up $${short.toFixed(2)} short on $${avail.toFixed(2)} of cash — the bank rolled it into the balance ($${balance.toFixed(2)} still owed).`, -paid)
  }
}

export function settleRent() {
  const shop = getShop()
  if (!shop) return
  const today = dayKey()
  if (shop.last_rent_day === today) return
  const stocked = (db.prepare(`SELECT COALESCE(SUM(i.quantity),0) AS n FROM shop_case_cards scc JOIN inventory i ON i.id = scc.inventory_id`).get() as { n: number }).n
  const owned = shop.bought_at != null
  const rent = currentRent(shop)
  db.prepare(`UPDATE shop SET today_customers = 0, today_revenue = 0, last_rent_day = ? WHERE id = 1`).run(today)
  // The bank drafts whether or not the cases are stocked — the deed doesn't care.
  if (owned) draftMortgage()
  // The landlord reads the books on his own cadence — stocked or dark, his
  // review lands after today's rent was already quoted, so a new rate bites
  // from the next game-day on.
  if (!owned) rentReview(shop)
  if (stocked === 0) {
    const streak = shop.no_sale_streak + 1
    db.prepare(`UPDATE shop SET no_sale_streak = ? WHERE id = 1`).run(streak)
    logActivity('shop', owned
      ? `New day at ${shop.name} — cases empty (day ${streak} dark). The building is yours, so nobody's sending a bill. Just the display dust.`
      : `New day at ${shop.name} — cases empty, landlord skipped the rent (day ${streak} dark). Don't make a habit of it.`, 0)
    return
  }
  db.prepare(`UPDATE shop SET no_sale_streak = 0 WHERE id = 1`).run()
  if (!owned) {
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
    logActivity('shop', `Rent day at ${shop.name}: -$${rent.toFixed(2)} (${stocked} cards on display)`, -rent)
  }
  // Payroll drafts alongside rent and books its own ledger line.
  staff.payRollDay(true)
}

/**
 * Buy the building out from under the landlord: cash down, the rest on a
 * mortgage that drafts daily until it clears. No P&L row for the down payment
 * (it's principal, not an expense — the deductible line is the daily draft).
 */
export function buyBuilding() {
  const shop = getShop()
  if (!shop) return { ok: false as const, error: 'Lease a shop first' }
  if (shop.bought_at != null) return { ok: false as const, error: 'You already hold the deed' }
  const price = buildingPrice(shop.tier)
  const down = round2(price * DOWN_PCT)
  const principal = round2(price - down)
  const cash = (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash
  if (cash < down) {
    return { ok: false as const, error: `The deed is $${price.toFixed(2)} — ${Math.round(DOWN_PCT * 100)}% down is $${down.toFixed(2)} and you're holding $${cash.toFixed(2)}` }
  }
  const at = nowIso()
  const buy = db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(down)
    db.prepare(`INSERT INTO loans (kind, lender, principal, balance, rate_daily, issued_at, last_accrual_day) VALUES ('mortgage', ?, ?, ?, ?, ?, ?)`)
      .run('Title & Trust Mortgage', principal, principal, MORTGAGE_RATE, at, dayKey())
    db.prepare(`UPDATE shop SET bought_at = ?, deed_price = ? WHERE id = 1`).run(at, price)
  })
  buy()
  const daily = mortgagePayment({ principal, balance: principal, rate_daily: MORTGAGE_RATE })
  logActivity('shop', `🏠 BOUGHT THE BUILDING — ${shop.name} is yours for $${price.toFixed(2)}: $${down.toFixed(2)} down, $${principal.toFixed(2)} on a ${MORTGAGE_RATE * 100}%/game-day mortgage drafting $${daily.toFixed(2)}/day. Rent is now $0 and no landlord can ever raise it again.`, -down)
  return { ok: true as const, price, down, principal, daily, rate: MORTGAGE_RATE }
}

/** Everything the Shop header and the property card need to render the decision. */
function propertyView(s: ShopRow) {
  const base = tierBaseRent(s.tier)
  const price = buildingPrice(s.tier)
  const down = round2(price * DOWN_PCT)
  const principal = round2(price - down)
  const m = db.prepare(`SELECT * FROM loans WHERE kind = 'mortgage' ORDER BY id DESC LIMIT 1`).get() as MortgageRow | undefined
  const live = m?.status === 'active' ? m : undefined
  const win = REVIEW_EVERY_GAME_DAYS * gameDayMs()
  const lastMs = s.last_rent_review ? Date.parse(s.last_rent_review) : Date.now() - win
  return {
    owned: s.bought_at != null,
    boughtAt: s.bought_at,
    deedPrice: s.deed_price != null ? round2(s.deed_price) : null,
    price,
    down,
    principal,
    rate: MORTGAGE_RATE,
    daily: round2(principal * MORTGAGE_AMORT),
    rentBase: round2(base),
    rentCurrent: currentRent(s),
    rentCap: round2(base * RENT_CAP_MULT),
    reviewEveryDays: REVIEW_EVERY_GAME_DAYS,
    lastReviewAt: s.last_rent_review,
    nextReviewAt: new Date(lastMs + win).toISOString(),
    mortgage: m
      ? {
          id: m.id,
          lender: m.lender,
          principal: round2(m.principal),
          balance: round2(live ? m.balance : 0),
          rateDaily: m.rate_daily,
          daily: live ? mortgagePayment(live) : 0,
          paidOff: !live,
        }
      : null,
  }
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
  db.prepare(`INSERT INTO shop (id, name, tier, opened_at, last_rent_day, last_rent_review) VALUES (1, ?, ?, ?, ?, ?)`).run(clean, t.id, nowIso(), dayKey(), nowIso())
  logActivity('shop', `Signed the lease on "${clean}" (${t.label}) — $${t.deposit.toFixed(2)} deposit, $${t.rent.toFixed(2)}/day. Time to stock some cases.`, -t.deposit)
  return { ok: true as const, name: clean, tier: t.id, deposit: t.deposit }
}

export function closeShop() {
  const shop = getShop()
  if (!shop) return { ok: false as const, error: 'No shop to close' }
  // The flagship is the brand: no flagship, no chain.
  const franchiseOpen = db.prepare(`SELECT id FROM franchise LIMIT 1`).get()
  if (franchiseOpen) return { ok: false as const, error: 'Close your other locations first — the flagship carries the brand' }
  const dm = db.prepare(`SELECT value FROM meta WHERE key = 'chain:districtManager'`).get()
  if (dm) return { ok: false as const, error: 'Your district manager still runs stores — let them go first' }
  const cased = db.prepare(`SELECT inventory_id FROM shop_case_cards`).all() as { inventory_id: number }[]
  db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL WHERE status = 'in_case'`).run()
  db.prepare(`DELETE FROM shop_case_cards`).run()
  // Consigned cardboard goes back to its owners — never yours to keep.
  const consigned = (db.prepare(`SELECT COUNT(*) AS n FROM shop_consignments WHERE status IN ('offered','active')`).get() as { n: number }).n
  db.prepare(`UPDATE shop_consignments SET status = 'pulled' WHERE status IN ('offered','active')`).run()
  const caseKeys = (db.prepare(`SELECT key FROM meta WHERE key LIKE 'shopCase:%'`).all() as { key: string }[]).map((k) => k.key)
  for (const k of caseKeys) db.prepare(`DELETE FROM meta WHERE key = ?`).run(k)
  db.prepare(`DELETE FROM shop WHERE id = 1`).run()
  if (consigned > 0) logActivity('shop', `The counter closed with ${consigned} consigned card${consigned === 1 ? '' : 's'} on it — all handed back to their owners.`, 0)
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
  const onBlock = db.prepare(`SELECT COUNT(*) AS n FROM ebay_auctions WHERE inventory_id = ? AND status = 'live'`).get(inventoryId) as { n: number }
  if (onBlock.n > 0) return { ok: false as const, error: 'That card is on the BidBay auction block — pull the lot or wait for the hammer' }
  if (row.graded_grade) return { ok: false as const, error: 'Slabs only go in the Locked slab tower — buy that case first' }
  // AUTH META: known fakes trade nowhere but the training wall.
  const sf = db.prepare('SELECT fake_revealed, is_fake FROM inventory WHERE id = ?').get(inventoryId) as { fake_revealed: number; is_fake: number } | undefined
  if (sf && (sf.fake_revealed || sf.is_fake)) {
    return { ok: false as const, error: 'Known counterfeit — buylist shops pay $1 flat for it (Inventory → 🛡 Authentication)' }
  }
  // A card can only live in one display at a time: stocking frees any binder pocket.
  import('./binders').then((b) => b.cleanupSlotsForInventory([inventoryId])).catch(() => {})
  // …and any chain-shelf row, so a card can't be listed in a case and on a
  // satellite shelf at once. (Orphan rows from crashed transfers, mainly.)
  db.prepare(`DELETE FROM franchise_shelf_cards WHERE inventory_id = ?`).run(inventoryId)
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
    // Suggested ask covers the whole stack (per-unit × count) — sales credit ask × quantity.
    return { ...r, anchor, suggestedAsk: round2(anchor * r.quantity) }
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
  try { import('./staff').then((s) => { s.lifeTick(); s.staffTick() }).catch(() => {}) } catch { /* non-fatal */ }
  // Dollar-bin pickers dig between the case browsers; gamblers eye the bags.
  try { bulk.bulkTick() } catch { /* non-fatal */ }
  try { grabbags.bagTick() } catch { /* non-fatal */ }
  // Repacks sit on the same shelf: one pack leaves the run when a walk-in bites.
  try { repacks.repackTick() } catch { /* non-fatal */ }
  // Daily rollup for the dashboard captures after the day's money events.
  try { shopstats.captureDaily() } catch { /* non-fatal */ }
  // The consignment counter: NPC offers trickle in, walk-ins buy their stock.
  try { consignTick() } catch { /* non-fatal */ }


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
    `INSERT INTO shop_sales (case_id, inventory_id, card_id, quantity, price, cost_basis, buyer, sold_at, roundup)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  let cashIn = 0
  let costOut = 0
  let sales = 0
  // Suggested-donation round-ups: at a nonprofit register the till asks each
  // buyer to round the total up to the next dollar for the cause. Collected
  // separately from product money — it never touches margin or the tax base.
  const askRoundUp = nonprofit && roundUpsEnabled()

  for (const r of displayed) {
    const ask = r.listing_price ?? 0
    if (ask <= 0) continue
    // CONDITION WARS: a single copy in the case is under the shop lights —
    // its read is public and walk-ins pay the copy's sub-grade, not the band.
    const single = (r.quantity ?? 1) === 1
    if (single) revealWithRead(r.id)
    const anchor = valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
    if (anchor <= 0) continue // no market data — walk-ins can't judge it
    const copyAnchor = anchor * (single ? marketFactor(r.id) : 1)
    // The ask is PER UNIT (the stocking UI prices stacks at per-unit × count);
    // buyers judge fairness per card, and the sale credits ask × quantity.
    const unitAsk = ask / Math.max(1, r.quantity)
    const ratio = unitAsk / copyAnchor
    // Shops live on trust: fair prices move steadily, gouging gets ignored,
    // deals build a crowd. (Slightly friendlier than the convention table.)
    const priceFactor = Math.min(1.5, Math.max(0.02, 1.45 - ratio))
    // Liquidity: pricey stock has fewer walk-in buyers (vendor tables waive
    // this — conventions are where grails move). Junk is unaffected.
    const liq = 1 / liquidityFactor(anchor)
  let chance = Math.min(0.26, 0.05 * hour * rep * counter * priceFactor * liq)
  // Seasonal weather: holiday weeks pack the floor, January empties it.
  chance *= seasonal.walkInMultiplier()
  // Channel conflict: every live BidBay listing quietly siphons walk-ins —
  // the locals are browsing your own online feed instead of your cases.
    chance *= shopTrafficFactor()
    // The rival across the street: cheap, confident competition pulls
    // browsers off your block (their cheap cases are the pull).
    try { chance *= rivalPoachFactor() } catch { /* non-fatal */ }
    if (nonprofit) chance *= NONPROFIT_TRAFFIC_FACTOR
    if (Math.random() >= chance) continue
    const buyer = pick(BUYER_NAMES)
    const cost = round2(r.cost_basis * r.quantity)
    // A seen copy sells at its copy-grade price — the sub-grade premium lands here.
    const proceeds = round2(ask * r.quantity * (single ? marketFactor(r.id) : 1))
    const profit = round2(proceeds - cost)
    const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(r.card_id) as { name: string }).name
    // The round-up ask: most customers nudge the total to the next dollar.
    let roundUp = 0
    if (askRoundUp) {
      const nextDollar = Math.ceil(proceeds)
      const spare = round2(nextDollar - proceeds)
      if (spare > 0.004 && Math.random() < ROUNDUP_OFFER_RATE) roundUp = spare
    }
    insertSale.run(r.case_id, r.id, r.card_id, r.quantity, proceeds, r.cost_basis, buyer, nowIso(), roundUp)
    db.prepare(`UPDATE inventory SET status = 'sold', quantity = 0 WHERE id = ?`).run(r.id)
    db.prepare(`DELETE FROM shop_case_cards WHERE inventory_id = ?`).run(r.id)
    db.prepare(
      `INSERT INTO sale_history (inventory_id, card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'shop', ?)`,
    ).run(r.id, r.card_id, r.variant, r.condition, r.quantity, proceeds, cost, profit, buyer, nowIso())
    cashIn += proceeds
    costOut += cost
    sales++
    // Reputation: fair deals earn word-of-mouth, gouging quietly costs you.
    const repDelta = ratio < 0.9 ? 1 : ratio > 1.2 ? -1 : 0
    // A round-up donor just did a tiny good deed at your register — some of
    // that glow lands on the shop. Tracked separately from price fairness.
    if (roundUp > 0 && Math.random() < ROUNDUP_REP_CHANCE) {
      db.prepare('UPDATE shop SET reputation = reputation + 1 WHERE id = 1').run()
      logActivity('shop', `🕊️ ${buyer} rounded up $${roundUp.toFixed(2)} for the cause and told a friend about ${shop.name}.`, roundUp)
    }
    if (repDelta !== 0) db.prepare(`UPDATE shop SET reputation = reputation + ? WHERE id = 1`).run(repDelta)
    logActivity(
      'shop',
      `Shop sale: ${r.quantity > 1 ? `${r.quantity}× ` : ''}${name} → ${buyer} for $${proceeds.toFixed(2)} (${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} vs cost${ratio < 0.9 ? ' — word of mouth building' : ratio > 1.2 ? ' — overpriced, rep slipping' : ''})`,
      proceeds,
    )
  }

  // Round-up donations bank this tick: the full spare-change amount reaches
  // the cause (no nonprofit spend discount — it was never product money), and
  // the product 'cases' money stays clean. Donations ride their own ledger
  // note so the P&L shows the cause's income separately.
  const windowDonated = round2(
    (db.prepare(`SELECT COALESCE(SUM(roundup),0) AS t FROM shop_sales WHERE sold_at > ?`).get(lastBankedSaleAt) as { t: number }).t,
  )
  if (cashIn > 0 || windowDonated > 0) {
    const take = nonprofit ? round2(cashIn * NONPROFIT_SPEND_FACTOR) : round2(cashIn)
    db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(round2(take + windowDonated))
    db.prepare(
      `UPDATE shop SET lifetime_revenue = lifetime_revenue + ?, lifetime_cost = lifetime_cost + ?, customer_count = customer_count + ?, today_customers = today_customers + ?, today_revenue = today_revenue + ? WHERE id = 1`,
    ).run(take, round2(costOut), sales, sales, take)
    pnl.append('cases', take, nonprofit ? `${sales} case sale${sales === 1 ? '' : 's'} (donation-framed)` : `${sales} case sale${sales === 1 ? '' : 's'}`)
    if (windowDonated > 0) {
      const donors = (db.prepare(`SELECT COUNT(*) AS n FROM shop_sales WHERE roundup > 0 AND sold_at > ?`).get(lastBankedSaleAt) as { n: number }).n
      pnl.append('cases', windowDonated, `🕊️ round-up donations ×${donors} — straight to the cause`)
    }
    // Nonprofits are exempt at the register — the mission covers the tax.
    // Donations are not taxable income either: they never enter the base.
    if (!nonprofit) salesTax.collect('cases', cashIn, `${sales} sale${sales === 1 ? '' : 's'} at the register`)
    // Attribute the sale to counter staff when they're on duty.
    try { staff.creditCounterSales(sales) } catch { /* non-fatal */ }
  }
  const newestSale = db.prepare(`SELECT sold_at FROM shop_sales ORDER BY id DESC LIMIT 1`).get() as { sold_at: string } | undefined
  if (newestSale) lastBankedSaleAt = newestSale.sold_at
}

// High-water mark: the sold_at of the newest sale whose roundup money has
// already been banked, so restarts and multiple ticks never double-credit.
let lastBankedSaleAt = '1970-01-01'

// ---------------------------------------------------------------------------
// The consignment counter — NPC collectors consign cards to the shop; you
// sell them over the counter and keep a 20% cut. Their cardboard never
// touches your inventory: it lives here, tagged by owner.
//
// How it plays: NPC offers trickle in (lowballers, the indecisive, and the
// occasional grail). Accept an offer and the clock starts — every consignor
// has patience, and when it runs out they walk in and take the card back,// no hard feelings and no commission. Price fairly and the counter pays for
// itself; gouge and you're showcasing someone else's cardboard for free.
// ---------------------------------------------------------------------------

const CONSIGNOR_NAMES = ['SlabWhisperer', 'VintageVanessa', 'CardboardCarl', 'GradedGus', 'BinderBurke', 'MoonbreonMike', 'FleaMarketFaye', 'ToploaderTina', 'PackFreshPat', 'OldSchoolOllie']
const COMMISSION = 0.2
const MAX_COUNTER_SLOTS = 6

function offerExpires(days: number): string {
  return new Date(Date.now() + days * gameDayMs()).toISOString()
}

/** A fresh NPC offer. Cheap rolls are common; grails are rare and picky. */
function rollOffer() {
  const roll = Math.random()
  const card = roll < 0.75
    ? db.prepare(`SELECT id FROM cards WHERE rarity IN ('Common','Uncommon') ORDER BY RANDOM() LIMIT 1`).get() as { id: string } | undefined
    : roll < 0.96
      ? db.prepare(`SELECT id FROM cards WHERE rarity IN ('Rare','Holo Rare','Double Rare','Illustration Rare') ORDER BY RANDOM() LIMIT 1`).get() as { id: string } | undefined
      : db.prepare(`SELECT id FROM cards WHERE rarity IN ('Special Illustration Rare','Hyper Rare','Secret Rare','Rare Holo EX') ORDER BY RANDOM() LIMIT 1`).get() as { id: string } | undefined
  if (!card) return
  const anchor = valueOf(card.id, 'normal', 'NM')
  if (anchor <= 0) return
  // The offer names an owner minimum near (sometimes under) market; the shop's
  // shelf ask is free — the walk-in fairness model prices the sale later.
  const min = round2(anchor * (0.82 + Math.random() * 0.3))
  const patience = 6 + Math.floor(Math.random() * 9) // 6–14 days of goodwill
  db.prepare(
    `INSERT INTO shop_consignments (card_id, variant, condition, quantity, ask, owner_name, owner_min, patience_days, consigned_at, expires_at, status)
     VALUES (?, 'normal', ?, ?, ?, ?, ?, ?, ?, ?, 'offered')`,
  ).run(card.id, Math.random() < 0.75 ? 'NM' : 'LP', 1, round2(anchor), pick(CONSIGNOR_NAMES), min, patience, nowIso(), offerExpires(2))
}

function consignmentStatusRow(id: number) {
  return db.prepare(`SELECT * FROM shop_consignments WHERE id = ?`).get(id) as
    | { id: number; card_id: string; variant: string; condition: string; quantity: number; ask: number; owner_name: string; owner_min: number; patience_days: number; consigned_at: string; expires_at: string; status: string; sold_price: number | null; commission: number | null } | undefined
}

/** Called from shopTick: generate offers, run out the clock, ring up sales. */
export function consignTick() {
  const shop = getShop()
  if (!shop) return
  // Offers trickle in on the first tick of each new hour, at most.
  const offerGate = `consign:offers:${dayKey()}:${new Date().getHours()}`
  const offered = (db.prepare(`SELECT COUNT(*) AS n FROM shop_consignments WHERE status = 'offered'`).get() as { n: number }).n
  if (!db.prepare(`SELECT 1 FROM meta WHERE key = ?`).get(offerGate) && offered < 3) {
    if (Math.random() < 0.5) rollOffer()
    db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES (?, '1')`).run(offerGate)
  }
  // Unaccepted offers quietly expire.
  db.prepare(`UPDATE shop_consignments SET status = 'pulled' WHERE status = 'offered' AND expires_at < ?`).run(nowIso())
  // The counter: fairness-driven walk-in sales on active consignments.
  const active = db.prepare(`SELECT * FROM shop_consignments WHERE status = 'active'`).all() as { id: number; card_id: string; variant: string; condition: string; quantity: number; ask: number; owner_name: string; owner_min: number; patience_days: number; expires_at: string; status: string }[]
  if (active.length === 0) return
  const hour = hourCurve()
  const rep = repMultiplier(shop.reputation)
  let counter = 1
  try { counter = staff.counterBoost() } catch { /* non-fatal */ }
  for (const c of active) {
    // Patience out: the owner takes the card back. Gouging is expensive.
    if (c.expires_at < nowIso()) {
      const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(c.card_id) as { name: string }).name
      db.prepare(`UPDATE shop_consignments SET status = 'pulled' WHERE id = ?`).run(c.id)
      logActivity('shop', `${c.owner_name} walked in and took their ${name} back — ${Math.round(c.patience_days)} days on the counter unsold at $${c.ask.toFixed(2)}. Consignors talk.`, 0)
      continue
    }
    const anchor = valueOf(c.card_id, c.variant || 'normal', (c.condition as Condition) || 'NM')
    if (anchor <= 0) continue
    const ratio = c.ask / anchor
    const priceFactor = Math.min(1.5, Math.max(0.02, 1.45 - ratio))
    const liq = 1 / liquidityFactor(anchor)
    const chance = Math.min(0.26, 0.05 * hour * rep * counter * priceFactor * liq) * shopTrafficFactor()
    if (Math.random() >= chance) continue
    const buyer = pick(BUYER_NAMES)
    const gross = round2(c.ask)
    const cut = round2(gross * COMMISSION)
    const payout = round2(gross - cut)
    const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(c.card_id) as { name: string }).name
    const tx = db.transaction(() => {
      db.prepare(`UPDATE shop_consignments SET status = 'sold', sold_price = ?, commission = ? WHERE id = ?`).run(gross, cut, c.id)
      db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(cut)
      db.prepare(
        `INSERT INTO sale_history (inventory_id, card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
         VALUES (0, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'consignment', ?)`,
      ).run(c.card_id, c.variant, c.condition, c.quantity, gross, cut, cut, buyer, nowIso())
      // The cut is the shop's income; the owner's 80% never touched our till.
      pnl.append('consignment', cut, `${c.owner_name}'s card sold via ${buyer}`)
      db.prepare(`UPDATE shop SET lifetime_revenue = lifetime_revenue + ?, customer_count = customer_count + 1, today_customers = today_customers + 1, today_revenue = today_revenue + ? WHERE id = 1`).run(cut, cut)
    })
    tx()
    // The register charges sales tax on the full retail price, consigned or not.
    salesTax.collect('consignment', gross, `consignment sale for ${c.owner_name}`)
    logActivity('shop', `Consignment sale: ${name} → ${buyer} for $${gross.toFixed(2)} on ${c.owner_name}'s behalf — your 20% cut is $${cut.toFixed(2)}.`, cut)
    const repDelta = ratio < 0.9 ? 1 : ratio > 1.2 ? -1 : 0
    if (repDelta !== 0) db.prepare(`UPDATE shop SET reputation = reputation + ? WHERE id = 1`).run(repDelta)
  }
}

/** Accept a consignment offer: set the shelf ask, start the patience clock. */
export function acceptConsignment(id: number, ask: number) {
  const shop = getShop()
  if (!shop) return { ok: false as const, error: 'Lease the shop first' }
  const c = consignmentStatusRow(id)
  if (!c || c.status !== 'offered') return { ok: false as const, error: 'That offer is gone' }
  if (!(ask > 0)) return { ok: false as const, error: 'Set a real price' }
  if (ask < c.owner_min) return { ok: false as const, error: `${c.owner_name} won't take less than $${c.owner_min.toFixed(2)} for it` }
  const activeCount = (db.prepare(`SELECT COUNT(*) AS n FROM shop_consignments WHERE status = 'active'`).get() as { n: number }).n
  if (activeCount >= MAX_COUNTER_SLOTS) return { ok: false as const, error: `The consignment counter is full (${MAX_COUNTER_SLOTS} slots)` }
  const anchor = valueOf(c.card_id, c.variant || 'normal', (c.condition as Condition) || 'NM')
  if (anchor > 250 && shop.reputation < 15) return { ok: false as const, error: `A $${anchor.toFixed(0)} card won't consign to an unknown shop — build some reputation first` }
  db.prepare(`UPDATE shop_consignments SET status = 'active', ask = ?, expires_at = ? WHERE id = ?`).run(round2(ask), offerExpires(c.patience_days), id)
  const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(c.card_id) as { name: string }).name
  logActivity('shop', `Consignment: ${c.owner_name} left a ${name} on your counter at $${round2(ask).toFixed(2)} — you keep 20% when it sells, and they'll take it back in ${c.patience_days} days if it doesn't.`, 0)
  return { ok: true as const }
}

export function declineConsignment(id: number) {
  const c = consignmentStatusRow(id)
  if (!c || c.status !== 'offered') return { ok: false as const, error: 'That offer is gone' }
  db.prepare(`UPDATE shop_consignments SET status = 'pulled' WHERE id = ?`).run(id)
  return { ok: true as const }
}

/** Return a consigned card to its owner early — before patience runs out. */
export function returnConsignment(id: number) {
  const c = consignmentStatusRow(id)
  if (!c || c.status !== 'active') return { ok: false as const, error: 'That card is not on the counter' }
  db.prepare(`UPDATE shop_consignments SET status = 'pulled' WHERE id = ?`).run(id)
  const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(c.card_id) as { name: string }).name
  logActivity('shop', `You handed the ${name} back to ${c.owner_name} — no sale, no hard feelings.`, 0)
  return { ok: true as const }
}

export function consignmentStatus() {
  const decorate = (rows: { id: number; card_id: string; variant: string; condition: string; quantity: number; ask: number; owner_name: string; owner_min: number; patience_days: number; consigned_at: string; expires_at: string; status: string; sold_price: number | null; commission: number | null }[]) =>
    rows.map((c) => {
      const anchor = valueOf(c.card_id, c.variant || 'normal', (c.condition as Condition) || 'NM')
      return {
        id: c.id,
        card_id: c.card_id,
        variant: c.variant,
        condition: c.condition,
        quantity: c.quantity,
        ask: round2(c.ask),
        ownerName: c.owner_name,
        ownerMin: round2(c.owner_min),
        patienceDays: c.patience_days,
        expiresAt: c.expires_at,
        status: c.status,
        soldPrice: c.sold_price != null ? round2(c.sold_price) : null,
        anchor: round2(anchor),
        commission: round2(c.ask * COMMISSION),
        name: (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(c.card_id) as { name: string } | undefined)?.name ?? c.card_id,
        image: (db.prepare(`SELECT image_small FROM cards WHERE id = ?`).get(c.card_id) as { image_small: string | null } | undefined)?.image_small ?? null,
        setName: (db.prepare(`SELECT s.name AS set_name FROM cards c JOIN sets s ON s.id = c.set_id WHERE c.id = ?`).get(c.card_id) as { set_name: string } | undefined)?.set_name ?? '',
        delta: anchor > 0 ? round2(c.ask / anchor - 1) : null,
      }
    })
  const offers = decorate(db.prepare(`SELECT * FROM shop_consignments WHERE status = 'offered' ORDER BY id DESC LIMIT 6`).all() as never[]) as ReturnType<typeof decorate>
  const active = decorate(db.prepare(`SELECT * FROM shop_consignments WHERE status = 'active' ORDER BY id`).all() as never[]) as ReturnType<typeof decorate>
  const history = decorate(db.prepare(`SELECT * FROM shop_consignments WHERE status IN ('sold','pulled') ORDER BY id DESC LIMIT 12`).all() as never[]) as ReturnType<typeof decorate>
  const earned = round2((db.prepare(`SELECT COALESCE(SUM(commission),0) AS t FROM shop_consignments WHERE status = 'sold'`).get() as { t: number }).t)
  return { offers, active, history, earned, commissionPct: COMMISSION, slots: MAX_COUNTER_SLOTS }
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
        // Asks are stack totals — judge fairness per unit.
        const unitAsk = ask / Math.max(1, r.quantity)
        return { ...r, ask, anchor, delta: anchor > 0 ? unitAsk / anchor - 1 : null }
      }),
    }
  })
  const recent = db
    .prepare(`SELECT ss.*, c.name FROM shop_sales ss JOIN cards c ON c.id = ss.card_id ORDER BY ss.id DESC LIMIT 12`)
    .all() as { id: number; card_id: string; quantity: number; price: number; cost_basis: number; buyer: string; sold_at: string; name: string; roundup: number }[]
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
      rent: currentRent(shop),
      property: propertyView(shop),
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
    roundUps: tax.roundUpStats(),
    roundUpsEnabled: roundUpsEnabled(),
    consignment: consignmentStatus(),
    salesTax: salesTax.status(),
  }
}
