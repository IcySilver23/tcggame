// Modern special reverse papers (Poké Ball / Master Ball) → four sheets + index.
//
// Run: ./node_modules/.bin/tsx scripts/reverse-special-foil.ts
//
// What is sourced: the finish (foil on the frame and text box), the ball, the
// sets, and the layout each set uses (one large ball behind the attack text for
// Prismatic Evolutions and Ascended Heroes; rows for Black Bolt and White Flare).
//
// What was reviewed: real photographs of a Prismatic Evolutions Poké Ball Sylveon
// and Master Ball Umbreon, plus published Terastal Festival ex and Black
// Bolt/White Flare renders. They confirm the two layouts, the M on the Master
// Ball, the fine etch that crosses artwork and body, and that the row references
// alternate large and small balls. The Sylveon photo fixes the large ball at about
// 0.52 card widths across, centred about 0.675 down the card; the Terastal render
// agrees. They do not make these sheets traces.
//
// What is drawn: the ball glyphs, facet spacing, exact row count and registration.
// The etched field is rendered separately in `src/foil/reverse-etch.ts` as a
// full-card relief; this sheet only draws the ball foil. Every asset still records
// `approximation: true`.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'
import type { FoilPatternId } from '../src/foil/patterns'
import {
  ASCENDED_BALL_GEOMETRY,
  BALL_STAMPS,
  type BallStamp,
  type SpecialStampId,
} from '../src/foil/ball-stamps'

// Ascended Heroes prints five ASSIGNED ball papers — Poké Ball, Love Ball, Friend
// Ball, Quick Ball, Dusk Ball — and gives Team Rocket's Pokémon an "R" where the
// ball would sit. The assignment itself lives in src/foil/ball-stamps.ts; this
// script only draws each paper. The R is not a ball: it is a disc with a letter,
// so it is never modelled as one.

const OUT_DIR = 'public/foil/reverse/special'
const INDEX_FILE = 'src/foil/reverse-special-index.ts'
const SIZE = 512

// The row references are a five-column lattice: large and small balls alternate,
// each row is staggered by half a cell, and the tile is sampled five times across
// the card. The outer rings measure about 56px (large) and 32px (small) on the
// 335px-wide reference cards; the column pitch is about 67.5px and the row pitch
// about 69px. The sheet radii are derived from those measurements, not guessed.
const ROWS_MEASURED = {
  cardWidthPx: 335,
  largeBallPx: 56,
  smallBallPx: 32,
  columnPitchPx: 67.5,
  rowPitchPx: 69,
} as const
const ROWS = {
  columns: 5,
  rows: 5,
  largeRadius: (ROWS_MEASURED.largeBallPx / ROWS_MEASURED.cardWidthPx) / (2 * 0.72),
  smallRadius: (ROWS_MEASURED.smallBallPx / ROWS_MEASURED.cardWidthPx) / (2 * 0.72),
  jitter: 0.003,
  scale: 1,
} as const
const RING_RADIUS = 0.72

/**
 * The radius that draws the Ascended Heroes ball at the size its photograph
 * measures. The sheet's ring sits at 0.72 of the stamped radius and the sampler
 * shows 0.95 of the sheet across the card, so the card diameter is
 * 2 * 0.72 * radius * 0.95; solving for the measured 0.434 gives this radius.
 * The inherited 0.3 drew 0.410 across — about 6% small against the photo — and
 * stays as the default for the Prismatic and Black Bolt/White Flare papers,
 * which were measured from their own references and must not be re-sized here.
 */
const ASCENDED_BALL_RADIUS = ASCENDED_BALL_GEOMETRY.diameter / (2 * RING_RADIUS * 0.95)

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
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ])
}

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

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t))
}

