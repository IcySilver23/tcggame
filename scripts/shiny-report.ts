// Shiny tier report: what is identified, what is painted, and where the printing database
// still disagrees.
//
// Run: ./node_modules/.bin/tsx scripts/shiny-report.ts
//
// The report keeps four things apart on purpose:
//
//   identified   `src/foil/shiny-db.ts` names a paper, or says no source read here
//                names one. Every claim carries its own source and status.
//   area         where the foil lands, when a source says so. `pokemon-only` and
//                `various-parts` are documented areas this build cannot cut.
//   painted      `painted` below counts rows whose claim points at a sheet that already
//                ships: the Neo Revelation pair's Cosmos and the Radiant Pokémon etch.
//   agreement    `printing-db.ts` reads this table at branch 1g, so the last section is a
//                row-for-row comparison and an empty table is the goal. It is kept because
//                a later change to either file must show up here rather than silently
//                diverge.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { PATTERNS } from '../src/foil/patterns'
import { printingFor } from '../src/foil/printing-db'
import { surfaceFor } from '../src/foil/surface-textures'
import {
  SHINY_CLAIMS,
  SHINY_FAMILY_LABEL,
  SHINY_RARITIES,
  SHINY_ROW_TOTAL,
  SHINY_SETS,
  shinyClaimFor,
  shinyClaimsFor,
  shinyPatternFor,
  type ShinyClaim,
  type ShinyFamily,
} from '../src/foil/shiny-db'

type Row = { id: string; set_id: string; number: string; name: string; rarity: string | null }

const db = new Database('data/tcglife.db', { readonly: true })
const setList = SHINY_SETS.map(() => '?').join(',')
const rows = db
  .prepare(
    `select id, set_id, number, name, rarity from cards
     where set_id in (${setList}) order by set_id, cast(number as integer)`,
  )
  .all(...SHINY_SETS) as Row[]
const rarityList = SHINY_RARITIES.map(() => '?').join(',')
const named = db
  .prepare(
    `select id, set_id, number, name, rarity from cards
     where rarity in (${rarityList}) or name like 'Shining %'
     order by set_id, cast(number as integer)`,
  )
  .all(...SHINY_RARITIES) as Row[]
db.close()

const asCard = (row: Row) => ({ cardId: row.id, setId: row.set_id, rarity: row.rarity, name: row.name })

const problems: string[] = []
const multi: string[] = []
for (const row of named) {
  const matches = shinyClaimsFor(asCard(row))
  if (matches.length > 1) multi.push(`${row.id}: ${matches.map((m) => m.id).join(' + ')}`)
}

type ClaimRow = {
  cardId: string
  setId: string
  number: string
  name: string
  rarity: string | null
  /** False when `printing-db.ts` returns no printing at all for the row. */
  dbHasFoil: boolean
  /** What `printing-db.ts` answers today, so a divergence is visible. */
  dbPattern: string | null
  dbStatus: string | null
  dbMask: string | null
  agrees: boolean
}

const claims = SHINY_CLAIMS.map((claim: ShinyClaim) => {
  const members: ClaimRow[] = []
  for (const row of rows) {
    if (shinyClaimFor(asCard(row))?.id !== claim.id) continue
    const printing = printingFor({ cardId: row.id, rarity: row.rarity ?? undefined, name: row.name })
    const dbPattern = printing?.pattern ?? null
    // The claim's raw `pattern` may be null while the record is still foil; compare the
    // pattern the resolver derives, which is the same function printing-db.ts calls.
    members.push({
      cardId: row.id,
      setId: row.set_id,
      number: row.number,
      name: row.name,
      rarity: row.rarity,
      dbHasFoil: printing !== null,
      dbPattern,
      dbStatus: printing?.status ?? null,
      dbMask: printing?.mask ?? null,
      agrees: dbPattern === shinyPatternFor(claim),
    })
  }
  if (members.length !== claim.expected) {
    problems.push(`${claim.id}: ${members.length} rows in the catalogue, expected ${claim.expected}`)
  }
  return {
    id: claim.id,
    family: claim.family,
    label: claim.label,
    sets: [...claim.sets],
    rarities: claim.rarities ? [...claim.rarities] : null,
    paper: claim.paper,
    pattern: claim.pattern,
    area: claim.area,
    areaVerified: claim.areaVerified,
    status: claim.status,
    matchedRule: claim.matchedRule,
    source: claim.source,
    note: claim.note,
    expected: claim.expected,
    found: members.length,
    painted: claim.pattern !== null && PATTERNS[claim.pattern].implemented,
    members,
  }
})

