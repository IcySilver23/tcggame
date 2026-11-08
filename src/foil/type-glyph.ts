// Type-symbol reverse paper: the glyphs and the sheet.
//
// Bulbapedia describes the reverse pattern of the BW/XY era as "the card's type
// symbol behind the Pokémon" (a Poké Ball for Trainers). This module draws a
// STYLISED glyph for each type and repeats it over a tileable sheet. It is not the
// official icon artwork: no icon font, vector asset or photograph is bundled here,
// so every glyph is a geometric approximation, and the generated index says so.
//
// The distinction that matters for the renderer: the TYPE comes from the card row
// (or from /api/cards/meta), not from a guess. A card whose type is unknown gets
// no symbol field and therefore plain foil, because drawing the wrong type would
// be worse than drawing none.
//
// Glyph coordinates run -1..1 with y downward; `glyphInk` returns 1 inside the
// mark. The sheet places glyphs on a jittered grid with wrap-around stamping, so
// cracks — well, symbols — continue across the tile edge.

export const TYPE_SYMBOL_SHEET_SIZE = 512
export const TYPE_SYMBOL_SEED = 0x7e51a1

export type GlyphId =
  | 'grass' | 'fire' | 'water' | 'lightning' | 'psychic' | 'fighting'
  | 'darkness' | 'metal' | 'dragon' | 'fairy' | 'colorless' | 'trainer'

export const GLYPH_IDS: GlyphId[] = [
  'grass', 'fire', 'water', 'lightning', 'psychic', 'fighting',
  'darkness', 'metal', 'dragon', 'fairy', 'colorless', 'trainer',
]

export const GLYPH_LABEL: Record<GlyphId, string> = {
  grass: 'Grass', fire: 'Fire', water: 'Water', lightning: 'Lightning',
  psychic: 'Psychic', fighting: 'Fighting', darkness: 'Darkness', metal: 'Metal',
  dragon: 'Dragon', fairy: 'Fairy', colorless: 'Colorless', trainer: 'Trainer (Poké Ball)',
}

export function typeSymbolRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const inCircle = (x: number, y: number, cx: number, cy: number, r: number) =>
  (x - cx) ** 2 + (y - cy) ** 2 <= r * r

function inPolygon(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Distance from a point to a segment, used for the dragon talons. */
function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t))
}

