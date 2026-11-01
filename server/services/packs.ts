import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { valueOf, firstEditionValueOf, round2 } from './market'
import * as sealed from './sealed'
import * as vault from './vault'

// Migration: pull_history rows written before the owner column existed are all
// attributable by session-id convention — stamp the known NPC shapes (live-wing
// host rips except packs the player personally won and ripped, battle
// opponents, break spots) so the record endpoints can trust the column
// immediately on existing saves. Everything else was the player's.
try {
  db.exec(`ALTER TABLE pull_history ADD COLUMN owner TEXT NOT NULL DEFAULT 'player'`)
} catch { /* column already exists */ }
// The owner index lives here rather than schema.sql: on legacy saves the table
// predates the column, and a CREATE INDEX in schema.sql would fire before the
// ALTER above and abort boot with 'no such column: owner'.
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pulls_owner ON pull_history (owner)`)
} catch { /* non-fatal */ }
db.exec(
  `UPDATE pull_history SET owner = 'other'
   WHERE (substr(session_id, 1, 5) = 'live_'
           AND session_id NOT LIKE '%rios_you_%')
      OR substr(session_id, 1, 16) = 'battle_opponent_'
      OR substr(session_id, 1, 6) = 'break_'`,
)

// Pre-split tournaments wrote plain tourney_<timestamp> session ids — no side
// marker — so the generic backfill leaves them 'player' and an old save's
// tournament history pollutes the records with NPC rips (40 of 60 rows on the
// first save that hit this). The saved bracket is ground truth: every played
// slot records aTotal/bTotal and each side's per-pack sessions sum to that
// total exactly. Reconstruct ownership from it: for each slot, find disjoint
// unclaimed session subsets matching both sides' cent-exact totals, claim the
// __you__ side (leave it 'player'), and stamp every other matched session
// 'other'. Runs once per save (meta flag), then never again.
try {
  if (getMeta('pulls:tourneySelfHeal') !== '1') {
    type Pool = { session_id: string; total: number }
    const pool = db.prepare(
      `SELECT session_id, ROUND(SUM(value), 2) AS total FROM pull_history
       WHERE owner = 'player' AND session_id GLOB 'tourney_[0-9]*'
       GROUP BY session_id`,
    ).all() as Pool[]
    if (pool.length > 0) {
      const rows = db.prepare('SELECT id, bracket FROM tournaments').all() as { id: number; bracket: string | null }[]
      type Slot = { a?: string; b?: string; aTotal?: number; bTotal?: number }
      const stamped: string[] = []
      const claimed = new Set<string>()
      // Smallest exact-sum subset of unclaimed sessions (packs per side ≤ 3,
      // so subset size ≤ 4 is generous). Returns null when nothing matches.
      const matchSubset = (target: number): string[] | null => {
        const avail = pool.filter((p) => !claimed.has(p.session_id))
        for (let k = 1; k <= 4 && k <= avail.length; k++) {
          const idx: number[] = []
          const walk = (start: number, sum: number): string[] | null => {
            if (idx.length === k) return Math.abs(sum - target) < 0.005 ? idx.map((i) => avail[i].session_id) : null
            for (let i = start; i <= avail.length - (k - idx.length); i++) {
              idx.push(i)
              const hit = walk(i + 1, sum + avail[i].total)
              idx.pop()
              if (hit) return hit
            }
            return null
          }
          const hit = walk(0, 0)
          if (hit) return hit
        }
        return null
      }
      for (const t of rows) {
        let rounds: unknown
        try { rounds = JSON.parse(t.bracket ?? 'null') } catch { continue }
        if (!Array.isArray(rounds)) continue
        for (const round of rounds) {
          if (!Array.isArray(round)) continue
          for (const s of round as Slot[]) {
            if (!s || typeof s !== 'object') continue
            const sides: [string | undefined, number | undefined][] = [[s.a, s.aTotal], [s.b, s.bTotal]]
            const sidesWithTotals = sides.filter(([, tot]) => typeof tot === 'number').length
            const claimedNow: string[] = []
            const stampNow: string[] = []
            let resolvedSides = 0
            for (const [who, total] of sides) {
              if (typeof total !== 'number') continue
              const hit = matchSubset(total)
              if (!hit) continue
              resolvedSides++
              for (const sid of hit) claimed.add(sid)
              claimedNow.push(...hit)
              if (who !== '__you__') stampNow.push(...hit)
            }
            // Only commit when BOTH sides resolved — one side matching alone
            // could grab the wrong pack on a cent-tie.
            if (resolvedSides === sidesWithTotals) {
              stamped.push(...stampNow)
            } else {
              for (const sid of claimedNow) claimed.delete(sid)
            }
          }
        }
      }
      if (stamped.length > 0) {
        const upd = db.prepare('UPDATE pull_history SET owner = \'other\' WHERE session_id = ?')
        const tx = db.transaction(() => { for (const sid of stamped) upd.run(sid) })
        tx()
        console.warn(`[migrate] tournaments: reconstructed ownership for ${stamped.length} pre-split pull rows from saved brackets`)
      }
    }
    setMeta('pulls:tourneySelfHeal', '1')
  }
} catch (e) {
  console.warn('[migrate] tournament pull-ownership self-heal skipped:', e instanceof Error ? e.message : e)
}

// ---------------------------------------------------------------------------
// Real sealed-product catalog (MSRP from official Pokemon Center retail)
// ---------------------------------------------------------------------------

type ProductDef = { setId: string; kind: string; name: string; msrp: number; packs: number; cardsPerPack: number }

export const PRODUCTS: ProductDef[] = [
  { setId: 'sv3pt5', kind: 'booster', name: 'Scarlet & Violet—151 Booster Pack', msrp: 4.49, packs: 1, cardsPerPack: 10 },
  { setId: 'sv3pt5', kind: 'bundle', name: 'Scarlet & Violet—151 Booster Bundle', msrp: 26.99, packs: 6, cardsPerPack: 10 },
  { setId: 'sv3pt5', kind: 'etb', name: 'Scarlet & Violet—151 Elite Trainer Box', msrp: 54.99, packs: 9, cardsPerPack: 10 },
  { setId: 'sv3pt5', kind: 'display', name: 'Scarlet & Violet—151 Booster Display (36 packs)', msrp: 161.64, packs: 36, cardsPerPack: 10 },
  { setId: 'sv8', kind: 'booster', name: 'Surging Sparks Booster Pack', msrp: 4.49, packs: 1, cardsPerPack: 10 },
  { setId: 'sv8', kind: 'etb', name: 'Surging Sparks Elite Trainer Box', msrp: 54.99, packs: 9, cardsPerPack: 10 },
  { setId: 'sv8', kind: 'display', name: 'Surging Sparks Booster Display (36 packs)', msrp: 161.64, packs: 36, cardsPerPack: 10 },
  { setId: 'sv8.5', kind: 'booster', name: 'Prismatic Evolutions Booster Pack', msrp: 4.99, packs: 1, cardsPerPack: 10 },
  { setId: 'sv8.5', kind: 'etb', name: 'Prismatic Evolutions Elite Trainer Box', msrp: 59.99, packs: 9, cardsPerPack: 10 },
  { setId: 'sv8.5', kind: 'special', name: 'Prismatic Evolutions Premium Collection', msrp: 79.99, packs: 15, cardsPerPack: 10 },
  { setId: 'sv4pt5', kind: 'booster', name: 'Paldean Fates Booster Pack', msrp: 4.49, packs: 1, cardsPerPack: 10 },
  { setId: 'sv4pt5', kind: 'etb', name: 'Paldean Fates Elite Trainer Box', msrp: 54.99, packs: 9, cardsPerPack: 10 },
]

// ---------------------------------------------------------------------------
// Pull table construction — built ONLY from the set's real rarity distribution
// ---------------------------------------------------------------------------

type SlotPlan = {
  common: number; uncommon: number; holo: number; hit: number
}

// Every rarity label the catalog uses. Anything missing here fell through to
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
    { slot: 'common', count: 7 },
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
}

// Rarities at or above this rank don't share the rare slot — they have their
// own dice (see PHANTOM_ODDS), because a ~1-in-12,000 card cannot be expressed
// as a share of a slot that appears in every pack.
const PHANTOM_RANK = 8
/** 30th Celebration RGB Mews: ~1 in 12,000 packs per colour (community estimate). */
const PHANTOM_PER_CARD_ODDS = 1 / 12_000

function rarityRank(r: string | null): number {
  if (!r) return 0
  return RARITY_RANK[r] ?? (r.startsWith('Rare') ? 3 : 1)
}

export function buildPullTable(setId: string, cardsPerPack = 10) {
  const cards = db
    // Trainers and Energy print in the same packs — leaving them out made
    // whole slots impossible to fill for sets whose commons are mostly items.
    .prepare(`SELECT id, name, rarity, supertype, number FROM cards WHERE set_id = ?`)
    .all(setId) as { id: string; name: string; rarity: string | null; supertype: string; number: string }[]

  if (cards.length === 0) return

  const commons: typeof cards = []
  const uncommons: typeof cards = []
  const holos: typeof cards = []
  const hits: typeof cards = []
  const phantoms: typeof cards = []
  const subsets: typeof cards = []

  // Classic Collection keeps each reprint's original rarity label, so the only
  // honest classification is "every card in this set is the subset".
  const allSubset = BLUEPRINTS[setId]?.every((s) => s.slot === 'subset') ?? false

  for (const c of cards) {
    if (allSubset) {
      subsets.push(c)
      continue
    }
    const rank = rarityRank(c.rarity)
    // Word-boundary tokens: 'ex'/'V'/'GX' are named suffixes, not substrings
    // (Vulpix, Eevee, Exeggcute and Venusaur all contain v/x letters).
    // Bracketed segments are form/letter labels — 'Unown [V]' is a common, not
    // a special-art V.
    const special = /\b(ex|v|gx|vmax|vstar|v-union)\b/i.test(c.name.replace(/\[[^\]]*\]/g, ' '))
    if (SUBSET_RARITIES.has(c.rarity ?? '')) subsets.push(c)
    else if (rank >= PHANTOM_RANK) phantoms.push(c)
    else if (rank <= 1 && !special) commons.push(c)
    else if (rank === 2) uncommons.push(c)
    else if (rank === 3) holos.push(c)
    else hits.push(c)
  }

  const clear = db.prepare('DELETE FROM pack_product_cards WHERE pack_product_id = ?')
  const insert = db.prepare(
    'INSERT OR IGNORE INTO pack_product_cards (pack_product_id, card_id, slot, weight) VALUES (?, ?, ?, ?)',
  )

  // 151-style structure: 5 commons + 3 uncommons + 1 reverse-ish holo + 1 hit-ish slot.
  const plan: SlotPlan = { common: 5, uncommon: 3, holo: 1, hit: 1 }
  if (commons.length < 5) { plan.common = Math.max(1, commons.length); plan.uncommon = Math.min(4, uncommons.length + (5 - plan.common)) }
  if (cardsPerPack === 10 && holos.length > 0) plan.holo = 1

  db.transaction(() => {
    // Every set rips from its own booster table — kind products (bundle/ETB/
    // display) all roll the same table via rollPack(set_id).
    const pid = `${setId}-booster`
    clear.run(pid)
    estimateCache.delete(setId)
    sealed.invalidateDerivedPrices(setId)
    const wCommon = commons.length ? 1 / commons.length : 0
    for (const c of commons) insert.run(pid, c.id, 'common', wCommon)
    const wUncommon = uncommons.length ? 1 / Math.max(1, uncommons.length) : 0
    for (const c of uncommons) insert.run(pid, c.id, 'uncommon', wUncommon)
    const wHolo = holos.length ? 1 / holos.length : 0
    for (const c of holos) insert.run(pid, c.id, 'holo', wHolo)
    // Hits are not a flat pool: each card carries its tier's real odds divided
    // by how many cards share that tier, so the slot draws an SIR ~5% of the
    // time and a Double Rare ~20% of the time instead of splitting evenly.
    const tierCount = new Map<string, number>()
    for (const c of hits) tierCount.set(c.rarity ?? '', (tierCount.get(c.rarity ?? '') ?? 0) + 1)
    for (const c of hits) {
      const tier = c.rarity ?? ''
      insert.run(pid, c.id, 'hit', (TIER_ODDS[tier] ?? 0.04) / (tierCount.get(tier) ?? 1))
    }
    const wSubset = subsets.length ? 1 / subsets.length : 0
    for (const c of subsets) insert.run(pid, c.id, 'subset', wSubset)
    const wPhantom = phantoms.length ? 1 / phantoms.length : 0
    for (const c of phantoms) insert.run(pid, c.id, 'phantom', wPhantom)
  })()
}

function productId(p: ProductDef): string {
  return `${p.setId}-${p.kind}`
}

// ---------------------------------------------------------------------------
// Pack value estimation (for the shop UI, labeled ESTIMATED)
// ---------------------------------------------------------------------------

type PackEstimate = { avg: number; p50: number; p90: number; topChases: { id: string; name: string; rarity: string; value: number }[] }

// Memoized per set — the simulation is too heavy to recompute on every shop
// request (502 sets × 300 packs × per-card price lookups). Cleared whenever
// that set's pull table is rebuilt.
const estimateCache = new Map<string, PackEstimate>()

export function estimatePackValue(setId: string): PackEstimate {
  const hit = estimateCache.get(setId)
  if (hit) return hit
  const loadPool = (slot: string) =>
    (db.prepare(`SELECT card_id, weight FROM pack_product_cards WHERE pack_product_id = ? AND slot = ?`).all(`${setId}-booster`, slot) as { card_id: string; weight: number }[])
      .map((r) => ({ ...r, v: valueOf(r.card_id) }))
  // The same plan the roll uses — including a guaranteed subset slot when the
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
  }
  sims.sort((a, b) => a - b)
  const p = (q: number) => round2(sims[Math.floor(q * (sims.length - 1))])

  const chases = (
    db
      .prepare(
        `SELECT c.id, c.name, c.rarity FROM pack_product_cards ppc
         JOIN cards c ON c.id = ppc.card_id
         WHERE ppc.pack_product_id = ? AND ppc.slot IN ('hit', 'phantom')`,
      )
      .all(`${setId}-booster`) as { id: string; name: string; rarity: string }[]
  )
    .map((c) => ({ ...c, market: valueOf(c.id) }))
    .filter((c) => c.market > 0)
    .sort((a, b) => b.market - a.market)
    .slice(0, 5)

  const result: PackEstimate = {
    avg: round2(expected),
    p50: p(0.5),
    p90: p(0.9),
    topChases: chases.map((c) => ({ id: c.id, name: c.name, rarity: c.rarity, value: round2(c.market) })),
  }
  estimateCache.set(setId, result)
  return result
}

export function invalidatePackEstimate(setId: string) {
  estimateCache.delete(setId)
}

// ---------------------------------------------------------------------------
// Pull rolling
// ---------------------------------------------------------------------------

export function rollPack(setId: string, sessionId: string, productKind = 'booster', cardsPerPack = 10, owner: 'player' | 'other' = 'player') {
  const pid = `${setId}-booster`
  const rows = db.prepare(`SELECT card_id, weight, slot FROM pack_product_cards WHERE pack_product_id = ?`).all(pid) as { card_id: string; weight: number; slot: string }[]
  if (rows.length === 0) return null

  // Structure comes from the set's blueprint (30C closes on a guaranteed
  // Pikachu, Classic Collection is all subset) or the era default. Empty pools
  // drop out rather than padding the pack with repeats of nothing.
  const slots: { slot: string; count: number }[] = planFor(setId, cardsPerPack).filter(
    (s) => s.slot !== 'holo' || holosCount(setId) > 0,
  )
  if (rows.some((r) => r.slot === 'subset') && !slots.some((s) => s.slot === 'subset')) {
    slots.push({ slot: 'subset', count: 1 })
  }

  const ghost = GHOST_SETS[setId] ?? null
  const insertPull = db.prepare(
    `INSERT INTO pull_history (session_id, pack_product_id, card_id, variant, value, rarity, is_hit, opened_at, owner)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const at = nowIso()
  const results: { cardId: string; isHit: boolean; value: number; variant: string }[] = []

  const tx = db.transaction(() => {
    for (const { slot, count } of slots) {
      const pool = rows.filter((r) => r.slot === slot)
      if (pool.length === 0 || count === 0) continue
      for (let i = 0; i < count; i++) {
        const cardId = weightedPick(pool)
        // WotC-era ghost: this card prints with the 1st Edition stamp.
        const stamp = ghost && Math.random() < ghost.perSlot ? ghostValue(setId, cardId, slot) : null
        const variant = stamp ? stamp.variant : 'normal'
        const value = stamp ? stamp.value : valueOf(cardId)
        const rarity = (db.prepare('SELECT rarity FROM cards WHERE id = ?').get(cardId) as { rarity: string | null } | undefined)?.rarity ?? null
        const isHit = slot === 'hit' || slot === 'subset'
        insertPull.run(sessionId, pid, cardId, variant, value, rarity ?? null, isHit ? 1 : 0, at, owner)
        results.push({ cardId, isHit, value, variant })
      }
    }
    // Phantom tier — the 30th Celebration RGB Mews. No published rate exists;
    // ~1 in 12,000 packs per colour is the community estimate, so a 36-pack
    // display very rarely holds one. It rides on top of the pack rather than
    // taking the rare slot, matching how these appear in real openings.
    const phantomPool = rows.filter((r) => r.slot === 'phantom')
    if (phantomPool.length > 0 && Math.random() < phantomPool.length * PHANTOM_PER_CARD_ODDS) {
      const cardId = weightedPick(phantomPool)
      const value = valueOf(cardId)
      const rarity = (db.prepare('SELECT rarity FROM cards WHERE id = ?').get(cardId) as { rarity: string | null } | undefined)?.rarity ?? null
      insertPull.run(sessionId, pid, cardId, 'normal', value, rarity ?? null, 1, at, owner)
      results.push({ cardId, isHit: true, value, variant: 'normal' })
    }
  })
  tx()

  return results
}

