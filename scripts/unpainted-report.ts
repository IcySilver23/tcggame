// Unpainted papers: every identified foil this build cannot draw, in one report.
//
// Run: ./node_modules/.bin/tsx scripts/unpainted-report.ts
//
// The question this answers is narrow on purpose: which foils does a source NAME, which
// cards does the game hand that name to, and which of those still render plain foil
// because no sheet ships? The database is the evidence, not the prose:
//
//   - the catalogue is swept card by card through `holoFor`, so the counts are the cards
//     the renderer actually assigns a paper to (reverse and chase styles included);
//   - `printingFor` is swept alongside it, so a paper's rows can be split between sourced
//     printings and the renderer's era rule, which is a guess;
//   - the registry decides what "identified" means: a row with a source and a documented
//     look. A pattern that ships no sheet and that no source names is not a gap in
//     painting; it is a gap in identification, and it is reported separately.
//
// It then checks the roadmap against the sweep: the "Papers still unpainted" line must
// name exactly the papers this script finds, so prose cannot drift from the registry.
//
// Plain-by-design papers are NOT gaps and the report says why: `reverse-flat` and
// `reverse-flat-background` are uniform foil with no marks to draw, `radiant` ships one
// motif per card rather than a shared sheet, and `textured-full-art` is relief (a normal
// map), so its mark layer is plain on purpose.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { PATTERNS, type FoilPatternId } from '../src/foil/patterns'
import { printingFor, type PrintingStatus } from '../src/foil/printing-db'
import { holoFor } from '../src/holo'

const problems: string[] = []

// ---------------------------------------------------------------------------
// Classification. Every registry row lands in exactly one bucket, and the script
// refuses to run if a row fits none, so a new pattern cannot be forgotten.
// ---------------------------------------------------------------------------

const PLAIN_BY_DESIGN: Record<string, string> = {
  'plain-holo': 'The δ Delta Species holo paper prints no marks at all — uniform light is the drawing, so no sheet is missing.',
  'reverse-flat': 'Flat foil with no marks; a plain MarkField is the correct drawing, not a missing one.',
  'reverse-flat-background': 'Plain foil inside the artwork background; there are no marks to draw.',
  radiant: 'One reconstructed concept motif per Radiant Collection card, not a shared sheet.',
  'textured-full-art': 'Relief, not marks: the paper prints nothing, so the surface normal map is its texture.',
}

const ALIASES: Record<string, { to: FoilPatternId; why: string }> = {
  sheen: {
    to: 'mirror',
    why: 'Bulbapedia calls the XY-onward paper Sheen and the BW printings Mirror; this build treats them as one paper, painted as `mirror`. No printing resolves to a separate sheen sheet.',
  },
  fireworks: {
    to: 'reverse-fireworks',
    why: 'Superseded by the dedicated reverse paper, which ships a sheet and is what Legendary Collection resolves to.',
  },
}

const UNNAMED_FINISH = new Set<string>(['special-treatment'])
const UNKNOWN = 'unresolved'

// Empty on purpose: every identified paper now ships a sheet. The order list also
// documents which papers used to be gaps, so removing one is a visible edit.
const GAP_IDS: FoilPatternId[] = []

// ---------------------------------------------------------------------------
// Sweep the catalogue.
// ---------------------------------------------------------------------------

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db
  .prepare('select id, set_id, number, rarity, name from cards order by id')
  .all() as { id: string; set_id: string; number: string; rarity: string | null; name: string }[]
db.close()

// The renderer gives an era card a STYLE and no database pattern. Four styles name a
// paper directly; the rest are counted through their printing records.
const STYLE_PAPER: Record<string, FoilPatternId> = {
  waterweb: 'waterweb',
  line: 'line',
  mirage: 'mirage',
  sheen: 'mirror',
  // Radiant Collection cards resolve by number prefix, not by a printing record, so the
  // style is the only place the paper appears. Its 13 non-foil commons are already null.
  radiant: 'radiant',
}

type StyleStat = { cards: number; sets: Set<string>; byStatus: Map<PrintingStatus | 'era', number> }
const byStyle = new Map<string, StyleStat>()
const byPattern = new Map<string, { cards: number; byStatus: Map<PrintingStatus, number>; sets: Set<string> }>()
let foilCards = 0
let noFoil = 0