/** Ink of one stylised type glyph at (x, y), both in -1..1. */
export function glyphInk(kind: GlyphId, x: number, y: number): number {
  switch (kind) {
    case 'grass': {
      // A leaf on a diagonal, with a midrib cut out.
      const u = (x + y) * 0.7071
      const v = (y - x) * 0.7071
      const leaf = (u / 0.9) ** 2 + (v / 0.42) ** 2 <= 1
      const rib = Math.abs(v) < 0.07 && Math.abs(u) < 0.85
      return leaf && !rib ? 1 : 0
    }
    case 'fire': {
      // Two lobes plus a tapered tip.
      const body = inCircle(x, y, 0, 0.22, 0.52) || inCircle(x, y, 0.16, -0.1, 0.34)
      const tip = y < -0.05 && y > -1 && Math.abs(x) < ((-y - 0.05) / 0.95) * 0.46
      return body || tip ? 1 : 0
    }
    case 'water': {
      const drop = inCircle(x, y, 0, 0.2, 0.55)
      const tip = y < 0.2 && y > -0.95 && Math.abs(x) < ((0.2 - y) / 1.15) * 0.55
      return drop || tip ? 1 : 0
    }
    case 'lightning':
      return inPolygon(x, y, [
        [0.14, -0.95], [-0.42, 0.08], [-0.04, 0.08], [-0.16, 0.95], [0.46, -0.12], [0.08, -0.12],
      ]) ? 1 : 0
    case 'psychic': {
      // An eye: ellipse outline plus a pupil.
      const q = Math.sqrt((x / 0.92) ** 2 + (y / 0.5) ** 2)
      const rim = Math.abs(q - 0.82) < 0.14
      const pupil = inCircle(x, y, 0, 0, 0.2)
      return rim || pupil ? 1 : 0
    }
    case 'fighting': {
      // A fist: palm plus four knuckles and a thumb.
      const palm = Math.abs(x) < 0.52 && y > -0.3 && y < 0.62
      let knuckle = false
      for (const kx of [-0.36, -0.12, 0.12, 0.36]) knuckle = knuckle || inCircle(x, y, kx, -0.36, 0.17)
      const thumb = inCircle(x, y, -0.58, 0.18, 0.22)
      return palm || knuckle || thumb ? 1 : 0
    }
    case 'darkness':
      // Crescent: a disc with a second disc subtracted.
      return inCircle(x, y, 0, 0, 0.62) && !inCircle(x, y, 0.32, -0.1, 0.52) ? 1 : 0
    case 'metal': {
      // Hexagonal nut outline with a centre hole.
      const h = Math.max(Math.abs(x) * 0.866 + Math.abs(y) * 0.5, Math.abs(y))
      const ring = h > 0.46 && h <= 0.76
      const hub = inCircle(x, y, 0, 0, 0.17)
      return ring || hub ? 1 : 0
    }
    case 'dragon': {
      // Three talons fanning from a wrist.
      let ink = 0
      for (const ex of [-0.6, 0, 0.6]) {
        if (segmentDistance(x, y, 0, 0.62, ex, -0.62) < 0.13) ink = 1
      }
      return ink
    }
    case 'fairy': {
      // Four-point sparkle: bright arms, soft core.
      const ax = Math.abs(x)
      const ay = Math.abs(y)
      const core = (x * x + y * y) < 0.16
      const armX = ay < 0.1 && ax < 0.85
      const armY = ax < 0.1 && ay < 0.85
      return core || armX || armY ? 1 : 0
    }
    case 'colorless': {
      // Five-point star.
      const r = Math.hypot(x, y)
      const a = Math.atan2(y, x) - Math.PI / 2
      const k = Math.PI / 5
      const edge = 0.78 * Math.cos(k) / Math.cos(((a % (2 * k)) + 2 * k) % (2 * k) - k)
      return r <= edge ? 1 : 0
    }
    case 'trainer': {
      // Poké Ball: outline, equator band, centre button.
      const r = Math.hypot(x, y)
      const ring = Math.abs(r - 0.7) < 0.11
      const band = Math.abs(y) < 0.1 && Math.abs(x) < 0.69
      const button = Math.abs(r - 0.26) < 0.09
      return ring || band || button ? 1 : 0
    }
  }
}

export type TypeSymbolSheet = {
  glyph: GlyphId
  size: number
  seed: number
  rgba: Uint8ClampedArray
  coverage: number
  peak: number
  seamRatio: number
  glyphs: number
}

/**
 * Draw one glyph's paper. Glyphs sit on a jittered 8x8 grid and are stamped with
 * wrap-around indices, so the tile edge continues the same field.
 */
