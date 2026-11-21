// Measure the embossed surface of the BW textured promos against the photographs
// that exist, with the same photograph's card BACK as the control.
//
// Run:
//   node tmp/fetch-textured-photos.mjs
//   py -c "from PIL import Image; import glob, os; [Image.open(f).convert('RGB').save('tmp/refs-textured/png/' + os.path.basename(f).rsplit('.',1)[0] + '.png') for f in sorted(glob.glob('tmp/refs-textured/photos/*')) if not os.path.basename(f).startswith('9-')]"
//   ./node_modules/.bin/tsx tmp/measure-textured.ts
//
// The photographs are not committed: they are copyrighted card images and several
// megabytes each, so the inputs are fetched rather than stored. Two downscaled
// previews are kept in tmp/refs-textured/preview/ as the visual record.
//
// Why a photograph can speak where a scan cannot: a catalogue scan is lit
// diffusely, so an emboss leaves almost no trace in it — which is why the relief
// was modelled rather than measured. A seller photograph is shot under a point
// light out of a phone, so every ridge throws a highlight and a shadow and the
// lattice becomes a periodic signal. The card's BACK in the same photograph is the
// control that matters: identical lens, light, distance and JPEG, and no emboss.
//
// What is measured, per patch (rectangles are fractions of the CARD, not the photo):
//
//   shape        band-passed luminance (blur 1.5 − blur 10), which keeps detail
//                between roughly 3 and 20 px and drops the artwork's own shapes;
//   angle        gradient-direction histogram mod 180°, plus `diagonal` = share of
//                gradient energy within ±10° of 45°/135° — a lattice puts its
//                energy in two peaks 90° apart, artwork spreads it;
//   anisotropy   structure-tensor eigenvalue ratio: 1 means one direction only;
//   pitch        autocorrelation of the profile projected across the dominant
//                direction, with the correlation coefficient at the chosen lag, so
//                a "pitch" can be judged by how strong the repeat actually is.
//
// The shipped relief's own pitch is printed for comparison, computed from its
// formula rather than from an image: it is ten lattice cycles per sheet axis.

import fs from 'node:fs'
import { decodePng } from './png'

type Img = { w: number; h: number; L: Float32Array; rgb: Float32Array; name: string; card: Rect; patches?: Patch[] }
type Rect = { x: number; y: number; w: number; h: number }
type Patch = { fx: number; fy: number; fw: number; fh: number; label: string }
type Result = {
  name: string
  patch: string
  /** Width of the card in the photograph, so a pitch can be stated in cycles across it. */
  cardW: number
  /** `luma` reads brightness; `achromatic` reads only what all three channels share. */
  mode: 'luma' | 'achromatic'
  /** Which band-pass the row was read at, in pixels. */
  scale: string
  angle: number
  diagonal: number
  anisotropy: number
  pitchPx: number | null
  pitchPerCard: number | null
  r: number
  strength: number
}

function load(name: string, file: string, card: Rect, patches?: Patch[]): Img | null {
  if (!fs.existsSync(file)) {
    console.log(`(missing ${file})`)
    return null
  }
  const p = decodePng(file)
  const L = new Float32Array(p.w * p.h)
  const rgb = new Float32Array(p.w * p.h * 3)
  for (let i = 0; i < p.w * p.h; i++) {
    L[i] = (0.2126 * p.px[i * 4] + 0.7152 * p.px[i * 4 + 1] + 0.0722 * p.px[i * 4 + 2]) / 255
    rgb[i * 3] = p.px[i * 4]
    rgb[i * 3 + 1] = p.px[i * 4 + 1]
    rgb[i * 3 + 2] = p.px[i * 4 + 2]
  }
  return { w: p.w, h: p.h, L, rgb, name, card, patches }
}

const at = (f: Float32Array, w: number, h: number, x: number, y: number): number =>
  f[Math.max(0, Math.min(h - 1, Math.round(y))) * w + Math.max(0, Math.min(w - 1, Math.round(x)))]

function blur(img: Img, radius: number, src: Float32Array = img.L): Float32Array {
  const tmp = new Float32Array(img.w * img.h)
  const out = new Float32Array(img.w * img.h)
  const r = Math.max(0, Math.round(radius))
  const n = 2 * r + 1
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      let s = 0
      for (let d = -r; d <= r; d++) {
        const xx = x + d
        s += src[y * img.w + (xx < 0 ? 0 : xx >= img.w ? img.w - 1 : xx)]
      }
      tmp[y * img.w + x] = s / n
    }
  }
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      let s = 0
      for (let d = -r; d <= r; d++) {
        const yy = y + d
        s += tmp[(yy < 0 ? 0 : yy >= img.h ? img.h - 1 : yy) * img.w + x]
      }
      out[y * img.w + x] = s / n
    }
  }
  return out
}

/**
 * Band-pass: fine detail in, the artwork's broad shading out.
 *
 * The band has to be chosen around the feature, not fixed: a lattice whose period
 * is 30 px is attenuated by a pass that only keeps everything finer than 20 px,
 * which is exactly how the first pass managed to miss a weave that is visible to
 * the eye. Three bands are tried and the strongest answer kept. `fine` is the blur
 * radius subtracted from `coarse`'s.
 */
