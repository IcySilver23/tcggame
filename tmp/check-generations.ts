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
// they sell for, exactly. The other ten are modelled from the retail price plus
// the promo's own catalogue value, which moves with the daily price sync, so
// they are pinned in a band — a collapse to MSRP or a tenfold spike fails, a
// few cents of market drift does not.
import { db } from '../server/lib/db'
import { ensureFullCatalog, priceDetail, sellsProduct } from '../server/services/sealed'
import { sealedEvidenceFor } from '../server/catalog/sealed-evidence'
import { expectedPackValue } from '../server/services/packodds'

type Box = {
  id: string
  packs: number
  promo: string
  /** The TCGplayer product id behind the box art. */
  art: number
  /** Modelled shelf price to hold within the band below. */
  price: number
  /** A published quote, which is the price, not a band. */
  quote?: number
}

const BOXES: Box[] = [
  { id: 'g1-mythical-mew', packs: 2, promo: 'xyp-XY110', art: 113774, price: 743.27, quote: 743.27 },
  { id: 'g1-mythical-celebi', packs: 2, promo: 'xyp-XY111', art: 114525, price: 177.41 },
  { id: 'g1-mythical-jirachi', packs: 2, promo: 'xyp-XY112', art: 116999, price: 182.15 },
  { id: 'g1-mythical-darkrai', packs: 2, promo: 'xyp-XY114', art: 118342, price: 177.41 },
  { id: 'g1-mythical-manaphy', packs: 2, promo: 'xyp-XY113', art: 118796, price: 177.41 },
  { id: 'g1-mythical-shaymin', packs: 2, promo: 'xyp-XY115', art: 120114, price: 650, quote: 650 },
  { id: 'g1-mythical-arceus', packs: 2, promo: 'xyp-XY116', art: 121363, price: 788.3, quote: 788.3 },
  { id: 'g1-mythical-victini', packs: 2, promo: 'xyp-XY117', art: 123433, price: 177.41 },
  { id: 'g1-mythical-keldeo', packs: 2, promo: 'xyp-XY118', art: 123740, price: 177.41 },
  { id: 'g1-mythical-genesect', packs: 2, promo: 'xyp-XY119', art: 126569, price: 177.41 },
  { id: 'g1-mythical-meloetta', packs: 2, promo: 'xyp-XY120', art: 126568, price: 177.41 },
  { id: 'g1-red-blue-charizard-ex', packs: 4, promo: 'xyp-XY121', art: 115598, price: 1800.88, quote: 1800.88 },
  { id: 'g1-red-blue-blastoise-ex', packs: 4, promo: 'xyp-XY122', art: 118795, price: 469.8 },
  { id: 'g1-red-blue-venusaur-ex', packs: 4, promo: 'xyp-XY123', art: 120700, price: 471.61 },
  { id: 'g1-red-blue-pikachu-ex', packs: 4, promo: 'xyp-XY124', art: 123432, price: 2995.99, quote: 2995.99 },
]

/** Modelled prices drift with the promo's market value; this is how far. */
const BAND = 0.15

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
const ev = expectedPackValue('g1')

ok(rows.length === BOXES.length + 2, `the set has exactly ${BOXES.length} boxes, the ETB and the pull-table host (found ${rows.length})`)
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
  } else {
    const drift = Math.abs(price - box.price) / box.price
    ok(drift <= BAND, `${box.id} sells near $${box.price} (got $${price}, ${(drift * 100).toFixed(1)}% off)`)
  }
  // Whatever the model says, no box may be cheaper than the cards its packs deal.
  ok(price + 0.02 >= 0.92 * box.packs * ev, `${box.id} is floored by its packs' pull value`)
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
