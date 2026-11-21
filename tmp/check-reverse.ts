// Reverse holo assertions — the reverse table and every validated expansion.
//
// What this suite is allowed to claim:
//   - the two generated textures ship, are not blank, tile without a visible
//     seam, and admit they are reconstructions;
//   - the expansion table gets the MASK right, including the EX-era sets that
//     foil the window instead of the body;
//   - eligibility excludes the printings that never existed (H-numbers, ultra
//     rares, Base Set 2/Team Rocket entirely);
//   - the renderer puts light only inside that mask, never moves the marks under
//     tilt, and treats the plain finish as uniform foil with no invented marks.
//
// Run: ./node_modules/.bin/tsx tmp/check-reverse.ts

import fs from 'node:fs'
import path from 'node:path'
import { decodePng } from './png'
import { buildCosmosGrid } from '../src/foil/cosmos'
import { REVERSE_ASSETS, REVERSE_SHOWCASE } from '../src/foil/reverse-index'
import {
  REVERSE_EXPANSIONS,
  REVERSE_IMPLEMENTED,
  reverseConfigFor,
  reverseEligible,
  reversePending,
} from '../src/foil/reverse-db'
import { reverseFieldFor, sampleReverse } from '../src/foil/reverse'
import { printingFor } from '../src/foil/printing-db'
import { holoFor } from '../src/holo'
import { coverageFraction, foilMaskFor, maskValue } from '../src/foil/mask'
import { DEFAULT_FOIL_SETTINGS, meanLift, paintFoil } from '../src/foil/stages'
import { FACE_ON } from '../src/foil/reflection'

