// Mirror sheet → shipped texture + generated index.
//
// Run: ./node_modules/.bin/tsx scripts/mirror-foil.ts
//
// There is no Mirror asset pack in this repository and no scan of the paper, so
// this script DRAWS one from the only description we have — Bulbapedia's Holofoil
// page on Sheen, which is the same finish ("Mirror Holofoil … last seen during the
// Black & White Series"): international cards "refract light in a diagonal
// direction … from bottom right to top left". The output is a reconstruction;
// `concept: true` and `textureVerified: false` are written into the index, not left
// to a comment somewhere.
//
// What the script measures rather than asserts:
//   - ink coverage and the floor, so a mirror that stops reflecting fails here;
//   - the wrap discontinuity, so "this tiles" is a measurement, not a claim;
//   - that the field varies along its diagonal at all, so a flat fill cannot ship
//     as a sheen.
//
// It also writes the nine BW Black Star Promos the printing table assigns Mirror,
// read from `promo-buckets-db.ts` so the report and the suite cannot disagree about
// which cards wear this paper.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import {
  MIRROR_SHEET_SIZE,
  mirrorSeamMismatch,
  renderMirrorSheet,
} from '../src/foil/mirror-sheet'
import { MIRROR_DIRECTION, MIRROR_FLOOR, MIRROR_PEAK, MIRROR_WAVES } from '../src/foil/mirror-sheen'
import { PROMO_BUCKET_CLAIMS, PROMO_BUCKET_UNLISTED } from '../src/foil/promo-buckets-db'

const OUT_DIR = 'public/foil/mirror'
const OUT_FILE = path.join(OUT_DIR, 'sheet.png')
const INDEX_FILE = 'src/foil/mirror-index.ts'

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
const sheet = renderMirrorSheet(MIRROR_SHEET_SIZE)
const seam = mirrorSeamMismatch(sheet.rgba, sheet.size)

if (sheet.coverage < 1) problems.push(`coverage ${sheet.coverage}: a mirror is uniform foil, every pixel carries ink`)
if (sheet.floor < 0.25) problems.push(`floor ${sheet.floor.toFixed(3)} lets the surface go dark, which a mirror does not`)
if (sheet.peak > 0.96) problems.push(`peak ${sheet.peak.toFixed(3)} leaves no headroom for the reflection`)
if (sheet.peak - sheet.floor < 0.3) problems.push(`contrast ${(sheet.peak - sheet.floor).toFixed(3)} is too flat to read as a sheen`)
if (seam > 0.02) problems.push(`wrap mismatch ${(seam * 100).toFixed(2)}%: the sheet was meant to tile`)

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, encodePng(sheet.size, sheet.size, sheet.rgba))

const mirrorCards = PROMO_BUCKET_CLAIMS.filter((c) => c.treatment === 'mirror')
if (!mirrorCards.length) problems.push('no Mirror claims in the promo bucket table')
for (const c of mirrorCards) {
  if (!c.cardId.startsWith('bwp-')) problems.push(`${c.cardId}: Mirror is expected inside the BW Black Star Promos`)
}

const crosshatch = PROMO_BUCKET_CLAIMS.filter((c) => c.treatment === 'crosshatch')
const textured = PROMO_BUCKET_CLAIMS.filter((c) => c.treatment === 'textured')
const unlisted = PROMO_BUCKET_UNLISTED

const per = (v: number) => (v * 100).toFixed(2)

const cardRows = mirrorCards
  .map(
    (c) =>
      `  { cardId: ${JSON.stringify(c.cardId)}, number: ${JSON.stringify(c.number)}, name: ${JSON.stringify(c.name)}, reverse: ${!!c.reverse}, alsoOn: [${(c.alsoOn ?? []).map((t) => `'${t}'`).join(', ')}] },`,
  )
  .join('\n')

