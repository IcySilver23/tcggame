// Scarlet & Violet: the Illustration and Special Illustration Rares print in
// the second reverse slot, not the rare slot.
//
// Run on a copy of the save, after rebuilding its pull tables:
//   TCGLIFE_HOME=$PWD/tmp/audit-home node ./node_modules/tsx/dist/cli.mjs tmp/check-sv-slot2.ts
import { db } from '../server/lib/db'
import { rollPack, estimatePackValue } from '../server/services/packs'
import { expectedPackValue, packSlots } from '../server/services/packodds'

let pass = 0
let fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) {
    pass++
    console.log(`  ok   ${msg}`)
  } else {
    fail++
    console.log(`  FAIL ${msg}`)
  }
}

const N = 400
const sets = ['sv1', 'sv3pt5', 'sv8pt5', 'me2pt5']
for (const setId of sets) {
  const rows = db
    .prepare(`SELECT p.card_id, p.slot, p.weight, c.rarity FROM pack_product_cards p JOIN cards c ON c.id = p.card_id WHERE p.pack_product_id = ?`)
    .all(`${setId}-booster`) as { card_id: string; slot: string; weight: number; rarity: string | null }[]
  const tierOdds = (rarity: string) =>
    rows
      .filter((r) => r.slot === 'reverse2hit' && (r.rarity ?? '').toLowerCase() === rarity.toLowerCase())
      .reduce((a, r) => a + Math.max(0, r.weight), 0)
  const secondIds = new Set(rows.filter((r) => r.slot === 'reverse2hit').map((r) => r.card_id))
  const secondRarities = new Set(rows.filter((r) => r.slot === 'reverse2hit').map((r) => (r.rarity ?? '').toLowerCase()))
  const hitHasIr = rows.some((r) => r.slot === 'hit' && /illustration rare/i.test(r.rarity ?? ''))
  const secondTable = packSlots(setId, 10).find((s) => s.slot === 'reverse2')
  ok(secondIds.size > 0, `${setId}: ${secondIds.size} art rares live in the second reverse pool`)
  ok(!hitHasIr, `${setId}: no Illustration or Special Illustration Rare is left in the rare pool`)
  ok(secondRarities.size > 0, `${setId}: the second pool holds its art rares (${[...secondRarities].join(', ')})`)
  ok(!!secondTable && /Illustration Rare/.test(secondTable.detail), `${setId}: the shelf's second-parallel line names the art-card rates`)

  // The pool's own summed weights are the slot's per-pack rates: a tier the
  // catalogue does not hold for the set is not promised here either.
  const irOdds = tierOdds('Illustration Rare')
  const sirOdds = tierOdds('Special Illustration Rare')
  let irPacks = 0
  let sirPacks = 0
  let misplaced = 0
  let wrongSlot = 0
  for (let i = 0; i < N; i++) {
    const cards = rollPack(setId, `svslot2-${setId}-${i}`, 'booster', 10)
    if (!cards) throw new Error(`no pull table for ${setId}`)
    if (cards.length !== 10) wrongSlot++
    const raritiesAt = cards.map((c) => rows.find((r) => r.card_id === c.cardId)?.rarity ?? '')
    if (raritiesAt.some((r) => /illustration rare/i.test(r))) {
      if (raritiesAt[8] !== 'Illustration Rare' && raritiesAt[8] !== 'Special Illustration Rare') misplaced++
    }
    if (raritiesAt.some((r) => /special illustration rare/i.test(r))) {
      if (raritiesAt[8] !== 'Special Illustration Rare') misplaced++
    }
    if (cards.some((c, at) => secondIds.has(c.cardId) && at !== 8)) misplaced++
    if (/illustration rare/i.test(raritiesAt[9] ?? '')) misplaced++
    if (raritiesAt[8] === 'Illustration Rare') irPacks++
    if (raritiesAt[8] === 'Special Illustration Rare') sirPacks++
  }
  db.prepare(`DELETE FROM pull_history WHERE session_id LIKE ?`).run(`svslot2-${setId}-%`)

  const sigma = (p: number) => Math.sqrt((p * (1 - p)) / N)
  ok(wrongSlot === 0, `${setId}: every pack is still ten cards`)
  ok(misplaced === 0, `${setId}: every art rare sits in the second reverse slot (position 9 of 10)`)
  ok(
    Math.abs(irPacks / N - irOdds) <= 3 * sigma(irOdds) + 1e-9,
    `${setId}: Illustration Rare in ${irPacks}/${N} packs against ${(irOdds * 100).toFixed(1)}%`,
  )
  ok(
    Math.abs(sirPacks / N - sirOdds) <= 3 * sigma(sirOdds) + 1e-9,
    `${setId}: Special Illustration Rare in ${sirPacks}/${N} packs against ${(sirOdds * 100).toFixed(1)}%`,
  )
  ok(expectedPackValue(setId) === estimatePackValue(setId).avg, `${setId}: the sealed EV and the shop estimate agree ($${expectedPackValue(setId)})`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
