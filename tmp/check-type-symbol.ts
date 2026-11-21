// Phase 5F: the type-symbol reverse paper.
//
// Claims checked:
//   - the glyphs are distinguishable geometric marks, not one blob reused;
//   - the twelve sheets ship, tile, and match the generated index;
//   - the loader chooses the card's own symbol, and refuses when the type is
//     unknown (plain foil, never the wrong glyph);
//   - all 24 BW/XY expansions are marked validated, resolve reverse printings and
//     render on the body with the artwork matte.
//
// Run: ./node_modules/.bin/tsx tmp/check-type-symbol.ts

import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  glyphInk,
  renderTypeSymbolSheet,
  GLYPH_IDS,
  TYPE_SYMBOL_SEED,
} from '../src/foil/type-glyph'
import {
  buildSymbolGrid,
  glyphForCard,
  loadTypeSymbolField,
  parseTypes,
  sampleTypeSymbol,
  symbolCopyFor,
  typeSymbolFieldFor,
} from '../src/foil/type-symbol'
import {
  TYPE_SYMBOL_ASSETS,
  TYPE_SYMBOL_CONCEPT,
  TYPE_SYMBOL_SCALE,
  TYPE_SYMBOL_SHOWCASE,
  TYPE_SYMBOL_TEXTURE_VERIFIED,
} from '../src/foil/type-symbol-index'
import { REVERSE_EXPANSIONS, reverseConfigFor, reverseEligible } from '../src/foil/reverse-db'
import { printingFor } from '../src/foil/printing-db'
import { holoFor } from '../src/holo'
import { coverageFraction, foilMaskFor, maskValue } from '../src/foil/mask'
import { DEFAULT_FOIL_SETTINGS, meanLift, paintFoil } from '../src/foil/stages'
import { FACE_ON } from '../src/foil/reflection'
import { PATTERNS } from '../src/foil/patterns'

