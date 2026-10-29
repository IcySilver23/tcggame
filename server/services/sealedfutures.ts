import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayKey, gameDayKeyStartMs, gameDayMs } from '../lib/gameday'
import { round2 } from './market'
import * as sealed from './sealed'
import * as pnl from './pnl'

// ---------------------------------------------------------------------------
// THE SEALED FUTURES DESK — the secondary market for sealed product. Sealed
// boxes don't trade like cards; they trade like commodities, and condition is
// the whole spread. A case-fresh booster box is investor grade; a dented,
// shelf-worn box from the back of a closet sells to someone who intends to
// rip it. Three desks share one counter:
//
//   • CASE-FRESH PREMIUM — sealed stock carries a condition (fresh | worn).
//     Fresh units trade ABOVE market (buyers pay up for crisp shrink and
//     sharp corners); worn units trade BELOW it. The spread decays with a
//     product's out-of-print age — on vintage boxes every surviving fresh
//     copy is a survivor, and that survivorship is already priced into the
//     comp; on fresh print runs the market still pays up for crispness.
//
//   • THE DAMAGE DOCK — worn stock has one stop before the rip: the dock.
//     Pay a re-wrap fee and the crew swaps the dented box for a fresh one
//     (fresh lot at your original basis). Or dump it: the dock on-sells worn
//     boxes at their worn price, no dealer fee — you already ate the
//     condition haircut.
//
//   • THE LOAN DESK — the bank lends against sealed inventory the way banks
//     lend against gold. Post units as collateral (they move to the vault —
//     `escrow_loan` tags the lot, and rip/sell/dock all skip it), borrow up
//     to 60% of their WORN value at 0.6%/game-day compounded. No fixed term:
//     interest accrues until you settle. Redeem units early at their
//     pro-rata principal, or walk away — the bank keeps the boxes, sells
//     them at the dock, and mails you any surplus. When the unpaid balance
//     outgrows the boxes (135% overhang) the whole ticket re-prices to
//     0.9%/day. Every dollar sits on the books; net worth stays honest.
// ---------------------------------------------------------------------------

export type SealedCondition = 'fresh' | 'worn'

const COLLATERAL_LTV = 0.6 // of WORN value — the desk values every box at rip-grade
const LOAN_RATE_DAILY = 0.006 // 0.6%/game-day (12h), compounded
const OVERHANG_RATIO = 1.35 // balance may exceed live collateral value up to this ratio...
const OVERHANG_RATE_MULT = 1.5 // ...then the whole balance re-prices ×1.5 (0.9%/day)
const REWRAP_FEE_PCT = 0.1 // 10% of the worn unit's value to re-wrap it fresh
const DOCK_HAIRCUT = 0.1 // the bank's forfeit sale clears at 90% of worn value
const MIN_LOAN = 5
const WEAR_CHANCE_PER_DAY = 0.08 // per fresh LOT per game-day — shrink scuffs, corners ding

export const TERMS = { collateralLtv: COLLATERAL_LTV, rateDaily: LOAN_RATE_DAILY, overhangRatio: OVERHANG_RATIO, overhangRateMult: OVERHANG_RATE_MULT, rewrapFeePct: REWRAP_FEE_PCT, dockHaircut: DOCK_HAIRCUT, minLoan: MIN_LOAN }

// Case-fresh premium / worn discount. Decays with OOP age: on vintage boxes
// fresh-vs-worn is already priced into the comp (survivorship), so the ±10%
// spread fades to ±2% by two years out of print.
export function conditionMultiplier(oopMonths: number, cond: SealedCondition): number {
  if (cond === 'fresh') return round2(1 + 0.1 - 0.08 * Math.min(1, oopMonths / 24))
  return round2(1 - 0.1 + 0.08 * Math.min(1, oopMonths / 24))
}

/** Unit market value of a sealed unit at a condition (fresh premium / worn discount applied). */
export function conditionPriceOf(productId: string, cond: SealedCondition): number {
  const base = sealed.priceOf(productId).market
  if (base <= 0) return 0
  const d = sealed.priceDetail(productId)
  return round2(base * conditionMultiplier(d.oopMonths, cond))
}

// ---------------------------------------------------------------------------
// Migration — condition + escrow_loan columns on sealed_inventory, the
// loan-desk table. Existing lots (and every existing purchase path) stamp
// 'fresh': the player has been paying retail, and the pre-futures world
// priced retail as fresh.
// ---------------------------------------------------------------------------

