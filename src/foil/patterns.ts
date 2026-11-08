// Every foil pattern the printing database can name.
//
// This is the registry requirement 7 asks for: a printing points at a pattern
// ID, and adding a pattern is a row here — not a new branch in the renderer.
// `implemented` says whether this build ships a texture for the pattern; the
// Cosmos rows are the only ones that do (plus Radiant, which owns a motif per
// card rather than a shared sheet). An unimplemented pattern still resolves, and
// the overlay falls back to the generic tile, so a printing that is identified
// but not yet painted is never silently described as something else.
//
// Sources: Bulbapedia's Cosmos and Holofoil pages, which name each pattern and
// the set range that used it.

export type FoilPatternId =
  | 'starlight' | 'cosmos-retro' | 'cosmos-hd' | 'tinsel' | 'sheen' | 'waterweb' | 'line' | 'mirage' | 'plain-holo'
  | 'crackedice' | 'crosshatch' | 'mirror' | 'sequin' | 'confetti' | 'radiant' | 'radiant-etched' | 'fireworks'
  | 'reverse-fireworks' | 'reverse-flat' | 'reverse-energy-symbol' | 'reverse-pinwheel'
  | 'reverse-pokeball' | 'reverse-flat-background' | 'reverse-type-symbol'
  | 'reverse-type-symbol-large' | 'reverse-energy-large' | 'reverse-tile' | 'reverse-tile-intricate'
  | 'reverse-pokeball-large' | 'reverse-pokeball-rows'
  | 'reverse-masterball-large' | 'reverse-masterball-rows'
  | 'reverse-pokeball-assigned-large'
  | 'reverse-loveball-large' | 'reverse-friendball-large' | 'reverse-quickball-large'
  | 'reverse-duskball-large' | 'reverse-teamrocket-large'
  | 'textured-full-art' | 'special-treatment' | 'unresolved'

export type FoilFamily = 'era' | 'promo' | 'reverse' | 'special' | 'chase'

export type PatternEntry = {
  id: FoilPatternId
  label: string
  family: FoilFamily
  /** Human-readable range this pattern is documented on. */
  years: string
  /** True when this build has a texture for it. */
  implemented: boolean
  /** Same-origin sheet, when there is one. */
  texture?: string
  note: string
  source: string
}

const BULBA_HOLO = 'https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)'
const FOILFOX = 'https://foilfox.app/guides/pokemon-finishes'
const BULBA_COSMOS = 'https://bulbapedia.bulbagarden.net/wiki/Cosmos_Holofoil_(TCG)'

