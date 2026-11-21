import fs from 'node:fs'
const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'application/json' } }
const targets = [
  { id: 'sv2', name: 'Paldea Evolved', abbr: 'PAL' },
  { id: 'sv3', name: 'Obsidian Flames', abbr: 'OBF' },
  { id: 'sv3pt5', name: '151', abbr: 'MEW' },
  { id: 'sv4pt5', name: 'Paldean Fates', abbr: 'PAF' },
  { id: 'sv6', name: 'Twilight Masquerade', abbr: 'TWM' },
  { id: 'sv6pt5', name: 'Shrouded Fable', abbr: 'SFA' },
  { id: 'sv7', name: 'Stellar Crown', abbr: 'SCR' },
  { id: 'sv8', name: 'Surging Sparks', abbr: 'SSP' },
  { id: 'sv8pt5', name: 'Prismatic Evolutions', abbr: 'PRE' },
  { id: 'sv9', name: 'Journey Together', abbr: 'JTG' },
  { id: 'sv10', name: 'Destined Rivals', abbr: 'DRI' },
  { id: 'rsv10pt5', name: 'White Flare', abbr: 'WHT' },
  { id: 'zsv10pt5', name: 'Black Bolt', abbr: 'BLK' },
  { id: 'me2', name: 'Phantasmal Flames', abbr: 'PFL' },
  { id: 'me2pt5', name: 'Ascended Heroes', abbr: 'ASH' },
  { id: 'me3', name: 'Perfect Order', abbr: 'POR' },
  { id: 'me4', name: 'Chaos Rising', abbr: 'CRI' },
  { id: 'me5', name: 'Pitch Black', abbr: 'PIB' },
  { id: 'me55', name: '30th Celebration', abbr: '30C' },
  { id: 'me6', name: 'Delta Reign', abbr: 'DLR' },
]
const groups = (await (await fetch('https://tcgcsv.com/tcgplayer/3/groups', UA)).json()).results
const out = []
for (const t of targets) {
  const group =
    groups.find((g) => (g.abbreviation || '').toUpperCase() === t.abbr) ||
    groups.find((g) => (g.name || '').toLowerCase().includes(t.name.toLowerCase()))
  if (!group) { out.push({ ...t, found: false }); continue }
  const [products, prices] = await Promise.all([
    fetch(`https://tcgcsv.com/tcgplayer/3/${group.groupId}/products`, UA).then((r) => r.json()),
    fetch(`https://tcgcsv.com/tcgplayer/3/${group.groupId}/prices`, UA).then((r) => r.json()),
  ])
  const price = new Map(prices.results.map((p) => [p.productId, p]))
  const hits = products.results
    .filter((p) => /pok[eé]mon center/i.test(p.name) && /elite trainer box|etb/i.test(p.name))
    .map((p) => ({ id: p.productId, name: p.name, market: price.get(p.productId)?.marketPrice ?? null, image: p.imageUrl }))
  out.push({ ...t, found: true, group: group.name, groupId: group.groupId, hits })
  await new Promise((r) => setTimeout(r, 150))
}
fs.writeFileSync('tmp/tcgcsv-pc.json', JSON.stringify(out, null, 2))
for (const o of out) {
  if (!o.found) { console.log(o.id, 'NOT FOUND'); continue }
  console.log(o.id, '|', o.group, '|', o.hits.map((h) => `${h.id} $${h.market} ${h.name}`).join(' || ') || 'NO PC ETB')
}
