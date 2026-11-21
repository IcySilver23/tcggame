// δ Delta Species holo rares are plain foil, and the card row can now tell.
//
// Run: ./node_modules/.bin/tsx tmp/check-delta-species.ts
//
// The roadmap's bug B3 said these cards were undetectable and therefore painted with
// Cosmos. This suite proves the closure end to end:
//
//   1. the shipped index is exactly what the catalogue says (no card left behind, none
//      invented, same order);
//   2. every indexed card resolves to `plain-holo`, not Cosmos, through both holoFor and
//      the printing database, with the illustration-window mask;
//   3. the index does not swallow its neighbours: Rare Holo EX, Gold Star, a non-δ holo
//      rare of the same era, POP4's cosmic Deoxys δ and a reverse printing all answer
//      with their own paper;
//   4. the renderer really draws plain foil: the mark field for an indexed card is null
//      (uniform light), and the registry has no sheet for the paper;
//   5. the paper is registered as implemented-but-plain so the registry check can excuse
//      it by name rather than by silence.

import Database from 'better-sqlite3'
import { DELTA_SPECIES_HOLO_RARES, DELTA_SPECIES_COUNTS, DELTA_SPECIES_SETS } from '../src/foil/delta-species-index'
import { printingFor } from '../src/foil/printing-db'
import { holoFor } from '../src/holo'
import { foilMaskFor } from '../src/foil/mask'
import { loadMarkFieldFor } from '../src/foil/mark-field'
import { PATTERNS } from '../src/foil/patterns'

let checks = 0
const failures: string[] = []
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) failures.push(msg)
}

// ---------------------------------------------------------------------------
// 1. The index is the catalogue's answer, not a copy of itself
// ---------------------------------------------------------------------------
const db = new Database('data/tcglife.db', { readonly: true })
const rows = db
  .prepare(
    `SELECT id, set_id, number, name FROM cards
     WHERE set_id IN (${DELTA_SPECIES_SETS.map(() => '?').join(',')})
       AND rarity = 'Rare Holo' AND name LIKE '%δ%'
     ORDER BY set_id, CAST(number AS INTEGER)`,
  )
  .all(...DELTA_SPECIES_SETS) as { id: string; set_id: string; number: string; name: string }[]
db.close()

ok(rows.length > 0, 'the catalogue has δ holo rares to index')
ok(
  JSON.stringify(rows.map((r) => r.id)) === JSON.stringify(DELTA_SPECIES_HOLO_RARES.map((r) => r.cardId)),
  `the shipped index matches the catalogue (${DELTA_SPECIES_HOLO_RARES.length} vs ${rows.length}) — rerun scripts/delta-species-index.ts`,
)
ok(DELTA_SPECIES_COUNTS.total === rows.length, 'the reported total matches the catalogue')
ok(
  Object.entries(DELTA_SPECIES_COUNTS.bySet).every(([set, n]) => rows.filter((r) => r.set_id === set).length === n),
  'the per-set counts match the catalogue',
)
ok(
  DELTA_SPECIES_HOLO_RARES.every((r) => r.name.includes('δ')),
  'every indexed card actually carries the δ marker in its name',
)

// ---------------------------------------------------------------------------
// 2. Every indexed card is plain foil, through every path
// ---------------------------------------------------------------------------
let plain = 0
for (const row of DELTA_SPECIES_HOLO_RARES) {
  const printing = printingFor({ cardId: row.cardId, rarity: 'Rare Holo', name: row.name })
  ok(printing?.pattern === 'plain-holo', `${row.cardId}: the database resolves plain-holo, got ${printing?.pattern ?? 'null'}`)
  ok(printing?.mask === 'art' && printing?.maskVerified === false, `${row.cardId}: the area is the modelled window, not a verified claim`)
  ok(printing?.status === 'verified', `${row.cardId}: the paper claim is verified`)
  const art = holoFor({ cardId: row.cardId, rarity: 'Rare Holo' })
  ok(art?.pattern === 'plain-holo' && art?.reverse === false, `${row.cardId}: holoFor carries plain-holo, got ${art?.pattern ?? 'null'}`)
  const mask = foilMaskFor({ cardId: row.cardId, rarity: 'Rare Holo' })
  ok(mask?.kind === 'art', `${row.cardId}: the foil area is the illustration window, got ${mask?.kind ?? 'null'}`)
  const field = await loadMarkFieldFor({ cardId: row.cardId, rarity: 'Rare Holo' })
  ok(field === null, `${row.cardId}: the mark field is null — plain foil borrows no sheet, got ${field?.id ?? 'null'}`)
  plain++
}
ok(plain === DELTA_SPECIES_HOLO_RARES.length, 'every indexed card was checked on every path')

// ---------------------------------------------------------------------------
// 3. The neighbours keep their own paper
// ---------------------------------------------------------------------------
const ex = printingFor({ cardId: 'ex15-90', rarity: 'Rare Holo EX' })
ok(ex?.pattern === 'cosmos-retro', `a δ Pokémon-ex keeps Cosmos, got ${ex?.pattern ?? 'null'}`)
const star = printingFor({ cardId: 'ex15-100', rarity: 'Rare Holo Star' })
ok(star?.pattern === 'special-treatment', `a δ ★ keeps its unresolved special treatment, got ${star?.pattern ?? 'null'}`)
const plainRare = printingFor({ cardId: 'ex14-1', rarity: 'Rare Holo' })
ok(plainRare?.pattern === 'cosmos-retro', `a non-δ holo rare of the same era keeps Cosmos, got ${plainRare?.pattern ?? 'null'}`)
const deoxys = printingFor({ cardId: 'pop4-2', rarity: 'Rare', variant: 'holofoil' })
ok(deoxys?.pattern === 'cosmos-retro', `POP4's cosmic Deoxys δ still resolves Cosmos, got ${deoxys?.pattern ?? 'null'}`)
const reverse = holoFor({ cardId: 'ex11-1', rarity: 'Rare Holo', variant: 'reverseHolofoil' })
ok(
  typeof reverse?.pattern === 'string' && reverse.pattern.startsWith('reverse-'),
  `a reverse of a δ card keeps the set's reverse paper, got ${reverse?.pattern ?? 'null'}`,
)
const unknownDelta = printingFor({ cardId: 'np-35', rarity: 'Promo' })
ok(unknownDelta?.pattern !== 'plain-holo', "a δ promo outside the four expansions is not swept in")

// ---------------------------------------------------------------------------
// 4. The registry states the paper honestly
// ---------------------------------------------------------------------------
const row = PATTERNS['plain-holo']
ok(!!row, 'plain-holo is a registry row')
ok(row?.implemented === true, 'plain-holo reports implemented')
ok(!row?.texture, 'plain-holo declares no sheet — there is nothing to draw')
ok(/plain/i.test(row?.note ?? ''), 'its note says the paper is plain rather than missing')

if (failures.length > 0) {
  console.error(failures.map((f) => `FAIL ${f}`).join('\n'))
  process.exit(1)
}
console.log(`delta-species: ${checks} checks passed — ${DELTA_SPECIES_HOLO_RARES.length} δ holo rares resolve plain foil, neighbours unchanged`)
