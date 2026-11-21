import { db } from '../../server/lib/db'
import { valueOf } from '../../server/services/market'
type Row = { card_id: string; weight: number; slot: string; rarity: string | null; name: string }
const rows = db.prepare(`SELECT p.card_id, p.weight, p.slot, c.rarity, c.name
  FROM pack_product_cards p JOIN cards c ON c.id = p.card_id WHERE p.pack_product_id = 'me6-booster'`).all() as Row[]
const by = new Map<string, Row[]>()
for (const r of rows) by.set(r.slot, [...(by.get(r.slot) ?? []), r])
for (const [slot, list] of by) {
  const w = list.reduce((a, r) => a + r.weight, 0)
  const vals = list.map((r) => ({ n: r.name, w: r.weight, v: valueOf(r.card_id, slot === 'holo' || slot === 'hit' ? 'holofoil' : 'normal') }))
  const avg = vals.reduce((a, x) => a + x.w * x.v, 0) / (w || 1)
  vals.sort((a, b) => b.v - a.v)
  console.log(`${slot}: ${list.length} cards, weight ${w.toFixed(1)}, weighted avg $${avg.toFixed(2)}; top: ${vals.slice(0, 3).map((x) => `${x.n} $${x.v.toFixed(2)} (w${x.w})`).join(', ')}`)
}
console.log('booster price', JSON.stringify(db.prepare("SELECT market FROM price_records WHERE card_id='me6-84' AND kind='tcgplayer'").all()))
