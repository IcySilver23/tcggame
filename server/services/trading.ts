import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { valueOf, CONDITION_MULT, round2, type Condition } from './market'
import * as market from './market'
import * as vault from './vault'

// ---------------------------------------------------------------------------
// Personality archetypes
// ---------------------------------------------------------------------------

type Archetype = {
  id: string
  label: string
  blurb: string
  avatar: string
  budget: number
  wants: (card: { supertype: string | null; rarity: string | null; setYear: number }) => number // demand multiplier
  traits: { patience: number; scrutiny: number; cashFlex: number; heat: number }
}

// All valuation in this file is anchored on REAL TCGplayer/PriceCharting/eBay data
// via market.valueOf() — personalities only skew perception around those anchors.
export const ARCHETYPES: Archetype[] = [
  {
    id: 'grail_hunter',
    label: 'Grail Hunter',
    blurb: 'Chases one perfect card forever. Pays way over market for the right piece.',
    avatar: '🏆',
    budget: 4000,
    wants: ({ rarity, setYear }) => (rarity?.includes('Illustration') || rarity?.includes('Secret') ? 2.2 : setYear <= 2007 ? 1.8 : 0.3),
    traits: { patience: 0.35, scrutiny: 0.15, cashFlex: 0.35, heat: 0.2 },
  },
  {
    id: 'set_builder',
    label: 'Set Builder',
    blurb: 'Completing every expansion, one duplicate at a time. Loves commons and uncommons.',
    avatar: '📑',
    budget: 1500,
    wants: ({ rarity }) => (rarity === 'Common' ? 1.6 : rarity === 'Uncommon' ? 1.4 : rarity?.startsWith('Rare') && !rarity.includes('Holo') ? 1.2 : 0.7),
    traits: { patience: 0.7, scrutiny: 0.35, cashFlex: 0.1, heat: 0.1 },
  },
  {
    id: 'flipper',
    label: 'Flipper',
    blurb: 'Trades for undervalued cardboard, sells within the hour. Only fair or better deals.',
    avatar: '📈',
    budget: 6000,
    wants: () => 1,
    traits: { patience: 0.15, scrutiny: 0.5, cashFlex: 0.15, heat: 0.5 },
  },
  {
    id: 'holo_hoarder',
    label: 'Holo Hoarder',
    blurb: 'Shiny side up, always. Pays a premium for anything that catches the light.',
    avatar: '✨',
    budget: 3000,
    wants: ({ rarity, supertype }) => (supertype === 'Energy' ? 0.4 : rarity?.includes('Holo') || rarity?.includes('Rare') ? 1.7 : 0.9),
    traits: { patience: 0.5, scrutiny: 0.3, cashFlex: 0.2, heat: 0.25 },
  },
  {
    id: 'vintage_purist',
    label: 'Vintage Purist',
    blurb: 'Nothing printed after 2007 matters. WotC-era or nothing.',
    avatar: '🕰️',
    budget: 5000,
    wants: ({ setYear }) => (setYear <= 2007 ? 2.0 : setYear <= 2015 ? 0.9 : 0.15),
    traits: { patience: 0.6, scrutiny: 0.25, cashFlex: 0.25, heat: 0.1 },
  },
  {
    id: 'deal_seeker',
    label: 'Deal Seeker',
    blurb: 'Collects profit margins, not cards. Lowballs happily, walks away fast.',
    avatar: '💰',
    budget: 2000,
    wants: () => 1,
    traits: { patience: 0.2, scrutiny: 0.6, cashFlex: 0.1, heat: 0.4 },
  },
]

const NAMES = [
  ['Maria "The Vault" Salazar', '@vaultkeeper'],
  ['Kenji Watanabe', '@wotc_kenji'],
  ['Priya Chandra', '@bindergoddess'],
  ['Otto "Flex" Frederiksen', '@flexdeals'],
  ['Dana Whitfield', '@holosniffer'],
  ['Luis Okafor', '@setocomplete'],
  ['Greta Lindqvist', '@psa_or_death'],
  ['Miles Turner', '@turnt_on_turnbacks'],
  ['Fatima Nasser', '@shinyfangirl'],
  ['Bruno Castellanos', '@brunobindery'],
]

const OPENERS = [
  'Saw your binder at the last meetup — got a minute?',
  'Been hunting for one of these for months. Name your price.',
  'I know what I have, and I know what you have. Trade?',
  'My spare for your piece. Clean swap, no drama.',
  'Word is you have good taste. Prove it.',
  'Cash on the barrel, or cards. Your call.',
]

// ---------------------------------------------------------------------------
// Population: ensure 6 traders with distinct archetypes and small collections
// ---------------------------------------------------------------------------

