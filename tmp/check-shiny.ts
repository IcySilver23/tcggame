// Phase 12: the shiny tier's papers, identified and then wired into the database.
//
// Run: ./node_modules/.bin/tsx tmp/check-shiny.ts
//
// The checks follow the claims, not the code:
//   - each family's catalogue rows are counted, and every shiny row is claimed exactly
//     once — a new set with a shiny rarity cannot slip in unclaimed;
//   - the four Shining products stay apart: Neo Revelation is Cosmos in the window,
//     Neo Destiny and Shining Legends put the foil on the Pokémon, and the 2026 reprint
//     wears the Classic Collection's named confetti paper;
//   - Gold Star stays an unnamed gold paper with no rectangle, and Radiant Pokémon is
//     not Radiant Collection;
//   - Shiny Vault names an embossed finish but no repeat, and borrows neither Starlight
//     nor Cosmos — the label "Galaxy holo" is documented as another name for Cosmos;
//   - and the printing database, the mask and holoFor answer with those claims.
//
// Read-only: it renders nothing.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { PATTERNS } from '../src/foil/patterns'
import { printingFor } from '../src/foil/printing-db'
import { foilMaskFor } from '../src/foil/mask'
import { holoFor } from '../src/holo'
import {
  SHINY_CLAIMS,
  SHINY_FAMILY_LABEL,
  SHINY_RARITIES,
  SHINY_ROW_TOTAL,
  SHINY_SETS,
  shinyClaimFor,
  shinyClaimsFor,
  shinyPatternFor,
} from '../src/foil/shiny-db'

