const fs = require('fs')
const eol = (s) => (s.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s)

function patch(file, from, to) {
  let src = fs.readFileSync(file, 'utf8')
  if (!src.includes(eol(from))) throw new Error('anchor missing in ' + file + ': ' + from.slice(0, 90))
  src = src.replace(eol(from), eol(to))
  fs.writeFileSync(file, src)
  console.log('ok', file)
}

/* ------------------------------------------------------------------ */
/* 1. The rarity ladder — every label the catalog actually uses         */
/* ------------------------------------------------------------------ */
patch(
  'server/services/packs.ts',
  `const RARITY_RANK: Record<string, number> = {
  'Common': 1, 'Uncommon': 2, 'Rare': 3, 'Double Rare': 4, 'Illustration Rare': 5,
  'Special Illustration Rare': 6, 'Hyper Rare': 7, 'Ultra Rare': 5, 'Rare Holo': 3,
  'Rare Holo V': 4, 'Rare Holo VMAX': 5, 'Rare Holo VSTAR': 5, 'Rare SECRET': 6,
  'Rare Ultra': 5, 'Rare Break': 4, 'Rare Holo EX': 5, 'Radiant Rare': 4,
  'RGB Rare': 8,
}`,
  `// Every rarity label the catalog uses. Anything missing here fell through to
// rank 1 and dealt like a Common — which is exactly why a 'Pikachu Rare' was as
// common as a Vulpix, a 'LEGEND' reprint was bulk, and the Trainer Gallery was
// invisible. Rank 3 = plain rare / rare holo (the holo slot); 4-7 = the special
// ladder in the hit slot, weighted by TIER_ODDS; 8 = phantom, rolled on its own.
const RARITY_RANK: Record<string, number> = {
  'Common': 1, 'Uncommon': 2,
  'Rare': 3, 'Rare Holo': 3,
  'Double Rare': 4, 'Rare Holo V': 4, 'Rare Break': 4, 'Rare BREAK': 4,
  'Rare Holo VMAX': 5, 'Rare Holo VSTAR': 5, 'Rare Holo EX': 5, 'Rare Holo GX': 5,
  'Rare Holo LV.X': 5, 'Rare Holo ex': 5, 'Rare Prime': 5, 'LEGEND': 5,
  'Illustration Rare': 5, 'Ultra Rare': 5, 'Rare Ultra': 5,
  'Rare Shiny': 5, 'Shiny Rare': 5, 'Rare Shining': 5, 'Rare Prism Star': 5,
  'Rare ACE': 5, 'ACE SPEC Rare': 5, 'Amazing Rare': 5, 'Radiant Rare': 5,
  'Trainer Gallery Rare Holo': 5,
  'Special Illustration Rare': 6, 'Rare SECRET': 6, 'Rare Secret': 6,
  'Rare Rainbow': 6, 'Rare Shiny GX': 6, 'Shiny Ultra Rare': 6, 'Rare Holo Star': 6,
  'Hyper Rare': 7, 'Mega Hyper Rare': 7, 'MEGA_ATTACK_RARE': 7, 'Black White Rare': 7,
  'Futuristic Rare': 7,
  'Pikachu Rare': 7, 'Classic Collection': 7, // guaranteed-subset tiers
  'RGB Rare': 8,
}

/** Tiers that fill their own guaranteed slot: the 30 Pikachus in 30th
 *  Celebration and Celebrations' classic reprint subset. They never appear in
 *  the ordinary rare ladder — every 30C pack ends in one of the 30 Pikachus. */
const SUBSET_RARITIES = new Set(['Pikachu Rare', 'Classic Collection'])

/**
 * Real per-pack tier odds, used as relative weights inside the hit slot so a
 * Special Illustration Rare stays genuinely rarer than a Double Rare instead
 * of one-in-forty-two like every other hit. The 30C figures come from
 * TCGplayer's 3,000-pack study (Double Rare 21%, Illustration Rare 19.7%,
 * SIR 4.9%, Futuristic Rare 0.83%); the rest are era-typical estimates.
 */
const TIER_ODDS: Record<string, number> = {
  'Double Rare': 0.20, 'Illustration Rare': 0.19, 'Special Illustration Rare': 0.049,
  'Ultra Rare': 0.06, 'Rare Ultra': 0.05, 'Rare SECRET': 0.02, 'Rare Secret': 0.02,
  'Rare Rainbow': 0.015, 'Hyper Rare': 0.02, 'Mega Hyper Rare': 0.02, 'MEGA_ATTACK_RARE': 0.02,
  'Black White Rare': 0.01, 'Futuristic Rare': 0.008,
  'Rare Holo EX': 0.06, 'Rare Holo GX': 0.06, 'Rare Holo V': 0.06,
  'Rare Holo VMAX': 0.03, 'Rare Holo VSTAR': 0.03, 'Rare Holo LV.X': 0.02, 'Rare Holo ex': 0.02,
  'Rare Prime': 0.05, 'LEGEND': 0.03, 'Rare Break': 0.03, 'Rare BREAK': 0.03,
  'Rare Shining': 0.03, 'Rare Shiny': 0.05, 'Shiny Rare': 0.05, 'Rare Shiny GX': 0.02,
  'Shiny Ultra Rare': 0.02, 'Rare Holo Star': 0.01, 'Rare Prism Star': 0.02,
  'Rare ACE': 0.02, 'ACE SPEC Rare': 0.02, 'Amazing Rare': 0.05, 'Radiant Rare': 0.05,
  'Trainer Gallery Rare Holo': 0.10,
}

type PackSlot = 'common' | 'uncommon' | 'holo' | 'hit' | 'subset'

/**
 * Documented pack structures. Anything not listed falls back to the era default
 * (5 common · 3 uncommon · 1 holo · 1 hit at ten cards).
 */
const BLUEPRINTS: Record<string, { slot: PackSlot; count: number }[]> = {
  // 30th Celebration, real pack of 6: 2 Commons + 1 flex + 1 rare-or-better +
  // 1 guaranteed Pikachu + 1 foil Basic Energy. Stretched to the game's ten
  // cards the Pikachu slot stays a guaranteed draw that closes the pack.
  me55: [
    { slot: 'common', count: 6 },
    { slot: 'uncommon', count: 1 },
    { slot: 'holo', count: 1 },
    { slot: 'hit', count: 1 },
    { slot: 'subset', count: 1 },
  ],
  // Classic Collection: the whole set is the 30-card reprint subset, so there
  // is no rarity ladder at all — every card in the pack is a classic.
  me55c: [{ slot: 'subset', count: 10 }],
  cel25c: [{ slot: 'subset', count: 10 }],
}

/** The slot plan a set's packs are dealt from. */
export function planFor(setId: string, cardsPerPack = 10): { slot: PackSlot; count: number }[] {
  const bp = BLUEPRINTS[setId]
  if (bp) return bp.map((s) => ({ ...s }))
  const tail = 5 // three uncommons + a rare + a special rare
  return [
    { slot: 'common', count: Math.max(1, cardsPerPack - tail) },
    { slot: 'uncommon', count: 3 },
    { slot: 'holo', count: 1 },
    { slot: 'hit', count: 1 },
  ]
}`,
)

