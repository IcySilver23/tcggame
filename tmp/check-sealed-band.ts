// Displays are wrappers: their price per pack must sit in the wrapper band.
//
//   TCGLIFE_HOME=<scratch> node ./node_modules/tsx/dist/cli.mjs tmp/check-sealed-band.ts
//
// The rule this pins: a display may discount below the packs it holds but may not
// cost more than DISPLAY_PACK_CAP x the same set's pack price, and the pull-EV
// floor still wins where the cards are worth more than the band allows. Without
// it the Evolving Skies 36-pack display priced at its real $2,190 collector quote
// while the same set's packs sell for $10, so every break and battle on that box
// staked case money for wrappers the shop sells for a tenth of it.
import { db } from '../server/lib/db'
import { ensureFullCatalog, priceOf, DISPLAY_PACK_CAP, SEALED_REALIZATION } from '../server/services/sealed'
import { expectedPackValue } from '../server/services/packodds'

ensureFullCatalog()

let fails = 0
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`)
  if (!cond) fails++
}

const rows = db
  .prepare(`SELECT id, set_id, packs FROM pack_products WHERE kind = 'display' AND packs > 1 ORDER BY id`)
  .all() as { id: string; set_id: string; packs: number }[]

let checked = 0
let capped = 0
const over: string[] = []
for (const r of rows) {
  const d = priceOf(r.id).market
  const pack = priceOf(`${r.set_id}-booster`).market
  if (!(d > 0) || !(pack > 0)) continue
  checked++
  const perPack = d / r.packs
  if (perPack > pack * DISPLAY_PACK_CAP + 0.01) over.push(`${r.id} $${perPack.toFixed(2)}/pack vs pack $${pack.toFixed(2)}`)
  if (perPack >= pack * DISPLAY_PACK_CAP - 0.01) capped++
  // The floor is never violated: a display cannot sell below what its packs pay.
  const floor = expectedPackValue(r.set_id) * r.packs * SEALED_REALIZATION
  if (floor > 0 && d + 0.01 < floor) over.push(`${r.id} $${d.toFixed(2)} is under its pack-EV floor $${floor.toFixed(2)}`)
}
ok(checked > 100, `every sellable display was priced (${checked})`)
ok(over.length === 0, over.length === 0 ? `no display is outside the wrapper band (${capped} sitting at the cap)` : `outside the band: ${over.slice(0, 5).join(' · ')}`)

// The box that started this: real $2,190, capped to the band it shares with its
// own $10 wrappers.
const swsh7 = priceOf('swsh7-display').market
const swsh7Pack = priceOf('swsh7-booster').market
ok(swsh7 > 0 && swsh7 <= swsh7Pack * 36 * DISPLAY_PACK_CAP + 0.01, `Evolving Skies display is $${swsh7.toFixed(2)} ($${(swsh7 / 36).toFixed(2)}/pack) for $${swsh7Pack.toFixed(2)} packs`)
ok(swsh7 < 1000, `its breaks stake four figures no longer ($${swsh7.toFixed(2)})`)

// The cap is one-sided: a box that discounts below its wrappers is left alone.
const cheap = rows
  .map((r) => ({ id: r.id, d: priceOf(r.id).market, p: priceOf(`${r.set_id}-booster`).market, n: r.packs }))
  .filter((r) => r.d > 0 && r.p > 0 && r.d / r.n < r.p * 0.5)
ok(cheap.length > 0, `a discounted box still exists to prove the floor is not a clamp (${cheap.length})`)
ok(cheap.every((r) => r.d / r.n < r.p * 0.5), 'discounted boxes were not raised to the band')

console.log(`\nsealed band: ${fails === 0 ? 'every display is priced off the wrappers it holds' : `${fails} problem(s)`}`)
process.exit(fails === 0 ? 0 : 1)