function pointInPolygon(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * The mark inside a ball's upper half. Every one is a drawing: no photograph of
 * these five papers was available, so the heart, flower, bolt, crescent and R
 * are stylised shapes placed where the ball's cap is, not traced artwork.
 */
function markInk(mark: BallStamp['mark'], x: number, y: number): boolean {
  switch (mark) {
    case 'none':
      return false
    case 'm': {
      // An M on the upper half: four strokes, clipped inside the top cap.
      const strokes: [number, number, number, number][] = [
        [-0.36, 0.12, -0.22, -0.5],
        [-0.22, -0.5, 0, -0.02],
        [0, -0.02, 0.22, -0.5],
        [0.22, -0.5, 0.36, 0.12],
      ]
      return strokes.some(([ax, ay, bx, by]) => segmentDistance(x, y, ax, ay, bx, by) < 0.075)
    }
    case 'heart': {
      // Implicit heart: (px² + py² - 1)³ - px²py³ <= 0, y measured upward.
      const px = x / 0.29
      const py = -(y + 0.3) / 0.29
      const a = px * px + py * py - 1
      return a * a * a - px * px * py * py * py <= 0
    }
    case 'flower': {
      if (Math.hypot(x, y + 0.3) < 0.055) return true
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
        if (Math.hypot(x - Math.cos(a) * 0.15, y + 0.3 - Math.sin(a) * 0.15) < 0.08) return true
      }
      return false
    }
    case 'bolt':
      return pointInPolygon(x, y, [
        [0.05, -0.62], [-0.18, -0.14], [0, -0.14], [-0.06, 0.02],
        [0.22, -0.34], [0.03, -0.34],
      ])
    case 'crescent':
      return Math.hypot(x - 0.03, y + 0.3) < 0.26 && Math.hypot(x - 0.16, y + 0.37) > 0.21
    case 'r': {
      // Stem, bowl and leg of an R.
      const stem = x >= -0.22 && x <= -0.09 && y >= -0.58 && y <= 0.02
      const d = Math.hypot(x + 0.07, y + 0.44)
      const bowl = d > 0.085 && d < 0.16 && y <= -0.36
      const leg = segmentDistance(x, y, -0.09, -0.4, 0.14, -0.02) < 0.065
      return stem || bowl || leg
    }
  }
}

/** Ink at normalised (-1..1) coordinates for one stamp. */
function ballInk(stamp: SpecialStampId, x: number, y: number): number {
  const mark = BALL_STAMPS[stamp].mark
  const r = Math.hypot(x, y)
  if (r > 1) return 0
  // Team Rocket's paper is a disc carrying an R, not a ball: ring and letter,
  // no equator band and no centre button.
  if (mark === 'r') {
    if (Math.abs(r - 0.76) < 0.09) return 1
    return markInk('r', x, y) ? 1 : 0
  }
  const ring = Math.abs(r - 0.72) < 0.1
  const band = Math.abs(y) < 0.085 && Math.abs(x) < 0.7
  const button = Math.abs(r - 0.24) < 0.075
  if (ring || band || button) return 1
  return markInk(mark, x, y) ? 1 : 0
}

function makeCanvas() {
  return new Float32Array(SIZE * SIZE)
}

function add(alpha: Float32Array, x: number, y: number, v: number, wrap: boolean) {
  let xi = Math.round(x)
  let yi = Math.round(y)
  if (wrap) {
    xi = ((xi % SIZE) + SIZE) % SIZE
    yi = ((yi % SIZE) + SIZE) % SIZE
  } else if (xi < 0 || yi < 0 || xi >= SIZE || yi >= SIZE) return
  const i = yi * SIZE + xi
  if (v > alpha[i]) alpha[i] = v
}

/** Stamp one ball at pixel centre with radius r. */
function stampBall(
  alpha: Float32Array,
  cx: number,
  cy: number,
  r: number,
  ball: SpecialStampId,
  wrap: boolean,
  level = 0.88,
) {
  const x0 = Math.floor(cx - r) - 1
  const x1 = Math.ceil(cx + r) + 1
  const y0 = Math.floor(cy - r) - 1
  const y1 = Math.ceil(cy + r) + 1
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - cx) / r
      const ny = (y + 0.5 - cy) / r
      if (nx < -1 || nx > 1 || ny < -1 || ny > 1) continue
      if (ballInk(ball, nx, ny)) add(alpha, x, y, level, wrap)
    }
  }
}

/**
 * Shattered-glass layer: thin boundaries between neighbouring cells, drawn as
 * F2 - F1 of a seeded point set. Faint by design (sources describe the layer as a
 * texture under the ball stamps, not a second pattern), and toroidal when the
 * sheet tiles.
 */
