// One set, larger N: a 3σ flag in the 150-set sweep is often chance, so a
// flagged set is re-drawn here before it is believed.
//   TCGLIFE_HOME=$PWD/tmp/audit-home node ./node_modules/tsx/dist/cli.mjs tmp/redraw-set.ts hgss2 1000
import { rollPack } from '../server/services/packs'
import { db } from '../server/lib/db'

const setId = process.argv[2] ?? 'hgss2'
const n = Number(process.argv[3] ?? 1000)
const rows = db
  .prepare(`SELECT card_id, weight FROM pack_product_cards WHERE pack_product_id = ? AND slot = 'hit'`)
  .all(`${setId}-booster`) as { card_id: string; weight: number }[]
const hitIds = new Set(rows.map((r) => r.card_id))
const expected = Math.min(0.85, rows.reduce((a, r) => a + r.weight, 0))
let hits = 0
for (let i = 0; i < n; i++) {
  const pack = rollPack(setId, `redraw-${setId}-${i}`)
  if (pack?.some((c) => hitIds.has(c.cardId))) hits++
}
db.prepare('DELETE FROM pull_history WHERE session_id LIKE ?').run(`redraw-${setId}-%`)
const p = hits / n
const sigma = Math.sqrt((expected * (1 - expected)) / n)
console.log(
  `${setId}: ${hits}/${n} = ${(p * 100).toFixed(2)}% against ${(expected * 100).toFixed(2)}% (3σ ${(3 * sigma * 100).toFixed(2)}%)`,
)
