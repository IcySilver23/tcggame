import fs from 'node:fs'
import { db } from '../server/lib/db'
import { ensureFullCatalog } from '../server/services/sealed'
import {
  allProductManifests,
  manifestSummary,
  type ManifestFieldName,
  type ManifestStatus,
} from '../server/services/product-manifest'
import { SEALED_EVIDENCE } from '../server/catalog/sealed-evidence'

// Standing audit for the per-product manifest.
//
// Run on a copy of the save:
//   TCGLIFE_HOME="$PWD/tmp/audit-home" node node_modules/tsx/dist/cli.mjs tmp/check-product-manifests.ts
//
// It is intentionally about the contract, not the prose: every product has all
// five fields, an unverified field has no value, the sourced special products
// keep their known counts, and a generic ETB never invents its promo.

let checks = 0
const problems: string[] = []
function ok(condition: boolean, message: string) {
  checks++
  if (!condition) problems.push(message)
}

ensureFullCatalog()
const fieldNames: ManifestFieldName[] = ['counts', 'layout', 'promos', 'hitTiers', 'foil']
const statuses: ManifestStatus[] = ['verified', 'inferred', 'modelled', 'unverified']
const manifests = allProductManifests()
const summary = manifestSummary(manifests)
const dbCount = (db.prepare('SELECT COUNT(*) AS n FROM pack_products').get() as { n: number }).n

ok(manifests.length === dbCount, `manifest count ${manifests.length} != pack_products ${dbCount}`)
ok(new Set(manifests.map((m) => m.productId)).size === manifests.length, 'duplicate product ids in the manifest')

for (const m of manifests) {
  ok(!!m.productId && !!m.setId && !!m.name, `${m.productId}: identity fields are incomplete`)
  ok(['verified', 'inferred', 'modelled', 'partial', 'unsourced'].includes(m.status), `${m.productId}: invalid verdict ${m.status}`)
  for (const name of fieldNames) {
    const f = m[name]
    ok(statuses.includes(f.status), `${m.productId}.${name}: invalid status ${f.status}`)
    ok(f.note.trim().length > 0, `${m.productId}.${name}: empty note`)
    ok(f.value === null || f.status !== 'unverified', `${m.productId}.${name}: unverified field carries a value`)
    ok(f.value !== null || f.status === 'unverified', `${m.productId}.${name}: null field is not unverified`)
  }
  const tierNames = m.hitTiers.value?.map((t) => t.name) ?? []
  ok(new Set(tierNames).size === tierNames.length, `${m.productId}: duplicate hit tier names`)
  const secondTier = m.hitTiers.value?.some((t) => t.slot === 'second-reverse') ?? false
  const hasSecondSlot = m.layout.value?.perPack.some((s) => s.slot === 'reverse2') ?? false
  ok(!secondTier || hasSecondSlot, `${m.productId}: second-slot tier without a second reverse slot`)
  if (m.status === 'verified') {
    ok(fieldNames.every((name) => m[name].status === 'verified'), `${m.productId}: verified verdict has a non-verified field`)
  }
  if (m.status === 'unsourced') {
    ok(!m.sold, `${m.productId}: unsourced verdict is sold`)
    ok(fieldNames.every((name) => m[name].status === 'unverified' && m[name].value === null), `${m.productId}: unsourced field has a value`)
  }
  if (!m.sold) {
    ok(m.status === 'unsourced', `${m.productId}: hidden product is not unsourced`)
  }
  ok(m.sources.length > 0, `${m.productId}: no sources recorded`)
}

const minis = manifests.filter((m) => m.productId.startsWith('gm-'))
ok(minis.length === 3, `expected 3 General Mills mini packs, found ${minis.length}`)
for (const m of minis) {
  ok(m.kind === 'special', `${m.productId}: mini is not special`)
  ok(m.counts.value?.packs === 1, `${m.productId}: pack count is not 1`)
  ok(m.counts.value?.cardsPerPack === 3, `${m.productId}: cards per pack is not 3`)
  ok(m.counts.value?.physicalCardsPerPack === 3, `${m.productId}: physical cards per pack is not 3`)
  ok(m.layout.value?.totalCards === 3, `${m.productId}: layout total is not 3`)
  ok((m.layout.value?.perPack.length ?? 0) > 0, `${m.productId}: layout is empty`)
  ok((m.promos.value?.length ?? 0) > 0, `${m.productId}: no Sequin promo entries`)
  ok((m.foil.value?.length ?? 0) > 0, `${m.productId}: no foil guarantee`)
  ok(m.counts.status === 'verified', `${m.productId}: counts are not verified`)
  ok(m.promos.status === 'verified', `${m.productId}: promos are not verified`)
  ok(m.foil.status === 'verified', `${m.productId}: foil is not verified`)
}