/* ------------------------------------------------------------------ */
/* 2. Build pools from the whole set, not just Pokémon                  */
/* ------------------------------------------------------------------ */
patch(
  'server/services/packs.ts',
  `    .prepare(\`SELECT id, name, rarity, supertype, number FROM cards WHERE set_id = ? AND supertype = 'Pokémon'\`)`,
  `    // Trainers and Energy print in the same packs — leaving them out made
    // whole slots impossible to fill for sets whose commons are mostly items.
    .prepare(\`SELECT id, name, rarity, supertype, number FROM cards WHERE set_id = ?\`)`,
)

patch(
  'server/services/packs.ts',
  `  const hits: typeof cards = []
  const phantoms: typeof cards = []`,
  `  const hits: typeof cards = []
  const phantoms: typeof cards = []
  const subsets: typeof cards = []`,
)

patch(
  'server/services/packs.ts',
  `    if (rank >= PHANTOM_RANK) phantoms.push(c)`,
  `    if (SUBSET_RARITIES.has(c.rarity ?? '')) subsets.push(c)
    else if (rank >= PHANTOM_RANK) phantoms.push(c)`,
)

patch(
  'server/services/packs.ts',
  `    const wHit = hits.length ? 1 / hits.length : 0
    for (const c of hits) insert.run(pid, c.id, 'hit', wHit)`,
  `    // Hits are not a flat pool: each card carries its tier's real odds divided
    // by how many cards share that tier, so the slot draws an SIR ~5% of the
    // time and a Double Rare ~20% of the time instead of splitting evenly.
    const tierCount = new Map<string, number>()
    for (const c of hits) tierCount.set(c.rarity ?? '', (tierCount.get(c.rarity ?? '') ?? 0) + 1)
    for (const c of hits) {
      const tier = c.rarity ?? ''
      insert.run(pid, c.id, 'hit', (TIER_ODDS[tier] ?? 0.04) / (tierCount.get(tier) ?? 1))
    }
    const wSubset = subsets.length ? 1 / subsets.length : 0
    for (const c of subsets) insert.run(pid, c.id, 'subset', wSubset)`,
)

