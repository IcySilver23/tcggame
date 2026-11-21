import { db } from '../../server/lib/db'
const q = db.prepare(`SELECT c.id, c.name, c.number, c.set_id, s.name AS set_name,
  (SELECT market FROM price_records p WHERE p.card_id=c.id AND p.kind='tcgplayer' AND p.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) AS market
  FROM cards c JOIN sets s ON s.id=c.set_id WHERE c.id IN ('me3-35','me3-18','me6-26','me6-84','me3-1')`)
for (const r of q.all()) console.log(JSON.stringify(r))