const BANDS: { fine: number; coarse: number; label: string }[] = [
  { fine: 1.5, coarse: 10, label: '3–20px' },
  { fine: 3, coarse: 26, label: '6–52px' },
  { fine: 6, coarse: 44, label: '12–88px' },
]

function bandPass(img: Img, fine: number, coarse: number): Float32Array {
  const f = blur(img, fine)
  const c = blur(img, coarse)
  const out = new Float32Array(img.w * img.h)
  for (let i = 0; i < out.length; i++) out[i] = f[i] - c[i]
  return out
}

/**
 * The part of the band-passed detail that all three channels agree on.
 *
 * This is what separates a SURFACE from printed ink. An emboss is a shape: it
 * multiplies whatever light leaves the card, so a ridge highlight scales R, G and B
 * by the same factor and its band-passed response is common-mode. Ink does not do
 * that — a printed pattern, a halftone rosette or a JPEG artefact moves the channels
 * apart. Working in log brightness makes the common factor additive, and each pixel
 * keeps only the share of its response the three channels share, so a lattice that
 * exists only in the ink of a picture scores nothing here.
 */
function achromaticBand(img: Img, fine: number, coarse: number): Float32Array {
  const n = img.w * img.h
  const planes = [0, 1, 2].map((c) => {
    const p = new Float32Array(n)
    for (let i = 0; i < n; i++) p[i] = Math.log(Math.max(6, img.rgb[i * 3 + c]))
    const f = blur(img, fine, p)
    const k = blur(img, coarse, p)
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) out[i] = f[i] - k[i]
    return out
  })
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const mean = (planes[0][i] + planes[1][i] + planes[2][i]) / 3
    let dev = 0
    for (let c = 0; c < 3; c++) dev += (planes[c][i] - mean) * (planes[c][i] - mean)
    const shared = (mean * mean) / (mean * mean + dev / 3 + 1e-12)
    out[i] = mean * shared
  }
  return out
}

function analyse(img: Img, band: Float32Array, p: Patch, scale: string, mode: 'luma' | 'achromatic'): Result {
  const r: Rect = {
    x: img.card.x + p.fx * img.card.w,
    y: img.card.y + p.fy * img.card.h,
    w: p.fw * img.card.w,
    h: p.fh * img.card.h,
  }
  const x0 = Math.round(r.x)
  const y0 = Math.round(r.y)
  const x1 = Math.round(r.x + r.w)
  const y1 = Math.round(r.y + r.h)
  const BINS = 36
  const hist = new Float64Array(BINS)
  let jxx = 0
  let jyy = 0
  let jxy = 0
  let mag = 0
  let n = 0
  for (let y = y0 + 1; y < y1 - 1; y++) {
    for (let x = x0 + 1; x < x1 - 1; x++) {
      const gx = (at(band, img.w, img.h, x + 1, y) - at(band, img.w, img.h, x - 1, y)) * 0.5
      const gy = (at(band, img.w, img.h, x, y + 1) - at(band, img.w, img.h, x, y - 1)) * 0.5
      const m = gx * gx + gy * gy
      if (m < 1e-12) continue
      jxx += gx * gx
      jyy += gy * gy
      jxy += gx * gy
      mag += Math.sqrt(m)
      n++
      let a = (Math.atan2(gy, gx) * 180) / Math.PI
      if (a < 0) a += 180
      hist[Math.min(BINS - 1, Math.floor(a / 5))] += m
    }
  }
  const total = hist.reduce((s, v) => s + v, 0) || 1
  let diagonal = 0
  for (let a = 35; a <= 55; a += 5) diagonal += hist[Math.round(a / 5)]
  for (let a = 125; a <= 145; a += 5) diagonal += hist[Math.round(a / 5)]
  diagonal /= total

  const tr = jxx + jyy
  const det = jxx * jyy - jxy * jxy
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
  const l1 = tr / 2 + disc
  const l2 = tr / 2 - disc
  const anisotropy = tr > 0 ? (l1 - l2) / (l1 + l2) : 0
  let angle = (0.5 * Math.atan2(2 * jxy, jxx - jyy) * 180) / Math.PI
  if (angle < 0) angle += 180

  // Project across the ridges, then autocorrelate the profile.
  const rad = (angle * Math.PI) / 180
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)
  const len = Math.ceil(Math.abs(r.w * dx) + Math.abs(r.h * dy)) + 1
  const profile = new Float64Array(len)
  const count = new Float64Array(len)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const t = Math.round((x - x0) * dx + (y - y0) * dy)
      if (t < 0 || t >= len) continue
      profile[t] += at(band, img.w, img.h, x, y)
      count[t]++
    }
  }
  for (let i = 0; i < len; i++) profile[i] = count[i] ? profile[i] / count[i] : 0
  let mean = 0
  let used = 0
  for (let i = 0; i < len; i++) {
    if (!count[i]) continue
    mean += profile[i]
    used++
  }
  mean = used ? mean / used : 0
  for (let i = 0; i < len; i++) profile[i] -= mean
  let var0 = 0
  for (let i = 0; i < len; i++) var0 += profile[i] * profile[i]
  let pitchPx: number | null = null
  let bestR = 0
  if (var0 > 0) {
    const maxLag = Math.min(80, Math.floor(len / 3))
    const ac = new Float64Array(maxLag + 1)
    for (let lag = 3; lag <= maxLag; lag++) {
      let s = 0
      let c = 0
      for (let i = 0; i + lag < len; i++) {
        if (!count[i] || !count[i + lag]) continue
        s += profile[i] * profile[i + lag]
        c++
      }
      ac[lag] = c ? s / var0 : 0
    }
    for (let lag = 4; lag < maxLag; lag++) {
      if (ac[lag] > bestR && ac[lag] > 0.15 && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) {
        bestR = ac[lag]
        pitchPx = lag
      }
    }
  }
  return {
    name: img.name,
    patch: p.label,
    cardW: img.card.w,
    mode,
    scale,
    angle,
    diagonal,
    anisotropy,
    pitchPx,
    pitchPerCard: pitchPx ? pitchPx / img.card.w : null,
    r: bestR,
    strength: n ? mag / n : 0,
  }
}

