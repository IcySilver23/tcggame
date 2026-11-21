// One-off: seed/refresh the sourced special products (adds the 2-Pack Blister)
// without waiting for a full boot.
//
// Run: node node_modules/tsx/dist/cli.mjs tmp/mep/seed.ts

import { db } from '../../server/lib/db'
import { ensureFullCatalog } from '../../server/services/sealed'

db.pragma('busy_timeout = 20000')
ensureFullCatalog()
console.log('blister:', JSON.stringify(db.prepare("SELECT id,set_id,kind,packs,cards_per_pack,msrp,release_date FROM pack_products WHERE id = 'me55-2pack-blister'").get()))
console.log('special rows:', db.prepare("SELECT COUNT(*) n FROM pack_products WHERE kind = 'special'").get())
