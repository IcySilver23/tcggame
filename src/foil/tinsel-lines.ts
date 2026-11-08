// One Tinsel line, sampled along its length.
//
// Split out of tinsel-sheet.ts so the suite can ask "what ink does this line put
// at this x?" without rendering a 1024px sheet, and so the sheet renderer stays a
// loop over rows. Everything here is wrapped around the sheet width: a break that
// runs off one edge continues at the other, which is what lets the field tile.

const TAU = Math.PI * 2

export type TinselGap = { start: number; width: number }

export type TinselLine = {
  index: number
  ink: number
  gaps: TinselGap[]
  shimmer: { cycles: number; phase: number; depth: number }
}

function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t
  return c * c * (3 - 2 * c)
}

function torusDistance(a: number, b: number, size: number): number {
  const d = Math.abs(a - b) % size
  return Math.min(d, size - d)
}

/**
 * Ink of this line at a sheet column. The shimmer is periodic in the sheet width,
 * and so is every gap, so the value at x = 0 continues the value at x = size - 1.
 */
export function tinselInkAt(line: TinselLine, x: number, size: number): number {
  const { cycles, phase, depth } = line.shimmer
  const shimmer = 1 - depth * (0.5 - 0.5 * Math.cos(TAU * (cycles * (x / size) + phase)))
  let ink = line.ink * shimmer
  for (const gap of line.gaps) {
    const d = torusDistance(x, gap.start, size)
    const half = gap.width / 2
    if (d < half) ink *= 1 - 0.9 * smoothstep(1 - d / half)
  }
  return ink
}
