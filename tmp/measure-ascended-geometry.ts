// Measure the Ascended Heroes ball paper against the real Snorunt photograph,
// calibrated on the illustration window.
//
// Run: ./node_modules/.bin/tsx tmp/measure-ascended-geometry.ts
//
// Why the art window is the ruler: this build already measured ASCENDED_ART_RECT
// (x 0.083, y 0.094, w 0.838, h 0.375) from the set's scan, and the window's
// border is the crispest edge on a photographed card. Detecting those four edges
// and dividing by the known fractions gives the card's pixel size and origin far
// better than the outer border does — the border is rounded and sits inside a
// sleeve, and the naive rect came out 3% tall (aspect 0.739 against 0.717).
//
// Then three measurements, each printed so it can be checked rather than taken
// on trust:
//
//   - the ring: a median-edge circle fit on a high-pass image, centre searched in
//     the body band only (a ball behind the attack text cannot sit off-centre);
//   - the button: the same fit at small radius, which also yields the ring:button
//     ratio — the shipped sheet's proportions are 1:3, so a photo that disagrees
//     is a real disagreement;
//   - the band: the horizontal equator's centre, from row-wise edge energy inside
//     the ring, which is where the ball's centre actually is.
//
// Reported in card fractions of the card's WIDTH (734) and HEIGHT (1024).

import { decodePng } from './png'

type Img = { w: number; h: number; L: Float32Array }

function load(file: string): Img {
  const p = decodePng(file)
  const L = new Float32Array(p.w * p.h)
  for (let i = 0; i < p.w * p.h; i++) {
    L[i] = (0.2126 * p.px[i * 4] + 0.7152 * p.px[i * 4 + 1] + 0.0722 * p.px[i * 4 + 2]) / 255
  }
  return { w: p.w, h: p.h, L }
}

const at = (f: Float32Array, w: number, h: number, x: number, y: number): number =>
  f[Math.max(0, Math.min(h - 1, Math.round(y))) * w + Math.max(0, Math.min(w - 1, Math.round(x)))]

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b)
  return s[(s.length - 1) >> 1]
}

function blur(img: Img, radius: number): Float32Array {
  const tmp = new Float32Array(img.w * img.h)
  const out = new Float32Array(img.w * img.h)
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      let s = 0
      let n = 0
      for (let d = -radius; d <= radius; d++) {
        const xx = x + d
        if (xx < 0 || xx >= img.w) continue
        s += img.L[y * img.w + xx]
        n++
      }
      tmp[y * img.w + x] = s / n
    }
  }
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      let s = 0
      let n = 0
      for (let d = -radius; d <= radius; d++) {
        const yy = y + d
        if (yy < 0 || yy >= img.h) continue
        s += tmp[yy * img.w + x]
        n++
      }
      out[y * img.w + x] = s / n
    }
  }
  return out
}

/** Strongest gradient along a line inside a search window. */
function edge(img: Img, fixed: number, axis: 'x' | 'y', from: number, to: number): number {
  let best = from
  let bestV = -1
  for (let t = Math.max(4, Math.round(from)); t < Math.min((axis === 'x' ? img.w : img.h) - 4, Math.round(to)); t++) {
    const a = axis === 'x' ? at(img.L, img.w, img.h, t - 3, fixed) : at(img.L, img.w, img.h, fixed, t - 3)
    const b = axis === 'x' ? at(img.L, img.w, img.h, t + 3, fixed) : at(img.L, img.w, img.h, fixed, t + 3)
    const d = Math.abs(b - a)
    if (d > bestV) { bestV = d; best = t }
  }
  return best
}

const ART = { x: 0.083, y: 0.094, w: 0.838, h: 0.375 }

/** Card rect derived from the illustration window's four edges. */
function calibrate(img: Img) {
  // Rough rect from the outer border, only to place the art-window searches.
  const lefts: number[] = []
  const rights: number[] = []
  for (const f of [0.45, 0.5, 0.55]) {
    const row = Math.round(img.h * f)
    lefts.push(edge(img, row, 'x', 2, img.w * 0.12))
    rights.push(edge(img, row, 'x', img.w * 0.86, img.w - 1))
  }
  const x0 = median(lefts)
  const x1 = median(rights)
  const w0 = x1 - x0
  const h0 = w0 * (1024 / 734)
  const y0 = img.h * 0.5 - h0 * 0.5

  // The window's four edges, each searched near where the known fractions put it.
  const midArtY = Math.round(y0 + (ART.y + ART.h / 2) * h0)
  const midArtX = Math.round(x0 + (ART.x + ART.w / 2) * w0)
  const artLeft = edge(img, midArtY, 'x', x0 + (ART.x - 0.07) * w0, x0 + (ART.x + 0.07) * w0)
  const artRight = edge(img, midArtY, 'x', x0 + (ART.x + ART.w - 0.07) * w0, x0 + (ART.x + ART.w + 0.07) * w0)
  const artTop = edge(img, midArtX, 'y', y0 + (ART.y - 0.06) * h0, y0 + (ART.y + 0.06) * h0)
  const artBottom = edge(img, midArtX, 'y', y0 + (ART.y + ART.h - 0.06) * h0, y0 + (ART.y + ART.h + 0.06) * h0)

  const artW = artRight - artLeft
  const artH = artBottom - artTop
  const W = artW / ART.w
  const H = artH / ART.h
  return {
    x0: artLeft - ART.x * W,
    y0: artTop - ART.y * H,
    W, H,
    art: { left: artLeft, right: artRight, top: artTop, bottom: artBottom, artW, artH },
  }
}

type Fit = { cx: number; cy: number; r: number; score: number }

