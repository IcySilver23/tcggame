// One-off: deal real Gem Packs against a scratch copy of the catalogue and count
// what each pack holds. Runs before any service import so the DB path resolves to
// the copy, never the player's save.
import fs from 'node:fs'
import { createRequire } from 'node:module'

// Resolved before the chdir, as absolute file URLs: relative imports would
// otherwise be looked up from the scratch home.
const packsUrl = new URL('../server/services/packs.ts', import.meta.url).href
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

// Absolute, because the services open the copy relative to a changed cwd.
const HOME = `${process.cwd()}/tmp/rip-home`
fs.rmSync(HOME, { recursive: true, force: true })
fs.mkdirSync(`${HOME}/data`, { recursive: true })
fs.copyFileSync('data/tcglife.db', `${HOME}/data/tcglife.db`)
process.chdir(HOME)

const { rollPack } = await import(packsUrl)
// The printed tier of every card, straight from the released catalogue.
const tierOf = new Map<string, string>(
  JSON.parse(fs.readFileSync(new URL('../server/catalog/regional-releases.json', import.meta.url), 'utf8'))
    .cards.filter((c: any) => c.tier)
    .map((c: any) => [c.id, c.tier]),
)
// Opened after the deals, once the rolling connection has been closed.
const openDb = () => new Database(`${HOME}/data/tcglife.db`, { readonly: true })

const N = 720
for (const setId of ['cbb7', 'cbb1']) {
  const sizes = new Map<number, number>()
  const hits = new Map<number, number>()
  const tiers = new Map<string, number>()
  let cards = 0
  const db = openDb()
  const num = db.prepare('SELECT number FROM cards WHERE id = ?')
  for (let i = 0; i < N; i++) {
    const pack = rollPack(setId, `sess_test_${setId}_${i}`)
    const picked = Array.isArray(pack) ? pack : (pack?.cards ?? [])
    sizes.set(picked.length, (sizes.get(picked.length) ?? 0) + 1)
    hits.set(picked.filter((c: any) => c.isHit).length, (hits.get(picked.filter((c: any) => c.isHit).length) ?? 0) + 1)
    for (const c of picked as any[]) {
      cards++
      const tier = tierOf.get(c.cardId) ?? '?'
      tiers.set(tier, (tiers.get(tier) ?? 0) + 1)
    }
  }
  const pct = (n: number) => `${((100 * n) / Math.max(1, cards)).toFixed(2)}%`
  console.log(`${setId}: ${N} packs, cards/pack ${JSON.stringify([...sizes])}, hit cards/pack ${JSON.stringify([...hits])}`)
  console.log(`   printed tiers ${[...tiers].sort().map(([t, n]) => `${t} ${pct(n)}`).join(' · ')}`)
  db.close()
}
