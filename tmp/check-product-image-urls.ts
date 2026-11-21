import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const root = path.resolve('.')
const home = path.join(root, 'tmp', 'product-image-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
const source = new Database(path.join(root, 'data', 'tcglife.db'), { readonly: true })
await source.backup(path.join(home, 'data', 'tcglife.db'))
source.close()
process.env.TCGLIFE_HOME = home

const { db } = await import('../server/lib/db')
const sealed = await import('../server/services/sealed')
sealed.ensureFullCatalog()

const rows = db.prepare(`SELECT id, set_id, image_url FROM pack_products`).all() as {
  id: string
  set_id: string
  image_url: string | null
}[]
const sold = rows.filter((r) => sealed.sellsProduct(r.id, r.set_id))
const remote = sold.filter((r) => r.image_url?.startsWith('http'))
const local = sold.filter((r) => r.image_url && !r.image_url.startsWith('http'))
const broken: string[] = []
let done = 0
const queue = [...remote]
async function worker(): Promise<void> {
  for (;;) {
    const row = queue.shift()
    if (!row) return
    let ok = false
    for (const method of ['HEAD', 'GET']) {
      try {
        const res = await fetch(row.image_url!, {
          method,
          redirect: 'follow',
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; TCG-Life image audit)' },
          signal: AbortSignal.timeout(20_000),
        })
        if (res.ok) { ok = true; break }
      } catch { /* try GET after a HEAD failure */ }
    }
    done++
    if (!ok) broken.push(row.id)
    if (done % 50 === 0) console.log(`checked ${done}/${remote.length}`)
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))
console.log(`sold=${sold.length} local=${local.length} remote=${remote.length} broken=${broken.length}`)
for (const id of broken) console.log(`BROKEN ${id}`)
