// Manager-quality ladder audit: does paying for stars actually net more?
//
// Same store, same stocking policy, same card band — the ONLY things that vary
// are manager quality and the wage that quality commands on the open market
// (MARKET_WAGE: 1★ $9/day … 5★ $21/day). Rent is identical across arms, so the
// comparison that matters is gross − wage − skim, per day.
//
// The whole point is a confidence interval: a single run per star is noise, and
// this repo has already been burned by tuning against one lucky sample.
//
// CAVEAT on the printed wage/skim columns: the per-tick hour pinning below makes
// settleRent guard fire ~2.8x per simulated day, so rent and payroll totals are
// multiplied by that factor (uniformly: wage per settle is exactly the hired
// wage). Re-score with tmp/recompute-ladder.cjs, which divides by the settle
// count; tmp/sim-ladder-clean.ts runs the same ladder on a one-hour-per-day clock.
import fs from 'node:fs'
import { requireSimHome, simDayPlan } from '../server/scripts/sim-home'

const home = requireSimHome()
const RUNS = Math.max(2, Number(process.env.LADDER_RUNS ?? 10))
const DAYS = Math.max(5, Number(process.env.LADDER_DAYS ?? 18))
const TICKS = Math.max(1, Number(process.env.LADDER_TICKS ?? 40))

const { db } = await import('../server/lib/db')
const franchise = await import('../server/services/franchise')
const { valueOf } = await import('../server/services/market')
const { MARKET_WAGE } = await import('../server/services/loyalty')

const round2 = (n: number) => Math.round(n * 100) / 100

const BANDS: Record<string, [number, number]> = { bulk: [0.5, 8], mid: [8, 60], premium: [60, 300] }
const [bandMin, bandMax] = BANDS[process.env.SIM_BAND ?? 'mid'] ?? BANDS.mid

function pickCardInBand(): { id: string; market: number } | null {
  for (let tries = 0; tries < 30; tries++) {
    const row = db.prepare(`SELECT id FROM cards WHERE rarity IN ('Common','Uncommon','Rare') AND id NOT LIKE '%-psa%' ORDER BY RANDOM() LIMIT 1`).get() as { id: string }
    const market = valueOf(row.id)
    if (market >= bandMin && market <= bandMax) return { id: row.id, market }
  }
  return null
}

