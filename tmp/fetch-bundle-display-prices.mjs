import fs from 'node:fs'

const UA = { headers: { 'User-Agent': 'tcglife-sealed-audit/1.0', Accept: 'application/json' } }
const base = 'https://tcgcsv.com/tcgplayer/3'
const get = async (url) => {
  const res = await fetch(url, UA)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

const sets = JSON.parse(fs.readFileSync('tmp/bundle-display-sets.json', 'utf8'))
const groups = (await get(`${base}/groups`)).results
const norm = (v) => (v || '').toLowerCase().replace(/pok[eé]mon/g, '').replace(/[^a-z0-9]/g, '')
const out = []
for (const set of sets) {
  const target = norm(set.setName)
  const group =
    groups.find((g) => norm(g.name) === target) ||
    groups.find((g) => norm(g.name).startsWith(target) || target.startsWith(norm(g.name))) ||
    groups.find((g) => norm(g.name).includes(target) || target.includes(norm(g.name)))
  if (!group) { out.push({ ...set, found: false, products: [] }); continue }
  const [prod, price] = await Promise.all([
    get(`${base}/${group.groupId}/products`),
    get(`${base}/${group.groupId}/prices`),
  ])
  const prices = new Map(price.results.map((p) => [p.productId, p]))
  const products = prod.results
    .filter((p) => /booster bundle|booster (box|display)/i.test(p.name))
    .map((p) => ({
      id: p.productId,
      name: p.name,
      url: p.url,
      image: p.imageUrl,
      market: prices.get(p.productId)?.marketPrice ?? null,
      mid: prices.get(p.productId)?.midPrice ?? null,
    }))
  out.push({ ...set, found: true, group: group.name, groupId: group.groupId, products })
  await new Promise((r) => setTimeout(r, 80))
}
fs.writeFileSync('tmp/bundle-display-prices.json', JSON.stringify(out, null, 2))
for (const o of out) {
  if (!o.found) { console.log(`NO GROUP\t${o.setId}\t${o.setName}`); continue }
  if (!o.products.length) continue
  console.log(`\n## ${o.setId} ${o.setName} [${o.group}]`)
  for (const p of o.products) console.log(`${p.id}\t${p.market}\t${p.name}`)
}
console.log(`\n${out.length} sets, ${out.filter((o) => o.found).length} matched, ${out.reduce((n, o) => n + o.products.length, 0)} listings`)
