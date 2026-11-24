// Is the pre-2011 rare slot priced with its holo rate, or as one flat pool?
import { ensureFullCatalog } from '../server/services/sealed'
import { expectedPackValue, profileFor } from '../server/services/packodds'
import { valueOf } from '../server/services/market'
import { rareVariantFor } from '../server/services/finish-odds'
import { db } from '../server/lib/db'

ensureFullCatalog()

for (const id of ['base1', 'base2', 'gym2', 'neo1', 'base6', 'ecard1', 'ex5', 'ex8', 'bw11']) {
  const rows = db
    .prepare(
      `SELECT p.card_id, p.weight, c.rarity FROM pack_product_cards p JOIN cards c ON c.id = p.card_id
       WHERE p.pack_product_id = ? AND p.slot = 'holo'`,
    )
    .all(`${id}-booster`) as { card_id: string; weight: number; rarity: string | null }[]
  const prof = profileFor(id).rare
  const v = rows.map((r) => ({ w: r.weight, v: valueOf(r.card_id, rareVariantFor(id, r.rarity)), holo: /holo/i.test(r.rarity ?? '') }))
  const wSum = v.reduce((a, r) => a + r.w, 0)
  const weighted = v.reduce((a, r) => a + r.w * r.v, 0)
  const normalised = weighted / wSum
  const flat = v.reduce((a, r) => a + r.v, 0) / v.length
  const holos = v.filter((r) => r.holo)
  const plains = v.filter((r) => !r.holo)
  const avgH = holos.reduce((a, r) => a + r.v, 0) / Math.max(1, holos.length)
  const avgP = plains.reduce((a, r) => a + r.v, 0) / Math.max(1, plains.length)
  const rateModel = prof.holo * avgH + prof.plain * avgP
  console.log(
    `${id.padEnd(7)} n=${String(v.length).padStart(3)} prof=${prof.plain}/${prof.holo} wSum=${wSum.toFixed(3)} ` +
      `weighted=$${weighted.toFixed(2)} normalised=$${normalised.toFixed(2)} rateModel=$${rateModel.toFixed(2)} flat=$${flat.toFixed(2)} ` +
      `avgH=$${avgH.toFixed(2)}(${holos.length}) avgP=$${avgP.toFixed(2)}(${plains.length}) EV=$${expectedPackValue(id).toFixed(2)}`,
  )
}
