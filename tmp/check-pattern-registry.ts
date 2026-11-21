// The pattern registry must tell the truth about what ships.
//
// Run: ./node_modules/.bin/tsx tmp/check-pattern-registry.ts
//
// `PATTERNS[id].implemented` is what the app and the inspector use to say whether
// a pattern is painted. It drifted: four reverse papers shipped textures and were
// rendered, while their rows still said `implemented: false`, so the registry
// under-reported what exists. This suite makes the flag and the files agree in both
// directions:
//
//   1. a pattern that declares a texture must have that file;
//   2. a pattern that is implemented either declares a texture, or is one of the
//      finishes that legitimately has none (a plain foil has no marks to sample,
//      and Radiant carries a motif per card rather than a shared sheet);
//   3. every texture a generator registry hands the renderer belongs to a pattern
//      that claims to be implemented.
//
// Read-only: it never renders a card.

import fs from 'node:fs'
import { PATTERNS, type FoilPatternId } from '../src/foil/patterns'
import { REVERSE_ASSETS } from '../src/foil/reverse-index'
import { SPECIAL_REVERSE_ASSETS } from '../src/foil/reverse-special-index'
import { TYPE_SYMBOL_ASSETS } from '../src/foil/type-symbol-index'
import { LARGE_TYPE_SYMBOL_ASSETS } from '../src/foil/type-symbol-large-index'
import { REVERSE_TILE_ASSETS } from '../src/foil/reverse-tile-index'
import { REVERSE_TILE_INTRICATE_ASSETS } from '../src/foil/reverse-tile-intricate-index'
import { ENERGY_REVERSE_ASSETS } from '../src/foil/reverse-energy-large-index'
import { RADIANT_ASSETS } from '../src/foil/radiant-index'
import { RADIANT_ETCHED_SHEET } from '../src/foil/radiant-etched-index'

let pass = 0
let fail = 0
function ok(cond: boolean, msg: string, extra = '') {
  if (cond) {
    pass++
    console.log(`  ok   ${msg}`)
  } else {
    fail++
    console.log(`  FAIL ${msg}${extra ? ` — ${extra}` : ''}`)
  }
}

const exists = (path: string): boolean => fs.existsSync('public' + path)
const rows = Object.values(PATTERNS)
const implemented = rows.filter((r) => r.implemented)

// ---------------------------------------------------------------------------
// 1. A declared texture is a file that exists
// ---------------------------------------------------------------------------
for (const row of implemented) {
  if (!row.texture) continue
  ok(exists(row.texture), `${row.id}: ${row.texture} ships`, exists(row.texture) ? '' : 'missing')
}

// ---------------------------------------------------------------------------
// 2. Implemented without a texture is a deliberate, named case
// ---------------------------------------------------------------------------
const NO_TEXTURE: Record<string, string> = {
  'plain-holo': 'the δ holo paper prints no marks; uniform light is the correct layer',
  'reverse-flat': 'a plain reverse has no marks, so it samples nothing',
  'reverse-flat-background': 'plain foil inside the art window has no marks either',
  radiant: 'each Radiant card carries its own motif from radiant-index',
}
for (const row of implemented.filter((r) => !r.texture)) {
  ok(row.id in NO_TEXTURE, `${row.id}: implemented without a texture is justified`, NO_TEXTURE[row.id] ?? 'unexplained')
}

// ---------------------------------------------------------------------------
// 3. Every registry the renderer reads belongs to an implemented pattern
// ---------------------------------------------------------------------------
type Source = { registry: string; pattern: FoilPatternId; textures: string[] }

