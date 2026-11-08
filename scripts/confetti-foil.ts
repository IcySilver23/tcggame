// Pixel / Confetti sheet → shipped texture + generated index.
//
// Run: ./node_modules/.bin/tsx scripts/confetti-foil.ts
//
// There is no confetti asset pack in this repository and no scan of the paper, so this
// script DRAWS one from the only description we have: Bulbapedia's Holofoil page —
// "Pixel or Confetti Holofoil is used primarily for cards in the McDonald's Collection
// sets, but was also featured on the Celebrations Classic Collection. The pattern
// consists of small, blocky reflective shapes scattered across the image, resembling
// pieces of confetti" — plus the Celebrations page's "feature etching and a Confetti
// Holofoil pattern". The output is a reconstruction; `concept: true` and
// `textureVerified: false` are written into the index, not left to a comment.
//
// What the script measures rather than asserts:
//   - the floor, so a bright field cannot ship as a marked paper;
//   - the peak and the contrast, so a flat fill cannot pass as flakes;
//   - the coverage, so the blocks read without burying the art;
//   - the wrap discontinuity, so "the sheet tiles" is a measurement, not a claim.
//
// It also writes the cards the catalogue holds for the three products Bulbapedia names,
// read from `data/tcglife.db`, so the report and the suite cannot disagree about which
// cards wear this paper.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'
import {
  CONFETTI_CELL,
  CONFETTI_FLOOR,
  CONFETTI_MARK_LINE,
  CONFETTI_SHEET_SIZE,
  confettiSeamMismatch,
  renderConfettiSheet,
} from '../src/foil/confetti-sheet'

const OUT_DIR = 'public/foil/confetti'
const OUT_FILE = path.join(OUT_DIR, 'sheet.png')
const INDEX_FILE = 'src/foil/confetti-index.ts'

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
const sheet = renderConfettiSheet(CONFETTI_SHEET_SIZE)
const seam = confettiSeamMismatch(sheet.rgba, sheet.size)
const contrast = sheet.peak / sheet.floor

if (sheet.floor > 0.1) problems.push(`floor ${sheet.floor.toFixed(3)} is too bright: a marked paper's bare field must stay dark`)
if (sheet.peak < 0.6) problems.push(`peak ${sheet.peak.toFixed(3)} is too dim for a reflective flake`)
if (contrast < 4) problems.push(`contrast ${contrast.toFixed(2)}x is too flat for a block to read as a mark`)
if (sheet.coverage < 0.04 || sheet.coverage > 0.45) {
  problems.push(`coverage ${(sheet.coverage * 100).toFixed(1)}% is outside the confetti range`)
}
if (seam > 0.02) problems.push(`wrap mismatch ${(seam * 100).toFixed(2)}%: the blocks were meant to wrap`)
if (CONFETTI_SHEET_SIZE % CONFETTI_CELL !== 0) problems.push('the cell pitch does not divide the sheet')

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, encodePng(sheet.size, sheet.size, sheet.rgba))

// The three products Bulbapedia names. The McDonald's rows cannot distinguish the
// non-holo printing from the Confetti Holofoil one, and the catalogue carries each card
// once, so every McDonald's row resolves to the paper — a limitation the report states.
const db = new Database('data/tcglife.db', { readonly: true })
const cards = db
  .prepare(
    `select id, set_id, number, name from cards
     where set_id in ('me55c', 'cel25c') or set_id like 'mcd%'
     order by set_id, cast(number as integer)`,
  )
  .all() as { id: string; set_id: string; number: string; name: string }[]
db.close()

const setIds = [...new Set(cards.map((c) => c.set_id))]
for (const required of ['me55c', 'cel25c']) {
  if (!setIds.includes(required)) problems.push(`no cards resolved for ${required}`)
}
if (cards.length < 150) problems.push(`the catalogue holds only ${cards.length} confetti rows`)

const per = (v: number) => (v * 100).toFixed(2)
const cardRows = cards
  .map((c) => `  { cardId: ${JSON.stringify(c.id)}, setId: ${JSON.stringify(c.set_id)}, number: ${JSON.stringify(c.number)}, name: ${JSON.stringify(c.name)} },`)
  .join('\n')

