// Reverse holo asset library + generated index.
//
// Run: ./node_modules/.bin/tsx scripts/reverse-foil.ts
//
// What this script is allowed to claim
// ------------------------------------
// No physical card photograph or tilt video is bundled with this project, and the
// flat scans do not contain the foil. So every texture here is a PROCEDURAL
// RECONSTRUCTION of the pattern a source describes — bursts for Legendary
// Collection's fireworks, Poké Balls and stars for Emerald/Unseen Forces, a
// pinwheel for Deoxys, and nothing at all for the plain finish.
// `approximation: true` is written into every metadata file. Nothing here is
// presented as a scan of a factory sheet.
//
// What it produces, per pattern, under public/foil/reverse/<id>/:
//   pattern.png     RGBA, marks in the alpha channel
//   alpha.png       the same marks as grayscale
//   meta.json       measured coverage/peak, scale, tileability, honesty flags
//   mask.json       the coverage template this pattern is paired with
//   reflection.json the reflection settings the printing database asks for
//   NOTES.md        what it is, what it is not, and the source
//   reference/      a README explaining why no reference photo ships
//
// And src/foil/reverse-index.ts, which the renderer reads.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'public', 'foil', 'reverse')
const INDEX = path.join(ROOT, 'src', 'foil', 'reverse-index.ts')

const BULBA = 'https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)'

// ---------------------------------------------------------------------------
// Minimal PNG encoder (RGBA and grayscale), no image dependency.
// ---------------------------------------------------------------------------
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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
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

function encodePng(w: number, h: number, channels: 1 | 4, px: Buffer): Buffer {
  const stride = w * channels
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = channels === 4 ? 6 : 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const SIZE = 1024

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Alpha canvas whose `add` wraps, so anything drawn near an edge continues. */
function canvas(seed: number) {
  const alpha = new Float32Array(SIZE * SIZE)
  const add = (x: number, y: number, v: number) => {
    const xi = ((Math.round(x) % SIZE) + SIZE) % SIZE
    const yi = ((Math.round(y) % SIZE) + SIZE) % SIZE
    const i = yi * SIZE + xi
    if (v > alpha[i]) alpha[i] = v
  }
  return { alpha, add, rnd: mulberry32(seed) }
}

function normalize(alpha: Float32Array): Float32Array {
  let peak = 0
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > peak) peak = alpha[i]
  const k = 0.88 / (peak || 1)
  for (let i = 0; i < alpha.length; i++) alpha[i] *= k
  return alpha
}

// ---------------------------------------------------------------------------
// Fireworks: burst-shaped marks.
// ---------------------------------------------------------------------------
function fireworks(): Float32Array {
  const { alpha, add, rnd } = canvas(0x5eed1e)

  const bursts = 18
  for (let b = 0; b < bursts; b++) {
    const cx = rnd() * SIZE
    const cy = rnd() * SIZE
    const core = 18 + rnd() * 26
    const strength = 0.55 + rnd() * 0.45
    for (let y = -core; y <= core; y++) {
      for (let x = -core; x <= core; x++) {
        const d = Math.hypot(x, y) / core
        if (d >= 1) continue
        add(cx + x, cy + y, strength * 0.32 * Math.pow(1 - d, 2))
      }
    }
    const rays = 46 + Math.floor(rnd() * 34)
    const spin = rnd() * Math.PI * 2
    for (let k = 0; k < rays; k++) {
      const angle = spin + (k / rays) * Math.PI * 2 + (rnd() - 0.5) * 0.06
      const len = 60 + rnd() * 130
      const rayGain = 0.45 + rnd() * 0.55
      for (let t = 6; t < len; t++) {
        const fall = Math.pow(1 - t / len, 1.7)
        const px = Math.cos(angle) * t
        const py = Math.sin(angle) * t
        add(cx + px, cy + py, strength * rayGain * fall * 0.9)
        // Thicker strokes: one texel vanishes when the sheet is drawn at card size.
        add(cx + px + 1, cy + py, strength * rayGain * fall * 0.5)
        add(cx + px - 1, cy + py, strength * rayGain * fall * 0.5)
        add(cx + px, cy + py + 1, strength * rayGain * fall * 0.42)
        add(cx + px, cy + py - 1, strength * rayGain * fall * 0.42)
        if (t % 9 === 0) {
          add(cx + px + 1, cy + py, strength * rayGain * fall * 0.45)
          add(cx + px, cy + py + 1, strength * rayGain * fall * 0.45)
        }
      }
      add(cx + Math.cos(angle) * (len + 4), cy + Math.sin(angle) * (len + 4), strength * 0.5)
    }
    // A shell of embers at the burst edge: the silhouette a firework leaves.
    const shell = 30 + Math.floor(rnd() * 22)
    for (let k = 0; k < shell; k++) {
      const angle = rnd() * Math.PI * 2
      const radius = 70 + rnd() * 110
      add(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, strength * (0.28 + rnd() * 0.32))
    }
  }

  for (let i = 0; i < 1400; i++) {
    const x = rnd() * SIZE
    const y = rnd() * SIZE
    const v = 0.12 + rnd() * 0.22
    add(x, y, v)
    if (rnd() > 0.5) add(x + 1, y, v * 0.7)
    if (rnd() > 0.5) add(x, y + 1, v * 0.7)
  }
  return normalize(alpha)
}