// ---------------------------------------------------------------------------
// WotC ghost pulls — early print runs carried the 1st Edition stamp, and
// unlimited packs could still contain them until the stamp ran out.
// ---------------------------------------------------------------------------

const GHOST_SETS: Record<string, { perSlot: number }> = {
  base1: { perSlot: 0.028 },
  base2: { perSlot: 0.014 },
  base3: { perSlot: 0.022 },
  gym1: { perSlot: 0.02 },
  gym2: { perSlot: 0.02 },
  neo1: { perSlot: 0.018 },
  neo2: { perSlot: 0.016 },
  neo3: { perSlot: 0.016 },
  neo4: { perSlot: 0.014 },
  base5: { perSlot: 0.012 },
}

/** Resolve the real value + variant of a ghosted card given its slot. */
export function ghostValue(setId: string, cardId: string, slot: string): { variant: string; value: number } | null {
  if (!GHOST_SETS[setId]) return null
  const holo = slot === 'holo' || slot === 'hit'
  const value = firstEditionValueOf(cardId, holo)
  if (value <= 0) return null
  return { variant: '1stEdition' + (holo ? 'Holofoil' : 'Normal'), value }
}

function holosCount(setId: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM pack_product_cards WHERE pack_product_id = ? AND slot = 'holo'`).get(`${setId}-booster`) as { n: number }).n
}

function weightedPick(pool: { card_id: string; weight: number }[]): string {
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
}

// ---------------------------------------------------------------------------
// Sealed inventory
// ---------------------------------------------------------------------------

export function buySealed(productId: string, qty: number) {
  const product = db.prepare('SELECT * FROM pack_products WHERE id = ?').get(productId) as { id: string; set_id: string; msrp: number; market_price: number | null; name: string } | undefined
  if (!product) throw new Error('Unknown product')
  // Buy at what the shop actually charges — the market price (appreciation
  // included), falling back to MSRP only for brand-new catalog rows.
  const unit = round2(sealed.priceOf(productId).market || product.msrp)
  const cost = round2(unit * qty)
  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < cost) throw new Error('Not enough cash')
  db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(cost)
  // Fresh off the distributor's truck — futures desk stamps case-fresh.
  db.prepare('INSERT INTO sealed_inventory (product_id, quantity, cost, condition, acquired_at) VALUES (?, ?, ?, ?, ?)')
    .run(productId, qty, unit, 'fresh', nowIso())
  logActivity('buy', `Bought ${qty}× ${product.name} for $${cost.toFixed(2)}`, -cost)
  return { cost }
}

export function openSealed(productId: string) {
  // Rip the oldest FREE box (loan collateral sits escrowed in the vault —
  // see sealedfutures.ts).
  const row = db.prepare('SELECT * FROM sealed_inventory WHERE product_id = ? AND (escrow_loan IS NULL) ORDER BY acquired_at ASC LIMIT 1').get(productId) as { id: number; product_id: string; cost: number; quantity: number } | undefined
  if (!row) {
    const anyLeft = db.prepare('SELECT COUNT(*) AS n FROM sealed_inventory WHERE product_id = ? AND quantity > 0').get(productId) as { n: number }
    throw new Error(anyLeft.n > 0 ? 'That stock is posted as loan collateral — redeem it from the futures desk first' : 'No sealed product in inventory')
  }
  const product = db.prepare('SELECT * FROM pack_products WHERE id = ?').get(row.product_id) as { set_id: string; cards_per_pack: number; name: string; kind: string; packs: number | null } | undefined
  if (!product) throw new Error('Product missing')

  // A bundle/ETB/display is a BOX of packs — ripping it opens every pack
  // inside (each with its own session id, so the pack-total record stays a
  // per-pack number). Boosters (and anything unlabeled) are one pack.
  const packsInBox = product.kind === 'booster' || !product.packs ? 1 : Math.max(1, product.packs)
  const perPackCost = round2(row.cost / packsInBox)

  // The whole box leaves the shelf on rip — multi-pack buys deplete their
  // quantity instead of vanishing with the first rip.
  if (row.quantity > 1) {
    db.prepare('UPDATE sealed_inventory SET quantity = quantity - 1 WHERE id = ?').run(row.id)
  } else {
    db.prepare('DELETE FROM sealed_inventory WHERE id = ?').run(row.id)
  }

  // Rip every pack in the box. A missing pull table aborts the box — the
  // caller's catch leaves the box in inventory (nothing was inserted yet).
  type OpenedCard = { cardId: string; isHit: boolean; value: number; variant?: string; setName?: string; rarity?: string | null; image?: string | null; isNew?: boolean }
  const sessions: { sessionId: string; cards: OpenedCard[]; totalValue: number; spent: number }[] = []
  const cards: OpenedCard[] = []
  let totalValue = 0
  for (let i = 0; i < packsInBox; i++) {
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const packCards = rollPack(product.set_id, sessionId, 'booster', product.cards_per_pack)
    if (!packCards) {
      if (sessions.length === 0) throw new Error('Pull table missing — sync this set first')
      break
    }
    cards.push(...packCards)
    totalValue += packCards.reduce((a, c) => a + c.value, 0)
    sessions.push({ sessionId, cards: packCards, totalValue: round2(packCards.reduce((a, c) => a + c.value, 0)), spent: perPackCost })
  }
  totalValue = round2(totalValue)
  // NEW-to-the-binder tag: a pull is "new" when you owned zero copies of that
  // card before this rip. Computed BEFORE the inventory insert below, and
  // within one rip only the FIRST copy of a double-printed card wears the
  // tag — the second is a dupe of the first, not a new find.
  const ownedBefore = db.prepare('SELECT COALESCE(SUM(quantity), 0) AS n FROM inventory WHERE card_id = ?')
  const seenInRip = new Map<string, number>()
  for (const c of cards) {
    const prior = (ownedBefore.get(c.cardId) as { n: number }).n + (seenInRip.get(c.cardId) ?? 0)
    if (prior === 0) c.isNew = true
    seenInRip.set(c.cardId, (seenInRip.get(c.cardId) ?? 0) + 1)
  }
  // Storage & the vault: make room per the overflow policy — the rest of the
  // rip stays in the wrapper (counted in the session total but never inserted).
  const keepCount = vault.makeRoomFor(cards.length, 'Pack rip')
  // Add to player inventory with per-unit cost = box cost / cards.
  // Variants are honored — a 1st Edition ghost keeps its stamp in your binder.
  const perCardCost = round2(row.cost / Math.max(1, cards.length))
  const addInv = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
     VALUES (?, ?, 'NM', 1, 'collection', 'pack', ?, ?)`,
  )
  for (const c of cards.slice(0, keepCount)) addInv.run(c.cardId, c.variant || 'normal', perCardCost, nowIso())
  if (keepCount < cards.length) {
    logActivity('storage', `${product.name}: the shelf is full — ${cards.length - keepCount} of the ${cards.length} pulls stayed in the wrapper. Rent a locker before the next rip.`, 0)
  }
  logActivity('pack', `Opened ${product.name}${packsInBox > 1 ? ` (${packsInBox} packs)` : ''} — ${cards.length} cards, value ≈ $${totalValue.toFixed(2)}`, -row.cost)
  return {
    sessionId: sessions[0].sessionId,
    sessionIds: sessions.map((s) => s.sessionId),
    cards,
    totalValue,
    spent: row.cost,
    packsInBox,
    packsOpened: sessions.length,
    perPack: sessions,
  }
}

