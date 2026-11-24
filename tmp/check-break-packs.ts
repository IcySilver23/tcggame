// A break buys BOXES and rips the packs inside them.
//
//   TCGLIFE_HOME=<scratch> node ./node_modules/tsx/dist/cli.mjs tmp/check-break-packs.ts
//
// The regression this pins: the panel's number was stored as the pack count, so
// a host who bought an 18-pack half display ripped one pack and the live header
// read "0 of 1 pack left" over a product named "(18 packs)" — seventeen packs
// paid for and never opened.
import { db } from '../server/lib/db'
import { createBreak, ripBreak, cancelBreak } from '../server/services/breaks'
import { goLive, endStream, liveStream } from '../server/services/streaming'
import { listBattlableProducts } from '../server/services/packbattles'

let fails = 0
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`)
  if (!cond) fails++
}
const cash = () => (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
const clear = () => { if (liveStream()) endStream() }
const unitOf = (id: string) => {
  const p = listBattlableProducts().find((x) => x.id === id)
  return p ? p.market_price ?? p.msrp : 0
}

clear()

// 1. One 18-pack half display: one box bought, eighteen packs to rip.
const before = cash()
const half = createBreak('swsh7-half-display', 8, null, 1)
if (!half.ok) {
  ok(false, `half display break refused: ${half.error}`)
} else {
  ok(half.packs === 18, `half display queues 18 packs (got ${half.packs})`)
  ok(half.boxes === 1, `half display buys 1 box (got ${half.boxes})`)
  ok(Math.abs(before - cash() - unitOf('swsh7-half-display')) < 0.02, `the display price is charged once (${(before - cash()).toFixed(2)})`)
  ok(Math.abs(half.productCost - unitOf('swsh7-half-display')) < 0.02, `product cost is the box, not a pack (${half.productCost.toFixed(2)})`)
  ok(Math.abs((half.evenSplit ?? 0) - unitOf('swsh7-half-display') / half.spotsTotal) < 0.02, `the even split is measured on the box ($${(half.evenSplit ?? 0).toFixed(2)})`)

  const live = goLive('swsh7-half-display', 1)
  ok(live.ok === true, 'the break goes live')
  const st = liveStream()
  ok(st?.packs_planned === 18, `the stream queues 18 rip slots (got ${st?.packs_planned})`)

  let ripped = 0
  for (let i = 0; i < 18; i++) {
    const r = ripBreak()
    if (!r.ok) { ok(false, `rip ${i + 1} refused: ${r.error}`); break }
    ripped++
  }
  ok(ripped === 18, `all 18 packs open (got ${ripped})`)
  const extra = ripBreak()
  ok(extra.ok === false, 'a nineteenth rip is refused — the box is empty')
}
clear()

// 2. Two booster packs stay two packs.
const booster = createBreak('swsh7-booster', 8, null, 2)
if (!booster.ok) ok(false, `booster break refused: ${booster.error}`)
else {
  ok(booster.packs === 2, `two booster packs queue two rips (got ${booster.packs})`)
  ok(Math.abs(booster.productCost - 2 * unitOf('swsh7-booster')) < 0.02, `two packs cost two pack prices (${booster.productCost.toFixed(2)})`)
  if (booster.breakId) cancelBreak(booster.breakId)
}

// 3. One ETB is its nine packs.
const etb = createBreak('swsh7-etb', 8, null, 1)
if (!etb.ok) ok(false, `ETB break refused: ${etb.error}`)
else {
  ok(etb.packs === 8, `an ETB queues its 8 packs (got ${etb.packs})`)
  if (etb.breakId) cancelBreak(etb.breakId)
}

// 4. A 36-pack display is not clipped to the old 20 cap.
const display = createBreak('swsh7-display', 12, null, 1)
if (!display.ok) ok(false, `display break refused: ${display.error}`)
else {
  ok(display.packs === 36, `a 36-pack display queues 36 rips (got ${display.packs})`)
  const live = goLive('swsh7-display', 1)
  ok(live.ok === true, 'the display break goes live')
  ok(liveStream()?.packs_planned === 36, `the stream keeps all 36 slots (got ${liveStream()?.packs_planned})`)
}
clear()

console.log(`\nbreak pack plans: ${fails === 0 ? 'every box queues the packs it holds' : `${fails} problem(s)`}`)
process.exit(fails === 0 ? 0 : 1)
