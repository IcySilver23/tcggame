// Researched collection products for the special sets whose lineups the era
// template never covered. Every row is a real product with a published contents
// list; `packs` is the number of that set's booster packs inside, and `promos`
// are the cards sealed in the box, in source order.
//
// A promo is named only where the catalogue can hand over the actual card. A
// few products include promos this catalogue does not carry (151's Kadabra,
// Abra, Electabuzz and the Venusaur/Blastoise ex promos, Shrouded Fable's
// pre-evolutions, Prismatic's Espeon/Umbreon ex and Surprise Box nine,
// Celebrations' Dragapult Prime and metal cards). Those are named in the
// description and note, never claimed as promo cards, so the opener cannot
// substitute an unrelated printing.
//
// `market` is TCGplayer's market for that exact listing through the tcgcsv
// mirror on 9 November 2026; `productId` is the listing, which is also the
// product photo. `msrp` is the published US shelf price where it is stated.

export type CollectionProduct = {
  id: string
  setId: string
  name: string
  msrp: number
  packs: number
  promos: string[]
  promoIds: string[]
  promoPolicy?: 'all' | 'one-of'
  releaseDate: string
  description: string
  productId: number
  market: number
  note?: string
}

export const COLLECTIONS: CollectionProduct[] = [
  // ------------------------------------------------------- Ultra-Premium
  {
    id: 'swsh1-upc-zacian-zamazenta', setId: 'swsh1', name: 'Sword & Shield Ultra-Premium Collection—Zacian & Zamazenta', msrp: 99.99, packs: 16,
    releaseDate: '2020/11/20', productId: 226136, market: 375.5,
    promos: ['Zacian V', 'Zamazenta V'], promoIds: ['swsh1-211', 'swsh1-212'], promoPolicy: 'all',
    description: 'Sixteen Sword & Shield Series packs, gold Zacian V and Zamazenta V, two metal coins, twelve metal damage-counter dice, 130 sleeves and metal condition markers.',
    note: 'Both gold cards are handed over. The sixteen packs are four each from Sword & Shield, Rebel Clash, Darkness Ablaze and Vivid Voltage, as confirmed by an owner\u2019s opening. The metal accessories are not modelled.',
  },
  {
    id: 'swsh11-upc-charizard', setId: 'swsh11', name: 'Sword & Shield Ultra-Premium Collection—Charizard', msrp: 119.99, packs: 16,
    releaseDate: '2022/10/28', productId: 282401, market: 576.25,
    promos: ['Charizard V', 'Charizard VMAX', 'Charizard VSTAR'], promoIds: ['swshp-SWSH260', 'swshp-SWSH261', 'swshp-SWSH262'], promoPolicy: 'all',
    description: 'Sixteen Sword & Shield Series packs, etched foil Charizard V, Charizard VMAX and Charizard VSTAR promos, a Gigantamax Charizard playmat, 65 sleeves, metal coin, dice and VSTAR marker.',
    note: 'All three promos are handed over. The sixteen packs are three each of Evolving Skies, Fusion Strike, Astral Radiance and Brilliant Stars, two Lost Origin, and one each of Vivid Voltage and Darkness Ablaze. Opening reports say the exact mix can vary. The playmat and metal accessories are not modelled.',
  },
  {
    id: 'swsh11-upc-arceus', setId: 'swsh11', name: 'Arceus VSTAR Ultra-Premium Collection', msrp: 99.99, packs: 15,
    releaseDate: '2022/11/12', productId: 285674, market: 371.05,
    promos: [], promoIds: [],
    description: 'Fifteen Lost Origin packs, metal Arceus V and Arceus VSTAR cards, an Arceus playmat, metal coin, six metal damage-counter dice and an acrylic VSTAR marker.',
    note: 'The two Arceus cards are metal and are not catalogued as paper promos, so neither is substituted. The playmat and accessories are not modelled.',
  },
  {
    id: 'sv6-upc-greninja', setId: 'sv6', name: 'Greninja ex Ultra-Premium Collection', msrp: 119.99, packs: 16,
    releaseDate: '2024/11/01', productId: 594491, market: 498.13,
    promos: ['Greninja ex'], promoIds: ['svp-132'], promoPolicy: 'all',
    description: 'Sixteen Scarlet & Violet packs, a full-art Greninja ex promo, an etched foil Tera Greninja ex, a metal Tera Greninja ex card, playmat, deck box, coin and dice.',
    note: 'The Greninja ex promo is handed over. The etched Tera and metal cards are not catalogued as paper promos, so neither is substituted. The sixteen packs are four Paldea Evolved, two Paradox Rift, two Temporal Forces, four Twilight Masquerade and four Stellar Crown, per an opening of the box.',
  },
  {
    id: 'sv7-upc-terapagos', setId: 'sv7', name: 'Terapagos ex Ultra-Premium Collection', msrp: 119.99, packs: 18,
    releaseDate: '2024/11/22', productId: 575198, market: 252.32,
    promos: ['Cinderace ex', 'Lapras ex', 'Terapagos ex'], promoIds: ['svp-163', 'svp-164', 'svp-165'], promoPolicy: 'all',
    description: 'Eighteen Stellar Crown packs, gold full-art Cinderace ex, Lapras ex and Terapagos ex promos, eight foil Basic Energy cards, a magnetic three-card display, playmat, deck box, coin and dice.',
    note: 'All three promos are handed over. The foil Energy cards and accessories are not modelled.',
  },
  {
    id: 'me2-upc-mega-charizard-x', setId: 'me2', name: 'Mega Charizard X ex Ultra-Premium Collection', msrp: 119.99, packs: 18,
    releaseDate: '2025/11/14', productId: 654213, market: 217.26,
    promos: ['Mega Charizard X ex', 'Oricorio ex'], promoIds: ['mep-023', 'mep-024'], promoPolicy: 'all',
    description: 'Eighteen Mega Evolution and Scarlet & Violet packs, foil Mega Charizard X ex and Oricorio ex promos, 65 sleeves, playmat, deck box, metal coin and dice.',
    note: 'Both promos are handed over. The eighteen packs are four each of Phantasmal Flames, Mega Evolution, Destined Rivals and Journey Together, plus two Surging Sparks; this split comes from an observed opening, while the official copy only states the eighteen-pack total. The sleeves, playmat and metal accessories are not modelled.',
  },
  {
    id: 'sv10-upc-moltres', setId: 'sv10', name: "Team Rocket's Moltres ex Ultra-Premium Collection", msrp: 119.99, packs: 18,
    releaseDate: '2025/11/14', productId: 656997, market: 321.68,
    promos: [], promoIds: [],
    description: "Eighteen Scarlet & Violet packs, three stamped foil Team Rocket's Moltres ex cards (double rare, ultra rare and special illustration rare), a Team Rocket playmat, deck box, metal coin, dice and coin-flip die.",
    note: "The three Moltres cards are Destined Rivals-stamped promos that this catalogue does not carry, so none is substituted. The eighteen packs are two Destined Rivals, two Journey Together, two Temporal Forces, two Paradox Rift, four Obsidian Flames, four Paldea Evolved and two Scarlet & Violet base, following the box-back pack list. The playmat and accessories are not modelled.",
  },

  // ------------------------------------------------------------------ 151
  {
    id: 'sv3pt5-poster-collection', setId: 'sv3pt5', name: '151 Poster Collection', msrp: 14.99, packs: 3,
    releaseDate: '2023/09/22', productId: 502001, market: 80.72,
    promos: ['Bulbasaur', 'Charmander', 'Squirtle'], promoIds: ['svp-46', 'svp-47', 'svp-48'], promoPolicy: 'all',
    description: 'Three 151 packs, foil promos of Bulbasaur, Charmander and Squirtle, and a two-sided poster of the original 151.',
    note: 'All three first-partner promos are inside; the poster is printed matter and is not modelled.',
  },
  {
    id: 'sv3pt5-binder-collection', setId: 'sv3pt5', name: '151 Binder Collection', msrp: 24.99, packs: 4,
    releaseDate: '2023/09/22', productId: 502004, market: 218.08,
    promos: [], promoIds: [],
    description: 'Four 151 packs and a nine-pocket binder that holds 360 cards.',
    note: 'No promo card is part of this product; the binder is not modelled.',
  },
  {
    id: 'sv3pt5-upc', setId: 'sv3pt5', name: '151 Ultra-Premium Collection', msrp: 119.99, packs: 16,
    releaseDate: '2023/10/06', productId: 502005, market: 843.07,
    promos: ['Mew ex', 'Mewtwo'], promoIds: ['svp-53', 'svp-52'], promoPolicy: 'all',
    description: 'Sixteen 151 packs, special illustration rare Mew ex and illustration rare Mewtwo promos, a metal Mew ex card, playmat, deck box and coin.',
    note: 'Both paper promos are handed over. The metal Mew ex card and the playmat are extras the game does not model.',
  },
  {
    id: 'sv3pt5-alakazam-ex-collection', setId: 'sv3pt5', name: '151 Alakazam ex Collection', msrp: 21.99, packs: 4,
    releaseDate: '2023/10/06', productId: 502006, market: 114.7,
    promos: ['Alakazam ex'], promoIds: ['svp-50'], promoPolicy: 'all',
    description: 'Four 151 packs, an Alakazam ex promo, and foil Kadabra and Abra promos.',
    note: 'The Alakazam ex promo is handed over. Its Kadabra and Abra promos are not in this catalogue, so they are described but not substituted.',
  },
  {
    id: 'sv3pt5-zapdos-ex-collection', setId: 'sv3pt5', name: '151 Zapdos ex Collection', msrp: 21.99, packs: 4,
    releaseDate: '2023/10/06', productId: 502007, market: 108.23,
    promos: ['Zapdos ex'], promoIds: ['svp-49'], promoPolicy: 'all',
    description: 'Four 151 packs, a Zapdos ex promo, an Electabuzz foil promo and an oversize Zapdos ex card.',
    note: 'The Zapdos ex promo is handed over; the Electabuzz promo is not catalogued and the oversize card is not modelled.',
  },
  {
    id: 'sv3pt5-blooming-waters', setId: 'sv3pt5', name: '151 Blooming Waters Premium Collection', msrp: 69.99, packs: 12,
    releaseDate: '2025/02/07', productId: 609597, market: 322.15,
    promos: ['Bulbasaur', 'Squirtle'], promoIds: ['svp-46', 'svp-48'], promoPolicy: 'all',
    description: 'Twelve 151 packs, foil Venusaur ex and Blastoise ex, foil Bulbasaur and Squirtle, and an oversize Blastoise ex.',
    note: 'Bulbasaur and Squirtle are handed over. Venusaur ex and Blastoise ex are not catalogued as promos here, so they are described only.',
  },

  // -------------------------------------------------------- Paldean Fates
  {
    id: 'sv4pt5-tech-sticker-fidough', setId: 'sv4pt5', name: 'Paldean Fates Tech Sticker Collection (Fidough)', msrp: 15.99, packs: 3,
    releaseDate: '2024/01/26', productId: 528043, market: 73.7,
    promos: ['Fidough'], promoIds: ['svp-69'], promoPolicy: 'all',
    description: 'Three Paldean Fates packs, a Shiny Fidough promo and a matching tech sticker sheet.',
  },
  {
    id: 'sv4pt5-tech-sticker-maschiff', setId: 'sv4pt5', name: 'Paldean Fates Tech Sticker Collection (Maschiff)', msrp: 15.99, packs: 3,
    releaseDate: '2024/01/26', productId: 528044, market: 71.4,
    promos: ['Maschiff'], promoIds: ['svp-71'], promoPolicy: 'all',
    description: 'Three Paldean Fates packs, a Shiny Maschiff promo and a matching tech sticker sheet.',
  },
  {
    id: 'sv4pt5-tech-sticker-greavard', setId: 'sv4pt5', name: 'Paldean Fates Tech Sticker Collection (Greavard)', msrp: 15.99, packs: 3,
    releaseDate: '2024/01/26', productId: 528045, market: 72.86,
    promos: ['Greavard'], promoIds: ['svp-70'], promoPolicy: 'all',
    description: 'Three Paldean Fates packs, a Shiny Greavard promo and a matching tech sticker sheet.',
  },
  {
    id: 'sv4pt5-premium-meowscarada', setId: 'sv4pt5', name: 'Paldean Fates Pokémon ex Premium Collection (Meowscarada ex)', msrp: 49.99, packs: 8,
    releaseDate: '2024/02/09', productId: 528079, market: 240.07,
    promos: ['Sprigatito', 'Floragato', 'Meowscarada ex'], promoIds: ['svp-76', 'svp-77', 'svp-78'], promoPolicy: 'all',
    description: 'Eight Paldean Fates packs, the full Shiny Sprigatito line as promos, an oversize Meowscarada ex and a magnetic three-card display.',
    note: 'All three promos are inside; the magnetic display is not modelled.',
  },
  {
    id: 'sv4pt5-premium-skeledirge', setId: 'sv4pt5', name: 'Paldean Fates Pokémon ex Premium Collection (Skeledirge ex)', msrp: 49.99, packs: 8,
    releaseDate: '2024/02/09', productId: 528080, market: 242.61,
    promos: ['Fuecoco', 'Crocalor', 'Skeledirge ex'], promoIds: ['svp-79', 'svp-80', 'svp-81'], promoPolicy: 'all',
    description: 'Eight Paldean Fates packs, the full Shiny Fuecoco line as promos, an oversize Skeledirge ex and a magnetic three-card display.',
  },
  {
    id: 'sv4pt5-premium-quaquaval', setId: 'sv4pt5', name: 'Paldean Fates Pokémon ex Premium Collection (Quaquaval ex)', msrp: 49.99, packs: 8,
    releaseDate: '2024/02/09', productId: 528082, market: 230.06,
    promos: ['Quaxly', 'Quaxwell', 'Quaquaval ex'], promoIds: ['svp-82', 'svp-83', 'svp-84'], promoPolicy: 'all',
    description: 'Eight Paldean Fates packs, the full Shiny Quaxly line as promos, an oversize Quaquaval ex and a magnetic three-card display.',
  },
  {
    id: 'sv4pt5-tusk-treads-premium', setId: 'sv4pt5', name: 'Paldean Fates Great Tusk ex & Iron Treads ex Premium Collection', msrp: 49.99, packs: 11,
    releaseDate: '2024/02/09', productId: 665113, market: 257.21,
    promos: ['Great Tusk ex', 'Iron Treads ex'], promoIds: ['svp-72', 'svp-73'], promoPolicy: 'all',
    description: 'Eleven Paldean Fates packs, Shiny Great Tusk ex and Iron Treads ex promos, their regular cards, and an oversize Great Tusk ex.',
    note: 'Both ex promos are handed over; the two regular cards are the set printings, which the packs may also hold.',
  },

  // -------------------------------------------------------- Shrouded Fable
  {
    id: 'sv6pt5-kingambit-collection', setId: 'sv6pt5', name: 'Shrouded Fable Kingambit Illustration Collection', msrp: 21.99, packs: 4,
    releaseDate: '2024/08/02', productId: 553000, market: 51.46,
    promos: ['Kingambit'], promoIds: ['svp-130'], promoPolicy: 'all',
    description: 'Four Shrouded Fable packs and a Kingambit illustration rare-style promo in ukiyo-e art, with Pawniard and Bisharp foil promos.',
    note: 'The Kingambit promo is handed over; the Pawniard and Bisharp promos are not catalogued, so they are described only.',
  },
  {
    id: 'sv6pt5-kingdra-collection', setId: 'sv6pt5', name: 'Shrouded Fable Kingdra ex Special Illustration Collection', msrp: 29.99, packs: 5,
    releaseDate: '2024/08/02', productId: 553001, market: 184.38,
    promos: ['Kingdra ex', 'Horsea'], promoIds: ['svp-131', 'svp-137'], promoPolicy: 'all',
    description: 'Five Shrouded Fable packs, a Kingdra ex special illustration rare-style promo in ukiyo-e art, and Horsea and Seadra foil promos.',
    note: 'Kingdra ex and Horsea are handed over; Seadra is not catalogued as a promo here.',
  },
  {
    id: 'sv6pt5-greninja-collection', setId: 'sv6pt5', name: 'Shrouded Fable Greninja ex Special Illustration Collection', msrp: 29.99, packs: 5,
    releaseDate: '2024/08/02', productId: 553002, market: 207.73,
    promos: ['Greninja ex'], promoIds: ['svp-132'], promoPolicy: 'all',
    description: 'Five Shrouded Fable packs, a Greninja ex special illustration rare-style promo in ukiyo-e art, and Froakie and Frogadier foil promos.',
    note: 'The Greninja ex promo is handed over; the two pre-evolution promos are not catalogued here.',
  },

  // ---------------------------------------------------- Prismatic Evolutions
  {
    id: 'sv8pt5-binder-collection', setId: 'sv8pt5', name: 'Prismatic Evolutions Binder Collection', msrp: 34.99, packs: 5,
    releaseDate: '2025/01/17', productId: 593356, market: 106.22,
    promos: [], promoIds: [],
    description: 'Five Prismatic Evolutions packs and a nine-pocket binder that holds 378 cards.',
    note: 'No promo card is part of this product.',
  },
  {
    id: 'sv8pt5-poster-collection', setId: 'sv8pt5', name: 'Prismatic Evolutions Poster Collection', msrp: 19.99, packs: 3,
    releaseDate: '2025/01/17', productId: 593359, market: 40.25,
    promos: ['Flareon', 'Vaporeon', 'Jolteon'], promoIds: ['svp-167', 'svp-168', 'svp-169'], promoPolicy: 'all',
    description: 'Three Prismatic Evolutions packs, Flareon, Vaporeon and Jolteon promos, and a two-sided poster of Eevee and its Evolutions.',
  },
  {
    id: 'sv8pt5-tech-sticker-leafeon', setId: 'sv8pt5', name: 'Prismatic Evolutions Tech Sticker Collection (Leafeon)', msrp: 15.99, packs: 3,
    releaseDate: '2025/01/17', productId: 593453, market: 38.05,
    promos: ['Leafeon'], promoIds: ['svp-170'], promoPolicy: 'all',
    description: 'Three Prismatic Evolutions packs, a Leafeon promo and a matching sticker sheet.',
  },
  {
    id: 'sv8pt5-tech-sticker-glaceon', setId: 'sv8pt5', name: 'Prismatic Evolutions Tech Sticker Collection (Glaceon)', msrp: 15.99, packs: 3,
    releaseDate: '2025/01/17', productId: 593451, market: 42.14,
    promos: ['Glaceon'], promoIds: ['svp-171'], promoPolicy: 'all',
    description: 'Three Prismatic Evolutions packs, a Glaceon promo and a matching sticker sheet.',
  },
  {
    id: 'sv8pt5-tech-sticker-sylveon', setId: 'sv8pt5', name: 'Prismatic Evolutions Tech Sticker Collection (Sylveon)', msrp: 15.99, packs: 3,
    releaseDate: '2025/01/17', productId: 593450, market: 46.38,
    promos: ['Sylveon'], promoIds: ['svp-172'], promoPolicy: 'all',
    description: 'Three Prismatic Evolutions packs, a Sylveon promo and a matching sticker sheet.',
  },
  {
    id: 'sv8pt5-surprise-box', setId: 'sv8pt5', name: 'Prismatic Evolutions Surprise Box', msrp: 32.99, packs: 4,
    releaseDate: '2025/02/07', productId: 593466, market: 62.92,
    promos: [], promoIds: [],
    description: 'Four Prismatic Evolutions packs, one of nine randomly selected Stellar Tera Eevee or Eeveelution ex promos, and a storage box with four dividers.',
    note: 'The promo is one of nine; none of that nine is catalogued as a promo here, so no card is guessed and the box is sold for its packs and storage box.',
  },
  {
    id: 'sv8pt5-accessory-pouch', setId: 'sv8pt5', name: 'Prismatic Evolutions Accessory Pouch Special Collection', msrp: 32.99, packs: 5,
    releaseDate: '2025/04/25', productId: 606881, market: 73.5,
    promos: [], promoIds: [],
    description: 'Five Prismatic Evolutions packs and an Eevee accessory pouch.',
    note: 'No promo card is part of this product.',
  },
  {
    id: 'sv8pt5-spc', setId: 'sv8pt5', name: 'Prismatic Evolutions Super-Premium Collection', msrp: 119.99, packs: 15,
    releaseDate: '2025/05/16', productId: 622770, market: 240.24,
    promos: ['Eevee ex'], promoIds: ['svp-174'], promoPolicy: 'all',
    description: 'Fifteen Prismatic Evolutions packs, an Eevee ex special illustration rare-style promo, a fuzzy Eevee deck box, playmat and 65 sleeves.',
    note: 'The Eevee ex promo is handed over; the accessories are not modelled.',
  },
  {
    id: 'sv8pt5-figure-collection', setId: 'sv8pt5', name: 'Prismatic Evolutions Premium Figure Collection', msrp: 54.99, packs: 11,
    releaseDate: '2025/09/26', productId: 650799, market: 206.02,
    promos: [], promoIds: [],
    description: 'Eleven Prismatic Evolutions packs, etched Espeon ex and Umbreon ex promos, an Espeon and Umbreon figure, pin and 65 sleeves.',
    note: 'The two etched promos are not catalogued here, so neither is substituted; the box is sold for its packs, figure and accessories.',
  },

  // ------------------------------------------------------------- Celebrations
  {
    id: 'cel25-dragapult-prime', setId: 'cel25', name: 'Celebrations Collection (Dragapult Prime)', msrp: 14.99, packs: 3,
    releaseDate: '2021/10/08', productId: 242807, market: 82.52,
    promos: [], promoIds: [],
    description: 'Two four-card Celebrations packs, one additional booster pack, a Dragapult Prime promo and oversize card, and a four-pocket binder.',
    note: 'The Dragapult Prime promo is not in this catalogue, so no card is substituted. The box opens all three wrappers it holds: its two four-card Celebrations packs, then the standard ten-card booster the contents list only calls “one additional Pokémon TCG booster pack”. That expansion is not named on the box, so it is dealt as a Chilling Reign pack — a set on shelves when this collection shipped in October 2021 — and that pick is this build’s choice. The four-pocket binder and anniversary coin are not modelled.',
  },
  {
    id: 'cel25-deluxe-pin', setId: 'cel25', name: 'Celebrations Deluxe Pin Collection', msrp: 19.99, packs: 6,
    releaseDate: '2021/10/08', productId: 242810, market: 133.12,
    promos: ['Zacian LV.X'], promoIds: ['swshp-SWSH135'], promoPolicy: 'all',
    description: 'Four Celebrations packs, two additional booster packs, a Zacian LV.X promo, and an enamel Flying and Surfing Pikachu pin.',
    note: 'The Zacian LV.X promo is handed over, and the box opens all six wrappers it holds: its four four-card Celebrations packs, then the two standard ten-card boosters the contents list only calls “two additional Pokémon TCG booster packs”. Those expansions are not named on the box, so they are dealt as one Chilling Reign and one Evolving Skies pack — sets on shelves when this collection shipped in October 2021 — and that pair is this build’s choice. The configurable Flying and Surfing Pikachu pin is not modelled.',
  },
  {
    id: 'cel25-v-memories', setId: 'cel25', name: 'Celebrations Special Collection—V Memories', msrp: 39.99, packs: 8,
    releaseDate: '2021/10/08', productId: 247470, market: 197.49,
    promos: ["Lance's Charizard V", 'Dark Sylveon V'], promoIds: ['swshp-SWSH133', 'swshp-SWSH134'], promoPolicy: 'all',
    description: 'Six Celebrations packs, two additional booster packs, Lance’s Charizard V and Dark Sylveon V promos, a pin and a coin.',
    note: 'Both promos are inside, and the box opens all eight wrappers it holds: its six four-card Celebrations packs, then the two standard ten-card boosters the contents list only calls “2 additional Pokémon TCG boosters”. Those expansions are not named on the box, so they are dealt as one Chilling Reign and one Evolving Skies pack — sets on shelves when this collection shipped in October 2021 — and that pair is this build’s choice. The Sylveon pin and Charizard coin are not modelled; the box is priced at its TCGplayer market.',
  },
  {
    id: 'cel25-pikachu-v-union', setId: 'cel25', name: 'Celebrations Special Collection—Pikachu V-UNION', msrp: 29.99, packs: 6,
    releaseDate: '2021/10/08', productId: 244726, market: 189.08,
    promos: ['Pikachu V-UNION', 'Pikachu V-UNION', 'Pikachu V-UNION', 'Pikachu V-UNION', 'Professor Burnet'],
    promoIds: ['swshp-SWSH139', 'swshp-SWSH140', 'swshp-SWSH141', 'swshp-SWSH142', 'swshp-SWSH167'], promoPolicy: 'all',
    description: 'Four Celebrations packs, two additional booster packs, the four cards that form Pikachu V-UNION, its oversize card, and a Professor Burnet Supporter promo.',
    note: 'All four Pikachu V-UNION pieces (SWSH139-142) and Professor Burnet are handed over, and the box opens all six wrappers it holds: the four four-card Celebrations packs, then the two standard ten-card boosters. Product copy does not name those two expansions, so they are dealt as one Chilling Reign and one Evolving Skies pack — the sets on shelves when the box shipped in October 2021. The oversize card is not modelled.',
  },
  {
    id: 'cel25-premium-figure', setId: 'cel25', name: 'Celebrations Premium Figure Collection—Pikachu VMAX', msrp: 49.99, packs: 11,
    releaseDate: '2021/10/22', productId: 245139, market: 296.52,
    promos: [], promoIds: [],
    description: 'Eight Celebrations packs, three additional booster packs, Pikachu VMAX and Pikachu V promos, and a Gigantamax Pikachu figure.',
    note: 'The two Pikachu promos are not catalogued in this build, so neither is substituted. The box opens all eleven wrappers it holds: its eight four-card Celebrations packs, then the three standard ten-card boosters the contents list only calls “3 additional Pokémon TCG booster packs”. Those expansions are not named on the box, so they are dealt as one each of Chilling Reign, Evolving Skies and Battle Styles — sets on shelves when this collection shipped in October 2021 — and that pick is this build’s choice. The supersize Gigantamax Pikachu figure is not modelled.',
  },
  {
    id: 'cel25-upc', setId: 'cel25', name: 'Celebrations Ultra-Premium Collection', msrp: 119.99, packs: 25,
    releaseDate: '2021/10/22', productId: 245140, market: 1206.87,
    promos: [], promoIds: [],
    description: 'Seventeen Celebrations packs, eight additional Sword & Shield packs, metal Base Set Pikachu and Charizard cards, gold Pikachu V and gold Poké Ball promos, a coin, pin and storage box.',
    note: 'The metal and gold cards are not catalogued as promos here, so none is substituted. The box opens all twenty-five wrappers it holds: its seventeen four-card Celebrations packs, then the eight standard ten-card boosters the contents list only calls “8 additional Pokémon TCG booster packs”. Those expansions are not named on the box, so they are dealt as two each of Chilling Reign, Evolving Skies, Battle Styles and Vivid Voltage — sets on shelves when this box shipped in October 2021 — and that split is this build’s choice. The two metal cards, the gold Pikachu V and Poké Ball, the pin, coin and storage boxes are not modelled.',
  },
]
