// Generates the etched normal-map sheets used by textured printings.
//
// Three reliefs ship: `etched` for the later, finer papers, `etched-deep` for the
// heavy Black & White / XY full arts, and `sparkle` — a granular, lattice-free grain
// — for the Shiny Vault finish. The sheets are encoded normal maps (R = x, G = y,
// both 128 = flat), not pictures. Run:
//
//   ./node_modules/.bin/tsx scripts/surface-foil.ts

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { normalMapFromHeight } from '../src/foil/surface'
import { ETCHED_SIZE, etchedDeepHeight, etchedHeight, sparkleHeight } from '../src/foil/surface-map'

const OUT = 'public/foil/surface'

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

const SURFACES = [
  { id: 'etched', height: etchedHeight, strength: 3.2 },
  { id: 'etched-deep', height: etchedDeepHeight, strength: 5.2 },
  { id: 'sparkle', height: sparkleHeight, strength: 2.2 },
]

const size = ETCHED_SIZE
const problems: string[] = []
fs.mkdirSync(OUT, { recursive: true })

for (const surface of SURFACES) {
  const map = normalMapFromHeight(size, size, surface.height, surface.strength)
  const rgba = new Uint8ClampedArray(size * size * 4)
  let sloped = 0
  let sum = 0
  let sum2 = 0
  for (let i = 0, n = size * size; i < n; i++) {
    const nx = map.data[i * 2]
    const ny = map.data[i * 2 + 1]
    rgba[i * 4] = nx
    rgba[i * 4 + 1] = ny
    rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = 255
    const slope = Math.hypot((nx - 127.5) / 127.5, (ny - 127.5) / 127.5)
    if (slope > 0.01) sloped++
    sum += slope
    sum2 += slope * slope
  }
  const mean = sum / (size * size)
  const sd = Math.sqrt(Math.max(0, sum2 / (size * size) - mean * mean))

  // Crossing the wrap should look like any other row step; equality would be the
  // wrong test, because neighbouring rows differ by one pixel of slope by design.
  let wrapStep = 0
  let innerStep = 0
  const midRow = Math.floor(size / 2)
  for (let i = 0; i < size; i++) {
    wrapStep += Math.abs(rgba[i * 4] - rgba[((size - 1) * size + i) * 4])
    wrapStep += Math.abs(rgba[i * 4 + 1] - rgba[((size - 1) * size + i) * 4 + 1])
    innerStep += Math.abs(rgba[(midRow * size + i) * 4] - rgba[((midRow + 1) * size + i) * 4])
    innerStep += Math.abs(rgba[(midRow * size + i) * 4 + 1] - rgba[((midRow + 1) * size + i) * 4 + 1])
  }
  const seam = wrapStep / Math.max(1, innerStep)

  const file = path.join(OUT, `${surface.id}.png`)
  fs.writeFileSync(file, encodePng(size, size, rgba))
  console.log(`${file}: ${size}x${size}, ${((sloped / (size * size)) * 100).toFixed(1)}% sloped, mean slope ${mean.toFixed(3)}, sd ${sd.toFixed(3)}, wrap step ${seam.toFixed(2)}x an inner row`)
  if (sloped / (size * size) < 0.6) problems.push(`${surface.id}: only ${((sloped / (size * size)) * 100).toFixed(1)}% slopes`)
  if (mean < 0.03) problems.push(`${surface.id}: mean slope ${mean.toFixed(4)} too shallow`)
  if (seam > 2.5) problems.push(`${surface.id}: wrap step ${seam.toFixed(2)}x an inner row`)
}

if (problems.length) {
  for (const p of problems) console.log(' -', p)
  process.exitCode = 1
} else console.log('all relief normal maps pass their gates')
