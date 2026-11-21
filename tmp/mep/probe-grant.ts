// One-off: prove the special-product boxes hand over their sourced promo.
//
// Runs against a copy of the save (see the command in the task transcript), opens
// one box per product and reads back what landed in the binder. The Knock Out
// Eevee is the numbered 30th Celebration set card 116; the binder names no card,
// so it must grant nothing.
//
// Run: TCGLIFE_HOME="$PWD/tmp/mep-home" node node_modules/tsx/dist/cli.mjs tmp/mep/probe-grant.ts

import { db } from '../../server/lib/db'
import { beginBox, openSealed } from '../../server/services/packs'

type Opened = { promo?: { cardId: string; name: string; value: number } | null }

const stock = db.prepare(
  `INSERT INTO sealed_inventory (product_id, quantity, cost, acquired_at) VALUES (?, 1, ?, datetime('now'))`,
)

const cases: { id: string; expected: string[] }[] = [
  { id: 'me55-poster', expected: ['mep-097', 'mep-098', 'mep-096'] },
  { id: 'me55-tech-sticker', expected: ['mep-094', 'mep-095'] },
  { id: 'me55-sylveon-ex-box', expected: ['mep-100'] },
  { id: 'me55-greninja-ex-box', expected: ['mep-099'] },
  { id: 'me55-upc-day', expected: ['mep-107', 'mep-108'] },
  { id: 'me55-upc-night', expected: ['mep-109', 'mep-110'] },
  { id: 'me55-etb', expected: ['mep-101'] },
  { id: 'me2pt5-premium-poster', expected: ['mep-033', 'mep-032'] },
  { id: 'me2pt5-mega-meganium-box', expected: ['mep-034'] },
  { id: 'me2pt5-first-partners-pin', expected: ['me2pt5-8', 'me2pt5-29', 'me2pt5-41'] },
  { id: 'me2pt5-tech-sticker', expected: ['me2pt5-20', 'me2pt5-123'] },
  { id: 'me55-knockout', expected: ['me55-116'] },
  { id: 'me55-2pack-blister', expected: ['me55-116'] },
  { id: 'sv8pt5-2pack-blister', expected: ['sv8pt5-74'] },
  { id: 'me2pt5-2pack-blister', expected: ['me2pt5-7', 'me2pt5-175'] },
  { id: 'sv1-single-blister', expected: ['svp-9', 'svp-10'] },
  { id: 'sv1-triple-blister', expected: ['svp-11', 'svp-12'] },
  { id: 'sv2-single-blister', expected: ['svp-23', 'svp-24'] },
  { id: 'sv2-triple-blister', expected: ['svp-25', 'svp-26'] },
  { id: 'sv3-single-blister', expected: ['svp-40', 'svp-41'] },
  { id: 'sv3-triple-blister', expected: ['svp-42', 'svp-43'] },
  { id: 'sv4-single-blister', expected: ['svp-61', 'svp-62'] },
  { id: 'sv4-triple-blister', expected: ['svp-63', 'svp-64'] },
  { id: 'sv5-single-blister', expected: ['svp-93', 'svp-94'] },
  { id: 'sv5-triple-blister', expected: ['svp-95', 'svp-96'] },
  { id: 'sv6-single-blister', expected: ['svp-119', 'svp-120'] },
  { id: 'sv6-triple-blister', expected: ['svp-121', 'svp-122'] },
  { id: 'sv7-single-blister', expected: ['svp-137', 'svp-138'] },
  { id: 'sv7-triple-blister', expected: ['svp-139', 'svp-140'] },
  { id: 'sv8-single-blister', expected: ['svp-155', 'svp-158'] },
  { id: 'sv8-triple-blister', expected: ['svp-156', 'svp-157'] },
  { id: 'sv10-single-blister', expected: ['svp-199', 'svp-200'] },
  { id: 'sv10-triple-blister', expected: ['svp-201', 'svp-202'] },
  { id: 'me1-single-blister', expected: ['mep-005', 'mep-006'] },
  { id: 'me1-triple-blister', expected: ['mep-007', 'mep-008'] },
  { id: 'me2-single-blister', expected: ['mep-018', 'mep-019'] },
  { id: 'me2-triple-blister', expected: ['mep-020', 'mep-021'] },
  { id: 'me4-single-blister', expected: ['mep-078'] },
  { id: 'me4-triple-blister', expected: ['mep-079'] },
  // Delta Reign's blister promos are set printings: Bulbapedia redirects MEP 115
  // to Spritzee (Perfect Order 35) and MEP 116 to Seel (Perfect Order 18).
  { id: 'me6-etb', expected: ['me6-26'] },
  { id: 'me6-single-blister', expected: ['me3-35'] },
  { id: 'me6-triple-blister', expected: ['me3-18'] },
  // Names no card at all, so it must grant nothing.
  { id: 'me55-binder', expected: [] },
]

console.log('db:', db.name, 'fk:', JSON.stringify(db.pragma('foreign_keys')))
let failures = 0
for (const c of cases) {
  const row = db.prepare('SELECT id, kind FROM pack_products WHERE id = ?').get(c.id)
  console.log('case', c.id, 'product row:', JSON.stringify(row))
  stock.run(c.id, 10)
  const opened = beginBox(c.id) as Opened
  const promo = opened.promo ?? null
  const granted = promo ? promo.cardId : null
  const ok = c.expected.length === 0 ? granted === null : granted !== null && c.expected.includes(granted)
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.id}: ${promo ? `${promo.name} (${promo.cardId}) $${promo.value}` : 'no promo'}`)
}

// The Inventory screen's "OPEN BOX" button rips the box whole; it must bank the
// same promo the pack-by-pack ceremony does.
stock.run('me55-upc-day', 10)
const bulk = openSealed('me55-upc-day') as Opened
const bulkOk = bulk.promo ? ['mep-107', 'mep-108'].includes(bulk.promo.cardId) : false
if (!bulkOk) failures++
console.log(`${bulkOk ? 'ok  ' : 'FAIL'} openSealed me55-upc-day: ${bulk.promo ? `${bulk.promo.name} (${bulk.promo.cardId})` : 'no promo'}`)

const promos = db.prepare("SELECT card_id, COUNT(*) AS n FROM inventory WHERE acquired_via = 'promo' GROUP BY card_id").all()
console.log(`binder promo rows: ${promos.length}`)
console.log(failures === 0 ? 'ALL OK' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
