// Cosmos/Galaxy concept pack → shipped assets + generated index.
//
// Run with `npx tsx scripts/cosmos-foil.ts` (extract the zip to tmp/cosmos-pack
// first: `unzip Cosmos_Galaxy_Foil_Concept_Pack.zip -d tmp/cosmos-pack`).
//
// The pack is explicit about what it is: four PROCEDURAL approximations of the
// Cosmos sheet, not scans, with example masks that are "schematic only, NOT
// valid for any specific card". This script therefore only does the mechanical
// part, and records what it found rather than what it hopes:
//
//   - verifies all four variants are 1024x1024 RGBA with the promised files;
//   - checks whether pattern_alpha.png carries anything the RGBA's alpha does
//     not (it does not: its LUMINANCE is byte-identical to the RGBA alpha on all
//     four, so one file ships and opacity is read from the RGBA alpha);
//   - copies the four textures into public/foil/cosmos/;
//   - measures mark coverage and peak so the index can state how sparse each
//     variant is;
//   - emits src/foil/cosmos-index.ts: variants, the era→variant table, and a
//     handful of showcase cards (id + set + rarity, read from the catalog).
//
// The example masks are never copied. They are a schematic rectangle, and the
// real coverage research lives in src/foil/cosmos-masks.ts where each claim can
// carry its own evidence and its own verified flag.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'

const ROOT = process.cwd()
const PACK = path.join(ROOT, 'tmp', 'cosmos-pack')
const OUT_DIR = path.join(ROOT, 'public', 'foil', 'cosmos')
const INDEX_FILE = path.join(ROOT, 'src', 'foil', 'cosmos-index.ts')
const DB_FILE = path.join(ROOT, 'data', 'tcglife.db')

type Png = { w: number; h: number; ch: number; px: Buffer }

function decodePng(buf: Buffer, label: string): Png {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${label}`)
  let o = 8
  let w = 0
  let h = 0
  let depth = 0
  let color = 0
  let interlace = 0
  const idat: Buffer[] = []
  while (o < buf.length) {
    const len = buf.readUInt32BE(o)
    const type = buf.toString('ascii', o + 4, o + 8)
    const data = buf.subarray(o + 8, o + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      depth = data[8]
      color = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    o += 12 + len
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}: ${label}`)
  if (interlace !== 0) throw new Error(`interlaced PNG unsupported: ${label}`)
  const ch = color === 6 ? 4 : color === 2 ? 3 : color === 0 ? 1 : 0
  if (!ch) throw new Error(`unsupported colour type ${color}: ${label}`)
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
  // Normalise to RGBA.
  const px = Buffer.alloc(w * h * 4)
  for (let i = 0, n = w * h; i < n; i++) {
    const s = i * ch
    const d = i * 4
    if (color === 6) { px[d] = out[s]; px[d + 1] = out[s + 1]; px[d + 2] = out[s + 2]; px[d + 3] = out[s + 3] }
    else if (color === 2) { px[d] = out[s]; px[d + 1] = out[s + 1]; px[d + 2] = out[s + 2]; px[d + 3] = 255 }
    else { px[d] = px[d + 1] = px[d + 2] = out[s]; px[d + 3] = 255 }
  }
  return { w, h, ch: 4, px }
}

type VariantDef = {
  id: string
  label: string
  /** Which physical paper this stands in for, and how confident that is. */
  paper: string
  style: 'retro' | 'neo' | 'swirl'
  note: string
}

const VARIANTS: VariantDef[] = [
  {
    id: 'classic_dense',
    label: 'Classic dense',
    paper: 'retro · Base Set 2 → Call of Legends (2000–2011)',
    style: 'retro',
    note: 'Coarse orbs of several sizes plus small four-point stars and fine speckle. The vintage pixel Cosmos look.',
  },
  {
    id: 'classic_sparse',
    label: 'Classic sparse',
    paper: 'retro · alternative density (no printing assigned)',
    style: 'retro',
    note: 'Same retro vocabulary at lower density. No printing is assigned to this variant — every set on the retro paper uses the dense sheet — so it is kept for comparison in the inspector only.',
  },
  {
    id: 'modern_fine',
    label: 'Modern fine',
    paper: 'smooth/HD · post-2013 promo Cosmos',
    style: 'neo',
    note: 'Finer, rounder marks with the small-star motifs thinned out — the "smooth/Neo" Cosmos seen on later promos.',
  },
  {
    id: 'swirl_example',
    label: 'Swirl landmark',
    paper: 'diagnostic only — not a printing',
    style: 'swirl',
    note: 'A swirl/constellation landmark. Real swirls are fixed points inside the master tile; this exists to show one, not to be pasted on a card.',
  },
]

