// Line sheet → shipped texture + generated index.
//
// Run: ./node_modules/.bin/tsx scripts/line-foil.ts
//
// There is no Line asset pack, scan or photograph in this repository, so this script
// DRAWS the sheet from Bulbapedia's description — "thin vertical lines that refract light
// from the top to the bottom of the Pokémon's image" — and records that it is a drawing.
//
// What it measures rather than asserts:
//   - the vertical pitch repeats exactly, so the stripes are ruled rather than noisy;
//   - the valleys stay bright, because a Line card reads as a vertical sheen and not as
//     bright marks on black;
//   - the wrap step across the sheet's own edges, so "it tiles" is a measurement;
//   - coverage and contrast, so a flat fill cannot pass as ridges.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import {
  LINE_MARK_LINE,
  LINE_PITCH,
  LINE_SHEET_SIZE,
  LINE_VALLEY,
  lineDrift,
  lineInkAt,
  lineInternalStep,
  lineSeamMismatch,
  lineStripeFor,
  renderLineSheet,
} from '../src/foil/line-sheet'

const OUT_DIR = 'public/foil/line'
const OUT_FILE = path.join(OUT_DIR, 'sheet.png')
const INDEX_FILE = 'src/foil/line-index.ts'

// --------------------------------------------------------------------------
// Minimal PNG writer (RGBA8, no interlace), same shape as the other sheets.
// --------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function encodePng(w: number, h: number, rgba: Uint8ClampedArray): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --------------------------------------------------------------------------

const problems: string[] = []
const sheet = renderLineSheet(LINE_SHEET_SIZE)
const seam = lineSeamMismatch(sheet.rgba, sheet.size)
// One pixel of a ridge's own slope is the floor for the wrap step: two adjacent columns
// of a stripe differ by that much inside the sheet, so the seam is continuous when it is
// no larger. A half-pitch phase error shows up here as a step well above this.
const internal = lineInternalStep(sheet.rgba, sheet.size)
const contrast = sheet.peak / sheet.floor

if (sheet.pitch !== LINE_PITCH) problems.push(`pitch is ${sheet.pitch}, expected ${LINE_PITCH}`)
if (LINE_SHEET_SIZE % LINE_PITCH !== 0) problems.push('the pitch does not divide the sheet')
if (sheet.stripes !== LINE_SHEET_SIZE / LINE_PITCH) problems.push(`stripe count ${sheet.stripes} is not size/pitch`)
if (sheet.floor < 0.25) problems.push(`valley ${sheet.floor.toFixed(3)} is too dark: Line is a ruled foil, not a marked paper`)
if (sheet.peak < 0.75) problems.push(`ridge ${sheet.peak.toFixed(3)} is too dim to catch light`)
if (contrast < 1.6) problems.push(`contrast ${contrast.toFixed(2)}x is too flat to read as lines`)
if (sheet.coverage < 0.35 || sheet.coverage > 0.9) problems.push(`coverage ${(sheet.coverage * 100).toFixed(1)}% is outside the ridged range`)
if (seam > internal + 0.01) {
  problems.push(`wrap step ${(seam * 100).toFixed(2)}% exceeds one pixel of the ridge gradient (${(internal * 100).toFixed(2)}%)`)
}

// The field must be a RULED GRID: a ridge peak on every multiple of the pitch, the
// declared valley exactly midway between two of them. Each line carries its own
// brightness, so the check is structural — the whole field neither repeats nor should.
{
  let ruled = true
  for (const i of [0, 1, 7, 64, 127]) {
    const stripe = lineStripeFor(i)
    for (const y of [0, 137, 512, 901]) {
      const expected = Math.min(1, LINE_VALLEY + (stripe.ink * lineDrift(stripe, y, LINE_SHEET_SIZE) - LINE_VALLEY))
      if (Math.abs(lineInkAt(i * LINE_PITCH, y) - expected) > 1e-9) ruled = false
      if (Math.abs(lineInkAt(i * LINE_PITCH + LINE_PITCH / 2, y) - LINE_VALLEY) > 1e-9) ruled = false
    }
  }
  if (!ruled) problems.push('the field is not a ruled grid centred on the pitch')
}

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, encodePng(sheet.size, sheet.size, sheet.rgba))

