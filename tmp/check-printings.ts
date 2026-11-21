// Printing-database assertions.
//
// This suite is about the DB's JOB: deciding which physical printing a card is,
// refusing to guess, and letting an explicit entry outrank a set rule. The foil
// rendering itself is still covered by check-cosmos.ts.
//
// Run: ./node_modules/.bin/tsx tmp/check-printings.ts

import Database from 'better-sqlite3'
import {
  CATALOGUED_LANGUAGES,
  COSMOS_PROMO_PRINTINGS,
  COSMOS_TEXTURE_FOR,
  DELTA_SPECIES_EXCEPTION,
  isUnresolvedCandidate,
  printingFor,
  reversePaperFor,
  unresolvedReason,
} from '../src/foil/printing-db'
import { PATTERNS, PATTERN_IDS, isCosmosPattern, patternLabel } from '../src/foil/patterns'
import { holoFor } from '../src/holo'
import { coverageFraction, foilMaskFor, maskValue } from '../src/foil/mask'
import { cosmosCoverage } from '../src/foil/cosmos-masks'
import { reverseConfigFor } from '../src/foil/reverse-db'

let total = 0
const fails: string[] = []
function ok(cond: boolean, label: string, detail?: string) {
  total++
  if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

// ---------------------------------------------------------------------------
// 1. The era rule, and where it stops
// ---------------------------------------------------------------------------
{
  const base4 = printingFor({ cardId: 'base4-4', rarity: 'Rare Holo' })
  ok(!!base4, 'Base Set 2 Holo resolves')
  ok(base4?.pattern === 'cosmos-retro', 'the era paper is the retro sheet', base4?.pattern)
  ok(base4?.status === 'verified', 'the era rule is verified, not modelled', base4?.status)
  ok(base4?.mask === 'art' && base4?.maskVerified === true, 'a holo rare foils the verified art window')
  ok(base4?.paper === 'classic_dense', 'the retro pattern maps to the dense texture', base4?.paper)
  ok(base4?.language === 'en', 'the printing records its language')
  ok(base4?.product === 'expansion booster', 'the printing records the product', base4?.product)
  ok(base4?.printingId === 'base4-4:en:holo', 'the printing id names card, language and variant', base4?.printingId)

  ok(printingFor({ cardId: 'base6-1', rarity: 'Rare Holo' })?.pattern === 'cosmos-retro',
    'Legendary Collection sits inside the same run')
  ok(printingFor({ cardId: 'hgss1-1', rarity: 'Rare Holo' })?.pattern === 'cosmos-retro',
    'HGSS uses the same retro paper — the dense/sparse split was an assumption')
  ok(printingFor({ cardId: 'col1-1', rarity: 'Rare Holo' })?.pattern === 'cosmos-retro',
    'Call of Legends is the last set on the retro paper')

  ok(printingFor({ cardId: 'base4-4', rarity: 'Common' }) === null, 'a common is not a Cosmos printing')
  ok(printingFor({ cardId: 'base4-4', rarity: 'Rare' }) === null, 'a plain Rare is not holofoil')
  const starlight = printingFor({ cardId: 'base1-4', rarity: 'Rare Holo' })
  ok(starlight?.pattern === 'starlight', 'Base Set holos are IDENTIFIED as Starlight, not Cosmos', starlight?.pattern)
  ok(starlight?.mask === 'art' && starlight?.maskVerified === true, 'with the verified illustration-window mask')
  ok(starlight?.status === 'verified', 'the identification carries a source', starlight?.status)
  ok(printingFor({ cardId: 'base2-1', rarity: 'Rare Holo' })?.pattern === 'starlight', 'Jungle is Starlight too')
  ok(printingFor({ cardId: 'base3-1', rarity: 'Rare Holo' })?.pattern === 'starlight', 'and Fossil')
  ok(printingFor({ cardId: 'base1-1', rarity: 'Common' }) === null, 'a Base Set common is not foil')
  ok(PATTERNS.starlight.implemented === true && PATTERNS.starlight.texture === '/foil/starlight/sheet.png',
    'the Starlight sheet ships and the registry points at it', PATTERNS.starlight.texture)
  const tinselEra = printingFor({ cardId: 'bw1-1', rarity: 'Rare Holo' })
  ok(tinselEra?.pattern === 'tinsel' && !isCosmosPattern(tinselEra?.pattern),
    'Black & White is after the era — Tinsel, never Cosmos', tinselEra?.pattern)
}

// ---------------------------------------------------------------------------
// 2. Special treatments are not Cosmos by default
// ---------------------------------------------------------------------------
{
  const legend = printingFor({ cardId: 'hgss1-LEGEND', rarity: 'LEGEND' })
  ok(legend?.mask === 'full' && legend?.maskVerified === true, 'LEGEND is foiled edge to edge, verified')

  const ex = printingFor({ cardId: 'ex1-1', rarity: 'Rare Holo EX' })
  ok(ex?.pattern === 'cosmos-retro' && ex?.mask === 'art-border', 'Pokémon-ex foils art AND border', `${ex?.pattern}/${ex?.mask}`)
  ok(ex?.maskVerified === true, 'the ex coverage is documented')

  const lvx = printingFor({ cardId: 'dp1-1', rarity: 'Rare Holo LV.X' })
  ok(lvx?.pattern === 'special-treatment', 'LV.X is a special treatment, not the era paper', lvx?.pattern)
  ok(lvx?.status === 'unresolved', 'and it is honestly unresolved', lvx?.status)
  ok(!isCosmosPattern(lvx?.pattern), 'no Cosmos textures are claimed for LV.X')

  const star = printingFor({ cardId: 'ex7-107', rarity: 'Rare Holo Star' })
  ok(star?.pattern === 'special-treatment', 'Gold Star is not the era paper either', star?.pattern)

  const prime = printingFor({ cardId: 'hgss1-1', rarity: 'Rare Prime' })
  ok(prime?.pattern === 'cosmos-retro' && prime?.status === 'inferred',
    'HGSS Prime inherits the era rule and is marked inferred', `${prime?.pattern}/${prime?.status}`)
}

// ---------------------------------------------------------------------------
// 3. Reverse printings get their set's reverse paper, never Cosmos
// ---------------------------------------------------------------------------
{
  ok(reversePaperFor('base4') === null, 'Base Set 2 had no reverse holos at all')
  ok(holoFor({ cardId: 'base4-4', rarity: 'Rare Holo', variant: 'reverseHolofoil' }) === null,
    'a reverse flag cannot invent a Base Set 2 reverse printing')
  ok(foilMaskFor({ cardId: 'base4-4', rarity: 'Rare Holo', variant: 'reverseHolofoil' }) === null,
    'and no mask is produced for it')

  const rev = printingFor({ cardId: 'base6-1', rarity: 'Rare Holo', variant: 'reverseHolofoil' })
  ok(rev?.pattern === 'reverse-fireworks', 'Legendary Collection reverse is the fireworks paper', rev?.pattern)
  ok(rev?.mask === 'outside-art' && rev?.maskVerified === true, 'reverse geometry is documented')
  ok(!isCosmosPattern(rev?.pattern), 'a reverse printing is not a Cosmos printing')
  ok(rev?.status === 'inferred', 'the individual reverse printing is inferred from the set rule')

  ok(reversePaperFor('ex11') === 'reverse-flat-background', 'EX Delta Species reverse sits inside the artwork')
  ok(reversePaperFor('dp1') === 'reverse-flat', 'Diamond & Pearl returns to the flat reverse paper')
  ok(reversePaperFor('hgss1') === 'reverse-flat', 'HGSS keeps the flat reverse paper')
  ok(reversePaperFor('base1') === null, 'a set with no reverse printings makes no reverse claim')

  ok(printingFor({ cardId: 'hgss1-1', rarity: 'LEGEND', variant: 'reverseHolofoil' }) === null,
    'ultra rares never received a reverse counterpart')
  ok(printingFor({ cardId: 'hgss1-1', rarity: 'Rare Secret', variant: 'reverseHolofoil' }) === null,
    'secret rares never received a reverse counterpart')

  const spec = foilMaskFor({ cardId: 'base6-1', rarity: 'Rare Holo', variant: 'reverseHolofoil' })
  ok(spec?.kind === 'outsideArt', 'the reverse mask covers everything but the window', spec?.kind)
  ok(maskValue(spec!, 0.5, 0.3) === 0, 'reverse: the art has no foil')
  ok(maskValue(spec!, 0.5, 0.95) === 255, 'reverse: the text panel has foil')
  ok(coverageFraction(spec!) > 0.5, 'reverse covers most of the card', String(coverageFraction(spec!)))
}

// ---------------------------------------------------------------------------
// 4. Promotional printings: named, not guessed
// ---------------------------------------------------------------------------
{
  const pika = printingFor({ cardId: 'basep-24', rarity: 'Promo' })
  ok(pika?.pattern === 'cosmos-retro', 'a catalogued WotC promo resolves to Cosmos', pika?.pattern)
  ok(pika?.status === 'verified', 'the promo is verified by the catalogue', pika?.status)
  ok(pika?.mask === 'art' && pika?.maskVerified === false,
    'its foil AREA is not documented, so coverage stays unverified')

  // BW32 Victini is the one BW promo neither source lists, so it is the row that
  // proves the table does not blanket-assign a treatment to a programme.
  ok(printingFor({ cardId: 'bwp-BW32', rarity: 'Promo' }) === null,
    'a promo no source lists is not blanket-assigned')
  ok(printingFor({ cardId: 'pop1-1', rarity: 'Rare' }) === null, 'POP Series is not blanket-assigned')
  const vault = printingFor({ cardId: 'dv1-1', rarity: 'Rare Holo' })
  ok(vault?.pattern === 'tinsel' && vault.status === 'inferred',
    'Dragon Vault is Tinsel from the era rule, marked inferred', vault?.pattern)
  ok(!!unresolvedReason('basep') && !!unresolvedReason('bwp'), 'those sets carry a stated reason')
  ok(isUnresolvedCandidate('np', 'Promo'), 'the report can count them as unresolved')

  const arceus = printingFor({ cardId: 'dpp-DP53', rarity: 'Rare Holo LV.X' })
  ok(arceus?.pattern === 'cosmos-retro', 'an explicit promo entry outranks the LV.X default', arceus?.pattern)
  ok(arceus?.status === 'verified', 'and it keeps its own evidence', arceus?.status)

  const alcremie = printingFor({ cardId: 'swshp-SWSH058', rarity: 'Promo' })
  ok(alcremie?.pattern === 'cosmos-hd', 'a post-2013 promo uses the HD paper', alcremie?.pattern)

  for (const id of ['svp-46', 'svp-47', 'svp-48']) {
    const p = printingFor({ cardId: id, rarity: 'Promo' })
    ok(p?.paperVariants?.length === 2, `${id}: documented on both Cosmos papers`, String(p?.paperVariants))
    ok(p?.pattern === 'cosmos-hd', `${id}: HD is the default paper`, p?.pattern)
  }

  // The catalogue must not drift onto a different card.
  const db = new Database('data/tcglife.db', { readonly: true })
  for (const entry of COSMOS_PROMO_PRINTINGS) {
    const row = db.prepare('select name from cards where id = ?').get(`${entry.setId}-${entry.number}`) as
      | { name: string } | undefined
    ok(row?.name === entry.name, `catalogue entry ${entry.setId}-${entry.number} still names ${entry.name}`, row?.name)
  }
  db.close()
}

// ---------------------------------------------------------------------------
// 5. Modelled, unresolved, and other languages
// ---------------------------------------------------------------------------
{
  const me = printingFor({ cardId: 'me55c-4', rarity: 'Rare Holo' })
  ok(me?.pattern === 'confetti', 'the Classic Collection reprint set wears its named confetti paper', me?.pattern)
  ok(me?.status === 'verified', 'on a source, not on a guess', me?.status)
  ok(me?.matchedRule === 'expansion', 'as a set rule in the record', me?.matchedRule)
  ok(me?.maskVerified === false, 'its foil area is not verified')

  const jp = printingFor({ cardId: 'base4-4', rarity: 'Rare Holo', language: 'ja' })
  ok(jp === null, 'a Japanese printing makes no claim from the English catalogue')
  ok(CATALOGUED_LANGUAGES.length === 1 && CATALOGUED_LANGUAGES[0] === 'en', 'only English is catalogued')

  ok(!isUnresolvedCandidate('base4', 'Common'), 'a non-foil common is not an unresolved Cosmos row')
  ok(DELTA_SPECIES_EXCEPTION.includes('Delta'), 'the undetectable δ exception is published, not hidden')
}

// ---------------------------------------------------------------------------
// 5b. The same card name, four different printings
// ---------------------------------------------------------------------------

// The brief's example: Legendary Treasures Charizard 19/113 is Tinsel, and a
// separate Cosmos promotional printing of a Charizard is a different printing —
// in this catalog the 30th-anniversary reprint. Both must stay distinguishable,
// and so must the reverse and non-holo versions.
{
  const tinsel = printingFor({ cardId: 'bw11-19', rarity: 'Rare Holo' })
  ok(tinsel?.pattern === 'tinsel' && !isCosmosPattern(tinsel?.pattern),
    'a Legendary Treasures holo makes no Cosmos claim', tinsel?.pattern)
  const tinselArt = holoFor({ cardId: 'bw11-19', rarity: 'Rare Holo' })
  ok(tinselArt?.style === 'tinsel' && !isCosmosPattern(tinselArt?.pattern),
    'and it still renders as its own Tinsel printing', `${tinselArt?.style}/${tinselArt?.pattern}`)
  const reprint = holoFor({ cardId: 'me55c-4', rarity: 'Rare Holo' })
  ok(reprint?.pattern === 'confetti', 'the confetti Charizard reprint is a different printing', reprint?.pattern)
  ok(reprint?.pattern !== tinselArt?.pattern, 'the two Charizards do not share a foil')
  const rev = holoFor({ cardId: 'base6-1', rarity: 'Rare Holo', variant: 'reverseHolofoil' })
  ok(rev?.reverse === true && !isCosmosPattern(rev?.pattern), 'a reverse Charizard is distinguishable from the holo')
  ok(holoFor({ cardId: 'base6-58', rarity: 'Common' }) === null, 'a non-holo Charizard is distinguishable by having no foil')
}

// ---------------------------------------------------------------------------
// 6. Pattern registry and coverage agreement
// ---------------------------------------------------------------------------
{
  for (const id of PATTERN_IDS) {
    ok(PATTERNS[id].id === id, `registry key matches ${id}`)
    ok(patternLabel(id).length > 0, `${id} has a label`)
    ok(PATTERNS[id].note.length > 0, `${id} explains itself`)
    ok(PATTERNS[id].source.startsWith('https://'), `${id} cites a source`)
  }
  ok(PATTERN_IDS.length >= 20, 'the registry covers the patterns the brief lists', String(PATTERN_IDS.length))
  ok(PATTERNS['cosmos-retro'].implemented && PATTERNS['cosmos-hd'].implemented, 'both Cosmos papers are implemented')
  ok(PATTERNS.radiant.implemented, 'Radiant is implemented')
  for (const id of ['tinsel', 'sheen', 'waterweb', 'line', 'mirage', 'crackedice', 'crosshatch', 'confetti'] as const) {
    ok(PATTERN_IDS.includes(id), `registry names ${id}`)
  }
  ok(COSMOS_TEXTURE_FOR['cosmos-retro'] === 'classic_dense', 'retro pattern → dense texture')
  ok(COSMOS_TEXTURE_FOR['cosmos-hd'] === 'modern_fine', 'HD pattern → modern texture')

  // The Cosmos-only view must agree with the database, not re-derive it.
  const cov = cosmosCoverage({ cardId: 'base4-4', rarity: 'Rare Holo' })
  ok(cov?.kind === 'art' && cov?.verified === true, 'cosmosCoverage agrees with the database')
  ok(cosmosCoverage({ cardId: 'base4-4', rarity: 'Rare Holo', variant: 'reverseHolofoil' }) === null,
    'cosmosCoverage makes no claim about a reverse printing')
  ok(cosmosCoverage({ cardId: 'base1-4', rarity: 'Rare Holo' }) === null, 'cosmosCoverage makes no claim about Base Set')

  // holoFor hands the overlay the pattern it needs to choose a texture.
  const art = holoFor({ cardId: 'base4-4', rarity: 'Rare Holo' })
  ok(art?.style === 'cosmos' && art?.pattern === 'cosmos-retro', 'holoFor carries the pattern', `${art?.style}/${art?.pattern}`)
  const revArt = holoFor({ cardId: 'base6-1', rarity: 'Rare Holo', variant: 'reverseHolofoil' })
  ok(revArt?.reverse === true && !isCosmosPattern(revArt?.pattern),
    'a reverse Cosmos-era card carries a reverse pattern, not Cosmos', String(revArt?.pattern))
}

// ---------------------------------------------------------------------------
// 7. Schema and rule provenance (Phase 2)
// ---------------------------------------------------------------------------
// The hierarchy has to be visible in the DATA, not just in the order of the code:
// a printing says which rule answered, so a later phase cannot quietly change
// precedence without a test noticing.
{
  const holo = printingFor({ cardId: 'base4-4', rarity: 'Rare Holo' })!
  ok(holo.matchedRule === 'era', 'an era holo records the era rule', holo.matchedRule)
  ok(holo.surfaceTexture === null, 'no printing claims a normal map yet')
  ok(holo.name === undefined, 'a printing with no supplied name does not invent one')
  ok(holo.year === undefined, 'and an unknown release year stays unknown')

  const named = printingFor({ cardId: 'base4-4', rarity: 'Rare Holo', name: 'Charizard' })!
  ok(named.name === 'Charizard', 'a supplied card name is carried on the printing')
  ok(named.printingId === holo.printingId, 'and the name does not change the printing id')

  const promo = printingFor({ cardId: 'basep-24', rarity: 'Promo' })!
  ok(promo.variant === 'promo', 'a promotional printing has its own variant', promo.variant)
  ok(promo.printingId.endsWith(':promo'), 'and its printing id says so', promo.printingId)
  ok(promo.matchedRule === 'explicit', 'named promos are explicit overrides', promo.matchedRule)

  const rev = printingFor({ cardId: 'base6-1', rarity: 'Rare Holo', variant: 'reverseHolofoil' })!
  ok(rev.matchedRule === 'expansion', 'a reverse paper comes from the expansion rule', rev.matchedRule)
  ok(rev.year === reverseConfigFor('base6')?.year && typeof rev.year === 'number',
    'its release year comes from the expansion catalogue', String(rev.year))
  ok(rev.surfaceTexture === null, 'a reverse printing has no normal map either')

  const lvx = printingFor({ cardId: 'dp1-1', rarity: 'Rare Holo LV.X' })!
  ok(lvx.matchedRule === 'unresolved', 'an unknown treatment records the unresolved fallback', lvx.matchedRule)
  ok(lvx.status === 'unresolved' && lvx.surfaceTexture === null, 'and claims nothing it cannot support')

  const classic = printingFor({ cardId: 'me55c-4', rarity: 'Rare Holo' })!
  ok(classic.matchedRule === 'expansion', 'a set rule says so in the record', classic.matchedRule)

  const star = printingFor({ cardId: 'base1-4', rarity: 'Rare Holo' })!
  ok(star.matchedRule === 'era', 'Starlight is an era-level identification', star.matchedRule)
  ok(star.year === undefined, 'Base Set year is not fabricated from a range')

  // Every resolved printing must name a rule; a missing one would mean a path was
  // added without deciding its precedence.
  const probes: Parameters<typeof printingFor>[0][] = [
    { cardId: 'base4-4', rarity: 'Rare Holo' },
    { cardId: 'base1-4', rarity: 'Rare Holo' },
    { cardId: 'basep-24', rarity: 'Promo' },
    { cardId: 'base6-1', rarity: 'Rare Holo', variant: 'reverseHolofoil' },
    { cardId: 'dp1-1', rarity: 'Rare Holo LV.X' },
    { cardId: 'me55c-4', rarity: 'Rare Holo' },
  ]
  ok(probes.every((p) => Boolean(printingFor(p)?.matchedRule)), 'every resolution path records its rule')
}

// ---------------------------------------------------------------------------
console.log(`\n${total - fails.length}/${total} assertions passed`)
if (fails.length) {
  console.log('FAILURES:')
  for (const f of fails) console.log(' ✗', f)
  process.exit(1)
}
console.log('ALL OK')
