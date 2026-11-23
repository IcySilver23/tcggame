// Economy check for the two new businesses: the lending desk and your own
// repacks. It drives the REAL services (lendingTick, lend, repackTick,
// assemble) against a copy of the save and reports what a dollar put into each
// one comes back as.
//
//   npx tsx server/scripts/hustle-sim.ts [trials]
//
// Method, stated because it matters:
//   • Time is compressed. A loan runs 14 game-days, and the real clock can only
//     advance one day per wall-clock boundary, so the sim moves a loan's accrual
//     key and due date one day closer per iteration and calls lendingTick —
//     the same code the game runs, just faster.
//   • The repack sim calls repackTick once per simulated shop tick; each call is
//     one customer passing the shelf, which is exactly what the shop does.
//   • A defaulted card is worth its market value on paper, but realising it
//     costs money (fees, postage, time), so results are reported both at market
//     and at 85% — the number that matters for "does this print money".
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const trials = Math.max(50, Number(process.argv[2] ?? 300))
const home = path.join(process.cwd(), 'tmp', 'hustle-sim-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
{
  const src = new Database(path.join(process.cwd(), 'data', 'tcglife.db'), { readonly: true })
  await src.backup(path.join(home, 'data', 'tcglife.db'))
  src.close()
}
process.env.TCGLIFE_HOME = home

const { db, nowIso } = await import('../lib/db')
const lending = await import('../services/lending')
const repacks = await import('../services/repacks')
const shop = await import('../services/shop')
const { round2, valueOf } = await import('../services/market')
const { gameDayKey, gameDayMs } = await import('../lib/gameday')

// A controllable clock. The sim advances it by exactly one game-day per step,
// so the desk's own accrual and due dates see real day boundaries instead of a
// rewritten timestamp — no faked calendar, no double-counted interest.
const realNow = Date.now
// Start at midnight UTC today rather than "now": a run begun at 10:58 and one
// begun at 11:02 land in different two-hour buckets, which shifts a few tickets
// by a day and moves the averages by cents. Same day, same save, same start.
let clockOffset = Math.floor(realNow() / 86_400_000) * 86_400_000 - realNow()
Date.now = () => realNow() + clockOffset
const DAY = gameDayMs()
function advanceOneDay() {
  clockOffset += DAY
}

// Reproducible dice. The desk rolls a repayment chance every game-day, so an
// unseeded sim gives a different answer each run — and a number nobody can
// reproduce is not a measurement. Same seed, same save, same table.
//   SIM_SEED=12345 npx tsx server/scripts/hustle-sim.ts 120
const SEED = Number(process.env.SIM_SEED ?? 20261123)
let seedState = SEED >>> 0
Math.random = function seededRandom(): number {
  seedState = (seedState + 0x6d2b79f5) >>> 0
  let t = seedState
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)]

