// A display is judged per pack against a real loose-wrapper quote.
//
//   TCGLIFE_HOME=<scratch> node ./node_modules/tsx/dist/cli.mjs tmp/check-sealed-band.ts
//
// The rule: where the same set's loose pack has a quote of its own, a display may
// discount below it freely but may not cost more than DISPLAY_PACK_CAP x that
// quote per pack; where the pack is only modelled there is no reference and the
// display keeps its quoted price. Evolving Skies is the case that proves it: its
// box is a genuine $2,190 box (1.38x a $44.12 wrapper), and the wrapper quote is
// now what the shop charges instead of the $9.60 the card model guessed.
import { db } from '../server/lib/db'
import { ensureFullCatalog, priceOf, DISPLAY_PACK_CAP, SEALED_REALIZATION } from '../server/services/sealed'
import { shelfPriceFor } from '../server/catalog/sealed-evidence'
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

const over: string[] = []
let banded = 0
let untouched = 0
for (const r of rows) {
  const d = priceOf(r.id).market
  if (!(d > 0)) continue
  const ref = priceOf(`${r.set_id}-booster`)
  if (!(ref.market > 0) || ref.source === 'estimated') {
    // No real wrapper quote: the display must still be at its shelf quote.
    const quote = shelfPriceFor(r.id)
    if (quote && Math.abs(quote.market - d) > 0.02) over.push(`${r.id} $${d.toFixed(2)} moved off its quote $${quote.market} without a reference`)
    untouched++
    continue
  }
  banded++
  const perPack = d / r.packs
  if (perPack > ref.market * DISPLAY_PACK_CAP + 0.01) over.push(`${r.id} $${perPack.toFixed(2)}/pack vs wrapper $${ref.market.toFixed(2)}`)
  const floor = expectedPackValue(r.set_id) * r.packs * SEALED_REALIZATION
  if (floor > 0 && d + 0.01 < floor) over.push(`${r.id} $${d.toFixed(2)} is under its pack-EV floor $${floor.toFixed(2)}`)
}
ok(banded > 20, `displays judged against a real wrapper quote (${banded})`)
ok(untouched > 0, `displays with only a modelled pack kept their own quote (${untouched})`)
ok(over.length === 0, over.length === 0 ? 'no display is outside the wrapper band' : `problems: ${over.slice(0, 5).join(' · ')}`)

// The box that started this: a real $2,190 box against a real $44 wrapper.
const box = priceOf('swsh7-display').market
const pack = priceOf('swsh7-booster')
ok(box > 2000, `Evolving Skies display keeps its marketplace price ($${box.toFixed(2)})`)
ok(pack.market > 40 && pack.source !== 'estimated', `its wrapper is quoted, not modelled ($${pack.market.toFixed(2)} ${pack.source})`)
ok(box / 36 <= pack.market * DISPLAY_PACK_CAP + 0.01, `box sits inside the band (${(box / 36 / pack.market).toFixed(2)}x the wrapper)`)

// The catch this exists for: a case quote is six boxes in one price.
const casePerPack = 15489.99 / 36
ok(casePerPack > pack.market * DISPLAY_PACK_CAP, `a six-box case quote would be trimmed (${(casePerPack / pack.market).toFixed(1)}x the wrapper)`)

// A discounted box is never pushed up to the band.
const cheap = rows
  .map((r) => ({ id: r.id, d: priceOf(r.id).market, p: priceOf(`${r.set_id}-booster`) }))
  .filter((r) => r.d > 0 && r.p.market > 0 && r.p.source !== 'estimated')
  .filter((r) => r.d / 36 < r.p.market * 0.5)
ok(cheap.length > 0, `a discounted box still exists and was not raised (${cheap.length})`)

console.log(`\nsealed band: ${fails === 0 ? 'every display is priced against a real wrapper' : `${fails} problem(s)`}`)
process.exit(fails === 0 ? 0 : 1)