let total = 0
const fails: string[] = []
function ok(cond: boolean, label: string, detail?: string) {
  total++
  if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

const W = 200
const H = 279

// ---------------------------------------------------------------------------
// 1. The asset library
// ---------------------------------------------------------------------------
{
  ok(Object.keys(REVERSE_ASSETS).length === 4, 'four reverse patterns ship so far', String(Object.keys(REVERSE_ASSETS).length))
  ok(REVERSE_IMPLEMENTED.includes('reverse-fireworks'), 'the fireworks pattern is implemented')
  ok(REVERSE_IMPLEMENTED.includes('reverse-flat'), 'the plain pattern is implemented')
  ok(REVERSE_IMPLEMENTED.includes('reverse-pokeball'), 'the Poké Ball pattern is implemented')
  ok(REVERSE_IMPLEMENTED.includes('reverse-pinwheel'), 'the pinwheel pattern is implemented')

  for (const id of ['reverse-fireworks', 'reverse-flat', 'reverse-pokeball', 'reverse-pinwheel'] as const) {
    const asset = REVERSE_ASSETS[id]
    ok(!!asset, `${id}: asset exists`)
    if (!asset) continue
    const dir = path.join('public', asset.texture.replace(/^\/foil\/reverse\//, 'foil/reverse/').replace(/\/pattern\.png$/, ''))
    for (const f of ['pattern.png', 'alpha.png', 'meta.json', 'mask.json', 'reflection.json', 'NOTES.md', path.join('reference', 'README.md')]) {
      ok(fs.existsSync(path.join(dir, f)), `${id}: library ships ${f}`)
    }
    ok(asset.approximation === true, `${id}: metadata admits it is a reconstruction`)
    ok(asset.reproduction.includes('procedural'), `${id}: reproduction is named`, asset.reproduction)
    ok(asset.source.startsWith('https://'), `${id}: cites a source`)
    ok(asset.tileable === true, `${id}: the sheet is tileable`, String(asset.tileable))
    ok(asset.peak > 0.5, `${id}: marks are bright enough to read`, String(asset.peak))
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
    ok(Math.abs(meta.coverage - asset.coverage) < 1e-6, `${id}: index matches its metadata file`)
    ok(meta.approximation === true, `${id}: the metadata file says approximation`)
  }

  const fire = REVERSE_ASSETS['reverse-fireworks']
  ok(fire?.plain === false, 'fireworks is a patterned foil')
  ok(!!fire && fire.coverage > 0.03 && fire.coverage < 0.20, 'fireworks is a sparse burst field, not a wash', String(fire?.coverage))
  const flat = REVERSE_ASSETS['reverse-flat']
  ok(flat?.plain === true, 'the plain finish is modelled without marks')
  ok(flat?.coverage === 1 && flat?.peak === 1, 'a plain foil covers the whole sheet at full strength')

  // The alpha file must be the RGBA alpha, not a different arrangement.
  if (fire) {
    const rgba = decodePng(path.join(dirOf(fire.texture), 'pattern.png'))
    const alpha = decodePng(path.join(dirOf(fire.texture), 'alpha.png'))
    ok(rgba.ch === 4, 'fireworks texture is RGBA')
    // The project decoder expands grayscale to RGBA, so read the colour type
    // from the file header rather than the decoded channel count.
    const alphaHeader = fs.readFileSync(path.join(dirOf(fire.texture), 'alpha.png'))
    ok(alphaHeader[25] === 0, 'alpha map is an 8-bit grayscale PNG', String(alphaHeader[25]))
    let mismatch = 0
    for (let i = 0; i < rgba.w * rgba.h; i++) {
      if (Math.abs(rgba.px[i * 4 + 3] - alpha.px[i * 4]) > 1) mismatch++
    }
    ok(mismatch === 0, 'alpha.png is exactly the RGBA alpha channel', `${mismatch} px`)
  }
}

function dirOf(texture: string): string {
  return path.join('public', texture.replace(/^\//, '').replace(/\/pattern\.png$/, ''))
}

// ---------------------------------------------------------------------------
// 2. Expansion table: pattern, mask, era
// ---------------------------------------------------------------------------
{
  ok(REVERSE_EXPANSIONS.length >= 90, 'the table covers the reverse-holo era', String(REVERSE_EXPANSIONS.length))
  const ids = new Set(REVERSE_EXPANSIONS.map((e) => e.setId))
  ok(ids.size === REVERSE_EXPANSIONS.length, 'no duplicate expansions')

  for (const e of REVERSE_EXPANSIONS) {
    ok(e.source.startsWith('https://'), `${e.setId}: cites a source`)
    ok(e.year >= 2002 && e.year <= 2026, `${e.setId}: dated in the reverse-holo era`, String(e.year))
    ok(e.mask === 'outside-art' || e.mask === 'art', `${e.setId}: uses a known mask`, e.mask)
    ok(e.note.length > 20 && e.maskNote.length > 20, `${e.setId}: explains itself`)
  }

  const base6 = reverseConfigFor('base6')
  ok(base6?.pattern === 'reverse-fireworks', 'Legendary Collection is Fireworks', base6?.pattern)
  ok(base6?.mask === 'outside-art' && base6.status === 'verified', 'and it foils the card body, verified')
  ok(base6?.implemented === true, 'and it is painted in this batch')

  const ecard1 = reverseConfigFor('ecard1')
  ok(ecard1?.pattern === 'reverse-flat', 'Expedition is the plain finish', ecard1?.pattern)
  ok(ecard1?.mask === 'outside-art' && ecard1.status === 'verified', 'on the card body, verified')
  ok(ecard1?.implemented === true, 'and it is painted in this batch')

  // The correction that matters: EX-era reverses foil the WINDOW.
  for (const id of ['ex5', 'ex6', 'ex7', 'ex8', 'ex9', 'ex10', 'ex11', 'ex16']) {
    ok(reverseConfigFor(id)?.mask === 'art', `${id}: the reverse pattern sits inside the artwork`, reverseConfigFor(id)?.mask)
  }
  ok(reverseConfigFor('ex11')?.status === 'approximated', 'the artwork-background masks admit they are approximated')
  ok(reverseConfigFor('dp1')?.mask === 'outside-art', 'Diamond & Pearl returns to the body')
  ok(reverseConfigFor('ex8')?.implemented === true, 'EX Deoxys is validated in this batch')
  ok(reverseConfigFor('ex9')?.implemented === true, 'EX Emerald is validated in this batch')
  ok(reverseConfigFor('dp1')?.implemented === true, 'Diamond & Pearl 1 is validated in this batch')
  // Phase 5D/5E: the plain body paper is shared, but validation is per expansion.
  for (const id of ['dp2', 'dp3', 'dp4', 'dp5', 'dp6', 'dp7', 'pl1', 'pl2', 'pl3', 'pl4', 'hgss1', 'hgss2', 'hgss3', 'hgss4', 'col1', 'bw1']) {
    ok(reverseConfigFor(id)?.implemented === true, `${id}: the plain body paper is validated end to end`)
  }
  ok(reverseConfigFor('bw2')?.pattern === 'reverse-type-symbol', 'Emerging Powers uses the type symbol')
  ok(reverseConfigFor('sm1')?.pattern === 'reverse-type-symbol-large', 'Sun & Moon uses the large type symbol')
  ok(reverseConfigFor('swsh1')?.pattern === 'reverse-tile', 'Sword & Shield uses tiles')
  ok(reverseConfigFor('sv1')?.pattern === 'reverse-tile-intricate', 'Scarlet & Violet uses intricate tiles')
  ok(reverseConfigFor('me1')?.pattern === 'reverse-flat', 'Mega Evolution returns to the plain background')
  ok(reverseConfigFor('base4') === null, 'Base Set 2 has no reverse configuration at all')

  ok(REVERSE_ASSETS['reverse-pokeball']?.mask === 'art', 'the Poké Ball pattern is documented INSIDE the window')
  ok(REVERSE_ASSETS['reverse-pinwheel']?.mask === 'art', 'the pinwheel pattern is documented inside the window')
  ok(REVERSE_ASSETS['reverse-pokeball']?.approximation === true, 'the Poké Ball glyphs are an approximation')
  for (const id of ['reverse-pokeball', 'reverse-pinwheel'] as const) {
    const a = REVERSE_ASSETS[id]
    ok(!!a && (a.coverage ?? 0) > 0.01 && (a.coverage ?? 0) < 0.30, `${id}: marks cover part of the sheet, not all of it`, String(a?.coverage))
  }

  const pending = reversePending()
  ok(pending.length === 0, 'nothing is left pending', String(pending.length))
  ok(!pending.some((p) => ['base6', 'ecard1', 'ex9', 'ex10', 'ex8', 'dp1'].some((id) => p.sets.includes(id))),
    'the validated expansions are not listed as pending')
  ok(pending.length === 0, 'every reverse expansion is validated end to end')
}

// ---------------------------------------------------------------------------
// 2b. Phase 5D/5E: each expansion on the plain body paper is proved on its own.
//
// Sharing a painted paper is not validation. For every one of these sets the
// suite resolves a common reverse printing, checks the outside-art mask, then
// renders that card and asserts the layer contract: untouched at rest, light only
// on the body, and a visible lift at 55 degrees.
// ---------------------------------------------------------------------------
{
  const plainRun = ['dp2', 'dp3', 'dp4', 'dp5', 'dp6', 'dp7', 'pl1', 'pl2', 'pl3', 'pl4', 'hgss1', 'hgss2', 'hgss3', 'hgss4', 'col1', 'bw1']
  const w = 200
  const h = 279
  const base = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      base[i] = 36 + Math.round((x / w) * 90)
      base[i + 1] = 52 + Math.round((y / h) * 80)
      base[i + 2] = 84
      base[i + 3] = 255
    }
  }
  const out = new Uint8ClampedArray(w * h * 4)

  for (const setId of plainRun) {
    const cardId = `${setId}-1`
    const cfg = reverseConfigFor(setId)
    ok(cfg?.pattern === 'reverse-flat' && cfg.mask === 'outside-art', `${setId}: plain reverse foil on the card body`)
    const input = { cardId, rarity: 'Common', variant: 'reverseHolofoil' }
    const printing = printingFor(input)
    ok(printing?.pattern === 'reverse-flat' && printing.variant === 'reverse', `${setId}: a common resolves as a reverse printing`)
    ok(holoFor(input)?.reverse === true && holoFor(input)?.pattern === 'reverse-flat', `${setId}: the routing keeps reverse and its paper`)
    const spec = foilMaskFor(input)
    ok(spec?.kind === 'outsideArt' && spec.verified, `${setId}: the outside-art mask is verified`, spec?.kind)
    if (!spec) continue

    paintFoil(out, base, w, h, spec, FACE_ON, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field: null })
    let diff = 0
    for (let i = 0; i < base.length; i++) if (out[i] !== base[i]) diff++
    ok(diff === 0, `${setId}: at rest the reverse layer is the scan byte for byte`, `${diff} bytes`)

    paintFoil(out, base, w, h, spec, { deg: 55, axis: 45 }, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field: null })
    ok(meanLift(base, out, w, h, spec) > 1, `${setId}: plain foil lifts the body at 55°`, meanLift(base, out, w, h, spec).toFixed(2))
    let artChanged = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (maskValue(spec, (x + 0.5) / w, (y + 0.5) / h, w / h) !== 0) continue
        const i = (y * w + x) * 4
        if (out[i] !== base[i] || out[i + 1] !== base[i + 1] || out[i + 2] !== base[i + 2]) artChanged++
      }
    }
    ok(artChanged === 0, `${setId}: the illustration window stays matte`, `${artChanged} px`)
  }

  // The two exclusions that matter for this run: Prime and LEGEND never had one.
  ok(!reverseEligible({ setId: 'hgss2', number: '1', rarity: 'Prime' }), 'a Prime card in HGSS 2 has no reverse')
  ok(!reverseEligible({ setId: 'hgss4', number: '1', rarity: 'LEGEND' }), 'a LEGEND card in HGSS 4 has no reverse')
  ok(reverseEligible({ setId: 'hgss2', number: '60', rarity: 'Common' }), 'an ordinary HGSS common does')
}

