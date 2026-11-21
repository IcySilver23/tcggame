// What the Cosmos pack actually contains, measured rather than assumed.
//
// Run: ./node_modules/.bin/tsx tmp/cosmos-probe.ts
//
// Questions this answers before any renderer code is written:
//   - size and colour type of each variant;
//   - is pattern_alpha.png a duplicate of the RGBA alpha (as in the Radiant pack)?
//   - how much of the tile carries a mark (coverage), and how bright it gets;
//   - do the edges continue across a repeat, or is the variant a one-shot card map?
//   - what the example masks look like (they are explicitly NOT to be used).

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

type Png = { w: number; h: number; ch: number; px: Buffer }

function decodePng(buf: Buffer): Png {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let o = 8
  let w = 0
  let h = 0
  let depth = 0
  let color = 0
  let interlace = 0
  let palette: Buffer | null = null
  const idat: Buffer[] = []
  while (o < buf.length) {
    const len = buf.readUInt32BE(o)
    const type = buf.toString('ascii', o + 4, o + 8)
    const data = buf.subarray(o + 8, o + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      depth = data[8]
      color = data[9]
      interlace = data[12]
    } else if (type === 'PLTE') palette = data
    else if (type === 'IDAT') idat.push(data)
    o += 12 + len
  }
  if (depth !== 8) throw new Error(`bit depth ${depth} unsupported`)
  if (interlace !== 0) throw new Error('interlaced PNG unsupported')
  const srcCh = color === 0 ? 1 : color === 2 ? 3 : color === 3 ? 1 : color === 4 ? 2 : color === 6 ? 4 : 0
  if (!srcCh) throw new Error(`colour type ${color} unsupported`)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * srcCh
  const out = Buffer.alloc(h * stride)
  let p = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[p++]
    const line = raw.subarray(p, p + stride)
    p += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= srcCh ? cur[x - srcCh] : 0
      const bp = prev ? prev[x] : 0
      const c = prev && x >= srcCh ? prev[x - srcCh] : 0
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

  const px = Buffer.alloc(w * h * 4)
  for (let i = 0, n = w * h; i < n; i++) {
    const s = i * srcCh
    const d = i * 4
    if (color === 6) {
      px[d] = out[s]; px[d + 1] = out[s + 1]; px[d + 2] = out[s + 2]; px[d + 3] = out[s + 3]
    } else if (color === 2) {
      px[d] = out[s]; px[d + 1] = out[s + 1]; px[d + 2] = out[s + 2]; px[d + 3] = 255
    } else if (color === 3) {
      const idx = out[s] * 3
      px[d] = palette ? palette[idx] : 0
      px[d + 1] = palette ? palette[idx + 1] : 0
      px[d + 2] = palette ? palette[idx + 2] : 0
      px[d + 3] = 255
    } else if (color === 0) {
      px[d] = px[d + 1] = px[d + 2] = out[s]; px[d + 3] = 255
    } else {
      px[d] = px[d + 1] = px[d + 2] = out[s]; px[d + 3] = out[s + 1]
    }
  }
  return { w, h, ch: 4, px }
}

const PACK = path.join('tmp', 'cosmos-pack')
const VARIANTS = ['classic_dense', 'classic_sparse', 'modern_fine', 'swirl_example']
const pad = (s: string | number, n: number) => String(s).padEnd(n)
const num = (n: number, d = 2) => n.toFixed(d)

for (const v of VARIANTS) {
  const dir = path.join(PACK, v)
  const rgba = decodePng(fs.readFileSync(path.join(dir, 'pattern_RGBA.png')))
  const alpha = decodePng(fs.readFileSync(path.join(dir, 'pattern_alpha.png')))
  const mask = decodePng(fs.readFileSync(path.join(dir, 'EXAMPLE_illustration_window_mask_NOT_VERIFIED.png')))

  // Alpha file vs the RGBA's own alpha.
  let alphaDiff = 0
  if (alpha.w !== rgba.w || alpha.h !== rgba.h) alphaDiff = -1
  else for (let i = 0; i < rgba.px.length; i += 4) if (rgba.px[i + 3] !== alpha.px[i + 3]) alphaDiff++

  // Mark statistics: luminance weighted by alpha.
  let markSum = 0
  let markMax = 0
  let covered = 0
  let opaque = 0
  const n = rgba.w * rgba.h
  const lumaAt = (i: number) => (0.2126 * rgba.px[i] + 0.7152 * rgba.px[i + 1] + 0.0722 * rgba.px[i + 2]) / 255
  for (let i = 0; i < rgba.px.length; i += 4) {
    const a = rgba.px[i + 3] / 255
    const m = lumaAt(i) * a
    markSum += m
    if (m > markMax) markMax = m
    if (a > 0.1) opaque++
    if (m > 0.1) covered++
  }

  // Seam test at the actual card render size (200x279): compare the light
  // continuing across the wrap with the light continuing inside the tile.
  const W = 200
  const H = 279
  const sample = (u: number, v: number) => {
    const x = Math.min(rgba.w - 1, Math.max(0, Math.floor(u * rgba.w)))
    const y = Math.min(rgba.h - 1, Math.max(0, Math.floor(v * rgba.h)))
    return lumaAt((y * rgba.w + x) * 4) * (rgba.px[(y * rgba.w + x) * 4 + 3] / 255)
  }
  let seamH = 0
  let insideH = 0
  let seamV = 0
  let insideV = 0
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H
    seamH += Math.abs(sample(0.999, v) - sample(0.001, v))
    insideH += Math.abs(sample(0.5, v) - sample(0.502, v))
  }
  for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W
    seamV += Math.abs(sample(u, 0.999) - sample(u, 0.001))
    insideV += Math.abs(sample(u, 0.5) - sample(u, 0.502))
  }

  // What the example mask is: a card-shaped window, drawn but unverified.
  let maskWhite = 0
  let maskMid = 0
  for (let i = 0; i < mask.px.length; i += 4) {
    const l = lumaAt2(mask.px, i)
    if (l > 0.9) maskWhite++
    else if (l > 0.05) maskMid++
  }
  function lumaAt2(px: Buffer, i: number) {
    return (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255
  }

  console.log(`\n=== ${v} ===`)
  console.log(`rgba ${rgba.w}x${rgba.h} ch${rgba.ch} · alpha ${alpha.w}x${alpha.h} · mask ${mask.w}x${mask.h}`)
  console.log(`alpha file differs from RGBA alpha on ${alphaDiff === -1 ? 'size mismatch' : alphaDiff + ' px'}`)
  console.log(`mark mean ${num(markSum / n, 3)} · peak ${num(markMax, 3)} · opaque ${num((opaque / n) * 100, 1)}% · marked >0.1 ${num((covered / n) * 100, 1)}%`)
  console.log(`seam across wrap: horizontal ${num(seamH / H / 2, 4)} vertical ${num(seamV / W / 2, 4)} · inside tile ${num(insideH / H / 2, 4)} / ${num(insideV / W / 2, 4)}`)
  console.log(`example mask: ${num((maskWhite / (mask.w * mask.h)) * 100, 1)}% white, ${num((maskMid / (mask.w * mask.h)) * 100, 1)}% partial (NOT used)`)
}