function addFacets(alpha: Float32Array, seed: number, wrap: boolean, strength: number, count = 42) {
  const rnd = mulberry32(seed)
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < count; i++) pts.push({ x: rnd() * SIZE, y: rnd() * SIZE })
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let d1 = Infinity
      let d2 = Infinity
      for (const p of pts) {
        let dx = Math.abs(x + 0.5 - p.x)
        let dy = Math.abs(y + 0.5 - p.y)
        if (wrap) {
          dx = Math.min(dx, SIZE - dx)
          dy = Math.min(dy, SIZE - dy)
        }
        const d = Math.hypot(dx, dy)
        if (d < d1) { d2 = d1; d1 = d } else if (d < d2) d2 = d
      }
      if (d2 - d1 < 1.4) {
        const i = y * SIZE + x
        const v = strength * (1 - (d2 - d1) / 1.4)
        if (v > alpha[i]) alpha[i] = v
      }
    }
  }
}

function measure(alpha: Float32Array, wrap: boolean): { coverage: number; peak: number; seam: number } {
  let covered = 0
  let peak = 0
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] > 0.1) covered++
    if (alpha[i] > peak) peak = alpha[i]
  }
  let edge = 0
  let interior = 0
  for (let y = 0; y < SIZE; y++) {
    edge += Math.abs(alpha[y * SIZE] - alpha[y * SIZE + SIZE - 1])
    interior += Math.abs(alpha[y * SIZE + 1] - alpha[y * SIZE])
  }
  for (let x = 0; x < SIZE; x++) {
    edge += Math.abs(alpha[x] - alpha[(SIZE - 1) * SIZE + x])
    interior += Math.abs(alpha[SIZE + x] - alpha[x])
  }
  return {
    coverage: covered / (SIZE * SIZE),
    peak,
    seam: wrap && interior > 1e-6 ? edge / interior : 0,
  }
}

function toRgba(alpha: Float32Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let i = 0, n = SIZE * SIZE; i < n; i++) {
    rgba[i * 4] = 255
    rgba[i * 4 + 1] = 255
    rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = Math.round(clamp01(alpha[i]) * 255)
  }
  return rgba
}

type Evidence = {
  kind: 'photograph' | 'render'
  url: string
  label: string
  confirms: string
  limits: string
}

type Asset = {
  id: string
  ball: SpecialStampId
  layout: 'large' | 'rows'
  label: string
  texture: string
  scale: number
  centerU: number
  centerV: number
  coverage: number
  peak: number
  tileable: boolean
  seam: number
  approximation: true
  /** Drawn outer-ring diameter in card widths (large layout only). */
  largeDiameter?: number
  note: string
  source: string
  evidence: Evidence
  rows?: {
    columns: number
    rows: number
    /** Full stamp radius before the printed ring, as a fraction of the sheet. */
    largeRadius: number
    smallRadius: number
    /** Outer-ring diameter as a fraction of the card width at scale 1. */
    largeBallWidth: number
    smallBallWidth: number
    aspectCorrected: true
  }
}

const assets: Asset[] = []
const problems: string[] = []
fs.mkdirSync(OUT_DIR, { recursive: true })

function build(ball: SpecialStampId, layout: 'large' | 'rows', ballRadius = 0.3): { alpha: Float32Array; coverage: number; peak: number; seam: number; centerU: number; centerV: number; scale: number } {
  const alpha = makeCanvas()
  const wrap = layout === 'rows'
  let centerU = 0.5
  // The large layout is measured from the real Sylveon photo: the outer ring is
  // ~0.52 card widths across and its centre ~0.675 down the card. The 0.95 sampler
  // window in largeBallCopyFor turns this 252/512 sheet ring into that size; the
  // old 0.78 window drew it ~0.63 wide. Rows keep the original sheet centre.
  let centerV = layout === 'large' ? 0.675 : 0.56
  let scale = 1

  if (layout === 'large') {
    addFacets(alpha, 0x9a1c + Object.keys(BALL_STAMPS).indexOf(ball) * 7, false, 0.16)
    stampBall(alpha, SIZE * centerU, SIZE * centerV, SIZE * ballRadius, ball, false, 0.9)
  } else {
    addFacets(alpha, 0x51ce + Object.keys(BALL_STAMPS).indexOf(ball) * 11, true, 0.12)
    const rnd = mulberry32(0x5eed + (ball === 'masterball' ? 5 : 0))
    for (let row = 0; row < ROWS.rows; row++) {
      for (let col = 0; col < ROWS.columns; col++) {
        const large = (col + row) % 2 === 0
        const r = SIZE * (large ? ROWS.largeRadius : ROWS.smallRadius)
        const cx = ((col + 0.5 + (row % 2 ? 0.5 : 0)) / ROWS.columns) * SIZE
          + (rnd() - 0.5) * SIZE * ROWS.jitter
        const cy = ((row + 0.5) / ROWS.rows) * SIZE
          + (rnd() - 0.5) * SIZE * ROWS.jitter
        stampBall(alpha, cx, cy, r, ball, true, 0.86)
      }
    }
    scale = ROWS.scale
  }

  const m = measure(alpha, wrap)
  return { alpha, ...m, centerU, centerV, scale }
}