let total = 0
let fails = 0
function ok(cond: boolean, label: string, detail?: string): void {
  total++
  if (!cond) {
    fails++
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('Shiny tier — identification and resolution')

type Row = { id: string; set_id: string; number: string; name: string; rarity: string | null }
const db = new Database('data/tcglife.db', { readonly: true })
const setList = SHINY_SETS.map(() => '?').join(',')
const rows = db
  .prepare(`select id, set_id, number, name, rarity from cards where set_id in (${setList})`)
  .all(...SHINY_SETS) as Row[]
const rarityList = SHINY_RARITIES.map(() => '?').join(',')
const shinyNamed = db
  .prepare(
    `select id, set_id, number, name, rarity from cards
     where rarity in (${rarityList}) or name like 'Shining %'`,
  )
  .all(...SHINY_RARITIES) as Row[]
const rcCards = db
  .prepare("select id, set_id, number, name from cards where number like 'RC%' limit 10")
  .all() as { id: string; set_id: string; number: string; name: string }[]
db.close()

const asCard = (row: Row) => ({ cardId: row.id, setId: row.set_id, rarity: row.rarity, name: row.name })

// ---------------------------------------------------------------------------
// 1. The table is well formed
// ---------------------------------------------------------------------------
ok(SHINY_CLAIMS.length === 11, 'eleven claims cover the tier', String(SHINY_CLAIMS.length))
ok(new Set(SHINY_CLAIMS.map((c) => c.id)).size === SHINY_CLAIMS.length, 'claim ids are unique')
ok(SHINY_ROW_TOTAL === 377, 'the table expects 377 catalogue rows', String(SHINY_ROW_TOTAL))
ok(SHINY_CLAIMS.every((c) => c.expected > 0), 'no claim is empty')
ok(
  SHINY_CLAIMS.every((c) => /^https:\/\//.test(c.source)),
  'every claim names an https source',
)
ok(
  SHINY_CLAIMS.every((c) => c.note.length >= 80),
  'every claim explains itself in a sentence',
)
ok(
  Object.keys(SHINY_FAMILY_LABEL).length === 4,
  'four families: Shining, Gold Star, Radiant Pokémon, Shiny Vault',
)
for (const family of Object.keys(SHINY_FAMILY_LABEL) as (keyof typeof SHINY_FAMILY_LABEL)[]) {
  ok(SHINY_CLAIMS.some((c) => c.family === family), `${SHINY_FAMILY_LABEL[family]} has at least one claim`)
}

// Every rarity a claim selects is in the sweep list, or the unclaimed check can miss a row.
const declared = new Set(SHINY_RARITIES)
const undeclared = [...new Set(SHINY_CLAIMS.flatMap((c) => c.rarities ?? []))].filter((r) => !declared.has(r))
ok(undeclared.length === 0, 'every selected rarity is in the sweep list', undeclared.join(', '))

// Every name-selected claim also names its card ids, so resolution never depends on a
// caller remembering to pass the card's name.
ok(
  SHINY_CLAIMS.every((c) => !c.namePattern || (c.cardIds?.length ?? 0) > 0),
  'a name-selected claim also carries explicit card ids',
)

// ---------------------------------------------------------------------------
// 2. The catalogue agrees row for row
// ---------------------------------------------------------------------------
for (const claim of SHINY_CLAIMS) {
  const found = rows.filter((row) => shinyClaimFor(asCard(row))?.id === claim.id)
  ok(
    found.length === claim.expected,
    `${claim.id}: ${claim.expected} rows in the catalogue`,
    `found ${found.length}`,
  )
  if (claim.cardIds) {
    const missing = claim.cardIds.filter((id) => !found.some((r) => r.id === id))
    ok(missing.length === 0, `${claim.id}: every named card id is in the catalogue`, missing.join(', '))
  }
}

const multi = shinyNamed.filter((row) => shinyClaimsFor(asCard(row)).length > 1)
ok(multi.length === 0, 'no shiny row satisfies two claims', multi.map((r) => r.id).join(', '))

const unclaimed = shinyNamed.filter((row) => shinyClaimsFor(asCard(row)).length === 0)
ok(
  unclaimed.length === 0,
  'every shiny row is claimed by a family',
  unclaimed.map((r) => `${r.id} ${r.rarity ?? '-'}`).join(', '),
)

const totalClaimed = SHINY_CLAIMS.reduce(
  (n, claim) => n + rows.filter((row) => shinyClaimFor(asCard(row))?.id === claim.id).length,
  0,
)
ok(totalClaimed === SHINY_ROW_TOTAL, 'the claims account for every expected row', String(totalClaimed))

// ---------------------------------------------------------------------------
// 3. Shining is four products, not one paper
// ---------------------------------------------------------------------------
const neoRev = SHINY_CLAIMS.find((c) => c.id === 'shining-neo-revelation')!
const neoDest = SHINY_CLAIMS.find((c) => c.id === 'shining-neo-destiny')!
const legends = SHINY_CLAIMS.find((c) => c.id === 'shining-legends')!

ok(neoRev.pattern === 'cosmos-retro', 'Neo Revelation Shining is Cosmos', String(neoRev.pattern))
ok(neoRev.area === 'art-window' && neoRev.areaVerified, 'and the foil is the illustration window, verified')
ok(neoRev.status === 'verified' && neoRev.matchedRule === 'explicit', 'and the claim is explicit')

ok(neoDest.pattern === null, 'Neo Destiny names no sheet', String(neoDest.pattern))
ok(neoDest.area === 'pokemon-only' && neoDest.areaVerified, 'its foil is the Pokémon itself, verified')
ok(neoDest.status === 'verified' && neoDest.matchedRule === 'explicit', 'the treatment is still an explicit claim')

ok(legends.pattern === null, 'Shining Legends names no sheet either', String(legends.pattern))
ok(legends.area === 'pokemon-only', 'and repeats the Neo Destiny area', legends.area)

const celebrations = SHINY_CLAIMS.find((c) => c.id === 'shining-celebrations-magikarp')!
ok(celebrations.pattern === null, 'the Celebrations reprint names no sheet')
ok(!celebrations.areaVerified, 'and claims no area the source did not restate')

const thirtieth = SHINY_CLAIMS.find((c) => c.id === 'shining-30th-celebi')!
ok(
  thirtieth.status === 'verified' && thirtieth.matchedRule === 'explicit',
  'the 2026 reprint names the Classic Collection paper',
  `${thirtieth.status}/${thirtieth.matchedRule}`,
)
ok(thirtieth.pattern === 'confetti', 'which is the registry confetti row', String(thirtieth.pattern))
ok(
  thirtieth.pattern !== 'cosmos-retro' && thirtieth.pattern !== 'cosmos-hd',
  'never the HD Cosmos the set used to be modelled as',
)
ok(!thirtieth.areaVerified, 'and claims no area the source did not state')
ok(/textured confetti/.test(thirtieth.note), 'the note quotes the pattern')

const promos = SHINY_CLAIMS.find((c) => c.id === 'shining-sm-promos')!
const promoRows = rows.filter((row) => shinyClaimFor(asCard(row))?.id === promos.id).map((r) => r.id)
ok(promoRows.length === 3, 'three SM Black Star Shining promos are catalogued', promoRows.join(', '))
ok(
  ['smp-SM70', 'smp-SM79', 'smp-SM82'].every((id) => promoRows.includes(id)),
  'the three are Ho-Oh, Celebi and Lugia',
  promoRows.join(', '),
)
ok(promos.pattern === null && !promos.areaVerified, 'their paper and area stay unnamed')

// ---------------------------------------------------------------------------
// 4. Gold Star is gold, and "various parts" is not a rectangle
// ---------------------------------------------------------------------------
const star = SHINY_CLAIMS.find((c) => c.id === 'gold-star')!
ok(star.expected === 25, 'twenty-five Gold Star rows', String(star.expected))
const starRows = rows.filter((row) => shinyClaimFor(asCard(row))?.id === star.id)
ok(starRows.length === 25, 'and the catalogue holds twenty-five', String(starRows.length))
ok(new Set(starRows.map((r) => r.set_id)).size === 9, 'across nine EX sets', String(new Set(starRows.map((r) => r.set_id)).size))
ok(star.pattern === 'special-treatment', "the paper is the registry's special-treatment", String(star.pattern))
ok(PATTERNS['special-treatment'].implemented === false, 'which ships no texture, so these render plain foil')
ok(star.area === 'various-parts' && !star.areaVerified, 'the area is unverified: "various parts" is not a mask')
ok(starRows.every((r) => r.rarity === 'Rare Holo Star'), 'every row carries the Rare Holo Star rarity')

// ---------------------------------------------------------------------------
// 5. Radiant Pokémon is not Radiant Collection
// ---------------------------------------------------------------------------
const radiant = SHINY_CLAIMS.find((c) => c.id === 'radiant-pokemon')!
ok(radiant.expected === 15, 'fifteen Radiant Pokémon rows', String(radiant.expected))
ok(radiant.pattern === 'radiant-etched', 'they wear radiant-etched', String(radiant.pattern))
ok(radiant.pattern !== 'radiant', 'never the Radiant Collection pattern')
ok(radiant.area === 'whole-card' && radiant.areaVerified, 'the foil is the whole card, on a source')
ok(PATTERNS['radiant-etched'].implemented === true, 'and its etched sheet ships')
ok(PATTERNS['radiant-etched'].family === 'chase', 'the registry files it as a chase paper')
ok(PATTERNS.radiant.label === 'Radiant Collection', 'radiant is still Radiant Collection')
ok(PATTERNS.radiant.implemented === true, 'and still ships its per-card motifs')
ok(
  PATTERNS['radiant-etched'].label !== PATTERNS.radiant.label,
  'the two labels cannot be mistaken for each other',
)
const radiantIds = new Set(rows.filter((row) => shinyClaimFor(asCard(row))?.id === radiant.id).map((r) => r.id))
ok(radiantIds.size === 15, 'all fifteen resolve to this claim', String(radiantIds.size))
ok(
  ['swsh10-27', 'swsh11-123', 'swsh12-120', 'swsh12pt5-105', 'pgo-11'].every((id) => radiantIds.has(id)),
  'one row from each of the five sets is here',
)
ok(rcCards.length > 0, 'the catalogue holds Radiant Collection cards to compare against')
ok(
  rcCards.every((card) => shinyClaimsFor({ cardId: card.id, setId: card.set_id, rarity: null, name: card.name }).length === 0),
  'no Radiant Collection card matches a shiny claim',
  rcCards.map((c) => c.id).join(', '),
)

// ---------------------------------------------------------------------------
// 6. Shiny Vault names a finish, never a repeat
// ---------------------------------------------------------------------------
const vault = SHINY_CLAIMS.filter((c) => c.family === 'shiny-vault')
ok(vault.length === 3, 'three Shiny Vault products are catalogued', String(vault.length))
ok(vault.reduce((n, c) => n + c.expected, 0) === 316, '316 shiny rows in total')
ok(vault.every((c) => c.pattern === null), 'none names a repeat')
ok(
  vault.every((c) => c.status === 'verified' && c.matchedRule === 'explicit'),
  'all three name their finish, verified',
)
ok(vault.every((c) => !c.areaVerified && c.area === 'unspecified'), 'and none claims an area')
ok(
  vault.every((c) => shinyPatternFor(c) === 'special-treatment'),
  'each resolves to the registry stand-in for an identified paper with no sheet',
)
ok(
  vault.every((c) => c.pattern !== 'starlight' && shinyPatternFor(c) !== 'cosmos-retro'),
  'no row borrows the 1999 Starlight sheet or the 2000-2011 Cosmos sheet',
)
ok(
  vault.every((c) => /embossed|etched|textured/.test(c.note)),
  'every note quotes the documented finish',
)
ok(
  vault.every((c) => /another name for Cosmos/.test(c.note)),
  'and every note refuses the Galaxy label by name',
)
ok(vault.every((c) => /^https:\/\//.test(c.source) && c.source !== SHINY_CLAIMS[0]!.source), 'each names its own source', vault.map((c) => c.source).join(', '))
ok(
  new Set(vault.map((c) => c.source)).size === 3,
  'the three sets cite different pages',
  vault.map((c) => c.source).join(', '),
)

// ---------------------------------------------------------------------------
// 7. Only one claim points at a sheet that ships
// ---------------------------------------------------------------------------
const usedPatterns = [...new Set(SHINY_CLAIMS.map((c) => c.pattern).filter((p): p is NonNullable<typeof p> => p !== null))]
ok(
  usedPatterns.sort().join(',') === 'confetti,cosmos-retro,radiant-etched,special-treatment',
  'four patterns are named in all',
  usedPatterns.join(', '),
)
const shippedUsed = usedPatterns.filter((p) => PATTERNS[p].implemented)
ok(
  shippedUsed.sort().join(',') === 'confetti,cosmos-retro,radiant-etched',
  'three of the named papers are painted: Neo Revelation’s Cosmos, Radiant Pokémon’s etch and the Classic Collection’s confetti',
  shippedUsed.join(', '),
)
const paintedRows = SHINY_CLAIMS.filter((c) => c.pattern !== null && PATTERNS[c.pattern].implemented).reduce(
  (n, c) => n + c.expected,
  0,
)
ok(paintedRows === 18, 'so eighteen rows of 377 have a sheet to draw with', String(paintedRows))

// ---------------------------------------------------------------------------
// 8. The database, the mask and holoFor all answer with the claims
// ---------------------------------------------------------------------------
const get = (cardId: string, rarity?: string, name?: string, variant?: string) =>
  printingFor({ cardId, rarity, name, variant })

{
  const p = get('neo3-65', 'Rare Shining', 'Shining Gyarados')
  ok(p?.pattern === 'cosmos-retro', 'Neo Revelation resolves to Cosmos', String(p?.pattern))
  ok(p?.mask === 'art' && p?.maskVerified === true, 'with the illustration window, verified')
  ok(p?.status === 'verified' && p?.matchedRule === 'explicit', 'as an explicit verified claim')
  ok(p?.paper === 'classic_dense', 'and names the retro Cosmos sheet')
}
{
  const p = get('neo4-107', 'Rare Shining', 'Shining Charizard')
  ok(p?.pattern === 'special-treatment', 'Neo Destiny resolves to the special treatment it can honestly draw', String(p?.pattern))
  ok(p?.status === 'verified', 'with the treatment verified')
  ok(p?.mask === 'art' && p?.maskVerified === false, 'and the window marked an approximation, not the documented area')
  ok(/Pokémon only/.test(p?.note ?? ''), 'the note says the foil is the Pokémon and the window is an approximation')
}
{
  const p = get('sm35-40', 'Rare Shining', 'Shining Mew')
  ok(p?.pattern === 'special-treatment', 'Shining Legends now has the same treatment', String(p?.pattern))
  ok(p !== null, 'instead of no foil at all')
}
{
  const p = get('ex7-107', 'Rare Holo Star', 'Mudkip ★')
  ok(p?.pattern === 'special-treatment', 'Gold Star keeps its unnamed gold paper', String(p?.pattern))
  ok(p?.status === 'verified' && p?.matchedRule === 'explicit', 'now stated as the verified treatment a source describes')
  ok(p?.maskVerified === false, 'and the window stays unverified: "various parts" is not a rectangle')
}
{
  const p = get('swsh10-27', 'Radiant Rare', 'Radiant Heatran')
  ok(p?.pattern === 'radiant-etched', 'Radiant Pokémon resolves to radiant-etched', String(p?.pattern))
  ok(p?.pattern !== 'radiant', 'never Radiant Collection')
  ok(p?.mask === 'full' && p?.maskVerified === true, 'over the whole card, verified')
  ok(p?.variant === 'special', 'as a special printing', String(p?.variant))
}
{
  const p = get('sv4pt5-212', 'Shiny Ultra Rare', 'Forretress ex')
  ok(p?.pattern === 'special-treatment', 'a Shiny Vault row resolves to its documented treatment', String(p?.pattern))
  ok(p?.status === 'verified' && p?.matchedRule === 'explicit', 'as a verified explicit claim', `${p?.status}/${p?.matchedRule}`)
  ok(p !== null, 'and is foil rather than plain card')
  ok(p?.mask === 'art' && p?.maskVerified === false, 'with no area claimed: the window is an approximation', `${p?.mask}/${p?.maskVerified}`)
  ok(/textured foil|embossed|etched/.test(p?.note ?? ''), 'and the note states the documented finish')
  ok(/Cosmos/.test(p?.note ?? ''), 'and refuses the Galaxy label')
}
{
  const p = get('me55c-106', 'Rare Secret', 'Shining Celebi')
  ok(p?.pattern === 'confetti', 'the 2026 reprint resolves to the Classic Collection paper', String(p?.pattern))
  ok(p?.status === 'verified' && p?.matchedRule === 'explicit', 'as a verified explicit printing', `${p?.status}/${p?.matchedRule}`)
  ok(p?.mask === 'art' && p?.maskVerified === false, 'with no area claimed', `${p?.mask}/${p?.maskVerified}`)
  ok(/textured confetti/.test(p?.note ?? ''), 'and the note quotes the source')
  ok(p?.pattern !== 'cosmos-hd' && p?.pattern !== 'cosmos-retro', 'and it is no longer painted as Cosmos')
}
{
  const p = get('cel25c-66_A', 'Classic Collection', 'Shining Magikarp')
  ok(p?.pattern === 'special-treatment', 'the Celebrations reprint is a special treatment', String(p?.pattern))
  ok(p?.status === 'verified', 'because its finish is named', String(p?.status))
}
{
  const p = get('smp-SM70', 'Promo', 'Shining Ho-Oh')
  ok(p?.pattern === 'special-treatment' && p?.variant === 'promo', 'a Shining promo keeps the promo variant', `${p?.pattern}/${p?.variant}`)
  ok(p?.product === 'Black Star Promo', 'and is sold as a Black Star Promo', String(p?.product))
}

// Resolution must not need the card's name: mask.ts and holo.ts call without one.
ok(get('me55c-106', 'Rare Secret')?.pattern === 'confetti', 'a reprint resolves with no name supplied')
ok(get('smp-SM82', 'Promo')?.pattern === 'special-treatment', 'and so does a Shining promo')
ok(get('sv4pt5-92', 'Shiny Rare')?.pattern === 'special-treatment', 'a Shiny Rare resolves by set and rarity alone')

// A reverse flag cannot invent a reverse printing of any of these families.
for (const [id, rarity] of [
  ['neo3-65', 'Rare Shining'],
  ['neo4-106', 'Rare Shining'],
  ['sm35-40', 'Rare Shining'],
  ['ex7-107', 'Rare Holo Star'],
  ['swsh10-27', 'Radiant Rare'],
  ['sv4pt5-92', 'Shiny Rare'],
]) {
  ok(get(id, rarity, undefined, 'reverseHolofoil') === null, `${id}: a reverse flag resolves nothing`)
}

// The mask and holoFor read the same claims.
{
  const mask = foilMaskFor({ cardId: 'swsh10-27', rarity: 'Radiant Rare' })
  ok(mask?.kind === 'full' && mask.verified === true, 'the mask is the whole card for Radiant Pokémon')
  const approx = foilMaskFor({ cardId: 'neo4-106', rarity: 'Rare Shining' })
  ok(approx?.kind === 'art' && approx.verified === false, 'the mask is the window and unverified for Neo Destiny')
  const cosmos = foilMaskFor({ cardId: 'neo3-65', rarity: 'Rare Shining' })
  ok(cosmos?.kind === 'art' && cosmos.verified === true, 'the mask is the window and verified for Neo Revelation')

  ok(holoFor({ cardId: 'sm35-40', rarity: 'Rare Shining' }) !== null, 'Shining Legends is foil again')
  ok(holoFor({ cardId: 'sv4pt5-92', rarity: 'Shiny Rare' }) !== null, 'a Shiny Rare is foil')
  ok(holoFor({ cardId: 'swsh10-27', rarity: 'Radiant Rare' })?.pattern === 'radiant-etched', 'Radiant Pokémon carries its pattern through holoFor')
  ok(holoFor({ cardId: 'neo3-65', rarity: 'Rare Shining' })?.style === 'cosmos', 'Neo Revelation renders on the Cosmos style')
}

// ---------------------------------------------------------------------------
// 9. The report agrees with the database
// ---------------------------------------------------------------------------
{
  const reportPath = 'reports/shiny-printings.json'
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as {
      counts: {
        rows: number
        divergenceRows: number
        unclaimedRows: number
        rowsWithoutFoilToday: number
      }
      divergence: { cardId: string; claimPattern: string | null; dbPattern: string | null }[]
      problems: string[]
    }
    ok(report.counts.rows === SHINY_ROW_TOTAL, 'the report counts every expected row', String(report.counts.rows))
    ok(report.counts.unclaimedRows === 0, 'and reports no unclaimed shiny row')
    ok(report.problems.length === 0, 'and found no problems', report.problems.join(' | '))
    ok(
      report.divergence.length === 0,
      'every claim now equals what the printing database answers',
      report.divergence.slice(0, 3).map((d) => `${d.cardId}: ${d.claimPattern} vs ${d.dbPattern}`).join(' | '),
    )
    ok(report.counts.divergenceRows === 0, 'and the report counts no divergence', String(report.counts.divergenceRows))
    ok(report.counts.rowsWithoutFoilToday === 0, 'no claim is left without a foil', String(report.counts.rowsWithoutFoilToday))
  } else {
    ok(false, 'reports/shiny-printings.json exists (run scripts/shiny-report.ts first)')
  }
}

console.log(`\n${total - fails} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
