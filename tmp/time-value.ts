// One-off: how expensive is a valueOf, and one set's estimate, on this save?
import path from 'node:path'

process.env.TCGLIFE_HOME = path.resolve('tmp/shop-home')

const { db } = await import('../server/lib/db')
const market = await import('../server/services/market')
const packs = await import('../server/services/packs')

const ids = db.prepare("SELECT id FROM cards WHERE set_id = 'swsh1' LIMIT 25").all() as { id: string }[]

let t = Date.now()
for (const { id } of ids) market.valueOf(id)
console.log('25 cold valueOf     ', Date.now() - t, 'ms')

t = Date.now()
market.valueOf(ids[0].id)
console.log('1 warm valueOf      ', Date.now() - t, 'ms')

t = Date.now()
packs.estimatePackValue('sm35')
console.log('estimate(sm35)      ', Date.now() - t, 'ms')

t = Date.now()
packs.estimatePackValue('swsh1')
console.log('estimate(swsh1)     ', Date.now() - t, 'ms')

db.close()
