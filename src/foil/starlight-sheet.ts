// Starlight: a procedural stand-in for the 1999 Base–Fossil holo sheet.
//
// Bulbapedia describes Starlight in one sentence, and this module tries to
// reproduce exactly that sentence and nothing more: "It consists of starbursts
// of different sizes spread across the image, with a slightly blurry
// appearance." Base, Jungle and Fossil are the only sets that used it; Fossil is
// the last, and Base Set 2 moved to Cosmos.
//
// THE TEXTURE IS A RECONSTRUCTION. No factory scan or angled photograph of a
// Starlight sheet exists in this repository, so this is a drawing, not a
// reproduction, and every consumer carries `verified: false` for the texture
// while the printing identification stays verified. The distinction matters:
// "this card is Starlight" is documented; "this is what Starlight looks like,
// pixel for pixel" is not.
//
// Two properties follow from the source sentence and shape the generator:
//
//   - starbursts: four-point stars, not round orbs and not noise. `starInk`
//     draws arms along both axes with a soft core, so a star is brightest at its
//     centre, tapers to nothing at the tips, and reads as a cross rather than a
//     disc. Nothing here is a random sparkle.
//   - different sizes, spread: placement is stratified — the sheet is divided
//     into cells and each cell gets at most one star — so the field is even at
//     every scale instead of clumping the way pure random sampling does.
//
// The sheet is one generated cut, not a tile: stars are placed independently
// right up to the edges, so wrapping it would slice stars in half. Cards sample
// a window, exactly as with Cosmos.
//
// Determinism is required: the pattern must not swim between frames, so the
// generator takes an explicit seed and uses a local PRNG. The global RNG is
// never called, here or in the sampler.

export const STARLIGHT_SHEET_SIZE = 1024
export const STARLIGHT_SEED = 0x5ba712

export type StarKind = 'large' | 'medium' | 'small' | 'dust'

export type StarSpec = {
  /** Centre, in sheet pixels. */
  x: number
  y: number
  /** Outer radius, in sheet pixels. */
  r: number
  kind: StarKind
  /** Rotation in radians, so the four arms are not all axis-aligned. */
  rot: number
  /** 0.55..1: a few stars are dimmer, which keeps the field from looking printed. */
  intensity: number
}

export type StarlightSheet = {
  size: number
  seed: number
  rgba: Uint8ClampedArray
  stars: StarSpec[]
  counts: Record<StarKind, number>
  /** Fraction of pixels with alpha > 0.1. */
  coverage: number
  /** Peak alpha, 0..1. */
  peak: number
}

/** Deterministic PRNG (mulberry32). Small, fast, and good enough for placement. */
export function starlightRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Ink of one four-point starburst at (dx, dy) from its centre, both in units of
 * the star's radius. Zero outside the radius.
 *
 * The profile is built from three pieces so a star reads as a cross: a soft
 * Gaussian core, and two arms whose perpendicular width narrows toward the tip.
 * At equal distance, an axis point is brighter than a diagonal one — that is the
 * definition of a four-point star, and the suite asserts it.
 */
export function starInk(dx: number, dy: number, rot = 0): number {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const x = (dx * c + dy * s)
  const y = (-dx * s + dy * c)
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  if (ax > 1 || ay > 1) return 0
  const core = Math.exp(-7 * (x * x + y * y))
  // Width of an arm at fraction t along it: widest at the centre, a point at the tip.
  const arm = (t: number, p: number) => {
    const w = 0.02 + 0.12 * (1 - t)
    return (1 - t) * Math.exp(-(p * p) / (w * w))
  }
  const ink = Math.max(core, arm(ax, y), arm(ay, x))
  return ink > 1 ? 1 : ink > 0 ? ink : 0
}

function shuffle(n: number, rand: () => number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = idx[i]
    idx[i] = idx[j]
    idx[j] = t
  }
  return idx
}

/** Stratified placement: one star per occupied cell, jittered inside it. */
function placeStars(
  rand: () => number,
  size: number,
  kind: StarKind,
  cells: number,
  count: number,
  rMin: number,
  rMax: number,
): StarSpec[] {
  const cell = size / cells
  const slots = shuffle(cells * cells, rand).slice(0, Math.min(count, cells * cells))
  return slots.map((slot) => {
    const cx = slot % cells
    const cy = Math.floor(slot / cells)
    return {
      x: (cx + rand()) * cell,
      y: (cy + rand()) * cell,
      r: rMin + rand() * (rMax - rMin),
      kind,
      // Quarter turns plus a little wander: the vintage sheet is not a tidy grid.
      rot: (Math.floor(rand() * 4) * Math.PI) / 2 + (rand() - 0.5) * 0.5,
      intensity: 0.55 + rand() * 0.45,
    }
  })
}

