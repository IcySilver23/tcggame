// Cosmos / Galaxy foil — Phase 2 assertions.
//
// What this suite is allowed to claim:
//   - the four pack variants ship, are not blank, and are not interchangeable;
//   - the sheet is sampled once per card (no repeat), and two copies of the same
//     card get different cuts, while a card is stable frame to frame;
//   - coverage follows the researched printings: art window for a holo rare,
//     outside it for a reverse, art+border for Pokémon-ex, whole card for LEGEND,
//     and a modelled (unverified) window for promos;
//   - the layer contract still holds with the Cosmos sheet in place: face-on is
//     the scan byte for byte, nothing lands outside the mask, light never darkens
//     the print, and a mark cannot double an already-white decoration.
//
// Run: ./node_modules/.bin/tsx tmp/check-cosmos.ts

import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { decodePng } from './png'
import {
  COSMOS_GRID,
  COSMOS_TEXTURE_VERIFIED,
  buildCosmosGrid,
  cosmosCopyFor,
  cosmosFieldFor,
  cosmosPaperFor,
  sampleCosmos,
} from '../src/foil/cosmos'
import { COSMOS_SHOWCASE, COSMOS_VARIANTS, COSMOS_VARIANT_IDS } from '../src/foil/cosmos-index'
import { cosmosCoverage } from '../src/foil/cosmos-masks'
import { CARD_AREA, coverageFraction, foilMaskFor, maskValue } from '../src/foil/mask'
import { holoFor } from '../src/holo'
import { DEFAULT_FOIL_SETTINGS, meanLift, paintFoil } from '../src/foil/stages'
import { FACE_ON } from '../src/foil/reflection'
import { fieldFromPatternMap } from '../src/foil/mark-field'

