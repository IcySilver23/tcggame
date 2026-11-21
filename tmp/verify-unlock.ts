import * as s from '../server/services/shop'
import * as f from '../server/services/franchise'
import * as v from '../server/services/vault'
import * as b from '../server/services/binders'

const st = s.status() as any
console.log('shop:', st.shop?.name, '| cases', st.cases?.length, '| rent', st.shop?.rentCurrent)
console.log('doors:', f.allStores().map((x) => `${x.name} q${x.manager_quality}`).join(', '))
console.log('offices:', f.districtRow()?.name, `${f.districtRow()?.quality}*`, '|', f.regionalRow()?.name, `${f.regionalRow()?.quality}*`)
const cap = v.capacity()
console.log('capacity: raw', `${cap.rawOwned}/${cap.rawCapacity}`, 'slabs', `${cap.slabOwned}/${cap.slabCapacity}`, '| vault', cap.vault?.active, '| monthly', cap.monthlyTotal)
console.log('binders:', b.listBinders().length)
process.exit(0)
