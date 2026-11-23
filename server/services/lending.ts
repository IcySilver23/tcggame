import { db, nowIso, logActivity } from '../lib/db'
import { gameDayKey, gameDayMs, gameDayKeyStartMs, accrualStamp } from '../lib/gameday'
import { round2, valueOf, type Condition } from './market'
import * as pnl from './pnl'

// ---------------------------------------------------------------------------
// THE DESK — the other side of the gold exchange.
//
// The pawn shop is where the town takes your cards. This is where the town
// comes to you: collectors who need cash now, offering a card as collateral.
// You quote against real market value, choose your rate, and either get paid
// back with interest or keep the card. A default is not a loss on paper — you
// own the collateral at what you lent — but the cash left your pocket the day
// you wrote the ticket, so a dead loan is a card you did not want at a price
// you did not set.
//
//   • Loans are 14 game-days, never more than 80% of the collateral's market.
//     That limit is load-bearing: lend much less and a default hands you a card
//     worth far more than the ticket, which turned the desk into a money press
//     the first time it was simulated (+36% to +123% per ticket — see
//     server/scripts/hustle-sim.ts). At 80% a default is roughly break-even
//     after fees, so the interest is what the business actually earns.
//   • You choose the rate: 0.25%, 0.4% or 0.6% per game-day. A borrower who
//     agreed to 0.6% pays more — and is likelier to walk away from it, which is
//     the whole trade: the highest rate is the one with the most defaults.
//   • Interest accrues once per game-day, like every other loan in the game.
//   • A loan that runs out becomes collateral in your inventory at its cost
//     basis (what you lent), and the ledger books no sale, because nothing sold.
// ---------------------------------------------------------------------------

db.exec(`CREATE TABLE IF NOT EXISTS lend_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  borrower TEXT NOT NULL,
  card_id TEXT NOT NULL REFERENCES cards(id),
  condition TEXT NOT NULL DEFAULT 'NM',
  market REAL NOT NULL,
  ask REAL NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'   -- open | taken | expired
)`)

db.exec(`CREATE TABLE IF NOT EXISTS lend_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER,
  borrower TEXT NOT NULL,
  card_id TEXT NOT NULL REFERENCES cards(id),
  condition TEXT NOT NULL DEFAULT 'NM',
  principal REAL NOT NULL,
  rate_daily REAL NOT NULL,
  interest_earned REAL NOT NULL DEFAULT 0,
  issued_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  last_accrual_day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active | repaid | defaulted
  repaid_at TEXT,
  repaid_amount REAL,
  defaulted_at TEXT,
  inventory_id INTEGER
)`)

export const DESK_TERMS = {
  days: 14,
  maxLtv: 0.8,
  rates: [0.0025, 0.004, 0.006] as const,
  /** The band a walk-in actually asks for, inside the limit. */
  askBand: [0.55, 0.8] as const,
  /** What a repo card is realistically worth once it is sold (fees, postage). */
  liquidation: 0.85,
  offerTtlDays: 3,
  openOffers: 4,
}

