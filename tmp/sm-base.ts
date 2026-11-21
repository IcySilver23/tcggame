const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json',
}
const groups = (await (await fetch('https://tcgcsv.com/tcgplayer/3/groups', { headers: UA })).json()) as {
  results: { groupId: number; name: string; abbreviation: string; publishedOn: string }[]
}
const base = groups.results.filter(
  (g) => /sun/i.test(g.name) || /^SM0?1$/i.test(g.abbreviation) || g.publishedOn.startsWith('2017-02-03'),
)
console.log('base groups', base)
for (const g of base) {
  const products = (await (await fetch(`https://tcgcsv.com/tcgplayer/3/${g.groupId}/products`, { headers: UA })).json()) as {
    results: { productId: number; name: string; imageUrl: string }[]
  }
  const prices = (await (await fetch(`https://tcgcsv.com/tcgplayer/3/${g.groupId}/prices`, { headers: UA })).json()) as {
    results: { productId: number; marketPrice: number | null; subTypeName: string }[]
  }
  const market = new Map<number, number | null>()
  for (const p of prices.results) if (p.subTypeName === 'Normal' || !market.has(p.productId)) market.set(p.productId, p.marketPrice)
  for (const p of products.results) {
    if (/elite trainer|bundle|booster box|display|half/i.test(p.name)) {
      console.log([p.productId, p.name, `mkt=${market.get(p.productId) ?? '-'}`, p.imageUrl ? 'img' : 'noimg'].join(' | '))
    }
  }
}
