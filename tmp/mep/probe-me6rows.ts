import { db } from '../../server/lib/db'
const rows = db.prepare(`SELECT card_id, kind, variant, market, retrieved_at FROM price_records
  WHERE card_id IN ('me6-84','me6-138','me6-141') ORDER BY card_id, variant`).all()
for (const r of rows) console.log(JSON.stringify(r))
console.log('--- top me6 prices ---')
for (const r of db.prepare(`SELECT c.id, c.name, c.number, p.variant, p.market FROM cards c
  JOIN price_records p ON p.card_id = c.id AND p.kind='tcgplayer' AND p.market IS NOT NULL
  WHERE c.set_id='me6' ORDER BY p.market DESC LIMIT 8`).all()) console.log(JSON.stringify(r))
console.log('--- does me6-138 exist? ---', JSON.stringify(db.prepare("SELECT id,name,number,rarity FROM cards WHERE id IN ('me6-138','me6-141')").all()))
