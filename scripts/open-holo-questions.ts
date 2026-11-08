// Open foil questions: every unresolved claim, refusal and missing piece of evidence in
// one generated file, so "what's left for holos" is data rather than memory.
//
// Run: ./node_modules/.bin/tsx scripts/open-holo-questions.ts
//
// This report derives nothing of its own. Every sentence in it comes from a report beside
// it — each of which already sweeps the catalogue through the renderer — or from the
// roadmap, and it lays their open items out with what would close each one:
//
//   reports/unnamed-finish.json     finishes documented, paper unnamed      -> "the 416"
//   reports/unpainted-papers.json   papers a source names with no sheet     -> must stay 0
//   reports/tinsel-printings.json   the refused 2025 Tinsel return
//   reports/confetti-printings.json the McDonald's single-row limitation
//   reports/cosmos-printings.json   holo versions with no named paper, BW32
//   reports/reverse-printings.json  pending papers and the approximated subject masks
//   reports/radiant-printings.json  modelled foil boundaries
//   HOLOFOIL_ROADMAP.md             open bugs and not-started phases
//
// The subject is drift. A family, a refusal or an open bug that appears in one of those
// sources must appear here too, and the roadmap is the authority on which bugs and phases
// count as open: an open bug with no evidence sentence (or a sentence left behind after
// the bug closed) fails this script, so the list cannot quietly fall behind the code.
// `tmp/check-open-holo-questions.ts` re-runs the build and fails when the committed file
// differs from a fresh one.

import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const GENERATED = 'scripts/open-holo-questions.ts'
const OUT_JSON = 'reports/open-holo-questions.json'
const OUT_MD = 'reports/open-holo-questions.md'
const ROADMAP = 'HOLOFOIL_ROADMAP.md'

type Section = 'unnamed-paper' | 'refused' | 'evidence' | 'bug' | 'phase'

export type Question = {
  id: string
  section: Section
  title: string
  /** What is true today, in the sources' own terms. */
  today: string
  /** The specific evidence that would close it. */
  closes: string[]
  cards: number | null
  sources: string[]
}

export type Totals = {
  papersAwaitingSheet: number
  unnamedFinishCards: number
  unnamedFinishFamilies: number
  refusals: number
  evidenceGaps: number
  openBugs: number
  phasesNotStarted: number
}

export type OpenQuestionsReport = {
  generated: string
  catalogue: number
  totals: Totals
  questions: Question[]
  problems: string[]
}

// ---------------------------------------------------------------------------
// Inputs. Only the fields this report reads are typed; the reports themselves are
// authoritative for everything else.
// ---------------------------------------------------------------------------

type UnnamedFamily = {
  family: string
  label: string
  cards: number
  sets: string[]
  known: string
  needs: string
  source: string
}
type UnnamedReport = { catalogue: number; cards: number; sets: number; families: UnnamedFamily[] }

type UnpaintedReport = {
  catalogue: { cards: number; foilCards: number; noFoil: number }
  roadmapLine: { text: string; named: string[] }
  gaps: { id: string }[]
  gapCards: number
}
type TinselReport = { counts: { holoRares: number }; blackBolt: { cardId: string }[] }
type ConfettiReport = {
  counts: { claimed: number; painted: number; exceptions: number; mcdonalds: number; textureVerified: boolean }
}
type CosmosReport = {
  counts: { unresolvedCards: number; specialTreatments: number; promoPrintingsResolved: number }
  popHoloUndocumented: { setId: string; number: string; name: string; why: string }[]
  promoBucketUnlisted: { cardId: string; name: string; why: string }[]
}
type ReverseReport = {
  counts: {
    expansions: number
    expansionsValidated: number
    patternsPainted: number
    patternsIdentified: number
    expansionsPending: number
  }
  limitations: string[]
  pendingPatterns: string[]
}
type RadiantReport = { counts: { cards: number; modelled: number; verified: number; plain: number } }

type RoadmapBug = { id: string; title: string; severity: string; status: string }
type RoadmapPhase = { number: string; name: string; note: string }

function readJson<T>(path: string, problems: string[]): T | null {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8')) as T
  } catch {
    problems.push(`cannot read ${path} — rerun the report that writes it`)
    return null
  }
}

// ---------------------------------------------------------------------------
// The roadmap is the authority for which bugs and phases are still open, so it is
// parsed rather than restated. A row only counts as closed when the status says so.
// ---------------------------------------------------------------------------

