import { db, nowIso, logActivity } from '../lib/db'
import { gameDayKey, gameDayMs } from '../lib/gameday'
import { round2 } from './market'
import { getShop } from './shop'
import * as pnl from './pnl'

// ---------------------------------------------------------------------------
// Advanced finance — business loans, a credit line sized to your shop, and
// cash-flow pressure: the bank drafts rent you can't cover and remembers
// every miss. Three consecutive missed drafts and they take the fixtures.
// ---------------------------------------------------------------------------

// Migrations for pre-finance databases.
try { db.exec(`ALTER TABLE finance ADD COLUMN total_borrowed REAL NOT NULL DEFAULT 0`) } catch { /* exists */ }
try { db.exec(`ALTER TABLE finance ADD COLUMN total_interest REAL NOT NULL DEFAULT 0`) } catch { /* exists */ }

// Interest rates are per GAME-DAY (12 real hours) — half the old 24h-day rates
// so interest pressure per real day stays where it was tuned.
export const OVERDRAFT_RATE = 0.025     // 2.5%/game-day — the landlord's "friend with cash"
export const DAILY_DRAFT_CAP = 0.25     // auto-drafts take at most 25% of daily net

type Finance = { id: 1; credit_score: number; missed_drafts: number; total_borrowed: number; total_interest: number }
type Loan = {
  id: number
  kind: 'loan' | 'overdraft' | 'mortgage'
  lender: string
  principal: number
  balance: number
  rate_daily: number
  interest_paid: number
  issued_at: string
  last_accrual_day: string
  status: 'active' | 'repaid' | 'defaulted'
}

function getFinance(): Finance {
  return db.prepare(`SELECT * FROM finance WHERE id = 1`).get() as Finance
}

function activeLoans(): Loan[] {
  // The property mortgage runs on its own daily draft in shop.ts: it is not
  // unsecured debt, so it stays out of the credit line, the interest accrual
  // and this panel's loan table. The Shop's Money tab shows it instead (and
  // repay() below still accepts its loan id for extra principal).
  return db.prepare(`SELECT * FROM loans WHERE status = 'active' AND kind != 'mortgage' ORDER BY id`).all() as Loan[]
}

function dayKey(at = Date.now()): string {
  return gameDayKey(at) // interest accrues once per game-day (12 real hours)
}