const BALL_LABEL = Object.fromEntries(
  Object.entries(BALL_STAMPS).map(([id, s]) => [id, s.label]),
) as Record<SpecialStampId, string>
const SOURCES = {
  pre: 'https://www.pokebeach.com/2025/01/prismatic-evolutions-set-guide-full-card-list-secret-rares-cut-cards-products-and-more',
  bw: 'https://www.pokebeach.com/2025/07/black-bolt-and-white-flare-english-set-guides-full-card-lists-pull-rates-cut-cards-products-and-more',
  foilfox: 'https://foilfox.app/guides/pokemon-finishes',
  terastal: 'https://www.pokebeach.com/2024/11/terastal-festival-ex-reverse-holos-will-feature-textured-etching-master-ball-pattern',
  folio: 'https://folio.fyi/blog/pokemon-holo-patterns',
  coded: 'https://www.codedyellow.com/reverse-holo-patterns',
  ascended: 'https://www.pokebeach.com/2026/01/ascended-heroes-set-guide-full-set-list-god-packs-reverse-holos-product-lineup-and-more',
}

/** What a reference settles, and what it does not. */
function evidenceFor(ball: SpecialStampId, layout: 'large' | 'rows', ascended = false): Evidence {
  if (layout === 'large' && ascended) {
    return {
      kind: 'photograph',
      url: 'https://www.pokebeach.com/news/2026/01/Snorunt-Poke-Ball-Reverse-Holo.png',
      label: 'Real Ascended Heroes Snorunt Poké Ball reverse (set-guide photograph)',
      confirms: `One large ball behind the attack text, on the card body with the illustration window matte. Fitted to this photograph's ring, the outer circle is ${ASCENDED_BALL_GEOMETRY.diameter} of the card's width across, centred about (${ASCENDED_BALL_GEOMETRY.centerU}, ${ASCENDED_BALL_GEOMETRY.centerV}) — the placement the Prismatic photograph gave, which this agrees with — and its button sits about a third of the way out, as the sheet draws it.`,
      limits: 'A Poké Ball card photographed at a slight angle: it settles the layout, the ring size and the placement, not the heart, flower, bolt or crescent inside the other four papers, nor the R on Team Rocket’s, which stay this build’s drawings. The ball glyph and facet spacing are drawn and the etch is a separate modelled relief.',
    }
  }
  if (layout === 'large') {
    if (ball === 'masterball') {
      return {
        kind: 'photograph',
        url: SOURCES.folio,
        label: 'Real Prismatic Evolutions Umbreon Master Ball reverse',
        confirms: 'One large Master Ball with an M behind the attack text; a fine crosshatched etch runs across the artwork and body.',
        limits: 'Photo confirms this ball and layout, not the shipped sheet: the glyph and facet spacing are drawn. The etch is a separate full-card relief, modelled rather than scanned.',
      }
    }
    return {
      kind: 'photograph',
      url: 'https://i.ebayimg.com/images/g/0rQAAeSwoZRoK8jv/s-l1600.jpg',
      label: 'Real Prismatic Evolutions Sylveon Poké Ball reverse (PSA 9, cert 108712104)',
      confirms: 'One large Poké Ball behind the attack text; measured from this photo, its outer circle is about 0.52 of the card width and its centre about 0.675 down the card, with the fine crosshatched etch crossing artwork and body.',
      limits: "A single angled, slabbed photo under glare confirms the layout, silhouette, size and placement, not the shipped glyph or facet spacing. The ball artwork is drawn; the etch is a separate full-card relief, modelled rather than scanned.",
    }
  }
  const reference = ball === 'pokeball'
    ? {
        url: 'https://www.codedyellow.com/wp-content/uploads/2023/04/Black-Bolt-Poke-Ball.jpg.webp',
        label: 'Black Bolt Poké Ball reverse card image',
      }
    : {
        url: 'https://www.codedyellow.com/wp-content/uploads/2023/04/White-Flare-Master-Ball-Reverse-Holo.jpg.webp',
        label: 'White Flare Master Ball reverse card image',
      }
  return {
    kind: 'render',
    ...reference,
    confirms: 'Five columns of large and small balls alternate in staggered rows across the frame and text box; the outer rings measure about 56px (large) and 32px (small) on the 335px reference card.',
    limits: 'Published card image only. The five-column pitch and ball diameters are measured from the image; the glyph, facet spacing and exact row registration remain drawings.',
  }
}

