// A raw card with no sleeve sells for less at every counter that names its own
// price — buylist, instant dealer, pawn, convention tables — while a protected
// or graded copy pays full. Runs on a COPY of the save (tmp/bare-home).
//
//   npx tsx tmp/check-bare-sales.ts

import fs from 'node:fs'
import path from 'node:path'

let checks = 0
const fails: string[] = []
function ok(cond: unknown, label: string) {
  checks++
  if (!cond) fails.push(label)
}

const home = path.resolve('tmp/bare-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'server'), { recursive: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
fs.copyFileSync('server/schema.sql', path.join(home, 'server', 'schema.sql'))
for (const suffix of ['', '-wal', '-shm']) {
  const src = path.join('data', `tcglife.db${suffix}`)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(home, 'data', `tcglife.db${suffix}`))
}
process.env.TCGLIFE_HOME = home

const { db, setMeta } = await import('../server/lib/db')
const { installClock } = await import('../server/lib/clock')
const { round2, valueOf } = await import('../server/services/market')
const supplies = await import('../server/services/supplies')
const buylist = await import('../server/services/buylist')
const resale = await import('../server/services/resale')
const pawn = await import('../server/services/pawn')
const floor = await import('../server/services/floor')

installClock()

const r2 = (n: number) => Math.round(n * 100) / 100
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol
const setProt = (id: number, p: string | null) => db.prepare('UPDATE inventory SET protection = ? WHERE id = ?').run(p, id)

