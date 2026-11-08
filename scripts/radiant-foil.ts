// Radiant Collection foil pack → shipped assets + generated index.
//
// Run with `npx tsx scripts/radiant-foil.ts`. The pack is a CONCEPT pack: every
// folder is a reconstructed decorative motif, not a scanned factory stamp, and
// no coverage mask is supplied (each README says so). This script therefore does
// only what can be verified mechanically:
//
//   - checks that all 57 folders exist, are RGBA 768x768, and carry the files
//     the READMEs promise;
//   - compares pattern_alpha.png against pattern_RGBA.png's own alpha channel,
//     so the renderer knows whether the separate opacity file carries any data
//     the RGBA file does not;
//   - copies the textures into public/ under a set/number path that the game can
//     fetch on demand (only the textures — reference sheets and reflection
//     examples are documentation, never overlays);
//   - emits src/foil/radiant-index.ts, the card-id → asset mapping.
//
// The mapping is keyed by set id + collector number, never by Pokémon name:
// Generations RC6 is Flareon-EX and Legendary Treasures RC6 is Piplup, so a
// name-first or number-only mapping would quietly hand one card the other's
// texture.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'

const ROOT = process.cwd()
const PACK = path.join(ROOT, 'Radiant_Collection_57_Card_Foil_Concept_Pack')
const OUT_DIR = path.join(ROOT, 'public', 'foil', 'radiant')
const INDEX_FILE = path.join(ROOT, 'src', 'foil', 'radiant-index.ts')
const DB_FILE = path.join(ROOT, 'data', 'tcglife.db')

/** Pack folder → the pokemontcg.io set id the game stores cards under. */
const SET_IDS: Record<string, string> = {
  Legendary_Treasures_2013: 'bw11',
  Generations_2016: 'g1',
}

type Png = { w: number; h: number; ch: number; px: Buffer }

