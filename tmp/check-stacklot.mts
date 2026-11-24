// The stack lot, end to end: escrow, one lot at a time, the bids walking, the
// sale and the return fanning out over every copy, and a copy that is on a live
// BidBay auction refused. Runs against the dev save (TCGLIFE_HOME=tmp/ui-home).
import { db } from '../server/lib/db'
import { valueOf } from '../server/services/market'
import * as streaming from '../server/services/streaming'
import { quoteStack } from '../server/services/stacks'

let fails = 0
const check = (name: string, ok: boolean, detail?: string) => {
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const cash = () => (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
const statusOf = (ids: number[]) =>
  ids.map((id) => (db.prepare('SELECT status, quantity FROM inventory WHERE id = ?').get(id) as { status: string; quantity: number } | undefined))

function reset() {
  if (streaming.liveStream()) {
    for (let i = 0; i < 6 && streaming.liveStream(); i++) streaming.endStream()
  }
  db.prepare(`UPDATE inventory SET status = 'collection' WHERE status = 'escrowed'`).run()
  db.prepare(`UPDATE stream_lots SET status = 'passed' WHERE status = 'live'`).run()
}

reset()
const product = streaming.listStreamProducts()[0]
const opened = streaming.goLive(product.id, 1)
check('went live', opened.ok !== false, product.name)

type Row = { id: number; card_id: string; variant: string | null; condition: string | null }
const cheap = (db
  .prepare("SELECT id, card_id, variant, condition FROM inventory WHERE status='collection' AND graded_grade IS NULL AND quantity = 1 LIMIT 400")
  .all() as Row[])
  .map((r) => ({ ...r, v: valueOf(r.card_id, r.variant || 'normal', (r.condition as never) || 'NM') }))
  .filter((r) => r.v > 0 && r.v <= 2)
  .sort((a, b) => a.v - b.v)

// --- listing ---------------------------------------------------------------
const ids = cheap.slice(0, 20).map((r) => r.id)
const market = Math.round(cheap.slice(0, 20).reduce((s, r) => s + r.v, 0) * 100) / 100
const listed = streaming.listStreamStack(ids, 2.99, 2.99)
const lot = listed.ok ? listed.lot : null
check('a 20-card stack goes up as one lot', listed.ok && !!lot && lot.kind === 'stack' && lot.cards === 20, listed.ok ? `${lot?.name} · market ${lot?.market}` : (listed as { error: string }).error)
check('every copy is escrowed', statusOf(ids).every((s) => s?.status === 'escrowed'), statusOf(ids).filter((s) => s?.status === 'escrowed').length + '/20')
check('the pile is priced at its own market', !!lot && Math.abs((lot.market ?? 0) - market) < 0.05, `lot ${lot?.market} vs sum ${market}`)
check('the ceiling never reaches the client', !!listed.ok && !('ceiling' in (listed as object)) && !('ceiling' in (lot as object)), 'banded only')

const second = streaming.listStreamStack(ids.slice(0, 10), null, null)
check('one lot at a time', !second.ok, second.ok ? '' : second.error)
const stolen = streaming.listStreamStack([...ids.slice(0, 19), cheap[30].id], null, null)
check('an escrowed copy cannot join another stack', !stolen.ok, stolen.ok ? '' : stolen.error)

// --- the bids walk ---------------------------------------------------------
const streamId = (streaming.liveStream() as { id: number }).id
for (let i = 0; i < 60; i++) {
  streaming.streamLotTick()
  await sleep(220)
  const live = streaming.streamLotsFor(streamId).live
  if (live && live.bids > 0) break
}
const walked = streaming.streamLotsFor(streamId).live
check('the room opens the pile', !!walked && walked.bids > 0, walked ? `bid $${walked.currentBid} · ${walked.bids} bids` : 'no lot')

// --- the sale fans out -----------------------------------------------------
const cashBefore = cash()
db.prepare(`UPDATE stream_lots SET ends_at = ? WHERE id = ?`).run(new Date(Date.now() - 1000).toISOString(), (walked as { id: number }).id)
streaming.streamLotTick()
const settled = streaming.streamLotsFor(streamId).recent.find((l) => l.id === (walked as { id: number }).id)
const afterSale = statusOf(ids)
check('the stack hammered as sold', settled?.status === 'sold', `${settled?.status} at $${settled?.soldPrice ?? 0}`)
check('every copy left the binder', afterSale.every((s) => s?.status === 'sold' && s.quantity === 0), `${afterSale.filter((s) => s?.status === 'sold').length}/20 sold`)
check('the sale paid the host once, net of the fee', Math.abs(cash() - cashBefore - (settled?.net ?? 0)) < 0.02, `+$${(cash() - cashBefore).toFixed(2)} vs net $${settled?.net ?? 0}`)
check('a sale records every copy', (db.prepare(`SELECT COUNT(*) AS n FROM sale_history WHERE sale_type = 'stream_stack' AND inventory_id IN (${ids.join(',')})`).get() as { n: number }).n === 20, '20 rows')

// --- the return fans out ---------------------------------------------------
const ids2 = cheap.slice(40, 60).map((r) => r.id)
const high = Math.round(market * 1.3 * 100) / 100
const listed2 = streaming.listStreamStack(ids2, high, high)
const lot2 = listed2.ok ? listed2.lot : null
check('an over-priced stack still lists', listed2.ok, listed2.ok ? `opens $${lot2?.start}, reserve $${lot2?.reserve}` : (listed2 as { error: string }).error)
db.prepare(`UPDATE stream_lots SET ends_at = ? WHERE id = ?`).run(new Date(Date.now() - 1000).toISOString(), (lot2 as { id: number }).id)
streaming.streamLotTick()
const settled2 = streaming.streamLotsFor(streamId).recent.find((l) => l.id === (lot2 as { id: number }).id)
check('nobody opens an over-priced pile', settled2?.status === 'passed' && (settled2?.bids ?? 0) === 0, `${settled2?.status}, ${settled2?.bids} bids`)
check('every copy comes home', statusOf(ids2).every((s) => s?.status === 'collection' && s.quantity === 1), `${statusOf(ids2).filter((s) => s?.status === 'collection').length}/20 back`)

// --- BidBay ----------------------------------------------------------------
const auctioned = cheap[70]
db.prepare(
  `INSERT INTO ebay_auctions (inventory_id, card_id, variant, condition, quantity, start, market_at_list, listed_at, closes_at)
   VALUES (?, ?, 'normal', 'NM', 1, 1, 1, ?, ?)`,
).run(auctioned.id, auctioned.card_id, new Date().toISOString(), new Date(Date.now() + 3_600_000).toISOString())
const blocked = quoteStack([...cheap.slice(80, 99).map((r) => r.id), auctioned.id], 200)
check('a copy on a live BidBay auction is refused', !blocked.ok && /BidBay/i.test((blocked as { error: string }).error), blocked.ok ? '' : (blocked as { error: string }).error)
const blockedList = streaming.listStreamStack([...cheap.slice(80, 99).map((r) => r.id), auctioned.id], null, null)
check('the block refuses it too', !blockedList.ok && /BidBay/i.test((blockedList as { error: string }).error), blockedList.ok ? '' : (blockedList as { error: string }).error)
db.prepare(`DELETE FROM ebay_auctions WHERE inventory_id = ?`).run(auctioned.id)

// --- wrap ------------------------------------------------------------------
const ended = streaming.endStream()
check('the stream can wrap with no lot open', ended.ok !== false, ended.ok === false ? ended.error : 'ended')

console.log(fails === 0 ? '\nstack lot ok' : `\n${fails} problem(s)`)
process.exit(fails === 0 ? 0 : 1)