try {
  // ---- the factor itself -------------------------------------------------
  ok(supplies.BARE_SALE_CUT === 0.06, 'the bare cut is 6%')
  ok(supplies.presentationFactor(null) === 1 - supplies.BARE_SALE_CUT, 'a bare row prices at 0.94')
  ok(supplies.presentationFactor('sleeve') === 1, 'a sleeved row prices at 1')
  ok(supplies.presentationFactor('toploader') === 1, 'a toploader prices at 1')
  ok(supplies.presentationFactor(null, true) === 1, 'a slab prices at 1 even with no sleeve')

  const card = db
    .prepare(
      `SELECT c.id, c.name, p.market FROM cards c JOIN price_records p ON p.card_id = c.id
       WHERE p.kind = 'tcgplayer' AND p.market > 150 ORDER BY p.market DESC LIMIT 1`,
    )
    .get() as { id: string; name: string; market: number } | undefined
  ok(Boolean(card), 'the catalogue has a card worth testing on')
  if (!card) throw new Error('no priced card')
  const anchor = round2(valueOf(card.id, 'normal', 'NM'))
  ok(anchor > 50, `the test card has a real anchor ($${anchor})`)

  const insert = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at, protection)
     VALUES (?, 'normal', 'NM', 1, 'collection', 'test', 10, ?, ?)`,
  )
  const at = new Date().toISOString()

  // ---- buylist: the same row, bare vs sleeved ---------------------------
  const shopId = buylist.SHOPS[0].id
  const buyId = Number(insert.run(card.id, at, null).lastInsertRowid)
  const off = (id: number) => buylist.collectionOffer(shopId).offers.find((o) => o.inventoryId === id)
  const bareBuy = off(buyId)
  setProt(buyId, 'sleeve')
  const protBuy = off(buyId)
  ok(Boolean(bareBuy && protBuy), 'the buylist quotes the test row')
  if (bareBuy && protBuy) {
    ok(bareBuy.bare === true, 'the bare quote is flagged bare')
    ok(protBuy.bare === false, 'the sleeved quote is not')
    ok(bareBuy.market === protBuy.market, 'the market column is unchanged — only the rate moves')
    ok(near(bareBuy.payoutCash, r2(protBuy.payoutCash * 0.94), 0.02), 'the bare cash leg is 6% under the sleeved one')
    ok(near(bareBuy.payoutCredit, r2(protBuy.payoutCredit * 0.94), 0.02), 'and so is the credit leg')
  }

  // ---- pawn: sell outright, and the loan against it ---------------------
  const pawnQuote = (id: number) => pawn.quotes().quotes.find((q) => q.inventoryId === id)
  const protPawn = pawnQuote(buyId)
  setProt(buyId, null)
  const barePawn = pawnQuote(buyId)
  ok(Boolean(protPawn && barePawn), 'the pawn counter quotes the test row')
  if (protPawn && barePawn) {
    ok(near(barePawn.cashNow, r2(protPawn.cashNow * 0.94), 0.02), 'the bare cash-now offer is 6% under')
    ok(near(barePawn.loanMax, r2(protPawn.loanMax * 0.94), 0.02), 'and the loan against it matches that read')
    const sold = pawn.sellOutright(buyId)
    ok(sold.ok, 'the counter buys the bare card')
    if (sold.ok) ok(near(sold.paid, barePawn.cashNow, 0.01), 'and pays exactly the quoted bare cash-now number')
  }

  // ---- the instant dealer: quote and sale agree, both discounted --------
  const flipId = Number(insert.run(card.id, at, null).lastInsertRowid)
  db.prepare(`UPDATE inventory SET acquired_via = 'resale' WHERE id = ?`).run(flipId)
  const lot = () => resale.flipStock().lots.find((l) => l.inventoryId === flipId)
  const bareLot = lot()
  setProt(flipId, 'toploader')
  const protLot = lot()
  ok(Boolean(bareLot && protLot), 'the dealer quotes the flip stock')
  if (bareLot && protLot) {
    ok(bareLot.bare === true && protLot.bare === false, 'only the bare lot is flagged')
    ok(near(bareLot.offer, r2(protLot.offer * 0.94), 0.02), 'the bare offer is 6% under the protected one')
    setProt(flipId, null)
    const sale = resale.instantSell(flipId)
    ok(sale.ok, 'the dealer takes the bare card')
    if (sale.ok) ok(near(sale.proceeds, bareLot.offer, 0.01), 'and pays the bare number the shelf showed')
  }

  // ---- a convention table ----------------------------------------------
  // Park the rest of the collection so the random 200-row draw cannot drop the
  // row being tested; this is a copy of the save.
  db.prepare(`UPDATE inventory SET status = 'parked' WHERE status = 'collection'`).run()
  const floorId = Number(insert.run(card.id, at, null).lastInsertRowid)
  const now = Date.now()
  const showId = Number(
    db
      .prepare(`INSERT INTO conventions (name, blurb, entry_fee, opened_at, closes_at) VALUES ('Bare Test Show', 'x', 0, ?, ?)`)
      .run(new Date(now - 3_600_000).toISOString(), new Date(now + 6 * 3_600_000).toISOString()).lastInsertRowid,
  )
  const boothId = Number(
    db
      .prepare(`INSERT INTO convention_booths (convention_id, vendor_name, avatar, specialty, blurb, mood, player_offered, seller_counters, sour) VALUES (?, 'Test Dealer', '🧢', 'vintage', 'x', 55, NULL, 0, 0)`)
      .run(showId).lastInsertRowid,
  )
  setMeta(`conventionEntry:${showId}`, '1')
  const floorQuote = () => {
    const d = floor.sellOffers(boothId, 500)
    return d.ok ? d.offers.find((o) => o.id === floorId) : undefined
  }
  const bareFloor = floorQuote()
  setProt(floorId, 'sleeve')
  const protFloor = floorQuote()
  ok(Boolean(bareFloor && protFloor), 'the convention dealer quotes the test row')
  if (bareFloor && protFloor) {
    ok(bareFloor.bare === true && protFloor.bare === false, 'only the bare offer is flagged')
    ok(near(bareFloor.offer, r2(protFloor.offer * 0.94), 0.02), 'the bare cash offer is 6% under')
    ok(near(bareFloor.creditOffer, r2(protFloor.creditOffer * 0.94), 0.02), 'and so is the credit offer')
    setProt(floorId, null)
    const sold = floor.sellToDealer(boothId, floorId, 'cash')
    ok(sold.ok && sold.sold === true, 'the dealer buys the bare card')
    if (sold.ok && sold.sold) ok(near(sold.paid, bareFloor.offer, 0.01), 'at exactly the bare offer on the sheet')
  }

  // ---- a slab pays full, no sleeve needed -------------------------------
  db.prepare(`UPDATE inventory SET status = 'parked' WHERE status = 'collection'`).run()
  const slabId = Number(
    db
      .prepare(
        `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at, protection, graded_grade)
         VALUES (?, 'normal', 'NM', 1, 'collection', 'test', 10, ?, NULL, 'PSA 10')`,
      )
      .run(card.id, at).lastInsertRowid,
  )
  const slabOffer = off(slabId)
  ok(Boolean(slabOffer), 'the buylist quotes the slab')
  if (slabOffer) {
    ok(slabOffer.bare === false, 'a slab is never flagged bare')
    setProt(slabId, 'one_touch')
    const slabProtected = off(slabId)
    ok(Boolean(slabProtected) && near(slabOffer.payoutCash, slabProtected!.payoutCash, 0.01), 'and sleeving a slab changes nothing')
  }
} catch (e) {
  fails.push(`threw: ${e instanceof Error ? e.message : String(e)}`)
}

// The copy is left in place: Windows keeps the file open past db.close().
try { db.close() } catch { /* already closed */ }

if (fails.length > 0) {
  console.error(`FAIL — ${fails.length}/${checks} checks failed:`)
  for (const f of fails) console.error(`  • ${f}`)
  process.exit(1)
}
console.log(`PASS — ${checks} checks`)
