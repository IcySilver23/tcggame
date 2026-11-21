// One-off: emit src/foil/promo-buckets-db.ts from the per-card evidence gathered
// for the four promo buckets that were still unresolved.
//
//   node tmp/emit-promo-buckets.mjs
//
// BW Black Star Promos come from Pokumon's `promo_set=bw` card list read through
// its REST API (tmp/promo/rest/bw.json). The other three buckets are hand-entered
// below, each row carrying the source it came from: Southern Islands checklists,
// the Pokémon Rumble product copy plus two price catalogues, and Bulbapedia's
// Best of Game page.
import { readFileSync, writeFileSync } from 'node:fs'

const READ = '2026-11-06'

// ---------------------------------------------------------------------------
// BW Black Star Promos — 101 English rows, one treatment each
// ---------------------------------------------------------------------------

/** Pokumon's holofoil taxonomy class -> this build's treatment vocabulary. */
const TREATMENT_FROM_CLASS = {
  'holofoil-cosmos': 'cosmos',
  'holofoil-tinsel': 'tinsel',
  'holofoil-cracked-ice': 'cracked-ice',
  'holofoil-crosshatch': 'crosshatch',
  'holofoil-mirror': 'mirror',
  'holofoil-textured': 'textured',
  'holofoil-non-holo': 'non-holo',
  'holofoil-pokeball': 'pokeball-reverse',
}

/** Slugs that describe an extra printing of a card, not the card's own row. */
const VARIANT_PREFIX = /^(cracked-ice|non-holo|staff|tinsel-holofoil|top-thirty-two|top-sixteen|quarter-finalist|semi-finalist|finalist|champion|winner|jumbo)-/

const bwRows = JSON.parse(readFileSync('tmp/promo/rest/bw.json', 'utf8'))
const byNumber = new Map()
for (const card of bwRows) {
  const m = card.slug.match(/-bw(\d+)-english-promo$/)
  if (!m) continue
  const key = String(Number(m[1]))
  // `holofoil-reverse` is a finish flag, not a treatment: it says the paper is
  // applied around the art rather than on the window.
  const classes = card.classes.filter((c) => c.startsWith('holofoil-') && c !== 'holofoil-reverse')
  const entry = {
    slug: card.slug,
    base: !VARIANT_PREFIX.test(card.slug),
    treatments: classes.map((c) => TREATMENT_FROM_CLASS[c] ?? `?${c}`),
    reverse: card.classes.includes('holofoil-reverse'),
  }
  if (!byNumber.has(key)) byNumber.set(key, [])
  byNumber.get(key).push(entry)
}

const db = JSON.parse(readFileSync('tmp/promo/bucket-summary.json', 'utf8'))
const bwCards = db.rows.filter((r) => r.set_id === 'bwp')

