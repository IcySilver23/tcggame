// Measure Ascended Heroes stamp size and placement from the real photographs.
//
// Run: ./node_modules/.bin/tsx tmp/measure-ascended-stamp.ts
//
// Two independent rulers, so a mistake in either shows up:
//
//  1. the CARD's own edges. Every photo shows the card against a background, so
//     the strongest luminance gradient near each border gives the card rect, and
//     the card is 734 x 1024 — a stamp's pixel box divided by that is its size in
//     card fractions. Width/height is printed as a check: a correct rect lands on
//     0.717.
//  2. the stamp itself. The ball is a pale disc on a darker body, so the score
//     mean(L inside) - mean(L in an annulus just outside) peaks at its true centre
//     and radius. Straight bright text does not score, because it leaves the
//     annulus empty.
//
// The Snorunt Energy reverse is measured the same way as a control: its symbol
// already ships at ~0.45 card widths centred (0.5, 0.675), so if this method
// finds that, it can be trusted on the ball.

import { decodePng } from './png'

type Img = { name: string; w: number; h: number; L: Float32Array }

function load(file: string): Img {
  const p = decodePng(file)
  const L = new Float32Array(p.w * p.h)
  for (let i = 0; i < p.w * p.h; i++) {
    L[i] = (0.2126 * p.px[i * 4] + 0.7152 * p.px[i * 4 + 1] + 0.0722 * p.px[i * 4 + 2]) / 255
  }
  return { name: file.split(/[\\/]/).pop()!, w: p.w, h: p.h, L }
}

const sample = (img: Img, x: number, y: number): number => {
  const xi = Math.max(0, Math.min(img.w - 1, Math.round(x)))
  const yi = Math.max(0, Math.min(img.h - 1, Math.round(y)))
  return img.L[yi * img.w + xi]
}

/** Strongest gradient position along one row or column inside a search window. */
function edgeAlong(img: Img, fixed: number, axis: 'x' | 'y', from: number, to: number): number {
  let best = from
  let bestV = -1
  for (let t = from; t < to; t++) {
    const a = axis === 'x' ? sample(img, t - 2, fixed) : sample(img, fixed, t - 2)
    const b = axis === 'x' ? sample(img, t + 2, fixed) : sample(img, fixed, t + 2)
    const d = Math.abs(b - a)
    if (d > bestV) { bestV = d; best = t }
  }
  return best
}

function cardRect(img: Img): { x0: number; x1: number; y0: number; y1: number; width: number; height: number } {
  const xs = [0.42, 0.5, 0.58].map((f) => {
    const row = Math.round(img.h * f)
    return {
      left: edgeAlong(img, row, 'x', Math.round(img.w * 0.01), Math.round(img.w * 0.18)),
      right: edgeAlong(img, row, 'x', Math.round(img.w * 0.82), Math.round(img.w * 0.99)),
    }
  })
  const ys = [0.44, 0.52, 0.6].map((f) => {
    const col = Math.round(img.w * f)
    return {
      top: edgeAlong(img, col, 'y', Math.round(img.h * 0.01), Math.round(img.h * 0.12)),
      bottom: edgeAlong(img, col, 'y', Math.round(img.h * 0.88), Math.round(img.h * 0.99)),
    }
  })
  const mid = xs.sort((a, b) => (a.right - a.left) - (b.right - b.left))[1]
  const midY = ys.sort((a, b) => (a.bottom - a.top) - (b.bottom - b.top))[1]
  return {
    x0: mid.left, x1: mid.right, y0: midY.top, y1: midY.bottom,
    width: mid.right - mid.left, height: midY.bottom - midY.top,
  }
}

type Fit = { cx: number; cy: number; r: number; score: number }

function discFit(img: Img, box: { x0: number; x1: number; y0: number; y1: number }): Fit[] {
  const ANGLES = 48
  const score = (cx: number, cy: number, r: number): number => {
    let inside = 0
    let outside = 0
    for (let k = 0; k < ANGLES; k++) {
      const a = (k / ANGLES) * Math.PI * 2
      const c = Math.cos(a)
      const s = Math.sin(a)
      inside += sample(img, cx + c * r * 0.7, cy + s * r * 0.7)
      outside += sample(img, cx + c * r * 1.18, cy + s * r * 1.18)
    }
    return inside / ANGLES - outside / ANGLES
  }
  const w = box.x1 - box.x0
  const h = box.y1 - box.y0
  const rMin = w * 0.16
  const rMax = w * 0.5
  let best: Fit[] = []
  for (let r = rMin; r <= rMax; r += 4) {
    for (let cy = box.y0 + h * 0.3; cy <= box.y0 + h * 0.85; cy += 6) {
      for (let cx = box.x0 + w * 0.2; cx <= box.x0 + w * 0.8; cx += 6) {
        best.push({ cx, cy, r, score: score(cx, cy, r) })
      }
    }
  }
  best.sort((a, b) => b.score - a.score)
  // Keep peaks that are not just the same circle nudged a pixel.
  const out: Fit[] = []
  for (const f of best) {
    if (out.every((o) => Math.hypot(o.cx - f.cx, o.cy - f.cy) > 10 || Math.abs(o.r - f.r) > 8)) out.push(f)
    if (out.length === 6) break
  }
  // Refine each peak on a fine grid.
  return out.map((f) => {
    let top = f
    for (let cy = f.cy - 5; cy <= f.cy + 5; cy += 1) {
      for (let cx = f.cx - 5; cx <= f.cx + 5; cx += 1) {
        for (let r = f.r - 5; r <= f.r + 5; r += 1) {
          const s = score(cx, cy, r)
          if (s > top.score) top = { cx, cy, r, score: s }
        }
      }
    }
    return top
  }).sort((a, b) => b.score - a.score)
}

const REFS = [
  { file: 'tmp/refs/Snorunt-Poke-Ball-Reverse-Holo.png', label: 'Poké Ball paper (Snorunt)' },
  { file: 'tmp/refs/Team-Rockets-Exeggutor-Reverse-Holo.png', label: "Team Rocket's R paper (Exeggutor)" },
  { file: 'tmp/refs/Snorunt-Energy-Reverse-Holo.png', label: 'Energy paper (Snorunt) — control' },
]

for (const ref of REFS) {
  const img = load(ref.file)
  const rect = cardRect(img)
  console.log(`\n## ${ref.label} — ${img.w}x${img.h}`)
  console.log(
    `   card rect x ${rect.x0}..${rect.x1} (${rect.width}px)  y ${rect.y0}..${rect.y1} (${rect.height}px)`
    + `  aspect ${(rect.width / rect.height).toFixed(3)} (card is 0.717)`,
  )
  for (const f of discFit(img, rect)) {
    const u = (f.cx - rect.x0) / rect.width
    const v = (f.cy - rect.y0) / rect.height
    console.log(
      `   disc score ${f.score.toFixed(3)} at u ${u.toFixed(3)} v ${v.toFixed(3)}`
      + `  radius ${(f.r / rect.width).toFixed(3)} of card width -> diameter ${((2 * f.r) / rect.width).toFixed(3)}`,
    )
  }
}
