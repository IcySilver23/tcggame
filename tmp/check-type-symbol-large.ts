// Phase 5H: the Sun & Moon large type-symbol paper.
//
// Checked: twelve large sheets ship, one glyph sits at the left rather than a
// repeated field, the sampler anchors it there with an aspect-correct window, all
// 13 expansions are validated with the body mask, and the render contract holds.
//
// Run: ./node_modules/.bin/tsx tmp/check-type-symbol-large.ts

import fs from 'node:fs'
import { renderLargeTypeSymbolSheet, GLYPH_IDS, TYPE_SYMBOL_SEED } from '../src/foil/type-glyph'
import {
  buildLargeSymbolGrid, largeSymbolCopyFor, sampleLargeTypeSymbol,
  largeTypeSymbolFieldFor,
} from '../src/foil/type-symbol-large'
import {
  LARGE_TYPE_SYMBOL_ASSETS, LARGE_TYPE_SYMBOL_SHOWCASE, LARGE_TYPE_SYMBOL_TEXTURE_VERIFIED,
} from '../src/foil/type-symbol-large-index'
import { REVERSE_EXPANSIONS } from '../src/foil/reverse-db'
import { printingFor } from '../src/foil/printing-db'
import { foilMaskFor, maskValue } from '../src/foil/mask'
import { DEFAULT_FOIL_SETTINGS, meanLift, paintFoil } from '../src/foil/stages'
import { FACE_ON } from '../src/foil/reflection'

let total = 0
let fails = 0
function ok(cond: boolean, label: string, detail?: string): void {
  total++
  if (!cond) { fails++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

console.log('Sun & Moon large type symbol — sheets, placement, 13 expansions')

const sheet = renderLargeTypeSymbolSheet('grass', 512, TYPE_SYMBOL_SEED)
ok(sheet.coverage > 0.008 && sheet.coverage < 0.12, 'one large glyph covers a small part of the sheet', sheet.coverage.toFixed(3))
ok(sheet.peak > 0.8, 'the glyph is bright', sheet.peak.toFixed(2))
ok(sheet.centerU > 0.2 && sheet.centerU < 0.4, 'the glyph is drawn at the left of the sheet', sheet.centerU.toFixed(2))

ok(GLYPH_IDS.length === 12, 'twelve glyphs exist')
ok(Object.keys(LARGE_TYPE_SYMBOL_ASSETS).length === 12, 'the index lists twelve large sheets')
for (const id of GLYPH_IDS) {
  const a = LARGE_TYPE_SYMBOL_ASSETS[id]
  ok(!!a && fs.existsSync('public' + a.texture), `${id}: large sheet ships`)
  ok(!!a && a.coverage > 0.008 && a.coverage < 0.12, `${id}: one mark, not a field`)
  ok(!!a && a.peak > 0.8, `${id}: bright mark`)
}
ok(Math.abs(LARGE_TYPE_SYMBOL_ASSETS.grass.coverage - sheet.coverage) < 1e-4, 'index coverage matches the render')
ok(LARGE_TYPE_SYMBOL_TEXTURE_VERIFIED === false, 'the artwork is not claimed as verified')

const grid = buildLargeSymbolGrid(512, 512, sheet.rgba)
const copy = largeSymbolCopyFor('sm1-1', LARGE_TYPE_SYMBOL_ASSETS.grass)
let best = 0
let bestU = 0
for (let v = 0.1; v < 0.9; v += 0.02) {
  for (let u = 0.02; u < 0.98; u += 0.02) {
    const m = sampleLargeTypeSymbol(copy, grid, u, v).mark
    if (m > best) { best = m; bestU = u }
  }
}
ok(best > 0.7, 'the symbol is visible inside the card window', best.toFixed(2))
ok(bestU < 0.45, 'it sits on the left of the card, not the centre', bestU.toFixed(2))
ok(sampleLargeTypeSymbol(copy, grid, 0.85, 0.5).mark < 0.1, 'the right side of the body is blank')
ok(sampleLargeTypeSymbol(copy, grid, 0.25, 0.5).mark === sampleLargeTypeSymbol(copy, grid, 0.25, 0.5).mark, 'sampling is stable')

const field = largeTypeSymbolFieldFor('sm1-1', 'grass', grid)
ok(field.verified === false, 'the field carries no verified-texture claim')
ok(String(field.meta.placement) === 'left of the card body', 'the field records the placement')

const largeSets = REVERSE_EXPANSIONS.filter((e) => e.pattern === 'reverse-type-symbol-large')
ok(largeSets.length === 13, 'the paper covers 13 expansions', String(largeSets.length))
ok(largeSets.every((e) => e.implemented), 'all are validated')
ok(largeSets.every((e) => e.mask === 'outside-art'), 'all use the body mask')
ok(largeSets.some((e) => e.setId === 'sm1') && largeSets.some((e) => e.setId === 'sm12'), 'SM1–12 are covered')
ok(largeSets.some((e) => e.setId === 'det1'), 'Detective Pikachu is covered')

const printing = printingFor({ cardId: 'sm1-1', rarity: 'Common', variant: 'reverseHolofoil' })
ok(printing?.pattern === 'reverse-type-symbol-large' && printing.mask === 'outside-art', 'SM reverses resolve to the large-symbol paper')
const spec = foilMaskFor({ cardId: 'sm1-1', rarity: 'Common', variant: 'reverseHolofoil' })
ok(spec?.kind === 'outsideArt' && spec.verified, 'with the verified body mask')
ok(spec ? maskValue(spec, 0.5, 0.3) === 0 : false, 'the artwork is matte')
ok(spec ? maskValue(spec, 0.5, 0.95) === 255 : false, 'the text panel is foil')

const W = 200
const H = 279
const base = new Uint8ClampedArray(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    base[i] = 38 + Math.round((x / W) * 90)
    base[i + 1] = 50 + Math.round((y / H) * 80)
    base[i + 2] = 70
    base[i + 3] = 255
  }
}
const out = new Uint8ClampedArray(W * H * 4)
paintFoil(out, base, W, H, spec, FACE_ON, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
let rest = 0
for (let i = 0; i < base.length; i++) if (out[i] !== base[i]) rest++
ok(rest === 0, 'at rest the composite is the scan', `${rest} bytes`)
paintFoil(out, base, W, H, spec, { deg: 55, axis: 45 }, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
let art = 0
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, W / H) !== 0) continue
    const i = (y * W + x) * 4
    if (out[i] !== base[i] || out[i + 1] !== base[i + 1] || out[i + 2] !== base[i + 2]) art++
  }
}
ok(art === 0, 'light never enters the artwork', `${art} px`)
ok(meanLift(base, out, W, H, spec) > 0.5, 'the symbol lifts the body at 55°', meanLift(base, out, W, H, spec).toFixed(2))

const report = JSON.parse(fs.readFileSync('reports/type-symbol-large-printings.json', 'utf8')) as {
  counts: { expansions: number; validated: number; glyphs: number; textureVerified: boolean }
  problems: string[]
}
ok(report.counts.expansions === 13 && report.counts.validated === 13, 'the report counts 13 validated expansions')
ok(report.counts.glyphs === 12, 'the report counts twelve glyphs')
ok(report.counts.textureVerified === false, 'the report refuses to verify the artwork')
ok(report.problems.length === 0, 'the report has no problems')
ok(LARGE_TYPE_SYMBOL_SHOWCASE.length >= 2, 'the inspector has showcase cards')

for (const f of ['src/foil/type-glyph.ts', 'src/foil/type-symbol-large.ts', 'scripts/type-symbol-large-foil.ts']) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
