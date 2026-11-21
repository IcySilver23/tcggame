// Draw a card-space grid on a real photograph so a stamp can be read off it.
//
// Run: ./node_modules/.bin/tsx tmp/overlay-ascended-stamp.ts
//
// The card rect comes from the outer border: the strongest luminance gradient
// near each image edge, with the search windows kept narrow enough that the
// printed inner frame, the trainer bar and the copyright line cannot win. Width
// and height are printed against the card's 0.717 aspect, which is the check
// that the rect is right before anything is read from the grid.
//
// The grid is in CARD coordinates: a thin line every 0.05 of the card's width
// and height, a brighter one every 0.10, and a blue crosshair at (0.5, 0.675) —
// where the Energy paper puts its stamp. The image is doubled so the lines are
// readable. Nothing here measures anything by itself; it makes the photo
// measurable by eye.

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

const at = (img: Img, x: number, y: number): number =>
  img.L[Math.max(0, Math.min(img.h - 1, Math.round(y))) * img.w + Math.max(0, Math.min(img.w - 1, Math.round(x)))]

function edgeAlong(img: Img, fixed: number, axis: 'x' | 'y', from: number, to: number): number {
  let best = from
  let bestV = -1
  for (let t = Math.max(4, from); t < Math.min((axis === 'x' ? img.w : img.h) - 4, to); t++) {
    const a = axis === 'x' ? at(img, t - 3, fixed) : at(img, fixed, t - 3)
    const b = axis === 'x' ? at(img, t + 3, fixed) : at(img, fixed, t + 3)
    const d = Math.abs(b - a)
    if (d > bestV) { bestV = d; best = t }
  }
  return best
}

/** Median of a numeric list. */
const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b)
  return s[(s.length - 1) >> 1]
}

function cardRect(img: Img) {
  const lefts: number[] = []
  const rights: number[] = []
  for (const f of [0.4, 0.45, 0.5, 0.55, 0.6]) {
    const row = Math.round(img.h * f)
    lefts.push(edgeAlong(img, row, 'x', 2, Math.round(img.w * 0.12)))
    rights.push(edgeAlong(img, row, 'x', Math.round(img.w * 0.86), img.w - 1))
  }
  const tops: number[] = []
  const bottoms: number[] = []
  for (const f of [0.4, 0.5, 0.6]) {
    const col = Math.round(img.w * f)
    tops.push(edgeAlong(img, col, 'y', 1, Math.round(img.h * 0.055)))
    bottoms.push(edgeAlong(img, col, 'y', Math.round(img.h * 0.945), img.h - 1))
  }
  const x0 = median(lefts)
  const x1 = median(rights)
  return { x0, x1, y0: median(tops), y1: median(bottoms), width: x1 - x0, height: median(bottoms) - median(tops) }
}

function overlay(file: string, out: string, rect: { x0: number; x1: number; y0: number; y1: number; width: number; height: number }) {
  const img = load(file)
  const S = 2
  const W = img.w * S
  const H = img.h * S
  const out_px = Buffer.alloc(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = (Math.floor(y / S) * img.w + Math.floor(x / S)) * 4
      const d = (y * W + x) * 4
      out_px[d] = img.px[s]
      out_px[d + 1] = img.px[s + 1]
      out_px[d + 2] = img.px[s + 2]
      out_px[d + 3] = 255
    }
  }
  const blend = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const d = (y * W + x) * 4
    out_px[d] = Math.round(out_px[d] * (1 - a) + r * a)
    out_px[d + 1] = Math.round(out_px[d + 1] * (1 - a) + g * a)
    out_px[d + 2] = Math.round(out_px[d + 2] * (1 - a) + b * a)
  }
  // Grid every 0.05, brighter every 0.10, in card space and across the whole image.
  for (let k = 0; k <= 20; k++) {
    const f = k / 20
    const gx = Math.round((rect.x0 + f * rect.width) * S)
    const gy = Math.round((rect.y0 + f * rect.height) * S)
    const strong = k % 2 === 0
    for (let y = 0; y < H; y++) {
      for (let t = 0; t < (strong ? 2 : 1); t++) blend(gx + t, y, strong ? 255 : 200, strong ? 60 : 200, 60, strong ? 0.55 : 0.32)
    }
    for (let x = 0; x < W; x++) {
      for (let t = 0; t < (strong ? 2 : 1); t++) blend(x, gy + t, strong ? 255 : 200, strong ? 60 : 200, 60, strong ? 0.55 : 0.32)
    }
  }
  // Crosshair at the Energy paper's stamp centre (0.5, 0.675), for comparison.
  const cx = Math.round((rect.x0 + 0.5 * rect.width) * S)
  const cy = Math.round((rect.y0 + 0.675 * rect.height) * S)
  for (let t = -14; t <= 14; t++) {
    blend(cx + t, cy, 60, 140, 255, 0.9)
    blend(cx, cy + t, 60, 140, 255, 0.9)
  }
  fs.writeFileSync(out, encodePng(W, H, new Uint8ClampedArray(out_px)))
}

const REFS = [
  ['tmp/refs/Snorunt-Poke-Ball-Reverse-Holo.png', 'tmp/refs/grid-pokeball.png', 'Poké Ball paper (Snorunt)'],
  ["tmp/refs/Team-Rockets-Exeggutor-Reverse-Holo.png", 'tmp/refs/grid-r.png', "Team Rocket's R (Exeggutor)"],
  ['tmp/refs/Snorunt-Energy-Reverse-Holo.png', 'tmp/refs/grid-energy.png', 'Energy paper (Snorunt) — control'],
] as const

for (const [file, out, label] of REFS) {
  const img = load(file)
  const rect = cardRect(img)
  console.log(
    `${label}: card rect x ${rect.x0}..${rect.x1} (${rect.width}px) y ${rect.y0}..${rect.y1} (${rect.height}px)`
    + `  aspect ${(rect.width / rect.height).toFixed(3)} (card 0.717) -> ${out}`,
  )
  overlay(file, out, rect)
}
