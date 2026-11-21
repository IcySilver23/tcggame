// Fit the ball's ring in a real photograph and draw the fit back onto it.
//
// Run: ./node_modules/.bin/tsx tmp/fit-ascended-ball.ts
//
// The unconstrained disc fit was contaminated: the right half of this card is
// far brighter than the left, so the score drifted right and proposed a circle
// that would run off the card. Three constraints fix that, each stated rather
// than hidden:
//
//   - the centre is searched only in the body band (x 0.42..0.58, y 0.55..0.80),
//     because a ball behind the attack text cannot be off to one side;
//   - the radius must stay inside the card;
//   - the score uses a MEDIAN over the circle's angles, so a bright patch cannot
//     carry it the way a mean can.
//
// The ring is a luminance EDGE, so the fit runs on a high-pass image: the foil
// is faint and the body's glitter is not, and the difference is what the eye
// follows. The result is drawn back onto the photo — a fit that does not sit on
// the visible ring is wrong however good its score looks.

import fs from 'node:fs'
import zlib from 'node:zlib'
import { decodePng } from './png'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function encodePng(w: number, h: number, rgba: Uint8ClampedArray): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ])
}

type Img = { w: number; h: number; L: Float32Array; px: Buffer }

function load(file: string): Img {
  const p = decodePng(file)
  const L = new Float32Array(p.w * p.h)
  for (let i = 0; i < p.w * p.h; i++) {
    L[i] = (0.2126 * p.px[i * 4] + 0.7152 * p.px[i * 4 + 1] + 0.0722 * p.px[i * 4 + 2]) / 255
  }
  return { w: p.w, h: p.h, L, px: p.px }
}

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b)
  return s[(s.length - 1) >> 1]
}

