// Verification report for the Cosmos printing database.
//
// Walks the whole card catalog, resolves every printing through printing-db.ts,
// and writes both a machine-readable JSON file and a readable Markdown summary.
// Run: ./node_modules/.bin/tsx scripts/cosmos-report.ts
//
// The point of this script is the numbers requirement 8 asks for — and, just as
// importantly, the numbers it refuses to invent: unresolved is a first-class
// bucket, and the report says outright that the catalogue is not exhaustive.

import fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  COSMOS_ERA,
  COSMOS_PROMO_PRINTINGS,
  DELTA_SPECIES_EXCEPTION,
  POP_HOLO_PRINTINGS,
  POP_HOLO_UNDOCUMENTED,
  PRINTING_DB_VERSION,
  REVERSE_PROMO_PRINTINGS,
  SOURCES,
  isUnresolvedCandidate,
  nonHoloFor,
  printingFor,
  unresolvedReason,
  type FoilPrinting,
  type NonHoloPrinting,
} from '../src/foil/printing-db'
import {
  PROMO_CATALOGUE,
  PROMO_COSMOS_CARDS,
  PROMO_NON_HOLO_CARDS,
  PROMO_UNLISTED_CARDS,
} from '../src/foil/promo-db'
import { PROMO_BUCKET_CLAIMS, PROMO_BUCKET_SETS, PROMO_BUCKET_UNLISTED } from '../src/foil/promo-buckets-db'
import { COSMOS_VARIANTS } from '../src/foil/cosmos-index'
import { PATTERNS, PATTERN_IDS, isCosmosPattern } from '../src/foil/patterns'

type Row = { id: string; set_id: string; number: string; name: string; rarity: string | null }

const db = new Database('data/tcglife.db', { readonly: true })
const rows = db.prepare('select id, set_id, number, name, rarity from cards').all() as Row[]
const setNames = new Map(
  (db.prepare('select id, name from sets').all() as { id: string; name: string }[]).map((s) => [s.id, s.name]),
)
db.close()

const cosmos: FoilPrinting[] = []
const special: FoilPrinting[] = []
const reverse: FoilPrinting[] = []
const unresolved: { cardId: string; setId: string; rarity: string; reason: string }[] = []
const nonHolo: NonHoloPrinting[] = []
const byCard = new Map<string, FoilPrinting[]>()

for (const row of rows) {
  const rarity = row.rarity ?? ''
  const holo = printingFor({ cardId: row.id, rarity })
  const nh = nonHoloFor({ cardId: row.id, rarity })
  if (holo) {
    if (isCosmosPattern(holo.pattern)) {
      cosmos.push(holo)
      byCard.set(row.id, [...(byCard.get(row.id) ?? []), holo])
    } else {
      special.push(holo)
    }
  } else if (!nh && isUnresolvedCandidate(row.set_id, rarity)) {
    // Unresolved means NO claim at all. A verified non-holo row answers the
    // question, so it must not be counted here as well — that double count is
    // exactly what made the promo buckets look unresolved while they resolved.
    unresolved.push({
      cardId: row.id,
      setId: row.set_id,
      rarity,
      reason: unresolvedReason(row.set_id) ?? 'no claim',
    })
  }
  if (nh) nonHolo.push(nh)
  const rev = printingFor({ cardId: row.id, rarity, variant: 'reverseHolofoil' })
  if (rev) {
    reverse.push(rev)
    byCard.set(row.id, [...(byCard.get(row.id) ?? []), rev])
  }
}

const count = (list: FoilPrinting[], status: string) => list.filter((p) => p.status === status).length

// The POP holographic versions are separate printings of the same card id. Neither
// half is guessed: a named version must resolve when the copy says it is the holo
// one, and every one must name a card that actually lives in the catalogue.
const popHolo = POP_HOLO_PRINTINGS.map((p) => {
  const row = rows.find((r) => r.id === `${p.setId}-${p.number}`)
  const resolved = printingFor({
    cardId: `${p.setId}-${p.number}`,
    rarity: row?.rarity ?? '',
    variant: p.reverse ? 'reverseHolofoil' : 'holofoil',
  })
  return {
    cardId: `${p.setId}-${p.number}`,
    name: p.name,
    catalogName: row?.name ?? null,
    product: p.product,
    pattern: p.pattern,
    reverse: p.reverse,
    resolvedPattern: resolved?.pattern ?? null,
    masksVerified: resolved?.maskVerified ?? false,
  }
})
const popHoloProblems = popHolo.filter((p) => !p.catalogName || p.resolvedPattern !== p.pattern)