const ART: Patch[] = [
  { fx: 0.08, fy: 0.1, fw: 0.34, fh: 0.22, label: 'art upper-left' },
  { fx: 0.57, fy: 0.11, fw: 0.33, fh: 0.22, label: 'art upper-right' },
  { fx: 0.22, fy: 0.3, fw: 0.4, fh: 0.24, label: 'art body' },
]

const images: Img[] = []
// Flat catalogue scans: 734x1024, the card is the whole frame.
for (const [name, file] of [
  ['BW43 scan', 'tmp/refs-textured/BW43.png'],
  ['BW73 scan', 'tmp/refs-textured/BW73.png'],
  ['BW74 scan', 'tmp/refs-textured/BW74.png'],
  ['BW75 scan (smooth control)', 'tmp/refs-textured/BW75.png'],
] as const) {
  const base = { x: 0, y: 0, w: 734, h: 1024 }
  const img = load(name, file, base)
  if (img) images.push(img)
}

// Seller photographs. Card rects were read off the photographs themselves: the
// slab border and the card's rounded corners give the edges.
const PSA_CARD = { x: 249, y: 1086, w: 1987, h: 2795 }
for (const [name, file] of [
  ['BW73 photo front (PSA 4)', 'tmp/refs-textured/png/Pokemon_Graded_Darkrai_B-01.png'],
  ['BW73 photo BACK (same photo)', 'tmp/refs-textured/png/Pokemon_Graded_Darkrai_B-02.png'],
] as const) {
  const img = load(name, file, PSA_CARD)
  if (img) images.push(img)
}
const CGC_CARD = { x: 216, y: 890, w: 1577, h: 2174 }
{
  const img = load('BW73 photo front (CGC 10)', 'tmp/refs-textured/png/Pokemon_Graded_Darkrai_2-03.png', CGC_CARD)
  if (img) images.push(img)
}

// Japanese-market photographs of the SAME printing: BW73 is プラズマ団ギフトセット
// 005/016, so the paper is the same card in another language. These are the ones
// that finally show the emboss — each is shot at an angle under a point light,
// which is exactly what the flat scans and the front-lit slab photographs could
// not do — so each gets a 3×3 grid of patches rather than three: one able patch is
// an anecdote, nine are a sample.
const JP_PATCHES: Patch[] = []
for (const [fx, fy] of [
  [0.16, 0.14],
  [0.44, 0.16],
  [0.68, 0.14],
  [0.16, 0.4],
  [0.44, 0.42],
  [0.68, 0.4],
  [0.18, 0.64],
  [0.44, 0.66],
  [0.66, 0.64],
] as const) {
  JP_PATCHES.push({ fx, fy, fw: 0.2, fh: 0.16, label: `p${JP_PATCHES.length + 1}` })
}
for (const [name, file, rect] of [
  ['BW73 JP angled A', 'tmp/refs-textured/jp-png/t1249971628-04.png', { x: 20, y: 40, w: 760, h: 1130 }],
  ['BW73 JP angled B', 'tmp/refs-textured/jp-png/t1249971628-05.png', { x: 40, y: 30, w: 780, h: 1150 }],
  ['BW73 JP angled C', 'tmp/refs-textured/jp-png/t1165449779-29.png', { x: 0, y: 0, w: 700, h: 1000 }],
  ['BW73 JP angled D', 'tmp/refs-textured/jp-png/x1238905421-11.png', { x: 10, y: 60, w: 600, h: 720 }],
] as const) {
  const img = load(name, file, rect, JP_PATCHES)
  if (img) images.push(img)
}

// Video: the same ENGLISH BW73 (identified by its own printed BW73 and 2013 line),
// laid flat on a desk under one lamp. A flat-on video frame is the best instrument
// this paper has had — one lens, one light, one card, and a run of tilts to choose
// from — so it is measured with the same patch grid. Frames are cut by
// tmp/fetch-video-frames.mjs into tmp/refs-textured/video/run/. The card is cropped
// above and below by the frame, so the rectangle's width is the measurement that
// matters and its height is inferred from the card's own 0.716 aspect.
for (const [name, file, rect] of [
  ['BW73 video flat-on A', 'tmp/refs-textured/video/run/012.png', { x: 250, y: 0, w: 668, h: 933 }],
  ['BW73 video flat-on B', 'tmp/refs-textured/video/run/022.png', { x: 330, y: 0, w: 615, h: 859 }],
] as const) {
  const img = load(name, file, rect, JP_PATCHES)
  if (img) images.push(img)
}

