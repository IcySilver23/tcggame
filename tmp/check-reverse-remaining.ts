// Phase 5K/5L: the last 22 reverse expansions — plain body, energy symbols in the
// window, and plain foil in the artwork background.
//
// Run: ./node_modules/.bin/tsx tmp/check-reverse-remaining.ts

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { REVERSE_EXPANSIONS, REVERSE_IMPLEMENTED, reverseConfigFor, reverseEligible, reversePending } from '../src/foil/reverse-db'
import { printingFor } from '../src/foil/printing-db'
import { foilMaskFor, maskValue } from '../src/foil/mask'
import { paintFoil, DEFAULT_FOIL_SETTINGS, meanLift } from '../src/foil/stages'
import { FACE_ON } from '../src/foil/reflection'
import { buildReverseEnergyGrid, reverseEnergyFieldFor, energyOffsetFor, sampleReverseEnergy, REVERSE_ENERGY_SCALE, REVERSE_ENERGY_TEXTURE_VERIFIED } from '../src/foil/reverse-energy'
import { flatBackgroundFieldFor } from '../src/foil/reverse-flat-background'
import { TYPE_SYMBOL_ASSETS } from '../src/foil/type-symbol-index'
import { glyphForCard } from '../src/foil/type-symbol'

let total = 0
let fails = 0
function ok(cond: boolean, label: string, detail?: string): void {
  total++
  if (!cond) { fails++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

console.log('Remaining reverse families — plain body, energy symbols, background foil')

const FLAT = ['ecard2', 'ecard3', 'ex1', 'ex2', 'ex3', 'ex4', 'me1', 'me2', 'me2pt5', 'me3', 'me4', 'me5', 'me55']
const ENERGY = ['ex5', 'ex6', 'ex7']
const BACKGROUND = ['ex11', 'ex12', 'ex13', 'ex14', 'ex15', 'ex16']
const OPEN = [...FLAT, ...ENERGY, ...BACKGROUND]

ok(OPEN.length === 22, 'the last families hold 22 expansions', String(OPEN.length))
for (const id of OPEN) {
  const cfg = reverseConfigFor(id)
  ok(!!cfg, `${id}: configured`)
  ok(!!cfg?.implemented, `${id}: validated`)
}
ok(REVERSE_EXPANSIONS.length === 112, 'the catalogue holds 112 expansions', String(REVERSE_EXPANSIONS.length))
ok(REVERSE_EXPANSIONS.every((e) => e.implemented), 'every expansion is now validated')
ok(reversePending().length === 0, 'nothing is left pending', String(reversePending().length))
ok(reversePending().every((p) => p.expansions === 0), 'no pending family has expansions')

for (const id of FLAT) {
  const cfg = reverseConfigFor(id)
  ok(cfg?.pattern === 'reverse-flat', `${id}: plain body paper`, cfg?.pattern)
  ok(cfg?.mask === 'outside-art', `${id}: body mask`)
  ok(cfg?.status === 'verified', `${id}: plain finish verified`)
}
for (const id of ENERGY) {
  const cfg = reverseConfigFor(id)
  ok(cfg?.pattern === 'reverse-energy-symbol', `${id}: energy-symbol paper`, cfg?.pattern)
  ok(cfg?.mask === 'art', `${id}: picture-window mask`)
}
for (const id of BACKGROUND) {
  const cfg = reverseConfigFor(id)
  ok(cfg?.pattern === 'reverse-flat-background', `${id}: background foil`, cfg?.pattern)
  ok(cfg?.mask === 'art', `${id}: window mask`)
  ok(cfg?.status === 'approximated', `${id}: area disclosed as approximated`)
}

ok(REVERSE_IMPLEMENTED.includes('reverse-flat') && REVERSE_IMPLEMENTED.includes('reverse-energy-symbol') && REVERSE_IMPLEMENTED.includes('reverse-flat-background'),
  'all three patterns count as implemented')

// ---------------------------------------------------------------- energy field
const size = 96
const rgba = new Uint8ClampedArray(size * size * 4)
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4
    const ink = ((x * 7 + y * 11) % 13) < 3 ? 240 : 20
    rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255; rgba[i + 3] = ink
  }
}
const grid = buildReverseEnergyGrid(size, size, rgba, size)
ok(grid.size === size, 'the energy grid keeps its sheet size')
ok(grid.coverage > 0.01 && grid.peak > 0.5, 'the grid measures its own coverage and peak')
const energyField = reverseEnergyFieldFor('ex5-1', 'grass', grid)
ok(energyField.verified === REVERSE_ENERGY_TEXTURE_VERIFIED && energyField.verified === false, 'the energy field makes no verified-texture claim')
ok(energyField.plain !== true, 'the energy field is not plain')
ok(String(energyField.meta.pattern) === 'reverse-energy-symbol', 'the field records its pattern')
ok(String(energyField.meta.glyph) === 'grass', 'the field records its glyph')
const off = energyOffsetFor('ex5-1')
ok(off.offsetU >= 0 && off.offsetU < 1 && off.offsetV >= 0 && off.offsetV < 1, 'per-card registration is in range')
ok(sampleReverseEnergy('ex5-1', grid, 0.3, 0.3) === sampleReverseEnergy('ex5-1', grid, 0.3 + 1 / REVERSE_ENERGY_SCALE, 0.3), 'the field repeats at its own period')
let differs = false
for (let k = 0; k < 20 && !differs; k++) if (sampleReverseEnergy('ex5-1', grid, 0.11 * k, 0.07 * k) !== sampleReverseEnergy('ex6-1', grid, 0.11 * k, 0.07 * k)) differs = true
ok(differs, 'two cards register differently')
ok(TYPE_SYMBOL_ASSETS.grass.coverage > 0 && fs.existsSync('public' + TYPE_SYMBOL_ASSETS.grass.texture), 'the glyph sheet it samples exists')

