// One-off: classify every Wizards/Nintendo/DP/HGSS promo row against Pokumon's
// Cosmos and Non-holo catalogues, and write the per-card claim table.
// Usage: node tmp/promo-match.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import Database from 'better-sqlite3'

const norm = (number) => {
  const m = String(number).match(/^([A-Za-z]*)(\d+)/)
  return m ? `${m[1].toUpperCase()}${Number(m[2])}` : String(number).toUpperCase()
}

const load = (p) => JSON.parse(readFileSync(p, 'utf8')).bySet
const cosmos = load('tmp/promo/cosmos.json')
const nonholo = load('tmp/promo/nonholo.json')

const index = (bySet) => {
  const out = new Map()
  for (const [set, rows] of Object.entries(bySet)) {
    for (const r of rows) {
      const key = `${set}:${norm(r.number)}`
      if (!out.has(key)) out.set(key, [])
      out.get(key).push(r)
    }
  }
  return out
}
const cosmosIdx = index(cosmos)
const nonholoIdx = index(nonholo)

const db = new Database('data/tcglife.db', { readonly: true })
const cards = db
  .prepare("select id, set_id, name, number, rarity from cards where set_id in ('basep','np','dpp','hsp') order by set_id, cast(number as integer)")
  .all()

const claims = []
const unclaimed = []
for (const c of cards) {
  const key = `${c.set_id}:${norm(c.number)}`
  const cHits = cosmosIdx.get(key) ?? []
  const nHits = nonholoIdx.get(key) ?? []
  if (cHits.length) {
    claims.push({ setId: c.set_id, id: c.id, number: c.number, name: c.name, treatment: 'cosmos', sourceTitles: cHits.map((h) => h.title), alsoNonHolo: nHits.length > 0 })
  } else if (nHits.length) {
    claims.push({ setId: c.set_id, id: c.id, number: c.number, name: c.name, treatment: 'non-holo', sourceTitles: nHits.map((h) => h.title) })
  } else {
    unclaimed.push({ setId: c.set_id, id: c.id, number: c.number, name: c.name })
  }
}

const bySet = {}
for (const s of ['basep', 'np', 'dpp', 'hsp']) {
  const rows = claims.filter((c) => c.setId === s)
  bySet[s] = {
    total: cards.filter((c) => c.set_id === s).length,
    cosmos: rows.filter((r) => r.treatment === 'cosmos').length,
    nonHolo: rows.filter((r) => r.treatment === 'non-holo').length,
    unclaimed: unclaimed.filter((c) => c.setId === s).length,
    alsoNonHolo: rows.filter((r) => r.alsoNonHolo).length,
  }
}

writeFileSync('tmp/promo/claims.json', JSON.stringify({ bySet, claims, unclaimed }, null, 2))
console.log(JSON.stringify(bySet, null, 2))
console.log('unclaimed rows:', unclaimed.length, JSON.stringify(unclaimed.slice(0, 40)))
console.log('unmatched cosmos entries (in catalogue, not in DB):')
for (const [key] of cosmosIdx) {
  const [set, num] = key.split(':')
  if (!cards.some((c) => c.set_id === set && norm(c.number) === num)) console.log(' ', key)
}