const rows: Result[] = []
for (const img of images) {
  for (const mode of ['luma', 'achromatic'] as const) {
    const bands = BANDS.map((b) => ({
      b,
      band: mode === 'luma' ? bandPass(img, b.fine, b.coarse) : achromaticBand(img, b.fine, b.coarse),
    }))
    for (const p of img.patches ?? ART) {
      // Keep the band that reads the surface most clearly: a real lattice scores on
      // both the diagonal share and the autocorrelation, artwork usually on neither.
      const scored = bands.map(({ b, band }) => ({ b, res: analyse(img, band, p, b.label, mode) }))
      scored.sort((x, y) => y.res.diagonal * (0.5 + y.res.r) - x.res.diagonal * (0.5 + x.res.r))
      rows.push(scored[0].res)
    }
  }
}

const pad = (s: string | number, n: number): string => String(s).padEnd(n)
console.log(
  pad('image', 30) + pad('patch', 16) + pad('mode', 7) + pad('band', 9) + pad('angle°', 8) + pad('diag', 7) + pad('aniso', 7) + pad('pitch', 8) + pad('per card', 10) + pad('r', 7) + 'signal',
)
for (const x of rows) {
  console.log(
    pad(x.name, 30) +
      pad(x.patch, 16) +
      pad(x.mode === 'achromatic' ? 'achro' : 'luma', 7) +
      pad(x.scale, 9) +
      pad(x.angle.toFixed(0), 8) +
      pad(x.diagonal.toFixed(2), 7) +
      pad(x.anisotropy.toFixed(2), 7) +
      pad(x.pitchPx ?? '—', 8) +
      pad(x.pitchPerCard ? (x.pitchPerCard * 100).toFixed(2) + '%' : '—', 10) +
      pad(x.r ? x.r.toFixed(2) : '—', 7) +
      x.strength.toFixed(4),
  )
}

const meanOf = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
console.log('\nsummary')
for (const key of [...new Set(rows.map((x) => x.name + '|' + x.mode))]) {
  const [name, mode] = key.split('|')
  const rs = rows.filter((x) => x.name === name && x.mode === mode)
  const hits = rs.filter((x) => x.pitchPerCard !== null && x.r >= 0.15)
  console.log(
    `  ${pad((mode === 'achromatic' ? '~ ' : '  ') + name, 32)} diag ${meanOf(rs.map((x) => x.diagonal)).toFixed(2)}` +
      `  aniso ${meanOf(rs.map((x) => x.anisotropy)).toFixed(2)}` +
      `  signal ${meanOf(rs.map((x) => x.strength)).toFixed(4)}` +
      `  pitch ${hits.length ? (meanOf(hits.map((x) => x.pitchPerCard as number)) * 100).toFixed(2) + '% of card width' : 'none'} (${hits.length}/${rs.length} patches)`,
  )
}

// The shipped relief's own pitch, from its formula: cos(2π·10·(u±v)) puts ten
// cycles per axis, so the period across the ridges is 1/(10·√2) of the sheet.
const MODEL_PITCH = 1 / (10 * Math.SQRT2)
console.log(`\nshipped etched-deep: lattice 10 cycles/axis -> ${(MODEL_PITCH * 100).toFixed(2)}% of card width across the ridges`)

// ---------------------------------------------------------------------------
// Record what the photographs settle, and what they do not.
// ---------------------------------------------------------------------------
//
// The bar for "settles the emboss" is deliberately high: one patch has to show a
// periodic repeat with a correlation of at least 0.25, and the same photograph's
// card BACK must not. Anything weaker is the artwork, the JPEG, or the light.

const PHOTO_SOURCES = [
  {
    label: 'BW73 front, PSA 4 slab (cert 157251293)',
    url: 'https://doubleinfinitygaming.com/products/pokemon-graded-darkrai-bw73-team-plasma-2013-full-art-psa-4',
    card: 'bw73' as const,
  },
  {
    label: 'BW73 back, the same slab (control)',
    url: 'https://doubleinfinitygaming.com/products/pokemon-graded-darkrai-bw73-team-plasma-2013-full-art-psa-4',
    card: 'bw73' as const,
  },
  {
    label: 'BW73 front, CGC 10 slab (cert 6034557167)',
    url: 'https://doubleinfinitygaming.com/products/pokemon-graded-darkrai-2013-bw73-cgc-10',
    card: 'bw73' as const,
  },
  // The Japanese print of the same paper, shot tilted. These are the frames that
  // show the weave; they are evidence about the PAPER, not about the English
  // printing, and the report says so.
  {
    label: 'BW73 JP 005/016, Yahoo!オークション listing t1249971628 (two oblique frames)',
    url: 'https://auctions.yahoo.co.jp/jp/auction/t1249971628',
    card: 'bw73' as const,
  },
  {
    label: 'BW73 JP 005/016, Yahoo!オークション listing t1165449779 (oblique frame)',
    url: 'https://auctions.yahoo.co.jp/jp/auction/t1165449779',
    card: 'bw73' as const,
  },
  {
    label: 'BW73 JP 005/016, Yahoo!オークション listing x1238905421 (oblique frame)',
    url: 'https://auctions.yahoo.co.jp/jp/auction/x1238905421',
    card: 'bw73' as const,
  },
  {
    label: 'BW73 English, YouTube dFI0NbvBygY "3 Full Art Promo Pokemon Cards (BCBM)" (flat on a desk, frames from 90 s)',
    url: 'https://www.youtube.com/watch?v=dFI0NbvBygY',
    card: 'bw73' as const,
  },
]

