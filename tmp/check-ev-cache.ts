// Pack, sealed and mini-pack EV caches must follow the price/catalogue snapshot.
// Runs against a COPY of the save under tmp/ev-cache-home so the price writes
// cannot touch the player's real save.
//
//   npx tsx tmp/check-ev-cache.ts

import fs from 'node:fs'
import path from 'node:path'

let checks = 0
const fails: string[] = []
function ok(cond: unknown, label: string) {
  checks++
  if (!cond) fails.push(label)
}
function eq<T>(got: T, want: T, label: string) {
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`)
}

const home = path.resolve('tmp/ev-cache-home')
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
const { estimatePackValue } = await import('../server/services/packs')
const sealed = await import('../server/services/sealed')
const gm = await import('../server/services/gmpacks')
const { derivedDataRevision, markCatalogChanged, markPricesChanged } = await import('../server/lib/derived-cache')

const FUTURE = '2099-01-01T00:00:00.000Z'

function priceWrite(cardId: string, variant: string, market: number) {
  db.prepare(
    `INSERT INTO price_records
       (card_id, kind, variant, low, mid, high, market, direct_low, avg1, avg7, avg30, retrieved_at)
     VALUES (?, 'tcgplayer', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
  ).run(cardId, variant, market, market, market, market, FUTURE)
}

try {
  gm.ensureMiniPacks()

  // -------------------------------------------------------------------------
  // 1. Booster estimate — a price write alone is not enough; the signal is.
  // -------------------------------------------------------------------------
  const setId = ['base3', 'det1', 'neo2', 'mcd22'].find((id) =>
    sealed.sellsProduct(`${id}-booster`, id),
  ) ?? 'base3'
  const packCard = db
    .prepare(
      `SELECT ppc.card_id
       FROM pack_product_cards ppc
       WHERE ppc.pack_product_id = ? AND ppc.slot = 'common'
       ORDER BY ppc.weight DESC LIMIT 1`,
    )
    .get(`${setId}-booster`) as { card_id: string } | undefined
  ok(!!packCard, `${setId}: has a common card in its pull table`)

  if (packCard) {
    const before = estimatePackValue(setId)
    const sealedBefore = sealed.derivedPrice(setId, 'booster')
    ok(before.avg > 0, `${setId}: booster estimate starts above zero`)
    ok(sealedBefore > 0, `${setId}: sealed estimate starts above zero`)

    priceWrite(packCard.card_id, 'normal', 1000)
    const stillCached = estimatePackValue(setId)
    ok(stillCached === before, `${setId}: a price row alone does not bypass the cache`)

    const revisionBefore = derivedDataRevision()
    markPricesChanged()
    ok(derivedDataRevision() > revisionBefore, 'price signal advances the derived-data revision')

    const after = estimatePackValue(setId)
    ok(after !== before, `${setId}: price signal recomputes the booster estimate`)
    ok(after.avg > before.avg + 10, `${setId}: higher common price raises booster EV (${before.avg} → ${after.avg})`)

    const sealedAfter = sealed.derivedPrice(setId, 'booster')
    ok(sealedAfter > sealedBefore + 10, `${setId}: higher common price raises sealed EV (${sealedBefore} → ${sealedAfter})`)
  }

  // -------------------------------------------------------------------------
  // 2. Mini-pack estimate follows its own pool's prices.
  // -------------------------------------------------------------------------
  const miniId = 'gm-sunmoon-mini'
  const entries = gm.miniPackEntries(miniId)
  const entry = entries.find((e) => e.variant === 'normal') ?? entries[0]
  ok(!!entry, `${miniId}: has at least one pool entry`)

  if (entry) {
    const before = gm.estimateMiniPack(miniId)
    priceWrite(entry.cardId, entry.variant, 1000)
    const stillCached = gm.estimateMiniPack(miniId)
    ok(stillCached === before, `${miniId}: a price row alone does not bypass the cache`)

    markPricesChanged()
    const after = gm.estimateMiniPack(miniId)
    ok(after !== before, `${miniId}: price signal recomputes the mini-pack estimate`)
    ok(after.avg > before.avg + 10, `${miniId}: higher pool price raises mini-pack EV (${before.avg} → ${after.avg})`)
  }

  // -------------------------------------------------------------------------
  // 3. Catalog changes use the same eviction path.
  // -------------------------------------------------------------------------
  const beforeCatalog = estimatePackValue(setId)
  markCatalogChanged()
  const afterCatalog = estimatePackValue(setId)
  ok(afterCatalog !== beforeCatalog, 'catalog signal recomputes the booster estimate')
} finally {
  db.close()
  fs.rmSync(home, { recursive: true, force: true })
}

if (fails.length > 0) {
  console.error(`ev-cache checks failed (${fails.length}/${checks}):`)
  for (const f of fails) console.error('  ✗', f)
  process.exit(1)
}
console.log(`ev-cache checks passed (${checks})`)
