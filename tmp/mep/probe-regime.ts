import { valueOf, resolvePrice } from '../../server/services/market'
for (const id of ['me6-84','me6-138','me6-26','mep-109','sv8-1']) {
  const p = resolvePrice(id, 'holofoil')
  console.log(id, 'usd', p.usd, 'source', p.source, 'kind', p.kind)
}