function ensureColumns() {
  try { db.exec(`ALTER TABLE sealed_inventory ADD COLUMN condition TEXT NOT NULL DEFAULT 'fresh'`) } catch { /* exists */ }
  try { db.exec(`ALTER TABLE sealed_inventory ADD COLUMN escrow_loan INTEGER`) } catch { /* exists */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sealed_inv_product ON sealed_inventory (product_id)`) } catch { /* exists */ }
}
ensureColumns()

db.exec(`CREATE TABLE IF NOT EXISTS sealed_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  principal REAL NOT NULL,
  balance REAL NOT NULL,                    -- outstanding, grows daily
  rate_daily REAL NOT NULL,
  collateral_qty INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',    -- active | settled | forfeited
  issued_at TEXT NOT NULL,
  last_accrual_day TEXT NOT NULL,
  settled_at TEXT
)`)

type SealedLoan = {
  id: number; principal: number; balance: number; rate_daily: number
  collateral_qty: number; status: 'active' | 'settled' | 'forfeited'
  issued_at: string; last_accrual_day: string; settled_at: string | null
}

type Lot = { id: number; product_id: string; condition: SealedCondition; quantity: number; cost: number; acquired_at: string; escrow_loan: number | null }

/** Free (non-escrowed) stock, FIFO. Escrowed collateral is the bank's until redeemed. */
function freeLots(productId?: string): Lot[] {
  if (productId != null) {
    return db
      .prepare(`SELECT id, product_id, condition, quantity, cost, acquired_at, escrow_loan FROM sealed_inventory WHERE product_id = ? AND quantity > 0 AND escrow_loan IS NULL ORDER BY acquired_at ASC, id ASC`)
      .all(productId) as Lot[]
  }
  return db
    .prepare(`SELECT id, product_id, condition, quantity, cost, acquired_at, escrow_loan FROM sealed_inventory WHERE quantity > 0 AND escrow_loan IS NULL ORDER BY acquired_at ASC, id ASC`)
    .all() as Lot[]
}

function escrowLotsOf(loanId: number): Lot[] {
  return db
    .prepare(`SELECT id, product_id, condition, quantity, cost, acquired_at, escrow_loan FROM sealed_inventory WHERE escrow_loan = ? AND quantity > 0 ORDER BY id ASC`)
    .all(loanId) as Lot[]
}

function productName(productId: string): string {
  return (db.prepare(`SELECT name FROM pack_products WHERE id = ?`).get(productId) as { name: string } | undefined)?.name ?? productId
}

function escrowedSummary(): { units: number; value: number } {
  const rows = db
    .prepare(`SELECT product_id, quantity FROM sealed_inventory WHERE escrow_loan IS NOT NULL AND quantity > 0`)
    .all() as { product_id: string; quantity: number }[]
  let units = 0
  let value = 0
  for (const r of rows) {
    units += r.quantity
    value += r.quantity * conditionPriceOf(r.product_id, 'worn')
  }
  return { units, value }
}

// ---------------------------------------------------------------------------
// Stock read model — every product lot, priced per condition, exchange quoted.
// ---------------------------------------------------------------------------

export type StockRow = {
  productId: string
  name: string
  kind: string
  freshQty: number
  wornQty: number
  escrowQty: number // units in the loan vault — priced, but not sellable/rippable/postable
  market: number
  freshPrice: number
  wornPrice: number
  freshBasis: number
  wornBasis: number
  freshValue: number
  wornValue: number
  value: number
  basis: number
  unrealized: number
  oop: boolean
  oopMonths: number
  freshPremium: number // % a fresh copy trades over worn, at this age
  rewrapFee: number
}

export function stock(): { rows: StockRow[]; terms: typeof TERMS; activeLoans: number; outstanding: number; collateralUnits: number; escrowedValue: number } {
  const rows = db
    .prepare(`SELECT product_id, condition, SUM(quantity) AS qty, AVG(cost) AS unit_cost, MAX(CASE WHEN escrow_loan IS NOT NULL THEN 1 ELSE 0 END) AS is_escrow FROM sealed_inventory WHERE quantity > 0 GROUP BY product_id, condition, CASE WHEN escrow_loan IS NOT NULL THEN 1 ELSE 0 END`)
    .all() as { product_id: string; condition: string; qty: number; unit_cost: number; is_escrow: number }[]
  const byId = new Map<string, StockRow>()
  for (const r of rows) {
    const cond: SealedCondition = r.condition === 'worn' ? 'worn' : 'fresh'
    const d = sealed.priceDetail(r.product_id)
    const unit = round2(d.market || r.unit_cost)
    let row = byId.get(r.product_id)
    if (!row) {
      row = {
        productId: r.product_id,
        name: productName(r.product_id),
        kind: (db.prepare(`SELECT kind FROM pack_products WHERE id = ?`).get(r.product_id) as { kind: string } | undefined)?.kind ?? 'booster',
        freshQty: 0, wornQty: 0, escrowQty: 0,
        market: unit,
        freshPrice: round2(unit * conditionMultiplier(d.oopMonths, 'fresh')),
        wornPrice: round2(unit * conditionMultiplier(d.oopMonths, 'worn')),
        freshBasis: 0, wornBasis: 0, freshValue: 0, wornValue: 0, value: 0, basis: 0, unrealized: 0,
        oop: d.oop, oopMonths: d.oopMonths,
        freshPremium: round2((conditionMultiplier(d.oopMonths, 'fresh') / Math.max(0.01, conditionMultiplier(d.oopMonths, 'worn')) - 1) * 100),
        rewrapFee: round2(unit * conditionMultiplier(d.oopMonths, 'worn') * REWRAP_FEE_PCT),
      }
      byId.set(r.product_id, row)
    }
    const price = cond === 'fresh' ? row.freshPrice : row.wornPrice
    if (r.is_escrow) {
      // Vault stock still counts toward value/basis — it's yours, just encumbered.
      row.escrowQty += r.qty
      if (cond === 'fresh') row.freshBasis = round2(row.freshBasis + r.qty * r.unit_cost)
      else row.wornBasis = round2(row.wornBasis + r.qty * r.unit_cost)
      if (cond === 'fresh') row.freshValue = round2(row.freshValue + r.qty * price)
      else row.wornValue = round2(row.wornValue + r.qty * price)
      continue
    }
    if (cond === 'fresh') {
      row.freshQty += r.qty
      row.freshBasis = round2(row.freshBasis + r.qty * r.unit_cost)
      row.freshValue = round2(row.freshValue + r.qty * price)
    } else {
      row.wornQty += r.qty
      row.wornBasis = round2(row.wornBasis + r.qty * r.unit_cost)
      row.wornValue = round2(row.wornValue + r.qty * price)
    }
  }
  const out = [...byId.values()]
  for (const row of out) {
    row.value = round2(row.freshValue + row.wornValue)
    row.basis = round2(row.freshBasis + row.wornBasis)
    row.unrealized = round2(row.value - row.basis)
  }
  out.sort((a, b) => b.value - a.value)
  const active = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(balance),0) AS s FROM sealed_loans WHERE status = 'active'`).get() as { n: number; s: number }
  const esc = escrowedSummary()
  return {
    rows: out,
    terms: TERMS,
    activeLoans: active.n,
    outstanding: round2(active.s),
    collateralUnits: esc.units,
    escrowedValue: round2(esc.value),
  }
}

