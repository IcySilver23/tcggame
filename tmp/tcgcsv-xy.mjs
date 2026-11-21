import fs from 'node:fs'
const UA = { headers: { 'User-Agent': 'tcglife-sealed-audit/1.0', Accept: 'application/json' } }
const groups = (await (await fetch('https://tcgcsv.com/tcgplayer/3/groups', UA)).json()).results
const sets = JSON.parse(fs.readFileSync('tmp/etb-sets.json', 'utf8'))
const norm = (v) => (v || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const xySets = sets.filter((s) => /^(xy\d+|g1|dc1|xy0)$/.test(s.setId))
const out = []
for (const s of xySets) {
  const target = norm(s.setName)
  let group = groups.find((g) => norm(g.name) === target)
  if (!group) group = groups.find((g) => norm(g.name).includes(target) && !/radiant|promo/i.test(g.name))
  if (!group) { out.push({ ...s, found: false, hits: [] }); continue }
  const [products, prices] = await Promise.all([
    fetch(`https://tcgcsv.com/tcgplayer/3/${group.groupId}/products`, UA).then((r) => r.json()),
    fetch(`https://tcgcsv.com/tcgplayer/3/${group.groupId}/prices`, UA).then((r) => r.json()),
  ])
  const price = new Map(prices.results.map((p) => [p.productId, p]))
  const hits = products.results
    .filter((p) => /booster|elite trainer|bundle|display/i.test(p.name) && !/case|code card|sleeve|playmat|deck box|theme deck/i.test(p.name))
    .map((p) => ({ id: p.productId, name: p.name, market: price.get(p.productId)?.marketPrice ?? null, image: p.imageUrl }))
  out.push({ ...s, found: true, group: group.name, groupId: group.groupId, hits })
  await new Promise((r) => setTimeout(r, 150))
}
fs.writeFileSync('tmp/tcgcsv-xy.json', JSON.stringify(out, null, 2))
for (const o of out) {
  console.log('\n' + o.setId + ' | ' + (o.found ? o.group : 'NOT FOUND'))
  for (const h of o.hits) console.log('  ' + h.id + ' | $' + h.market + ' | ' + h.name)
}
