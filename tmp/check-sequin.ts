// Sequin: the sheet, the sampler, the registry and the render.
//
// Run: ./node_modules/.bin/tsx tmp/check-sequin.ts
//
// The checks are split the way the claims are:
//   - the GENERATOR is a drawing: regular polygons (a corner is a mark where an edge's
//     midpoint is not), a dark field, many small shapes, a sheet that wraps,
//     deterministic pixels, neutral colour;
//   - the PRINTING is honest: the registry says painted and points at a shipped file, and
//     the 19 cards Bulbapedia's Sequin tables name resolve by card id, with the modelled
//     illustration window and no verified area;
//   - the RENDER still obeys the layer contract: at rest it is the scan byte for byte,
//     at tilt it adds light only inside the mask.
//
// Read reports/sequin-printings.md first if a number here looks arbitrary.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  buildSequinField,
  polygonCoverage,
  SEQUIN_CELL,
  SEQUIN_FLOOR,
  SEQUIN_MARK_LINE,
  SEQUIN_MAX_SIDES,
  SEQUIN_MIN_SIDES,
  SEQUIN_SHEET_SIZE,
  renderSequinSheet,
  sequinInternalStep,
  sequinMarksFor,
  sequinSeamMismatch,
} from '../src/foil/sequin-sheet'
import {
  buildSequinGrid,
  sampleSequin,
  sequinCopyFor,
  sequinFieldFor,
  SEQUIN_TEXTURE_VERIFIED,
} from '../src/foil/sequin'
import { SEQUIN_CARDS, SEQUIN_CARDS_CAVEAT, SEQUIN_CLAIM, SEQUIN_SHEET } from '../src/foil/sequin-index'
import { PATTERNS } from '../src/foil/patterns'
import { holoFor } from '../src/holo'
import { printingFor, SEQUIN_PRINTINGS, SEQUIN_VARIANT } from '../src/foil/printing-db'
import { coverageFraction, foilMaskFor, maskValue } from '../src/foil/mask'
import { DEFAULT_FOIL_SETTINGS, meanLift, paintFoil, patternModulatorFor } from '../src/foil/stages'
import { FACE_ON } from '../src/foil/reflection'

