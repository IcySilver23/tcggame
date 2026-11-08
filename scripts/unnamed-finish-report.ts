// Unnamed finishes: one evidence record per card whose foil is identified but not named.
//
// Run: ./node_modules/.bin/tsx scripts/unnamed-finish-report.ts
//
// `scripts/unpainted-report.ts` answers "which papers ship no sheet". This answers the
// next question down: of the cards that render plain foil because their paper is unnamed,
// what does a source actually say about each one, and what would a source have to name
// before the card could be painted?
//
// The set is defined by the renderer, not by a list: a card is in this report when the
// catalogue sweep resolves it to `special-treatment`. That is the registry row for "the
// finish is documented, the paper is not", and it is deliberately the only row that means
// it — `unresolved` says even the finish is unknown, and it is reported separately.
//
// Every row carries:
//   - identity (card id, set, number, name, rarity, variant);
//   - provenance (the claim or rule that resolved it, its status, matched rule and source);
//   - KNOWN, in the sources' own terms: the finish, its area, and whether the area is
//     documented;
//   - NEEDS: the specific evidence that would let the paper be named and the area cut.
//
// Nothing here paints, and nothing here changes a claim. It is a reading aid over the same
// database the renderer uses, generated so it cannot drift from it.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { holoFor } from '../src/holo'
import { printingFor } from '../src/foil/printing-db'
import { shinyClaimFor, type ShinyArea } from '../src/foil/shiny-db'

const problems: string[] = []

type CardRow = { id: string; set_id: string; number: string; rarity: string | null; name: string }

const AREA_LABEL: Record<ShinyArea, string> = {
  'art-window': 'the illustration window',
  'pokemon-only': 'the Pokémon itself only — not cuttable without subject segmentation',
  'whole-card': 'the whole face',
  'various-parts': '“various parts” — not a rectangle',
  unspecified: 'not stated by any source',
}

/**
 * What is known and what is missing, per family.
 *
 * These are the same sentences for every card in a family on purpose: the sources speak per
 * printing family, not per card, and inventing a per-card sentence would imply evidence that
 * does not exist. The JSON repeats them per row so a record can be read alone.
 */
type Family = { label: string; known: string; needs: string; source: string }

