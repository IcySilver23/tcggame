import { priceDetail } from '../../server/services/sealed'
const ids = ['ex12-display', 'hgss1-display', 'bw1-display', 'bw11-etb', 'xy1-etb', 'swsh1-etb', 'swsh9-etb', 'swsh12pt5-bundle', 'swsh12pt5-display']
for (const id of ids) { try { console.log(id.padEnd(22), JSON.stringify(priceDetail(id))) } catch (e) { console.log(id.padEnd(22), 'ERR', (e as Error).message) } }
