// One-off: gather evidence for the four remaining unresolved buckets.
// 1. Mine the already-crawled Pokumon catalogues for these sets.
// 2. Ask TCGdex for each card's variant record (holo / normal / reverse).
import { readFileSync, writeFileSync } from 'node:fs'
import Database from 'better-sqlite3'

const SETS = ['bp', 'bwp', 'ru1', 'si1']
const db = new Database('data/tcglife.db', { readonly: true })
const rows = db
  .prepare(`select id, set_id, number, name, rarity from cards where set_id in (${SETS.map(() => '?').join(',')}) order by set_id, rowid`)
  .all(...SETS)
db.close()

const norm = (n) => {
  const m = String(n).match(/^([A-Za-z]*)(\d+)/)
  return m ? `${m[1].toUpperCase()}${Number(m[2])}` : String(n).toUpperCase()
}

// Titles like "Zekrom (BW05 English Promo)", "Frost Rotom (Best of Game 1)",
// "Pikachu (Southern Islands 1)".
const classify = (title) => {
  if (/\(BW\d/i.test(title) || /BW Black Star/i.test(title)) return 'bwp'
  if (/Best of Game/i.test(title)) return 'bp'
  if (/Rumble/i.test(title)) return 'ru1'
  if (/Southern Islands/i.test(title)) return 'si1'
  return null
}
const numOf = (title) => {
  const m = title.match(/\((?:BW|HGSS|DP)?\s*0*(\d+)/i)
  return m ? Number(m[1]) : null
}

const catalogue = { bwp: new Map(), bp: new Map(), ru1: new Map(), si1: new Map() }
for (const [file, treatment] of [
  ['tmp/promo/cosmos.json', 'cosmos'],
  ['tmp/promo/nonholo.json', 'non-holo'],
]) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  const all = [...Object.values(data.bySet).flat(), ...(data.other ?? [])]
  for (const entry of all) {
    const set = classify(entry.title)
    if (!set) continue
    const n = numOf(entry.title)
    if (n === null) continue
    const key = `${set}:${n}`
    if (!catalogue[set].has(key)) catalogue[set].set(key, [])
    catalogue[set].get(key).push({ treatment, title: entry.title, english: entry.english })
  }
}

const fetchVariants = async (id) => {
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/en/cards/${id}`)
    if (!res.ok) return null
    const j = await res.json()
    return { id, name: j.name, rarity: j.rarity, variants: j.variants ?? null }
  } catch {
    return null
  }
}

const variants = []
for (let i = 0; i < rows.length; i += 8) {
  const batch = rows.slice(i, i + 8)
  variants.push(...(await Promise.all(batch.map((r) => fetchVariants(r.id)))))
}

writeFileSync('tmp/promo/variants.json', JSON.stringify(variants, null, 2))

const summary = {}
for (const set of SETS) {
  const setRows = rows.filter((r) => r.set_id === set)
  const v = variants.filter((x) => x && x.id.startsWith(`${set}-`))
  const tally = {}
  for (const card of v) {
    const key = card.variants
      ? Object.entries(card.variants).filter(([, b]) => b).map(([k]) => k).sort().join('+') || 'none'
      : 'no-record'
    tally[key] = (tally[key] ?? 0) + 1
  }
  summary[set] = {
    rows: setRows.length,
    tcgdex: v.length,
    tally,
    catalogue: {
      cosmos: [...catalogue[set].values()].filter((l) => l.some((e) => e.treatment === 'cosmos')).length,
      nonHolo: [...catalogue[set].values()].filter((l) => l.some((e) => e.treatment === 'non-holo')).length,
    },
  }
}
writeFileSync('tmp/promo/bucket-summary.json', JSON.stringify({ summary, rows, catalogue: Object.fromEntries(Object.entries(catalogue).map(([k, m]) => [k, [...m.entries()]])) }, null, 2))
console.log(JSON.stringify(summary, null, 2))
