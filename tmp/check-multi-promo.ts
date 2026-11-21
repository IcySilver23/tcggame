// Proves a box documented to hold EVERY named promo banks all of them, and that
// a one-of box still hands over exactly one.
//
// Runs on a copy of the save, because opening a box writes inventory:
//   mkdir -p tmp/promo-home/data && cp data/tcglife.db tmp/promo-home/data/
//   TCGLIFE_HOME=$PWD/tmp/promo-home node ./node_modules/tsx/dist/cli.mjs tmp/check-multi-promo.ts
import { db } from '../server/lib/db'
import { openSealed } from '../server/services/packs'
import { ensureFullCatalog, priceDetail, promoValueOf } from '../server/services/sealed'
import { applyPromoCards } from '../server/catalog/promo-cards'

ensureFullCatalog()
applyPromoCards()

function seed(productId: string, cost: number) {
  db.prepare(
    `INSERT INTO sealed_inventory (product_id, cost, quantity, acquired_at) VALUES (?, ?, 1, ?)`,
  ).run(productId, cost, new Date().toISOString())
}

function promoRows(): string[] {
  return (db.prepare(`SELECT card_id FROM inventory WHERE acquired_via = 'promo' ORDER BY id`).all() as { card_id: string }[]).map(
    (r) => r.card_id,
  )
}

// [product, cost, how many promos the box physically holds, allowed card ids]
const cases: [string, number, number, string[]?][] = [
  ['me55-poster', 30, 3],
  ['me55-upc-day', 239, 2],
  ['me55-upc-night', 250, 2],
  ['me2pt5-first-partners-pin', 34, 3],
  ['sv1-single-blister', 4.49, 1], // one of two: a single grant is correct
  ['me55-tech-sticker', 15, 1], // one of two as well
  // The split regular ETBs: each art now pins its own promo.
  ['sv1-etb', 132, 1, ['svp-14']],
  ['sv1-etb-miraidon', 145, 1, ['svp-13']],
  ['me1-etb', 115, 1, ['mep-010']],
  ['me1-etb-gardevoir', 112, 1, ['mep-009']],
  ['me2-etb', 69, 1, ['mep-022']],
  ['me3-etb', 69, 1, ['mep-070']],
  ['me4-etb', 69, 1, ['mep-080']],
  ['me5-etb', 69, 1, ['mep-088']],
  // Black Bolt / White Flare: the SVP promos upstream has not published yet.
  ['zsv10pt5-etb', 55, 1, ['svp-209']],
  ['rsv10pt5-etb', 55, 1, ['svp-210']],
]

let bad = 0
for (const [id, cost, expected, allowed] of cases) {
  const before = promoRows().length
  seed(id, cost)
  let granted: string[] = []
  let returned = 0
  try {
    const res = openSealed(id)
    granted = promoRows().slice(before)
    returned = res.promos?.length ?? 0
  } catch (e) {
    console.log(`FAIL ${id}: ${(e as Error).message}`)
    bad++
    continue
  }
  const ok = granted.length === expected && returned === expected && granted.every((g) => !allowed || allowed.includes(g))
  if (!ok) bad++
  const detail = priceDetail(id)
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${pad(id, 27)} granted ${granted.length}/${expected} ` +
      `[${granted.join(', ')}] returned ${returned} · promo value $${promoValueOf(id).toFixed(2)} · shelf $${detail.market.toFixed(2)}`,
  )
}

function pad(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n)
}

console.log(bad ? `\n${bad} case(s) wrong` : '\nall promo cases correct')
process.exit(bad ? 1 : 0)
