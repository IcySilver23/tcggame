// Phase 10 — modern special reverses (Poké Ball / Master Ball).
//
// Run: ./node_modules/.bin/tsx tmp/check-phase10.ts

import fs from 'node:fs'
import { holoFor } from '../src/holo'
import { foilMaskFor, maskValue } from '../src/foil/mask'
import { PATTERNS } from '../src/foil/patterns'
import {
  CARD_ASPECT,
  SPECIAL_REVERSE_SETS,
  isSpecialReversePattern,
  specialBallFor,
  specialReverseFieldFor,
  specialReverseFor,
} from '../src/foil/reverse-special'
import { decodePng } from './png'
import { SPECIAL_REVERSE_ASSETS, SPECIAL_REVERSE_SHOWCASE, SPECIAL_REVERSE_TEXTURE_VERIFIED } from '../src/foil/reverse-special-index'
import type { CosmosGrid } from '../src/foil/cosmos'
import { composeFrame } from '../src/foil/engine'
import { FACE_ON } from '../src/foil/reflection'
import { normalMapFromHeight } from '../src/foil/surface'
import type { MarkField } from '../src/foil/mark-field'
import {
  SPECIAL_REVERSE_ETCH_STRENGTH,
  SPECIAL_REVERSE_ETCH_SURFACE,
  specialReverseEtchFor,
  specialReverseEtchMaskFor,
} from '../src/foil/reverse-etch'

let fails = 0
let total = 0
function ok(cond: boolean, label: string, extra = ''): void {
  total++
  if (cond) return
  fails++
  console.log(`FAIL ${label}${extra ? ` — ${extra}` : ''}`)
}

console.log('Phase 10 — modern special reverses')

// --------------------------------------------------------------- variant tokens
ok(specialBallFor('reverseHolofoilPokeBall') === 'pokeball', 'a Poké Ball token names the ball')
ok(specialBallFor('reverseHolofoilMasterBall') === 'masterball', 'a Master Ball token names the ball')
ok(specialBallFor('reverseHolofoil') === null, 'an ordinary reverse names no ball')
ok(specialBallFor(null) === null, 'no variant names no ball')

ok(specialReverseFor('sv8pt5', 'reverseHolofoilPokeBall')?.pattern === 'reverse-pokeball-large',
  'Prismatic Evolutions uses the large Poké Ball layout')
ok(specialReverseFor('sv8pt5', 'reverseHolofoilMasterBall')?.pattern === 'reverse-masterball-large',
  'Prismatic Evolutions uses the large Master Ball layout')
ok(specialReverseFor('zsv10pt5', 'reverseHolofoilPokeBall')?.layout === 'rows', 'Black Bolt uses rows')
ok(specialReverseFor('rsv10pt5', 'reverseHolofoilMasterBall')?.layout === 'rows', 'White Flare uses rows')
ok(specialReverseFor('me2pt5', 'reverseHolofoilPokeBall')?.layout === 'large', 'Ascended Heroes uses one large ball')
ok(specialReverseFor('me2pt5', 'reverseHolofoilMasterBall') === null, 'Ascended Heroes makes no Master Ball claim')
ok(specialReverseFor('sv6pt5', 'reverseHolofoilPokeBall') === null, 'a set without the printing makes no claim')
ok(SPECIAL_REVERSE_SETS.every((s) => s.mask === 'outside-art' && s.status === 'verified'), 'every printing is frame foil, verified')

// ---------------------------------------------------------------- holo routing
const special = holoFor({ cardId: 'sv8pt5-1', rarity: 'Common', variant: 'reverseHolofoilPokeBall' })
ok(!!special && special.reverse && special.pattern === 'reverse-pokeball-large', 'the overlay routes the special variant to its paper')
const master = holoFor({ cardId: 'sv8pt5-1', rarity: 'Common', variant: 'reverseHolofoilMasterBall' })
ok(!!master && master.pattern === 'reverse-masterball-large', 'the Master Ball variant routes separately')
const normal = holoFor({ cardId: 'sv8pt5-1', rarity: 'Common', variant: 'reverseHolofoil' })
ok(!!normal && normal.pattern === 'reverse-tile-intricate', 'a normal reverse keeps the set paper')
const ex = holoFor({ cardId: 'sv8pt5-1', rarity: 'Double Rare', variant: 'reverseHolofoilPokeBall' })
ok(ex === null, 'a Pokémon ex cannot take the Poké Ball reverse')

