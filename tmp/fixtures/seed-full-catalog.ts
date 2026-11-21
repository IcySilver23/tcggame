// Builds the full catalog into an isolated save for the sealed check.
//
// data/catalog-seed.db is the offline 176-set catalogue the game ships. It has
// sets, cards and prices but no sealed products or pull tables, so this seeder
// applies it, adds the local releases, seeds every product line and rebuilds
// every booster table exactly as the server's boot pass does. The result is the
// same 522-product catalogue the full audit sees on a dev save.
//
// Run by tmp/check-sealed-suite.ts when CI has no player save. TCGLIFE_HOME
// must point at an isolated home with schema.sql already in place.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

if (!process.env.TCGLIFE_HOME) {
  console.error('seed-full-catalog must run with TCGLIFE_HOME set to an isolated directory')
  process.exit(1)
}

const home = process.env.TCGLIFE_HOME
const seedFile = existsSync(join(home, 'data', 'catalog-seed.db'))
  ? join(home, 'data', 'catalog-seed.db')
  : join(process.cwd(), 'data', 'catalog-seed.db')
if (!existsSync(seedFile)) {
  console.error(`full catalog seed not found at ${seedFile}`)
  process.exit(1)
}

// Import only after the home and seed are known: db.ts binds on module load.
const { db } = await import('../../server/lib/db')
const { applyCatalogSeed } = await import('../../server/services/sync')
const { applyLocalReleases } = await import('../../server/services/localcatalog')
const { ensureFullCatalog } = await import('../../server/services/sealed')
const { ensureMiniPacks } = await import('../../server/services/gmpacks')
const { buildPullTable } = await import('../../server/services/packs')

const seeded = applyCatalogSeed()
if (!seeded.applied) {
  console.error(`full catalog seed was not applied: ${seeded.reason ?? 'unknown reason'}`)
  process.exit(1)
}

// Delta Reign and the 30th Celebration Wave 4 products are newer than the
// upstream catalogue. This is the same loader the server runs at boot.
applyLocalReleases()
ensureFullCatalog()
ensureMiniPacks()

// The real save retains historical wrapper rows for sets the current rules hide
// (subset-only sets, no-booster products) and two explicit sv3pt5 boxes. Those
// rows are what make the audit 522 products rather than 428; seed the same rows
// so CI checks the real catalogue shape. They are hidden, not offered for sale.
type ExtraProduct = {
  id: string
  set_id: string
  name: string
  kind: string
  msrp: number | null
  market_price: number | null
  packs: number | null
  cards_per_pack: number
  release_date: string | null
  description: string | null
}
const extras = JSON.parse(
  readFileSync(join(process.cwd(), 'tmp', 'fixtures', 'historical-sealed-products.json'), 'utf8'),
) as ExtraProduct[]
const insertProduct = db.prepare(
  `INSERT OR IGNORE INTO pack_products
   (id, set_id, name, kind, msrp, market_price, packs, cards_per_pack, release_date, description)
   VALUES (@id, @set_id, @name, @kind, @msrp, @market_price, @packs, @cards_per_pack, @release_date, @description)`,
)
for (const product of extras) insertProduct.run(product)

// The catalogue ships the three 30th Celebration RGB Mews mistagged as Common;
// the server repairs them before rebuilding. Do the same or the me55 table is
// built from the wrong pool.
const repaired = db
  .prepare(
    `UPDATE cards SET rarity = 'RGB Rare'
     WHERE id IN ('me55-R', 'me55-G', 'me55-B') AND (rarity IS NULL OR rarity <> 'RGB Rare')`,
  )
  .run().changes

const setIds = db
  .prepare(
    `SELECT DISTINCT c.set_id AS id
     FROM cards c JOIN pack_products p ON p.id = c.set_id || '-booster'`,
  )
  .all() as { id: string }[]
for (const { id } of setIds) {
  buildPullTable(id, 10)
}

const counts = db
  .prepare(
    `SELECT (SELECT COUNT(*) FROM sets) AS sets,
            (SELECT COUNT(*) FROM cards) AS cards,
            (SELECT COUNT(*) FROM pack_products) AS products,
            (SELECT COUNT(*) FROM pack_product_cards) AS pool`,
  )
  .get() as { sets: number; cards: number; products: number; pool: number }
// Sanity floors, not an exact catalogue snapshot: products are added with every
// release (570 at the last pass), so an exact count fails CI on a healthy seed
// whenever a product ships. A seed that half-applies or loses its extras still
// lands far below these.
if (counts.sets < 150 || counts.cards < 15000 || counts.products < 500 || counts.pool < 1000) {
  console.error(
    `full catalog fixture incomplete: ${counts.sets} sets, ${counts.cards} cards, ${counts.products} products, ${counts.pool} pool rows`,
  )
  process.exit(1)
}

console.log(
  `full catalog fixture: ${counts.sets} sets, ${counts.cards} cards, ${counts.products} products, ${counts.pool} pool rows` +
    (repaired > 0 ? `, repaired ${repaired} RGB rarity row(s)` : ''),
)
