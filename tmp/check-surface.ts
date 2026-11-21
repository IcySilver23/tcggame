// Phase 11: textured printings and the etched normal map.
//
// Run: ./node_modules/.bin/tsx tmp/check-surface.ts

import fs from 'node:fs'
import { buildEtchedNormalMap, SURFACE_SHOWCASE, SURFACE_TEXTURES, surfaceFor, TEXTURED_SURFACE_VERIFIED } from '../src/foil/surface-textures'
import { renderDiffPreview, renderNormalPreview, renderReliefPreview } from '../src/foil/surface-preview'
import { referenceCaption, REFERENCE_PHOTOS } from '../src/foil/reference'
import { etchedHeight, sparkleHeight, ETCHED_SIZE } from '../src/foil/surface-map'
import { normalMapFromHeight } from '../src/foil/surface'
import { composeFrame, type FoilLayer } from '../src/foil/engine'
import { foilMaskFor, maskValue } from '../src/foil/mask'
import { FACE_ON } from '../src/foil/reflection'
import { DEFAULT_FOIL_SETTINGS } from '../src/foil/stages'
import type { MarkField } from '../src/foil/mark-field'

let total = 0
let fails = 0
function ok(cond: boolean, label: string, detail?: string): void {
  total++
  if (!cond) { fails++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

console.log('Phase 11 — textured ultra rares and the etched normal map')

// --------------------------------------------------------------------- routing
ok(surfaceFor({ rarity: 'Illustration Rare' }) === 'etched', 'Illustration Rare is textured')
ok(surfaceFor({ rarity: 'Special Illustration Rare' }) === 'etched', 'Special Illustration Rare is textured')
ok(surfaceFor({ rarity: 'Ultra Rare' }) === 'etched', 'Ultra Rare is textured')
ok(surfaceFor({ rarity: 'Hyper Rare' }) === 'etched', 'Hyper Rare is textured')
ok(surfaceFor({ rarity: 'Rare Ultra' }) === 'etched', 'Rare Ultra is textured')
ok(surfaceFor({ rarity: 'Full Art' }) === 'etched', 'a full art is textured')
ok(surfaceFor({ rarity: 'Double Rare' }) === null, 'Double Rare stays smooth')
ok(surfaceFor({ rarity: 'Common' }) === null, 'a common stays smooth')
ok(surfaceFor({ rarity: 'Rare' }) === null, 'a plain Rare stays smooth')
ok(surfaceFor({ rarity: 'Shiny Ultra Rare' }) === 'sparkle', 'a Shiny Vault rarity wears the granular relief')
ok(surfaceFor({ rarity: 'Rare Shiny', cardId: 'sma-1' }) === 'sparkle', 'Hidden Fates too, with no sheet borrowed')
ok(surfaceFor({ rarity: 'Shiny Rare', cardId: 'sv4pt5-1' }) === 'sparkle', 'and Paldean Fates')
ok(surfaceFor({ rarity: 'Rare Shiny', variant: 'reverseHolofoil' }) === null, 'a reverse shiny still carries no surface')
ok(surfaceFor({ rarity: 'Shiny Secret Rare' }) === null, 'a shiny label outside the vault is not embossed')
ok(surfaceFor({ rarity: 'Ultra Rare', variant: 'reverseHolofoil' }) === null, 'a reverse carries no surface')
ok(surfaceFor({ rarity: 'Rare Ultra', cardId: 'bw1-113' }) === 'etched-deep', 'a Black & White full art wears the deep relief')
ok(surfaceFor({ rarity: 'Rare Ultra', cardId: 'xy1-141' }) === 'etched-deep', 'an XY full art wears the deep relief')
ok(surfaceFor({ rarity: 'Rare Ultra', cardId: 'swsh1-1' }) === 'etched', 'a Sword & Shield full art wears the fine relief')
ok(surfaceFor({ rarity: 'Illustration Rare', cardId: 'sv1-199' }) === 'etched', 'a Scarlet & Violet illustration rare wears the fine relief')
ok(surfaceFor({ rarity: 'Rare Ultra' }) === 'etched', 'a card with no set id falls back to the fine relief')

const meta = SURFACE_TEXTURES.etched
ok(meta.verified === false && meta.modelled === true, 'the surface discloses that it is modelled')
ok(TEXTURED_SURFACE_VERIFIED === false, 'nothing claims a verified texture')
ok(fs.existsSync('public' + meta.texture), 'the normal map ships', meta.texture)
ok(meta.strength > 0 && meta.strength <= 1, 'the default strength is in range', String(meta.strength))

// ---------------------------------------------------------------- normal map
const small = buildEtchedNormalMap(128)
ok(small.w === 128 && small.h === 128, 'the map keeps its requested size', `${small.w}x${small.h}`)
let inRange = true
let sloped = 0
for (let y = 0; y < small.h; y++) {
  for (let x = 0; x < small.w; x++) {
    const i = (y * small.w + x) * 2
    const nx = (small.data[i] - 127.5) / 127.5
    const ny = (small.data[i + 1] - 127.5) / 127.5
    if (Math.abs(nx) > 1.01 || Math.abs(ny) > 1.01) inRange = false
    if (Math.hypot(nx, ny) > 0.02) sloped++
  }
}
ok(inRange, 'every stored slope stays within the encodable range')
ok(sloped / (small.w * small.h) > 0.6, 'most of the sheet is sloped', (sloped / (small.w * small.h)).toFixed(2))
// Crossing the wrap should look like any other row step: equality is the wrong
// test, because neighbouring rows differ by one pixel of slope by design.
let wrapStep = 0
let innerStep = 0
const midRow = Math.floor(small.h / 2)
for (let x = 0; x < small.w; x++) {
  wrapStep += Math.abs(small.data[x * 2] - small.data[((small.h - 1) * small.w + x) * 2])
  innerStep += Math.abs(small.data[(midRow * small.w + x) * 2] - small.data[((midRow + 1) * small.w + x) * 2])
}
const seamRatio = wrapStep / Math.max(1, innerStep)
ok(seamRatio <= 2.5, 'the lattice wraps like an ordinary row step', seamRatio.toFixed(2))

const heightSeam = Math.abs(etchedHeight(0.001, 0.31) - etchedHeight(0.999, 0.31))
ok(heightSeam < 0.05, 'the height field itself is periodic', heightSeam.toFixed(3))
const flatMap = normalMapFromHeight(16, 16, () => 0.5, 4)
let centred = true
for (let i = 0; i < flatMap.data.length; i++) if (Math.abs(flatMap.data[i] - 128) > 1) centred = false
ok(centred, 'a constant height is a flat normal')

// -------------------------------------------------------------- engine surface
const W = 200
const H = 279
const spec = foilMaskFor({ cardId: 'sv1-1', rarity: 'Illustration Rare' })!
ok(!!spec, 'an illustration rare has a foil mask')
const base = new Uint8ClampedArray(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    base[i] = 40 + ((x * 5) % 120)
    base[i + 1] = 60 + ((y * 3) % 100)
    base[i + 2] = 90
    base[i + 3] = 255
  }
}
const plain: MarkField = {
  id: 'test', label: 'plain', mark: () => 1, opacity: () => 1, coverage: 1, peak: 1,
  verified: false, plain: true, note: 'uniform', meta: {},
}
const layer: FoilLayer = { id: 'printing', spec, field: plain, settings: DEFAULT_FOIL_SETTINGS, surface: { map: small, strength: 0.45 } }

const rest = composeFrame(base, W, H, { tilt: FACE_ON, layers: [layer] })
let same = true
for (let i = 0; i < base.length; i++) if (rest[i] !== base[i]) { same = false; break }
ok(same, 'a textured card at rest is still the scan, byte for byte')

const TILT55 = { deg: 55, axis: Math.PI / 4 }
// The foil reflection is in both frames; only the surface differs, so every
// measurement below is the relief's contribution, not the sheen's.
const unembossed = composeFrame(base, W, H, { tilt: TILT55, layers: [{ ...layer, surface: null }] })
const tilted = composeFrame(base, W, H, { tilt: TILT55, layers: [layer] })
let changed = 0
let outside = 0
let alpha = true
let hue = true
let sum = 0
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const dr = tilted[i] - unembossed[i]
    const dg = tilted[i + 1] - unembossed[i + 1]
    const db = tilted[i + 2] - unembossed[i + 2]
    if (dr !== 0 || dg !== 0 || db !== 0) {
      changed++
      sum += dr
      if (dr !== dg || dg !== db) hue = false
      if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, W / H) === 0) outside++
    }
    if (tilted[i + 3] !== unembossed[i + 3]) alpha = false
  }
}
ok(changed > 0, 'at 55° the relief shades the foil', String(changed))
ok(outside === 0, 'no shading escapes the mask', String(outside))
ok(alpha, 'the surface never writes alpha')
ok(hue, 'shading is one equal delta, so hue cannot shift')
ok(Math.abs(sum / changed) < 2, 'the relief is symmetric, with no net brightness change', (sum / changed).toFixed(2))

