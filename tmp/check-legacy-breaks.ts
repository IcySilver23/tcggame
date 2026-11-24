// Break rows written before 0.94.12 stored the BOX count as the pack plan.
//
//   TCGLIFE_HOME=<scratch> node ./node_modules/tsx/dist/cli.mjs tmp/check-legacy-breaks.ts
//
// `packs_per_box` is the marker that separates the two meanings (NULL = old row).
// This pins the heal for both shapes: a PENDING half display bought at box price
// must come back as 18 packs, and a LIVE stream riding an old row must have its
// queue lifted from 1 to 18 so the host is not billed 18 and handed one.
import { db } from '../server/lib/db'
import { createBreak, healLegacyBreakPlans, cancelBreak, ripBreak } from '../server/services/breaks'
import { goLive, endStream, liveStream } from '../server/services/streaming'

let fails = 0
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`)
  if (!cond) fails++
}
const breakRow = (id: number) =>
  db.prepare('SELECT packs, packs_per_box, product_cost, stream_id FROM stream_breaks WHERE id = ?').get(id) as
    | { packs: number | null; packs_per_box: number | null; product_cost: number; stream_id: number | null }
    | undefined
/** Put a row back the way 0.94.11 wrote it: box count in `packs`, no marker. */
const makeLegacy = (id: number) =>
  db.prepare('UPDATE stream_breaks SET packs = 1, packs_per_box = NULL WHERE id = ?').run(id)

const clear = () => { if (liveStream()) endStream() }
clear()
db.prepare(`UPDATE stream_breaks SET status = 'settled' WHERE status = 'selling'`).run()

// --- 1. A pending break from the old build.
const made = createBreak('swsh7-half-display', 8, null, 1)
if (!made.ok) {
  ok(false, `could not open the break: ${made.error}`)
} else {
  const id = made.breakId!
  ok(breakRow(id)?.packs === 18, 'a new half-display break queues 18 packs')
  makeLegacy(id)
  ok(breakRow(id)?.packs === 1 && breakRow(id)?.packs_per_box === null, 'the row is now shaped like a pre-0.94.12 one')
  const before = breakRow(id)!

  const heal = healLegacyBreakPlans()
  ok(heal.healed >= 1, `the boot heal found the old row (${heal.healed})`)
  ok(breakRow(id)?.packs === 18, `the pending plan is recomputed to 18 packs (got ${breakRow(id)?.packs})`)
  ok(breakRow(id)?.packs_per_box === 18, 'the row is stamped with what the box holds, so it heals once')
  ok(breakRow(id)?.product_cost === before.product_cost, 'the product cost is untouched — nobody is charged twice')

  // --- 2. A live stream riding a row written before the fix.
  const live = goLive('swsh7-half-display', 1)
  ok(live.ok === true, 'the healed break goes live')
  const streamId = liveStream()?.id ?? 0
  ok(liveStream()?.packs_planned === 18, `the queue is 18 (got ${liveStream()?.packs_planned})`)
  // Force the old shape onto the live pair: one slot, box count in `packs`.
  makeLegacy(id)
  db.prepare('UPDATE streams SET packs_planned = 1 WHERE id = ?').run(streamId)

  const healLive = healLegacyBreakPlans()
  ok(healLive.healed >= 1, `the heal found the live row (${healLive.healed})`)
  ok(breakRow(id)?.packs === 18, `the live break plan is 18 (got ${breakRow(id)?.packs})`)
  ok(liveStream()?.packs_planned === 18, `the live queue is lifted to 18 (got ${liveStream()?.packs_planned})`)

  let ripped = 0
  for (let i = 0; i < 18; i++) {
    const r = ripBreak()
    if (!r.ok) { ok(false, `rip ${i + 1} refused: ${r.error}`); break }
    ripped++
  }
  ok(ripped === 18, `all 18 packs open after the repair (got ${ripped})`)

  // --- 3. A second heal is a no-op: healed rows are not rewritten again.
  ok(healLegacyBreakPlans().healed === 0, 'healing twice rewrites nothing')
  if (made.breakId) cancelBreak(made.breakId)
}
clear()

console.log(`\nlegacy break plans: ${fails === 0 ? 'old rows are recomputed before they cost a pack' : `${fails} problem(s)`}`)
process.exit(fails === 0 ? 0 : 1)