// ---------------------------------------------------------------------------
// Opening a box, one pack at a time
// ---------------------------------------------------------------------------
// A bundle/ETB/display is a box of packs, so it opens like one: the box comes
// off the shelf once, the promo sealed beside the packs goes into the binder
// first, and every wrapper after that is its own rip. sealed_box_open holds
// what is left, so a reload mid-box resumes at the next pack.

type BoxRow = {
  id: number
  product_id: string
  set_id: string
  cards_per_pack: number
  packs_left: number
  packs_total: number
  per_pack_cost: number
  total_cost: number
}

export type BoxPromo = { cardId: string; name: string; image: string | null; value: number }

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/** The promo set that shipped alongside a set's ETBs, by era. */
function promoSetForYear(year: number): string | null {
  if (year >= 2023) return 'svp'
  if (year >= 2020) return 'swshp'
  if (year >= 2017) return 'smp'
  if (year >= 2014) return 'xyp'
  if (year >= 2011) return 'bwp'
  return null
}

/**
 * The promo card sealed beside an ETB's packs. Real ETBs carry one specific
 * promo; the catalog doesn't map set → promo, so this picks one from that
 * era's promo set deterministically per product — the same box always gives
 * the same card — and only cards with a live price qualify, so it is never a
 * $0 phantom.
 */
