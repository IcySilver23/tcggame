// One-off: apply the merged local release (Delta Reign + MEP promos) to this save,
// then report what the renderer and the price table do with the new promo cards.
//
// Run: node node_modules/tsx/dist/cli.mjs tmp/mep/apply.ts

import { applyLocalReleases } from '../../server/services/localcatalog'
import { db } from '../../server/lib/db'
import { holoFor } from '../../src/holo'
import { printingFor } from '../../src/foil/printing-db'

// The game may be running; wait for its write lock instead of failing outright.
db.pragma('busy_timeout = 20000')
const result = applyLocalReleases()
console.log('apply:', JSON.stringify(result))

const NEEDED = [
  'mep-031', 'mep-032', 'mep-033', 'mep-034', 'mep-035', 'mep-036',
  'mep-094', 'mep-095', 'mep-096', 'mep-097', 'mep-098', 'mep-099', 'mep-100', 'mep-101',
  'mep-104', 'mep-105', 'mep-106', 'mep-107', 'mep-108', 'mep-109', 'mep-110',
]

const price = db.prepare(
  `SELECT market, variant, source FROM (
     SELECT market, variant, 'tcgplayer' AS source FROM price_records WHERE card_id = ? AND kind = 'tcgplayer' AND market IS NOT NULL
   ) LIMIT 1`,
)
const missing: string[] = []
for (const id of NEEDED) {
  const row = price.get(id) as { market: number; variant: string } | undefined
  if (!row) missing.push(id)
}
console.log(`needed promos: ${NEEDED.length}, without a price: ${missing.length}${missing.length ? ` -> ${missing.join(', ')}` : ''}`)

const mep = db.prepare("SELECT id, name, number, rarity FROM cards WHERE set_id = 'mep' ORDER BY position, id").all() as {
  id: string
  name: string
  number: string
  rarity: string | null
}[]
const patterns = new Map<string, number>()
for (const c of mep) {
  const art = holoFor({ cardId: c.id, rarity: c.rarity ?? undefined })
  const printing = printingFor({
    cardId: c.id,
    rarity: c.rarity ?? undefined,
    name: c.name,
    variant: art?.reverse ? 'reverseHolofoil' : undefined,
  })
  const key = printing?.pattern ?? art?.pattern ?? '(none)'
  patterns.set(key, (patterns.get(key) ?? 0) + 1)
}
console.log('mep patterns:', JSON.stringify(Object.fromEntries(patterns)))
console.log('mep cards in db:', mep.length)
