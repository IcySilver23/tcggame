// Full-empire audit internals — run via `npm run sim:empire`.
// Builds the whole chain through the REAL open()/hireDm()/hireRegional()
// paths, runs the real chainTick() at a realistic mixed-hours cadence, and
// reports whether the chain compounds or drains: per-door net, the cost of
// management overhead (from the ledger, not end-of-run state), and the cash
// curve of the empire as a whole.
//
// THE MANAGEMENT GAME MATTERS: busy chains make managers file raise demands
// (loyalty.ts), and an ignored ask ends in a walkout — satellites after 7
// days, the DM after 14, the regional after 21. The owner policy is part of
// the economy, so the sim plays it: SIM_OWNER=attentive (default) grants
// every raise; SIM_OWNER=negligent ignores every ask. Run both — the gap
// between them IS the cost of managing (or not managing) the chain.
//
// The flagship counter is abstracted (the flagship's own walk-ins are the
// shop.ts economy, audited elsewhere): this audit isolates the CHAIN —
// satellites, their salaries, and the offices above them — against the
// game_state cash curve they all draw on.
import fs from 'node:fs'
import { requireSimHome, simArgs, simDayPlan } from './sim-home'

const home = requireSimHome()
const { runs: RUNS, days: DAYS } = simArgs()
const OWNER = process.env.SIM_OWNER === 'negligent' ? 'negligent' : 'attentive'

import { db } from '../lib/db'
import * as franchise from '../services/franchise'
import { resolveDemand, resolveDmDemand, resolveRegionalDemand, hasOpenDemand } from '../services/loyalty'
import { valueOf } from '../services/market'

const round2 = (n: number) => Math.round(n * 100) / 100
const TICKS_PER_DAY = Math.max(1, Number(process.env.SIM_TICKS_PER_DAY ?? 40))
const BAND: Record<string, [number, number]> = { bulk: [0.5, 8], mid: [8, 60], premium: [60, 300] }
const [bandMin, bandMax] = BAND[process.env.SIM_BAND ?? 'mid'] ?? BAND.mid

function pickCardInBand(): { id: string; market: number } | null {
  for (let tries = 0; tries < 30; tries++) {
    const row = db.prepare(`SELECT id FROM cards WHERE rarity IN ('Common','Uncommon','Rare') AND id NOT LIKE '%-psa%' ORDER BY RANDOM() LIMIT 1`).get() as { id: string }
    const market = valueOf(row.id)
    if (market >= bandMin && market <= bandMax) return { id: row.id, market }
  }
  return null
}

