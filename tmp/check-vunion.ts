// The Celebrations Pikachu V-UNION Special Collection must hand over the four
// cards that make the Pokémon, plus Professor Burnet — the box exists for them,
// and it used to open as four Celebrations packs and one promo. It also holds
// six wrappers, not four: the four four-card Celebrations packs and the two
// standard ten-card boosters printed on the box.
//
//   node ./node_modules/tsx/dist/cli.mjs tmp/check-vunion.ts
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const home = path.join(process.cwd(), 'tmp', 'union-home')
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
const { sealedEvidenceFor, mixedPackSpec } = await import('../server/catalog/sealed-evidence')

// The copy still carries the old four-pack product row; reseed so the box is
// asked to rip the six wrappers the catalogue now claims.
sealed.ensureFullCatalog()

const ID = 'cel25-pikachu-v-union'
const PIECES = ['swshp-SWSH139', 'swshp-SWSH140', 'swshp-SWSH141', 'swshp-SWSH142']
const checks: [string, boolean][] = []
const ok = (label: string, pass: boolean) => checks.push([label, pass])

const evidence = sealedEvidenceFor(ID)
ok('the product has evidence', !!evidence)
ok('it names five promos', evidence?.promos.length === 5)
ok('every promo has a catalogue id', evidence?.promoIds?.length === 5)
ok('every policy is "all" (each card is inside)', evidence?.promoPolicy === 'all')
ok('the four pieces are the named ids', PIECES.every((id) => evidence?.promoIds?.includes(id)))
ok('Professor Burnet rides along', evidence?.promoIds?.includes('swshp-SWSH167') === true)

// Stock one box and open it the way the shop does.
db.prepare('INSERT INTO sealed_inventory (product_id, quantity, cost, condition, acquired_at) VALUES (?, 1, 189.08, ?, ?)').run(
  ID,
  'sealed',
  new Date().toISOString(),
)
const opened = packs.openSealed(ID) as {
  promos: { cardId: string; name: string; value: number }[]
  cards: unknown[]
  packsOpened: number
  perPack: { sessionId: string; cards: { cardId: string }[] }[]
}
const ids = opened.promos.map((p) => p.cardId)
ok('the box banks five promos', opened.promos.length === 5)
ok('all four V-UNION pieces are banked', PIECES.every((id) => ids.includes(id)))
ok('Burnet is banked', ids.includes('swshp-SWSH167'))
ok('each piece has a live value', opened.promos.filter((p) => PIECES.includes(p.cardId)).every((p) => p.value > 0))
ok('the four pieces are distinct printings', new Set(PIECES.map((id) => db.prepare('SELECT number FROM cards WHERE id = ?').get(id))).size === 4)

// Six wrappers: four Celebrations packs, then the two additional boosters the
// box lists (each 10 cards), so the box is no longer four packs and no extra.
ok('the box holds six packs', sealedEvidenceFor(ID)?.packs === 6)
ok('it opens all six packs', opened.packsOpened === 6)
ok('the first four wrappers are Celebrations packs', mixedPackSpec(ID, 0)?.setId === 'cel25' && mixedPackSpec(ID, 3)?.setId === 'cel25')
ok('the fifth wrapper is the first additional booster', mixedPackSpec(ID, 4)?.setId === 'swsh6')
ok('the sixth wrapper is the second additional booster', mixedPackSpec(ID, 5)?.setId === 'swsh7')
ok('the Celebrations wrappers deal their four cards', opened.perPack.slice(0, 4).every((p) => p.cards.length === 4))
ok('each additional booster deals ten cards', opened.perPack.slice(4).length === 2 && opened.perPack.slice(4).every((p) => p.cards.length === 10))
ok('the additional boosters are other expansions, not Celebrations', opened.perPack.slice(4).every((p) => p.cards.every((c) => !PIECES.includes(c.cardId))))
const owned = db
  .prepare(`SELECT COUNT(DISTINCT card_id) AS n FROM inventory WHERE card_id IN (${PIECES.map(() => '?').join(',')})`)
  .get(...PIECES) as { n: number }
ok('the binder now holds all four', owned.n === 4)

let failed = 0
for (const [label, pass] of checks) {
  if (!pass) failed++
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}`)
}
console.log(failed === 0 ? `\nPASS — ${checks.length} checks` : `\nFAILED — ${failed} of ${checks.length}`)
process.exit(failed === 0 ? 0 : 1)
