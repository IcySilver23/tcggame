// Do the office stars pay for themselves?
//
// The question the manager ladder couldn't answer: a district (or regional)
// manager is a weekly salary line, and the star rating changes exactly two
// things — how much shrink they suppress, and how much they demand at raise
// time. Both offices also gate a door (any DM unlocks store #2, any regional
// unlocks store #3), but that is binary: a 1★ unlocks it as surely as a 5★.
//
// So the measurement is: hold the chain fixed, sweep the office star at its
// REAL market wage (DM_BASE 7.5/12.5/21, REGIONAL_BASE 12/21/32 — the hire
// paths only offer 1★, 3★ and 5★; 2★/4★ come from internal promotion), and
// compare net/day including the office payroll.
//
// Night-heavy ticks on purpose: the till is only unwatched after close, so
// this is the cadence where a DM's value actually exists. A full-day run is
// reported too, because that is how most players actually play.
import { requireSimHome, simArgs, simDayPlan } from '../server/scripts/sim-home'

requireSimHome()
import { db } from '../server/lib/db'
import * as franchise from '../server/services/franchise'
import { resolveDemand, resolveDmDemand, resolveRegionalDemand, hasOpenDemand } from '../server/services/loyalty'
import { valueOf } from '../server/services/market'

const { runs: RUNS, days: DAYS } = simArgs()
const TICKS = Math.max(1, Number(process.env.SIM_TICKS_PER_DAY ?? 30))
const round2 = (n: number) => Math.round(n * 100) / 100
const STARS = [1, 3, 5]

function pickCard(): { id: string; market: number } | null {
  for (let t = 0; t < 30; t++) {
    const row = db.prepare(`SELECT id FROM cards WHERE rarity IN ('Common','Uncommon','Rare') AND id NOT LIKE '%-psa%' ORDER BY RANDOM() LIMIT 1`).get() as { id: string }
    const market = valueOf(row.id)
    if (market >= 8 && market <= 60) return { id: row.id, market }
  }
  return null
}

