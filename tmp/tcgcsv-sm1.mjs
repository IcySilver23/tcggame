const UA = { headers: { 'User-Agent': 'tcglife-sealed-audit/1.0', Accept: 'application/json' } }
const groupId = 1863
const [products, prices] = await Promise.all([
  fetch(`https://tcgcsv.com/tcgplayer/3/${groupId}/products`, UA).then((r) => r.json()),
  fetch(`https://tcgcsv.com/tcgplayer/3/${groupId}/prices`, UA).then((r) => r.json()),
])
const price = new Map(prices.results.map((p) => [p.productId, p]))
for (const p of products.results) {
  if (/elite trainer box/i.test(p.name) && !/center|case|code card/i.test(p.name)) {
    console.log(p.productId, '$' + (price.get(p.productId)?.marketPrice ?? 'null'), p.name)
  }
}