// ---------------------------------------------------------------------------
// Selling — FIFO walk of FREE lots, worn condition cleared first (the market
// moves rip-grade stock before investor grade), priced per condition.
// Loan-escrowed units are untouchable here.
// ---------------------------------------------------------------------------

export function sellSealed(productId: string, qty: number, cond?: SealedCondition): { ok: true; units: number; unitPrice: number; gross: number; fee: number; proceeds: number; basis: number; profit: number } | { ok: false; error: string } {
  const want: SealedCondition[] = cond === 'worn' || cond === 'fresh' ? [cond] : ['worn', 'fresh']
  let remaining = Math.max(1, Math.floor(qty))
  const takes: { lot: Lot; take: number }[] = []
  for (const c of want) {
    for (const lot of freeLots(productId)) {
      if (lot.condition !== c) continue
      if (remaining <= 0) break
      const take = Math.min(remaining, lot.quantity)
      takes.push({ lot, take })
      remaining -= take
    }
    if (remaining <= 0) break
  }
  const units = takes.reduce((a, t) => a + t.take, 0)
  if (units === 0) return { ok: false, error: 'No free sealed stock of that product' }

  let gross = 0
  let basis = 0
  for (const t of takes) {
    gross += t.take * conditionPriceOf(productId, t.lot.condition)
    basis += t.take * t.lot.cost
  }
  gross = round2(gross)
  basis = round2(basis)
  const fee = round2(gross * 0.1)
  const proceeds = round2(gross - fee)
  const profit = round2(proceeds - basis)
  const worn = takes.some((t) => t.lot.condition === 'worn')

  const del = db.prepare(`DELETE FROM sealed_inventory WHERE id = ?`)
  const dec = db.prepare(`UPDATE sealed_inventory SET quantity = ? WHERE id = ?`)
  const insertSale = db.prepare(
    `INSERT INTO sale_history (card_id, variant, condition, quantity, sale_price, cost_basis, fee, profit, buyer, sale_type, sold_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'Local collector', 'sealed', ?)`,
  )
  db.transaction(() => {
    for (const t of takes) {
      const left = t.lot.quantity - t.take
      if (left <= 0) del.run(t.lot.id)
      else dec.run(left, t.lot.id)
    }
    const condLabel = takes.every((t) => t.lot.condition === 'worn') ? 'Sealed (worn)' : takes.every((t) => t.lot.condition === 'fresh') ? 'Sealed (fresh)' : 'Sealed (mixed)'
    insertSale.run(productId, condLabel, units, proceeds, basis, fee, profit, nowIso())
    db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(proceeds)
    logActivity('sale', `Sold ${units}× ${productName(productId)} (${worn ? 'worn, dock-priced' : 'case-fresh'}) for $${proceeds.toFixed(2)} after 10% fee${profit >= 0 ? ` (+$${profit.toFixed(2)} vs cost)` : ` (−$${Math.abs(profit).toFixed(2)} vs cost)`}`, proceeds)
  })()
  return { ok: true, units, unitPrice: round2(gross / units), gross, fee, proceeds, basis, profit }
}