/** Separable box blur, applied twice — the "slightly blurry" edge in the source. */
function blurAlpha(alpha: Float32Array, size: number, radius: number): void {
  const tmp = new Float32Array(alpha.length)
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const n = radius * 2 + 1
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0
        for (let k = -radius; k <= radius; k++) {
          const xx = horizontal ? x + k : x
          const yy = horizontal ? y : y + k
          // Clamp at the edge: a star near the border should fade, not wrap.
          const cx = xx < 0 ? 0 : xx >= size ? size - 1 : xx
          const cy = yy < 0 ? 0 : yy >= size ? size - 1 : yy
          sum += src[cy * size + cx]
        }
        dst[y * size + x] = sum / n
      }
    }
  }
  pass(alpha, tmp, true)
  pass(tmp, alpha, false)
}

/**
 * Draw the sheet. Pure and browser-free, so the generator, the report and the
 * suite all run the same code.
 */
export function renderStarlightSheet(size = STARLIGHT_SHEET_SIZE, seed = STARLIGHT_SEED): StarlightSheet {
  const rand = starlightRandom(seed)
  const stars: StarSpec[] = [
    ...placeStars(rand, size, 'large', 4, 10, size * 0.030, size * 0.046),
    ...placeStars(rand, size, 'medium', 9, 46, size * 0.012, size * 0.019),
    ...placeStars(rand, size, 'small', 21, 210, size * 0.0045, size * 0.0075),
    ...placeStars(rand, size, 'dust', 54, 720, size * 0.0011, size * 0.0021),
  ]

  const alpha = new Float32Array(size * size)
  for (const star of stars) {
    const x0 = Math.max(0, Math.floor(star.x - star.r) - 1)
    const x1 = Math.min(size - 1, Math.ceil(star.x + star.r) + 1)
    const y0 = Math.max(0, Math.floor(star.y - star.r) - 1)
    const y1 = Math.min(size - 1, Math.ceil(star.y + star.r) + 1)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ink = starInk((x + 0.5 - star.x) / star.r, (y + 0.5 - star.y) / star.r, star.rot) * star.intensity
        if (ink <= 0) continue
        const i = y * size + x
        // Overlapping stars stack with max, not addition: two marks over each
        // other are still one foil surface, not twice the light.
        if (ink > alpha[i]) alpha[i] = ink
      }
    }
  }

  // Neutral white ink with the drawing in alpha. The renderer reads luminance x
  // alpha, so the pattern layer can never introduce a colour.
  blurAlpha(alpha, size, 1)
  const rgba = new Uint8ClampedArray(size * size * 4)
  let peak = 0
  let covered = 0
  for (let i = 0, n = size * size; i < n; i++) {
    const a = alpha[i] > 1 ? 1 : alpha[i]
    const o = i * 4
    rgba[o] = 255
    rgba[o + 1] = 255
    rgba[o + 2] = 255
    rgba[o + 3] = Math.round(a * 255)
    if (a > peak) peak = a
    if (a > 0.1) covered++
  }

  const counts: Record<StarKind, number> = { large: 0, medium: 0, small: 0, dust: 0 }
  for (const s of stars) counts[s.kind]++

  return { size, seed, rgba, stars, counts, coverage: covered / (size * size), peak }
}

/**
 * How discontinuous the sheet's wrap would be. A tile's edges agree by
 * construction; this sheet's do not, which is why cards sample one window and
 * nothing wraps. Returns the fraction of rows whose first and last pixels differ
 * enough to show a seam.
 */
export function starlightSeamMismatch(rgba: Uint8ClampedArray, size: number): number {
  let rows = 0
  for (let y = 0; y < size; y++) {
    const a = rgba[(y * size) * 4 + 3] / 255
    const b = rgba[(y * size + size - 1) * 4 + 3] / 255
    if (Math.abs(a - b) > 0.2) rows++
  }
  return rows / size
}