// The two documented papers keep both layouts; Ascended Heroes' assigned papers
// exist only in the one-large form, so no rows sheet is invented for them.
// Ids are explicit: BALL_STAMPS now names the Ascended Poké Ball paper, so a
// lookup would hand the Prismatic entry the assigned sheet's id and overwrite it.
const PLAN: { id: FoilPatternId; ball: SpecialStampId; layout: 'large' | 'rows'; ascended?: boolean }[] = [
  { id: 'reverse-pokeball-large', ball: 'pokeball', layout: 'large' },
  { id: 'reverse-masterball-large', ball: 'masterball', layout: 'large' },
  { id: 'reverse-pokeball-rows', ball: 'pokeball', layout: 'rows' },
  { id: 'reverse-masterball-rows', ball: 'masterball', layout: 'rows' },
  // Ascended Heroes assigns its own paper per card, so each of its six papers is
  // a separate printing — including its Poké Ball, which is NOT Prismatic's and
  // has its own measured size.
  ...(['pokeball', 'loveball', 'friendball', 'quickball', 'duskball', 'teamrocket'] as const)
    .map((ball) => ({ id: BALL_STAMPS[ball].pattern, ball, layout: 'large' as const, ascended: true })),
]

for (const { id, ball, layout, ascended } of PLAN) {
  {
    const radius = ascended ? ASCENDED_BALL_RADIUS : 0.3
    const built = build(ball, layout, radius)
    const file = path.join(OUT_DIR, `${id}.png`)
    fs.writeFileSync(file, encodePng(SIZE, SIZE, toRgba(built.alpha)))
    console.log(`${file}: coverage ${(built.coverage * 100).toFixed(1)}%, peak ${built.peak.toFixed(2)}, seam ${built.seam.toFixed(2)}`)
    if (built.coverage < 0.02 || built.coverage > 0.6) problems.push(`${id}: coverage ${(built.coverage * 100).toFixed(1)}%`)
    if (built.peak < 0.6) problems.push(`${id}: peak ${built.peak.toFixed(2)} too dim`)
    // A seam ratio near 1 means crossing the wrap differs no more than moving one
    // column inside the sheet; above 2.5 the tile edge is a visible break.
    if (layout === 'rows' && built.seam > 2.5) problems.push(`${id}: seam ratio ${built.seam.toFixed(2)} too high to tile`)
    assets.push({
      id, ball, layout,
      label: `${BALL_LABEL[ball]} (${layout === 'large' ? 'one large' : 'rows'})`,
      texture: `/foil/reverse/special/${id}.png`,
      scale: built.scale,
      centerU: built.centerU,
      centerV: built.centerV,
      largeDiameter: layout === 'large' ? Number((2 * RING_RADIUS * radius * 0.95).toFixed(4)) : undefined,
      coverage: Number(built.coverage.toFixed(4)),
      peak: Number(built.peak.toFixed(3)),
      tileable: layout === 'rows',
      seam: Number(built.seam.toFixed(4)),
      approximation: true,
      note: layout === 'large'
        ? (ascended
            ? `One large ${BALL_LABEL[ball]} behind the attack text, over a faint etched field, drawn at the ${ASCENDED_BALL_GEOMETRY.diameter}-card-width ring a real Ascended Heroes photograph measures. The layout and the size are photographed; the ball artwork and facet spacing are this build's drawing.`
            : `One large ${BALL_LABEL[ball]} behind the attack text, over a faint etched field. The layout is photographed/rendered; the ball artwork and facet spacing are this build's drawing.`)
        : `Rows of alternating large and small ${BALL_LABEL[ball]} stamps over a faint etched field, tiled so a card can sample any window. The five-column lattice and ball diameters are measured from the Black Bolt and White Flare images; the glyph, facet spacing and exact row registration are modelled.`,
      source: layout === 'large' ? (ascended ? SOURCES.ascended : SOURCES.foilfox) : SOURCES.bw,
      evidence: evidenceFor(ball, layout, ascended),
      rows: layout === 'rows'
        ? {
            columns: ROWS.columns,
            rows: ROWS.rows,
            largeRadius: Number(ROWS.largeRadius.toFixed(6)),
            smallRadius: Number(ROWS.smallRadius.toFixed(6)),
            largeBallWidth: Number(((2 * RING_RADIUS * ROWS.largeRadius) / ROWS.scale).toFixed(4)),
            smallBallWidth: Number(((2 * RING_RADIUS * ROWS.smallRadius) / ROWS.scale).toFixed(4)),
            aspectCorrected: true,
            measured: ROWS_MEASURED,
          }
        : undefined,
    })
  }
}