const FAMILIES: Record<string, Family> = {
  'shiny-vault-hidden-fates': {
    label: 'Shiny Vault · Hidden Fates',
    known:
      '“All have a special embossed Holofoil treatment.” The finish is documented; the repeat and the foil area are not. The finish is drawn as relief: these rarities now wear the granular sparkle surface, so the card renders embossed while its paper stays unnamed.',
    needs:
      'A source naming the paper behind the embossed treatment — its marks, pitch or density — and stating the foiled area. The search is on record: Bulbapedia calls Cosmos “often referred to as Galaxy Holofoil” and folio.fyi confirms galaxy is another name for cosmos, so the collector label cannot be promoted. A publisher or foil-stock statement, or a macro photograph showing a repeat that is not Cosmos, would reopen it.',
    source: 'Bulbapedia, Hidden Fates (TCG)',
  },
  'shiny-vault-shining-fates': {
    label: 'Shiny Vault · Shining Fates',
    known:
      'The Shiny Rare rarity “is used for all cards in the Shiny Vault subset”, and those cards “have a special embossed Holofoil treatment”, promised in product copy as “beautiful etched cards”. No repeat, no area. The finish is drawn as relief: these rarities now wear the granular sparkle surface.',
    needs:
      'A source naming the etched paper and its repeat, plus the foiled area. “Galaxy holo” is refused for the same reason as Hidden Fates — it names Cosmos — and folio.fyi files “textured or etched” as relief rather than a printed pattern, so a repeat has to be demonstrated before either can be drawn.',
    source: 'Bulbapedia, Shining Fates (TCG)',
  },
  'shiny-vault-paldean-fates': {
    label: 'Shiny Vault · Paldean Fates',
    known:
      'A “holographic, silver, textured foil border” that Japan did not get, with “textured artwork” on the shiny cards. The treatment is documented outside Bulbapedia; the repeat is not. The finish is drawn as relief: these rarities now wear the granular sparkle surface; the documented silver border is still not modelled.',
    needs:
      'A source naming the paper of that silver border and of the textured artwork, plus the area — a border plus textured artwork is not a rectangle this build can cut. The only name collectors offer for the family is “Galaxy holo”, which Bulbapedia and folio.fyi both document as another name for Cosmos.',
    source: 'Bleeding Cool and PokéBeach, Paldean Fates set guide',
  },
  'gold-star': {
    label: 'Pokémon ★ (Gold Star)',
    known:
      '“Golden tinges and holographic shadows are added to various parts of the card.” The treatment is documented; “various parts” is not a rectangle and no source names the paper.',
    needs:
      'A source naming the gold-tinted paper, stating the foiled area, and a scan of a Gold Star card so the mask can be cut. Until then the illustration window must not be assumed.',
    source: 'Bulbapedia, Rarity',
  },
  'shining-neo-destiny': {
    label: 'Shining Pokémon · Neo Destiny',
    known:
      'A “unique metallic sheen covering the Pokémon itself” — the area is documented, the paper is not. Cosmos must not answer here.',
    needs:
      'A source naming the sheen’s paper and what carries it (a sheen may be a surface rather than a mark sheet), plus a tilted photograph of a card.',
    source: 'Flipside Gaming; Bulbapedia, Shining Pokémon (TCG)',
  },
  'shining-legends': {
    label: 'Shining Pokémon · Shining Legends',
    known:
      'The Neo Destiny look repeated, described as “special textured foil”; the paper stays unnamed and no texture is borrowed.',
    needs:
      'A source naming the paper of the repeated sheen, and whether it is the same physical treatment as Neo Destiny or a new one.',
    source: 'Flipside Gaming; Bulbapedia',
  },
  'shining-celebrations-magikarp': {
    label: 'Shining · Celebrations reprint',
    known:
      '“Special textured foil treatment” on this reprint. The finish is named; neither the paper nor the area is restated.',
    needs:
      'A source naming the treatment’s paper and the foiled area on this specific reprint, rather than inheriting Neo Destiny’s area.',
    source: 'Bulbapedia, Shining Pokémon (TCG)',
  },
  'shining-sm-promos': {
    label: 'Shining · SM Black Star Promos',
    known:
      'Product copy says only “foil promo card”. Neither the paper nor the area is claimed, so nothing is borrowed.',
    needs:
      'A source naming the promo’s foil paper and its area; the product copy claims neither, so there is no claim to extend.',
    source: 'Pokémon, Shining Legends Super-Premium Collection',
  },
  'lvx': {
    label: 'LV.X · era special treatment',
    known:
      'LV.X is a special treatment recorded as unresolved: the foil is not the era paper, and no source read here names it. No Cosmos is applied.',
    needs:
      'A source that names the LV.X finish and its area. There is no paper claim yet, so the record has nothing to paint and draws plain foil.',
    source: 'Bulbapedia, Holofoil',
  },
  'bwp-pokeball': {
    label: 'BW promo · Poké Ball reverse',
    known:
      'Bucketed as a Poké Ball reverse printing (BW Black Star Promos). The ball reverse is a documented treatment, but this card’s paper inside the ball has no drawn sheet.',
    needs:
      'A source naming the Poké Ball reverse paper for this promo, or a photograph of its reverse face so the interior can be measured.',
    source: 'Pokumon, holofoil taxonomy',
  },
}

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db.prepare('select id, set_id, number, rarity, name from cards order by id').all() as CardRow[]
db.close()