function readRoadmap(problems: string[]): { bugs: RoadmapBug[]; phases: RoadmapPhase[] } {
  const bugs: RoadmapBug[] = []
  const phases: RoadmapPhase[] = []
  let md: string
  try {
    md = fs.readFileSync(ROADMAP, 'utf8')
  } catch {
    problems.push(`cannot read ${ROADMAP}`)
    return { bugs, phases }
  }
  for (const line of md.split(/\r?\n/)) {
    const bug = /^\| (B\d+) \| (.+?) \| (.+?) \| (.+?) \|$/.exec(line)
    if (bug) {
      const status = bug[4].replace(/\*\*/g, '').trim()
      const closed = /^(fixed|accepted)/i.test(status)
      if (!closed) bugs.push({ id: bug[1], title: bug[2].replace(/~~/g, '').trim(), severity: bug[3], status })
      continue
    }
    const phase = /^\| (\d+) \| (.+?) \| \*\*(.+?)\*\* \| (.+?) \|$/.exec(line)
    if (phase && /^not started/i.test(phase[3])) {
      phases.push({ number: phase[1], name: phase[2].trim(), note: phase[4].trim() })
    }
  }
  if (bugs.length === 0) problems.push(`${ROADMAP} has no open bug rows — the known-bugs table changed shape`)
  if (phases.length === 0) problems.push(`${ROADMAP} has no "Not started" phases — the phase table changed shape`)
  return { bugs, phases }
}

// ---------------------------------------------------------------------------
// Evidence sentences, keyed to the roadmap's own ids. The roadmap decides WHICH items
// are open; this map decides what would close each one, and the script fails in both
// directions — a new open item with no sentence, or a sentence left behind for a closed
// one — so neither side can drift alone.
// ---------------------------------------------------------------------------

const BUG_EVIDENCE: Record<string, string> = {
  B4: 'A subject-segmented mask for the artwork backgrounds of EX Delta Species through EX Power Keepers and Dragon Frontiers, where the printed pattern excludes (or, on Dragon Frontiers, sits on) the Pokémon. Artwork segmentation or a per-card coordinate list would replace the whole-window approximation.',
  B5: 'A source stating whether Prime cards were printed reverse-holo, in either direction. Nothing read here answers it, so the conservative exclusion stays until one does.',
  B6: 'A macro or tilted photograph of one textured ultra rare with a measurable repeat, from which the normal map’s spacing, depth and coverage could be fitted rather than modelled.',
  B10: 'The same kind of photograph focused on a modern ball reverse’s etch, with the ball’s own spacing published, so the generic fine lattice can be replaced by a measured one.',
}

const PHASE_EVIDENCE: Record<string, string> = {
  '14': 'Catalogue rows for the Japanese and Chinese printings — set ids, collector numbers and a source per language for that language’s foil — so the language axis resolves its own claim rather than borrowing the English one. Japanese cards also foil the border, which is a different mask from the one shipped.',
  '15': 'A treatment a source names that is not already one of the painted families. The phase stays empty until a source describes a foil this build has not catalogued.',
  '23': 'An import path from the publisher or API into `pack_product_cards` and the price tables per release, so a new set is playable without a hand-written entry in `server/catalog/local-releases.json`.',
}

// ---------------------------------------------------------------------------