const cash = () => (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
db.prepare('UPDATE game_state SET cash = 50000000 WHERE id = 1').run()
if (!shop.getShop()) shop.lease('Sim Shop', 'hole-in-the-wall')

const pct = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`
const usd = (n: number) => `$${n.toFixed(2)}`

// ---------------------------------------------------------------------------
// LENDING
// ---------------------------------------------------------------------------

type Outcome = { principal: number; cashIn: number; collateral: number; defaulted: boolean; worstAccrual: number }

// Drawn from a fixed, ordered list by our own dice: SQLite's RANDOM() does not
// see the seeded Math.random, so leaving it in this path would break replay.
const lendingPool = db
  .prepare(
    `WITH latest AS (
       SELECT card_id, market, ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY retrieved_at DESC) rn
       FROM price_records WHERE kind = 'tcgplayer' AND market IS NOT NULL
     )
     SELECT l.card_id, l.market FROM latest l WHERE l.rn = 1 AND l.market BETWEEN 40 AND 1500
     ORDER BY l.card_id`,
  )
  .all() as { card_id: string; market: number }[]

function offerRow(): { id: number; ask: number; market: number; card_id: string } | null {
  // Everything but the collateral rule is the desk's own: a card with real
  // market data, priced into the lending limit.
  const row = pick(lendingPool)
  if (!row) return null
  const market = round2(valueOf(row.card_id, 'normal', 'NM') || row.market)
  if (market < 40) return null
  // Ask from the desk's own band — the sim used to invent a 30–60% ask here and
  // measured a windfall the game no longer offers.
  const [lo, hi] = lending.DESK_TERMS.askBand
  const ask = round2(Math.min(market * lending.DESK_TERMS.maxLtv, Math.max(10, market * (lo + Math.random() * (hi - lo)))))
  const now = nowIso()
  const info = db
    .prepare(`INSERT INTO lend_offers (borrower, card_id, condition, market, ask, created_at, expires_at) VALUES ('Sim', ?, 'NM', ?, ?, ?, ?)`)
    .run(row.card_id, market, ask, now, new Date(Date.now() + 3 * 86_400_000).toISOString())
  return { id: Number(info.lastInsertRowid), ask, market, card_id: row.card_id }
}

// The desk's own spawner rolls `Math.random() < 0.65` once per empty queue slot
// and draws again inside spawnOffer, and its card pick is SQLite RANDOM() — so a
// half-empty queue shifts every later repayment roll by a variable number of
// draws and no two runs agree. Filling the queue to its cap makes the spawner
// silent, which is what makes a seeded run actually replayable.
function fillDeskQueue(): void {
  if (!lendingPool.length) return
  const open = (db.prepare(`SELECT COUNT(*) n FROM lend_offers WHERE status = 'open'`).get() as { n: number }).n
  for (let i = open; i < lending.DESK_TERMS.openOffers; i++) {
    const card = lendingPool[(open + i) % lendingPool.length]
    db.prepare(
      `INSERT INTO lend_offers (borrower, card_id, condition, market, ask, created_at, expires_at) VALUES ('Queue', ?, 'NM', ?, ?, ?, ?)`,
    ).run(
      card.card_id,
      50,
      10,
      nowIso(),
      new Date(Date.now() + 999 * DAY).toISOString(),
    )
  }
}

function simulateLoan(rate: number, shock: number): Outcome | null {
  const offer = offerRow()
  if (!offer) return null
  const wrote = lending.lend(offer.id, rate)
  if (!wrote.ok) return null
  // Baseline for "what came back": the till AFTER the principal left, so a
  // repayment counts the whole payoff and a default counts nothing.
  const afterLend = cash()
  const loan = db.prepare(`SELECT * FROM lend_loans WHERE offer_id = ?`).get(offer.id) as { id: number; card_id: string; principal: number; status: string }
  // The collateral's price row, so a falling market can be applied for real and
  // put back afterwards — every trial starts from the same prices.
  const priceRow = db
    .prepare(
      `SELECT id, market FROM price_records WHERE card_id = ? AND kind = 'tcgplayer' AND market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1`,
    )
    .get(loan.card_id) as { id: number; market: number } | undefined
  let worstAccrual = 0
  for (let d = 1; d <= lending.DESK_TERMS.days + 1; d++) {
    const live = db.prepare(`SELECT status, interest_earned FROM lend_loans WHERE id = ?`).get(loan.id) as {
      status: string
      interest_earned: number
    }
    if (live.status !== 'active') break
    advanceOneDay()
    // The real downside: the card you took as collateral is worth less by the
    // time the ticket runs out, and the desk prices the default off today's
    // market, not the market it lent against.
    if (shock !== 0 && priceRow) {
      db.prepare(`UPDATE price_records SET market = ROUND(MAX(0.01, market * ?), 2) WHERE id = ?`).run(1 + shock, priceRow.id)
    }
    lending.lendingTick()
    const after = db.prepare(`SELECT interest_earned, status FROM lend_loans WHERE id = ?`).get(loan.id) as {
      interest_earned: number
      status: string
    }
    // One game-day means one day of simple interest on this ticket. If the
    // accrual ever disagrees, the sim says so instead of averaging it away.
    const expected = round2(loan.principal * rate)
    worstAccrual = Math.max(worstAccrual, Math.abs(after.interest_earned - live.interest_earned - expected))
  }
  const done = db.prepare(`SELECT * FROM lend_loans WHERE id = ?`).get(loan.id) as {
    status: string
    principal: number
    repaid_amount: number | null
    card_id: string
  }
  const after = cash()
  const collateral = done.status === 'defaulted' ? round2(valueOf(done.card_id, 'normal', 'NM')) : 0
  if (priceRow) db.prepare(`UPDATE price_records SET market = ? WHERE id = ?`).run(priceRow.market, priceRow.id)
  return {
    principal: done.principal,
    cashIn: round2(after - afterLend),
    collateral,
    defaulted: done.status === 'defaulted',
    worstAccrual: round2(worstAccrual),
  }
}

console.log(`hustle sim — ${trials} trials per scenario, seed ${SEED} (SIM_SEED to change it), save copy at ${path.relative(process.cwd(), home)}\n`)

// A repo card is not worth its market price to you until it is sold: 85% is a
// good day (a local buyer), 70% is a buylist or a marketplace fee. Both matter.
const LIQ_GOOD = 0.85
const LIQ_POOR = 0.7

fillDeskQueue()

// The market moving against the collateral is the whole risk in a lending book.
// Each scenario drifts the ticket's price row once per game-day and puts it back
// after settlement, so trials stay independent.
for (const shock of [0, -0.01, -0.03, -0.06]) {
  const label = shock === 0 ? 'steady market' : `market falling ${Math.abs(shock * 100).toFixed(0)}%/game-day`
  const n = shock === 0 ? trials : Math.ceil(trials / 2)
  console.log(`\nLENDING DESK — ${label} (14 game-day tickets, limit 80% of market, ${n} tickets per rate)`)
  console.log('rate      loans  defaulted  avg lent   avg cash back  collateral  ret @85%   ret @70%   per day @85%')
  for (const rate of lending.DESK_TERMS.rates) {
    const outs: Outcome[] = []
    for (let i = 0; i < n; i++) {
      const o = simulateLoan(rate, shock)
      if (o) outs.push(o)
    }
    if (!outs.length) continue
    const lent = outs.reduce((a, o) => a + o.principal, 0)
    const back = outs.reduce((a, o) => a + o.cashIn, 0)
    const coll = outs.reduce((a, o) => a + o.collateral, 0)
    const defaults = outs.filter((o) => o.defaulted).length
    const worstAccrual = Math.max(...outs.map((o) => o.worstAccrual), 0)
    const retGood = (back + coll * LIQ_GOOD - lent) / Math.max(1, lent)
    const retPoor = (back + coll * LIQ_POOR - lent) / Math.max(1, lent)
    console.log(
      `${(rate * 100).toFixed(2)}%/d  ${String(outs.length).padStart(4)}  ${String(defaults).padStart(9)}  ${usd(lent / outs.length).padStart(9)}  ${usd(back / outs.length).padStart(13)}  ${usd(coll / outs.length).padStart(10)}  ${pct(retGood).padStart(9)}  ${pct(retPoor).padStart(9)}  ${pct(retGood / lending.DESK_TERMS.days).padStart(10)}`,
    )
    console.log(`          accrual check: worst per-day deviation ${usd(worstAccrual)} across ${outs.length} tickets (each game-day bills principal × rate exactly)`)
    db.prepare(`DELETE FROM lend_loans`).run()
    db.prepare(`DELETE FROM lend_offers`).run()
    fillDeskQueue()
  }
}

// ---------------------------------------------------------------------------
// REPACKS
// ---------------------------------------------------------------------------

const cheap = db
  .prepare(
    `WITH latest AS (
       SELECT card_id, market, ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY retrieved_at DESC) rn
       FROM price_records WHERE kind = 'tcgplayer' AND market IS NOT NULL
     )
     SELECT card_id FROM latest WHERE rn = 1 AND market <= 2 ORDER BY card_id LIMIT 40`,
  )
  .all() as { card_id: string }[]
// A rational player does not put a $300 card behind a $20 wrapper: they pick a
// chase close to the 4× floor the rule demands. The sim plays that way, because
// measuring a random expensive card would measure a mistake, not the product.
const chaseBands = new Map<number, { card_id: string; market: number }[]>()
function chaseFor(price: number): { card_id: string; market: number } {
  let band = chaseBands.get(price)
  if (!band) {
    band = db
      .prepare(
        `WITH latest AS (
           SELECT card_id, market, ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY retrieved_at DESC) rn
           FROM price_records WHERE kind = 'tcgplayer' AND market IS NOT NULL
         )
         SELECT card_id, market FROM latest WHERE rn = 1 AND market BETWEEN ? AND ? ORDER BY card_id`,
      )
      .all(price * 4, price * 6) as { card_id: string; market: number }[]
    chaseBands.set(price, band)
  }
  return pick(band) ?? { card_id: '', market: price * 4 }
}

function stockBatch(chase: { card_id: string; market: number }): { chaseId: number; ok: boolean } {
  const ins = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, cost_basis, acquired_via, acquired_at) VALUES (?, 'normal', 'NM', 1, 'collection', 0.25, 'sim', ?)`,
  )
  for (const c of cheap) ins.run(c.card_id, nowIso())
  const chaseId = Number(
    db
      .prepare(
        `INSERT INTO inventory (card_id, variant, condition, quantity, status, cost_basis, acquired_via, acquired_at) VALUES (?, 'normal', 'NM', 1, 'collection', ?, 'sim', ?)`,
      )
      // Bought at half market — the flipper's edge, not free money.
      .run(chase.card_id, round2(chase.market * 0.5), nowIso()).lastInsertRowid,
  )
  return { chaseId, ok: true }
}

