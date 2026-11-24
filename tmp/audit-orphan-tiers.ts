// Tiers dealt out of the hit (and second-slot) pool that the ladder never quotes.
import { db } from '../server/lib/db'
import { upgradeOdds } from '../server/services/packodds'
import { tierOddsSource } from '../server/services/packs'
import { ensureFullCatalog } from '../server/services/sealed'

const tierKey = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim()
ensureFullCatalog()
const sets = db.prepare('SELECT DISTINCT set_id FROM cards ORDER BY set_id').all() as { set_id: string }[]
const rows = db.prepare(`SELECT c.rarity AS rarity, p.slot AS slot, ROUND(SUM(p.weight),6) w FROM pack_product_cards p
  JOIN cards c ON c.id = p.card_id WHERE p.pack_product_id = ? AND p.slot IN ('hit','reverse2hit') GROUP BY c.rarity, p.slot`)

let orphans = 0
for (const { set_id } of sets) {
  const ladder = upgradeOdds(set_id)
  const keys = new Set(Object.keys(ladder).map(tierKey))
  for (const r of rows.all(`${set_id}-booster`) as { rarity: string | null; slot: string; w: number }[]) {
    if (!r.rarity || r.w <= 0 || keys.has(tierKey(r.rarity))) continue
    orphans++
    const src = tierOddsSource(set_id, r.rarity)
    console.log(`${set_id.padEnd(10)} ${r.slot.padEnd(11)} '${r.rarity}' deals ${(r.w * 100).toFixed(2)}% · tierOddsSource ${(src.odds * 100).toFixed(2)}% (${src.kind})`)
  }
}
console.log(`\norphan hit-slot tiers: ${orphans}`)