function cash(): number {
  return (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash
}

/** The shop's demonstrated revenue: what the business has proven it can move. */
function shopRevenue(): number {
  const shop = getShop()
  return shop?.lifetime_revenue ?? 0
}

/** Credit line: the shop's revenue history is the real collateral. */
export function creditLimit(): number {
  const f = getFinance()
  const shop = getShop()
  if (!shop) return 0
  const scoreFactor = f.credit_score >= 720 ? 1.5 : f.credit_score >= 640 ? 1.0 : 0.5
  return round2(Math.min(8000, Math.max(300, shopRevenue() * 2.5)) * scoreFactor)
}

export function totalOutstanding(): number {
  return round2(activeLoans().reduce((a, l) => a + l.balance, 0))
}

/** What's left on the line after outstanding balances. */
export function availableCredit(): number {
  return round2(Math.max(0, creditLimit() - totalOutstanding()))
}

/** Daily interest accrual on all active loans — called from the game tick. */
export function accrueDaily() {
  const today = dayKey()
  const loans = activeLoans().filter((l) => l.last_accrual_day !== today)
  let grew = 0
  for (const l of loans) {
    const interest = round2(l.balance * l.rate_daily)
    if (interest > 0) {
      db.prepare(`UPDATE loans SET balance = balance + ?, interest_paid = interest_paid + ? WHERE id = ?`)
        .run(interest, interest, l.id)
      db.prepare(`UPDATE finance SET total_interest = total_interest + ? WHERE id = 1`).run(interest)
      grew += interest
    }
    db.prepare(`UPDATE loans SET last_accrual_day = ? WHERE id = ?`).run(today, l.id)
  }
  if (grew > 0.005) {
    logActivity('finance', `Interest accrued on outstanding debt: +$${round2(grew).toFixed(2)} across ${loans.length} loan${loans.length === 1 ? '' : 's'}.`)
    pnl.append('interest', -grew, 'daily accrual on outstanding loans')
  }
}

// ---------------------------------------------------------------------------
// Borrowing & repaying
// ---------------------------------------------------------------------------

export function borrow(amount: number) {
  const f = getFinance()
  if (!(amount > 0)) return { ok: false as const, error: 'Enter a real amount' }
  const limit = creditLimit()
  if (limit <= 0) return { ok: false as const, error: 'No credit line — open a card shop first' }
  const room = availableCredit()
  if (amount > room) return { ok: false as const, error: `Only $${room.toFixed(2)} available on your $${limit.toFixed(2)} line (score ${f.credit_score})` }
  // Score tiers price the money: better score, cheaper daily rate.
  const rate = f.credit_score >= 720 ? 0.006 : f.credit_score >= 640 ? 0.01 : 0.0175
  const lender = f.credit_score >= 720 ? 'First National Collectors Bank' : 'Quick Rip Loans'
  db.prepare(`INSERT INTO loans (kind, lender, principal, balance, rate_daily, issued_at, last_accrual_day) VALUES ('loan', ?, ?, ?, ?, ?, ?)`)
    .run(lender, round2(amount), round2(amount), rate, nowIso(), dayKey())
  db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(round2(amount))
  db.prepare(`UPDATE finance SET total_borrowed = total_borrowed + ? WHERE id = 1`).run(round2(amount))
  logActivity('finance', `Borrowed $${round2(amount).toFixed(2)} from ${lender} at ${(rate * 100).toFixed(1)}%/day. Debt clock is ticking.`, round2(amount))
  return { ok: true as const, amount: round2(amount), lender, rateDaily: rate }
}

export function repay(loanId: number, amount?: number) {
  const l = db.prepare(`SELECT * FROM loans WHERE id = ? AND status = 'active'`).get(loanId) as Loan | undefined
  if (!l) return { ok: false as const, error: 'Loan not found' }
  const owed = round2(l.balance)
  const pay = round2(amount != null ? Math.min(amount, owed) : owed)
  if (!(pay > 0)) return { ok: false as const, error: 'Enter a real amount' }
  if (cash() < pay) return { ok: false as const, error: `Not enough cash — need $${pay.toFixed(2)}` }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(pay)
    const interestShare = Math.min(pay, round2(l.interest_paid + (l.balance - l.principal)))
    const wasFull = pay >= owed
    if (wasFull) {
      db.prepare(`UPDATE loans SET balance = 0, status = 'repaid' WHERE id = ?`).run(l.id)
      // Clean repayment builds credit; on-time payoff of real principal jumps it more.
      const bump = pay >= l.principal ? 12 : 4
      db.prepare(`UPDATE finance SET credit_score = credit_score + ? WHERE id = 1`).run(bump)
    } else {
      db.prepare(`UPDATE loans SET balance = balance - ?, interest_paid = MAX(0, interest_paid - ?) WHERE id = ?`).run(pay, pay - Math.max(0, pay - (l.balance - l.principal)), l.id)
      db.prepare(`UPDATE finance SET credit_score = credit_score + 1 WHERE id = 1`).run()
    }
    void interestShare
  })
  tx()
  const after = db.prepare(`SELECT status, balance FROM loans WHERE id = ?`).get(loanId) as { status: string; balance: number }
  logActivity('finance', after.status === 'repaid'
    ? `Paid off the ${l.lender} loan in full — credit score climbing.`
    : `Paid $${pay.toFixed(2)} toward ${l.lender} — $${round2(after.balance).toFixed(2)} still outstanding.`, -pay)
  return { ok: true as const, paid: pay, remaining: after.balance, cleared: after.status === 'repaid' }
}