function stockShelf(store: number, rows = 10) {
  for (let i = 0; i < rows; i++) {
    const pick = pickCardInBand()
    if (!pick) continue
    const info = db.prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, listing_price, cost_basis, acquired_at, acquired_via) VALUES (?, 'normal', 'NM', 1, 'on_shelf', ?, ?, ?, 'sim')`)
      .run(pick.id, round2(pick.market * 1.15), round2(pick.market * 0.7), new Date().toISOString())
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

/** The owner's daily pass: grant every raise on the table, or ignore them all. */
function grantAmount(r: { ok: boolean; granted?: number }): number {
  return r.ok && typeof r.granted === 'number' ? r.granted : 0
}

function playOwner(): number {
  if (OWNER === 'negligent') return 0
  let paid = 0
  for (const f of franchise.allStores()) {
    if (!hasOpenDemand(f)) continue
    paid += grantAmount(resolveDemand(f.id, 'grant'))
  }
  if (franchise.districtRow()?.raise_demand) paid += grantAmount(resolveDmDemand('grant'))
  if (franchise.regionalRow()?.raise_demand) paid += grantAmount(resolveRegionalDemand('grant'))
  return paid
}

type DoorNet = { gross: number; rent: number; wages: number; skim: number }
function doorNets(): Record<number, DoorNet> {
  const out: Record<number, DoorNet> = {}
  const rows = db.prepare(`SELECT location, line, SUM(amount) a FROM shop_ledger WHERE location LIKE 'satellite:%' GROUP BY location, line`).all() as { location: string; line: string; a: number }[]
  for (const store of [1, 2, 3]) {
    const rs = rows.filter((r) => r.location === `satellite:${store}`)
    const g = rs.find((r) => r.line === 'cases')
    out[store] = {
      gross: round2(g?.a ?? 0),
      rent: round2(-(rs.find((r) => r.line === 'rent')?.a ?? 0)),
      wages: round2(-(rs.find((r) => r.line === 'payroll')?.a ?? 0)),
      skim: 0,
    }
  }
  const skims = db.prepare(`SELECT store, COALESCE(SUM(skimmed),0) s FROM franchise_sales GROUP BY store`).all() as { store: number; s: number }[]
  for (const s of skims) if (out[s.store]) out[s.store].skim = round2(s.s)
  return out
}

/** Office overhead from the ledger — DM + regional payroll and signing bonuses. */
function officeCosts(): { dmPay: number; regPay: number; signing: number } {
  const rows = db.prepare(`SELECT line, amount, note FROM shop_ledger WHERE location = 'main'`).all() as { line: string; amount: number; note: string }[]
  let dmPay = 0
  let regPay = 0
  let signing = 0
  for (const r of rows) {
    if (r.line === 'payroll' && r.note.startsWith('District manager')) dmPay += r.amount
    else if (r.line === 'payroll' && r.note.startsWith('Regional manager')) regPay += r.amount
    else if (r.line === 'overhead' && r.note.includes('signing bonus')) signing += r.amount
  }
  return { dmPay: round2(dmPay), regPay: round2(regPay), signing: round2(signing) }
}

const cash = () => (db.prepare(`SELECT cash FROM game_state`).get() as { cash: number }).cash
const fmt$ = (v: number) => `$${Math.round(Math.abs(v)).toLocaleString()}`
const signed$ = (v: number) => `${v >= 0 ? '+' : '-'}${fmt$(v)}`

type OfficeNet = { dmPay: number; regPay: number; signing: number; grants: number; walkouts: number }
const zeroOffice = (): OfficeNet => ({ dmPay: 0, regPay: 0, signing: 0, grants: 0, walkouts: 0 })

const curves: number[][] = []
const doorAgg: Record<number, DoorNet> = { 1: { gross: 0, rent: 0, wages: 0, skim: 0 }, 2: { gross: 0, rent: 0, wages: 0, skim: 0 }, 3: { gross: 0, rent: 0, wages: 0, skim: 0 } }
const officeAgg: OfficeNet = zeroOffice()
let dmQualityStartSum = 0
let dmQualityEndSum = 0
let cashMin = Infinity
let cashEndSum = 0

for (let run = 1; run <= RUNS; run++) {
  db.exec(`DELETE FROM franchise_shelf_cards; DELETE FROM franchise_sales; DELETE FROM franchise;
           DELETE FROM regional_managers; DELETE FROM shop_case_cards; DELETE FROM rival_cases; DELETE FROM rival_shop;
           DELETE FROM shop; DELETE FROM inventory; DELETE FROM shop_ledger; DELETE FROM activity_log; DELETE FROM sale_history;
           DELETE FROM meta WHERE key LIKE 'rival:%' OR key LIKE 'shopDaily:%' OR key LIKE 'chain:%' OR key LIKE 'staffCandidates:%';`)
  db.prepare(`UPDATE game_state SET cash = 20000, last_tick_at = NULL`).run()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO shop (id, name, tier, opened_at, reputation) VALUES (1, 'Flagship', 'flagship', ?, 30)`).run(now)

  // The empire, through the real gates: satellite → DM → satellite → regional → store 3.
  // Manager quality is drawn per door (2–5★) — the sim plays an average owner.
  // Door managers hire at the market ladder (6+q×3, the managerCandidates price)
  // so the raise game starts from fair pay, not from an instant underpay.
  const q = () => 2 + Math.floor(Math.random() * 4)
  const marketWage = (quality: number) => round2((6 + quality * 3) * 4) / 4
  const r1 = franchise.open('Satellite One', 'storefront', q(), marketWage(q()), 'Mgr A', 1)
  if (!('ok' in r1 && r1.ok)) throw new Error('store 1: ' + JSON.stringify(r1))
  const dmQ = [3, 5][run % 2] // alternate a mid DM and a star DM across runs
  const rd = franchise.hireDm({ name: 'Dell', quality: dmQ, wage: franchise.DM_BASE[dmQ as 3 | 5] })
  if (!('ok' in rd && rd.ok)) throw new Error('dm: ' + JSON.stringify(rd))
  const r2 = franchise.open('Satellite Two', 'storefront', q(), marketWage(q()), 'Mgr B', 2)
  if (!('ok' in r2 && r2.ok)) throw new Error('store 2: ' + JSON.stringify(r2))
  const regQ = 3
  const rr = franchise.hireRegional('Renata', regQ, franchise.REGIONAL_BASE[regQ as 3])
  if (!('ok' in rr && rr.ok)) throw new Error('regional: ' + JSON.stringify(rr))
  const r3 = franchise.open('Satellite Three', 'storefront', q(), marketWage(q()), 'Mgr C', 3)
  if (!('ok' in r3 && r3.ok)) throw new Error('store 3: ' + JSON.stringify(r3))
  stockShelf(1); stockShelf(2); stockShelf(3)
  dmQualityStartSum += dmQ

  const curve: number[] = []
  let grants = 0
  const setSimHour = (globalThis as { setSimHour?: (h: number) => void }).setSimHour
  for (let day = 1; day <= DAYS; day++) {
    const plan = simDayPlan(TICKS_PER_DAY).sort((a, b) => a - b)
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      setSimHour?.(plan[t])
      franchise.chainTick()
    }
    grants += playOwner()
    topUpShelves()
    ;(globalThis as { advanceSimDay?: () => void }).advanceSimDay?.()
    const c = cash()
    if (c < cashMin) cashMin = c
    curve.push(round2(c))
  }

  const nets = doorNets()
  const office = officeCosts()
  const walkouts = (db.prepare(`SELECT COUNT(*) n FROM activity_log WHERE message LIKE '%🚪%'`).get() as { n: number }).n
  for (const s of [1, 2, 3]) {
    doorAgg[s].gross = round2(doorAgg[s].gross + nets[s].gross)
    doorAgg[s].rent = round2(doorAgg[s].rent + nets[s].rent)
    doorAgg[s].wages = round2(doorAgg[s].wages + nets[s].wages)
    doorAgg[s].skim = round2(doorAgg[s].skim + nets[s].skim)
  }
  officeAgg.dmPay = round2(officeAgg.dmPay + office.dmPay)
  officeAgg.regPay = round2(officeAgg.regPay + office.regPay)
  officeAgg.signing = round2(officeAgg.signing + office.signing)
  officeAgg.grants = round2(officeAgg.grants + grants)
  officeAgg.walkouts += walkouts
  const dm = franchise.districtRow()
  dmQualityEndSum += dm?.quality ?? 0
  cashEndSum += curve[curve.length - 1]
  curves.push(curve)
  const doorStr = [1, 2, 3].map((s) => {
    const n = nets[s]
    const d = round2((n.gross - n.rent - n.wages - n.skim) / DAYS)
    return `S${s} ${d >= 0 ? '+' : ''}${d.toFixed(0)}`
  }).join('  ')
  const officeDay = round2((office.dmPay + office.regPay) / DAYS)
  console.log(`run ${String(run).padStart(2)}  DM ${dmQ}★${dm && dm.quality !== dmQ ? `→${dm.quality}★` : '   '}  doors/day: ${doorStr}  offices ${signed$(officeDay)}/d  skim $${round2(nets[1].skim + nets[2].skim + nets[3].skim).toFixed(0)}  🚪${walkouts}  empire $${Math.round(curve[curve.length - 1]).toLocaleString()}`)
}

