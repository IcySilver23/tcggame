// Minimal PNG reader for the Node test scripts (this project has no image
// dependency; the pack files are 8-bit, non-interlaced, RGB or RGBA/RG).
import fs from 'node:fs'
import zlib from 'node:zlib'

export type Png = { w: number; h: number; ch: number; px: Buffer }

export function decodePng(file: string): Png {
  const b = fs.readFileSync(file)
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG: ' + file)
  let o = 8
  let w = 0
  let h = 0
  let depth = 0
  let color = 0
  let interlace = 0
  const idat: Buffer[] = []
  while (o < b.length) {
    const len = b.readUInt32BE(o)
    const type = b.toString('ascii', o + 4, o + 8)
    const data = b.subarray(o + 8, o + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      depth = data[8]
      color = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    o += 12 + len
  }
  if (depth !== 8) throw new Error(`bit depth ${depth} unsupported: ${file}`)
  if (interlace !== 0) throw new Error(`interlaced PNG unsupported: ${file}`)
  const ch = color === 6 ? 4 : color === 2 ? 3 : color === 0 ? 1 : 0
  if (!ch) throw new Error(`colour type ${color} unsupported: ${file}`)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = Buffer.alloc(h * stride)
  let p = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[p++]
    const line = raw.subarray(p, p + stride)
    p += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0
      const bp = prev ? prev[x] : 0
      const c = prev && x >= ch ? prev[x - ch] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += bp
      else if (filter === 3) v += (a + bp) >> 1
      else if (filter === 4) {
        const pp = a + bp - c
        const pa = Math.abs(pp - a)
        const pb = Math.abs(pp - bp)
        const pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? bp : c
      }
      cur[x] = v & 255
    }
  }
  // Normalise to RGBA so callers never branch on colour type.
  const px = Buffer.alloc(w * h * 4)
  for (let i = 0, n = w * h; i < n; i++) {
    const s = i * ch
    const d = i * 4
    if (color === 6) { px[d] = out[s]; px[d + 1] = out[s + 1]; px[d + 2] = out[s + 2]; px[d + 3] = out[s + 3] }
    else if (color === 2) { px[d] = out[s]; px[d + 1] = out[s + 1]; px[d + 2] = out[s + 2]; px[d + 3] = 255 }
    else { px[d] = px[d + 1] = px[d + 2] = out[s]; px[d + 3] = 255 }
  }
  return { w, h, ch: 4, px }
}
