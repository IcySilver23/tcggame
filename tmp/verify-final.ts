import * as packs from '../server/services/packs'
import { db } from '../server/lib/db'

db.pragma('busy_timeout = 8000')
db.prepare(`DELETE FROM pull_history WHERE session_id LIKE 'verify-%'`).run()

console.log('me55 slots:', JSON.stringify(db.prepare(`SELECT slot, COUNT(*) n FROM pack_product_cards WHERE pack_product_id='me55-booster' GROUP BY slot`).all()))

const session = `verify-final-${Date.now()}`
let ok = 0
const lastRarities: Record<string, number> = {}
const sizes: Record<number, number> = {}
for (let i = 0; i < 30; i++) {
  const r = packs.rollPack('me55', session, 'booster', 10, 'other')
  if (!r || r.length === 0) continue
  sizes[r.length] = (sizes[r.length] ?? 0) + 1
  const last = (db.prepare('SELECT rarity FROM cards WHERE id = ?').get(r[r.length - 1].cardId) as { rarity: string | null } | undefined)?.rarity ?? 'null'
  lastRarities[last] = (lastRarities[last] ?? 0) + 1
  if (last === 'Pikachu Rare') ok++
}
console.log('30C packs:', JSON.stringify(sizes), 'last card is a Pikachu:', `${ok}/30`, JSON.stringify(lastRarities))
db.prepare('DELETE FROM pull_history WHERE session_id = ?').run(session)
console.log('verify rows left:', (db.prepare(`SELECT COUNT(*) n FROM pull_history WHERE session_id LIKE 'verify-%'`).get() as { n: number }).n)
