// Builds the tiny tracked catalog in tmp/fixtures/sealed-catalog.json into an
// isolated save. Run by tmp/check-sealed-suite.ts when no local dev save is
// available (or when SEALED_AUDIT_USE_FIXTURE=1 is set).
//
// The fixture is deliberately synthetic: one Scarlet & Violet set with five
// commons, three uncommons, one Rare and one Double Rare, all priced at $5.
// That is enough for the audit's ten-card SV blueprint, a non-zero pack EV and
// the sv1-booster failure hook, without shipping a real catalog database.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

if (!process.env.TCGLIFE_HOME) {
  console.error('seed-sealed-fixture must run with TCGLIFE_HOME set to an isolated directory')
  process.exit(1)
}

type Card = { id: string; number: string; name: string; rarity: string; supertype: string }
type Fixture = {
  set: { id: string; name: string; series: string; release_date: string; printed_total: number; total: number }
  cards: Card[]
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tmp', 'fixtures', 'sealed-catalog.json'), 'utf8'),
) as Fixture

// Import after checking TCGLIFE_HOME: db.ts binds its file on module load.
const { db } = await import('../../server/lib/db')
const { ensureFullCatalog } = await import('../../server/services/sealed')
const { buildPullTable } = await import('../../server/services/packs')

const set = fixture.set
db.prepare(
  `INSERT OR IGNORE INTO sets (id, name, series, printed_total, total, release_date)
   VALUES (?, ?, ?, ?, ?, ?)`,
).run(set.id, set.name, set.series, set.printed_total, set.total, set.release_date)

const insertCard = db.prepare(
  `INSERT OR IGNORE INTO cards
   (id, set_id, name, supertype, subtypes, number, position, rarity, types, hp, artist, dex_numbers, image_small, image_large, regulation_mark, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
const now = new Date().toISOString()
fixture.cards.forEach((card, index) => {
  insertCard.run(
    card.id,
    set.id,
    card.name,
    card.supertype,
    null,
    card.number,
    index + 1,
    card.rarity,
    JSON.stringify(['Colorless']),
    100,
    'Sealed fixture',
    null,
    null,
    null,
    null,
    now,
  )
})

// Every slot prices from the same real-looking anchor. valueOf() falls back
// through holofoil/normal, but seeding all three makes the intent explicit.
const insertPrice = db.prepare(
  `INSERT OR IGNORE INTO price_records
   (card_id, kind, variant, low, mid, high, market, direct_low, avg1, avg7, avg30, retrieved_at)
   VALUES (?, 'tcgplayer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
for (const card of fixture.cards) {
  for (const variant of ['normal', 'holofoil', 'reverseHolofoil']) {
    insertPrice.run(card.id, variant, 5, 5, 5, 5, null, 5, 5, 5, now)
  }
}

ensureFullCatalog()
buildPullTable(set.id, 10)

const counts = db
  .prepare(
    `SELECT (SELECT COUNT(*) FROM cards WHERE set_id = ?) AS cards,
            (SELECT COUNT(*) FROM pack_products WHERE set_id = ?) AS products,
            (SELECT COUNT(*) FROM pack_product_cards WHERE pack_product_id = ?) AS pool`,
  )
  .get(set.id, set.id, `${set.id}-booster`) as { cards: number; products: number; pool: number }

if (counts.cards !== fixture.cards.length || counts.products < 1 || counts.pool !== 10) {
  console.error(
    `sealed fixture seed incomplete: ${counts.cards} cards, ${counts.products} products, ${counts.pool} pool rows`,
  )
  process.exit(1)
}

console.log(
  `sealed fixture: ${counts.cards} cards, ${counts.products} products, ${counts.pool} pull-table rows`,
)
