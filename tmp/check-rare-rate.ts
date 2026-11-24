// The rare slot is priced at its era's holo rate, not as one flat pool.
//
//   TCGLIFE_HOME=<scratch> node ./node_modules/tsx/dist/cli.mjs tmp/check-rare-rate.ts
//
// A pre-2011 pack holds one rare, and 1 in 3 of them is the holo printing
// (pokegym's box study, carried in ERA_PROFILES). The pull table stores that
// split as weights, but a normalised average would throw it away, so the slot is
// priced by `rareSlotValue` from the profile. This check recomputes the figure
// from the database independently and fails if the rate stops being applied —
// then it re-checks the modelled boxes against their sold medians, because a
// richer pack EV is what would push them up.
import { db } from '../server/lib/db'
import { ensureFullCatalog, priceOf } from '../server/services/sealed'
import { expectedPackValue, planFor, profileFor, rareSlotValue, weightedAvg } from '../server/services/packodds'
import { isFoilRare, rareVariantFor } from '../server/services/finish-odds'
import { valueOf } from '../server/services/market'

ensureFullCatalog()

let fails = 0
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`)
  if (!cond) fails++
}

const pre2011 = (db.prepare(`SELECT id, name FROM sets WHERE release_date < '2011-01-01' ORDER BY release_date`).all() as { id: string; name: string }[])

let checked = 0
let flatHigher = 0
let worstEvGap = 0
for (const s of pre2011) {
  const rows = db
    .prepare(
      `SELECT p.card_id, p.weight, c.rarity FROM pack_product_cards p JOIN cards c ON c.id = p.card_id
       WHERE p.pack_product_id = ? AND p.slot = 'holo'`,
    )
    .all(`${s.id}-booster`) as { card_id: string; weight: number; rarity: string | null }[]
  if (rows.length === 0) continue
  const priced = rows.map((r) => ({
    weight: r.weight,
    v: valueOf(r.card_id, rareVariantFor(s.id, r.rarity)),
    holo: isFoilRare(s.id, r.rarity),
  }))
  const holos = priced.filter((r) => r.holo)
  const plains = priced.filter((r) => !r.holo)
  const rate = profileFor(s.id).rare.holo
  const flat = priced.reduce((a, r) => a + r.v, 0) / priced.length
  const model = rareSlotValue(s.id, priced)

  // 1. The slot is the rate model, recomputed here without the helper.
  const expectedModel =
    holos.length === 0 ? weightedAvg(plains) : plains.length === 0 ? weightedAvg(holos) : rate * weightedAvg(holos) + (1 - rate) * weightedAvg(plains)
  ok(Math.abs(model - expectedModel) < 0.005, `${s.id}: the rare slot is ${rate} x holo + ${(1 - rate).toFixed(2)} x plain ($${model.toFixed(2)})`)

  // 2. Where a set prints both kinds, the rate has to make a difference: a flat
  //    pool would price the rare slot higher, which is the bug this pins.
  if (holos.length > 0 && plains.length > 0) {
    checked++
    if (flat > model) flatHigher++
    if (holos.length > 0 && plains.length > 0 && Math.abs(flat - model) / model > worstEvGap) worstEvGap = Math.abs(flat - model) / model
  }

  // 3. The pack EV's rare component is that figure (the rest is commons,
  //    uncommons, energy, reverse and any hit tier on top).
  const plan = planFor(s.id, 10)
  const hitRows = db.prepare(`SELECT SUM(weight) w FROM pack_product_cards WHERE pack_product_id = ? AND slot = 'hit'`).get(`${s.id}-booster`) as { w: number | null }
  const chance = Math.min(0.85, hitRows.w ?? 0)
  const otherSlots = plan.filter((p) => p.slot !== 'hit').reduce((a, p) => a + p.count, 0)
  const ev = expectedPackValue(s.id)
  ok(ev > model, `${s.id}: the pack EV ($${ev.toFixed(2)}) is above the rare slot alone ($${model.toFixed(2)})`)
  if (otherSlots === 0 && chance === 0) ok(Math.abs(ev - model) < 0.005, `${s.id}: a rare-only pack prices at the rare slot`)
}

ok(checked >= 30, `the rate is measured on ${checked} pre-2011 sets that print both rare kinds`)
// Four sets print holo rares cheaper than plain ones (Gym Challenge's commons of
// the rare tier, Neo's trainers), so a flat pool is not always higher — the claim
// is that the rate MOVES the slot, not that it always raises it.
ok(flatHigher >= Math.floor(checked * 0.85), `a flat pool prices ${flatHigher} of them higher, the rest lower`, )
ok(worstEvGap > 0.15, `and by a visible margin: up to ${(worstEvGap * 100).toFixed(0)}% above the rate model`)

// The era figure itself: Wizards and EX are the counted 1 in 3.
for (const id of ['wotc', 'ex'] as const) {
  ok(Math.abs(profileFor(`${id === 'wotc' ? 'base1' : 'ex5'}`).rare.holo - 1 / 3) < 0.01, `${id}'s profile carries the counted 1-in-3 holo rate`)
}

// The boxes the rate feeds must still land within the tolerance the release set.
const SOLD: [string, number][] = [
  ['base3', 8800], ['base4', 10499], ['gym1', 9000], ['gym2', 13000], ['neo1', 23197], ['neo4', 13500],
  ['ecard1', 50000], ['ex5', 8200], ['ex13', 18863], ['ex16', 13526], ['dp3', 6100], ['dp4', 4050],
  ['pl2', 5500], ['bw2', 2500], ['bw8', 6000], ['bw11', 4550],
]
let worst = 0
for (const [setId, sold] of SOLD) {
  const p = priceOf(`${setId}-display`)
  if (p.source !== 'estimated') continue
  worst = Math.max(worst, p.market / sold, sold / p.market)
}
ok(worst <= 3.5, `every modelled box is still within 3.5x of its sold median (worst ${worst.toFixed(2)}x)`)

console.log(`\nrare rate: ${fails === 0 ? 'the holo rate is the rare slot' : `${fails} problem(s)`}`)
process.exit(fails === 0 ? 0 : 1)