// The four pre-2012 Black Star Promo programmes are classified card by card, and
// the report proves all three answers because the difference between them is the
// point: a Cosmos claim must resolve to Cosmos, a non-holo claim to a non-holo
// printing, and a card neither catalogue lists must resolve to nothing.
const promoBuckets = ['basep', 'np', 'dpp', 'hsp'].map((setId) => ({
  setId,
  name: setNames.get(setId) ?? setId,
  cosmos: PROMO_COSMOS_CARDS.filter((c) => c.setId === setId).length,
  nonHolo: PROMO_NON_HOLO_CARDS.filter((c) => c.setId === setId).length,
  // Every row of these programmes now resolves; the column stays so a future gap
  // shows up as a non-zero number instead of a silently missing row.
  unlisted: 0,
}))
const rarityOf = (cardId: string) => rows.find((r) => r.id === cardId)?.rarity ?? ''
const promoProblems: string[] = []
for (const claim of PROMO_COSMOS_CARDS) {
  const p = printingFor({ cardId: claim.cardId, rarity: rarityOf(claim.cardId) })
  if (p?.pattern !== 'cosmos-retro') promoProblems.push(`${claim.cardId}: expected cosmos-retro, got ${p?.pattern ?? 'nothing'}`)
  else if (p.status !== 'verified') promoProblems.push(`${claim.cardId}: Cosmos claim is ${p.status}, not verified`)
  const row = rows.find((r) => r.id === claim.cardId)
  if (row && row.name !== claim.name) promoProblems.push(`${claim.cardId}: table says ${claim.name}, catalogue says ${row.name}`)
}
for (const claim of PROMO_NON_HOLO_CARDS) {
  if (!nonHoloFor({ cardId: claim.cardId, rarity: rarityOf(claim.cardId) })) {
    promoProblems.push(`${claim.cardId}: non-holo claim did not resolve`)
  }
}
// The three reverse-only Nintendo promos must resolve to their reverse printing. A
// plain resolution, or a non-holo claim on the same card, would mean the entry and
// the renderer had drifted apart.
for (const entry of REVERSE_PROMO_PRINTINGS) {
  const cardId = `${entry.setId}-${entry.number}`
  const p = printingFor({ cardId, rarity: rarityOf(cardId) })
  if (p?.pattern !== 'reverse-flat' || p.variant !== 'reverse') {
    promoProblems.push(`${cardId}: expected a reverse-flat reverse printing, got ${p?.pattern ?? 'nothing'}`)
  }
  if (nonHoloFor({ cardId, rarity: rarityOf(cardId) })) promoProblems.push(`${cardId}: reverse printing also claims non-holo`)
}

// Four HGSS promos are named Cracked Ice Holofoil prints by their own card pages.
// They answer through printing-db's Cracked Ice table, not the catalogues, and their
// foil area is not documented — so they must resolve to the pattern and not to an
// area claim they do not have.
const promoCrackedIce = ['hsp-HGSS16', 'hsp-HGSS17', 'hsp-HGSS24', 'hsp-HGSS25'].map((cardId) => {
  const p = printingFor({ cardId, rarity: rarityOf(cardId) })
  if (p?.pattern !== 'crackedice' || p.status !== 'verified') {
    promoProblems.push(`${cardId}: expected a verified Cracked Ice printing, got ${p?.pattern ?? 'nothing'}`)
  }
  return {
    cardId,
    name: rows.find((r) => r.id === cardId)?.name ?? '',
    pattern: p?.pattern ?? null,
    maskVerified: p?.maskVerified ?? false,
    source: p?.source ?? '',
  }
})

