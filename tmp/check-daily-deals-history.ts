// Daily-deal history coverage for the sealed check suite.
//
// The test runs on its own copy of the suite's isolated save because it writes
// both daily-deal tables. It proves two separate things:
//
//   1. today's board is snapshotted with the product's name, set, kind, base
//      price, discount, deal price and slot, and a re-record cannot overwrite
//      what the player saw;
//   2. the past-board query returns the three newest days, excludes today and
//      older days, and marks claimed only when the purchase matches both the
//      day and the product (a product claimed on one day is missed on another).
//
// Run by tmp/check-sealed-suite.ts, never on data/tcglife.db.
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const sourceHome = process.env.TCGLIFE_HOME
if (!sourceHome) {
  console.error('daily-deal history check must run with TCGLIFE_HOME set')
  process.exit(1)
}

const home = join(root, 'tmp', 'daily-deal-check-home')
rmSync(home, { recursive: true, force: true })
mkdirSync(join(home, 'data'), { recursive: true })
for (const suffix of ['', '-wal', '-shm']) {
  const file = join(resolve(sourceHome), 'data', `tcglife.db${suffix}`)
  if (existsSync(file)) copyFileSync(file, join(home, 'data', `tcglife.db${suffix}`))
}
copyFileSync(join(root, 'server', 'schema.sql'), join(home, 'schema.sql'))
process.env.TCGLIFE_HOME = home

const { db } = await import('../server/lib/db')
const { gameDayKey, gameDayMs } = await import('../server/lib/gameday')
const { dealForToday, dealsForToday, discountedPrice, historyForPlayer, resetDailyDealsCache } =
  await import('../server/services/dailydeals')
const sealed = await import('../server/services/sealed')

function fail(message: string): never {
  throw new Error(`daily-deal history: ${message}`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message)
}