const bw = []
const unlisted = []
let problems = 0
for (const row of bwCards) {
  const key = String(Number(row.number.replace(/^BW/i, '')))
  const entries = byNumber.get(key) ?? []
  const base = entries.find((e) => e.base)
  const variants = entries.filter((e) => !e.base)
  if (!base) {
    unlisted.push({
      cardId: row.id,
      setId: 'bwp',
      number: row.number,
      name: row.name,
      why: entries.length
        ? 'Pokumon lists only variant printings of this number, none of them the card’s own row.'
        : 'Pokumon does not list this promo, and Bulbapedia’s set page tags no variant for it, so there is no per-card evidence here.',
    })
    continue
  }
  // A Poké Ball reverse is one treatment, not a ball plus a flag: it names both
  // the paper and the fact that it is applied around the art.
  let treatment = null
  if (base.reverse && base.treatments.includes('pokeball-reverse')) {
    treatment = 'pokeball-reverse'
  } else {
    const primary = base.treatments.filter((t) => t !== 'pokeball-reverse')
    if (primary.length !== 1) {
      console.error(`BW${key}: expected one treatment on the base row, got`, base.treatments.join(','))
      problems++
      continue
    }
    treatment = primary[0]
  }
  if (treatment.startsWith('?')) {
    console.error(`BW${key}: unknown treatment`, treatment)
    problems++
    continue
  }
  const alsoOn = [...new Set(variants.flatMap((v) => v.treatments))].filter((t) => t !== treatment && !t.startsWith('?'))
  const claim = {
    cardId: row.id,
    setId: 'bwp',
    number: row.number,
    name: row.name,
    treatment,
  }
  if (base.reverse) claim.reverse = true
  if (alsoOn.length) claim.alsoOn = alsoOn
  bw.push(claim)
}
if (problems) {
  console.error(`${problems} BW rows could not be classified`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Southern Islands — six reverse holos, twelve normal
// ---------------------------------------------------------------------------
//
// Three independent checklists agree on the same six numbers (1, 4, 7, 11, 14,
// 17) and on the other twelve being plain, and the structure explains it: the
// eighteen cards are six three-card island scenes, and each scene pairs ONE
// holographic card with two plain ones. The finish is therefore verified per
// card; the PAPER is read from the Mew scan (a starry field with planets and
// speckle over the body, the art window matte), which no checklist names.
const SI_REVERSE = ['1', '4', '7', '11', '14', '17']
const siRows = db.rows.filter((r) => r.set_id === 'si1')
const si = siRows.map((row) => {
  const reverse = SI_REVERSE.includes(String(Number(row.number)))
  return {
    cardId: row.id,
    setId: 'si1',
    number: row.number,
    name: row.name,
    treatment: reverse ? 'cosmos' : 'non-holo',
    ...(reverse ? { reverse: true } : {}),
  }
})

// ---------------------------------------------------------------------------
// Pokémon Rumble — three all-foil cards, thirteen with a foil logo only
// ---------------------------------------------------------------------------
//
// The product copy is explicit: "16 exclusive Pokémon TCG cards with foil Rumble
// logos, including 3 all-foil cards." It does not name them; two price catalogues
// list exactly Venusaur 1, Pikachu 7 and Mewtwo 9 as the holo printings and every
// other card as Normal.
const RU_ALL_FOIL = ['1', '7', '9']
const ru = db.rows
  .filter((r) => r.set_id === 'ru1')
  .map((row) => {
    const allFoil = RU_ALL_FOIL.includes(String(Number(row.number)))
    return {
      cardId: row.id,
      setId: 'ru1',
      number: row.number,
      name: row.name,
      treatment: allFoil ? 'cosmos' : 'non-holo',
    }
  })

// ---------------------------------------------------------------------------
// Best of Game — five reverse holos, four plain
// ---------------------------------------------------------------------------
//
// Bulbapedia: "While these cards remained plain, the other cards received a
// special reverse-holographic treatment", naming Rocket's Scizor, Rocket's
// Sneasel, Dark Ivysaur and Dark Venusaur as the four new-to-English cards.
// Pokumon classifies the same five as Cosmos + reverse and the same four as
// non-holo, so the two sources agree card for card.
const BP_REVERSE = ['1', '2', '3', '8', '9']
const bp = db.rows
  .filter((r) => r.set_id === 'bp')
  .map((row) => {
    const reverse = BP_REVERSE.includes(String(Number(row.number)))
    return {
      cardId: row.id,
      setId: 'bp',
      number: row.number,
      name: row.name,
      treatment: reverse ? 'cosmos' : 'non-holo',
      ...(reverse ? { reverse: true } : {}),
    }
  })

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const fmt = (claims) =>
  claims
    .map((c) => {
      const extra =
        `, treatment: '${c.treatment}'` +
        (c.reverse ? ', reverse: true' : '') +
        (c.alsoOn ? `, alsoOn: [${c.alsoOn.map((t) => `'${t}'`).join(', ')}]` : '')
      return `  { cardId: '${c.cardId}', setId: '${c.setId}', number: '${c.number}', name: ${JSON.stringify(c.name)}${extra} },`
    })
    .join('\n')

const countBy = (claims) => {
  const out = {}
  for (const c of claims) out[c.treatment] = (out[c.treatment] ?? 0) + 1
  return out
}

const bwCounts = countBy(bw)
const summary = ['bwp', 'si1', 'ru1', 'bp'].map((setId) => {
  const claims = [...bw, ...si, ...ru, ...bp].filter((c) => c.setId === setId)
  const counts = countBy(claims)
  return `//   ${setId}: ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(' / ')} / unlisted ${unlisted.filter((u) => u.setId === setId).length}`
})

const out = `// GENERATED by tmp/emit-promo-buckets.mjs — do not hand-edit.
//
// The four promotional buckets that used to sit in UNRESOLVED_SETS, resolved
// card by card with the same evidence standard as the pre-2012 promo programmes:
// a claim needs a source that names the card's treatment, and a card no source
// answers makes NO claim rather than being swept into a bucket.
//
// Sources, per bucket:
//
//   bwp — BW Black Star Promos, 101 English rows. Pokumon's BW promo set, read
//         through its REST API on ${READ}, gives a holofoil taxonomy class per card.
//         Bulbapedia's set page independently tags the same variant printings —
//         Minccino/Scraggy/Luxio [Cosmos]+[Cracked Ice], Riolu [Cosmos]+[Non
//         Holo], Keldeo [Tinsel]+[Non Holo], Drifblim/Ninetales/Ampharos [Pixel /
//         Smooth Cosmos], Druddigon [Cosmos]+[Tinsel], N [Mirror]+[Non Holo] — so
//         every card either has two agreeing sources or is left unclaimed.
//         https://pokumon.com/promo_set/bw/
//
//   si1 — Southern Islands. Three checklists agree on the same six reverse-holo
//         numbers (1, 4, 7, 11, 14, 17) and twelve plain ones, and the product's
//         structure explains it: six three-card island scenes, each pairing ONE
//         holographic card with two plain ones. The finish is verified; the paper
//         is read from the Mew scan, not named by a checklist.
//         https://t206cards.com/checklists/southern-islands
//
//   ru1 — Pokémon Rumble. The product copy says "16 exclusive Pokémon TCG cards
//         with foil Rumble logos, including 3 all-foil cards." It does not name
//         them; two price catalogues list exactly Venusaur 1, Pikachu 7 and
//         Mewtwo 9 as the holo printings.
//         http://www.pokemonrumble.com/ (quoted at https://www.pocketmonsters.net/news/674)
//
//   bp  — Best of Game. Bulbapedia: "While these cards remained plain, the other
//         cards received a special reverse-holographic treatment", naming Rocket's
//         Scizor, Rocket's Sneasel, Dark Ivysaur and Dark Venusaur as the four new
//         cards. Pokumon classifies the same five as Cosmos + reverse and the same
//         four as non-holo, so the sources agree card for card.
//         https://bulbapedia.bulbagarden.net/wiki/Best_of_Game_(TCG)
//
// Counts:
${summary.join('\n')}
//
// A treatment names the foil; it does not claim a sheet this build has not drawn.
// The renderer resolves each treatment to a registry pattern, and treatments the
// registry carries as unimplemented fall back to plain foil rather than borrowing
// another paper.

export type PromoTreatment =
  | 'cosmos'
  | 'tinsel'
  | 'cracked-ice'
  | 'crosshatch'
  | 'mirror'
  | 'textured'
  | 'pokeball-reverse'
  | 'non-holo'

export type PromoBucketClaim = {
  cardId: string
  setId: string
  number: string
  /** Guards the table against a card id drifting to a different card. */
  name: string
  treatment: PromoTreatment
  /** True when the foil is a REVERSE finish: body and text box, art window matte. */
  reverse?: boolean
  /** The same card was also printed in another treatment. */
  alsoOn?: PromoTreatment[]
}

/** Every card of the four buckets that a source answers, one row each. */
export const PROMO_BUCKET_CLAIMS: readonly PromoBucketClaim[] = [
${fmt(bw)}
${fmt(si)}
${fmt(ru)}
${fmt(bp)}
]

/**
 * Rows no source answers. They keep making no claim, and the reason is what makes
 * that visible instead of silent.
 */
export const PROMO_BUCKET_UNLISTED: readonly (PromoBucketClaim & { why: string })[] = [
${unlisted
  .map(
    (c) =>
      `  { cardId: '${c.cardId}', setId: '${c.setId}', number: '${c.number}', name: ${JSON.stringify(c.name)}, treatment: 'non-holo', why: ${JSON.stringify(c.why)} },`,
  )
  .join('\n')}
]

/** What each bucket's claim rests on, for the report and the inspector. */
export const PROMO_BUCKET_SETS = {
  bwp: {
    name: 'BW Black Star Promos',
    source: 'https://pokumon.com/promo_set/bw/',
    corroboration: 'https://bulbapedia.bulbagarden.net/wiki/BW_Black_Star_Promos_(TCG)',
    note: 'One treatment per card from Pokumon\\u2019s holofoil taxonomy, corroborated where Bulbapedia tags the same variant printing. Pokumon does not date the retro-to-HD Cosmos switch per card, so every Cosmos claim here uses the retro sheet the programme opened on.',
  },
  si1: {
    name: 'Southern Islands',
    source: 'https://t206cards.com/checklists/southern-islands',
    corroboration: 'https://www.artofpkm.com/feature/southern-islands?lang=en',
    note: 'Six reverse holos and twelve plain cards, three independent checklists agreeing number for number. The FINISH is verified per card; the starry paper is read from the Mew scan and is not named by any checklist, so it is inferred.',
  },
  ru1: {
    name: 'Pokémon Rumble',
    source: 'https://www.pocketmonsters.net/news/674',
    corroboration: 'https://www.thepricedex.com/illustrator/pokemon-rumble',
    note: 'The product copy states three all-foil cards among sixteen; two price catalogues name the same three (Venusaur 1, Pikachu 7, Mewtwo 9) and list the rest as Normal. The paper those three carry is modelled as the era\\u2019s Cosmos.',
  },
  bp: {
    name: 'Best of Game',
    source: 'https://bulbapedia.bulbagarden.net/wiki/Best_of_Game_(TCG)',
    corroboration: 'https://pokumon.com/promo_set/best-of-game/',
    note: 'Bulbapedia states the reverse-holographic treatment and names the four cards that stayed plain; Pokumon classifies the same five as Cosmos + reverse and the same four as non-holo.',
  },
} as const

const CLAIM_BY_ID = new Map<string, PromoBucketClaim>()
for (const claim of PROMO_BUCKET_CLAIMS) CLAIM_BY_ID.set(claim.cardId, claim)
const UNLISTED_BY_ID = new Map(PROMO_BUCKET_UNLISTED.map((c) => [c.cardId, c]))

export function promoBucketClaimFor(cardId: string): PromoBucketClaim | null {
  return CLAIM_BY_ID.get(cardId) ?? null
}

/** True for a row the table deliberately leaves unclaimed, so the report can show it. */
export function promoBucketUnlisted(cardId: string) {
  return UNLISTED_BY_ID.get(cardId) ?? null
}
`

writeFileSync('src/foil/promo-buckets-db.ts', out)
console.log('wrote src/foil/promo-buckets-db.ts', out.length, 'bytes')
console.log('bwp', bw.length, JSON.stringify(bwCounts), 'unlisted', unlisted.length)
console.log('si1', si.length, JSON.stringify(countBy(si)))
console.log('ru1', ru.length, JSON.stringify(countBy(ru)))
console.log('bp', bp.length, JSON.stringify(countBy(bp)))
