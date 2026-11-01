import * as packs from '../server/services/packs'
import { db } from '../server/lib/db'

const N = 200
const slotCounts = (setId: string) =>
  db
    .prepare(`SELECT slot, COUNT(*) n FROM pack_product_cards WHERE pack_product_id = ? GROUP BY slot`)
    .all(`${setId}-booster`) as { slot: string; n: number }[]

for (const id of ['me55', 'me55c', 'cel25c']) {
  packs.buildPullTable(id, 10)
}
console.log('me55 slots:', JSON.stringify(slotCounts('me55')))
console.log('me55c slots:', JSON.stringify(slotCounts('me55c')))
console.log('cel25c slots:', JSON.stringify(slotCounts('cel25c')))

for (const setId of ['me55', 'me55c', 'cel25c']) {
  const session = `verify-${setId}-${Date.now()}`
  const rarities: Record<string, number> = {}
  const sizes: Record<number, number> = {}
  let subsetLast = 0
  let rolled = 0
  for (let i = 0; i < N; i++) {
    const r = packs.rollPack(setId, session, 'booster', 10, 'other')
    if (!r || r.length === 0) continue
    rolled++
    sizes[r.length] = (sizes[r.length] ?? 0) + 1
    const lastRarity = (db.prepare('SELECT rarity FROM cards WHERE id = ?').get(r[r.length - 1].cardId) as { rarity: string | null } | undefined)?.rarity
    if (lastRarity === 'Pikachu Rare' || lastRarity === 'Classic Collection' || setId === 'me55c') subsetLast++
    for (const c of r) {
      const q = (db.prepare('SELECT rarity FROM cards WHERE id = ?').get(c.cardId) as { rarity: string | null } | undefined)?.rarity ?? 'null'
      rarities[q] = (rarities[q] ?? 0) + 1
    }
  }
  console.log(`\n[${setId}] packs=${rolled} sizes=${JSON.stringify(sizes)} lastCardFromSubset=${subsetLast}/${rolled}`)
  console.log('  rarities per 200 packs:', JSON.stringify(rarities))
  db.prepare('DELETE FROM pull_history WHERE session_id = ?').run(session)
}

const leftover = db.prepare(`SELECT COUNT(*) n FROM pull_history WHERE session_id LIKE 'verify-%'`).get() as { n: number }
console.log('\nverify rows cleaned (should be 0):', leftover.n)
