// Every sealed product, checked against the pack it actually deals.
//
// The one-card bug was not a pricing bug: a product can only deal the cards its
// set's pull table can fill. This sweep measures each sold product's set, 40
// packs each, against that set's blueprint, and flags:
//
//   no-table    the set has no booster pool at all
//   short       the pack deals fewer cards than the blueprint declares
//   one-card    the pack deals one card or fewer (the fake-wrapper case)
//   declared    the product's cards_per_pack disagrees with the blueprint
//   bad-box     a bundle/ETB/display with no pack count
//   sold-subset a subset-only set is still offered
//   rip-positive a sold product's shelf price is below its expected pull value
//                (this is a failure, not a warning: the audit exits non-zero)
//
// Hidden products are reported, not failed: they are kept for owned stock but
// the shop filter does not offer them. A set is hidden when it only ever came
// inside another set's packs, or when it never had a randomised booster of its
// own (decks, promos, fixed binders, one-card toys). Mini packs roll their own
// composition and are reported as exceptions.
//
// Writes reports/sealed-products.{json,md} (or SEALED_AUDIT_REPORT_DIR). Run on
// a copy of the save:
//   TCGLIFE_HOME=$PWD/tmp/audit-home node ./node_modules/tsx/dist/cli.mjs tmp/check-sealed-products.ts
//
// The SEALED_AUDIT_FIXTURE_RIP hook is test-only; tmp/check-sealed-audit-failure.ts
// uses it to quote one sold product below EV and prove this audit exits 1.
import { mkdirSync, writeFileSync } from 'node:fs'
import { db } from '../server/lib/db'
import { rollPack } from '../server/services/packs'
import { planFor, expectedPackValue } from '../server/services/packodds'
import { ensureFullCatalog, sellsOwnPacks, priceDetail, SUBSET_ONLY_SETS } from '../server/services/sealed'
import { miniPackFor } from '../server/catalog/general-mills'

const N = Number(process.env.SEALED_PACKS ?? 40)
const REPORT_DIR = process.env.SEALED_AUDIT_REPORT_DIR ?? 'reports'
// Test-only: quote this product at a quarter of its shelf price so the fixture
// can exercise the pricing-failure path without changing any real price.
const FIXTURE_RIP = process.env.SEALED_AUDIT_FIXTURE_RIP
ensureFullCatalog()

type Product = {
  id: string
  set_id: string
  name: string
  kind: string
  msrp: number
  packs: number | null
  cards_per_pack: number
  set_name: string
  series: string
  release_date: string
}

const products = db
  .prepare(
    `SELECT p.*, s.name AS set_name, s.series, s.release_date
     FROM pack_products p JOIN sets s ON s.id = p.set_id
     ORDER BY s.release_date DESC, p.id`,
  )
  .all() as Product[]

type Shape = { pool: number; plan: number; min: number; max: number; avg: number }
const shapeCache = new Map<string, Shape>()

function shapeOf(setId: string): Shape {
  const cached = shapeCache.get(setId)
  if (cached) return cached
  const pool = (db.prepare(`SELECT COUNT(*) AS n FROM pack_product_cards WHERE pack_product_id = ?`).get(`${setId}-booster`) as { n: number }).n
  const plan = planFor(setId, 10).reduce((a, s) => a + s.count, 0)
  const counts: number[] = []
  if (pool > 0) {
    for (let i = 0; i < N; i++) {
      const pack = rollPack(setId, `sealedaudit-${setId}-${i}`, 'booster', 10)
      if (!pack) break
      counts.push(pack.length)
    }
    db.prepare('DELETE FROM pull_history WHERE session_id LIKE ?').run(`sealedaudit-${setId}-%`)
  }
  const shape: Shape = {
    pool,
    plan,
    min: counts.length ? Math.min(...counts) : 0,
    max: counts.length ? Math.max(...counts) : 0,
    avg: counts.length ? counts.reduce((a, n) => a + n, 0) / counts.length : 0,
  }
  shapeCache.set(setId, shape)
  return shape
}