const BORROWERS = [
  'Denny', 'Marisol', 'Tomas', 'Priya', 'Gus', 'Lena', 'Anwar', 'Bea', 'Curtis',
  'Nadia', 'Rafe', 'Simone', 'Oli', 'Esther', 'Jun', 'Kira', 'Wendell', 'Mo',
]

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}
function nameOf(cardId: string): string {
  return (db.prepare('SELECT name FROM cards WHERE id = ?').get(cardId) as { name: string } | undefined)?.name ?? cardId
}
function cashNow(): number {
  return (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
}

type Offer = {
  id: number
  borrower: string
  card_id: string
  condition: string
  market: number
  ask: number
  created_at: string
  expires_at: string
  status: 'open' | 'taken' | 'expired'
}

type Loan = {
  id: number
  offer_id: number | null
  borrower: string
  card_id: string
  condition: string
  principal: number
  rate_daily: number
  interest_earned: number
  issued_at: string
  due_at: string
  last_accrual_day: string
  status: 'active' | 'repaid' | 'defaulted'
  repaid_at: string | null
  repaid_amount: number | null
  defaulted_at: string | null
  inventory_id: number | null
}

// --- Walk-ins ---------------------------------------------------------------

/** One collector with a card worth lending against. Real market data only. */
function spawnOffer() {
  const row = db
    .prepare(
      `WITH latest AS (
         SELECT card_id, market, ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY retrieved_at DESC) rn
         FROM price_records WHERE kind = 'tcgplayer' AND market IS NOT NULL
       )
       SELECT l.card_id, l.market FROM latest l WHERE l.rn = 1 AND l.market BETWEEN 40 AND 1500
       ORDER BY RANDOM() LIMIT 1`,
    )
    .get() as { card_id: string; market: number } | undefined
  if (!row) return
  const condition: Condition = pick(['NM', 'NM', 'LP', 'MP'])
  const market = round2(valueOf(row.card_id, 'normal', condition) || row.market)
  if (market < 40) return
  const ask = round2(Math.min(market * DESK_TERMS.maxLtv, Math.max(10, market * rand(DESK_TERMS.askBand[0], DESK_TERMS.askBand[1]))))
  const now = nowIso()
  db.prepare(
    `INSERT INTO lend_offers (borrower, card_id, condition, market, ask, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    pick(BORROWERS),
    row.card_id,
    condition,
    market,
    ask,
    now,
    new Date(Date.now() + DESK_TERMS.offerTtlDays * gameDayMs()).toISOString(),
  )
}

// --- Lending ----------------------------------------------------------------

export type LendResult =
  | { ok: true; principal: number; dueAt: string; interest: number }
  | { ok: false; error: string }

/**
 * Write a ticket. The borrower's ask is the principal; the card is not yours
 * until the loan is not repaid, so nothing enters the collection yet.
 */
export function lend(offerId: number, rateDaily: number): LendResult {
  const offer = db.prepare(`SELECT * FROM lend_offers WHERE id = ?`).get(offerId) as Offer | undefined
  if (!offer || offer.status !== 'open') return { ok: false, error: 'That offer is gone' }
  if (new Date(offer.expires_at).getTime() <= Date.now()) {
    db.prepare(`UPDATE lend_offers SET status = 'expired' WHERE id = ?`).run(offerId)
    return { ok: false, error: 'They walked away — the offer expired' }
  }
  const rate = DESK_TERMS.rates.find((r) => Math.abs(r - rateDaily) < 1e-9)
  if (rate === undefined) return { ok: false, error: `Rate must be ${DESK_TERMS.rates.map((r) => `${(r * 100).toFixed(1)}%`).join(', ')} per game-day` }
  if (offer.ask > offer.market * DESK_TERMS.maxLtv + 0.005) return { ok: false, error: `That ask is over the ${Math.round(DESK_TERMS.maxLtv * 100)}% lending limit` }
  if (cashNow() < offer.ask) return { ok: false, error: `You need $${offer.ask.toFixed(2)} in cash to write this ticket` }

  const now = nowIso()
  const due = new Date(Date.now() + DESK_TERMS.days * gameDayMs()).toISOString()
  const tx = db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(offer.ask)
    db.prepare(`INSERT INTO lend_loans (offer_id, borrower, card_id, condition, principal, rate_daily, issued_at, due_at, last_accrual_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      // The day KEY, not a date: a date-only stamp parses to midnight and the
      // first accrual counts every game-day since then (up to 12 at the default
      // 2-hour day). gameDayKey() is what the accrual gate compares against.
      .run(offer.id, offer.borrower, offer.card_id, offer.condition, offer.ask, rate, now, due, gameDayKey())
    db.prepare(`UPDATE lend_offers SET status = 'taken' WHERE id = ?`).run(offer.id)
    pnl.append('lending', -offer.ask, `Lent to ${offer.borrower} against ${nameOf(offer.card_id)}`)
  })
  tx()
  logActivity(
    'lending',
    `Wrote a $${offer.ask.toFixed(2)} ticket for ${offer.borrower} on ${nameOf(offer.card_id)} — ${((rate) * 100).toFixed(2)}%/day, ${DESK_TERMS.days} game-days, $${round2(offer.ask * rate * DESK_TERMS.days).toFixed(2)} if it runs the full term.`,
    -offer.ask,
  )
  return { ok: true, principal: offer.ask, dueAt: due, interest: round2(offer.ask * rate * DESK_TERMS.days) }
}

/** The offer's own ask, so the desk can show what a ticket would be worth. */
export function quoteFor(offer: Offer): { principal: number; interest: Record<string, number> } {
  const interest: Record<string, number> = {}
  for (const r of DESK_TERMS.rates) interest[String(r)] = round2(offer.ask * r * DESK_TERMS.days)
  return { principal: offer.ask, interest }
}

function accrue(loan: Loan): number {
  const today = gameDayKey()
  // A stamp from a build that wrote a bare date is read as the day the ticket
  // was issued, so the first tick after an upgrade bills the days it ran rather
  // than every bucket since midnight.
  const stamp = accrualStamp(loan.last_accrual_day, loan.issued_at)
  if (stamp === today) return 0
  // Count whole game-days between the two KEYS, not from the previous key's
  // start to `now`: the latter adds whatever fraction of the current day has
  // passed, so an accrual could bill 2 days for 1. Key-to-key is exact however
  // the ticks fall, and a skipped tick still charges every day that passed.
  const days = Math.min(
    60,
    Math.max(1, Math.round((gameDayKeyStartMs(today) - gameDayKeyStartMs(stamp)) / gameDayMs())),
  )
  const interest = round2(loan.principal * (Math.pow(1 + loan.rate_daily, days) - 1))
  db.prepare(`UPDATE lend_loans SET interest_earned = interest_earned + ?, last_accrual_day = ? WHERE id = ?`).run(interest, today, loan.id)
  loan.interest_earned += interest
  loan.last_accrual_day = today
  return interest
}

function payoffOf(loan: Loan): number {
  return round2(loan.principal + loan.interest_earned)
}

/** Repaid: the cash comes back with the interest, and the card never leaves them. */
function settleRepaid(loan: Loan) {
  const total = payoffOf(loan)
  db.prepare(`UPDATE lend_loans SET status = 'repaid', repaid_at = ?, repaid_amount = ? WHERE id = ?`).run(nowIso(), total, loan.id)
  db.prepare(`UPDATE game_state SET cash = cash + ? WHERE id = 1`).run(total)
  pnl.append('lending', total, `${loan.borrower} repaid ${nameOf(loan.card_id)}`)
  logActivity(
    'lending',
    `${loan.borrower} paid off the ticket on ${nameOf(loan.card_id)}: $${total.toFixed(2)} back on a $${loan.principal.toFixed(2)} loan (+$${round2(total - loan.principal).toFixed(2)}).`,
    total,
  )
}

/** Defaulted: the collateral is yours at what you lent, not at what it is worth. */
function settleDefault(loan: Loan) {
  const now = nowIso()
  const tx = db.transaction(() => {
    db.prepare(`UPDATE lend_loans SET status = 'defaulted', defaulted_at = ? WHERE id = ?`).run(now, loan.id)
    const info = db
      .prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, cost_basis, acquired_via, acquired_at) VALUES (?, 'normal', ?, 1, 'collection', ?, 'lending_default', ?)`)
      .run(loan.card_id, loan.condition, loan.principal, now)
    db.prepare(`UPDATE lend_loans SET inventory_id = ? WHERE id = ?`).run(Number(info.lastInsertRowid), loan.id)
  })
  tx()
  const worth = round2(valueOf(loan.card_id, 'normal', (loan.condition as Condition) || 'NM'))
  logActivity(
    'lending',
    `Default: ${loan.borrower} never came back for ${nameOf(loan.card_id)}. It is in your collection at a $${loan.principal.toFixed(2)} basis — market says $${worth.toFixed(2)}, ${worth >= loan.principal ? 'so the collateral covered it' : 'so you are holding a loss until it sells'}.`,
  )
}

// --- The daily roll ---------------------------------------------------------

export function lendingTick(): void {
  const now = nowIso()

  // Offers that were not taken walk out the door.
  db.prepare(`UPDATE lend_offers SET status = 'expired' WHERE status = 'open' AND expires_at <= ?`).run(now)
  // Keep the dead rows from piling up.
  db.prepare(`DELETE FROM lend_offers WHERE status != 'open' AND created_at < ?`)
    .run(new Date(Date.now() - 10 * gameDayMs()).toISOString())

  const open = (db.prepare(`SELECT COUNT(*) n FROM lend_offers WHERE status = 'open'`).get() as { n: number }).n
  for (let i = open; i < DESK_TERMS.openOffers; i++) {
    if (Math.random() < 0.65) spawnOffer()
  }

  const loans = db.prepare(`SELECT * FROM lend_loans WHERE status = 'active'`).all() as Loan[]
  for (const loan of loans) {
    accrue(loan)
    const payoff = payoffOf(loan)
    const worth = round2(valueOf(loan.card_id, 'normal', (loan.condition as Condition) || 'NM'))
    const dueLeft = Math.ceil((new Date(loan.due_at).getTime() - Date.now()) / gameDayMs())

    // Who pays back? A borrower whose collateral is still worth more than the
    // ticket has every reason to; one who agreed to a punishing rate, or whose
    // card has fallen under what they owe, is thinking about walking.
    const rateWillingness = loan.rate_daily <= 0.0025 ? 1.15 : loan.rate_daily <= 0.004 ? 0.95 : 0.7
    const equityWillingness = worth >= payoff ? 1 : 0.45
    const chance = 0.16 * rateWillingness * equityWillingness

    if (Math.random() < chance) {
      settleRepaid(loan)
      continue
    }
    if (dueLeft === 2) {
      logActivity('lending', `⏳ ${loan.borrower}'s ticket on ${nameOf(loan.card_id)} is due in 2 game-days — $${payoff.toFixed(2)} to clear it.`)
    }
    if (dueLeft <= 0) settleDefault(loan)
  }
}

