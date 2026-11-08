// Sequin, drawn: many small reflective geometric shapes scattered across the image.
//
// The source names the look, the products and the date, and nothing else:
//
//   Bulbapedia, Holofoil — "The Sequin holofoil was first introduced in August, 2017,
//   and is exclusively used for General Mills promotional cards, including the General
//   Mills Sun & Moon Mini Packs, General Mills Let's Go, Kanto! Mini Packs and the
//   latest General Mills 25th Anniversary Mini Packs. The pattern consists of many
//   small reflective geometric shapes scattered across the image, giving it a
//   sequined appearance."
//
// So this module DRAWS that: regular polygons of three to six sides, small and dense,
// each with its own rotation and brightness, over a dark field. No scan, photograph or
// asset pack of the paper is in this repository, `textureVerified` is false, and the
// generated index says so.
//
// Four properties are measured rather than asserted, and the suite pins them:
//   - the FIELD STAYS DARK. This is a marked paper like Crosshatch and Confetti, not a
//     mirror: a bright field would stop the shapes reading as shapes at all.
//   - the MARKS ARE POLYGONS. A shape's boundary is a regular polygon, so at 0.8 of the
//     circumradius a corner is still a mark while the middle of an edge is not. A disc
//     would cover both, which is why the suite measures the asymmetry.
//   - it WRAPS. Shapes are stamped with wrap-around coordinates, so the sheet's edges
//     meet and a card may sample any window.
//   - it is DETERMINISTIC. Every mark derives from an integer hash of its cell index:
//     no random source, same bytes every run, and the pattern never moves under tilt.
//
// What is NOT claimed: the sides, radius, density and brightness are this build's
// reading of "many small reflective geometric shapes". The source names no count, no
// size and no repeat.

export const SEQUIN_SHEET_SIZE = 1024

/** Cell pitch, in sheet pixels. Divides the sheet exactly (32 × 32 cells). */
export const SEQUIN_CELL = 32

/** Ink floor between shapes: a marked foil's bare field is dark on purpose. */
export const SEQUIN_FLOOR = 0.045

/** Soft rim, in pixels, so a shape is a reflective chip rather than a hard cut-out. */
export const SEQUIN_EDGE = 0.9

/** Ink at or above this is a mark, for the coverage measurement. */
export const SEQUIN_MARK_LINE = 0.5

/** The shape families the source's "geometric" admits here: triangle to hexagon. */
export const SEQUIN_MIN_SIDES = 3
export const SEQUIN_MAX_SIDES = 6

/** Circumradius range, in sheet pixels. "Small" against a 1024px sheet. */
export const SEQUIN_MIN_RADIUS = 4.2
export const SEQUIN_MAX_RADIUS = 9.6

/** 32-bit integer hash → 0..1. Deterministic, no state, no random source. */
function hash32(x: number, y: number, salt: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967295
}

const wrap = (v: number, size: number): number => ((v % size) + size) % size

export type SequinMark = {
  /** Centre in sheet space, before wrapping. */
  x: number
  y: number
  /** Circumradius, in pixels. */
  radius: number
  /** 3–6, so each mark is a triangle, square, pentagon or hexagon. */
  sides: number
  /** Radians; a vertex sits at this angle. */
  rotation: number
  /** Peak ink of this mark. */
  ink: number
}

/** The marks one cell carries: two, and often three, which is what makes it dense. */
export function sequinMarksFor(cx: number, cy: number): SequinMark[] {
  const count = hash32(cx, cy, 1) > 0.62 ? 3 : 2
  const marks: SequinMark[] = []
  for (let k = 0; k < count; k++) {
    const salt = k * 8
    marks.push({
      x: cx * SEQUIN_CELL + hash32(cx, cy, salt + 2) * (SEQUIN_CELL - 1),
      y: cy * SEQUIN_CELL + hash32(cx, cy, salt + 3) * (SEQUIN_CELL - 1),
      radius:
        SEQUIN_MIN_RADIUS +
        hash32(cx, cy, salt + 4) * (SEQUIN_MAX_RADIUS - SEQUIN_MIN_RADIUS),
      sides: SEQUIN_MIN_SIDES + Math.floor(hash32(cx, cy, salt + 5) * (SEQUIN_MAX_SIDES - SEQUIN_MIN_SIDES + 1)),
      rotation: hash32(cx, cy, salt + 6) * Math.PI,
      ink: 0.52 + hash32(cx, cy, salt + 7) * 0.44,
    })
  }
  return marks
}

/**
 * How much of a pixel the polygon covers, 0..1.
 *
 * A regular polygon's boundary at angle `angle` is `apothem / cos(phi - step / 2)`,
 * where `phi` is the angle past the nearest vertex: at a vertex the radius is the
 * circumradius, at the middle of an edge it is the apothem. A disc would have one
 * radius for every angle, so this is what makes the marks geometric rather than round.
 */
