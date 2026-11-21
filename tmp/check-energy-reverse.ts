// Ascended Heroes' Energy-pattern reverse.
//
// Checked: eleven large glyph sheets ship, one type glyph sits behind the attack
// text rather than a repeated field, the sampler uses the measured 0.675-down
// placement, only a regular Pokémon with a known type gets a stamp, the explicit
// variant routes to its own paper and the outside-art mask, and the render
// contract still holds.

import fs from 'node:fs'
import { holoFor } from '../src/holo'
import { foilMaskFor, maskValue } from '../src/foil/mask'
import { printingFor } from '../src/foil/printing-db'
import {
  ENERGY_REVERSE_ASSETS,
  ENERGY_REVERSE_GEOMETRY,
  ENERGY_REVERSE_SHOWCASE,
  ENERGY_REVERSE_TEXTURE_VERIFIED,
} from '../src/foil/reverse-energy-large-index'
import {
  buildEnergyReverseGrid,
  energyReverseCopyFor,
  energyReverseFieldFor,
  energyReverseGlyphFor,
  loadEnergyReverseField,
  sampleEnergyReverse,
} from '../src/foil/reverse-energy-large'
import {
  ENERGY_REVERSE_GLYPHS,
  ENERGY_REVERSE_STAMP_HEIGHT,
  ENERGY_REVERSE_STAMP_WIDTH,
  renderEnergyReverseSheet,
} from '../src/foil/reverse-energy-large-sheet'
import {
  ENERGY_REVERSE_PRINTINGS,
  ENERGY_REVERSE_SET_IDS,
  ENERGY_REVERSE_VARIANT,
  energyReverseFor,
  isEnergyReverseVariant,
} from '../src/foil/reverse-energy-large-db'
import {
  ENERGY_REVERSE_SET_IDS as GAME_ENERGY_SETS,
  energyReverseEligible,
  hasEnergyReverse,
  isEnergyReverseVariant as gameEnergyVariant,
} from '../server/services/special-reverse'
import { resolvePrice } from '../server/services/market'
import { DEFAULT_FOIL_SETTINGS, meanLift, paintFoil } from '../src/foil/stages'
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

console.log("Ascended Heroes Energy-pattern reverse — sheets, placement, routing")

const sheet = renderEnergyReverseSheet('water', 512)
ok(sheet.coverage > 0.01 && sheet.coverage < 0.24, 'one large symbol fills its stamp box, not the sheet', sheet.coverage.toFixed(3))
ok(sheet.peak > 0.8, 'the symbol is bright', sheet.peak.toFixed(2))
ok(Math.abs(sheet.centerU - 0.5) < 0.02 && Math.abs(sheet.centerV - 0.5) < 0.02, 'the symbol is drawn at the sheet centre', `${sheet.centerU.toFixed(2)},${sheet.centerV.toFixed(2)}`)
ok(Math.abs(ENERGY_REVERSE_STAMP_WIDTH - 0.45) < 0.001 && Math.abs(ENERGY_REVERSE_STAMP_HEIGHT - 0.43) < 0.001, 'every glyph fills the measured 0.45 x 0.43 stamp box')

ok(ENERGY_REVERSE_GLYPHS.length === 11, 'eleven Energy types have a stamp (Trainer is excluded)')
ok(Object.keys(ENERGY_REVERSE_ASSETS).length === 11, 'the index lists eleven sheets')
for (const id of ENERGY_REVERSE_GLYPHS) {
  const a = ENERGY_REVERSE_ASSETS[id]
  ok(!!a && fs.existsSync('public' + a.texture), `${id}: sheet ships`)
  ok(!!a && a.coverage > 0.01 && a.coverage < 0.24, `${id}: one mark, not a field`)
  ok(!!a && a.peak > 0.8, `${id}: bright mark`)
}
ok(ENERGY_REVERSE_TEXTURE_VERIFIED === false, 'the artwork is not claimed as verified')
ok(ENERGY_REVERSE_GEOMETRY.targetU === 0.5 && ENERGY_REVERSE_GEOMETRY.targetV === 0.675, 'the measured placement is recorded')

const grid = buildEnergyReverseGrid(512, 512, sheet.rgba)
const copy = energyReverseCopyFor('me2pt5-1', ENERGY_REVERSE_ASSETS.water)
let best = 0
let weight = 0
let sumU = 0
let sumV = 0
for (let v = 0.2; v < 0.98; v += 0.01) {
  for (let u = 0.05; u < 0.95; u += 0.01) {
    const m = sampleEnergyReverse(copy, grid, u, v).mark
    if (m > best) best = m
    if (m > 0.2) {
      weight += m
      sumU += u * m
      sumV += v * m
    }
  }
}
const centroidU = weight > 0 ? sumU / weight : 0
const centroidV = weight > 0 ? sumV / weight : 0
ok(best > 0.7, 'the symbol is visible on the card', best.toFixed(2))
ok(Math.abs(centroidU - 0.5) < 0.12, 'it sits across the card centre, not at the left', centroidU.toFixed(2))
ok(Math.abs(centroidV - 0.675) < 0.12, 'it sits behind the attack text', centroidV.toFixed(2))
ok(sampleEnergyReverse(copy, grid, 0.5, 0.675).mark > 0.8, 'the measured target point is inside the symbol')
ok(sampleEnergyReverse(copy, grid, 0.08, 0.4).mark < 0.1, 'the left of the body is blank')
ok(sampleEnergyReverse(copy, grid, 0.5, 0.3).mark === sampleEnergyReverse(copy, grid, 0.5, 0.3).mark, 'sampling is stable')