export function build(): OpenQuestionsReport {
  const problems: string[] = []
  const unnamed = readJson<UnnamedReport>('reports/unnamed-finish.json', problems)
  const unpainted = readJson<UnpaintedReport>('reports/unpainted-papers.json', problems)
  const tinsel = readJson<TinselReport>('reports/tinsel-printings.json', problems)
  const confetti = readJson<ConfettiReport>('reports/confetti-printings.json', problems)
  const cosmos = readJson<CosmosReport>('reports/cosmos-printings.json', problems)
  const reverse = readJson<ReverseReport>('reports/reverse-printings.json', problems)
  const radiant = readJson<RadiantReport>('reports/radiant-printings.json', problems)
  const roadmap = readRoadmap(problems)

  const questions: Question[] = []

  // 1. Documented finish, unnamed paper. The families carry the prose, so this report
  //    repeats the report rather than inventing a second description of the same cards.
  for (const f of unnamed?.families ?? []) {
    questions.push({
      id: `paper:${f.family}`,
      section: 'unnamed-paper',
      title: `${f.label} — ${f.cards} card${f.cards === 1 ? '' : 's'} across ${f.sets.length} set${f.sets.length === 1 ? '' : 's'}`,
      today: f.known,
      closes: [f.needs],
      cards: f.cards,
      sources: ['reports/unnamed-finish.json', f.source],
    })
  }
  if (unnamed) {
    const summed = unnamed.families.reduce((a, f) => a + f.cards, 0)
    if (summed !== unnamed.cards) {
      problems.push(`unnamed-finish families sum to ${summed} cards but the report totals ${unnamed.cards}`)
    }
    if (unnamed.families.length === 0) problems.push('unnamed-finish.json lists no families')
  }
  if (unpainted && unpainted.gaps.length > 0) {
    problems.push(
      `${unpainted.gaps.length} paper(s) ship no sheet (${unpainted.gapCards} cards) — reports/unpainted-papers.md lists them, and this report's headline must change`,
    )
  }

  // 2. Claims deliberately refused. Each one is a decision, not an omission, and the
  //    report says which evidence would reverse it.
  if (tinsel) {
    const rows = tinsel.blackBolt.length
    questions.push({
      id: 'refused:tinsel-2025',
      section: 'refused',
      title: `Black Bolt & White Flare — the 2025 Tinsel return (${rows} holo-rare rows)`,
      today:
        'No foil claim. Bulbapedia’s Rarity page says Tinsel “returned as a once-off” there “with holofoil rare cards in these sets also having Tinsel Holofoil borders”, while its set page marks three poster-collection exclusives and TCGdex registers exactly those three. The sources disagree about which printings, the covered promos are not in this catalogue, and the one sentence about the holo rares describes a border — a different foil area from the striped image this build draws.',
      closes: [
        'A source naming which Black Bolt & White Flare printings carry Tinsel and where. If the foil is a border rather than the image, that is a different mask and needs its own geometry before it can be drawn; if it is the image, a card list that agrees with Bulbapedia’s set page reopens the 22 rows.',
        'Catalogue rows for the three poster-collection exclusives those sources name, since they are promos this catalogue does not carry today.',
      ],
      cards: rows,
      sources: ['reports/tinsel-printings.json', 'src/foil/tinsel-index.ts'],
    })
  }

  if (confetti) {
    questions.push({
      id: 'refused:mcdonalds-variants',
      section: 'refused',
      title: `McDonald’s Collections — ${confetti.counts.mcdonalds} rows, one row per card`,
      today: `Every McDonald’s row paints the Confetti foil, because each card exists in both a Non Holofoil and a Confetti Holofoil printing and the catalogue holds one row for the number. The finish and its product are verified; the limitation is the catalogue’s shape, not the source.`,
      closes: [
        'Per-variant catalogue rows for the McDonald’s Collections — a source stating which copy is the Confetti one — then a variant gate like Sequin’s `sequinHolofoil`, so the plain printing makes no foil claim and the foil printing still does.',
      ],
      cards: confetti.counts.mcdonalds,
      sources: ['reports/confetti-printings.json'],
    })
  }

  if (cosmos) {
    const undocumented = cosmos.popHoloUndocumented
    questions.push({
      id: 'refused:pop-holo-paper',
      section: 'refused',
      title: `POP Series holo versions with no named paper (${undocumented.length} cards)`,
      today: `${undocumented
        .map((c) => `${c.name} (${c.setId.toUpperCase()} ${c.number})`)
        .join(', ')} have holographic versions a source records but never names the paper of, so they make no foil claim rather than a guessed one.`,
      closes: [
        undocumented[0]?.why ??
          'A source naming the foil paper of each holographic version.',
        'A photograph of one of those copies with a repeat that can be matched to a known paper would do it; a marketplace “holofoil” flag is not evidence of which paper.',
      ],
      cards: undocumented.length,
      sources: ['reports/cosmos-printings.json'],
    })

    for (const c of cosmos.promoBucketUnlisted) {
      questions.push({
        id: `refused:${c.cardId}`,
        section: 'refused',
        title: `${c.name} (${c.number}) — in neither treatment catalogue`,
        today: c.why,
        closes: [
          'A Pokumon or Bulbapedia entry classifying this promo’s treatment. Until one exists there is no per-card evidence, and a promo set’s blanket rule would be the error the printing database exists to prevent.',
        ],
        cards: 1,
        sources: ['reports/cosmos-printings.json'],
      })
    }
  }

  // 3. Painted, but not evidenced. These are the papers that render today and would
  //    stop being drawings the moment a photograph or segmentation exists.
  if (unpainted) {
    questions.push({
      id: 'evidence:drawn-sheets',
      section: 'evidence',
      title: `Every drawn sheet is a reconstruction (${unpainted.catalogue.foilCards} cards ride on them)`,
      today: `No identified paper ships without a sheet, but no factory scan or angled photograph of a paper exists in this repository either: the sheets are drawn from a sentence, and each metadata file says so (${reverse ? `${reverse.counts.patternsPainted} reverse papers` : 'the reverse papers'}, the era papers and the promo papers alike).`,
      closes: [
        'One tilted or macro photograph per paper, at a known angle and distance, catalogued so `textureVerified` can flip from false to true and the drawn pitch, density or ring size can be measured against it instead of disclosed.',
      ],
      cards: unpainted.catalogue.foilCards,
      sources: ['reports/unpainted-papers.json', 'reports/reverse-printings.json'],
    })
  }
  if (reverse) {
    questions.push({
      id: 'evidence:reverse-subject-masks',
      section: 'evidence',
      title: `Reverse masks that exclude the artwork subject (${reverse.counts.expansionsValidated}/${reverse.counts.expansions} expansions validated)`,
      today:
        reverse.limitations.find((l) => /subject/i.test(l)) ??
        'Masks marked “approximated” use the whole illustration window because the printed pattern excludes the subject and this build cannot segment it.',
      closes: [
        'Subject segmentation for the artwork-background masks (EX Delta Species through EX Power Keepers and Dragon Frontiers), or a per-card coordinate list, so an approximated mask can be marked verified rather than described as approximate.',
      ],
      cards: null,
      sources: ['reports/reverse-printings.json'],
    })
  }
  if (radiant) {
    questions.push({
      id: 'evidence:radiant-modelled',
      section: 'evidence',
      title: `Radiant Collection boundaries still modelled (${radiant.counts.modelled} of ${radiant.counts.cards} cards)`,
      today: `The foil area is verified for ${radiant.counts.verified} cards and plain by design for ${radiant.counts.plain}; the remaining ${radiant.counts.modelled} use a modelled boundary because no source read here describes where their foil stops.`,
      closes: [
        'A card-specific photograph or scan for each modelled card, which would move it into the verified column; absence is why the report keeps them modelled rather than averaging them into a claim.',
      ],
      cards: radiant.counts.modelled,
      sources: ['reports/radiant-printings.json'],
    })
  }

  // 4. Roadmap bugs and phases. Both directions are checked: every open row needs a
  //    sentence here, and a sentence for a row that has closed is stale.
  for (const bug of roadmap.bugs) {
    const evidence = BUG_EVIDENCE[bug.id]
    if (!evidence) problems.push(`roadmap bug ${bug.id} is open but has no evidence sentence — add one to BUG_EVIDENCE`)
    questions.push({
      id: `bug:${bug.id}`,
      section: 'bug',
      title: `${bug.id} — ${bug.title} (${bug.severity})`,
      today: `Roadmap status: ${bug.status}.`,
      closes: evidence ? [evidence] : [],
      cards: null,
      sources: [ROADMAP],
    })
  }
  for (const id of Object.keys(BUG_EVIDENCE)) {
    if (!roadmap.bugs.some((b) => b.id === id)) problems.push(`BUG_EVIDENCE still describes ${id}, which is no longer open`)
  }

  for (const phase of roadmap.phases) {
    const evidence = PHASE_EVIDENCE[phase.number]
    if (!evidence) problems.push(`roadmap phase ${phase.number} is not started but has no evidence sentence — add one to PHASE_EVIDENCE`)
    questions.push({
      id: `phase:${phase.number}`,
      section: 'phase',
      title: `Phase ${phase.number} — ${phase.name}`,
      today:
        phase.note && phase.note !== '—'
          ? `Not started. ${phase.note}`
          : 'Not started, and the roadmap records no implementation note for it.',
      closes: evidence ? [evidence] : [],
      cards: null,
      sources: [ROADMAP],
    })
  }
  for (const id of Object.keys(PHASE_EVIDENCE)) {
    if (!roadmap.phases.some((p) => p.number === id)) problems.push(`PHASE_EVIDENCE still describes phase ${id}, which is no longer unstarted`)
  }

  const totals: Totals = {
    papersAwaitingSheet: unpainted?.gaps.length ?? 0,
    unnamedFinishCards: unnamed?.cards ?? 0,
    unnamedFinishFamilies: unnamed?.families.length ?? 0,
    refusals: questions.filter((q) => q.section === 'refused').length,
    evidenceGaps: questions.filter((q) => q.section === 'evidence').length,
    openBugs: roadmap.bugs.length,
    phasesNotStarted: roadmap.phases.length,
  }

  return {
    generated: GENERATED,
    catalogue: unpainted?.catalogue.cards ?? unnamed?.catalogue ?? 0,
    totals,
    questions,
    problems,
  }
}

