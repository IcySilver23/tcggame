// Sequin sheet → shipped texture + generated index.
//
// Run: ./node_modules/.bin/tsx scripts/sequin-foil.ts
//
// There is no sequin asset pack in this repository, no scan and no angled photograph,
// so this script DRAWS one from the only description there is — Bulbapedia's Holofoil
// page: "The Sequin holofoil was first introduced in August, 2017, and is exclusively
// used for General Mills promotional cards ... The pattern consists of many small
// reflective geometric shapes scattered across the image, giving it a sequined
// appearance." The output is a reconstruction; `concept: true` and
// `textureVerified: false` are written into the index, not left to a comment.
//
// What the script measures rather than asserts:
//   - the floor, so a bright field cannot ship as a marked paper;
//   - the peak and the contrast, so a flat fill cannot pass as shapes;
//   - the coverage, so the marks read without burying the art;
//   - the mark count, so "many small shapes" is a number;
//   - the wrap discontinuity, so "the sheet tiles" is a measurement, not a claim.
//
// It also sweeps the catalogue through `holoFor` and records every card that resolves
// to this paper: the 19 General Mills printings that `printing-db.ts` names from
// Bulbapedia's per-series Sequin tables. The list is generated from the resolution, so a
// printing record that stops resolving drops its card here on the next run.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'
import {
  SEQUIN_CELL,
  SEQUIN_FLOOR,
  SEQUIN_MARK_LINE,
  SEQUIN_MAX_RADIUS,
  SEQUIN_MAX_SIDES,
  SEQUIN_MIN_RADIUS,
  SEQUIN_MIN_SIDES,
  SEQUIN_SHEET_SIZE,
  renderSequinSheet,
  sequinInternalStep,
  sequinSeamMismatch,
} from '../src/foil/sequin-sheet'
import { holoFor } from '../src/holo'
import { SEQUIN_VARIANT } from '../src/foil/printing-db'

const OUT_DIR = 'public/foil/sequin'
const OUT_FILE = path.join(OUT_DIR, 'sheet.png')
const INDEX_FILE = 'src/foil/sequin-index.ts'

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
const sheet = renderSequinSheet(SEQUIN_SHEET_SIZE)
const seam = sequinSeamMismatch(sheet.rgba, sheet.size)
// A dense field's seam is not near zero: two unrelated columns differ about as much as
// any neighbours. Continuity means the seam is no larger than the sheet's own step.
const internal = sequinInternalStep(sheet.rgba, sheet.size)
const contrast = sheet.peak / sheet.floor

if (sheet.floor > 0.1) problems.push(`floor ${sheet.floor.toFixed(3)} is too bright: a marked paper's bare field must stay dark`)
if (sheet.peak < 0.6) problems.push(`peak ${sheet.peak.toFixed(3)} is too dim for a reflective shape`)
if (contrast < 4) problems.push(`contrast ${contrast.toFixed(2)}x is too flat for a shape to read as a mark`)
if (sheet.coverage < 0.08 || sheet.coverage > 0.4) {
  problems.push(`coverage ${(sheet.coverage * 100).toFixed(1)}% is outside the sequin range`)
}
if (sheet.marks < 1500) problems.push(`only ${sheet.marks} marks on the sheet: the source says many shapes`)
if (seam > internal * 1.15) {
  problems.push(`wrap step ${(seam * 100).toFixed(2)}% exceeds the sheet's own ${(internal * 100).toFixed(2)}% by more than 15%: the marks were meant to wrap`)
}
if (SEQUIN_SHEET_SIZE % SEQUIN_CELL !== 0) problems.push('the cell pitch does not divide the sheet')

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, encodePng(sheet.size, sheet.size, sheet.rgba))

// The cards the renderer actually gives this paper: the rows `printing-db.ts` resolves to
// the Sequin paper from Bulbapedia's per-series tables, never a set rule.
const db = new Database('data/tcglife.db', { readonly: true })
const rows = db.prepare('select id, set_id, number, name from cards order by id').all() as
  { id: string; set_id: string; number: string; name: string }[]
db.close()

const cards = rows.filter((row) => {
  const art = holoFor({ cardId: row.id, variant: SEQUIN_VARIANT })
  return art?.pattern === 'sequin'
})

const per = (v: number) => (v * 100).toFixed(2)
const cardRows = cards
  .map((c) => `  { cardId: ${JSON.stringify(c.id)}, setId: ${JSON.stringify(c.set_id)}, number: ${JSON.stringify(c.number)}, name: ${JSON.stringify(c.name)} },`)
  .join('\n')