export const PATTERNS: Record<FoilPatternId, PatternEntry> = {
  starlight: {
    id: 'starlight', label: 'Starlight', family: 'era', years: 'Base – Fossil (1999)',
    implemented: true, texture: '/foil/starlight/sheet.png',
    note: 'Four-point starbursts of several sizes, spread evenly, with a slightly blurry edge. This build draws the sheet procedurally; no scan of the 1999 sheet exists here.',
    source: BULBA_HOLO,
  },
  'cosmos-retro': {
    id: 'cosmos-retro', label: 'Cosmos · retro (pixel)', family: 'era', years: 'Base Set 2 – Call of Legends (2000–2011)',
    implemented: true, texture: '/foil/cosmos/classic_dense.png',
    note: 'Coarse printed orbs, fine speckle and small four-point stars. The default English holo paper for eleven years.',
    source: BULBA_COSMOS,
  },
  'cosmos-hd': {
    id: 'cosmos-hd', label: 'Cosmos · HD', family: 'promo', years: 'post-2013 promo printings',
    implemented: true, texture: '/foil/cosmos/modern_fine.png',
    note: 'The modernised Cosmos paper that replaced the retro one around 2013: rounder, finer marks.',
    source: 'https://sleevenocardbehind.com/pokemon-151-secret-variants/',
  },
  tinsel: {
    id: 'tinsel', label: 'Tinsel', family: 'era', years: 'Black & White – Legendary Treasures (2011–2013)',
    implemented: true, texture: '/foil/tinsel/sheet.png',
    note: 'Horizontal stripes across the image, the Generation V holo paper. This build draws the stripes: the identification is verified, the texture is not a scan. Black Bolt & White Flare are left unpainted because the sources disagree about which printings carry it — see tinsel-index.ts.', source: BULBA_HOLO,
  },
  sheen: {
    id: 'sheen', label: 'Sheen', family: 'era', years: 'XY – (2014–)',
    implemented: false, note: 'Diagonal refraction; Japanese cards cover the whole card, international ones the art.', source: BULBA_HOLO,
  },
  waterweb: {
    id: 'waterweb', label: 'Water Web', family: 'era', years: 'Sun & Moon – Cosmic Eclipse (2017–2019)',
    implemented: true, texture: '/foil/waterweb/sheet.png',
    note: 'A wavy pattern similar to flowing water. Bulbapedia names it for every standard Holo card from Sun & Moon to Cosmic Eclipse. This build draws the waves (eight bands, undulating twice down the sheet): the look and the era are sourced, the geometry is not.', source: BULBA_HOLO,
  },
  line: {
    id: 'line', label: 'Line', family: 'era', years: 'Sword & Shield – Crown Zenith (2020–2023)',
    implemented: true, texture: '/foil/line/sheet.png',
    note: 'Thin vertical lines that refract light from the top to the bottom of the image. Bulbapedia names it for standard Holo cards from Sword & Shield through Crown Zenith. This build draws the ruled sheet at an 8px pitch: the orientation and direction are sourced, the pitch and drift depth are not.', source: BULBA_HOLO,
  },
  mirage: {
    id: 'mirage', label: 'Mirage', family: 'era', years: 'Scarlet & Violet onward (2023–)',
    implemented: true, texture: '/foil/mirage/sheet.png',
    note: 'A smooth sheen that refracts light horizontally rather than diagonally — the Sheen paper rotated, with foil silver borders on standard holos. This build draws the sweep (two broad bands, high floor): the direction and the look are sourced, and the band spacing is measured from tilt footage of the real promos, but the texture is still a drawing and the silver border is not modelled.', source: BULBA_HOLO,
  },
  crackedice: {
    id: 'crackedice', label: 'Cracked Ice', family: 'promo', years: 'Platinum theme decks and blisters (2009–)',
    implemented: true, texture: '/foil/crackedice/sheet.png',
    note: 'Irregular shattered-glass facets with thin bright cracks. This build draws the sheet procedurally; only Frost Rotom (Rising Rivals RT2) is a named printing here.',
    source: BULBA_HOLO,
  },
  crosshatch: {
    id: 'crosshatch', label: 'Crosshatch', family: 'promo',
    years: 'Play! Pokémon event awards (BW era to the 2015-16 season)',
    implemented: true, texture: '/foil/crosshatch/sheet.png',
    note: 'Intersecting diagonal lines forming a reflective grid, applied to the card body. The three BW Victory Cup promos carry it here. This build draws the lattice: the two families and the grid are sourced, the pitch and line width are not. The sheet does not tile, so a card samples one window.',
    source: BULBA_HOLO,
  },
  'plain-holo': {
    id: 'plain-holo', label: 'Plain holo', family: 'era',
    years: 'EX Delta Species – EX Dragon Frontiers δ holo rares (2005–2006)',
    implemented: true,
    note: 'A holo printing with no printed pattern: the paper reflects as uniform light. Bulbapedia gives the δ Delta Species holo rares this treatment instead of the era Cosmos sheet, so the correct layer is a plain MarkField — there is no missing texture to draw, and no sheet is borrowed. The δ marker is in the card name; src/foil/delta-species-index.ts (GENERATED) lists the 50 cards.',
    source: BULBA_HOLO,
  },
  mirror: {
    id: 'mirror', label: 'Mirror / Sheen', family: 'promo',
    years: 'BW-era promo variants (2011–2013); the XY-onward holo paper by its other name',
    implemented: true, texture: '/foil/mirror/sheet.png',
    note: 'A smooth, mark-free foil that refracts light diagonally — bottom right to top left on international cards. Bulbapedia calls the BW printings Mirror and the XY-onward paper Sheen; this build treats them as one paper. Nine BW Black Star Promos carry it. The sheet is a drawing: the direction is sourced, the contrast and band count are not.',
    source: BULBA_HOLO,
  },
  sequin: {
    id: 'sequin', label: 'Sequin', family: 'promo', years: 'General Mills mini packs (2017–)',
    implemented: true, texture: '/foil/sequin/sheet.png',
    note: 'Many small reflective geometric shapes scattered across the image, giving a sequined appearance — Bulbapedia\'s description of the paper that is exclusive to the General Mills Sun & Moon, Let\'s Go Kanto! and 25th Anniversary mini packs. This build draws the shapes as regular polygons of three to six sides: the identification is sourced, the count, size and density are not. Nineteen cards carry it — the Sun & Moon promos, the five Let\'s Go reprints and the six 25th Anniversary promos Bulbapedia\'s Sequin tables name — and each resolves by card id in `printing-db.ts` only for the explicit `sequinHolofoil` variant, so the plain promo of the same number makes no foil claim; `reports/sequin-printings.md` records the split.',
    source: BULBA_HOLO,
  },
  confetti: {
    id: 'confetti', label: 'Pixel / Confetti', family: 'special', years: "McDonald's Collections, Celebrations and 30th Celebration Classic Collections",
    implemented: true, texture: '/foil/confetti/sheet.png',
    note: 'Small, blocky reflective shapes scattered across the image, like pieces of confetti. Bulbapedia names the paper for the McDonald\'s Collections and the Celebrations Classic Collection, and the 2026 30th Celebration Classic Collection carries it too. This build draws the flakes: the identification is sourced, the block sizes, density and brightness are not.', source: BULBA_HOLO,
  },
  radiant: {
    id: 'radiant', label: 'Radiant Collection', family: 'special', years: 'Legendary Treasures RC, Generations RC',
    implemented: true, note: 'One reconstructed concept motif per RC card; coverage researched per printing.', source: BULBA_HOLO,
  },
  'radiant-etched': {
    id: 'radiant-etched', label: 'Radiant Pokémon (etched silver)', family: 'chase',
    years: 'Astral Radiance – Crown Zenith (2022)',
    implemented: true, texture: '/foil/radiant-etched/sheet.png',
    note: 'Etched, embossed silver foil across the whole card. Identified from Bulbapedia ("a special holofoil layer") and a collector guide ("covering the entire card"); the sheet is a DRAWING — a 16px etch inside a 128px diamond grid — because the sources name the finish and its area, not a repeat, so the texture is unverified. Distinct from Radiant Collection, which is a 2013 RC subset with one motif per card.',
    source: BULBA_HOLO,
  },
  fireworks: {
    id: 'fireworks', label: 'Fireworks', family: 'reverse', years: 'Legendary Collection (2002)',
    implemented: false, note: 'The reverse paper of Legendary Collection: firework bursts over the card body.', source: BULBA_HOLO,
  },
  'reverse-fireworks': {
    id: 'reverse-fireworks', label: 'Reverse · Fireworks', family: 'reverse', years: 'Legendary Collection (2002)',
    implemented: true, texture: '/foil/reverse/fireworks/pattern.png',
    note: 'Fireworks over the whole card apart from the artwork.', source: BULBA_HOLO,
  },
  'reverse-flat': {
    id: 'reverse-flat', label: 'Reverse · Flat', family: 'reverse', years: 'Expedition – EX Team Magma vs Team Aqua; Diamond & Pearl – Black & White',
    implemented: true, note: 'A flat holographic finish over everything but the artwork.', source: BULBA_HOLO,
  },
  'reverse-energy-symbol': {
    id: 'reverse-energy-symbol', label: 'Reverse · Energy symbols', family: 'reverse', years: 'EX Hidden Legends – EX Team Rocket Returns',
    implemented: true, texture: '/foil/type-symbol/grass.png',
    note: "The card's own energy symbol repeated behind the Pokémon inside the picture window. This build samples the stylised type-symbol sheets at a tighter repeat; an unknown type gets plain foil.",
    source: BULBA_HOLO,
  },
  'reverse-pinwheel': {
    id: 'reverse-pinwheel', label: 'Reverse · Pinwheel', family: 'reverse', years: 'EX Deoxys',
    implemented: true, texture: '/foil/reverse/pinwheel/pattern.png',
    note: 'Pinwheel pattern with the set logo bottom-right.', source: BULBA_HOLO,
  },
  'reverse-pokeball': {
    id: 'reverse-pokeball', label: 'Reverse · Poké Ball', family: 'reverse', years: 'EX Emerald – EX Unseen Forces',
    implemented: true, texture: '/foil/reverse/pokeball/pattern.png',
    note: 'Poké Ball and stars (3D from Unseen Forces), set logo in the window.', source: BULBA_HOLO,
  },
  'reverse-flat-background': {
    id: 'reverse-flat-background', label: 'Reverse · Flat background', family: 'reverse', years: 'EX Delta Species – EX Power Keepers; Dragon Frontiers on the Pokémon',
    implemented: true,
    note: 'Plain foil inside the artwork background rather than across the card body. No marks to draw; the printed exclusion of the Pokémon is approximated by the window mask.',
    source: BULBA_HOLO,
  },
  'reverse-type-symbol': {
    id: 'reverse-type-symbol', label: 'Reverse · Type symbol', family: 'reverse', years: 'Emerging Powers – Steam Siege',
    implemented: true, texture: '/foil/type-symbol/grass.png',
    note: "The card's own type symbol repeated over the card body, a Poké Ball for Trainers. This build draws twelve stylised glyphs; the glyph is chosen from the card's type and an unknown type gets plain foil.",
    source: BULBA_HOLO,
  },
  'reverse-type-symbol-large': {
    id: 'reverse-type-symbol-large', label: 'Reverse · Large type symbol', family: 'reverse', years: 'Sun & Moon – Cosmic Eclipse',
    implemented: true, texture: '/foil/type-symbol/large-grass.png',
    note: 'A large type symbol on the left of the card; the glyph is chosen from the card’s type.', source: BULBA_HOLO,
  },
  'reverse-energy-large': {
    id: 'reverse-energy-large', label: 'Reverse · Energy symbol (one large)', family: 'reverse', years: 'Ascended Heroes (2026)',
    implemented: true, texture: '/foil/reverse/energy/water.png',
    note: "One large symbol for the card's own type behind the attack text, on the card body. The single-stamp layout and approximate size are measured from a real Energy reverse; the glyphs are stylised drawings, not official icons, and an unknown type gets plain foil.",
    source: 'https://www.pokebeach.com/2026/01/ascended-heroes-set-guide-full-set-list-god-packs-reverse-holos-product-lineup-and-more',
  },
  'reverse-tile': {
    id: 'reverse-tile', label: 'Reverse · Tile', family: 'reverse', years: 'Sword & Shield – Crown Zenith',
    implemented: true, texture: '/foil/reverse/tile/grass.png',
    note: "Tiles each containing the card's own type symbol, a Poké Ball for Trainers. This build draws a staggered tile lattice and twelve stylised glyphs; an unknown type gets plain foil.",
    source: BULBA_HOLO,
  },
  'reverse-tile-intricate': {
    id: 'reverse-tile-intricate', label: 'Reverse · Intricate tile', family: 'reverse', years: 'Scarlet & Violet onward',
    implemented: true, texture: '/foil/reverse/tile-intricate/grass.png',
    note: "Nested tiles carrying the card's own type symbol at different sizes, a Poké Ball for Trainers. This build draws a nested lattice and twelve stylised glyphs; an unknown type gets plain foil.",
    source: BULBA_HOLO,
  },
  'reverse-pokeball-large': {
    id: 'reverse-pokeball-large', label: 'Reverse · Poké Ball (one large)', family: 'reverse', years: 'Prismatic Evolutions, Ascended Heroes (2025–2026)',
    implemented: true, texture: '/foil/reverse/special/reverse-pokeball-large.png',
    note: 'One large Poké Ball behind the attack text, on the frame and text box. The finish, ball and layout are documented; the glyph and shattered-glass layer are drawn here.',
    source: FOILFOX,
  },
  'reverse-pokeball-rows': {
    id: 'reverse-pokeball-rows', label: 'Reverse · Poké Ball (rows)', family: 'reverse', years: 'Black Bolt, White Flare (2025)',
    implemented: true, texture: '/foil/reverse/special/reverse-pokeball-rows.png',
    note: 'Rows of Poké Balls across the frame and text box. The finish and layout are documented; the glyph artwork is a procedural drawing.',
    source: FOILFOX,
  },
  'reverse-masterball-large': {
    id: 'reverse-masterball-large', label: 'Reverse · Master Ball (one large)', family: 'reverse', years: 'Prismatic Evolutions (2025)',
    implemented: true, texture: '/foil/reverse/special/reverse-masterball-large.png',
    note: 'One large Master Ball behind the attack text, with an M on the upper half. Documented finish and layout; drawn artwork.',
    source: FOILFOX,
  },
  'reverse-masterball-rows': {
    id: 'reverse-masterball-rows', label: 'Reverse · Master Ball (rows)', family: 'reverse', years: 'Black Bolt, White Flare (2025)',
    implemented: true, texture: '/foil/reverse/special/reverse-masterball-rows.png',
    note: 'Rows of Master Balls, each with an M on the upper half. Documented finish and layout; drawn artwork.',
    source: FOILFOX,
  },
  'reverse-pokeball-assigned-large': {
    id: 'reverse-pokeball-assigned-large', label: 'Poké Ball · Ascended Heroes', family: 'special',
    years: 'Ascended Heroes (2026)',
    implemented: true, texture: '/foil/reverse/special/reverse-pokeball-assigned-large.png',
    note: 'One large Poké Ball behind the attack text, the same design Prismatic Evolutions prints but its own sheet: a real Ascended Heroes Snorunt reverse measures the outer ring at 0.434 of the card width across, centred about 0.675 down. The card’s assigned stamp, not a rolled ball.',
    source: 'https://www.pokebeach.com/2026/01/ascended-heroes-set-guide-full-set-list-god-packs-reverse-holos-product-lineup-and-more',
  },
  'reverse-loveball-large': {
    id: 'reverse-loveball-large', label: 'Reverse · Love Ball (one large)', family: 'reverse', years: 'Ascended Heroes (2026)',
    implemented: true, texture: '/foil/reverse/special/reverse-loveball-large.png',
    note: 'One large Love Ball behind the attack text, on the frame and text box. The paper and its assigned cards are documented; the ball artwork and its heart are drawn here.',
    source: FOILFOX,
  },
  'reverse-friendball-large': {
    id: 'reverse-friendball-large', label: 'Reverse · Friend Ball (one large)', family: 'reverse', years: 'Ascended Heroes (2026)',
    implemented: true, texture: '/foil/reverse/special/reverse-friendball-large.png',
    note: 'One large Friend Ball behind the attack text, on the frame and text box. The paper and its assigned cards are documented; the ball artwork and its flower are drawn here.',
    source: FOILFOX,
  },
  'reverse-quickball-large': {
    id: 'reverse-quickball-large', label: 'Reverse · Quick Ball (one large)', family: 'reverse', years: 'Ascended Heroes (2026)',
    implemented: true, texture: '/foil/reverse/special/reverse-quickball-large.png',
    note: 'One large Quick Ball behind the attack text, on the frame and text box. The paper and its assigned cards are documented; the ball artwork and its bolt are drawn here.',
    source: FOILFOX,
  },
  'reverse-duskball-large': {
    id: 'reverse-duskball-large', label: 'Reverse · Dusk Ball (one large)', family: 'reverse', years: 'Ascended Heroes (2026)',
    implemented: true, texture: '/foil/reverse/special/reverse-duskball-large.png',
    note: 'One large Dusk Ball behind the attack text, on the frame and text box. The paper and its assigned cards are documented; the ball artwork and its crescent are drawn here.',
    source: FOILFOX,
  },
  'reverse-teamrocket-large': {
    id: 'reverse-teamrocket-large', label: 'Reverse · Team Rocket (one large)', family: 'reverse', years: 'Ascended Heroes (2026)',
    implemented: true, texture: '/foil/reverse/special/reverse-teamrocket-large.png',
    note: 'One large Team Rocket mark — an R in place of the ball — behind the attack text. The replacement is documented; the glyph and its disc are drawn here.',
    source: FOILFOX,
  },
  'textured-full-art': {
    id: 'textured-full-art', label: 'Textured full art', family: 'chase', years: 'BW textured promos, modern chase tiers',
    implemented: true, texture: '/foil/surface/etched-deep.png',
    note: 'Embossed rather than marked. This paper prints no dots, stars or lines, so its texture is a NORMAL MAP — the BW/XY deep relief — and not a mark sheet: the mark layer stays plain and the relief supplies the structure, which is why the registry points at a surface file.', source: BULBA_HOLO,
  },
  'special-treatment': {
    id: 'special-treatment', label: 'Special treatment', family: 'special', years: 'LV.X, Gold Star and similar',
    implemented: false, note: 'A printing whose foil is neither the era paper nor a verified variant. No Cosmos claim is made.', source: BULBA_HOLO,
  },
  unresolved: {
    id: 'unresolved', label: 'Unresolved', family: 'special', years: '—',
    implemented: false, note: 'Recorded as unknown on purpose: the database refuses to guess.', source: BULBA_HOLO,
  },
}

export const PATTERN_IDS = Object.keys(PATTERNS) as FoilPatternId[]

export function patternLabel(id: FoilPatternId): string {
  return PATTERNS[id]?.label ?? id
}

/** Patterns that name the Cosmos sheet, and only these may load a Cosmos texture. */
export function isCosmosPattern(id: FoilPatternId | null | undefined): boolean {
  return id === 'cosmos-retro' || id === 'cosmos-hd'
}

export function isReversePattern(id: FoilPatternId | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('reverse-')
}