const unclaimed = named.filter((row) => shinyClaimsFor(asCard(row)).length === 0)
const divergence = claims.flatMap((claim) =>
  claim.members
    .filter((m) => !m.agrees)
    .map((m) => ({
      cardId: m.cardId,
      claim: claim.id,
      claimPattern: claim.pattern,
      resolvedPattern: shinyPatternFor(claim),
      dbPattern: m.dbPattern,
      dbStatus: m.dbStatus,
      dbMask: m.dbMask,
    })),
)

const families = (Object.keys(SHINY_FAMILY_LABEL) as ShinyFamily[]).map((family) => {
  const own = claims.filter((c) => c.family === family)
  return {
    family,
    label: SHINY_FAMILY_LABEL[family],
    claims: own.length,
    rows: own.reduce((n, c) => n + c.found, 0),
    patterns: [...new Set(own.map((c) => c.pattern).filter((p): p is NonNullable<typeof p> => p !== null))],
    unresolvedRows: own.filter((c) => c.status === 'unresolved').reduce((n, c) => n + c.found, 0),
  }
})

const counts = {
  claims: claims.length,
  families: families.length,
  rows: claims.reduce((n, c) => n + c.found, 0),
  expectedRows: SHINY_ROW_TOTAL,
  rowsWithNamedPattern: claims.filter((c) => c.pattern !== null).reduce((n, c) => n + c.found, 0),
  rowsWhoseSheetShips: claims.filter((c) => c.painted).reduce((n, c) => n + c.found, 0),
  rowsWithVerifiedArea: claims.filter((c) => c.areaVerified).reduce((n, c) => n + c.found, 0),
  unresolvedRows: claims.filter((c) => c.status === 'unresolved').reduce((n, c) => n + c.found, 0),
  vaultReliefRows: claims
    .filter((c) => c.family === 'shiny-vault')
    .flatMap((c) => c.members)
    .filter((m) => surfaceFor({ rarity: m.rarity, cardId: m.cardId }) !== null).length,
  rowsWithoutFoilToday: claims
    .filter((c) => c.status !== 'unresolved')
    .flatMap((c) => c.members)
    .filter((m) => !m.dbHasFoil).length,
  divergenceRows: divergence.length,
  unclaimedRows: unclaimed.length,
  multiClaimRows: multi.length,
}

if (multi.length) problems.push(`${multi.length} rows satisfy more than one claim: ${multi.slice(0, 3).join(' | ')}`)
if (unclaimed.length) {
  problems.push(
    `${unclaimed.length} shiny rows are claimed by no family: ${unclaimed
      .slice(0, 5)
      .map((r) => `${r.id} (${r.rarity ?? '-'})`)
      .join(', ')}`,
  )
}

const familyTable = families
  .map((f) => `| ${f.label} | ${f.claims} | ${f.rows} | ${f.patterns.join(', ') || '—'} | ${f.unresolvedRows} |`)
  .join('\n')

const claimTable = claims
  .map(
    (c) =>
      `| \`${c.id}\` | ${c.sets.join(', ')} | ${c.rarities?.join(' / ') ?? 'name match'} | ${c.found} | ${c.paper} | ${c.pattern ? `\`${c.pattern}\`` : '—'} | ${c.area}${c.areaVerified ? '' : ' (unverified)'} | ${c.status} |`,
  )
  .join('\n')

const divergenceTable = divergence.length
  ? divergence
      .map((d) => `| \`${d.cardId}\` | \`${d.claim}\` | ${d.claimPattern ? `\`${d.claimPattern}\`` : '—'} | ${d.dbPattern ? `\`${d.dbPattern}\`` : 'none'} | ${d.dbStatus ?? '—'} |`)
      .join('\n')
  : '| — | — | — | — | — |'

const md = `# Shiny tier printings