type Showcase = { cardId: string; setId: string; number: string; name: string; rarity: string; variant: string; group: string }
const showcase: Showcase[] = []
const DB_FILE = 'data/tcglife.db'
if (fs.existsSync(DB_FILE)) {
  const db = new Database(DB_FILE, { readonly: true })
  const ids = ['sv8pt5-1', 'sv8pt5-2', 'zsv10pt5-1', 'zsv10pt5-2', 'me2pt5-1', 'me2pt5-8', 'me2pt5-11', 'me2pt5-17', 'me2pt5-18', 'me2pt5-90']
  const rows = db.prepare(`select id, set_id, number, name, rarity from cards where id in (${ids.map(() => '?').join(',')})`).all(...ids) as
    { id: string; set_id: string; number: string; name: string; rarity: string | null }[]
  db.close()
  const byId = new Map(rows.map((r) => [r.id, r]))
  const add = (cardId: string, variant: string) => {
    const r = byId.get(cardId)
    if (!r) { problems.push(`showcase card missing: ${cardId}`); return }
    showcase.push({ cardId: r.id, setId: r.set_id, number: r.number, name: r.name, rarity: r.rarity ?? '', variant, group: 'Special reverse' })
  }
  add('sv8pt5-1', 'reverseHolofoilPokeBall')
  add('sv8pt5-2', 'reverseHolofoilMasterBall')
  add('zsv10pt5-1', 'reverseHolofoilPokeBall')
  add('zsv10pt5-2', 'reverseHolofoilMasterBall')
  add('me2pt5-1', 'reverseHolofoilPokeBall')
  add('me2pt5-8', BALL_STAMPS.friendball.variant)
  add('me2pt5-11', BALL_STAMPS.loveball.variant)
  add('me2pt5-17', BALL_STAMPS.quickball.variant)
  add('me2pt5-18', BALL_STAMPS.teamrocket.variant)
  add('me2pt5-90', BALL_STAMPS.duskball.variant)
} else problems.push('card database missing')

const rowsEntry = (a: Asset): string => a.rows
  ? `    rows: {
      columns: ${a.rows.columns},
      rows: ${a.rows.rows},
      largeRadius: ${a.rows.largeRadius},
      smallRadius: ${a.rows.smallRadius},
      largeBallWidth: ${a.rows.largeBallWidth},
      smallBallWidth: ${a.rows.smallBallWidth},
      aspectCorrected: true,
      measured: {
        cardWidthPx: ${a.rows.measured.cardWidthPx},
        largeBallPx: ${a.rows.measured.largeBallPx},
        smallBallPx: ${a.rows.measured.smallBallPx},
        columnPitchPx: ${a.rows.measured.columnPitchPx},
        rowPitchPx: ${a.rows.measured.rowPitchPx},
      },
    },
`
  : ''

