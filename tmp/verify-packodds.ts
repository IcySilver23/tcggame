// Measure the pack roller against the odds its own table claims, on a
// throwaway copy of the save. Run:  SIM_PACKS=600 npx tsx tmp/verify-packodds.ts
import { prepareSimHome } from '../server/scripts/sim-home'

const home = prepareSimHome()
const { db } = await import('../server/lib/db')
const packs = await import('../server/services/packs')
const odds = await import('../server/services/packodds')

const PACKS = Number(process.env.SIM_PACKS ?? 600)

const metaCache = new Map<string, { rarity: string | null; supertype: string }>()
function info(id: string) {
  const hit = metaCache.get(id)
  if (hit) return hit
  const row = db.prepare('SELECT rarity, supertype FROM cards WHERE id = ?').get(id) as { rarity: string | null; supertype: string } | undefined
  const val = { rarity: row?.rarity ?? null, supertype: row?.supertype ?? '' }
  metaCache.set(id, val)
  return val
}

const sets = db
  .prepare(`SELECT s.id FROM sets s WHERE s.release_date IS NOT NULL
            AND EXISTS (SELECT 1 FROM pack_products p WHERE p.id = s.id || '-booster')
            ORDER BY s.release_date`)
  .all() as { id: string }[]
const samples = new Map<string, string>()
const hitless: string[] = []
for (const s of sets) {
  const era = odds.eraOf(s.id)
  if (!samples.has(era)) samples.set(era, s.id)
}
for (const id of ['sv8', 'sv3pt5', 'sv8.5', 'sv4pt5', 'me55']) {
  if ((db.prepare('SELECT COUNT(*) AS n FROM cards WHERE set_id = ?').get(id) as { n: number }).n > 0) samples.set('extra:' + id, id)
}

console.log(`sim home: ${home}  |  ${PACKS} packs per set\n`)
const pct = (n: number, d: number) => ((100 * n) / d).toFixed(2) + '%'
let worstEnergy = 0

for (const [label, setId] of samples) {
  packs.buildPullTable(setId, 10)
  const era = odds.eraOf(setId)
  const profile = odds.profileFor(setId)
  const declared = odds.upgradeOdds(setId)

  // Targets as the table actually encodes them: each hit weight IS the per-pack
  // chance divided by the cards sharing that tier, so summing a tier's weights
  // gives that tier's per-pack target.
  const rows = db
    .prepare(`SELECT c.rarity AS rarity, ppc.weight AS weight FROM pack_product_cards ppc
              JOIN cards c ON c.id = ppc.card_id
              WHERE ppc.pack_product_id = ? AND ppc.slot = 'hit'`)
    .all(`${setId}-booster`) as { rarity: string | null; weight: number }[]
  const tierTarget = new Map<string, number>()
  for (const r of rows) tierTarget.set(r.rarity ?? '?', (tierTarget.get(r.rarity ?? '?') ?? 0) + r.weight)
  const hitTarget = Math.min(0.85, [...tierTarget.values()].reduce((a, v) => a + v, 0))
  const holoPool = db.prepare("SELECT c.rarity AS rarity, ppc.weight AS weight FROM pack_product_cards ppc JOIN cards c ON c.id = ppc.card_id WHERE ppc.pack_product_id = ? AND ppc.slot = 'holo'").all(setId + '-booster') as { rarity: string | null; weight: number }[]
  const holoTotal = holoPool.reduce((a, r) => a + r.weight, 0)
  const holoTarget = holoTotal > 0 ? holoPool.filter((r) => /^rare holo$/i.test(r.rarity ?? '')).reduce((a, r) => a + r.weight, 0) / holoTotal : 0
  if (hitTarget === 0) hitless.push(setId)

  // Only the energy-slot cards are Basic Energy. A rare-slot Energy (Neo
  // Genesis prints Darkness and Metal Energy at Rare) is a different card.
  const basicEnergyIds = new Set(
    (db.prepare("SELECT card_id FROM pack_product_cards WHERE pack_product_id = ? AND slot = 'energy'").all(`${setId}-booster`) as { card_id: string }[]).map((r) => r.card_id),
  )

  let cardTotal = 0
  let hitPacks = 0
  let holoPacks = 0
  const energyHist = new Map<number, number>()
  const tiers = new Map<string, number>()

  for (let i = 0; i < PACKS; i++) {
    const cards = packs.rollPack(setId, `verify_${era}_${i}`, 'booster', 10, 'other')
    if (!cards) break
    cardTotal += cards.length
    let energy = 0
    let plainHolo = 0
    let hit = false
    for (const c of cards) {
      const m = info(c.cardId)
      if (basicEnergyIds.has(c.cardId)) energy++
      if (c.isHit) {
        hit = true
        tiers.set(m.rarity ?? '?', (tiers.get(m.rarity ?? '?') ?? 0) + 1)
      } else if (/^rare holo$/i.test(m.rarity ?? '')) plainHolo++
    }
    energyHist.set(energy, (energyHist.get(energy) ?? 0) + 1)
    if (hit) hitPacks++
    if (plainHolo > 0) holoPacks++
    if (energy > worstEnergy) worstEnergy = energy
  }

  console.log(`${label}  ${setId}  (${profile.label})`)
  console.log(`  cards/pack      ${(cardTotal / PACKS).toFixed(2)}`)
  console.log(`  energy/pack     ${[...energyHist.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n}:${pct(c, PACKS)}`).join('  ')}  (era ships energy: ${profile.energyInPack})`)
  console.log(`  holo rare       ${pct(holoPacks, PACKS)}  (target ${pct(holoTarget, 1)})`)
  console.log(`  any hit         ${pct(hitPacks, PACKS)}  (target ${pct(hitTarget, 1)})`)
  for (const [tier, n] of [...tiers.entries()].sort((a, b) => b[1] - a[1])) {
    const target = tierTarget.get(tier) ?? declared[tier]
    console.log(`    ${tier.padEnd(30)} ${pct(n, PACKS)}${target !== undefined ? `  (target ${pct(target, 1)})` : ''}`)
  }
  console.log('')
}

console.log(`sets with no upgrade tier at all: ${hitless.length} (of ${sets.length})`)
console.log(`max Basic Energy from the energy slot in any pack: ${worstEnergy} ${worstEnergy <= 1 ? 'OK' : 'FAIL'}`)
process.exit(worstEnergy <= 1 ? 0 : 1)