let total = 0
let fails = 0
function ok(cond: boolean, label: string, detail?: string): void {
  total++
  if (!cond) { fails++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

console.log('Type-symbol reverse paper — glyphs, routing, 24 expansions')

// ---------------------------------------------------------------------------
// 1. Glyphs are distinct marks with the right silhouette.
// ---------------------------------------------------------------------------
ok(glyphInk('water', 0, 0.2) === 1, 'the water glyph is solid at its drop body')
ok(glyphInk('water', 0.9, 0.9) === 0, 'and empty at the glyph corner')
ok(glyphInk('water', 0, -0.8) === 1, 'with a tapered tip')
ok(glyphInk('trainer', 0, 0.7) === 1, 'the Trainer glyph has a Poké Ball rim')
ok(glyphInk('trainer', 0, 0.42) === 0, 'and is open between rim and band')
ok(glyphInk('trainer', 0, 0) === 1, 'with a solid centre button on the equator band', String(glyphInk('trainer', 0, 0)))
ok(glyphInk('trainer', 0, 0.26) === 1, 'the button ring is drawn')
ok(glyphInk('lightning', 0.1, -0.6) === 1 && glyphInk('lightning', -0.8, 0.8) === 0, 'the lightning bolt is a bolt, not a box')
ok(glyphInk('colorless', 0, 0) === 1 && glyphInk('colorless', 0.8, 0.8) === 0, 'the Colorless glyph is a star')
ok(glyphInk('darkness', -0.2, 0) === 1 && glyphInk('darkness', 0.5, 0) === 0, 'the Darkness glyph is a crescent')
ok(glyphInk('metal', 0, 0.6) === 1 && glyphInk('metal', 0, 0) === 1, 'the Metal glyph is a hex nut with a hub')

const grassSheet = renderTypeSymbolSheet('grass', 512, TYPE_SYMBOL_SEED)
const trainerSheet = renderTypeSymbolSheet('trainer', 512, TYPE_SYMBOL_SEED)
ok(grassSheet.coverage > 0.02 && grassSheet.coverage < 0.3, 'the Grass sheet is sparse enough to read', grassSheet.coverage.toFixed(3))
ok(trainerSheet.coverage > 0.02 && trainerSheet.coverage < 0.3, 'the Trainer sheet is sparse too', trainerSheet.coverage.toFixed(3))
ok(grassSheet.peak > 0.5 && trainerSheet.peak > 0.5, 'both sheets have a bright core')
ok(grassSheet.seamRatio < 2, 'the Grass sheet tiles', grassSheet.seamRatio.toFixed(3))
ok(trainerSheet.glyphs === 64, 'a sheet carries 64 glyphs', String(trainerSheet.glyphs))
const grassAgain = renderTypeSymbolSheet('grass', 512, TYPE_SYMBOL_SEED)
let identical = true
for (let i = 0; i < grassSheet.rgba.length; i++) if (grassSheet.rgba[i] !== grassAgain.rgba[i]) { identical = false; break }
ok(identical, 'the same seed renders byte-identical glyphs')

// ---------------------------------------------------------------------------
// 2. Twelve sheets ship and the index agrees with a fresh render.
// ---------------------------------------------------------------------------
ok(GLYPH_IDS.length === 12, 'twelve glyphs exist', String(GLYPH_IDS.length))
ok(Object.keys(TYPE_SYMBOL_ASSETS).length === 12, 'the index lists twelve sheets')
for (const id of GLYPH_IDS) {
  const asset = TYPE_SYMBOL_ASSETS[id]
  ok(!!asset, `${id}: indexed`)
  ok(fs.existsSync('public' + asset.texture), `${id}: texture ships`, asset.texture)
  ok(asset.coverage > 0.02 && asset.coverage < 0.3 && asset.peak > 0.5, `${id}: measured coverage and peak are plausible`)
}
ok(Math.abs(TYPE_SYMBOL_ASSETS.grass.coverage - grassSheet.coverage) < 1e-4, 'index coverage matches the render')
ok(Math.abs(TYPE_SYMBOL_ASSETS.grass.peak - grassSheet.peak) < 1e-4, 'index peak matches the render')
ok(TYPE_SYMBOL_CONCEPT === true && TYPE_SYMBOL_TEXTURE_VERIFIED === false, 'the index calls the artwork a reconstruction')
ok(TYPE_SYMBOL_TEXTURE_VERIFIED === false, 'the sampler exposes no verified-texture claim')

const grid = buildSymbolGrid(grassSheet.size, grassSheet.size, grassSheet.rgba)
ok(grid.coverage > 0.02 && grid.peak > 0.5, 'the sampling grid carries the glyphs')

// ---------------------------------------------------------------------------
// 3. The loader picks the card's own type — or nothing.
// ---------------------------------------------------------------------------
ok(parseTypes('["Grass"]')[0] === 'Grass', 'types parse from the card-row JSON')
ok(parseTypes(['Fire'])[0] === 'Fire', 'and from an array')
ok(parseTypes(null).length === 0, 'missing types parse to nothing')
ok(glyphForCard({ types: '["Grass"]' }) === 'grass', 'a Grass Pokémon gets the Grass glyph')
ok(glyphForCard({ types: '["Lightning"]' }) === 'lightning', 'a Lightning Pokémon gets the bolt')
ok(glyphForCard({ types: '["Colorless"]' }) === 'colorless', 'a Colorless Pokémon gets the star')
ok(glyphForCard({ types: null, supertype: 'Trainer' }) === 'trainer', 'a Trainer gets the Poké Ball')
ok(glyphForCard({ types: '["Water"]', supertype: 'Pokémon' }) === 'water', 'a Water Pokémon gets the drop')
ok(glyphForCard({ types: null, supertype: 'Energy' }) === null, 'an untyped Energy card gets no symbol')
ok(glyphForCard({ types: '["Cosmic"]' }) === null, 'an unknown type gets no symbol')
ok(glyphForCard({ types: null, supertype: null }) === null, 'no type at all gets no symbol')

const copy = symbolCopyFor('bw2-1')
const a = sampleTypeSymbol(copy, grid, 0.2, 0.4)
const b = sampleTypeSymbol(copy, grid, 0.2 + 1 / TYPE_SYMBOL_SCALE, 0.4)
ok(Math.abs(a.mark - b.mark) < 1e-6, 'sampling wraps at the tile period', `${a.mark} vs ${b.mark}`)
ok(sampleTypeSymbol(copy, grid, 0.3, 0.3).mark === sampleTypeSymbol(copy, grid, 0.3, 0.3).mark, 'sampling is stable frame to frame')
const field = typeSymbolFieldFor('bw2-1', 'grass', grid)
ok(field.verified === false, 'the field carries no verified-texture claim')
ok(String(field.meta.glyph) === 'grass', 'the field names the glyph it draws')
ok(field.coverage > 0.02 && field.peak > 0.5, 'the field reports real coverage')

// ---------------------------------------------------------------------------
// 4. All 24 BW/XY expansions are validated and resolve on the body.
// ---------------------------------------------------------------------------
const symbolSets = REVERSE_EXPANSIONS.filter((e) => e.pattern === 'reverse-type-symbol')
ok(symbolSets.length === 24, 'the type-symbol run is 24 expansions', String(symbolSets.length))
ok(symbolSets.every((e) => e.implemented), 'every one is marked validated')
ok(symbolSets.every((e) => e.mask === 'outside-art'), 'every one foils the card body')
ok(symbolSets.some((e) => e.setId === 'bw2') && symbolSets.some((e) => e.setId === 'bw11'), 'BW2–11 are covered')
ok(symbolSets.some((e) => e.setId === 'xy0') && symbolSets.some((e) => e.setId === 'xy12'), 'XY0–12 are covered')
ok(symbolSets.some((e) => e.setId === 'g1'), 'Generations is covered')
ok(PATTERNS['reverse-type-symbol'].implemented === true, 'the pattern registry says the type-symbol paper is painted')

const printing = printingFor({ cardId: 'bw2-1', rarity: 'Common', variant: 'reverseHolofoil' })
ok(printing?.pattern === 'reverse-type-symbol' && printing.mask === 'outside-art', 'BW2 reverses resolve to the type-symbol paper')
ok(printing?.variant === 'reverse' && printing.status === 'inferred', 'as a reverse printing inferred from the set rule')
ok(holoFor({ cardId: 'bw2-1', rarity: 'Common', variant: 'reverseHolofoil' })?.reverse === true, 'the routing keeps the reverse flag')
const spec = foilMaskFor({ cardId: 'bw2-1', rarity: 'Common', variant: 'reverseHolofoil' })
ok(spec?.kind === 'outsideArt' && spec.verified, 'with the outside-art mask')
ok(spec ? maskValue(spec, 0.5, 0.3) === 0 : false, 'the artwork is matte')
ok(spec ? maskValue(spec, 0.5, 0.95) === 255 : false, 'the text panel is foil')
ok(reverseEligible({ setId: 'bw2', number: '1', rarity: 'Rare Holo' }), 'a regular BW2 rare is eligible')
ok(!reverseEligible({ setId: 'bw2', number: '1', rarity: 'Rare Holo EX' }), 'a Pokémon-EX is not')

// ---------------------------------------------------------------------------
// 5. The render obeys the layer contract.
// ---------------------------------------------------------------------------
const W = 200
const H = 279
const base = new Uint8ClampedArray(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    base[i] = 40 + Math.round((x / W) * 90)
    base[i + 1] = 52 + Math.round((y / H) * 80)
    base[i + 2] = 72
    base[i + 3] = 255
  }
}
const out = new Uint8ClampedArray(W * H * 4)
paintFoil(out, base, W, H, spec, FACE_ON, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
let restDiff = 0
for (let i = 0; i < base.length; i++) if (out[i] !== base[i]) restDiff++
ok(restDiff === 0, 'at rest the composite is the scan byte for byte', `${restDiff} bytes`)

paintFoil(out, base, W, H, spec, { deg: 55, axis: 45 }, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
let artChanged = 0
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, W / H) !== 0) continue
    const i = (y * W + x) * 4
    if (out[i] !== base[i] || out[i + 1] !== base[i + 1] || out[i + 2] !== base[i + 2]) artChanged++
  }
}
ok(artChanged === 0, 'the symbols never appear in the artwork', `${artChanged} px`)
ok(meanLift(base, out, W, H, spec) > 1, 'the paper lifts the body at 55°', meanLift(base, out, W, H, spec).toFixed(2))
ok(coverageFraction(spec) > 0.6, 'the foil covers the card minus the window')

