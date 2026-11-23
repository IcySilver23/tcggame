import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayMs, gameDayKey, gameDayKeyStartMs, accrualStamp } from '../lib/gameday'
import { round2, valueOf, gradedPriceOf, type Condition } from './market'
import { factor as regimeFactor } from './regimes'
import { presentationFactor } from './supplies'
import * as pnl from './pnl'

// ---------------------------------------------------------------------------
// THE GOLD EXCHANGE — pawn shops & instant cash. The exit door of last resort:
//
//   • Fire-sale quotes: 40% of a *fire-sale* value (market x 0.75) — so an
//     effective ~30% of market, worse than the buylist, available to anyone,
//     instantly, no questions. Graded cards quote off their graded price.
//   • Or hock it: leave the card as COLLATERAL against a 30-day loan of up to
//     40% of fire-sale value at 1.5%/day, compounded daily. Miss the payback
//     by day 30 and the card goes on the pawn shelf — first come, first served
//     (you can buy your own card back, marked up, from the case).
//   • The loan shows up in net worth only as the card leaving your collection;
//     the debt itself is yours to remember (the ledger line is deliberately
//     silent — "nowhere but your conscience").
//   • Payoff anytime: principal + accrued interest, cash on the glass.
// ---------------------------------------------------------------------------

// Migration: pawn tables (existing DBs predate them).
db.exec(`CREATE TABLE IF NOT EXISTS pawn_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id),
  card_id TEXT NOT NULL REFERENCES cards(id),
  principal REAL NOT NULL,
  rate_daily REAL NOT NULL,
  interest_paid REAL NOT NULL DEFAULT 0,
  issued_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  last_accrual_day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active | repaid | defaulted
  repaid_at TEXT,
  repaid_amount REAL,
  defaulted_at TEXT
)`)
db.exec(`CREATE TABLE IF NOT EXISTS pawn_shelf (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id INTEGER NOT NULL REFERENCES pawn_loans(id),
  card_id TEXT NOT NULL REFERENCES cards(id),
  ask REAL NOT NULL,
  listed_at TEXT NOT NULL,
  sold_to TEXT
)`)

const TERMS = {
  fireSaleOfMarket: 0.75,   // the shop values your card at 75% of a quick dump
  quotePct: 0.40,           // ...and offers 40% of THAT, cash now
  loanPct: 0.40,            // hock it: loan = 40% of fire-sale value
  rateDaily: 0.0075,        // 0.75%/game-day (12h), compounded — same brutal real-day rate as the old 1.5%/24h
  days: 30,                 // ...for 30 days
  graceDays: 3,             // pickup window after default before the case restocks the shelf price
  shelfMarkup: 1.25,        // your card back, at a 25% markup, in the case
}

export const PAWN_COUNTDOWN_DAYS = TERMS.days

type PawnLoan = {
  id: number; inventory_id: number; card_id: string; principal: number; rate_daily: number
  interest_paid: number; issued_at: string; due_at: string; last_accrual_day: string
  status: 'active' | 'repaid' | 'defaulted'; repaid_at: string | null; repaid_amount: number | null; defaulted_at: string | null
}

function cardName(cardId: string): string {
  return (db.prepare('SELECT name FROM cards WHERE id = ?').get(cardId) as { name: string } | undefined)?.name ?? cardId
}

/** Fire-sale value: what a quick dump would realistically clear. */
export function fireSaleValue(cardId: string, variant = 'normal', condition: Condition = 'NM', gradedGrade: string | null = null): number {
  const base = gradedGrade ? gradedPriceOf(cardId, gradedGrade).usd : valueOf(cardId, variant, condition)
  return round2(base * TERMS.fireSaleOfMarket * regimeFactor(cardId))
}

// --- Quote & inventory scan ---------------------------------------------------

export interface PawnQuote {
  inventoryId: number
  cardId: string
  name: string
  variant: string
  condition: Condition
  gradedGrade: string | null
  image: string | null
  market: number
  fireSale: number
  cashNow: number
  loanMax: number
}