const sources: Source[] = [
  ...Object.entries(REVERSE_ASSETS).flatMap(([id, a]) =>
    a ? [{ registry: 'reverse-index', pattern: id as FoilPatternId, textures: [a.texture, a.alpha] }] : []),
  ...Object.entries(SPECIAL_REVERSE_ASSETS).flatMap(([id, a]) =>
    a ? [{ registry: 'reverse-special-index', pattern: id as FoilPatternId, textures: [a.texture] }] : []),
  { registry: 'type-symbol-index', pattern: 'reverse-type-symbol', textures: Object.values(TYPE_SYMBOL_ASSETS).map((a) => a.texture) },
  { registry: 'type-symbol-large-index', pattern: 'reverse-type-symbol-large', textures: Object.values(LARGE_TYPE_SYMBOL_ASSETS).map((a) => a.texture) },
  { registry: 'reverse-tile-index', pattern: 'reverse-tile', textures: Object.values(REVERSE_TILE_ASSETS).map((a) => a.texture) },
  { registry: 'reverse-tile-intricate-index', pattern: 'reverse-tile-intricate', textures: Object.values(REVERSE_TILE_INTRICATE_ASSETS).map((a) => a.texture) },
  { registry: 'reverse-energy-large-index', pattern: 'reverse-energy-large', textures: Object.values(ENERGY_REVERSE_ASSETS).map((a) => a.texture) },
  { registry: 'radiant-index', pattern: 'radiant', textures: Object.values(RADIANT_ASSETS).map((a) => a.pattern) },
  { registry: 'radiant-etched-index', pattern: 'radiant-etched', textures: [RADIANT_ETCHED_SHEET.pattern] },
]

for (const source of sources) {
  const row = PATTERNS[source.pattern]
  ok(!!row, `${source.registry}: ${source.pattern} is a registry row`)
  if (!row) continue
  ok(row.implemented, `${source.registry}: ${source.pattern} claims to be implemented`)
  ok(source.textures.length > 0, `${source.registry}: hands the renderer at least one texture`, String(source.textures.length))
  const missing = source.textures.filter((t) => !exists(t))
  ok(missing.length === 0, `${source.registry}: all ${source.textures.length} textures ship`, missing.slice(0, 3).join(', '))
}

// ---------------------------------------------------------------------------
// 4. The four that used to be wrong stay right
// ---------------------------------------------------------------------------
for (const id of ['reverse-fireworks', 'reverse-pinwheel', 'reverse-pokeball', 'reverse-type-symbol-large'] as const) {
  ok(PATTERNS[id].implemented, `${id} reports implemented`)
  ok(!!PATTERNS[id].texture && exists(PATTERNS[id].texture), `${id} points at a shipped sheet`, PATTERNS[id].texture ?? 'no texture')
}

// ---------------------------------------------------------------------------
// 5. Nothing is claimed twice in a contradictory way
// ---------------------------------------------------------------------------
const claimed = new Set(implemented.map((r) => r.id))
const shipped = new Set(sources.filter((s) => s.textures.some(exists)).map((s) => s.pattern))
const silent = [...shipped].filter((p) => !claimed.has(p))
ok(silent.length === 0, 'no pattern ships a texture while reporting unimplemented', silent.join(', '))

const decoys = rows.filter((r) => !r.implemented && r.texture)
ok(decoys.length === 0, 'no unimplemented pattern points at a texture it does not use', decoys.map((r) => r.id).join(', '))

// ---------------------------------------------------------------------------
// 6. The roadmap agrees with the registry about what is unpainted
// ---------------------------------------------------------------------------
//
// `implemented` is the live truth, and HOLOFOIL_ROADMAP.md repeats it in prose —
// which is exactly how Phase 8 came to list Crosshatch and Sheen as unpainted rows
// long after both were painted (Crosshatch in 0.45.0, Sheen under the shipped
// Mirror row in 0.44.0). A flag cannot drift silently the way a sentence can, so
// the two are compared here in both directions:
//
//   - a paper the roadmap calls unpainted must not be covered by a shipped row;
//   - the roadmap must name every era paper that is still unpainted, so a new
//     unpainted family cannot be added to the registry and forgotten in the plan.
//
// The list has a machine-readable contract on purpose — "Papers still unpainted:
// A, B and C" — because parsing prose around a comma list is how a checker turns
// into a source of false confidence. A strikethrough line records something that
// was once true and is kept as history, so those are skipped rather than rewrote.
const ROADMAP = 'HOLOFOIL_ROADMAP.md'
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Every name a shipped row answers to: its id, and each half of an "A / B" label. */
const shippedNames = new Map<string, string>()
for (const row of implemented) {
  shippedNames.set(norm(row.id), row.id)
  for (const part of row.label.split('/')) if (norm(part)) shippedNames.set(norm(part), row.id)
}
const registryNames = new Set<string>()
for (const row of rows) {
  registryNames.add(norm(row.id))
  for (const part of row.label.split('/')) if (norm(part)) registryNames.add(norm(part))
}

