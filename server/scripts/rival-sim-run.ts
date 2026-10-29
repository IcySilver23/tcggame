// Rival-arc simulator internals — run through `npm run sim:rival` (which
// prepares the isolated temp home BEFORE importing anything from ../lib or
// ../services; importing this file directly binds to your real save and the
// guard below refuses).
//
// Replays whole in-game days through the REAL rivalTick() (no re-implemented
// math) and reports war frequency, blink rates, comeback durations, and till
// solvency across runs. Each run reseeds its own rows in the throwaway copy.
//
// Time travel: Date is shimmed forward one day per iteration BEFORE the
// service imports load, so every `new Date()` inside rival.ts (today keys,
// war windows, spawn checks) agrees with the simulated clock. There is no
// 20-second tick gate to fight — rivalTick() gates itself per simulated day.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// --- isolation guard: never bind to the real save --------------------------
const home = process.env.TCGLIFE_HOME
if (!home || !path.resolve(home).startsWith(path.resolve(os.tmpdir()))) {
  console.error('rival-sim-run must be launched via `npm run sim:rival` (it needs an isolated TCGLIFE_HOME in the OS temp dir) — refusing to run against your real save.')
  process.exit(1)
}

const RUNS = Math.max(1, Number(process.env.SIM_RUNS ?? 20))
const DAYS = Math.max(1, Number(process.env.SIM_DAYS ?? 30))

// --- 2. the clock shim (before service imports) ----------------------------
const simStart = Date.now()
let simNow = simStart
const RealDate = Date
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SimDate: any = function (this: unknown, ...args: any[]) {
  if (new.target) return args.length === 0 ? new RealDate(simNow) : new (RealDate as any)(...args)
  return (RealDate as any)(...args) // Date() without new returns a string, as usual
}
SimDate.prototype = RealDate.prototype
SimDate.now = () => simNow
SimDate.parse = RealDate.parse
SimDate.UTC = RealDate.UTC
globalThis.Date = SimDate
const advanceDay = () => { simNow += 86_400_000 }

// --- 3. imports (db binds to the temp home; Date already shimmed) ----------
import { db, getMeta } from '../lib/db'
import * as rival from '../services/rival'

const round2 = (n: number) => Math.round(n * 100) / 100

// --- 4. per-run seeding: rival stocks first, my cases mirror its board -----
function seedRun(run: number) {
  db.exec(`DELETE FROM shop_case_cards; DELETE FROM rival_cases; DELETE FROM rival_sales;
           DELETE FROM rival_shop; DELETE FROM shop_consignments; DELETE FROM shop_sales;
           DELETE FROM shop; DELETE FROM inventory; DELETE FROM shop_ledger; DELETE FROM activity_log;
           DELETE FROM meta WHERE key LIKE 'rival:%' OR key LIKE 'shopDaily:%';`)
  db.prepare(`UPDATE game_state SET cash = 1000, last_tick_at = NULL`).run()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO shop (id, name, tier, opened_at, reputation) VALUES (1, 'Sim Shop', 'storefront', ?, 15)`).run(now)
  const aggression = round2(0.5 + (run % 5) * 0.125) // 0.50..1.00 across runs
  db.prepare(`INSERT INTO rival_shop (id, name, quality, reputation, aggression, cash, buyout_bump, spawned_at) VALUES (1, 'The Other Case', ?, ?, ?, 500, 1, ?)`)
    .run(1 + (run % 4), 20, aggression, now)
  rival.stockCases(12)
}

// My shelf mirrors 8 of the rival's cards at 1.1× their ask: healthy overlap,
// so wars have something to bite — the same shape organic play produces.
function mirrorShelf() {
  const theirs = db.prepare(`SELECT card_id, ask FROM rival_cases ORDER BY id LIMIT 8`).all() as { card_id: string; ask: number }[]
  for (const t of theirs) {
    db.prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, listing_price, cost_basis, acquired_at, acquired_via) VALUES (?, 'normal', 'NM', 1, 'in_case', ?, 0, ?, 'sim')`)
      .run(t.card_id, round2(t.ask * 1.1), new Date().toISOString())
    db.prepare(`INSERT INTO shop_case_cards (case_id, inventory_id) VALUES (1, ?)`).run((db.prepare(`SELECT id FROM inventory WHERE card_id = ?`).get(t.card_id) as { id: number }).id)
  }
}

// --- 5. the sim -------------------------------------------------------------
type WarEvent = { startDay: number; kind: 'natural' | 'blink'; endDay: number | null }
type Run = {
  aggression: number
  wars: WarEvent[]
  blinks: number
  comebackDays: number[]
  endCash: number
  endRep: number
  endCases: number
  stillOpen: boolean
}
const runs: Run[] = []

