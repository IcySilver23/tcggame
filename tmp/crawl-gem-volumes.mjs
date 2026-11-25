// Crawl artofpkm's print lists for Gem Pack Vol. 1-6.
//
// The Chinese line numbers a card by GROUP and TREATMENT — "01 01/09" is group 01,
// treatment 01 of 09 — so the group number, the denominator and the treatment index
// all have to come from the printed card, not from an assumed seven-per-Pokémon
// rule. Every volume is crawled and the raw HTML kept, so a re-run is offline.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const VOLUMES = [
  { vol: 1, setId: 'cbb1', artId: 796, code: 'CBB1C', released: '2025/01/17' },
  { vol: 2, setId: 'cbb2', artId: 801, code: 'CBB2C', released: '2025/05/16' },
  { vol: 3, setId: 'cbb3', artId: 809, code: 'CBB3C', released: '2025/09/26' },
  { vol: 4, setId: 'cbb4', artId: 815, code: 'CBB4C', released: '2026/02/06' },
  { vol: 5, setId: 'cbb5', artId: 818, code: 'CBB5C', released: '2026/04/24' },
  { vol: 6, setId: 'cbb6', artId: 825, code: 'CBB6C', released: '2026/08/07' },
]

fs.mkdirSync('tmp/gems', { recursive: true })

const decode = (s) =>
  s
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim()

function fetchPage(url, file) {
  if (!fs.existsSync(file) || fs.statSync(file).size < 20000) {
    execFileSync('curl', ['-sSL', '-m', '60', '-o', file, url], { stdio: 'inherit' })
  }
  return fs.readFileSync(file, 'utf8')
}

const out = []
for (const v of VOLUMES) {
  const html = fetchPage(`https://www.artofpkm.com/sets/${v.artId}`, `tmp/gems/vol${v.vol}.html`)
  const articles = html.match(/<article[\s\S]*?<\/article>/g) ?? []
  const prints = []
  for (const a of articles) {
    const card = a.match(/href="\/sets\/\d+\/card\/([^"]+)"/)
    const name = a.match(/<h3[^>]*>([^<]+)<\/h3>/)
    const num = a.match(/whitespace-nowrap[^"]*">\s*([0-9]{1,3})\s+([0-9]{1,3})\/([0-9]{1,3})\s*</)
    if (!card || !name || !num) continue
    const artist = a.match(/href="\/illustrators\/[^"]*"[^>]*>([^<]+)</)
    prints.push({
      cardId: card[1],
      name: decode(name[1]),
      group: Number(num[1]),
      treatment: Number(num[2]),
      of: Number(num[3]),
      number: `${String(num[1]).padStart(2, '0')} ${String(num[2]).padStart(2, '0')}/${String(num[3]).padStart(2, '0')}`,
      artist: artist ? decode(artist[1]) : null,
    })
  }
  const groups = new Map()
  for (const p of prints) {
    if (!groups.has(p.group)) groups.set(p.group, [])
    groups.get(p.group).push(p)
  }
  out.push({ ...v, prints, groups: [...groups.entries()].map(([g, ps]) => ({ group: g, of: ps[0].of, n: ps.length, name: ps[0].name })) })
  console.log(`vol ${v.vol}: ${prints.length} prints · ${groups.size} groups · titles ${[...new Set(prints.map((p) => p.name))].length}`)
  const weird = [...groups.entries()].filter(([, ps]) => ps.length !== ps[0].of)
  if (weird.length) console.log('  groups whose prints != denominator:', weird.map(([g, ps]) => `${g}:${ps.length}/${ps[0].of}`).join(' '))
}

fs.writeFileSync('tmp/gems/parsed.json', JSON.stringify(out, null, 1))
console.log('wrote tmp/gems/parsed.json')
