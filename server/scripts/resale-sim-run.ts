// Resale-desk economy audit internals — run via `npm run sim:resale`.
// Replays whole in-game days through the REAL resaleTick() and plays a simple
// scripted buyer (buy any open deal with positive estimated margin, flip via
// instant dealer offers) to measure deal flow, EV accuracy, and realized ROI.
import fs from 'node:fs'
import { requireSimHome, simArgs } from './sim-home'

const home = requireSimHome()
const { runs: RUNS, days: DAYS } = simArgs()

// --- imports (db binds to the temp home; Date already shimmed by bootstrap) -
import { db } from '../lib/db'
import * as resale from '../services/resale'

const round2 = (n: number) => Math.round(n * 100) / 100

function seedRun() {
  db.exec(`DELETE FROM resale_deal_cards; DELETE FROM resale_deals; DELETE FROM inventory;
           DELETE FROM shop_case_cards; DELETE FROM rival_cases; DELETE FROM rival_shop; DELETE FROM shop;
           DELETE FROM sale_history; DELETE FROM shop_ledger; DELETE FROM activity_log;
           DELETE FROM meta WHERE key LIKE 'rival:%' OR key LIKE 'shopDaily:%' OR key LIKE 'tut:%';`)
  db.prepare(`UPDATE game_state SET cash = 2000, last_tick_at = NULL`).run()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO shop (id, name, tier, opened_at, reputation) VALUES (1, 'Sim Shop', 'storefront', ?, 20)`).run(now)
}

type RunResult = { dealsSeen: number; bought: number; spent: number; estValue: number; expired: number; instantSold: number; proceeds: number; endCash: number }
const results: RunResult[] = []

for (let run = 1; run <= RUNS; run++) {
  seedRun()
  const res: RunResult = { dealsSeen: 0, bought: 0, spent: 0, estValue: 0, expired: 0, instantSold: 0, proceeds: 0, endCash: 0 }

  for (let day = 1; day <= DAYS; day++) {
    // The desk churns ~2 deals/tick in live play (UI polls every 15s); the sim
    // runs the tick a few times per day to get equivalent deal pressure.
    for (let t = 0; t < 6; t++) resale.resaleTick()
    res.dealsSeen = (db.prepare(`SELECT COUNT(*) n FROM resale_deals`).get() as { n: number }).n
    res.expired = (db.prepare(`SELECT COUNT(*) n FROM resale_deals WHERE status = 'expired'`).get() as { n: number }).n

    // Scripted buyer: take every open deal, flip the stock instantly.
    const open = db.prepare(`SELECT id, ask, true_value FROM resale_deals WHERE status = 'open' ORDER BY id`).all() as { id: number; ask: number; true_value: number }[]
    for (const d of open) {
      const r = resale.buyDeal(d.id)
      if ('ok' in r && r.ok) {
        res.bought++
        res.spent = round2(res.spent + d.ask)
        res.estValue = round2(res.estValue + d.true_value)
      }
    }
    // Instant-flip everything bought today (dealer offers pay 70–92% of market).
    const held = db.prepare(`SELECT id FROM inventory WHERE status = 'collection' AND acquired_via = 'resale'`).all() as { id: number }[]
    for (const h of held) {
      const r = resale.instantSell(h.id)
      if ('ok' in r && r.ok) {
        res.instantSold++
        res.proceeds = round2(res.proceeds + r.proceeds)
      }
    }
    ;(globalThis as { advanceSimDay?: () => void }).advanceSimDay?.()
  }
  res.endCash = round2((db.prepare(`SELECT cash FROM game_state`).get() as { cash: number }).cash)
  results.push(res)
  const roi = res.spent > 0 ? ((res.proceeds - res.spent) / res.spent) * 100 : 0
  console.log(`run ${String(run).padStart(2)}  deals ${String(res.dealsSeen).padStart(3)}  bought ${String(res.bought).padStart(3)}  spent $${res.spent.toFixed(0).padStart(6)}  est $${res.estValue.toFixed(0).padStart(6)}  instant $${res.proceeds.toFixed(0).padStart(6)}  ROI ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`)
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const totalSpent = results.reduce((a, r) => a + r.spent, 0)
const totalProceeds = results.reduce((a, r) => a + r.proceeds, 0)
const totalEst = results.reduce((a, r) => a + r.estValue, 0)
console.log(`
================ resale audit: ${RUNS} runs × ${DAYS} days ================
deals seen (avg/run)  : ${avg(results.map((r) => r.dealsSeen)).toFixed(1)}  (bought ${avg(results.map((r) => r.bought)).toFixed(1)}, expired ${avg(results.map((r) => r.expired)).toFixed(1)})
capital deployed      : $${totalSpent.toFixed(0)}  → instant-dealer proceeds $${totalProceeds.toFixed(0)}
est. true value bought: $${totalEst.toFixed(0)}  (ask/est = ${(totalEst > 0 ? (totalSpent / totalEst) * 100 : 0).toFixed(1)}% of value)
instant-flip ROI      : ${totalSpent > 0 ? (((totalProceeds - totalSpent) / totalSpent) * 100).toFixed(1) : '0'}%  (dealer pays 70–92% of market, so ROI < est-margin is expected)
=============================================`)

db.close()
fs.rmSync(home, { recursive: true, force: true })
console.log(`(temp home cleaned: ${home})`)
