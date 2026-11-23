// The day pass is a flat ticket; the board it opens pays for itself only when it
// is used — a deal claimed on a skipped day pays exactly the margin a resale
// would have paid, so the round trip is proved HERE by actually buying and
// reselling. Runs against a COPY of the save under tmp/daypass-home, never the
// player's real save.
//
//   npx tsx tmp/check-daypass.ts

import fs from 'node:fs'
import path from 'node:path'

let checks = 0
const fails: string[] = []
function ok(cond: unknown, label: string) {
  checks++
  if (!cond) fails.push(label)
}

const home = path.resolve('tmp/daypass-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'server'), { recursive: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
fs.copyFileSync('server/schema.sql', path.join(home, 'server', 'schema.sql'))
for (const suffix of ['', '-wal', '-shm']) {
  const src = path.join('data', `tcglife.db${suffix}`)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(home, 'data', `tcglife.db${suffix}`))
}
process.env.TCGLIFE_HOME = home

const { db, setSetting } = await import('../server/lib/db')
const { installClock, clockOffsetMs, clockSkips } = await import('../server/lib/clock')
const { gameDayKey, gameDayEnd, gameDayHours, gameDayMs, gameDayNumber, resetGameDayCache } = await import('../server/lib/gameday')
const { isSkippedDay, RESALE_FEE_PCT, skippedClaimShare } = await import('../server/lib/skipped-days')
const dailydeals = await import('../server/services/dailydeals')
const daypass = await import('../server/services/daypass')
const packs = await import('../server/services/packs')
const sealed = await import('../server/services/sealed')
const sealedfutures = await import('../server/services/sealedfutures')

installClock()

