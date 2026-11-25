// Fill in the prints the set page does not list (it stops at 100) by reading each
// card page, whose <title> carries the printed name and number:
//   "Basic Darkness Energy 11 06/06 – Gem Pack Vol. 2 (Simplified Chinese)"
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const parsed = JSON.parse(fs.readFileSync('tmp/gems/parsed.json', 'utf8'))
const TOTALS = { 1: 115, 2: 140, 3: 136, 4: 196, 5: 196, 6: 196 }
fs.mkdirSync('tmp/gems/cards', { recursive: true })

const decode = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim()

for (const v of parsed) {
  const total = TOTALS[v.vol]
  const known = new Map(v.prints.map((p) => [Number(p.cardId), p]))
  let fetched = 0
  for (let id = 1; id <= total + 5; id++) {
    if (known.has(id)) continue
    const file = `tmp/gems/cards/${v.vol}-${id}.html`
    if (!fs.existsSync(file) || fs.statSync(file).size < 5000) {
      execFileSync('curl', ['-sSL', '-m', '40', '-o', file, `https://www.artofpkm.com/sets/${v.artId}/card/${id}`], { stdio: 'inherit' })
      fetched++
    }
    const html = fs.readFileSync(file, 'utf8')
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
    const m = title.match(/^(.*?)\s+(\d{1,3})\s+(\d{1,3})\/(\d{1,3})\s+[–-]\s+Gem Pack/)
    if (!m) { if (id <= total) console.log(`  vol ${v.vol} id ${id}: no number in title (${title.slice(0, 60)})`); continue }
    const artist = html.match(/value="([^"]+)"[^>]*data-artist|href="\/illustrators\/[^"]*"[^>]*>([^<]+)</)
    known.set(id, {
      cardId: String(id),
      name: decode(m[1]),
      group: Number(m[2]),
      treatment: Number(m[3]),
      of: Number(m[4]),
      number: `${String(m[2]).padStart(2, '0')} ${String(m[3]).padStart(2, '0')}/${String(m[4]).padStart(2, '0')}`,
      artist: artist ? decode(artist[2] ?? '') || null : null,
    })
  }
  const prints = [...known.values()].sort((a, b) => Number(a.cardId) - Number(b.cardId))
  v.prints = prints
  const groups = new Map()
  for (const p of prints) {
    if (!groups.has(p.group)) groups.set(p.group, [])
    groups.get(p.group).push(p)
  }
  v.groups = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([g, ps]) => ({
    group: g,
    of: ps[0].of,
    n: ps.length,
    names: [...new Set(ps.map((p) => p.name))],
  }))
  console.log(`vol ${v.vol}: ${prints.length} prints (target ${total}) · ${groups.size} groups · ${fetched} card pages fetched`)
}

fs.writeFileSync('tmp/gems/parsed.json', JSON.stringify(parsed, null, 1))
console.log('\nvol 1 groups:', parsed[0].groups.map((g) => `${g.group}[${g.n}/${g.of}] ${g.names.join('/')}`).join(' | '))
console.log('\nvol 2 groups:', parsed[1].groups.map((g) => `${g.group}[${g.n}/${g.of}] ${g.names.join('/')}`).join(' | '))
