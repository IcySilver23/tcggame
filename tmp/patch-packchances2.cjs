const fs = require('fs')
const eol = (s) => (s.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s)

function patch(file, from, to) {
  let src = fs.readFileSync(file, 'utf8')
  if (!src.includes(eol(from))) throw new Error('anchor missing in ' + file + ': ' + from.slice(0, 90))
  src = src.replace(eol(from), eol(to))
  fs.writeFileSync(file, src)
  console.log('ok', file)
}

/* 30C has no Uncommon rarity at all, so its blueprint must not plan for one. */
patch(
  'server/services/packs.ts',
  `  me55: [
    { slot: 'common', count: 6 },
    { slot: 'uncommon', count: 1 },
    { slot: 'holo', count: 1 },
    { slot: 'hit', count: 1 },
    { slot: 'subset', count: 1 },
  ],`,
  `  me55: [
    { slot: 'common', count: 7 },
    { slot: 'holo', count: 1 },
    { slot: 'hit', count: 1 },
    { slot: 'subset', count: 1 },
  ],`,
)

/* A set whose blueprint is entirely subset (Classic Collection) IS the subset:
   its cards keep their original rarity labels, so classifying by rarity would
   leave the subset pool empty and the pack would deal nothing. */
patch(
  'server/services/packs.ts',
  `  for (const c of cards) {
    const rank = rarityRank(c.rarity)`,
  `  // Classic Collection keeps each reprint's original rarity label, so the only
  // honest classification is "every card in this set is the subset".
  const allSubset = BLUEPRINTS[setId]?.every((s) => s.slot === 'subset') ?? false

  for (const c of cards) {
    if (allSubset) {
      subsets.push(c)
      continue
    }
    const rank = rarityRank(c.rarity)`,
)

/* Only rebuild tables that can exist — promo sets have no booster product. */
patch(
  'server/index.ts',
  `  const ids = db.prepare(\`SELECT DISTINCT set_id AS id FROM cards\`).all() as { id: string }[]`,
  `  const ids = db
    .prepare(\`SELECT s.id FROM sets s WHERE EXISTS (SELECT 1 FROM pack_products p WHERE p.id = s.id || '-booster')\`)
    .all() as { id: string }[]`,
)
