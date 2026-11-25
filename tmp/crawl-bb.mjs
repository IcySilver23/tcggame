// Simplified Chinese Black Bolt (CSV10.5C) and White Flare (CSV10.6C).
//
// Bulbapedia keeps both in one article, "Black Bolt & White Flare (TCG)", with a
// single card-list table: Black Bolt runs 001/086 to 174/086, then the numbering
// restarts and White Flare runs the same. The split is where the first column
// returns to 001/086, not a row count, so a stray row cannot shift a set.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
const file = 'tmp/bb-both.html'
if (!fs.existsSync(file) || fs.statSync(file).size < 500000) {
  execFileSync('curl', ['-sSL', '-m', '90', '-A', UA, '-o', file, 'https://bulbapedia.bulbagarden.net/wiki/Black_Bolt_%26_White_Flare_(TCG)'], { stdio: 'inherit' })
}
const html = fs.readFileSync(file, 'utf8')
const start = html.indexOf('id="Card_list"')
const end = html.indexOf('id="Gallery"')
if (start < 0 || end < 0) throw new Error('card list section not found')
const seg = html.slice(start, end)

const decode = (s) => s.replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').trim()
const rows = []
for (const r of seg.split('<tr>').slice(1)) {
  const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1])
  const num = decode((cells[0] ?? '').replace(/<[^>]*>/g, ''))
  if (!/^\d{3}\/\d{3}$/.test(num)) continue
  const nameCell = cells[2] ?? ''
  // Some rows (Basic Energy, and the odd Trainer) have no card article to link, so
  // the name is the cell's own text rather than an anchor's.
  const linked = nameCell.match(/<a[^>]*>([^<]+)<\/a>/)
  const name = decode(linked ? linked[1] : nameCell.replace(/<[^>]*>/g, ''))
  // Rarity is an image whose alt text names the grade; Bulbapedia uses the same
  // grade names the English catalogue does.
  const rarity = (r.match(/alt="([A-Za-z ]+)" src="[^"]*Rarity/) ?? [])[1] ?? null
  // The type cell is a coloured <th> whose text is Bulbapedia's abbreviation:
  // energy types for a Pokémon, I/Su/St for a Trainer, E/Sp for an Energy card.
  const type = decode((r.match(/<th[^>]*>([^<]{1,4})<\/th>/) ?? [])[1] ?? '') || null
  if (!name) { rows.push(null); continue }
  rows.push({ number: num, name, rarity, type })
}
const first = rows.filter(Boolean)
const restart = first.findIndex((r, i) => i > 0 && r.number === '001/086')
const sets = [
  { set: 'Black Bolt', code: 'CSV10.5C', cards: first.slice(0, restart) },
  { set: 'White Flare', code: 'CSV10.6C', cards: first.slice(restart) },
]
for (const s of sets) {
  const byRarity = s.cards.reduce((m, c) => ((m[c.rarity] = (m[c.rarity] ?? 0) + 1), m), {})
  const nums = s.cards.map((c) => Number(c.number.split('/')[0]))
  const contiguous = nums.every((n, i) => n === i + 1)
  console.log(`${s.set} (${s.code}): ${s.cards.length} cards · contiguous ${contiguous} · ${JSON.stringify(byRarity)}`)
  const secrets = s.cards.filter((c) => Number(c.number.split('/')[0]) > 86)
  console.log('  secrets sample:', secrets.slice(0, 3).map((c) => `${c.number} ${c.name} [${c.rarity}]`).join(' | '))
  const named = s.cards.filter((c) => /N's Plan|Hilda/.test(c.name))
  console.log('  N\'s Plan / Hilda:', named.map((c) => `${c.number} ${c.name} [${c.rarity}]`).join(' | '))
  console.log('  tail:', s.cards.slice(-6).map((c) => `${c.number} ${c.name} [${c.rarity}]`).join(' | '))
  const types = s.cards.reduce((m, c) => ((m[c.type] = (m[c.type] ?? 0) + 1), m), {})
  console.log('  types:', JSON.stringify(types))
}
fs.writeFileSync('tmp/gems/bb.json', JSON.stringify(sets, null, 1))
console.log('wrote tmp/gems/bb.json')