export function ensureTraders() {
  // Lazy migration for saves created before reputation existed.
  const cols = db.prepare(`PRAGMA table_info(traders)`).all() as { name: string }[]
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('reputation')) db.exec(`ALTER TABLE traders ADD COLUMN reputation REAL NOT NULL DEFAULT 0`)
  if (!names.has('walked_away')) db.exec(`ALTER TABLE traders ADD COLUMN walked_away INTEGER NOT NULL DEFAULT 0`)
  // Lifetime ledger for the Trade view's stats panel.
  if (!names.has('offers_made')) db.exec(`ALTER TABLE traders ADD COLUMN offers_made INTEGER NOT NULL DEFAULT 0`)
  if (!names.has('offers_accepted')) db.exec(`ALTER TABLE traders ADD COLUMN offers_accepted INTEGER NOT NULL DEFAULT 0`)
  if (!names.has('ev_net')) db.exec(`ALTER TABLE traders ADD COLUMN ev_net REAL NOT NULL DEFAULT 0`)
  const n = (db.prepare('SELECT COUNT(*) AS n FROM traders').get() as { n: number }).n
  if (n >= 6) return
  const insertTrader = db.prepare(
    `INSERT OR IGNORE INTO traders (name, handle, archetype, cash, seed_cash, traits, blurb, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertCard = db.prepare(
    `INSERT INTO trader_cards (trader_id, card_id, variant, condition, acquired_at) VALUES (?, ?, ?, ?, ?)`,
  )
  const year = (setId: string): number => {
    const row = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(setId) as { release_date: string } | undefined
    return row ? Number(row.release_date.slice(0, 4)) : 2025
  }
  const tx = db.transaction(() => {
    let nameIdx = Math.floor(Math.random() * NAMES.length)
    for (const arch of ARCHETYPES) {
      const exists = db.prepare('SELECT 1 FROM traders WHERE archetype = ?').get(arch.id)
      if (exists) continue
      const [name, handle] = NAMES[nameIdx % NAMES.length]
      nameIdx++
      const cash = Math.round(arch.budget * (0.5 + Math.random() * 0.5))
      const info = insertTrader.run(name, handle, arch.id, cash, arch.budget, JSON.stringify(arch.traits), arch.blurb, arch.avatar, nowIso())
      const traderId = Number(info.lastInsertRowid)
      // Seed a collection of ~24 cards skewed toward what the archetype wants.
      const pool = db
        .prepare(
          `SELECT c.id, c.rarity, c.supertype, c.set_id,
                  (SELECT market FROM price_records pr WHERE pr.card_id = c.id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) AS m
           FROM cards c WHERE c.rarity IS NOT NULL AND c.rarity != ''
           ORDER BY RANDOM() LIMIT 400`,
        )
        .all() as { id: string; rarity: string; supertype: string | null; set_id: string; m: number | null }[]
      const valued = pool.filter((p) => p.m != null && p.m > 0.05 && p.m < 400)
      const scored = valued
        .map((p) => ({ ...p, want: arch.wants({ rarity: p.rarity, supertype: p.supertype, setYear: year(p.set_id) }) }))
        .sort((a, b) => b.want - a.want)
      const top = scored.slice(0, Math.max(40, Math.floor(scored.length * 0.3)))
      for (let i = 0; i < 24 && top.length > 0; i++) {
        const card = top[Math.floor(Math.random() * top.length)]
        const cond = pick(['NM', 'NM', 'NM', 'LP', 'MP'] as Condition[])
        insertCard.run(traderId, card.id, 'normal', cond, nowIso())
      }
    }
  })
  tx()
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ---------------------------------------------------------------------------
// Reputation — completed trades build trust, walk-aways sour the relationship.
// Clamped -10..+10. Effects: better prices, softer counters, more tolerance
// when you're slightly short, and more approaches — or the opposite.
// ---------------------------------------------------------------------------

type RepRow = { id: number; reputation: number; walked_away: number }

function clampRep(v: number): number {
  return Math.max(-10, Math.min(10, Math.round(v * 100) / 100))
}

function addRep(traderId: number, delta: number) {
  db.prepare(`UPDATE traders SET reputation = MAX(-10, MIN(10, reputation + ?)) WHERE id = ?`).run(delta, traderId)
}

/**
 * How far a trader opens up BEYOND their visible binder, 0..0.35. The mirror of
 * the grudge: if you've consistently taken the LOSING end against someone
 * (deeply negative lifetime avg EV — they've been profiting off you), they
 * court your business — best cards surface, two-card lineups more often.
 * Rubber-band mercy for a losing player, and self-limiting: win back enough
 * value and the average climbs past −$5 and it fades before you could farm it.
 */
function generosityOf(trader: { ev_net?: number; trade_count?: number }): number {
  const trades = trader.trade_count ?? 0
  if (trades === 0) return 0
  const avg = (trader.ev_net ?? 0) / trades
  if (avg >= -5) return 0
  return Math.min(0.35, (-avg - 5) / 100)
}

/** Reputation multiplier on the trader's perceived value: 0.9 at -10, 1.1 at +10. */
function repValueMult(rep: number): number {
  return 1 + rep * 0.01
}

/** The forum's ship-first perk: at 40+ forum standing, trade partners know
 * you from the scene and ship their side before you've shipped yours — the
 * escrow anxiety ends. Mechanically: a +2 effective trader reputation floor
 * (their warmth toward a forum pillar) and a patience bump on counters. */
function forumShipFirst(): boolean {
  return lazyForumRep() >= 40
}
/** The forum's standing, read fresh on every call — a cached value here would
 * pin ship-first to whatever the rep was at server boot. (No import cycle:
 * this reads the meta the forum service owns, not the module.) */
function lazyForumRep(): number {
  try {
    const row = db.prepare(`SELECT value FROM meta WHERE key = 'forum:rep'`).get() as { value: string } | undefined
    return Number(row?.value ?? '0')
  } catch {
    return 0
  }
}

/** How much of a shortfall they tolerate before refusing outright (× your card's real value). */
function tolerance(rep: number): number {
  return rep >= 0 ? 0.15 + rep * 0.05 : 0.15 + rep * 0.025
}

/** Counter-ask multiplier: trusted collectors leave money on the table. */
function repCounterMult(rep: number): number {
  return 1 - rep * 0.025
}

/** Stance label for the UI. */
export function stanceOf(rep: number): string {
  if (rep >= 6) return 'Trusted'
  if (rep >= 2) return 'Friendly'
  if (rep > -2) return 'Neutral'
  if (rep > -6) return 'Wary'
  return 'Hostile'
}

const REP_DECAY_TOWARD_ZERO = 0.03 // fraction per tick — relationships fade slowly

// ---------------------------------------------------------------------------
// Valuation — everyone sees the real price; personalities distort *perceived* value
// ---------------------------------------------------------------------------

/** How much a trader PERCEIVES a card as worth (both directions). */
export function perceivedValue(
  traits: { scrutiny: number; cashFlex: number; heat: number },
  arch: Archetype,
  cardId: string,
  condition: Condition,
  repMult = 1,
  mode: 'offer' | 'value' = 'offer',
): number {
  const real = valueOf(cardId, 'normal', condition)
  if (real <= 0) return 0
  const card = db.prepare('SELECT rarity, supertype, set_id FROM cards WHERE id = ?').get(cardId) as { rarity: string | null; supertype: string | null; set_id: string } | undefined
  const demand = card ? arch.wants({ rarity: card.rarity, supertype: card.supertype, setYear: Number((db.prepare('SELECT release_date FROM sets WHERE id = ?').get(card.set_id) as { release_date: string }).release_date.slice(0, 4)) }) : 1
  // Their offer: pay less than their own perceived value (that's the margin).
  const perception = real * (0.85 + Math.random() * 0.3) * Math.min(2.5, Math.max(0.4, demand))
  // 'offer' mode: their BUYING discount applies — the margin they skim when
  //   paying cash for a card.
  // 'value' mode: what the card is honestly worth to them — used for cards
  //   they GIVE AWAY (the player actually receives it at real value, so
  //   crediting it at a buying discount made every trade leak free value).
  const offerFrac = mode === 'value' ? 1 : 0.7 + (1 - traits.scrutiny) * 0.15 + traits.cashFlex * 0.1
  return Math.max(0.05, round2(perception * offerFrac * repMult))
}

// ---------------------------------------------------------------------------
// Offer assembly
// ---------------------------------------------------------------------------

type TheirCard = { traderCardId: number; cardId: string; name: string; image: string | null; variant: string; condition: string; value: number }

/**
 * How hard this trader guards their binder from you, 0..1. Driven by lifetime
 * EV from YOUR perspective: if you're consistently UP big against someone,
 * they've been bleeding value and close the binder (anti-farm guard).
 * Reputation is deliberately NOT a factor — winning trades also build rep, so
 * a rep-based softening would re-open the door to exactly the farmer it exists
 * to stop. Negative feedback: the way back is to trade fair (lose less), which
 * pulls the average toward 0 and fades the grudge.
 *   ≤ +$5/trade → 0 (fair) · +$15 → ~0.1 · +$40 → ~0.35 · +$95+ → 0.9 cap
 */
function grudgeDepthOf(trader: { ev_net?: number; trade_count?: number }): number {
  const trades = trader.trade_count ?? 0
  if (trades === 0) return 0
  const avg = (trader.ev_net ?? 0) / trades
  if (avg <= 5) return 0
  return Math.min(0.9, (avg - 5) / 100)
}

/**
 * Cards the trader would put on the table for something worth `targetValue`.
 * A trader you've farmed hides their best cards: with `grudge` > 0, the top
 * slice of their binder is off the table (and out of sight) until the ledger
 * evens out. A `generosityBonus` > 0 (losing player) surfaces their best card
 * as an occasional sweetener instead.
 */
function fittingLineup(traderId: number, arch: Archetype, traits: { scrutiny: number; cashFlex: number; heat: number }, targetValue: number, repMult = 1, mode: 'offer' | 'value' = 'offer', grudge = 0, generosityBonus = 0): TheirCard[] {
  const rows = db
    .prepare(
      `SELECT tc.id, tc.card_id, tc.condition, c.name, c.image_small
       FROM trader_cards tc JOIN cards c ON c.id = tc.card_id
       WHERE tc.trader_id = ?`,
    )
    .all(traderId) as { id: number; card_id: string; condition: string; name: string; image_small: string | null }[]
  const valued = rows
    .map((r) => ({ traderCardId: r.id, cardId: r.card_id, name: r.name, image: r.image_small, variant: 'normal', condition: r.condition, value: perceivedValue(traits, arch, r.card_id, (r.condition as Condition) || 'NM', repMult, mode) }))
    .sort((a, b) => b.value - a.value)
  // Grudge gate: the deeper it runs, the more of the top end stays in the binder.
  const visibleCount = Math.max(1, Math.ceil(valued.length * (1 - grudge)))
  const hiddenIds = new Set(valued.slice(visibleCount).map((c) => c.traderCardId))
  const fitting = valued
    .filter((c) => c.value > 0 && c.value <= targetValue * (targetValue < 1 ? 3 : 1.15) && !hiddenIds.has(c.traderCardId))
    .sort((a, b) => b.value - a.value)
  // Bulk-tier targets (< $0.50): any single cheap card will do — bulk for bulk.
  if (fitting.length === 0 && targetValue < 0.5) {
    const cheapest = valued
      .filter((c) => c.value > 0 && !hiddenIds.has(c.traderCardId))
      .sort((a, b) => a.value - b.value)[0]
    return cheapest ? [cheapest] : []
  }
  if (fitting.length === 0) return []
  // Generous traders offer two-card lineups more often — and occasionally lay
  // their single best visible card on the table as a sweetener (the "back of
  // the binder" moment). Only proposal callers pass this > 0: an incoming
  // offer with a free grail attached would be an unbounded giveaway, and the
  // acceptance math makes YOU pay for the bonus card in proposals.
  const twoCardChance = 0.25 + generosityBonus * 2
  let lineup = fitting.slice(0, Math.random() < twoCardChance && fitting.length >= 2 ? 2 : 1)
  if (generosityBonus > 0 && Math.random() < Math.min(0.5, generosityBonus * 3)) {
    // The courting sweetener is proportional to the trade at hand — best card
    // within 1.5× the target — so "mercy" can't be harvested by pairing a
    // junk card with a once-in-a-lifetime binder grail.
    const bestVisible = valued.find((c) => !hiddenIds.has(c.traderCardId) && c.value <= targetValue * 1.5)
    if (bestVisible && !lineup.some((c) => c.traderCardId === bestVisible.traderCardId)) lineup = [...lineup, bestVisible]
  }
  return lineup
}

/** Propose a trade: you give one collection card (+ optional cash top-up), they give cards/cash. */
export function proposeTrade(
  traderId: number,
  inventoryId: number,
  yourCashOffer: number,
): { ok: boolean; reply: string; accepted?: boolean; offer?: Record<string, unknown>; error?: string } {
  ensureTraders()
  const trader = db.prepare('SELECT * FROM traders WHERE id = ?').get(traderId) as
    | { id: number; name: string; handle: string; archetype: string; cash: number; seed_cash: number; traits: string; reputation?: number; walked_away?: number; ev_net?: number; trade_count?: number }
    | undefined
  if (!trader) return { ok: false, reply: '', error: 'Trader not found' }
  const arch = ARCHETYPES.find((a) => a.id === trader.archetype) ?? ARCHETYPES[0]
  const traits = JSON.parse(trader.traits) as { patience: number; scrutiny: number; cashFlex: number; heat: number }

  const mine = db
    .prepare(`SELECT i.*, c.name, c.image_small FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ? AND i.status = 'collection'`)
    .get(inventoryId) as { id: number; card_id: string; condition: string; variant: string; quantity: number; graded_grade: string | null; name: string; image_small: string | null } | undefined
  if (!mine) return { ok: false, reply: '', error: 'That card is not available to trade' }
  const onBlock = db.prepare(`SELECT COUNT(*) AS n FROM ebay_auctions WHERE inventory_id = ? AND status = 'live'`).get(inventoryId) as { n: number }
  if (onBlock.n > 0) return { ok: false, reply: '', error: 'That card is on the BidBay auction block — traders respect a live hammer' }
  if (mine.quantity > 1) return { ok: false, reply: '', error: 'Trade one copy at a time' }
  if (mine.graded_grade) return { ok: false, reply: '', error: 'Graded slabs do not trade — sell them instead' }

  const realValue = valueOf(mine.card_id, mine.variant || 'normal', (mine.condition as Condition) || 'NM')
  if (realValue <= 0) return { ok: false, reply: '', error: 'No market data for that card yet' }

  // Reputation colors everything: trusted collectors value your cards higher,
  // hostile ones lowball and refuse more often.
  let rep = (trader as { reputation?: number }).reputation ?? 0
  // Ship-first trust (forum rep 40+): partners ship first, warmth is real.
  if (forumShipFirst()) rep = Math.max(rep, 2)
  const streak = (trader as { walked_away?: number }).walked_away ?? 0
  const repMult = repValueMult(rep)
  // Farming someone shuts their binder; losing to them opens it back up.
  const grudge = grudgeDepthOf(trader)
  const theirCards = fittingLineup(traderId, arch, traits, realValue, repMult, 'value', grudge, generosityOf(trader))
  // Player-side mirror of the insulting-lowball guard, in REAL market value on
  // both sides (perception must not launder a rip-off past it). A binder that
  // can't even reach 30% of your card's worth is politely declined outright.
  const lineupReal = theirCards.reduce((a, c) => a + valueOf(c.cardId, 'normal', (c.condition as Condition) || 'NM'), 0)
  if (realValue >= 1 && lineupReal < realValue * 0.3) {
    logActivity('trade', `${trader.name} eyes your ${mine.name}. "That's out of my league — got anything smaller?"`)
    return { ok: true, reply: `"Whoa — that's out of my league. Bring me something in my range and we'll talk." — ${trader.name}`, accepted: false }
  }
  // Direct execution requires the lineup to be at least 85% of your card's
  // real worth; anything weaker must go to a counter, where counterFrom's
  // cash ask is floored on the real shortfall — the player never
  // auto-loses more than ~15% of market without getting a say.
  if (theirCards.length === 0) return { ok: false, reply: '', error: `${trader.name} has nothing comparable on offer right now` }

  // Their acceptance math on YOUR side: perceived value of what they receive.
  // 'value' mode on both sides keeps the exchange honest — specialists still
  // overpay for cards they chase, but nobody wins a baked-in discount.
  const yourPerceived = perceivedValue(traits, arch, mine.card_id, (mine.condition as Condition) || 'NM', repMult, 'value')
  const theirSide = theirCards.reduce((a, c) => a + c.value, 0)
  const balance = yourPerceived + yourCashOffer - theirSide

  if (balance >= -realValue * tolerance(rep)) {
    // Good enough — but patient traders still push once in a while.
    if (traits.patience > 0.45 && Math.random() < 0.3) {
      return counterFrom(trader, theirCards, mine, yourCashOffer)
    }
    if (lineupReal >= realValue * 0.85) {
      return executeTrade(trader, theirCards, inventoryId, yourCashOffer, 'outgoing')
    }
    return counterFrom(trader, theirCards, mine, yourCashOffer)
  }
  if (balance < -realValue * (0.9 + streak * 0.25)) {
    // Insulting lowball — hard no. A walk-away streak hardens the door.
    logActivity('trade', `${trader.name} turned you down flat on ${mine.name}.${grudge > 0.4 ? ' "And after how you traded with me? My best stays in the binder."' : ''}`)
    return { ok: true, reply: pickHardNo(trader.name, rep, streak), accepted: false }
  }
  return counterFrom(trader, theirCards, mine, yourCashOffer)
}

function counterFrom(
  trader: { id: number; name: string; archetype: string; cash: number; seed_cash: number; reputation?: number; walked_away?: number },
  theirCards: TheirCard[],
  mine: { id: number; card_id: string; name: string; image_small: string | null; condition: string; variant: string },
  yourCashOffer: number,
) {
  const gap = Math.max(0, theirCards.reduce((a, c) => a + c.value, 0) - yourCashOffer)
  const rep = trader.reputation ?? 0
  // Trusted collectors leave money on the table; hostile ones squeeze harder.
  let ask = round2(gap * (0.6 + Math.random() * 0.4) * repCounterMult(rep))
  // Player fairness CAP (in real market value): accepting the counter must
  // leave the player holding at least ~90% of their card's worth across lineup
  // + net cash. Landed = (L − ask)/M ≥ 0.9 ⇔ ask ≤ L − 0.9M — exactly the
  // inverse of the haggle floor in haggleContext (cashToYou ≥ 0.9M − L), so a
  // counter at the cap and a haggle at the floor land at the same 90% line.
  // (An earlier /0.9 form here let positive-ask counters land a few % short.)
  // A strong lineup supports a bigger ask; a weak one forces the trader to
  // bridge the gap in cash (negative ask = their_cash, paid to you) instead of
  // you overpaying.
  const myReal = valueOf(mine.card_id, mine.variant || 'normal', (mine.condition as Condition) || 'NM')
  const lineupReal = theirCards.reduce((a, c) => a + valueOf(c.cardId, 'normal', (c.condition as Condition) || 'NM'), 0)
  // No minimum-value guard: the cap applies to penny cards too — a $0.76 ask on
  // top of a $0.65 lineup for a $0.44 card is exactly the rip-off it exists to
  // stop, and round2 noise at the bottom is harmless. The cap itself is floored
  // to the penny (not rounded) — rounding up could breach the 90% guarantee by
  // a cent or two, which the fairness explainer would then honestly report.
  ask = Math.min(ask, Math.floor((lineupReal - myReal * 0.9) * 100) / 100)
  // Counter lineups display in REAL market value too — what you see is what
  // you'd get (the trader's perceived values only drove their own side of the
  // negotiation, never the sticker).
  const theirReal = theirCards.map((c) => ({ ...c, value: valueOf(c.cardId, 'normal', (c.condition as Condition) || 'NM') }))
  saveThread({
    traderId: trader.id,
    direction: 'outgoing',
    theirCards: theirReal,
    theirCash: ask, // cash the TRADER wants FROM you (negative: they chip in)
    yourItems: [{ inventoryId: mine.id, cardId: mine.card_id, name: mine.name, image: mine.image_small, condition: mine.condition, value: myReal }],
    yourCash: yourCashOffer,
    message: counterMsg(trader.name, ask),
    rounds: 1,
  })
  logActivity('trade', ask > 0 ? `${trader.name} wants $${ask.toFixed(2)} on top for the swap.` : `${trader.name} will throw in $${(-ask).toFixed(2)} to close the swap.`)
  return { ok: true, reply: counterMsg(trader.name, ask), accepted: false }
}

function counterMsg(name: string, ask: number) {
  if (ask <= 0) {
    // The fairness cap pushed the ask negative — the trader bridges the gap in
    // cash instead of asking you to overpay for a thin lineup.
    return pick([
      `"Tell you what — I'll toss in $${(-ask).toFixed(2)} to make this right." — ${name}`,
      `"My lineup's light. I'll add $${(-ask).toFixed(2)} and we're square." — ${name}`,
    ])
  }
  return pick([
    `"Close — but I need $${ask.toFixed(2)} on top to even look at it." — ${name}`,
    `"Sweeten it by $${ask.toFixed(2)} and we shake hands." — ${name}`,
    `"My binder says that's short. $${ask.toFixed(2)} more." — ${name}`,
  ])
}

function pickHardNo(name: string, rep = 0, streak = 0) {
  if (rep <= -4 || streak >= 2) return pick(HARD_NO_COLD(name))
  return pick(HARD_NO_LINES(name))
}

export function acceptCounter(tradeId: number) {
  const t = db.prepare(`SELECT * FROM trade_offers WHERE id = ? AND status = 'pending'`).get(tradeId) as
    | { id: number; trader_id: number; direction: string; their_cards: string; their_cash: number; your_items: string; your_cash: number }
    | undefined
  if (!t) return { ok: false, error: 'No pending counter' }
  const theirCards = JSON.parse(t.their_cards) as TheirCard[]
  const trader = db.prepare('SELECT * FROM traders WHERE id = ?').get(t.trader_id) as { id: number; name: string; cash: number } | undefined
  if (!trader) return { ok: false, error: 'Trader gone' }
  if (t.direction !== 'outgoing' || !t.your_items) return { ok: false, error: 'Nothing to accept' }
  const yourItems = JSON.parse(t.your_items) as { inventoryId: number }[]
  if (yourItems.length !== 1) return { ok: false, error: 'Broken thread' }
  const netCash = t.your_cash - t.their_cash // >0: trader pays you; <0: you pay the counter
  if (netCash < 0) {
    const gs = market.getGameState()
    if (gs.cash < -netCash) return { ok: false, error: `You need $${(-netCash).toFixed(2)} cash to accept this counter` }
  } else if (trader.cash < netCash) {
    return { ok: false, error: `${trader.name} is out of cash` }
  }
  return executeTrade(trader, theirCards, yourItems[0].inventoryId, netCash, 'outgoing')
}

export function declineCounter(tradeId: number) {
  db.prepare(`UPDATE trade_offers SET status = 'rejected' WHERE id = ? AND status = 'pending'`).run(tradeId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Offer haggling — propose a different cash split on ANY pending thread.
// Everything here speaks netToPlayer: >0 the trader pays you, <0 you pay
// them. (outgoing threads: netToPlayer = your_cash − their_cash; incoming:
// their_cash − your_cash — the trader's sweetener is money TO you.) On
// outgoing (counter) threads a better deal means their ask drops; on incoming
// offers it means their sweetener grows — same ledger, opposite storage sign.
// The trader accepts at/below their current stance, counters partway toward
// your number within a cashFlex-scaled headroom (bounded by how much surplus
// their perception leaves on the table), or walks if pushed past it. The
// player-side 90% fairness floor is enforced live in the UI from `haggle.min`
// on counters and re-enforced here so the API can't be gamed.
// ---------------------------------------------------------------------------

function haggleContext(t: { id: number; trader_id: number; direction: 'incoming' | 'outgoing'; their_cards: string; their_cash: number; your_items: string; your_cash: number }) {
  const theirCards = JSON.parse(t.their_cards) as TheirCard[]
  const yourItems = JSON.parse(t.your_items) as { inventoryId: number; cardId: string; condition: string; value: number }[]
  const trader = db.prepare('SELECT * FROM traders WHERE id = ?').get(t.trader_id) as
    | { id: number; name: string; archetype: string; traits: string; cash: number; reputation?: number }
    | undefined
  if (!trader || yourItems.length !== 1) return null
  const arch = ARCHETYPES.find((a) => a.id === trader.archetype) ?? ARCHETYPES[0]
  const traits = JSON.parse(trader.traits) as { patience: number; scrutiny: number; cashFlex: number; heat: number }
  const repMult = repValueMult(trader.reputation ?? 0)
  // Their perception of the whole deal — the surplus their opinion leaves on
  // the table is the haggle room. REAL values only set the fairness floor.
  const perceivedMine = perceivedValue(traits, arch, yourItems[0].cardId, (yourItems[0].condition as Condition) || 'NM', repMult, 'value')
  const perceivedLineup = theirCards.reduce((a, c) => a + perceivedValue(traits, arch, c.cardId, (c.condition as Condition) || 'NM', repMult, 'value'), 0)
  const myReal = yourItems[0].value
  const lineupReal = theirCards.reduce((a, c) => a + c.value, 0)
  // Current stance in netToPlayer terms (positive = trader pays you).
  const current = t.direction === 'incoming' ? t.their_cash - t.your_cash : t.your_cash - t.their_cash
  // Fairness floor: accepting must land ≥ 90% of the card's real worth
  // (lineup + net cash) ⇒ cashToYou ≥ 0.9·M − L. Ceil to the penny — a lower
  // bound tightens by rounding up, never loosens.
  const min = Math.ceil((myReal * 0.9 - lineupReal) * 100) / 100
  // Headroom: their perception of your card minus their lineup is their ledger
  // surplus (P = perceivedMine − perceivedLineup); they'll concede real cash
  // up to it, but only reveal a cashFlex-scaled slice of the gap per round.
  // A small patience-scaled grace band always remains — even a trader whose
  // counter rode the fairness cap will nibble a quarter or two before walking.
  const ledgerSurplus = perceivedMine - perceivedLineup
  const grace = 0.25 + traits.patience * 0.75
  const max = current + Math.max(grace, Math.max(0, ledgerSurplus - current) * (0.4 + traits.cashFlex * 2.5 + Math.random() * 0.3))
  return { trader, arch, traits, theirCards, yourItems, myReal, lineupReal, current, min, max }
}

export function offerHaggle(tradeId: number, cashToYou: number): { ok: boolean; reply?: string; result?: 'accepted' | 'countered' | 'walked'; error?: string } {
  cashToYou = round2(cashToYou)
  const t = db.prepare(`SELECT * FROM trade_offers WHERE id = ? AND status = 'pending'`).get(tradeId) as
    | { id: number; trader_id: number; direction: 'incoming' | 'outgoing'; their_cards: string; their_cash: number; your_items: string; your_cash: number; rounds: number }
    | undefined
  if (!t) return { ok: false, error: 'No pending offer' }
  // Tutorial gate: any haggle attempt on a real thread (any outcome — even a
  // below-floor error or a walk — teaches the mechanics) flips the /api/state
  // flag that dismisses the one-time explainer in the UI.
  if (getMeta('haggledOnce') !== '1') setMeta('haggledOnce', '1')
  const ctx = haggleContext(t)
  if (!ctx) return { ok: false, error: 'Broken thread' }
  const { trader, traits, myReal, lineupReal, current, min, max } = ctx

  // Fairness floor — outgoing (counter) threads only. Counters carry the 90%
  // guarantee, so the player can't self-break it even via the API. Incoming
  // offers make no such promise (lowballs are legal openings — the ⚖ block
  // says so), and the player haggling UP from a lowball needs no floor.
  if (t.direction === 'outgoing' && cashToYou < min - 0.005) {
    return { ok: false, error: `The fairness cap blocks that — you'd land below 90% of your card's worth. The floor is ${min >= 0 ? `they pay you at least $${min.toFixed(2)}` : `you pay no more than $${(-min).toFixed(2)}`}.` }
  }
  // Pushed past what they'll stomach → walk. (Variance lives in the headroom
  // factor, not the threshold — max can be negative in cashToYou space.)
  if (cashToYou > max + 0.01 || (t.rounds >= 2 && cashToYou > current + 0.005)) {
    db.prepare(`UPDATE trade_offers SET status = 'rejected' WHERE id = ?`).run(tradeId)
    addRep(trader.id, -1)
    db.prepare(`UPDATE traders SET walked_away = walked_away + 1 WHERE id = ?`).run(trader.id)
    logActivity('trade', `${trader.name} laughs off your $${Math.abs(cashToYou).toFixed(2)} ${cashToYou >= 0 ? 'ask' : 'sweetener'} and walks.`)
    return { ok: true, result: 'walked', reply: pick([`"That's not a haggle, that's a mugging. We're done." — ${trader.name}`, `"You just priced yourself out of my binder." — ${trader.name}`]) }
  }
  // At or below their current stance → deal. Incoming threads settle at the
  // ORIGINAL terms (a player dragging below their own sweetener shouldn't
  // accidentally take less money); counters settle at the offered number.
  if (cashToYou <= current + 0.005) {
    const settle = t.direction === 'incoming' ? current : cashToYou
    return { ...executeTrade(trader as never, ctx.theirCards, ctx.yourItems[0].inventoryId, settle, t.direction), result: 'accepted' }
  }
  // Otherwise they meet you partway — patience decides how big a step. On
  // incoming threads a concession RAISES their sweetener; on counters it
  // LOWERS their ask. Either way their wallet bounds it — and since pending
  // sweeteners aren't debited until acceptance, the money already committed
  // in THIS thread comes back off the top.
  if (t.rounds >= 2) return { ok: false, error: `${trader.name} said final. The thread is closed.` }
  const desired = round2(Math.min(cashToYou - current, (cashToYou - current) * (0.5 + traits.patience * 0.4)))
  const committed = t.direction === 'incoming' ? t.their_cash : Math.max(0, current)
  const concession = round2(Math.min(desired, Math.max(0, trader.cash - committed)))
  if (concession <= 0) return { ok: false, error: `${trader.name} is out of cash to sweeten with.` }
  const newTheirCash = t.direction === 'incoming' ? round2(t.their_cash + concession) : round2(t.their_cash - concession)
  const netAfter = t.direction === 'incoming' ? newTheirCash - t.your_cash : t.your_cash - newTheirCash
  const netTxt = netAfter >= 0 ? `$${netAfter.toFixed(2)} your way` : `$${(-netAfter).toFixed(2)} on top`
  const line = `"Best I can do is ${netTxt}. Final-ish." — ${trader.name}`
  db.prepare(`UPDATE trade_offers SET their_cash = ?, rounds = rounds + 1, message = message || ? WHERE id = ?`).run(newTheirCash, ` — ${line}`, tradeId)
  return { ok: true, result: 'countered', reply: line }
}

// ---------------------------------------------------------------------------
// Execution — the atomic swap
// ---------------------------------------------------------------------------

function executeTrade(
  trader: { id: number; name: string; cash: number; reputation?: number; walked_away?: number; ev_net?: number; trade_count?: number },
  theirCards: TheirCard[],
  inventoryId: number,
  cashToMe: number,
  dir: 'incoming' | 'outgoing' = 'incoming',
) {
  const mine = db
    .prepare(`SELECT i.*, c.name FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ? AND i.status = 'collection'`)
    .get(inventoryId) as { id: number; card_id: string; name: string; condition: string } | undefined
  if (!mine) return { ok: false, reply: '', error: 'Your card changed status — trade aborted' }
  if (cashToMe > 0 && trader.cash < cashToMe) return { ok: false, reply: '', error: 'Trader is out of cash' }
  // Storage & the vault: a trade is a two-way door — but the incoming side
  // still needs somewhere to live.
  const admit = vault.admitRaw(theirCards.length, 'Trade')
  if (!admit.ok) return { ok: false, reply: '', error: admit.error }

  const tx = db.transaction(() => {
    // 1. Your card leaves the collection.
    db.prepare(`DELETE FROM inventory WHERE id = ?`).run(inventoryId)
    db.prepare('DELETE FROM binder_slots WHERE inventory_id = ?').run(inventoryId)
    // 2. Their cards enter your collection as REAL inventory rows.
    for (const c of theirCards) {
      db.prepare(
        `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
         VALUES (?, ?, ?, 1, 'collection', 'trade', ?, ?)`,
      ).run(c.cardId, c.variant, c.condition, c.value, nowIso())
      db.prepare('DELETE FROM trader_cards WHERE id = ?').run(c.traderCardId)
    }
    // 3. Cash moves. cashToMe > 0: trader pays you from their wallet.
    //    cashToMe < 0: you pay the counter-ask (e.g. accepting a cash-top-up counter).
    if (cashToMe > 0) {
      db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(round2(cashToMe))
      db.prepare('UPDATE traders SET cash = cash - ? WHERE id = ?').run(round2(cashToMe), trader.id)
    } else if (cashToMe < 0) {
      db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(round2(cashToMe))
    }
    db.prepare('UPDATE traders SET trade_count = trade_count + 1 WHERE id = ?').run(trader.id)
    // Trust: a completed trade repairs a broken relationship a little and
    // rewards an existing one. Also clears any walk-away streak.
    addRep(trader.id, trader.reputation !== undefined && trader.reputation < 0 ? 2.5 : 1.5)
    db.prepare(`UPDATE traders SET walked_away = 0 WHERE id = ?`).run(trader.id)
    // 4. Bookkeeping.
    db.prepare(`UPDATE trade_offers SET status = 'accepted' WHERE trader_id = ? AND status = 'pending'`).run(trader.id)
    logActivity(
      'trade',
      `Traded ${mine.name} to ${trader.name} for ${theirCards.map((c) => c.name).join(' + ')}${cashToMe > 0 ? ` + $${cashToMe.toFixed(2)}` : cashToMe < 0 ? ` (you added $${(-cashToMe).toFixed(2)})` : ''}.`,
    )
  })
  tx()
  const gained = theirCards.reduce((a, c) => a + valueOf(c.cardId, c.variant, (c.condition as Condition) || 'NM'), 0) + Math.max(0, cashToMe)
  const gave = valueOf(mine.card_id, 'normal', (mine.condition as Condition) || 'NM') + Math.max(0, -cashToMe)
  // Relationship moments: the ledger crossing a threshold is felt.
  const preLedger = { ev_net: trader.ev_net ?? 0, trade_count: trader.trade_count ?? 0 }
  const postLedger = { ev_net: preLedger.ev_net + (gained - gave), trade_count: preLedger.trade_count + 1 }
  if (grudgeDepthOf(preLedger) > 0 && grudgeDepthOf(postLedger) === 0) {
    logActivity('trade', `🔒 ${trader.name}'s binder opens back up to you. "Fair and square. Come see the good stuff."`)
  }
  if (generosityOf(preLedger) === 0 && generosityOf(postLedger) > 0) {
    logActivity('trade', `🤝 ${trader.name} is courting your business now — their best cards are suddenly on the table. "You've had rough luck. Let me make it right."`)
  }
  // Lifetime ledger: net value won/lost against this trader, plus incoming-offer
  // outcome tracking (of everything they've ever put on the table, how much did
  // you actually take?).
  db.prepare(`UPDATE traders SET ev_net = ev_net + ? WHERE id = ?`).run(round2(gained - gave), trader.id)
  if (dir === 'incoming') db.prepare(`UPDATE traders SET offers_accepted = offers_accepted + 1 WHERE id = ?`).run(trader.id)
  const verdict = gained >= gave ? 'Solid trade.' : gained > gave * 0.85 ? 'About even.' : 'You got worked.'
  return { ok: true, reply: `"Pleasure doing business." — ${trader.name} · ${verdict}`, accepted: true, gained: round2(gained), gave: round2(gave) }
}

