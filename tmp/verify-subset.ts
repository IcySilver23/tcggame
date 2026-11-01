import * as packs from '../server/services/packs'
import { db } from '../server/lib/db'

db.pragma('busy_timeout = 8000')
db.prepare(`DELETE FROM pull_history WHERE session_id LIKE 'verify-%'`).run()

for (const setId of ['me55c', 'cel25c']) {
  const session = `verify-${setId}-${Date.now()}`
  const rarities: Record<string, number> = {}
  const sizes: Record<number, number> = {}
  const distinct = new Set<string>()
  let rolled = 0
  for (let i = 0; i < 40; i++) {
    const r = packs.rollPack(setId, session, 'booster', 10, 'other')
    if (!r || r.length === 0) continue
    rolled++
    sizes[r.length] = (sizes[r.length] ?? 0) + 1
    for (const c of r) {
      distinct.add(c.cardId)
      const q = (db.prepare('SELECT rarity FROM cards WHERE id = ?').get(c.cardId) as { rarity: string | null } | undefined)?.rarity ?? 'null'
      rarities[q] = (rarities[q] ?? 0) + 1
    }
  }
  console.log(`[${setId}] packs=${rolled} sizes=${JSON.stringify(sizes)} distinctCards=${distinct.size}`)
  console.log('  rarities per pack set:', JSON.stringify(rarities))
  db.prepare('DELETE FROM pull_history WHERE session_id = ?').run(session)
}

const leftover = db.prepare(`SELECT COUNT(*) n FROM pull_history WHERE session_id LIKE 'verify-%'`).get() as { n: number }
console.log('verify rows cleaned (should be 0):', leftover.n)
console.log('me55 slots:', JSON.stringify(db.prepare(`SELECT slot, COUNT(*) n FROM pack_product_cards WHERE pack_product_id = 'me55-booster' GROUP BY slot`).all()))
