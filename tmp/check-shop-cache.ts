// The Pack Shop shelf cache must be keyed by its inputs, not by time. Runs
// against a COPY of the save under tmp/shop-cache-home so the claim written by
// the test cannot touch the player's real save.
//
//   npx tsx tmp/check-shop-cache.ts

import fs from 'node:fs'
import path from 'node:path'

let checks = 0
const fails: string[] = []
function ok(cond: unknown, label: string) {
  checks++
  if (!cond) fails.push(label)
}

const home = path.resolve('tmp/shop-cache-home')
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
const { gameDayKey } = await import('../server/lib/gameday')
const { markCatalogChanged, markPricesChanged } = await import('../server/lib/derived-cache')
const { markSaveChanged } = await import('../server/lib/save-revision')
const dailydeals = await import('../server/services/dailydeals')
const shelf = await import('../server/services/shop-shelf-cache')

const row = (id: string) => ({ id, est: { avg: 1 } })

function reused(label: string) {
  const rows = [row(label)]
  shelf.cacheShopRows(rows)
  ok(shelf.cachedShopRows() === rows, `${label}: unchanged inputs reuse the exact cached rows`)
  ok(shelf.cachedShopRows() === shelf.cachedShopRows(), `${label}: repeated reads stay cached`)
}

try {
  // Stable inputs: the same key, with no elapsed-time component.
  reused('stable')

  // -------------------------------------------------------------------------
  // 1. Price and catalogue revisions.
  // -------------------------------------------------------------------------
  const beforePrice = shelf.shopShelfKey()
  markPricesChanged()
  ok(shelf.shopShelfKey() !== beforePrice, 'a price change moves the shelf key')
  ok(shelf.cachedShopRows() === null, 'a price change cannot return the previous shelf')

  reused('after price')
  const beforeCatalog = shelf.shopShelfKey()
  markCatalogChanged()
  ok(shelf.shopShelfKey() !== beforeCatalog, 'a catalogue change moves the shelf key')
  ok(shelf.cachedShopRows() === null, 'a catalogue change cannot return the previous shelf')

  // -------------------------------------------------------------------------
  // 2. Daily-deal claims.
  // -------------------------------------------------------------------------
  const deals = dailydeals.dealsForToday()
  const productId = [...deals.keys()][0]
  ok(!!productId, 'the copied save has a daily deal to claim')
  if (productId) {
    const day = gameDayKey()
    db.prepare('DELETE FROM daily_deal_purchases WHERE day_key = ? AND product_id = ?').run(day, productId)
    dailydeals.resetDailyDealsCache()
    reused('before claim')
    const beforeClaim = shelf.shopShelfKey()
    ok(dailydeals.claimDealToday(productId), 'the test can claim today\'s deal')
    ok(shelf.shopShelfKey() !== beforeClaim, 'a daily-deal claim moves the shelf key')
    ok(shelf.cachedShopRows() === null, 'a daily-deal claim cannot return the claimed=false shelf')
  }

  // -------------------------------------------------------------------------
  // 3. Save-level changes and the combined invalidation used by restore/reset.
  // -------------------------------------------------------------------------
  reused('before save change')
  const beforeSave = shelf.shopShelfKey()
  markSaveChanged()
  ok(shelf.shopShelfKey() !== beforeSave, 'a save change moves the shelf key')
  ok(shelf.cachedShopRows() === null, 'a save change cannot return the previous shelf')

  reused('before combined save invalidation')
  shelf.invalidateAfterSaveChange()
  ok(shelf.cachedShopRows() === null, 'restore/reset invalidation drops the shelf')
  ok(shelf.shopShelfKey() !== beforeSave, 'restore/reset invalidation also moves the derived key')
} finally {
  db.close()
  fs.rmSync(home, { recursive: true, force: true })
}

if (fails.length > 0) {
  console.error(`shop-cache checks failed (${fails.length}/${checks}):`)
  for (const f of fails) console.error('  ✗', f)
  process.exit(1)
}
console.log(`shop-cache checks passed (${checks})`)
