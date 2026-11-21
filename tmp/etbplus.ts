const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json',
}
for (const groupId of [2585, 2626, 2675, 2701]) {
  const products = (await (await fetch(`https://tcgcsv.com/tcgplayer/3/${groupId}/products`, { headers: UA })).json()) as {
    results: { productId: number; name: string; imageUrl: string }[]
  }
  const prices = (await (await fetch(`https://tcgcsv.com/tcgplayer/3/${groupId}/prices`, { headers: UA })).json()) as {
    results: { productId: number; marketPrice: number | null; subTypeName: string }[]
  }
  const market = new Map<number, number | null>()
  for (const p of prices.results) if (p.subTypeName === 'Normal' || !market.has(p.productId)) market.set(p.productId, p.marketPrice)
  const hits = products.results.filter((p) => /elite trainer box plus/i.test(p.name))
  console.log(`group ${groupId}: ${hits.length} ETB Plus listings`)
  for (const p of hits) console.log([p.productId, p.name, `mkt=${market.get(p.productId) ?? '-'}`, p.imageUrl ? 'img' : 'noimg'].join(' | '))
}