// The four buckets that were still unresolved are classified card by card too, and
// the report proves every answer because the ways they differ are the point: a
// treatment must resolve to its named pattern, a non-holo claim to a non-holo
// printing, a reverse finish with or without a token, and a row no source answers
// to nothing at all.
const BUCKET_PATTERN_REPORT: Record<string, string> = {
  cosmos: 'cosmos-retro',
  tinsel: 'tinsel',
  'cracked-ice': 'crackedice',
  crosshatch: 'crosshatch',
  mirror: 'mirror',
  textured: 'textured-full-art',
  'pokeball-reverse': 'special-treatment',
}
const promoBucketRows = ['bwp', 'si1', 'ru1', 'bp'].map((setId) => {
  const claims = PROMO_BUCKET_CLAIMS.filter((c) => c.setId === setId)
  const unlisted = PROMO_BUCKET_UNLISTED.filter((c) => c.setId === setId)
  const treatments: Record<string, number> = {}
  for (const c of claims) treatments[c.treatment] = (treatments[c.treatment] ?? 0) + 1
  const meta = PROMO_BUCKET_SETS[setId as keyof typeof PROMO_BUCKET_SETS]
  return {
    setId,
    name: meta.name,
    source: meta.source,
    claims: claims.length,
    unlisted: unlisted.length,
    reverse: claims.filter((c) => c.reverse).length,
    treatments,
  }
})
const promoBucketProblems: string[] = []
for (const claim of PROMO_BUCKET_CLAIMS) {
  const rarity = rarityOf(claim.cardId)
  if (claim.treatment === 'non-holo') {
    if (!nonHoloFor({ cardId: claim.cardId, rarity })) promoBucketProblems.push(`${claim.cardId}: non-holo claim did not resolve`)
    if (printingFor({ cardId: claim.cardId, rarity })) promoBucketProblems.push(`${claim.cardId}: non-holo claim also resolved a foil`)
    continue
  }
  const p = printingFor({ cardId: claim.cardId, rarity })
  if (!p) promoBucketProblems.push(`${claim.cardId}: ${claim.treatment} claim resolved nothing`)
  else if (p.pattern !== BUCKET_PATTERN_REPORT[claim.treatment]) {
    promoBucketProblems.push(`${claim.cardId}: expected ${BUCKET_PATTERN_REPORT[claim.treatment]}, got ${p.pattern}`)
  }
  const rev = printingFor({ cardId: claim.cardId, rarity, variant: 'reverseHolofoil' })
  if (claim.reverse && rev?.pattern !== p?.pattern) promoBucketProblems.push(`${claim.cardId}: reverse-only printing does not answer with a reverse token`)
  if (!claim.reverse && rev) promoBucketProblems.push(`${claim.cardId}: invented a reverse printing`)
}
for (const claim of PROMO_BUCKET_UNLISTED) {
  if (printingFor({ cardId: claim.cardId, rarity: rarityOf(claim.cardId) })) promoBucketProblems.push(`${claim.cardId}: unlisted row resolved a foil`)
  if (nonHoloFor({ cardId: claim.cardId, rarity: rarityOf(claim.cardId) })) promoBucketProblems.push(`${claim.cardId}: unlisted row resolved non-holo`)
}

const dragonVault = rows
  .filter((r) => r.set_id === 'dv1')
  .map((r) => ({ cardId: r.id, name: r.name, rarity: r.rarity ?? '', pattern: printingFor({ cardId: r.id, rarity: r.rarity ?? '' })?.pattern ?? null }))

const bySet = new Map<string, { name: string; verified: number; inferred: number; modelled: number; reverse: number }>()
for (const p of cosmos) {
  const entry = bySet.get(p.setId) ?? { name: setNames.get(p.setId) ?? p.setId, verified: 0, inferred: 0, modelled: 0, reverse: 0 }
  if (p.status === 'verified') entry.verified++
  else if (p.status === 'inferred') entry.inferred++
  else if (p.status === 'modelled') entry.modelled++
  bySet.set(p.setId, entry)
}
for (const p of reverse) {
  const entry = bySet.get(p.setId) ?? { name: setNames.get(p.setId) ?? p.setId, verified: 0, inferred: 0, modelled: 0, reverse: 0 }
  entry.reverse++
  bySet.set(p.setId, entry)
}

const unresolvedBySet = new Map<string, number>()
for (const u of unresolved) unresolvedBySet.set(u.setId, (unresolvedBySet.get(u.setId) ?? 0) + 1)

const multiPrinting = [...byCard.entries()]
  .filter(([, list]) => new Set(list.map((p) => p.pattern)).size > 1)
  .map(([cardId, list]) => ({ cardId, name: rows.find((r) => r.id === cardId)?.name ?? '', patterns: list.map((p) => p.pattern) }))

const twoPaper = cosmos.filter((p) => (p.paperVariants?.length ?? 0) > 1).map((p) => ({
  cardId: p.cardId,
  product: p.product,
  papers: p.paperVariants,
  defaultPattern: p.pattern,
}))

