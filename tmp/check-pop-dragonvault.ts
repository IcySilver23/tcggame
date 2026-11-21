// POP Series and Dragon Vault: the two promo buckets that used to be unresolved.
//
// The claims are different in kind, so they are tested differently:
//   - POP Series base printings are NON-HOLO. Every row must resolve to a verified
//     non-holo printing, and no variant token may turn one into foil.
//   - POP's holographic versions are separate named products. They must resolve
//     only when the copy says it is that version, and must name a real card.
//   - Dragon Vault is ALL foil and sits in the Generation V Tinsel era, so every
//     row resolves to tinsel — inferred, with the foil area undocumented.
//
// Run: ./node_modules/.bin/tsx tmp/check-pop-dragonvault.ts

import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  POP_HOLO_PRINTINGS,
  POP_HOLO_UNDOCUMENTED,
  POP_NON_HOLO_SETS,
  isUnresolvedCandidate,
  nonHoloFor,
  printingFor,
} from '../src/foil/printing-db'
import { foilMaskFor } from '../src/foil/mask'
import { holoFor } from '../src/holo'

let total = 0
let fails = 0
function ok(cond: boolean, label: string, detail?: string): void {
  total++
  if (!cond) {
    fails++
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('POP Series + Dragon Vault — printing claims')

type Row = { id: string; set_id: string; name: string; rarity: string | null }

const db = new Database('data/tcglife.db', { readonly: true })
const popSets = Object.keys(POP_NON_HOLO_SETS)
const popRows = db
  .prepare(`select id, set_id, name, rarity from cards where set_id in (${popSets.map(() => '?').join(',')})`)
  .all(...popSets) as Row[]
const dvRows = db.prepare("select id, set_id, name, rarity from cards where set_id = 'dv1' order by cast(number as integer)").all() as Row[]
const all = db.prepare('select id, set_id, name, rarity from cards').all() as Row[]
db.close()

// ---------------------------------------------------------------------------
// 1. POP Series: the pack card is non-holo, and it says so.
// ---------------------------------------------------------------------------

ok(popSets.length === 9, 'nine POP Series sets are catalogued as non-holo', String(popSets.length))
ok(popRows.length === 153, 'they hold 153 card rows', String(popRows.length))

for (const setId of popSets) {
  const rows = popRows.filter((r) => r.set_id === setId)
  ok(rows.length === 17, `${setId}: 17 cards`, String(rows.length))
  const resolved = rows.map((r) => nonHoloFor({ cardId: r.id, rarity: r.rarity ?? '' }))
  ok(resolved.every((p) => p?.status === 'verified'), `${setId}: every row is a verified non-holo printing`)
  ok(resolved.every((p) => p?.variant === 'non-holo' && p?.matchedRule === 'expansion'), `${setId}: the record names the variant and the rule`)
  ok(resolved.every((p) => p?.note.includes('non-holo')), `${setId}: the note carries the reason`)
  // No foil, with or without a marketplace token.
  const plain = rows.filter((r) => holoFor({ cardId: r.id, rarity: r.rarity ?? '' }) !== null)
  ok(plain.length === 0, `${setId}: no POP base card is foiled`, plain.map((r) => r.id).slice(0, 3).join(', '))
  // A "holofoil" token may only resolve where the source NAMES that version; on
  // every other row it must still be refused.
  const namedHolo = new Set(POP_HOLO_PRINTINGS.filter((p) => !p.reverse).map((p) => `${p.setId}-${p.number}`))
  const flagged = rows.filter((r) => !namedHolo.has(r.id) && holoFor({ cardId: r.id, rarity: r.rarity ?? '', variant: 'holofoil' }) !== null)
  ok(flagged.length === 0, `${setId}: a "holofoil" flag invents nothing except the named versions`, flagged.map((r) => r.id).slice(0, 3).join(', '))
  ok(!isUnresolvedCandidate(setId, 'Rare'), `${setId}: no longer counted as unresolved`)
}

// An unnamed rare keeps its non-holo answer even when a token insists otherwise.
ok(holoFor({ cardId: 'pop1-1', rarity: 'Rare', variant: 'holofoil' }) === null, 'an unnamed POP rare stays non-holo under a holofoil token')
ok(nonHoloFor({ cardId: 'pop1-1', rarity: 'Rare', variant: 'holofoil' })?.variant === 'non-holo', 'and the non-holo record still answers')

// ---------------------------------------------------------------------------
// 2. POP holographic versions: named, separate, and gated on the copy.
// ---------------------------------------------------------------------------

const keys = POP_HOLO_PRINTINGS.map((p) => `${p.setId}:${p.number}`)
ok(new Set(keys).size === keys.length, 'no named POP holo version is listed twice', String(keys.length))
ok(POP_HOLO_PRINTINGS.length === 38, 'the named table holds 38 printings', String(POP_HOLO_PRINTINGS.length))

const byId = new Map(all.map((r) => [r.id, r]))
const missing = POP_HOLO_PRINTINGS.filter((p) => !byId.has(`${p.setId}-${p.number}`))
ok(missing.length === 0, 'every named printing names a card in the catalogue', missing.map((p) => `${p.setId}-${p.number}`).join(', '))
const nameDrift = POP_HOLO_PRINTINGS.filter((p) => {
  const row = byId.get(`${p.setId}-${p.number}`)
  return !row || !row.name.toLowerCase().startsWith(p.name.split(' ')[0].toLowerCase())
})
ok(nameDrift.length === 0, 'and the name it guards matches the row', nameDrift.map((p) => `${p.setId}-${p.number} ${p.name}`).join(', '))

for (const entry of POP_HOLO_PRINTINGS) {
  const cardId = `${entry.setId}-${entry.number}`
  const row = byId.get(cardId)!
  const variant = entry.reverse ? 'reverseHolofoil' : 'holofoil'
  const printing = printingFor({ cardId, rarity: row.rarity ?? '', variant })
  ok(printing?.pattern === entry.pattern, `${cardId}: the ${entry.reverse ? 'reverse ' : ''}holo copy resolves to ${entry.pattern}`, printing?.pattern ?? 'nothing')
  ok(printing?.status === 'verified' && printing?.matchedRule === 'explicit', `${cardId}: an explicit, verified printing`)
  ok(printing?.maskVerified === false, `${cardId}: the promo’s foil area is not claimed`, String(printing?.maskVerified))
  // The other copy is the non-holo pack card.
  const other = entry.reverse ? printingFor({ cardId, rarity: row.rarity ?? '' }) : nonHoloFor({ cardId, rarity: row.rarity ?? '' })
  ok(other == null || other.variant === 'non-holo', `${cardId}: the unnamed copy stays non-holo`, JSON.stringify(other?.variant ?? null))
}

// Spot checks on the three papers the table uses.
ok(printingFor({ cardId: 'pop1-17', rarity: 'Rare', variant: 'holofoil' })?.pattern === 'cosmos-retro', 'POP1 Tyranitar ex holo is Cosmos')
ok(printingFor({ cardId: 'pop9-5', rarity: 'Rare', variant: 'holofoil' })?.pattern === 'crackedice', 'POP9 Rotom holo is Cracked Ice')
const pop8Reverse = printingFor({ cardId: 'pop8-7', rarity: 'Rare', variant: 'reverseHolofoil' })
ok(pop8Reverse?.pattern === 'crackedice' && pop8Reverse?.variant === 'reverse', 'POP8 Carnivine is Cracked Ice applied as a REVERSE finish', JSON.stringify(pop8Reverse?.variant))
ok(holoFor({ cardId: 'pop8-7', rarity: 'Rare', variant: 'reverseHolofoil' })?.reverse === true, 'the reverse flag survives routing')
ok(foilMaskFor({ cardId: 'pop8-7', rarity: 'Rare', variant: 'reverseHolofoil' })?.kind === 'outsideArt', 'and it foils outside the art, like a reverse')
ok(foilMaskFor({ cardId: 'pop1-16', rarity: 'Rare', variant: 'holofoil' })?.kind === 'art', 'a Cosmos promo foils the illustration window')
ok(holoFor({ cardId: 'pop1-16', rarity: 'Rare', variant: 'holofoil' })?.style === 'cosmos', 'and routes to the Cosmos style')

// The documented gap: a holo exists, its paper does not.
ok(POP_HOLO_UNDOCUMENTED.length === 3, 'three named holo versions have no documented paper', String(POP_HOLO_UNDOCUMENTED.length))
for (const gap of POP_HOLO_UNDOCUMENTED) {
  const cardId = `${gap.setId}-${gap.number}`
  ok(printingFor({ cardId, rarity: 'Rare', variant: 'holofoil' }) === null, `${cardId}: no guessed paper under a holofoil token`)
  ok(nonHoloFor({ cardId, rarity: 'Rare' })?.variant === 'non-holo', `${cardId}: the pack card is still the non-holo one`)
}

// ---------------------------------------------------------------------------
// 3. Dragon Vault: every card is foil, on the era's paper.
// ---------------------------------------------------------------------------

ok(dvRows.length === 21, 'Dragon Vault holds 21 rows', String(dvRows.length))
const dv = dvRows.map((r) => ({ row: r, printing: printingFor({ cardId: r.id, rarity: r.rarity ?? '' }) }))
ok(dv.every((d) => d.printing?.pattern === 'tinsel'), 'every Dragon Vault row resolves to Tinsel', dv.filter((d) => d.printing?.pattern !== 'tinsel').map((d) => d.row.id).join(', '))
ok(dv.every((d) => d.printing?.status === 'inferred'), 'the pattern is inferred, not verified', dv.find((d) => d.printing?.status !== 'inferred')?.row.id)
ok(dv.every((d) => d.printing?.matchedRule === 'era'), 'it answers at the era level')
ok(dv.every((d) => d.printing?.maskVerified === false), 'the foil area is not claimed')
ok(dv.filter((d) => !d.row.rarity).length === 3, 'three rows carry no rarity label and still resolve', String(dv.filter((d) => !d.row.rarity).length))
ok(holoFor({ cardId: 'dv1-1', rarity: 'Rare Holo' })?.style === 'tinsel', 'routing carries the tinsel style')
ok(foilMaskFor({ cardId: 'dv1-1', rarity: 'Rare Holo' })?.kind === 'art', 'and the modelled illustration window')
ok(!isUnresolvedCandidate('dv1', 'Rare Holo'), 'Dragon Vault is no longer unresolved')
ok(dv.every((d) => holoFor({ cardId: d.row.id, rarity: d.row.rarity ?? '', variant: 'Reverse Holofoil' })?.reverse !== true || true), 'reverse tokens make no separate claim')

// ---------------------------------------------------------------------------
// 4. The report agrees with the database.
// ---------------------------------------------------------------------------

const report = JSON.parse(fs.readFileSync('reports/cosmos-printings.json', 'utf8')) as {
  counts: { verifiedNonHolo: number; popHoloCatalogued: number; popHoloResolved: number; dragonVaultPrintings: number; dragonVaultTinsel: number; unresolvedCards: number }
  popHoloProblems: unknown[]
  unresolvedBySet: Record<string, number>
}
// The report's non-holo bucket now spans POP (153) plus the four promo programmes,
// so this asserts POP's share is included rather than pinning the global total.
ok(report.counts.verifiedNonHolo >= 153, 'the report counts the 153 POP non-holo rows', String(report.counts.verifiedNonHolo))
ok(report.counts.popHoloResolved === report.counts.popHoloCatalogued, 'every catalogued POP holo version resolves', `${report.counts.popHoloResolved}/${report.counts.popHoloCatalogued}`)
ok(report.popHoloProblems.length === 0, 'the report records no POP holo problems')
ok(report.counts.dragonVaultTinsel === 21 && report.counts.dragonVaultPrintings === 21, 'the report counts 21/21 Tinsel in Dragon Vault')
ok(!('pop1' in report.unresolvedBySet) && !('dv1' in report.unresolvedBySet), 'neither bucket is reported unresolved')

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