function simulateRun(printedOdds: number, price: number) {
  const { chaseId } = stockBatch(chaseFor(price))
  const sealed = repacks.assemble({ price, chaseInventoryId: chaseId, publishedOdds: printedOdds })
  if (!sealed.ok) return null
  const batch = (repacks.status().batches[0] ?? null) as { id: number; cost_basis: number } | null
  if (!batch) return null
  let ticks = 0
  while (ticks < 200_000) {
    const live = repacks.status().batches.find((b) => b.id === batch.id)
    if (!live) break
    repacks.repackTick()
    ticks++
  }
  const done = db.prepare(`SELECT * FROM repacks WHERE id = ?`).get(batch.id) as
    | { sold: number; revenue: number; complaints: number; cost_basis: number }
    | undefined
  // What the run GAVE AWAY is the honest cost: the chase and filler at market,
  // not what they once cost you. Basis alone makes a $20 repack look like +117%
  // while it is quietly handing over a $300 card for $100.
  const packs = db
    .prepare(`SELECT i.card_id, i.variant, i.condition FROM repack_cards rc JOIN inventory i ON i.id = rc.inventory_id WHERE rc.repack_id = ?`)
    .all(batch.id) as { card_id: string; variant: string; condition: string }[]
  const marketGiven = round2(packs.reduce((a, c) => a + valueOf(c.card_id, c.variant || 'normal', (c.condition as 'NM') || 'NM'), 0))
  return {
    revenue: done?.revenue ?? 0,
    basis: batch.cost_basis,
    marketGiven,
    complaints: done?.complaints ?? 0,
    ticks,
    sold: done?.sold ?? 0,
  }
}

