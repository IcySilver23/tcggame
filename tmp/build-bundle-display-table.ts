import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const home = fs.mkdtempSync(path.join(root, 'tmp', 'bundle-table-'))
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
for (const suffix of ['', '-wal', '-shm']) {
  const source = path.join(root, 'data', `tcglife.db${suffix}`)
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(home, 'data', `tcglife.db${suffix}`))
}
fs.copyFileSync(path.join(root, 'server', 'schema.sql'), path.join(home, 'schema.sql'))
process.env.TCGLIFE_HOME = home

const { db } = await import('../server/lib/db')
const rows = db.prepare(`SELECT id, name, kind, set_id AS setId FROM pack_products WHERE kind IN ('bundle','display') ORDER BY set_id, kind`).all() as { id: string; name: string; kind: 'bundle' | 'display'; setId: string }[]
db.close()
fs.rmSync(home, { recursive: true, force: true })

const sets = JSON.parse(fs.readFileSync('tmp/bundle-display-prices.json', 'utf8')) as {
  setId: string
  setName: string
  products: { id: number; name: string; market: number | null }[]
}[]

// The automatic group matcher picked the wrong group for these four.
const extraGroups: Record<string, { id: number; name: string; market: number | null }[]> = {
  me1: [{ id: 644298, name: 'Mega Evolution Booster Box', market: 300.72 }, { id: 644362, name: 'Mega Evolution Booster Bundle', market: 66.55 }],
  sv1: [{ id: 476452, name: 'Scarlet & Violet Booster Box', market: 298.51 }, { id: 478258, name: 'Scarlet & Violet Booster Bundle', market: 102.96 }],
  xy1: [{ id: 91601, name: 'XY Booster Box', market: null }],
  xy12: [{ id: 123446, name: 'XY Evolutions Booster Box', market: 2747.49 }],
}

const chosen: { id: string; kind: string; set: string; productId: number; market: number; label: string }[] = []
const missing: typeof rows = []
for (const row of rows) {
  if (row.id.includes('half-display') || row.id.includes('enhanced')) continue
  const set = sets.find((s) => s.setId === row.setId)
  const products = extraGroups[row.setId] ?? set?.products ?? []
  const candidate = products.find((p) => {
    if (p.market === null) return false
    const name = p.name.replace(/\s+/g, ' ').trim()
    if (row.kind === 'bundle') {
      if (!/Booster Bundle( \(LGS\))?$/i.test(name)) return false
      if (/Case|Display|Bulk|Surprise/i.test(name)) return false
      return true
    }
    if (!/Booster (Box|Display)$/i.test(name)) return false
    if (/Half|Enhanced|Case|Code/i.test(name)) return false
    return true
  })
  if (!candidate) { missing.push(row); continue }
  chosen.push({ id: row.id, kind: row.kind, set: row.setId, productId: candidate.id, market: candidate.market!, label: candidate.name })
}

for (const c of chosen) console.log(`${c.id}\t${c.kind}\t${c.productId}\t${c.market.toFixed(2)}\t${c.label}`)
console.log(`\nchosen ${chosen.length}, missing ${missing.length}`)
fs.writeFileSync('tmp/bundle-display-chosen.json', JSON.stringify(chosen, null, 2) + '\n')
fs.writeFileSync('tmp/bundle-display-missing.json', JSON.stringify(missing, null, 2) + '\n')
