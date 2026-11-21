// Second Cosmos probe: is pattern_alpha.png redundant, and what do the marks look like?
//
// Run: ./node_modules/.bin/tsx tmp/cosmos-probe2.ts
//
// The first probe compared the alpha PNG's ALPHA channel to the RGBA's alpha and
// found "different on every pixel" — which is what a greyscale PNG does (its
// alpha is 255 everywhere), not a real disagreement. This compares the alpha
// file's LUMINANCE instead, which is how an opacity map would actually be stored.

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
    } else if (type === 'PLTE') palette = data
    else if (type === 'IDAT') idat.push(data)
    o += 12 + len
  }
  if (depth !== 8) throw new Error('bit depth unsupported')
  const srcCh = color === 0 ? 1 : color === 2 ? 3 : color === 3 ? 1 : color === 4 ? 2 : color === 6 ? 4 : 0
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
    if (color === 6) { px[d] = out[s]; px[d + 1] = out[s + 1]; px[d + 2] = out[s + 2]; px[d + 3] = out[s + 3] }
    else if (color === 2) { px[d] = out[s]; px[d + 1] = out[s + 1]; px[d + 2] = out[s + 2]; px[d + 3] = 255 }
    else if (color === 3) { const idx = out[s] * 3; px[d] = palette ? palette[idx] : 0; px[d + 1] = palette ? palette[idx + 1] : 0; px[d + 2] = palette ? palette[idx + 2] : 0; px[d + 3] = 255 }
    else if (color === 0) { px[d] = px[d + 1] = px[d + 2] = out[s]; px[d + 3] = 255 }
    else { px[d] = px[d + 1] = px[d + 2] = out[s]; px[d + 3] = out[s + 1] }
  }
  return { w, h, ch: 4, px }
}

const luma = (px: Buffer, i: number) => (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255
const PACK = path.join('tmp', 'cosmos-pack')
const VARIANTS = ['classic_dense', 'classic_sparse', 'modern_fine', 'swirl_example']
const num = (n: number, d = 2) => n.toFixed(d)

for (const v of VARIANTS) {
  const dir = path.join(PACK, v)
  const rgba = decodePng(fs.readFileSync(path.join(dir, 'pattern_RGBA.png')))
  const alpha = decodePng(fs.readFileSync(path.join(dir, 'pattern_alpha.png')))
  const n = rgba.w * rgba.h

  let diffLuma = 0
  let diffAlpha = 0
  let maxDiff = 0
  let alphaLumaMean = 0
  for (let i = 0; i < rgba.px.length; i += 4) {
    const al = Math.round(luma(alpha.px, i) * 255)
    const rg = rgba.px[i + 3]
    alphaLumaMean += al / 255
    if (Math.abs(al - rg) > 2) diffLuma++
    if (Math.abs(alpha.px[i + 3] - rg) > 2) diffAlpha++
    if (Math.abs(al - rg) > maxDiff) maxDiff = Math.abs(al - rg)
  }

  // Where is the ink? RGBA alpha histogram + how the RGB is distributed inside it.
  const hist = [0, 0, 0, 0, 0]
  let brightRim = 0
  let dimCore = 0
  let marked = 0
  for (let i = 0; i < rgba.px.length; i += 4) {
    const a = rgba.px[i + 3] / 255
    hist[Math.min(4, Math.floor(a * 5))]++
    if (a > 0.1) {
      marked++
      const l = luma(rgba.px, i)
      if (l > 0.55) brightRim++
      else dimCore++
    }
  }
  // Cluster size: mean run length of alpha>0.4 across rows, as an orb-size proxy.
  let runs = 0
  let runPx = 0
  for (let y = 0; y < rgba.h; y++) {
    let inRun = false
    for (let x = 0; x < rgba.w; x++) {
      const a = rgba.px[(y * rgba.w + x) * 4 + 3] / 255
      if (a > 0.4 && !inRun) { runs++; inRun = true; runPx++ }
      else if (a <= 0.4) inRun = false
      else runPx++
    }
  }

  console.log(`\n=== ${v} ===`)
  console.log(`alpha-file luma vs RGBA alpha: ${num((diffLuma / n) * 100, 1)}% of px differ >2/255 (max ${maxDiff}); vs its own alpha channel: ${num((diffAlpha / n) * 100, 1)}%`)
  console.log(`alpha-file mean luma ${num(alphaLumaMean / n, 3)}`)
  console.log(`RGBA alpha distribution: ${hist.map((h, i) => `${i * 20}-${i * 20 + 20}%:${num((h / n) * 100, 1)}`).join(' ')}`)
  console.log(`marked ${num((marked / n) * 100, 1)}% · of those bright(>0.55) ${num((brightRim / marked) * 100, 0)}% / dim ${num((dimCore / marked) * 100, 0)}%`)
  console.log(`alpha>0.4 runs: ${runs} rows-worth, mean on-run ${num(runPx / Math.max(1, runs), 1)} px at 1024 wide`)
}
