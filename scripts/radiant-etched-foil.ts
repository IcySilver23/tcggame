// Radiant Pokémon sheet → shipped texture + generated index.
//
// Run: ./node_modules/.bin/tsx scripts/radiant-etched-foil.ts
//
// There is no Radiant Pokémon asset pack in this repository and no scan of the paper,
// so this script DRAWS one from the only descriptions we have: Bulbapedia's Rarity page
// ("They have a special holofoil layer") and a collector foil guide ("etched, embossed
// silver foil covering the entire card"), plus an account of textured foil on the figure
// with a geometric pattern running through the body. The output is a reconstruction;
// `concept: true` and `textureVerified: false` are written into the index, not left to a
// comment somewhere.
//
// What the script measures rather than asserts:
//   - the floor, so silver that stops reflecting fails here;
//   - the peak and the contrast, so a flat fill cannot ship as a lattice;
//   - the coverage, so the etch has to cover enough to read and not so much that it
//     hides the art;
//   - the wrap discontinuity, so "this tiles" is a measurement, not a claim.
//
// It also writes the fifteen Radiant Pokémon the catalogue holds, read from
// `data/tcglife.db`, so the report and the suite cannot disagree about which cards wear
// this paper.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'
import {
  RADIANT_ETCHED_COARSE_PERIOD,
  RADIANT_ETCHED_COARSE_WIDTH,
  RADIANT_ETCHED_FINE_PERIOD,
  RADIANT_ETCHED_FINE_WIDTH,
  RADIANT_ETCHED_FLOOR,
  RADIANT_ETCHED_PEAK,
  RADIANT_ETCHED_SHEET_SIZE,
  radiantEtchedInkAt,
  radiantEtchedSeamMismatch,
  renderRadiantEtchedSheet,
} from '../src/foil/radiant-etched-sheet'

const OUT_DIR = 'public/foil/radiant-etched'
const OUT_FILE = path.join(OUT_DIR, 'sheet.png')
const INDEX_FILE = 'src/foil/radiant-etched-index.ts'
const SETS = ['swsh10', 'swsh11', 'swsh12', 'swsh12pt5', 'pgo']

// --------------------------------------------------------------------------
// Minimal PNG writer (RGBA8, no interlace). Same shape as the other sheets.
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
const sheet = renderRadiantEtchedSheet(RADIANT_ETCHED_SHEET_SIZE)
const seam = radiantEtchedSeamMismatch(sheet.rgba, sheet.size)

if (sheet.floor < 0.3) problems.push(`floor ${sheet.floor.toFixed(3)} lets the silver go dark, which a foil paper does not`)
if (sheet.peak > 0.95) problems.push(`peak ${sheet.peak.toFixed(3)} leaves no headroom for the reflection`)
if (sheet.peak / sheet.floor < 1.7) {
  problems.push(`contrast ${(sheet.peak / sheet.floor).toFixed(2)}x is too flat for a mark to read as a mark`)
}
if (sheet.coverage < 0.2 || sheet.coverage > 0.7) {
  problems.push(`coverage ${(sheet.coverage * 100).toFixed(1)}% is outside the etched-paper range`)
}
if (seam > 0.02) problems.push(`wrap mismatch ${(seam * 100).toFixed(2)}%: the sheet was meant to tile`)
if (RADIANT_ETCHED_SHEET_SIZE % RADIANT_ETCHED_FINE_PERIOD !== 0) problems.push('the fine period does not divide the sheet')
if (RADIANT_ETCHED_SHEET_SIZE % RADIANT_ETCHED_COARSE_PERIOD !== 0) problems.push('the coarse period does not divide the sheet')

// The lattice must repeat exactly when translated by the COARSE period, which is the
// multiple both families share: that is what makes the wrap a continuation rather than
// a seam. Translating by the fine period alone must NOT be identical, or the coarse
// grid is not there.
{
  let coarseDiffers = 0
  for (let y = 3; y < 200; y += 17) {
    for (let x = 5; x < 200; x += 19) {
      if (radiantEtchedInkAt(x, y) !== radiantEtchedInkAt(x + RADIANT_ETCHED_COARSE_PERIOD, y + RADIANT_ETCHED_COARSE_PERIOD)) {
        problems.push(`the lattice is not periodic at ${RADIANT_ETCHED_COARSE_PERIOD}px (${x}, ${y})`)
      }
      if (radiantEtchedInkAt(x, y) !== radiantEtchedInkAt(x + RADIANT_ETCHED_FINE_PERIOD, y + RADIANT_ETCHED_FINE_PERIOD)) {
        coarseDiffers++
      }
    }
  }
  if (coarseDiffers === 0) problems.push('the coarse diamond grid is invisible: every point repeats at the fine period')
}

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, encodePng(sheet.size, sheet.size, sheet.rgba))

const db = new Database('data/tcglife.db', { readonly: true })
const cards = db
  .prepare(
    `select id, set_id, number, name from cards
     where set_id in (${SETS.map(() => '?').join(',')}) and rarity = 'Radiant Rare'
     order by set_id, cast(number as integer)`,
  )
  .all(...SETS) as { id: string; set_id: string; number: string; name: string }[]
