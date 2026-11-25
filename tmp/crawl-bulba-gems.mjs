// Bulbapedia's six Gem Pack card lists, parsed row by row: the printed number
// ("01 03/07"), the card name and the printed Gem rarity. Each row links the card
// as "Name (Gem Pack Vol. N K)", so the name and its index come from the link.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const PAGES = [
  { vol: 1, url: 'https://bulbapedia.bulbagarden.net/wiki/Gem_Pack_Vol._1_(ATCG)' },
  { vol: 2, url: 'https://bulbapedia.bulbagarden.net/wiki/Gem_Pack_Vol._2_(ATCG)' },
  { vol: 3, url: 'https://bulbapedia.bulbagarden.net/wiki/Gem_Pack_Vol._3_(ATCG)' },
  { vol: 4, url: 'https://bulbapedia.bulbagarden.net/wiki/Gem_Pack_Vol._4_(ATCG)' },
  { vol: 5, url: 'https://bulbapedia.bulbagarden.net/wiki/Gem_Pack_Vol._5_(ATCG)' },
  { vol: 6, url: 'https://bulbapedia.bulbagarden.net/wiki/Gem_Pack_Vol._6_(ATCG)' },
]
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
fs.mkdirSync('tmp/gems', { recursive: true })

const decode = (s) =>
  s.replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/<[^>]*>/g, '').trim()

const out = []
for (const p of PAGES) {
  const file = `tmp/gems/bulba-${p.vol}.html`
  if (!fs.existsSync(file) || fs.statSync(file).size < 50000) {
    execFileSync('curl', ['-sSL', '-m', '60', '-A', UA, '-o', file, p.url], { stdio: 'inherit' })
  }
  const html = fs.readFileSync(file, 'utf8')
  const rows = html.split('<tr').slice(1)
  const cards = []
  for (const r of rows) {
    // Cells are: number, regulation mark, card name, type, rarity. Reading by
    // position is what the energy rows need — those link to "Basic Grass Energy
    // (TCG)", not to a "(Gem Pack Vol. 1 18)" article, so a title-based parse
    // silently dropped all six of them.
    const cells = [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => m[1])
    const num = (cells[0] ?? '').match(/(\d{2})\s+(\d{2})\/(\d{2})/)
    const rar = (cells[4] ?? r).match(/Gem (RRR|RR|R|U|C)\b/)
    const name = decode(cells[2] ?? '')
    if (!num || !rar || !name) continue
    cards.push({
      group: Number(num[1]),
      treatment: Number(num[2]),
      of: Number(num[3]),
      number: `${num[1]} ${num[2]}/${num[3]}`,
      name,
      rarity: `Gem ${rar[1]}`,
    })
  }
  // The same row can appear twice on a page (a "list" table and a gallery table);
  // key on the printed number and keep the first.
  const seen = new Map()
  for (const c of cards) if (!seen.has(c.number)) seen.set(c.number, c)
  const list = [...seen.values()].sort((a, b) => a.group - b.group || a.treatment - b.treatment)
  out.push({ vol: p.vol, cards: list })
  const byRarity = list.reduce((m, c) => ((m[c.rarity] = (m[c.rarity] ?? 0) + 1), m), {})
  console.log(`vol ${p.vol}: ${list.length} cards · groups ${new Set(list.map((c) => c.group)).size} · ${JSON.stringify(byRarity)}`)
}
fs.writeFileSync('tmp/gems/bulba.json', JSON.stringify(out, null, 1))
console.log('wrote tmp/gems/bulba.json')