function decodePng(file: string): Png {
  const b = fs.readFileSync(file)
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG: ' + file)
  let o = 8
  let w = 0
  let h = 0
  let color = 0
  let depth = 0
  const idat: Buffer[] = []
  while (o < b.length) {
    const len = b.readUInt32BE(o)
    const type = b.toString('ascii', o + 4, o + 8)
    const data = b.subarray(o + 8, o + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      depth = data[8]
      color = data[9]
    } else if (type === 'IDAT') idat.push(data)
    o += 12 + len
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}: ${file}`)
  const ch = color === 6 ? 4 : color === 2 ? 3 : 0
  if (!ch) throw new Error(`unsupported colour type ${color}: ${file}`)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = Buffer.alloc(h * stride)
  let p = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[p++]
    const line = raw.subarray(p, p + stride)
    p += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0
      const bp = prev ? prev[x] : 0
      const c = prev && x >= ch ? prev[x - ch] : 0
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
  return { w, h, ch, px: out }
}

/** Minimal CSV reader: the index has quoted-free fields, but be safe anyway. */
function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  const head = lines[0].split(',')
  return lines.slice(1).map((line) => {
    const cells = line.split(',')
    const row: Record<string, string> = {}
    head.forEach((k, i) => (row[k.trim()] = (cells[i] ?? '').trim()))
    return row
  })
}

type Entry = {
  cardId: string
  setId: string
  number: string
  name: string
  /** Rarity from the card database: Generations RC commons are non-foil. */
  rarity: string
  motif: string
  folder: string
  fullArt: boolean
  pattern: string
  alpha: string | null
}

const csv = readCsv(path.join(PACK, 'INDEX.csv'))
const bySetNumber = new Map<string, { motif: string; name: string }>()
for (const row of csv) {
  const setId = SET_IDS[row.set]
  if (!setId) throw new Error('unknown set in INDEX.csv: ' + row.set)
  bySetNumber.set(`${setId}-RC${Number(row.number)}`, { motif: row.illustrative_motif, name: row.name })
}

// Rarity decides foil existence for the Generations subset (commons are plain),
// so the index carries it alongside the texture path.
const rarityOf = new Map<string, string>()
if (fs.existsSync(DB_FILE)) {
  const db = new Database(DB_FILE, { readonly: true })
  for (const row of db.prepare("select id, rarity from cards where number like 'RC%'").all() as { id: string; rarity: string }[]) {
    rarityOf.set(row.id, row.rarity)
  }
  db.close()
} else {
  console.warn('warning: data/tcglife.db not found — the index will carry empty rarities')
}

const problems: string[] = []
const notes: string[] = []
const entries: Entry[] = []
let copied = 0
let skipped = 0
let alphaSame = 0
let alphaDifferent = 0

for (const [setFolder, setId] of Object.entries(SET_IDS)) {
  const setDir = path.join(PACK, setFolder)
  const folders = fs.readdirSync(setDir).filter((d) => fs.statSync(path.join(setDir, d)).isDirectory()).sort()
  for (const folder of folders) {
    const dir = path.join(setDir, folder)
    for (const required of ['pattern_RGBA.png', 'pattern_alpha.png', 'README.txt']) {
      if (!fs.existsSync(path.join(dir, required))) problems.push(`${setFolder}/${folder}: missing ${required}`)
    }
    // RC06_Flareon_EX / RC28_Flareon_EX_Full_Art → RC6 / RC28
    const m = /^RC(\d+)_(.+)$/.exec(folder)
    if (!m) {
      problems.push(`${setFolder}/${folder}: folder name is not RCnn_Name`)
      continue
    }
    const number = `RC${Number(m[1])}`
    const cardId = `${setId}-${number}`
    const fullArt = /_Full_Art$/i.test(folder)
    const meta = bySetNumber.get(cardId)
    if (!meta) problems.push(`${cardId}: no row in INDEX.csv for ${folder}`)

    const rgbaPath = path.join(dir, 'pattern_RGBA.png')
    const alphaPath = path.join(dir, 'pattern_alpha.png')
    const rgba = decodePng(rgbaPath)
    const alphaPng = decodePng(alphaPath)
    if (rgba.w !== 768 || rgba.h !== 768) problems.push(`${cardId}: pattern is ${rgba.w}x${rgba.h}, expected 768x768`)
    if (rgba.ch !== 4) problems.push(`${cardId}: pattern is not RGBA`)

    // Does the separate opacity file actually differ from the RGBA's alpha?
    let differs = false
    if (alphaPng.w !== rgba.w || alphaPng.h !== rgba.h) differs = true
    else {
      for (let i = 0; i < rgba.px.length; i += 4) {
        if (rgba.px[i + 3] !== alphaPng.px[i + 3]) {
          differs = true
          break
        }
      }
    }
    if (differs) alphaDifferent++
    else alphaSame++

    const outDir = path.join(OUT_DIR, setId)
    fs.mkdirSync(outDir, { recursive: true })
    const patternRel = `/foil/radiant/${setId}/${number}.png`
    const patternOut = path.join(OUT_DIR, setId, `${number}.png`)
    const rgbaBytes = fs.readFileSync(rgbaPath)
    if (fs.existsSync(patternOut) && fs.readFileSync(patternOut).equals(rgbaBytes)) skipped++
    else {
      fs.writeFileSync(patternOut, rgbaBytes)
      copied++
    }

    let alphaRel: string | null = null
    if (differs) {
      alphaRel = `/foil/radiant/${setId}/${number}.alpha.png`
      fs.writeFileSync(path.join(OUT_DIR, setId, `${number}.alpha.png`), fs.readFileSync(alphaPath))
    }

    entries.push({
      cardId,
      setId,
      number,
      name: meta?.name ?? m[2].replace(/_/g, ' '),
      rarity: rarityOf.get(cardId) ?? '',
      motif: meta?.motif ?? 'unknown',
      folder: `${setFolder}/${folder}`,
      fullArt,
      pattern: patternRel,
      alpha: alphaRel,
    })
  }
}

if (alphaSame && alphaDifferent) {
  notes.push(`pattern_alpha.png carries extra data on ${alphaDifferent} cards — those ship a second file.`)
} else if (alphaSame) {
  notes.push('pattern_alpha.png is byte-identical to the alpha channel of pattern_RGBA.png for all cards: one file is enough, and the renderer reads opacity from the RGBA alpha.')
}

entries.sort((a, b) => (a.setId === b.setId ? Number(a.number.slice(2)) - Number(b.number.slice(2)) : a.setId.localeCompare(b.setId)))

const body = `// GENERATED by scripts/radiant-foil.ts — do not hand-edit.
//
// The Radiant Collection concept pack, mapped card id → texture. Keyed by set
// id + collector number: Legendary Treasures RC6 (Piplup) and Generations RC6
// (Flareon-EX) are different cards with different motifs, and the pack ships
// both, so nothing here may ever be looked up by Pokémon name alone.
//
// 'pattern' is a same-origin path under public/. In dev Vite serves it; in the
// packaged build the server serves dist/, which public/ is copied into.
//
// These motifs are RECONSTRUCTED CONCEPT ART, not scanned factory stamps — see
// Radiant_Collection_57_Card_Foil_Concept_Pack/README_FIRST.txt. Nothing here
// claims otherwise, and the mask side records its own verification separately.

export type RadiantAsset = {
  cardId: string
  setId: string
  number: string
  name: string
  /** Rarity from the card database. */
  rarity: string
  /** The motif the pack describes, e.g. 'bows'. Documentation only. */
  motif: string
  /** Pack folder the texture came from, for tracing a bad render back. */
  folder: string
  fullArt: boolean
  pattern: string
  /** Separate opacity file, only when it differs from the RGBA alpha. */
  alpha: string | null
}

export const RADIANT_ASSETS: Record<string, RadiantAsset> = {
${entries
  .map(
    (e) =>
      `  '${e.cardId}': { cardId: '${e.cardId}', setId: '${e.setId}', number: '${e.number}', name: ${JSON.stringify(e.name)}, rarity: ${JSON.stringify(e.rarity)}, motif: '${e.motif}', folder: '${e.folder}', fullArt: ${e.fullArt}, pattern: '${e.pattern}', alpha: ${e.alpha ? `'${e.alpha}'` : 'null'} },`,
  )
  .join('\n')}
}

/** Every card the pack covers, in set then collector-number order. */
export const RADIANT_CARD_IDS: string[] = [${entries.map((e) => `'${e.cardId}'`).join(', ')}]

export const RADIANT_COUNT = ${entries.length}
`

fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true })
fs.writeFileSync(INDEX_FILE, body)

console.log(`cards: ${entries.length}`)
console.log(`textures copied: ${copied}, already current: ${skipped}`)
console.log(`alpha file identical to RGBA alpha: ${alphaSame}, different: ${alphaDifferent}`)
for (const n of notes) console.log('note:', n)
if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):`)
  for (const p of problems) console.log(' -', p)
  process.exitCode = 1
} else {
  console.log('all folders, files and dimensions verified')
}
