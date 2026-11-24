// Every display's price per pack against the set's own pack price.
import { db } from '../server/lib/db'
import { ensureFullCatalog, priceOf } from '../server/services/sealed'

ensureFullCatalog()
const rows = db.prepare(`SELECT id, set_id, kind, packs, msrp FROM pack_products WHERE kind='display' AND packs > 1 ORDER BY id`).all() as any[]
const out: { id: string; packs: number; mkt: number; pack: number; ratio: number }[] = []
for (const r of rows) {
  const d = priceOf(r.id)
  const p = priceOf(`${r.set_id}-booster`)
  if (!(d.market > 0) || !(p.market > 0)) continue
  out.push({ id: r.id, packs: r.packs, mkt: d.market, pack: p.market, ratio: (d.market / r.packs) / p.market })
}
out.sort((a, b) => b.ratio - a.ratio)
console.log('worst per-pack ratios (display price per pack / pack price):')
for (const r of out.slice(0, 12)) console.log(`  ${r.id.padEnd(18)} ${r.packs}p  display $${r.mkt.toFixed(2)} ($${(r.mkt / r.packs).toFixed(2)}/pack)  pack $${r.pack.toFixed(2)}  ratio ${r.ratio.toFixed(2)}`)
console.log('\nbest (cheapest per pack):')
for (const r of out.slice(-6)) console.log(`  ${r.id.padEnd(18)} ${r.packs}p  ratio ${r.ratio.toFixed(2)}`)
const buckets = [0.5, 0.8, 1, 1.2, 1.5, 2, 3, 5, 10]
console.log('\ncounts over ratio:', buckets.map((b) => `${b}:${out.filter((r) => r.ratio > b).length}`).join(' '), 'of', out.length)