let total = 0
const fails: string[] = []
function ok(cond: boolean, label: string, detail?: string) {
  total++
  if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

const W = 200
const H = 279

// ---------------------------------------------------------------------------
// 1. The shipped sheet
// ---------------------------------------------------------------------------
ok(COSMOS_VARIANT_IDS.length === 4, 'the pack has four variants', String(COSMOS_VARIANT_IDS.length))
ok(new Set(COSMOS_VARIANT_IDS).size === 4, 'no duplicate variant ids')
ok(COSMOS_TEXTURE_VERIFIED === false, 'the textures are concept art, and the code says so')

const grids = new Map<string, ReturnType<typeof buildCosmosGrid>>()
for (const id of COSMOS_VARIANT_IDS) {
  const v = COSMOS_VARIANTS[id]
  const file = path.join('public', v.pattern.replace(/^\//, ''))
  ok(fs.existsSync(file), `${id}: texture is shipped`)
  ok(v.pattern.startsWith('/foil/cosmos/'), `${id}: served from /foil/cosmos/`, v.pattern)
  ok(v.alphaInRgba === true, `${id}: opacity lives in the RGBA alpha (no second asset)`)
  ok(v.size === '1024x1024', `${id}: texture is 1024x1024`, v.size)
  ok(v.coverage > 0.02 && v.coverage < 0.12, `${id}: mark coverage is a starfield, not a wash`, String(v.coverage))
  ok(v.peak > 0.5, `${id}: marks are bright enough to read`, String(v.peak))
  ok(v.concept === true, `${id}: metadata admits the texture is concept art`)

  const png = decodePng(file)
  const grid = buildCosmosGrid(png.w, png.h, png.px)
  grids.set(id, grid)
  ok(grid.peak > 0.5, `${id}: decoded grid has bright ink`, String(grid.peak))
  ok(Math.abs(grid.coverage - v.coverage) < 0.02, `${id}: generator record matches the file`, `${grid.coverage} vs ${v.coverage}`)
  let markOverOpacity = 0
  for (let i = 0; i < grid.mark.length; i++) if (grid.mark[i] > grid.opacity[i] + 1e-6) markOverOpacity++
  ok(markOverOpacity === 0, `${id}: ink never exceeds opacity (luma cannot amplify coverage)`, String(markOverOpacity))
}

// The four variants must not be the same file with different names.
{
  const ids = COSMOS_VARIANT_IDS
  let identicalPairs = 0
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      const ga = grids.get(ids[a])!
      const gb = grids.get(ids[b])!
      let differ = 0
      for (let i = 0; i < ga.mark.length; i += 97) if (Math.abs(ga.mark[i] - gb.mark[i]) > 0.02) differ++
      if (differ === 0) identicalPairs++
    }
  }
  ok(identicalPairs === 0, 'every variant is a different arrangement', `${identicalPairs} identical pairs`)
}

// ---------------------------------------------------------------------------
// 2. Grid building on synthetic texels
// ---------------------------------------------------------------------------
{
  const px = new Uint8ClampedArray(4 * 4 * 4)
  for (let i = 0; i < 16; i++) { px[i * 4] = 255; px[i * 4 + 1] = 255; px[i * 4 + 2] = 255 }
  px[(1 * 4 + 1) * 4 + 3] = 255
  const grid = buildCosmosGrid(4, 4, px, 4)
  ok(Math.abs(grid.mark[5] - 1) < 1e-6, 'an opaque white texel is full ink', String(grid.mark[5]))
  ok(Math.abs(grid.opacity[5] - 1) < 1e-6, 'an opaque white texel is full opacity', String(grid.opacity[5]))
  ok(Math.abs(grid.coverage - 1 / 16) < 1e-6, 'coverage counts only marked texels', String(grid.coverage))
  ok(grid.mark[0] === 0, 'a transparent texel carries no ink')
  ok(COSMOS_GRID >= 256, 'the sampling grid is dense enough for round orbs', String(COSMOS_GRID))
}

// ---------------------------------------------------------------------------
// 3. One cut per copy, stable per card
// ---------------------------------------------------------------------------
const db = new Database('data/tcglife.db', { readonly: true })
const holoRows = db
  .prepare("select id, rarity from cards where set_id = 'base4' and rarity like '%Holo%' order by id")
  .all() as { id: string; rarity: string }[]
db.close()

ok(holoRows.length >= 2, 'Base Set 2 has at least two holo rares to compare', String(holoRows.length))
const [cardA, cardB] = holoRows

{
  const a1 = cosmosCopyFor('base4-4')
  const a2 = cosmosCopyFor('base4-4')
  ok(a1.variant === a2.variant && a1.offsetU === a2.offsetU && a1.offsetV === a2.offsetV && a1.zoom === a2.zoom,
    'a card always shows the same cut (no shimmer between frames)')
  ok(a1.rotated === cosmosCopyFor(cardA.id).rotated && a1.rotated === cosmosCopyFor(cardB.id).rotated,
    'the sheet orientation is a property of the set, not the card')
  ok(a1.zoom >= 0.96 && a1.zoom <= 1.08, 'the cut scale stays near 1:1', String(a1.zoom))

  const other = cosmosCopyFor(cardB.id)
  ok(Math.abs(a1.offsetU - other.offsetU) > 1e-4 || Math.abs(a1.offsetV - other.offsetV) > 1e-4 || Math.abs(a1.zoom - other.zoom) > 1e-4,
    'two copies of the same printing get different cuts',
    `${a1.offsetU},${a1.offsetV} vs ${other.offsetU},${other.offsetV}`)

  // Variation should not collapse onto one value across a set.
  const seen = new Set<string>()
  for (const row of holoRows) {
    const c = cosmosCopyFor(row.id)
    seen.add(`${c.offsetU.toFixed(3)}:${c.offsetV.toFixed(3)}`)
  }
  ok(seen.size === holoRows.length, 'every holo in the set sits at its own position', `${seen.size}/${holoRows.length}`)
}

// One retro paper for the whole 2000–2011 run: the era ended in 2011 and the
// "HD" paper only arrives around 2013, so splitting the run in two had no source.
ok(cosmosPaperFor('base4-4') === 'classic_dense', 'Base Set 2 uses the vintage sheet')
ok(cosmosPaperFor('neo1-9') === 'classic_dense', 'Neo keeps the vintage sheet')
ok(cosmosPaperFor('hgss1-1') === 'classic_dense', 'HGSS keeps the vintage sheet too')
ok(cosmosPaperFor('col1-1') === 'classic_dense', 'Call of Legends is the last set on it')
ok(cosmosPaperFor('svp-46') === 'modern_fine', 'a post-2013 151 promo uses the smooth sheet')
ok(cosmosPaperFor('swshp-SWSH058') === 'modern_fine', 'an HD-era promo uses the smooth sheet')

// ---------------------------------------------------------------------------
// 4. Sampling: fixed marks, moving light
// ---------------------------------------------------------------------------
{
  const grid = grids.get('classic_dense')!
  const copy = cosmosCopyFor('base4-4')
  const a = sampleCosmos(copy, grid, 0.37, 0.62)
  const b = sampleCosmos(copy, grid, 0.37, 0.62)
  ok(a.mark === b.mark && a.opacity === b.opacity, 'sampling the same point twice is identical (the pattern does not drift)')

  // Scan the card: two cuts must disagree somewhere, but a single point can
  // legitimately land on bare field for both.
  const otherCopy = cosmosCopyFor(cardB.id)
  let differing = 0
  for (let v = 0.1; v <= 0.9; v += 0.1) {
    for (let u = 0.1; u <= 0.9; u += 0.1) {
      const p = sampleCosmos(copy, grid, u, v)
      const q = sampleCosmos(otherCopy, grid, u, v)
      if (Math.abs(p.mark - q.mark) > 1e-3 || Math.abs(p.opacity - q.opacity) > 1e-3) differing++
    }
  }
  ok(differing > 10, 'different copies sample different marks across the card', String(differing))

  let outOfRange = 0
  for (let v = 0; v <= 1; v += 0.05) {
    for (let u = 0; u <= 1; u += 0.05) {
      for (const scale of [1, 1.7, 3]) {
        const s = sampleCosmos(copy, grid, u, v, scale)
        if (!(s.mark >= 0 && s.mark <= 1 && s.opacity >= 0 && s.opacity <= 1)) outOfRange++
      }
    }
  }
  ok(outOfRange === 0, 'sampling stays inside 0..1 at every scale', String(outOfRange))

  // Beyond the sheet edge the sample clamps. That is what distinguishes a crop
  // from a repeat — the measured seams make wrapping the wrong choice.
  const edge = sampleCosmos(copy, grid, 1, 0.37)
  const beyond = sampleCosmos(copy, grid, 1.8, 0.37)
  ok(edge.mark === beyond.mark && edge.opacity === beyond.opacity, 'past the sheet edge the sample clamps, it does not wrap')
}

// ---------------------------------------------------------------------------
// 5. Coverage follows the research
// ---------------------------------------------------------------------------
{
  const base4 = foilMaskFor({ cardId: 'base4-4', rarity: 'Rare Holo' })
  ok(base4?.kind === 'art', 'Base Set 2 holo rare foils the illustration window', base4?.kind)
  ok(base4?.verified === true, 'the art-window rule is verified against a printing')
  ok(maskValue(base4!, 0.5, 0.3) === 255, 'the art centre is foil')
  ok(maskValue(base4!, 0.5, 0.05) === 0, 'the name bar is not foil')
  ok(maskValue(base4!, 0.5, 0.95) === 0, 'the text panel is not foil')
  ok(maskValue(base4!, 0.02, 0.3) === 0, 'the yellow frame is not foil')
  ok(maskValue(base4!, 0.002, 0.002) === 0, 'the cut corner is outside the card')
  ok(Math.abs(coverageFraction(base4) - 0.838 * 0.448) < 1e-9, 'holo coverage is the art rect')

  // Base Set 2 predates reverse holos, so the flag cannot invent a printing.
  ok(foilMaskFor({ cardId: 'base4-4', rarity: 'Rare Holo', variant: 'reverseHolofoil' }) === null,
    'Base Set 2 has no reverse printing to foil')
  // Legendary Collection introduced them, with its own documented paper.
  const rev = foilMaskFor({ cardId: 'base6-1', rarity: 'Rare Holo', variant: 'reverseHolofoil' })
  ok(rev?.kind === 'outsideArt', 'a reverse printing inverts the window', rev?.kind)
  ok(maskValue(rev!, 0.5, 0.3) === 0, 'reverse: the art has no foil')
  ok(maskValue(rev!, 0.5, 0.95) === 255, 'reverse: the text panel has foil')
  ok(cosmosFieldFor !== undefined, 'the Cosmos field adapter is still the renderer entry point')

  const base1 = foilMaskFor({ cardId: 'base1-4', rarity: 'Rare Holo' })
  ok(holoFor({ cardId: 'base1-4', rarity: 'Rare Holo' })?.style === 'starfoil', 'Base Set is Starlight, not Cosmos')
  ok(cosmosCoverage({ cardId: 'base1-4', rarity: 'Rare Holo' }) === null, 'Cosmos makes no claim about Base Set')
  ok(base1?.kind === 'art', 'Base Set still resolves through the generic path', base1?.kind)

  const sv = foilMaskFor({ cardId: 'sv3pt5-1', rarity: 'Common' })
  ok(sv === null, 'a modern common gets no foil and no mask')

  ok(foilMaskFor({ cardId: 'base4-4', rarity: 'Rare Holo' })?.evidence.includes('illustration window') === true,
    'the coverage rule carries its evidence text')
}

// ex / LEGEND / promo rows come from the catalog rather than invented ids.
{
  const db2 = new Database('data/tcglife.db', { readonly: true })
  const exRow = db2.prepare("select id, rarity from cards where set_id like 'ex%' and rarity like '%EX%' limit 1").get() as
    | { id: string; rarity: string } | undefined
  const legendRow = db2.prepare("select id, rarity from cards where set_id like 'hgss%' and rarity = 'LEGEND' limit 1").get() as
    | { id: string; rarity: string } | undefined
  const legendReprint = db2.prepare("select id, rarity from cards where set_id = 'me55c' and rarity = 'LEGEND' limit 1").get() as
    | { id: string; rarity: string } | undefined
  const promoRow = db2.prepare("select id, rarity from cards where id = 'basep-24'").get() as
    | { id: string; rarity: string } | undefined
  db2.close()

  ok(!!exRow, 'catalog has a Pokémon-ex row to check')
  if (exRow) {
    const spec = foilMaskFor({ cardId: exRow.id, rarity: exRow.rarity })
    ok(spec?.kind === 'artBorder', 'Pokémon-ex foils the art AND the border', `${exRow.id}: ${spec?.kind}`)
    ok(spec?.verified === true, 'the ex rule is documented')
    ok(maskValue(spec!, 0.5, 0.3) === 255, 'ex: art is foil')
    ok(maskValue(spec!, 0.02, 0.5) === 255, 'ex: border is foil')
    ok(maskValue(spec!, 0.5, 0.95) === 0, 'ex: text panel stays matte')
    ok(coverageFraction(spec!) > 0.838 * 0.448, 'ex coverage is larger than the window alone')
  }

  ok(!!legendRow, 'catalog has a LEGEND row to check')
  if (legendRow) {
    const spec = foilMaskFor({ cardId: legendRow.id, rarity: legendRow.rarity })
    ok(spec?.kind === 'full', 'LEGEND is foiled edge to edge', `${legendRow.id}: ${spec?.kind}`)
    ok(spec?.verified === true, 'the LEGEND rule is documented')
  }
  if (legendReprint) {
    const spec = foilMaskFor({ cardId: legendReprint.id, rarity: legendReprint.rarity })
    ok(spec?.kind === 'full', 'a Classic Collection LEGEND reprint is foiled edge to edge', `${legendReprint.id}: ${spec?.kind}`)
  }

  ok(!!promoRow, 'catalog has a named Cosmos promo to check')
  if (promoRow) {
    // Named by the promotional catalogue, so the identity is verified while the
    // foil AREA remains undocumented for this card.
    const cov = cosmosCoverage({ cardId: promoRow.id, rarity: promoRow.rarity })
    ok(cov?.kind === 'art', 'a catalogued promo foils the art window', `${promoRow.id}: ${cov?.kind}`)
    ok(cov?.verified === false, 'promo coverage is marked unverified, not asserted')
    // BW32 Victini is the BW promo no source lists: a programme's other rows do not
    // carry it, so it must stay unassigned rather than inherit the set's paper.
    ok(cosmosCoverage({ cardId: 'bwp-BW32', rarity: 'Promo' }) === null, 'a promo no source names is not blanket-assigned')
  }
}

// ---------------------------------------------------------------------------
// 6. The layer contract with the Cosmos sheet
// ---------------------------------------------------------------------------
function gradientBase(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      px[i] = 40 + (x / W) * 170
      px[i + 1] = 60 + (y / H) * 150
      px[i + 2] = 90 + ((x + y) / (W + H)) * 120
      px[i + 3] = 255
    }
  }
  return px
}
const base = gradientBase()
const spec = foilMaskFor({ cardId: 'base4-4', rarity: 'Rare Holo' })
const field = cosmosFieldFor('base4-4', grids.get('classic_dense')!, cosmosCopyFor('base4-4'))

