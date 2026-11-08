// Confetti, drawn: small blocky reflective shapes scattered across the card.
//
// The source names the look and the products, and nothing else:
//
//   Bulbapedia, Holofoil — "Pixel or Confetti Holofoil is used primarily for cards
//   in the McDonald's Collection sets, but was also featured on the Celebrations
//   Classic Collection. The pattern consists of small, blocky reflective shapes
//   scattered across the image, resembling pieces of confetti."
//
//   Bulbapedia, Celebrations — the 25-card Classic Collection subset cards
//   "feature etching and a Confetti Holofoil pattern".
//
// So this module DRAWS that: rectangular blocks of differing size and brightness,
// scattered over a dark field, with a soft edge so a block reads as a reflective
// flake rather than a clipped square. No scan or angled photograph of the paper
// exists in this repository, `textureVerified` is false, and the generated index
// says so.
//
// Four properties are measured rather than asserted, and the suite pins them:
//   - the FIELD STAYS DARK. This is a marked paper like Crosshatch, not a mirror:
//     a bright field would stop the blocks reading as marks at all.
//   - the BLOCKS ARE BLOCKY. Every mark is an axis-aligned rectangle; nothing here
//     draws a circle, star or stripe.
//   - it WRAPS. Blocks are stamped with wrap-around coordinates, so the sheet's
//     edges meet and a card may sample any window.
//   - it is DETERMINISTIC. Each cell derives its blocks from an integer hash of the
//     cell index: no random source, same bytes every run, and the pattern never
//     moves under tilt.

export const CONFETTI_SHEET_SIZE = 1024

/** Cell pitch, in sheet pixels. Divides the sheet exactly (16 × 16 cells). */
export const CONFETTI_CELL = 64

/** Ink floor between blocks: a marked foil's bare field is dark on purpose. */
export const CONFETTI_FLOOR = 0.035

/** Soft edge, in pixels, so a block is a flake rather than a hard pixel square. */
export const CONFETTI_EDGE = 1.2

/** Ink at or above this is a mark, for the coverage measurement. */
export const CONFETTI_MARK_LINE = 0.5

/** 32-bit integer hash → 0..1. Deterministic, no state, no random source. */
function hash32(x: number, y: number, salt: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967295
}

export type ConfettiBlock = {
  /** Top-left in sheet space, before wrapping. */
  x: number
  y: number
  w: number
  h: number
  /** Peak ink of this block. */
  ink: number
}

/** The blocks one cell carries. Two, and occasionally three, so the field is even. */
export function confettiBlocksFor(cx: number, cy: number): ConfettiBlock[] {
  const count = hash32(cx, cy, 1) > 0.72 ? 3 : 2
  const blocks: ConfettiBlock[] = []
  for (let k = 0; k < count; k++) {
    const salt = k * 8
    blocks.push({
      x: cx * CONFETTI_CELL + hash32(cx, cy, salt + 2) * (CONFETTI_CELL - 1),
      y: cy * CONFETTI_CELL + hash32(cx, cy, salt + 3) * (CONFETTI_CELL - 1),
      // The source says small: 9–28px wide, 7–22px tall on a 1024 sheet, which on
      // a 734px-wide card is a flake a few pixels across.
      w: 9 + hash32(cx, cy, salt + 4) * 19,
      h: 7 + hash32(cx, cy, salt + 5) * 15,
      ink: 0.56 + hash32(cx, cy, salt + 6) * 0.4,
    })
  }
  return blocks
}

/** Ink at every sheet pixel, 0..1. Blocks are stamped with wrap-around. */
export function buildConfettiField(size = CONFETTI_SHEET_SIZE): Float32Array {
  const ink = new Float32Array(size * size).fill(CONFETTI_FLOOR)
  const cells = Math.round(size / CONFETTI_CELL)
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      for (const b of confettiBlocksFor(cx, cy)) {
        const w = Math.max(1, Math.round(b.w))
        const h = Math.max(1, Math.round(b.h))
        const x0 = Math.round(b.x)
        const y0 = Math.round(b.y)
        for (let dy = 0; dy < h; dy++) {
          const yy = (((y0 + dy) % size) + size) % size
          for (let dx = 0; dx < w; dx++) {
            const xx = (((x0 + dx) % size) + size) % size
            // Distance to the block's own edge, in pixels, gives the flake a soft rim.
            const edge = Math.min(dx + 0.5, w - dx - 0.5, dy + 0.5, h - dy - 0.5)
            const cover = Math.min(1, Math.max(0, edge / CONFETTI_EDGE))
            const v = CONFETTI_FLOOR + (b.ink - CONFETTI_FLOOR) * cover
            const i = yy * size + xx
            if (v > ink[i]) ink[i] = v
          }
        }
      }
    }
  }
  return ink
}

export type ConfettiSheet = {
  size: number
  rgba: Uint8ClampedArray
  /** Fraction of pixels above the mark line: how much of the sheet is a mark. */
  coverage: number
  peak: number
  floor: number
  mean: number
}

export function renderConfettiSheet(size = CONFETTI_SHEET_SIZE): ConfettiSheet {
  const ink = buildConfettiField(size)
  const rgba = new Uint8ClampedArray(size * size * 4)
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
    if (v >= CONFETTI_MARK_LINE) marked++
    sum += v
  }
  return { size, rgba, coverage: marked / (size * size), peak, floor, mean: sum / (size * size) }
}

/**
 * Discontinuity across the two edges that meet when the sheet wraps: the mean alpha
 * step over adjacent pixels either side of the seam. Small means the sheet wraps.
 */
export function confettiSeamMismatch(rgba: Uint8ClampedArray | Uint8Array, size: number): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < size; y++) {
    sum += Math.abs(rgba[(y * size + (size - 1)) * 4 + 3] - rgba[(y * size) * 4 + 3]) / 255
    sum += Math.abs(rgba[((size - 1) * size + y) * 4 + 3] - rgba[y * 4 + 3]) / 255
    n += 2
  }
  return n ? sum / n : 0
}
