// Grid-search the two premium parameters against the 25 displays with a real price.
import { ensureFullCatalog } from '../server/services/sealed'
import { expectedPackValue } from '../server/services/packodds'
import { sealedFactor } from '../server/services/demographics'
import { monthsOutOfPrint } from '../server/services/sealed'
import { db } from '../server/lib/db'

ensureFullCatalog()

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

const rows = db.prepare(`SELECT id, set_id, packs FROM pack_products WHERE kind = 'display'`).all() as { id: string; set_id: string; packs: number | null }[]
const pts = rows
  .filter((r) => REAL[r.set_id])
  .map((r) => {
    const rel = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(r.set_id) as { release_date: string }
    const year = Number(rel.release_date.slice(0, 4))
    const ev = expectedPackValue(r.set_id)
    const packs = Math.max(1, Math.floor(r.packs ?? 36))
    const contents = ev * packs * 0.8
    const m = monthsOutOfPrint(rel.release_date, 'display', r.set_id)
    const scene = m > 0 && year > 0 && year < 2011 ? sealedFactor(r.set_id) : 1
    return { id: r.set_id, contents, m, scene, real: REAL[r.set_id] }
  })

let best: { P: number; tau: number; worst: number; geo: number } | null = null
for (const P of [4, 4.5, 5, 5.5, 6, 6.3, 7, 8, 9]) {
  for (const tau of [36, 48, 60, 72, 84, 96, 120, 144]) {
    const errs = pts.map((p) => {
      const prem = p.m <= 0 ? 1 : 1 + (P - 1) * (1 - Math.exp(-p.m / tau))
      return (p.contents * prem * p.scene) / p.real
    })
    const worst = Math.max(...errs.map((x) => Math.max(x, 1 / x)))
    const geo = Math.exp(errs.reduce((s, x) => s + Math.log(x), 0) / errs.length)
    if (!best || worst < best.worst) best = { P, tau, worst, geo }
    if (worst <= 2.6) console.log(`P=${P} tau=${tau}  worst ${worst.toFixed(2)}x  geo ${geo.toFixed(2)}x`)
  }
}
console.log('best', JSON.stringify(best))

// Per-set view of the chosen parameters.
if (best) {
  for (const p of pts.sort((a, b) => b.m - a.m)) {
    const prem = p.m <= 0 ? 1 : 1 + (best.P - 1) * (1 - Math.exp(-p.m / best.tau))
    const price = p.contents * prem * p.scene
    console.log(`${p.id.padEnd(7)} m=${p.m.toFixed(0).padStart(3)} prem=${prem.toFixed(2)} price=${Math.round(price)} real=${Math.round(p.real)} ${(price / p.real).toFixed(2)}x`)
  }
}