const cash = () => Math.round((db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash * 100) / 100
const setCash = (n: number) => db.prepare('UPDATE game_state SET cash = ? WHERE id = 1').run(n)
const r2 = (n: number) => Math.round(n * 100) / 100
const created = (db.prepare('SELECT created_at FROM game_state WHERE id = 1').get() as { created_at: string }).created_at

try {
  // ---- the ticket follows the pace --------------------------------------
  // Pinned on the old 12-hour day first, so the body below keeps testing the
  // same $25 pass it always did, then the two other paces it now prices.
  setSetting('dayLengthHours', '12')
  resetGameDayCache()
  ok(gameDayHours() === 12, 'the harness runs the body on the 12-hour clock')
  const FEE = daypass.dayPassFee()
  ok(FEE === 50, 'the 12-hour day costs $50')
  ok(daypass.dayPassFee(2) === 8.33, 'a 2-hour day costs a sixth of that — $8.33')
  ok(daypass.dayPassFee(24) === 100, 'a 24-hour day costs double — $100')
  ok(Math.abs(daypass.PASS_RATE_PER_HOUR - 50 / 12) < 1e-9, 'the rate is $50 per 12 hours of wait')

  // ---- the share is a gap, pinned ---------------------------------------
  ok(RESALE_FEE_PCT === 0.1, 'the resale desk takes 10%')
  ok(skippedClaimShare(90, 100) === 10, 'a claim under its payout adds the difference')
  ok(skippedClaimShare(100, 90) === 0, 'a claim already above its payout adds nothing')
  ok(skippedClaimShare(100, 100) === 0, 'an exactly break-even claim adds nothing')
  ok(skippedClaimShare(700, 990) === 290, 'a $1,000 box at 30% off adds $290')

  // ---- a skip: the ticket out, the landed day marked ---------------------
  ok(clockOffsetMs() === 0, 'a save that never skipped has no clock offset')
  const key0 = gameDayKey()
  const day0 = gameDayNumber(created, new Date())
  setCash(5_000_000)
  const before = cash()
  const first = daypass.skipToNextDay()
  ok(first.ok, 'a funded drawer can buy the pass')
  const landed = gameDayKey()
  ok(landed !== key0, 'the day key turned over')
  ok(r2(before - cash()) === FEE, `the drawer loses exactly the ticket ($${FEE}) — the price of the board it lands on is irrelevant`)
  ok(first.ok && first.fee === FEE, 'the response quotes the ticket')
  ok(clockOffsetMs() === gameDayMs(), 'the clock moved exactly one game-day')
  ok(clockSkips() === 1, 'the skip is counted')
  ok(gameDayNumber(created, new Date()) === day0 + 1, 'the day number advanced by one')
  ok(first.ok && first.day.resetsAt === gameDayEnd(new Date()).toISOString(), 'resetsAt is the new day boundary')

  // ---- the landed day is marked; ordinary days are not -------------------
  ok(isSkippedDay(landed), 'the day the pass opened is marked')
  ok(!isSkippedDay(key0), 'the day before the pass is not marked')

  // ---- what the desk actually pays is NOT shelf minus 10% ----------------
  const board = dailydeals.dealsForToday()
  ok(board.size === 3, 'the skipped day has three deals')
  for (const [id] of board) {
    const market = sealed.priceOf(id).market
    const payout = dailydeals.freshResaleProceeds(id)
    const gross = sealedfutures.conditionPriceOf(id, 'fresh')
    ok(Math.abs(payout - r2(gross * 0.9)) <= 0.01, `${id}: the payout is the fresh price minus 10%`)
    ok(payout > r2(market * 0.9) - 0.01, `${id}: case-fresh pays MORE than shelf minus 10% — a flat 0.9 share would have left a gap`)
  }

  // ---- each deal's share is exactly its own gap -------------------------
  for (const [id, deal] of board) {
    const market = sealed.priceOf(id).market
    const discounted = dailydeals.discountedPrice(market, deal.discountPct)
    const payout = dailydeals.freshResaleProceeds(id)
    ok(deal.surcharge === skippedClaimShare(discounted, payout), `${id}: the share is this deal's own gap to resale`)
    ok(Math.abs(r2(discounted + deal.surcharge) - payout) <= 0.01, `${id}: discounted price plus share equals the payout`)
  }

  // ---- PROOF: buy a board deal, resell it, net about zero ---------------
  const roundTrips: { id: string; pct: number; paid: number; proceeds: number; net: number }[] = []
  for (const [id, deal] of board) {
    const beforeBuy = cash()
    packs.buySealed(id, 1)
    const paid = r2(beforeBuy - cash())
    const payout = dailydeals.freshResaleProceeds(id)
    ok(Math.abs(paid - payout) <= 0.01, `${id} at ${deal.discountPct}%: the claim already costs the resale payout`)

    const sale = sealedfutures.sellSealed(id, 1, 'fresh')
    ok(sale.ok, `${id}: the desk buys the unit straight back`)
    if (sale.ok) {
      ok(Math.abs(sale.proceeds - payout) <= 0.01, `${id}: the desk pays what the share assumed`)
      const net = r2(sale.proceeds - paid)
      const afterSell = r2(cash() - beforeBuy)
      ok(Math.abs(net) <= 0.02, `${id} at ${deal.discountPct}%: the round trip nets ~$0 (net $${net.toFixed(2)})`)
      ok(Math.abs(afterSell - net) <= 0.01, `${id}: and the drawer moves by that same amount`)
      roundTrips.push({ id, pct: deal.discountPct, paid, proceeds: sale.proceeds, net })
    }
  }
  ok(roundTrips.length === 3, 'all three board deals were round-tripped')
  for (const t of roundTrips) console.log(`  round trip ${t.pct}%: paid $${t.paid.toFixed(2)}, desk paid $${t.proceeds.toFixed(2)}, net $${t.net.toFixed(2)}`)
  for (const [id] of board) {
    const market = sealed.priceOf(id).market
    const payout = dailydeals.freshResaleProceeds(id)
    const deep = dailydeals.discountedPrice(market, 30)
    ok(
      Math.abs(r2(deep + skippedClaimShare(deep, payout)) - payout) <= 0.01,
      `${id}: even a 30% deal on a skipped day costs exactly its payout`,
    )
  }

  // ---- a deal is still one claim a day ----------------------------------
  const [dealId] = [...board.keys()]
  let again = ''
  try { packs.buySealed(dealId, 1) } catch (e) { again = e instanceof Error ? e.message : String(e) }
  ok(/already claimed/i.test(again), 'the deal cannot be claimed twice in one day')

  // ---- a product that is NOT on the board pays no share ------------------
  const boardIds = new Set(board.keys())
  const other = (db.prepare('SELECT id, set_id FROM pack_products').all() as { id: string; set_id: string }[])
    .find((p) => !boardIds.has(p.id) && sealed.sellsProduct(p.id, p.set_id) && sealed.priceOf(p.id).market > 0)
  ok(Boolean(other), 'the catalogue has a product off the board')
  if (other) {
    const plain = sealed.priceOf(other.id).market
    ok(dailydeals.dealForToday(other.id) === null, 'an off-board product has no deal')
    ok(dailydeals.passShareFor(other.id, 30) === 0, 'an off-board product carries no share at any discount')
    const beforeOther = cash()
    packs.buySealed(other.id, 1)
    ok(r2(beforeOther - cash()) === plain, 'an off-board product costs its plain shelf price')
  }

  // ---- refusal below the ticket -----------------------------------------
  setCash(24.99)
  const broke = daypass.skipToNextDay()
  ok(!broke.ok, 'a drawer below the ticket cannot buy the pass')
  ok(!broke.ok && broke.fee === FEE, 'the refusal quotes the ticket')
  ok(clockOffsetMs() === gameDayMs(), 'a refused pass does not move the clock')
  ok(cash() === 24.99, 'a refused pass does not take cash')
  ok(!broke.ok && /day pass costs/.test(broke.error), 'the refusal names the ticket')

  // ---- a reset clears the markers and puts the clock back ----------------
  setCash(5_000_000)
  ok(daypass.skipToNextDay().ok, 'a topped-up drawer buys another pass')
  ok(clockOffsetMs() === 2 * gameDayMs(), 'two skips are two days ahead')
  ok(isSkippedDay(gameDayKey()), 'the second landed day is marked too')

  const { resetSave } = await import('../server/services/savereset')
  const keyBeforeReset = gameDayKey()
  resetSave()
  ok(clockOffsetMs() === 0, 'a reset puts the RUNNING clock back on real time')
  ok(clockSkips() === 0, 'a reset forgets the skips')
  ok(!isSkippedDay(gameDayKey()), 'a reset forgets which days a pass opened')
  ok(
    !db.prepare("SELECT 1 FROM meta WHERE key IN ('clock:offsetMs','clock:skips','daypass:days')").get(),
    'a reset leaves no clock or pass keys in meta',
  )
  ok(gameDayKey() !== keyBeforeReset, 'the fresh save is not still on the skipped day')
  const createdAfter = (db.prepare('SELECT created_at FROM game_state WHERE id = 1').get() as { created_at: string }).created_at
  ok(Math.abs(Date.parse(createdAfter) - Date.now()) < 60_000, 'created_at is stamped on the real clock')
  ok(gameDayNumber(createdAfter, new Date()) === 1, 'the reset save is day 1')
  ok(Math.round(cash()) === 1000, 'the reset save starts with $1,000')
  const freshBoard = dailydeals.dealsForToday()
  ok([...freshBoard.values()].every((d) => d.surcharge === 0), 'a fresh day’s deals carry no margin')
  ok(daypass.dayPassFee() === 50, 'the ticket is $50 on a 12-hour day after a reset')

  // ---- on the live 2-hour pace the ticket is a sixth ---------------------
  setSetting('dayLengthHours', '2')
  resetGameDayCache()
  const fee2 = daypass.dayPassFee()
  ok(fee2 === 8.33, 'a 2-hour save quotes $8.33, not $50')
  ok(r2(daypass.PASS_RATE_PER_HOUR * 2) === fee2, 'the 2h ticket is exactly the rate times two hours')
  setCash(1_000)
  const before2 = cash()
  const skip2 = daypass.skipToNextDay()
  ok(skip2.ok, 'the cheaper pass still buys a skip')
  ok(r2(before2 - cash()) === 8.33, 'the drawer loses exactly $8.33')
  ok(skip2.ok && skip2.fee === 8.33, 'the response quotes $8.33')
  ok(clockOffsetMs() === 2 * 3_600_000, 'the pass still moves the clock exactly two hours')
  ok(gameDayMs() === 2 * 3_600_000, 'the day it skipped is a 2-hour day')
} catch (e) {
  fails.push(`threw: ${e instanceof Error ? e.message : String(e)}`)
}

// The copy is left in place: better-sqlite3 still holds the file on Windows.
try { db.close() } catch { /* already closed */ }

if (fails.length > 0) {
  console.error(`FAIL — ${fails.length}/${checks} checks failed:`)
  for (const f of fails) console.error(`  • ${f}`)
  process.exit(1)
}
console.log(`PASS — ${checks} checks`)