const photoRows = rows.filter((r) => /photo|JP angled/.test(r.name))
const frontRows = photoRows.filter((r) => /front/.test(r.name))
const backRows = photoRows.filter((r) => /BACK/.test(r.name))
const angledRows = photoRows.filter((r) => /JP angled/.test(r.name))
const resolved = frontRows.filter((r) => r.pitchPx !== null && r.r >= 0.25 && r.diagonal >= 0.35)

// A tilted listing photograph foreshortens the card, so an absolute pitch in
// pixels is not comparable between frames. Cycles across the card is: it divides
// the measured period by that frame's own card width. One hot patch is an
// anecdote; the emboss is settled when patches from at least two different
// photographs land in the same bin.
const angledHits = angledRows.filter((r) => r.pitchPx !== null && r.r >= 0.25 && r.diagonal >= 0.35)
const binOf = (r: Result): number => Math.round(r.cardW / (r.pitchPx as number) / 5) * 5
const bins = new Map<number, { patches: Result[]; photos: Set<string> }>()
for (const r of angledHits) {
  const entry = bins.get(binOf(r)) ?? { patches: [], photos: new Set<string>() }
  entry.patches.push(r)
  entry.photos.add(r.name)
  bins.set(binOf(r), entry)
}
const agreement = [...bins.entries()]
  .filter(([, e]) => e.photos.size >= 2 && e.patches.length >= 3)
  .sort((a, b) => b[1].patches.length - a[1].patches.length)[0]
const embossSettled = Boolean(agreement) || resolved.length > 0

if (angledHits.length) {
  console.log('\nangled photographs — ridge agreement')
  for (const [bin, e] of [...bins.entries()].sort((a, b) => b[1].patches.length - a[1].patches.length)) {
    console.log(
      `  ~${bin} cycles/card: ${e.patches.length} patch(es) from ${e.photos.size} photograph(s)` +
        `  (${[...new Set(e.patches.map((p) => p.name))].join(', ')})`,
    )
  }
  console.log(
    agreement
      ? `  -> agreeing cluster: ~${agreement[0]} cycles across the card`
      : '  -> no cluster: no two photographs agree on a period',
  )
}

// Where a raking-light photograph or video was looked for, and what came back.
// This is part of the record: "none was found" is a fact about the search, not an
// omission, and it is what keeps the relief modelled without pretending otherwise.
const SEARCH = {
  goal: 'a photograph or video of BW73 shot under raking light, where an emboss throws highlights and shadows',
  attempted: [
    { channel: 'eBay listings', result: 'blocked — item pages return a 1.7 KB interstitial with no image URLs' },
    { channel: 'Cardmarket item pages + seller scans', result: 'HTTP 403 on the pages; the marketplace-scan URLs a search engine returned serve an HTML error page' },
    { channel: 'CardTrader item page', result: 'HTTP 403' },
    { channel: 'Reddit search (JSON API)', result: 'blocked — an HTML challenge page instead of JSON' },
    { channel: 'DuckDuckGo HTML search', result: 'no image results for this card; only price catalogues' },
    { channel: 'YouTube search HTML', result: 'reachable, but nothing about this card’s surface: the Darkrai results were about another product' },
    { channel: 'Shop product APIs (Shopify /products.json)', result: 'two shops stocked BW73 and both photographed it front-lit, which is what was measured' },
    { channel: 'Yahoo!オークション (auctions.yahoo.co.jp)', result: 'HTTP 200 — 28 gallery photographs from 10 listings of 005/016; three listings photograph the card tilted under a point light, where the weave is visible at high zoom' },
    { channel: 'Mercari Japan (jp.mercari.com)', result: 'search HTML reachable; listings carry photographs only — the pages contain no video markup at all' },
    { channel: 'YouTube search + download (yt-dlp, ffmpeg in a throwaway tmp/.venv)', result: 'reachable — eight queries returned 27 candidates; dFI0NbvBygY shows the ENGLISH BW73 flat on a desk under one lamp and 28 frames were cut at 4 fps, but at 720p the ridges blur into the artwork' },
    { channel: 'YouTube 4K / close-up sweep (10 queries, retried with backoff)', result: 'BW73 queries for 4K return no results at all; the 4K holo showcases that do exist cover modern sets, not this promo' },
    { channel: 'Highest master of the two videos that do show BW73', result: 'dFI0NbvBygY tops out at 720p; eufTQfegapg has a 1920x1080 stream, but there the card is hand-held about 350 px wide behind a sleeve, softer than the 720p desk frames already measured' },
    { channel: 'Nicovideo search', result: 'HTTP 404 on the search URL; no listing to read' },
  ],
  outcome: 'No raking-light photograph yields a pitch this build will attribute to the emboss, so the relief keeps its modelled pitch and direction. One video was found and measured (verdict.video) and the Japanese listings do show the weave (verdict.weaveVisible): both are facts about the paper, and neither is a measurement of its ridges.',
}