const HARD_NO_LINES = (name: string) => [
  `"Not even close. Don't waste my time." — ${name}`,
  `"You're off by miles. Come back serious." — ${name}`,
  `"Hard pass." — ${name}`,
]

const HARD_NO_COLD = (name: string) => [
  `"We're done here. Don't come back." — ${name}`,
  `"You. Again. No." — ${name}`,
  `"After last time? Absolutely not." — ${name}`,
]

// ---------------------------------------------------------------------------
// Incoming offers — the NPC approaches YOU (tick-driven)
// ---------------------------------------------------------------------------

function saveThread(o: {
  traderId: number
  direction: 'incoming' | 'outgoing'
  theirCards: TheirCard[]
  theirCash: number
  yourItems: { inventoryId: number; cardId: string; name: string; image: string | null; condition: string; value: number }[]
  yourCash: number
  message: string
  rounds: number
}) {
  // Every incoming offer counts toward the trader's lifetime accept-rate denominator.
  if (o.direction === 'incoming') {
    db.prepare(`UPDATE traders SET offers_made = offers_made + 1 WHERE id = ?`).run(o.traderId)
    // An offer that expires unanswered is a real loss, so it wants a badge.
    const lead = o.theirCards[0]?.name ?? 'a card'
    const more = o.theirCards.length > 1 ? ` + ${o.theirCards.length - 1} more` : ''
    void import('./notify')
      .then((n) => n.push(
        'trade',
        '🤝 New trade offer',
        `${lead}${more} on the table${o.theirCash > 0 ? ` with ${o.theirCash.toFixed(2)}` : ''} — it expires if you sit on it.`,
        '#/trade',
      ))
      .catch(() => {})
  }
  db.prepare(
    `INSERT INTO trade_offers (trader_id, direction, their_cards, their_cash, your_items, your_cash, message, expires_at, status, rounds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(
    o.traderId,
    o.direction,
    JSON.stringify(o.theirCards),
    o.theirCash,
    JSON.stringify(o.yourItems),
    o.yourCash,
    o.message,
    new Date(Date.now() + 20 * 60_000).toISOString(),
    o.rounds,
    nowIso(),
  )
}

function maybeIncomingOffer() {
  // Cap applies to NPC-initiated offers only — your own counter threads don't block them.
  const pending = (db.prepare(`SELECT COUNT(*) AS n FROM trade_offers WHERE status = 'pending' AND direction = 'incoming'`).get() as { n: number }).n
  if (pending >= 3) return
  const trader = db.prepare(`SELECT * FROM traders WHERE cash > 5 ORDER BY RANDOM() LIMIT 1`).get() as
    | { id: number; name: string; archetype: string; cash: number; seed_cash: number; traits: string; reputation?: number; walked_away?: number; ev_net?: number; trade_count?: number }
    | undefined
  if (!trader) return
  const arch = ARCHETYPES.find((a) => a.id === trader.archetype) ?? ARCHETYPES[0]
  const traits = JSON.parse(trader.traits) as { patience: number; scrutiny: number; cashFlex: number; heat: number }
  const rep = trader.reputation ?? 0
  const streak = trader.walked_away ?? 0
  // Friendly collectors seek you out; hostile ones (or a walk-away streak) stay home.
  const heat = traits.heat * (1 + rep * 0.06) * Math.max(0, 1 - streak * 0.35)
  if (Math.random() > 0.12 + heat * 0.25) return

  // What do they covet from your collection? Bias by demand, cap by their cash.
  // Grudge hides their best cards here too; generosity APPLIES here — courting
  // a player who's down bad is self-limiting (each favorable offer pushes the
  // player's avg EV back toward fair, fading the mercy before it can be farmed).
  const grudge = grudgeDepthOf(trader)
  const generosity = generosityOf(trader)
  const want = db
    .prepare(
      `SELECT i.id, i.card_id, i.condition, c.name, c.image_small,
              (SELECT market FROM price_records pr WHERE pr.card_id = i.card_id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) AS m
       FROM inventory i JOIN cards c ON c.id = i.card_id
       WHERE i.status = 'collection' AND i.quantity = 1 AND i.graded_grade IS NULL AND i.condition != 'DM'
       ORDER BY RANDOM() LIMIT 60`,
    )
    .all() as { id: number; card_id: string; condition: string; name: string; image_small: string | null; m: number | null }[]
  if (want.length === 0) return
  const yearOf = (setId: string): number => {
    const row = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(setId) as { release_date: string } | undefined
    return row ? Number(row.release_date.slice(0, 4)) : 2025
  }
  const scored = want
    .filter((w) => w.m != null && w.m > 0.05)
    .map((w) => {
      const card = db.prepare('SELECT rarity, supertype, set_id FROM cards WHERE id = ?').get(w.card_id) as { rarity: string | null; supertype: string | null; set_id: string } | undefined
      const d = card ? arch.wants({ rarity: card.rarity, supertype: card.supertype, setYear: yearOf(card.set_id) }) : 1
      return { ...w, score: d * (0.8 + Math.random() * 0.4) }
    })
    .sort((a, b) => b.score - a.score)
  const target = scored[0]
  if (!target) return
  // A walk-away streak dims their interest in your binder — they pick from a
  // lower-quality slice of your collection.
  if (streak > 0 && scored.length > 2) {
    const dimmed = scored[Math.min(scored.length - 1, Math.floor(Math.random() * 3) + streak)]
    if (dimmed && Math.random() < 0.5) scored[0] = dimmed
  }

  const realValue = valueOf(target.card_id, 'normal', (target.condition as Condition) || 'NM')
  // They offer cards they personally value that FIT the target's worth — a real
  // trader doesn't throw their grail at a $0.13 common.
  const theirCards = fittingLineup(trader.id, arch, traits, realValue, repValueMult(rep), 'value', grudge, generosity).map((c) => ({
    ...c,
    // Offers are presented in REAL market value — what you see is what you
    // get. The trader's specialist bias decides what they WANT (and how hard
    // they sweeten), but their opinion of their own cards must not inflate
    // the sticker on an offer you're about to accept.
    value: valueOf(c.cardId, 'normal', (c.condition as Condition) || 'NM'),
  }))
  if (theirCards.length === 0) return
  const theirSide = theirCards.reduce((a, c) => a + c.value, 0)
  // Cash sweetener out of their wallet — partial, and capped well under the
  // shortfall: traders leave a little on the table in kind, not in cash. The
  // old top-up-to-95% turned every offer into free value; keep sweeteners as
  // a nudge toward yes, not a subsidy.
  let cash = 0
  if (theirSide < realValue * 0.95 && trader.cash > 20) {
    cash = Math.min(trader.cash * 0.25, round2((realValue * 0.95 - theirSide) * (0.3 + Math.random() * 0.4)))
    cash = round2(cash)
  }
  const total = theirSide + cash
  const flavor =
    total > realValue * 1.15
      ? pick(['"I know this is over market. I want it THAT bad."', '"Overpaying? Call it enthusiasm."'])
      : total >= realValue * 0.9
        ? pick(['"Fair swap by my book."', '"Even trade, binder to binder."'])
        : pick(['"I know it\'s light — but my binder needed this."', '"Take it or leave it, this is my number."'])
  saveThread({
    traderId: trader.id,
    direction: 'incoming',
    theirCards,
    theirCash: cash,
    yourItems: [{ inventoryId: target.id, cardId: target.card_id, name: target.name, image: target.image_small, condition: target.condition, value: realValue }],
    yourCash: 0,
    message: `${flavor} — ${trader.name}`,
    rounds: 0,
  })
  logActivity('trade', `${trader.name} offered ${theirCards.map((c) => c.name).join(' + ')}${cash > 0 ? ` + $${cash.toFixed(2)}` : ''} for your ${target.name}.`)
}

/** Accept an incoming offer as-is. */
export function acceptIncoming(tradeId: number) {
  const t = db.prepare(`SELECT * FROM trade_offers WHERE id = ? AND status = 'pending' AND direction = 'incoming'`).get(tradeId) as
    | { id: number; trader_id: number; their_cards: string; their_cash: number; your_items: string }
    | undefined
  if (!t) return { ok: false, error: 'Offer gone or already answered' }
  const theirCards = JSON.parse(t.their_cards) as TheirCard[]
  const yourItems = JSON.parse(t.your_items) as { inventoryId: number }[]
  const trader = db.prepare('SELECT * FROM traders WHERE id = ?').get(t.trader_id) as { id: number; name: string; cash: number } | undefined
  if (!trader) return { ok: false, error: 'Trader gone' }
  if (trader.cash < t.their_cash) return { ok: false, error: 'Trader is out of cash' }
  return executeTrade(trader, theirCards, yourItems[0].inventoryId, t.their_cash, 'incoming')
}

/** Reject an incoming offer — small chance they come back with more cash. Repeated
 *  rejections sour the relationship: their offers get worse and they stop asking. */
export function rejectIncoming(tradeId: number) {
  const t = db.prepare(`SELECT * FROM trade_offers WHERE id = ? AND status = 'pending' AND direction = 'incoming'`).get(tradeId) as
    | { id: number; trader_id: number; their_cash: number; rounds: number }
    | undefined
  if (!t) return { ok: false, error: 'Offer gone' }
  const trader = db.prepare('SELECT * FROM traders WHERE id = ?').get(t.trader_id) as { id: number; name: string; cash: number; seed_cash: number; traits: string; reputation?: number; walked_away?: number } | undefined
  if (!trader) return { ok: false, error: 'Trader gone' }
  const traits = JSON.parse(trader.traits) as { patience: number }
  const rep = trader.reputation ?? 0
  const streak = trader.walked_away ?? 0
  const canImprove = t.rounds === 0 && trader.cash > 40 && traits.patience > 0.3
  // Repeated walk-aways kill the sweetener: a spurned trader stops chasing.
  const improveChance = Math.max(0, 0.35 + traits.patience * 0.3 - streak * 0.18 - Math.max(0, -rep) * 0.02)
  if (canImprove && Math.random() < improveChance) {
    const bump = round2(Math.min(trader.cash * 0.2, 5 + Math.random() * 25))
    db.prepare(`UPDATE trade_offers SET their_cash = their_cash + ?, rounds = rounds + 1, message = message || ? WHERE id = ?`).run(
      bump,
      ` — ${trader.name}: "Fine, $${bump.toFixed(2)} more. Final."`,
      tradeId,
    )
    // Grudging respect: they climbed down once, small warmth. Streak resets.
    addRep(trader.id, 0.3)
    db.prepare(`UPDATE traders SET walked_away = 0 WHERE id = ?`).run(trader.id)
    logActivity('trade', `${trader.name} sweetened their offer by $${bump.toFixed(2)}.`)
    return { ok: true, improved: true, bump }
  }
  db.prepare(`UPDATE trade_offers SET status = 'rejected' WHERE id = ?`).run(tradeId)
  addRep(trader.id, -1)
  db.prepare(`UPDATE traders SET walked_away = walked_away + 1 WHERE id = ?`).run(trader.id)
  logActivity('trade', `You turned ${trader.name} down — again. Word gets around.`)
  return { ok: true, improved: false }
}

// ---------------------------------------------------------------------------
// Tick integration
// ---------------------------------------------------------------------------

export function tradeTick() {
  ensureTraders()
  // Expire stale threads.
  db.prepare(`UPDATE trade_offers SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`).run(nowIso())
  // Traders slowly earn money back toward their archetype budget.
  db.prepare(`UPDATE traders SET cash = MIN(seed_cash, cash + seed_cash * 0.02)`).run()
  // Relationships fade slowly toward neutral.
  db.prepare(
    `UPDATE traders SET reputation = CASE
       WHEN reputation > 0 THEN MAX(0, reputation - ?)
       WHEN reputation < 0 THEN MIN(0, reputation + ?)
       ELSE reputation END`,
  ).run(REP_DECAY_TOWARD_ZERO, REP_DECAY_TOWARD_ZERO)
  // Traders replenish their binders over time — they buy cards too, so the
  // trading post never runs dry.
  const low = db
    .prepare(`SELECT id FROM traders WHERE (SELECT COUNT(*) FROM trader_cards WHERE trader_id = traders.id) < 12`)
    .all() as { id: number }[]
  if (low.length > 0) {
    const insertCard = db.prepare(`INSERT INTO trader_cards (trader_id, card_id, variant, condition, acquired_at) VALUES (?, ?, 'normal', ?, ?)`)
    for (const t of low) {
      if (Math.random() > 0.4) continue // restock gradually, a card here and there
      const pool = db
        .prepare(
          `SELECT c.id FROM cards c
           WHERE c.rarity IN ('Common','Uncommon')
           AND (SELECT market FROM price_records pr WHERE pr.card_id = c.id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) BETWEEN 0.05 AND 8
           ORDER BY RANDOM() LIMIT 1`,
        )
        .get() as { id: string } | undefined
      if (pool) insertCard.run(t.id, pool.id, pick(['NM', 'NM', 'LP', 'MP'] as Condition[]), nowIso())
    }
  }
  maybeIncomingOffer()
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export function listTraders() {
  ensureTraders()
  const rows = db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM trader_cards tc WHERE tc.trader_id = t.id) AS card_count
       FROM traders t ORDER BY t.cash DESC`,
    )
    .all() as Record<string, unknown>[]
  return rows.map((r) => {
    const rep = (r.reputation as number) ?? 0
    const tCount = (r.trade_count as number) ?? 0
    const evNet = (r.ev_net as number) ?? 0
    const made = (r.offers_made as number) ?? 0
    const grudge = grudgeDepthOf({ ev_net: evNet, trade_count: tCount })
    const generous = generosityOf({ ev_net: evNet, trade_count: tCount }) > 0
    // A burned trader keeps their best cards out of sight when you browse, too;
    // a generous one flips the single best card of the binder to the front.
    let sample = db
      .prepare(
        `SELECT tc.id, tc.card_id, tc.condition, c.name, c.image_small, c.rarity, s.name AS set_name
         FROM trader_cards tc JOIN cards c ON c.id = tc.card_id JOIN sets s ON s.id = c.set_id
         WHERE tc.trader_id = ? ORDER BY RANDOM() LIMIT 8`,
      )
      .all(r.id) as Record<string, unknown>[]
    if (generous) {
      const best = db
        .prepare(
          `SELECT tc.id, tc.card_id, tc.condition, c.name, c.image_small, c.rarity, s.name AS set_name,
                  (SELECT market FROM price_records pr WHERE pr.card_id = tc.card_id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) AS m
           FROM trader_cards tc JOIN cards c ON c.id = tc.card_id JOIN sets s ON s.id = c.set_id
           WHERE tc.trader_id = ? ORDER BY m DESC LIMIT 1`,
        )
        .get(r.id) as Record<string, unknown> | undefined
      if (best) sample = [best, ...sample.filter((c) => c.id !== best.id)].slice(0, 8)
    }
    const valuedSample = sample
      .map((c) => ({ ...c, value: valueOf(c.card_id as string, 'normal', (c.condition as Condition) || 'NM') }))
      .sort((a, b) => (b.value as number) - (a.value as number))
    const keep = Math.max(1, Math.ceil(valuedSample.length * (1 - grudge)))
    const cards = valuedSample.slice(0, keep)
    return {
      ...r,
      traits: JSON.parse(r.traits as string),
      reputation: rep,
      stance: stanceOf(rep),
      walked_away: (r.walked_away as number) ?? 0,
      ev_net: round2(evNet),
      avg_ev: tCount > 0 ? round2(evNet / tCount) : 0,
      offer_accept_rate: made > 0 ? Math.round(((r.offers_accepted as number) ?? 0) / made * 100) : null,
      guarding: grudge > 0,
      generous,
      cards,
    }
  })
}

