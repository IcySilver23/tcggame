// Measure the real box-to-loose-pack relationship, then judge the band against it.
//
//   TCGLIFE_HOME=<scratch> node ./node_modules/tsx/dist/cli.mjs tmp/audit-box-ratios.ts
//
// Boxes are compared at their *shelf quote* (what the marketplace asks), not at
// the price the band left them, and only against a wrapper that has a real quote
// of its own — a modelled pack cannot judge a real box.
import { db } from '../server/lib/db'
import { ensureFullCatalog, priceOf, DISPLAY_PACK_CAP } from '../server/services/sealed'
import { shelfPriceFor } from '../server/catalog/sealed-evidence'

ensureFullCatalog()

const rows = db
  .prepare(`SELECT id, set_id, packs FROM pack_products WHERE kind = 'display' AND packs > 1 ORDER BY set_id`)
  .all() as { id: string; set_id: string; packs: number }[]

const pairs: { set: string; id: string; box: number; perPack: number; pack: number; ratio: number }[] = []
let modelled = 0
for (const r of rows) {
  const cut = priceOf(r.id)
  const quote = shelfPriceFor(r.id)
  const box = quote ? quote.market : cut.market
  if (!(box > 0)) continue
  const p = priceOf(`${r.set_id}-booster`)
  if (!(p.market > 0)) continue
  if (p.source === 'estimated') {
    modelled++
    continue
  }
  const perPack = box / r.packs
  pairs.push({ set: r.set_id, id: r.id, box, perPack, pack: p.market, ratio: perPack / p.market })
}

pairs.sort((a, b) => a.ratio - b.ratio)
console.log('set        box       $/pack   loose pack  box/pack')
for (const r of pairs) {
  console.log(`${r.set.padEnd(10)} ${r.box.toFixed(2).padStart(9)} ${r.perPack.toFixed(2).padStart(8)} ${r.pack.toFixed(2).padStart(11)} ${r.ratio.toFixed(2).padStart(9)}`)
}

const rs = pairs.map((r) => r.ratio)
const q = (f: number) => (rs.length ? rs[Math.min(rs.length - 1, Math.floor(f * rs.length))] : 0)
console.log(`\nreal box vs real loose pack: ${rs.length} pairs · ${modelled} displays still have only a modelled pack (no band)`)
if (rs.length) {
  console.log(`  min ${rs[0].toFixed(2)} · median ${q(0.5).toFixed(2)} · p90 ${q(0.9).toFixed(2)} · p95 ${q(0.95).toFixed(2)} · max ${rs[rs.length - 1].toFixed(2)}`)
  console.log(`  widest: ${pairs.slice(-3).map((r) => `${r.set} ${r.ratio.toFixed(2)}`).join(' · ')}`)
  console.log(`  cap ${DISPLAY_PACK_CAP}x · pairs above the cap: ${rs.filter((r) => r > DISPLAY_PACK_CAP).length}`)
}
const cut = rows.filter((r) => priceOf(r.id).market > 0).length
console.log(`  displays priced: ${cut} · box quotes that the band moved: ${pairs.filter((r) => shelfPriceFor(r.id) && priceOf(r.id).market !== shelfPriceFor(r.id)!.market).length}`)