export function quotes(): { quotes: PawnQuote[]; terms: typeof TERMS; activeLoans: number; outstanding: number } {
  const rows = db.prepare(`SELECT i.id, i.card_id, i.variant, i.condition, i.quantity, i.graded_grade, i.protection, c.name, c.image_small FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.status = 'collection' AND i.quantity > 0`).all() as { id: number; card_id: string; variant: string; condition: Condition; quantity: number; graded_grade: string | null; protection: string | null; name: string; image_small: string | null }[]
  const qs = rows.map((r) => {
    // One price lookup per row: the market value is what the fire-sale quote
    // was recomputing. The card name arrives in the same join, not a query each.
    const market = r.graded_grade ? gradedPriceOf(r.card_id, r.graded_grade).usd : valueOf(r.card_id, r.variant, r.condition)
    // The counter buys bare cardboard at a discount, and lends against the
    // same read, so the ticket and the cash offer never disagree.
    const fire = round2(market * TERMS.fireSaleOfMarket * regimeFactor(r.card_id) * presentationFactor(r.protection, r.graded_grade != null))
    return {
      inventoryId: r.id, cardId: r.card_id, name: r.name, variant: r.variant, condition: r.condition, gradedGrade: r.graded_grade, image: r.image_small,
      market: round2(market), fireSale: fire, cashNow: round2(fire * TERMS.quotePct), loanMax: round2(fire * TERMS.loanPct),
    }
  }).sort((a, b) => b.cashNow - a.cashNow)
  const active = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(principal),0) s FROM pawn_loans WHERE status='active'`).get() as { n: number; s: number }
  return { quotes: qs, terms: TERMS, activeLoans: active.n, outstanding: round2(active.s) }
}

// --- Sell outright -------------------------------------------------------------

export function sellOutright(inventoryId: number): { ok: true; paid: number } | { ok: false; error: string } {
  const row = db.prepare(`SELECT id, card_id, variant, condition, quantity, graded_grade, protection FROM inventory WHERE id = ? AND status = 'collection'`).get(inventoryId) as { id: number; card_id: string; variant: string; condition: Condition; quantity: number; graded_grade: string | null; protection: string | null } | undefined
  if (!row) return { ok: false, error: 'Card not in your collection (already hocked or listed?)' }
  // AUTH META: the pawn counter doesn't launder counterfeits — the guy has
  // seen every fake on the wall twice. Known fakes exit at the buylist's $1.
  const pf = db.prepare('SELECT fake_revealed, is_fake FROM inventory WHERE id = ?').get(inventoryId) as { fake_revealed: number; is_fake: number } | undefined
  if (pf && (pf.fake_revealed || pf.is_fake)) {
    return { ok: false, error: 'Known counterfeit — buylist shops pay $1 flat for it (Inventory → 🛡 Authentication)' }
  }
  const paid = round2(
    fireSaleValue(row.card_id, row.variant, row.condition, row.graded_grade) *
      presentationFactor(row.protection, row.graded_grade != null) *
      TERMS.quotePct,
  )
  if (paid <= 0) return { ok: false, error: 'No price data — the counter guy squints and waves you off.' }
  db.prepare(`DELETE FROM binder_slots WHERE inventory_id = ?`).run(inventoryId)
  db.prepare(`DELETE FROM inventory WHERE id = ?`).run(inventoryId)
  db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(paid)
  pnl.append('bulk', paid, `Pawn sale: ${cardName(row.card_id)}`)
  logActivity('pawn', `Gold exchange paid $${paid.toFixed(2)} cash for ${cardName(row.card_id)} — no questions asked.`)
  if (getMeta('tut:pawn') !== '1') setMeta('tut:pawn', '1')
  return { ok: true, paid }
}

// --- Hock (collateral loan) ------------------------------------------------------

export function hock(inventoryId: number, amount?: number): { ok: true; principal: number; dueAt: string } | { ok: false; error: string } {
  const row = db.prepare(`SELECT id, card_id, variant, condition, quantity, graded_grade, protection FROM inventory WHERE id = ? AND status = 'collection'`).get(inventoryId) as { id: number; card_id: string; variant: string; condition: Condition; quantity: number; graded_grade: string | null; protection: string | null } | undefined
  if (!row) return { ok: false, error: 'Card not in your collection' }
  const fire = round2(fireSaleValue(row.card_id, row.variant, row.condition, row.graded_grade) * presentationFactor(row.protection, row.graded_grade != null))
  const max = round2(fire * TERMS.loanPct)
  const principal = amount == null ? max : round2(Math.min(max, Math.max(1, amount)))
  if (principal <= 0 || max <= 0) return { ok: false, error: 'No price data — nothing to lend against.' }
  const now = nowIso()
  const due = new Date(Date.now() + TERMS.days * gameDayMs()).toISOString()
  db.prepare(`UPDATE inventory SET status = 'pawned' WHERE id = ?`).run(inventoryId)
  db.prepare(`DELETE FROM binder_slots WHERE inventory_id = ?`).run(inventoryId)
  db.prepare(`INSERT INTO pawn_loans (inventory_id, card_id, principal, rate_daily, issued_at, due_at, last_accrual_day) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    // The day KEY, not a date: a date-only stamp parses to midnight, so the
    // first accrual billed every game-day since then (up to 12 on 2-hour days).
    .run(inventoryId, row.card_id, principal, TERMS.rateDaily, now, due, gameDayKey())
  db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(principal)
  logActivity('pawn', `Hocked ${cardName(row.card_id)} for a $${principal.toFixed(2)} loan — 30 game-days, 0.75%/day. The ticket is in your pocket, not the books.`)
  if (getMeta('tut:pawn') !== '1') setMeta('tut:pawn', '1')
  return { ok: true, principal, dueAt: due }
}

