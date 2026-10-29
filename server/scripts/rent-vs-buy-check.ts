// Rent-vs-buy regression check (v0.5.97) — run: npx tsx server/scripts/rent-vs-buy-check.ts
// Isolated TCGLIFE_HOME (tmp-rentbuy-home, wiped each run); nothing touches the real save.
import fs from 'node:fs'
import path from 'node:path'

const home = path.join(process.cwd().replace(/\\/g, '/'), 'tmp-rentbuy-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'server'), { recursive: true })
fs.copyFileSync('server/schema.sql', path.join(home, 'server', 'schema.sql'))
process.env.TCGLIFE_HOME = home

const { db } = await import('../lib/db')
const { gameDayMs } = await import('../lib/gameday')
await import('../services/vault')
await import('../services/salestax')
await import('../services/deliveries')
await import('../services/forum')
await import('../services/fleamarket')
await import('../services/liveshopping')
await import('../services/demographics')
const shop = await import('../services/shop')
const finance = await import('../services/finance')
const pnl = await import('../services/pnl')
const networth = await import('../services/networth')
const today = await import('../services/today')

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) { failures++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
  else console.log(`  ✓ ${label}`)
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.011
const iso = (ms: number) => new Date(ms).toISOString()
const stale = () => db.prepare(`UPDATE shop SET last_rent_day = 'stale' WHERE id = 1`).run()
const rewound = () => db.prepare(`UPDATE shop SET last_rent_review = ? WHERE id = 1`).run(iso(Date.now() - 6 * gameDayMs()))
const rentNow = () => (db.prepare(`SELECT rent_current AS r FROM shop WHERE id = 1`).get() as { r: number | null }).r
const cash = () => (db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash

// ---------------------------------------------------------------- fresh save
db.prepare(`INSERT OR IGNORE INTO game_state (id, cash, created_at) VALUES (1, 1000, ?)`).run(new Date().toISOString())
db.prepare(`UPDATE game_state SET cash = 100000 WHERE id = 1`).run()
const leased = shop.lease('Rent Test', 'storefront')
check('lease a storefront', leased.ok === true)
check('base rent is the tier number', near(shop.currentRent(shop.getShop()!), 22.5), `${shop.currentRent(shop.getShop()!)}`)
check('asking price = 400 × base rent', near(shop.buildingPrice('storefront'), 9000), `${shop.buildingPrice('storefront')}`)

// ------------------------------------------------------------ buy: too poor
db.prepare(`UPDATE game_state SET cash = 100 WHERE id = 1`).run()
const broke = shop.buyBuilding()
check('buy refused without the down payment', broke.ok === false && /2250/.test((broke as { error: string }).error), (broke as { error: string }).error)
check('a refused buy changes nothing', shop.getShop()!.bought_at == null && cash() === 100)

// --------------------------------------------------------- landlord reviews
const ins = db.prepare(`INSERT INTO shop_sales (case_id, inventory_id, card_id, quantity, price, cost_basis, buyer, sold_at, roundup) VALUES (?,?,?,?,?,?,?,?,?)`)
const gd = gameDayMs()
const seedSales = (prior: number, recent: number) => {
  db.prepare(`DELETE FROM shop_sales`).run() // each case gets its own clean window
  const t = Date.now()
  ins.run(null, 1, 'p1', 1, prior * 0.6, 0, 'NPC', iso(t - 8 * gd), 0)
  ins.run(null, 1, 'p2', 1, prior * 0.4, 0, 'NPC', iso(t - 7 * gd), 0)
  ins.run(null, 1, 'r1', 1, recent * 0.55, 0, 'NPC', iso(t - 3 * gd), 0)
  ins.run(null, 1, 'r2', 1, recent * 0.45, 0, 'NPC', iso(t - 1 * gd), 0)
}
db.prepare(`UPDATE game_state SET cash = 100000 WHERE id = 1`).run()

seedSales(1000, 1500) // +50% → raise
if (process.env.DEBUG) {
  const gd = gameDayMs()
  const lastMs = Date.now() - 6 * gd
  console.log('DEBUG rows', db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(price),0) s FROM shop_sales`).get())
  console.log('DEBUG recent', db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(price),0) s FROM shop_sales WHERE sold_at > ? AND sold_at <= ?`).get(new Date(lastMs).toISOString(), new Date(Date.now()).toISOString()))
  console.log('DEBUG prior ', db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(price),0) s FROM shop_sales WHERE sold_at > ? AND sold_at <= ?`).get(new Date(lastMs - gd * 5).toISOString(), new Date(lastMs).toISOString()))
  console.log('DEBUG review col', db.prepare(`SELECT last_rent_review, last_rent_day, rent_current FROM shop`).get())
}
stale(); rewound()
shop.settleRent()
if (process.env.DEBUG) console.log('DEBUG after settle', db.prepare(`SELECT last_rent_review, rent_current, last_rent_day FROM shop`).get())
check('growth raises rent 15%', near(rentNow() ?? 0, 25.875), `rent_current=${rentNow()}`)

seedSales(1000, 1500)
db.prepare(`UPDATE shop SET rent_current = 67.5 WHERE id = 1`).run() // exactly the cap (3× base)
stale(); rewound()
shop.settleRent()
check('the cap holds at 3× base', near(rentNow() ?? 0, 67.5), `rent_current=${rentNow()}`)

seedSales(2000, 1000) // −50% → ease by 8%
stale(); rewound()
shop.settleRent()
check('a revenue slump eases rent 8%', near(rentNow() ?? 0, 62.1), `rent_current=${rentNow()}`)

seedSales(1000, 1000) // flat → untouched
stale(); rewound()
shop.settleRent()
const flat = rentNow()!
check('flat revenue leaves rent alone', near(flat, 62.1), `rent_current=${rentNow()}`)

// review cadence: a second settle inside the window must not re-review
stale(); rewound()
const beforeReview = rentNow()
db.prepare(`UPDATE shop SET last_rent_review = ? WHERE id = 1`).run(iso(Date.now()))
seedSales(5000, 100)
stale()
shop.settleRent()
check('reviews respect the cadence', near(rentNow() ?? -1, beforeReview!), `rent_current=${rentNow()}`)

// ------------------------------------------------------------------ buy it
const nwBefore = networth.currentTotals()
const cashBeforeBuy = cash()
const rentLinesBefore = (db.prepare(`SELECT COUNT(*) c FROM shop_ledger WHERE line='rent'`).get() as { c: number }).c
const bought = shop.buyBuilding()
check('buy succeeds with cash', bought.ok === true, JSON.stringify(bought))
if (bought.ok) {
  check('price/down/principal/daily line up', near(bought.price, 9000) && near(bought.down, 2250) && near(bought.principal, 6750) && near(bought.daily, 23.63), JSON.stringify(bought))
}
check('cash only moved by the down payment', near(cash(), cashBeforeBuy - 2250), `cash ${cashBeforeBuy} → ${cash()}`)
check('deed stamped', shop.getShop()!.bought_at != null && near(shop.getShop()!.deed_price ?? 0, 9000))
check('creep is gone the moment you own', shop.currentRent(shop.getShop()!) === 0)
const nwAfter = networth.currentTotals()
check('buying nets to ~zero on net worth', near(nwAfter.netWorth, nwBefore.netWorth), `before=${nwBefore.netWorth} after=${nwAfter.netWorth} building=${nwAfter.building}`)
check('building counts as an asset', near(nwAfter.building, 9000), `${nwAfter.building}`)
check('the mortgage is NOT unsecured credit', near(finance.status().outstanding, 0) && finance.status().availableCredit > 0, JSON.stringify({ out: finance.status().outstanding, avail: finance.status().availableCredit }))

const st = shop.status()
check('status reports ownership + mortgage', st.open === true && st.shop.property.owned === true && st.shop.property.mortgage != null && !st.shop.property.mortgage.paidOff, JSON.stringify(st.open === true ? st.shop.property : null))
check('status rent is 0 when owned', st.open === true && st.shop.rent === 0)

// ------------------------------------------------- the daily mortgage draft
const m0 = shop.activeMortgage()!
const cashBefore = cash()
stale()
shop.settleRent() // cases are empty — the bank drafts anyway
const m1 = shop.activeMortgage()!
check('mortgage drafts daily with no rent charged', near(cash(), cashBefore - 23.63), `cash ${cashBefore} → ${cash()}`)
check('the balance amortizes', m1.balance < m0.balance, `${m0.balance} → ${m1.balance}`)
const rentLinesAfter = (db.prepare(`SELECT COUNT(*) c FROM shop_ledger WHERE line='rent'`).get() as { c: number }).c
check('no rent line booked once owned', rentLinesAfter === rentLinesBefore, `${rentLinesBefore} → ${rentLinesAfter}`)

const stmt = pnl.weekStatement()
check('P&L shows a mortgage line', stmt.overhead.mortgage.amount < 0, JSON.stringify(stmt.overhead.mortgage))
const oh = stmt.overhead
const expectedNet = Math.round((stmt.productRevenue + stmt.lines.consignment.revenue + stmt.shows.amount + oh.rent.amount + oh.mortgage.amount + oh.payroll.amount + oh.interest.amount + oh.other.amount) * 100) / 100
check('mortgage counts into total costs & net', stmt.totalCosts > 0 && near(stmt.net, expectedNet), `net=${stmt.net} expected=${expectedNet} costs=${stmt.totalCosts}`)
check('the mortgage line is auto-deductible (negative, not sales_tax)', oh.mortgage.amount < 0)

const rolls = today.todayRolls().rolls
const mortRoll = rolls.find((r) => r.kind === 'mortgage')
check('Today panel rolls the mortgage', !!mortRoll && (mortRoll.amount ?? 0) > 0, JSON.stringify(mortRoll))
check('Today panel no longer rolls rent for an owner', !rolls.some((r) => r.kind === 'rent'))

// ------------------------------------------------------------- payoff
db.prepare(`UPDATE loans SET balance = 20 WHERE kind = 'mortgage' AND status = 'active'`).run()
stale()
shop.settleRent()
check('last payment clears the mortgage', shop.activeMortgage() == null)
const st2 = shop.status()
check('paid-off state shows on status', st2.open === true && st2.shop.property.mortgage?.paidOff === true && st2.shop.rent === 0, JSON.stringify(st2.open === true ? st2.shop.property.mortgage : null))
const cashAtPayoff = cash()
stale()
shop.settleRent()
check('no more drafts once paid off', cash() === cashAtPayoff, `cash ${cashAtPayoff} → ${cash()}`)
const rolls2 = today.todayRolls().rolls
check('Today panel rolls neither rent nor mortgage when owned outright', !rolls2.some((r) => r.kind === 'rent' || r.kind === 'mortgage'))

console.log(failures === 0 ? '\nrent-vs-buy: all checks passed' : `\nrent-vs-buy: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
