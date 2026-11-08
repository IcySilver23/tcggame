// Tinsel sheet → shipped texture + generated index.
//
// Run: ./node_modules/.bin/tsx scripts/tinsel-foil.ts
//
// There is no Tinsel asset pack in this repository and no scan of the Generation V
// sheet, so this script DRAWS one from the only description we have (Bulbapedia,
// Rarity: "consists of horizontal stripes across the image") and records that
// provenance in the generated index. The output is a reconstruction;
// `concept: true` and `verified: false` are written into the index, not left to a
// comment somewhere.
//
// What the script measures rather than asserts:
//   - ink coverage and peak alpha, so a blank or blown-out sheet fails here;
//   - the wrap discontinuity, so "this tiles" is a measurement, not a claim;
//   - the number of broken segments, so the lines keep a tinsel texture instead of
//     becoming a ruled grid.
//
// It also writes the showcase cards the report and the suite start from, read from
// the catalogue: one holo rare each from the first, middle and last Gen V sets.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'
import {
  renderTinselSheet,
  tinselSeamMismatch,
  TINSEL_PERIOD,
  TINSEL_SEED,
  TINSEL_SHEET_SIZE,
  TINSEL_STRIPES,
} from '../src/foil/tinsel-sheet'

const OUT_DIR = 'public/foil/tinsel'
const OUT_FILE = path.join(OUT_DIR, 'sheet.png')
const INDEX_FILE = 'src/foil/tinsel-index.ts'
const DB_FILE = 'data/tcglife.db'

/** English expansions Bulbapedia assigns Tinsel to, as a set rule. */
const TINSEL_SETS = ['bw1', 'bw2', 'bw3', 'bw4', 'bw5', 'bw6', 'bw7', 'bw8', 'bw9', 'bw10', 'bw11']

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
const sheet = renderTinselSheet(TINSEL_SHEET_SIZE, TINSEL_SEED)
const seam = tinselSeamMismatch(sheet.rgba, sheet.size)
const gaps = sheet.lines.reduce((n, line) => n + line.gaps.length, 0)

if (sheet.stripes !== TINSEL_STRIPES) problems.push(`drew ${sheet.stripes} stripes, expected ${TINSEL_STRIPES}`)
if (sheet.period !== TINSEL_PERIOD) problems.push(`period is ${sheet.period}px, expected ${TINSEL_PERIOD}px`)
if (sheet.coverage < 0.3) problems.push(`coverage ${(sheet.coverage * 100).toFixed(2)}% is too sparse to read as banding`)
if (sheet.coverage > 0.62) problems.push(`coverage ${(sheet.coverage * 100).toFixed(2)}% is dense enough to hide the artwork`)
if (sheet.peak < 0.85) problems.push(`peak ${sheet.peak.toFixed(3)} is too dim for a foil line`)
if (seam > 0.06) problems.push(`wrap mismatch ${(seam * 100).toFixed(1)}%: the sheet was meant to tile`)
if (gaps < sheet.stripes) problems.push(`${gaps} breaks across ${sheet.stripes} lines: that is a ruled grid, not tinsel`)

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, encodePng(sheet.size, sheet.size, sheet.rgba))

// --------------------------------------------------------------------------
// Showcase cards, read from the catalogue.
// --------------------------------------------------------------------------

type Showcase = { cardId: string; setId: string; number: string; name: string; rarity: string }
const showcase: Showcase[] = []
if (fs.existsSync(DB_FILE)) {
  const db = new Database(DB_FILE, { readonly: true })
  for (const setId of ['bw1', 'bw6', 'bw11']) {
    const row = db
      .prepare("select id, set_id, number, name, rarity from cards where set_id = ? and rarity = 'Rare Holo' order by cast(number as integer) limit 1")
      .get(setId) as { id: string; set_id: string; number: string; name: string; rarity: string } | undefined
    if (!row) {
      problems.push(`${setId} has no Rare Holo row to showcase`)
      continue
    }
    showcase.push({ cardId: row.id, setId: row.set_id, number: row.number, name: row.name, rarity: row.rarity })
  }
  db.close()
} else {
  problems.push('card database missing: cannot choose showcase cards')
}

const per = (v: number) => (v * 100).toFixed(2)