// ------------------------------------------------------------------- coverage
const spec = foilMaskFor({ cardId: 'sv8pt5-1', rarity: 'Common', variant: 'reverseHolofoilPokeBall' })
ok(!!spec && spec.kind === 'outsideArt', 'the special reverse foils everything but the art')
if (spec) {
  const insideArt = maskValue(spec, 0.5, 0.33)
  const outsideArt = maskValue(spec, 0.5, 0.86)
  ok(insideArt === 0, 'the illustration window stays matte')
  ok(outsideArt === 255, 'the text box carries the foil')
}

// --------------------------------------------------------------------- etch
ok(specialReverseEtchFor('sv8pt5', 'reverseHolofoilPokeBall'), 'the large Poké Ball has a full-card etch')
ok(specialReverseEtchFor('sv8pt5', 'reverseHolofoilMasterBall'), 'the large Master Ball has a full-card etch')
ok(!specialReverseEtchFor('sv8pt5', 'reverseHolofoil'), 'an ordinary reverse has no ball etch')
ok(!specialReverseEtchFor('sv6pt5', 'reverseHolofoilPokeBall'), 'a set without the ball printing gets no etch')
const etchSpec = specialReverseEtchMaskFor('sv8pt5-1')
ok(etchSpec.kind === 'full' && etchSpec.verified, 'the etch mask is the full card and records its area', etchSpec.kind)
ok(maskValue(etchSpec, 0.5, 0.33) === 255, 'the etch is allowed inside the artwork')
ok(maskValue(etchSpec, 0.5, 0.86) === 255, 'and over the text box')
ok(SPECIAL_REVERSE_ETCH_SURFACE === 'etched', 'the etch reuses the fine modern lattice')
ok(SPECIAL_REVERSE_ETCH_STRENGTH > 0 && SPECIAL_REVERSE_ETCH_STRENGTH < 0.6, 'the etch relief is deliberately light', String(SPECIAL_REVERSE_ETCH_STRENGTH))