// ---------------------------------------------------------------------------
// Markdown. Prose sub-sections rather than one wide table: the evidence sentence is the
// point of each entry, and it does not fit in a column.
// ---------------------------------------------------------------------------

const SECTION_TITLE: Record<Section, string> = {
  'unnamed-paper': '1. Finishes whose paper no source names',
  refused: '2. Claims this build refuses',
  evidence: '3. Evidence the painted sheets still lack',
  bug: '4. Roadmap bugs still open',
  phase: '5. Roadmap phases not started',
}

function renderMarkdown(report: OpenQuestionsReport): string {
  const t = report.totals
  const lines: string[] = []
  lines.push('# Open foil questions')
  lines.push('')
  lines.push(`Generated by \`${GENERATED}\`; do not edit by hand — rerun the script. It reads the reports`)
  lines.push('beside it and `HOLOFOIL_ROADMAP.md`, so the list cannot drift from them.')
  lines.push('')
  lines.push(`Catalogue swept: **${report.catalogue.toLocaleString()} cards**.`)
  lines.push('')
  lines.push('| What is still open | Count |')
  lines.push('| --- | --- |')
  lines.push(`| Papers a source names that still ship no sheet | **${t.papersAwaitingSheet}** |`)
  lines.push(`| Cards whose finish is documented but whose paper no source names | **${t.unnamedFinishCards}** in ${t.unnamedFinishFamilies} families |`)
  lines.push(`| Claims this build refuses | **${t.refusals}** |`)
  lines.push(`| Painted papers with an evidence gap | **${t.evidenceGaps}** |`)
  lines.push(`| Roadmap bugs still open | **${t.openBugs}** |`)
  lines.push(`| Roadmap phases not started | **${t.phasesNotStarted}** |`)
  lines.push('')
  lines.push('Nothing here waits on the renderer: the opening count is zero because every identified paper')
  lines.push('ships a sheet. What remains is evidence — a source naming a paper, a photograph of it, a card')
  lines.push('list from the publisher — or catalogue rows this build cannot invent.')
  lines.push('')

  for (const section of Object.keys(SECTION_TITLE) as Section[]) {
    const items = report.questions.filter((q) => q.section === section)
    if (items.length === 0) continue
    lines.push(`## ${SECTION_TITLE[section]}`)
    lines.push('')
    for (const q of items) {
      lines.push(`### ${q.title}`)
      lines.push('')
      lines.push(`**Today.** ${q.today}`)
      lines.push('')
      lines.push('**Would close it.**')
      lines.push('')
      for (const c of q.closes) lines.push(`- ${c}`)
      lines.push('')
      lines.push(`*Sources: ${q.sources.join(' · ')}*`)
      lines.push('')
    }
  }

  lines.push('## Regenerating')
  lines.push('')
  lines.push('```')
  lines.push('./node_modules/.bin/tsx scripts/open-holo-questions.ts')
  lines.push('./node_modules/.bin/tsx tmp/check-open-holo-questions.ts   # fails when this file is stale')
  lines.push('```')
  lines.push('')
  return lines.join('\n')
}

function main(): void {
  const report = build()
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n')
  fs.writeFileSync(OUT_MD, renderMarkdown(report))
  console.log(
    `open-holo-questions: ${report.questions.length} items — ${report.totals.unnamedFinishCards} unnamed-finish cards in ` +
      `${report.totals.unnamedFinishFamilies} families, ${report.totals.refusals} refusals, ${report.totals.evidenceGaps} evidence gaps, ` +
      `${report.totals.openBugs} open bugs, ${report.totals.phasesNotStarted} unstarted phases`,
  )
  if (report.problems.length > 0) {
    console.error(report.problems.map((p) => `FAIL ${p}`).join('\n'))
    process.exit(1)
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main()