type Row = {
  id: string
  set: string
  set_name: string
  kind: string
  cards_per_pack: number
  plan: number
  pool: number
  dealt: string
  packs: number | null
  msrp: number
  market: number
  ev: number
  productEv: number
  ratio: number | null
  hidden: boolean
  mini: boolean
  issues: string[]
}

const rows: Row[] = []
const failures: Row[] = []
for (const p of products) {
  const mini = !!miniPackFor(p.id)
  const hidden = !sellsOwnPacks(p.set_id)
  const shape = shapeOf(p.set_id)
  const issues: string[] = []
  if (!mini) {
    if (hidden) issues.push('hidden')
    else {
      if (shape.pool === 0) issues.push('no-table')
      if (shape.pool > 0 && shape.avg < shape.plan - 0.01) issues.push('short')
      if (shape.plan >= 4 && shape.pool > 0 && shape.avg <= 1.5) issues.push('one-card')
      if (p.kind === 'booster' && p.cards_per_pack !== shape.plan) issues.push('declared')
      if (p.kind !== 'booster' && p.kind !== 'special' && (!p.packs || p.packs < 1)) issues.push('bad-box')
      if (SUBSET_ONLY_SETS.has(p.set_id)) issues.push('sold-subset')
    }
  }
  const quoted = priceDetail(p.id).market
  const market = FIXTURE_RIP === p.id ? Math.round(quoted * 0.25 * 100) / 100 : quoted
  const ev = expectedPackValue(p.set_id)
  const packs = Math.max(1, p.packs ?? 1)
  const productEv = ev * packs
  const ratio = market > 0 ? productEv / market : null
  const row: Row = {
    id: p.id,
    set: p.set_id,
    set_name: p.set_name,
    kind: p.kind,
    cards_per_pack: p.cards_per_pack,
    plan: shape.plan,
    pool: shape.pool,
    dealt: shape.pool > 0 ? `${shape.min === shape.max ? shape.min : `${shape.min}–${shape.max}`} (avg ${shape.avg.toFixed(2)})` : '—',
    packs: p.packs,
    msrp: p.msrp,
    market,
    ev,
    productEv,
    ratio,
    hidden,
    mini,
    issues,
  }
  rows.push(row)
  if (issues.some((i) => i !== 'hidden')) failures.push(row)
}

const sold = rows.filter((r) => !r.hidden && !r.mini)
const hiddenRows = rows.filter((r) => r.hidden)
const miniRows = rows.filter((r) => r.mini)
const ripPositive = sold
  .filter((r) => r.ratio != null && r.ratio > 1.25)
  .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
