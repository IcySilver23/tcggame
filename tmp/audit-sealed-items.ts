// One row per sealed product: is it available, does it carry the promo the box
// really holds, and where do its hit rates come from?
//
// Read-only. It never rolls a pack and never writes to the save: it asks the same
// functions the shop and the opener ask.
//
//   npx tsx tmp/audit-sealed-items.ts              every product
//   npx tsx tmp/audit-sealed-items.ts me55         only ids matching a substring
//   npx tsx tmp/audit-sealed-items.ts --json       machine-readable rows only
//   npx tsx tmp/audit-sealed-items.ts --sets       repertoire per set
//
// The promo rule this encodes: a box that held "one of two" is correctly served
// by a single grant, and only a box documented to hold BOTH is short-changed. The
// distinction is read from the evidence note ("either", "one of two"), not
// assumed, because the blisters and the UPC both list two names and only one of
// them puts both cards in the box.
import { db } from '../server/lib/db'
import { allProductManifests, type ProductManifest } from '../server/services/product-manifest'
import { sealedEvidenceFor, unsellableReason } from '../server/catalog/sealed-evidence'
import { sellsProduct, priceOf, promoValueOf } from '../server/services/sealed'
import { eraOf, planFor, profileFor, SET_UPGRADE_OVERRIDE, SET_SIR_OVERRIDE } from '../server/services/packodds'
import { miniPackFor } from '../server/catalog/general-mills'
import { valueOf } from '../server/services/market'

const args = process.argv.slice(2)
const json = args.includes('--json')
const setsOnly = args.includes('--sets')
const filter = args.find((a) => !a.startsWith('--'))

type ProductRow = {
  id: string
  set_id: string
  name: string
  kind: string
  msrp: number
  packs: number | null
  cards_per_pack: number
  market_price: number | null
  release_date: string | null
  set_name: string
}

const products = db
  .prepare(
    `SELECT p.id, p.set_id, p.name, p.kind, p.msrp, p.packs, p.cards_per_pack,
            p.market_price, p.release_date, s.name AS set_name
     FROM pack_products p JOIN sets s ON s.id = p.set_id
     ORDER BY s.release_date DESC, p.id`,
  )
  .all() as ProductRow[]

const manifests = new Map(allProductManifests().map((m) => [m.productId, m]))

function tableFor(setId: string): { rows: number; hitWeight: number; slots: Record<string, number> } {
  const rows = db
    .prepare(`SELECT slot, COUNT(*) AS n, SUM(weight) AS w FROM pack_product_cards WHERE pack_product_id = ? GROUP BY slot`)
    .all(`${setId}-booster`) as { slot: string; n: number; w: number | null }[]
  const slots: Record<string, number> = {}
  let total = 0
  let hitWeight = 0
  for (const r of rows) {
    slots[r.slot] = r.n
    total += r.n
    if (r.slot === 'hit') hitWeight = Math.round((r.w ?? 0) * 1000) / 1000
  }
  return { rows: total, hitWeight, slots }
}

function oddsBasis(setId: string): { basis: string; detail: string; perSet: boolean } {
  const upgrade = SET_UPGRADE_OVERRIDE[setId]
  const sir = SET_SIR_OVERRIDE[setId]
  if (upgrade || sir != null) {
    const parts: string[] = []
    if (upgrade) parts.push(Object.keys(upgrade).join('/'))
    if (sir != null) parts.push(`SIR ${(sir * 100).toFixed(2)}%`)
    return { basis: 'set', detail: parts.join(' '), perSet: true }
  }
  const profile = profileFor(setId)
  return { basis: `era/${eraOf(setId)}`, detail: Object.keys(profile.upgrade).join('/'), perSet: false }
}

