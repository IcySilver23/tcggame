// Why does the Charizard Ultra-Premium Collection ship with blank promo art?
import fs from 'node:fs'
import path from 'node:path'

const HOME = path.resolve('tmp/upc-home')
fs.rmSync(HOME, { recursive: true, force: true })
fs.mkdirSync(path.join(HOME, 'data'), { recursive: true })
fs.copyFileSync(path.resolve('data/tcglife.db'), path.join(HOME, 'data', 'tcglife.db'))
process.env.TCGLIFE_HOME = HOME

const { db } = await import('../server/lib/db')

const promoIds = ['swshp-SWSH260', 'swshp-SWSH261', 'swshp-SWSH262']

console.log('exact ids:')
console.table(db.prepare('SELECT id, name, set_id, image_url FROM cards WHERE id IN (?,?,?)').all(...promoIds))

console.log('\nany promo row mentioning Charizard:')
console.table(
  db
    .prepare("SELECT id, name, set_id, substr(image_url, 1, 60) AS url FROM cards WHERE set_id LIKE '%p%' AND name LIKE '%Charizard%' AND id LIKE 'swsh%' ORDER BY id LIMIT 25")
    .all(),
)

console.log('\nproduct row:')
console.table(db.prepare("SELECT id, name, set_id, kind, packs FROM pack_products WHERE id LIKE '%upc-charizard%' OR name LIKE '%Charizard%Ultra%'").all())

console.log('\ncard art coverage across swshp:')
console.table(
  db
    .prepare("SELECT COUNT(*) AS rows_, SUM(image_url IS NULL OR image_url = '') AS no_art FROM cards WHERE set_id = 'swshp'")
    .all(),
)
