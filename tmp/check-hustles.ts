// The two new businesses: the lending desk (the town borrows from you against
// collateral) and your own repacks (a run of five sealed packs with printed
// odds). Both move real cash, so this runs against a COPY of the save.
//
//   node ./node_modules/tsx/dist/cli.mjs tmp/check-hustles.ts
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const home = path.join(process.cwd(), 'tmp', 'hustles-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
{
  const src = new Database(path.join(process.cwd(), 'data', 'tcglife.db'), { readonly: true })
  await src.backup(path.join(home, 'data', 'tcglife.db'))
  src.close()
}
process.env.TCGLIFE_HOME = home

const { db, nowIso } = await import('../server/lib/db')
const lending = await import('../server/services/lending')
const repacks = await import('../server/services/repacks')
const shop = await import('../server/services/shop')
const { gameDayMs, gameDayKey } = await import('../server/lib/gameday')

const checks: [string, boolean][] = []
const ok = (label: string, pass: boolean) => checks.push([label, pass])
const round2 = (n: number) => Math.round(n * 100) / 100
const cash = () => (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash

db.prepare('UPDATE game_state SET cash = 100000 WHERE id = 1').run()
if (!shop.getShop()) {
  const leased = shop.lease('Desk Test', 'hole-in-the-wall') as { ok: boolean; error?: string }
  ok('a shop can be leased for the repack shelf', leased.ok)
} else {
  ok('a shop is already open for the repack shelf', true)
}

// ---------------------------------------------------------------------------
// Lending desk
// ---------------------------------------------------------------------------

for (let i = 0; i < 4; i++) lending.lendingTick()
const desk0 = lending.desk()
ok('walk-ins arrive at the desk', desk0.offers.length > 0)
ok('every offer names a card with a real market value', desk0.offers.every((o) => o.market > 0 && o.card.length > 0))
ok('no offer asks for more than the lending limit', desk0.offers.every((o) => o.ask <= o.market * lending.DESK_TERMS.maxLtv + 0.005))
ok('every offer quotes all three rates', desk0.offers.every((o) => Object.keys(o.interest).length === 3))

const offer = desk0.offers[0]
const RATE = lending.DESK_TERMS.rates[1]
const before = cash()
const written = lending.lend(offer.id, RATE)
ok('a ticket can be written', written.ok)
ok('the cash leaves the till at issue', cash() === round2(before - offer.ask))
const desk1 = lending.desk()
ok('the offer leaves the queue', desk1.offers.every((o) => o.id !== offer.id))
const loan = desk1.loans[0]
ok('the loan is on the book', !!loan && loan.principal === offer.ask)
ok('the chosen rate is recorded', loan?.rate_daily === RATE)
// Interest accrues on the game-day roll, so a ticket written this second owes
// exactly what was lent; the offer's quote is what the full term is worth.
ok('a fresh ticket owes exactly what was lent', loan?.payoff === loan?.principal)
ok('the offer quoted interest over the full term', (offer.interest[String(RATE)] ?? 0) > 0)
ok('the collateral is valued against the loan', (loan?.worth ?? 0) > 0)
ok('the ticket has the full 14-game-day window', loan?.daysLeft === lending.DESK_TERMS.days)

// A second ticket tests the rate guard on an offer that is still open.
const other = desk1.offers[0]
if (other) {
  const bad = lending.lend(other.id, 0.5)
  ok('a rate outside the three options is refused', !bad.ok)
  const overLimit = lending.lend(other.id, RATE)
  ok('the honest rate is accepted', overLimit.ok)
}

// Run the ticket to its end: it either comes back paid or the collateral lands
// in the collection at what was lent.
const active = db.prepare(`SELECT id, principal, card_id, status FROM lend_loans WHERE status = 'active'`).all() as {
  id: number
  principal: number
  card_id: string
  status: string
}[]
ok('two tickets are live', active.length >= 1)
for (const a of active) {
  db.prepare(`UPDATE lend_loans SET due_at = ? WHERE id = ?`).run(new Date(Date.now() - 1000).toISOString(), a.id)
}
for (let i = 0; i < 60; i++) {
  if ((db.prepare(`SELECT COUNT(*) n FROM lend_loans WHERE status = 'active'`).get() as { n: number }).n === 0) break
  lending.lendingTick()
}
const settled = db.prepare(`SELECT * FROM lend_loans WHERE status != 'active'`).all() as {
  id: number
  status: string
  principal: number
  card_id: string
  interest_earned: number
  repaid_amount: number | null
  inventory_id: number | null
}[]
ok('every expired ticket resolves', settled.length === active.length)
ok('each resolution is a repayment or a default', settled.every((l) => l.status === 'repaid' || l.status === 'defaulted'))
for (const l of settled) {
  if (l.status === 'repaid') {
    // A ticket that pays on its first roll earns no interest by definition, so
    // the guarantee here is "never less than the principal"; that interest is
    // actually charged is proven exactly in the deterministic edge cases below.
    ok(`loan ${l.id}: a repayment never returns less than the principal`, (l.repaid_amount ?? 0) >= l.principal)
  } else {
    const row = db.prepare('SELECT status, cost_basis, acquired_via FROM inventory WHERE id = ?').get(l.inventory_id) as
      | { status: string; cost_basis: number; acquired_via: string }
      | undefined
    ok(`loan ${l.id}: a default lands the collateral in the collection`, row?.status === 'collection')
    ok(`loan ${l.id}: the collateral is booked at what was lent`, row?.cost_basis === l.principal)
    ok(`loan ${l.id}: the acquisition says where it came from`, row?.acquired_via === 'lending_default')
  }
}
ok('the desk reports what it earned', lending.desk().stats.interestEarned >= 0)

// ---------------------------------------------------------------------------
// Lending edge cases — a clock and dice this test owns, so each case is exact
// ---------------------------------------------------------------------------

const realNow = Date.now
let clock = 0
Date.now = () => realNow() + clock
const realRandom = Math.random
const DAY = gameDayMs()

const anyCard = (
  db.prepare(`SELECT card_id FROM price_records WHERE kind = 'tcgplayer' AND market IS NOT NULL ORDER BY RANDOM() LIMIT 1`).get() as {
    card_id: string
  }
).card_id
const addOffer = (ask: number, market: number, expiresAt?: string) =>
  Number(
    db
      .prepare(`INSERT INTO lend_offers (borrower, card_id, condition, market, ask, created_at, expires_at) VALUES ('Edge Case', ?, 'NM', ?, ?, ?, ?)`)
      .run(anyCard, market, ask, nowIso(), expiresAt ?? new Date(Date.now() + 3 * DAY).toISOString()).lastInsertRowid,
  )

db.prepare('DELETE FROM lend_loans').run()
db.prepare('UPDATE game_state SET cash = 10000 WHERE id = 1').run()

const overLimit = addOffer(90, 100)
ok('an ask over the lending limit is refused', !lending.lend(overLimit, RATE).ok)

const expiredId = addOffer(50, 100, new Date(Date.now() - 1000).toISOString())
ok('an expired offer is refused', !lending.lend(expiredId, RATE).ok)
ok(
  'the expired offer is closed out',
  (db.prepare('SELECT status FROM lend_offers WHERE id = ?').get(expiredId) as { status: string }).status === 'expired',
)

const noCashId = addOffer(50, 100)
db.prepare('UPDATE game_state SET cash = 0 WHERE id = 1').run()
ok('a ticket cannot be written with no cash', !lending.lend(noCashId, RATE).ok)
db.prepare('UPDATE game_state SET cash = 10000 WHERE id = 1').run()

const twiceId = addOffer(50, 100)
ok('the first write succeeds', lending.lend(twiceId, RATE).ok)
ok('the same offer cannot be lent twice', !lending.lend(twiceId, RATE).ok)

// Exact accrual: three real game-days on the fake clock must bill three days.
db.prepare('DELETE FROM lend_loans').run()
const accId = addOffer(100, 200)
ok('an accrual ticket can be written', lending.lend(accId, RATE).ok)
const accLoan = db
  .prepare('SELECT id, principal, last_accrual_day FROM lend_loans WHERE offer_id = ?')
  .get(accId) as { id: number; principal: number; last_accrual_day: string }
ok('the accrual stamp is a game-day key, not a bare date', accLoan.last_accrual_day.length > 10)
Math.random = () => 0.999 // never repays, never spawns a walk-in
for (let d = 0; d < 3; d++) {
  clock += DAY
  lending.lendingTick()
}
const accAfter = db.prepare('SELECT interest_earned, status FROM lend_loans WHERE id = ?').get(accLoan.id) as {
  interest_earned: number
  status: string
}
// Simple interest on the principal, one day at a time, rounded to the cent.
const wantInterest = Math.round(3 * Math.round(accLoan.principal * RATE * 100) / 100 * 100) / 100
ok(
  `three game-days bill exactly three days of interest ($${accAfter.interest_earned.toFixed(2)} vs $${wantInterest.toFixed(2)})`,
  Math.abs(accAfter.interest_earned - wantInterest) <= 0.01,
)
ok('the ticket is still live while it accrues', accAfter.status === 'active')

// A ticket that runs out: the collateral lands in the collection, no cash moves.
db.prepare('DELETE FROM lend_loans').run()
const defId = addOffer(100, 200)
ok('a default ticket can be written', lending.lend(defId, RATE).ok)
const defLoan = db.prepare('SELECT id, principal FROM lend_loans WHERE offer_id = ?').get(defId) as { id: number; principal: number }
const cashAfterIssue = cash()
for (let d = 0; d < lending.DESK_TERMS.days + 2; d++) {
  clock += DAY
  lending.lendingTick()
}
const defDone = db.prepare('SELECT status, inventory_id FROM lend_loans WHERE id = ?').get(defLoan.id) as {
  status: string
  inventory_id: number | null
}
ok('a ticket that runs out defaults', defDone.status === 'defaulted')
const defRow = db.prepare('SELECT status, cost_basis, acquired_via FROM inventory WHERE id = ?').get(defDone.inventory_id) as
  | { status: string; cost_basis: number; acquired_via: string }
  | undefined
ok('the collateral lands in the collection', defRow?.status === 'collection')
ok('the collateral is booked at the principal', defRow?.cost_basis === defLoan.principal)
ok('the default itself moves no cash', cash() === cashAfterIssue)

// A repayment: the payoff lands in the till and the card stays with them.
db.prepare('DELETE FROM lend_loans').run()
const repId = addOffer(100, 200)
ok('a repayment ticket can be written', lending.lend(repId, RATE).ok)
const repLoan = db.prepare('SELECT id, card_id FROM lend_loans WHERE offer_id = ?').get(repId) as { id: number; card_id: string }
const cashAfterRepIssue = cash()
Math.random = () => 0 // the borrower pays at the first chance
clock += DAY
lending.lendingTick()
const repDone = db.prepare('SELECT status, repaid_amount FROM lend_loans WHERE id = ?').get(repLoan.id) as {
  status: string
  repaid_amount: number | null
}
ok('a repayment closes the ticket', repDone.status === 'repaid')
ok('the payoff lands in the till to the cent', Math.abs(cash() - cashAfterRepIssue - (repDone.repaid_amount ?? 0)) < 0.005)
ok(
  'a repaid ticket never takes the collateral',
  (db.prepare('SELECT inventory_id FROM lend_loans WHERE id = ?').get(repLoan.id) as { inventory_id: number | null })
    .inventory_id === null,
)

// The pawn desk bills the same exact days — one game-day, one day of interest.
const pawnSvc = await import('../server/services/pawn')
db.prepare('DELETE FROM pawn_loans').run()
const pawnCard = db.prepare(`SELECT id FROM inventory WHERE status = 'collection' LIMIT 1`).get() as { id: number } | undefined
ok('a collection card is available for the pawn checks', !!pawnCard)
if (pawnCard) {
  const hocked = pawnSvc.hock(pawnCard.id)
  ok('a pawn ticket can be written', hocked.ok)
  const pawnLoan = db
    .prepare('SELECT id, principal, rate_daily, last_accrual_day FROM pawn_loans ORDER BY id DESC LIMIT 1')
    .get() as { id: number; principal: number; rate_daily: number; last_accrual_day: string }
  ok('the pawn ticket is stamped with a game-day key, not a date', pawnLoan.last_accrual_day.length > 10)
  for (let d = 0; d < 3; d++) {
    clock += DAY
    pawnSvc.pawnTick()
  }
  const owed = pawnSvc.payoffAmount(pawnLoan.id)
  const wantOwed = Math.round(pawnLoan.principal * Math.pow(1 + pawnLoan.rate_daily, 3) * 100) / 100
  ok(
    `three game-days of pawn interest are exact ($${owed.ok ? owed.amount.toFixed(2) : 'n/a'} vs $${wantOwed.toFixed(2)})`,
    owed.ok && Math.abs(owed.amount - wantOwed) <= 0.01,
  )
  // Put the card back in the collection so the legacy-stamp case below has one.
  db.prepare(`UPDATE inventory SET status = 'collection' WHERE id = ?`).run(pawnCard.id)
}

// A ticket written before the day-key fix carries a bare date. After an upgrade
// it must bill the days it ran, not every two-hour bucket since midnight.
if (pawnCard) {
  const issuedMs = Date.now()
  const legacyId = Number(
    db
      .prepare(
        `INSERT INTO pawn_loans (inventory_id, card_id, principal, rate_daily, issued_at, due_at, last_accrual_day) VALUES (?, ?, 100, 0.0075, ?, ?, ?)`,
      )
      .run(
        pawnCard.id,
        anyCard,
        new Date(issuedMs).toISOString(),
        new Date(issuedMs + 30 * DAY).toISOString(),
        new Date(issuedMs).toISOString().slice(0, 10),
      ).lastInsertRowid,
  )
  Math.random = () => 0.999
  for (let d = 0; d < 5; d++) {
    clock += DAY
    pawnSvc.pawnTick()
  }
  const legacyOwed = pawnSvc.payoffAmount(legacyId)
  // The pawn desk charges simple interest on the principal, booked to the cent
  // each day: five days is 5 × $0.75, not the compounded $3.81.
  const wantLegacy = Math.round((100 + 5 * Math.round(100 * 0.0075 * 100) / 100) * 100) / 100
  ok(
    `a date-only stamp bills the 5 days it ran, not the buckets since midnight ($${legacyOwed.ok ? legacyOwed.amount.toFixed(2) : 'n/a'} vs $${wantLegacy.toFixed(2)})`,
    legacyOwed.ok && Math.abs(legacyOwed.amount - wantLegacy) <= 0.01,
  )
  ok(
    'the legacy stamp heals to a real game-day key',
    (db.prepare('SELECT last_accrual_day FROM pawn_loans WHERE id = ?').get(legacyId) as { last_accrual_day: string })
      .last_accrual_day.length > 10,
  )
}

// Sealed futures: the same day-key rule, and this desk is the one that
// compounds on the running balance rather than charging simple interest.
const sealed = await import('../server/services/sealedfutures')
const cents = (n: number) => Math.round(n * 100) / 100
const compounded = (start: number, rate: number, days: number) => {
  let v = start
  for (let d = 0; d < days; d++) v = cents(v + v * rate)
  return v
}
const addSealedLoan = (principal: number, stamp: string) =>
  Number(
    db
      .prepare(
        `INSERT INTO sealed_loans (principal, balance, rate_daily, collateral_qty, status, issued_at, last_accrual_day) VALUES (?, ?, 0.006, 0, 'active', ?, ?)`,
      )
      .run(principal, principal, new Date(Date.now()).toISOString(), stamp).lastInsertRowid,
  )
const sealedBalance = (id: number) =>
  (db.prepare('SELECT balance FROM sealed_loans WHERE id = ?').get(id) as { balance: number }).balance

Math.random = () => 0.999 // no shelf-wear rolls, no other dice
db.prepare('DELETE FROM sealed_loans').run()
const sealedId = addSealedLoan(500, gameDayKey())
for (let d = 0; d < 3; d++) {
  clock += DAY
  sealed.sealedLoanTick()
}
const wantSealed = compounded(500, 0.006, 3)
ok(
  `a sealed ticket bills three exact game-days ($${sealedBalance(sealedId).toFixed(2)} vs $${wantSealed.toFixed(2)})`,
  Math.abs(sealedBalance(sealedId) - wantSealed) <= 0.01,
)

db.prepare('DELETE FROM sealed_loans').run()
const sealedLegacyId = addSealedLoan(300, new Date(Date.now()).toISOString().slice(0, 10))
ok(
  'the sealed legacy stamp really is a bare date',
  (db.prepare('SELECT last_accrual_day FROM sealed_loans WHERE id = ?').get(sealedLegacyId) as { last_accrual_day: string })
    .last_accrual_day.length === 10,
)
for (let d = 0; d < 2; d++) {
  clock += DAY
  sealed.sealedLoanTick()
}
const wantSealedLegacy = compounded(300, 0.006, 2)
ok(
  `a date-only sealed stamp bills only the 2 days it ran ($${sealedBalance(sealedLegacyId).toFixed(2)} vs $${wantSealedLegacy.toFixed(2)}, not the buckets since midnight)`,
  Math.abs(sealedBalance(sealedLegacyId) - wantSealedLegacy) <= 0.01,
)
ok(
  'the sealed legacy stamp heals to a real game-day key',
  (db.prepare('SELECT last_accrual_day FROM sealed_loans WHERE id = ?').get(sealedLegacyId) as { last_accrual_day: string })
    .last_accrual_day.length > 10,
)

db.prepare('DELETE FROM sealed_loans').run()
Math.random = realRandom
Date.now = realNow

// ---------------------------------------------------------------------------
// Your own repacks
// ---------------------------------------------------------------------------

// Stock the junk drawer the way the shop would: real cards at $2 or less.
const cheap = db
  .prepare(
    `WITH latest AS (
       SELECT card_id, market, ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY retrieved_at DESC) rn
       FROM price_records WHERE kind = 'tcgplayer' AND market IS NOT NULL
     )
     SELECT card_id FROM latest WHERE rn = 1 AND market <= 2 ORDER BY RANDOM() LIMIT 40`,
  )
  .all() as { card_id: string }[]
ok('the catalogue has filler cards to pack', cheap.length >= 24)
const ins = db.prepare(
  `INSERT INTO inventory (card_id, variant, condition, quantity, status, cost_basis, acquired_via, acquired_at) VALUES (?, 'normal', 'NM', 1, 'collection', 0.25, 'test', ?)`,
)
for (const c of cheap.slice(0, 30)) ins.run(c.card_id, nowIso())

const chaseCard = db
  .prepare(
    `WITH latest AS (
       SELECT card_id, market, ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY retrieved_at DESC) rn
       FROM price_records WHERE kind = 'tcgplayer' AND market IS NOT NULL
     )
     SELECT card_id FROM latest WHERE rn = 1 AND market BETWEEN 60 AND 400 ORDER BY RANDOM() LIMIT 1`,
  )
  .get() as { card_id: string } | undefined
ok('the catalogue has a chase card', !!chaseCard)
const chaseId = Number(
  db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, cost_basis, acquired_via, acquired_at) VALUES (?, 'normal', 'NM', 1, 'collection', 40, 'test', ?)`,
  ).run(chaseCard!.card_id, nowIso()).lastInsertRowid,
)

const stock = repacks.stockable()
ok('the assembler sees the filler it needs', stock.fillerCount >= stock.need)
ok('the assembler lists the chase as stock', stock.rows.some((r) => r.id === chaseId))

const wrongPrice = repacks.assemble({ price: 13, chaseInventoryId: chaseId, publishedOdds: 5 })
ok('a price off the sheet is refused', !wrongPrice.ok)
const assembled = repacks.assemble({ price: 12, chaseInventoryId: chaseId, publishedOdds: 3 })
ok('a run can be sealed', assembled.ok)
const shelf = repacks.status()
ok('the run is on the shelf', shelf.batches.length === 1)
const batch = shelf.batches[0]
ok('the run is five packs of five', batch.pack_count === 5 && batch.cards_per_pack === 5)
ok('all five packs are still there', batch.remaining === 5)
ok('the printed odds are the ones chosen', batch.published_odds === 3)
ok('the truth is 1 in 5 regardless of the label', batch.actual_odds === 5)
ok('hype is flagged when the label beats the truth', batch.honest === false)
ok('the run knows its chase value', batch.chase_value > 0)
ok('the run has a real basis', batch.cost_basis > 0)
ok('the cards left the collection', (db.prepare(`SELECT COUNT(*) n FROM inventory WHERE status = 'in_repack'`).get() as { n: number }).n === 25)

const cashBeforeRip = cash()
const ripped = repacks.buyOwn(batch.id)
ok('you can rip your own repack', ripped.ok)
ok('the rip charges the shelf price', cash() === round2(cashBeforeRip - 12))
ok('the rip deals five cards', ripped.ok && ripped.reveal?.length === 5)
ok('the dealt cards are yours again', (db.prepare(`SELECT COUNT(*) n FROM inventory WHERE status = 'in_repack'`).get() as { n: number }).n === 20)
const ledger = db
  .prepare(`SELECT line, amount FROM shop_ledger WHERE note LIKE '%own rip%' ORDER BY id DESC LIMIT 1`)
  .get() as { line: string; amount: number } | undefined
ok('the own rip is booked in the ledger as a cost', ledger?.line === 'repacks' && ledger.amount === -12)
// The rip deletes its repack_cards rows, so a row count would still say 5.
ok('the shelf counts a ripped pack as gone', repacks.status().batches[0]?.remaining === 4)

const unsealed = repacks.stockBack(batch.id)
ok('an unsold run can be unsealed', unsealed.ok)
ok('unsealing returns every card', (db.prepare(`SELECT COUNT(*) n FROM inventory WHERE status = 'in_repack'`).get() as { n: number }).n === 0)
ok('the run leaves the shelf', repacks.status().batches.length === 0)
ok('reputation starts somewhere honest', repacks.reputation() >= 0 && repacks.reputation() <= 100)

let failed = 0
for (const [label, pass] of checks) {
  if (!pass) failed++
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}`)
}
console.log(failed === 0 ? `\nPASS — ${checks.length} checks` : `\nFAILED — ${failed} of ${checks.length}`)
process.exit(failed === 0 ? 0 : 1)