let total = 0
let fails = 0
function ok(cond: boolean, label: string, detail?: string): void {
  total++
  if (!cond) {
    fails++
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('Sequin — sheet, sampler, registry, render')

// ---------------------------------------------------------------------------
// 1. The generator draws small polygons over a dark field.
// ---------------------------------------------------------------------------
const marks = sequinMarksFor(5, 7)
ok(marks.length >= 2 && marks.length <= 3, 'a cell carries two or three shapes', String(marks.length))
ok(marks.every((m) => m.sides >= SEQUIN_MIN_SIDES && m.sides <= SEQUIN_MAX_SIDES), 'each shape has 3–6 sides')
ok(marks.every((m) => m.radius >= 4 && m.radius <= 10), 'each shape is small against the sheet')
ok(marks.every((m) => m.rotation >= 0 && m.rotation < Math.PI), 'each shape has its own rotation')
ok(marks.every((m) => m.ink > 0.5 && m.ink <= 0.96), 'each shape is brighter than the field')
ok(new Set(marks.map((m) => m.sides)).size > 1 || marks.some((m) => m.sides !== marks[0]!.sides), 'side counts vary across the field')

// The shape is a POLYGON: at 0.8 of the circumradius a corner is a mark and the middle
// of an edge is bare. A disc would cover both, which is why this is the sharpest test
// that Sequin is not the dot field Cosmos or the block field Confetti.
{
  const r = 10
  const corner = polygonCoverage(0.8 * r, 0, r, 4, 0)
  const edge = polygonCoverage(0.8 * r, Math.PI / 4, r, 4, 0)
  ok(corner > 0.9, 'a square mark reaches its corner', corner.toFixed(3))
  ok(edge === 0, 'and its edge midpoint is bare at the same radius', edge.toFixed(3))
  const triCorner = polygonCoverage(0.8 * r, 0, r, 3, 0)
  const triEdge = polygonCoverage(0.8 * r, Math.PI / 3, r, 3, 0)
  ok(triCorner > 0.9 && triEdge === 0, 'a triangle does the same', `${triCorner.toFixed(2)} / ${triEdge.toFixed(2)}`)
  const centre = polygonCoverage(0.2 * r, 1.1, r, 6, 0.3)
  ok(centre === 1, 'the body of a shape is flat ink', centre.toFixed(3))
}

const sheet = renderSequinSheet(SEQUIN_SHEET_SIZE)
ok(sheet.size === 1024, 'the sheet is 1024px square')
ok(SEQUIN_SHEET_SIZE % SEQUIN_CELL === 0, 'the cell pitch divides the sheet exactly')
ok(sheet.marks >= 1500, 'the sheet carries many shapes', String(sheet.marks))
ok(sheet.floor <= 0.1, 'the bare field stays dark: this is a marked paper', sheet.floor.toFixed(3))
ok(Math.abs(sheet.floor - SEQUIN_FLOOR) < 1e-6, 'and the floor is the constant the sheet declares', sheet.floor.toFixed(3))
ok(sheet.peak >= 0.6, 'a shape body is bright', sheet.peak.toFixed(3))
ok(sheet.peak / sheet.floor >= 4, 'contrast makes a shape read as a mark', (sheet.peak / sheet.floor).toFixed(1))
ok(sheet.coverage > 0.08 && sheet.coverage < 0.4, 'the shapes cover enough to read and not enough to bury the art', `${(sheet.coverage * 100).toFixed(2)}%`)

// A shape's interior is flat and the field just beyond it is bare.
{
  const m = marks[0]!
  const field = buildSequinField(SEQUIN_SHEET_SIZE)
  const cx = Math.round(m.x)
  const cy = Math.round(m.y)
  const inside = field[cy * SEQUIN_SHEET_SIZE + cx]
  const outside = field[(cy + Math.round(m.radius) + 3) * SEQUIN_SHEET_SIZE + cx]
  ok(inside >= 0.5, 'a shape interior is a mark', inside.toFixed(3))
  ok(outside <= SEQUIN_FLOOR + 1e-6, 'and the field beyond it is bare', outside.toFixed(3))
}

const seam = sequinSeamMismatch(sheet.rgba, sheet.size)
const internal = sequinInternalStep(sheet.rgba, sheet.size)
ok(
  seam <= internal * 1.15,
  'the wrap step is no larger than the sheet’s own neighbouring-pixel step',
  `${(seam * 100).toFixed(2)}% vs ${(internal * 100).toFixed(2)}%`,
)

const again = renderSequinSheet(SEQUIN_SHEET_SIZE)
let identical = again.rgba.length === sheet.rgba.length
for (let i = 0; identical && i < sheet.rgba.length; i++) if (again.rgba[i] !== sheet.rgba[i]) identical = false
ok(identical, 'the same inputs render byte-identical pixels (the pattern cannot move between frames)')

let neutral = true
for (let i = 0; i < sheet.rgba.length; i += 4) {
  if (sheet.rgba[i] !== 255 || sheet.rgba[i + 1] !== 255 || sheet.rgba[i + 2] !== 255) {
    neutral = false
    break
  }
}
ok(neutral, 'the sheet carries luminance only, never colour')

const small = renderSequinSheet(256)
ok(small.floor <= 0.1 && small.coverage > 0.05, 'a smaller sheet keeps the same shape', `${small.floor.toFixed(3)} / ${(small.coverage * 100).toFixed(1)}%`)

// ---------------------------------------------------------------------------
// 2. The shipped asset and the generated index agree with a fresh render.
// ---------------------------------------------------------------------------
const png = fs.readFileSync('public/foil/sequin/sheet.png')
ok(png.length > 10_000, 'the sheet is shipped and not a stub', `${png.length} bytes`)
ok(png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, 'the sheet is a PNG')
ok(png.readUInt32BE(16) === 1024 && png.readUInt32BE(20) === 1024, 'the PNG is 1024x1024')
ok(Math.abs(SEQUIN_SHEET.floor - sheet.floor) < 1e-4, 'the index floor matches the render')
ok(Math.abs(SEQUIN_SHEET.peak - sheet.peak) < 1e-4, 'the index peak matches the render')
ok(Math.abs(SEQUIN_SHEET.coverage - sheet.coverage) < 1e-4, 'the index coverage matches the render')
ok(SEQUIN_SHEET.marks === sheet.marks, 'the index counts the shapes', `${SEQUIN_SHEET.marks} vs ${sheet.marks}`)
ok(Math.abs(SEQUIN_SHEET.seamMismatch - seam) < 1e-3, 'the index records the measured wrap step')
ok(Math.abs(SEQUIN_SHEET.internalStep - internal) < 1e-3, 'and the internal step it is judged against')
ok(SEQUIN_SHEET.concept === true && SEQUIN_SHEET.textureVerified === false, 'the index declares the sheet a reconstruction')
ok(SEQUIN_SHEET.cell === SEQUIN_CELL, 'the index records the cell pitch')
ok(SEQUIN_TEXTURE_VERIFIED === false, 'the sampler exposes no verified-texture claim')
ok(SEQUIN_CLAIM.includes('many small reflective geometric shapes'), 'the claim quotes the source, not a paraphrase')
ok(/exclusively used for General Mills/.test(SEQUIN_CLAIM), 'and records which product line the paper belongs to')
ok(/separate inventory rows/.test(SEQUIN_CARDS_CAVEAT), 'the index records that the two printings are separate rows')

const grid = buildSequinGrid(sheet.size, sheet.size, sheet.rgba)
{
  let lo = 1
  let hi = 0
  let marked = 0
  for (let i = 0; i < grid.mark.length; i++) {
    lo = Math.min(lo, grid.mark[i])
    hi = Math.max(hi, grid.mark[i])
    if (grid.mark[i] >= SEQUIN_MARK_LINE) marked++
  }
  ok(lo <= 0.1, 'the grid keeps the dark field', lo.toFixed(3))
  ok(hi >= 0.6, 'and the bright shapes', hi.toFixed(3))
  ok(hi - lo > 0.5, 'the field varies across the sheet', `${lo.toFixed(2)}–${hi.toFixed(2)}`)
  const frac = marked / grid.mark.length
  ok(frac > 0.05, 'the grid keeps the shapes through the downsample', `${(frac * 100).toFixed(2)}%`)
}

// ---------------------------------------------------------------------------
// 3. Per-card cuts: stable between frames, different between cards, wrapping.
// ---------------------------------------------------------------------------
const c1 = sequinCopyFor('smp-SM01')
const c1b = sequinCopyFor('smp-SM01')
const c2 = sequinCopyFor('swshp-SWSH013')
ok(c1.seed === c1b.seed && c1.offsetU === c1b.offsetU && c1.offsetV === c1b.offsetV, 'a card keeps its cut between frames')
ok(c1.offsetU !== c2.offsetU || c1.offsetV !== c2.offsetV, 'two cards sit at different cuts')

const s1 = sampleSequin(c1, grid, 0.31, 0.42)
ok(s1.mark === sampleSequin(c1, grid, 0.31, 0.42).mark, 'sampling is stable for a fixed point')
const wrappedU = sampleSequin({ ...c1, offsetU: c1.offsetU + 1 }, grid, 0.31, 0.42).mark
const wrappedV = sampleSequin({ ...c1, offsetV: c1.offsetV + 1 }, grid, 0.31, 0.42).mark
ok(Math.abs(wrappedU - s1.mark) < 1e-9 && Math.abs(wrappedV - s1.mark) < 1e-9, 'the sampler wraps instead of clamping at the sheet edge')

const field = sequinFieldFor('smp-SM01', grid)
ok(field.verified === false, 'the field carries no verified-texture claim')
ok(field.plain !== true, 'sequin is not a plain field')
ok(String(field.meta.reproduction) === 'procedural reconstruction', 'the field names its reproduction as procedural')
ok(/wrap/i.test(String(field.meta.tiling)), 'the field discloses how the sheet wraps', String(field.meta.tiling))

let fieldLo = 1
let fieldHi = 0
for (let v = 0.01; v < 1; v += 0.01) {
  for (let u = 0.01; u < 1; u += 0.01) {
    const m = field.mark(u, v)
    fieldLo = Math.min(fieldLo, m)
    fieldHi = Math.max(fieldHi, m)
  }
}
ok(fieldHi - fieldLo > 0.2, 'the shapes vary across the card', `${fieldLo.toFixed(2)}–${fieldHi.toFixed(2)}`)
ok(fieldLo <= 0.12, 'and the field between them stays dark', fieldLo.toFixed(3))

// ---------------------------------------------------------------------------
// 4. The registry ships it; no catalogue card claims it.
// ---------------------------------------------------------------------------
ok(PATTERNS.sequin.implemented === true, 'the registry says sequin is painted')
ok(PATTERNS.sequin.texture === SEQUIN_SHEET.pattern, 'the registry points at this sheet')
ok(fs.existsSync('public' + PATTERNS.sequin.texture!), 'the file it points at ships')

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db.prepare('select id, set_id, number, name, rarity from cards order by id').all() as
  { id: string; set_id: string; number: string; name: string; rarity: string | null }[]
db.close()

const resolved = rows.filter((row) => {
  const art = holoFor({ cardId: row.id, rarity: row.rarity ?? undefined, variant: SEQUIN_VARIANT })
  return art?.pattern === 'sequin'
})
ok(resolved.length === 19, 'the 19 cards Bulbapedia’s Sequin tables name resolve to the paper', `${resolved.length} found`)
ok(SEQUIN_CARDS.length === resolved.length, 'the generated card list matches the sweep', `${SEQUIN_CARDS.length} vs ${resolved.length}`)
ok(SEQUIN_PRINTINGS.length === 19, 'the printing table names 19 cards', String(SEQUIN_PRINTINGS.length))

// Each named card resolves from its own row, at `explicit`, with the modelled window and the
// page it was read from — the four things that make this a per-card claim rather than a guess.
const generatedIds = new Set(SEQUIN_CARDS.map((c) => c.cardId))
for (const entry of SEQUIN_PRINTINGS) {
  ok(rows.some((r) => r.id === entry.cardId), `${entry.cardId}: the catalogue holds the row`)
  const printing = printingFor({ cardId: entry.cardId, name: entry.name, variant: SEQUIN_VARIANT })
  ok(printing?.pattern === 'sequin', `${entry.cardId}: the sequin variant resolves to the paper`, String(printing?.pattern))
  ok(printing?.variant === 'sequin', `${entry.cardId}: as its own printing variant`, String(printing?.variant))
  ok(printing?.status === 'verified' && printing?.matchedRule === 'explicit', `${entry.cardId}: the paper is named, not an era rule`)
  ok(printing?.mask === 'art' && printing?.maskVerified === false, `${entry.cardId}: the area is modelled, not sourced`)
  ok(printing?.source === entry.source, `${entry.cardId}: records the page it came from`)
  ok(generatedIds.has(entry.cardId), `${entry.cardId}: the generated list carries it`)
  // The split the variant exists for: the plain printing of the same number claims nothing.
  ok(printingFor({ cardId: entry.cardId, name: entry.name }) === null, `${entry.cardId}: the plain printing makes no foil claim`)
  ok(holoFor({ cardId: entry.cardId }) === null, `${entry.cardId}: so the overlay paints it plain`)
  ok(holoFor({ cardId: entry.cardId, variant: SEQUIN_VARIANT })?.pattern === 'sequin', `${entry.cardId}: the token reaches the renderer`, String(holoFor({ cardId: entry.cardId, variant: SEQUIN_VARIANT })?.pattern))
  ok(foilMaskFor({ cardId: entry.cardId, variant: SEQUIN_VARIANT })?.kind === 'art', `${entry.cardId}: the sequin copy's mask is the illustration window`)
  ok(foilMaskFor({ cardId: entry.cardId }) === null, `${entry.cardId}: and the plain copy has no mask at all`)
}

// The list is those three products and nothing else: eight SM promos, the five Let's Go
// reprints (set cards, not promos) and six 25th Anniversary promos.
const smPromos = SEQUIN_CARDS.filter((c) => c.setId === 'smp').length
const letGo = SEQUIN_CARDS.filter((c) => ['sm1', 'sm3', 'sm6', 'sm35'].includes(c.setId)).length
const ann25 = SEQUIN_CARDS.filter((c) => c.setId === 'swshp').length
ok(smPromos === 8, 'eight Sun & Moon promos wear it', String(smPromos))
ok(letGo === 5, 'five Let’s Go, Kanto! reprints wear it', String(letGo))
ok(ann25 === 6, 'six 25th Anniversary promos wear it', String(ann25))

// A card outside the campaign does not get the paper, and no reverse printing is invented.
for (const id of ['sv8-25', 'sv3pt5-6', 'swsh1-1']) {
  ok(holoFor({ cardId: id })?.pattern !== 'sequin', `${id}: a card outside the campaign is not sequin`)
  ok(printingFor({ cardId: id })?.pattern !== 'sequin', `${id}: and no printing record says it is`)
}
ok(printingFor({ cardId: 'smp-SM01', variant: 'reverseHolofoil' }) === null, 'a reverse token does not conjure a sequin reverse printing')
ok(/separate inventory rows/.test(SEQUIN_CARDS_CAVEAT), 'the caveat states the variant split, not a clean bill')

// ---------------------------------------------------------------------------
// 5. The render obeys the layer contract.
// ---------------------------------------------------------------------------
const W = 200
const H = 279
const base = new Uint8ClampedArray(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    base[i] = 62 + Math.round((x / W) * 96)
    base[i + 1] = 88 + Math.round((y / H) * 64)
    base[i + 2] = 104
    base[i + 3] = 255
  }
}

const target = 'me55c-4'
const spec = foilMaskFor({ cardId: target, rarity: 'Rare Holo' })
ok(!!spec, 'the render target has a mask')
const area = coverageFraction(spec!)
ok(area > 0.2, 'the mask is a real foil area', area.toFixed(3))

const out = new Uint8ClampedArray(W * H * 4)
paintFoil(out, base, W, H, spec!, FACE_ON, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
let restDiff = 0
for (let i = 0; i < base.length; i++) if (out[i] !== base[i]) restDiff++
ok(restDiff === 0, 'at rest the composite is the scan byte for byte', `${restDiff} bytes differ`)

paintFoil(out, base, W, H, spec!, { deg: 55, axis: 45 }, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
let outsideChanged = 0
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (maskValue(spec!, (x + 0.5) / W, (y + 0.5) / H, W / H) !== 0) continue
    const i = (y * W + x) * 4
    if (out[i] !== base[i] || out[i + 1] !== base[i + 1] || out[i + 2] !== base[i + 2]) outsideChanged++
  }
}
ok(outsideChanged === 0, 'tilted light never lands outside the mask', `${outsideChanged} pixels`)
const lift = meanLift(base, out, W, H, spec!)
ok(lift > 0.5, 'the paper lifts its face at 55°', lift.toFixed(2))

const modulate = patternModulatorFor(null, W / H, DEFAULT_FOIL_SETTINGS, field)
let modLo = 1
let modHi = 0
for (let v = 0.01; v < 1; v += 0.02) {
  for (let u = 0.01; u < 1; u += 0.02) {
    const m = modulate(u, v, 0)
    modLo = Math.min(modLo, m)
    modHi = Math.max(modHi, m)
  }
}
ok(modHi - modLo > 0.05, 'the shapes shape the reflection across the card', `${modLo.toFixed(2)}–${modHi.toFixed(2)}`)
ok(modLo > 0.1, 'and never extinguish it', modLo.toFixed(3))

// ---------------------------------------------------------------------------
// 6. The report exists, matches the database, and does not overclaim.
// ---------------------------------------------------------------------------
{
  const report = JSON.parse(fs.readFileSync('reports/sequin-printings.json', 'utf8')) as {
    counts: { claimed: number; indexCards: number; printingClaims: number; textureVerified: boolean; reliefClaimed: boolean; marks: number }
    cards: unknown[]
    sheet: typeof SEQUIN_SHEET
    problems: string[]
  }
  ok(report.counts.claimed === resolved.length, 'the report counts the cards the sweep finds', `${report.counts.claimed}`)
  ok(report.counts.indexCards === SEQUIN_CARDS.length, 'the report counts the generated list')
  ok(report.counts.printingClaims === SEQUIN_PRINTINGS.length, 'the report counts the printing records that name the paper')
  ok(report.counts.textureVerified === false, 'the report refuses to call the texture verified')
  ok(report.counts.reliefClaimed === false, 'and claims no relief')
  ok(report.cards.length === resolved.length && report.problems.length === 0, 'the report has no unresolved row')
  ok(report.sheet.pattern === SEQUIN_SHEET.pattern, 'the report ships the registry’s sheet')
}

// The pattern must never be generated at render time.
for (const f of [
  'src/foil/sequin-sheet.ts',
  'src/foil/sequin.ts',
  'scripts/sequin-foil.ts',
  'src/foil/sequin-index.ts',
]) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
