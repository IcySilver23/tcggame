// One-off: classify Pokumon catalogue pages into the four Black Star Promo sets.
// Usage: node tmp/promo-scan.mjs <dir-with-html> <out.json>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const out = process.argv[3]

const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const files = readdirSync(dir).filter((f) => f.endsWith('.html'))
const rows = []
for (const f of files) {
  const html = readFileSync(join(dir, f), 'utf8')
  const re = /class="cl-element-title__anchor" href="https:\/\/pokumon\.com\/card\/([^"]+)">([\s\S]*?)<\/a>/g
  let m
  while ((m = re.exec(html))) {
    const slug = m[1]
    const title = decode(m[2].replace(/<[^>]*>/g, ''))
    rows.push({ slug, title })
  }
}

const seen = new Map()
for (const r of rows) seen.set(r.slug, r)
const unique = [...seen.values()]

const classify = (title) => {
  if (/Wizards Black Star/i.test(title)) return 'basep'
  if (/Nintendo Black Star/i.test(title)) return 'np'
  if (/\(HGSS\d/i.test(title)) return 'hsp'
  if (/\(DP\d/i.test(title)) return 'dpp'
  return null
}

const numOf = (title) => {
  const m = title.match(/\(([A-Za-z]*0*\d+[A-Za-z0-9-]*)/)
  if (!m) return null
  const raw = m[1]
  const prefix = raw.match(/^[A-Za-z]+/)?.[0] ?? ''
  const digits = raw.slice(prefix.length).replace(/^0+(?=\d)/, '')
  return `${prefix.toUpperCase()}${digits}`
}

const bySet = { basep: [], np: [], dpp: [], hsp: [] }
const other = []
for (const r of unique) {
  const set = classify(r.title)
  if (!set) continue
  const number = numOf(r.title)
  const english = /English/i.test(r.title)
  const entry = { number, name: r.title.replace(/\s*\([^)]*\)\s*$/, '').trim(), title: r.title, slug: r.slug, english }
  if (!english) other.push({ set, ...entry })
  else bySet[set].push(entry)
}

const summary = Object.fromEntries(
  Object.entries(bySet).map(([k, v]) => [k, { count: v.length, numbers: v.map((e) => e.number).sort() }]),
)
writeFileSync(out, JSON.stringify({ bySet, other, totalUnique: unique.length, summary }, null, 2))
console.log('pages', files.length, 'anchors', rows.length, 'unique', unique.length)
for (const [k, v] of Object.entries(bySet)) console.log(k, v.length, v.map((e) => e.number).join(','))
console.log('non-english skipped:', other.length, other.map((o) => `${o.set}:${o.number}`).join(','))
