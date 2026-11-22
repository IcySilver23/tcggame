import fs from 'node:fs'
import path from 'node:path'
const HOME = path.resolve('tmp/upc-home')
fs.rmSync(HOME, { recursive: true, force: true })
fs.mkdirSync(path.join(HOME, 'data'), { recursive: true })
fs.copyFileSync(path.resolve('data/tcglife.db'), path.join(HOME, 'data', 'tcglife.db'))
process.env.TCGLIFE_HOME = HOME
const { db } = await import('../server/lib/db')
const academy = await import('../server/services/academy')
const cash = () => (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
// The copy carries the live save's academy flags; start from a fresh course.
db.prepare("DELETE FROM meta WHERE key LIKE 'academy:%'").run()

let ok = 0, bad = 0
const check = (label: string, pass: boolean, extra = '') => {
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${label}${extra ? ` — ${extra}` : ''}`)
  pass ? ok++ : bad++
}

const start = cash()
const s0 = academy.academyState()
check('ten chapters', s0.total === 10 && s0.chapters.length === 10)
check('nothing done on a fresh course', s0.doneCount === 0 && !s0.allDone && s0.earned === 0)
check('offer total is chapters + bonus', s0.offerTotal === 300 && s0.bonus === 50, `${s0.offerTotal}`)
check('the whole course stays under the $400 Resale Desk gate', s0.offerTotal < 400, `${s0.offerTotal} < 400`)
check('and under the $500 Card Shop gate', s0.offerTotal < 500)

const first = academy.completeChapter('economy')
check('chapter pays its reward', first.ok === true && (first as any).awarded === 25, `awarded ${(first as any).awarded}`)
check('cash moved by exactly the reward', Math.abs(cash() - (start + 25)) < 0.001, `${start} -> ${cash()}`)
const again = academy.completeChapter('economy')
check('re-completing pays nothing', again.ok === true && (again as any).awarded === 0)
check('unknown chapter refused', academy.completeChapter('nope').ok === false)

for (const c of academy.ACADEMY_CHAPTERS.slice(1)) academy.completeChapter(c.id)
const all = academy.academyState()
check('all ten done', all.doneCount === 10 && all.allDone)
check('graduation bonus claimed', all.bonusClaimed === true)
check('course paid 300 in total', Math.abs(cash() - (start + 300)) < 0.001, `${cash() - start}`)
check('earned figure matches', Math.abs(all.earned - 300) < 0.001, `${all.earned}`)
check('finishing a chapter again pays nothing', (academy.completeChapter('packs') as any).awarded === 0)

const afterReset = academy.resetAcademy().state
check('reset clears progress', afterReset.doneCount === 0 && !afterReset.bonusClaimed)
check('reset keeps the money', Math.abs(cash() - (start + 300)) < 0.001)
check('a replay chapter pays nothing', (academy.completeChapter('economy') as any).awarded === 0)

// --- one source of truth -----------------------------------------------------
// The screen may not restate what the server owns: no chapter title, no reward
// figure. Prose is allowed; titles and money are not.
const view = fs.readFileSync(path.resolve('src/views/Academy.tsx'), 'utf8')
const titleLeaks = academy.ACADEMY_CHAPTERS.filter((c) => view.includes(c.title))
check('no chapter title is duplicated in the screen', titleLeaks.length === 0, titleLeaks.map((c) => c.id).join(', '))
check('no reward figure is written in the screen', !/reward:\s*\d/.test(view) && !/\$\{?\s*150|fmtUsd\(150\)|fmtUsd\(1000\)/.test(view))
const idsInView = [...view.matchAll(/^\s{2}(\w+): \{/gm)].map((m) => m[1])
const missingProse = academy.ACADEMY_CHAPTERS.filter((c) => !idsInView.includes(c.id))
check('every server chapter has prose', missingProse.length === 0, missingProse.map((c) => c.id).join(', '))
check('no orphan prose for unknown ids', idsInView.every((id) => academy.ACADEMY_CHAPTERS.some((c) => c.id === id)), idsInView.join(', '))

// A save paid under 0.82.0's flat $150 records a bare '1'; that flag must keep
// its value in `earned` rather than being re-read as the new $25.
db.prepare("DELETE FROM meta WHERE key LIKE 'academy:%'").run()
db.prepare("INSERT INTO meta (key, value) VALUES ('academy:paid:economy', '1')").run()
const legacy = academy.academyState()
check('a legacy flag still reports what the old build paid', Math.abs(legacy.earned - 150) < 0.001, `${legacy.earned}`)
check('the legacy flag migrates to its amount', db.prepare("SELECT value FROM meta WHERE key = 'academy:paid:economy'").get()?.value === '150')
check('a migrated chapter does not pay again', (academy.completeChapter('economy') as any).awarded === 0)

console.log(`\n${bad === 0 ? 'PASS' : 'FAIL'} ${ok + bad} checks (${ok} ok, ${bad} failed)`)
process.exit(bad === 0 ? 0 : 1)
