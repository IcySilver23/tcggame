import { ensureFullCatalog, priceOf, wrapperQuoteAgreesWithBox, derivedPrice } from '../server/services/sealed'
import { shelfPriceFor } from '../server/catalog/sealed-evidence'
import { db } from '../server/lib/db'

ensureFullCatalog()
const ids = db.prepare(`SELECT id, set_id FROM pack_products WHERE kind = 'booster' ORDER BY set_id`).all() as { id: string; set_id: string }[]
for (const r of ids) {
  const q = shelfPriceFor(r.id)
  if (!q) continue
  const ok = wrapperQuoteAgreesWithBox(r.set_id, q.market)
  const box = priceOf(`${r.set_id}-display`)
  const perPack = box.market / 36
  console.log(
    `${ok ? 'accept' : 'REFUSE'} ${r.id.padEnd(16)} quote=$${q.market.toFixed(2).padStart(10)} box=$${box.market.toFixed(0).padStart(7)} (${box.source}) perPack=$${perPack.toFixed(2)} ratio=${(perPack / q.market).toFixed(2)}`,
  )
}
