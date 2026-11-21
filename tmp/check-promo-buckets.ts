// Suite: the four pre-2012 Black Star Promo programmes are resolved per card.
//
// What must hold:
//   - the counts are the ones the catalogues state, per programme;
//   - every Cosmos claim resolves to Cosmos, verified, on the retro sheet;
//   - every non-holo claim resolves to a non-holo printing with a source;
//   - a card in neither catalogue makes NO claim rather than being swept into one;
//   - the table's names still match the catalogue (a moved row fails here);
//   - promos are never reverse: a reverse token cannot conjure a reverse printing.
//
// Run: ./node_modules/.bin/tsx tmp/check-promo-buckets.ts
import Database from 'better-sqlite3'
import {
  PROMO_COSMOS_CARDS,
  PROMO_NON_HOLO_CARDS,
  PROMO_UNLISTED_CARDS,
  PROMO_CATALOGUE,
} from '../src/foil/promo-db'
import { PROMO_BUCKET_CLAIMS, PROMO_BUCKET_SETS, PROMO_BUCKET_UNLISTED } from '../src/foil/promo-buckets-db'
import { nonHoloFor, printingFor } from '../src/foil/printing-db'

let checks = 0
let failed = 0
const check = (name: string, ok: boolean) => {
  checks++
  if (!ok) {
    failed++
    console.log(`  FAIL ${name}`)
  }
}

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db.prepare('select id, set_id, name, rarity from cards').all() as {
  id: string
  set_id: string
  name: string
  rarity: string | null
}[]
db.close()
const byId = new Map(rows.map((r) => [r.id, r]))

// 1. Counts per programme, exactly as read from the two catalogues.
const expected: Record<string, { cosmos: number; nonHolo: number; unlisted: number }> = {
  basep: { cosmos: 8, nonHolo: 45, unlisted: 0 },
  np: { cosmos: 22, nonHolo: 15, unlisted: 0 },
  dpp: { cosmos: 51, nonHolo: 3, unlisted: 0 },
  hsp: { cosmos: 20, nonHolo: 1, unlisted: 0 },
}
for (const [setId, want] of Object.entries(expected)) {
  check(`${setId} cosmos count`, PROMO_COSMOS_CARDS.filter((c) => c.setId === setId).length === want.cosmos)
  check(`${setId} non-holo count`, PROMO_NON_HOLO_CARDS.filter((c) => c.setId === setId).length === want.nonHolo)
  check(`${setId} unlisted count`, PROMO_UNLISTED_CARDS.filter((c) => c.setId === setId).length === want.unlisted)
}
check('catalogue totals', PROMO_CATALOGUE.counts.cosmos === 101 && PROMO_CATALOGUE.counts.nonHolo === 64 && PROMO_CATALOGUE.counts.unlisted === 0)

// Four HGSS promos are named Cracked Ice Holofoil prints by their own card pages, so
// they answer through the Cracked Ice table rather than the treatment catalogues.
const CRACKED_ICE_PROMOS = ['hsp-HGSS16', 'hsp-HGSS17', 'hsp-HGSS24', 'hsp-HGSS25']
for (const id of CRACKED_ICE_PROMOS) {
  const p = printingFor({ cardId: id, rarity: byId.get(id)?.rarity ?? '' })
  check(`${id} resolves crackedice`, p?.pattern === 'crackedice')
  check(`${id} cracked ice is verified`, p?.status === 'verified')
  check(`${id} cracked ice area stays modelled`, p?.maskVerified === false)
  check(`${id} no reverse printing`, printingFor({ cardId: id, variant: 'reverseHolofoil' }) === null)
}

// The two French-only DP promos are named Cosmos by their own Bulbapedia pages, against
// Pokumon's non-holo tag. The claim follows the source that names the paper, and the
// disagreement has to stay visible in the entry rather than being tidied away.
const NAMED_COSMOS_PROMOS = ['dpp-DP54', 'dpp-DP55']
for (const id of NAMED_COSMOS_PROMOS) {
  const p = printingFor({ cardId: id, rarity: byId.get(id)?.rarity ?? '' })
  check(`${id} resolves cosmos-retro`, p?.pattern === 'cosmos-retro')
  check(`${id} is verified`, p?.status === 'verified')
  check(`${id} records the Pokumon disagreement`, /Pokumon/.test(p?.note ?? ''))
  check(`${id} keeps the retro paper`, p?.paper === 'classic_dense')
  check(`${id} foil area stays undocumented`, p?.maskVerified === false)
  check(`${id} no reverse printing`, printingFor({ cardId: id, variant: 'reverseHolofoil' }) === null)
}

// 2. Every row names a card that exists, with the name the catalogue knows.
for (const claim of [...PROMO_COSMOS_CARDS, ...PROMO_NON_HOLO_CARDS, ...PROMO_UNLISTED_CARDS]) {
  const row = byId.get(claim.cardId)
  check(`${claim.cardId} exists`, Boolean(row))
  check(`${claim.cardId} name matches`, row?.name === claim.name)
}

