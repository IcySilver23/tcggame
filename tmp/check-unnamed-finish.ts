// Keeps reports/unnamed-finish.{json,md} equal to the renderer's own answer.
//
// Run: ./node_modules/.bin/tsx tmp/check-unnamed-finish.ts
//
// The report is generated from a sweep, so this re-runs the sweep and compares. It fails when
// a card enters or leaves the `special-treatment` bucket without the report moving, when a
// record loses its known/needs/source text, when a card appears twice, or when a family in
// the data has no entry in the report's family table.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { holoFor } from '../src/holo'
import { printingFor } from '../src/foil/printing-db'

const ok = (cond: boolean, label: string, detail?: string) => {
  if (cond) console.log(`  ok   ${label}${detail ? ` (${detail})` : ''}`)
  else {
    console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`)
    failures++
  }
}
let failures = 0

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db.prepare('select id, set_id, number, rarity, name from cards order by id').all() as {
  id: string
  set_id: string
  number: string
  rarity: string | null
  name: string
}[]
db.close()

const expected = new Set<string>()
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
  if (pattern === 'special-treatment') expected.add(row.id)
}

const report = JSON.parse(fs.readFileSync('reports/unnamed-finish.json', 'utf8')) as {
  cards: number
  byStatus: Record<string, number>
  families: { family: string; label: string; cards: number; known: string; needs: string; source: string }[]
  records: {
    cardId: string
    family: string
    known: string
    needs: string
    source: string
    area: string
    pattern: string
    status: string
  }[]
  problems: string[]
}

ok(report.problems.length === 0, 'the generator reported no problems', String(report.problems.length))
ok(report.records.length === expected.size, 'the report covers every special-treatment card', `${report.records.length} vs ${expected.size}`)
ok(report.cards === report.records.length, 'the stated count is the record count', String(report.cards))

const reported = new Set(report.records.map((r) => r.cardId))
const missing = [...expected].filter((id) => !reported.has(id))
const extra = [...reported].filter((id) => !expected.has(id))
ok(missing.length === 0, 'no special-treatment card is missing from the report', missing.slice(0, 3).join(', '))
ok(extra.length === 0, 'the report invents no card', extra.slice(0, 3).join(', '))
ok(reported.size === report.records.length, 'no card appears twice', String(reported.size))

ok(
  report.records.every((r) => r.pattern === 'special-treatment'),
  'every record is the special-treatment row',
)
ok(
  report.records.every((r) => r.known.trim() && r.needs.trim() && r.source.trim()),
  'every record says what is known, what is needed, and where the claim comes from',
)
ok(
  report.records.every((r) => r.area.trim().length > 0),
  'every record states the foil area, even when the answer is "not stated"',
)

const familyNames = new Set(report.families.map((f) => f.family))
ok(
  report.records.every((r) => familyNames.has(r.family)),
  'every record belongs to a family table',
)
ok(
  report.records.every((r) => report.families.find((f) => f.family === r.family)?.known.trim() !== ''),
  'every family says what is known',
)
ok(
  report.records.every((r) => report.families.find((f) => f.family === r.family)?.needs.trim() !== ''),
  'every family says what a source would need',
)

const familyTotal = report.families.reduce((n, f) => n + f.cards, 0)
ok(familyTotal === report.records.length, 'the family counts add up', `${familyTotal} vs ${report.records.length}`)

const statusTotal = Object.values(report.byStatus).reduce((n, v) => n + v, 0)
ok(statusTotal === report.records.length, 'the status counts add up', `${statusTotal} vs ${report.records.length}`)

const md = fs.readFileSync('reports/unnamed-finish.md', 'utf8')
ok(md.includes(`${report.records.length} cards`), 'the markdown states the same card count')
ok(
  report.families.every((f) => md.includes(f.label)),
  'every family appears in the markdown',
)

console.log(failures === 0 ? '\nALL OK' : `\n${failures} FAILED`)
if (failures) process.exit(1)