console.log('\nREPACKS (five packs per run, truth 1 in 5, filler from bulk)')
console.log('label     price  runs  avg revenue  market given  margin vs basis  margin vs market  complaints  ticks')

for (const price of [8, 12, 20] as const) {
  for (const printed of [3, 5, 10] as const) {
    const runs: { revenue: number; basis: number; marketGiven: number; complaints: number; ticks: number }[] = []
    for (let i = 0; i < Math.min(trials, 120); i++) {
      const r = simulateRun(printed, price)
      if (r) runs.push(r)
      db.prepare(`DELETE FROM repack_cards`).run()
      db.prepare(`DELETE FROM repacks`).run()
    }
    if (runs.length === 0) continue
    const rev = runs.reduce((a, r) => a + r.revenue, 0) / runs.length
    const basis = runs.reduce((a, r) => a + r.basis, 0) / runs.length
    const given = runs.reduce((a, r) => a + r.marketGiven, 0) / runs.length
    const comp = runs.reduce((a, r) => a + r.complaints, 0) / runs.length
    const ticks = runs.reduce((a, r) => a + r.ticks, 0) / runs.length
    console.log(
      `1 in ${String(printed).padEnd(4)}  ${String(price).padStart(4)}  ${String(runs.length).padStart(4)}  ${usd(rev).padStart(11)}  ${usd(given).padStart(12)}  ${pct((rev - basis) / Math.max(0.01, basis)).padStart(15)}  ${pct((rev - given) / Math.max(0.01, given)).padStart(16)}  ${comp.toFixed(2).padStart(10)}  ${ticks.toFixed(0).padStart(5)}`,
    )
  }
}
console.log(`\nrepack reputation now ${repacks.reputation()}/100 (the sim leaves it where the runs put it)`)
