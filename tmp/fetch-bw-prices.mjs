const UA = 'tcglife-sealed-audit/1.0'
const base = 'https://tcgcsv.com/tcgplayer/3'
const get = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}
const groups = (await get(`${base}/groups`)).results
const bw = groups.filter((g) => /Black & White|Black and White|Plasma|Emerging Powers|Noble Victories|Next Destinies|Dark Explorers|Dragons Exalted|Boundaries Crossed|Legendary Treasures|Dragon Vault/i.test(g.name))
console.log('GROUPS', bw.map((g) => `${g.groupId}:${g.abbreviation}:${g.name}`).join(' | '))
for (const g of bw) {
  const [prod, price] = await Promise.all([get(`${base}/${g.groupId}/products`), get(`${base}/${g.groupId}/prices`)])
  const prices = new Map(price.results.map((p) => [p.productId, p]))
  const rows = prod.results
    .filter((p) => /booster (pack|box|display)|elite trainer|blister|bundle/i.test(p.name))
    .map((p) => ({ id: p.productId, name: p.name, url: p.url, market: prices.get(p.productId)?.marketPrice ?? null, mid: prices.get(p.productId)?.midPrice ?? null }))
  console.log('\n##', g.groupId, g.abbreviation, g.name)
  for (const r of rows) console.log(`${r.id}\t${r.market}\t${r.mid}\t${r.name}\t${r.url}`)
}
