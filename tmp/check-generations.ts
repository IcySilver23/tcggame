// The fifteen Generations collection boxes, pinned: which products they are,
// how many packs each holds, which promo card each one hands over, which
// TCGplayer product supplies its art, what it sells for, and that all fifteen
// are actually sellable.
//
//   TCGLIFE_HOME=tmp/g1-check node ./node_modules/tsx/dist/cli.mjs tmp/check-generations.ts
//
// Generations is the set whose packs never sat on a shelf: they came inside
// eleven Mythical Pokémon Collections (2 packs, $12.99) and four Red & Blue
// Collections (4 packs, $24.99), plus the ten-pack Elite Trainer Box. The rows
// live in server/catalog/sealed-evidence.ts and are seeded into the catalogue at
// boot, so this drives the seeded table rather than the source file — a row that
// fails to seed is as broken as a row that names the wrong card.
//
// Prices: five boxes publish a TCGplayer market quote and that quote is what
// they sell for, exactly. The other ten are modelled, and a model's number is
// only as current as the save's price data — a factory-fresh save prices them
// lower than a save that has been syncing for weeks, with no code difference at
// all. So the modelled ten are held to the rules their model must obey rather
// than to one save's number: never below the retail sticker, and never below
// what their own packs deal (the floor 0.90.1 added). That is true on any save
// and still catches a row that loses its promo or its floor.
import { db } from '../server/lib/db'
import { ensureFullCatalog, priceDetail, sellsProduct } from '../server/services/sealed'
import { sealedEvidenceFor } from '../server/catalog/sealed-evidence'
import { expectedPackValue } from '../server/services/packodds'
import { buildPullTable } from '../server/services/packs'
import { applyCatalogSeed } from '../server/services/sync'

type Box = {
  id: string
  packs: number
  promo: string
  /** The TCGplayer product id behind the box art. */
  art: number
  /** A published quote, which is the price. */
  quote?: number
}

const BOXES: Box[] = [
  { id: 'g1-mythical-mew', packs: 2, promo: 'xyp-XY110', art: 113774, quote: 743.27 },
  { id: 'g1-mythical-celebi', packs: 2, promo: 'xyp-XY111', art: 114525 },
  { id: 'g1-mythical-jirachi', packs: 2, promo: 'xyp-XY112', art: 116999 },
  { id: 'g1-mythical-darkrai', packs: 2, promo: 'xyp-XY114', art: 118342 },
  { id: 'g1-mythical-manaphy', packs: 2, promo: 'xyp-XY113', art: 118796 },
  { id: 'g1-mythical-shaymin', packs: 2, promo: 'xyp-XY115', art: 120114, quote: 650 },
  { id: 'g1-mythical-arceus', packs: 2, promo: 'xyp-XY116', art: 121363, quote: 788.3 },
  { id: 'g1-mythical-victini', packs: 2, promo: 'xyp-XY117', art: 123433 },
  { id: 'g1-mythical-keldeo', packs: 2, promo: 'xyp-XY118', art: 123740 },
  { id: 'g1-mythical-genesect', packs: 2, promo: 'xyp-XY119', art: 126569 },
  { id: 'g1-mythical-meloetta', packs: 2, promo: 'xyp-XY120', art: 126568 },
  { id: 'g1-red-blue-charizard-ex', packs: 4, promo: 'xyp-XY121', art: 115598, quote: 1800.88 },
  { id: 'g1-red-blue-blastoise-ex', packs: 4, promo: 'xyp-XY122', art: 118795 },
  { id: 'g1-red-blue-venusaur-ex', packs: 4, promo: 'xyp-XY123', art: 120700 },
  { id: 'g1-red-blue-pikachu-ex', packs: 4, promo: 'xyp-XY124', art: 123432, quote: 2995.99 },
]


// A home that has never booted has an empty save beside the shipped catalogue
// seed. Take the seed first, exactly as the first boot does, so this check can be
// pointed at a factory-fresh install rather than only at a played one.
const empty = (db.prepare('SELECT COUNT(*) n FROM cards').get() as { n: number }).n === 0
if (empty) {
  const seeded = applyCatalogSeed()
  if (seeded.cards === 0) {
    console.error(`this home has no cards and no catalogue seed to grow from (${seeded.reason ?? 'seed empty'})`)
    process.exit(1)
  }
}
ensureFullCatalog()