const index = `// GENERATED by scripts/confetti-foil.ts — do not hand-edit.
//
// The Pixel / Confetti sheet is NOT in this repository: no scan, no photograph, no
// asset pack. This texture is a PROCEDURAL RECONSTRUCTION of the pattern Bulbapedia
// describes — "small, blocky reflective shapes scattered across the image, resembling
// pieces of confetti" — drawn at ${sheet.size}px as axis-aligned flakes of 9–28px on a
// ${CONFETTI_CELL}px cell grid, over a dark field.
//
// Measured from the shipped file:
//   coverage ${per(sheet.coverage)}% of the sheet is above the mark line, so the flakes read
//            without burying the art.
//   floor    ${sheet.floor.toFixed(3)} alpha in the bare field: this is a MARKED paper, so the
//            field is dark on purpose — a bright field would stop the blocks reading.
//   peak     ${sheet.peak.toFixed(3)} alpha at a block's body.
//   contrast ${contrast.toFixed(2)}x between a flake and the field beside it.
//   seam     ${per(seam)}% step across the edges that meet when the sheet wraps, so a card
//            may sample any window.
//
// The block sizes, their density on the cell grid and their brightness are this build's
// choice: Bulbapedia names the look and the products, not a repeat or a count. Nothing
// here is embossed as relief, even though the source calls the paper "textured" — depth
// would be a second, unmeasured claim.
//
// The paper is shared by three products, and the catalogue needs no lookup to tell them
// apart: the McDonald's Collections, the Celebrations Classic Collection and the 2026
// 30th Celebration Classic Collection. The McDonald's rows carry both a non-holo and a
// Confetti Holofoil printing in reality and the catalogue holds each card once, so every
// McDonald's row paints the foil — disclosed in the report rather than hidden.

export const CONFETTI_SHEET = {
  pattern: '/foil/confetti/sheet.png',
  size: ${sheet.size},
  cell: ${CONFETTI_CELL},
  coverage: ${sheet.coverage.toFixed(5)},
  floor: ${sheet.floor.toFixed(5)},
  peak: ${sheet.peak.toFixed(5)},
  mean: ${sheet.mean.toFixed(5)},
  markLine: ${CONFETTI_MARK_LINE},
  seamMismatch: ${seam.toFixed(5)},
  tiling: 'disclosed choice: blocks wrap, seam measured',
  concept: true,
  textureVerified: false,
  reproduction: 'procedural reconstruction',
  source: 'https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)',
  description: 'small blocky reflective flakes scattered over a dark field',
} as const

/** What the source says, quoted so the report cannot drift from it. */
export const CONFETTI_CLAIM =
  'Bulbapedia, Holofoil: "Pixel or Confetti Holofoil is used primarily for cards in the McDonald\\'s Collection sets, but was also featured on the Celebrations Classic Collection. The pattern consists of small, blocky reflective shapes scattered across the image, resembling pieces of confetti." Its Celebrations page adds that the 25-card Classic Collection subset cards "feature etching and a Confetti Holofoil pattern".'

/** The McDonald's limitation, stated once so no report has to soften it. */
export const CONFETTI_MCD_CAVEAT =
  'McDonald\\'s Collection cards exist as both Non Holofoil and Confetti Holofoil printings (the 2021 set: "Each card has a Non Holofoil and a Confetti Holofoil print"). The catalogue holds one row per card, so every McDonald\\'s row in this build paints the foil rather than the plain print.'

/** Every card the catalogue holds for the three products. */
export const CONFETTI_CARDS: { cardId: string; setId: string; number: string; name: string }[] = [
${cardRows}
]

/**
 * Cards in these products whose OWN sourced claim outranks the set rule, so they are
 * not painted with this sheet. Listed here rather than filtered silently: the paper is
 * shared, the exception is one card, and the reason is a source.
 */
export const CONFETTI_EXCEPTIONS: { cardId: string; pattern: string | null; reason: string }[] = [
  {
    cardId: 'cel25c-66_A',
    pattern: null,
    reason: 'Shining Magikarp (Celebrations Classic Collection): Bulbapedia says it was "re-released with a Pokémon 25th Anniversary stamp and special textured foil treatment", naming a different finish from the subset’s textured confetti. The per-card claim in shiny-db.ts outranks the set rule, and its paper is unnamed, so this build paints it plain rather than borrowing the confetti flakes.',
  },
]
`

fs.writeFileSync(INDEX_FILE, index)

console.log(`Confetti sheet: coverage ${per(sheet.coverage)}%, floor ${sheet.floor.toFixed(3)}, peak ${sheet.peak.toFixed(3)}, contrast ${contrast.toFixed(1)}x`)
console.log(`  ${CONFETTI_CELL}px cells, wrap step ${per(seam)}%, ${cards.length} cards across ${setIds.length} sets`)
console.log(`  wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB) and ${INDEX_FILE}`)
if (problems.length) {
  console.log('\nPROBLEMS:')
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