db.close()

if (cards.length !== 15) problems.push(`the catalogue holds ${cards.length} Radiant Pokémon rows, expected 15`)
for (const card of cards) {
  if (!card.name.startsWith('Radiant ')) problems.push(`${card.id}: the card name does not start with "Radiant "`)
}

const per = (v: number) => (v * 100).toFixed(2)
const cardRows = cards
  .map(
    (c) =>
      `  { cardId: ${JSON.stringify(c.id)}, setId: ${JSON.stringify(c.set_id)}, number: ${JSON.stringify(c.number)}, name: ${JSON.stringify(c.name)} },`,
  )
  .join('\n')

const index = `// GENERATED by scripts/radiant-etched-foil.ts — do not hand-edit.
//
// The Radiant Pokémon sheet is NOT in this repository: no scan, no photograph, no asset
// pack. This texture is a PROCEDURAL RECONSTRUCTION of the finish the sources describe
// — Bulbapedia's "They have a special holofoil layer" and a collector guide's "etched,
// embossed silver foil covering the entire card" — drawn at ${sheet.size}px as a fine
// etched lattice (${RADIANT_ETCHED_FINE_PERIOD}px) inside a coarser diamond grid
// (${RADIANT_ETCHED_COARSE_PERIOD}px).
//
// Measured from the shipped file:
//   coverage ${per(sheet.coverage)}% of the sheet is above the mid-ink line, so the etch
//            reads without hiding the art.
//   floor    ${sheet.floor.toFixed(3)} alpha at the dimmest point: silver foil never
//            goes dark the way a marked paper's bare field does.
//   peak     ${sheet.peak.toFixed(3)} alpha at the brightest ridge.
//   contrast ${(sheet.peak / sheet.floor).toFixed(2)}x between a ridge and the field.
//   seam     ${per(seam)}% step across the edges that meet when the sheet wraps, so a
//            card may sample any window.
//
// The PITCH, the ridge widths and the contrast are this build's choice: the sources
// name the finish and its area, not a repeat. Nothing here is embossed as relief —
// depth would be a second, unmeasured claim.
//
// Radiant Pokémon is NOT Radiant Collection: the 2013 RC subset has one concept motif
// per card (\`radiant\`), while this is the 2022 etched silver paper. The two must never
// share a lookup.

export const RADIANT_ETCHED_SHEET = {
  pattern: '/foil/radiant-etched/sheet.png',
  size: ${sheet.size},
  coverage: ${sheet.coverage.toFixed(5)},
  floor: ${sheet.floor.toFixed(5)},
  peak: ${sheet.peak.toFixed(5)},
  mean: ${sheet.mean.toFixed(5)},
  finePeriod: ${RADIANT_ETCHED_FINE_PERIOD},
  coarsePeriod: ${RADIANT_ETCHED_COARSE_PERIOD},
  fineWidth: ${RADIANT_ETCHED_FINE_WIDTH},
  coarseWidth: ${RADIANT_ETCHED_COARSE_WIDTH},
  seamMismatch: ${seam.toFixed(5)},
  tiling: 'disclosed choice',
  concept: true,
  textureVerified: false,
  reproduction: 'procedural reconstruction',
  source: 'https://bulbapedia.bulbagarden.net/wiki/Rarity',
  description: 'a fine etched lattice inside a wider diamond grid, over bright silver',
} as const

/** What the sources say, quoted so the report cannot drift from them. */
export const RADIANT_ETCHED_CLAIM =
  'Bulbapedia Rarity on Radiant Pokémon: "They have a special holofoil layer." A collector foil guide describes the finish as "etched, embossed silver foil covering the entire card", and a second account puts textured foil on the Pokémon figure with a geometric pattern running through the card body.'

/** The separation that matters more than any single look. */
export const RADIANT_ETCHED_SEPARATION =
  'Radiant Pokémon (Astral Radiance onward, 2022) is not Radiant Collection (Legendary Treasures RC, Generations RC, 2013). The RC subset is \`radiant\`: one reconstructed concept motif per card. This paper is \`radiant-etched\`: etched silver across the whole card. The two share a word and nothing else, and no lookup may answer one with the other.'

/** The fifteen Radiant Pokémon the catalogue holds. */
export const RADIANT_ETCHED_CARDS: { cardId: string; setId: string; number: string; name: string }[] = [
${cardRows}
]
`

fs.writeFileSync(INDEX_FILE, index)

console.log(`Radiant Pokémon sheet: coverage ${per(sheet.coverage)}%, floor ${sheet.floor.toFixed(3)}, peak ${sheet.peak.toFixed(3)}`)
console.log(`  ${RADIANT_ETCHED_FINE_PERIOD}px etch + ${RADIANT_ETCHED_COARSE_PERIOD}px grid, wrap step ${per(seam)}%, ${cards.length} cards`)
console.log(`  wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB) and ${INDEX_FILE}`)
if (problems.length) {
  console.log('\nPROBLEMS:')
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