function ringScore(hp: Float32Array, w: number, h: number, cx: number, cy: number, r: number): number {
  const ANG = 90
  const on: number[] = []
  const near: number[] = []
  for (let k = 0; k < ANG; k++) {
    const a = (k / ANG) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    on.push(at(hp, w, h, cx + c * r, cy + s * r))
    near.push(at(hp, w, h, cx + c * r * 0.88, cy + s * r * 0.88))
    near.push(at(hp, w, h, cx + c * r * 1.12, cy + s * r * 1.12))
  }
  return median(on) - median(near)
}

function fitRing(
  hp: Float32Array, w: number, h: number,
  cxRange: [number, number], cyRange: [number, number], rRange: [number, number], step = 2,
): Fit {
  let best: Fit = { cx: 0, cy: 0, r: 0, score: -9 }
  const coarse: Fit[] = []
  for (let r = rRange[0]; r <= rRange[1]; r += step) {
    for (let cy = cyRange[0]; cy <= cyRange[1]; cy += step * 1.5) {
      for (let cx = cxRange[0]; cx <= cxRange[1]; cx += step) {
        coarse.push({ cx, cy, r, score: ringScore(hp, w, h, cx, cy, r) })
      }
    }
  }
  coarse.sort((a, b) => b.score - a.score)
  for (const c of coarse.slice(0, 6)) {
    for (let cy = c.cy - step * 1.5; cy <= c.cy + step * 1.5; cy += 1) {
      for (let cx = c.cx - step; cx <= c.cx + step; cx += 1) {
        for (let r = c.r - step; r <= c.r + step; r += 1) {
          const s = ringScore(hp, w, h, cx, cy, r)
          if (s > best.score) best = { cx, cy, r, score: s }
        }
      }
    }
  }
  return best
}

/** Band centre: the strongest pair of horizontal edges inside the ring. */
function bandCentre(hp: Float32Array, w: number, h: number, cx: number, cy: number, r: number): number | null {
  const rows: { y: number; v: number }[] = []
  for (let y = Math.round(cy - r * 0.45); y <= Math.round(cy + r * 0.45); y++) {
    let s = 0
    for (let x = Math.round(cx - r * 0.45); x <= Math.round(cx + r * 0.45); x++) {
      s += Math.abs(at(hp, w, h, x, y + 1) - at(hp, w, h, x, y - 1))
    }
    rows.push({ y, v: s })
  }
  const peaks = [...rows].sort((a, b) => b.v - a.v).slice(0, 6)
  if (peaks.length < 2) return null
  const above = peaks.filter((p) => p.y < cy).sort((a, b) => b.v - a.v)[0]
  const below = peaks.filter((p) => p.y > cy).sort((a, b) => b.v - a.v)[0]
  if (!above || !below) return null
  return (above.y + below.y) / 2
}

const REF = 'tmp/refs/Snorunt-Poke-Ball-Reverse-Holo.png'
const img = load(REF)
const cal = calibrate(img)
console.log(`Snorunt Poké Ball reverse — ${img.w}x${img.h}`)
console.log(
  `  art window px ${cal.art.artW}x${cal.art.artH} at (${cal.art.left}, ${cal.art.top})`
  + ` -> card ${cal.W.toFixed(1)}x${cal.H.toFixed(1)}px, aspect ${(cal.W / cal.H).toFixed(3)} (card 0.717)`,
)

const low = blur(img, 8)
const hp = new Float32Array(img.w * img.h)
for (let i = 0; i < img.w * img.h; i++) hp[i] = img.L[i] - low[i]

const ring = fitRing(
  hp, img.w, img.h,
  [cal.x0 + cal.W * 0.4, cal.x0 + cal.W * 0.6],
  [cal.y0 + cal.H * 0.55, cal.y0 + cal.H * 0.8],
  [cal.W * 0.17, cal.W * 0.28],
)
const ringU = (ring.cx - cal.x0) / cal.W
const ringV = (ring.cy - cal.y0) / cal.H
const ringDia = (2 * ring.r) / cal.W
console.log(
  `  ring  score ${ring.score.toFixed(3)}  centre (${ringU.toFixed(3)}, ${ringV.toFixed(3)})`
  + `  diameter ${ringDia.toFixed(3)} card widths`,
)

const button = fitRing(
  hp, img.w, img.h,
  [ring.cx - ring.r * 0.15, ring.cx + ring.r * 0.15],
  [ring.cy - ring.r * 0.15, ring.cy + ring.r * 0.15],
  [ring.r * 0.15, ring.r * 0.45], 1,
)
console.log(
  `  button score ${button.score.toFixed(3)} radius ${button.r.toFixed(1)}px`
  + `  -> ring:button ${(ring.r / button.r).toFixed(2)}:1 (shipped sheet draws 3.00:1)`,
)
const band = bandCentre(hp, img.w, img.h, ring.cx, ring.cy, ring.r)
if (band !== null) {
  console.log(`  equator band centre y ${((band - cal.y0) / cal.H).toFixed(3)} down the card (fitted centre ${ringV.toFixed(3)})`)
}

// The shipped geometry, for the comparison the correction decision needs.
const SHIP_WINDOW = 0.95
const SHEET_RING = 2 * 0.72 * 0.3
console.log(
  `\n  shipped one-large sampler: sheet ring ${SHEET_RING.toFixed(3)} x window ${SHIP_WINDOW}`
  + ` = ${(SHEET_RING * SHIP_WINDOW).toFixed(3)} card widths, centred (0.5, 0.675)`,
)
console.log(`  photo says ${ringDia.toFixed(3)} at (${ringU.toFixed(3)}, ${ringV.toFixed(3)})`)
console.log(`  size delta ${(((ringDia / (SHEET_RING * SHIP_WINDOW)) - 1) * 100).toFixed(1)}%`)