Generated by \`scripts/shiny-report.ts\`.

**Identification.** This report names the paper behind each family and its evidence. Only two
of the named papers have a sheet that ships — Neo Revelation's Cosmos and Radiant Pokémon's
etch — and \`src/foil/printing-db.ts\` reads this table; the last section compares the two row
for row.

## Counts

| | |
| --- | --- |
| Families | ${counts.families} |
| Claims | ${counts.claims} |
| Catalogue rows in scope | ${counts.rows} of ${counts.expectedRows} expected |
| Rows whose claim names a pattern | ${counts.rowsWithNamedPattern} |
| Rows whose named sheet actually ships | ${counts.rowsWhoseSheetShips} |
| Rows with a source-verified foil area | ${counts.rowsWithVerifiedArea} |
| Rows left unresolved | ${counts.unresolvedRows} |
| Shiny Vault rows wearing an etched relief | ${counts.vaultReliefRows} |
| Rows the printing database gives no foil at all | ${counts.rowsWithoutFoilToday} |
| Rows the printing database answers differently | ${counts.divergenceRows} |
| Shiny rows claimed by no family | ${counts.unclaimedRows} |
| Rows satisfying two claims | ${counts.multiClaimRows} |

## Per family

| Family | Claims | Rows | Patterns named | Unresolved rows |
| --- | --- | --- | --- | --- |
${familyTable}

## Per claim

| Claim | Sets | Selector | Rows | Paper | Pattern | Area | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
${claimTable}

## Radiant is two different printings

**Radiant Collection** (Legendary Treasures RC, Generations RC, 2013) is \`radiant\`: one
reconstructed concept motif per RC card, 57 cards, already shipped. **Radiant Pokémon**
(Astral Radiance onward, 2022) is \`radiant-etched\`: etched, embossed silver across the whole
card, with the figure textured and a geometric pattern through the body. The two share a
word and nothing else, and no lookup may answer one with the other. The registry keeps both at
\`implemented: true\`, each with its own sheet and its own lookup.

## Shiny Vault names a finish, not a repeat

Shiny Vault cards are shiny printings whose finish is documented three ways. Bulbapedia says of
the Hidden Fates subset that "All have a special embossed Holofoil treatment"; the Shining Fates
page says its Shiny Pokémon "have a special embossed Holofoil treatment" while the product copy
promises "beautiful etched cards"; and for Paldean Fates Bleeding Cool reports that the "Baby
Shiny" cards carry a "holographic, silver, textured foil border" Japan did not get, which
PokéBeach confirms ("The shiny Pokemon in our set have holo borders ... Both feature textured
artwork"). So all ${families.find((f) => f.family === 'shiny-vault')?.rows ?? 0} of those rows resolve to \`special-treatment\` at
\`verified\`, and none claims an area: "border plus textured artwork" is not a mask this build can
cut.

Two rules keep that honest. The finish is never promoted to a repeat, so no sheet is borrowed.
And "Galaxy holo" — the name two collector guides use for these cards — is documented as
another name for **Cosmos**, the 2000–2011 paper; adopting it would put a 2011 sheet on a 2019
card. That is the same error as inheriting \`starlight\`, which stays refused because a starfield
look is not evidence of the 1999 Base/Jungle/Fossil sheet.

### A named paper was asked for, and refused

The question was put to the sources rather than left implied. Bulbapedia's Cosmos page opens
"**Cosmos Holofoil** (often referred to as **Galaxy Holofoil**)", and folio.fyi's pattern guide
answers it plainly — "galaxy is another name for cosmos" — while filing "textured or etched" as
relief "pressed into the card", **"not a fourteenth pattern"**. A collector guide that calls Shiny
Vault foil "Galaxy holo" is applying the Cosmos nickname to a modern finish; it is not evidence of
a separate sheet.

So the answer is a **refusal with reasons**, not a paint. No source read here names a paper distinct
from Cosmos for Hidden Fates, Shining Fates or Paldean Fates, and the only name on offer points at a
2000–2011 sheet. What would reopen it: a publisher or foil-stock statement naming the material, or a
macro photograph showing a repeat that is demonstrably not Cosmos (round orbs and swirls) on one of
these cards beside a Cosmos promo printed from the same stock.

### The finish is relief, so it can be drawn without a paper

\"Embossed\", \"etched\" and \"textured\" are words about the surface, not about the repeat, and the
renderer has a layer for exactly that. \`surface-textures.ts\` routes the Shiny Vault rarities
(\`Rare Shiny\`, \`Rare Shiny GX\`, \`Shiny Rare\`, \`Shiny Ultra Rare\`) to their own granular \`sparkle\`
normal map, and the photographs are why it is a grain rather than a lattice: no periodic repeat
survives at a 2700 px card width (\`reports/shiny-etch-photos.md\`),
so ${counts.vaultReliefRows} rows now catch a raking light over their illustration-window foil
instead of rendering flat. The pattern stays \`special-treatment\`: what ships is a surface, no
Cosmos or Starlight sheet is loaded, and the unnamed-finish report keeps the paper open. The relief
is modelled — the grain's scale, depth and strength are this build's drawing, \`verified: false\` on
the surface record — and Paldean Fates' documented silver border is still not modelled.

## Agreement with the printing database

Every claim above should equal what \`printing-db.ts\` answers for its rows. The table is kept
because a change to either file has to show up here: an empty table means the two agree, and a
row appearing in it means one of them moved without the other.

| Card | Claim | Claimed pattern | Printing database | Status |
| --- | --- | --- | --- | --- |
${divergenceTable}

## Sources

- Bulbapedia, Rarity: Shining Pokémon's foil on the Pokémon itself, Pokémon ★'s "golden
  tinges and holographic shadows", Radiant Pokémon's "special holofoil layer", the Shiny Rare
  rarity, and its Paldean Fates rendition.
- Bulbapedia, Cosmos Holofoil: Shining Gyarados and Shining Magikarp as Cosmos holofoils, and
  the page's own opening that Cosmos is "often referred to as Galaxy Holofoil" — the name two
  collector guides apply to the Shiny Vault finish.
- folio.fyi, "Pokémon Holo Patterns: A Visual Identification Guide": "galaxy is another name for
  cosmos", and textured or etched relief is "not a fourteenth pattern" but a treatment.
- Bulbapedia, Shining Pokémon (TCG): the Neo/Sun & Moon history and the Celebrations reprint.
- Flipside Gaming, "Shining Bright Like a Diamond: The Return of Shining Pokémon": Neo
  Revelation's Japanese full-card foil, and Neo Destiny's "unique metallic sheen covering the
  Pokémon itself", replicated in Shining Legends.
- Pokémon.com, Shining Legends Super-Premium Collection: the three Shining SM promo cards
  described only as foil promos.
- A collector foil guide: Radiant Pokémon as "etched, embossed silver foil covering the
  entire card" — appearance and area, not a repeat.
- Bulbapedia, Classic Collection (TCG): "Classic Collection cards have a textured confetti
  holofoil pattern", with a golden border in the Mega Evolution Series — the paper behind the
  2026 Shining Celebi reprint, which is the registry's \`confetti\` row.
- Bulbapedia, Shining Celebi (Neo Destiny 106): "The 30th Celebration reprint features a gold
  border, a glittery Holofoil finish, and the Pokémon 30th Anniversary logo."

## Validation

\`tmp/check-shiny.ts\` proves the per-claim catalogue counts, that every shiny row is claimed
exactly once, that Radiant Collection and Radiant Pokémon cannot be confused, that only Neo
Revelation's Cosmos and Radiant Pokémon's etch draw on a shipped sheet, that every Shiny Vault
row names a documented finish and no repeat, and that the 30th Celebration reprint resolves to
the Classic Collection's confetti paper rather than to a guess. No row is left unresolved.
`

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync(
  'reports/shiny-printings.json',
  JSON.stringify(
    {
      generated: 'scripts/shiny-report.ts',
      phase: 'Phase 12 — shiny tier identification',
      identificationOnly: true,
      counts,
      families,
      claims,
      unclaimed: unclaimed.map((r) => ({ cardId: r.id, setId: r.set_id, rarity: r.rarity, name: r.name })),
      divergence,
      problems,
    },
    null,
    2,
  ) + '\n',
)
fs.writeFileSync('reports/shiny-printings.md', md)

console.log(`Shiny tier: ${counts.rows}/${counts.expectedRows} rows across ${counts.claims} claims, ${counts.families} families`)
console.log(`  named patterns: ${counts.rowsWithNamedPattern} rows; shipping sheets: ${counts.rowsWhoseSheetShips}`)
console.log(`  verified areas: ${counts.rowsWithVerifiedArea}; unresolved: ${counts.unresolvedRows}`)
console.log(`  divergent from printing-db: ${counts.divergenceRows}; unclaimed: ${counts.unclaimedRows}`)
console.log(`  problems: ${problems.length}`)
for (const p of problems) console.log(`  - ${p}`)
if (problems.length) process.exit(1)
