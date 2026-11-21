import { db } from '../../server/lib/db'
import { valueOf, resolvePrice } from '../../server/services/market'
const rows = db.prepare("SELECT id, name, price FROM (SELECT c.id, c.name, (SELECT market FROM price_records p WHERE p.card_id=c.id AND p.kind='tcgplayer' AND p.market IS NOT NULL LIMIT 1) AS price FROM cards c WHERE c.set_id='mep')").all() as {id:string;name:string;price:number|null}[]
console.log('mep rows', rows.length, 'without a tcgplayer price', rows.filter(r=>r.price==null).length)
for (const id of ['mep-120','mep-Museum','mep-109','mep-110']) {
  const p = resolvePrice(id)
  console.log(id, 'valueOf', valueOf(id).toFixed(2), 'source', p.source, 'kind', p.kind)
}