/* ------------------------------------------------------------------ */
/* 3. Roll from the blueprint, with real weighted picks                 */
/* ------------------------------------------------------------------ */
patch(
  'server/services/packs.ts',
  `  const pid = \`\${setId}-booster\`
  const slots: { slot: string; count: number }[] = [
    { slot: 'common', count: 5 },
    { slot: 'uncommon', count: 3 },
    { slot: 'holo', count: holosCount(setId) > 0 ? 1 : 0 },
    { slot: 'hit', count: 1 },
  ]
  const rows = db.prepare(\`SELECT card_id, weight, slot FROM pack_product_cards WHERE pack_product_id = ?\`).all(pid) as { card_id: string; weight: number; slot: string }[]
  if (rows.length === 0) return null`,
  `  const pid = \`\${setId}-booster\`
  const rows = db.prepare(\`SELECT card_id, weight, slot FROM pack_product_cards WHERE pack_product_id = ?\`).all(pid) as { card_id: string; weight: number; slot: string }[]
  if (rows.length === 0) return null

  // Structure comes from the set's blueprint (30C closes on a guaranteed
  // Pikachu, Classic Collection is all subset) or the era default. Empty pools
  // drop out rather than padding the pack with repeats of nothing.
  const slots: { slot: string; count: number }[] = planFor(setId, cardsPerPack).filter(
    (s) => s.slot !== 'holo' || holosCount(setId) > 0,
  )
  if (rows.some((r) => r.slot === 'subset') && !slots.some((s) => s.slot === 'subset')) {
    slots.push({ slot: 'subset', count: 1 })
  }`,
)

patch(
  'server/services/packs.ts',
  `        const isHit = slot === 'hit'`,
  `        const isHit = slot === 'hit' || slot === 'subset'`,
)

patch(
  'server/services/packs.ts',
  `function weightedPick(pool: { card_id: string; weight: number }[]): string {
  // Uniform within slot — real per-card pull rates are not published; the
  // slot structure itself is what encodes scarcity.
  return pool[Math.floor(Math.random() * pool.length)].card_id
}`,
  `function weightedPick(pool: { card_id: string; weight: number }[]): string {
  // Weights are real: within a tier the cards are uniform, but the tiers are
  // not. Flat picks here would undo the whole rarity ladder.
  let total = 0
  for (const p of pool) if (p.weight > 0) total += p.weight
  if (total <= 0) return pool[Math.floor(Math.random() * pool.length)].card_id
  let roll = Math.random() * total
  for (const p of pool) {
    if (p.weight <= 0) continue
    roll -= p.weight
    if (roll <= 0) return p.card_id
  }
  return pool[pool.length - 1].card_id
}`,
)

/* ------------------------------------------------------------------ */
/* 4. Shop estimate reads the same plan                                 */
/* ------------------------------------------------------------------ */
patch(
  'server/services/packs.ts',
  `  const plan: SlotPlan = { common: 5, uncommon: 3, holo: 1, hit: 1 }
  const loadPool = (slot: string) =>`,
  `  const loadPool = (slot: string) =>`,
)