// ------------------------------------------------------- etch vs ball coverage
{
  const W = 120
  const H = 167
  const aspect = W / H
  const base = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      base[i] = 80 + ((x * 7) % 40)
      base[i + 1] = 90 + ((y * 5) % 30)
      base[i + 2] = 100
      base[i + 3] = 255
    }
  }
  const plain: MarkField = {
    id: 'test', label: 'plain', mark: () => 1, opacity: () => 1, coverage: 1, peak: 1,
    verified: false, plain: true, note: 'uniform', meta: {},
  }
  const bump = normalMapFromHeight(48, 48, (u, v) => 0.5 + 0.25 * Math.cos(u * Math.PI * 2) * Math.cos(v * Math.PI * 2), 8)
  const tilt = { deg: 55, axis: Math.PI / 4 }
  const foilOnly = composeFrame(base, W, H, {
    tilt, layers: [{ id: 'foil', spec, field: plain }],
  })
  const etched = composeFrame(base, W, H, {
    tilt, layers: [{ id: 'printing', spec, field: plain, surface: { map: bump, strength: 0.6 }, surfaceSpec: etchSpec }],
  })
  const rest = composeFrame(base, W, H, {
    tilt: FACE_ON,
    layers: [{ id: 'printing', spec, field: plain, surface: { map: bump, strength: 0.6 }, surfaceSpec: etchSpec }],
  })
  let sameAtRest = true
  for (let i = 0; i < base.length; i++) if (rest[i] !== base[i]) { sameAtRest = false; break }
  ok(sameAtRest, 'the ball reverse at rest is still the scan, byte for byte')
  let foilInside = 0
  let etchInside = 0
  let etchOutside = 0
  let hue = true
  let alpha = true
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W
      const v = (y + 0.5) / H
      const insideArt = maskValue({ ...spec, kind: 'art' }, u, v, aspect) === 255
      const i = (y * W + x) * 4
      const foilChanged = foilOnly[i] !== base[i] || foilOnly[i + 1] !== base[i + 1] || foilOnly[i + 2] !== base[i + 2]
      const dr = etched[i] - foilOnly[i]
      const dg = etched[i + 1] - foilOnly[i + 1]
      const db = etched[i + 2] - foilOnly[i + 2]
      if (insideArt && foilChanged) foilInside++
      if (insideArt && (dr !== 0 || dg !== 0 || db !== 0)) etchInside++
      if (!insideArt && (dr !== 0 || dg !== 0 || db !== 0)) etchOutside++
      if ((dr !== 0 || dg !== 0 || db !== 0) && (dr !== dg || dg !== db)) hue = false
      if (etched[i + 3] !== foilOnly[i + 3]) alpha = false
    }
  }
  ok(foilInside === 0, 'no ball foil changes the artwork', String(foilInside))
  ok(etchInside > 0, 'the etch does shade the artwork', String(etchInside))
  ok(etchOutside > 0, 'and still shades the frame and text box', String(etchOutside))
  ok(hue, 'the etch writes one equal delta, so it cannot tint the art')
  ok(alpha, 'the etch never writes alpha')
}

// --------------------------------------------------------------------- assets
const ids = Object.keys(SPECIAL_REVERSE_ASSETS)
ok(ids.length === 10, 'ten papers ship: two balls in two layouts plus Ascended Heroes\' six assigned papers', String(ids.length))
for (const id of ids) {
  const a = SPECIAL_REVERSE_ASSETS[id as keyof typeof SPECIAL_REVERSE_ASSETS]!
  ok(fs.existsSync('public' + a.texture), `${id} texture ships`, a.texture)
  ok(a.approximation === true, `${id} is disclosed as a drawing`)
  ok(a.evidence?.url.startsWith('https://'), `${id} cites a reference`, a.evidence?.url)
  ok(a.evidence?.kind === 'photograph' || a.evidence?.kind === 'render', `${id} names its reference kind`)
  ok(a.coverage > 0.02 && a.coverage < 0.6, `${id} coverage is plausible`, String(a.coverage))
  ok(a.peak > 0.6, `${id} has visible ink`, String(a.peak))
  if (a.layout === 'rows') ok(a.seam < 2.5, `${id} tiles (wrap step vs interior step)`, String(a.seam))
  ok(!!PATTERNS[a.id] && PATTERNS[a.id].implemented, `${id} is an implemented pattern row`)
  ok(isSpecialReversePattern(a.id), `${id} is recognised as a special reverse`)
}
ok(!isSpecialReversePattern('reverse-tile-intricate'), 'ordinary reverse papers are not special')
ok(SPECIAL_REVERSE_TEXTURE_VERIFIED === false, 'the drawn texture stays unverified after review')
const masterPhoto = SPECIAL_REVERSE_ASSETS['reverse-masterball-large']!
ok(masterPhoto.evidence.kind === 'photograph', 'the large Master Ball cites the real-card photograph')
const pokePhoto = SPECIAL_REVERSE_ASSETS['reverse-pokeball-large']!
ok(pokePhoto.evidence.kind === 'photograph', 'the large Poké Ball cites a real Sylveon photograph')
ok(pokePhoto.evidence.url.includes('ebayimg'), 'the Poké Ball evidence points at the real listing image')
ok(Math.abs(pokePhoto.centerV - 0.675) < 0.005, 'the large Poké Ball sheet is centred for the measured placement', String(pokePhoto.centerV))
ok(/0\.52/.test(pokePhoto.evidence.confirms) && /0\.675/.test(pokePhoto.evidence.confirms), 'the evidence records the measured size and centre')
const rowAssets = [SPECIAL_REVERSE_ASSETS['reverse-pokeball-rows']!, SPECIAL_REVERSE_ASSETS['reverse-masterball-rows']!]
ok(rowAssets.every((a) => /large and small/i.test(a.evidence.confirms)), 'both row assets record the alternating ball sizes')
ok(rowAssets.every((a) => /glyph, facet spacing and exact row registration/i.test(a.evidence.limits)), 'and limit the claim to the measured lattice, not the drawing')
ok(rowAssets[0].evidence.url.includes('Black-Bolt-Poke-Ball'), 'the Poké Ball rows cite the Black Bolt image directly')
ok(rowAssets[1].evidence.url.includes('White-Flare-Master-Ball'), 'the Master Ball rows cite the White Flare image directly')
ok(rowAssets.every((a) => a.rows?.columns === 5 && a.rows?.rows === 5), 'both row sheets use five columns and five rows')
ok(rowAssets.every((a) => Math.abs((a.rows?.largeBallWidth ?? 0) - 0.1672) < 0.005), 'the large ball is recorded at about 0.167 of card width')
ok(rowAssets.every((a) => Math.abs((a.rows?.smallBallWidth ?? 0) - 0.0955) < 0.005), 'the small ball is recorded at about 0.096 of card width')
ok(rowAssets.every((a) => a.rows?.measured.cardWidthPx === 335 && a.rows?.measured.largeBallPx === 56 && a.rows?.measured.smallBallPx === 32), 'the report records the measured reference pixels')
ok(rowAssets.every((a) => a.rows?.measured.columnPitchPx === 67.5 && a.rows?.measured.rowPitchPx === 69), 'the report records the measured row and column pitch')

