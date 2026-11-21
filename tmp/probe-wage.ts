// Diagnostic: what is the satellite 'payroll' line actually charging?
import { prepareSimHome, installSimClock, simDayPlan } from '../server/scripts/sim-home'

prepareSimHome()
installSimClock()
const Q = Number(process.argv[2] ?? 1)
process.env.SIM_HOUR = 'fullday'

const { db } = await import('../server/lib/db')
const franchise = await import('../server/services/franchise')
const { valueOf } = await import('../server/services/market')

db.exec(`DELETE FROM franchise_shelf_cards; DELETE FROM franchise_sales; DELETE FROM franchise;
         DELETE FROM shop; DELETE FROM inventory; DELETE FROM shop_ledger; DELETE FROM activity_log;
         DELETE FROM meta WHERE key LIKE 'loyalty:%' OR key LIKE 'shopDaily:%' OR key LIKE 'chain:%';`)
db.prepare(`UPDATE game_state SET cash = 5000, last_tick_at = NULL`).run()
db.prepare(`INSERT INTO shop (id, name, tier, opened_at, reputation) VALUES (1, 'Flagship', 'flagship', ?, 30)`).run(new Date().toISOString())

const wageIn = Number(process.argv[3] ?? 9)
const r = franchise.open('Probe', 'storefront', Q, wageIn, 'Mgr', 1)
console.log('open:', JSON.stringify(r))

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
console.log(`hired at $${wageIn}/d, stored wage`, (db.prepare(`SELECT manager_wage, wage_start FROM franchise WHERE id = 1`).get() as { manager_wage: number; wage_start: number }).manager_wage)

const setSimHour = (globalThis as { setSimHour?: (h: number) => void }).setSimHour
const advanceDay = (globalThis as { advanceSimDay?: () => void }).advanceSimDay
for (let day = 1; day <= 4; day++) {
  const plan = simDayPlan(40).sort((a, b) => a - b)
  for (let t = 0; t < 40; t++) {
    setSimHour?.(plan[t])
    franchise.chainTick()
  }
  const f = db.prepare(`SELECT manager_wage, loyalty, raise_demand, last_rent_day FROM franchise WHERE id = 1`).get() as { manager_wage: number; loyalty: number; raise_demand: string | null; last_rent_day: string }
  const rows = db.prepare(`SELECT line, amount, note, created_at FROM shop_ledger WHERE location = 'satellite:1' ORDER BY id DESC LIMIT 4`).all() as { line: string; amount: number; note: string; created_at: string }[]
  console.log(`day ${day}: wage ${f.manager_wage} loyalty ${f.loyalty} demand ${f.raise_demand ?? '-'} lastRent ${f.last_rent_day}`)
  for (const x of rows) console.log(`    ${x.line.padEnd(8)} ${String(x.amount).padStart(9)}  ${x.note}`)
  advanceDay?.()
  stock(10)
}