const index = `// GENERATED by scripts/tinsel-foil.ts — do not hand-edit.
//
// The Generation V Tinsel sheet is NOT in this repository: no scan, no photograph,
// no asset pack. This texture is a PROCEDURAL RECONSTRUCTION of Bulbapedia's
// description ("consists of horizontal stripes across the image"), drawn at
// ${sheet.size}px with a ${sheet.period}px pitch (${sheet.stripes} lines).
//
// Measured from the shipped file:
//   coverage ${per(sheet.coverage)}% of the sheet carries ink (alpha > 0.1)
//   peak     ${sheet.peak.toFixed(3)} alpha inside a line
//   seam     ${per(seam)}% step across the edges that meet when the sheet wraps, so
//            a card may sample any window.
//   breaks   ${gaps} across ${sheet.stripes} lines, so the lines are not a ruled grid.
//
// The stripes TILE and the pitch is this build's choice: the sources name the
// pattern and its orientation, not a line count or a repeat.
//
// The printing claim is separate and lives in printing-db.ts: Bulbapedia names
// Tinsel for every Generation V set's holofoil rares, which is why those rows are
// verified while this texture is labelled a reconstruction.

export const TINSEL_SHEET = {
  pattern: '/foil/tinsel/sheet.png',
  size: ${sheet.size},
  period: ${sheet.period},
  stripes: ${sheet.stripes},
  coverage: ${sheet.coverage.toFixed(5)},
  peak: ${sheet.peak.toFixed(5)},
  seamMismatch: ${seam.toFixed(5)},
  breaks: ${gaps},
  tiling: 'disclosed choice',
  concept: true,
  textureVerified: false,
  reproduction: 'procedural reconstruction',
  source: 'https://bulbapedia.bulbagarden.net/wiki/Rarity',
  description: 'horizontal stripes across the image',
} as const

export const TINSEL_SETS: string[] = [${TINSEL_SETS.map((s) => `'${s}'`).join(', ')}]

export const TINSEL_SHOWCASE: { cardId: string; setId: string; number: string; name: string; rarity: string }[] = [
${showcase
  .map(
    (c) =>
      `  { cardId: '${c.cardId}', setId: '${c.setId}', number: '${c.number}', name: ${JSON.stringify(c.name)}, rarity: ${JSON.stringify(c.rarity)} },`,
  )
  .join('\n')}
]

/** The sentence that gives the set rule, quoted so the report cannot drift from it. */
export const TINSEL_CLAIM =
  'Bulbapedia Rarity: "For all sets in Generation V (from Black and White to Legendary Treasures), the holofoil pattern is named "Tinsel Holofoil", and consists of horizontal stripes across the image."'

export const TINSEL_PROMO_NOTE =
  'Bulbapedia says Tinsel was also used "along with various promotional cards", but names none of them, and this catalogue does not resolve promos by set. No promotional printing makes a Tinsel claim here.'

/**
 * The 2025 return is recorded and NOT painted. The sources disagree about which
 * cards carry it, and the one sentence that covers the sets at all describes a
 * border rather than the striped image this sheet draws.
 */
export const TINSEL_RETURN_NOTE = {
  claim:
    'Bulbapedia Rarity: "Tinsel Holofoil returned as a once-off in Black Bolt and White Flare, with holofoil rare cards in these sets also having Tinsel Holofoil borders."',
  conflict:
    'The Black Bolt & White Flare set page marks Tinsel Holofoil on three cards only — 001, 011 and 021 — each a Black Bolt & White Flare Poster Collection exclusive, and TCGdex registers exactly those three variants as tinsel. Those are promotional printings this catalogue does not carry.',
  decision:
    'Neither set is painted: the sources disagree on whether every holo rare or only three promos carry it, and the sentence that does cover the holo rares describes a BORDER, which is a different foil area from the striped image reproduced here.',
} as const
`

fs.writeFileSync(INDEX_FILE, index)

console.log(`Tinsel sheet: ${per(sheet.coverage)}% coverage, peak ${sheet.peak.toFixed(3)}`)
console.log(`  ${sheet.stripes} stripes at ${sheet.period}px, ${gaps} breaks, wrap step ${per(seam)}%`)
console.log(`  wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB) and ${INDEX_FILE}`)
console.log(`  showcase: ${showcase.map((c) => c.cardId).join(', ')}`)
if (problems.length) {
  console.log('\nPROBLEMS:')
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
