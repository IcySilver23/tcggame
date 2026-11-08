// Type-symbol reverse paper → shipped sheets + generated index.
//
// Run: ./node_modules/.bin/tsx scripts/type-symbol-foil.ts
//
// Bulbapedia describes the BW/XY reverse pattern as the card's type symbol in the
// card body ("a Poké Ball for Trainers"). No official icon asset is bundled here,
// so each of the twelve glyphs is a STYLISED geometric drawing, and the generated
// index says `concept: true` / `textureVerified: false`.
//
// One sheet per glyph, because the symbol must match the card. The loader reads
// the type from the card row (or /api/cards/meta) and refuses to draw a symbol for
// an unknown type — plain foil is the honest fallback, not the wrong glyph.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'
import {
  GLYPH_IDS,
  GLYPH_LABEL,
  renderTypeSymbolSheet,
  TYPE_SYMBOL_SEED,
  TYPE_SYMBOL_SHEET_SIZE,
  type GlyphId,
} from '../src/foil/type-glyph'

const OUT_DIR = 'public/foil/type-symbol'
const INDEX_FILE = 'src/foil/type-symbol-index.ts'
const DB_FILE = 'data/tcglife.db'

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

const problems: string[] = []
fs.mkdirSync(OUT_DIR, { recursive: true })

type Measured = { id: GlyphId; label: string; texture: string; coverage: number; peak: number; glyphs: number; seamRatio: number }
const measured: Measured[] = []

for (const glyph of GLYPH_IDS) {
  const sheet = renderTypeSymbolSheet(glyph, TYPE_SYMBOL_SHEET_SIZE, TYPE_SYMBOL_SEED)
  if (sheet.coverage < 0.02) problems.push(`${glyph}: coverage ${(sheet.coverage * 100).toFixed(2)}% is too sparse to read`)
  if (sheet.coverage > 0.25) problems.push(`${glyph}: coverage ${(sheet.coverage * 100).toFixed(2)}% is dense enough to hide the card`)
  if (sheet.peak < 0.5) problems.push(`${glyph}: peak ${sheet.peak.toFixed(3)} is too dim`)
  if (sheet.seamRatio > 2) problems.push(`${glyph}: wrap ratio ${sheet.seamRatio.toFixed(2)} means the tile does not continue`)
  const file = path.join(OUT_DIR, `${glyph}.png`)
  fs.writeFileSync(file, encodePng(sheet.size, sheet.size, sheet.rgba))
  measured.push({
    id: glyph,
    label: GLYPH_LABEL[glyph],
    texture: `/foil/type-symbol/${glyph}.png`,
    coverage: Number(sheet.coverage.toFixed(5)),
    peak: Number(sheet.peak.toFixed(5)),
    glyphs: sheet.glyphs,
    seamRatio: Number(sheet.seamRatio.toFixed(4)),
  })
}

// Showcase cards, read from the catalog. Their cards span a type and a Trainer so
// the report can show both the Pokémon symbol and the Poké Ball.
type Showcase = { cardId: string; setId: string; number: string; name: string; rarity: string; types: string | null; supertype: string | null; variant: string }
const showcase: Showcase[] = []
if (fs.existsSync(DB_FILE)) {
  const db = new Database(DB_FILE, { readonly: true })
  const rows = db
    .prepare("select id, set_id, number, name, rarity, types, supertype from cards where id in ('bw2-1','bw11-1')")
    .all() as { id: string; set_id: string; number: string; name: string; rarity: string | null; types: string | null; supertype: string | null }[]
  for (const r of rows) {
    showcase.push({
      cardId: r.id, setId: r.set_id, number: r.number, name: r.name,
      rarity: r.rarity ?? '', types: r.types, supertype: r.supertype, variant: 'reverseHolofoil',
    })
  }
  const trainer = db
    .prepare("select id, set_id, number, name, rarity, types, supertype from cards where set_id = 'bw2' and supertype = 'Trainer' order by cast(number as integer) limit 1")
    .get() as { id: string; set_id: string; number: string; name: string; rarity: string | null; types: string | null; supertype: string | null } | undefined
  if (trainer) {
    showcase.push({
      cardId: trainer.id, setId: trainer.set_id, number: trainer.number, name: trainer.name,
      rarity: trainer.rarity ?? '', types: trainer.types, supertype: trainer.supertype, variant: 'reverseHolofoil',
    })
  } else problems.push('no BW2 Trainer card to showcase')
  db.close()
} else {
  problems.push('card database missing: cannot choose showcase cards')
}

const entries = measured
  .map(
    (m) => `  ${m.id}: {
    id: ${JSON.stringify(m.id)},
    label: ${JSON.stringify(m.label)},
    texture: ${JSON.stringify(m.texture)},
    coverage: ${m.coverage},
    peak: ${m.peak},
    glyphs: ${m.glyphs},
    seamRatio: ${m.seamRatio},
  },`,
  )
  .join('\n')

const index = `// GENERATED by scripts/type-symbol-foil.ts — do not hand-edit.
//
// The BW/XY reverse paper repeats the card's TYPE SYMBOL over the card body. No
// official icon set, vector asset or photograph is bundled with this project, so
// each glyph below is a STYLISED GEOMETRIC DRAWING, not the official icon, and
// none is verified against a real card. The pattern's identity is researched
// (Bulbapedia); the artwork is a reconstruction.
//
// One sheet per glyph because the symbol must match the card. The loader reads the
// card's type and refuses to substitute a different one: an unknown type renders
// plain foil rather than the wrong symbol.

export type TypeSymbolGlyph =
  | 'grass' | 'fire' | 'water' | 'lightning' | 'psychic' | 'fighting'
  | 'darkness' | 'metal' | 'dragon' | 'fairy' | 'colorless' | 'trainer'

export type TypeSymbolAsset = {
  id: TypeSymbolGlyph
  label: string
  texture: string
  coverage: number
  peak: number
  glyphs: number
  seamRatio: number
}

export const TYPE_SYMBOL_ASSETS: Record<TypeSymbolGlyph, TypeSymbolAsset> = {
${entries}
}

/** Glyph copies across the card at 1x. */
export const TYPE_SYMBOL_SCALE = 1.6

/** Stylised drawings, not official icons, and not verified against a card. */
export const TYPE_SYMBOL_CONCEPT = true
export const TYPE_SYMBOL_TEXTURE_VERIFIED = false

export const TYPE_SYMBOL_NOTE =
  'Stylised geometric type glyphs repeated over the card body; a reconstruction of the BW/XY reverse paper, not official icon artwork.'

/** Cards the inspector and report open first: two Pokémon and a Trainer. */
export const TYPE_SYMBOL_SHOWCASE: {
  cardId: string; setId: string; number: string; name: string; rarity: string
  types: string | null; supertype: string | null; variant: string
}[] = ${JSON.stringify(showcase, null, 2)}
`

fs.writeFileSync(INDEX_FILE, index)

console.log(`${measured.length} glyph sheets → ${OUT_DIR}`)
console.log(measured.map((m) => `${m.id}: ${(m.coverage * 100).toFixed(2)}% peak ${m.peak.toFixed(2)} seam ${m.seamRatio.toFixed(2)}`).join('\n'))
console.log(`index: ${INDEX_FILE} (${showcase.length} showcase cards)`)
if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):`)
  for (const p of problems) console.log(' -', p)
  process.exitCode = 1
} else {
  console.log('every glyph sheet passes its gates')
}