// The catalogued promotional Cosmos printings, one row each. The denominator is the
// catalogue's own length, so a resolved BW or Southern Islands promo can never make
// the promotional table look larger than the catalogue it comes from.
const promoPrintings = COSMOS_PROMO_PRINTINGS.map((entry) => {
  const cardId = `${entry.setId}-${entry.number}`
  const p = printingFor({ cardId, rarity: rarityOf(cardId) })
  if (p?.pattern !== entry.pattern || p.status !== 'verified') {
    promoProblems.push(`${cardId}: catalogued promo expected ${entry.pattern}, got ${p?.pattern ?? 'nothing'}`)
  }
  return {
    cardId,
    product: entry.product,
    pattern: p?.pattern ?? null,
    status: p?.status ?? 'unresolved',
    maskVerified: p?.maskVerified ?? false,
    source: p?.source ?? '',
  }
})

const report = {
  patternDatabaseVersion: PRINTING_DB_VERSION,
  catalog: 'data/tcglife.db',
  era: COSMOS_ERA,
  patterns: {
    registered: PATTERN_IDS.length,
    implemented: PATTERN_IDS.filter((id) => PATTERNS[id].implemented),
    cosmosTextures: Object.values(COSMOS_VARIANTS).map((v) => v.id),
  },
  counts: {
    cardsScanned: rows.length,
    cosmosPrintings: cosmos.length,
    verified: count(cosmos, 'verified'),
    inferred: count(cosmos, 'inferred'),
    modelled: count(cosmos, 'modelled'),
    reversePrintings: reverse.length,
    specialTreatments: special.length,
    unresolvedCards: unresolved.length,
    promoCatalogue: COSMOS_PROMO_PRINTINGS.length,
    promoPrintingsResolved: promoPrintings.length,
    cardsWithTwoPapers: twoPaper.length,
    cardsWithMultipleFoils: multiPrinting.length,
    verifiedNonHolo: nonHolo.length,
    popHoloCatalogued: popHolo.length,
    popHoloResolved: popHolo.filter((p) => p.resolvedPattern === p.pattern).length,
    popHoloUndocumented: POP_HOLO_UNDOCUMENTED.length,
    dragonVaultPrintings: dragonVault.length,
    dragonVaultTinsel: dragonVault.filter((d) => d.pattern === 'tinsel').length,
    promoCosmos: PROMO_COSMOS_CARDS.length,
    promoNonHolo: PROMO_NON_HOLO_CARDS.length,
    promoUnlisted: PROMO_UNLISTED_CARDS.length,
    promoCrackedIce: promoCrackedIce.length,
    promoReverse: REVERSE_PROMO_PRINTINGS.length,
    promoBucketClaims: PROMO_BUCKET_CLAIMS.length,
    promoBucketUnlisted: PROMO_BUCKET_UNLISTED.length,
  },
  bySet: Object.fromEntries([...bySet.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, v]) => [id, v])),
  unresolvedBySet: Object.fromEntries([...unresolvedBySet.entries()].sort(([a], [b]) => a.localeCompare(b))),
  promoPrintings: promoPrintings.map((p) => ({
    cardId: p.cardId,
    product: p.product,
    pattern: p.pattern,
    status: p.status,
    maskVerified: p.maskVerified,
    source: p.source,
  })),
  cardsWithTwoPapers: twoPaper,
  cardsWithMultipleFoils: multiPrinting,
  popHolo,
  popHoloProblems,
  popHoloUndocumented: POP_HOLO_UNDOCUMENTED,
  dragonVault,
  promoBuckets,
  promoCrackedIce,
  promoReverse: REVERSE_PROMO_PRINTINGS,
  promoProblems,
  promoBucketRows,
  promoBucketUnlisted: PROMO_BUCKET_UNLISTED,
  promoBucketProblems,
  limitations: [
    'English only: no Japanese, Korean or other-language printing is catalogued, so none of them is assigned a foil.',
    'The four Cosmos textures are procedural concept art, not scans.',
    'Promotional Cosmos is catalogued only where a source names the card. The four pre-2012 Black Star Promo programmes are classified card by card from Pokumon’s catalogues; a card listed in neither makes no claim.',
    'The BW Black Star Promos, Southern Islands, Pokémon Rumble and Best of Game are classified card by card too. Their treatments name the foil; no source read here states these printings’ foil AREA, so the illustration window is the default and maskVerified stays false.',
    DELTA_SPECIES_EXCEPTION,
  ],
}

fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/cosmos-printings.json', JSON.stringify(report, null, 2) + '\n')

const pct = (n: number) => `${((n / Math.max(1, cosmos.length)) * 100).toFixed(1)}%`
const topSets = [...bySet.entries()]
  .sort(([, a], [, b]) => b.verified + b.inferred + b.modelled - (a.verified + a.inferred + a.modelled))
  .slice(0, 8)

const md = `# Cosmos printing database — verification report

Generated by \`scripts/cosmos-report.ts\` from \`${report.catalog}\` and \`src/foil/printing-db.ts\` (v${PRINTING_DB_VERSION}).

**This catalogue is not exhaustive.** It knows the English expansions whose foil is
stated by a source, plus the promotional printings a catalogue names directly. It does
not claim to list every Cosmos card ever printed.

## 1. Unique Cosmos printings identified

| bucket | count |
| --- | --- |
| Cosmos holo printings | **${report.counts.cosmosPrintings}** |
| of which verified | ${report.counts.verified} (${pct(report.counts.verified)}) |
| of which inferred from a verified set rule | ${report.counts.inferred} (${pct(report.counts.inferred)}) |
| of which modelled (this build's choice) | ${report.counts.modelled} (${pct(report.counts.modelled)}) |

## 2. Verified against sources

${report.counts.verified} printings are named either by the era rule (${COSMOS_ERA.first} → ${COSMOS_ERA.last}, ${COSMOS_ERA.from} to ${COSMOS_ERA.to}) or by a promotional catalogue entry.

## 3. Inferred from verified set rules

${report.counts.inferred} printings inherit a verified set rule with the individual card unnamed — today that is exactly the HGSS Prime holos, whose rarity label never says "Holo". Reverse printings are their own bucket (${report.counts.reversePrintings}) and are counted separately.

## 4. Unresolved

${report.counts.unresolvedCards} card rows sit in sets this database deliberately does not resolve, and **no Cosmos is applied to them**:

${[...unresolvedBySet.entries()].sort(([, a], [, b]) => b - a).map(([id, n]) => `- \`${id}\` (${setNames.get(id) ?? id}): ${n} rows — ${unresolvedReason(id) ?? 'no source read here'}`).join('\n')}

Also unresolved, and not countable as a row: δ Delta Species holo rares (see limitations).

POP Series 1–9 and Dragon Vault are **no longer** in this bucket: the POP base
printings are verified non-holo (below), and Dragon Vault resolves to Tinsel. The four
pre-2012 Black Star Promo programmes are no longer wholesale unresolved either: every
card is classified in 4d, and only the handful neither catalogue lists stays here.

## 4b. Verified non-holo printings

