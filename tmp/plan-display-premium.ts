// Every rule candidate, scored on the boxes that actually ship a modelled price.
import { ensureFullCatalog, priceOf, derivedPrice, oopMultiplier, monthsOutOfPrint } from '../server/services/sealed'
import { expectedPackValue } from '../server/services/packodds'
import { db } from '../server/lib/db'

ensureFullCatalog()

// Real boxes, from the quotes and from the sold medians of the refused pages.
const REAL: Record<string, number> = {
  base1: 40000, base2: 13456, base3: 8799.99, base4: 10499, base5: 11336.53, base6: 110200,
  gym1: 9000, gym2: 13000, neo1: 23196.6, neo2: 13475.53, neo4: 13500,
  ecard1: 50000, ecard2: 155226.3, ecard3: 212500, ex5: 8200, ex7: 67654, ex8: 29112.52,
  ex13: 18862.66, ex16: 13526, col1: 11996.11, hgss3: 7710.5, hgss4: 5188.71,
  dp2: 14211, dp3: 6100, dp4: 4050, dp6: 7337.38, dp7: 8542.75,
  pl1: 4126.82, pl2: 5500, pl3: 14183.91, pl4: 5743.39,
  bw11: 4550, bw10: 3399.95, bw9: 3900, bw8: 6000, bw7: 4350, bw6: 4158.33, bw5: 4999.99,
  bw4: 3500, bw3: 2295.62, bw2: 2500, xy1: 5999.99, xy2: 11766.73, xy4: 16763.04,
  sm1: 1032.84, swsh7: 2190.2, sv6: 330.34,
}

const rows = db.prepare(`SELECT id, set_id, packs, msrp FROM pack_products WHERE kind = 'display' ORDER BY set_id`).all() as {
  id: string
  set_id: string
  packs: number | null
  msrp: number | null
}[]

const PREMIUM = 6.3
const premiumFor = (m: number) => (m <= 0 ? 1 : 1 + (PREMIUM - 1) * (1 - Math.exp(-m / 48)))

const results: { id: string; setId: string; m: number; contents: number; now: number; next: number; real?: number }[] = []
for (const r of rows) {
  const rel = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(r.set_id) as { release_date: string } | undefined
  const ev = expectedPackValue(r.set_id)
  const packs = Math.max(1, Math.floor(r.packs ?? 36))
  const contents = ev * packs * 0.8
  const m = rel ? monthsOutOfPrint(rel.release_date, 'display', r.set_id) : 0
  const now = derivedPrice(r.set_id, 'display', r.id)
  const next = contents > 0 ? Math.round(contents * premiumFor(m)) : now
  results.push({ id: r.id, setId: r.set_id, m, contents, now, next, real: REAL[r.set_id] })
}

const modelled = results.filter((r) => priceOf(r.id).source === 'estimated')
console.log(`model-only displays: ${modelled.length} of ${results.length}\n`)
console.log('set     mo   contents     now      next     real     now/real  next/real')
for (const r of modelled.sort((a, b) => b.m - a.m)) {
  const fmt = (x: number | undefined) => (x ? Math.round(x).toString().padStart(8) : '       —')
  console.log(
    `${r.setId.padEnd(7)} ${r.m.toFixed(0).padStart(3)} ${Math.round(r.contents).toString().padStart(8)} ${fmt(r.now)} ${fmt(r.next)} ${fmt(r.real)}` +
      `  ${r.real ? (r.now / r.real).toFixed(2).padStart(7) : '      —'}` +
      `  ${r.real ? (r.next / r.real).toFixed(2).padStart(7) : '      —'}`,
  )
}

for (const [name, pick] of [
  ['now', (r: (typeof results)[number]) => r.now],
  ['next', (r: (typeof results)[number]) => r.next],
] as [string, (r: (typeof results)[number]) => number][]) {
  const scored = modelled.filter((r) => r.real).map((r) => pick(r) / (r.real as number))
  const worst = Math.max(...scored.map((x) => Math.max(x, 1 / x)))
  const geo = Math.exp(scored.reduce((s, x) => s + Math.log(x), 0) / scored.length)
  console.log(`${name}: n=${scored.length} worst ${worst.toFixed(2)}x  geo ${geo.toFixed(2)}x`)
}
