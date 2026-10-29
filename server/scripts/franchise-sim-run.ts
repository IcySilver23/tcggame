// Franchise-chain economy audit internals — run via `npm run sim:franchise`.
// Replays whole in-game days through the REAL chainTick() and reports per-store
// sales, skim leakage, rent/wage burden, and whether stores earn their keep.
import fs from 'node:fs'
import { requireSimHome, simArgs, simDayPlan } from './sim-home'

const home = requireSimHome()
const { runs: RUNS, days: DAYS } = simArgs()

// --- imports (db binds to the temp home; Date already shimmed by bootstrap) -
import { db } from '../lib/db'
import * as franchise from '../services/franchise'
import { valueOf } from '../services/market'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Stocking band under audit: SIM_BAND = bulk | mid | premium (default mid). */
const BAND = process.env.SIM_BAND ?? 'mid'
const BANDS: Record<string, [number, number]> = { bulk: [0.5, 8], mid: [8, 60], premium: [60, 300] }
const [bandMin, bandMax] = BANDS[BAND] ?? BANDS.mid

function pickCardInBand(): { id: string; market: number } | null {
  for (let tries = 0; tries < 30; tries++) {
    const pickRow = db.prepare(`SELECT id FROM cards WHERE rarity IN ('Common','Uncommon','Rare') AND id NOT LIKE '%-psa%' ORDER BY RANDOM() LIMIT 1`).get() as { id: string }
    const market = valueOf(pickRow.id)
    if (market >= bandMin && market <= bandMax) return { id: pickRow.id, market }
  }
  return null
}

/** Seed a run: fresh save with a stock catalog card in inventory, then open the store. */
function seedRun(run: number) {
  db.exec(`DELETE FROM franchise_shelf_cards; DELETE FROM franchise_sales; DELETE FROM franchise;
           DELETE FROM shop_case_cards; DELETE FROM rival_cases; DELETE FROM rival_shop;
           DELETE FROM shop; DELETE FROM inventory; DELETE FROM shop_ledger; DELETE FROM activity_log;
           DELETE FROM meta WHERE key LIKE 'rival:%' OR key LIKE 'shopDaily:%' OR key LIKE 'chain:%';`)
  db.prepare(`UPDATE game_state SET cash = 5000, last_tick_at = NULL`).run()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO shop (id, name, tier, opened_at, reputation) VALUES (1, 'Flagship', 'flagship', ?, 30)`).run(now)

  // Manager quality 1–5 across runs: the whole honesty spectrum gets audited.
  const quality = 1 + ((run - 1) % 5)
  const r = franchise.open('Satellite ' + run, 'storefront', quality, 15 + quality * 4, 'Mgr ' + quality, 1)
  if (!('ok' in r) || !r.ok) throw new Error('franchise.open failed: ' + JSON.stringify(r))

  // Stock the satellite shelf: 10 fresh inventory rows priced at market × 1.15.
  for (let i = 0; i < 10; i++) {
    const pick = pickCardInBand()
    if (!pick) { i--; continue }
    const market = pick.market
    const info = db.prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, listing_price, cost_basis, acquired_at, acquired_via) VALUES (?, 'normal', 'NM', 1, 'on_shelf', ?, ?, ?, 'sim')`)
      .run(pick.id, round2(market * 1.15), round2(market * 0.7), now)
    db.prepare(`INSERT INTO franchise_shelf_cards (store, inventory_id, arrived_at) VALUES (1, ?, NULL)`).run(Number(info.lastInsertRowid))
  }
  return quality
}

type RunResult = { quality: number; sales: number; revenue: number; skimmed: number; rentPaid: number; wagesPaid: number; restocks: number; closed: boolean }
const results: RunResult[] = []