try {
  // -------------------------------------------------------------------------
  // Today: the board is written once, with the exact values the shop showed.
  // -------------------------------------------------------------------------
  db.prepare('DELETE FROM daily_deal_history').run()
  db.prepare('DELETE FROM daily_deal_purchases').run()
  resetDailyDealsCache()

  const todayKey = gameDayKey()
  const deals = dealsForToday()
  assert(deals.size >= 3, `expected at least three deals on today's board, got ${deals.size}`)
  const expectedRows = [...deals.keys()].filter((id) => sealed.priceOf(id).market > 0)
  assert(expectedRows.length >= 3, 'today\'s board has fewer than three priced products')

  const todayRows = db
    .prepare(`SELECT * FROM daily_deal_history WHERE day_key = ? ORDER BY slot ASC`)
    .all(todayKey) as {
      day_key: string
      product_id: string
      slot: number
      product_name: string
      set_name: string
      kind: string
      discount_pct: number
      base_price: number
      deal_price: number
      ends_at: string
      recorded_at: string
    }[]
  assert(todayRows.length === expectedRows.length, `today history has ${todayRows.length} rows, expected ${expectedRows.length}`)

  const products = new Map(
    (db.prepare(`SELECT p.id, p.name, p.kind, s.name AS set_name FROM pack_products p JOIN sets s ON s.id = p.set_id`).all() as {
      id: string
      name: string
      kind: string
      set_name: string
    }[]).map((p) => [p.id, p]),
  )

  todayRows.forEach((row, index) => {
    const deal = deals.get(row.product_id)
    const product = products.get(row.product_id)
    assert(deal, `history row ${row.product_id} is not on today's board`)
    assert(product, `history row ${row.product_id} has no product`)
    assert(row.slot === index, `slot ${row.slot} is not sequential at ${index}`)
    assert(row.product_name === product.name, `snapshot name ${row.product_name} != ${product.name}`)
    assert(row.set_name === product.set_name, `snapshot set ${row.set_name} != ${product.set_name}`)
    assert(row.kind === product.kind, `snapshot kind ${row.kind} != ${product.kind}`)
    assert(row.discount_pct === deal.discountPct, `snapshot discount ${row.discount_pct} != ${deal.discountPct}`)
    const base = sealed.priceOf(row.product_id).market
    assert(row.base_price === base, `snapshot base ${row.base_price} != ${base}`)
    assert(row.deal_price === discountedPrice(base, deal.discountPct), `snapshot deal ${row.deal_price} is wrong`)
    assert(row.ends_at === deal.endsAt, `snapshot endsAt ${row.ends_at} != ${deal.endsAt}`)
  })

  const first = todayRows[0]
  db.prepare('UPDATE pack_products SET name = ? WHERE id = ?').run('Renamed after the snapshot', first.product_id)
  resetDailyDealsCache()
  dealsForToday()
  const rerecorded = db
    .prepare('SELECT product_name FROM daily_deal_history WHERE day_key = ? AND product_id = ?')
    .get(todayKey, first.product_id) as { product_name: string }
  assert(rerecorded.product_name === first.product_name, 'a later board re-record overwrote the snapshot name')

  const claimed = dealForToday(first.product_id)
  assert(claimed && claimed.claimed === false, 'the untouched deal reads claimed before purchase')

  // -------------------------------------------------------------------------
  // Past boards: three newest days, newest first, with per-day claim joins.
  // -------------------------------------------------------------------------
  db.prepare('DELETE FROM daily_deal_history').run()
  db.prepare('DELETE FROM daily_deal_purchases').run()

  const dayKeys = [1, 2, 3, 4].map((n) => gameDayKey(new Date(Date.now() - n * gameDayMs())))
  assert(new Set(dayKeys).size === 4, 'past game-day keys are not distinct')
  const insertHistory = db.prepare(`
    INSERT INTO daily_deal_history
      (day_key, product_id, slot, product_name, set_name, kind, discount_pct, base_price, deal_price, ends_at, recorded_at)
    VALUES (?, ?, ?, ?, ?, 'booster', ?, ?, ?, ?, ?)
  `)
  const insertClaim = db.prepare('INSERT INTO daily_deal_purchases (day_key, product_id, purchased_at) VALUES (?, ?, ?)')
  const now = new Date().toISOString()
  const snapshot = new Map<string, { name: string; set: string; discount: number; base: number; deal: number }>()

  dayKeys.forEach((dayKey, dayIndex) => {
    for (let slot = 0; slot < 3; slot++) {
      // The second offer reuses one product id on every day: a claim on day 1
      // must not bleed into day 2's row.
      const productId = slot === 1 ? 'past-shared' : `past-${dayIndex}-${slot}`
      const name = `Day ${dayIndex + 1} Offer ${slot + 1}`
      const discount = 10 + dayIndex + slot
      const base = 100 + dayIndex * 10 + slot
      const deal = discountedPrice(base, discount)
      insertHistory.run(dayKey, productId, slot, name, `Set ${dayIndex + 1}`, discount, base, deal, now, now)
      snapshot.set(`${dayKey}:${slot}`, { name, set: `Set ${dayIndex + 1}`, discount, base, deal })
    }
  })

  // Four claims across the three visible days; the same product on day 2 stays
  // missed because only day 1's copy was bought.
  insertClaim.run(dayKeys[0], 'past-0-0', now)
  insertClaim.run(dayKeys[0], 'past-0-2', now)
  insertClaim.run(dayKeys[1], 'past-1-0', now)
  insertClaim.run(dayKeys[2], 'past-2-0', now)
  insertClaim.run(dayKeys[3], 'past-3-0', now)

  // A real today row must not leak into the past strip.
  insertHistory.run(todayKey, 'today-offer', 0, 'Today Offer', 'Set today', 10, 200, 180, now, now)

  const history = historyForPlayer(3)
  assert(history.length === 3, `expected three past days, got ${history.length}`)
  assert(history.map((day) => day.dayKey).join('|') === dayKeys.slice(0, 3).join('|'), 'past days are not newest-first')
  assert(!history.some((day) => day.dayKey === todayKey), 'today leaked into the past strip')
  assert(!history.some((day) => day.dayKey === dayKeys[3]), 'the fourth past day was not cut off')

  const expectedBought = [
    [true, false, true],
    [true, false, false],
    [true, false, false],
  ]
  let claimedCount = 0
  history.forEach((day, dayIndex) => {
    assert(day.deals.length === 3, `${day.dayKey} has ${day.deals.length} deals, expected 3`)
    day.deals.forEach((past, slot) => {
      const expected = snapshot.get(`${day.dayKey}:${slot}`)
      assert(expected, `missing synthetic snapshot for ${day.dayKey}:${slot}`)
      assert(past.productName === expected.name, `${past.productId} name drifted`)
      assert(past.setName === expected.set, `${past.productId} set drifted`)
      assert(past.discountPct === expected.discount, `${past.productId} discount drifted`)
      assert(past.basePrice === expected.base, `${past.productId} base price drifted`)
      assert(past.dealPrice === expected.deal, `${past.productId} deal price drifted`)
      assert(past.bought === expectedBought[dayIndex][slot], `${past.dayKey}/${past.productId} bought=${past.bought}`)
      if (past.bought) claimedCount++
    })
  })
  assert(claimedCount === 4, `expected 4 claimed offers, got ${claimedCount}`)
  assert(history.reduce((n, day) => n + day.deals.length, 0) - claimedCount === 5, 'expected 5 missed offers')
  assert(historyForPlayer(1).length === 1, 'days=1 did not limit the history')
  assert(historyForPlayer(0).length === 0, 'days=0 did not empty the history')

  console.log(
    `daily-deal history passed: ${todayRows.length} today snapshots, ${history.length} past days, ` +
      `${claimedCount} claimed / ${history.reduce((n, day) => n + day.deals.length, 0) - claimedCount} missed`,
  )
} finally {
  db.close()
  rmSync(home, { recursive: true, force: true })
}
