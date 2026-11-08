// Starlight sheet → shipped texture + generated index.
//
// Run: ./node_modules/.bin/tsx scripts/starlight-foil.ts
//
// There is no Starlight asset pack in this repository and no scan of the 1999
// sheet, so this script DRAWS one from the only description we have (Bulbapedia:
// "starbursts of different sizes spread across the image, with a slightly blurry
// appearance") and records that provenance in the generated index. The output is
// a reconstruction; `concept: true` and `verified: false` are written into the
// index, not left to a comment somewhere.
//
// What the script measures rather than asserts:
//   - mark coverage and peak alpha, so a blank or blown-out sheet fails here;
//   - the wrap discontinuity, so "this is not a tile" is a measurement;
//   - the star mix (large/medium/small/dust), so the sheet keeps its vocabulary.
//
// It also writes the showcase cards the inspector and the report start from,
// read from the catalog: Base Charizard, a Jungle holo and a Fossil holo.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'
import {
  renderStarlightSheet,
  starlightSeamMismatch,
  STARLIGHT_SEED,
  STARLIGHT_SHEET_SIZE,
} from '../src/foil/starlight-sheet'

const OUT_DIR = 'public/foil/starlight'
const OUT_FILE = path.join(OUT_DIR, 'sheet.png')
const INDEX_FILE = 'src/foil/starlight-index.ts'
const DB_FILE = 'data/tcglife.db'

// --------------------------------------------------------------------------
// Minimal PNG writer (RGBA8, no interlace). Same shape as the reverse sheets.
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
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
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
const sheet = renderStarlightSheet(STARLIGHT_SHEET_SIZE, STARLIGHT_SEED)
const seam = starlightSeamMismatch(sheet.rgba, sheet.size)

// Sanity gates. A starfield that is blank, blown out or accidentally tileable
// should fail here rather than ship and be discovered in a screenshot.
if (sheet.coverage < 0.02) problems.push(`coverage ${(sheet.coverage * 100).toFixed(2)}% is too sparse to read as a holo pattern`)
if (sheet.coverage > 0.16) problems.push(`coverage ${(sheet.coverage * 100).toFixed(2)}% is dense enough to hide the artwork`)
if (sheet.peak < 0.45) problems.push(`peak ${sheet.peak.toFixed(3)} is too dim for a star core`)
if (seam < 0.05) problems.push(`wrap mismatch ${(seam * 100).toFixed(1)}% is low: the sheet may be tileable, which this sampler must not assume`)
if (sheet.counts.dust < 100 || sheet.counts.large < 4) problems.push('star mix is missing a size class')

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, encodePng(sheet.size, sheet.size, sheet.rgba))

// --------------------------------------------------------------------------
// Showcase cards, read from the catalog. These are the cards the inspector and
// the report open; the report checks that every Base/Jungle/Fossil holo rare
// resolves, not just these three.
// --------------------------------------------------------------------------

type Showcase = { cardId: string; setId: string; number: string; name: string; rarity: string }
const showcase: Showcase[] = []
if (fs.existsSync(DB_FILE)) {
  const db = new Database(DB_FILE, { readonly: true })
  const pick = (id: string) => {
    const row = db
      .prepare('select id, set_id, number, name, rarity from cards where id = ?')
      .get(id) as { id: string; set_id: string; number: string; name: string; rarity: string | null } | undefined
    if (!row) {
      problems.push(`showcase ${id} is not in the catalog`)
      return
    }
    showcase.push({ cardId: row.id, setId: row.set_id, number: row.number, name: row.name, rarity: row.rarity ?? '' })
  }
  pick('base1-4') // Base Set Charizard
  pick('base2-1') // Jungle Clefable
  pick('base3-1') // Fossil Aerodactyl
  db.close()
} else {
  problems.push('card database missing: cannot choose showcase cards')
}

const index = `// GENERATED by scripts/starlight-foil.ts — do not hand-edit.
//
// The 1999 Starlight sheet is NOT in this repository: no scan, no photograph, no
// asset pack. This texture is a PROCEDURAL RECONSTRUCTION drawn from Bulbapedia's
// description ("starbursts of different sizes spread across the image, with a
// slightly blurry appearance"). It is a drawing of the pattern, not a copy of a
// card's foil, and the renderer reports it as such.
//
// Measured from the shipped file:
//   coverage ${(sheet.coverage * 100).toFixed(2)}% of the sheet carries ink (alpha > 0.1)
//   peak     ${sheet.peak.toFixed(3)} alpha at a star core
//   stars    ${sheet.counts.large} large, ${sheet.counts.medium} medium, ${sheet.counts.small} small, ${sheet.counts.dust} dust
//   seam     ${(seam * 100).toFixed(1)}% of rows disagree across the wrap, so the sheet is cut as
//            one window per card and never tiles.
//
// The printing claim is separate and lives in printing-db.ts: Bulbapedia names
// Starlight for Base, Jungle and Fossil holo rares, which is why those rows are
// verified while this texture is labelled a reconstruction.

export type StarlightSheetInfo = {
  pattern: string
  size: string
  seed: number
  /** Fraction of the sheet carrying ink, measured from the shipped file. */
  coverage: number
  /** Peak alpha, measured from the shipped file. */
  peak: number
  stars: { large: number; medium: number; small: number; dust: number }
  /** Rows whose two edge pixels disagree across a wrap, as a fraction. */
  seamMismatch: number
  /** Procedural drawing, not a scan. */
  concept: true
  /** No printing is verified against this texture. */
  textureVerified: false
  note: string
}

export const STARLIGHT_SHEET: StarlightSheetInfo = {
  pattern: '/foil/starlight/sheet.png',
  size: '${sheet.size}x${sheet.size}',
  seed: ${sheet.seed},
  coverage: ${sheet.coverage.toFixed(5)},
  peak: ${sheet.peak.toFixed(5)},
  stars: { large: ${sheet.counts.large}, medium: ${sheet.counts.medium}, small: ${sheet.counts.small}, dust: ${sheet.counts.dust} },
  seamMismatch: ${seam.toFixed(4)},
  concept: true,
  textureVerified: false,
  note: 'Procedural reconstruction of the Starlight sheet from Bulbapedia\\'s description: four-point starbursts of several sizes, spread evenly, slightly blurred. Not a scan of a factory sheet.',
}

/** The only sets printed on Starlight. Fossil is the last of the three. */
export const STARLIGHT_SETS = ['base1', 'base2', 'base3'] as const

/** Cards the inspector and report open first. */
export const STARLIGHT_SHOWCASE: { cardId: string; setId: string; number: string; name: string; rarity: string }[] = ${JSON.stringify(showcase, null, 2)}
`

fs.writeFileSync(INDEX_FILE, index)

console.log(`sheet: ${sheet.size}x${sheet.size} → ${OUT_FILE}`)
console.log(`coverage ${(sheet.coverage * 100).toFixed(2)}% · peak ${sheet.peak.toFixed(3)} · wrap mismatch ${(seam * 100).toFixed(1)}%`)
console.log(`stars: ${sheet.counts.large} large, ${sheet.counts.medium} medium, ${sheet.counts.small} small, ${sheet.counts.dust} dust`)
console.log(`index: ${INDEX_FILE} (${showcase.length} showcase cards)`)
if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):`)
  for (const p of problems) console.log(' -', p)
  process.exitCode = 1
} else {
  console.log('sheet passes its own gates')
}
