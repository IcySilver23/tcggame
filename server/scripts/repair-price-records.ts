#!/usr/bin/env tsx
/**
 * Offline repair for a bloated `price_records` table.
 *
 * Why this exists: every boot re-ran the catalog seed's
 *   INSERT OR IGNORE INTO price_records ... SELECT ... FROM seed.price_records
 * with NO unique constraint, so all ~53k seed prices were re-inserted as brand
 * new duplicate rows on each launch. On top of that, takeSnapshot() copied the
 * latest price for ALL ~20k catalog cards into history once a day. The table
 * ballooned past 3.3M rows / 800MB, and the boot-time backfill queries
 *   ... NOT IN (SELECT card_id FROM price_records WHERE market IS NOT NULL ...)
 * are O(table). They blocked the single-threaded event loop for ~20-66s, so the
 * HTTP port bound but no request was ever answered and the WebView2 splash
 * never cleared — i.e. "the game won't launch."
 *
 * This script (idempotent, run OFFLINE while the server is stopped):
 *   1. Deletes exact duplicate (card_id, kind, variant, retrieved_at) rows.
 *   2. Caps history depth per (card_id, kind, variant): owned + wishlisted
 *      cards keep the newest 90 points (their portfolio chart), everything
 *      else collapses to its newest price only.
 *   3. Adds a UNIQUE index so the seed's INSERT OR IGNORE becomes a genuine
 *      no-op on future boots (this is the actual root-cause fix).
 *   4. Checkpoints the WAL and VACUUMs to reclaim the freed pages.
 *
 * Usage:  npx tsx server/scripts/repair-price-records.ts <path-to-tcglife.db>
 * Prints before/after row counts and file sizes. Safe to re-run.
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const dbPath = process.argv[2]
if (!dbPath) {
  console.error('usage: tsx server/scripts/repair-price-records.ts <path-to-tcglife.db>')
  process.exit(1)
}
if (!fs.existsSync(dbPath)) {
  console.error(`not found: ${dbPath}`)
  process.exit(1)
}

// Snapshot the sizes + a couple of invariants we must not disturb.
const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + ' MB'
const fileSize = (p: string) => (fs.existsSync(p) ? fs.statSync(p).size : 0)
const before = {
  db: fileSize(dbPath),
  wal: fileSize(dbPath + '-wal'),
}

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const countPrices = db.prepare('SELECT COUNT(*) AS n FROM price_records').get() as { n: number }
const countCards = db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }
const invCount = db.prepare("SELECT COUNT(*) AS n FROM inventory WHERE status != 'sold'").get() as { n: number }
console.log(`\n${dbPath}`)
console.log(`  cards=${countCards.n}  price_records=${countPrices.n}  owned=${invCount.n}`)
console.log(`  before: db=${mb(before.db)} wal=${mb(before.wal)}`)

// The set of cards whose price history is worth keeping deep (portfolio chart).
const watchedSql = `
  SELECT DISTINCT card_id FROM inventory WHERE status != 'sold'
  UNION
  SELECT DISTINCT card_id FROM wishlist
`

const repair = db.transaction(() => {
  // 1. Drop exact duplicates — keep the newest (max id) of each identical
  //    (card_id, kind, variant, retrieved_at) tuple.
  const dupes = db.prepare(`
    DELETE FROM price_records
    WHERE id NOT IN (
      SELECT MAX(id) FROM price_records
      GROUP BY card_id, kind, variant, retrieved_at
    )
  `).run()

  // 2. Cap history depth. Owned/wishlisted keep 90 newest points per
  //    (card, kind, variant); every other card keeps only its newest price.
  const pruned = db.prepare(`
    DELETE FROM price_records
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, card_id,
               ROW_NUMBER() OVER (
                 PARTITION BY card_id, kind, variant
                 ORDER BY retrieved_at DESC, id DESC
               ) AS rn
        FROM price_records
      ) ranked
      WHERE ranked.rn <= CASE
        WHEN ranked.card_id IN (${watchedSql}) THEN 90
        ELSE 1
      END
    )
  `).run()

  return { dupes: dupes.changes, pruned: pruned.changes }
})

const { dupes, pruned } = repair()
console.log(`  removed ${dupes.toLocaleString()} exact duplicate rows`)
console.log(`  removed ${pruned.toLocaleString()} rows beyond history cap`)

// 3. The root-cause guard: with this unique index the seed's
//    INSERT OR IGNORE ... FROM seed.price_records stops re-inserting the same
//    prices every boot. Build it only after dupes are gone so it can't fail.
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_price_records_natural
           ON price_records (card_id, kind, variant, retrieved_at)`)
  console.log('  ensured unique index ux_price_records_natural (card_id, kind, variant, retrieved_at)')
} catch (err) {
  console.warn('  could not create unique index:', err instanceof Error ? err.message : err)
}

// 4. Reclaim space: fold the WAL into the main file, then VACUUM the freelist.
const walPages = db.pragma('wal_checkpoint(TRUNCATE)') as unknown[]
console.log(`  wal_checkpoint(TRUNCATE): ${JSON.stringify(walPages)}`)
db.pragma('incremental_vacuum')
db.exec('VACUUM')

const after = {
  db: fileSize(dbPath),
  wal: fileSize(dbPath + '-wal'),
}
const afterPrices = db.prepare('SELECT COUNT(*) AS n FROM price_records').get() as { n: number }
db.close()

console.log(`  price_records: ${countPrices.n.toLocaleString()} -> ${afterPrices.n.toLocaleString()}`)
console.log(`  after:  db=${mb(after.db)} wal=${mb(after.wal)}`)
console.log('done.\n')