// --- Read model -------------------------------------------------------------

export function desk() {
  const offers = db.prepare(`SELECT * FROM lend_offers WHERE status = 'open' ORDER BY ask DESC`).all() as Offer[]
  const loans = db.prepare(`SELECT * FROM lend_loans WHERE status = 'active' ORDER BY due_at ASC`).all() as Loan[]
  const history = db.prepare(`SELECT * FROM lend_loans WHERE status != 'active' ORDER BY id DESC LIMIT 20`).all() as Loan[]

  const activeValue = loans.map((l) => ({
    ...l,
    interest: round2(l.interest_earned),
    payoff: payoffOf(l),
    worth: round2(valueOf(l.card_id, 'normal', (l.condition as Condition) || 'NM')),
    daysLeft: Math.max(0, Math.ceil((new Date(l.due_at).getTime() - Date.now()) / gameDayMs())),
    card: nameOf(l.card_id),
  }))

  const repaid = history.filter((l) => l.status === 'repaid')
  const defaulted = history.filter((l) => l.status === 'defaulted')
  const interestEarned = round2(repaid.reduce((a, l) => a + (l.interest_earned ?? 0), 0))
  const defaultedValue = round2(
    defaulted.reduce((a, l) => a + valueOf(l.card_id, 'normal', (l.condition as Condition) || 'NM'), 0),
  )

  return {
    terms: DESK_TERMS,
    offers: offers.map((o) => ({ ...o, card: nameOf(o.card_id), ...quoteFor(o) })),
    loans: activeValue,
    history: history.map((l) => ({
      id: l.id,
      card: nameOf(l.card_id),
      borrower: l.borrower,
      principal: l.principal,
      interest: round2(l.interest_earned),
      total: round2(l.principal + l.interest_earned),
      status: l.status,
      issued_at: l.issued_at,
      due_at: l.due_at,
      repaid_amount: l.repaid_amount,
    })),
    stats: {
      lentOut: round2(loans.reduce((a, l) => a + l.principal, 0)),
      openLoans: loans.length,
      interestEarned,
      repaid: repaid.length,
      defaulted: defaulted.length,
      defaultRate: repaid.length + defaulted.length > 0 ? round2(defaulted.length / (repaid.length + defaulted.length)) : null,
      collateralValue: round2(loans.reduce((a, l) => a + valueOf(l.card_id, 'normal', (l.condition as Condition) || 'NM'), 0)),
      defaultedValue,
    },
  }
}
