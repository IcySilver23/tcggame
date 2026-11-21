// The Pack Shop list must paint without pricing or EV-modelling every product;
// detail supplies the expensive half. Runs against a COPY of the save under
// tmp/shop-split-home.
//
//   npx tsx tmp/check-shop-split.ts

import fs from 'node:fs'
import path from 'node:path'

let checks = 0
const fails: string[] = []
function ok(cond: unknown, label: string) {
  checks++
  if (!cond) fails.push(label)
}

const home = path.resolve('tmp/shop-split-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'server'), { recursive: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
fs.copyFileSync('server/schema.sql', path.join(home, 'server', 'schema.sql'))
for (const suffix of ['', '-wal', '-shm']) {
  const src = path.join('data', `tcglife.db${suffix}`)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(home, 'data', `tcglife.db${suffix}`))
}
process.env.TCGLIFE_HOME = home

const { db } = await import('../server/lib/db')
const shop = await import('../server/services/shop-catalog')
const gmpacks = await import('../server/services/gmpacks')

try {
  gmpacks.ensureMiniPacks()
  const listStart = performance.now()
  const rows = shop.listProducts()
  const listMs = Math.round(performance.now() - listStart)
  console.log(`shop-split: list ${rows.length} rows in ${listMs}ms`)
  ok(rows.length > 0, 'the list returns products')
  const sample = rows.find((r) => r.kind === 'booster' && !String(r.id).startsWith('gm-')) ?? rows[0]
  ok(!!sample, 'the list has a first row')
  if (sample) {
    ok(!('est' in sample), 'the list does not carry pack EV')
    ok(!('slots' in sample), 'the list does not carry slot plans')
    ok(!('mini' in sample), 'the list does not carry Sequin odds')
    ok(typeof sample.price_source === 'string', 'the list still carries the cheap price source')
    ok(typeof sample.oop === 'boolean', 'the list still carries the cheap print status')
    const detailStart = performance.now()
    const detail = shop.productDetail(String(sample.id))
    console.log(`shop-split: first detail in ${Math.round(performance.now() - detailStart)}ms`)
    ok(!!detail, 'detail resolves the first product')
    if (detail) {
      ok(detail.market > 0, 'detail carries the actual shelf price')
      ok(detail.price_source === sample.price_source, 'detail agrees with the list price source')
      ok(detail.est.avg >= 0 && detail.est.p50 >= 0, 'detail carries the EV estimate')
      ok(Array.isArray(detail.slots) && detail.slots.length > 0, 'detail carries the slot plan')
      ok(detail.mini == null, 'a booster has no Sequin odds')
    }
  }

  const mini = rows.find((r) => String(r.id) === 'gm-sunmoon-mini')
  ok(!!mini, 'the General Mills mini pack is on the shelf')
  if (mini) {
    const detail = shop.productDetail('gm-sunmoon-mini')
    ok(!!detail?.mini, 'mini detail carries Sequin odds')
    ok(detail?.slots === undefined, 'mini detail omits the booster slot plan')
  }

  const batch = shop.productDetails(rows.slice(0, 3).map((r) => String(r.id)))
  ok(batch.length === Math.min(3, rows.length), 'batch detail returns one row per known product')
  ok(shop.productDetail('not-a-product') === null, 'unknown detail returns null')
} finally {
  db.close()
  fs.rmSync(home, { recursive: true, force: true })
}

if (fails.length > 0) {
  console.error(`shop-split checks failed (${fails.length}/${checks}):`)
  for (const f of fails) console.error('  ✗', f)
  process.exit(1)
}
console.log(`shop-split checks passed (${checks})`)