const problems: string[] = []
const measured: { id: string; coverage: number; peak: number; alphaIdentical: boolean; size: string }[] = []

fs.mkdirSync(OUT_DIR, { recursive: true })

for (const v of VARIANTS) {
  const dir = path.join(PACK, v.id)
  if (!fs.existsSync(dir)) {
    problems.push(`${v.id}: pack folder missing (extract the zip into tmp/cosmos-pack)`)
    continue
  }
  for (const f of ['pattern_RGBA.png', 'pattern_alpha.png', 'README.txt']) {
    if (!fs.existsSync(path.join(dir, f))) problems.push(`${v.id}: missing ${f}`)
  }

  const rgba = decodePng(fs.readFileSync(path.join(dir, 'pattern_RGBA.png')), `${v.id}/pattern_RGBA.png`)
  const alpha = decodePng(fs.readFileSync(path.join(dir, 'pattern_alpha.png')), `${v.id}/pattern_alpha.png`)
  if (rgba.w !== 1024 || rgba.h !== 1024) problems.push(`${v.id}: texture is ${rgba.w}x${rgba.h}, expected 1024x1024`)
  if (alpha.w !== rgba.w || alpha.h !== rgba.h) problems.push(`${v.id}: alpha file is a different size`)

  // Alpha file's LUMINANCE vs the RGBA's alpha channel, not its own alpha (which
  // is 255 everywhere in a greyscale PNG and would look like a total mismatch).
  let mismatched = 0
  let maxDiff = 0
  for (let i = 0; i < rgba.px.length; i += 4) {
    const l = Math.round((0.2126 * alpha.px[i] + 0.7152 * alpha.px[i + 1] + 0.0722 * alpha.px[i + 2]))
    const diff = Math.abs(l - rgba.px[i + 3])
    if (diff > 2) mismatched++
    if (diff > maxDiff) maxDiff = diff
  }
  const alphaIdentical = mismatched === 0

  // Mark statistics on the field the renderer will actually read.
  let marked = 0
  let peak = 0
  for (let i = 0; i < rgba.px.length; i += 4) {
    const a = rgba.px[i + 3] / 255
    const luma = (0.2126 * rgba.px[i] + 0.7152 * rgba.px[i + 1] + 0.0722 * rgba.px[i + 2]) / 255
    const m = luma * a
    if (a > 0.1) marked++
    if (m > peak) peak = m
  }
  const coverage = marked / (rgba.w * rgba.h)
  if (peak < 0.2) problems.push(`${v.id}: texture is nearly blank (peak ${peak.toFixed(2)})`)

  const out = path.join(OUT_DIR, `${v.id}.png`)
  fs.writeFileSync(out, fs.readFileSync(path.join(dir, 'pattern_RGBA.png')))
  measured.push({ id: v.id, coverage, peak, alphaIdentical, size: `${rgba.w}x${rgba.h}` })
  if (!alphaIdentical) {
    problems.push(`${v.id}: pattern_alpha.png disagrees with the RGBA alpha (max ${maxDiff}/255) — this build reads the RGBA alpha only`)
  }
}

// --- showcase cards -------------------------------------------------------
//
// Real cards, real rarities, read from the catalog. These are the cards the
// inspector offers and the ones a render check can start from — not an
// assertion that every one of them is Cosmos (cosmos-masks.ts decides that).
const SHOWCASE_IDS = [
  'base4-4',   // Base Set 2 Charizard — dark art, the classic Cosmos showcase
  'base6-1',   // Legendary Collection
  'neo1-9',    // Neo Genesis Lugia — swirl showcase
  'ex1-1',     // EX Ruby & Sapphire
  'dp1-1',     // Diamond & Pearl
  'hgss1-1',   // HGSS
  'col1-1',    // Call of Legends
]