for (const row of rows) {
  const art = holoFor({ cardId: row.id, rarity: row.rarity ?? undefined })
  if (!art) {
    noFoil++
    continue
  }
  foilCards++
  const styleStat = byStyle.get(art.style) ?? { cards: 0, sets: new Set<string>(), byStatus: new Map() }
  styleStat.cards++
  styleStat.sets.add(row.set_id)
  byStyle.set(art.style, styleStat)

  const printing = printingFor({
    cardId: row.id,
    rarity: row.rarity ?? undefined,
    name: row.name,
    variant: art.reverse ? 'reverseHolofoil' : undefined,
  })
  const pattern = printing?.pattern ?? art.pattern ?? STYLE_PAPER[art.style] ?? null
  if (!pattern) continue
  const stat = byPattern.get(pattern) ?? { cards: 0, byStatus: new Map(), sets: new Set<string>() }
  stat.cards++
  stat.sets.add(row.set_id)
  const status = printing ? printing.status : 'era'
  stat.byStatus.set(status as PrintingStatus, (stat.byStatus.get(status as PrintingStatus) ?? 0) + 1)
  byPattern.set(pattern, stat)
}

// ---------------------------------------------------------------------------
// Classify every registry row.
// ---------------------------------------------------------------------------

type Row = {
  id: string
  label: string
  family: string
  years: string
  status: 'gap' | 'painted' | 'plain-by-design' | 'alias' | 'unnamed-finish' | 'unknown'
  sheet: string | null
  cards: number
  sets: number
  databaseRows: number
  eraRows: number
  statuses: Record<string, number>
  evidence: string
  missing: string
  source: string
}

const registry = Object.values(PATTERNS)
const classified: Row[] = registry.map((p) => {
  const stat = byPattern.get(p.id)
  const statuses: Record<string, number> = {}
  for (const [k, v] of stat?.byStatus ?? []) statuses[k] = v
  const databaseRows = Object.entries(statuses)
    .filter(([k]) => k !== 'era')
    .reduce((n, [, v]) => n + v, 0)
  const eraRows = statuses.era ?? 0
  const base = {
    id: p.id,
    label: p.label,
    family: p.family,
    years: p.years,
    sheet: p.texture ?? null,
    cards: stat?.cards ?? 0,
    sets: stat?.sets.size ?? 0,
    databaseRows,
    eraRows,
    statuses,
    evidence: p.note,
    source: p.source,
  }
  if (p.texture && fs.existsSync('public' + p.texture)) {
    return { ...base, status: 'painted', missing: '' }
  }
  if (PLAIN_BY_DESIGN[p.id]) {
    return { ...base, status: 'plain-by-design', missing: '' }
  }
  if (ALIASES[p.id]) {
    return { ...base, status: 'alias', missing: '' }
  }
  if (UNNAMED_FINISH.has(p.id)) {
    return {
      ...base,
      status: 'unnamed-finish',
      missing: 'No source here names the paper, so no sheet can be chosen. The finish is documented; the texture is not identified.',
    }
  }
  if (p.id === UNKNOWN) {
    return { ...base, status: 'unknown', missing: 'Not identified: the database refuses to guess.' }
  }
  if (!p.implemented) {
    return {
      ...base,
      status: 'gap',
      missing:
        'The paper is named and the renderer assigns it, but no texture ships. What is missing is the pattern itself: no source read here gives a mark count, a pitch or a scan, so any sheet would be a drawing that has to say so.',
    }
  }
  // An `implemented: true` row with no texture and no accepted reason is a real problem.
  problems.push(`${p.id}: implemented but ships no texture and is not in an accepted bucket`)
  return { ...base, status: 'gap', missing: 'implemented but unaccounted for' }
})

const gaps = classified.filter((r) => r.status === 'gap')
const order = new Map(GAP_IDS.map((id, i) => [id, i]))
gaps.sort((a, b) => (order.get(a.id as FoilPatternId) ?? 99) - (order.get(b.id as FoilPatternId) ?? 99))

// Every gap must be one Bulbapedia names, and must have a source.
for (const gap of gaps) {
  if (!gap.source) problems.push(`${gap.id}: a gap with no source is not "identified"`)
  if (!gap.evidence) problems.push(`${gap.id}: a gap with no documented look cannot be painted later`)
}

// ---------------------------------------------------------------------------
// The roadmap must name exactly these papers.
// ---------------------------------------------------------------------------

const roadmap = fs.readFileSync('HOLOFOIL_ROADMAP.md', 'utf8')
// The sentence sits inside a phase-status table cell, so it is not line-anchored.
const line = (roadmap.match(/Papers still unpainted: ([^|\n]+)/i)?.[1] ?? '').replace(/[.\s]+$/, '').trim()
// "none" is a complete answer, not a paper called None.
const declaresNone = /^none$/i.test(line)
const named = declaresNone
  ? []
  : line
      .split(/,| and /)
      .map((s) => s.trim())
      .filter(Boolean)