type Record_ = {
  cardId: string
  setId: string
  number: string
  name: string
  rarity: string | null
  variant: string
  family: string
  familyLabel: string
  claimId: string | null
  pattern: string
  mask: string
  maskVerified: boolean
  status: string
  matchedRule: string
  source: string
  known: string
  needs: string
  area: string
  areaVerified: boolean
}

const records: Record_[] = []

for (const row of rows) {
  const art = holoFor({ cardId: row.id, rarity: row.rarity ?? undefined })
  if (!art) continue
  const printing = printingFor({
    cardId: row.id,
    rarity: row.rarity ?? undefined,
    name: row.name,
    variant: art.reverse ? 'reverseHolofoil' : undefined,
  })
  const pattern = printing?.pattern ?? art.pattern ?? null
  if (pattern !== 'special-treatment') continue

  const claim = shinyClaimFor({ cardId: row.id, setId: row.set_id, rarity: row.rarity, name: row.name })
  let family: string
  if (claim) family = claim.id
  else if (/lv\.x/i.test(row.rarity ?? '')) family = 'lvx'
  else if (row.set_id === 'bwp') family = 'bwp-pokeball'
  else family = 'unaccounted'

  const meta = FAMILIES[family]
  if (!meta) {
    problems.push(`${row.id}: resolved to special-treatment but belongs to no known family`)
  }

  records.push({
    cardId: row.id,
    setId: row.set_id,
    number: row.number,
    name: row.name,
    rarity: row.rarity,
    variant: printing?.variant ?? 'holo',
    family,
    familyLabel: meta?.label ?? family,
    claimId: claim?.id ?? null,
    pattern,
    mask: printing?.mask ?? 'art',
    maskVerified: printing?.maskVerified ?? false,
    status: printing?.status ?? 'unresolved',
    matchedRule: printing?.matchedRule ?? 'unresolved',
    source: claim?.source ?? meta?.source ?? printing?.source ?? '',
    known: claim ? `${claim.paper}. ${meta?.known ?? ''}`.trim() : meta?.known ?? '',
    needs: meta?.needs ?? '',
    area: claim ? AREA_LABEL[claim.area] : AREA_LABEL.unspecified,
    areaVerified: claim?.areaVerified ?? false,
  })
}

// ---------------------------------------------------------------------------
// Consistency: a record is only useful if it says something on both sides.
// ---------------------------------------------------------------------------

for (const r of records) {
  if (!r.known.trim()) problems.push(`${r.cardId}: no record of what is known`)
  if (!r.needs.trim()) problems.push(`${r.cardId}: no record of what a source would need`)
  if (!r.source.trim()) problems.push(`${r.cardId}: no source for the claim`)
}
const ids = new Set(records.map((r) => r.cardId))
if (ids.size !== records.length) problems.push('a card appears twice in the record')

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------

type Group = {
  family: string
  label: string
  known: string
  needs: string
  source: string
  cards: Record_[]
  sets: string[]
  statuses: Record<string, number>
  areas: Record<string, number>
}

const groups = new Map<string, Group>()
for (const r of records) {
  const g = groups.get(r.family) ?? {
    family: r.family,
    label: r.familyLabel,
    known: FAMILIES[r.family]?.known ?? '',
    needs: FAMILIES[r.family]?.needs ?? '',
    source: FAMILIES[r.family]?.source ?? '',
    cards: [],
    sets: [],
    statuses: {},
    areas: {},
  }
  g.cards.push(r)
  if (!g.sets.includes(r.setId)) g.sets.push(r.setId)
  g.statuses[r.status] = (g.statuses[r.status] ?? 0) + 1
  g.areas[r.area] = (g.areas[r.area] ?? 0) + 1
  groups.set(r.family, g)
}
const ordered = [...groups.values()].sort((a, b) => b.cards.length - a.cards.length)

const byStatus = records.reduce<Record<string, number>>((acc, r) => {
  acc[r.status] = (acc[r.status] ?? 0) + 1
  return acc
}, {})

