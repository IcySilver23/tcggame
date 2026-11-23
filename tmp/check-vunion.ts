// The Celebrations Pikachu V-UNION Special Collection must hand over the four
// cards that make the Pokémon, plus Professor Burnet — the box exists for them,
// and it used to open as four Celebrations packs and one promo.
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
const { sealedEvidenceFor } = await import('../server/catalog/sealed-evidence')

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
const opened = packs.openSealed(ID) as { promos: { cardId: string; name: string; value: number }[]; cards: unknown[]; packsOpened: number }
const ids = opened.promos.map((p) => p.cardId)
ok('the box banks five promos', opened.promos.length === 5)
ok('all four V-UNION pieces are banked', PIECES.every((id) => ids.includes(id)))
ok('Burnet is banked', ids.includes('swshp-SWSH167'))
ok('each piece has a live value', opened.promos.filter((p) => PIECES.includes(p.cardId)).every((p) => p.value > 0))
ok('the four pieces are distinct printings', new Set(PIECES.map((id) => db.prepare('SELECT number FROM cards WHERE id = ?').get(id))).size === 4)
ok('the box still opens its four packs', opened.packsOpened === 4)
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