function promoForProduct(product: { id: string; set_id: string; kind: string; release_date: string | null }): BoxPromo | null {
  if (product.kind !== 'etb') return null
  type Cand = { id: string; name: string; image_small: string | null }
  let pool = db
    .prepare("SELECT id, name, image_small FROM cards WHERE set_id = ? AND rarity LIKE '%romo%'")
    .all(product.set_id) as Cand[]
  if (pool.length === 0) {
    const promoSet = promoSetForYear(Number((product.release_date || '').slice(0, 4)))
    if (promoSet) {
      pool = db
        .prepare("SELECT id, name, image_small FROM cards WHERE set_id = ? AND rarity LIKE '%romo%'")
        .all(promoSet) as Cand[]
    }
  }
  const priced = pool
    .map((c) => ({ cardId: c.id, name: c.name, image: c.image_small, value: round2(Number(valueOf(c.id)) || 0) }))
    .filter((c) => c.value > 0)
    .sort((a, b) => a.cardId.localeCompare(b.cardId))
  // ETB promos are the ordinary, everywhere kind — a promo box is not a grail
  // ticket. Pick inside the normal band; if a promo set is all grails, take
  // its cheapest card rather than handing out a four-figure freebie.
  const band = priced.filter((c) => c.value >= 0.75 && c.value <= 25)
  const candidates = band.length > 0 ? band : [...priced].sort((a, b) => a.value - b.value)
  if (candidates.length === 0) return null
  return candidates[hashStr(product.id) % candidates.length]
}