const special = manifests.filter((m) => m.kind === 'special')
ok(special.length === 127, `expected 127 special products, found ${special.length}`)
for (const id of [
  'me55-upc-day', 'me55-upc-night', 'me55-ditto-premium', 'me55-figure-mew', 'me55-figure-mewtwo',
  'me55-2pack-blister', 'sv8pt5-2pack-blister', 'me2pt5-2pack-blister',
  'sv1-single-blister', 'sv1-triple-blister', 'sv2-single-blister', 'sv2-triple-blister',
  'sv3-single-blister', 'sv3-triple-blister', 'sv4-single-blister', 'sv4-triple-blister',
  'sv5-single-blister', 'sv5-triple-blister', 'sv6-single-blister', 'sv6-triple-blister',
  'sv7-single-blister', 'sv7-triple-blister', 'sv8-single-blister', 'sv8-triple-blister',
  'sv10-single-blister', 'sv10-triple-blister',
  'me1-single-blister', 'me1-triple-blister', 'me2-single-blister', 'me2-triple-blister',
  'me4-single-blister', 'me4-triple-blister',
  'me6-single-blister', 'me6-triple-blister',
  'me55-poster', 'me55-tech-sticker', 'me55-binder', 'me55-mini-tin', 'me55-knockout',
  'me55-sylveon-ex-box', 'me55-greninja-ex-box',
  'me2pt5-tech-sticker', 'me2pt5-mini-tin', 'me2pt5-premium-poster', 'me2pt5-first-partners-pin',
  'me2pt5-mega-meganium-box', 'me2pt5-mega-emboar-box', 'me2pt5-mega-feraligatr-box',
]) {
  ok(special.some((m) => m.productId === id), `${id}: missing from the special products`)
}

const expectedPacks: Record<string, number> = {
  'me55-upc-day': 29,
  'me55-upc-night': 29,
  'me55-ditto-premium': 8,
  'me55-figure-mew': 5,
  'me55-figure-mewtwo': 5,
  'me55-poster': 3,
  'me55-tech-sticker': 3,
  'me55-binder': 5,
  'me55-mini-tin': 2,
  'me55-knockout': 2,
  'me55-sylveon-ex-box': 4,
  'me55-greninja-ex-box': 4,
  'me2pt5-tech-sticker': 3,
  'me2pt5-mini-tin': 2,
  'me2pt5-premium-poster': 10,
  'me2pt5-first-partners-pin': 5,
  'me2pt5-mega-meganium-box': 4,
  'me2pt5-mega-emboar-box': 4,
  'me2pt5-mega-feraligatr-box': 4,
}
// Products whose published copy names no card promo: the box holds a binder,
// sticker sheet or art card, which is not a card.
const NO_PROMO: Record<string, string> = {
  'me55-binder': 'Binder Collection: five packs and a binder, no promo.',
  'me55-mini-tin': 'Mini Tin: two packs; the sticker sheet and art card are not cards.',
  'me2pt5-mini-tin': 'Mini Tin: two packs; the sticker sheet and art card are not cards.',
}
for (const [id, packs] of Object.entries(expectedPacks)) {
  const m = manifests.find((x) => x.productId === id)
  ok(!!m, `${id}: missing from the manifest`)
  if (!m) continue
  ok(m.counts.value?.packs === packs, `${id}: expected ${packs} packs, found ${m.counts.value?.packs}`)
  if (m.setId === 'me55') ok(m.counts.value?.physicalCardsPerPack === 6, `${id}: physical 30C wrapper is not 6`)
  if (m.setId === 'me2pt5') ok(m.counts.value?.physicalCardsPerPack === 10, `${id}: Ascended Heroes wrapper is not 10`)
  if (id.startsWith('me55-upc-')) {
    ok(m.layout.value?.omitted.includes('one three-card Classic Collection pack') ?? false, `${id}: the omitted Classic pack is not recorded`)
    ok(m.counts.value?.physicalTotalCards === 29 * 6 + 3, `${id}: physical total does not include the Classic pack`)
  }
  if (NO_PROMO[id]) {
    ok(m.promos.status === 'verified', `${id}: a sourced empty promo list is not verified`)
    ok(m.promos.value?.length === 0, `${id}: a promo was invented for a no-card product`)
  } else {
    ok((m.promos.value?.length ?? 0) > 0, `${id}: no named promo`)
  }
}