// ---------------------------------------------------------------------------
// Poké Balls and stars — EX Emerald / EX Unseen Forces.
// ---------------------------------------------------------------------------
function pokeballs(): Float32Array {
  const { alpha, add, rnd } = canvas(0xb0a7c0)

  const glyph = (cx: number, cy: number, radius: number, strength: number) => {
    // Outline
    const steps = Math.max(48, Math.round(radius * 5))
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      for (let w = -1; w <= 1; w++) {
        add(cx + Math.cos(a) * (radius + w), cy + Math.sin(a) * (radius + w), strength)
      }
    }
    // Horizontal band across the ball
    for (let x = -radius; x <= radius; x++) {
      for (let w = -2; w <= 2; w++) add(cx + x, cy + w, strength * (Math.abs(w) < 2 ? 1 : 0.6))
    }
    // Centre button
    const inner = radius * 0.34
    for (let i = 0; i < Math.max(28, Math.round(inner * 6)); i++) {
      const a = (i / Math.max(28, Math.round(inner * 6))) * Math.PI * 2
      add(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner, strength)
    }
    add(cx, cy, strength)
  }

  const star = (cx: number, cy: number, size: number, strength: number) => {
    // Four-point sparkle: a thin cross with tapered points.
    for (let t = -size; t <= size; t++) {
      const f = 1 - Math.abs(t) / size
      add(cx + t, cy, strength * f)
      add(cx, cy + t, strength * f)
      if (Math.abs(t) <= size * 0.55) {
        add(cx + t * 0.7, cy + t * 0.7, strength * f * rightish(t))
      }
    }
  }
  const rightish = (t: number) => 1 - Math.min(1, Math.abs(t))

  for (let i = 0; i < 26; i++) {
    glyph(rnd() * SIZE, rnd() * SIZE, 22 + rnd() * 14, 0.55 + rnd() * 0.45)
  }
  for (let i = 0; i < 90; i++) {
    star(rnd() * SIZE, rnd() * SIZE, 8 + rnd() * 10, 0.35 + rnd() * 0.45)
  }
  for (let i = 0; i < 500; i++) {
    add(rnd() * SIZE, rnd() * SIZE, 0.1 + rnd() * 0.2)
  }
  return normalize(alpha)
}