let fails = 0
const ok = (cond: boolean, label: string) => {
  console.log(cond ? 'ok  ' : 'FAIL', label)
  if (!cond) fails++
}

const rows = db
  .prepare("SELECT id, kind, packs, msrp, market_price, image_url FROM pack_products WHERE set_id = 'g1' ORDER BY id")
  .all() as { id: string; kind: string; packs: number | null; msrp: number; market_price: number | null; image_url: string | null }[]
const byId = new Map(rows.map((r) => [r.id, r]))
const card = db.prepare('SELECT 1 FROM cards WHERE id = ?')

ok(rows.length === BOXES.length + 2, `the set has exactly ${BOXES.length} boxes, the ETB and the pull-table host (found ${rows.length})`)

// The table the boxes deal from. A home that has booted has it already; a
// factory-fresh catalogue only grows it on its first boot, so this builds it when
// it is missing — which is also the assertion that the wrapper row it hangs from
// really exists. 0.91.1 first shipped with that row missing on new installs and
// every Generations box answered "Pull table missing — sync this set first".
const tableRows = () => (db.prepare("SELECT COUNT(*) n FROM pack_product_cards WHERE pack_product_id = 'g1-booster'").get() as { n: number }).n
if (tableRows() === 0) {
  try {
    buildPullTable('g1')
  } catch (e) {
    ok(false, `the wrapper's pull table can be built (${e instanceof Error ? e.message : e})`)
  }
}
const dealt = tableRows()
ok(dealt > 0, `the wrapper's pull table is built (${dealt} cards)`)
const ev = expectedPackValue('g1')
ok(ev > 0, `Generations deals cards from a real pull table (pack EV $${ev.toFixed(2)})`)

for (const box of BOXES) {
  const row = byId.get(box.id)
  ok(!!row, `${box.id} exists`)
  if (!row) continue
  ok(row.kind === 'special', `${box.id} is a collection row (kind ${row.kind})`)
  ok(row.packs === box.packs, `${box.id} holds ${box.packs} packs (row says ${row.packs})`)
  ok(!!card.get(box.promo), `${box.id} promo ${box.promo} is in the catalogue`)
  const evidence = sealedEvidenceFor(box.id)
  ok(evidence?.promoIds?.[0] === box.promo, `${box.id} hands over ${box.promo} (evidence says ${evidence?.promoIds?.[0] ?? 'none'})`)
  ok(!!row.image_url?.includes(`/product/${box.art}_in_400x400.jpg`), `${box.id} draws TCGplayer art ${box.art} (row has ${row.image_url ?? 'none'})`)
  ok(sellsProduct(box.id, 'g1'), `${box.id} is on the shelf`)

  const price = priceDetail(box.id).market
  if (box.quote !== undefined) {
    ok(Math.abs(price - box.quote) < 0.005, `${box.id} sells at its published quote $${box.quote} (got $${price})`)
  }
  ok(price + 0.005 >= row.msrp, `${box.id} is not sold under its sticker ($${row.msrp}, asks $${price})`)
  // Whatever the model says, no box may be cheaper than the cards its packs deal.
  ok(price + 0.02 >= 0.92 * box.packs * ev, `${box.id} is floored by its packs' pull value ($${(0.92 * box.packs * ev).toFixed(2)})`)
}

const etb = byId.get('g1-etb')
ok(!!etb && etb.kind === 'etb' && etb.packs === 10, 'the Elite Trainer Box keeps its ten packs')
ok(!!etb && sellsProduct('g1-etb', 'g1'), 'the Elite Trainer Box is on the shelf')
ok(sealedEvidenceFor('g1-etb')?.promoIds?.[0] === 'xyp-XY148', 'the Elite Trainer Box still hands over Shaymin-EX (XY148)')

const host = byId.get('g1-booster')
ok(!!host, 'the loose wrapper row still exists so the boxes have a table to deal from')
ok(!!host && !sellsProduct('g1-booster', 'g1'), 'the loose wrapper is NOT sellable — no shelf ever sold Generations packs alone')


for (const r of rows) {
  if (r.id === 'g1-booster' || r.id === 'g1-etb') continue
  if (!BOXES.some((b) => b.id === r.id)) ok(false, `${r.id} is not one of the fifteen and should not be here`)
}

console.log(fails === 0 ? '\nthe fifteen Generations boxes check out' : `\n${fails} failure(s)`)
process.exit(fails === 0 ? 0 : 1)