// The finished PNGs, not just the metadata: locate each planted ball and measure
// its horizontal ink span. The band through a ball's centre runs to the ring, so a
// larger stamp measures a longer span. Facets are below the threshold.
function inkSpan(png: ReturnType<typeof decodePng>, cx: number, cy: number): number {
  let best = 0
  for (let dy = -5; dy <= 5; dy++) {
    const y = ((Math.floor(cy + dy) % png.h) + png.h) % png.h
    let run = 0
    let gap = 0
    let started = false
    for (let dx = 0; dx <= 55; dx++) {
      const x = ((Math.floor(cx + dx) % png.w) + png.w) % png.w
      const ink = png.px[(y * png.w + x) * 4 + 3] >= 112
      if (ink) {
        started = true
        run = dx
        gap = 0
      } else if (started) {
        gap++
        if (gap >= 2) break
      }
    }
    best = Math.max(best, run)
  }
  return best
}

for (const a of rowAssets) {
  const png = decodePng('public' + a.texture)
  const spans: number[] = []
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const cx = ((col + 0.5 + (row % 2 ? 0.5 : 0)) / 5) * png.w
      const cy = ((row + 0.5) / 5) * png.h
      spans.push(inkSpan(png, cx, cy))
    }
  }
  const large = spans.filter((_, i) => ((i % 5) + Math.floor(i / 5)) % 2 === 0)
  const small = spans.filter((_, i) => ((i % 5) + Math.floor(i / 5)) % 2 === 1)
  const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length
  const largeMean = mean(large)
  const smallMean = mean(small)
  ok(large.length === 13 && small.length === 12, `${a.id} lands 13 large and 12 small balls`, `${large.length}/${small.length}`)
  ok(largeMean > smallMean * 1.25, `${a.id} visibly alternates large and small balls`, `${largeMean.toFixed(1)} vs ${smallMean.toFixed(1)}`)
  ok(largeMean > 38 && smallMean > 22, `${a.id} draws both sizes at readable scale`, `${largeMean.toFixed(1)} / ${smallMean.toFixed(1)}`)
}

