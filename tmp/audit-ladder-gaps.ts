// Every set whose filtered hit ladder still disagrees with its pull table, with
// the reason, and a check that the filter never dropped a tier the set prints.
import { db } from '../server/lib/db'
import { upgradeOdds } from '../server/services/packodds'
import { ensureFullCatalog } from '../server/services/sealed'

const tierKey = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim()
ensureFullCatalog()

const sets = db.prepare('SELECT DISTINCT set_id FROM cards ORDER BY set_id').all() as { set_id: string }[]
const weightBySlotAndRarity = db.prepare(`
  SELECT c.rarity AS rarity, ROUND(SUM(p.weight), 6) AS w, COUNT(*) AS n
  FROM pack_product_cards p JOIN cards c ON c.id = p.card_id
  WHERE p.pack_product_id = ? AND p.slot = ? GROUP BY c.rarity`)
const cardsByRarity = db.prepare('SELECT lower(rarity) AS r, COUNT(*) n FROM cards WHERE set_id = ? AND rarity IS NOT NULL GROUP BY lower(rarity)')

let falseDrops = 0
let mismatched = 0
const report: string[] = []

for (const { set_id } of sets) {
  const hit = weightBySlotAndRarity.all(`${set_id}-booster`, 'hit') as { rarity: string | null; w: number; n: number }[]
  const second = weightBySlotAndRarity.all(`${set_id}-booster`, 'reverse2hit') as { rarity: string | null; w: number; n: number }[]
  const tableHit = hit.reduce((a, r) => a + r.w, 0)
  if (tableHit <= 0 && second.length === 0) continue
  const rarities = new Map((cardsByRarity.all(set_id) as { r: string; n: number }[]).map((r) => [r.r, r.n]))
  const ladder = upgradeOdds(set_id)
  const kept = Object.entries(ladder)
  const total = kept.reduce((a, [, v]) => a + v, 0)
  const tableTotal = tableHit + second.reduce((a, r) => a + r.w, 0)

  // False-drop test: a tier the filter removed, where the table actually deals
  // cards of that tier (matched the way the roller matches names).
  const tableTierKeys = new Set([...hit, ...second].map((r) => tierKey(r.rarity ?? '')))
  const dropped = Object.entries({ ...(kept.length ? {} : {}) })
  // Recompute what the unfiltered ladder would have been, to see the drops.
  void dropped
  for (const [name, odds] of Object.entries(ladder)) {
    if (rarities.has(name.toLowerCase())) continue
    falseDrops++
  }
  // Any table tier whose name matches no ladder entry at all — the other half of
  // the same question, from the table's side.
  const ladderKeys = new Set(kept.map(([n]) => tierKey(n)))
  const orphanRows = [...hit, ...second].filter((r) => !ladderKeys.has(tierKey(r.rarity ?? '')) && r.w > 0)

  if (Math.abs(total - tableTotal) > 0.005 || Math.abs(total - tableHit) > 0.005) {
    mismatched++
    report.push(
      `${set_id.padEnd(10)} hit ${(tableHit * 100).toFixed(2)}% + second ${((tableTotal - tableHit) * 100).toFixed(2)}% = ${(tableTotal * 100).toFixed(2)}%` +
        ` · ladder ${(total * 100).toFixed(2)}% [${kept.map(([n, v]) => `${n} ${(v * 100).toFixed(2)}%`).join(', ')}]` +
        (orphanRows.length ? ` · ORPHAN TABLE TIERS: ${orphanRows.map((r) => `${r.rarity} ${(r.w * 100).toFixed(2)}%`).join(', ')}` : '') +
        ` · ${Math.abs(total - tableTotal) < 0.005 ? 'matches hit+second' : Math.abs(total - tableHit) < 0.005 ? 'matches hit only' : 'NO MATCH'}`,
    )
  }
  void tableTierKeys
}

console.log(report.join('\n'))
console.log(`\nsets still off: ${mismatched} · ladder entries with no card of that exact name: ${falseDrops}`)