const idByLabel = new Map(classified.map((r) => [r.id.toLowerCase(), r]))
for (const name of named) {
  const row = idByLabel.get(name.toLowerCase()) ?? classified.find((r) => r.label.toLowerCase().startsWith(name.toLowerCase()))
  if (!row) problems.push(`the roadmap names "${name}", which the registry does not know`)
  else if (row.status !== 'gap') problems.push(`the roadmap calls ${name} unpainted, but it is classified ${row.status}`)
}
for (const gap of gaps) {
  if (!named.some((n) => gap.label.toLowerCase().startsWith(n.toLowerCase()) || n.toLowerCase() === gap.label.toLowerCase())) {
    problems.push(`${gap.id} is unpainted but the roadmap's unpainted line does not name it`)
  }
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------

const gapCards = gaps.reduce((n, g) => n + g.cards, 0)
const unnamed = classified.filter((r) => r.status === 'unnamed-finish')
const unnamedCards = unnamed.reduce((n, g) => n + g.cards, 0)
const unknownRows = byPattern.get(UNKNOWN)?.cards ?? 0

const statLine = (row: Row) => {
  const parts = Object.entries(row.statuses)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
  return parts.length ? parts.join(', ') : '—'
}

const gapSection = gaps.length
  ? `${gaps.length} identified papers still ship no sheet, on ${gapCards.toLocaleString('en-US')} cards:

| Paper | Cards | Sets | Named as | What is missing |
| --- | --- | --- | --- | --- |
${gaps
  .map((g) => `| **${g.label}** | ${g.cards.toLocaleString('en-US')} | ${g.sets} | ${g.years} | the paper is named, its marks are not; no sheet ships |`)
  .join('\n')}

All of them are painted with plain foil today: the mask and the tilt are real, and the marks are
absent because no drawing ships. That is the layer contract's honest fallback, not a bug.

${gaps.filter((g) => g.cards > 0).length} of them carry cards in this catalogue${gaps.filter((g) => g.cards === 0).length ? `; ${gaps.filter((g) => g.cards === 0).map((g) => `**${g.label}**`).join(' and ')} has no card here at all, because its product is not catalogued` : ''}:

${gaps
  .map(
    (g) =>
      `- **${g.label}** — ${
        g.cards === 0
          ? 'no card in this catalogue resolves to it (its product is not catalogued)'
          : `${g.cards.toLocaleString('en-US')} cards across ${g.sets} sets` +
            (g.databaseRows
              ? `, ${g.databaseRows} from printing records and ${g.eraRows} from the renderer's era rule`
              : ', all from the renderer\'s era rule (no printing record claims it)')
      }. Registry evidence: "${g.evidence}"`,
  )
  .join('\n')}`
  : `**None.** Every paper the registry identifies now ships a sheet, so no identified family depends on the plain-foil fallback any more.

The last one closed with **Sequin**: its drawn sheet ships, its sampler is wired, and the 19 General Mills printings Bulbapedia's Sequin tables name resolve to it by card id for the explicit sequinHolofoil variant, so the paper is painted and has a printing to wear it. The report names the cards and the variant split. \`reports/sequin-printings.md\` records that rather than hiding it.`

const md = `# Papers with no sheet

Generated by \`scripts/unpainted-report.ts\` by sweeping all ${rows.length.toLocaleString('en-US')} cards in
\`data/tcglife.db\` through \`holoFor\` and \`printingFor\`. Counts are cards the renderer actually
paints, not rows a document mentions.

## The answer

${gapSection}

## Everything else that ships no sheet, and why it is not a gap

| Paper | Rows | Classification | Why |
| --- | --- | --- | --- |
${classified
  .filter((r) => r.status === 'plain-by-design' || r.status === 'alias' || r.status === 'unnamed-finish' || r.status === 'unknown')
  .sort((a, b) => b.cards - a.cards)
  .map(
    (r) =>
      `| ${r.label} | ${r.cards.toLocaleString('en-US')} | ${
        r.status === 'plain-by-design'
          ? 'plain by design'
          : r.status === 'alias'
            ? `alias of \`${ALIASES[r.id].to}\``
            : r.status === 'unnamed-finish'
              ? 'identified finish, unnamed paper'
              : 'unidentified'
      } | ${
        r.status === 'plain-by-design'
          ? PLAIN_BY_DESIGN[r.id]
          : r.status === 'alias'
            ? ALIASES[r.id].why
            : r.status === 'unnamed-finish'
              ? r.missing
              : 'A row whose foil nothing in this repository names; no Cosmos or other paper is applied.'
      } |`,
  )
  .join('\n')}

\`special-treatment\` is the largest of these: ${unnamedCards.toLocaleString('en-US')} cards whose *finish* is
documented but whose *paper* no source names (the Shiny Vault's embossed/etched sets, Gold Star's
gold tint, the Neo Destiny sheen). They cannot be painted without a source that names a pattern, and
painting them with an era sheet would be the exact error the printing database exists to prevent. A
further ${unknownRows} rows carry the \`unresolved\` pattern: nothing is claimed for them at all.

## What "identified" means here, and what it does not

Every registry row carries a \`source\` (Bulbapedia's Holofoil page) and a description of the look —
"starbursts of different sizes", "intersecting diagonal lines that form a reflective grid", "many
small reflective geometric shapes". That is enough to know which paper a card wears and not enough
to draw it: none of them states a repeat, a mark size, a line pitch or a density. Painting one
therefore meant choosing those numbers, which is what every painted sheet in this build does — and
says so with \`textureVerified: false\`, \`concept: true\` and a note.

**Bottom line:** every painted sheet in this repository is either a procedural reconstruction (Starlight,
Tinsel, Crosshatch, Mirror, Confetti, Cracked Ice, Radiant Pokémon) or a sampled asset pack (Cosmos,
Radiant Collection's per-card motifs). No identified paper is waiting on code any more; what each
drawn sheet still lacks is evidence — a scan, a tilted photograph, or a source that states the
pattern's geometry. What none of them has is a photograph of the paper itself, which is what would let a drawn density be checked rather than disclosed.

## Coverage

| | |
| --- | --- |
| Cards in the catalogue | ${rows.length.toLocaleString('en-US')} |
| Cards the renderer gives a foil | ${foilCards.toLocaleString('en-US')} |
| Cards with no foil | ${noFoil.toLocaleString('en-US')} |
| Cards on a paper with no sheet (gap) | ${gapCards.toLocaleString('en-US')} |
| Cards on a documented finish with no named paper | ${unnamedCards.toLocaleString('en-US')} |
| Cards on \`unresolved\` | ${unknownRows} |

## Papers by state

| Paper | State | Sheet | Cards | Sets | Resolution |
| --- | --- | --- | --- | --- | --- |
${classified
  .slice()
  .sort((a, b) => b.cards - a.cards)
  .map(
    (r) =>
      `| ${r.label} | ${r.status} | ${r.sheet ? `\`${r.sheet}\`` : '—'} | ${r.cards.toLocaleString('en-US')} | ${r.sets} | ${statLine(r)} |`,
  )
  .join('\n')}

## Consistency checks

- The roadmap's "Papers still unpainted" line names ${named.length} papers: ${named.join(', ') || '(none)'}.
- The registry classifies ${gaps.length} as gaps: ${gaps.map((g) => g.id).join(', ')}.
- ${problems.length ? `${problems.length} problem(s): ${problems.join('; ')}` : 'The two agree, so a painting change cannot land without this report moving with it.'}

## Reading this report honestly

- A card can appear in two rows when the same card id exists as a holo and a reverse; the sweep
  counts the card the renderer paints, once, using the variant the record resolves.
- The era counts are **guesses**: \`holo.ts\` maps a set prefix to a paper. For a paper with no
  printing records, the count is how many cards would change if that sheet were painted — not proof
  that those printings wore it.
- "No sheet" is not "no foil": every one of these cards has coverage, tilt, iridescence and a mask.
  What it lacks is the paper's own marks, and the inspector says so on the card.
`

const report = {
  generated: 'scripts/unpainted-report.ts',
  catalogue: { cards: rows.length, foilCards, noFoil },
  roadmapLine: { text: line, named },
  gaps: gaps.map((g) => ({
    id: g.id,
    label: g.label,
    years: g.years,
    cards: g.cards,
    sets: g.sets,
    databaseRows: g.databaseRows,
    eraRows: g.eraRows,
    source: g.source,
    evidence: g.evidence,
    missing: g.missing,
  })),
  gapCards,
  unnamedFinish: { cards: unnamedCards, rows: unnamed.map((r) => ({ id: r.id, cards: r.cards })) },
  unresolvedCards: unknownRows,
  papers: classified.map((r) => ({
    id: r.id,
    label: r.label,
    family: r.family,
    years: r.years,
    status: r.status,
    sheet: r.sheet,
    cards: r.cards,
    sets: r.sets,
    statuses: r.statuses,
    databaseRows: r.databaseRows,
    eraRows: r.eraRows,
  })),
  problems,
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/unpainted-papers.json', JSON.stringify(report, null, 2) + '\n')
fs.writeFileSync('reports/unpainted-papers.md', md)

console.log(`Unpainted: ${gaps.length} identified papers, ${gapCards} cards — ${gaps.map((g) => `${g.id} ${g.cards}`).join(', ')}`)
console.log(`  no sheet, not a gap: ${classified.filter((r) => r.status === 'plain-by-design').length} plain by design, ${classified.filter((r) => r.status === 'alias').length} aliases, ${unnamedCards} cards on an unnamed finish, ${unknownRows} unresolved`)
console.log(`  catalogue ${rows.length}, foil ${foilCards}`)
console.log(`  roadmap line: ${line || '(missing)'}`)
console.log(`  problems: ${problems.length}`)
for (const p of problems) console.log(`  - ${p}`)
if (problems.length) process.exit(1)