function stockShelf(store: number, target: number) {
  const used = (db.prepare(`SELECT COUNT(*) n FROM franchise_shelf_cards WHERE store = ?`).get(store) as { n: number }).n
  for (let i = used; i < target; i++) {
    const pick = pickCardInBand()
    if (!pick) continue
    const info = db
      .prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, listing_price, cost_basis, acquired_at, acquired_via) VALUES (?, 'normal', 'NM', 1, 'on_shelf', ?, ?, ?, 'sim')`)
      .run(pick.id, round2(pick.market * 1.15), round2(pick.market * 0.7), new Date().toISOString())
    db.prepare(`INSERT INTO franchise_shelf_cards (store, inventory_id, arrived_at) VALUES (?, ?, NULL)`).run(store, Number(info.lastInsertRowid))
  }
}

function seedRun(quality: number) {
  db.exec(`DELETE FROM franchise_shelf_cards; DELETE FROM franchise_sales; DELETE FROM franchise;
           DELETE FROM shop_case_cards; DELETE FROM rival_cases; DELETE FROM rival_shop;
           DELETE FROM shop; DELETE FROM inventory; DELETE FROM shop_ledger; DELETE FROM activity_log;
           DELETE FROM meta WHERE key LIKE 'rival:%' OR key LIKE 'shopDaily:%' OR key LIKE 'chain:%';`)
  db.prepare(`UPDATE game_state SET cash = 5000, last_tick_at = NULL`).run()
  db.prepare(`INSERT INTO shop (id, name, tier, opened_at, reputation) VALUES (1, 'Flagship', 'flagship', ?, 30)`).run(new Date().toISOString())
  const wage = MARKET_WAGE[quality]
  const r = franchise.open('Ladder ' + quality, 'storefront', quality, wage, 'Mgr ' + quality, 1)
  if (!('ok' in r) || !r.ok) throw new Error('franchise.open failed: ' + JSON.stringify(r))
  stockShelf(1, 10)
}

type Row = { quality: number; revenue: number; wages: number; rent: number; skim: number; sales: number }

const rows: Row[] = []
const setSimHour = (globalThis as { setSimHour?: (h: number) => void }).setSimHour
const advanceDay = (globalThis as { advanceSimDay?: () => void }).advanceSimDay

for (const quality of [1, 2, 3, 4, 5]) {
  for (let run = 1; run <= RUNS; run++) {
    seedRun(quality)
    for (let day = 1; day <= DAYS; day++) {
      const plan = simDayPlan(TICKS).sort((a, b) => a - b)
      for (let t = 0; t < TICKS; t++) {
        setSimHour?.(plan[t])
        franchise.chainTick()
      }
      advanceDay?.()
      stockShelf(1, 10)
    }
    const store = db.prepare(`SELECT lifetime_revenue FROM franchise WHERE id = 1`).get() as { lifetime_revenue: number } | undefined
    if (!store) throw new Error(`store closed early at ${quality}★ run ${run}`)
    const ledger = db.prepare(`SELECT line, COALESCE(SUM(amount), 0) a FROM shop_ledger WHERE location = 'satellite:1' GROUP BY line`).all() as { line: string; a: number }[]
    const line = (name: string) => {
      const hit = ledger.find((l) => l.line === name)
      return hit ? round2(-hit.a) : 0
    }
    const row: Row = {
      quality,
      revenue: round2(store.lifetime_revenue),
      wages: line('payroll'),
      rent: line('rent'),
      skim: round2((db.prepare(`SELECT COALESCE(SUM(skimmed), 0) s FROM franchise_sales WHERE store = 1`).get() as { s: number }).s),
      sales: (db.prepare(`SELECT COUNT(*) n FROM franchise_sales WHERE store = 1`).get() as { n: number }).n,
    }
    rows.push(row)
    console.log(`${quality}★ run ${String(run).padStart(2)}/${RUNS}  sales ${String(row.sales).padStart(3)}  gross $${(row.revenue / DAYS).toFixed(1).padStart(6)}/d  wage $${(row.wages / DAYS).toFixed(1)}/d  skim $${row.skim.toFixed(1)}`)
  }
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const sd = (a: number[]) => {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1))
}
const net = (r: Row) => (r.revenue - r.wages - r.skim) / DAYS // rent identical everywhere

console.log(`\n=========== manager ladder: ${RUNS} runs/star × ${DAYS} days × ${TICKS} ticks ===========`)
console.log('star   gross/d    wage/d   skim/d    net/d (wage+skim only; rent $36/d is common)')
const stats: { quality: number; net: number; se: number; gross: number; wage: number }[] = []
for (const q of [1, 2, 3, 4, 5]) {
  const rs = rows.filter((r) => r.quality === q)
  const nets = rs.map(net)
  const m = mean(nets)
  const se = rs.length > 1 ? sd(nets) / Math.sqrt(rs.length) : 0
  stats.push({ quality: q, net: m, se, gross: mean(rs.map((r) => r.revenue / DAYS)), wage: mean(rs.map((r) => r.wages / DAYS)) })
  console.log(
    ` ${q}★   $${mean(rs.map((r) => r.revenue / DAYS)).toFixed(2).padStart(7)}   $${mean(rs.map((r) => r.wages / DAYS)).toFixed(2).padStart(6)}   $${mean(rs.map((r) => r.skim / DAYS)).toFixed(2).padStart(5)}   $${m.toFixed(2).padStart(7)} ± ${(1.96 * se).toFixed(2)}`,
  )
}

const one = stats[0]
const five = stats[4]
const diff = five.net - one.net
const seDiff = Math.sqrt(one.se ** 2 + five.se ** 2)
const low = diff - 1.96 * seDiff
const high = diff + 1.96 * seDiff
console.log(`\n5★ − 1★ net/day: ${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}  [95% CI ${low.toFixed(2)} … ${high.toFixed(2)}]`)
console.log(`gross +$${(five.gross - one.gross).toFixed(2)}/d vs wage +$${(five.wage - one.wage).toFixed(2)}/d`)
console.log(
  low > 0
    ? 'VERDICT: stars pay — the 5★ manager out-nets the 1★ across the whole interval.'
    : high < 0
      ? 'VERDICT: stars COST — the 5★ manager nets less than the 1★ across the whole interval.'
      : 'VERDICT: indistinguishable from the 1★ — quality does not reliably pay for itself.',
)
console.log(`ladder monotonic (net rises with every star): ${stats.every((s, i) => i === 0 || s.net > stats[i - 1].net)}`)
console.log(`top vs bottom of ladder: best ${stats.reduce((a, b) => (b.net > a.net ? b : a)).quality}★ at $${Math.max(...stats.map((s) => s.net)).toFixed(2)}/d`)

fs.writeFileSync('tmp/ladder-rows.json', JSON.stringify(rows, null, 2))
db.close()
fs.rmSync(home, { recursive: true, force: true })
