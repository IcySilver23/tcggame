// Generates assets/icon.png (256x256) — the TCG Life mark: a trading card
// tilted over a Pokéball-style ball, on a rounded navy tile. Pure TypeScript
// (no image deps): scanline/SDF rasterizer with 2x2 supersampling, then a
// hand-rolled PNG encoder. `python scripts/png-to-ico.py` packs the .ico.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const S = 256
type RGB = [number, number, number]

// --- palette ---------------------------------------------------------------
const TILE_A: RGB = [24, 33, 59]     // navy tile top
const TILE_B: RGB = [15, 21, 40]     // navy tile bottom
const CARD_FACE: RGB = [245, 246, 250]
const CARD_EDGE: RGB = [205, 210, 222]
const CARD_BACK: RGB = [56, 97, 190] // the blue card back
const BALL_TOP: RGB = [238, 68, 60]
const BALL_BOT: RGB = [235, 235, 240]
const BALL_BAND: RGB = [26, 30, 44]

// --- geometry helpers (signed distance style) ------------------------------
const sdCircle = (px: number, py: number, cx: number, cy: number, r: number) =>
  Math.hypot(px - cx, py - cy) - r

function sdRoundRect(px: number, py: number, cx: number, cy: number, hw: number, hh: number, rad: number): number {
  const dx = Math.abs(px - cx) - (hw - rad)
  const dy = Math.abs(py - cy) - (hh - rad)
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - rad
}

/** Rotate a point around (cx,cy) by -ang (so shapes drawn at +ang appear tilted). */
function rot(px: number, py: number, cx: number, cy: number, ang: number): [number, number] {
  const c = Math.cos(-ang), s = Math.sin(-ang)
  const dx = px - cx, dy = py - cy
  return [cx + dx * c - dy * s, cy + dx * s + dy * c]
}

// --- the mark, in paint order ----------------------------------------------
// Returns coverage (0..1-ish) and sets the color for pixel (x, y).
function paint(x: number, y: number): { a: number; c: RGB } | null {
  // 1) rounded tile with a subtle vertical gradient
  const tile = sdRoundRect(x, y, S / 2, S / 2, S / 2 - 4, S / 2 - 4, 52)
  if (tile > 1) return null
  const t = Math.min(1, Math.max(0, (y / S - 0.5) * 1.4 + 0.5))
  const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
  let col = mix(TILE_A, TILE_B, t)

  // 2) Pokéball-style ball, lower right of center
  const bx = S * 0.60, by = S * 0.605, br = S * 0.215
  const dB = sdCircle(x, y, bx, by, br)
  if (dB < 1) {
    const bt = Math.min(1, Math.max(0, (y - (by - br)) / (2 * br)))
    col = mix(BALL_TOP, BALL_BOT, bt < 0.5 ? 0 : 1) // hard hemisphere split
    if (y > by) col = mix(BALL_TOP, BALL_BOT, Math.min(1, (y - by) / (br * 0.9) + 0.15))
    // center band
    const band = Math.abs(y - by) - S * 0.022
    if (band < 0) col = BALL_BAND
    // button
    const dBt = sdCircle(x, y, bx, by, S * 0.052)
    if (dBt < 0) col = CARD_FACE
    const dBt2 = sdCircle(x, y, bx, by, S * 0.026)
    if (dBt2 < 0) col = BALL_BAND
    if (dB < -1.2) return { a: 1, c: col }
    return { a: 1 - Math.max(0, dB), c: col }
  }

  // 3) trading card, tilted, upper left — drawn over a soft shadow
  const ang = -0.30
  const cx = S * 0.435, cy = S * 0.42
  const [rx, ry] = rot(x, y, cx, cy, ang)
  const card = sdRoundRect(rx, ry, cx, cy, S * 0.155, S * 0.215, S * 0.02)
  if (card < 1) {
    if (card < -1.2) col = CARD_FACE
    else return { a: 1 - Math.max(0, card), c: CARD_EDGE }
    // blue card back inset
    const inner = sdRoundRect(rx, ry, cx, cy, S * 0.125, S * 0.185, S * 0.014)
    if (inner < 0) {
      col = CARD_BACK
      // inner ring ornament
      const ring = Math.abs(Math.hypot(rx - cx, ry - cy) - S * 0.105) - S * 0.014
      if (ring < 0) col = mix(CARD_BACK, [255, 255, 255], 0.25)
      const dot = sdCircle(rx, ry, cx, cy, S * 0.038)
      if (dot < 0) col = mix(CARD_BACK, [255, 255, 255], 0.45)
    }
    return { a: 1, c: col }
  }

  // soft card shadow on the tile (cheap: blurred band along the card's lower edge)
  const [sx, sy] = rot(x, y, cx + 5, cy + 7, ang)
  const shadow = sdRoundRect(sx, sy, cx + 5, cy + 7, S * 0.155, S * 0.215, S * 0.02)
  if (shadow < 6) {
    const k = Math.max(0, 1 - shadow / 6) * 0.35
    col = mix(col, [0, 0, 0], k)
  }

  return { a: 1, c: col }
}

// --- rasterize with 2x2 supersampling --------------------------------------
const raw = Buffer.alloc(S * S * 3)
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, cov = 0
    for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const p = paint(x + ox, y + oy)
      if (p) {
        // transparent pixels outside the tile composite over a dark backdrop
        r += p.c[0] * p.a; g += p.c[1] * p.a; b += p.c[2] * p.a
        cov += p.a
      }
    }
    const i = (y * S + x) * 3
    if (cov > 0) {
      raw[i] = Math.round(r / cov); raw[i + 1] = Math.round(g / cov); raw[i + 2] = Math.round(b / cov)
    } else {
      raw[i] = 10; raw[i + 1] = 12; raw[i + 2] = 20
    }
  }
}

// --- PNG encode (color type 2, truecolor) ----------------------------------
function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
const stride = S * 3
const scan = Buffer.alloc((stride + 1) * S)
for (let y = 0; y < S; y++) {
  scan[y * (stride + 1)] = 0 // filter: none
  raw.copy(scan, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(scan, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(dirname('assets/icon.png'), { recursive: true })
writeFileSync('assets/icon.png', png)
console.log(`assets/icon.png written (${png.length} bytes)`)
