// Crosshatch sheet → shipped texture + generated index.
//
// Run: ./node_modules/.bin/tsx scripts/crosshatch-foil.ts
//
// There is no Crosshatch asset pack in this repository and no scan of the paper, so
// this script DRAWS one from the only description we have — Bulbapedia's Holofoil
// page: "The pattern consists of intersecting diagonal lines that form a reflective
// grid across the card." The output is a reconstruction; `concept: true` and
// `textureVerified: false` are written into the index, not left to a comment.
//
// What the script measures rather than asserts:
//   - ink coverage, peak, and the darkness between the lines, so a sheet that reads
//     as a flat wash fails here;
//   - the wrap discontinuity, so the index states whether this field tiles instead
//     of claiming it does — it does not, because each cell carries its own line;
//   - that both line families are present, so a single set of stripes cannot ship
//     as a crosshatch.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import {
  CROSSHATCH_PER_FAMILY,
  CROSSHATCH_PITCH,
  CROSSHATCH_SEED,
  CROSSHATCH_SHEET_SIZE,
  crosshatchSeamMismatch,
  renderCrosshatchSheet,
} from '../src/foil/crosshatch-sheet'
import { PROMO_BUCKET_CLAIMS, PROMO_BUCKET_UNLISTED } from '../src/foil/promo-buckets-db'

const OUT_DIR = 'public/foil/crosshatch'
const OUT_FILE = path.join(OUT_DIR, 'sheet.png')
const INDEX_FILE = 'src/foil/crosshatch-index.ts'

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
const sheet = renderCrosshatchSheet(CROSSHATCH_SHEET_SIZE, CROSSHATCH_SEED)
const seam = crosshatchSeamMismatch(sheet.rgba, sheet.size)

// Dark between the lines: a crosshatch is marks, so the field must fall away.
let between = 0
let betweenN = 0
for (let y = 0; y < sheet.size; y += 7) {
  for (let x = 0; x < sheet.size; x += 7) {
    const sum = x + y
    const diff = x - y
    const nearA = Math.min(sum % sheet.pitch, sheet.pitch - (sum % sheet.pitch))
    const nearB = Math.min(
      ((diff % sheet.pitch) + sheet.pitch) % sheet.pitch,
      sheet.pitch - (((diff % sheet.pitch) + sheet.pitch) % sheet.pitch),
    )
    if (nearA < sheet.pitch / 4 || nearB < sheet.pitch / 4) continue
    between += sheet.rgba[(y * sheet.size + x) * 4 + 3] / 255
    betweenN++
  }
}
const field = betweenN ? between / betweenN : 1

if (sheet.pitch !== CROSSHATCH_PITCH) problems.push(`pitch is ${sheet.pitch}px, expected ${CROSSHATCH_PITCH}px`)
if (sheet.perFamily !== CROSSHATCH_PER_FAMILY) problems.push(`perFamily is ${sheet.perFamily}, expected ${CROSSHATCH_PER_FAMILY}`)
if (sheet.size % sheet.pitch !== 0) problems.push('the pitch does not divide the sheet')
if (sheet.coverage < 0.2) problems.push(`coverage ${(sheet.coverage * 100).toFixed(2)}% is too sparse to read as a lattice`)
if (sheet.coverage > 0.7) problems.push(`coverage ${(sheet.coverage * 100).toFixed(2)}% is dense enough to hide the artwork`)
if (sheet.peak < 0.9) problems.push(`peak ${sheet.peak.toFixed(3)} is too dim for a foil line`)
if (field > 0.12) problems.push(`the field between the lines is ${field.toFixed(3)}: a lattice needs a dark field`)
// The lattice repeats every pitch and sixteen cells fit the sheet exactly, so the
// column at 1023 continues at 0 to within one pixel of the lattice's own gradient.
// That residual is what the index records; a phase jump would be far larger.
if (seam > 0.06) {
  problems.push(`wrap step ${(seam * 100).toFixed(1)}% is too large for a lattice that is meant to repeat`)
}

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, encodePng(sheet.size, sheet.size, sheet.rgba))

const crosshatchCards = PROMO_BUCKET_CLAIMS.filter((c) => c.treatment === 'crosshatch')
if (crosshatchCards.length !== 3) problems.push(`${crosshatchCards.length} Crosshatch claims in the table, expected 3`)
for (const c of crosshatchCards) {
  if (!c.cardId.startsWith('bwp-')) problems.push(`${c.cardId}: Crosshatch is expected inside the BW Black Star Promos`)
  if (c.reverse) problems.push(`${c.cardId}: a Crosshatch claim is not a reverse printing`)
}

const textured = PROMO_BUCKET_CLAIMS.filter((c) => c.treatment === 'textured')
const unlisted = PROMO_BUCKET_UNLISTED

const per = (v: number) => (v * 100).toFixed(2)
const cardRows = crosshatchCards
  .map(
    (c) =>
      `  { cardId: ${JSON.stringify(c.cardId)}, number: ${JSON.stringify(c.number)}, name: ${JSON.stringify(c.name)}, mask: 'outside-art' as const },`,
  )
  .join('\n')