// ---------------------------------------------------------------------------
// Pinwheel — EX Deoxys.
// ---------------------------------------------------------------------------
function pinwheels(): Float32Array {
  const { alpha, add, rnd } = canvas(0xd30e1e)

  const wheel = (cx: number, cy: number, radius: number, strength: number) => {
    const blades = 7 + Math.floor(rnd() * 3)
    const spin = rnd() * Math.PI * 2
    for (let b = 0; b < blades; b++) {
      const a0 = spin + (b / blades) * Math.PI * 2
      const turn = 2.1
      for (let t = 3; t < radius; t++) {
        const f = t / radius
        const a = a0 + f * turn
        const fall = Math.pow(1 - f, 1.5)
        const px = cx + Math.cos(a) * t
        const py = cy + Math.sin(a) * t
        add(px, py, strength * fall)
        add(px + 1, py, strength * fall * 0.55)
        add(px, py + 1, strength * fall * 0.55)
      }
    }
    // A faint rim, so the blades read as one wheel rather than loose curls.
    const steps = Math.max(60, Math.round(radius * 3))
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      add(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, strength * 0.25)
    }
    add(cx, cy, strength * 0.8)
  }

  for (let i = 0; i < 14; i++) {
    wheel(rnd() * SIZE, rnd() * SIZE, 60 + rnd() * 70, 0.5 + rnd() * 0.5)
  }
  for (let i = 0; i < 700; i++) {
    add(rnd() * SIZE, rnd() * SIZE, 0.08 + rnd() * 0.18)
  }
  return normalize(alpha)
}

type Texture = {
  id: string
  pattern: string
  label: string
  alpha: Float32Array
  size: number
  plain: boolean
  scale: number
  mask: 'outside-art' | 'art'
  note: string
}

