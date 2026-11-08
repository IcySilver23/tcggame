// Phase 10 report: modern special reverses (Poké Ball / Master Ball).
//
// Run: ./node_modules/.bin/tsx scripts/special-reverse-report.ts
//
// Eligibility is checked against the source's own published counts where it gives
// them: Prismatic Evolutions printed 100 Poké Ball and 67 Master Ball reverses.
// A rule that does not reproduce those numbers is a bug, not a rounding choice.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { SPECIAL_REVERSE_SETS } from '../src/foil/reverse-special'
import { SPECIAL_REVERSE_ASSETS } from '../src/foil/reverse-special-index'
import { PATTERNS } from '../src/foil/patterns'
import { SPECIAL_REVERSE_ETCH_STRENGTH, SPECIAL_REVERSE_ETCH_SURFACE } from '../src/foil/reverse-etch'
import { ASSIGNED_STAMP_PRINTINGS, BALL_PRINTINGS } from '../server/services/special-reverse'
import { ASCENDED_PUBLISHED_COUNTS, ascendedStampFor } from '../src/foil/ball-stamps'

type CardRow = { number: string; supertype: string | null; subtypes: string | null }
type SetRow = { id: string; name: string; printed_total: number | null; release_date: string | null }

const db = new Database('data/tcglife.db', { readonly: true })
const sets = new Map<string, SetRow>()
for (const id of new Set(SPECIAL_REVERSE_SETS.map((s) => s.setId))) {
  const row = db.prepare('select id, name, printed_total, release_date from sets where id = ?').get(id) as SetRow | undefined
  if (row) sets.set(id, row)
}

function has(subtypes: string | null, name: string): boolean {
  try {
    const list = JSON.parse(subtypes ?? '[]') as string[]
    return list.includes(name)
  } catch {
    return false
  }
}

type Eligibility = { mainSet: number; pokeball: number; masterball: number }
function eligibilityFor(setId: string): Eligibility {
  const set = sets.get(setId)
  const printed = set?.printed_total ?? Number.POSITIVE_INFINITY
  const rows = db.prepare('select number, supertype, subtypes from cards where set_id = ?').all(setId) as CardRow[]
  const main = rows.filter((r) => {
    const n = Number(r.number)
    return !Number.isFinite(n) || n <= printed
  })
  return {
    mainSet: main.length,
    pokeball: main.filter((r) => r.supertype !== 'Energy' && !has(r.subtypes, 'ex') && !has(r.subtypes, 'ACE SPEC')).length,
    masterball: main.filter((r) => r.supertype === 'Pokémon' && !has(r.subtypes, 'ex')).length,
  }
}

const eligibility = new Map<string, Eligibility>()
for (const id of sets.keys()) eligibility.set(id, eligibilityFor(id))
// Ascended Heroes is counted from the assignment table, not from a blanket rule:
// each regular Pokémon carries exactly one published paper.
const assignedCounts = new Map<string, Record<string, number>>()
for (const setId of new Set(ASSIGNED_STAMP_PRINTINGS.map((p) => p.setId))) {
  const rows = db.prepare('select id from cards where set_id = ?').all(setId) as { id: string }[]
  const counts: Record<string, number> = {}
  for (const r of rows) {
    const stamp = ascendedStampFor(r.id)
    if (!stamp) continue
    counts[stamp] = (counts[stamp] ?? 0) + 1
  }
  assignedCounts.set(setId, counts)
}
db.close()

const problems: string[] = []
const rowsOut: {
  setId: string
  setName: string
  year: number
  layout: string
  ball: string
  pattern: string
  variant: string | null
  eligible: number
  published: number | null
  delta: number | null
  source: string
  note: string
  odds: number | null
  oddsBasis: string | null
  rateSource: string | null
  slot: string | null
  reverseSlots: number | null
  upgrades: string | null
}[] = []