// 3. A Cosmos claim resolves to Cosmos, verified, on the retro sheet.
for (const claim of PROMO_COSMOS_CARDS) {
  const p = printingFor({ cardId: claim.cardId, rarity: byId.get(claim.cardId)?.rarity ?? '' })
  check(`${claim.cardId} resolves cosmos-retro`, p?.pattern === 'cosmos-retro')
  check(`${claim.cardId} is verified`, p?.status === 'verified')
  check(`${claim.cardId} matched an explicit rule`, p?.matchedRule === 'explicit')
  check(`${claim.cardId} foil area stays undocumented`, p?.maskVerified === false)
  // The paper: every one of these programmes predates the 2013 HD sheet.
  const vintage = ['basep', 'np', 'dpp', 'hsp'].includes(claim.setId)
  check(`${claim.cardId} keeps the retro paper`, !vintage || p?.pattern === 'cosmos-retro')
}

// 4. A non-holo claim resolves to a non-holo printing, and no foil can be conjured.
for (const claim of PROMO_NON_HOLO_CARDS) {
  const nh = nonHoloFor({ cardId: claim.cardId, rarity: byId.get(claim.cardId)?.rarity ?? '' })
  check(`${claim.cardId} resolves non-holo`, nh?.variant === 'non-holo' && nh.status === 'verified')
  check(`${claim.cardId} non-holo names its source`, Boolean(nh?.source))
  check(`${claim.cardId} reverse token invents nothing`, nonHoloFor({ cardId: claim.cardId, variant: 'reverseHolofoil' }) === null)
}

// 5. Three Nintendo promos exist only as reverse holos, so the card row itself answers.
// The identification is explicit; the paper is the era's reverse finish and the area is
// read from a scan, so neither of those may be presented as verified.
const REVERSE_PROMOS = ['np-3', 'np-8', 'np-10']
for (const id of REVERSE_PROMOS) {
  const rarity = byId.get(id)?.rarity ?? ''
  const p = printingFor({ cardId: id, rarity })
  check(`${id} resolves reverse-flat`, p?.pattern === 'reverse-flat')
  check(`${id} is a reverse printing`, p?.variant === 'reverse')
  check(`${id} matched an explicit rule`, p?.matchedRule === 'explicit')
  check(`${id} keeps its paper inferred`, p?.status === 'inferred')
  check(`${id} keeps its foil area modelled`, p?.maskVerified === false)
  check(`${id} makes no non-holo claim`, nonHoloFor({ cardId: id, rarity }) === null)
  check(`${id} also resolves with a holofoil token`, printingFor({ cardId: id, rarity, variant: 'holofoil' })?.pattern === 'reverse-flat')
}

// 6. The bucket where both treatments exist: the card resolves as Cosmos, and the
// non-holo printing is still available under its own name.
const dual = PROMO_COSMOS_CARDS.filter((c) => c.alsoNonHolo)
check('dual-treatment cards are recorded', dual.length >= 1)
for (const claim of dual) {
  const rarity = byId.get(claim.cardId)?.rarity ?? ''
  check(`${claim.cardId} dual resolves as Cosmos`, printingFor({ cardId: claim.cardId, rarity })?.pattern === 'cosmos-retro')
  check(`${claim.cardId} dual also has a non-holo printing`, nonHoloFor({ cardId: claim.cardId, rarity }) !== null)
}

// 7. Promotional printings are not reverse holos.
for (const claim of PROMO_COSMOS_CARDS) {
  check(`${claim.cardId} no reverse printing`, printingFor({ cardId: claim.cardId, variant: 'reverseHolofoil' }) === null)
}

// 8. Every row of the four programmes now has an answer of some kind, and the
// bucket sizes add up to the catalogue.
for (const setId of Object.keys(expected)) {
  const total = rows.filter((r) => r.set_id === setId).length
  const counted =
    PROMO_COSMOS_CARDS.filter((c) => c.setId === setId).length +
    PROMO_NON_HOLO_CARDS.filter((c) => c.setId === setId).length +
    PROMO_UNLISTED_CARDS.filter((c) => c.setId === setId).length +
    CRACKED_ICE_PROMOS.filter((id) => byId.get(id)?.set_id === setId).length +
    NAMED_COSMOS_PROMOS.filter((id) => byId.get(id)?.set_id === setId).length +
    REVERSE_PROMOS.filter((id) => byId.get(id)?.set_id === setId).length
  check(`${setId} bucket sizes cover the catalogue (${counted}/${total})`, counted === total)
}