export function pendingOffers() {
  const rows = db
    .prepare(
      `SELECT o.*, t.name AS trader_name, t.avatar, t.handle
       FROM trade_offers o JOIN traders t ON t.id = o.trader_id
       WHERE o.status = 'pending' ORDER BY o.created_at DESC`,
    )
    .all() as Record<string, unknown>[]
  return rows.map((r) => {
    const out: Record<string, unknown> = {
      ...r,
      their_cards: JSON.parse(r.their_cards as string),
      your_items: JSON.parse(r.your_items as string),
    }
    // Pending threads carry the slider bounds so the UI can clamp live. On
    // counters the low end is the fairness floor (public knowledge — the ⚖
    // block already shows the math); on incoming offers it's the current
    // sweetener (settling below just means taking less, so the slider starts
    // there and goes up). The trader's patience ceiling stays server-side:
    // revealing it would turn haggling into "drag to max, click accept".
    if (r.direction === 'outgoing' || r.direction === 'incoming') {
      const ctx = haggleContext(r as never)
      if (ctx) out.haggle = { min: r.direction === 'outgoing' ? ctx.min : round2(ctx.current), current: round2(ctx.current), rounds: r.rounds as number, incoming: r.direction === 'incoming' }
    }
    return out
  })
}

export function tradeHistory(limit = 40) {
  return db.prepare(`SELECT * FROM activity_log WHERE kind = 'trade' ORDER BY id DESC LIMIT ?`).all(limit)
}