// A mapped promo shows the card, not just the name; the one documented gap does not.
const poster = manifests.find((m) => m.productId === 'me55-poster')
ok(
  (poster?.promos.value ?? []).map((p) => p.cardId).join(',') === 'mep-097,mep-098,mep-096',
  'me55-poster: the legendary birds are not mapped to their MEP printings',
)
const knockout = manifests.find((m) => m.productId === 'me55-knockout')
ok(knockout?.promos.value?.[0]?.name === 'Eevee', 'me55-knockout: the Eevee promo is not named')
ok(knockout?.promos.value?.[0]?.cardId === 'me55-116', 'me55-knockout: the Eevee promo is not mapped to set card 116')
const pin = manifests.find((m) => m.productId === 'me2pt5-first-partners-pin')
ok(
  (pin?.promos.value ?? []).every((p) => p.cardId != null),
  'me2pt5-first-partners-pin: the Ascended Heroes set-card promos are not mapped',
)

const me6etb = manifests.find((m) => m.productId === 'me6-etb')
ok(me6etb?.promos.status === 'verified', 'me6-etb: Kyogre promo is not sourced')
ok(me6etb?.promos.value?.[0]?.name === 'Kyogre', 'me6-etb: Kyogre promo is missing')
ok(me6etb?.promos.value?.[0]?.cardId === 'me6-26', 'me6-etb: Kyogre is not mapped to Delta Reign 26')

const etbs = manifests.filter((m) => m.kind === 'etb' && m.sold && m.productId !== 'me6-etb')
ok(etbs.length > 80, `expected the generic ETB population, found ${etbs.length}`)
const evidencedEtbs = etbs.filter((m) => SEALED_EVIDENCE[m.productId])
const genericEtbs = etbs.filter((m) => !SEALED_EVIDENCE[m.productId])
ok(evidencedEtbs.length === 24, `expected 24 evidenced ETBs, found ${evidencedEtbs.length}`)
for (const m of evidencedEtbs) {
  ok(m.promos.status === 'verified', `${m.productId}: evidenced ETB promo is not verified`)
  ok((m.promos.value?.length ?? 0) > 0, `${m.productId}: evidenced ETB has no named promo`)
}
for (const m of genericEtbs) {
  ok(m.promos.status === 'unverified', `${m.productId}: generic ETB promo is not unverified`)
  ok(m.promos.value === null, `${m.productId}: generic ETB promo carries a value`)
  ok(m.status === 'partial', `${m.productId}: generic ETB verdict is not partial`)
}

const dv1 = manifests.find((m) => m.productId === 'dv1-blister')
ok(dv1?.foil.value?.some((f) => f.label === 'Holofoil' && f.guarantee === 'every-pack') ?? false, 'dv1: all-foil guarantee is missing')
ok(dv1?.hitTiers.value?.length === 0, 'dv1: a hit tier was invented for a set with no hit slot')

const hidden = manifests.filter((m) => !m.sold)
ok(hidden.length === 3, `expected the 3 pull-table hosts, found ${hidden.length} hidden rows`)
ok(hidden.every((m) => m.productId.endsWith('-booster')), 'a hidden row is not a pull-table host')
for (const m of hidden) ok(m.status === 'unsourced', `${m.productId}: hidden row verdict is ${m.status}`)

ok(summary.products === manifests.length, 'summary product count is wrong')
ok(summary.hidden === hidden.length, 'summary hidden count is wrong')
ok(summary.sold === manifests.length - hidden.length, 'summary sold count is wrong')

const reportPath = 'reports/product-manifests.json'
ok(fs.existsSync(reportPath), `${reportPath} is missing (run scripts/product-manifests.ts)`)
if (fs.existsSync(reportPath)) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as {
    summary?: { products?: number }
    products?: { productId?: string }[]
  }
  ok(report.summary?.products === manifests.length, 'report summary is for a different product count')
  ok(report.products?.length === manifests.length, 'report product list is a different length')
  const reportIds = new Set((report.products ?? []).map((p) => p.productId))
  ok(reportIds.size === manifests.length, 'report product list has duplicate or missing ids')
}

console.log(`Product manifests: ${checks} checks`)
if (problems.length) {
  for (const p of problems) console.log(`  FAIL ${p}`)
  console.log(`  ${problems.length} problem(s)`)
  process.exit(1)
}
console.log('  all ok')
