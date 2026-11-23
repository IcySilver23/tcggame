// The other Celebrations collections hold more than their four-card packs, and
// used to open only the Celebrations half. Published contents list the extra
// standard boosters (Dragapult Prime 2 + 1, Deluxe Pin 4 + 2, V Memories 6 + 2,
// Premium Figure 8 + 3, Ultra-Premium 17 + 8) without ever naming which
// expansions they are, so this build deals them from the sets on shelves in
// October 2021: Chilling Reign, then Evolving Skies, Battle Styles and Vivid
// Voltage. This script opens every one of those boxes on a copy of the save and
// checks the wrapper count, the wrapper order, and the four-card/ten-card split.
//
//   node ./node_modules/tsx/dist/cli.mjs tmp/check-cel-collections.ts
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const home = path.join(process.cwd(), 'tmp', 'cel-collections-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
{
  const src = new Database(path.join(process.cwd(), 'data', 'tcglife.db'), { readonly: true })
  await src.backup(path.join(home, 'data', 'tcglife.db'))
  src.close()
}
process.env.TCGLIFE_HOME = home

const { db } = await import('../server/lib/db')
const packs = await import('../server/services/packs')
const sealed = await import('../server/services/sealed')
const { sealedEvidenceFor, mixedPackSpec, PACK_MIX } = await import('../server/catalog/sealed-evidence')

// The copy carries the old product rows (and no mixes), so reseed before asking.
sealed.ensureFullCatalog()

type Box = {
  id: string
  cost: number
  cele: number
  extra: string[]
  promos: number
}

const BOXES: Box[] = [
  { id: 'cel25-dragapult-prime', cost: 82.52, cele: 2, extra: ['swsh6'], promos: 0 },
  { id: 'cel25-deluxe-pin', cost: 133.12, cele: 4, extra: ['swsh6', 'swsh7'], promos: 1 },
  { id: 'cel25-v-memories', cost: 197.49, cele: 6, extra: ['swsh6', 'swsh7'], promos: 2 },
  { id: 'cel25-premium-figure', cost: 296.52, cele: 8, extra: ['swsh6', 'swsh7', 'swsh5'], promos: 0 },
  {
    id: 'cel25-upc',
    cost: 1206.87,
    cele: 17,
    // Two apiece, grouped in the mix's order rather than round-robin.
    extra: ['swsh6', 'swsh6', 'swsh7', 'swsh7', 'swsh5', 'swsh5', 'swsh4', 'swsh4'],
    promos: 0,
  },
]

const checks: [string, boolean][] = []
const ok = (label: string, pass: boolean) => checks.push([label, pass])
const setOf = db.prepare('SELECT set_id FROM cards WHERE id = ?')

for (const box of BOXES) {
  const total = box.cele + box.extra.length
  const evidence = sealedEvidenceFor(box.id)
  ok(`${box.id}: the product has evidence`, !!evidence)
  ok(`${box.id}: it holds ${total} wrappers, not ${box.cele}`, evidence?.packs === total)

  const mix = PACK_MIX[box.id]
  ok(`${box.id}: the mix is recorded`, !!mix)
  ok(`${box.id}: the mix totals ${total} wrappers`, mix?.reduce((n, s) => n + s.packs, 0) === total)
  ok(
    `${box.id}: every mix segment names a wrapper the set actually sells`,
    (mix ?? []).every((s) => typeof s.setId === 'string' && s.setId.length > 0),
  )

  // Wrapper order: all the Celebrations packs first, then the extras in the
  // documented order, so the box never interleaves the sizes.
  const lastCele = mixedPackSpec(box.id, box.cele - 1)
  const firstExtra = mixedPackSpec(box.id, box.cele)
  ok(`${box.id}: the first ${box.cele} wrappers are Celebrations packs`, lastCele?.setId === 'cel25')
  ok(`${box.id}: the Celebrations wrappers keep their four cards`, lastCele?.cardsPerPack === undefined)
  ok(`${box.id}: the first additional booster is a standard pack`, firstExtra?.cardsPerPack === 10)
  ok(
    `${box.id}: the additional boosters are dealt in the documented order`,
    box.extra.every((setId, i) => mixedPackSpec(box.id, box.cele + i)?.setId === setId),
  )
  ok(
    `${box.id}: every additional booster comes from outside Celebrations`,
    box.extra.every((setId) => setId !== 'cel25'),
  )

  db.prepare('INSERT INTO sealed_inventory (product_id, quantity, cost, condition, acquired_at) VALUES (?, 1, ?, ?, ?)').run(
    box.id,
    box.cost,
    'sealed',
    new Date().toISOString(),
  )
  const opened = packs.openSealed(box.id) as {
    promos: { cardId: string; value: number }[]
    packsOpened: number
    perPack: { sessionId: string; cards: { cardId: string }[] }[]
  }
  ok(`${box.id}: ripping the box opens ${total} packs`, opened.packsOpened === total)
  ok(`${box.id}: the ESP shows ${total} bundles`, opened.perPack.length === total)
  ok(`${box.id}: it still hands over its ${box.promos} promos`, opened.promos.length === box.promos)
  ok(
    `${box.id}: the first ${box.cele} wrappers deal four cards each`,
    opened.perPack.slice(0, box.cele).every((p) => p.cards.length === 4),
  )
  ok(
    `${box.id}: each additional booster deals ten cards`,
    opened.perPack.slice(box.cele).every((p) => p.cards.length === 10),
  )
  ok(
    `${box.id}: the additional boosters deal the expansions the mix names`,
    opened.perPack.slice(box.cele).every((p, i) => {
      const want = box.extra[i]
      return p.cards.length > 0 && p.cards.every((c) => (setOf.get(c.cardId) as { set_id: string } | undefined)?.set_id === want)
    }),
  )
  // A Celebrations wrapper deals main-set cards and Classic Collection
  // reprints, so its cards belong to cel25 or the cel25c subset — never to the
  // expansions the rest of the box hands out.
  const CELEBRATIONS = new Set(['cel25', 'cel25c'])
  ok(
    `${box.id}: the Celebrations wrappers stay Celebrations`,
    opened.perPack
      .slice(0, box.cele)
      .every((p) => p.cards.every((c) => CELEBRATIONS.has((setOf.get(c.cardId) as { set_id: string } | undefined)?.set_id ?? ''))),
  )
}

let failed = 0
for (const [label, pass] of checks) {
  if (!pass) failed++
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}`)
}
console.log(failed === 0 ? `\nPASS — ${checks.length} checks` : `\nFAILED — ${failed} of ${checks.length}`)
process.exit(failed === 0 ? 0 : 1)