const field = energyReverseFieldFor('me2pt5-1', 'water', grid)
ok(field.verified === false, 'the field carries no verified-texture claim')
ok(String(field.meta.placement).includes('behind the attack text'), 'the field records the placement')
ok(field.meta.glyph === 'water', 'the field records the glyph')

const printing = printingFor({ cardId: 'me2pt5-1', rarity: 'Common', variant: ENERGY_REVERSE_VARIANT })
ok(printing?.pattern === 'reverse-energy-large', 'the printing database names the Energy paper')
ok(printing?.mask === 'outside-art' && printing.maskVerified, 'with the verified body area')
ok(printing?.matchedRule === 'explicit' && printing.status === 'verified', 'as an explicit verified printing')

const routed = holoFor({ cardId: 'me2pt5-1', rarity: 'Common', variant: ENERGY_REVERSE_VARIANT })
ok(!!routed && routed.reverse && routed.pattern === 'reverse-energy-large', 'the overlay routes the explicit variant to its paper')
const ordinary = holoFor({ cardId: 'me2pt5-1', rarity: 'Common', variant: 'reverseHolofoil' })
ok(!!ordinary && ordinary.pattern === 'reverse-flat', 'an ordinary reverse keeps the set paper')
const ex = holoFor({ cardId: 'me2pt5-1', rarity: 'Double Rare', variant: ENERGY_REVERSE_VARIANT })
ok(ex === null, 'a Pokémon ex cannot take the Energy reverse')

const spec = foilMaskFor({ cardId: 'me2pt5-1', rarity: 'Common', variant: ENERGY_REVERSE_VARIANT })
ok(spec?.kind === 'outsideArt' && spec.verified, 'the Energy paper uses the verified outside-art mask')
ok(spec ? maskValue(spec, 0.5, 0.3) === 0 : false, 'the artwork is matte')
ok(spec ? maskValue(spec, 0.5, 0.48) === 255 : false, 'foil starts below the modern art window')
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

// Type routing is the card's, not the set's. Trainer/Energy/unknown stay plain.
ok(energyReverseGlyphFor({ types: '["Water"]', supertype: 'Pokémon' }) === 'water', 'a Water Pokémon gets the Water stamp')
ok(energyReverseGlyphFor({ types: ['Fire'], supertype: 'Pokémon' }) === 'fire', 'a Fire Pokémon gets the Fire stamp')
const trainerField = await loadEnergyReverseField('me2pt5-1', { types: null, supertype: 'Trainer' })
ok(trainerField === null, 'a Trainer gets plain foil')
const energyField = await loadEnergyReverseField('me2pt5-1', { types: null, supertype: 'Energy' })
ok(energyField === null, 'an Energy card gets plain foil')
const unknownField = await loadEnergyReverseField('me2pt5-1', { types: '["Mystery"]', supertype: 'Pokémon' })
ok(unknownField === null, 'an unknown type gets plain foil rather than a wrong symbol')

ok(energyReverseFor('me2pt5', ENERGY_REVERSE_VARIANT)?.pattern === 'reverse-energy-large', 'the renderer registry resolves me2pt5')
ok(energyReverseFor('sv8pt5', ENERGY_REVERSE_VARIANT) === null, 'another set makes no Energy-paper claim')
ok(isEnergyReverseVariant(ENERGY_REVERSE_VARIANT) && !isEnergyReverseVariant('reverseHolofoil'), 'the token is explicit')
ok(ENERGY_REVERSE_SET_IDS.join(',') === GAME_ENERGY_SETS.join(','), 'the game-side set list matches the renderer')
ok(gameEnergyVariant(ENERGY_REVERSE_VARIANT), 'the game recognises the same token')
ok(hasEnergyReverse('me2pt5') && !hasEnergyReverse('sv8pt5'), 'the game marks only Ascended Heroes')
ok(energyReverseEligible({ supertype: 'Pokémon', subtypes: '["Stage 1"]' }), 'a regular Pokémon is eligible')
ok(!energyReverseEligible({ supertype: 'Pokémon', subtypes: '["ex"]' }), 'a Pokémon ex is not eligible')
ok(!energyReverseEligible({ supertype: 'Trainer', subtypes: '["Item"]' }), 'a Trainer is not eligible')
ok(!energyReverseEligible({ supertype: 'Energy', subtypes: '[]' }), 'an Energy card is not eligible')

const reversePrice = resolvePrice('sv8pt5-1', 'reverseHolofoil')
const energyPrice = resolvePrice('sv8pt5-1', ENERGY_REVERSE_VARIANT)
ok(energyPrice.usd === reversePrice.usd, 'the Energy reverse prices at the ordinary reverse anchor')
ok(energyPrice.variant === ENERGY_REVERSE_VARIANT, 'the price keeps the requested Energy token')

ok(ENERGY_REVERSE_PRINTINGS.length === 1 && ENERGY_REVERSE_PRINTINGS[0].setId === 'me2pt5', 'the registry holds the one documented printing')
ok(ENERGY_REVERSE_SHOWCASE.length >= 2, 'the inspector has showcase cards')

for (const f of [
  'src/foil/reverse-energy-large-sheet.ts',
  'src/foil/reverse-energy-large.ts',
  'scripts/reverse-energy-large-foil.ts',
]) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