export function polygonCoverage(
  dist: number,
  angle: number,
  radius: number,
  sides: number,
  rotation: number,
): number {
  const step = (Math.PI * 2) / sides
  const apothem = radius * Math.cos(Math.PI / sides)
  let phi = (angle - rotation) % step
  if (phi < 0) phi += step
  const boundary = apothem / Math.cos(phi - step / 2)
  return Math.min(1, Math.max(0, 0.5 + (boundary - dist) / SEQUIN_EDGE))
}

/** Ink at every sheet pixel, 0..1. Marks are stamped with wrap-around. */
export function buildSequinField(size = SEQUIN_SHEET_SIZE): Float32Array {
  const ink = new Float32Array(size * size).fill(SEQUIN_FLOOR)
  const cells = Math.round(size / SEQUIN_CELL)
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      for (const m of sequinMarksFor(cx, cy)) {
        const x0 = Math.floor(m.x - m.radius) - 1
        const y0 = Math.floor(m.y - m.radius) - 1
        const x1 = Math.ceil(m.x + m.radius) + 1
        const y1 = Math.ceil(m.y + m.radius) + 1
        for (let py0 = y0; py0 <= y1; py0++) {
          const py = py0 + 0.5
          const yy = wrap(py0, size)
          for (let px0 = x0; px0 <= x1; px0++) {
            const px = px0 + 0.5
            const d = Math.hypot(px - m.x, py - m.y)
            if (d > m.radius + SEQUIN_EDGE) continue
            const a = Math.atan2(py - m.y, px - m.x)
            const cover = polygonCoverage(d, a, m.radius, m.sides, m.rotation)
            if (cover <= 0) continue
            const v = SEQUIN_FLOOR + (m.ink - SEQUIN_FLOOR) * cover
            const i = yy * size + wrap(px0, size)
            if (v > ink[i]) ink[i] = v
          }
        }
      }
    }
  }
  return ink
}

export type SequinSheet = {
  size: number
  rgba: Uint8ClampedArray
  /** Fraction of pixels above the mark line: how much of the sheet is a mark. */
  coverage: number
  peak: number
  floor: number
  mean: number
  /** Marks on the whole sheet, so "many small shapes" is a number. */
  marks: number
}

export function renderSequinSheet(size = SEQUIN_SHEET_SIZE): SequinSheet {
  const ink = buildSequinField(size)
  const rgba = new Uint8ClampedArray(size * size * 4)
  const cells = Math.round(size / SEQUIN_CELL)
  let peak = 0
  let floor = 1
  let sum = 0
  let marked = 0
  for (let i = 0; i < ink.length; i++) {
    const v = ink[i]
    const p = i * 4
    // Neutral: luminance only, so the sheet can never tint a card.
    rgba[p] = 255
    rgba[p + 1] = 255
    rgba[p + 2] = 255
    rgba[p + 3] = Math.round(v * 255)
    if (v > peak) peak = v
    if (v < floor) floor = v
    if (v >= SEQUIN_MARK_LINE) marked++
    sum += v
  }
  return {
    size,
    rgba,
    coverage: marked / (size * size),
    peak,
    floor,
    mean: sum / (size * size),
    marks: marksOnSheet(cells),
  }
}

/** Marks across a sheet of `cells` × `cells` cells, counted the same way as the render. */
function marksOnSheet(cells: number): number {
  let n = 0
  for (let cy = 0; cy < cells; cy++) for (let cx = 0; cx < cells; cx++) n += sequinMarksFor(cx, cy).length
  return n
}

/**
 * Discontinuity across the two edges that meet when the sheet wraps: the mean alpha
 * step over adjacent pixels either side of the seam.
 *
 * On a dense marked field this is NOT small on its own: two unrelated columns differ by
 * about as much as any two neighbouring columns inside the sheet, because the shapes are
 * smaller than a cell. Compare it with `sequinInternalStep` — the seam is continuous when
 * it is no larger than the sheet's own step, not when it is near zero.
 */
export function sequinSeamMismatch(rgba: Uint8ClampedArray | Uint8Array, size: number): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < size; y++) {
    sum += Math.abs(rgba[(y * size + (size - 1)) * 4 + 3] - rgba[(y * size) * 4 + 3]) / 255
    sum += Math.abs(rgba[((size - 1) * size + y) * 4 + 3] - rgba[y * 4 + 3]) / 255
    n += 2
  }
  return n ? sum / n : 0
}

/**
 * The sheet's own mean step between neighbouring pixels, sampled on a grid.
 *
 * This is what a seam must be compared against for a dense pattern: a wrap that is
 * continuous has the same difference across it as anywhere else in the field.
 */
export function sequinInternalStep(rgba: Uint8ClampedArray | Uint8Array, size: number, stride = 4): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < size; y += stride) {
    for (let x = 0; x + 1 < size; x++) {
      const i = (y * size + x) * 4 + 3
      sum += Math.abs(rgba[i + 4] - rgba[i]) / 255
      n++
    }
  }
  for (let x = 0; x < size; x += stride) {
    for (let y = 0; y + 1 < size; y++) {
      const i = (y * size + x) * 4 + 3
      sum += Math.abs(rgba[i + size * 4] - rgba[i]) / 255
      n++
    }
  }
  return n ? sum / n : 0
}
