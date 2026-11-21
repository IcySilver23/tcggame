import fs from 'node:fs'

const UA = { 'User-Agent': 'TCGLife/0.6.1 (collector-sim; local card game)' }
const rows = JSON.parse(fs.readFileSync('tmp/bb-parsed.json', 'utf8'))
const groups = JSON.parse(fs.readFileSync('tmp/tcg-groups.json', 'utf8')).results
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
const strip = (s) => s.replace(/^[A-Z0-9]+:\s*/, '').replace(/^XY\s*-\s*/, '')

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: UA })
      if (!res.ok) throw new Error(`${res.status} ${url}`)
      return await res.json()
    } catch (e) {
      if (i === 2) throw e
      await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    }
  }
}

function groupFor(expansion) {
  const target = norm(expansion)
  let best = null
  for (const g of groups) {
    if (/promo|energy|trainer gallery|sealed/i.test(g.name)) continue
    const gn = norm(strip(g.name))
    if (gn === target) return g
    if (!best && (gn.includes(target) || target.includes(gn))) best = g
  }
  return best
}

const out = []
for (const row of rows) {
  const group = groupFor(row.expansion)
  const result = { ...row, groupId: group?.groupId ?? null, groupName: group?.name ?? null, productId: null, market: null, image: null }
  if (group) {
    try {
      const products = (await get(`https://tcgcsv.com/tcgplayer/3/${group.groupId}/products`)).results ?? []
      const want = norm(`${row.expansion} Build & Battle Box`)
      const hit = products.find((p) => norm(p.name) === want)
        ?? products.find((p) => /build.*battle/i.test(p.name) && !/display|stadium|code card/i.test(p.name))
      if (hit) {
        result.productId = hit.productId
        result.image = `https://tcgplayer-cdn.tcgplayer.com/product/${hit.productId}_in_400x400.jpg`
        const prices = (await get(`https://tcgcsv.com/tcgplayer/3/${group.groupId}/prices`)).results ?? []
        const price = prices.find((p) => p.productId === hit.productId && p.subTypeName === 'Normal')
          ?? prices.find((p) => p.productId === hit.productId)
        result.market = price?.marketPrice ?? null
      }
    } catch (e) {
      result.error = String(e)
    }
  }
  console.log(`${row.setId}\t${row.expansion}\tgroup=${result.groupId}\tproduct=${result.productId}\tmarket=${result.market}\timg=${result.image ? 'yes' : 'no'}`)
  out.push(result)
}

fs.writeFileSync('tmp/bb-catalog.json', JSON.stringify(out, null, 2))
console.log('saved', out.length, 'with product', out.filter((r) => r.productId).length, 'with market', out.filter((r) => typeof r.market === 'number').length)
