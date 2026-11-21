import { rollPack } from '../../server/services/packs'
import { db } from '../../server/lib/db'
const gg = new Set((db.prepare("SELECT id FROM cards WHERE set_id='swsh12pt5gg'").all() as { id: string }[]).map((r) => r.id))
let gallery = 0, galleryCards = 0
const n = 3000
for (let i = 0; i < n; i++) {
  const pack = rollPack('swsh12pt5', 'probe-cz') as { cardId: string }[] | null
  if (!pack) throw new Error('no pack')
  const hits = pack.filter((c) => gg.has(c.cardId)).length
  if (hits > 0) gallery++
  galleryCards += hits
}
console.log(`packs ${n} | packs with a gallery card ${(gallery / n * 100).toFixed(1)}% | gallery cards per pack ${(galleryCards / n).toFixed(2)}`)
