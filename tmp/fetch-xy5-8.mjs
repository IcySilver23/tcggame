const UA = 'tcglife-sealed-audit/1.0'
const base = 'https://tcgcsv.com/tcgplayer/3'
const get = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}
for (const group of [1509, 1661]) {
  const [prod, price] = await Promise.all([get(`${base}/${group}/products`), get(`${base}/${group}/prices`)])
  const prices = new Map(price.results.map((p) => [p.productId, p]))
  console.log('\n## group', group)
  for (const p of prod.results.filter((x) => /elite|trainer box|booster box|booster pack/i.test(x.name))) {
    const q = prices.get(p.productId)
    console.log(`${p.productId}\t${q?.marketPrice ?? null}\t${q?.midPrice ?? null}\t${p.name}\t${p.url}`)
  }
}
