// Radiant Collection foil pack — Phase 1-3 assertions.
//
// What this suite is allowed to claim:
//   - the pack maps to the right card ids, per set (the RC6 trap: two cards,
//     same collector number, different textures);
//   - every texture that ships is real motif data, not a blank file;
//   - coverage masks follow the researched printings, including the Generations
//     commons that must have NO foil at all;
//   - the layer contract still holds with a real texture in place: face-on is the
//     scan byte for byte, nothing lands outside the mask, no channel goes down,
//     and a mark over already-white print adds no light.
//
// Run: ./node_modules/.bin/tsx tmp/check-radiant.ts

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'
import { RADIANT_ASSETS, RADIANT_CARD_IDS, RADIANT_COUNT } from '../src/foil/radiant-index'
import { buildPatternMap, samplePattern, CARD_ASPECT, type PatternMap } from '../src/foil/radiant'
import { foilMaskFor, maskValue } from '../src/foil/mask'
import { holoFor } from '../src/holo'
import { DEFAULT_FOIL_SETTINGS, meanLift, paintFoil } from '../src/foil/stages'
import { FACE_ON } from '../src/foil/reflection'

let total = 0
const fails: string[] = []
function ok(cond: boolean, label: string, detail?: string) {
  total++
  if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

// ---------------------------------------------------------------------------
// PNG decode (no image library in this project; zlib + the five filters suffice
// for the pack's 8-bit non-interlaced RGBA files)
// ---------------------------------------------------------------------------
type Png = { w: number; h: number; ch: number; px: Buffer }
function decodePng(file: string): Png {
  const b = fs.readFileSync(file)
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG: ' + file)
  let o = 8
  let w = 0
  let h = 0
  let color = 0
  const idat: Buffer[] = []
  while (o < b.length) {
    const len = b.readUInt32BE(o)
    const type = b.toString('ascii', o + 4, o + 8)
    const data = b.subarray(o + 8, o + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      color = data[9]
    } else if (type === 'IDAT') idat.push(data)
    o += 12 + len
  }
  const ch = color === 6 ? 4 : color === 2 ? 3 : 0
  if (!ch) throw new Error(`unsupported colour type ${color}`)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = Buffer.alloc(h * stride)
  let p = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[p++]
    const line = raw.subarray(p, p + stride)
    p += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0
      const bp = prev ? prev[x] : 0
      const c = prev && x >= ch ? prev[x - ch] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += bp
      else if (filter === 3) v += (a + bp) >> 1
      else if (filter === 4) {
        const pp = a + bp - c
        const pa = Math.abs(pp - a)
        const pb = Math.abs(pp - bp)
        const pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? bp : c
      }
      cur[x] = v & 255
    }
  }
  return { w, h, ch, px: out }
}