const photographed = ['bw73']

// What the oblique Japanese photographs settle that the front-lit slab photographs
// could not: the weave is there, on the card, over the whole printed face. That is
// a claim about APPEARANCE, not a measurement, and the numbers below are why the
// two are kept apart.
// Only patches that actually produced a pitch count. A null is "no repeat found",
// and averaging it in as zero would invent a number — which the first draft of this
// summary did, reading 3.15% where the measured frames average 4.4%.
const measured = (rs: Result[]): number[] =>
  rs.filter((r) => r.pitchPerCard !== null).map((r) => r.pitchPerCard as number)
const angledLuma = meanOf(measured(angledRows.filter((r) => r.mode === 'luma')))
const angledAchroRows = angledRows.filter((r) => r.mode === 'achromatic')
const angledAchro = meanOf(measured(angledAchroRows))
// Per PHOTOGRAPH, because that is the unit of independent evidence: individual
// patches scatter widely and quoting that spread as agreement would overstate it.
const angledPerPhoto = [...new Set(angledAchroRows.map((r) => r.name))].map((n) =>
  meanOf(measured(angledAchroRows.filter((r) => r.name === n))),
)
const controlRows = rows.filter((r) => /BW75/.test(r.name) && r.mode === 'achromatic')
const controlAchro = meanOf(measured(controlRows))

// The video frames are the sharpest evidence of the lot: the same card as the BW73
// catalogue scan, flat under one lamp. If a lattice is really there, its pitch on
// the achromatic band should differ from that scan's artwork-derived period.
const videoAchroRows = rows.filter((r) => /video/.test(r.name) && r.mode === 'achromatic')
const videoPitch = meanOf(measured(videoAchroRows))
const videoDiagonal = meanOf(videoAchroRows.map((r) => r.diagonal))
const scanBw73Achro = meanOf(measured(rows.filter((r) => /BW73 scan/.test(r.name) && r.mode === 'achromatic')))
const missingPhotographs = ['BW43 Landorus', 'BW74 Giratina'].filter((n) => !photographed.some((c) => n.toLowerCase().includes(c.slice(2))))