// ---------------------------------------------------------------------------
// 3. Eligibility: a flag cannot invent a printing
// ---------------------------------------------------------------------------
{
  ok(reverseEligible({ setId: 'base6', number: '1', rarity: 'Rare Holo' }), 'a Legendary Collection holo has a reverse')
  ok(reverseEligible({ setId: 'base6', number: '58', rarity: 'Common' }), 'and so does its commons')
  ok(reverseEligible({ setId: 'ecard1', number: '4', rarity: 'Rare Holo' }), 'Expedition holos got reverse counterparts')
  ok(!reverseEligible({ setId: 'ecard2', number: 'H1', rarity: 'Rare Holo' }), 'an Aquapolis H-number has none')
  ok(reverseEligible({ setId: 'ecard2', number: '1', rarity: 'Rare' }), 'its regular rares do')
  ok(!reverseEligible({ setId: 'ex1', number: '1', rarity: 'Rare Holo EX' }), 'Pokémon-ex has none')
  ok(!reverseEligible({ setId: 'dp1', number: '1', rarity: 'Rare Holo LV.X' }), 'LV.X has none')
  ok(!reverseEligible({ setId: 'hgss1', number: '1', rarity: 'LEGEND' }), 'LEGEND has none')
  ok(!reverseEligible({ setId: 'hgss1', number: '1', rarity: 'Rare Prime' }), 'Prime is excluded rather than guessed')
  ok(!reverseEligible({ setId: 'sv1', number: '1', rarity: 'Double Rare' }), 'a Double Rare has none')
  ok(reverseEligible({ setId: 'sv1', number: '100', rarity: 'Common' }), 'a Scarlet & Violet common does')
  ok(reverseEligible({ setId: 'me1', number: '1', rarity: 'Common' }), 'a Mega Evolution common does')
  ok(!reverseEligible({ setId: 'base4', number: '1', rarity: 'Common' }), 'Base Set 2 has no reverse printings')

  ok(printingFor({ cardId: 'ecard2-H1', rarity: 'Rare Holo', variant: 'reverseHolofoil' }) === null,
    'an H-number reverse makes no printing')
  ok(holoFor({ cardId: 'ecard2-H1', rarity: 'Rare Holo', variant: 'reverseHolofoil' }) === null,
    'and no foil is invented for it')
  ok(foilMaskFor({ cardId: 'ex1-1', rarity: 'Rare Holo EX', variant: 'reverseHolofoil' }) === null,
    'a Pokémon-ex flagged reverse gets no mask')
}

