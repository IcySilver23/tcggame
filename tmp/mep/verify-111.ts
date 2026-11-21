import { db } from '../../server/lib/db'
const rows = db.prepare(`SELECT c.id, c.name, c.number, c.hp, c.rarity, c.types,
  (SELECT market FROM price_records p WHERE p.card_id=c.id AND p.kind='tcgplayer' AND p.market IS NOT NULL LIMIT 1) AS market
  FROM cards c WHERE c.id BETWEEN 'mep-111' AND 'mep-114' ORDER BY c.position`).all()
for (const r of rows) console.log(JSON.stringify(r))
console.log('mep rows in db:', (db.prepare("SELECT COUNT(*) n FROM cards WHERE set_id='mep'").get() as any).n)
