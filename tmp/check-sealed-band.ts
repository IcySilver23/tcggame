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
import { ensureFullCatalog, priceOf, shelfFacts, DISPLAY_PACK_CAP, SEALED_REALIZATION, wrapperQuoteAgreesWithBox } from '../server/services/sealed'
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
    // No real wrapper quote: the display is its shelf quote, except where the
    // pull-EV floor lifts it — the floor is allowed to win, never to go below.
    const quote = shelfPriceFor(r.id)
    if (quote && d + 0.02 < quote.market) over.push(`${r.id} $${d.toFixed(2)} is under its quote $${quote.market} without a reference`)
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

// Researched box quotes: the collector-era boxes carry PriceCharting sold values,
// and the ones whose value disagreed with their own sales stay modelled.
const quotedDisplays = rows.filter((r) => priceOf(r.id).source !== 'estimated').length
ok(quotedDisplays >= 70, `most displays are priced off a quote (${quotedDisplays} of ${rows.length})`)
ok(priceOf('base1-display').market === 40000 && priceOf('base1-display').source === 'pricecharting', `Base Set's box is its sold value ($${priceOf('base1-display').market.toFixed(2)})`)
ok(priceOf('sm1-display').market === 1032.84, `Sun & Moon's box is its TCGplayer market ($${priceOf('sm1-display').market.toFixed(2)})`)
ok(priceOf('bw8-display').source === 'estimated', 'Plasma Storm stays modelled: its page disagrees with its own sales')
ok(priceOf('base6-display').market === 110200, `Legendary Collection is admitted on its sold median ($${priceOf('base6-display').market.toFixed(2)})`)
ok(priceOf('gym2-display').source === 'estimated', 'Gym Challenge stays modelled: its value is 1.5x its sold median')
ok(priceOf('ex12-display').source === 'estimated', 'Legend Maker stays modelled: only two completed sales')
ok(priceOf('xy9-display').source === 'estimated', 'BREAKpoint stays modelled: its value is 6.9x its sold median')
ok(priceOf('ex1-display').source === 'estimated', 'a set with no PriceCharting box page stays modelled')

// A modelled box has to be in the right order of magnitude. These are the sold
// medians of the pages whose quotes were refused: 23 boxes the model still prices,
// each against what it actually sold for.
const SOLD_MEDIAN: Record<string, number> = {
  base3: 8800, base4: 10499, gym1: 9000, gym2: 13000, neo1: 23197, neo4: 13500,
  ecard1: 50000, ex5: 8200, ex13: 18863, ex16: 13526, dp3: 6100, dp4: 4050, pl2: 5500,
  bw2: 2500, bw3: 2296, bw4: 3500, bw5: 5000, bw6: 4158, bw7: 4350, bw8: 6000, bw9: 3900,
  bw10: 3400, bw11: 4550,
}
let worstBoxFactor = 0
for (const [setId, sold] of Object.entries(SOLD_MEDIAN)) {
  const modelled = priceOf(`${setId}-display`)
  if (modelled.source !== 'estimated') continue
  const factor = Math.max(modelled.market / sold, sold / modelled.market)
  worstBoxFactor = Math.max(worstBoxFactor, factor)
  ok(factor <= 3.5, `${setId}'s modelled box is within 3.5x of its sold median ($${modelled.market.toFixed(0)} vs $${sold}, ${factor.toFixed(2)}x)`)
}
ok(worstBoxFactor <= 3.5, `every modelled box with a sold median is in the right order of magnitude (worst ${worstBoxFactor.toFixed(2)}x)`)
ok(priceOf('gym2-display').market < 32000, `Gym Challenge is no longer priced above its whole set ($${priceOf('gym2-display').market.toFixed(0)} vs a $13,000 sold median)`)
ok(priceOf('bw8-display').market > 3000, `Plasma Storm is no longer priced at a fraction of its sold median ($${priceOf('bw8-display').market.toFixed(0)} vs $6,000)`)

// The ceiling is set from the gap in the data, not from its edge: above every
// measured box (2.74x) and below the 6x a six-box case starts at. A thin outlier
// moving by a tenth of a turn must not be able to move it.
ok(DISPLAY_PACK_CAP > 2.74 && DISPLAY_PACK_CAP < 6, `the per-pack ceiling sits in the empty stretch (${DISPLAY_PACK_CAP}x)`)

// A half box cannot out-price the full box it is half of.
const sv9Half = priceOf('sv9-half-display').market
const sv9Full = priceOf('sv9-display').market
ok(sv9Half <= sv9Full + 0.01, `a half box is not dearer than its full box ($${sv9Half.toFixed(2)} vs $${sv9Full.toFixed(2)})`)
const swsh7Half = priceOf('swsh7-half-display').market
const swsh7Full = priceOf('swsh7-display').market
ok(swsh7Half <= swsh7Full + 0.01, `and a cheaper half is left alone ($${swsh7Half.toFixed(2)} vs $${swsh7Full.toFixed(2)})`)

// The badge and the price agree: a refused quote is not cited as this row's source.
const bw8Facts = shelfFacts('bw8-booster')
ok(bw8Facts.source === 'estimated' && priceOf('bw8-booster').source === 'estimated', `a refused quote is not the badge either (${bw8Facts.source})`)
const swsh7Facts = shelfFacts('swsh7-booster')
ok(swsh7Facts.source === priceOf('swsh7-booster').source, `an accepted quote badges as its own source (${swsh7Facts.source})`)

// A quote that cannot be a wrapper is refused before it prices anything.
// Black & White's $187.99 pack is accepted now: it was refused as "box-sized"
// against a $656 box that the twice-charged scarcity model had made 5x too cheap,
// and TCGplayer's own pack listing (98553) carries that market beside a $3,569 box.
ok(wrapperQuoteAgreesWithBox('bw1', 187.99), 'accepts the $187.99 Black & White wrapper now that its box is $3,569')
ok(!wrapperQuoteAgreesWithBox('bw8', 651.13), 'refuses the $651.13 Plasma Storm wrapper, 3.3x its box per pack')
ok(wrapperQuoteAgreesWithBox('swsh7', 44.12), 'accepts the $44.12 Evolving Skies wrapper beside a $2,190 box')
ok(wrapperQuoteAgreesWithBox('sv8', 9.03), 'accepts the $9.03 Surging Sparks wrapper beside a $303 box')
ok(wrapperQuoteAgreesWithBox('xy4', 229.72), 'accepts the $229.72 Phantom Forces wrapper beside its $16,763 box')
const bw1 = priceOf('bw1-booster')
ok(bw1.source === 'tcgplayer' && Math.round(bw1.market) === 188, `the Black & White wrapper is priced at its marketplace quote ($${bw1.market.toFixed(2)} ${bw1.source})`)
const bw8 = priceOf('bw8-booster')
ok(bw8.source === 'estimated', `the refused Plasma Storm wrapper falls back to its model ($${bw8.market.toFixed(2)} ${bw8.source})`)
// In-print wrappers are retail stickers, not resale quotes, and are not screened.
const me55 = priceOf('me55-booster')
ok(me55.source === 'tcgplayer', `an in-print wrapper keeps its shelf sticker ($${me55.market.toFixed(2)} ${me55.source})`)

console.log(`\nsealed band: ${fails === 0 ? 'every display is priced against a real wrapper' : `${fails} problem(s)`}`)
process.exit(fails === 0 ? 0 : 1)
