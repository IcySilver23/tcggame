// The game day is 2 real hours by default now. This pins the boundary maths,
// the day key format, the day number and the 12/24 fallbacks, on a COPY of the
// save (tmp/gameday-home) so the setting can be switched freely.
//
//   npx tsx tmp/check-gameday-2h.ts

import fs from 'node:fs'
import path from 'node:path'

let checks = 0
const fails: string[] = []
function ok(cond: unknown, label: string) {
  checks++
  if (!cond) fails.push(label)
}

const home = path.resolve('tmp/gameday-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'server'), { recursive: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
fs.copyFileSync('server/schema.sql', path.join(home, 'server', 'schema.sql'))
for (const suffix of ['', '-wal', '-shm']) {
  const src = path.join('data', `tcglife.db${suffix}`)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(home, 'data', `tcglife.db${suffix}`))
}
process.env.TCGLIFE_HOME = home

const { db, setSetting, getSetting } = await import('../server/lib/db')
const g = await import('../server/lib/gameday')

const iso = (t: number) => new Date(t).toISOString()
const at = (s: string) => Date.parse(s)

try {
  // ---- default is 2 hours ------------------------------------------------
  db.prepare(`DELETE FROM meta WHERE key = 'dayLengthHours'`).run()
  g.resetGameDayCache()
  ok(g.gameDayHours() === 2, 'an untouched save runs 2-hour days')
  ok(g.gameDayMs() === 7_200_000, 'a game day is 7,200,000 ms')

  // ---- boundaries: every even UTC hour -----------------------------------
  ok(iso(g.gameDayStart(at('2026-11-22T13:47:00Z')).getTime()) === '2026-11-22T12:00:00.000Z', '13:47 sits in the 12:00 day')
  ok(iso(g.gameDayStart(at('2026-11-22T14:00:00Z')).getTime()) === '2026-11-22T14:00:00.000Z', '14:00 starts its own day')
  ok(iso(g.gameDayStart(at('2026-11-22T00:59:00Z')).getTime()) === '2026-11-22T00:00:00.000Z', '00:59 sits in the 00:00 day')
  ok(iso(g.gameDayStart(at('2026-11-22T23:59:00Z')).getTime()) === '2026-11-22T22:00:00.000Z', '23:59 sits in the 22:00 day')
  ok(iso(g.gameDayEnd(at('2026-11-22T13:47:00Z')).getTime()) === '2026-11-22T14:00:00.000Z', 'the 12:00 day ends at 14:00')

  // ---- keys: one per 2-hour bucket, and they parse back -------------------
  const keys = ['00', '02', '12', '22'].map((h) => g.gameDayKey(at(`2026-11-22T${h}:10:00Z`)))
  ok(new Set(keys).size === 4, `four buckets, four keys (got ${keys.join(' ')})`)
  ok(keys.every((k) => /^2026-11-22-\d{2}$/.test(k)), 'keys are date-HH at 2 hours')
  ok(keys[0] === '2026-11-22-00' && keys[3] === '2026-11-22-22', 'the hour is the key tail')
  ok(iso(g.gameDayKeyStartMs('2026-11-22-14')) === '2026-11-22T14:00:00.000Z', 'a 2h key parses back to its boundary')
  ok(iso(g.gameDayKeyStartMs('2026-11-22-pm')) === '2026-11-22T12:00:00.000Z', 'an old pm key still parses')
  ok(iso(g.gameDayKeyStartMs('2026-11-22-am')) === '2026-11-22T00:00:00.000Z', 'an old am key still parses')
  ok(iso(g.gameDayKeyStartMs('2026-11-22')) === '2026-11-22T00:00:00.000Z', 'a date-only key still parses')

  // ---- day numbers move six times faster than on a 12h clock -------------
  const created = '2026-11-22T00:30:00Z'
  ok(g.gameDayNumber(created, at('2026-11-22T00:59:00Z')) === 1, 'day 1 is the day it was created')
  ok(g.gameDayNumber(created, at('2026-11-22T02:00:00Z')) === 2, 'two hours later is day 2')
  ok(g.gameDayNumber(created, at('2026-11-22T12:00:00Z')) === 7, 'twelve hours later is day 7')
  ok(g.gameDayNumber(created, at('2026-11-23T00:00:00Z')) === 13, 'a real day later is day 13')

  // ---- switching the setting --------------------------------------------
  setSetting('dayLengthHours', '12')
  g.resetGameDayCache()
  ok(g.gameDayHours() === 12, 'a stored 12 is respected')
  ok(iso(g.gameDayStart(at('2026-11-22T13:47:00Z')).getTime()) === '2026-11-22T12:00:00.000Z', '12h day starts at noon')
  ok(g.gameDayKey(at('2026-11-22T13:47:00Z')) === '2026-11-22-pm', '12h keys keep the am/pm tail')

  setSetting('dayLengthHours', '24')
  g.resetGameDayCache()
  ok(g.gameDayHours() === 24, 'a stored 24 is respected')
  ok(iso(g.gameDayStart(at('2026-11-22T23:59:00Z')).getTime()) === '2026-11-22T00:00:00.000Z', '24h day starts at midnight')
  ok(g.gameDayKey(at('2026-11-22T13:47:00Z')) === '2026-11-22', '24h keys are the plain date')

  setSetting('dayLengthHours', '2')
  g.resetGameDayCache()
  setSetting('dayLengthHours', 'nonsense')
  g.resetGameDayCache()
  ok(g.gameDayHours() === 2, 'a junk setting falls back to 2 hours')
  ok(getSetting('dayLengthHours') === 'nonsense', 'the junk value is left in place, not rewritten')

  // ---- the clock offset a day pass uses is one 2h day --------------------
  ok(g.gameDayMs() === 2 * 3_600_000, 'a skipped day is 2 hours of clock')
} catch (e) {
  fails.push(`threw: ${e instanceof Error ? e.message : String(e)}`)
}

try { db.close() } catch { /* already closed */ }

if (fails.length > 0) {
  console.error(`FAIL — ${fails.length}/${checks} checks failed:`)
  for (const f of fails) console.error(`  • ${f}`)
  process.exit(1)
}
console.log(`PASS — ${checks} checks`)
