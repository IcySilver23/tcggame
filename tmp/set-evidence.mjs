// One-off: what do the catalogues call these sets, and what do the set pages say?
import { readFileSync, readdirSync } from 'node:fs'

const load = (f) => JSON.parse(readFileSync(f, 'utf8'))
const cosmos = load('tmp/promo/cosmos.json')
const nonholo = load('tmp/promo/nonholo.json')
const all = [...Object.values(cosmos.bySet).flat(), ...(cosmos.other ?? []), ...Object.values(nonholo.bySet).flat(), ...(nonholo.other ?? [])]

console.log('catalogue entries scanned:', all.length)
for (const [label, re] of [
  ['BW', /BW\s*\d|\bBW\b/i],
  ['Best of Game', /best of game/i],
  ['Rumble', /rumble/i],
  ['Southern Islands', /southern islands/i],
]) {
  const hits = all.filter((e) => re.test(e.title))
  console.log(`\n${label}: ${hits.length}`)
  for (const h of hits.slice(0, 6)) console.log('   ', h.title, '|', h.slug)
}

const strip = (html) => {
  const body = html.slice(html.indexOf('mw-parser-output'))
  return body
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<\/(tr|p|div|li|h2|h3|td)>/g, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

for (const f of readdirSync('tmp/promo/sets')) {
  const lines = strip(readFileSync(`tmp/promo/sets/${f}`, 'utf8'))
  const hits = lines.filter((l) => /holo|foil/i.test(l))
  console.log(`\n## ${f} — ${hits.length} foil lines`)
  for (const h of hits.slice(0, 14)) console.log('  ', h.slice(0, 260))
}