function stockShelf(store: number, rows = 10) {
  for (let i = 0; i < rows; i++) {
    const p = pickCard()
    if (!p) continue
    const info = db.prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, listing_price, cost_basis, acquired_at, acquired_via) VALUES (?, 'normal', 'NM', 1, 'on_shelf', ?, ?, ?, 'sim')`)
      .run(p.id, round2(p.market * 1.15), round2(p.market * 0.7), new Date().toISOString())
    db.prepare(`INSERT OR IGNORE INTO franchise_shelf_cards (store, inventory_id, arrived_at) VALUES (?, ?, NULL)`).run(store, Number(info.lastInsertRowid))
  }
}

function topUpShelves() {
  for (const store of [1, 2, 3]) {
    if (!db.prepare(`SELECT 1 FROM franchise WHERE id = ?`).get(store)) continue
    const used = (db.prepare(`SELECT COUNT(*) n FROM franchise_shelf_cards WHERE store = ?`).get(store) as { n: number }).n
    if (used < 8) stockShelf(store, 10 - used)
  }
}

function grantAmount(r: { ok: boolean; granted?: number }): number {
  return r.ok && typeof r.granted === 'number' ? r.granted : 0
}

function playOwner(): number {
  let paid = 0
  for (const f of franchise.allStores()) if (hasOpenDemand(f)) paid += grantAmount(resolveDemand(f.id, 'grant'))
  if (franchise.districtRow()?.raise_demand) paid += grantAmount(resolveDmDemand('grant'))
  if (franchise.regionalRow()?.raise_demand) paid += grantAmount(resolveRegionalDemand('grant'))
  return paid
}

function reset() {
  db.exec(`DELETE FROM franchise_shelf_cards; DELETE FROM franchise_sales; DELETE FROM franchise;
           DELETE FROM regional_managers; DELETE FROM shop_case_cards; DELETE FROM rival_cases; DELETE FROM rival_shop;
           DELETE FROM shop; DELETE FROM inventory; DELETE FROM shop_ledger; DELETE FROM activity_log; DELETE FROM sale_history;
           DELETE FROM meta WHERE key LIKE 'rival:%' OR key LIKE 'shopDaily:%' OR key LIKE 'chain:%' OR key LIKE 'staffCandidates:%';`)
  db.prepare(`UPDATE game_state SET cash = 20000, last_tick_at = NULL`).run()
  db.prepare(`INSERT INTO shop (id, name, tier, opened_at, reputation) VALUES (1, 'Flagship', 'flagship', ?, 30)`).run(new Date().toISOString())
}

type Totals = { gross: number; rent: number; wages: number; skim: number; dmPay: number; regPay: number }

function build(dmStar: number, regStar: number) {
  const r1 = franchise.open('Satellite One', 'storefront', 3, 15, 'Mgr A', 1)
  if (!('ok' in r1 && r1.ok)) throw new Error('store 1: ' + JSON.stringify(r1))
  const rd = franchise.hireDm({ name: 'Dell', quality: dmStar, wage: franchise.DM_BASE[dmStar as 1 | 3 | 5] })
  if (!('ok' in rd && rd.ok)) throw new Error('dm: ' + JSON.stringify(rd))
  const r2 = franchise.open('Satellite Two', 'storefront', 3, 15, 'Mgr B', 2)
  if (!('ok' in r2 && r2.ok)) throw new Error('store 2: ' + JSON.stringify(r2))
  const rr = franchise.hireRegional('Renata', regStar, franchise.REGIONAL_BASE[regStar as 1 | 3 | 5])
  if (!('ok' in rr && rr.ok)) throw new Error('regional: ' + JSON.stringify(rr))
  const r3 = franchise.open('Satellite Three', 'storefront', 3, 15, 'Mgr C', 3)
  if (!('ok' in r3 && r3.ok)) throw new Error('store 3: ' + JSON.stringify(r3))
  for (const s of [1, 2, 3]) stockShelf(s)
}

function totals(): Totals {
  const rows = db.prepare(`SELECT location, line, SUM(amount) a FROM shop_ledger GROUP BY location, line`).all() as { location: string; line: string; a: number }[]
  const sum = (pred: (r: { location: string; line: string }) => boolean) => round2(rows.filter(pred).reduce((a, r) => a + r.a, 0))
  const skim = round2((db.prepare(`SELECT COALESCE(SUM(skimmed),0) s FROM franchise_sales`).get() as { s: number }).s)
  const main = (line: string) => sum((r) => r.location === 'main' && r.line === line)
  return {
    gross: sum((r) => r.line === 'cases'),
    rent: round2(-sum((r) => r.line === 'rent')),
    wages: round2(-sum((r) => r.location !== 'main' && r.line === 'payroll')),
    skim,
    // Office payroll is booked at 'main'; the note distinguishes the two salaries.
    dmPay: round2(-(db.prepare(`SELECT COALESCE(SUM(amount),0) a FROM shop_ledger WHERE location='main' AND line='payroll' AND note LIKE 'District manager%'`).get() as { a: number }).a),
    regPay: round2(-(db.prepare(`SELECT COALESCE(SUM(amount),0) a FROM shop_ledger WHERE location='main' AND line='payroll' AND note LIKE 'Regional manager%'`).get() as { a: number }).a),
  }
}

function runOne(dmStar: number, regStar: number): Totals {
  reset()
  build(dmStar, regStar)
  const setSimHour = (globalThis as { setSimHour?: (h: number) => void }).setSimHour
  const advance = (globalThis as { advanceSimDay?: () => void }).advanceSimDay
  for (let day = 1; day <= DAYS; day++) {
    const plan = simDayPlan(TICKS).sort((a, b) => a - b)
    for (let t = 0; t < TICKS; t++) {
      setSimHour?.(plan[t])
      franchise.chainTick()
    }
    playOwner()
    topUpShelves()
    advance?.()
  }
  return totals()
}

type Row = { star: number; net: number; skim: number; offices: number; gross: number }
const results: Record<string, Row[]> = { dm: [], regional: [] }

for (const star of STARS) {
  for (let run = 1; run <= RUNS; run++) {
    const dmStar = star
    const regStar = 3
    const t = runOne(dmStar, regStar)
    results.dm.push({ star, net: round2((t.gross - t.rent - t.wages - t.skim - t.dmPay - t.regPay) / DAYS), skim: round2(t.skim / DAYS), offices: round2((t.dmPay + t.regPay) / DAYS), gross: round2(t.gross / DAYS) })
  }
  for (let run = 1; run <= RUNS; run++) {
    const t = runOne(3, star)
    results.regional.push({ star, net: round2((t.gross - t.rent - t.wages - t.skim - t.dmPay - t.regPay) / DAYS), skim: round2(t.skim / DAYS), offices: round2((t.dmPay + t.regPay) / DAYS), gross: round2(t.gross / DAYS) })
  }
}

function mean(xs: number[]) { return xs.reduce((a, b) => a + b, 0) / xs.length }
function sd(xs: number[]) {
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1))
}

console.log(`\n===== office ladder: ${RUNS} runs × ${DAYS} days, ${TICKS} ticks/day (${process.env.SIM_HOUR} cadence) =====`)
for (const kind of ['dm', 'regional'] as const) {
  const label = kind === 'dm' ? 'district' : 'regional'
  const wage = kind === 'dm' ? franchise.DM_BASE : franchise.REGIONAL_BASE
  console.log(`\n${label} manager (other office held at 3★)`)
  console.log('  star   wage/d   skim/d   net/d ± CI')
  const byStar = new Map<number, Row[]>()
  for (const r of results[kind]) {
    const cur = byStar.get(r.star) ?? []
    cur.push(r)
    byStar.set(r.star, cur)
  }
  for (const star of STARS) {
    const rows = byStar.get(star) ?? []
    const nets = rows.map((r) => r.net)
    const ci = 1.96 * (sd(nets) / Math.sqrt(Math.max(1, nets.length)))
    console.log(`  ${star}★   $${(wage[star as 1 | 3 | 5] ?? 0).toFixed(2)}    $${mean(rows.map((r) => r.skim)).toFixed(2)}    $${mean(nets).toFixed(2)} ± ${ci.toFixed(2)}`)
  }
  const lo = (byStar.get(1) ?? []).map((r) => r.net)
  const hi = (byStar.get(5) ?? []).map((r) => r.net)
  const diff = mean(hi) - mean(lo)
  const se = Math.sqrt(sd(hi) ** 2 / hi.length + sd(lo) ** 2 / lo.length)
  const dci = 1.96 * se
  console.log(`  5★ − 1★: ${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}/day  [95% CI ${(diff - dci).toFixed(2)} … ${(diff + dci).toFixed(2)}]  → ${diff - dci > 0 ? 'STAR PAYS' : diff + dci < 0 ? 'STAR COSTS' : 'STAR IS A WASH'}`)
}
console.log('')