const index = `// GENERATED by scripts/mirror-foil.ts — do not hand-edit.
//
// The Mirror / Sheen sheet is NOT in this repository: no scan, no photograph, no
// asset pack. This texture is a PROCEDURAL RECONSTRUCTION of Bulbapedia's
// description of the finish — international cards "refract light in a diagonal
// direction … from bottom right to top left" — drawn at ${sheet.size}px as a
// uniform mirror modulated along that diagonal (${MIRROR_WAVES} bands).
//
// Measured from the shipped file:
//   coverage ${per(sheet.coverage)}% of the sheet carries ink — every pixel: a mirror is
//            uniform foil, and only its brightness varies.
//   floor    ${sheet.floor.toFixed(3)} alpha at the dimmest point, so the surface never
//            stops reflecting the way a marked foil's bare field does.
//   peak     ${sheet.peak.toFixed(3)} alpha at the brightest point.
//   seam     ${per(seam)}% step across the edges that meet when the sheet wraps, so
//            a card may sample any window.
//
// The CONTRAST and the number of bands are this build's choice: the source names an
// orientation, not a contrast or a repeat. The direction is the international one,
// because this catalogue holds English printings; a Japanese card runs the other
// way and that axis is not modelled.
//
// The printing claim is separate and lives in promo-buckets-db.ts / printing-db.ts:
// Pokumon classifies these nine BW promos as Mirror and Bulbapedia tags the same
// variant printings, which is why the cards are identified while this texture is
// labelled a reconstruction.

export const MIRROR_SHEET = {
  pattern: '/foil/mirror/sheet.png',
  size: ${sheet.size},
  coverage: ${sheet.coverage.toFixed(5)},
  floor: ${sheet.floor.toFixed(5)},
  peak: ${sheet.peak.toFixed(5)},
  mean: ${sheet.mean.toFixed(5)},
  bands: ${MIRROR_WAVES},
  seamMismatch: ${seam.toFixed(5)},
  direction: ${JSON.stringify(MIRROR_DIRECTION)},
  tiling: 'disclosed choice',
  concept: true,
  textureVerified: false,
  reproduction: 'procedural reconstruction',
  source: 'https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)',
  description: 'a uniform mirror that refracts light diagonally, printing no marks',
} as const

/** Bulbapedia's sentence for the finish, quoted so the report cannot drift from it. */
export const MIRROR_CLAIM =
  'Bulbapedia Holofoil: "Sheen Holofoil is used for all Holo cards from XY, and on various promotional cards… Japanese Holofoil cards refract light in a diagonal direction from bottom left to top right across the entire card… and international releases have the same effect as Japanese cards, but only cover the image, and the direction is from bottom right to top left."'

/**
 * One paper, two names. Bulbapedia's Mega Evolution set page says the set
 * "reintroduces Mirror Holofoil variants of cards, last seen during the Black &
 * White Series", and its own promo listings tag cards "[Mirror Holofoil]" — the
 * same smooth finish its Holofoil page files under Sheen.
 */
export const MIRROR_NAME_NOTE = {
  mirror:
    'Bulbapedia, Mega Evolution set page: the set "reintroduces Mirror Holofoil variants of cards, last seen during the Black & White Series".',
  sheen:
    'Bulbapedia, Holofoil page: the same finish is described as "Sheen Holofoil … used for all Holo cards from XY, and on various promotional cards".',
  decision:
    'This build treats Mirror and Sheen as one paper with one texture, named \`mirror\`. A printing that the sources call either resolves here; the side of the name a card carries is recorded in its own row, not in the renderer.',
} as const

/** The language axis: only English printings are catalogued, so only one direction is modelled. */
export const MIRROR_LANGUAGE_NOTE =
  'The direction is a language axis, not a per-card one: Japanese cards run bottom left to top right across the whole face, Korean the same over the image only, and international (English) cards bottom right to top left over the image. This catalogue holds English printings, so that is the direction modelled; a Japanese printing would need its own texture, and none is claimed here.'

/** The nine BW Black Star Promos the printing table assigns Mirror. */
export const MIRROR_CARDS: { cardId: string; number: string; name: string; reverse: boolean; alsoOn: string[] }[] = [
${cardRows}
]

/** The rest of the programme: papers this sheet is never lent to. */
export const MIRROR_NEIGHBOURS = {
  crosshatch: [${crosshatch.map((c) => JSON.stringify(c.cardId)).join(', ')}],
  textured: [${textured.map((c) => JSON.stringify(c.cardId)).join(', ')}],
  unlisted: [${unlisted.map((c) => JSON.stringify(c.cardId)).join(', ')}],
  note:
    'The Crosshatch promos have their own lattice sheet (crosshatch-index.ts) and are not painted as Mirror. ' +
    'The textured BW promos wear an embossed paper with no marks at all, so they are painted as the BW relief (reports/textured-printings.md) rather than borrowing this one. ' +
    'The row no source lists makes no claim at all.',
} as const
`

fs.writeFileSync(INDEX_FILE, index)

console.log(`Mirror sheet: coverage ${per(sheet.coverage)}%, floor ${sheet.floor.toFixed(3)}, peak ${sheet.peak.toFixed(3)}`)
console.log(`  ${MIRROR_WAVES} bands, wrap step ${per(seam)}%, ${mirrorCards.length} cards`)
console.log(`  wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB) and ${INDEX_FILE}`)
console.log(`  cards: ${mirrorCards.map((c) => c.cardId).join(', ')}`)
if (problems.length) {
  console.log('\nPROBLEMS:')
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
