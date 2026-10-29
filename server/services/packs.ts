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

const RARITY_RANK: Record<string, number> = {
  'Common': 1, 'Uncommon': 2, 'Rare': 3, 'Double Rare': 4, 'Illustration Rare': 5,
  'Special Illustration Rare': 6, 'Hyper Rare': 7, 'Ultra Rare': 5, 'Rare Holo': 3,
  'Rare Holo V': 4, 'Rare Holo VMAX': 5, 'Rare Holo VSTAR': 5, 'Rare SECRET': 6,
  'Rare Ultra': 5, 'Rare Break': 4, 'Rare Holo EX': 5, 'Radiant Rare': 4,
}

function rarityRank(r: string | null): number {
  if (!r) return 0
  return RARITY_RANK[r] ?? (r.startsWith('Rare') ? 3 : 1)
}

export function buildPullTable(setId: string, cardsPerPack = 10) {
  const cards = db
    .prepare(`SELECT id, name, rarity, supertype, number FROM cards WHERE set_id = ? AND supertype = 'Pokémon'`)
    .all(setId) as { id: string; name: string; rarity: string | null; supertype: string; number: string }[]

  if (cards.length === 0) return

  const commons: typeof cards = []
  const uncommons: typeof cards = []
  const holos: typeof cards = []
  const hits: typeof cards = []

  for (const c of cards) {
    const rank = rarityRank(c.rarity)
    // Word-boundary tokens: 'ex'/'V'/'GX' are named suffixes, not substrings
    // (Vulpix, Eevee, Exeggcute and Venusaur all contain v/x letters).
    // Bracketed segments are form/letter labels — 'Unown [V]' is a common, not
    // a special-art V.
    const special = /\b(ex|v|gx|vmax|vstar|v-union)\b/i.test(c.name.replace(/\[[^\]]*\]/g, ' '))
    if (rank <= 1 && !special) commons.push(c)
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
    const wHit = hits.length ? 1 / hits.length : 0
    for (const c of hits) insert.run(pid, c.id, 'hit', wHit)
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
  const plan: SlotPlan = { common: 5, uncommon: 3, holo: 1, hit: 1 }
  const loadPool = (slot: string) =>
    (db.prepare(`SELECT card_id, weight FROM pack_product_cards WHERE pack_product_id = ? AND slot = ?`).all(`${setId}-booster`, slot) as { card_id: string; weight: number }[])
      .map((r) => ({ ...r, v: valueOf(r.card_id) }))
  const commons = loadPool('common')
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
  }
  sims.sort((a, b) => a - b)
  const p = (q: number) => round2(sims[Math.floor(q * (sims.length - 1))])

  const chases = db
    .prepare(
      `SELECT c.id, c.name, c.rarity, pr.market FROM pack_product_cards ppc
       JOIN cards c ON c.id = ppc.card_id
       JOIN price_records pr ON pr.card_id = c.id AND pr.kind = 'tcgplayer' AND pr.variant = 'normal'
       WHERE ppc.pack_product_id = ? AND ppc.slot = 'hit'
         AND pr.retrieved_at = (SELECT MAX(retrieved_at) FROM price_records p2 WHERE p2.card_id = pr.card_id AND p2.kind = 'tcgplayer' AND p2.variant = 'normal')
       ORDER BY pr.market DESC LIMIT 5`,
    )
    .all(`${setId}-booster`) as { id: string; name: string; rarity: string; market: number }[]

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
  const slots: { slot: string; count: number }[] = [
    { slot: 'common', count: 5 },
    { slot: 'uncommon', count: 3 },
    { slot: 'holo', count: holosCount(setId) > 0 ? 1 : 0 },
    { slot: 'hit', count: 1 },
  ]
  const rows = db.prepare(`SELECT card_id, weight, slot FROM pack_product_cards WHERE pack_product_id = ?`).all(pid) as { card_id: string; weight: number; slot: string }[]
  if (rows.length === 0) return null

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
        const isHit = slot === 'hit'
        insertPull.run(sessionId, pid, cardId, variant, value, rarity ?? null, isHit ? 1 : 0, at, owner)
        results.push({ cardId, isHit, value, variant })
      }
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
  // Uniform within slot — real per-card pull rates are not published; the
  // slot structure itself is what encodes scarcity.
  return pool[Math.floor(Math.random() * pool.length)].card_id
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
