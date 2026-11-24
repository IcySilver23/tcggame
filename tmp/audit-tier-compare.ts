// Per-tier: what the ladder quotes vs what the table deals (hit + second slot).
import { db } from '../server/lib/db'
import { upgradeOdds } from '../server/services/packodds'
import { ensureFullCatalog } from '../server/services/sealed'

const tierKey = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim()
ensureFullCatalog()
const rows = db.prepare(`SELECT c.rarity AS rarity, p.slot AS slot, ROUND(SUM(p.weight),6) w FROM pack_product_cards p
  JOIN cards c ON c.id = p.card_id WHERE p.pack_product_id = ? AND p.slot IN ('hit','reverse2hit') GROUP BY c.rarity, p.slot`)
const sets = process.argv.slice(2).length ? process.argv.slice(2).map((s) => ({ set_id: s })) : (db.prepare('SELECT DISTINCT set_id FROM cards ORDER BY set_id').all() as { set_id: string }[])

const off = new Map<string, string[]>()
for (const { set_id } of sets) {
  const ladder = upgradeOdds(set_id)
  const byKey = new Map(Object.entries(ladder).map(([n, v]) => [tierKey(n), { name: n, odds: v }]))
  const dealt = new Map<string, { rarity: string; w: number; slot: string }>()
  for (const r of rows.all(`${set_id}-booster`) as { rarity: string | null; slot: string; w: number }[]) {
    if (!r.rarity || r.w <= 0) continue
    const k = tierKey(r.rarity)
    const prev = dealt.get(k)
    dealt.set(k, { rarity: r.rarity, w: (prev?.w ?? 0) + r.w, slot: r.slot })
  }
  const diffs: string[] = []
  for (const [k, d] of dealt) {
    const l = byKey.get(k)
    if (!l) diffs.push(`dealt ${d.rarity} ${(d.w * 100).toFixed(2)}% with no ladder row`)
    else if (Math.abs(l.odds - d.w) > 0.005) diffs.push(`${l.name}: ladder ${(l.odds * 100).toFixed(2)}% vs table ${(d.w * 100).toFixed(2)}%`)
  }
  for (const [k, l] of byKey) if (!dealt.has(k)) diffs.push(`ladder ${l.name} ${(l.odds * 100).toFixed(2)}% with no card dealt`)
  if (diffs.length) off.set(set_id, diffs)
}
for (const [set, diffs] of [...off].slice(0, 12)) console.log(`${set}: ${diffs.join(' · ')}`)
console.log(`\nsets with a per-tier difference: ${off.size} of ${sets.length}`)
const kinds = new Map<string, number>()
for (const diffs of off.values()) for (const d of diffs) kinds.set(d.split(':')[0].split(' ').slice(0, 2).join(' '), (kinds.get(d.split(':')[0].split(' ').slice(0, 2).join(' ')) ?? 0) + 1)
console.log('shapes:', [...kinds].map(([k, n]) => `${k}×${n}`).join(', '))