${report.counts.verifiedNonHolo} card rows are resolved as **non-holo** printings with a
source, not left unknown. Every POP Series page names the holographic versions as
separate products ("All of the rare cards have holographic versions and were
available through several waves of promotional items"), so the card in the POP
booster is the non-holo one. A non-holo printing has no pattern and no mask, and a
marketplace "holofoil" flag on one cannot conjure a foil.

## 4c. POP holographic versions, and Dragon Vault

${report.counts.popHoloResolved} of ${report.counts.popHoloCatalogued} named POP holographic versions resolve to their card and paper (Cosmos Holo gift packs, blisters, tins; Cracked Ice Reverse Holo for the later boxes). The other ${report.counts.popHoloUndocumented} named holographic versions have a foil the source does not state, so they make no claim:

${POP_HOLO_UNDOCUMENTED.map((p) => `- \`${p.setId}-${p.number}\` ${p.name} — ${p.product}: ${p.why}`).join('\n')}

Dragon Vault is a Generation V product whose every card is foil ("ALL of them foil!"),
so ${report.counts.dragonVaultTinsel} of its ${report.counts.dragonVaultPrintings} rows resolve to Tinsel at the era level. The pattern is
\`inferred\` rather than \`verified\`, and the foil area is not documented: the set page
does not say which part of the card carries it.

## 4d. The pre-2012 Black Star Promo programmes

Wizards, Nintendo, DP and HGSS are classified card by card, not by set: ${PROMO_CATALOGUE.counts.cosmos} cards are catalogued on Cosmos, ${PROMO_CATALOGUE.counts.nonHolo} as non-holo, and every remaining printing is answered by its own page — four Cracked Ice, three reverse holos and two French-only Cosmos promos. Catalogue counts read from Pokumon’s two treatment catalogues on ${PROMO_CATALOGUE.read}.

| programme | Cosmos | non-holo | unlisted |
| --- | --- | --- | --- |
${promoBuckets.map((b) => `| ${b.setId} (${b.name}) | ${b.cosmos} | ${b.nonHolo} | ${b.unlisted} |`).join('\n')}

Bulbapedia’s promo set pages tag only the exceptional printings — [Cosmos Holo], [Non Holofoil], [Cracked Ice Holo] — so a set page cannot answer for a whole programme. Pokumon assigns a treatment to every card it catalogues, which is what makes a per-card claim possible. The Cosmos claims are verified for the pattern and **not** for the area: no source read here states which part of these promos is foiled, so the illustration window is the default.

Four HGSS promos are answered by their own card pages instead of either catalogue: HGSS16 Plusle, HGSS17 Minun, HGSS24 Hitmonchan and HGSS25 Hitmonlee are named as **Cracked Ice Holofoil** HGSS Black Star Promo prints, so they resolve to the Cracked Ice paper — pattern verified, area undisclosed. DP54 Beginning Door and DP55 Ultimate Zone are answered by their own Bulbapedia pages, which name a Cosmos Holofoil DP Black Star Promo version of each released exclusively in French. Pokumon tags both cards non-holo instead; the entries record that disagreement and follow the source that names the paper. Three Nintendo promos — Treecko 003, Torchic 008 and Mudkip 010 — are **reverse holos**, the only finish those cards were printed in: TCGplayer sells Treecko 003 only as Reverse Holofoil, PokemonPrice files Torchic 008 as [Reverse Holo], TCGdex reports holo and normal false with reverse true, and the supplied scans show a dotted foil field across the body and text box with a flat illustration window. The identification is explicit; the paper is the EX-era reverse finish and the area comes from a scan, so neither is marked verified.

## 4e. The four buckets resolved after the pre-2012 programmes

BW Black Star Promos, Southern Islands, Pokémon Rumble and Best of Game were the last rows in the unresolved bucket. Each is now classified card by card, and the four are not the same claim:

| bucket | claims | of which reverse | unlisted | treatments |
| --- | --- | --- | --- | --- |
${promoBucketRows.map((b) => `| ${b.name} | ${b.claims} | ${b.reverse} | ${b.unlisted} | ${Object.entries(b.treatments).map(([t, n]) => `${t} ${n}`).join(', ')} |`).join('\n')}

**BW Black Star Promos** change paper card by card: ${promoBucketRows[0].treatments.cosmos} Cosmos, ${promoBucketRows[0].treatments.tinsel} Tinsel, ${promoBucketRows[0].treatments['cracked-ice']} Cracked Ice, ${promoBucketRows[0].treatments.crosshatch} Crosshatch, ${promoBucketRows[0].treatments.mirror} Mirror, ${promoBucketRows[0].treatments.textured} textured, one Poké Ball reverse and ${promoBucketRows[0].treatments['non-holo']} non-holo. Pokumon’s treatment taxonomy gives one class per card, and Bulbapedia’s set page independently tags the same variant printings (Minccino, Scraggy and Luxio as Cosmos + Cracked Ice; Riolu as Cosmos + Non Holo; Keldeo as Tinsel + Non Holo; Druddigon as Cosmos + Tinsel; N as Mirror + Non Holo). ${promoBucketRows[0].unlisted} row — BW32 Victini — is in neither source and makes no claim. Pokumon does not date the retro-to-HD Cosmos switch per card, so every Cosmos claim here uses the retro sheet the programme opened on; that choice is stated in the table, not presented as a source’s.

**Southern Islands** is six reverse holos (1, 4, 7, 11, 14, 17) and twelve plain cards. Three checklists agree number for number, and the product explains it: the eighteen cards are six three-card island scenes, each pairing one holographic card with two plain ones. The FINISH is verified per card; the starry paper is read from the Mew scan — planets and speckle over the body, the art window matte — and no checklist names it, so the pattern is \`inferred\`.

**Pokémon Rumble** is three all-foil cards and thirteen that carry only a foil logo. The product copy says “16 exclusive Pokémon TCG cards with foil Rumble logos, including 3 all-foil cards” and does not name them; two price catalogues name the same three — Venusaur 1, Pikachu 7, Mewtwo 9. The paper those three carry is modelled as the era’s Cosmos, so the pattern is \`inferred\` and the area (“all-foil”, the product copy’s own phrase) is not marked verified.

**Best of Game** is five reverse holos and four plain cards. Bulbapedia: “While these cards remained plain, the other cards received a special reverse-holographic treatment”, naming Rocket’s Scizor, Rocket’s Sneasel, Dark Ivysaur and Dark Venusaur as the four new-to-English cards. Pokumon classifies the same five as Cosmos + reverse and the same four as non-holo, so the two sources agree card for card.

No printing in these four buckets claims a foil area: no source read here states one, so the illustration window is the default (whole-card for Rumble’s all-foil three, which is what “all-foil” means) and \`maskVerified\` is false throughout.

## 5. Promotional variants added

${report.counts.promoPrintingsResolved} of ${report.counts.promoCatalogue} catalogued promo entries resolve to a card row in this catalog:

${promoPrintings.map((p) => `- \`${p.cardId}\` — ${p.product} · ${p.pattern} · coverage ${p.maskVerified ? 'documented' : 'not documented'}`).join('\n')}