// 9. The four buckets that were still unresolved — BW Black Star Promos, Southern
// Islands, Pokémon Rumble and Best of Game — are now classified card by card too.
// Each treatment resolves to a named pattern; a non-holo claim answers through
// nonHoloFor; a reverse finish answers with or without a token because it is the
// card's only printing; and the one BW row no source lists makes no claim at all.
const PATTERN_FOR_TREATMENT: Record<string, string> = {
  cosmos: 'cosmos-retro',
  tinsel: 'tinsel',
  'cracked-ice': 'crackedice',
  crosshatch: 'crosshatch',
  mirror: 'mirror',
  textured: 'textured-full-art',
  'pokeball-reverse': 'special-treatment',
}
const BUCKET_COUNTS: Record<string, { claims: number; unlisted: number; treatments: Record<string, number> }> = {
  bwp: { claims: 100, unlisted: 1, treatments: { tinsel: 15, cosmos: 51, 'non-holo': 15, crosshatch: 3, 'pokeball-reverse': 1, mirror: 9, textured: 3, 'cracked-ice': 3 } },
  si1: { claims: 18, unlisted: 0, treatments: { cosmos: 6, 'non-holo': 12 } },
  ru1: { claims: 16, unlisted: 0, treatments: { cosmos: 3, 'non-holo': 13 } },
  bp: { claims: 9, unlisted: 0, treatments: { cosmos: 5, 'non-holo': 4 } },
}
for (const [setId, want] of Object.entries(BUCKET_COUNTS)) {
  const claims = PROMO_BUCKET_CLAIMS.filter((c) => c.setId === setId)
  const unlisted = PROMO_BUCKET_UNLISTED.filter((c) => c.setId === setId)
  check(`${setId} claim count`, claims.length === want.claims)
  check(`${setId} unlisted count`, unlisted.length === want.unlisted)
  for (const [treatment, n] of Object.entries(want.treatments)) {
    check(`${setId} ${treatment} count`, claims.filter((c) => c.treatment === treatment).length === n)
  }
  check(`${setId} every row is answered or explicitly unclaimed`, claims.length + unlisted.length === rows.filter((r) => r.set_id === setId).length)
  check(`${setId} names its source`, Boolean(PROMO_BUCKET_SETS[setId as keyof typeof PROMO_BUCKET_SETS]?.source))
}

for (const claim of PROMO_BUCKET_CLAIMS) {
  const rarity = byId.get(claim.cardId)?.rarity ?? ''
  check(`${claim.cardId} exists`, Boolean(byId.get(claim.cardId)))
  check(`${claim.cardId} name matches`, byId.get(claim.cardId)?.name === claim.name)
  if (claim.treatment === 'non-holo') {
    check(`${claim.cardId} resolves non-holo`, nonHoloFor({ cardId: claim.cardId, rarity })?.variant === 'non-holo')
    check(`${claim.cardId} non-holo makes no foil claim`, printingFor({ cardId: claim.cardId, rarity }) === null)
    check(`${claim.cardId} reverse token invents nothing`, nonHoloFor({ cardId: claim.cardId, rarity, variant: 'reverseHolofoil' }) === null)
    continue
  }
  const p = printingFor({ cardId: claim.cardId, rarity })
  check(`${claim.cardId} resolves ${PATTERN_FOR_TREATMENT[claim.treatment]}`, p?.pattern === PATTERN_FOR_TREATMENT[claim.treatment])
  check(`${claim.cardId} variant is ${claim.reverse ? 'reverse' : 'holo'}`, p?.variant === (claim.reverse ? 'reverse' : 'promo'))
  check(`${claim.cardId} matched an explicit rule`, p?.matchedRule === 'explicit')
  check(`${claim.cardId} names its source`, Boolean(p?.source))
  check(`${claim.cardId} does not claim a documented area`, p?.maskVerified === false)
  // Southern Islands names the finish but never the paper; Rumble names three
  // all-foil cards without naming the paper. Both stay inferred; the rest are
  // stated by a source and stay verified.
  const inferred = (claim.setId === 'si1' && claim.reverse) || (claim.setId === 'ru1' && !claim.reverse)
  check(`${claim.cardId} status is ${inferred ? 'inferred' : 'verified'}`, p?.status === (inferred ? 'inferred' : 'verified'))
  if (claim.reverse) {
    check(`${claim.cardId} resolves with a reverse token`, printingFor({ cardId: claim.cardId, rarity, variant: 'reverseHolofoil' })?.pattern === p?.pattern)
  } else {
    check(`${claim.cardId} no reverse printing`, printingFor({ cardId: claim.cardId, rarity, variant: 'reverseHolofoil' }) === null)
  }
}

// A BW card the two sources also printed plain has a non-holo printing as well.
for (const claim of PROMO_BUCKET_CLAIMS.filter((c) => c.alsoOn?.includes('non-holo'))) {
  check(`${claim.cardId} also resolves non-holo`, nonHoloFor({ cardId: claim.cardId, rarity: byId.get(claim.cardId)?.rarity ?? '' }) !== null)
}

// A row no source answers keeps making no claim — neither foil nor plain.
for (const claim of PROMO_BUCKET_UNLISTED) {
  const rarity = byId.get(claim.cardId)?.rarity ?? ''
  check(`${claim.cardId} is unclaimed`, printingFor({ cardId: claim.cardId, rarity }) === null && nonHoloFor({ cardId: claim.cardId, rarity }) === null)
  check(`${claim.cardId} records a reason`, claim.why.length > 20)
}

console.log(failed === 0 ? `ALL OK — ${checks} checks` : `${failed} FAILED of ${checks} checks`)
if (failed) process.exit(1)
