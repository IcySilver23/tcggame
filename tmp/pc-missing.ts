const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json',
}
const groups = (await (await fetch('https://tcgcsv.com/tcgplayer/3/groups', { headers: UA })).json()) as {
  results: { groupId: number; name: string; abbreviation: string }[]
}
for (const g of groups.results) {
  if (/^(SV0?1|ME0?1|SV: Scarlet & Violet|ME: Mega Evolution)/i.test(g.name) || /^(SV0?1|ME0?1)$/i.test(g.abbreviation)) {
    console.log('GROUP', g.groupId, g.abbreviation, g.name)
    const products = (await (await fetch(`https://tcgcsv.com/tcgplayer/3/${g.groupId}/products`, { headers: UA })).json()) as {
      results: { productId: number; name: string; imageUrl: string }[]
    }
    const prices = (await (await fetch(`https://tcgcsv.com/tcgplayer/3/${g.groupId}/prices`, { headers: UA })).json()) as {
      results: { productId: number; marketPrice: number | null; subTypeName: string }[]
    }
    const market = new Map<number, number | null>()
    for (const p of prices.results) if (p.subTypeName === 'Normal' || !market.has(p.productId)) market.set(p.productId, p.marketPrice)
    for (const p of products.results) {
      if (/pok[eé]mon center/i.test(p.name) && /elite trainer|etb/i.test(p.name)) {
        console.log([p.productId, p.name, `mkt=${market.get(p.productId) ?? '-'}`, p.imageUrl ? 'img' : 'noimg'].join(' | '))
      }
    }
  }
}
