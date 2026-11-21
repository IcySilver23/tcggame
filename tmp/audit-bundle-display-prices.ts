import fs from 'node:fs'
import path from 'node:path'
import { shelfPriceFor } from '../server/catalog/sealed-evidence'

const root = process.cwd()
const home = fs.mkdtempSync(path.join(root, 'tmp', 'bundle-audit-'))
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
for (const suffix of ['', '-wal', '-shm']) {
  const source = path.join(root, 'data', `tcglife.db${suffix}`)
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(home, 'data', `tcglife.db${suffix}`))
}
fs.copyFileSync(path.join(root, 'server', 'schema.sql'), path.join(home, 'schema.sql'))
process.env.TCGLIFE_HOME = home

const { db } = await import('../server/lib/db')
const rows = db.prepare(`SELECT id, name, kind, set_id FROM pack_products WHERE kind IN ('bundle','display') ORDER BY kind, set_id, id`).all() as { id: string; name: string; kind: string; set_id: string }[]
const missing: typeof rows = []
for (const row of rows) {
  const quote = shelfPriceFor(row.id)
  if (!quote) missing.push(row)
  console.log(`${quote ? 'QUOTE' : 'MODEL'}\t${row.kind}\t${row.id}\t${row.name}\t${quote ? `${quote.kind} $${quote.market.toFixed(2)} ${quote.asOf}` : ''}`)
}
console.log(`\n${rows.length} rows, ${missing.length} without a shelf quote`)
db.close()
fs.rmSync(home, { recursive: true, force: true })
