// Phase 24: the textured paper — an embossed relief, not a mark sheet.
//
// The checks are split the way the claims are:
//   - the PRINTING is documented: three BW promos resolve to textured-full-art at
//     the explicit level, invent no reverse printing, and reach a relief by their
//     PRINTING rather than by a rarity label they do not carry;
//   - the RELIEF is a drawing: deterministic, non-flat, deeper than the fine one,
//     and disclosed as modelled;
//   - the RENDER still obeys the layer contract: at rest it is the scan byte for
//     byte, at tilt it shades only inside the foil mask, with one equal delta for
//     R, G and B, never touching alpha, and it redistributes light rather than
//     brightening the card.
//
// Run: ./node_modules/.bin/tsx tmp/check-textured.ts

import fs from 'node:fs'
import { composeFrame, type FoilFrameSpec } from '../src/foil/engine'
import { foilMaskFor, maskValue } from '../src/foil/mask'
import { PATTERNS } from '../src/foil/patterns'
import { printingFor } from '../src/foil/printing-db'
import { PROMO_BUCKET_CLAIMS } from '../src/foil/promo-buckets-db'
import { FACE_ON } from '../src/foil/reflection'
import {
  SURFACE_TEXTURES,
  TEXTURED_SURFACE_VERIFIED,
  buildEtchedNormalMap,
  surfaceFor,
} from '../src/foil/surface-textures'
import { loadMarkFieldFor } from '../src/foil/mark-field'
import { holoFor } from '../src/holo'

