// Resale probe internals — run via `npm run sim:resale-probe`.
import { requireSimHome } from './sim-home'

const home = requireSimHome()

import { db } from '../lib/db'
import * as resale from '../services/resale'
import { valueOfRow } from '../services/market'

db.exec(`DELETE FROM resale_deal_cards; DELETE FROM resale_deals; DELETE FROM inventory; DELETE FROM shop; DELETE FROM sale_history; DELETE FROM activity_log; DELETE FROM meta WHERE key LIKE 'tut:%';`)
db.prepare(`UPDATE game_state SET cash = 2000, last_tick_at = NULL`).run()
db.prepare(`INSERT INTO shop (id, name, tier, opened_at, reputation) VALUES (1, 'Probe', 'storefront', ?, 20)`).run(new Date().toISOString())

for (let t = 0; t < 10; t++) resale.resaleTick()
const open = db.prepare(`SELECT id, ask, true_value, seller_type FROM resale_deals WHERE status = 'open' ORDER BY id LIMIT 1`).get() as { id: number; ask: number; true_value: number; seller_type: string }
const cards = db.prepare(`SELECT card_id, condition FROM resale_deal_cards WHERE deal_id = ?`).all(open.id) as { card_id: string; condition: string }[]
console.log(`deal #${open.id} (${open.seller_type}): ask $${open.ask.toFixed(2)}  est $${open.true_value.toFixed(2)}  ${cards.length} cards`)
let rowSum = 0
for (const c of cards) {
  const v = valueOfRow({ card_id: c.card_id, variant: 'normal', condition: c.condition, graded_grade: null })
  rowSum += v
  console.log(`  ${c.card_id} [${c.condition}]  valueOfRow=$${v.toFixed(2)}`)
}
console.log(`valueOfRow sum: $${rowSum.toFixed(2)} vs deal est: $${open.true_value.toFixed(2)}  (ratio ${(rowSum / open.true_value).toFixed(3)})`)
const bought = resale.buyDeal(open.id)
console.log('buy:', JSON.stringify(bought))
const inv = db.prepare(`SELECT id, card_id, condition, cost_basis FROM inventory WHERE acquired_via = 'resale'`).all() as { id: number; card_id: string; condition: string; cost_basis: number }[]
console.log('inventory conditions:', inv.map((i) => i.condition).join(','))
let proceeds = 0
for (const row of inv) {
  const r = resale.instantSell(row.id)
  if ('ok' in r && r.ok) { proceeds += r.proceeds; console.log(`  sold ${row.card_id} [${row.condition}] → $${r.proceeds.toFixed(2)} (its market est $${r.market.toFixed(2)})`) }
}
console.log(`instant proceeds: $${proceeds.toFixed(2)} vs est $${open.true_value.toFixed(2)} (ratio ${(proceeds / open.true_value).toFixed(3)})`)

db.close()
const fs = await import('node:fs')
fs.rmSync(home, { recursive: true, force: true })
console.log(`(temp home cleaned: ${home})`)