const per = (v: number) => (v * 100).toFixed(2)

const index = `// GENERATED by scripts/line-foil.ts — do not hand-edit.
//
// The Line sheet is NOT in this repository: no scan, no photograph, no asset pack. This
// texture is a PROCEDURAL RECONSTRUCTION of the pattern Bulbapedia describes — "thin
// vertical lines that refract light from the top to the bottom of the Pokémon's image" —
// drawn at ${sheet.size}px as a ruled foil of ${sheet.stripes} vertical ridges at a
// ${sheet.pitch}px pitch, each ridge's brightness drifting slowly down the sheet.
//
// Measured from the shipped file:
//   coverage ${per(sheet.coverage)}% of the sheet is ridge above the mark line.
//   valley   ${sheet.floor.toFixed(3)} alpha at the dark between two ridges. A Line card reads as a
//            vertical sheen, not as bright marks on black, so the field stays bright and
//            the ridge is what catches light — the opposite of Crosshatch's dark field.
//   ridge    ${sheet.peak.toFixed(3)} alpha at a lit ridge.
//   contrast ${contrast.toFixed(2)}x between ridge and valley.
//   seam     ${per(seam)}% step across the edges that meet when the sheet wraps, so a card
//            may sample any window.
//
// The pitch, the drift depth and the ridge width are this build's choices: the sources
// name the orientation and the fineness of the lines, not a count. Nothing is embossed as
// relief, because no source describes this paper as textured.
//
// The paper is identified at the SET level, not per printing: Bulbapedia says Line ran on
// standard Holo cards from Sword & Shield through Crown Zenith, and no printing record in
// this build claims a Line card. Japanese printings also foil the border; that is not
// modelled here, because this catalogue holds English rows.

export const LINE_SHEET = {
  pattern: '/foil/line/sheet.png',
  size: ${sheet.size},
  pitch: ${sheet.pitch},
  stripes: ${sheet.stripes},
  coverage: ${sheet.coverage.toFixed(5)},
  valley: ${sheet.floor.toFixed(5)},
  peak: ${sheet.peak.toFixed(5)},
  mean: ${sheet.mean.toFixed(5)},
  markLine: ${LINE_MARK_LINE},
  seamMismatch: ${seam.toFixed(5)},
  tiling: 'disclosed choice: pitch divides the sheet, seam measured',
  concept: true,
  textureVerified: false,
  reproduction: 'procedural reconstruction',
  source: 'https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)',
  description: 'thin vertical ridges that refract light top to bottom',
} as const

/** What the source says, quoted so the report cannot drift from it. */
export const LINE_CLAIM =
  'Bulbapedia, Holofoil: "Line Holofoil was used for standard Holo cards from Sword & Shield through Crown Zenith. The pattern consists of thin vertical lines that refract light from the top to the bottom of the Pokémon\\'s image. Japanese cards using the pattern also have Holofoil borders, while international releases retained their yellow borders."'

/** What this build does not claim. */
export const LINE_LIMITATION =
  'The pitch (${sheet.pitch}px, ${sheet.stripes} lines), the ridge width and the depth of the top-to-bottom drift are this build\\'s drawing: the source names the orientation and the fineness of the lines, not a count. The paper is identified at the SET level — no printing record claims a Line card — and Japanese printings\\' foil borders are not modelled because this catalogue holds English rows.'
`

fs.writeFileSync(INDEX_FILE, index)

console.log(`Line sheet: coverage ${per(sheet.coverage)}%, valley ${sheet.floor.toFixed(3)}, ridge ${sheet.peak.toFixed(3)}, contrast ${contrast.toFixed(2)}x`)
console.log(`  pitch ${sheet.pitch}px (${sheet.stripes} lines), wrap step ${per(seam)}%`)
console.log(`  wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB) and ${INDEX_FILE}`)
if (problems.length) {
  console.log('\nPROBLEMS:')
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