let total = 0
let fails = 0
function ok(cond: boolean, label: string, detail?: string): void {
  total++
  if (!cond) {
    fails++
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('Textured — paper, relief, render')

// ---------------------------------------------------------------------------
// 1. The printing.
// ---------------------------------------------------------------------------

const TEXTURED = PROMO_BUCKET_CLAIMS.filter((c) => c.treatment === 'textured')
ok(TEXTURED.length === 3, 'the bucket table files three textured BW promos', String(TEXTURED.length))

for (const claim of TEXTURED) {
  const p = printingFor({ cardId: claim.cardId, rarity: 'Promo' })
  ok(p?.pattern === 'textured-full-art', `${claim.cardId}: resolves to the textured paper`, p?.pattern ?? 'nothing')
  ok(p?.status === 'verified', `${claim.cardId}: the identification is verified`, p?.status)
  ok(p?.matchedRule === 'explicit', `${claim.cardId}: answered by the card’s own row`, p?.matchedRule)
  ok(p?.mask === 'full-art', `${claim.cardId}: foils the full-art field, not a standard window`, `${p?.mask}`)
  ok(foilMaskFor({ cardId: claim.cardId, rarity: 'Promo' })?.kind === 'fullArt', `${claim.cardId}: the mask kind is fullArt`, foilMaskFor({ cardId: claim.cardId, rarity: 'Promo' })?.kind)
  ok(p?.maskVerified === false, `${claim.cardId}: the foil area is not claimed`, String(p?.maskVerified))
  ok(
    holoFor({ cardId: claim.cardId, rarity: 'Promo' })?.pattern === 'textured-full-art',
    `${claim.cardId}: holoFor carries the paper`,
  )
  ok(
    !printingFor({ cardId: claim.cardId, rarity: 'Promo', variant: 'reverseHolofoil' }),
    `${claim.cardId}: invents no reverse printing`,
  )
  // The route that matters: a Promo rarity label reaches no etched tier, so the
  // relief has to come from the resolved printing.
  ok(
    surfaceFor({ cardId: claim.cardId, rarity: 'Promo' }) === 'etched-deep',
    `${claim.cardId}: wears the BW deep relief through its printing`,
  )
  ok(
    surfaceFor({ cardId: claim.cardId, rarity: 'Promo', pattern: 'textured-full-art' }) === 'etched-deep',
    `${claim.cardId}: and answers the same when handed the pattern`,
  )
}

ok(surfaceFor({ rarity: 'Common' }) === null, 'a smooth card stays smooth')
ok(surfaceFor({ rarity: 'Ultra Rare', variant: 'reverseHolofoil' }) === null, 'a reverse is never routed by this path')
ok(surfaceFor({ cardId: 'swsh1-1', rarity: 'Rare Ultra' }) === 'etched', 'a modern chase card keeps the fine relief')

// The paper is the one row whose texture is a relief, and it says so.
ok(PATTERNS['textured-full-art'].implemented === true, 'the registry reports the paper as painted')
ok(
  PATTERNS['textured-full-art'].texture === SURFACE_TEXTURES['etched-deep'].texture,
  'and points at the relief it ships',
  PATTERNS['textured-full-art'].texture,
)
ok(fs.existsSync('public' + PATTERNS['textured-full-art'].texture!), 'the relief file is shipped')

// The photographs: a separate report, because their inputs cannot be committed.
// The suite pins that the record says exactly what the pictures do and do not
// settle, so a future change cannot quietly promote the relief to verified.
type PhotoReport = {
  cardsPhotographed: string[]
  cardsWithoutAPhotograph: string[]
  verdict: {
    embossSettled: boolean
    statement: string
    settles: string
    doesNotSettle: string
    weaveVisible?: { seen: boolean; what: string }
    video?: { url?: string; resolvesPitch?: boolean; pitchAchromatic?: number }
    angledPitchAchromatic?: number
    smoothControlPitchAchromatic?: number
    tuning?: unknown
  }
}
let photos: PhotoReport | null = null
if (fs.existsSync('reports/textured-photos.json')) {
  photos = JSON.parse(fs.readFileSync('reports/textured-photos.json', 'utf8')) as PhotoReport
}
ok(photos !== null, 'the photograph measurement is recorded')
ok(photos?.verdict.embossSettled === false, 'and says the photographs do not resolve the emboss', String(photos?.verdict.embossSettled))
ok(
  photos?.verdict.embossSettled === false ? photos?.verdict.statement.toLowerCase().includes('do not resolve') === true : true,
  'the wording matches the verdict',
  photos?.verdict.statement,
)
ok(
  photos?.verdict.settles.includes('LAYOUT') === true,
  'and records the layout as the thing the photographs DO settle',
  photos?.verdict.settles,
)
ok(
  (photos?.cardsWithoutAPhotograph ?? []).includes('bw43') && (photos?.cardsWithoutAPhotograph ?? []).includes('bw74'),
  'BW43 and BW74 are recorded as having no photograph',
  (photos?.cardsWithoutAPhotograph ?? []).join(','),
)
ok(
  (photos?.cardsPhotographed ?? []).includes('bw73'),
  'BW73 is the card actually photographed',
  (photos?.cardsPhotographed ?? []).join(','),
)

// The Japanese listings settle the APPEARANCE and nothing more. Pin both halves: a
// later change may not quietly delete the weave, and may not promote it to a pitch.
ok(photos?.verdict.weaveVisible?.seen === true, 'the oblique listing photographs are recorded as showing the weave')
ok(
  (photos?.verdict.smoothControlPitchAchromatic ?? 0) >= (photos?.verdict.angledPitchAchromatic ?? 1),
  'and the pitch stays unattributed: the smooth control reads as strongly on the same band',
  `${photos?.verdict.angledPitchAchromatic} textured vs ${photos?.verdict.smoothControlPitchAchromatic} smooth`,
)
ok(photos?.verdict.tuning === null, 'no tuning is derived from the photographs', JSON.stringify(photos?.verdict.tuning))

// The video pass is recorded too, and it closed the same way: a source was found and
// measured, and it does not yield a pitch. Neither absence nor appearance alone may
// be promoted into a measurement.
ok(photos?.verdict.video?.url?.includes('youtube.com') === true, 'the video pass is recorded with its source')
ok(
  photos?.verdict.video?.resolvesPitch === false,
  'and records that the video frames do not resolve the emboss',
  String(photos?.verdict.video?.resolvesPitch),
)

// ---------------------------------------------------------------------------
// 2. The relief is a drawing, and says so.
// ---------------------------------------------------------------------------

ok(TEXTURED_SURFACE_VERIFIED === false, 'the relief is not claimed as verified')
ok(SURFACE_TEXTURES['etched-deep'].verified === false, 'the deep relief says it is unverified')
ok(SURFACE_TEXTURES['etched-deep'].modelled === true, 'and that it is modelled')
ok(
  SURFACE_TEXTURES['etched-deep'].strength > SURFACE_TEXTURES.etched.strength,
  'the BW relief is the deeper of the two',
  `${SURFACE_TEXTURES['etched-deep'].strength} vs ${SURFACE_TEXTURES.etched.strength}`,
)

const a = buildEtchedNormalMap(96, 'etched-deep')
const b = buildEtchedNormalMap(96, 'etched-deep')
let same = a.data.length === b.data.length
for (let i = 0; same && i < a.data.length; i++) if (a.data[i] !== b.data[i]) same = false
ok(same, 'the relief is deterministic')

let lo = 255
let hi = 0
for (let i = 0; i < a.data.length; i += 2) {
  lo = Math.min(lo, a.data[i])
  hi = Math.max(hi, a.data[i])
}
ok(hi - lo > 40, 'the relief is not flat', `${lo}..${hi}`)

// ---------------------------------------------------------------------------
// 3. The render obeys the layer contract.
// ---------------------------------------------------------------------------

const W = 200
const H = 279
const base = new Uint8ClampedArray(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    base[i] = 42 + Math.round((x / W) * 110)
    base[i + 1] = 58 + Math.round((y / H) * 90)
    base[i + 2] = 96
    base[i + 3] = 255
  }
}

const spec = foilMaskFor({ cardId: TEXTURED[0].cardId, rarity: 'Promo' })!
const frame = (deg: number): FoilFrameSpec => ({
  tilt: deg === 0 ? FACE_ON : { deg, axis: 45 },
  // The relief alone: no foil layer, so every delta measured below is embossing.
  layers: [
    {
      id: 'textured-relief',
      spec: null,
      surfaceSpec: spec,
      surface: { map: a, strength: SURFACE_TEXTURES['etched-deep'].strength },
    },
  ],
})

const rest = composeFrame(base, W, H, frame(0))
let restDiff = 0
for (let i = 0; i < base.length; i++) if (rest[i] !== base[i]) restDiff++
ok(restDiff === 0, 'at rest the card is the scan byte for byte', `${restDiff} bytes differ`)

const tilted = composeFrame(base, W, H, frame(55))
let changed = 0
let outside = 0
let hue = 0
let alpha = 0
let sum = 0
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const dr = tilted[i] - base[i]
    const dg = tilted[i + 1] - base[i + 1]
    const db = tilted[i + 2] - base[i + 2]
    if (tilted[i + 3] !== base[i + 3]) alpha++
    if (dr === 0 && dg === 0 && db === 0) continue
    changed++
    if (dr !== dg || dg !== db) hue++
    if (maskValue(spec, (x + 0.5) / W, (y + 0.5) / H, W / H) === 0) outside++
    sum += dr
  }
}

ok(changed > 0, 'the relief reads at tilt', `${changed} pixels`)
ok(outside === 0, 'and never shades outside the foil area', `${outside} pixels`)
ok(hue === 0, 'shading is neutral: one delta for R, G and B', `${hue} pixels off`)
ok(alpha === 0, 'alpha is never written')
const mean = changed ? sum / changed : 0
ok(Math.abs(mean) < 1.5, 'and it redistributes light rather than brightening the card', mean.toFixed(2))

// The press of this paper: NO marks. The mark layer must hand back nothing, so the
// pattern layer renders plain foil light and only the relief carries structure.
loadMarkFieldFor({ cardId: TEXTURED[0].cardId, rarity: 'Promo' }).then((field) => {
  ok(field === null, 'the mark layer hands no sheet: a textured card prints no marks', field?.id ?? 'null')
  console.log(fails ? `\n${fails}/${total} FAILED` : `\nALL OK — ${total} checks`)
  if (fails) process.exit(1)
})