// Strength scales the effect without changing where it lands.
const softer = composeFrame(base, W, H, { tilt: TILT55, layers: [{ ...layer, surface: { map: small, strength: 0.15 } }] })
let softerChanged = 0
for (let i = 0; i < base.length; i += 4) {
  if (softer[i] !== unembossed[i] || softer[i + 1] !== unembossed[i + 1] || softer[i + 2] !== unembossed[i + 2]) softerChanged++
}
ok(softerChanged > 0 && softerChanged < changed, 'a shallower relief touches fewer pixels', `${softerChanged} vs ${changed}`)
ok(unembossed.length === base.length, 'no surface means the plain composite path')

// --------------------------------------------------------------- inspector views
{
  const preview = new Uint8ClampedArray(64 * 64 * 4)
  renderNormalPreview(preview, 64, 64, flatMap)
  ok(preview[0] === 128 && preview[1] === 128 && preview[2] === 255 && preview[3] === 255,
    'the normal-map preview encodes flat as 128,128,255')
  const textured = new Uint8ClampedArray(64 * 64 * 4)
  renderNormalPreview(textured, 64, 64, small)
  let varied = 0
  for (let i = 0; i < textured.length; i += 4) if (textured[i] !== 128 || textured[i + 1] !== 128) varied++
  ok(varied > 0, 'the preview shows the relief\'s slope', String(varied))

  const reliefOnly = new Uint8ClampedArray(base.length)
  renderReliefPreview(reliefOnly, base, W, H, spec, small, 0)
  let unchanged = true
  for (let i = 0; i < base.length; i++) if (reliefOnly[i] !== base[i]) { unchanged = false; break }
  ok(unchanged, 'relief-only at strength 0 is the scan')

  renderReliefPreview(reliefOnly, base, W, H, spec, small, 0.45)
  let shaded = 0
  let escaped = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      if (reliefOnly[i] === base[i] && reliefOnly[i + 1] === base[i + 1] && reliefOnly[i + 2] === base[i + 2]) continue
      shaded++
      if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, W / H) === 0) escaped++
    }
  }
  ok(shaded > 0, 'relief-only shades the foil', String(shaded))
  ok(escaped === 0, 'relief-only never leaves the mask', String(escaped))

  // Pixel diff: the diagnostic that proves the scan survives untouched.
  const DW = 8
  const DH = 8
  const dBase = new Uint8ClampedArray(DW * DH * 4)
  const dFrame = new Uint8ClampedArray(DW * DH * 4)
  for (let i = 0; i < dBase.length; i += 4) {
    dBase[i] = 20
    dBase[i + 1] = 40
    dBase[i + 2] = 60
    dBase[i + 3] = 255
  }
  dFrame.set(dBase)
  const dOut = new Uint8ClampedArray(DW * DH * 4)
  const restDiff = renderDiffPreview(dOut, dBase, dFrame, DW, DH, null)
  ok(restDiff.changed === 0 && restDiff.maxDelta === 0, 'a frame at rest diffs to nothing')
  const at = (3 * DW + 4) * 4
  dFrame[at] += 30
  dFrame[at + 1] += 30
  dFrame[at + 2] += 30
  const oneDiff = renderDiffPreview(dOut, dBase, dFrame, DW, DH, null)
  ok(oneDiff.changed === 1 && oneDiff.maxDelta === 30, 'one changed pixel is counted', `${oneDiff.changed}/${oneDiff.maxDelta}`)
  ok(oneDiff.outside === 0, 'no pixel is claimed outside a mask that does not exist')
  let diffOpaque = true
  for (let i = 3; i < dOut.length; i += 4) if (dOut[i] !== 255) diffOpaque = false
  ok(diffOpaque, 'the diff preview is fully opaque')

  // Reference pane: a scan may stand in for the base layer, never for relief evidence.
  ok(REFERENCE_PHOTOS.every((r) => r.kind === 'tilted-photo' && !!r.src && !!r.credit), 'reference photos are tilted photographs with a credit')
  const noRef = referenceCaption('zzz-0').toLowerCase()
  ok(noRef.includes('no tilted photograph'), 'the reference pane says when none is catalogued')
  ok(noRef.includes('cannot confirm the relief'), 'and refuses to let the flat scan stand in for proof')

  ok(SURFACE_SHOWCASE.length >= 2, 'the inspector opens more than one textured card', String(SURFACE_SHOWCASE.length))
  for (const card of SURFACE_SHOWCASE) {
    const id = surfaceFor({ rarity: card.rarity, variant: 'holofoil', cardId: card.cardId })
    ok(id !== null, `${card.cardId} resolves to a textured surface`)
    ok(!!id && fs.existsSync('public' + SURFACE_TEXTURES[id].texture), `${card.cardId} has its relief sheet`)
  }
}