patch(
  'server/services/packs.ts',
  `  const commons = loadPool('common')
  const uncommons = loadPool('uncommon')
  const holos = loadPool('holo')
  const hits = loadPool('hit')

  const avg = (rows: { weight: number; v: number }[]) =>
    rows.reduce((acc, r) => acc + r.v * r.weight, 0)

  const expected = plan.common * avg(commons) + plan.uncommon * avg(uncommons) + plan.holo * avg(holos) + plan.hit * avg(hits)

  // Simulate 300 packs to estimate p50/p90 outcomes.
  const sims: number[] = []
  for (let i = 0; i < 300; i++) {
    let v = 0
    for (const [slots, rows] of [[plan.common, commons], [plan.uncommon, uncommons], [plan.holo, holos], [plan.hit, hits]] as [number, { weight: number; v: number }[]][]) {
      for (let s = 0; s < slots; s++) {
        if (rows.length === 0) continue
        let roll = Math.random()
        for (const r of rows) {
          roll -= r.weight
          if (roll <= 0) { v += r.v; break }
        }
      }
    }
    sims.push(v)
  }`,
  `  // The same plan the roll uses — including a guaranteed subset slot when the
  // set has one (every 30C pack lands a Pikachu, so the estimate must too).
  const slots = planFor(setId, 10).map((s) => ({ slot: s.slot as string, count: s.count }))
  const pools = new Map(slots.map((s) => [s.slot, loadPool(s.slot)]))
  if (loadPool('subset').length > 0) {
    const sub = loadPool('subset')
    if (!pools.has('subset')) {
      slots.push({ slot: 'subset', count: 1 })
      pools.set('subset', sub)
    } else {
      pools.set('subset', sub)
    }
  }

  // Weights are relative, not probabilities — normalise before averaging.
  const weightedAvg = (rows: { weight: number; v: number }[]) => {
    let total = 0
    for (const r of rows) if (r.weight > 0) total += r.weight
    if (total <= 0) return 0
    return rows.reduce((acc, r) => acc + r.v * (Math.max(0, r.weight) / total), 0)
  }
  const draw = (rows: { weight: number; v: number }[]) => {
    let total = 0
    for (const r of rows) if (r.weight > 0) total += r.weight
    if (total <= 0) return rows.length ? rows[Math.floor(Math.random() * rows.length)].v : 0
    let roll = Math.random() * total
    for (const r of rows) {
      if (r.weight <= 0) continue
      roll -= r.weight
      if (roll <= 0) return r.v
    }
    return rows[rows.length - 1].v
  }

  const expected = slots.reduce((acc, s) => acc + s.count * weightedAvg(pools.get(s.slot) ?? []), 0)

  // Simulate 300 packs to estimate p50/p90 outcomes.
  const sims: number[] = []
  for (let i = 0; i < 300; i++) {
    let v = 0
    for (const s of slots) {
      const rows = pools.get(s.slot) ?? []
      if (rows.length === 0) continue
      for (let k = 0; k < s.count; k++) v += draw(rows)
    }
    sims.push(v)
  }`,
)

/* ------------------------------------------------------------------ */
/* 5. index.ts — rebuild every pull table once, then never again        */
/* ------------------------------------------------------------------ */
patch(
  'server/index.ts',
  `function rebuildPullTables() {`,
  `// The rarity ladder and pack blueprints changed shape, so tables built by
// older code are wrong: 30C Pikachus sat in the common pool, Trainer Gallery
// and LEGEND cards dealt like Commons, and no set produced Trainers or Energy
// at all. Rebuild every booster table once per save.
function migratePullTableRarities() {
  const VERSION = '3'
  if (getMeta('packs:tableVersion') === VERSION) return
  sealed.ensureFullCatalog()
  const ids = db.prepare(\`SELECT DISTINCT set_id AS id FROM cards\`).all() as { id: string }[]
  let n = 0
  for (const { id } of ids) {
    try {
      packs.buildPullTable(id, 10)
      n++
    } catch (err) {
      console.warn('[packs] pull table rebuild failed for', id, err instanceof Error ? err.message : err)
    }
  }
  setMeta('packs:tableVersion', VERSION)
  console.log(\`[packs] rebuilt \${n} pull table(s) on the real rarity ladder\`)
}

function rebuildPullTables() {`,
)

patch(
  'server/index.ts',
  `repairPhantomRarities()
ensurePackCatalog()`,
  `repairPhantomRarities()
ensurePackCatalog()
migratePullTableRarities()`,
)
