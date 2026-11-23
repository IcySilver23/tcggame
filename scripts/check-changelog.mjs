#!/usr/bin/env node
// Lint CHANGELOG.json against the house rules in AGENTS.md. The rules are
// mechanical, so they are checked mechanically:
//
//   node scripts/check-changelog.mjs
//
//   • newest entry: 3–5 highlights, each a plain sentence of 200 characters or
//     less; every older entry exactly ONE highlight (the panel shows highlights[0]
//     and nothing more for history);
//   • every entry: version, YYYY-MM-DD date, a short title, at least one feature,
//     no empty strings, no duplicated versions;
//   • newest version === package.json version, or the What's New badge never
//     lights up for the build that shipped it;
//   • entries newest-first and dates non-increasing;
//   • no baked counts ("288 updates") — the changelog ships inside the build, so
//     a count is wrong the moment the next release lands.
//
// Exit code 1 on any violation, with one line per problem.
import fs from 'node:fs'

const problems = []
const log = JSON.parse(fs.readFileSync('CHANGELOG.json', 'utf8'))
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const entries = log.entries ?? []
const LIMIT = 200

const isText = (s) => typeof s === 'string' && s.trim().length > 0
const parse = (v) => String(v).split('.').map((n) => Number(n) || 0)
const cmp = (a, b) => {
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
// A count is a claim the build cannot keep; a DATE is not. "24 May 2002 release"
// is a fact about the world, so the pattern looks for the shapes a count takes
// ("all 288 updates", "12 versions", "40 chapters shipped") rather than any
// number that happens to sit before the word "release".
const COUNT = /\b(?:all|every|each|the)\s+\d[\d,]*[\s-]+(?:updates?|releases?|versions?|chapters?)\b|\b\d[\d,]*[\s-]+(?:updates?|versions?|chapters? shipped)\b/i

if (entries.length === 0) problems.push('CHANGELOG.json has no entries')

const seen = new Set()
for (const [i, e] of entries.entries()) {
  const where = `entry ${i} (${e?.version ?? 'no version'})`
  if (!isText(e?.version)) problems.push(`${where}: missing version`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e?.date ?? '')) problems.push(`${where}: date must be YYYY-MM-DD, got ${JSON.stringify(e?.date)}`)
  if (!isText(e?.title)) problems.push(`${where}: missing title`)
  else if (e.title.length > 90) problems.push(`${where}: title is ${e.title.length} chars — keep it short and evocative`)
  if (!Array.isArray(e?.features) || e.features.length === 0) problems.push(`${where}: needs at least one feature`)
  for (const f of e?.features ?? []) {
    if (!isText(f)) problems.push(`${where}: empty feature string`)
    else if (COUNT.test(f)) problems.push(`${where}: feature bakes in a count — "${f.slice(0, 60)}…"`)
  }
  if (seen.has(e?.version)) problems.push(`${where}: duplicate version`)
  seen.add(e?.version)

  const h = e?.highlights
  if (h !== undefined) {
    if (!Array.isArray(h) || h.length === 0) problems.push(`${where}: highlights must be a non-empty array or absent`)
    else {
      const want = i === 0 ? 'between 3 and 5' : 'exactly 1'
      if (i === 0 && (h.length < 3 || h.length > 5)) problems.push(`${where}: newest entry wants ${want} highlights, has ${h.length}`)
      if (i > 0 && h.length !== 1) problems.push(`${where}: an older entry shows ${want} highlight, has ${h.length}`)
      for (const line of h) {
        if (!isText(line)) problems.push(`${where}: empty highlight string`)
        else if (line.length > LIMIT) problems.push(`${where}: highlight is ${line.length} chars (limit ${LIMIT}) — "${line.slice(0, 50)}…"`)
        else if (COUNT.test(line)) problems.push(`${where}: highlight bakes in a count — "${line.slice(0, 60)}…"`)
      }
    }
  } else if (i === 0) {
    problems.push(`${where}: the newest entry must ship highlights`)
  }
}

for (let i = 1; i < entries.length; i++) {
  if (cmp(entries[i - 1].version, entries[i].version) <= 0) {
    problems.push(`entries out of order: ${entries[i - 1].version} then ${entries[i].version}`)
  }
  if (String(entries[i - 1].date) < String(entries[i].date)) {
    problems.push(`dates out of order: ${entries[i - 1].version} (${entries[i - 1].date}) then ${entries[i].version} (${entries[i].date})`)
  }
}

if (entries[0] && entries[0].version !== pkg.version) {
  problems.push(`newest changelog entry is ${entries[0].version} but package.json is ${pkg.version} — bump one to match the other`)
}

const newest = entries[0]
console.log(
  `entries ${entries.length} | newest ${newest?.version} (${(newest?.highlights ?? []).length}h/${(newest?.features ?? []).length}f) | package ${pkg.version}`,
)
if (problems.length > 0) {
  for (const p of problems.slice(0, 40)) console.log('!! ' + p)
  console.log(`${problems.length} problem${problems.length === 1 ? '' : 's'}`)
  process.exit(1)
}
console.log('changelog ok')
