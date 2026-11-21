// Phase 5J: the Scarlet & Violet intricate nested-tile reverse paper.
//
// Run: ./node_modules/.bin/tsx tmp/check-reverse-tile-intricate.ts

import fs from 'node:fs'
import {
  buildReverseTileIntricateGrid, sampleReverseTileIntricate,
  reverseTileIntricateFieldFor, intricateOffsetFor,
} from '../src/foil/reverse-tile-intricate'
import { renderReverseTileIntricateSheet, REVERSE_TILE_INTRICATE_SIZE } from '../src/foil/reverse-tile-intricate-sheet'
import { REVERSE_TILE_INTRICATE_ASSETS, REVERSE_TILE_INTRICATE_SCALE, REVERSE_TILE_INTRICATE_TEXTURE_VERIFIED } from '../src/foil/reverse-tile-intricate-index'
import { GLYPH_IDS } from '../src/foil/type-glyph'
import { glyphForCard } from '../src/foil/type-symbol'
import { REVERSE_EXPANSIONS, reverseEligible } from '../src/foil/reverse-db'
import { printingFor } from '../src/foil/printing-db'
import { foilMaskFor, maskValue } from '../src/foil/mask'
import { DEFAULT_FOIL_SETTINGS, meanLift, paintFoil } from '../src/foil/stages'
import { FACE_ON } from '../src/foil/reflection'
import Database from 'better-sqlite3'

let total = 0
let fails = 0
function ok(cond: boolean, label: string, detail?: string): void {
  total++
  if (!cond) { fails++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

console.log('Scarlet & Violet intricate tile paper — nesting, glyphs, 16 expansions')

const grass = renderReverseTileIntricateSheet('grass', REVERSE_TILE_INTRICATE_SIZE)
ok(grass.coverage > 0.3 && grass.coverage < 0.95, 'nested tiles cover much of the sheet', grass.coverage.toFixed(3))
ok(grass.peak > 0.9, 'the glyphs are bright', grass.peak.toFixed(2))
ok(grass.seam < 0.05, 'the nested lattice tiles', grass.seam.toFixed(4))
const fire = renderReverseTileIntricateSheet('fire', REVERSE_TILE_INTRICATE_SIZE)
let diff = 0
for (let i = 3; i < grass.rgba.length; i += 4) if (grass.rgba[i] !== fire.rgba[i]) diff++
ok(diff > 1000, 'different types draw different glyphs', String(diff))

ok(GLYPH_IDS.length === 12 && Object.keys(REVERSE_TILE_INTRICATE_ASSETS).length === 12, 'twelve sheets are indexed')
for (const id of GLYPH_IDS) {
  const a = REVERSE_TILE_INTRICATE_ASSETS[id]
  ok(!!a && fs.existsSync('public' + a.texture), `${id}: sheet ships`)
  ok(!!a && a.seam < 0.05, `${id}: sheet tiles`)
  ok(!!a && a.peak > 0.9, `${id}: bright marks`)
}
ok(REVERSE_TILE_INTRICATE_TEXTURE_VERIFIED === false, 'the artwork is not claimed as verified')

const grid = buildReverseTileIntricateGrid(REVERSE_TILE_INTRICATE_SIZE, REVERSE_TILE_INTRICATE_SIZE, grass.rgba)
const off = intricateOffsetFor('sv1-1')
ok(off.offsetU >= 0 && off.offsetU < 1 && off.offsetV >= 0 && off.offsetV < 1, 'per-card registration is in range')
ok(sampleReverseTileIntricate('sv1-1', grid, 0.3, 0.3) >= 0, 'sampling works')
ok(sampleReverseTileIntricate('sv1-1', grid, 0.3, 0.3) === sampleReverseTileIntricate('sv1-1', grid, 0.3 + 1 / REVERSE_TILE_INTRICATE_SCALE, 0.3), 'the sheet wraps at its own period')
ok(sampleReverseTileIntricate('sv1-1', grid, 0.3, 0.3) !== sampleReverseTileIntricate('sv1-2', grid, 0.3, 0.3), 'two cards register differently')

const field = reverseTileIntricateFieldFor('sv1-1', 'grass', grid)
ok(field.verified === false, 'the field makes no verified-texture claim')
ok(String(field.meta.glyph) === 'grass', 'the field records its glyph')

ok(glyphForCard({ types: 'Grass' }) === 'grass', 'Grass routes to the leaf')
ok(glyphForCard({ types: ['Water'] }) === 'water', 'a type array routes to its first type')
ok(glyphForCard({ supertype: 'Trainer' }) === 'trainer', 'a Trainer routes to the Poké Ball')
ok(glyphForCard({ types: 'Cosmic' }) === null, 'an unknown type gets no glyph')

const sets = REVERSE_EXPANSIONS.filter((e) => e.pattern === 'reverse-tile-intricate')
ok(sets.length === 16, 'the paper covers 16 expansions', String(sets.length))
ok(sets.every((e) => e.implemented), 'all 16 are validated')
ok(sets.every((e) => e.mask === 'outside-art'), 'all use the body mask')
ok(sets.some((e) => e.setId === 'sv1') && sets.some((e) => e.setId === 'zsv10pt5'), 'Scarlet & Violet through Black Bolt are covered')

const printing = printingFor({ cardId: 'sv1-1', rarity: 'Common', variant: 'reverseHolofoil' })
ok(printing?.pattern === 'reverse-tile-intricate' && printing.mask === 'outside-art', 'SV reverses resolve to the intricate paper')
const spec = foilMaskFor({ cardId: 'sv1-1', rarity: 'Common', variant: 'reverseHolofoil' })
ok(spec?.kind === 'outsideArt' && spec.verified, 'with the verified body mask')
ok(spec ? maskValue(spec, 0.5, 0.3) === 0 : false, 'the artwork is matte')
ok(spec ? maskValue(spec, 0.5, 0.95) === 255 : false, 'the text panel is foil')

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db.prepare(`select set_id, number, rarity, types from cards where set_id in (${sets.map(() => '?').join(',')})`).all(...sets.map((s) => s.setId)) as
  { set_id: string; number: string; rarity: string | null; types: string | null }[]
db.close()
const eligible = rows.filter((r) => reverseEligible({ setId: r.set_id, number: r.number, rarity: r.rarity }))
ok(eligible.length > 1000, 'the paper holds well over a thousand reverse printings', String(eligible.length))
ok(eligible.filter((r) => glyphForCard({ types: r.types, supertype: null }) !== null).length / eligible.length > 0.7,
  'most printings have a usable type')

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
ok(meanLift(base, out, W, H, spec) > 1, 'the nested tiles lift the body at 55°', meanLift(base, out, W, H, spec).toFixed(2))

const report = JSON.parse(fs.readFileSync('reports/reverse-tile-intricate-printings.json', 'utf8')) as {
  counts: { expansions: number; validated: number; glyphs: number; textureVerified: boolean }
  problems: string[]
}
ok(report.counts.expansions === 16 && report.counts.validated === 16, 'the report counts 16 validated expansions')
ok(report.counts.glyphs === 12, 'the report counts twelve sheets')
ok(report.counts.textureVerified === false, 'the report refuses to verify the artwork')
ok(report.problems.length === 0, 'the report has no problems')

for (const f of ['src/foil/reverse-tile-intricate.ts', 'src/foil/reverse-tile-intricate-sheet.ts', 'scripts/reverse-tile-intricate-foil.ts']) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
