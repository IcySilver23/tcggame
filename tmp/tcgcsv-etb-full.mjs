import fs from 'node:fs'
const UA = { headers: { 'User-Agent': 'tcglife-sealed-audit/1.0', Accept: 'application/json' } }
const groups = (await (await fetch('https://tcgcsv.com/tcgplayer/3/groups', UA)).json()).results
const norm = (v) => (v || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const all = JSON.parse(fs.readFileSync('tmp/etb-sets.json', 'utf8'))
const main = /^(bw\d+|xy\d+|sm\d+|sm35|sm75|sm115|swsh\d+|swsh35|swsh45|swsh12pt5|cel25|pgo|sv\d+|sv3pt5|sv4pt5|sv6pt5|sv8pt5|me\d+|me2pt5|me55|rsv10pt5|zsv10pt5)$/
const sets = all.filter((s) => main.test(s.setId))
const out = []
for (const s of sets) {
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
    .filter((p) => /elite trainer box/i.test(p.name) && !/pok[eé]mon center|case|code card|display|booster|plus|set of/i.test(p.name))
    .map((p) => ({ id: p.productId, name: p.name, market: price.get(p.productId)?.marketPrice ?? null, image: p.imageUrl }))
  out.push({ ...s, found: true, group: group.name, groupId: group.groupId, hits })
  await new Promise((r) => setTimeout(r, 120))
}
fs.writeFileSync('tmp/tcgcsv-etb-full.json', JSON.stringify(out, null, 2))
for (const o of out) {
  if (!o.found) continue
  if (o.hits.length >= 2) console.log(o.setId + ' | ' + o.group + ' | ' + o.hits.map((h) => h.id + ' $' + h.market + ' ' + h.name).join(' || '))
}
console.log('sets with 2+ regular arts:', out.filter((o) => o.hits.length >= 2).length, 'of', out.length)