const index = `// GENERATED by scripts/sequin-foil.ts — do not hand-edit.
//
// The Sequin sheet is NOT in this repository: no scan, no photograph, no asset pack.
// This texture is a PROCEDURAL RECONSTRUCTION of the pattern Bulbapedia describes —
// "many small reflective geometric shapes scattered across the image, giving it a
// sequined appearance" — drawn at ${sheet.size}px as regular polygons of ${SEQUIN_MIN_SIDES}–${SEQUIN_MAX_SIDES} sides with a
// circumradius of ${SEQUIN_MIN_RADIUS}–${SEQUIN_MAX_RADIUS}px on a ${SEQUIN_CELL}px cell grid, over a dark field.
//
// Measured from the shipped file:
//   marks    ${sheet.marks} shapes, so "many small shapes" is counted rather than claimed.
//   coverage ${per(sheet.coverage)}% of the sheet is above the mark line, so the shapes read
//            without burying the art.
//   floor    ${sheet.floor.toFixed(3)} alpha in the bare field: this is a MARKED paper, so the
//            field is dark on purpose — a bright field would stop the shapes reading.
//   peak     ${sheet.peak.toFixed(3)} alpha at a shape's body.
//   contrast ${contrast.toFixed(2)}x between a shape and the field beside it.
//   seam     ${per(seam)}% step across the edges that meet when the sheet wraps, against
//            ${per(internal)}% between neighbouring pixels inside the sheet — the same order, so
//            the wrap is continuous and a card may sample any window.
//
// The side count, radii, density and brightness are this build's choice: Bulbapedia names
// the look, the products and the year, not a count, a size or a repeat. The polygons are
// what separate this paper from Pixel / Confetti, whose flakes are axis-aligned rectangles.
//
// The cards below are the General Mills printings Bulbapedia's Sequin tables name, resolved
// in src/foil/printing-db.ts for the explicit \`sequinHolofoil\` variant. The plain promo of the
// same number is a different physical printing and makes no foil claim, so the two can sit in
// a save as separate rows. The list is generated from the sweep, never hand-written.

export const SEQUIN_SHEET = {
  pattern: '/foil/sequin/sheet.png',
  size: ${sheet.size},
  cell: ${SEQUIN_CELL},
  sides: [${SEQUIN_MIN_SIDES}, ${SEQUIN_MAX_SIDES}],
  radius: [${SEQUIN_MIN_RADIUS}, ${SEQUIN_MAX_RADIUS}],
  marks: ${sheet.marks},
  coverage: ${sheet.coverage.toFixed(5)},
  floor: ${sheet.floor.toFixed(5)},
  peak: ${sheet.peak.toFixed(5)},
  mean: ${sheet.mean.toFixed(5)},
  markLine: ${SEQUIN_MARK_LINE},
  seamMismatch: ${seam.toFixed(5)},
  internalStep: ${internal.toFixed(5)},
  tiling: 'disclosed choice: marks wrap, seam measured',
  concept: true,
  textureVerified: false,
  reproduction: 'procedural reconstruction',
  source: 'https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)',
  description: 'many small reflective polygons scattered over a dark field',
} as const

/** What the source says, quoted so the report cannot drift from it. */
export const SEQUIN_CLAIM =
  'Bulbapedia, Holofoil: "The Sequin holofoil was first introduced in August, 2017, and is exclusively used for General Mills promotional cards, including the General Mills Sun & Moon Mini Packs, General Mills Let\\'s Go, Kanto! Mini Packs and the latest General Mills 25th Anniversary Mini Packs. The pattern consists of many small reflective geometric shapes scattered across the image, giving it a sequined appearance."'

/** Every catalogued card the renderer gives this paper. */
export const SEQUIN_CARDS: { cardId: string; setId: string; number: string; name: string }[] = [
${cardRows}
]

/** The limitation that travels with the list, stated once so no report has to soften it. */
export const SEQUIN_CARDS_CAVEAT =
  'The 19 cards in the generated list are the printings Bulbapedia’s Sequin tables name, and each resolves by card id in printing-db.ts only for the explicit sequinHolofoil variant. Every one of those numbers was also distributed another way — the same promo in a blister, the same set card in a booster — and that plain copy is a different physical printing: it makes no foil claim here, and a save can hold both copies as separate inventory rows. The three General Mills mini packs are sealed products of their own (server/catalog/general-mills.ts) and roll exactly these printings, so the variant is both the identity the paper renders on and the printing the pack hands out.'
`

fs.writeFileSync(INDEX_FILE, index)

console.log(`Sequin sheet: ${sheet.marks} marks, coverage ${per(sheet.coverage)}%, floor ${sheet.floor.toFixed(3)}, peak ${sheet.peak.toFixed(3)}, contrast ${contrast.toFixed(1)}x`)
console.log(`  ${SEQUIN_CELL}px cells, wrap step ${per(seam)}% vs ${per(internal)}% internal, ${cards.length} catalogue cards resolve to it`)
console.log(`  wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB) and ${INDEX_FILE}`)
if (problems.length) {
  console.log('\nPROBLEMS:')
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
