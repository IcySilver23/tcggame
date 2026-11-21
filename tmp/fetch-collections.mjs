import fs from 'node:fs'

const UA = { 'User-Agent': 'TCGLife/0.6.1 (collector-sim; local card game)' }
async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: UA })
      if (!res.ok) throw new Error(`${res.status} ${url}`)
      return await res.json()
    } catch (e) {
      if (i === 2) throw e
      await new Promise((r) => setTimeout(r, 700 * (i + 1)))
    }
  }
}

const groups = (await get('https://tcgcsv.com/tcgplayer/3/groups')).results
const targets = {
  sv3pt5: /151/i,
  sv4pt5: /Paldean Fates/i,
  sv6pt5: /Shrouded Fable/i,
  sv8pt5: /Prismatic Evolutions/i,
  cel25: /Celebrations/i,
}
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
const out = {}
for (const [setId, re] of Object.entries(targets)) {
  const candidates = groups.filter((g) => re.test(g.name) && !/promo|energy|classic|jumbo/i.test(g.name))
  const group = candidates.sort((a, b) => norm(a.name).length - norm(b.name).length)[0]
  if (!group) { out[setId] = { error: 'no group', candidates: candidates.map((g) => g.name) }; continue }
  const products = (await get(`https://tcgcsv.com/tcgplayer/3/${group.groupId}/products`)).results ?? []
  const prices = (await get(`https://tcgcsv.com/tcgplayer/3/${group.groupId}/prices`)).results ?? []
  const sealed = products.filter((p) =>
    /collection|premium|ultra|poster|binder|tin|box|special|deluxe|surprise|pouch|bundle|elite/i.test(p.name)
    && !/code card|sleeve|playmat|deck box|coin|dice|album|booster pack(?! bundle)/i.test(p.name),
  )
  const byId = new Map(prices.map((p) => [p.productId, p]))
  out[setId] = {
    groupId: group.groupId,
    groupName: group.name,
    products: sealed.map((p) => {
      const price = byId.get(p.productId)
      return { productId: p.productId, name: p.name, market: price?.marketPrice ?? null, image: p.imageUrl }
    }),
  }
  console.log(`== ${setId} ${group.groupId} ${group.name} (${sealed.length})`)
  for (const p of out[setId].products) console.log(`  ${p.productId}\t${p.market ?? '-'}\t${p.name}`)
}
fs.writeFileSync('tmp/collections-catalog.json', JSON.stringify(out, null, 2))