function draw(mode: Parameters<typeof paintFoil>[6]['mode'], tilt: Parameters<typeof paintFoil>[5], settings = DEFAULT_FOIL_SETTINGS) {
  const buf = new Uint8ClampedArray(W * H * 4)
  paintFoil(buf, base, W, H, spec, tilt, { mode, settings, map: null, field })
  return buf
}

ok(field.verified === false, 'the Cosmos field reports its texture as unverified')
ok(field.peak > 0.5 && field.coverage > 0.02, 'the field is not empty', `${field.coverage}`)
ok(String(field.meta.reproduction).includes('concept'), 'the field metadata admits the texture is a concept')

{
  const plain = draw('base', { deg: 55, axis: 45 })
  ok(plain.every((v, i) => v === base[i]), 'base mode is the artwork, byte for byte')

  const atRest = draw('composite', FACE_ON)
  ok(atRest.every((v, i) => v === base[i]), 'face-on composite is the artwork, byte for byte')

  const tilted = draw('composite', { deg: 55, axis: 45 })
  let changed = 0
  for (let i = 0; i < base.length; i += 4) if (tilted[i] !== base[i] || tilted[i + 1] !== base[i + 1] || tilted[i + 2] !== base[i + 2]) changed++
  ok(changed > 200, 'a tilted card lights up across the window', `${changed} px`)
  ok(meanLift(base, tilted, W, H, spec) > 2, 'the composite lifts the foil visibly', String(meanLift(base, tilted, W, H, spec)))
  ok(meanLift(base, tilted, W, H, spec) < 70, 'the lift stays a foil, not a white-out', String(meanLift(base, tilted, W, H, spec)))

  let outsideTouched = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W
      const v = (y + 0.5) / H
      if (maskValue(spec!, u, v, W / H) !== 0) continue
      const i = (y * W + x) * 4
      if (tilted[i] !== base[i] || tilted[i + 1] !== base[i + 1] || tilted[i + 2] !== base[i + 2]) outsideTouched++
    }
  }
  ok(outsideTouched === 0, 'no light lands outside the coverage mask', `${outsideTouched} px`)

  for (const deg of [20, 45, 70]) {
    const buf = draw('composite', { deg, axis: 30 })
    let down = 0
    for (let i = 0; i < base.length; i += 4) {
      if (buf[i] < base[i] || buf[i + 1] < base[i + 1] || buf[i + 2] < base[i + 2]) down++
    }
    ok(down === 0, `at ${deg}° the foil never darkens the print`, `${down} px`)
  }

  const white = new Uint8ClampedArray(W * H * 4).fill(255)
  const overWhite = new Uint8ClampedArray(W * H * 4)
  paintFoil(overWhite, white, W, H, spec, { deg: 60, axis: 45 }, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: null, field })
  let whiteChanged = 0
  for (let i = 0; i < white.length; i += 4) if (overWhite[i] !== white[i] || overWhite[i + 1] !== white[i + 1] || overWhite[i + 2] !== white[i + 2]) whiteChanged++
  ok(whiteChanged === 0, 'a mark cannot double a bright printed decoration', `${whiteChanged} px`)

  const again = draw('composite', { deg: 55, axis: 45 })
  ok(again.every((v, i) => v === tilted[i]), 'the same card and tilt render identically twice')

  const off = draw('composite', { deg: 55, axis: 45 }, { ...DEFAULT_FOIL_SETTINGS, intensity: 0 })
  ok(off.every((v, i) => v === base[i]), 'intensity 0 is the artwork')

  const noPattern = draw('composite', { deg: 55, axis: 45 }, { ...DEFAULT_FOIL_SETTINGS, patternOpacity: 0 })
  ok(meanLift(base, noPattern, W, H, spec) !== meanLift(base, tilted, W, H, spec),
    'the sheet shapes the light (it is not decorative noise)')

  const pat = draw('pattern', { deg: 0, axis: 0 })
  let patternColoured = 0
  for (let i = 0; i < pat.length; i += 4) if (pat[i] !== pat[i + 1] || pat[i + 1] !== pat[i + 2]) patternColoured++
  ok(patternColoured === 0, 'the pattern layer writes no colour of its own', `${patternColoured} px`)

  const mask = draw('mask', { deg: 0, axis: 0 })
  let maskGrey = 0
  for (let i = 0; i < mask.length; i += 4) if (mask[i] !== 0 && mask[i] !== 255) maskGrey++
  ok(maskGrey === 0, 'the mask view is pure black and white', `${maskGrey} px`)
  ok(Math.abs(CARD_AREA - 0.9965) < 0.005, 'the card silhouette constant is unchanged (Radiant contract)', String(CARD_AREA))
}

