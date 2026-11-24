// Why is a collector-era box's modelled price that far off? Print the derivation
// for the sets the audit flagged plus a few that are right.
import { ensureFullCatalog, priceOf, derivedPrice, oopMultiplier, monthsOutOfPrint, launchAdjustedMultiplier } from '../server/services/sealed'
import { planFor, expectedPackValue, upgradeChance } from '../server/services/packodds'
import { valueOf } from '../server/services/market'
import { rareVariantFor } from '../server/services/finish-odds'
import { db } from '../server/lib/db'

ensureFullCatalog()

const SETS = ['base1', 'base2', 'gym2', 'neo1', 'base6', 'ecard1', 'ex5', 'ex8', 'bw11', 'bw8', 'xy2', 'swsh7', 'sv6']

for (const id of SETS) {
  const rel = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(id) as { release_date: string } | undefined
  const year = rel ? Number(rel.release_date.slice(0, 4)) : 0
  const ev = expectedPackValue(id)
  const plan = planFor(id, 10)
  const months = rel ? monthsOutOfPrint(rel.release_date, 'display', id) : 0
  const oop = rel ? launchAdjustedMultiplier(oopMultiplier(months, 'display'), (Date.now() - new Date(rel.release_date).getTime()) / 2.628e9) : 1
  const contents = ev * 36 * 0.8
  const ceiling = 700 * oop
  const modelled = derivedPrice(id, 'display')
  const p = priceOf(`${id}-display`)
  console.log(
    `${id.padEnd(7)} ${year} ev=$${ev.toFixed(2)} upg=${(upgradeChance(id) * 100).toFixed(1)}% contents36=${Math.round(contents)} oop=${oop.toFixed(1)} capTerm=${Math.round(ceiling)} est=${Math.round(Math.min(contents, ceiling) * oop)} modelled=$${Math.round(modelled)} shelf=$${Math.round(p.market)} ${p.source}`,
  )

  // Per-slot value with the same variant rule expectedPackValue uses.
  const rows = db
    .prepare(
      `SELECT p.card_id, p.weight, p.slot, c.rarity, c.name
       FROM pack_product_cards p JOIN cards c ON c.id = p.card_id
       WHERE p.pack_product_id = ?`,
    )
    .all(`${id}-booster`) as { card_id: string; weight: number; slot: string; rarity: string | null; name: string }[]
  for (const slot of ['common', 'uncommon', 'holo', 'hit', 'energy']) {
    const rs = rows.filter((r) => r.slot === slot)
    if (!rs.length) continue
    const vals = rs.map((r) => ({
      name: r.name,
      v: valueOf(r.card_id, slot === 'holo' || slot === 'hit' ? rareVariantFor(id, r.rarity) : 'normal'),
      w: r.weight,
    }))
    const tot = vals.reduce((a, v) => a + Math.max(0, v.w), 0)
    const avg = tot > 0 ? vals.reduce((a, v) => a + v.v * (Math.max(0, v.w) / tot), 0) : 0
    const top = [...vals].sort((a, b) => b.v - a.v).slice(0, 3).map((v) => `${v.name} $${v.v.toFixed(0)}`).join(', ')
    console.log(`        ${slot.padEnd(9)} n=${String(vals.length).padStart(3)} avg=$${avg.toFixed(2)} top: ${top}`)
  }
  console.log(`        plan ${plan.map((s) => `${s.slot}x${s.count}`).join(' ')}`)
}