const assetEntries = assets.map((a) => `  ${JSON.stringify(a.id)}: {
    id: ${JSON.stringify(a.id)},
    ball: ${JSON.stringify(a.ball)},
    layout: ${JSON.stringify(a.layout)},
    label: ${JSON.stringify(a.label)},
    texture: ${JSON.stringify(a.texture)},
    scale: ${a.scale},
    centerU: ${a.centerU},
    centerV: ${a.centerV},
${a.largeDiameter ? `    largeDiameter: ${a.largeDiameter},\n` : ''}    coverage: ${a.coverage},
    peak: ${a.peak},
    tileable: ${a.tileable},
    seam: ${a.seam},
    approximation: true,
    note: ${JSON.stringify(a.note)},
    source: ${JSON.stringify(a.source)},
${rowsEntry(a)}    evidence: {
      kind: ${JSON.stringify(a.evidence.kind)},
      url: ${JSON.stringify(a.evidence.url)},
      label: ${JSON.stringify(a.evidence.label)},
      confirms: ${JSON.stringify(a.evidence.confirms)},
      limits: ${JSON.stringify(a.evidence.limits)},
    },
  },`).join('\n')

const showcaseEntries = showcase.map((s) => `  ${JSON.stringify(s)},`).join('\n')

const index = `// GENERATED by scripts/reverse-special-foil.ts — do not hand-edit.
//
// Modern special reverses: the frame/text-box foil of a reverse holo with a
// stamped paper. Two layouts ship, because the sources describe two: one large
// stamp behind the attack text (Prismatic Evolutions, Ascended Heroes), and rows
// of balls (Black Bolt, White Flare). Ascended Heroes prints five assigned ball
// papers — Poké Ball, Love Ball, Friend Ball, Quick Ball, Dusk Ball — and gives
// Team Rocket’s Pokémon an R in place of the ball; the assignment lives in
// src/foil/ball-stamps.ts.
//
// Real Poké Ball and Master Ball photographs and published renders confirm the
// layouts, the M, the etched field and the alternating large/small row rhythm; the
// large Poké Ball photo also fixes the ball's size and placement. An Ascended
// Heroes Snorunt reverse measures that set's own ball at 0.434 card widths, so its
// six papers — Poké Ball included — are separate sheets at that size, while the
// Prismatic and Black Bolt/White Flare papers keep the geometry their references
// gave. The rows sheet's five-column lattice and ball diameters are measured from
// the reference images; the glyph artwork, facet spacing and exact registration are
// still drawings. Every asset records approximation: true, and its evidence records
// what the reference does not settle.

import type { FoilPatternId } from './patterns'
import type { SpecialStampId } from './ball-stamps'

export type SpecialReverseAsset = {
  id: FoilPatternId
  ball: SpecialStampId
  layout: 'large' | 'rows'
  label: string
  texture: string
  /** Horizontal copies across the card at 1x (rows layout only). */
  scale: number
  /** Sheet position of the ball's centre (large layout). */
  centerU: number
  centerV: number
  /** Drawn outer-ring diameter in card widths (large layout only). */
  largeDiameter?: number
  coverage: number
  peak: number
  tileable: boolean
  seam: number
  approximation: true
  note: string
  /** Row-grid geometry (rows layout only). */
  rows?: {
    columns: number
    rows: number
    largeRadius: number
    smallRadius: number
    largeBallWidth: number
    smallBallWidth: number
    aspectCorrected: true
    measured: {
      cardWidthPx: number
      largeBallPx: number
      smallBallPx: number
      columnPitchPx: number
      rowPitchPx: number
    }
  }
  source: string
  evidence: {
    kind: 'photograph' | 'render'
    url: string
    label: string
    confirms: string
    limits: string
  }
}

export const SPECIAL_REVERSE_ASSETS: Partial<Record<FoilPatternId, SpecialReverseAsset>> = {
${assetEntries}
}

export const SPECIAL_REVERSE_TEXTURE_VERIFIED = false
export const SPECIAL_REVERSE_NOTE =
  'A photographed or render-confirmed ball layout drawn over a faint etched field; the ball glyphs, facet spacing, exact row count and registration are procedural. The etch is a separate full-card relief, modelled rather than scanned.'

export const SPECIAL_REVERSE_SHOWCASE: {
  cardId: string; setId: string; number: string; name: string; rarity: string; variant: string; group: string
}[] = [
${showcaseEntries}
]
`

fs.writeFileSync(INDEX_FILE, index)
console.log(`written: ${INDEX_FILE} (${assets.length} assets, ${showcase.length} showcase cards)`)
if (problems.length) { for (const p of problems) console.log(' -', p); process.exitCode = 1 }
else console.log('all special reverse assets pass their gates')