export function renderTypeSymbolSheet(
  glyph: GlyphId,
  size = TYPE_SYMBOL_SHEET_SIZE,
  seed = TYPE_SYMBOL_SEED,
): TypeSymbolSheet {
  const rand = typeSymbolRandom(seed + GLYPH_IDS.indexOf(glyph) * 7919)
  const cells = 8
  const step = size / cells
  const radius = size * 0.04
  const alpha = new Float32Array(size * size)

  const stamp = (cx: number, cy: number, level: number) => {
    const x0 = Math.floor(cx - radius) - 1
    const x1 = Math.ceil(cx + radius) + 1
    const y0 = Math.floor(cy - radius) - 1
    const y1 = Math.ceil(cy + radius) + 1
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const nx = (x + 0.5 - cx) / radius
        const ny = (y + 0.5 - cy) / radius
        if (nx < -1 || nx > 1 || ny < -1 || ny > 1) continue
        if (!glyphInk(glyph, nx, ny)) continue
        const xi = ((x % size) + size) % size
        const yi = ((y % size) + size) % size
        const i = yi * size + xi
        if (level > alpha[i]) alpha[i] = level
      }
    }
  }

  for (let gy = 0; gy < cells; gy++) {
    for (let gx = 0; gx < cells; gx++) {
      const cx = (gx + 0.5 + (rand() - 0.5) * 0.5) * step
      const cy = (gy + 0.5 + (rand() - 0.5) * 0.5) * step
      stamp(cx, cy, 0.7 + rand() * 0.3)
    }
  }

  const rgba = new Uint8ClampedArray(size * size * 4)
  let peak = 0
  let covered = 0
  for (let i = 0, n = size * size; i < n; i++) {
    const a = alpha[i]
    rgba[i * 4] = 255
    rgba[i * 4 + 1] = 255
    rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = Math.round(a * 255)
    if (a > peak) peak = a
    if (a > 0.1) covered++
  }

  let edge = 0
  let interior = 0
  for (let y = 0; y < size; y++) {
    const a = rgba[(y * size) * 4 + 3] / 255
    const b = rgba[(y * size + size - 1) * 4 + 3] / 255
    const c = rgba[(y * size + 1) * 4 + 3] / 255
    edge += Math.abs(a - b)
    interior += Math.abs(a - c)
  }

  return {
    glyph,
    size,
    seed,
    rgba,
    coverage: covered / (size * size),
    peak,
    seamRatio: interior > 1e-6 ? edge / interior : 1,
    glyphs: cells * cells,
  }
}

/** The Sun & Moon paper uses ONE large symbol on the left, not a repeating field. */
export const TYPE_SYMBOL_LARGE_SIZE = 512

export type LargeTypeSymbolSheet = {
  glyph: GlyphId
  size: number
  rgba: Uint8ClampedArray
  coverage: number
  peak: number
  /** Symbol centre as a fraction of the sheet, so the sampler can anchor it. */
  centerU: number
  centerV: number
}

/**
 * One large glyph at the left of a blank sheet. The card samples a window around
 * it; there is no tiling here, because the print puts a single symbol on the left
 * rather than a field of them.
 */
export function renderLargeTypeSymbolSheet(
  glyph: GlyphId,
  size = TYPE_SYMBOL_LARGE_SIZE,
  seed = TYPE_SYMBOL_SEED,
): LargeTypeSymbolSheet {
  const rand = typeSymbolRandom(seed + GLYPH_IDS.indexOf(glyph) * 104729)
  const cx = size * (0.28 + rand() * 0.06)
  const cy = size * (0.46 + rand() * 0.08)
  const radius = size * 0.17
  const alpha = new Float32Array(size * size)
  const x0 = Math.max(0, Math.floor(cx - radius) - 1)
  const x1 = Math.min(size - 1, Math.ceil(cx + radius) + 1)
  const y0 = Math.max(0, Math.floor(cy - radius) - 1)
  const y1 = Math.min(size - 1, Math.ceil(cy + radius) + 1)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!glyphInk(glyph, (x + 0.5 - cx) / radius, (y + 0.5 - cy) / radius)) continue
      alpha[y * size + x] = 0.95
    }
  }
  const rgba = new Uint8ClampedArray(size * size * 4)
  let covered = 0
  let peak = 0
  for (let i = 0, n = size * size; i < n; i++) {
    const a = alpha[i]
    rgba[i * 4] = 255
    rgba[i * 4 + 1] = 255
    rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = Math.round(a * 255)
    if (a > 0.1) covered++
    if (a > peak) peak = a
  }
  return { glyph, size, rgba, coverage: covered / (size * size), peak, centerU: cx / size, centerV: cy / size }
}