// --------------------------------------------------------------------- sampling
const size = 64
function gridWith(fn: (u: number, v: number) => number): CosmosGrid {
  const mark = new Float32Array(size * size)
  const opacity = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = fn((x + 0.5) / size, (y + 0.5) / size)
      mark[y * size + x] = v
      opacity[y * size + x] = v
    }
  }
  return { size, mark, opacity, coverage: 0.2, peak: 1 } as unknown as CosmosGrid
}

const blob = gridWith((u, v) => (Math.hypot(u - 0.5, v - 0.675) < 0.25 ? 0.9 : 0.05))
const largeAsset = SPECIAL_REVERSE_ASSETS['reverse-pokeball-large']!
const largeField = specialReverseFieldFor('sv8pt5-1', largeAsset, blob)
ok(largeField.mark(0.5, 0.675) > 0.5, 'the large ball lands behind the attack text', String(largeField.mark(0.5, 0.675).toFixed(2)))
ok(largeField.mark(0.08, 0.08) < 0.5, 'the card corner is bare foil', String(largeField.mark(0.08, 0.08).toFixed(2)))
ok(largeField.mark(0.5, 0.675) === largeField.mark(0.5, 0.675), 'the large layout is stable frame to frame')

const gradient = gridWith((u) => u)
const rowsAsset = SPECIAL_REVERSE_ASSETS['reverse-pokeball-rows']!
const rowsField = specialReverseFieldFor('zsv10pt5-1', rowsAsset, gradient)
ok(Math.abs(rowsField.mark(0.1, 0.1) - rowsField.mark(0.6, 0.7)) > 0.05, 'the rows layout varies across the card')
ok(rowsField.meta.layout === 'rows', 'the field reports its layout')
ok(Math.abs(Number(rowsField.meta.verticalScale) - 1 / CARD_ASPECT) < 0.001, 'the rows sampler corrects for the card aspect', String(rowsField.meta.verticalScale))
ok(rowsField.meta.columns === 5 && rowsField.meta.rows === 5, 'the field reports the five-by-five alternation')
ok(Math.abs(Number(rowsField.meta.largeBallWidth) - 0.1672) < 0.005, 'the field reports the large-ball width')
ok(Math.abs(Number(rowsField.meta.smallBallWidth) - 0.0955) < 0.005, 'the field reports the small-ball width')
ok(rowsField.meta.columnPitchPx === 67.5 && rowsField.meta.rowPitchPx === 69, 'the field carries the measured pitch')