/** Payoff amount today: principal + accrued interest. */
export function payoffAmount(loanId: number): { ok: true; amount: number; daysLeft: number } | { ok: false; error: string } {
  const l = db.prepare(`SELECT * FROM pawn_loans WHERE id = ? AND status = 'active'`).get(loanId) as PawnLoan | undefined
  if (!l) return { ok: false, error: 'Loan not active' }
  accrueLoan(l)
  const fresh = db.prepare(`SELECT * FROM pawn_loans WHERE id = ?`).get(loanId) as PawnLoan
  const amount = round2(fresh.principal + fresh.interest_paid)
  const daysLeft = Math.max(0, Math.ceil((new Date(fresh.due_at).getTime() - Date.now()) / gameDayMs()))
  return { ok: true, amount, daysLeft }
}

export function payoff(loanId: number): { ok: true; paid: number } | { ok: false; error: string } {
  const amt = payoffAmount(loanId)
  if (!amt.ok) return amt
  const cash = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
  if (cash < amt.amount) return { ok: false, error: `Not enough cash — payoff is $${amt.amount.toFixed(2)} (principal + accrued interest).` }
  const l = db.prepare(`SELECT * FROM pawn_loans WHERE id = ?`).get(loanId) as PawnLoan
  db.prepare(`UPDATE pawn_loans SET status='repaid', repaid_at=?, repaid_amount=? WHERE id=?`).run(nowIso(), amt.amount, loanId)
  db.prepare(`UPDATE inventory SET status='collection' WHERE id=? AND status='pawned'`).run(l.inventory_id)
  db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(amt.amount)
  pnl.append('interest', -round2(l.interest_paid), `Pawn interest on ${cardName(l.card_id)}`)
  logActivity('pawn', `Redeemed ${cardName(l.card_id)} for $${amt.amount.toFixed(2)} — principal plus ${TERMS.days}-day window of interest. Card's back in the binder.`)
  return { ok: true, paid: amt.amount }
}

// --- Accrual & default (the brutal part) ------------------------------------------

function accrueLoan(l: PawnLoan): number {
  const today = gameDayKey()
  // A ticket written before the day-key fix carries a bare date; read it as the
  // day the ticket was issued so the first tick bills the days it ran.
  const stamp = accrualStamp(l.last_accrual_day, l.issued_at)
  if (stamp === today) return 0
  // Whole game-days between the two KEYS. Measuring from the previous key's
  // start to `now` added the fraction of the current day already gone, so one
  // day could be billed as two.
  const days = Math.min(
    60,
    Math.max(1, Math.round((gameDayKeyStartMs(today) - gameDayKeyStartMs(stamp)) / gameDayMs())),
  )
  const interest = round2(l.principal * (Math.pow(1 + l.rate_daily, days) - 1))
  db.prepare(`UPDATE pawn_loans SET interest_paid = interest_paid + ?, last_accrual_day = ? WHERE id = ?`).run(interest, today, l.id)
  l.interest_paid += interest
  l.last_accrual_day = today
  return interest
}

export function pawnTick(): void {
  const today = nowIso()
  const todayKey = today.slice(0, 10)
  const loans = db.prepare(`SELECT * FROM pawn_loans WHERE status = 'active'`).all() as PawnLoan[]
  let warned = 0
  for (const l of loans) {
    accrueLoan(l)
    const dueAt = new Date(l.due_at).getTime()
    const daysLeft = Math.ceil((dueAt - Date.now()) / gameDayMs())
    if (daysLeft === 3 && warned < 3) {
      logActivity('pawn', `⏳ Pawn ticket: ${cardName(l.card_id)} comes due in 3 days. Payoff grows every day you wait.`)
      warned++
    }
    if (daysLeft <= 0) {
      // DEFAULT: the card goes on the shelf at a markup; the loan closes defaulted.
      db.prepare(`UPDATE pawn_loans SET status='defaulted', defaulted_at=? WHERE id=?`).run(today, l.id)
      const ask = round2((l.principal + l.interest_paid) * TERMS.shelfMarkup)
      db.prepare(`INSERT INTO pawn_shelf (loan_id, card_id, ask, listed_at) VALUES (?, ?, ?, ?)`).run(l.id, l.card_id, ask, today)
      logActivity('pawn', `🔔 Default: ${cardName(l.card_id)} is now in the case at $${ask.toFixed(2)}. You have ${TERMS.graceDays} days before a stranger buys your card.`)
    }
  }
  void todayKey
  // NPC shoppers clear the shelf slowly; after the grace window anything unsold
  // goes to the scrapper and the row leaves the case.
  const shelf = db.prepare(`SELECT * FROM pawn_shelf WHERE sold_to IS NULL`).all() as { id: number; loan_id: number; card_id: string; ask: number; listed_at: string }[]
  for (const s of shelf) {
    const ageDays = (Date.now() - new Date(s.listed_at).getTime()) / gameDayMs()
    if (ageDays > TERMS.graceDays && Math.random() < 0.5) {
      db.prepare(`UPDATE pawn_shelf SET sold_to='npc' WHERE id=?`).run(s.id)
      logActivity('pawn', `${cardName(s.card_id)} sold out of the case to a walk-in. Your card is somebody else's find now.`)
    }
  }
}