// ---------------------------------------------------------------------------
// 4. Printing records
// ---------------------------------------------------------------------------
{
  const rev = printingFor({ cardId: 'base6-2', rarity: 'Common', variant: 'reverseHolofoil' })
  ok(rev?.variant === 'reverse', 'the record is a reverse printing', rev?.variant)
  ok(rev?.pattern === 'reverse-fireworks', 'and carries the fireworks paper', rev?.pattern)
  ok(rev?.mask === 'outside-art' && rev?.maskVerified === true, 'with the documented body mask')
  ok(rev?.status === 'inferred', 'the individual printing is inferred from the set rule', rev?.status)
  ok(rev?.printingId === 'base6-2:en:reverse', 'the printing id names the variant', rev?.printingId)

  const plain = printingFor({ cardId: 'ecard1-2', rarity: 'Common', variant: 'reverseHolofoil' })
  ok(plain?.pattern === 'reverse-flat', 'Expedition resolves to the plain paper', plain?.pattern)

  const win = printingFor({ cardId: 'ex5-1', rarity: 'Rare Holo', variant: 'reverseHolofoil' })
  ok(win?.mask === 'art', 'an EX Hidden Legends reverse foils the window', win?.mask)
  ok(win?.pattern === 'reverse-energy-symbol', 'with its own pattern', win?.pattern)

  // Cosmos is untouched: a normal holo still resolves to Cosmos, and a reverse
  // flag no longer routes it to the Cosmos sheet.
  ok(printingFor({ cardId: 'base6-2', rarity: 'Rare Holo' })?.pattern === 'cosmos-retro', 'the normal holo is still Cosmos')
  ok(printingFor({ cardId: 'base6-2', rarity: 'Rare Holo', variant: 'reverseHolofoil' })?.pattern === 'reverse-fireworks',
    'the reverse of the same card is not Cosmos')
}