// ---------------------------------------------------------------------------
// The damage dock — worn stock's second chance.
// ---------------------------------------------------------------------------

export function rewrap(productId: string, qty: number): { ok: true; units: number; fee: number } | { ok: false; error: string } {
  const n = Math.max(1, Math.floor(qty))
  const worn = freeLots(productId).filter((l) => l.condition === 'worn')
  const unitFee = conditionPriceOf(productId, 'worn') * REWRAP_FEE_PCT
  let remaining = n
  let fee = 0
  const takes: { lot: Lot; take: number }[] = []
  for (const lot of worn) {
    if (remaining <= 0) break
    const take = Math.min(remaining, lot.quantity)
    fee += take * unitFee
    takes.push({ lot, take })
    remaining -= take
  }
  const units = takes.reduce((a, t) => a + t.take, 0)
  if (units === 0) return { ok: false, error: 'No worn units to re-wrap' }
  fee = round2(fee)
  const cash = (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash
  if (cash < fee) return { ok: false, error: `Re-wrap costs $${fee.toFixed(2)} — not enough cash` }
  if (getMeta('tut:futures') !== '1') setMeta('tut:futures', '1')
  db.transaction(() => {
    for (const t of takes) {
      const left = t.lot.quantity - t.take
      if (left <= 0) db.prepare(`DELETE FROM sealed_inventory WHERE id = ?`).run(t.lot.id)
      else db.prepare(`UPDATE sealed_inventory SET quantity = ? WHERE id = ?`).run(left, t.lot.id)
      db.prepare(`INSERT INTO sealed_inventory (product_id, quantity, cost, condition, acquired_at) VALUES (?, ?, ?, 'fresh', ?)`)
        .run(productId, t.take, round2(t.lot.cost), nowIso())
    }
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(fee)
    logActivity('dock', `Damage dock re-wrapped ${units}× ${productName(productId)} for $${fee.toFixed(2)} — fresh shrink, your basis rides along.`, -fee)
  })()
  return { ok: true, units, fee }
}

export function dumpWorn(productId: string, qty: number): { ok: true; units: number; unitPrice: number; proceeds: number } | { ok: false; error: string } {
  if (getMeta('tut:futures') !== '1') setMeta('tut:futures', '1')
  const worn = freeLots(productId).filter((l) => l.condition === 'worn')
  const avail = worn.reduce((a, l) => a + l.quantity, 0)
  if (avail === 0) return { ok: false, error: 'No worn units to dump' }
  const r = sellSealed(productId, Math.min(Math.max(1, Math.floor(qty)), avail), 'worn')
  if (!r.ok) return r
  return { ok: true, units: r.units, unitPrice: r.unitPrice, proceeds: r.proceeds }
}

// ---------------------------------------------------------------------------
// The loan desk — lend against sealed inventory, bank-against-gold style.
// ---------------------------------------------------------------------------

export function collateralQuote(): { units: number; wornValue: number; maxLoan: number; activeLoans: number; outstanding: number } {
  let units = 0
  let wornValue = 0
  for (const lot of freeLots()) {
    units += lot.quantity
    wornValue += lot.quantity * conditionPriceOf(lot.product_id, 'worn')
  }
  const active = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(balance),0) AS s FROM sealed_loans WHERE status = 'active'`).get() as { n: number; s: number }
  const outstanding = round2(active.s)
  return {
    units,
    wornValue: round2(wornValue),
    maxLoan: round2(Math.max(0, wornValue * COLLATERAL_LTV - outstanding)),
    activeLoans: active.n,
    outstanding,
  }
}

function postEscrow(productId: string, takes: { lot: Lot; take: number }[], loanId: number) {
  // The posted units leave free stock and join the loan's escrow lots. Fresh
  // and worn never share a lot (each keeps its own condition and weighted
  // basis) — redeeming or settling hands every box home in the condition it
  // was posted in.
  const existing = escrowLotsOf(loanId).filter((l) => l.product_id === productId)
  for (const t of takes) {
    const left = t.lot.quantity - t.take
    if (left <= 0) db.prepare(`DELETE FROM sealed_inventory WHERE id = ?`).run(t.lot.id)
    else db.prepare(`UPDATE sealed_inventory SET quantity = ? WHERE id = ?`).run(left, t.lot.id)
  }
  const groups = new Map<SealedCondition, { qty: number; cost: number }>()
  for (const t of takes) {
    const g = groups.get(t.lot.condition) ?? { qty: 0, cost: 0 }
    g.qty += t.take
    g.cost += t.take * t.lot.cost
    groups.set(t.lot.condition, g)
  }
  for (const [cond, g] of groups) {
    const reuse = existing.find((l) => l.condition === cond)
    if (reuse) {
      const mergedCost = round2((reuse.cost * reuse.quantity + g.cost) / (reuse.quantity + g.qty))
      db.prepare(`UPDATE sealed_inventory SET quantity = quantity + ?, cost = ? WHERE id = ?`).run(g.qty, mergedCost, reuse.id)
    } else {
      db.prepare(`INSERT INTO sealed_inventory (product_id, quantity, cost, condition, acquired_at, escrow_loan) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(productId, g.qty, round2(g.cost / g.qty), cond, nowIso(), loanId)
    }
  }
}

