import fs from 'node:fs'
import Database from 'better-sqlite3'

const parsed = JSON.parse(fs.readFileSync('tmp/bb-parsed.json', 'utf8'))
const catalog = JSON.parse(fs.readFileSync('tmp/bb-catalog.json', 'utf8'))
const db = new Database('data/tcglife.db', { readonly: true })
const sets = new Map(db.prepare('SELECT id, name, release_date FROM sets').all().map((s) => [s.id, s]))

const rows = []
const problems = []
for (const row of parsed) {
  const cat = catalog.find((c) => c.setId === row.setId)
  const set = row.setId ? sets.get(row.setId) : null
  if (!set) problems.push(`${row.expansion}: no catalogued set`)
  if (!cat) problems.push(`${row.expansion}: no tcgcsv lookup`)
  const promos = row.promos.map((p) => ({ name: p.name, id: p.id }))
  for (const p of row.promos) if (!p.exists) problems.push(`${row.setId}: promo ${p.name} (${p.number}) -> ${p.id ?? 'no id'}`)
  if (promos.length !== 4) problems.push(`${row.setId}: ${promos.length} promos`)
  const prefixes = new Set(promos.map((p) => (p.id ? p.id.split('-')[0] : null)))
  rows.push({
    setId: row.setId,
    expansion: row.expansion,
    setName: set?.name ?? row.expansion,
    releaseDate: set?.release_date ?? null,
    promos,
    promoSet: prefixes.size === 1 ? [...prefixes][0] : null,
    productId: cat?.productId ?? null,
    market: typeof cat?.market === 'number' ? cat.market : null,
    image: cat?.image ?? null,
  })
}

fs.writeFileSync('tmp/bb-final.json', JSON.stringify(rows, null, 2))
console.log('rows', rows.length)
console.log('with product', rows.filter((r) => r.productId).length)
console.log('with market', rows.filter((r) => r.market !== null).length)
console.log('with image', rows.filter((r) => r.image).length)
console.log('problems', problems.length)
for (const p of problems) console.log('  -', p)
console.log(rows.map((r) => `${r.setId} ${r.expansion} ${r.releaseDate} ${r.promoSet} [${r.promos.map((p) => p.id).join(' ')}] ${r.market ?? '-'}`).join('\n'))
