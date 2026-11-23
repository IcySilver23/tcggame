// The shop's quantity order and Inventory's bulk rip both loop the single-unit
// path, so the failure mode is arithmetic — a wrong count, a lost wrapper, a
// batch that reports fewer packs than it tore. This drives both for real.
//
//   TCGLIFE_HOME=tmp/academy-test npx tsx tmp/check-bulk.ts
//
// Use a scratch home: it BUYS and RIPS sealed stock (a few dollars' worth) and
// leaves the cards in the binder.
import { buySealed, openSealedMany } from '../server/services/packs'
import { sellsProduct } from '../server/services/sealed'
import { db } from '../server/lib/db'

let fails = 0
const ok = (cond: boolean, label: string) => { console.log(cond ? 'ok  ' : 'FAIL', label); if (!cond) fails++ }
const qtyOf = (id: string) =>
  (db.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM sealed_inventory WHERE product_id = ? AND escrow_loan IS NULL').get(id) as { n: number }).n

const rows = db.prepare("SELECT id, set_id FROM pack_products WHERE kind = 'booster'").all() as { id: string; set_id: string }[]
const product = rows.find((r) => sellsProduct(r.id, r.set_id))
ok(!!product, 'found a booster the shop sells')
const id = product!.id
const cashBefore = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash

const bought = buySealed(id, 4)
const cashAfter = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
ok(Math.abs((cashBefore - cashAfter) - bought.cost) < 0.011, 'one request charged for four units')
ok(qtyOf(id) >= 4, 'four units landed in the sealed stock')

const before = qtyOf(id)
ok(before === 4, `four units in the shelf before the rip (got ${before})`)
const res = openSealedMany(id, 3)
ok(res.units === 3, `three units ripped (got ${res.units})`)
ok(qtyOf(id) === before - 3, 'exactly three left the shelf')
ok(res.perPack.length === 3 && res.packsOpened === 3, 'one per-wrapper record per pack')
ok(res.perPack.every((p) => (p.cards?.length ?? 0) > 0), 'every wrapper carries its cards')
ok(res.sessionIds.length === 3, 'each pack kept its own session')
ok(Math.abs(res.totalValue - res.cards.reduce((a, c) => a + c.value, 0)) < 0.02, 'the batch total is the sum of the cards')

// Asking for more than is there rips what is there, never more: with one unit
// left the batch collapses back to the ordinary single rip.
const left = qtyOf(id)
ok(left === 1, 'one unit left after the batch')
const over = openSealedMany(id, 99)
ok(over.units === undefined, 'a batch of one collapses to a plain rip')
ok(qtyOf(id) === 0, 'the shelf agrees with that')

// An empty shelf says so instead of reporting a batch.
try {
  openSealedMany(id, 5)
  ok(false, 'ripping from an empty shelf must fail')
} catch (e) {
  ok(/No sealed product/.test(String(e)), 'an empty shelf says so')
}
console.log(fails === 0 ? 'bulk paths check out' : `${fails} failed`)
if (fails > 0) process.exitCode = 1
