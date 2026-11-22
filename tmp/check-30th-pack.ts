// Proof that a 30th Celebration pack is the six-card wrapper the product copy
// describes (five foil cards plus a foil Basic Energy), not the ten-card pack
// the game used to deal — and that its shelf price is unaffected by the change.
//
// Runs against a COPY of the save: ensureFullCatalog corrects cards_per_pack in
// place, and rollPack may record pulls, so data/tcglife.db is never touched.
import fs from 'node:fs'
import path from 'node:path'

const HOME = path.resolve('tmp/me55-home')
fs.rmSync(HOME, { recursive: true, force: true })
// The save lives under <home>/data, not at the home root (db.ts joins 'data').
fs.mkdirSync(path.join(HOME, 'data'), { recursive: true })
fs.copyFileSync(path.resolve('data/tcglife.db'), path.join(HOME, 'data', 'tcglife.db'))
process.env.TCGLIFE_HOME = HOME

const { db } = await import('../server/lib/db')
const odds = await import('../server/services/packodds')
const packs = await import('../server/services/packs')
const sealed = await import('../server/services/sealed')
const localcatalog = await import('../server/services/localcatalog')

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? ` (${detail})` : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`) }
}

console.log('1. the plan is the wrapper\'s six cards')
const plan = odds.planFor('me55')
const total = plan.reduce((a, s) => a + s.count, 0)
check('a 30C pack deals six cards', total === 6, `plan ${JSON.stringify(plan)}`)
check('the body is four commons', plan.find((s) => s.slot === 'common')?.count === 4)
check('one rare-or-hit card', plan.find((s) => s.slot === 'hit')?.count === 1)
check('one guaranteed Pikachu', plan.find((s) => s.slot === 'subset')?.count === 1)
check('no reverse slot (a 30C pack has none)', !plan.some((s) => s.slot.startsWith('reverse')))

console.log('\n2. the shelf prints the same six')
const slots = odds.packSlots('me55', 6)
check('the slot label totals six cards', slots.reduce((a, s) => a + s.count, 0) === 6, slots.map((s) => `${s.count}×${s.label}`).join(', '))

console.log('\n3. every 30th product advertises six cards per pack')
// The boot order: local releases (the Wave 4 specials) then the generic line.
localcatalog.applyLocalReleases()
sealed.ensureFullCatalog()
const rows = db.prepare("SELECT id, cards_per_pack FROM pack_products WHERE set_id = 'me55' ORDER BY id").all() as { id: string; cards_per_pack: number }[]
check('the 17-row line is seeded', rows.length >= 16, `${rows.length} rows`)
check('every row says six', rows.every((r) => r.cards_per_pack === 6), rows.filter((r) => r.cards_per_pack !== 6).map((r) => `${r.id}=${r.cards_per_pack}`).join(',') || 'all 6')

console.log('\n4. rolled packs really hold six cards')
const dealt = [1, 2, 3, 4, 5].map((i) => packs.rollPack('me55', `check-30th-${i}`, 'booster', 6) as unknown[] | null)
check('five packs rolled', dealt.every((d) => Array.isArray(d)), dealt.map((d) => d?.length).join(','))
check('each holds six cards', dealt.every((d) => d?.length === 6))
const subsetIds = new Set(
  (db.prepare("SELECT card_id FROM pack_product_cards WHERE pack_product_id = 'me55-booster' AND slot = 'subset'").all() as { card_id: string }[]).map((r) => r.card_id),
)
const withPikachu = dealt.filter((d) => d?.some((c: any) => subsetIds.has(c.cardId)))
check('every pack carries the guaranteed Pikachu', withPikachu.length === 5, `${withPikachu.length}/5 packs, subset pool ${subsetIds.size} cards`)
const poolOf = (slot: string) =>
  new Set((db.prepare("SELECT card_id FROM pack_product_cards WHERE pack_product_id = 'me55-booster' AND slot = ?").all(slot) as { card_id: string }[]).map((r) => r.card_id))
const commons = poolOf('common')
const fits = dealt.map((pack) => {
  const ids = (pack ?? []).map((c: any) => c.cardId)
  return { common: ids.filter((id) => commons.has(id)).length, subset: ids.filter((id) => subsetIds.has(id)).length, total: ids.length }
})
check(
  'every pack is four commons + one rare-or-hit + one Pikachu',
  fits.every((f) => f.common === 4 && f.subset === 1 && f.total === 6),
  fits.map((f) => `${f.common}c+${f.total - f.common - f.subset}h+${f.subset}p`).join(' '),
)

console.log('\n5. the pack sells at its market, not at a model of it')
const price = sealed.priceDetail('me55-booster')
const shelf = (await import('../server/catalog/sealed-evidence')).shelfPriceFor('me55-booster')
check('booster shelf price is the sourced TCGplayer quote', shelf != null && Math.abs(price.market - shelf.market) < 0.01, `$${price.market} (quote $${shelf?.market}, as of ${shelf?.asOf})`)
check('the quote is the Nov-13 30th snapshot, not the MSRP fallback', price.source === 'tcgplayer' && price.market > 4.49, `$${price.market} ${price.source}`)
const est = packs.estimatePackValue('me55')
check('a six-card pack is worth less than it did as ten', est.avg < 4.8, `avg $${est.avg} (was $4.80 across ten cards)`)
check('the pack is not a money printer', price.market >= est.p50, `p50 $${est.p50} on $${price.market}`)
console.log(`     typical rip: ${Math.round((est.p50 / price.market) * 100)}% of the sticker`)

console.log('\n6. the products that carry packs are priced from their own packs')
for (const id of ['me55-bundle', 'me55-etb', 'me55-upc-day', 'me55-ditto-premium']) {
  const d = sealed.priceDetail(id)
  check(`${id} still prices`, d.market > 0, `$${d.market}`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass + fail} checks (${pass} ok, ${fail} failed)`)
process.exit(fail === 0 ? 0 : 1)