// ---------------------------------------------------------------------------
// Rent day: the bank covers what you can't — and keeps score
// ---------------------------------------------------------------------------

/** Offered by shop.ts on rent day when cash < rent. Returns true if covered. */
export function draftRent(rent: number): boolean {
  const f = getFinance()
  const short = round2(rent - cash())
  if (short <= 0) return true
  if (short > availableCredit()) {
    // The line is tapped out: the draft bounces. Landlord sees everything.
    const misses = f.missed_drafts + 1
    db.prepare(`UPDATE finance SET missed_drafts = ?, credit_score = MAX(300, credit_score - 25) WHERE id = 1`).run(misses)
    logActivity('finance', `RENT BOUNCED: $${rent.toFixed(2)} due, $${short.toFixed(2)} short with no credit left. Missed draft #${misses} of 3 — at three the fixtures go.`, -rent)
    if (misses >= 3) seizeFixtures()
    return false
  }
  const rate = OVERDRAFT_RATE
  db.prepare(`INSERT INTO loans (kind, lender, principal, balance, rate_daily, issued_at, last_accrual_day) VALUES ('overdraft', 'Landlord\u2019s Friend (overdraft)', ?, ?, ?, ?, ?)`)
    .run(round2(short), round2(short), rate, nowIso(), dayKey())
  db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(round2(short))
  db.prepare(`UPDATE finance SET total_borrowed = total_borrowed + ? WHERE id = 1`).run(round2(short))
  logActivity('finance', `Bank auto-drafted $${short.toFixed(2)} to cover rent — now an overdraft loan at 5%/day. Cheap money it is not.`, round2(short))
  return true
}

function seizeFixtures() {
  const shopRow = db.prepare(`SELECT name FROM shop WHERE id = 1`).get() as { name: string } | undefined
  if (!shopRow) return
  const seized = db.prepare(`SELECT COUNT(*) AS n FROM shop_case_cards`).get() as { n: number }
  // The bank takes the shop: cases emptied, stock returned, lease terminated.
  db.prepare(`UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL WHERE status = 'in_case'`).run()
  db.prepare(`DELETE FROM shop_case_cards`).run()
  const caseKeys = (db.prepare(`SELECT key FROM meta WHERE key LIKE 'shopCase:%'`).all() as { key: string }[]).map((k) => k.key)
  for (const k of caseKeys) db.prepare(`DELETE FROM meta WHERE key = ?`).run(k)
  db.prepare(`DELETE FROM shop WHERE id = 1`).run()
  db.prepare(`UPDATE finance SET missed_drafts = 0, credit_score = MAX(300, credit_score - 40) WHERE id = 1`).run()
  logActivity('finance', `🚨 REPOSSESSION: three missed drafts and the bank seized ${shopRow.name} — ${seized.n} displayed cards returned to you, cases and lease gone. Rebuild your credit and start again.`, 0)
}

export function status() {
  const f = getFinance()
  const limit = creditLimit()
  const outstanding = totalOutstanding()
  return {
    creditScore: f.credit_score,
    creditLimit: limit,
    availableCredit: availableCredit(),
    outstanding,
    missedDrafts: f.missed_drafts,
    totalBorrowed: round2(f.total_borrowed),
    totalInterest: round2(f.total_interest),
    dailyInterest: round2(activeLoans().reduce((a, l) => a + l.balance * l.rate_daily, 0)),
    overdraftRate: OVERDRAFT_RATE,
    loans: activeLoans().map((l) => ({
      id: l.id,
      kind: l.kind,
      lender: l.lender,
      principal: round2(l.principal),
      balance: round2(l.balance),
      rateDaily: l.rate_daily,
      interestPaid: round2(l.interest_paid),
      issuedAt: l.issued_at,
      daysOld: Math.max(0, Math.floor((Date.now() - new Date(l.issued_at).getTime()) / gameDayMs())),
    })),
  }
}
