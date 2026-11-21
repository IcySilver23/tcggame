import fs from 'node:fs'
import Database from 'better-sqlite3'

const text = fs.readFileSync('tmp/bb-jina.txt', 'utf8')
const start = text.indexOf('## List of Build & Battle Boxes')
const end = text.indexOf('## Build & Battle Stadium')
const body = text.slice(start, end === -1 ? undefined : end)

const db = new Database('data/tcglife.db', { readonly: true })
const sets = db.prepare('SELECT id, name FROM sets').all()
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const byName = new Map(sets.map((s) => [norm(s.name), s]))
const pad = (n, w) => String(n).padStart(w, '0')

const rows = []
for (const line of body.split('\n')) {
  if (!line.startsWith('| [![Image')) continue
  const nameMatch = line.match(/\| \[([^\]]*(?:Build & Battle Box|Prerelease Kit))\]\(https:\/\/bulbapedia[^)]*\)/)
  if (!nameMatch) continue
  const imageMatch = line.match(/\((https:\/\/archives\.bulbagarden\.net\/media\/upload\/thumb\/[^)]+)\)/)
  const expansion = nameMatch[1].replace(/ (Build & Battle Box|Prerelease Kit)$/, '')
  const set = byName.get(norm(expansion))
  const cell = line.slice(line.indexOf(nameMatch[0]) + nameMatch[0].length)
  const promos = []
  for (const entry of cell.split('* ').slice(1)) {
    const names = [...entry.matchAll(/\[([^\]]+)\]\((https:\/\/bulbapedia\.bulbagarden\.net\/wiki\/(?!File:)[^\s"]+)/g)]
    const last = names[names.length - 1]
    if (!last) continue
    const before = entry.slice(0, entry.lastIndexOf(last[0]))
    const num = before.match(/([A-Z]{1,4}\d{1,3}|\d{1,3}(?:\/\d{1,3})?)\s*$/)?.[1] ?? null
    const block = entry.match(/(XY|SM|SWSH|SVP|MEP)_Black_Star_Promos/)?.[1] ?? null
    let id = null
    if (num) {
      if (block === 'XY') id = `xyp-XY${pad(num.replace(/\D/g, ''), 2)}`
      else if (block === 'SM') id = `smp-SM${pad(num.replace(/\D/g, ''), 2)}`
      else if (block === 'SWSH') id = `swshp-SWSH${pad(num.replace(/\D/g, ''), 3)}`
      else if (block === 'SVP') id = `svp-${Number(num)}`
      else if (block === 'MEP') id = `mep-${pad(num.replace(/\D/g, ''), 3)}`
      else if (/^\d+\/\d+$/.test(num) && set) id = `${set.id}-${Number(num.split('/')[0])}`
    }
    const exists = id ? db.prepare('SELECT 1 FROM cards WHERE id = ?').get(id) : null
    promos.push({ number: num, name: last[1], link: last[2], block, id, exists: Boolean(exists) })
  }
  rows.push({ product: nameMatch[1], expansion, image: imageMatch ? imageMatch[1] : null, setId: set?.id ?? null, setName: set?.name ?? null, promos })
}

fs.writeFileSync('tmp/bb-parsed.json', JSON.stringify(rows, null, 2))
console.log('rows', rows.length)
for (const r of rows) {
  const miss = r.promos.filter((p) => !p.exists).map((p) => `${p.number} ${p.name}->${p.id ?? '?'}`)
  console.log(`${r.setId ?? 'NO-SET'}\t${r.expansion}\tpromos=${r.promos.length}\tmissing=${miss.join(', ') || 'none'}`)
}