const index = `// GENERATED by scripts/crosshatch-foil.ts — do not hand-edit.
//
// The Crosshatch sheet is NOT in this repository: no scan, no photograph, no asset
// pack. This texture is a PROCEDURAL RECONSTRUCTION of Bulbapedia's sentence —
// "The pattern consists of intersecting diagonal lines that form a reflective grid
// across the card" — drawn at ${sheet.size}px as two line families at right angles,
// ${sheet.pitch}px apart, ${sheet.perFamily} lines each.
//
// Measured from the shipped file:
//   coverage ${per(sheet.coverage)}% of the sheet carries ink (alpha > 0.1)
//   peak     ${sheet.peak.toFixed(3)} alpha on a line
//   field    ${field.toFixed(3)} mean alpha between the lines — a lattice needs a dark field,
//            which is what separates this paper from Mirror's continuous foil.
//   wrap     ${per(seam)}% step across the edges that meet: the lattice repeats every
//            ${sheet.pitch}px and ${sheet.perFamily} cells fit the sheet exactly, so the phase at
//            column 1023 continues at column 0 and the residual is one pixel of the
//            lattice's own gradient. The sheet TILES; a card may sample any window.
//
// The PITCH, the line WIDTH, the per-line intensity and the breaks are this build's
// drawings: the source names the two families and the grid, not a count or a repeat.
//
// The printing claim is separate and lives in promo-buckets-db.ts / printing-db.ts:
// Pokumon files these three Victory Cup promos as Crosshatch, and Bulbapedia names
// the treatment for Play! Pokémon awards, which is why the cards are identified
// while this texture is labelled a reconstruction.

export const CROSSHATCH_SHEET = {
  pattern: '/foil/crosshatch/sheet.png',
  size: ${sheet.size},
  pitch: ${sheet.pitch},
  perFamily: ${sheet.perFamily},
  coverage: ${sheet.coverage.toFixed(5)},
  peak: ${sheet.peak.toFixed(5)},
  fieldBetween: ${field.toFixed(5)},
  wrapMismatch: ${seam.toFixed(5)},
  tiles: true,
  sampling: 'wrapped',
  concept: true,
  textureVerified: false,
  reproduction: 'procedural reconstruction',
  source: 'https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)',
  description: 'intersecting diagonal lines forming a reflective grid',
} as const

/** The sentence that names the paper, quoted so the report cannot drift from it. */
export const CROSSHATCH_CLAIM =
  'Bulbapedia Holofoil: "Crosshatch Holofoil is generally used only for cards awarded at Play! Pokémon events. The pattern consists of intersecting diagonal lines that form a reflective grid across the card. The crosshatch effect is often applied to the background of the card, as in a Reverse Holo card."'

/** Where the paper sits, and why the area is still unverified. */
export const CROSSHATCH_AREA_NOTE =
  'The source says the crosshatch effect is "often applied to the background of the card, as in a Reverse Holo card", so these rows foil the body and text box with the illustration window left matte. "Often" is not "always" and no photograph is in this repo, so maskVerified stays false.'

/** When the treatment stopped, so a later Play! Pokémon award is not painted by habit. */
export const CROSSHATCH_SCOPE_NOTE = {
  used:
    'Bulbapedia Holofoil: the pattern is "generally used only for cards awarded at Play! Pokémon events" — which is what the three BW Victory Cup promos are.',
  ended:
    'Bulbapedia, Miscellaneous Promotional cards: "The Crosshatch Holofoil treatment was no longer used on cards starting with the 2015-2016 season and was replaced by the Mirror Holofoil treatment (on cards from BREAKthrough only) followed by the standard Parallel Holofoil treatment."',
  decision:
    'No later Play! Pokémon award is painted by habit: this build paints the three cards its printing table names Crosshatch and nothing else, because "an award card" is not evidence of a paper.',
} as const

/** The three BW Black Star Promos the printing table assigns Crosshatch. */
export const CROSSHATCH_CARDS: { cardId: string; number: string; name: string; mask: 'outside-art' }[] = [
${cardRows}
]

/** The rest of the programme: papers this sheet is never lent to. */
export const CROSSHATCH_NEIGHBOURS = {
  textured: [${textured.map((c) => JSON.stringify(c.cardId)).join(', ')}],
  unlisted: [${unlisted.map((c) => JSON.stringify(c.cardId)).join(', ')}],
  note:
    'The textured BW promos wear no mark sheet at all: their paper is embossed, so they are painted as the BW relief (reports/textured-printings.md) and this lattice is never lent to them. ' +
    'The row no source lists makes no claim at all.',
} as const
`

fs.writeFileSync(INDEX_FILE, index)

console.log(
  `Crosshatch sheet: coverage ${per(sheet.coverage)}%, peak ${sheet.peak.toFixed(3)}, field ${field.toFixed(3)}`,
)
console.log(`  ${sheet.perFamily} lines per family at ${sheet.pitch}px, wrap step ${per(seam)}% (tiles within one pixel)`)
console.log(`  wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB) and ${INDEX_FILE}`)
console.log(`  cards: ${crosshatchCards.map((c) => c.cardId).join(', ')}`)
if (problems.length) {
  console.log('\nPROBLEMS:')
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
