import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const home = fs.mkdtempSync(path.join(root, 'tmp', 'bundle-sets-'))
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
for (const suffix of ['', '-wal', '-shm']) {
  const source = path.join(root, 'data', `tcglife.db${suffix}`)
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(home, 'data', `tcglife.db${suffix}`))
}
fs.copyFileSync(path.join(root, 'server', 'schema.sql'), path.join(home, 'schema.sql'))
process.env.TCGLIFE_HOME = home

const { db } = await import('../server/lib/db')
const rows = db.prepare(`
  SELECT DISTINCT p.set_id AS setId, s.name AS setName
  FROM pack_products p JOIN sets s ON s.id = p.set_id
  WHERE p.kind IN ('bundle','display')
  ORDER BY p.set_id
`).all() as { setId: string; setName: string }[]
fs.writeFileSync('tmp/bundle-display-sets.json', JSON.stringify(rows, null, 2) + '\n')
console.log(`${rows.length} sets`)
db.close()
fs.rmSync(home, { recursive: true, force: true })
