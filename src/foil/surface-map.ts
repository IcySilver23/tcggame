// Height fields for the etched surfaces, kept free of any index import so the
// generator can build the normal maps before the sheets exist.
//
// Two reliefs, because the sources describe two weights: Black & White and XY full
// arts are called "heavy with deeply etched texture", while Sun & Moon and Sword &
// Shield use a "much lighter", "finer, wavier" texture. Both are MODELS — no
// photograph of a textured card ships with this project.

export const ETCHED_SIZE = 512

const TAU = Math.PI * 2

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

/** Modern relief: a fine diagonal lattice with a light grain. */
export function etchedHeight(u: number, v: number): number {
  const lattice = (Math.cos(TAU * 18 * (u + v)) + Math.cos(TAU * 18 * (u - v))) * 0.5
  const grain = (Math.cos(TAU * 54 * (u + v)) + Math.cos(TAU * 54 * (u - v))) * 0.5
  return clamp01(0.5 + 0.20 * lattice + 0.08 * grain)
}

/**
 * BW/XY relief: the same construction, coarser and deeper. Fewer lattice lines
 * across the sheet and a stronger slope, matching the "deeply etched" description
 * rather than the later, finer papers.
 */
export function etchedDeepHeight(u: number, v: number): number {
  const lattice = (Math.cos(TAU * 10 * (u + v)) + Math.cos(TAU * 10 * (u - v))) * 0.5
  const grain = (Math.cos(TAU * 30 * (u + v)) + Math.cos(TAU * 30 * (u - v))) * 0.5
  return clamp01(0.5 + 0.30 * lattice + 0.11 * grain)
}

/** Integer hash in [0, 1). `Math.imul` keeps the multiply exact in 32 bits. */
function hash2(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/**
 * Smooth value noise on a periodic lattice, so the sheet tiles.
 *
 * Sampling wraps at `period` cells, which makes u = 0 and u = 1 the same noise
 * field: a card may sample any window, as the other surfaces allow.
 */
function periodicNoise(u: number, v: number, period: number): number {
  const x = u * period
  const y = v * period
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const wrap = (n: number) => ((n % period) + period) % period
  const n00 = hash2(wrap(ix), wrap(iy))
  const n10 = hash2(wrap(ix + 1), wrap(iy))
  const n01 = hash2(wrap(ix), wrap(iy + 1))
  const n11 = hash2(wrap(ix + 1), wrap(iy + 1))
  const a = n00 + (n10 - n00) * sx
  const b = n01 + (n11 - n01) * sx
  return a + (b - a) * sy
}

/**
 * Shiny Vault relief: a fine granular sparkle, not a lattice.
 *
 * The photographs of the English SV107 and its Shiny Star V print show a dense
 * granular shimmer, and the measurement in `reports/shiny-etch-photos.md` finds no
 * periodic repeat on them — not even at a 2700 px card width. So this surface is
 * drawn as three octaves of isotropic grain rather than lines. It is MODELLED: the
 * photographs settle that the finish is granular, not the grain's scale.
 */
export function sparkleHeight(u: number, v: number): number {
  const broad = periodicNoise(u, v, 48)
  const mid = periodicNoise(u, v, 96)
  const fine = periodicNoise(u, v, 192)
  return clamp01(0.5 + 0.30 * (broad - 0.5) + 0.22 * (mid - 0.5) + 0.12 * (fine - 0.5))
}
