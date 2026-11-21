import { rollPack } from '../../server/services/packs'
import { db } from '../../server/lib/db'
const r = rollPack('me6', 'tmp-dlr-smoke', 'booster', 10)
console.log('me6 pack ->', r?.length, 'cards')
console.log('sample', r?.slice(0, 5).map((c) => `${c.cardId} [${c.variant}] $${c.value}`).join(' | '))
const hits = r?.filter((c) => c.isHit) ?? []
console.log('hits', hits.map((c) => `${c.cardId} $${c.value}`).join(' | '))
// The smoke pull is test state, not a real opening.
db.prepare('DELETE FROM pull_history WHERE session_id = ?').run('tmp-dlr-smoke')
console.log('cleaned pull_history rows for tmp-dlr-smoke')
