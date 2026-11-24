// Every set's hit ladder against the pull table it deals from.
//
//   TCGLIFE_HOME=<home> node ./node_modules/tsx/dist/cli.mjs tmp/check-hit-ladders.ts
//
// The hit ladder is what the pack panel and the pack-contents list quote; the
// pull table is what the roller deals. They are built from two different places
// (an era profile plus per-set overrides, versus one weight per card), so they
// can drift, and twice they did: Generations quoted the whole XY ladder — Rare
// BREAK and Rare ACE SPEC included — for tiers it never printed, and Ascended
// Heroes' Mega Attack Rare was dealt at 1 in 29 packs while the panels hid it.
// Both were found by reading the two tables against each other, so this gate
// does that for every set, every release.
//
// Three rules, and why each one has to hold:
//   1. every tier the table deals out of the hit or second slot is quoted in the
//      ladder at the same rate — a rate nobody prints is a pull a player cannot
//      plan for;
//   2. every ladder row belongs to a tier the catalogue holds for that set — the
//      Generations bug, and what the ladder filter exists to guarantee;
//   3. where the set deals hit or second-slot cards at all, the ladder's total
//      is that total — no tier can quietly go missing from the sum.
//
// Subset sets are exempt from rule 3 and not from 1 or 2: their cards come out
// of the subset slot at a rate the ladder never claims to cover.
import { db } from '../server/lib/db'
import { ensureFullCatalog } from '../server/services/sealed'
import { upgradeOdds } from '../server/services/packodds'

// The roller's own comparison for rarity names, restated here so the gate does
// not depend on the module exporting it (a build without the filter should fail
// this check, not fail to load it).
const tierKey = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim()

ensureFullCatalog()

let fails = 0
let checked = 0
let dealtTiers = 0
let quotedTiers = 0
const problems: string[] = []
const bad = (msg: string) => {
  fails++
  problems.push(msg)
}

const perTier = db.prepare(`
  SELECT c.rarity AS rarity, p.slot AS slot, SUM(p.weight) AS w
  FROM pack_product_cards p JOIN cards c ON c.id = p.card_id
  WHERE p.pack_product_id = ? AND p.slot IN ('hit','reverse2hit') AND c.rarity IS NOT NULL
  GROUP BY c.rarity, p.slot`)
const subsetWeight = db.prepare(`
  SELECT COALESCE(SUM(p.weight), 0) AS w FROM pack_product_cards p
  WHERE p.pack_product_id = ? AND p.slot = 'subset'`)
const printed = db.prepare('SELECT DISTINCT rarity FROM cards WHERE set_id = ? AND rarity IS NOT NULL')
const hasTable = db.prepare('SELECT 1 AS ok FROM pack_product_cards WHERE pack_product_id = ? LIMIT 1')

const sets = db.prepare('SELECT DISTINCT set_id FROM cards ORDER BY set_id').all() as { set_id: string }[]
const seenInTable = new Set<string>()

for (const { set_id } of sets) {
  const productId = `${set_id}-booster`
  if (!hasTable.get(productId)) continue
  checked++

  const ladder = upgradeOdds(set_id)
  const byKey = new Map(Object.entries(ladder).map(([name, odds]) => [tierKey(name), { name, odds }]))
  const printedKeys = new Set((printed.all(set_id) as { rarity: string }[]).map((r) => tierKey(r.rarity)))

  // 1. Everything dealt is quoted, at the same rate.
  const dealt = new Map<string, { rarity: string; w: number; slots: Set<string> }>()
  for (const r of perTier.all(productId) as { rarity: string; slot: string; w: number }[]) {
    if (!(r.w > 0)) continue
    const k = tierKey(r.rarity)
    const prev = dealt.get(k)
    dealt.set(k, { rarity: r.rarity, w: (prev?.w ?? 0) + r.w, slots: new Set([...(prev?.slots ?? []), r.slot]) })
  }
  for (const [k, d] of dealt) {
    dealtTiers++
    const row = byKey.get(k)
    if (!row) {
      bad(`${set_id}: deals ${d.rarity} at ${(d.w * 100).toFixed(2)}% and the ladder does not quote it`)
      continue
    }
    quotedTiers++
    if (Math.abs(row.odds - d.w) > 0.005) {
      bad(`${set_id}: ${row.name} quoted ${(row.odds * 100).toFixed(2)}%, table deals ${(d.w * 100).toFixed(2)}%`)
    }
  }

  // 2. Nothing is quoted that the set cannot print.
  for (const [name, odds] of Object.entries(ladder)) {
    if (odds <= 0) continue
    if (!printedKeys.has(tierKey(name))) bad(`${set_id}: quotes ${name} ${(odds * 100).toFixed(2)}% but has no card of that tier`)
  }

  // 3. The ladder adds up to what the table deals, wherever it deals at all.
  const dealtTotal = [...dealt.values()].reduce((a, d) => a + d.w, 0)
  if (dealtTotal > 0) {
    const ladderTotal = Object.values(ladder).reduce((a, v) => a + v, 0)
    if (Math.abs(ladderTotal - dealtTotal) > 0.005) {
      bad(`${set_id}: ladder adds to ${(ladderTotal * 100).toFixed(2)}%, table deals ${(dealtTotal * 100).toFixed(2)}%`)
    }
  }
  void subsetWeight
  seenInTable.add(set_id)
}

for (const line of problems) console.log('FAIL', line)
console.log(
  `\nhit ladders: ${checked} sets with a pull table, ${dealtTiers} dealt tiers (${quotedTiers} quoted) — ` +
    `${fails === 0 ? 'every ladder adds up' : `${fails} problem(s)`}`,
)
process.exit(fails === 0 ? 0 : 1)