// ----------------------------------------------------------- background field
const bg = flatBackgroundFieldFor('ex11-1')
ok(bg.plain === true && bg.mark(0.2, 0.2) === 1 && bg.mark(0.8, 0.8) === 1, 'background foil is uniform')
ok(bg.verified === false, 'the approximated area is not claimed as verified')
ok(String(bg.meta.pattern) === 'reverse-flat-background', 'the background field records its pattern')

// ----------------------------------------------------------------- rendering
const db = new Database('data/tcglife.db', { readonly: true })
function sampleCard(setId: string): { number: string; rarity: string | null } {
  const row = db.prepare('select number, rarity from cards where set_id = ? order by number limit 1').get(setId) as
    { number: string; rarity: string | null } | undefined
  return row ?? { number: '1', rarity: 'Common' }
}
const W = 200
const H = 279
const base = new Uint8ClampedArray(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    base[i] = 44 + Math.round((x / W) * 76)
    base[i + 1] = 58 + Math.round((y / H) * 68)
    base[i + 2] = 90
    base[i + 3] = 255
  }
}
const out = new Uint8ClampedArray(W * H * 4)

function render(setId: string, field: ReturnType<typeof flatBackgroundFieldFor> | null): { spec: ReturnType<typeof foilMaskFor>; artLight: number; lift: number } {
  const card = sampleCard(setId)
  const input = { cardId: `${setId}-${card.number}`, rarity: card.rarity, variant: 'reverseHolofoil' }
  const spec = foilMaskFor(input)
  paintFoil(out, base, W, H, spec, FACE_ON, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
  let rest = 0
  for (let i = 0; i < base.length; i++) if (out[i] !== base[i]) rest++
  ok(rest === 0, `${setId}: at rest the composite is the scan`, `${rest} bytes`)
  paintFoil(out, base, W, H, spec, { deg: 55, axis: 45 }, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
  let artLight = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, W / H) !== 0) continue
      const i = (y * W + x) * 4
      if (out[i] !== base[i] || out[i + 1] !== base[i + 1] || out[i + 2] !== base[i + 2]) artLight++
    }
  }
  return { spec, artLight, lift: meanLift(base, out, W, H, spec) }
}

const flat = render('me1', flatBackgroundFieldFor('me1-1'))
ok(flat.spec?.kind === 'outsideArt', 'Mega Evolution uses the body mask')
ok(flat.artLight === 0, 'the artwork stays untouched on the body paper', String(flat.artLight))
ok(flat.lift > 1, 'the plain body paper lifts at 55°', flat.lift.toFixed(2))

const energy = render('ex5', energyField)
ok(energy.spec?.kind === 'art', 'energy symbols use the picture-window mask')
ok(energy.artLight === 0, 'nothing is lit outside the window', String(energy.artLight))
ok(energy.lift > 1, 'the symbols lift the window at 55°', energy.lift.toFixed(2))

const background = render('ex11', bg)
ok(background.spec?.kind === 'art', 'background foil uses the picture-window mask')
ok(background.artLight === 0, 'nothing is lit outside the window', String(background.artLight))
ok(background.lift > 1, 'the background foil lifts at 55°', background.lift.toFixed(2))

db.close()

// --------------------------------------------------------------- eligibility
ok(!reverseEligible({ setId: 'ex11', number: '1', rarity: 'Gold Star' }), 'a Gold Star gets no reverse counterpart')
ok(!reverseEligible({ setId: 'me1', number: '1', rarity: 'Special Illustration Rare' }), 'an illustration rare gets none')
ok(reverseEligible({ setId: 'ex5', number: '1', rarity: 'Common' }), 'a regular card does get one')
ok(printingFor({ cardId: 'ex5-1', rarity: 'Common', variant: 'reverseHolofoil' })?.pattern === 'reverse-energy-symbol',
  'ex5 resolves through the printing database')
ok(printingFor({ cardId: 'ex11-1', rarity: 'Common', variant: 'reverseHolofoil' })?.pattern === 'reverse-flat-background',
  'ex11 resolves through the printing database')

const report = JSON.parse(fs.readFileSync('reports/reverse-printings.json', 'utf8')) as {
  counts: { expansionsValidated: number; patternsPainted: number; expansions: number }
  pendingPatterns: { pattern: string; expansions: number }[]
}
ok(report.counts.expansionsValidated === 112, 'the report validates all 112', String(report.counts.expansionsValidated))
ok(report.counts.patternsPainted === 10, 'the report counts ten painted patterns', String(report.counts.patternsPainted))
ok(report.pendingPatterns.length === 0, 'the report lists no pending families')

for (const f of ['src/foil/reverse-energy.ts', 'src/foil/reverse-flat-background.ts']) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
