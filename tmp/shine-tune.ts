// Score the SHIPPED shine against the iridescence layer's rule — colour without
// light — using the W3C blend maths and the CSS values verbatim.
const LUM = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
const SAT = (c: number[]) => Math.max(...c) - Math.min(...c)
const over = (cb: number[], b: number[], a: number) => cb.map((v, i) => v * (1 - a) + b[i] * a)
const softLight = (v: number, s: number) => (s <= 0.5 ? v - (1 - 2 * s) * v * (1 - v) : v + (2 * s - 1) * (Math.sqrt(v) - v))
const screen = (v: number, s: number) => v + s - v * s

const BAND: [string, number[]][] = [
  ['violet 262', [130, 85, 210]],
  ['magenta 330', [200, 45, 130]],
  ['gold 45', [205, 150, 40]],
  ['cyan 172', [45, 185, 170]],
  ['violet 279', [135, 95, 215]],
]
const BAND_OPACITY = 0.8
const GLINT = 0.09
const bases: [string, number[]][] = [
  ['dark art ', [0.16, 0.14, 0.12]],
  ['mid art  ', [0.5, 0.48, 0.45]],
  ['light art', [0.82, 0.8, 0.78]],
]
const chroma = (c: number[]) => Math.round(SAT(c) * 255)
const hueOf = (c: number[]) => {
  const mx = Math.max(...c), mn = Math.min(...c), d = mx - mn
  if (d < 1e-9) return NaN
  const x = mx === c[0] ? ((c[1] - c[2]) / d) % 6 : mx === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4
  return Math.round((((x * 60) % 360) + 360) % 360)
}

const rows: { dL: number; dC: number }[] = []
for (const [bn, base] of bases) {
  for (const [sn, rgb] of BAND) {
    const src = rgb.map((v) => v / 255)
    let out = base.map((v, i) => v * (1 - BAND_OPACITY) + softLight(v, src[i]) * BAND_OPACITY)
    out = out.map((v) => screen(v, 1) * GLINT + v * (1 - GLINT))
    const dL = (LUM(out) - LUM(base)) * 255
    const dC = chroma(out) - chroma(base)
    rows.push({ dL, dC })
    console.log(`${bn} ${sn.padEnd(11)} ΔL ${dL.toFixed(0).padStart(4)}  ΔC ${String(dC).padStart(4)}  hue ${String(hueOf(out)).padStart(3)}`)
  }
}
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const old: { dL: number; dC: number }[] = bases.map(([, base]) => {
  const out = over(base, screen(base[0], 206 / 255) === 0 ? base : base.map((v) => screen(v, [206, 247, 255][0] / 255)), 0.4)
  const o = base.map((v, i) => screen(v, [206, 247, 255][i] / 255) * 0.4 + v * 0.6)
  return { dL: (LUM(o) - LUM(base)) * 255, dC: chroma(o) - chroma(base) }
})
console.log('')
console.log(`shipped  mean ΔL ${avg(rows.map((r) => r.dL)).toFixed(0).padStart(3)}  mean ΔC ${avg(rows.map((r) => r.dC)).toFixed(0).padStart(3)}`)
console.log(`old wash mean ΔL ${avg(old.map((r) => r.dL)).toFixed(0).padStart(3)}  mean ΔC ${avg(old.map((r) => r.dC)).toFixed(0).padStart(3)}`)
console.log(`stops with no chroma gain: ${rows.filter((r) => r.dC <= 0).length} of ${rows.length}`)
console.log(`stops that brighten art by more than 12/255: ${rows.filter((r) => r.dL > 12).length} of ${rows.length}`)
