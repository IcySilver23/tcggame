import Database from 'better-sqlite3'

const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json',
}
const db = new Database('data/tcglife.db', { readonly: true })
const sets = db
  .prepare(
    `SELECT DISTINCT s.id, s.name FROM pack_products p JOIN sets s ON s.id = p.set_id WHERE p.id LIKE '%-etb-pc' ORDER BY s.release_date`,
  )
  .all() as { id: string; name: string }[]
console.log('sets with PC rows:', sets.length)

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const groups = (await (await fetch('https://tcgcsv.com/tcgplayer/3/groups', { headers: UA })).json()) as {
  results: { groupId: number; name: string; abbreviation: string }[]
}

const matched: { set: { id: string; name: string }; groupId: number; groupName: string }[] = []
for (const s of sets) {
  const want = norm(s.name)
  const g = groups.results.find((g) => {
    const gn = norm(g.name)
    return gn === want || gn.endsWith(want) || gn.includes(want)
  })
  if (g) matched.push({ set: s, groupId: g.groupId, groupName: g.name })
  else console.log('NO GROUP', s.id, s.name)
}

for (const m of matched) {
  const products = (await (await fetch(`https://tcgcsv.com/tcgplayer/3/${m.groupId}/products`, { headers: UA })).json()) as {
    results: { productId: number; name: string; imageUrl: string }[]
  }
  const prices = (await (await fetch(`https://tcgcsv.com/tcgplayer/3/${m.groupId}/prices`, { headers: UA })).json()) as {
    results: { productId: number; marketPrice: number | null; subTypeName: string }[]
  }
  const market = new Map<number, number | null>()
  for (const p of prices.results) if (p.subTypeName === 'Normal' || !market.has(p.productId)) market.set(p.productId, p.marketPrice)
  const hits = products.results.filter((p) => /pok[eé]mon center/i.test(p.name) && /elite trainer|etb/i.test(p.name))
  console.log(`\n=== ${m.set.id} ${m.set.name} (group ${m.groupId} ${m.groupName}) -> ${hits.length} PC ETB listings ===`)
  for (const p of hits) console.log([p.productId, p.name, `mkt=${market.get(p.productId) ?? '-'}`, p.imageUrl ? 'img' : 'noimg'].join(' | '))
}