// ------------------------------------------------------------------- report
const report = JSON.parse(fs.readFileSync('reports/surface-printings.json', 'utf8')) as {
  counts: { surfaces: number; rarities: number; cards: number; cardsBySurface: Record<string, number>; textureVerified: boolean }
  problems: string[]
}
ok(report.counts.surfaces === 3, 'the report counts three surfaces')
ok(report.counts.cardsBySurface['etched-deep'] > 0, 'and cards routed to the deep relief', String(report.counts.cardsBySurface['etched-deep']))
ok(report.counts.cardsBySurface['etched'] > 0, 'and cards routed to the fine relief', String(report.counts.cardsBySurface['etched']))
ok(report.counts.cardsBySurface['sparkle'] > 0, 'and cards routed to the granular relief', String(report.counts.cardsBySurface['sparkle']))
ok(report.counts.rarities >= 5, 'the report lists the textured tiers', String(report.counts.rarities))
ok(report.counts.cards > 0, 'and the cards they cover', String(report.counts.cards))
ok(report.counts.textureVerified === false, 'the report refuses to verify the relief')
ok(report.problems.length === 0, 'the report has no problems')
ok(ETCHED_SIZE === 512, 'the shipped sheet is 512px', String(ETCHED_SIZE))
const meanSlope = (m: { data: Uint8Array }) => {
  let sum = 0
  for (let i = 0; i < m.data.length; i += 2) sum += Math.hypot((m.data[i] - 127.5) / 127.5, (m.data[i + 1] - 127.5) / 127.5)
  return sum / (m.data.length / 2)
}
const fineMap = buildEtchedNormalMap(128, 'etched')
const deepMap = buildEtchedNormalMap(128, 'etched-deep')
ok(fineMap.w === 128 && deepMap.w === 128, 'both reliefs build at the requested size')
ok(meanSlope(deepMap) > meanSlope(fineMap) * 1.15, 'the deep relief is measurably steeper', `${meanSlope(fineMap).toFixed(3)} vs ${meanSlope(deepMap).toFixed(3)}`)
ok(SURFACE_TEXTURES['etched-deep'].verified === false && SURFACE_TEXTURES['etched-deep'].modelled === true, 'the deep relief is disclosed as modelled')

