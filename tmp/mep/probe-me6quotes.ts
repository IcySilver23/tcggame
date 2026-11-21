import { db } from '../../server/lib/db'
const cols = (db.prepare(`PRAGMA table_info(sealed_prices)`).all() as { name: string }[]).map((c) => c.name)
console.log('cols', cols.join(','))
const q = db.prepare(`SELECT * FROM sealed_prices WHERE product_id LIKE 'me6%' ORDER BY retrieved_at DESC LIMIT 10`).all()
console.log(JSON.stringify(q, null, 1))
