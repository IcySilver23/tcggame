import fs from 'node:fs'
const UA = { headers: { 'User-Agent': 'tcglife-sealed-audit/1.0', Accept: 'application/json' } }
const groups = (await (await fetch('https://tcgcsv.com/tcgplayer/3/groups', UA)).json()).results
const all = JSON.parse(fs.readFileSync('tmp/etb-sets.json', 'utf8'))
const ids = ['sm1','sm2','sm3','sm4','sm5','sm6','sm7','sm8','sm9','sm10','sm11','sm12','sm35','sm75','sm115','swsh1','swsh2','swsh3','swsh4','swsh5','swsh6','swsh7','swsh8','swsh9','swsh10','swsh11','swsh12','swsh12pt5','swsh35','swsh45','cel25','pgo']
const norm = (v) => (v || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const out = []
for (const id of ids) {
  const s = all.find((x) => x.setId === id)
  if (!s) continue
  const target = norm(s.setName)
  const group =
    groups.find((g) => norm(g.name) === target) ||
    groups.find((g) => norm(g.name).includes(target)) ||
    groups.find((g) => target.includes(norm(g.name)))
  if (!group) { out.push({ ...s, found: false, hits: [] }); continue }
  const [products, prices] = await Promise.all([
    fetch(`https://tcgcsv.com/tcgplayer/3/${group.groupId}/products`, UA).then((r) => r.json()),
    fetch(`https://tcgcsv.com/tcgplayer/3/${group.groupId}/prices`, UA).then((r) => r.json()),
  ])
  const price = new Map(prices.results.map((p) => [p.productId, p]))
  const hits = products.results
    .filter((p) => /elite trainer box/i.test(p.name) && !/pok[eé]mon center|case|code card|display|booster/i.test(p.name))
    .map((p) => ({ id: p.productId, name: p.name, market: price.get(p.productId)?.marketPrice ?? null, image: p.imageUrl }))
  out.push({ ...s, found: true, group: group.name, groupId: group.groupId, hits })
  await new Promise((r) => setTimeout(r, 150))
}
fs.writeFileSync('tmp/tcgcsv-etb-audit.json', JSON.stringify(out, null, 2))
for (const o of out) {
  if (!o.found) { console.log(o.setId + ' | NOT FOUND'); continue }
  if (o.hits.length >= 2) console.log(o.setId + ' | ' + o.group + ' | ' + o.hits.map((h) => h.id + ' $' + h.market + ' ' + h.name).join(' || '))
}
console.log('multi-art sets:', out.filter((o) => o.hits.length >= 2).length)