for (let run = 1; run <= RUNS; run++) {
  seedRun(run)
  mirrorShelf()
  const r: Run = {
    aggression: (db.prepare(`SELECT aggression FROM rival_shop WHERE id = 1`).get() as { aggression: number }).aggression,
    wars: [], blinks: 0, comebackDays: [], endCash: 0, endRep: 0, endCases: 0, stillOpen: true,
  }

  const trace = process.env.SIM_TRACE === '1'
  for (let day = 1; day <= DAYS; day++) {
    const before = db.prepare(`SELECT cash, reputation, price_war_until FROM rival_shop WHERE id = 1`).get() as { cash: number; reputation: number; price_war_until: string | null }
    const salesBefore = (db.prepare(`SELECT COUNT(*) n FROM rival_sales`).get() as { n: number }).n
    if (trace) console.log(`  pre-day ${day}: rep=${before.reputation} cash=${before.cash.toFixed(2)} war=${before.price_war_until}`)

    rival.rivalTick()
    advanceDay()

    const after = db.prepare(`SELECT cash, reputation, price_war_until FROM rival_shop WHERE id = 1`).get() as { cash: number; reputation: number; price_war_until: string | null }
    if (trace) {
      const sales = (db.prepare(`SELECT COUNT(*) n FROM rival_sales`).get() as { n: number }).n - salesBefore
      console.log(`  post-day ${day}: rep=${after.reputation} cash=${after.cash.toFixed(2)} war=${after.price_war_until} sales=+${sales} humbled=${getMeta('rival:humbled') ?? 'no'}`)
    }

    // war opened today?
    if (after.price_war_until && !before.price_war_until) {
      r.wars.push({ startDay: day, kind: 'natural', endDay: null })
    }
    // war closed today — by expiry or by blinking first? The humbled flag is
    // the deterministic tell: ONLY the blink branch sets it. (Feed-text
    // matching leaked across runs — prior runs stamp activity rows in the
    // simulated future, and each run restarts the clock at real-now.)
    if (!after.price_war_until && before.price_war_until) {
      const war = r.wars[r.wars.length - 1]
      const fresh = war != null && war.endDay == null
      if (fresh) war.endDay = day
      const blink = fresh && !!getMeta('rival:humbled')
      if (blink) {
        war.kind = 'blink'
        r.blinks++
        // comeback duration: simulated days until the humbled flag lifts
        let d = 0
        while (getMeta('rival:humbled') && d < 90) { rival.rivalTick(); advanceDay(); d++ }
        r.comebackDays.push(d)
      }
    }

    if (day === DAYS) {
      const row = db.prepare(`SELECT cash, reputation FROM rival_shop WHERE id = 1`).get() as { cash: number; reputation: number }
      r.endCash = row.cash
      r.endRep = row.reputation
      r.endCases = (db.prepare(`SELECT COUNT(*) n FROM rival_cases`).get() as { n: number }).n
      r.stillOpen = !!db.prepare(`SELECT 1 FROM rival_shop WHERE id = 1 AND sold = 0`).get()
    }
  }
  runs.push(r)
  console.log(`run ${String(run).padStart(2)}  agg ${r.aggression.toFixed(2)}  wars ${r.wars.length} (blinks ${r.blinks})  comeback ${r.comebackDays.join(',') || '—'}d  till $${r.endCash.toFixed(0)}  rep ${r.endRep}  cases ${r.endCases}`)
}

// --- 6. aggregate -----------------------------------------------------------
const totalWars = runs.reduce((a, r) => a + r.wars.length, 0)
const totalBlinks = runs.reduce((a, r) => a + r.blinks, 0)
const warDurations = runs.flatMap((r) => r.wars.filter((w) => w.endDay != null).map((w) => w.endDay! - w.startDay + 1))
const comebacks = runs.flatMap((r) => r.comebackDays)
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const insolvent = runs.filter((r) => r.endCases === 0 && r.endCash < 20).length
const died = runs.filter((r) => !r.stillOpen).length

console.log(`
================ ${RUNS} runs × ${DAYS} days ================
wars fired          : ${totalWars}  (${(totalWars / RUNS).toFixed(2)}/run)
war duration (d)    : avg ${avg(warDurations).toFixed(1)}  n=${warDurations.length}
ended by blink      : ${totalBlinks}/${totalWars || 1} wars  (${Math.round((totalBlinks / (totalWars || 1)) * 100)}%)
comeback duration   : avg ${avg(comebacks).toFixed(1)}d  n=${comebacks.length}  (days under the flag)
till at day ${DAYS}      : avg $${avg(runs.map((r) => r.endCash)).toFixed(0)}  min $${Math.min(...runs.map((r) => r.endCash)).toFixed(0)}
rep at day ${DAYS}       : avg ${avg(runs.map((r) => r.endRep)).toFixed(1)}  (spawn 20)
cases at day ${DAYS}     : avg ${avg(runs.map((r) => r.endCases)).toFixed(1)}
struggled to empty  : ${insolvent}/${RUNS} runs  | closed early: ${died}/${RUNS}
=============================================`)

db.close()
fs.rmSync(home, { recursive: true, force: true })
console.log(`(temp home cleaned: ${home})`)
