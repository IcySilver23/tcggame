// What does a real display cost relative to the cards inside it?
//
//   TCGLIFE_HOME=<scratch> node ./node_modules/tsx/dist/cli.mjs tmp/measure-box-premium.ts
//
// Two evidence sets: boxes we have a quote for, and boxes whose quote was refused
// but whose SOLD median is known (the audit's numbers), which is out-of-sample for
// anything fitted on the first.
import { ensureFullCatalog } from '../server/services/sealed'
import { expectedPackValue } from '../server/services/packodds'
import { db } from '../server/lib/db'

ensureFullCatalog()

// real value, source, and whether it was in the sample that fitted a curve
const EVIDENCE: [string, number, string, boolean][] = [
  // quoted in the shelf (PriceCharting / TCGplayer)
  ['base1', 40000, 'quote', true], ['base2', 13456, 'quote', true], ['base5', 11336.53, 'quote', true],
  ['base6', 110200, 'quote', true], ['col1', 11996.11, 'quote', true], ['dp2', 14211, 'quote', true],
  ['dp6', 7337.38, 'quote', true], ['dp7', 8542.75, 'quote', true], ['ecard2', 155226.3, 'quote', true],
  ['ecard3', 212500, 'quote', true], ['ex7', 67654, 'quote', true], ['ex8', 29112.52, 'quote', true],
  ['hgss3', 7710.5, 'quote', true], ['hgss4', 5188.71, 'quote', true], ['neo2', 13475.53, 'quote', true],
  ['pl1', 4126.82, 'quote', true], ['pl3', 14183.91, 'quote', true], ['pl4', 5743.39, 'quote', true],
  ['xy1', 5999.99, 'quote', true], ['xy2', 11766.73, 'quote', true], ['xy4', 16763.04, 'quote', true],
  ['sm1', 1032.84, 'quote', true], ['bw11', 4550, 'sold', true],
  // refused quotes: their sold medians are the out-of-sample check
  ['base3', 8799.99, 'sold', false], ['base4', 10499, 'sold', false], ['gym1', 9000, 'sold', false],
  ['gym2', 13000, 'sold', false], ['neo1', 23196.6, 'sold', false], ['neo4', 13500, 'sold', false],
  ['ecard1', 50000, 'sold', false], ['ex5', 8200, 'sold', false], ['ex13', 18862.66, 'sold', false],
  ['ex16', 13526, 'sold', false], ['dp3', 6100, 'sold', false], ['dp4', 4050, 'sold', false],
  ['pl2', 5500, 'sold', false], ['bw2', 2499.99, 'sold', false], ['bw3', 2295.62, 'sold', false],
  ['bw4', 3500, 'sold', false], ['bw5', 4999.99, 'sold', false], ['bw6', 4158.33, 'sold', false],
  ['bw7', 4350, 'sold', false], ['bw8', 6000, 'sold', false], ['bw9', 3900, 'sold', false],
  ['bw10', 3399.95, 'sold', false], ['swsh7', 2190.2, 'quote', true], ['sv6', 330.34, 'quote', true],
]

const rows = EVIDENCE.map(([id, real, kind, fit]) => {
  const rel = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(id) as { release_date: string } | undefined
  const ev = expectedPackValue(id)
  const contents = ev * 36 * 0.8
  const months = rel ? (Date.now() - new Date(rel.release_date).getTime()) / 2.628e9 : 0
  return { id, real, kind, fit, year: rel ? Number(rel.release_date.slice(0, 4)) : 0, ev, contents, months, ratio: contents > 0 ? real / contents : NaN }
})

console.log('set     year  mo    contents   real      ratio')
for (const r of rows.sort((a, b) => a.months - b.months)) {
  console.log(
    `${r.id.padEnd(7)} ${r.year} ${r.months.toFixed(0).padStart(3)}  ${Math.round(r.contents).toString().padStart(8)} ${Math.round(r.real).toString().padStart(8)}  ${r.ratio.toFixed(2).padStart(6)}x  ${r.fit ? '' : '(held out)'}`,
  )
}

const fit = rows.filter((r) => r.fit && r.contents > 0)
const ratios = fit.map((r) => r.ratio).sort((a, b) => a - b)
const q = (p: number) => ratios[Math.min(ratios.length - 1, Math.floor(p * ratios.length))]
console.log(`\nratios (n=${ratios.length}): min ${ratios[0].toFixed(2)} p25 ${q(0.25).toFixed(2)} median ${q(0.5).toFixed(2)} p75 ${q(0.75).toFixed(2)} max ${ratios[ratios.length - 1].toFixed(2)}`)

// log-log fit: real = a * contents^b
const xs = fit.map((r) => Math.log(r.contents))
const ys = fit.map((r) => Math.log(r.real))
const mx = xs.reduce((a, b) => a + b, 0) / xs.length
const my = ys.reduce((a, b) => a + b, 0) / ys.length
const b = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0)
const a = Math.exp(my - b * mx)
const err = (pred: (r: (typeof rows)[number]) => number) => {
  const all = rows.filter((r) => r.contents > 0).map((r) => pred(r) / r.real)
  const geo = Math.exp(all.reduce((s, x) => s + Math.log(x), 0) / all.length)
  return { worst: Math.max(...all.map((x) => Math.max(x, 1 / x))), geo }
}
const medianRatio = q(0.5)
const current = (r: (typeof rows)[number]) => Math.min(r.contents, 700 * 12) * 12 // what sealed.ts does now
const power = (r: (typeof rows)[number]) => a * r.contents ** b
for (const [name, pred] of [
  ['current 12x with a cap', current],
  [`constant ${medianRatio.toFixed(2)}x`, (r) => r.contents * medianRatio],
  [`power law ${a.toFixed(0)} x contents^${b.toFixed(2)}`, power],
] as [string, (r: (typeof rows)[number]) => number][]) {
  const e = err(pred)
  console.log(`${name.padEnd(34)} worst factor ${e.worst.toFixed(1)}x  geometric mean ${e.geo.toFixed(2)}`)
}
