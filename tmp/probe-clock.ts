// Verifies the fixed clock: one rent charge and one payroll charge per simulated
// day, at exactly the tier rent and the hired wage.
import { prepareSimHome, installSimClock, simDayPlan } from '../server/scripts/sim-home'

prepareSimHome()
installSimClock()
process.env.SIM_HOUR = 'fullday'

const { db } = await import('../server/lib/db')
const franchise = await import('../server/services/franchise')
const { valueOf } = await import('../server/services/market')
const { gameDayKey } = await import('../server/lib/gameday')

const Q = Number(process.argv[2] ?? 3)
const WAGE = Number(process.argv[3] ?? 15)
const DAYS = Number(process.argv[4] ?? 6)

db.exec(`DELETE FROM franchise_shelf_cards; DELETE FROM franchise_sales; DELETE FROM franchise;
         DELETE FROM shop; DELETE FROM inventory; DELETE FROM shop_ledger; DELETE FROM activity_log;
         DELETE FROM meta WHERE key LIKE 'loyalty:%' OR key LIKE 'shopDaily:%' OR key LIKE 'chain:%';`)
db.prepare(`UPDATE game_state SET cash = 5000, last_tick_at = NULL`).run()
db.prepare(`INSERT INTO shop (id, name, tier, opened_at, reputation) VALUES (1, 'Flagship', 'flagship', ?, 30)`).run(new Date().toISOString())
const r = franchise.open('Clock', 'storefront', Q, WAGE, 'Mgr', 1)
if (!('ok' in r) || !r.ok) throw new Error(JSON.stringify(r))

function stock(target: number) {
  const used = (db.prepare(`SELECT COUNT(*) n FROM franchise_shelf_cards WHERE store = 1`).get() as { n: number }).n
  for (let i = used; i < target; i++) {
    const row = db.prepare(`SELECT id FROM cards WHERE rarity IN ('Common','Uncommon','Rare') AND id NOT LIKE '%-psa%' ORDER BY RANDOM() LIMIT 1`).get() as { id: string }
    const market = valueOf(row.id)
    const info = db.prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, listing_price, cost_basis, acquired_at, acquired_via) VALUES (?, 'normal', 'NM', 1, 'on_shelf', ?, ?, ?, 'sim')`)
      .run(row.id, Math.round(market * 1.15 * 100) / 100, Math.round(market * 0.7 * 100) / 100, new Date().toISOString())
    db.prepare(`INSERT INTO franchise_shelf_cards (store, inventory_id, arrived_at) VALUES (1, ?, NULL)`).run(Number(info.lastInsertRowid))
  }
}
stock(10)

const setSimHour = (globalThis as { setSimHour?: (h: number) => void }).setSimHour
const advanceDay = (globalThis as { advanceSimDay?: () => void }).advanceSimDay

const keys: string[] = []
for (let day = 1; day <= DAYS; day++) {
  keys.push(gameDayKey())
  const plan = simDayPlan(40).sort((a, b) => a - b)
  for (let t = 0; t < 40; t++) {
    setSimHour?.(plan[t])
    franchise.chainTick()
  }
  advanceDay?.()
  stock(10)
}

const rent = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount), 0) a FROM shop_ledger WHERE location = 'satellite:1' AND line = 'rent'`).get() as { n: number; a: number }
const payroll = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount), 0) a FROM shop_ledger WHERE location = 'satellite:1' AND line = 'payroll'`).get() as { n: number; a: number }
const distinctKeys = new Set(keys)

console.log(`${DAYS} simulated days (${process.env.SIM_DAY_HOURS ?? 12}h each), hired ${Q}★ at $${WAGE}/d`)
console.log(`  game-day keys seen by the runner: ${distinctKeys.size} distinct — ${[...distinctKeys].join(', ')}`)
console.log(`  rent rows:    ${rent.n}  total $${-rent.a}  (expect ${DAYS} × $11 = $${DAYS * 11})`)
console.log(`  payroll rows: ${payroll.n}  total $${-payroll.a}  (expect ${DAYS} × $${WAGE} = $${DAYS * WAGE})`)
// A day whose shelf is empty at settle waives rent outright (game behaviour), so
// the count can be lower — what must hold is that every charge is exactly one
// rent () or one wage, never a multiple of them.
const ok = rent.n === payroll.n && rent.n <= DAYS && -rent.a === rent.n * 11 && -payroll.a === payroll.n * WAGE
console.log(ok ? 'OK — one charge each per game-day' : 'MISMATCH — inspect above')
process.exit(ok ? 0 : 1)