// ---------------------------------------------------------------------------
// 6. The report matches, and no new code uses unseeded randomness.
// ---------------------------------------------------------------------------
const report = JSON.parse(fs.readFileSync('reports/type-symbol-printings.json', 'utf8')) as {
  counts: { expansions: number; validated: number; glyphs: number; textureVerified: boolean }
  problems: string[]
}
ok(report.counts.expansions === 24 && report.counts.validated === 24, 'the report counts 24 validated expansions')
ok(report.counts.glyphs === 12, 'the report counts twelve glyphs')
ok(report.counts.textureVerified === false, 'the report refuses to verify the artwork')
ok(report.problems.length === 0, 'the report has no unresolved problems')
ok(TYPE_SYMBOL_SHOWCASE.length === 3, 'three showcase cards, including a Trainer', String(TYPE_SYMBOL_SHOWCASE.length))
ok(TYPE_SYMBOL_SHOWCASE.some((c) => c.supertype === 'Trainer'), 'the Trainer showcase uses the Poké Ball')
for (const f of ['src/foil/type-glyph.ts', 'src/foil/type-symbol.ts', 'scripts/type-symbol-foil.ts']) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

// The loader is browser-only; this proves the module exists and exports the path
// the overlay uses, without pretending to have run a fetch in Node.
ok(typeof loadTypeSymbolField === 'function', 'the overlay loader is exported')

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