function writeTexture(tex: Texture) {
  const dir = path.join(OUT, tex.id)
  fs.mkdirSync(path.join(dir, 'reference'), { recursive: true })
  const n = tex.size
  const rgba = Buffer.alloc(n * n * 4)
  const grey = Buffer.alloc(n * n)
  for (let i = 0; i < n * n; i++) {
    const a = Math.max(0, Math.min(1, tex.alpha[i]))
    rgba[i * 4] = 255
    rgba[i * 4 + 1] = 255
    rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = Math.round(a * 255)
    grey[i] = Math.round(a * 255)
  }
  fs.writeFileSync(path.join(dir, 'pattern.png'), encodePng(n, n, 4, rgba))
  fs.writeFileSync(path.join(dir, 'alpha.png'), encodePng(n, n, 1, grey))

  let covered = 0
  let peak = 0
  for (let i = 0; i < n * n; i++) {
    if (tex.alpha[i] > 0.1) covered++
    if (tex.alpha[i] > peak) peak = tex.alpha[i]
  }
  const coverage = covered / (n * n)

  let edge = 0
  let interior = 0
  for (let y = 0; y < n; y++) {
    edge += Math.abs(tex.alpha[y * n] - tex.alpha[y * n + n - 1])
    interior += Math.abs(tex.alpha[y * n + 1] - tex.alpha[y * n])
  }
  edge /= n
  interior /= n

  const meta = {
    pattern: tex.pattern,
    label: tex.label,
    texture: `/foil/reverse/${tex.id}/pattern.png`,
    alpha: `/foil/reverse/${tex.id}/alpha.png`,
    size: `${n}x${n}`,
    scale: tex.scale,
    coverage: Number(coverage.toFixed(4)),
    peak: Number(peak.toFixed(4)),
    plain: tex.plain,
    mask: tex.mask,
    tileable: interior > 0 ? edge < interior * 3 : true,
    seam: { edge: Number(edge.toFixed(4)), interior: Number(interior.toFixed(4)) },
    approximation: true,
    reproduction: 'procedural reconstruction',
    note: tex.note,
    source: BULBA,
    generatedBy: 'scripts/reverse-foil.ts',
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
  fs.writeFileSync(
    path.join(dir, 'mask.json'),
    JSON.stringify(
      {
        kind: tex.mask,
        artWindow: { x: 0.081, y: 0.116, w: 0.838, h: 0.448 },
        note: tex.mask === 'art'
          ? 'Foil sits inside the picture window; the card body stays matte. Which expansion uses which template is decided in src/foil/reverse-db.ts.'
          : 'Foil covers the card body; the illustration window stays matte. Which expansion uses which template is decided in src/foil/reverse-db.ts.',
        source: BULBA,
      },
      null,
      2,
    ) + '\n',
  )
  fs.writeFileSync(
    path.join(dir, 'reflection.json'),
    JSON.stringify(
      tex.plain
        ? { intensity: 0.85, iridescence: 0.55, patternOpacity: 0, note: 'A plain foil has no marks, so the reflection is uniform.' }
        : { intensity: 0.95, iridescence: 0.85, patternOpacity: 1, note: 'Marks modulate the reflection; the hue still comes from the iridescence layer.' },
      null,
      2,
    ) + '\n',
  )
  fs.writeFileSync(
    path.join(dir, 'NOTES.md'),
    [
      `# ${tex.label} — reverse holo pattern`,
      '',
      '## What this is',
      '',
      tex.note,
      '',
      'The texture is a **procedural reconstruction** generated by',
      '`scripts/reverse-foil.ts`. It is not a scan of a factory sheet and not a',
      'photograph: no physical reference was bundled with this project, and the flat',
      'card scans do not contain foil. It is labelled an approximation everywhere it',
      'is exposed.',
      '',
      '## Measurements',
      '',
      `- coverage: ${(coverage * 100).toFixed(2)}% of texels carry a mark`,
      `- peak: ${peak.toFixed(3)}`,
      `- tileable: ${meta.tileable} (edge ${edge.toFixed(4)} vs interior ${interior.toFixed(4)})`,
      `- scale: ${tex.scale} copies across the card`,
      `- paired mask: ${tex.mask}`,
      '',
      '## Reference',
      '',
      'No reference photograph ships. `reference/README.md` explains what would be',
      'needed to verify the reconstruction, and Bulbapedia is cited as the source for',
      "the pattern's description.",
      '',
      `Source: ${BULBA}`,
      '',
    ].join('\n'),
  )
  fs.writeFileSync(
    path.join(dir, 'reference', 'README.md'),
    [
      '# Reference images',
      '',
      'None are bundled. The flat card scans this project owns show printed artwork,',
      'not foil, so they cannot verify a reverse pattern. Two owner-supplied',
      'photographs under angled light — one face-on, one at roughly 45° — would be',
      'enough to check the mark shape, density and scale of this reconstruction.',
      '',
      'Until then the pattern is an approximation, and the metadata says so.',
      '',
    ].join('\n'),
  )
  return meta
}

// ---------------------------------------------------------------------------
// Build the patterns
// ---------------------------------------------------------------------------
const plainSize = 32
const textures: Texture[] = [
  {
    id: 'fireworks',
    pattern: 'reverse-fireworks',
    label: 'Fireworks (Legendary Collection)',
    alpha: fireworks(),
    size: SIZE,
    plain: false,
    scale: 1.6,
    mask: 'outside-art',
    note: 'Burst-shaped glints — a soft core with radiating rays and trailing embers — spread over the card body. Described by Bulbapedia as a "fireworks" design.',
  },
  {
    id: 'pokeball',
    pattern: 'reverse-pokeball',
    label: 'Poké Ball and stars (EX Emerald / Unseen Forces)',
    alpha: pokeballs(),
    size: SIZE,
    plain: false,
    scale: 2.2,
    mask: 'art',
    note: 'Poké Ball glyphs with four-point stars, placed inside the picture window. Bulbapedia describes Poké Balls and stars for Emerald and a 3D Poké Ball for Unseen Forces.',
  },
  {
    id: 'pinwheel',
    pattern: 'reverse-pinwheel',
    label: 'Pinwheel (EX Deoxys)',
    alpha: pinwheels(),
    size: SIZE,
    plain: false,
    scale: 1.8,
    mask: 'art',
    note: 'Spiral-bladed pinwheels with a faint rim, inside the artwork. Bulbapedia describes a "pinwheel" holo pattern with the set logo bottom-right, which is printed and not duplicated here.',
  },
  {
    id: 'flat',
    pattern: 'reverse-flat',
    label: 'Plain foil (Expedition, Diamond & Pearl run)',
    alpha: new Float32Array(plainSize * plainSize).fill(1),
    size: plainSize,
    plain: true,
    scale: 1,
    mask: 'outside-art',
    note: 'A plain reflective finish with no printed pattern: the foil itself is the whole effect.',
  },
]

const metas = textures.map(writeTexture)

// ---------------------------------------------------------------------------
// Generated index
// ---------------------------------------------------------------------------
const db = new Database(path.join(ROOT, 'data', 'tcglife.db'), { readonly: true })
function pick(setId: string, number: string) {
  const row = db.prepare('select id, name, rarity from cards where id = ?').get(`${setId}-${number}`) as
    | { id: string; name: string; rarity: string }
    | undefined
  return row ? { cardId: row.id, setId, number, name: row.name, rarity: row.rarity, variant: 'reverseHolofoil' } : null
}
const showcase = [
  pick('base6', '2'),
  pick('ecard1', '2'),
  pick('ex9', '2'),
  pick('ex8', '2'),
  pick('dp1', '2'),
].filter(Boolean)
db.close()

const entry = (m: (typeof metas)[number]) => `  ${JSON.stringify(m.pattern)}: {
    id: ${JSON.stringify(m.pattern)},
    label: ${JSON.stringify(m.label)},
    texture: ${JSON.stringify(m.texture)},
    alpha: ${JSON.stringify(m.alpha)},
    size: ${JSON.stringify(m.size)},
    scale: ${m.scale},
    plain: ${m.plain},
    mask: ${JSON.stringify(m.mask)},
    coverage: ${m.coverage},
    peak: ${m.peak},
    tileable: ${m.tileable},
    approximation: ${m.approximation},
    reproduction: ${JSON.stringify(m.reproduction)},
    note: ${JSON.stringify(m.note)},
    source: ${JSON.stringify(m.source)},
  },`

const body = `// GENERATED by scripts/reverse-foil.ts — do not hand-edit.
//
// Reverse holo textures. Every one is a PROCEDURAL RECONSTRUCTION of the pattern
// a source describes: no factory scan or photograph was available, so
// \`approximation\` is true throughout. The plain finish is modelled as a uniform
// field rather than a texture full of marks, because a plain foil has none.

import type { FoilPatternId } from './patterns'

export type ReverseAsset = {
  id: FoilPatternId
  label: string
  /** Same-origin RGBA sheet (marks in the alpha channel). */
  texture: string
  alpha: string
  size: string
  /** Copies across the card at 1x. */
  scale: number
  /** No printed marks: a uniform reflective finish. */
  plain: boolean
  /** Coverage template this pattern is documented with. */
  mask: 'outside-art' | 'art'
  coverage: number
  peak: number
  tileable: boolean
  approximation: boolean
  reproduction: string
  note: string
  source: string
}

export const REVERSE_ASSETS: Partial<Record<FoilPatternId, ReverseAsset>> = {
${metas.map(entry).join('\n')}
}

export const REVERSE_INDEX_VERSION = 1

/** Cards the inspector opens for the validated reverse batches. */
export const REVERSE_SHOWCASE: { cardId: string; setId: string; number: string; name: string; rarity: string; variant: string }[] = ${JSON.stringify(showcase, null, 2)}
`

fs.writeFileSync(INDEX, body)

console.log(
  metas
    .map((m) => `${m.pattern}: ${m.size}, coverage ${(m.coverage * 100).toFixed(2)}%, peak ${m.peak}, mask ${m.mask}, tileable ${m.tileable}`)
    .join('\n'),
)
console.log('assets written to public/foil/reverse; index: src/foil/reverse-index.ts')