type Row = {
  id: string
  name: string
  kind: string
  set: string
  sold: boolean
  why: string | null
  price: number
  packs: number | null
  packsClaimed: number | null
  packsMatch: boolean
  cardsPerPack: number
  cardsClaimed: number | null
  cardsMatch: boolean
  planCards: number
  planMatch: boolean
  tableRows: number
  hitWeight: number
  tableSlots: Record<string, number>
  promoEvidence: string[]
  promoPolicy: 'either' | 'all' | 'none'
  promoNote: string | null
  promoValues: { id: string; name: string; value: number }[]
  promoResolved: number
  promosGranted: number
  promoValue: number
  promoValueIfAll: number
  odds: { basis: string; detail: string; perSet: boolean }
  issues: string[]
}

const rows: Row[] = []

for (const p of products) {
  if (filter && !p.id.includes(filter)) continue
  const m: ProductManifest | null = manifests.get(p.id) ?? null
  const ev = sealedEvidenceFor(p.id)
  const mini = miniPackFor(p.id)
  const issues: string[] = []

  const sold = sellsProduct(p.id, p.set_id)
  const why = sold ? null : unsellableReason(p.id)
  let price = 0
  try {
    price = priceOf(p.id).market
  } catch {
    issues.push('price threw')
  }
  if (sold && !(price > 0)) issues.push('sold with no price')

  const packs = p.packs
  const packsClaimed = ev?.packs ?? null
  const packsMatch = packsClaimed == null || packs == null || packsClaimed === packs
  if (!packsMatch) issues.push(`packs ${packs} vs evidence ${packsClaimed}`)
  if ((p.kind === 'bundle' || p.kind === 'etb' || p.kind === 'display') && !packs) issues.push('box with no pack count')

  const cardsPerPack = p.cards_per_pack || 0
  // `cardsClaimed` is the PHYSICAL wrapper count from the evidence; the row's
  // `cards_per_pack` is the count the game actually deals. They legitimately
  // differ for 30th Celebration (six-card wrapper, ten-card game pack), and
  // the manifest names both. Judge the row by the blueprint it opens with.
  const cardsClaimed = ev?.cardsPerPack ?? null
  const planCards = mini ? 3 : planFor(p.set_id, cardsPerPack || 10).reduce((a, s) => a + s.count, 0)
  const planMatch = mini || !cardsPerPack || planCards === cardsPerPack
  const cardsMatch = mini || cardsClaimed == null || cardsClaimed === cardsPerPack || planMatch
  if (!mini && !planMatch) issues.push(`blueprint deals ${planCards} vs cards_per_pack ${cardsPerPack}`)

  const table = mini ? { rows: 0, hitWeight: 0, slots: {} as Record<string, number> } : tableFor(p.set_id)
  if (!mini && table.rows === 0) issues.push('no pull table')

  const promoEvidence = ev?.promos ?? []
  // The evidence states the policy: 'all' is declared per box, and every other
  // named-promo row is the ordinary one-of case.
  const policy: Row['promoPolicy'] = promoEvidence.length === 0 ? 'none' : ev?.promoPolicy === 'all' ? 'all' : 'either'
  const promoValues = (ev?.promoIds ?? []).map((id) => ({ id, name: '', value: 0 }))
  for (const pv of promoValues) {
    const hit = db.prepare('SELECT name FROM cards WHERE id = ?').get(pv.id) as { name: string } | undefined
    pv.name = hit?.name ?? '(not catalogued)'
    try {
      pv.value = Math.round(Number(valueOf(pv.id) || 0) * 100) / 100
    } catch {
      pv.value = 0
    }
  }
  const promoResolved = (m?.promos.value ?? []).filter((x) => !!x.cardId).length
  // A box documented to hold every named promo hands them all over now; the
  // ordinary box hands over the one that was inside.
  const promosGranted = ev?.promoPolicy === 'all' ? promoResolved : promoResolved > 0 ? 1 : 0
  let promoValue = 0
  try {
    promoValue = promoValueOf(p.id)
  } catch {
    issues.push('promo value threw')
  }
  const promoValueIfAll = Math.round(promoValues.reduce((a, x) => a + x.value, 0) * 100) / 100

  if (promoEvidence.length > 0 && promoResolved === 0) {
    issues.push(`promo named but unresolved: ${promoEvidence.join(' / ')}`)
  }
  if (promoEvidence.length > 0 && promoValue <= 0) {
    issues.push('promo named but worth $0 (opener grants nothing)')
  }
  // Only a box that holds them ALL is short-changed by a single grant.
  if (policy === 'all' && promoEvidence.length > promosGranted) {
    issues.push(`box holds ${promoEvidence.length} promos, one rip grants ${promosGranted}`)
  }

  rows.push({
    id: p.id,
    name: p.name,
    kind: p.kind,
    set: p.set_id,
    sold,
    why,
    price,
    packs,
    packsClaimed,
    packsMatch,
    cardsPerPack,
    cardsClaimed,
    cardsMatch,
    planCards,
    planMatch,
    tableRows: table.rows,
    hitWeight: table.hitWeight,
    tableSlots: table.slots,
    promoEvidence,
    promoPolicy: policy,
    promoNote: ev?.note ?? null,
    promoValues,
    promoResolved,
    promosGranted,
    promoValue,
    promoValueIfAll,
    odds: oddsBasis(p.set_id),
    issues,
  })
}