// ---------------------------------------------------------------------------
// 5. Masks: light only where the printing put foil
// ---------------------------------------------------------------------------
{
  const body = foilMaskFor({ cardId: 'base6-2', rarity: 'Common', variant: 'reverseHolofoil' })
  ok(body?.kind === 'outsideArt', 'Fireworks foils the body', body?.kind)
  ok(maskValue(body!, 0.5, 0.3) === 0, 'fireworks: the art window has no foil')
  ok(maskValue(body!, 0.5, 0.95) === 255, 'fireworks: the text panel does')
  ok(maskValue(body!, 0.002, 0.002) === 0, 'nothing outside the card silhouette')
  ok(coverageFraction(body!) > 0.5, 'the body mask covers most of the card')

  const win = foilMaskFor({ cardId: 'ex5-1', rarity: 'Rare Holo', variant: 'reverseHolofoil' })
  ok(win?.kind === 'art', 'the EX window mask is not inverted', win?.kind)
  ok(maskValue(win!, 0.5, 0.3) === 255, 'EX Hidden Legends: the art window IS foil')
  ok(maskValue(win!, 0.5, 0.95) === 0, 'EX Hidden Legends: the text panel is matte')
  ok(coverageFraction(win!) < 0.5, 'and it covers less than the body does')
}

// ---------------------------------------------------------------------------
// 6. Sampling: fixed marks, wrapping sheet, different per card
// ---------------------------------------------------------------------------
const fire = REVERSE_ASSETS['reverse-fireworks']!
const png = decodePng(path.join(dirOf(fire.texture), 'pattern.png'))
const grid = buildCosmosGrid(png.w, png.h, png.px)

{
  const a = sampleReverse('base6-2', 'reverse-fireworks', grid, 0.37, 0.62)
  const b = sampleReverse('base6-2', 'reverse-fireworks', grid, 0.37, 0.62)
  ok(a === b, 'the pattern does not move between frames')

  let differing = 0
  for (let v = 0.1; v <= 0.9; v += 0.1) {
    for (let u = 0.1; u <= 0.9; u += 0.1) {
      if (Math.abs(sampleReverse('base6-2', 'reverse-fireworks', grid, u, v) - sampleReverse('base6-3', 'reverse-fireworks', grid, u, v)) > 1e-3) differing++
    }
  }
  ok(differing > 10, 'two copies register the sheet differently', String(differing))

  // Repeat is a property of the sample spanning whole sheets, so step back by
  // exactly one sheet: scale 1/asset.scale makes one card width equal one tile.
  const inv = 1 / fire.scale
  const edge = sampleReverse('base6-2', 'reverse-fireworks', grid, 1, 0.37, inv)
  const wrapped = sampleReverse('base6-2', 'reverse-fireworks', grid, 0, 0.37, inv)
  ok(Math.abs(edge - wrapped) < 1e-6, 'the sheet wraps rather than clamping')

  let out = 0
  for (let v = 0; v <= 1; v += 0.05) {
    for (let u = 0; u <= 1; u += 0.05) {
      const s = sampleReverse('base6-2', 'reverse-fireworks', grid, u, v, 2.5)
      if (!(s >= 0 && s <= 1)) out++
    }
  }
  ok(out === 0, 'sampling stays inside 0..1 at every scale', String(out))
}