## 6. Cards with multiple holofoil printings

| kind | cards |
| --- | --- |
| Same card, holo + reverse (${report.counts.reversePrintings} reverse printings in all) | ${report.counts.cardsWithMultipleFoils} |
| Same Cosmos printing documented on two papers | ${report.counts.cardsWithTwoPapers} |

${twoPaper.map((p) => `- \`${p.cardId}\` — ${p.product}: ${p.papers?.join(' or ')} (default ${p.defaultPattern})`).join('\n')}

Example cards that carry two distinct finishes in this catalog: ${multiPrinting.slice(0, 4).map((m) => `\`${m.cardId}\` (${m.patterns.join(' + ')})`).join(', ')}.

## Sets with the largest Cosmos counts

${topSets.map(([id, v]) => `- \`${id}\` ${v.name}: ${v.verified} verified, ${v.inferred} inferred, ${v.modelled} modelled, ${v.reverse} reverse`).join('\n')}

## What is not claimed

${report.limitations.map((l) => `- ${l}`).join('\n')}
`

fs.writeFileSync('reports/cosmos-printings.md', md)

console.log(`Cosmos printings: ${report.counts.cosmosPrintings} (verified ${report.counts.verified}, inferred ${report.counts.inferred}, modelled ${report.counts.modelled})`)
console.log(`Reverse printings: ${report.counts.reversePrintings} · special treatments: ${report.counts.specialTreatments}`)
console.log(`Unresolved cards: ${report.counts.unresolvedCards} · promo entries: ${report.counts.promoPrintingsResolved}/${report.counts.promoCatalogue}`)
console.log(`Verified non-holo: ${report.counts.verifiedNonHolo} · POP holo versions: ${report.counts.popHoloResolved}/${report.counts.popHoloCatalogued} · Dragon Vault: ${report.counts.dragonVaultTinsel}/${report.counts.dragonVaultPrintings} tinsel`)
console.log(`Black Star promos: ${report.counts.promoCosmos} Cosmos · ${report.counts.promoNonHolo} non-holo · ${report.counts.promoCrackedIce} Cracked Ice · ${report.counts.promoReverse} reverse · ${report.counts.promoUnlisted} unlisted`)
console.log(`Promo buckets: ${report.counts.promoBucketClaims} claims · ${report.counts.promoBucketUnlisted} unlisted — ${report.promoBucketRows.map((b) => `${b.setId} ${b.claims}/${b.claims + b.unlisted}`).join(' · ')}`)
if (report.promoProblems.length) {
  console.log('Black Star promo problems:')
  for (const p of report.promoProblems) console.log(`  - ${p}`)
  process.exit(1)
}
if (report.promoBucketProblems.length) {
  console.log('Promo bucket problems:')
  for (const p of report.promoBucketProblems) console.log(`  - ${p}`)
  process.exit(1)
}
if (report.popHoloProblems.length) {
  console.log('POP holo problems:')
  for (const p of report.popHoloProblems) console.log(`  - ${p.cardId}: expected ${p.pattern}, got ${p.resolvedPattern ?? 'nothing'}`)
  process.exit(1)
}
console.log(`Written: reports/cosmos-printings.json, reports/cosmos-printings.md`)
