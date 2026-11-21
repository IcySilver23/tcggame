// Verifies reports/open-holo-questions.json is a fresh build of its generator, and that
// every open item says what would close it. The generator itself fails when the roadmap
// and its evidence map disagree; this proves the committed file matches the sources.
//
// Run: ./node_modules/.bin/tsx tmp/check-open-holo-questions.ts

import fs from 'node:fs'
import { build } from '../scripts/open-holo-questions'

const failures: string[] = []
let checks = 0
const ok = (cond: boolean, msg: string) => {
  checks++
  if (!cond) failures.push(msg)
}

const fresh = build()
const onDisk = JSON.parse(fs.readFileSync('reports/open-holo-questions.json', 'utf8')) as unknown

ok(fresh.problems.length === 0, `generator reported: ${fresh.problems.join('; ')}`)
ok(JSON.stringify(fresh) === JSON.stringify(onDisk), 'reports/open-holo-questions.json is stale — rerun scripts/open-holo-questions.ts')

const ids = new Set(fresh.questions.map((q) => q.id))
ok(ids.size === fresh.questions.length, 'duplicate question ids')

// The prose sections must carry a real description; a bug or phase row legitimately
// opens with its status, so those only need a non-empty statement here and a full
// evidence sentence below.
const PROSE = new Set(['unnamed-paper', 'refused', 'evidence'])
for (const q of fresh.questions) {
  ok(
    PROSE.has(q.section) ? q.today.length > 40 : q.today.length > 10,
    `${q.id}: "Today" does not state what is true now`,
  )
  ok(q.closes.length > 0, `${q.id}: no evidence sentence`)
  ok(q.closes.every((c) => c.length > 40), `${q.id}: evidence sentence is too short to say anything`)
  ok(q.sources.length > 0, `${q.id}: no source cited`)
}

const bySection = (s: string) => fresh.questions.filter((q) => q.section === s)
ok(bySection('unnamed-paper').every((q) => (q.cards ?? 0) > 0), 'an unnamed-paper item has no card count')
ok(
  bySection('unnamed-paper').reduce((a, q) => a + (q.cards ?? 0), 0) === fresh.totals.unnamedFinishCards,
  'family counts do not sum to the unnamed-finish total',
)
ok(fresh.totals.papersAwaitingSheet === 0, `papers awaiting a sheet: ${fresh.totals.papersAwaitingSheet}`)
ok(fresh.totals.refusals >= 1, 'no refused claims recorded')
ok(fresh.totals.openBugs >= 1, 'no open roadmap bugs recorded')
ok(fresh.totals.phasesNotStarted >= 1, 'no unstarted roadmap phases recorded')

if (failures.length > 0) {
  console.error(failures.map((f) => `FAIL ${f}`).join('\n'))
  process.exit(1)
}
console.log(`open-holo-questions: ${checks} checks passed — ${fresh.questions.length} open items, catalogue ${fresh.catalogue}`)