/** Box-blurred copy, used as the low-pass half of the high-pass filter. */
function blur(img: Img, radius: number): Float32Array {
  const out = new Float32Array(img.w * img.h)
  const tmp = new Float32Array(img.w * img.h)
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

const at = (f: Float32Array, w: number, h: number, x: number, y: number): number => {
  const xi = Math.max(0, Math.min(w - 1, Math.round(x)))
  const yi = Math.max(0, Math.min(h - 1, Math.round(y)))
  return f[yi * w + xi]
}

/** Card rect from the outer border, as in the overlay script. */
function cardRect(img: Img) {
  const edge = (fixed: number, axis: 'x' | 'y', from: number, to: number): number => {
    let best = from
    let bestV = -1
    const lim = axis === 'x' ? img.w : img.h
    for (let t = Math.max(4, from); t < Math.min(lim - 4, to); t++) {
      const a = axis === 'x' ? at(img.L, img.w, img.h, t - 3, fixed) : at(img.L, img.w, img.h, fixed, t - 3)
      const b = axis === 'x' ? at(img.L, img.w, img.h, t + 3, fixed) : at(img.L, img.w, img.h, fixed, t + 3)
      const d = Math.abs(b - a)
      if (d > bestV) { bestV = d; best = t }
    }
    return best
  }
  const lefts: number[] = []
  const rights: number[] = []
  for (const f of [0.4, 0.45, 0.5, 0.55, 0.6]) {
    const row = Math.round(img.h * f)
    lefts.push(edge(row, 'x', 2, Math.round(img.w * 0.12)))
    rights.push(edge(row, 'x', Math.round(img.w * 0.86), img.w - 1))
  }
  const tops: number[] = []
  const bottoms: number[] = []
  for (const f of [0.4, 0.5, 0.6]) {
    const col = Math.round(img.w * f)
    tops.push(edge(col, 'y', 1, Math.round(img.h * 0.055)))
    bottoms.push(edge(col, 'y', Math.round(img.h * 0.945), img.h - 1))
  }
  const x0 = median(lefts)
  const x1 = median(rights)
  const y0 = median(tops)
  const y1 = median(bottoms)
  return { x0, x1, y0, y1, width: x1 - x0, height: y1 - y0 }
}

type Fit = { cx: number; cy: number; r: number; score: number }

/** Median edge response around a circle, minus the median just inside and outside it. */
function ringScore(hp: Img, cx: number, cy: number, r: number): number {
  const ANG = 72
  const on: number[] = []
  const near: number[] = []
  for (let k = 0; k < ANG; k++) {
    const a = (k / ANG) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    on.push(at(hp.L, hp.w, hp.h, cx + c * r, cy + s * r))
    near.push(at(hp.L, hp.w, hp.h, cx + c * r * 0.86, cy + s * r * 0.86))
    near.push(at(hp.L, hp.w, hp.h, cx + c * r * 1.14, cy + s * r * 1.14))
  }
  return median(on) - median(near)
}

function fit(hp: Img, rect: { x0: number; y0: number; width: number; height: number }): Fit {
  let best: Fit = { cx: 0, cy: 0, r: 0, score: -1 }
  const coarse: Fit[] = []
  for (let r = rect.width * 0.22; r <= rect.width * 0.46; r += 2) {
    for (let cy = rect.y0 + rect.height * 0.52; cy <= rect.y0 + rect.height * 0.84; cy += 3) {
      for (let cx = rect.x0 + rect.width * 0.4; cx <= rect.x0 + rect.width * 0.6; cx += 3) {
        coarse.push({ cx, cy, r, score: ringScore(hp, cx, cy, r) })
      }
    }
  }
  coarse.sort((a, b) => b.score - a.score)
  for (const c of coarse.slice(0, 5)) {
    for (let cy = c.cy - 3; cy <= c.cy + 3; cy += 1) {
      for (let cx = c.cx - 3; cx <= c.cx + 3; cx += 1) {
        for (let r = c.r - 3; r <= c.r + 3; r += 1) {
          const s = ringScore(hp, cx, cy, r)
          if (s > best.score) best = { cx, cy, r, score: s }
        }
      }
    }
  }
  return best
}

function render(file: string, out: string, title: string) {
  const img = load(file)
  const rect = cardRect(img)
  const low = blur(img, 8)
  const hpPx = Buffer.alloc(img.w * img.h * 4)
  const hpL = new Float32Array(img.w * img.h)
  for (let i = 0; i < img.w * img.h; i++) {
    const v = Math.max(0, Math.min(1, 0.5 + (img.L[i] - low[i]) * 4))
    hpL[i] = v
    hpPx[i * 4] = Math.round(v * 255)
    hpPx[i * 4 + 1] = Math.round(v * 255)
    hpPx[i * 4 + 2] = Math.round(v * 255)
    hpPx[i * 4 + 3] = 255
  }
  const hp: Img = { w: img.w, h: img.h, L: hpL, px: hpPx }
  const f = fit(hp, rect)
  const u = (f.cx - rect.x0) / rect.width
  const v = (f.cy - rect.y0) / rect.height
  console.log(
    `\n${title}: card ${rect.width}x${rect.height}px (aspect ${(rect.width / rect.height).toFixed(3)})\n`
    + `  fit score ${f.score.toFixed(3)}  centre u ${u.toFixed(3)} v ${v.toFixed(3)}  `
    + `radius ${f.r.toFixed(1)}px  diameter ${((2 * f.r) / rect.width).toFixed(3)} card widths `
    + `(= ${(((2 * f.r) / rect.height) * (1024 / 734)).toFixed(3)} card widths read vertically)`,
  )

  // 2x overlay: high-pass image, card grid, crosshair at (0.5, 0.675), fitted circle.
  const S = 2
  const W = img.w * S
  const H = img.h * S
  const outPx = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = (Math.floor(y / S) * img.w + Math.floor(x / S)) * 4
      const d = (y * W + x) * 4
      outPx[d] = hpPx[s]
      outPx[d + 1] = hpPx[s + 1]
      outPx[d + 2] = hpPx[s + 2]
      outPx[d + 3] = 255
    }
  }
  const blend = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const d = (y * W + x) * 4
    outPx[d] = Math.round(outPx[d] * (1 - a) + r * a)
    outPx[d + 1] = Math.round(outPx[d + 1] * (1 - a) + g * a)
    outPx[d + 2] = Math.round(outPx[d + 2] * (1 - a) + b * a)
  }
  for (let k = 0; k <= 10; k++) {
    const fx = Math.round((rect.x0 + (k / 10) * rect.width) * S)
    const fy = Math.round((rect.y0 + (k / 10) * rect.height) * S)
    for (let t = 0; t < H; t++) blend(fx, t, 255, 70, 70, 0.5)
    for (let t = 0; t < W; t++) blend(t, fy, 255, 70, 70, 0.5)
  }
  const ccx = Math.round((rect.x0 + 0.5 * rect.width) * S)
  const ccy = Math.round((rect.y0 + 0.675 * rect.height) * S)
  for (let t = -16; t <= 16; t++) {
    blend(ccx + t, ccy, 60, 140, 255, 0.95)
    blend(ccx, ccy + t, 60, 140, 255, 0.95)
  }
  for (let k = 0; k < 720; k++) {
    const a = (k / 720) * Math.PI * 2
    for (let t = 0; t < 2; t++) {
      blend(Math.round(f.cx * S + Math.cos(a) * (f.r - t) * S), Math.round(f.cy * S + Math.sin(a) * (f.r - t) * S), 60, 255, 90, 0.95)
    }
  }
  fs.writeFileSync(out, encodePng(W, H, outPx))
  console.log(`  wrote ${out}`)
}

render('tmp/refs/Snorunt-Poke-Ball-Reverse-Holo.png', 'tmp/refs/fit-pokeball.png', 'Poké Ball paper (Snorunt)')