// ---------------------------------------------------------------------- report
const report = JSON.parse(fs.readFileSync('reports/special-reverse-printings.json', 'utf8')) as {
  counts: { sets: number; printings: number; eligibleCards: number; publishedCountsMatched: { matched: number; checked: number }; assets: number; photographicReferences: number; renderReferences: number; rowPattern: { columns: number; rows: number; largeBallWidth: number; smallBallWidth: number; aspectCorrected: boolean; measured: { cardWidthPx: number; largeBallPx: number; smallBallPx: number; columnPitchPx: number; rowPitchPx: number } } | null; etch: { surface: string; strength: number; mask: string; foilInsideArt: boolean; reliefVerified: boolean } }
  problems: string[]
  rows: { setId: string; ball: string; eligible: number; published: number | null; delta: number | null }[]
  references: { id: string; kind: string; url: string }[]
  honesty: string[]
}
ok(report.counts.sets === 4, 'the report covers four sets', String(report.counts.sets))
ok(report.counts.printings === 12, 'and twelve set/stamp printings', String(report.counts.printings))
ok(report.counts.assets === 10, 'and ten assets', String(report.counts.assets))
ok(report.counts.photographicReferences === 8, 'eight papers cite a real photograph: the two Prismatic ones and the six Ascended', String(report.counts.photographicReferences))
ok(report.counts.renderReferences === 2, 'the two row papers are the only render-only references left', String(report.counts.renderReferences))
ok(report.counts.rowPattern?.columns === 5 && report.counts.rowPattern?.rows === 5, 'the report records the five-by-five row grid', JSON.stringify(report.counts.rowPattern))
ok(Math.abs((report.counts.rowPattern?.largeBallWidth ?? 0) - 0.1672) < 0.005 && Math.abs((report.counts.rowPattern?.smallBallWidth ?? 0) - 0.0955) < 0.005, 'the report records both measured ball widths')
ok(report.counts.rowPattern?.aspectCorrected === true, 'the report records the aspect-corrected sampling')
ok(report.counts.rowPattern?.measured.cardWidthPx === 335 && report.counts.rowPattern?.measured.largeBallPx === 56 && report.counts.rowPattern?.measured.smallBallPx === 32, 'the report keeps the measured reference pixels')
ok(report.counts.rowPattern?.measured.columnPitchPx === 67.5 && report.counts.rowPattern?.measured.rowPitchPx === 69, 'the report keeps the measured pitch')
ok(report.counts.etch.surface === 'etched' && report.counts.etch.strength === 0.32, 'the report records the fine full-card etch')
ok(report.counts.etch.mask.includes('full card') && report.counts.etch.foilInsideArt === false, 'the etch covers the card while the ball stays out of the art')
ok(report.counts.etch.reliefVerified === false, 'the etch relief is disclosed as modelled')
ok(report.references.length === 10 && report.references.every((r) => r.url.startsWith('https://')), 'every asset carries a reference link')
ok(report.references.some((r) => r.id === 'reverse-masterball-large' && r.kind === 'photograph'), 'the report names the photographed Master Ball')
ok(report.references.some((r) => r.id === 'reverse-pokeball-large' && r.kind === 'photograph'), 'the report names the photographed Poké Ball')
ok(report.counts.eligibleCards > 0, 'with eligible cards counted')
ok(report.counts.publishedCountsMatched.checked === 8 && report.counts.publishedCountsMatched.matched === 8,
  'the rules reproduce both published Prismatic counts and all six Ascended Heroes papers', JSON.stringify(report.counts.publishedCountsMatched))
ok(report.counts.assignedStamps?.every((s) => s.counted === s.printed),
  'the Ascended Heroes assignment counts match its published breakdown', JSON.stringify(report.counts.assignedStamps))
ok(report.rows.every((r) => r.delta === null || r.delta === 0), 'no rule count disagrees with a published count')
ok(report.honesty.some((h) => h.includes('procedural')), 'the report says the artwork is drawn')
ok(report.honesty.some((h) => h.includes('full-card relief')), 'the report says the etch is a separate full-card relief')
ok(report.honesty.some((h) => h.includes('0.52') && h.includes('0.675')), 'the report records the measured ball size and placement')
ok(report.honesty.some((h) => h.includes('five columns') && h.includes('56px') && h.includes('32px')), 'the report records the measured row lattice')
ok(report.honesty.some((h) => h.includes('inventory')), 'the report says the game has no variant row yet')
ok(report.problems.length === 0, 'the report has no problems', report.problems.join('; '))

// ------------------------------------------------------------------- showcase
ok(SPECIAL_REVERSE_SHOWCASE.length >= 4, 'the inspector has special reverse cards', String(SPECIAL_REVERSE_SHOWCASE.length))
for (const c of SPECIAL_REVERSE_SHOWCASE) {
  const ball = specialBallFor(c.variant)
  ok(ball !== null, `${c.cardId} ${c.variant} parses`)
  ok(!!specialReverseFor(c.setId, c.variant), `${c.cardId} ${c.variant} resolves to a printing`)
}

for (const f of ['src/foil/reverse-special.ts', 'scripts/reverse-special-foil.ts', 'scripts/special-reverse-report.ts']) {
  ok(!/Math\.random\s*\(/.test(fs.readFileSync(f, 'utf8')), `${f} has no unseeded randomness`)
}

console.log(fails === 0 ? `ALL OK — ${total} checks` : `${fails}/${total} FAILED`)
if (fails) process.exitCode = 1