for (const entry of SPECIAL_REVERSE_SETS) {
  const elig = eligibility.get(entry.setId) ?? { mainSet: 0, pokeball: 0, masterball: 0 }
  const assigned = ASSIGNED_STAMP_PRINTINGS.find((p) => p.setId === entry.setId)
  const stampRow = assigned?.stamps.find((s) => s.stamp === entry.ball)
  // A fixed-stamp set is counted by its researched eligibility rule; an assigned
  // set is counted card by card, because an assigned stamp has no general rule.
  const eligible = stampRow
    ? assignedCounts.get(entry.setId)?.[entry.ball] ?? 0
    : entry.ball === 'pokeball' ? elig.pokeball : elig.masterball
  const published = entry.published ?? (stampRow ? ASCENDED_PUBLISHED_COUNTS[entry.ball] : null)
  const delta = published === null ? null : eligible - published
  if (eligible === 0) problems.push(`${entry.setId}: no card is eligible for the ${entry.ball} reverse`)
  if (delta !== null && delta !== 0) problems.push(`${entry.setId} ${entry.ball}: rule counts ${eligible}, source published ${published}`)
  const pattern = PATTERNS[entry.pattern]
  if (!pattern || !pattern.implemented) problems.push(`${entry.setId} ${entry.ball}: pattern ${entry.pattern} is not implemented`)
  if (!SPECIAL_REVERSE_ASSETS[entry.pattern]) problems.push(`${entry.setId} ${entry.ball}: no asset for ${entry.pattern}`)
  const game = BALL_PRINTINGS.find((p) => p.setId === entry.setId && p.ball === entry.ball)
  const gamePattern = game?.pattern ?? stampRow?.pattern
  const gameVariant = stampRow?.variant ?? null
  if (!game && !stampRow) problems.push(`${entry.setId} ${entry.ball}: no game-side stamp printing`)
  else if (gamePattern !== entry.pattern) problems.push(`${entry.setId} ${entry.ball}: game pattern ${gamePattern} disagrees with ${entry.pattern}`)
  if (stampRow && gameVariant !== stampRow.variant) problems.push(`${entry.setId} ${entry.ball}: variant token disagrees`)
  rowsOut.push({
    setId: entry.setId, setName: entry.setName, year: entry.year,
    layout: entry.layout, ball: entry.ball, pattern: entry.pattern,
    variant: stampRow?.variant ?? null,
    eligible, published, delta, source: entry.source, note: entry.note,
    odds: game?.packOdds ?? assigned?.packOdds ?? null,
    oddsBasis: game?.oddsBasis ?? assigned?.oddsBasis ?? null,
    rateSource: game?.source ?? assigned?.source ?? null,
    slot: game?.slot ?? assigned?.slot ?? null,
    reverseSlots: game?.reverseSlots ?? assigned?.reverseSlots ?? null,
    upgrades: (game?.upgrades ?? assigned?.upgrades)?.map((u) => `${u.rarity} ${(u.odds * 100).toFixed(2)}%`).join(', ') ?? null,
  })
}

const totalEligible = rowsOut.reduce((n, r) => n + r.eligible, 0)
const matched = rowsOut.filter((r) => r.delta === 0).length
const checked = rowsOut.filter((r) => r.delta !== null).length

const rowPattern = Object.values(SPECIAL_REVERSE_ASSETS)
  .find((a) => a?.layout === 'rows' && a.rows)?.rows ?? null

const references = Object.keys(SPECIAL_REVERSE_ASSETS).map((id) => {
  const a = SPECIAL_REVERSE_ASSETS[id as keyof typeof SPECIAL_REVERSE_ASSETS]!
  return { id: a.id, ball: a.ball, layout: a.layout, ...a.evidence }
})