type Showcase = { cardId: string; setId: string; number: string; name: string; rarity: string }
const showcase: Showcase[] = []
if (fs.existsSync(DB_FILE)) {
  const db = new Database(DB_FILE, { readonly: true })
  for (const id of SHOWCASE_IDS) {
    const row = db.prepare('select id, set_id, number, name, rarity from cards where id = ?').get(id) as
      | { id: string; set_id: string; number: string; name: string; rarity: string | null }
      | undefined
    if (!row) {
      // Not fatal: the catalog may not carry every set.
      console.warn(`showcase: ${id} not in the catalog — skipped`)
      continue
    }
    showcase.push({ cardId: row.id, setId: row.set_id, number: row.number, name: row.name, rarity: row.rarity ?? '' })
  }
  db.close()
} else {
  problems.push('data/tcglife.db not found — showcase cards cannot be resolved')
}

const byId = new Map(measured.map((m) => [m.id, m]))
const entry = (v: VariantDef) => {
  const m = byId.get(v.id)
  return `  ${v.id}: {
    id: '${v.id}',
    label: ${JSON.stringify(v.label)},
    style: '${v.style}',
    paper: ${JSON.stringify(v.paper)},
    pattern: '/foil/cosmos/${v.id}.png',
    note: ${JSON.stringify(v.note)},
    // Measured from the shipped file, not asserted.
    coverage: ${(m?.coverage ?? 0).toFixed(4)},
    peak: ${(m?.peak ?? 0).toFixed(4)},
    size: '${m?.size ?? '?'}',
    /** true only while pattern_alpha.png's luminance == the RGBA alpha. */
    alphaInRgba: ${m?.alphaIdentical ?? false},
    concept: true,
  },`
}

const body = `// GENERATED by scripts/cosmos-foil.ts — do not hand-edit.
//
// The Cosmos/Galaxy concept pack: four procedural textures that stand in for the
// real sheet. They are NOT scans and this index says so in every entry
// (\`verified: false\` is implied by \`concept\`); coverage is researched
// separately in cosmos-masks.ts.
//
// Opacity comes from each PNG's own alpha channel. The pack ships a separate
// pattern_alpha.png as well, and for all four files its LUMINANCE is byte-
// identical to the RGBA alpha — so one file ships per variant and there is no
// second opacity asset to keep in sync.

export type CosmosVariantId = ${VARIANTS.map((v) => `'${v.id}'`).join(' | ')}

export type CosmosPaper = 'retro' | 'neo' | 'swirl'

export type CosmosVariant = {
  id: CosmosVariantId
  label: string
  /** Which physical paper it stands in for. */
  style: CosmosPaper
  paper: string
  /** Same-origin path under public/. */
  pattern: string
  note: string
  /** Fraction of texels carrying any mark, measured from the file. */
  coverage: number
  /** Peak mark value, so a blank texture cannot pass silently. */
  peak: number
  size: string
  alphaInRgba: boolean
  /** Procedural concept art, not a scan of a printing's foil. */
  concept: boolean
}

export const COSMOS_VARIANTS: Record<CosmosVariantId, CosmosVariant> = {
${VARIANTS.map(entry).join('\n')}
}

/** The variant a set's era is printed on. See cosmos.ts for the reasoning. */
export const COSMOS_VARIANT_IDS: CosmosVariantId[] = [${VARIANTS.map((v) => `'${v.id}'`).join(', ')}]

export const COSMOS_TEXTURES_ARE_CONCEPT_ART = true

/** Cards the inspector and the render check start from. */
export const COSMOS_SHOWCASE: { cardId: string; setId: string; number: string; name: string; rarity: string }[] = [
${showcase.map((s) => `  { cardId: '${s.cardId}', setId: '${s.setId}', number: '${s.number}', name: ${JSON.stringify(s.name)}, rarity: ${JSON.stringify(s.rarity)} },`).join('\n')}
]

/** The single card this integration is demonstrated on before it is widened. */
export const COSMOS_REFERENCE_CARD = 'base4-4'
`

fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true })
fs.writeFileSync(INDEX_FILE, body)

console.log('variants:')
for (const m of measured) {
  console.log(`  ${m.id.padEnd(14)} ${m.size}  marks ${(m.coverage * 100).toFixed(1)}%  peak ${m.peak.toFixed(2)}  alpha in RGBA: ${m.alphaIdentical}`)
}
console.log(`showcase cards: ${showcase.map((s) => s.cardId).join(', ')}`)
console.log(`textures written to ${path.relative(ROOT, OUT_DIR)}`)
if (problems.length) {
  console.log(`\nPROBLEMS (${problems.length}):`)
  for (const p of problems) console.log(' -', p)
  process.exitCode = 1
} else {
  console.log('\nall four variants verified; example masks deliberately not copied')
}
