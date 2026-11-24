// Per-pack sanity of the sealed market prices.
import { db } from '../server/lib/db'
import { ensureFullCatalog } from '../server/services/sealed'
import { expectedPackValue } from '../server/services/packodds'
import { priceOf, derivedPrice, priceDetail } from '../server/services/sealed'

ensureFullCatalog()
const sets = ['swsh7', 'sv8', 'sv6', 'base1', 'swsh12', 'sv3pt5']
for (const s of sets) {
  const ev = expectedPackValue(s)
  const booster = priceOf(`${s}-booster`)
  const display = priceOf(`${s}-display`)
  const d = priceDetail(`${s}-display`)
  console.log(
    `${s.padEnd(8)} ev/pack $${ev.toFixed(2)} · pack $${booster.market.toFixed(2)} (${booster.source}) · display $${display.market.toFixed(2)} `
    + `= $${(display.market / 36).toFixed(2)}/pack · derived ${derivedPrice(s, 'display').toFixed(2)} · ${d.source}`,
  )
}
// The top contributors to one set's pack EV.
const rows = db.prepare(`SELECT p.card_id, p.weight, p.slot, c.name, c.rarity FROM pack_product_cards p JOIN cards c ON c.id=p.card_id WHERE p.pack_product_id='swsh7-booster' AND p.slot='hit'`).all() as any[]
const { valueOf } = await import('../server/services/market')
const scored = rows.map((r) => ({ name: r.name, rarity: r.rarity, w: r.weight, v: valueOf(r.card_id), c: r.weight * valueOf(r.card_id) }))
  .sort((a, b) => b.c - a.c)
console.log('\nswsh7 hit pool, top contributors:')
for (const r of scored.slice(0, 8)) console.log(`  ${r.name.padEnd(28)} ${String(r.rarity).padEnd(18)} w=${(r.w * 100).toFixed(3)}% $${r.v.toFixed(2)} -> $${r.c.toFixed(3)}/pack`)
console.log('  hit pool total per pack:', scored.reduce((a, r) => a + r.c, 0).toFixed(2))