const report = {
  generated: 'scripts/special-reverse-report.ts',
  phase: 'Phase 10 — modern special reverses',
  counts: {
    sets: new Set(rowsOut.map((r) => r.setId)).size,
    printings: rowsOut.length,
    eligibleCards: totalEligible,
    publishedCountsMatched: { matched, checked },
    assets: Object.keys(SPECIAL_REVERSE_ASSETS).length,
    assignedStamps: ASSIGNED_STAMP_PRINTINGS.flatMap((p) => p.stamps.map((s) => ({
      setId: p.setId, stamp: s.stamp, label: s.label, pattern: s.pattern, variant: s.variant, printed: s.printed,
      counted: assignedCounts.get(p.setId)?.[s.stamp] ?? 0,
    }))),
    rates: {
      measured: BALL_PRINTINGS.filter((p) => p.oddsBasis === 'measured').length,
      derived: ASSIGNED_STAMP_PRINTINGS.filter((p) => p.oddsBasis === 'derived').length,
      modelled: BALL_PRINTINGS.filter((p) => p.oddsBasis === 'modelled').length,
    },
    photographicReferences: references.filter((r) => r.kind === 'photograph').length,
    renderReferences: references.filter((r) => r.kind === 'render').length,
    textureVerified: false,
    rowPattern,
    etching: 'documented across artwork and body; modelled as a full-card relief',
    etch: {
      surface: SPECIAL_REVERSE_ETCH_SURFACE,
      strength: SPECIAL_REVERSE_ETCH_STRENGTH,
      mask: 'full card (artwork + body)',
      foilInsideArt: false,
      reliefVerified: false,
    },
  },
  rows: rowsOut,
  references,
  problems,
  honesty: [
    'A real Prismatic Evolutions Sylveon Poké Ball photograph (PSA 9, cert 108712104) and a real Umbreon Master Ball photograph confirm one large ball behind the attack text, with a fine crosshatched etch running across both artwork and body. The Sylveon photo measures the Poké Ball at about 0.52 of the card width, centred about 0.675 down the card; the published Terastal Festival ex render agrees. Published Black Bolt and White Flare renders confirm rows of balls.',
    'The large one-ball geometry is corrected to that measurement. The shipped sampler now draws the ball about 0.52 card widths across at v = 0.675, replacing the earlier ~0.63-wide stamp centred at v = 0.62, which the photo and render both contradict. The corrected value covers both large ball papers.',
    'The Black Bolt Poké Ball and White Flare Master Ball images show five columns of large and small balls alternating in staggered rows. On the 335px-wide reference cards the outer rings measure about 56px (large) and 32px (small), the column pitch is about 67.5px and the row pitch about 69px. The sheet uses those measured sizes and pitch, sampled five times across the card. The glyph, facet spacing and exact row registration remain drawings.',
    'The five-row tile is sampled with the card aspect so the balls stay circular. On the 465px-high reference card that puts the sheet rows about 2.3px tighter than the measured 69px pitch; the difference is accepted rather than stretching the balls, and the 56px/32px ring diameters are used as measured.',
    'The ball glyphs and facet spacing remain procedural drawings: no sheet is traced. The etched field is rendered as a separate full-card relief, modelled from the fine modern lattice; the ball foil itself stays outside the artwork, so the etch crossing the art is not a ball stamp.',
    'Eligibility follows the source\'s own wording: the Poké Ball version covers main-set cards except Pokémon ex and ACE SPEC, and the Master Ball version only regular Pokémon. On Prismatic Evolutions the rule reproduces the published 100 and 67 exactly.',
    'Black Bolt and White Flare have no published per-ball counts read here, so their eligible counts are this build\'s rule, not a print-run fact. Ascended Heroes also has no published card-by-card ball count; its 87.31% rate is derived from the measured second-slot hits below.',
    'Ascended Heroes does not roll a ball: it assigns one stamp to each regular Pokémon. The set prints five ball papers — Poké Ball, Love Ball, Friend Ball, Quick Ball and Dusk Ball — and Team Rocket\'s Pokémon carry an R where the ball would sit. Which card carries which paper is in src/foil/ball-stamps.ts, read from the set checklist, and this report counts the assignment against the published breakdown: 34 Poké Ball, 25 Love Ball, 23 Friend Ball, 22 Quick Ball, 26 Dusk Ball and 10 Team Rocket, 140 cards in total. Team Rocket\'s mark is deliberately not modelled as a ball.',
    'Because the paper follows the card, the game cannot roll “Poké Ball” in this set\'s second slot. The slot draws a card that was assigned a stamp and stores that card\'s own token; the fixed-stamp sets (Prismatic Evolutions, Black Bolt, White Flare) still roll their ball before choosing a card, which is what their published per-pack rates describe.',
    'Ascended Heroes has two reverse slots: an Energy-pattern reverse first, then the card\'s assigned stamp unless the second slot upgrades. TCGplayer\'s 2,000+ pack study measured Illustration Rare at 11.25% ± 1.33% and Special Illustration Rare at 1.44% ± 0.50% in that second slot, leaving 87.31% for the assigned paper — a stamp, not specifically a Poké Ball. The game models both slots: four commons, three uncommons, the two reverse slots and one rare-or-hit card.',
    'The 87.31% is derived, not a direct count of stamped cards: it is the complement of two measured second-slot hit rates. The report labels it derived for that reason. The Energy-pattern paper is reported separately: one large type symbol behind the attack text, with the glyphs drawn rather than traced.',
    'The four new ball glyphs and the Team Rocket R are drawings. The papers and their assigned cards are documented, but no angled photograph or scan of these sheets exists in this repo, so the heart, flower, bolt, crescent and R are stylised shapes placed in the ball cap. The assignment is verified; the artwork is not.',
    'The game\'s inventory stores the explicit ball variant, so a normal reverse holo keeps the set\'s ordinary paper and nothing is inferred from a set id alone.',
  ],
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/special-reverse-printings.json', JSON.stringify(report, null, 2) + '\n')

const lines = [
  '# Modern special reverses — Poké Ball and Master Ball',
  '',
  `Generated by \`${report.generated}\`. Phase 10 of \`HOLOFOIL_ROADMAP.md\`.`,
  '',
  '## Numbers',
  '',
  `- Sets: **${report.counts.sets}**; set/ball printings: **${report.counts.printings}**; assets: **${report.counts.assets}**.`,
  `- Eligible cards: **${report.counts.eligibleCards}**; published counts reproduced: **${matched}/${checked}**.`,
  `- Rates: **${report.counts.rates.measured}** measured, **${report.counts.rates.derived}** derived, **${report.counts.rates.modelled}** modelled.`,
  `- Texture verified: ${report.counts.textureVerified ? 'yes' : 'no — procedural drawing; references reviewed but no sheet traced'}.`,
  `- References reviewed: **${report.counts.photographicReferences}** photograph${report.counts.photographicReferences === 1 ? '' : 's'}, **${report.counts.renderReferences}** published render${report.counts.renderReferences === 1 ? '' : 's'}; etching: ${report.counts.etching}.`,
  ...(report.counts.rowPattern
    ? [`- Rows: **${report.counts.rowPattern.columns} × ${report.counts.rowPattern.rows}** alternating large/small balls; large ≈ **${(report.counts.rowPattern.largeBallWidth * 100).toFixed(1)}%** of card width, small ≈ **${(report.counts.rowPattern.smallBallWidth * 100).toFixed(1)}%**. Measured on a ${report.counts.rowPattern.measured.cardWidthPx}px card: ${report.counts.rowPattern.measured.largeBallPx}px / ${report.counts.rowPattern.measured.smallBallPx}px outer rings, ${report.counts.rowPattern.measured.columnPitchPx}px column pitch, ${report.counts.rowPattern.measured.rowPitchPx}px row pitch; sampler aspect-corrected so the balls stay round.`]
    : []),
  `- Etch: \`${report.counts.etch.surface}\` at ${report.counts.etch.strength} over the **${report.counts.etch.mask}**; ball foil inside the art: ${report.counts.etch.foilInsideArt ? 'yes' : 'no'}; relief verified: ${report.counts.etch.reliefVerified ? 'yes' : 'no — modelled'}.`,
  '',
  '## Printings',
  '',
  '| set | year | stamp | variant | layout | reverse slots | slot | upgrades | eligible | published | delta | odds | basis |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rowsOut.map((r) => `| ${r.setName} (\`${r.setId}\`) | ${r.year} | ${r.ball} | ${r.variant ? `\`${r.variant}\`` : '—'} | ${r.layout} | ${r.reverseSlots ?? '—'} | ${r.slot ?? '—'} | ${r.upgrades ?? '—'} | ${r.eligible} | ${r.published ?? '—'} | ${r.delta === null ? '—' : r.delta === 0 ? '0 ✓' : r.delta} | ${r.odds === null ? '—' : `${(r.odds * 100).toFixed(2)}%`} | ${r.oddsBasis ?? '—'} |`),
  '',
  '## What is sourced and what is drawn',
  '',
  ...report.honesty.map((h) => `- ${h}`),
  '',
  '## Etched field',
  '',
  'The printed etch is modelled as a full-card relief with its own mask. It may shade the artwork and the body as the card tilts; the ball foil keeps the outside-art mask and is never drawn inside the picture. The relief reuses the shipped fine lattice, so its spacing and depth are modelled rather than measured, and a card at rest remains the scan, byte for byte.',
  '',
  '## References',
  '',
  '| asset | reference | kind | confirms | limits |',
  '| --- | --- | --- | --- | --- |',
  ...references.map((r) => `| \`${r.id}\` | [${r.label}](${r.url}) | ${r.kind} | ${r.confirms} | ${r.limits} |`),
  '',
  '## Sources',
  '',
  ...rowsOut.map((r) => `- ${r.setName} — ${r.ball} rate: ${r.rateSource ?? '—'}; foil: ${r.source}`),
  '',
]
if (problems.length) lines.push('## Problems', '', ...problems.map((p) => `- ${p}`), '')
fs.writeFileSync('reports/special-reverse-printings.md', lines.join('\n'))

console.log(`sets: ${report.counts.sets} · printings: ${report.counts.printings} · eligible cards: ${totalEligible}`)
console.log(`published counts matched: ${matched}/${checked}`)
console.log('written: reports/special-reverse-printings.{json,md}')
if (problems.length) { for (const p of problems) console.log(' -', p); process.exitCode = 1 }
else console.log('every special reverse resolves to a shipped, documented paper')
