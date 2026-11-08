// Cracked Ice: a procedural shattered-glass sheet.
//
// The source sentence (Bulbapedia, Holofoil): "The pattern consists of irregular
// reflective shapes resembling pieces of cracked or shattered glass." That is the
// whole brief, and it shapes the generator:
//
//   - SHARDS, not sparkles: the sheet is a Voronoi fracture. Each cell is a flat
//     facet with its own reflectivity, and the boundaries between cells are thin,
//     bright cracks. There is no noise texture anywhere; a facet is smooth.
//   - ANGULAR boundaries: Voronoi edges are straight segments meeting at corners,
//     which is exactly the "cracked" read. A blurred or rounded field would not be
//     this pattern.
//   - The sheet TILES. Cracks are computed with toroidal distances, so a card can
//     sample any window and the pattern continues across the wrap. Measured edge
//     versus interior variation is recorded by the generator's script.
//
// PROVENANCE: this is a RECONSTRUCTION. No factory sheet, no angled photograph and
// no tilt video of a Cracked Ice card exists in this repository, and the flat scans
// this project can load do not contain foil. `concept` is true and
// `textureVerified` is false wherever the sheet is described.
//
// Determinism: a seeded PRNG places the fracture seeds. The global RNG is never
// called, so the cracks cannot move between frames.

export const CRACKEDICE_SHEET_SIZE = 1024
export const CRACKEDICE_SEED = 0xc4ac1ce
/** Fracture seeds per side. 20x20 gives shards a few dozen pixels across. */
export const CRACKEDICE_CELLS = 20

export type IceSeed = {
  x: number
  y: number
  /** Flat facet brightness, 0..1 before the crack highlight. */
  level: number
  /** Stable id, so a facet can be pointed at in a test or the inspector. */
  id: number
}

export type CrackedIceSheet = {
  size: number
  seed: number
  rgba: Uint8ClampedArray
  seeds: IceSeed[]
  coverage: number
  peak: number
  /** Mean |difference| across the wrap over mean |difference| inside. */
  seamRatio: number
}

/** Deterministic PRNG (mulberry32). */
export function crackedIceRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Jittered grid of fracture seeds, with a brightness per facet. */
export function crackedIceSeeds(size: number, seed: number): IceSeed[] {
  const rand = crackedIceRandom(seed)
  const cells = CRACKEDICE_CELLS
  const step = size / cells
  const seeds: IceSeed[] = []
  for (let gy = 0; gy < cells; gy++) {
    for (let gx = 0; gx < cells; gx++) {
      // A little under a full cell of jitter keeps every cell owned by its seed
      // while making the shards irregular rather than a tiled grid.
      seeds.push({
        id: gy * cells + gx,
        x: (gx + 0.5 + (rand() - 0.5) * 0.78) * step,
        y: (gy + 0.5 + (rand() - 0.5) * 0.78) * step,
        level: 0.16 + rand() * 0.38,
      })
    }
  }
  return seeds
}

const wrapDelta = (d: number, size: number): number => {
  if (d > size / 2) return d - size
  if (d < -size / 2) return d + size
  return d
}

export type CrackedIceSample = {
  /** Final ink, 0..1: facet brightness plus the crack highlight. */
  ink: number
  /** Distance from the nearest fracture boundary, in pixels. */
  gap: number
  /** The facet this point belongs to. */
  facet: number
  /** The facet's base brightness before the crack. */
  level: number
}

/**
 * Ink at a sheet point. Exported so the tests can probe an exact boundary rather
 * than infer one from the rendered pixels.
 */
export function crackedIceInkAt(seeds: IceSeed[], size: number, x: number, y: number): CrackedIceSample {
  let d1 = Infinity
  let d2 = Infinity
  let nearest: IceSeed | null = null
  for (const s of seeds) {
    const dx = wrapDelta(x - s.x, size)
    const dy = wrapDelta(y - s.y, size)
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d < d1) {
      d2 = d1
      d1 = d
      nearest = s
    } else if (d < d2) {
      d2 = d
    }
  }
  if (!nearest) return { ink: 0, gap: Infinity, facet: -1, level: 0 }
  // The crack lives where the two nearest seeds are almost equidistant. Width is
  // ~5px so a crack survives the 200px card render (about one screen pixel).
  const gap = d2 - d1
  const crack = Math.exp(-((gap / 4.6) ** 2))
  const ink = Math.min(1, nearest.level * 0.92 + crack * 0.82)
  return { ink, gap, facet: nearest.id, level: nearest.level }
}

/**
 * Draw the sheet. Pure: the script and the suite run the same code.
 */
export function renderCrackedIceSheet(size = CRACKEDICE_SHEET_SIZE, seed = CRACKEDICE_SEED): CrackedIceSheet {
  const seeds = crackedIceSeeds(size, seed)
  const rgba = new Uint8ClampedArray(size * size * 4)
  let peak = 0
  let covered = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { ink } = crackedIceInkAt(seeds, size, x + 0.5, y + 0.5)
      const i = (y * size + x) * 4
      rgba[i] = 255
      rgba[i + 1] = 255
      rgba[i + 2] = 255
      rgba[i + 3] = Math.round(ink * 255)
      if (ink > peak) peak = ink
      if (ink > 0.1) covered++
    }
  }
  // Seam continuity: compare the wrap columns with a normal interior column.
  let edge = 0
  let interior = 0
  for (let y = 0; y < size; y++) {
    const a = rgba[(y * size) * 4 + 3] / 255
    const b = rgba[(y * size + size - 1) * 4 + 3] / 255
    const c = rgba[(y * size + 1) * 4 + 3] / 255
    edge += Math.abs(a - b)
    interior += Math.abs(a - c)
  }
  const seamRatio = interior > 1e-6 ? edge / interior : 1
  return { size, seed, rgba, seeds, coverage: covered / (size * size), peak, seamRatio }
}
