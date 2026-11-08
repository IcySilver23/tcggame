// Crosshatch, drawn: two families of thin diagonal lines crossing into a grid.
//
// Bulbapedia's Holofoil page is the only description of this paper in reach:
//
//   "Crosshatch Holofoil is generally used only for cards awarded at Play!
//    Pokémon events. The pattern consists of intersecting diagonal lines that
//    form a reflective grid across the card. The crosshatch effect is often
//    applied to the background of the card, as in a Reverse Holo card."
//
// So the marks are named and their orientation is named: two line families at
// right angles to each other, each at 45° to the card edge, crossing into diamonds.
// What the sentence does NOT give is a pitch, a line width, an intensity per line,
// or whether the lines are continuous — and no scan, photograph or asset pack of a
// Crosshatch card exists in this repository. Those four things are this build's
// drawings, and `textureVerified` is false.
//
// The vocabulary stays narrow: every pixel is neutral. Ink is luminance x alpha, so
// the sheet cannot tint a card — hue belongs to iridescence alone.
//
// Unlike Mirror, this IS a marked paper: the field between the lines is nearly dark,
// which is what makes a line read as a line. The floor is therefore low on purpose.

export type CrosshatchGap = { start: number; width: number }
export type CrosshatchLine = {
  index: number
  ink: number
  gaps: CrosshatchGap[]
}

/**
 * Square pitch of the lattice. 64px on a 1024 sheet puts about eleven lines each
 * way across a card, which is what makes the paper read as a reflective grid
 * rather than a screen door. Ours: the source names the families, not a count.
 */
export const CROSSHATCH_PITCH = 64
export const CROSSHATCH_SHEET_SIZE = 1024
export const CROSSHATCH_SEED = 0x2c0a5e
export const CROSSHATCH_PER_FAMILY = CROSSHATCH_SHEET_SIZE / CROSSHATCH_PITCH

/**
 * Ink across one line as a function of the band coordinate: 0 at the line's centre,
 * 1 at the midpoint between two lines. A thin flat core with a smooth shoulder —
 * a hard step would alias into a moiré at card scale rather than reading as foil.
 */
export function crosshatchProfile(band: number): number {
  // A thin bright line with a wide shoulder: the diamonds between the lines are
  // most of the card, so the foil reads as a grid over quiet foil, not a wash.
  const core = 0.1
  const edge = 0.3
  if (band >= edge) return 0
  if (band <= core) return 1
  const t = (band - core) / (edge - core)
  return 1 - t * t * (3 - 2 * t)
}

const mod = (v: number, m: number) => ((v % m) + m) % m

/** Band coordinate of a coordinate inside the lattice cell. */
export function crosshatchBand(value: number, pitch = CROSSHATCH_PITCH): number {
  const r = mod(value, pitch)
  return Math.min(r, pitch - r) / (pitch / 2)
}

export type CrosshatchSheet = {
  size: number
  pitch: number
  perFamily: number
  rgba: Uint8ClampedArray
  coverage: number
  peak: number
  familyA: CrosshatchLine[]
  familyB: CrosshatchLine[]
}

/** Small deterministic PRNG; the sheet must be byte-identical for a seed. */
export function crosshatchRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function buildFamily(rand: () => number, count: number, size: number): CrosshatchLine[] {
  const lines: CrosshatchLine[] = []
  for (let i = 0; i < count; i++) {
    const gaps: CrosshatchGap[] = []
    const gapCount = Math.floor(rand() * 3)
    for (let g = 0; g < gapCount; g++) {
      gaps.push({ start: rand() * size, width: size * (0.01 + rand() * 0.05) })
    }
    lines.push({ index: i, ink: 0.62 + rand() * 0.38, gaps })
  }
  return lines
}

/**
 * Ink of one line at a position along it. Gaps wrap in the sheet width, so a break
 * that runs off one edge continues at the other and the lattice still tiles.
 */
export function crosshatchInkAt(line: CrosshatchLine, along: number, size: number): number {
  let ink = line.ink
  for (const gap of line.gaps) {
    const d = Math.abs(mod(along - gap.start + size / 2, size) - size / 2)
    const half = gap.width / 2
    if (d < half) {
      const t = 1 - d / half
      ink *= 1 - 0.9 * t * t * (3 - 2 * t)
    }
  }
  return ink
}

export function renderCrosshatchSheet(
  size = CROSSHATCH_SHEET_SIZE,
  seed = CROSSHATCH_SEED,
): CrosshatchSheet {
  const rand = crosshatchRandom(seed)
  const pitch = Math.max(4, Math.round(size / (CROSSHATCH_SHEET_SIZE / CROSSHATCH_PITCH)))
  const perFamily = Math.round(size / pitch)
  const familyA = buildFamily(rand, perFamily, size)
  const familyB = buildFamily(rand, perFamily, size)

  const rgba = new Uint8ClampedArray(size * size * 4)
  let peak = 0
  let inked = 0

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Family A runs one diagonal (constant x + y), family B the other (x − y).
      const sum = x + y
      const diff = x - y
      const lineA = familyA[mod(Math.floor(sum / pitch), perFamily)]
      const lineB = familyB[mod(Math.floor(diff / pitch), perFamily)]
      const inkA = crosshatchInkAt(lineA, x, size) * crosshatchProfile(crosshatchBand(sum, pitch))
      const inkB = crosshatchInkAt(lineB, x, size) * crosshatchProfile(crosshatchBand(diff, pitch))
      // Max, not sum: two lines crossing must not blow past full ink into a blob.
      // A faint ambient between the lines keeps the field alive without reading as
      // a second pattern.
      const ambient = 0.015 + 0.02 * (0.5 + 0.5 * Math.sin((2 * Math.PI * (5 * x + 3 * y)) / size))
      const ink = Math.min(1, ambient + Math.max(inkA, inkB))
      const p = (y * size + x) * 4
      rgba[p] = 255
      rgba[p + 1] = 255
      rgba[p + 2] = 255
      rgba[p + 3] = Math.round(ink * 255)
      if (ink > peak) peak = ink
      if (ink > 0.1) inked++
    }
  }

  return { size, pitch, perFamily, rgba, coverage: inked / (size * size), peak, familyA, familyB }
}

/**
 * Discontinuity across the two edges that meet when the sheet wraps: the mean alpha
 * step over adjacent pixels either side of the seam.
 */
export function crosshatchSeamMismatch(rgba: Uint8ClampedArray | Uint8Array, size: number): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < size; y++) {
    sum += Math.abs(rgba[(y * size + (size - 1)) * 4 + 3] - rgba[(y * size) * 4 + 3]) / 255
    sum += Math.abs(rgba[((size - 1) * size + y) * 4 + 3] - rgba[y * 4 + 3]) / 255
    n += 2
  }
  return n ? sum / n : 0
}