/** Bank the promo before a single wrapper opens. */
function grantPromo(product: { id: string; set_id: string; kind: string; release_date: string | null; name: string }): BoxPromo | null {
  const promo = promoForProduct(product)
  if (!promo) return null
  db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
     VALUES (?, 'normal', 'NM', 1, 'collection', 'promo', 0, ?)`,
  ).run(promo.cardId, nowIso())
  logActivity('pack', `${product.name} promo: ${promo.name} — it was in the box before you tore a wrapper`, 0)
  return promo
}

/** Roll one pack out of a box and count it down. */
function ripNextPack(box: BoxRow) {
  const product = db.prepare('SELECT name FROM pack_products WHERE id = ?').get(box.product_id) as { name: string } | undefined
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const packCards = rollPack(box.set_id, sessionId, 'booster', box.cards_per_pack)
  if (!packCards) throw new Error('Pull table missing — sync this set first')

  type OpenedCard = { cardId: string; isHit: boolean; value: number; variant?: string; setName?: string; rarity?: string | null; image?: string | null; isNew?: boolean }
  const ownedBefore = db.prepare('SELECT COALESCE(SUM(quantity), 0) AS n FROM inventory WHERE card_id = ?')
  const seen = new Map<string, number>()
  for (const c of packCards) {
    const prior = (ownedBefore.get(c.cardId) as { n: number }).n + (seen.get(c.cardId) ?? 0)
    if (prior === 0) (c as OpenedCard).isNew = true
    seen.set(c.cardId, (seen.get(c.cardId) ?? 0) + 1)
  }
  const keepCount = vault.makeRoomFor(packCards.length, 'Pack rip')
  const perCardCost = round2(box.per_pack_cost / Math.max(1, packCards.length))
  const addInv = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
     VALUES (?, ?, 'NM', 1, 'collection', 'pack', ?, ?)`,
  )
  for (const c of packCards.slice(0, keepCount)) addInv.run(c.cardId, c.variant || 'normal', perCardCost, nowIso())
  if (keepCount < packCards.length) {
    logActivity('storage', `${product?.name ?? 'Box'}: the shelf is full — ${packCards.length - keepCount} of the ${packCards.length} pulls stayed in the wrapper. Rent a locker before the next rip.`, 0)
  }

  const packIndex = box.packs_total - box.packs_left + 1
  const packsLeft = box.packs_left - 1
  if (packsLeft <= 0) db.prepare('DELETE FROM sealed_box_open WHERE id = ?').run(box.id)
  else db.prepare('UPDATE sealed_box_open SET packs_left = ? WHERE id = ?').run(packsLeft, box.id)

  const totalValue = round2(packCards.reduce((a, c) => a + c.value, 0))
  logActivity('pack', `Opened ${product?.name ?? 'a pack'} — pack ${packIndex} of ${box.packs_total}: ${packCards.length} cards, value ≈ $${totalValue.toFixed(2)}`, -box.per_pack_cost)

  return {
    sessionId,
    cards: packCards,
    totalValue,
    spent: box.per_pack_cost,
    boxId: box.id,
    productId: box.product_id,
    productName: product?.name ?? 'Sealed box',
    packIndex,
    packsTotal: box.packs_total,
    packsLeft,
    done: packsLeft <= 0,
  }
}