const n = RUNS
const doorNetSum = round2(([1, 2, 3] as number[]).reduce((a, s) => a + (doorAgg[s].gross - doorAgg[s].rent - doorAgg[s].wages - doorAgg[s].skim), 0))
const officeDay = round2((officeAgg.dmPay + officeAgg.regPay) / n / DAYS) // already negative
const chainNet = round2(doorNetSum / n / DAYS + officeDay)
console.log(`
================ empire audit: ${RUNS} runs × ${DAYS} days (${TICKS_PER_DAY} ticks/day, full-day clock) ================
owner policy       : ${OWNER === 'attentive' ? 'attentive — grants every raise (raises paid: ' + fmt$(officeAgg.grants / n) + '/run)' : 'negligent — ignores every raise ask'}
per-door averages  : ${[1, 2, 3].map((s) => {
    const d = doorAgg[s]
    const net = round2((d.gross - d.rent - d.wages - d.skim) / n / DAYS)
    return `S${s} gross $${round2(d.gross / n / DAYS).toFixed(0)}/d − rent $${round2(d.rent / n / DAYS).toFixed(0)} − wage $${round2(d.wages / n / DAYS).toFixed(0)} − skim $${round2(d.skim / n / DAYS).toFixed(0)} → ${net >= 0 ? '+' : ''}$${net}/d`
  }).join('\n                     ')}
management overhead: DM ${signed$(officeAgg.dmPay / n / DAYS)}/day (quality ${round2(dmQualityStartSum / n).toFixed(1)}★${dmQualityEndSum !== dmQualityStartSum ? ` → ${round2(dmQualityEndSum / n).toFixed(1)}★ coached` : ''}) + regional ${signed$(officeAgg.regPay / n / DAYS)}/day
one-time setup     : -${fmt$(officeAgg.signing / n)} office signing bonuses + deposits & door signing fees in the doors' books
manager walkouts   : 🚪 ${officeAgg.walkouts} across ${n} runs
manager skim       : $${round2(([1, 2, 3] as number[]).reduce((a, s) => a + doorAgg[s].skim, 0) / n).toFixed(0)} per run ($${round2(([1, 2, 3] as number[]).reduce((a, s) => a + doorAgg[s].skim, 0) / n / DAYS).toFixed(2)}/day chain-wide)
chain net (doors + offices): ${signed$(chainNet)}/day
empire cash        : ${fmt$(20000)} → ${fmt$(cashEndSum / n)} (lowest point ${fmt$(cashMin)})
verdict            : ${(() => {
    if (chainNet > 25) return 'COMPOUNDS — each door carries its share and funds the offices'
    if (chainNet > 0) return 'grinds out a small surplus — expansion pays, barely'
    return 'DRAINS — the offices cost more than the doors earn'
  })()}
=============================================`)

db.close()
fs.rmSync(home, { recursive: true, force: true })
console.log(`(temp home cleaned: ${home})`)
