import { db } from '../server/lib/db'
import { ensureFullCatalog, priceDetail } from '../server/services/sealed'

ensureFullCatalog()
const rows = db.prepare("SELECT id, set_id, packs FROM pack_products WHERE name LIKE '%Center%' ORDER BY id").all() as {
  id: string
  set_id: string
  packs: number
}[]
for (const row of rows) {
  const d = priceDetail(row.id) as { market: number; source: string; derived?: number; detail?: string }
  console.log(`${row.id}\t${d.source}\t$${d.market}\tderived=${d.derived ?? '-'}\t${d.detail ?? ''}`)
}
