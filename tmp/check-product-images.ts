import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const root = path.resolve('.')
const home = path.join(root, 'tmp', 'product-image-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
const source = new Database(path.join(root, 'data', 'tcglife.db'), { readonly: true })
await source.backup(path.join(home, 'data', 'tcglife.db'))
source.close()
process.env.TCGLIFE_HOME = home

const { db } = await import('../server/lib/db')
const sealed = await import('../server/services/sealed')
const { sellsProduct, ensureFullCatalog } = sealed
ensureFullCatalog()

const rows = db.prepare(`
  SELECT id, set_id, name, kind, image_url
  FROM pack_products
  ORDER BY set_id, kind, id
`).all() as { id: string; set_id: string; name: string; kind: string; image_url: string | null }[]
const sold = rows.filter((r) => sellsProduct(r.id, r.set_id))
const missing = sold.filter((r) => !r.image_url)
console.log(`sold=${sold.length} missing=${missing.length}`)
for (const r of missing) console.log(`${r.id}\t${r.kind}\t${r.name}`)
