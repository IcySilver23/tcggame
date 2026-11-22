// One-off generator: turns tmp/dlr/cards.json into the shipped release file.
// Rerun it, never hand-edit server/catalog/local-releases.json.
import fs from 'node:fs'

const cards = JSON.parse(fs.readFileSync('tmp/dlr/cards.json', 'utf8'))

const RARITY = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  'double-rare': 'Double Rare',
  'illustration-rare': 'Illustration Rare',
  'ultra-rare': 'Ultra Rare',
  'special-illustration-rare': 'Special Illustration Rare',
  'mega-hyper-rare': 'Mega Hyper Rare',
}
const TYPE = {
  grass: 'Grass', fire: 'Fire', water: 'Water', lightning: 'Lightning', psychic: 'Psychic',
  fighting: 'Fighting', darkness: 'Darkness', metal: 'Metal', fairy: 'Fairy', dragon: 'Dragon',
  colorless: 'Colorless',
}

const out = {
  release: 'Delta Reign and the 30th Celebration Wave 4 products, 2026-11-06',
  note: 'Releases newer than the upstream catalog. Card identity, numbering and rarity from the published Delta Reign card list (Serebii + YesTCG), prices are TCGplayer market as relayed by YesTCG on 2026-11-05, images from the same image service the catalog uses. Supertype/subtype/type/HP come from Serebii cards. Subtypes of Pokémon are not published in the sources read here, so they stay null rather than being guessed.',
  sets: [
    {
      id: 'me6',
      name: 'Delta Reign',
      series: 'Mega Evolution',
      printed_total: 103,
      total: 141,
      ptcgo_code: 'DLR',
      release_date: '2026/11/06',
      symbol_url: 'https://images.scrydex.com/pokemon/me6-symbol/symbol',
      logo_url: 'https://images.scrydex.com/pokemon/me6-logo/logo',
    },
  ],
  cards: cards.map((c) => ({
    id: `me6-${c.number}`,
    set_id: 'me6',
    name: c.name,
    supertype: c.supertype,
    subtypes: c.subtype ? [c.subtype] : null,
    number: String(c.number),
    position: c.number,
    rarity: RARITY[c.rarity] ?? null,
    types: c.types && c.types.length ? c.types.map((t) => TYPE[t] ?? t) : null,
    hp: c.hp,
    artist: null,
    dex_numbers: null,
    image_small: `https://images.scrydex.com/pokemon/me6-${c.number}/small`,
    image_large: `https://images.scrydex.com/pokemon/me6-${c.number}/large`,
    regulation_mark: null,
    price: c.price > 0
      ? { market: c.price, variant: c.rarity === 'common' || c.rarity === 'uncommon' ? 'normal' : 'holofoil' }
      : null,
  })),
  products: [
    // 30th Celebration's core line: the generic catalog would apply the modern
    // defaults (bundle $26.99, ETB $54.99) and ten cards a pack, while the real
    // wrapper is six cards and the published stickers are $26.94 and $49.99.
    { id: 'me55-booster', set_id: 'me55', name: '30th Celebration Booster Pack', kind: 'booster', msrp: 4.49, packs: 1, cards_per_pack: 6, release_date: '2026/09/16', description: 'Six cards per pack: five foil cards, one of them a guaranteed Pikachu, and a foil Basic Energy.' },
    { id: 'me55-bundle', set_id: 'me55', name: '30th Celebration Booster Bundle', kind: 'bundle', msrp: 26.94, packs: 6, cards_per_pack: 6, release_date: '2026/10/02', description: 'Six booster packs.' },
    { id: 'me55-etb', set_id: 'me55', name: '30th Celebration Elite Trainer Box', kind: 'etb', msrp: 49.99, packs: 9, cards_per_pack: 6, release_date: '2026/09/16', description: 'Nine booster packs, sleeves, dice, a coin and the Nidorina promo.' },
    // Delta Reign's own line. MSRPs are the published ones, not the era
    // defaults the generic catalog would apply (ETB $49.99, bundle $26.94).
    { id: 'me6-booster', set_id: 'me6', name: 'Delta Reign Booster Pack', kind: 'booster', msrp: 4.49, packs: 1, cards_per_pack: 10, release_date: '2026/11/06', description: '10 cards per pack.' },
    { id: 'me6-bundle', set_id: 'me6', name: 'Delta Reign Booster Bundle', kind: 'bundle', msrp: 26.94, packs: 6, cards_per_pack: 10, release_date: '2026/11/06', description: 'Six booster packs.' },
    { id: 'me6-etb', set_id: 'me6', name: 'Delta Reign Elite Trainer Box', kind: 'etb', msrp: 49.99, packs: 9, cards_per_pack: 10, release_date: '2026/11/06', description: 'Nine booster packs, sleeves, dice, a coin and the Kyogre promo.' },
    { id: 'me6-display', set_id: 'me6', name: 'Delta Reign Booster Display (36 packs)', kind: 'display', msrp: 161.64, packs: 36, cards_per_pack: 10, release_date: '2026/11/06', description: '36 booster packs.' },
    // 30th Celebration Wave 4, all released 6 November 2026.
    { id: 'me55-upc-day', set_id: 'me55', name: '30th Celebration Ultra-Premium Collection — Day', kind: 'special', msrp: 179.99, packs: 29, cards_per_pack: 6, release_date: '2026/11/06', description: '29 30th Celebration packs plus one three-card Classic Collection pack, Pikachu ex and Espeon ex promos, playmat, sleeves, deck box and coin.' },
    { id: 'me55-upc-night', set_id: 'me55', name: '30th Celebration Ultra-Premium Collection — Night', kind: 'special', msrp: 179.99, packs: 29, cards_per_pack: 6, release_date: '2026/11/06', description: '29 30th Celebration packs plus one three-card Classic Collection pack, Pikachu ex and Umbreon ex promos, playmat, sleeves, deck box and coin.' },
    { id: 'me55-ditto-premium', set_id: 'me55', name: '30th Celebration Ditto Premium Collection', kind: 'special', msrp: 39.99, packs: 8, cards_per_pack: 6, release_date: '2026/11/06', description: 'Eight booster packs, a Ditto promo and an acrylic card display.' },
    { id: 'me55-figure-mew', set_id: 'me55', name: '30th Celebration Figure Collection — Mew', kind: 'special', msrp: 29.99, packs: 5, cards_per_pack: 6, release_date: '2026/11/06', description: 'Five booster packs, a Mew foil promo and oversize card, and a sculpted figure.' },
    { id: 'me55-figure-mewtwo', set_id: 'me55', name: '30th Celebration Figure Collection — Mewtwo', kind: 'special', msrp: 29.99, packs: 5, cards_per_pack: 6, release_date: '2026/11/06', description: 'Five booster packs, a Mewtwo foil promo and oversize card, and a sculpted figure.' },
  ],
}

fs.mkdirSync('server/catalog', { recursive: true })
fs.writeFileSync('server/catalog/local-releases.json', JSON.stringify(out, null, 1) + '\n')
console.log('wrote server/catalog/local-releases.json', out.sets.length, 'set(s),', out.cards.length, 'card(s),', out.products.length, 'product(s)')
const byRarity = {}
for (const c of out.cards) byRarity[c.rarity] = (byRarity[c.rarity] || 0) + 1
console.log('rarities', byRarity)
console.log('priced', out.cards.filter((c) => c.price).length, 'priced holofoil', out.cards.filter((c) => c.price?.variant === 'holofoil').length)
console.log('sample', JSON.stringify(out.cards[0]), JSON.stringify(out.cards[140]))
