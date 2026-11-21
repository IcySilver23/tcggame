const UA = 'tcglife-sealed-audit/1.0'
const base = 'https://tcgcsv.com/tcgplayer/3'
const get = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}
const groups = (await get(`${base}/groups`)).results
const wanted = /^(XY|XY - |Flashfire|Furious Fists|Phantom Forces|Primal Clash|Roaring Skies|Ancient Origins|BREAKthrough|BREAKpoint|Fates Collide|Steam Siege|Evolutions)/i
const xy = groups.filter((g) => wanted.test(g.name) && /XY|Flashfire|Furious|Phantom|Primal|Roaring|Ancient|BREAK|Fates|Steam|Evolutions/i.test(g.name))
console.log('GROUPS', xy.map((g) => `${g.groupId}:${g.abbreviation}:${g.name}`).join(' | '))
for (const g of xy) {
  const [prod, price] = await Promise.all([get(`${base}/${g.groupId}/products`), get(`${base}/${g.groupId}/prices`)])
  const prices = new Map(price.results.map((p) => [p.productId, p]))
  const rows = prod.results
    .filter((p) => /booster (pack|box|display)/i.test(p.name))
    .map((p) => ({ id: p.productId, name: p.name, url: p.url, market: prices.get(p.productId)?.marketPrice ?? null, mid: prices.get(p.productId)?.midPrice ?? null }))
  console.log('\n##', g.groupId, g.abbreviation, g.name)
  for (const r of rows) console.log(`${r.id}\t${r.market}\t${r.mid}\t${r.name}\t${r.url}`)
}
