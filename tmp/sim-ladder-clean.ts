// Clean-clock confirmation: same ladder, but one pinned hour per DAY rather than
// a new hour every tick. With the clock advancing a whole day at a time and the
// local hour held still inside it, settleRent's dayKey() guard fires exactly once
// per day, so rent ($11) and wage can be read straight off the ledger with no
// correction at all. If this agrees with the corrected fullday run, the ladder
// conclusion is not an artifact of either clock.
import { prepareSimHome, installSimClock, simDayPlan } from '../server/scripts/sim-home'

prepareSimHome()
installSimClock()

const RUNS = Math.max(2, Number(process.argv[2] ?? 10))
const DAYS = Math.max(5, Number(process.argv[3] ?? 15))
const TICKS = 40

const { db } = await import('../server/lib/db')
const franchise = await import('../server/services/franchise')
const { valueOf } = await import('../server/services/market')
const { MARKET_WAGE } = await import('../server/services/loyalty')

const round2 = (n: number) => Math.round(n * 100) / 100
const RENT = 11

function pickCard(): { id: string; market: number } | null {
  for (let tries = 0; tries < 30; tries++) {
    const row = db.prepare(`SELECT id FROM cards WHERE rarity IN ('Common','Uncommon','Rare') AND id NOT LIKE '%-psa%' ORDER BY RANDOM() LIMIT 1`).get() as { id: string }
    const market = valueOf(row.id)
    if (market >= 8 && market <= 60) return { id: row.id, market }
  }
  return null
}

function stockShelf(target: number) {
  const used = (db.prepare(`SELECT COUNT(*) n FROM franchise_shelf_cards WHERE store = 1`).get() as { n: number }).n
  for (let i = used; i < target; i++) {
    const pick = pickCard()
    if (!pick) continue
    const info = db
      .prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, listing_price, cost_basis, acquired_at, acquired_via) VALUES (?, 'normal', 'NM', 1, 'on_shelf', ?, ?, ?, 'sim')`)
      .run(pick.id, round2(pick.market * 1.15), round2(pick.market * 0.7), new Date().toISOString())
    db.prepare(`INSERT INTO franchise_shelf_cards (store, inventory_id, arrived_at) VALUES (1, ?, NULL)`).run(Number(info.lastInsertRowid))
  }
}

function seedRun(quality: number) {
  db.exec(`DELETE FROM franchise_shelf_cards; DELETE FROM franchise_sales; DELETE FROM franchise;
           DELETE FROM shop_case_cards; DELETE FROM rival_cases; DELETE FROM rival_shop;
           DELETE FROM shop; DELETE FROM inventory; DELETE FROM shop_ledger; DELETE FROM activity_log;
           DELETE FROM meta WHERE key LIKE 'rival:%' OR key LIKE 'shopDaily:%' OR key LIKE 'chain:%' OR key LIKE 'loyalty:%';`)
  db.prepare(`UPDATE game_state SET cash = 5000, last_tick_at = NULL`).run()
  db.prepare(`INSERT INTO shop (id, name, tier, opened_at, reputation) VALUES (1, 'Flagship', 'flagship', ?, 30)`).run(new Date().toISOString())
  const r = franchise.open('Clean ' + quality, 'storefront', quality, MARKET_WAGE[quality], 'Mgr ' + quality, 1)
  if (!('ok' in r) || !r.ok) throw new Error('open failed: ' + JSON.stringify(r))
  stockShelf(10)
}

type Row = { quality: number; revenue: number; wages: number; rent: number; skim: number }
const rows: Row[] = []
const setSimHour = (globalThis as { setSimHour?: (h: number) => void }).setSimHour
const advanceDay = (globalThis as { advanceSimDay?: () => void }).advanceSimDay

for (const quality of [1, 5]) {
  for (let run = 1; run <= RUNS; run++) {
    seedRun(quality)
    for (let day = 1; day <= DAYS; day++) {
      setSimHour?.(simDayPlan(1)[0]) // one hour for the whole day — key flips once
      for (let t = 0; t < TICKS; t++) franchise.chainTick()
      advanceDay?.()
      stockShelf(10)
    }
    const store = db.prepare(`SELECT lifetime_revenue FROM franchise WHERE id = 1`).get() as { lifetime_revenue: number }
    const ledger = db.prepare(`SELECT line, COALESCE(SUM(amount), 0) a FROM shop_ledger WHERE location = 'satellite:1' GROUP BY line`).all() as { line: string; a: number }[]
    const line = (n: string) => {
      const hit = ledger.find((l) => l.line === n)
      return hit ? round2(-hit.a) : 0
    }
    rows.push({
      quality,
      revenue: round2(store.lifetime_revenue),
      wages: line('payroll'),
      rent: line('rent'),
      skim: round2((db.prepare(`SELECT COALESCE(SUM(skimmed), 0) s FROM franchise_sales WHERE store = 1`).get() as { s: number }).s),
    })
  }
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const sd = (a: number[]) => {
  const m = mean(a)
  return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : 0
}
const se = (a: number[]) => (a.length > 1 ? sd(a) / Math.sqrt(a.length) : 0)
const net = (r: Row) => (r.revenue - r.wages - r.rent - r.skim) / DAYS

console.log(`\n===== clean clock: ${RUNS}/star × ${DAYS} days =====`)
const stats: { q: number; net: number; se: number; wage: number; gross: number; settles: number }[] = []
for (const q of [1, 5]) {
  const rs = rows.filter((r) => r.quality === q)
  const nets = rs.map(net)
  stats.push({ q, net: mean(nets), se: se(nets), wage: mean(rs.map((r) => r.wages / DAYS)), gross: mean(rs.map((r) => r.revenue / DAYS)), settles: mean(rs.map((r) => r.rent / RENT)) })
  console.log(`${q}★ gross $${mean(rs.map((r) => r.revenue / DAYS)).toFixed(2)}/d  wage $${mean(rs.map((r) => r.wages / DAYS)).toFixed(2)}/d  rent $${mean(rs.map((r) => r.rent / DAYS)).toFixed(2)}/d (${(mean(rs.map((r) => r.rent / RENT))).toFixed(2)} settles/d)  net $${mean(nets).toFixed(2)}/d ± ${(1.96 * se(nets)).toFixed(2)}`)
}
const diff = stats[1].net - stats[0].net
const ci = 1.96 * Math.sqrt(stats[0].se ** 2 + stats[1].se ** 2)
console.log(`\n5★ − 1★: ${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}/d [95% CI ${(diff - ci).toFixed(2)} … ${(diff + ci).toFixed(2)}]`)
console.log(diff - ci > 0 ? 'CONFIRMED: stars pay.' : diff + ci < 0 ? 'CONFIRMED: stars cost.' : 'CONFIRMED: no reliable difference.')
