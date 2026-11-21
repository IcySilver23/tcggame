// One-off: extend the MEP import to the four Build & Battle Box promos that
// TCGdex does not list (MEP 111-114).
//
// fetch.mjs reads TCGdex, which stops at MEP 110 and then carries 120 and the
// Museum promo. The Build & Battle promos Delta Reign shipped are absent from it
// and from pokemontcg.io (which has no MEP set at all), but TCGplayer lists them
// — and tcgcsv.com is this repo's free daily mirror of TCGplayer products and
// prices, already used by the price backfill. So identity (number, card type, HP,
// rarity) and the USD market price both come from one product row there.
//
// MEP 115-118 deliberately get NO rows. Bulbapedia's promo pages for them
// redirect to the set printings they reprint:
//   115 -> Spritzee (Perfect Order 35)
//   116 -> Seel (Perfect Order 18)
//   117 -> Kyogre (Delta Reign 26)
//   118 -> Mega Rayquaza ex (Delta Reign 84)
// so there is no separate card identity to import; the products that carry them
// hand over those set cards, exactly as the 30th Celebration Knock Out Eevee is
// the numbered set card rather than a Black Star Promo.
//
// Run before merge.mjs:
//   node tmp/mep/fetch.mjs && node tmp/mep/fetch-extra.mjs && node tmp/mep/merge.mjs

import { readFileSync, writeFileSync } from 'node:fs'

const GROUP = 24451 // tcgcsv: "ME: Mega Evolution Promo"
const BASE = `https://tcgcsv.com/tcgplayer/3/${GROUP}`
const WANT = [111, 112, 113, 114]
const OUT = 'tmp/mep/cards.json'

const res = await fetch(`${BASE}/products`, { headers: { 'user-agent': 'tcg-life catalog import' } })
if (!res.ok) throw new Error(`products HTTP ${res.status}`)
const { results: products } = await res.json()
const priceRes = await fetch(`${BASE}/prices`, { headers: { 'user-agent': 'tcg-life catalog import' } })
if (!priceRes.ok) throw new Error(`prices HTTP ${priceRes.status}`)
const { results: prices } = await priceRes.json()
const priceByProduct = new Map(prices.map((p) => [p.productId, p]))

const field = (p, name) => (p.extendedData ?? []).find((e) => e.name === name)?.value ?? null

const rows = []
for (const p of products) {
  const number = Number(field(p, 'Number'))
  if (!WANT.includes(number)) continue
  // A [Staff] stamped copy is a different physical card; the plain entry is the
  // promo as it shipped in the box.
  if (/\[staff\]/i.test(p.name)) continue
  const price = priceByProduct.get(p.productId)
  const market = Number(price?.marketPrice)
  const name = p.name.split(' - ')[0].trim()
  // tcgcsv names the stage as "Stage 1"/"Stage 2"/"Basic"; the catalogue's local
  // releases leave uncatalogued subtypes null rather than deriving them.
  rows.push({
    id: `mep-${String(number).padStart(3, '0')}`,
    set_id: 'mep',
    name,
    supertype: 'Pokémon',
    subtypes: null,
    number: String(number).padStart(3, '0'),
    position: number,
    rarity: field(p, 'Rarity') || 'Promo',
    types: field(p, 'Card Type') ? [field(p, 'Card Type')] : null,
    hp: field(p, 'HP') == null ? null : Number(field(p, 'HP')),
    artist: null, // the mirror does not publish an illustrator
    dex_numbers: null, // nor a Pokédex number; neither is derived from the name
    image_small: `https://images.scrydex.com/pokemon/mep-${String(number).padStart(3, '0')}/small`,
    image_large: `https://images.scrydex.com/pokemon/mep-${String(number).padStart(3, '0')}/large`,
    regulation_mark: null,
    price: Number.isFinite(market) && market > 0 ? { market, variant: price.subTypeName === 'Holofoil' ? 'holofoil' : 'normal' } : null,
  })
}

const missing = WANT.filter((n) => !rows.some((r) => r.position === n))
if (missing.length) throw new Error(`tcgcsv did not return MEP ${missing.join(', ')} — refusing to write a partial set`)

const fragment = JSON.parse(readFileSync(OUT, 'utf8'))
const mepBefore = fragment.cards.filter((c) => c.set_id === 'mep').length
const imported = new Set(rows.map((r) => r.id))
fragment.cards = fragment.cards.filter((c) => !imported.has(c.id))
fragment.cards.push(...rows)
fragment.cards.sort((a, b) => (a.set_id === 'mep') - (b.set_id === 'mep') || a.position - b.position)

const mep = fragment.cards.filter((c) => c.set_id === 'mep')
// The Museum promo has no number at all (position 9999), so the printed count
// comes from the numbered rows only.
const highest = Math.max(...mep.filter((c) => /^\d+$/.test(c.number)).map((c) => c.position))
fragment.set.total = mep.length
// MEP's published numbering runs to 120 (Celebratory Fanfare); 119 was never
// printed. The four redirected numbers are not rows, so the two counts differ.
fragment.set.printed_total = Math.max(highest, 120)
fragment.source.label = `${fragment.source.label}; MEP 111-114 from tcgcsv (TCGplayer mirror)`

writeFileSync(OUT, JSON.stringify(fragment, null, 1) + '\n')
console.log(`mep rows ${mepBefore} -> ${mep.length} (printed_total ${fragment.set.printed_total})`)
for (const r of rows) console.log(`  ${r.id} ${r.name} ${r.number} ${r.types?.join('/')} ${r.hp}HP $${r.price?.market ?? '—'}`)