/**
 * Post units of a product as collateral and borrow against them. The desk
 * appraises every box at WORN value — it doesn't pay for your shrink.
 */
export function borrow(productId: string, qty: number, amount?: number): { ok: true; principal: number; units: number } | { ok: false; error: string } {
  const units = Math.max(1, Math.floor(qty))
  const lots = freeLots(productId)
  const avail = lots.reduce((a, l) => a + l.quantity, 0)
  if (avail < units) return { ok: false, error: `Only ${avail} free unit${avail === 1 ? '' : 's'} of ${productName(productId)} in stock` }
  const takes: { lot: Lot; take: number }[] = []
  let remaining = units
  let wornValue = 0
  for (const lot of lots) {
    if (remaining <= 0) break
    const take = Math.min(remaining, lot.quantity)
    wornValue += take * conditionPriceOf(productId, 'worn')
    takes.push({ lot, take })
    remaining -= take
  }
  wornValue = round2(wornValue)
  const room = collateralQuote().maxLoan
  const principal = amount == null ? round2(wornValue * COLLATERAL_LTV) : round2(Math.min(amount, wornValue * COLLATERAL_LTV))
  if (principal < MIN_LOAN) return { ok: false, error: `Those boxes support $${round2(wornValue * COLLATERAL_LTV).toFixed(2)} at ${Math.round(COLLATERAL_LTV * 100)}% LTV — minimum ticket is $${MIN_LOAN}` }
  if (principal > room) return { ok: false, error: `Collateral room is $${room.toFixed(2)} — settle or forfeit something first` }

  const now = nowIso()
  const loanId = Number(
    db.prepare(`INSERT INTO sealed_loans (principal, balance, rate_daily, collateral_qty, issued_at, last_accrual_day) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(principal, principal, LOAN_RATE_DAILY, units, now, gameDayKey()).lastInsertRowid,
  )
  db.transaction(() => {
    postEscrow(productId, takes, loanId)
    db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(principal)
    if (getMeta('tut:futures') !== '1') setMeta('tut:futures', '1')
  })()
  logActivity('loan', `Sealed-loan desk advanced $${principal.toFixed(2)} against ${units}× ${productName(productId)} — 0.6%/game-day, compounded, no term. The boxes sit in the bank's vault: no ripping, no selling, redeem anytime.`, principal)
  return { ok: true, principal, units }
}

/** Redeem n collateral units early: pay their pro-rata principal, boxes come home. */
export function redeem(loanId: number, units: number): { ok: true; paid: number; redeemedUnits: number; balanceLeft: number } | { ok: false; error: string } {
  const l = db.prepare(`SELECT * FROM sealed_loans WHERE id = ? AND status = 'active'`).get(loanId) as SealedLoan | undefined
  if (!l) return { ok: false, error: 'Loan not active' }
  const lots = escrowLotsOf(loanId)
  const posted = lots.reduce((a, x) => a + x.quantity, 0)
  if (posted === 0) return { ok: false, error: 'Collateral lot missing — the desk owes you an audit' }
  const r = Math.max(1, Math.floor(units))
  if (r > posted) return { ok: false, error: `Only ${posted} unit${posted === 1 ? '' : 's'} posted as collateral` }
  const unitCollateral = round2(l.principal / Math.max(1, l.collateral_qty))
  const pay = round2(r * unitCollateral)
  const cash = (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash
  if (cash < pay) return { ok: false, error: `Redeeming ${r} unit${r === 1 ? '' : 's'} costs $${pay.toFixed(2)} — not enough cash` }
  db.transaction(() => {
    let remaining = r
    for (const lot of lots) {
      if (remaining <= 0) break
      const take = Math.min(remaining, lot.quantity)
      const leftQty = lot.quantity - take
      if (leftQty <= 0) db.prepare(`DELETE FROM sealed_inventory WHERE id = ?`).run(lot.id)
      else db.prepare(`UPDATE sealed_inventory SET quantity = ? WHERE id = ?`).run(leftQty, lot.id)
      // Units go home in the condition they were posted in.
      db.prepare(`INSERT INTO sealed_inventory (product_id, quantity, cost, condition, acquired_at) VALUES (?, ?, ?, ?, ?)`)
        .run(lot.product_id, take, round2(lot.cost), lot.condition, nowIso())
      remaining -= take
    }
    db.prepare(`UPDATE sealed_loans SET principal = MAX(0, principal - ?), balance = MAX(0, balance - ?), collateral_qty = MAX(0, collateral_qty - ?) WHERE id = ?`)
      .run(pay, pay, r, loanId)
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(pay)
  })()
  const after = db.prepare(`SELECT balance, status FROM sealed_loans WHERE id = ?`).get(loanId) as { balance: number; status: string }
  if (after.balance <= 0.005 && after.status === 'active') {
    db.prepare(`UPDATE sealed_loans SET status = 'settled', settled_at = ? WHERE id = ?`).run(nowIso(), loanId)
  }
  logActivity('loan', `Redeemed ${r}× ${productName(lots[0].product_id)} from the vault for $${pay.toFixed(2)} — back on the shelf, balance down to $${Math.max(0, after.balance).toFixed(2)}.`, -pay)
  return { ok: true, paid: pay, redeemedUnits: r, balanceLeft: round2(Math.max(0, after.balance)) }
}

/** Payoff the whole remaining balance; all collateral comes home. */
export function settle(loanId: number): { ok: true; paid: number; units: number } | { ok: false; error: string } {
  const l = db.prepare(`SELECT * FROM sealed_loans WHERE id = ? AND status = 'active'`).get(loanId) as SealedLoan | undefined
  if (!l) return { ok: false, error: 'Loan not active' }
  const lots = escrowLotsOf(loanId)
  const units = lots.reduce((a, x) => a + x.quantity, 0)
  if (units === 0) return { ok: false, error: 'Collateral lot missing — the desk owes you an audit' }
  const amount = round2(l.balance)
  const cash = (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash
  if (cash < amount) return { ok: false, error: `Not enough cash — settle is $${amount.toFixed(2)} (principal plus accrued interest)` }
  db.transaction(() => {
    db.prepare(`UPDATE sealed_inventory SET escrow_loan = NULL WHERE escrow_loan = ?`).run(loanId)
    db.prepare(`UPDATE sealed_loans SET balance = 0, status = 'settled', settled_at = ? WHERE id = ?`).run(nowIso(), loanId)
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(amount)
  })()
  const interest = round2(Math.max(0, amount - l.principal))
  if (interest > 0) pnl.append('interest', -interest, `Sealed-loan desk interest on ${productName(lots[0].product_id)}`)
  logActivity('loan', `Settled the sealed loan in full — $${amount.toFixed(2)} cash, the vault opens and ${units}× ${productName(lots[0].product_id)} come home.`, -amount)
  return { ok: true, paid: amount, units }
}

/** Walk away: the bank keeps the boxes, sells them at the dock, mails any surplus. */
export function forfeit(loanId: number): { ok: true; units: number; kept: number; surplus: number } | { ok: false; error: string } {
  const l = db.prepare(`SELECT * FROM sealed_loans WHERE id = ? AND status = 'active'`).get(loanId) as SealedLoan | undefined
  if (!l) return { ok: false, error: 'Loan not active' }
  const lots = escrowLotsOf(loanId)
  const units = lots.reduce((a, x) => a + x.quantity, 0)
  if (units === 0) return { ok: false, error: 'Collateral lot missing' }
  const productId = lots[0].product_id
  const gross = round2(units * conditionPriceOf(productId, 'worn'))
  const kept = round2(gross * (1 - DOCK_HAIRCUT))
  const balance = round2(l.balance)
  const surplus = round2(kept - balance)
  db.transaction(() => {
    db.prepare(`DELETE FROM sealed_inventory WHERE escrow_loan = ?`).run(loanId)
    db.prepare(`UPDATE sealed_loans SET status = 'forfeited', balance = 0, settled_at = ? WHERE id = ?`).run(nowIso(), loanId)
    if (surplus > 0) db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(surplus)
  })()
  logActivity('loan', surplus >= 0
    ? `Walked away from sealed loan #${loanId} — the bank kept ${units}× ${productName(productId)}, sold them at the dock, and mailed you the $${surplus.toFixed(2)} surplus.`
    : `Walked away from sealed loan #${loanId} — the bank kept ${units}× ${productName(productId)}, sold them at the dock, and you still ate a $${Math.abs(surplus).toFixed(2)} shortfall. The debt dies with the boxes.`, surplus > 0 ? surplus : 0)
  return { ok: true, units, kept, surplus }
}

/** Post more collateral on an active loan to buy headroom (a different product swaps the collateral). */
export function addCollateral(loanId: number, productId: string, qty: number): { ok: true; units: number; headroom: number; releasedUnits: number } | { ok: false; error: string } {
  const l = db.prepare(`SELECT * FROM sealed_loans WHERE id = ? AND status = 'active'`).get(loanId) as SealedLoan | undefined
  if (!l) return { ok: false, error: 'Loan not active' }
  const units = Math.max(1, Math.floor(qty))
  const lots = freeLots(productId)
  const avail = lots.reduce((a, x) => a + x.quantity, 0)
  if (avail < units) return { ok: false, error: `Only ${avail} free unit${avail === 1 ? '' : 's'} in stock` }
  const released = escrowLotsOf(loanId)
  const releasedQty = released.reduce((a, x) => a + x.quantity, 0)
  const releasedProduct = released[0]?.product_id ?? null
  const swap = releasedQty > 0 && releasedProduct !== productId
  const releasedUnits = swap ? releasedQty : 0
  const worn = round2(units * conditionPriceOf(productId, 'worn'))
  const headroom = round2(worn * COLLATERAL_LTV)
  const takes: { lot: Lot; take: number }[] = []
  let remaining = units
  for (const lot of lots) {
    if (remaining <= 0) break
    const take = Math.min(remaining, lot.quantity)
    takes.push({ lot, take })
    remaining -= take
  }
  db.transaction(() => {
    if (swap) {
      // One product per ticket: swapping releases every old box home, then
      // posts the new ones (the overhang math re-prices the ticket if the
      // balance now outgrows the new collateral).
      for (const lot of released) {
        db.prepare(`INSERT INTO sealed_inventory (product_id, quantity, cost, condition, acquired_at) VALUES (?, ?, ?, ?, ?)`)
          .run(lot.product_id, lot.quantity, round2(lot.cost), lot.condition, nowIso())
      }
      db.prepare(`DELETE FROM sealed_inventory WHERE escrow_loan = ?`).run(loanId)
      postEscrow(productId, takes, loanId)
    } else {
      // Same product (or first post): posted units merge into the matching
      // escrow lots — one vault lot per condition per loan, always.
      postEscrow(productId, takes, loanId)
    }
    db.prepare(`UPDATE sealed_loans SET collateral_qty = collateral_qty + ? WHERE id = ?`).run(units, loanId)
  })()
  logActivity('loan', swap
    ? `Swapped the collateral on sealed loan #${loanId}: ${releasedUnits}× ${productName(releasedProduct!)} released home, ${units}× ${productName(productId)} posted — $${headroom.toFixed(2)} of headroom at the desk.`
    : `Posted ${units}× ${productName(productId)} as extra collateral on sealed loan #${loanId} — $${headroom.toFixed(2)} of headroom at the desk.`, 0)
  return { ok: true, units, headroom, releasedUnits }
}

// ---------------------------------------------------------------------------
// Accrual — once per game-day on every active loan. Overhang pricing: an
// unpaid balance over 135% of live collateral value re-prices the whole
// ticket to 0.9%/game-day (the desk charges for the risk you're carrying).
// ---------------------------------------------------------------------------

function collateralValueOf(loanId: number): { value: number; units: number; productId: string | null } {
  const lots = escrowLotsOf(loanId)
  if (lots.length === 0) return { value: 0, units: 0, productId: null }
  let value = 0
  let units = 0
  for (const lot of lots) {
    value += lot.quantity * conditionPriceOf(lot.product_id, 'worn')
    units += lot.quantity
  }
  return { value: round2(value), units, productId: lots[0].product_id }
}

function accrueLoan(l: SealedLoan): number {
  const today = gameDayKey()
  if (l.last_accrual_day === today) return 0
  const days = Math.min(60, Math.max(1, Math.round((Date.now() - gameDayKeyStartMs(l.last_accrual_day)) / gameDayMs())))
  const col = collateralValueOf(l.id)
  const overhanging = col.value > 0 && l.balance > col.value * OVERHANG_RATIO
  const rate = overhanging ? LOAN_RATE_DAILY * OVERHANG_RATE_MULT : l.rate_daily
  const interest = round2(l.balance * (Math.pow(1 + rate, days) - 1))
  db.prepare(`UPDATE sealed_loans SET balance = balance + ?, last_accrual_day = ? WHERE id = ?`).run(interest, today, l.id)
  l.balance += interest
  l.last_accrual_day = today
  return round2(interest)
}

export function sealedLoanTick(): void {
  // Wear pass — once per game-day, a small slice of the freshest stock slips a
  // grade. Shrink scuffs, corners ding, shelf-light yellows the box. The
  // case-fresh premium is a perishable asset, not a permanent one; the damage
  // dock exists to fight exactly this. Escrowed collateral never wears — it
  // sits in the bank's vault, untouched.
  const wearKey = `seal:wear:${gameDayKey()}`
  if (getMeta(wearKey) !== '1') {
    setMeta(wearKey, '1')
    const lots = db
      .prepare(`SELECT id, product_id, quantity FROM sealed_inventory WHERE condition = 'fresh' AND quantity > 0 AND escrow_loan IS NULL ORDER BY id ASC`)
      .all() as { id: number; product_id: string; quantity: number }[]
    let slippedLots = 0
    let slippedUnits = 0
    for (const lot of lots) {
      if (Math.random() >= WEAR_CHANCE_PER_DAY) continue
      db.prepare(`UPDATE sealed_inventory SET condition = 'worn' WHERE id = ?`).run(lot.id)
      slippedLots++
      slippedUnits += lot.quantity
    }
    if (slippedUnits > 0) {
      const names = [...new Set(
        db.prepare(`SELECT DISTINCT product_id FROM sealed_inventory WHERE condition = 'worn' AND escrow_loan IS NULL`).all() as { product_id: string }[],
      ).values()].map((p) => productName(p.product_id))
      logActivity('dock', `📦 Shelf wear: ${slippedUnits} sealed unit${slippedUnits === 1 ? '' : 's'} slipped from case-fresh to worn (${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}). The damage dock re-wraps for ${(REWRAP_FEE_PCT * 100).toFixed(0)}% of unit value.`)
    }
  }

  const loans = db.prepare(`SELECT * FROM sealed_loans WHERE status = 'active'`).all() as SealedLoan[]
  let accrued = 0
  for (const l of loans) {
    const i = accrueLoan(l)
    accrued += i
    if (i > 0) {
      const col = collateralValueOf(l.id)
      if (col.value > 0 && l.balance > col.value * OVERHANG_RATIO) {
        const stamp = `seal:warned:${l.id}:${gameDayKey()}`
        if (getMeta(stamp) !== '1') {
          setMeta(stamp, '1')
          logActivity('loan', `⚠ Sealed loan #${l.id}: the balance ($${l.balance.toFixed(2)}) has outgrown the boxes ($${col.value.toFixed(2)}) — the desk re-priced you to 0.9%/game-day until you post collateral or settle.`)
        }
      }
    }
  }
  if (accrued > 0.005) {
    logActivity('loan', `Sealed-loan desk accrued $${round2(accrued).toFixed(2)} interest across ${loans.length} active ticket${loans.length === 1 ? '' : 's'}.`)
    pnl.append('interest', -round2(accrued), 'daily accrual on sealed-asset loans')
  }
}

// ---------------------------------------------------------------------------
// Read model for the API.
// ---------------------------------------------------------------------------

export function section(): unknown {
  const s = stock()
  const q = collateralQuote()
  const loans = (db.prepare(`SELECT * FROM sealed_loans ORDER BY id DESC LIMIT 40`).all() as SealedLoan[]).map((l) => {
    const lots = escrowLotsOf(l.id)
    const col = collateralValueOf(l.id)
    return {
      id: l.id,
      principal: round2(l.principal),
      balance: round2(l.balance),
      rateDaily: l.rate_daily,
      collateralQty: l.collateral_qty,
      collateralName: lots.length > 0 ? productName(lots[0].product_id) : '—',
      collateralProductId: lots[0]?.product_id ?? null,
      collateralLeft: col.units,
      collateralValue: col.value,
      overhanging: col.value > 0 && l.balance > col.value * OVERHANG_RATIO,
      status: l.status,
      issuedAt: l.issued_at,
    }
  })
  return {
    ...s,
    collateral: q,
    loans: loans.filter((l) => l.status === 'active'),
    history: loans,
  }
}