const roadmap = fs.readFileSync(ROADMAP, 'utf8').split('\n')
const markers = roadmap.filter((l) => /Papers still unpainted:/i.test(l))
ok(markers.length === 1, 'exactly one line declares which papers are still unpainted', String(markers.length))
const listText = (markers[0]?.match(/Papers still unpainted:\s*([^|]+)\|/i)?.[1] ?? '').trim()
// "none" is a complete answer once every identified paper ships a sheet; it is not a
// missing list. Anything else must name at least one paper.
const declaresNone = /^none$/i.test(listText)
const listedNames = declaresNone
  ? []
  : listText
      .split(/,|\band\b/)
      .map((s) => s.trim())
      .filter(Boolean)
ok(declaresNone || listedNames.length > 0, 'that line names them, or says none', listText || 'empty')

for (const name of listedNames) {
  const key = norm(name)
  ok(registryNames.has(key), `${name}: is a pattern the registry knows`, 'no such row')
  const shippedAs = shippedNames.get(key)
  ok(!shippedAs, `${name}: is not called unpainted while a shipped row covers it`, shippedAs ? `covered by ${shippedAs}` : '')
}

const listedKeys = new Set(listedNames.map(norm))
const namesRow = (r: (typeof rows)[number]): boolean =>
  listedKeys.has(norm(r.id)) || r.label.split('/').some((part) => listedKeys.has(norm(part)))
const forgotten = rows.filter((r) => r.family === 'era' && !shippedNames.has(norm(r.id)) && !namesRow(r))
ok(forgotten.length === 0, 'every unpainted era paper is named on that line', forgotten.map((r) => r.id).join(', '))

// Any other sentence that calls a paper unpainted must not name one that ships.
// Short labels are skipped: "Line" appears in ordinary prose about line widths.
const shippedLabelTexts = [...new Set(implemented.flatMap((row) => [row.id, ...row.label.split('/').map((p) => p.trim())]))]
  .filter((t) => t.length >= 5)
/**
 * True when a sentence calls one of the SHIPPED papers unpainted.
 *
 * Proximity, not co-occurrence: the Phase 8 row names Tinsel, Mirror and Crosshatch
 * as painted and then says which papers are still unpainted, so a bare "does this
 * line contain the word and the name" test fails on the very sentence that is
 * correct. Only names within the same clause as the claim count. The declaring line
 * is exempt because it has the stricter list contract checked just above.
 */
const claimsShippedUnpainted = (line: string): boolean => {
  if (/Papers still unpainted:/i.test(line)) return false
  const claim = /unpainted|not painted/i.exec(line)
  if (!claim) return false
  const clause = line.slice(Math.max(0, claim.index - 60), claim.index + 90)
  return shippedLabelTexts.some((t) => new RegExp(`\\b${t}\\b`, 'i').test(clause))
}

const wrongClaims = roadmap
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => !line.includes('~~') && claimsShippedUnpainted(line))
ok(
  wrongClaims.length === 0,
  'no roadmap line still calls a shipped paper unpainted',
  wrongClaims.map((c) => `${c.n}: ${c.line.slice(0, 90)}`).join(' | '),
)

// The detector is only worth having if it still catches the drift it was written
// for, so it is given the old Phase 8 sentence and a true one.
ok(
  claimsShippedUnpainted('Sheen, Water Web, Line, Mirage, Confetti, Sequin and Crosshatch remain unpainted rows |'),
  'the detector catches the stale Phase 8 wording',
  'it did not flag Crosshatch/Sheen as unpainted',
)
ok(
  !claimsShippedUnpainted('Mirror painted for nine BW promos (0.44.0) and Crosshatch for three promos (0.45.0); papers remain as listed.'),
  'and leaves a correct sentence alone',
  'false positive on a line that only names painted papers',
)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
