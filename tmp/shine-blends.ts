// Which blend+stop-luminance carries chroma without washing the artwork out?
// Scored the same way as the canvas layers: delta luminance vs delta chroma.
const LUM = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
const SAT = (c: number[]) => Math.max(...c) - Math.min(...c)
const over = (cb: number[], b: number[], a: number) => cb.map((v, i) => v * (1 - a) + b[i] * a)
const blend = (m: string, cb: number[], cs: number[]) => cb.map((v, i) => {
  const s = cs[i]
  if (m === 'overlay') return v <= 0.5 ? 2 * v * s : 1 - 2 * (1 - v) * (1 - s)
  if (m === 'soft-light') return s <= 0.5 ? v - (1 - 2 * s) * v * (1 - v) : v + (2 * s - 1) * (Math.sqrt(v) - v)
  if (m === 'screen') return v + s - v * s
  if (m === 'hard-light') return s <= 0.5 ? 2 * s * v : 1 - 2 * (1 - s) * (1 - v)
  return s
})
const bases: [string, number[]][] = [
  ['dark ', [0.16, 0.14, 0.12]],
  ['mid  ', [0.5, 0.48, 0.45]],
  ['light', [0.82, 0.8, 0.78]],
]
const stopsBright = [[175, 125, 255], [240, 90, 195], [250, 195, 70], [90, 240, 225], [175, 130, 255]]
const stopsMid = [[130, 85, 210], [200, 45, 130], [205, 150, 40], [45, 185, 170], [135, 95, 215]]
const chroma = (c: number[]) => Math.round(SAT(c) * 255)
const run = (name: string, mode: string, stops: number[][], a: number) => {
  const rows = bases.map(([bn, base]) => {
    let dL = 0, dC = 0
    for (const s of stops) {
      const out = over(base, blend(mode, base, s.map((v) => v / 255)), a)
      dL += (LUM(out) - LUM(base)) * 255
      dC += chroma(out) - chroma(base)
    }
    return { bn, dL: dL / stops.length, dC: dC / stops.length }
  })
  console.log(`${name.padEnd(30)} ` + rows.map((r) => `${r.bn} ΔL ${r.dL.toFixed(0).padStart(3)} ΔC ${r.dC.toFixed(0).padStart(3)}`).join(' | '))
}
run('overlay .50 bright stops (old)', 'overlay', stopsBright, 0.5)
run('overlay .45 mid stops', 'overlay', stopsMid, 0.45)
run('soft-light .80 mid stops', 'soft-light', stopsMid, 0.8)
run('soft-light .60 mid stops', 'soft-light', stopsMid, 0.6)
run('hard-light .30 mid stops', 'hard-light', stopsMid, 0.3)
run('screen .25 mid stops', 'screen', stopsMid, 0.25)
