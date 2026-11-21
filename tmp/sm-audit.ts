const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json',
}

const GROUPS = 'https://tcgcsv.com/tcgplayer/3/groups'
const WANT = /^SM - |shining legends|dragon majesty|hidden fates|detective pikachu/i

const groups = (await (await fetch(GROUPS, { headers: UA })).json()) as {
  results: { groupId: number; name: string; abbreviation: string; publishedOn: string }[]
}
const picked = groups.results.filter((g) => WANT.test(g.name.trim()))
console.log('picked', picked.length)
for (const g of picked) console.log(g.groupId, g.abbreviation, g.name, g.publishedOn)

const SEALED = /elite trainer|bundle|booster box|display|half booster|case|collection|premium/i

for (const g of picked) {
  const products = (await (await fetch(`https://tcgcsv.com/tcgplayer/3/${g.groupId}/products`, { headers: UA })).json()) as {
    results: { productId: number; name: string; imageUrl: string; extendedData?: { name: string; value: string }[] }[]
  }
  const prices = (await (await fetch(`https://tcgcsv.com/tcgplayer/3/${g.groupId}/prices`, { headers: UA })).json()) as {
    results: { productId: number; marketPrice: number | null; lowPrice: number | null; subTypeName: string }[]
  }
  const market = new Map<number, number | null>()
  for (const p of prices.results) if (p.subTypeName === 'Normal' || !market.has(p.productId)) market.set(p.productId, p.marketPrice)
  const rows = products.results.filter((p) => SEALED.test(p.name))
  console.log(`\n=== ${g.groupId} ${g.name} (${products.results.length} products, ${rows.length} sealed-like) ===`)
  for (const p of rows) {
    const upc = p.extendedData?.find((e) => /UPC|ISBN/i.test(e.name))?.value
    console.log(
      [p.productId, p.name, `mkt=${market.get(p.productId) ?? '-'}`, p.imageUrl ? 'img' : 'noimg', upc ?? ''].join(' | '),
    )
  }
}
