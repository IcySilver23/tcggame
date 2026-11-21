// One-off: where the /api/shop/products time goes, on the copied save.
import path from 'node:path'

process.env.TCGLIFE_HOME = path.resolve('tmp/shop-home')

const { db } = await import('../server/lib/db')
const packs = await import('../server/services/packs')
const sealed = await import('../server/services/sealed')
const gm = await import('../server/services/gmpacks')

const rows = db.prepare('SELECT id, set_id FROM pack_products').all() as { id: string; set_id: string }[]
console.log('products:', rows.length, 'sets:', new Set(rows.map((r) => r.set_id)).size)

let t = Date.now()
packs.estimatePackValue('swsh1')
console.log('  estimatePackValue(swsh1)        ', Date.now() - t, 'ms')

t = Date.now()
sealed.priceDetail('sm1-booster')
console.log('  priceDetail(sm1-booster)        ', Date.now() - t, 'ms')

t = Date.now()
sealed.priceDetail('gm-sunmoon-mini')
console.log('  priceDetail(gm-sunmoon-mini)    ', Date.now() - t, 'ms')

t = Date.now()
gm.estimateMiniPack('gm-25th-mini')
console.log('  estimateMiniPack(gm-25th-mini)  ', Date.now() - t, 'ms')

t = Date.now()
for (const r of rows) sealed.priceDetail(r.id)
console.log('  priceDetail for every product   ', Date.now() - t, 'ms')

t = Date.now()
const sets = [...new Set(rows.map((r) => r.set_id))]
for (const s of sets) packs.estimatePackValue(s)
console.log('  estimatePackValue for every set ', Date.now() - t, 'ms', `(${sets.length} sets)`)

t = Date.now()
for (const r of rows) sealed.priceDetail(r.id)
console.log('  priceDetail again (warm)        ', Date.now() - t, 'ms')

t = Date.now()
for (const s of sets) packs.estimatePackValue(s)
console.log('  estimatePackValue again (warm)  ', Date.now() - t, 'ms')

db.close()