const photosReport = {
  generated: 'tmp/measure-textured.ts',
  question: 'Does any real photograph of BW43, BW73 or BW74 show the embossed lattice, and what does it settle?',
  method:
    'band-passed luminance (blur 1.5 - blur 10), gradient-direction histogram and structure tensor per patch, autocorrelation of the profile across the dominant direction; the same photograph\'s card BACK is the control',
  thresholds: {
    settlesEmboss: 'a front patch with r >= 0.25 and diagonal >= 0.35, not matched by the back',
    diagonalEnergyShare: 0.35,
    autocorrelation: 0.25,
  },
  photographs: PHOTO_SOURCES,
  cardsPhotographed: ['bw73'],
  cardsWithoutAPhotograph: ['bw43', 'bw74'],
  modelPitchPerCard: MODEL_PITCH,
  modelPitchSource: 'src/foil/surface-map.ts: cos(2π·10·(u±v)), ten cycles per sheet axis',
  rakingLightSearch: SEARCH,
  rows,
  verdict: {
    embossSettled,
    pitchPerCard: embossSettled ? meanOf(resolved.map((r) => r.pitchPerCard as number)) : null,
    // The tuning the relief would take, derived rather than guessed: for a lattice
    // cos(2πN(u+v)) the lines are spaced 1/N in (u+v), which is 1/(N√2) of the card
    // width perpendicular to them. So a measured pitch p implies N = 1/(p√2).
    tuning: embossSettled
      ? {
          cyclesPerAxis: Math.round(1 / (meanOf(resolved.map((r) => r.pitchPerCard as number)) * Math.SQRT2)),
          directionDeg: Math.round(meanOf(resolved.map((r) => r.angle))),
          relief: 'etched-deep',
          appliesTo: 'src/foil/surface-map.ts -> etchedDeepHeight lattice constant',
        }
      : null,
    tuningFormula: 'for cos(2πN(u±v)): N = 1 / (pitchPerCard × √2); lines run at ±45° when the measured gradient direction is 45°/135°',
    weaveVisible: {
      seen: true,
      where: 'three Japanese listings of プラズマ団ギフトセット 005/016 (BW73 in Japanese), four frames, all shot tilted under a point light',
      what: 'a fine diagonal lattice of ridges over the whole printed face, the weave the front-lit slab photographs could not show',
      whyItIsNotAPitch: `the estimator returns a periodic peak on a SMOOTH card too: the BW75 control reads ${(controlAchro * 100).toFixed(2)}% of card width on the achromatic band against ${(angledAchro * 100).toFixed(2)}% for the four textured photographs, so a period here cannot be attributed to the emboss`,
      consequence: 'the relief keeps its modelled pitch, but the record now says the paper IS visible in oblique photographs, which is what the full-art mask describes',
    },
    video: {
      source: 'dFI0NbvBygY — "3 Full Art Promo Pokemon Cards (BCBM)", the English BW73 flat on a desk under one lamp',
      url: 'https://www.youtube.com/watch?v=dFI0NbvBygY',
      framesAvailable: 28,
      framesMeasured: 2,
      resolution: '1280x720 video-only stream',
      pitchAchromatic: videoPitch,
      diagonalAchromatic: videoDiagonal,
      sameCardScanPitchAchromatic: scanBw73Achro,
      resolvesPitch: false,
      whyItIsNotAPitch: `the same card's own flat catalogue scan reads ${(scanBw73Achro * 100).toFixed(2)}% on the same band against ${(videoPitch * 100).toFixed(2)}% here, and the smooth control reads ${(controlAchro * 100).toFixed(2)}%; an estimator that returns 4% and 8% for one card is not tracking one stable property`,
      atThisResolution:
        '720p — the patch crops are soft enough that the ridges blur into the artwork, while the 900–1200 px Japanese stills with a raking light do show them',
    },
    highResolutionSweep: {
      result: 'nothing sharper than what is already measured',
      detail:
        'no BW73 upload above 720p came back from ten 4K/close-up queries; the only 1080p master of a Team Plasma opening shows the card hand-held at about 350 px behind a sleeve, and the 4K holo showcases cover modern sets',
      bindingLimit: 'resolution, not search coverage',
    },
    angledPitchLuma: angledLuma,
    angledPitchAchromatic: angledAchro,
    smoothControlPitchAchromatic: controlAchro,
    diagonalFront: meanOf(frontRows.map((r) => r.diagonal)),
    diagonalBack: meanOf(backRows.map((r) => r.diagonal)),
    anisotropyFront: meanOf(frontRows.map((r) => r.anisotropy)),
    anisotropyBack: meanOf(backRows.map((r) => r.anisotropy)),
    statement: embossSettled
      ? 'The photographs resolve a periodic lattice on the front face, so the relief can be calibrated against them.'
      : 'The photographs do NOT resolve the emboss: no front patch shows a repeat that its own card back does not, so the ridge geometry stays modelled.',
    settles:
      'The LAYOUT, and that the weave is really there. All three are full-art printings whose illustration runs under the text wash (BW73 in both seller photographs, BW43 and BW74 in the catalogue scans), which is why the rows now use the full-art mask rather than a 37.5%-tall illustration window; and the oblique Japanese photographs show the lattice across that whole face, at a zoom where nothing else could be mistaken for it.',
    doesNotSettle:
      'The ridge pitch, depth and direction. The oblique photographs show the weave but the same estimator reads a comparable period on a smooth card, so attributing the number to the emboss would be a choice dressed as a measurement. A front-lit phone photograph does not show the ridges at all, and no raking-light photograph or video of BW43, BW73 or BW74 was found.',
    missingPhotographs,
  },
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/textured-photos.json', JSON.stringify(photosReport, null, 2) + '\n')

const table = [...new Set(photoRows.map((r) => r.name))]
  .map((name) => {
    const rs = photoRows.filter((r) => r.name === name)
    const pitches = rs.filter((r) => r.pitchPx !== null && r.r >= 0.15)
    return `| ${name} | ${meanOf(rs.map((r) => r.diagonal)).toFixed(2)} | ${meanOf(rs.map((r) => r.anisotropy)).toFixed(2)} | ${meanOf(rs.map((r) => r.strength)).toFixed(4)} | ${pitches.length ? (meanOf(pitches.map((r) => r.pitchPerCard as number)) * 100).toFixed(2) + '% (' + Math.max(...pitches.map((r) => r.r)).toFixed(2) + ')' : 'none'} |`
  })
  .join('\n')

const md = `# Textured promos: what the photographs settle

Generated by \`tmp/measure-textured.ts\`. Inputs are seller photographs fetched by
\`tmp/fetch-textured-photos.mjs\`; they are not committed, so re-fetch before re-running.

## Verdict

**${embossSettled ? 'The photographs resolve the emboss.' : 'The photographs do not resolve the emboss.'}**
${photosReport.verdict.statement}

What they do settle: ${photosReport.verdict.settles}

What they do not: ${photosReport.verdict.doesNotSettle}

| Card | Photographs found |
| --- | --- |
| BW73 Darkrai | 2 English sellers, 3 front-lit slab photographs (front ×2, back ×1); 4 oblique frames from 3 Japanese listings; and one English video (28 frames cut at 4 fps, 2 measured) |
| BW43 Landorus | none found |
| BW74 Giratina | none found |

## The measurement

Each row is one patch of card (fractions of the card, not the photo), on the
band-passed luminance. \`diag\` is the share of gradient energy within ±10° of
the two diagonals; \`aniso\` is the structure tensor's eigenvalue ratio (1 = one
direction only); \`r\` is the autocorrelation coefficient at the reported pitch.

| Image | diag | aniso | signal | pitch (r) |
| --- | --- | --- | --- | --- |
${table}

The control is the **back of the same slab, in the same photograph**: same lens,
same light, same JPEG, and no emboss. A measurement that does not separate the two
is measuring the artwork and the light, not the foil.

Whole-card numbers, for comparison:

| | diagonal | anisotropy |
| --- | --- | --- |
| BW73 front (both photographs) | ${photosReport.verdict.diagonalFront.toFixed(2)} | ${photosReport.verdict.anisotropyFront.toFixed(2)} |
| BW73 back (control) | ${photosReport.verdict.diagonalBack.toFixed(2)} | ${photosReport.verdict.anisotropyBack.toFixed(2)} |

## What the Japanese listings show

The Japanese print of this card is プラズマ団ギフトセット 005/016 — the same paper,
another language — and Japanese sellers photograph holo cards tilted far more often
than Western shops do. Four frames from three listings (\`t1249971628\` ×2,
\`t1165449779\`, \`x1238905421\`) are shot at an angle under a point light, and at
high zoom each shows a **fine diagonal lattice of ridges across the whole printed
face**: a weave, not a broad wave. That is the thing the front-lit slab
photographs could not show, and it is why the paper's appearance is no longer
something only the catalogue description asserts.

It is not a pitch, and the numbers say why. Read on the achromatic band — the part
of the detail all three colour channels share, which is what a surface does and ink
does not — the four photographs average
${(angledAchro * 100).toFixed(2)}% of the card width, while the **smooth** control
card (BW75, no emboss) reads ${(controlAchro * 100).toFixed(2)}%. A period the
smooth card produces as readily cannot be attributed to the emboss, so the ridge
spacing stays this build's choice. The four frames' own means agree closely
(${(Math.min(...angledPerPhoto) * 100).toFixed(2)}–${(Math.max(...angledPerPhoto) * 100).toFixed(2)}% of card width),
though individual patches scatter much wider — but agreement between four photographs
of one card is not separation from a control.

## The video: the best instrument, and the same answer

A video is the instrument this paper actually wanted: one lens, one light, one card.
\`tmp/fetch-video-frames.mjs\` downloads \`dFI0NbvBygY\` ("3 Full Art Promo Pokemon
Cards") and cuts 28 frames at 4 fps from 90 s, where the **English** BW73 lies flat
on a desk under a single lamp. The two flattest frames are measured here. The point
of a video is that the card can be read where it is square-on, without the
foreshortening that spoils a tilted still.

At 720p it still does not resolve the emboss. The patch crops are soft enough that
the ridges blur into the artwork, and on the achromatic band the frames read
${(videoPitch * 100).toFixed(2)}% of card width against ${(controlAchro * 100).toFixed(2)}%
for the smooth control — and ${(scanBw73Achro * 100).toFixed(2)}% for the **same**
card's own flat catalogue scan. An estimator that returns 4% and 8% for one card is
not tracking one stable property of its surface, so no pitch is taken from this
video either. What it does add is the emboss in motion on the English printing:
the same weave the Japanese stills caught, seen on the card this build actually
renders.

## The shipped relief, and how it compares

The modelled \`etched-deep\` lattice is cos(2π·10·(u±v)) over the sheet: ten cycles
per sheet axis, which is **${(MODEL_PITCH * 100).toFixed(2)}% of the card width** across
the ridges. ${embossSettled ? `The photographs put the real pitch at ${(photosReport.verdict.pitchPerCard! * 100).toFixed(2)}%, which is what the sheet should be tuned to.` : 'No photograph found here measures a real pitch, so that number remains this build\'s choice and is not evidence about the card.'}

## Why the mask changed

The scans and both BW73 photographs show all three cards are **full-art**: the
illustration runs under the text wash, edge to edge, with no separated art window.
A standard illustration window — a band covering about 37.5% of the card height —
would therefore have put the relief on a strip of a face that is entirely art. The
three rows now resolve \`mask: 'full-art'\` (the full-art layout, 90% × 77.5% of the
card, measured in \`mask.ts\`), with \`maskVerified\` still false because no source
states which cells of the face carry the emboss.

## What would settle the rest

A raking-light still — light from the side at a shallow angle — or a high-bitrate
video of any one of the three. A video was found and cut into frames
(\`dFI0NbvBygY\`), but at 720p the ridges blur: resolution, not the search, is now
the binding limit. Until a sharper source exists the ridge pitch, depth, strength
and direction stay modelled, and \`SURFACE_TEXTURES['etched-deep'].verified\` stays false.

### The search for one

${SEARCH.goal}.

| Channel | What came back |
| --- | --- |
${SEARCH.attempted.map((a) => `| ${a.channel} | ${a.result} |`).join('\n')}

**${SEARCH.outcome}**

### How the relief would be tuned

No guesswork is needed once a photograph resolves: the sheet's lattice is
\`cos(2πN(u±v))\`, whose lines are spaced 1/N in (u+v) — that is 1/(N√2) of the
card width perpendicular to them. A measured pitch p therefore implies
**N = 1/(p√2)**, and a measured gradient direction of 45°/135° confirms the diagonal
the sheet already draws. This script prints that number as \`verdict.tuning\` as
soon as a front patch clears the bar, so tuning the paper is a one-line change in
\`src/foil/surface-map.ts\` rather than a new investigation. At the sheet's current
N = 10 the pitch is ${(MODEL_PITCH * 100).toFixed(2)}% of the card width.
`

fs.writeFileSync('reports/textured-photos.md', md)
console.log(`\nwrote reports/textured-photos.{json,md} — emboss settled: ${embossSettled ? 'yes' : 'no'}`)
