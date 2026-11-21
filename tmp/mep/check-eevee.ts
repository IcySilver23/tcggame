// One-off: what the catalogue claims for the Knock Out Eevee (me55-116).
import { db } from '../../server/lib/db'
import { holoFor } from '../../src/holo'
import { printingFor } from '../../src/foil/printing-db'

const card = db.prepare("SELECT id,name,number,rarity,artist,hp FROM cards WHERE id='me55-116'").get()
console.log('card:', JSON.stringify(card))
const holo = holoFor({ cardId: 'me55-116', rarity: 'Common' })
const printing = printingFor({ cardId: 'me55-116', rarity: 'Common', name: 'Eevee' })
console.log('holoFor:', JSON.stringify(holo))
console.log('printingFor:', JSON.stringify(printing))
console.log('blister products:', JSON.stringify(db.prepare("SELECT id,kind,name FROM pack_products WHERE set_id='me55' AND (id LIKE '%blister%' OR name LIKE '%Blister%')").all()))
console.log('all me55 products:', JSON.stringify(db.prepare("SELECT id,kind FROM pack_products WHERE set_id='me55' ORDER BY id").all().map((r: { id: string; kind: string }) => r.id + ':' + r.kind)))