/** Take a box off the shelf, bank its promo, and open the first pack. */
export function beginBox(productId: string) {
  const row = db
    .prepare('SELECT * FROM sealed_inventory WHERE product_id = ? AND (escrow_loan IS NULL) ORDER BY acquired_at ASC LIMIT 1')
    .get(productId) as { id: number; product_id: string; cost: number; quantity: number } | undefined
  if (!row) {
    const anyLeft = db.prepare('SELECT COUNT(*) AS n FROM sealed_inventory WHERE product_id = ? AND quantity > 0').get(productId) as { n: number }
    throw new Error(anyLeft.n > 0 ? 'That stock is posted as loan collateral — redeem it from the futures desk first' : 'No sealed product in inventory')
  }
  const product = db
    .prepare('SELECT id, set_id, name, kind, packs, cards_per_pack, release_date FROM pack_products WHERE id = ?')
    .get(row.product_id) as { id: string; set_id: string; name: string; kind: string; packs: number | null; cards_per_pack: number; release_date: string | null } | undefined
  if (!product) throw new Error('Product missing')

  const packsInBox = product.kind === 'booster' || !product.packs ? 1 : Math.max(1, product.packs)
  const perPackCost = round2(row.cost / packsInBox)

  if (row.quantity > 1) db.prepare('UPDATE sealed_inventory SET quantity = quantity - 1 WHERE id = ?').run(row.id)
  else db.prepare('DELETE FROM sealed_inventory WHERE id = ?').run(row.id)

  const promo = grantPromo(product)

  const info = db
    .prepare(
      `INSERT INTO sealed_box_open (product_id, set_id, cards_per_pack, packs_left, packs_total, per_pack_cost, total_cost, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(product.id, product.set_id, product.cards_per_pack, packsInBox, packsInBox, perPackCost, row.cost, nowIso())
  const box = db.prepare('SELECT * FROM sealed_box_open WHERE id = ?').get(Number(info.lastInsertRowid)) as BoxRow
  return { ...ripNextPack(box), promo }
}

/** The next wrapper out of a box that is already open. */
export function openBoxNext(boxId: number) {
  const box = db.prepare('SELECT * FROM sealed_box_open WHERE id = ?').get(boxId) as BoxRow | undefined
  if (!box) throw new Error('That box is already empty')
  return ripNextPack(box)
}

/** Boxes with wrappers still in them, for the ceremony's resume row. */
export function openBoxes() {
  return db
    .prepare(
      `SELECT b.id, b.product_id, b.packs_left, b.packs_total, p.name
       FROM sealed_box_open b LEFT JOIN pack_products p ON p.id = b.product_id
       ORDER BY b.created_at ASC`,
    )
    .all() as { id: number; product_id: string; packs_left: number; packs_total: number; name: string | null }[]
}