const PACK = 'Radiant_Collection_57_Card_Foil_Concept_Pack'
const publicPath = (url: string) => path.join('public', url.replace(/^\//, ''))

// ---------------------------------------------------------------------------
// 1. The mapping
// ---------------------------------------------------------------------------
const db = new Database('data/tcglife.db', { readonly: true })
const rcRows = db.prepare("select id, name, rarity from cards where number like 'RC%'").all() as { id: string; name: string; rarity: string }[]
db.close()

ok(RADIANT_COUNT === 57, 'pack covers 57 cards', String(RADIANT_COUNT))
ok(RADIANT_CARD_IDS.length === 57, 'index lists 57 card ids', String(RADIANT_CARD_IDS.length))
ok(new Set(RADIANT_CARD_IDS).size === 57, 'no duplicate card ids in the index')
ok(RADIANT_CARD_IDS.every((id) => !!RADIANT_ASSETS[id]), 'every listed id has an asset')
ok(
  rcRows.length === 57 && rcRows.every((r) => !!RADIANT_ASSETS[r.id]),
  'every RC card in the database has a pack asset',
  `${rcRows.filter((r) => !RADIANT_ASSETS[r.id]).map((r) => r.id).join(', ') || 'all present'}`,
)
ok(
  rcRows.every((r) => RADIANT_ASSETS[r.id].rarity === r.rarity),
  'index rarities match the database (the mask research depends on them)',
)

// The trap this whole mapping exists to avoid.
ok(RADIANT_ASSETS['g1-RC6'].folder.includes('Generations') && RADIANT_ASSETS['g1-RC6'].pattern !== RADIANT_ASSETS['bw11-RC6'].pattern,
  'g1-RC6 and bw11-RC6 are different textures')
ok(RADIANT_ASSETS['g1-RC6'].pattern === '/foil/radiant/g1/RC6.png', 'g1-RC6 resolves to the Generations RC6 file')
ok(RADIANT_ASSETS['bw11-RC6'].pattern === '/foil/radiant/bw11/RC6.png', 'bw11-RC6 resolves to the Legendary Treasures RC6 file')
ok(new Set(RADIANT_CARD_IDS.map((id) => RADIANT_ASSETS[id].pattern)).size === 57, 'no two cards share a texture file')
ok(
  RADIANT_CARD_IDS.every((id) => {
    const a = RADIANT_ASSETS[id]
    return a.pattern === `/foil/radiant/${a.setId}/${a.number}.png` && a.folder.includes(a.number.replace('RC', 'RC0'))
      || (Number(a.number.slice(2)) >= 10 && a.pattern === `/foil/radiant/${a.setId}/${a.number}.png`)
  }),
  'every texture path is set-scoped and number-scoped',
)
ok(RADIANT_CARD_IDS.every((id) => fs.existsSync(path.join(PACK, RADIANT_ASSETS[id].folder))), 'every card folder exists in the pack')
ok(RADIANT_CARD_IDS.every((id) => /^[a-z]+$/i.test(RADIANT_ASSETS[id].motif)), 'every card records the motif the pack names')

// ---------------------------------------------------------------------------
// 2. The shipped textures are real motif data
// ---------------------------------------------------------------------------
const maps = new Map<string, PatternMap>()
let blankTextures = 0
let tinyCoverage = 0
let hugeCoverage = 0
for (const id of RADIANT_CARD_IDS) {
  const asset = RADIANT_ASSETS[id]
  const file = publicPath(asset.pattern)
  ok(fs.existsSync(file), `${id} texture is shipped`)
  const png = decodePng(file)
  ok(png.w === 768 && png.h === 768 && png.ch === 4, `${id} texture is 768x768 RGBA`, `${png.w}x${png.h}x${png.ch}`)
  const map = buildPatternMap(id, png.w, png.h, png.px)
  maps.set(id, map)
  if (map.peak < 0.05) blankTextures++
  if (map.coverage < 0.005) tinyCoverage++
  if (map.coverage > 0.5) hugeCoverage++
}
ok(blankTextures === 0, 'no shipped texture is blank', `${blankTextures} blank`)
ok(tinyCoverage === 0, 'every texture marks at least half a percent of its area', `${tinyCoverage} too sparse`)
ok(hugeCoverage === 0, 'no texture marks more than half its area (that would be a wash, not a motif)', `${hugeCoverage} too dense`)

// pattern_alpha.png: the generator says it is the RGBA alpha channel. Spot-check
// three cards against the pack rather than trusting the report.
for (const id of ['g1-RC6', 'bw11-RC6', 'g1-RC28']) {
  const asset = RADIANT_ASSETS[id]
  const rgba = decodePng(path.join(PACK, asset.folder, 'pattern_RGBA.png'))
  const alpha = decodePng(path.join(PACK, asset.folder, 'pattern_alpha.png'))
  let same = rgba.px.length === alpha.px.length
  for (let i = 3; same && i < rgba.px.length; i += 4) same = rgba.px[i] === alpha.px[i]
  ok(same, `${id}: pattern_alpha.png is the RGBA alpha channel`, 'differs — the renderer would need the separate file')
}

// ---------------------------------------------------------------------------
// 3. Sampling
// ---------------------------------------------------------------------------
{
  // 4x4 opaque white at one pixel, transparent everywhere else.
  const px = new Uint8ClampedArray(4 * 4 * 4)
  for (let i = 0; i < 16; i++) { px[i * 4] = 255; px[i * 4 + 1] = 255; px[i * 4 + 2] = 255 }
  px[(1 * 4 + 1) * 4 + 3] = 255
  const map = buildPatternMap('g1-RC6', 4, 4, px, 4)
  ok(Math.abs(map.mark[5] - 1) < 1e-6, 'a white opaque texel reaches full mark', String(map.mark[5]))
  ok(Math.abs(map.opacity[5] - 1) < 1e-6, 'a white opaque texel reaches full opacity', String(map.opacity[5]))
  ok(Math.abs(map.coverage - 1 / 16) < 1e-6, 'coverage counts only marked texels', String(map.coverage))
  ok(map.mark[0] === 0, 'a transparent texel carries no mark')
}

{
  const map = maps.get('g1-RC6')!
  const a = samplePattern(map, 0.34, 0.71)
  const b = samplePattern(map, 1.34, 0.71)
  ok(Math.abs(a.mark - b.mark) < 1e-9, 'the motif wraps horizontally (one copy across the width)')
  const c = samplePattern(map, 0.34, 0.71 + CARD_ASPECT)
  ok(Math.abs(a.mark - c.mark) < 1e-9, 'the motif wraps vertically at card aspect, so bows stay round')
  let markOverOpacity = 0
  for (let v = 0.02; v < 1; v += 0.07) {
    for (let u = 0.02; u < 1; u += 0.07) {
      const s = samplePattern(map, u, v)
      if (s.mark > s.opacity + 1e-6) markOverOpacity++
    }
  }
  ok(markOverOpacity === 0, 'a mark never exceeds its own opacity (luma cannot amplify coverage)', String(markOverOpacity))
}

// ---------------------------------------------------------------------------
// 4. Coverage masks follow the research, not convenience
// ---------------------------------------------------------------------------
ok(holoFor({ cardId: 'g1-RC1', rarity: 'Common' }) === null, 'a Generations RC common is not foil at all')
ok(foilMaskFor({ cardId: 'g1-RC1', rarity: 'Common' }) === null, 'a Generations RC common gets no mask')
ok(foilMaskFor({ cardId: 'g1-RC1', rarity: 'Common', variant: 'reverseHolofoil' }) === null, 'a reverse flag cannot invent foil on a plain RC common')
ok(holoFor({ cardId: 'g1-RC5', rarity: 'Uncommon' })?.style === 'radiant', 'a Generations RC uncommon is Radiant foil')

const bw1 = foilMaskFor({ cardId: 'bw11-RC1', rarity: 'Common' })
ok(bw1?.kind === 'full' && bw1.verified === true, 'Legendary Treasures RC is foil across the whole card, verified')

const flareon = foilMaskFor({ cardId: 'g1-RC6', rarity: 'Rare Holo EX' })
ok(flareon?.kind === 'full' && flareon.verified === true, 'RC6 is edge-to-edge, verified by photograph')

const yveltal = foilMaskFor({ cardId: 'g1-RC16', rarity: 'Uncommon' })
ok(yveltal?.kind === 'art' && yveltal.verified === true, 'RC16 is the art window, verified by scan')

const charmander = foilMaskFor({ cardId: 'g1-RC5', rarity: 'Uncommon' })
ok(charmander?.kind === 'art' && charmander.verified === false, 'other Generations RC uncommons are modelled, and say so')

const fullArt = foilMaskFor({ cardId: 'g1-RC28', rarity: 'Rare Ultra' })
ok(fullArt?.kind === 'fullArt' && fullArt.verified === false, 'RC28 full-art coverage is modelled, and says so')

let plainMatchesRarity = 0
for (const row of rcRows) {
  const spec = foilMaskFor({ cardId: row.id, rarity: row.rarity })
  const shouldBePlain = row.id.startsWith('g1-') && /^common$/i.test(row.rarity)
  if (shouldBePlain === (spec === null)) plainMatchesRarity++
}
ok(plainMatchesRarity === 57, 'foil existence matches rarity for all 57 RC cards', `${plainMatchesRarity}/57`)
const g1Commons = rcRows.filter((r) => r.id.startsWith('g1-') && /^common$/i.test(r.rarity)).length
ok(g1Commons === 13, 'the Generations RC common count is the 13 the print sheets imply', String(g1Commons))

// ---------------------------------------------------------------------------
// 4b. Phase 3 validation record: which of the 57 configurations rest on a
// source, and which are this build's disclosed geometry. These numbers are the
// deliverable, so they are pinned here: if a later change quietly promotes a
// modelled card to verified, this fails.
// ---------------------------------------------------------------------------
{
  let verifiedFoil = 0
  let modelledFoil = 0
  let plain = 0
  let shortEvidence = 0
  let g1Full = 0
  let bw11NotFull = 0
  for (const row of rcRows) {
    const spec = foilMaskFor({ cardId: row.id, rarity: row.rarity })
    if (!spec) { plain++; continue }
    if (spec.verified) verifiedFoil++
    else modelledFoil++
    if (spec.evidence.trim().length < 40) shortEvidence++
    if (row.id.startsWith('g1-') && spec.kind === 'full') g1Full++
    if (row.id.startsWith('bw11-') && spec.kind !== 'full') bw11NotFull++
  }
  ok(plain === 13, 'exactly 13 RC printings have no foil (Generations commons)', String(plain))
  ok(verifiedFoil === 27, '27 foil configurations rest on a source (26 full-face + RC16)', String(verifiedFoil))
  ok(modelledFoil === 17, '17 foil configurations are modelled and must say so', String(modelledFoil))
  ok(verifiedFoil + modelledFoil + plain === 57, 'the three groups account for all 57 cards')
  ok(shortEvidence === 0, 'every configuration carries its evidence sentence', String(shortEvidence))
  ok(g1Full === 1, 'only Generations RC6 is verified full-bleed', String(g1Full))
  ok(bw11NotFull === 0, 'every Legendary Treasures RC card is full-face', String(bw11NotFull))
}

// ---------------------------------------------------------------------------
// 5. The layer contract, with a real texture
// ---------------------------------------------------------------------------
const W = 200
const H = 279
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
const draw = (mode: Parameters<typeof paintFoil>[6]['mode'], spec: Parameters<typeof paintFoil>[4], tilt: Parameters<typeof paintFoil>[5], settings = DEFAULT_FOIL_SETTINGS, map: PatternMap | null = maps.get('g1-RC6')!) => {
  const buf = new Uint8ClampedArray(W * H * 4)
  paintFoil(buf, base, W, H, spec, tilt, { mode, settings, map })
  return buf
}

{
  const plain = draw('base', flareon, { deg: 55, axis: 45 })
  ok(plain.every((v, i) => v === base[i]), 'base mode is the artwork, byte for byte')

  const atRest = draw('composite', flareon, FACE_ON)
  ok(atRest.every((v, i) => v === base[i]), 'face-on composite is the artwork, byte for byte')

  const tilted = draw('composite', flareon, { deg: 55, axis: 45 })
  const changes = (() => { let n = 0; for (let i = 0; i < base.length; i += 4) if (tilted[i] !== base[i] || tilted[i + 1] !== base[i + 1] || tilted[i + 2] !== base[i + 2]) n++; return n })()
  ok(changes > 0, 'a tilted card does light up')
  ok(meanLift(base, tilted, W, H, flareon) > 2, 'the composite lifts the foil by a visible amount', String(meanLift(base, tilted, W, H, flareon)))

  // Nothing outside the mask, on a card where the mask is not the whole card.
  const window = draw('composite', yveltal, { deg: 55, axis: 45 })
  let outsideTouched = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W
      const v = (y + 0.5) / H
      if (maskValue(yveltal!, u, v, W / H) !== 0) continue
      const i = (y * W + x) * 4
      if (window[i] !== base[i] || window[i + 1] !== base[i + 1] || window[i + 2] !== base[i + 2]) outsideTouched++
    }
  }
  ok(outsideTouched === 0, 'no light lands outside the coverage mask', `${outsideTouched} px`)

  for (const deg of [20, 45, 70]) {
    const buf = draw('composite', flareon, { deg, axis: 30 })
    let down = 0
    for (let i = 0; i < base.length; i += 4) {
      if (buf[i] < base[i] || buf[i + 1] < base[i + 1] || buf[i + 2] < base[i + 2]) down++
    }
    ok(down === 0, `at ${deg}° the foil never darkens the artwork`, `${down} px`)
  }

  // Duplicate-decoration guard: over already-white print a mark adds nothing.
  const white = new Uint8ClampedArray(W * H * 4).fill(255)
  const overWhite = new Uint8ClampedArray(W * H * 4)
  paintFoil(overWhite, white, W, H, flareon, { deg: 60, axis: 45 }, { mode: 'composite', settings: DEFAULT_FOIL_SETTINGS, map: maps.get('g1-RC6')! })
  let whiteChanged = 0
  for (let i = 0; i < white.length; i += 4) if (overWhite[i] !== white[i] || overWhite[i + 1] !== white[i + 1] || overWhite[i + 2] !== white[i + 2]) whiteChanged++
  ok(whiteChanged === 0, 'a mark cannot double a bright printed decoration', `${whiteChanged} px`)

  // The knobs mean what they say.
  // Colour off means NEUTRAL light: every changed pixel must move R, G and B by
  // the same amount. (It is not bit-identical to the reflection stage, because
  // the pattern still shapes it — that is what the pattern is for.)
  const noColour = draw('composite', flareon, { deg: 55, axis: 45 }, { ...DEFAULT_FOIL_SETTINGS, iridescence: 0 })
  let channelDrift = 0
  for (let i = 0; i < base.length; i += 4) {
    if (noColour[i] === base[i] && noColour[i + 1] === base[i + 1] && noColour[i + 2] === base[i + 2]) continue
    const dr = noColour[i] - base[i]
    const dg = noColour[i + 1] - base[i + 1]
    const dbb = noColour[i + 2] - base[i + 2]
    if (dr !== dg || dg !== dbb) channelDrift++
  }
  ok(channelDrift === 0, 'iridescence 0 leaves purely neutral light', `${channelDrift} px with channel drift`)

  const tinted = draw('composite', flareon, { deg: 70, axis: 45 })
  let tintedPixels = 0
  for (let i = 0; i < base.length; i += 4) {
    const dr = tinted[i] - base[i]
    const dg = tinted[i + 1] - base[i + 1]
    const dbb = tinted[i + 2] - base[i + 2]
    if (dr !== dg || dg !== dbb) tintedPixels++
  }
  ok(tintedPixels > 0, 'at a steep angle the light does carry colour', String(tintedPixels))

  const noPattern = draw('composite', flareon, { deg: 55, axis: 45 }, { ...DEFAULT_FOIL_SETTINGS, patternOpacity: 0 })
  const noPatternLift = meanLift(base, noPattern, W, H, flareon)
  const patternedLift = meanLift(base, draw('composite', flareon, { deg: 55, axis: 45 }), W, H, flareon)
  ok(noPatternLift !== patternedLift, 'the motif changes how much light lands (it is not decorative noise)', `${patternedLift} vs ${noPatternLift}`)

  const off = draw('composite', flareon, { deg: 55, axis: 45 }, { ...DEFAULT_FOIL_SETTINGS, intensity: 0 })
  ok(off.every((v, i) => v === base[i]), 'intensity 0 is the artwork')
}

// Two different cards must not render the same marks.
{
  const a = maps.get('g1-RC6')!
  const b = maps.get('bw11-RC6')!
  let differs = 0
  for (let i = 0; i < a.mark.length; i++) if (Math.abs(a.mark[i] - b.mark[i]) > 1e-3) differs++
  ok(differs > a.mark.length * 0.05, 'different cards carry different motifs', `${differs} texels differ`)
}

// ---------------------------------------------------------------------------
// 6. The old procedural effects are gone from the Radiant path
// ---------------------------------------------------------------------------
{
  const files = fs.readdirSync('src/foil').filter((f) => /\.(ts|tsx)$/.test(f))
  const randomUsers = files.filter((f) => fs.readFileSync(path.join('src/foil', f), 'utf8').includes('Math.random'))
  ok(randomUsers.length === 0, 'no foil module generates particles at random', randomUsers.join(', '))
}

// ---------------------------------------------------------------------------
console.log(`\n${total - fails.length}/${total} assertions passed`)
if (fails.length) {
  console.log('FAILURES:')
  for (const f of fails) console.log(' ✗', f)
  process.exit(1)
}
console.log('ALL OK')