type SetCover = { set: string; name: string; kinds: Record<string, { exists: boolean; sold: boolean }> }
const cover: SetCover[] = []
{
  const sets = db.prepare('SELECT id, name FROM sets ORDER BY release_date DESC').all() as { id: string; name: string }[]
  for (const s of sets) {
    const mine = products.filter((p) => p.set_id === s.id)
    if (mine.length === 0) continue
    const kinds: SetCover['kinds'] = {}
    for (const k of ['booster', 'bundle', 'etb', 'display', 'special']) {
      const row = mine.find((p) => p.kind === k)
      kinds[k] = { exists: !!row, sold: row ? sellsProduct(row.id, row.set_id) : false }
    }
    cover.push({ set: s.id, name: s.name, kinds })
  }
}

if (json) {
  console.log(JSON.stringify({ rows, cover }, null, 2))
  process.exit(rows.some((r) => r.issues.length > 0) ? 1 : 0)
}

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n))
console.log(`${rows.length} sealed products\n`)
for (const r of rows) {
  let promo = '—'
  if (r.promoEvidence.length) {
    const held = r.promoPolicy === 'all' ? 'holds ALL' : 'one of'
    promo = `${r.promoEvidence.join(' / ')} [${held}, grants ${r.promosGranted}] $${r.promoValue.toFixed(2)}`
  }
  console.log(
    `${pad(r.id, 26)} ${r.sold ? 'SOLD ' : 'HIDE '} ${pad(String(r.packs ?? '?') + 'p', 4)} ` +
      `${pad(String(r.cardsPerPack), 2)}c ${pad(r.odds.basis, 14)} ${pad(promo, 62)} ${r.issues.length ? '✗ ' + r.issues.join('; ') : 'ok'}`,
  )
}

if (setsOnly) {
  console.log('\nper-set repertoire')
  for (const c of cover) {
    const parts = ['booster', 'bundle', 'etb', 'display', 'special'].map((k) => {
      const v = c.kinds[k]
      return `${k}:${v.exists ? (v.sold ? 'sold' : 'hidden') : '—'}`
    })
    console.log(`  ${pad(c.set, 12)} ${pad(c.name, 34)} ${parts.join(' ')}`)
  }
}

const failed = rows.filter((r) => r.issues.length > 0)
const soldCount = rows.filter((r) => r.sold).length
const withPromo = rows.filter((r) => r.promoEvidence.length > 0)
const perSetOdds = rows.filter((r) => r.odds.perSet)
console.log(
  `\nsummary: ${soldCount}/${rows.length} sold · ${withPromo.length} carry a named promo ` +
    `(${withPromo.filter((r) => r.promoResolved === r.promoEvidence.length).length} fully resolved) · ` +
    `${perSetOdds.length} on per-set odds, ${rows.length - perSetOdds.length} on era odds`,
)
if (failed.length) {
  console.log(`\n${failed.length} flagged:`)
  for (const r of failed) console.log(`  ${r.id}: ${r.issues.join('; ')}`)
}
process.exit(failed.length ? 1 : 0)