// A Radiant card still resolves through the same interface, unchanged.
{
  const rc = foilMaskFor({ cardId: 'g1-RC6', rarity: 'Rare Holo EX' })
  ok(rc?.kind === 'full', 'Radiant RC6 is still full-bleed', rc?.kind)
  ok(fieldFromPatternMap !== undefined, 'the Radiant adapter still exists')
}

// ---------------------------------------------------------------------------
// 7. No procedural motion, no random particles
// ---------------------------------------------------------------------------
{
  const files = ['src/foil/cosmos.ts', 'src/foil/mark-field.ts', 'src/foil/cosmos-masks.ts']
  const offenders = files.filter((f) => {
    const src = fs.readFileSync(f, 'utf8')
    return src.includes('Math.random') || src.includes('Date.now')
  })
  ok(offenders.length === 0, 'the Cosmos path has no random or time-based marks', offenders.join(', '))
}

ok(COSMOS_SHOWCASE.some((c) => c.cardId === 'base4-4'), 'the showcase names the reference card')

// ---------------------------------------------------------------------------
console.log(`\n${total - fails.length}/${total} assertions passed`)
if (fails.length) {
  console.log('FAILURES:')
  for (const f of fails) console.log(' ✗', f)
  process.exit(1)
}
console.log('ALL OK')