const md = `# Unnamed finishes, card by card

Generated by \`scripts/unnamed-finish-report.ts\` by sweeping all ${rows.length.toLocaleString('en-US')} cards in
\`data/tcglife.db\` through \`holoFor\` and \`printingFor\`, and keeping every card the renderer resolves to
\`special-treatment\` — the registry row for **a documented finish whose paper no source names**.

These cards are not a bug and not a gap in painting: they render plain foil because the paper
beneath the finish is unnamed. This report records, per card, what the sources actually say and
what would have to be published before the paper could be drawn.

**${records.length} cards** across ${new Set(records.map((r) => r.setId)).size} sets.

| What the record is | |
| --- | --- |
| Resolution status | ${Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')} |
| Foil area documented | ${records.filter((r) => r.areaVerified).length} of ${records.length} |
| Foil area claimed at all | ${records.filter((r) => r.area !== AREA_LABEL.unspecified).length} of ${records.length} |
| Papers named by a source | 0 — that is why the row exists |

## The families

| Family | Cards | Sets | Status | Area |
| --- | --- | --- | --- | --- |
${ordered
  .map(
    (g) =>
      `| ${g.label} | ${g.cards.length} | ${g.sets.join(', ')} | ${Object.entries(g.statuses)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')} | ${Object.entries(g.areas)
        .map(([k, v]) => `${k} ×${v}`)
        .join('; ')} |`,
  )
  .join('\n')}

## What would unblock each family

${ordered
  .map(
    (g) => `### ${g.label} — ${g.cards.length} cards

**Known.** ${g.known}

**Needs.** ${g.needs}

**Source read:** ${g.source}`,
  )
  .join('\n\n')}

## Every card

The JSON carries the same record per card, including its known and needs sentences, so a row can
be read without this page.

${ordered
  .map(
    (g) => `### ${g.label}

| Card | Set | No. | Rarity | Area | Mask | Status |
| --- | --- | --- | --- | --- | --- | --- |
${g.cards
  .map(
    (r) =>
      `| ${r.name} (\`${r.cardId}\`) | ${r.setId} | ${r.number} | ${r.rarity ?? '—'} | ${r.area} | \`${r.mask}\`${r.maskVerified ? '' : ' (unverified)'} | ${r.status} |`,
  )
  .join('\n')}`,
  )
  .join('\n\n')}

## Reading this honestly

- The set is defined by the renderer: a card appears here because \`printingFor\` resolves it to
  \`special-treatment\`, not because a document lists it.
- The family sentences are shared, because the sources speak per printing family. A per-card
  sentence would imply evidence that does not exist.
- The foil area is often documented and not cuttable (“the Pokémon itself”, “various parts”). Those
  rows say so rather than assuming the illustration window.
- No card here is waiting on code. Each is waiting on a source that names the paper, or on a scan
  or tilted photograph that would let its geometry be measured.
`

const report = {
  generated: 'scripts/unnamed-finish-report.ts',
  catalogue: rows.length,
  cards: records.length,
  sets: new Set(records.map((r) => r.setId)).size,
  byStatus,
  areaDocumented: records.filter((r) => r.areaVerified).length,
  families: ordered.map((g) => ({
    family: g.family,
    label: g.label,
    cards: g.cards.length,
    sets: g.sets,
    statuses: g.statuses,
    areas: g.areas,
    known: g.known,
    needs: g.needs,
    source: g.source,
  })),
  records,
  problems,
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/unnamed-finish.json', JSON.stringify(report, null, 2) + '\n')
fs.writeFileSync('reports/unnamed-finish.md', md)

console.log(`Unnamed finish: ${records.length} cards across ${report.sets} sets`)
for (const g of ordered) console.log(`  ${g.label}: ${g.cards.length} (${g.sets.join(', ')})`)
console.log(`  area documented: ${report.areaDocumented} of ${records.length}`)
console.log(`  problems: ${problems.length}`)
for (const p of problems) console.log(`  - ${p}`)
if (problems.length) process.exit(1)