// A rip-positive product is a pricing failure. It joins the same failure list
// the report and exit code use, so a regression cannot hide in a warning row.
for (const r of ripPositive) {
  if (!r.issues.includes('rip-positive')) r.issues.push('rip-positive')
  if (!failures.includes(r)) failures.push(r)
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const md: string[] = []
md.push('# Sealed products, every product')
md.push('')
md.push(
  `Swept ${rows.length} sealed products across ${new Set(rows.map((r) => r.set)).size} sets; ${sold.length} offered for sale, ${hiddenRows.length} kept for owned stock only, ${miniRows.length} mini packs with their own composition. Each set is dealt ${N} packs.`,
)
md.push('')
md.push('## Summary')
md.push('')
md.push('| | Products |')
md.push('|---|---:|')
md.push(`| Offered for sale | ${sold.length} |`)
md.push(`| Hidden (no wrapper of their own) | ${hiddenRows.length} |`)
md.push(`| Mini packs (own composition) | ${miniRows.length} |`)
md.push(`| Failures | ${failures.length} |`)
md.push('')
md.push('## Failures')
md.push('')
if (failures.length === 0) md.push('None: every offered product deals its declared pack and clears its expected-value floor.')
else {
  md.push('| Product | Set | Kind | Declared | Blueprint | Dealt | Issues |')
  md.push('|---|---|---|---:|---:|---:|---|')
  for (const r of failures) md.push(`| ${r.id} | ${r.set_name} | ${r.kind} | ${r.cards_per_pack} | ${r.plan} | ${r.dealt} | ${r.issues.join(', ')} |`)
}
md.push('')
md.push('## Rip-positive products (pricing failures)')
md.push('')
if (ripPositive.length === 0) md.push('None: no offered product has an expected value more than 1.25× its shelf price.')
else {
  md.push('These are failures: the audit exits non-zero until the product is priced at or above its expected pull value.')
  md.push('')
  md.push('| Product | Set | Kind | EV/product | Shelf price | EV ÷ price |')
  md.push('|---|---|---|---:|---:|---:|')
  for (const r of ripPositive) md.push(`| ${r.id} | ${r.set_name} | ${r.kind} | $${r.productEv.toFixed(2)} | $${r.market.toFixed(2)} | ${(r.ratio ?? 0).toFixed(2)}× |`)
}
md.push('')
md.push('## Hidden, not sold')
md.push('')
if (hiddenRows.length === 0) md.push('None.')
else {
  md.push('These sets have no wrapper of their own: they are subset-only, or their cards came in decks, promo giveaways, a fixed binder, or one per toy. Their rows are kept so stock already owned still resolves; the shop, pack battles and live shows do not offer them.')
  md.push('')
  md.push('| Set | Products |')
  md.push('|---|---:|')
  const bySet = new Map<string, number>()
  for (const r of hiddenRows) bySet.set(r.set, (bySet.get(r.set) ?? 0) + 1)
  for (const [set, n] of [...bySet.entries()].sort()) md.push(`| ${set} | ${n} |`)
}
md.push('')
md.push('## Mini packs')
md.push('')
if (miniRows.length === 0) md.push('None.')
else {
  md.push('These roll their own researched composition (one Sequin card plus reprints) rather than a set pull table, so their three-card shape is checked separately.')
  md.push('')
  md.push('| Product | Set | Cards |')
  md.push('|---|---|---:|')
  for (const r of miniRows) md.push(`| ${r.id} | ${r.set_name} | ${r.cards_per_pack} |`)
}
md.push('')
md.push('## Method')
md.push('')
md.push(
  'Each set is dealt 40 packs through the same roller the shop uses; the blueprint is the source of truth, so a four-card Celebrations pack is judged as four. A product fails when its set has no booster pool, the pack deals fewer cards than the blueprint, it deals one card or fewer, the product advertises a different card count, a box has no pack count, or a subset-only set is somehow still offered. Every sold product\'s shelf price is floored at expected pull value × its real pack count; a rip-positive product is a pricing failure and makes the audit exit non-zero. Boxes reuse the set\'s per-pack roll, so the check covers them through their set.',
)
md.push('')
md.push('## Every sold product')
md.push('')
md.push('| Product | Set | Kind | Cards | Dealt | Pool |')
md.push('|---|---|---|---:|---:|---:|')
for (const r of sold) md.push(`| ${r.id} | ${r.set_name} | ${r.kind} | ${r.cards_per_pack} | ${r.dealt} | ${r.pool} |`)

mkdirSync(REPORT_DIR, { recursive: true })
writeFileSync(
  `${REPORT_DIR}/sealed-products.json`,
  JSON.stringify(
    {
      n: N,
      summary: { products: rows.length, sold: sold.length, hidden: hiddenRows.length, mini: miniRows.length, failures: failures.length },
      failures,
      ripPositive,
      hidden: hiddenRows.map((r) => ({ id: r.id, set: r.set, kind: r.kind })),
      rows,
    },
    null,
    2,
  ),
)
writeFileSync(`${REPORT_DIR}/sealed-products.md`, md.join('\n') + '\n')

console.log(`products ${rows.length} | sold ${sold.length} | hidden ${hiddenRows.length} | mini ${miniRows.length} | failures ${failures.length}`)
for (const r of failures.slice(0, 40)) console.log(`  FAIL ${r.id} (${r.kind}) declared ${r.cards_per_pack} plan ${r.plan} dealt ${r.dealt}: ${r.issues.join(', ')}`)
for (const r of ripPositive.slice(0, 10)) console.log(`  RIP-POSITIVE ${r.id}: EV $${r.ev.toFixed(2)} vs $${r.market.toFixed(2)} (${(r.ratio ?? 0).toFixed(2)}×)`)
console.log(`report: ${REPORT_DIR}/sealed-products.{json,md}`)
process.exit(failures.length === 0 ? 0 : 1)
