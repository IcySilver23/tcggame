import { db } from '../../server/lib/db'
for (const id of ['mep-120','mep-Museum','mep-109']) {
  const rows = db.prepare('SELECT kind, variant, market, retrieved_at FROM price_records WHERE card_id = ?').all(id)
  console.log(id, JSON.stringify(rows))
}
const cols = db.prepare("PRAGMA table_info(price_records)").all().map((c:any)=>c.name)
console.log('price cols', cols.join(','))