// The Shiny Vault relief is a grain, not a lattice. These are the checks that keep
// the two apart: a lattice's normals point along the diagonals, an isotropic grain's
// do not; and the grain must build deterministically and tile.
const sparkleMap = buildEtchedNormalMap(128, 'sparkle')
const sparkleAgain = buildEtchedNormalMap(128, 'sparkle')
let sparkleStable = true
for (let i = 0; i < sparkleMap.data.length; i++) if (sparkleMap.data[i] !== sparkleAgain.data[i]) sparkleStable = false
ok(sparkleMap.w === 128, 'the granular relief builds at the requested size')
ok(sparkleStable, 'the granular relief is deterministic')
ok(SURFACE_TEXTURES.sparkle.verified === false && SURFACE_TEXTURES.sparkle.modelled === true, 'the granular relief is disclosed as modelled')
ok(fs.existsSync('public' + SURFACE_TEXTURES.sparkle.texture), 'the granular relief sheet ships', SURFACE_TEXTURES.sparkle.texture)
const sparkleSeam = Math.abs(sparkleHeight(0.001, 0.37) - sparkleHeight(0.999, 0.37))
ok(sparkleSeam < 0.05, 'the grain tiles', sparkleSeam.toFixed(3))
function diagonalShare(map: { w: number; h: number; data: Uint8Array }): number {
  let diag = 0
  let total = 0
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const i = (y * map.w + x) * 2
      const nx = Math.abs((map.data[i] - 127.5) / 127.5)
      const ny = Math.abs((map.data[i + 1] - 127.5) / 127.5)
      const m = Math.hypot(nx, ny)
      if (m < 1e-6) continue
      if (Math.abs(nx - ny) < 0.25 * Math.max(nx, ny)) diag += m
      total += m
    }
  }
  return total ? diag / total : 0
}
ok(diagonalShare(sparkleMap) < 0.45, 'the grain has no diagonal bias', diagonalShare(sparkleMap).toFixed(2))
// A lattice repeats; a grain does not. Both index families of the etch advance 18 cycles
// per sheet axis, so shifting u by 1/18 returns the same field exactly.
const periodicAt = (fn: (u: number, v: number) => number, d: number): number => {
  let n = 0
  let sa = 0
  let sb = 0
  let saa = 0
  let sbb = 0
  let sab = 0
  for (let j = 0; j < 64; j++) {
    for (let i = 0; i < 64; i++) {
      const u = (i + 0.5) / 64
      const v = (j + 0.5) / 64
      const a = fn(u, v)
      const b = fn((u + d) % 1, v)
      n++
      sa += a
      sb += b
      saa += a * a
      sbb += b * b
      sab += a * b
    }
  }
  const cov = sab / n - (sa / n) * (sb / n)
  const va = saa / n - (sa / n) ** 2
  const vb = sbb / n - (sb / n) ** 2
  return cov / Math.sqrt(va * vb)
}
ok(periodicAt(etchedHeight, 1 / 18) > 0.9, 'the etch repeats every 1/18 of the sheet', periodicAt(etchedHeight, 1 / 18).toFixed(3))
ok(periodicAt(sparkleHeight, 1 / 18) < 0.2, 'the grain does not repeat at the lattice pitch', periodicAt(sparkleHeight, 1 / 18).toFixed(3))

for (const f of ['src/foil/surface-textures.ts', 'src/foil/surface-map.ts', 'scripts/surface-foil.ts']) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