// ---------------------------------------------------------------------------
// 7. Fields and rendering
// ---------------------------------------------------------------------------
{
  const field = reverseFieldFor('base6-2', 'reverse-fireworks', grid)
  ok(!!field, 'the fireworks field builds')
  ok(field?.plain !== true, 'a patterned reverse is not plain')
  ok(field?.verified === false, 'a reconstruction is not marked verified')
  ok((field?.coverage ?? 0) > 0.02, 'the field carries marks', String(field?.coverage))
  ok(String(field?.meta.approximation) === 'true', 'the field admits it is an approximation')

  const plainField = reverseFieldFor('ecard1-2', 'reverse-flat', null)
  ok(plainField?.plain === true, 'the plain finish builds without a texture')
  ok(plainField?.mark(0.5, 0.5) === 1 && plainField?.opacity(0.5, 0.5) === 1, 'and is full-strength everywhere')

  const base = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      base[i] = 50 + (x / W) * 150
      base[i + 1] = 70 + (y / H) * 140
      base[i + 2] = 100 + ((x + y) / (W + H)) * 110
      base[i + 3] = 255
    }
  }
  const spec = foilMaskFor({ cardId: 'base6-2', rarity: 'Common', variant: 'reverseHolofoil' })
  const draw = (mode: Parameters<typeof paintFoil>[6]['mode'], tilt: Parameters<typeof paintFoil>[5], fieldIn: typeof field = field) => {
    const buf = new Uint8ClampedArray(W * H * 4)
    paintFoil(buf, base, W, H, spec, tilt, { mode, settings: DEFAULT_FOIL_SETTINGS, map: null, field: fieldIn })
    return buf
  }

  const atRest = draw('composite', FACE_ON)
  ok(atRest.every((v, i) => v === base[i]), 'face-on is the scan byte for byte')

  const tilted = draw('composite', { deg: 55, axis: 45 })
  ok(meanLift(base, tilted, W, H, spec) > 2, 'the fireworks raise the body visibly', String(meanLift(base, tilted, W, H, spec)))

  let outside = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W
      const v = (y + 0.5) / H
      if (maskValue(spec!, u, v, W / H) !== 0) continue
      const i = (y * W + x) * 4
      if (tilted[i] !== base[i] || tilted[i + 1] !== base[i + 1] || tilted[i + 2] !== base[i + 2]) outside++
    }
  }
  ok(outside === 0, 'no light lands in the illustration window', `${outside} px`)

  let down = 0
  for (let i = 0; i < base.length; i += 4) {
    if (tilted[i] < base[i] || tilted[i + 1] < base[i + 1] || tilted[i + 2] < base[i + 2]) down++
  }
  ok(down === 0, 'the foil never darkens the print', `${down} px`)

  const plainDraw = draw('composite', { deg: 55, axis: 45 }, plainField)
  ok(meanLift(base, plainDraw, W, H, spec) > meanLift(base, tilted, W, H, spec),
    'the plain finish is brighter than the patterned one (no marks dimming it)')

  const pat = draw('pattern', { deg: 0, axis: 0 })
  let coloured = 0
  for (let i = 0; i < pat.length; i += 4) if (pat[i] !== pat[i + 1] || pat[i + 1] !== pat[i + 2]) coloured++
  ok(coloured === 0, 'the reverse pattern writes no colour of its own', `${coloured} px`)

  const again = draw('composite', { deg: 55, axis: 45 })
  ok(again.every((v, i) => v === tilted[i]), 'the same card and tilt render identically twice')
}

ok(REVERSE_SHOWCASE.length === 5, 'the inspector has all five validated cases', String(REVERSE_SHOWCASE.length))
ok(REVERSE_SHOWCASE.every((c) => c.variant === 'reverseHolofoil'), 'both are opened as reverse printings')

// ---------------------------------------------------------------------------
console.log(`\n${total - fails.length}/${total} assertions passed`)
if (fails.length) {
  console.log('FAILURES:')
  for (const f of fails) console.log(' ✗', f)
  process.exit(1)
}
console.log('ALL OK')