// --- Shelf (the case) -------------------------------------------------------------

export function shelf(): { rows: { id: number; cardId: string; name: string; ask: number; market: number; mine: boolean; loanId: number | null }[]; mineCount: number } {
  const rows = db.prepare(`SELECT ps.id, ps.card_id, ps.ask, ps.loan_id, ps.listed_at FROM pawn_shelf ps WHERE ps.sold_to IS NULL ORDER BY ps.ask DESC`).all() as { id: number; card_id: string; ask: number; loan_id: number; listed_at: string }[]
  const out = rows.map((r) => {
    const mine = !!db.prepare(`SELECT id FROM pawn_loans WHERE id = ? AND status = 'defaulted'`).get(r.loan_id)
    return {
      id: r.id, cardId: r.card_id, name: cardName(r.card_id), ask: r.ask,
      market: round2(valueOf(r.card_id, 'normal', 'NM')), mine, loanId: r.loan_id,
    }
  })
  return { rows: out, mineCount: out.filter((r) => r.mine).length }
}

export function buyBack(shelfId: number): { ok: true; paid: number } | { ok: false; error: string } {
  const s = db.prepare(`SELECT * FROM pawn_shelf WHERE id = ? AND sold_to IS NULL`).get(shelfId) as { id: number; loan_id: number; card_id: string; ask: number } | undefined
  if (!s) return { ok: false, error: 'Already gone from the case' }
  const cash = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
  if (cash < s.ask) return { ok: false, error: `Not enough cash — the case wants $${s.ask.toFixed(2)}.` }
  const l = db.prepare(`SELECT * FROM pawn_loans WHERE id = ?`).get(s.loan_id) as PawnLoan
  db.prepare(`UPDATE pawn_shelf SET sold_to='owner' WHERE id=?`).run(shelfId)
  if (l && l.inventory_id) {
    db.prepare(`UPDATE inventory SET status='collection' WHERE id=? AND status='pawned'`).run(l.inventory_id)
  } else {
    // Reacquire row (old saves may have purged the inventory row)
    db.prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, cost_basis, acquired_via, acquired_at) VALUES (?, 'normal', 'NM', 1, 'collection', ?, 'pawn_buyback', ?)`)
      .run(s.card_id, round2(s.ask / TERMS.shelfMarkup), nowIso())
  }
  db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(s.ask)
  pnl.append('bulk', -s.ask, `Pawn buyback: ${cardName(s.card_id)}`)
  logActivity('pawn', `Bought your own ${cardName(s.card_id)} back out of the case for $${s.ask.toFixed(2)} — the house always wins the vig.`)
  return { ok: true, paid: s.ask }
}

// --- History -----------------------------------------------------------------------

export function history(): { loans: { id: number; card: string; principal: number; interest: number; total: number; status: string; issued_at: string; due_at: string; repaid_amount: number | null }[] } {
  const rows = db.prepare(`SELECT * FROM pawn_loans ORDER BY id DESC LIMIT 40`).all() as (PawnLoan & { card_id: string })[]
  return {
    loans: rows.map((l) => ({
      id: l.id, card: cardName(l.card_id), principal: l.principal, interest: round2(l.interest_paid),
      total: round2(l.principal + l.interest_paid), status: l.status, issued_at: l.issued_at, due_at: l.due_at, repaid_amount: l.repaid_amount,
    })),
  }
}

// --- Read model (API) ----------------------------------------------------------------

export function section(): unknown {
  const q = quotes()
  // One history scan, two views of it — this used to rebuild both the active
  // ticket list and the full history (each with a name lookup per loan).
  const loans = history().loans
  return {
    ...q,
    loans: loans.filter((l) => l.status === 'active'),
    shelf: shelf(),
    history: loans,
  }
}