for (let run = 1; run <= RUNS; run++) {
  const quality = seedRun(run)
  const res: RunResult = { quality, sales: 0, revenue: 0, skimmed: 0, rentPaid: 0, wagesPaid: 0, restocks: 0, closed: false }
  const startCash = (db.prepare(`SELECT cash FROM game_state`).get() as { cash: number }).cash

  // Live cadence: chainTick fires on EVERY market tick (~every 20s while the
  // app is open), and sales roll per tick — one chainTick per sim day would
  // understate a played session ~40×. SIM_TICKS_PER_DAY models one evening
  // session at the pinned peak hour (default 40 ticks).
  const TICKS = Math.max(1, Number(process.env.SIM_TICKS_PER_DAY ?? 40))
  // Full-day clock: each simulated day spans the real hour curve (with a
  // genuine late-night slice), so the skim — a night mechanic — gets honest
  // sampling weight instead of silently never firing.
  const setSimHour = (globalThis as { setSimHour?: (h: number) => void }).setSimHour
  for (let day = 1; day <= DAYS; day++) {
    const plan = simDayPlan(TICKS).sort((a, b) => a - b)
    for (let t = 0; t < TICKS; t++) {
      setSimHour?.(plan[t])
      franchise.chainTick()
    }
    ;(globalThis as { advanceSimDay?: () => void }).advanceSimDay?.()
    // Keep the shelf stocked at ~10 rows so the store keeps trading (the sim
    // plays a diligent owner; unstocked stores just sit dark and waive rent).
    const used = (db.prepare(`SELECT COUNT(*) n FROM franchise_shelf_cards WHERE store = 1`).get() as { n: number }).n
    if (used < 8) {
      res.restocks++
      for (let i = used; i < 10; i++) {
        const pick = pickCardInBand()
        if (!pick) continue
        const market = pick.market
        const info = db.prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, listing_price, cost_basis, acquired_at, acquired_via) VALUES (?, 'normal', 'NM', 1, 'on_shelf', ?, ?, ?, 'sim')`)
          .run(pick.id, round2(market * 1.15), round2(market * 0.7), new Date().toISOString())
        db.prepare(`INSERT INTO franchise_shelf_cards (store, inventory_id, arrived_at) VALUES (1, ?, NULL)`).run(Number(info.lastInsertRowid))
      }
    }
  }

  const store = db.prepare(`SELECT * FROM franchise WHERE id = 1`).get() as { lifetime_revenue: number; lifetime_cost: number } | undefined
  if (!store) { res.closed = true; results.push(res); continue }
  res.sales = (db.prepare(`SELECT COUNT(*) n FROM franchise_sales WHERE store = 1`).get() as { n: number }).n
  res.revenue = round2(store.lifetime_revenue)
  res.skimmed = round2((db.prepare(`SELECT COALESCE(SUM(skimmed), 0) s FROM franchise_sales WHERE store = 1`).get() as { s: number }).s)
  const ledger = db.prepare(`SELECT line, COALESCE(SUM(amount), 0) a FROM shop_ledger WHERE location = 'satellite:1' GROUP BY line`).all() as { line: string; a: number }[]
  const rentRow = ledger.find((l) => l.line === 'rent')
  const wageRow = ledger.find((l) => l.line === 'payroll')
  res.rentPaid = round2(rentRow ? -rentRow.a : 0)
  res.wagesPaid = round2(wageRow ? -wageRow.a : 0)
  results.push(res)
  const endCash = (db.prepare(`SELECT cash FROM game_state`).get() as { cash: number }).cash
  console.log(`run ${String(run).padStart(2)}  mgr ${quality}★  sales ${String(res.sales).padStart(3)}  gross $${res.revenue.toFixed(0).padStart(6)}  skim $${res.skimmed.toFixed(0).padStart(5)} (${res.revenue > 0 ? Math.round((res.skimmed / res.revenue) * 100) : 0}%)  rent+wage $${(res.rentPaid + res.wagesPaid).toFixed(0).padStart(5)}  cash Δ $${(endCash - startCash).toFixed(0)}`)
}

const byQ = (q: number) => results.filter((r) => r.quality === q)
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
console.log(`
================ franchise audit: ${RUNS} runs × ${DAYS} days ================
per manager quality   sales/day   gross/day   skim%   (rent $36 + wage/d)
${[1, 2, 3, 4, 5].map((q) => {
  const rs = byQ(q)
  if (!rs.length) return `  ${q}★ (no runs)`
  const s = avg(rs.map((r) => r.sales / DAYS)), g = avg(rs.map((r) => r.revenue / DAYS))
  const sk = avg(rs.map((r) => (r.revenue > 0 ? (r.skimmed / r.revenue) * 100 : 0)))
  return `  ${q}★                ${s.toFixed(2)}       $${g.toFixed(2).padStart(7)}   ${sk.toFixed(1)}%`
}).join('\n')}
closed early          : ${results.filter((r) => r.closed).length}/${RUNS}
net per store (avg)   : ${avg(results.map((r) => (r.revenue - r.rentPaid - r.wagesPaid - r.skimmed) / DAYS)).toFixed(2)}/day  (breakeven ≈ 0; well-run target ≈ +25–45/day)
=============================================`)

db.close()
fs.rmSync(home, { recursive: true, force: true })
console.log(`(temp home cleaned: ${home})`)
