import { db, nowIso, logActivity } from '../lib/db'
import { valueOf, CONDITION_MULT, round2, type Condition } from './market'
import * as market from './market'

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

/** Reputation multiplier on the trader's perceived value: 0.9 at -10, 1.1 at +10. */
function repValueMult(rep: number): number {
  return 1 + rep * 0.01
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
): number {
  const real = valueOf(cardId, 'normal', condition)
  if (real <= 0) return 0
  const card = db.prepare('SELECT rarity, supertype, set_id FROM cards WHERE id = ?').get(cardId) as { rarity: string | null; supertype: string | null; set_id: string } | undefined
  const demand = card ? arch.wants({ rarity: card.rarity, supertype: card.supertype, setYear: Number((db.prepare('SELECT release_date FROM sets WHERE id = ?').get(card.set_id) as { release_date: string }).release_date.slice(0, 4)) }) : 1
  // Their offer: pay less than their own perceived value (that's the margin).
  const perception = real * (0.85 + Math.random() * 0.3) * Math.min(2.5, Math.max(0.4, demand))
  const offerFrac = 0.7 + (1 - traits.scrutiny) * 0.15 + traits.cashFlex * 0.1
  return Math.max(0.05, round2(perception * offerFrac * repMult))
}

// ---------------------------------------------------------------------------
// Offer assembly
// ---------------------------------------------------------------------------

type TheirCard = { traderCardId: number; cardId: string; name: string; image: string | null; variant: string; condition: string; value: number }

/** Cards the trader would put on the table for something worth `targetValue`. */
function fittingLineup(traderId: number, arch: Archetype, traits: { scrutiny: number; cashFlex: number; heat: number }, targetValue: number, repMult = 1): TheirCard[] {
  const rows = db
    .prepare(
      `SELECT tc.id, tc.card_id, tc.condition, c.name, c.image_small
       FROM trader_cards tc JOIN cards c ON c.id = tc.card_id
       WHERE tc.trader_id = ?`,
    )
    .all(traderId) as { id: number; card_id: string; condition: string; name: string; image_small: string | null }[]
  const fitting = rows
    .map((r) => ({ traderCardId: r.id, cardId: r.card_id, name: r.name, image: r.image_small, variant: 'normal', condition: r.condition, value: perceivedValue(traits, arch, r.card_id, (r.condition as Condition) || 'NM', repMult) }))
    .filter((c) => c.value > 0 && c.value <= targetValue * (targetValue < 1 ? 3 : 1.3))
    .sort((a, b) => b.value - a.value)
  // Bulk-tier targets (< $0.50): any single cheap card will do — bulk for bulk.
  if (fitting.length === 0 && targetValue < 0.5) {
    const cheapest = rows
      .map((r) => ({ traderCardId: r.id, cardId: r.card_id, name: r.name, image: r.image_small, variant: 'normal', condition: r.condition, value: perceivedValue(traits, arch, r.card_id, (r.condition as Condition) || 'NM', repMult) }))
      .filter((c) => c.value > 0)
      .sort((a, b) => a.value - b.value)[0]
    return cheapest ? [cheapest] : []
  }
  if (fitting.length === 0) return []
  return fitting.slice(0, Math.random() < 0.25 && fitting.length >= 2 ? 2 : 1)
}

/** Propose a trade: you give one collection card (+ optional cash top-up), they give cards/cash. */
export function proposeTrade(
  traderId: number,
  inventoryId: number,
  yourCashOffer: number,
): { ok: boolean; reply: string; accepted?: boolean; offer?: Record<string, unknown>; error?: string } {
  ensureTraders()
  const trader = db.prepare('SELECT * FROM traders WHERE id = ?').get(traderId) as
    | { id: number; name: string; handle: string; archetype: string; cash: number; seed_cash: number; traits: string; reputation?: number; walked_away?: number }
    | undefined
  if (!trader) return { ok: false, reply: '', error: 'Trader not found' }
  const arch = ARCHETYPES.find((a) => a.id === trader.archetype) ?? ARCHETYPES[0]
  const traits = JSON.parse(trader.traits) as { patience: number; scrutiny: number; cashFlex: number; heat: number }

  const mine = db
    .prepare(`SELECT i.*, c.name, c.image_small FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ? AND i.status = 'collection'`)
    .get(inventoryId) as { id: number; card_id: string; condition: string; variant: string; quantity: number; graded_grade: string | null; name: string; image_small: string | null } | undefined
  if (!mine) return { ok: false, reply: '', error: 'That card is not available to trade' }
  if (mine.quantity > 1) return { ok: false, reply: '', error: 'Trade one copy at a time' }
  if (mine.graded_grade) return { ok: false, reply: '', error: 'Graded slabs do not trade — sell them instead' }

  const realValue = valueOf(mine.card_id, mine.variant || 'normal', (mine.condition as Condition) || 'NM')
  if (realValue <= 0) return { ok: false, reply: '', error: 'No market data for that card yet' }

  // Reputation colors everything: trusted collectors value your cards higher,
  // hostile ones lowball and refuse more often.
  const rep = (trader as { reputation?: number }).reputation ?? 0
  const streak = (trader as { walked_away?: number }).walked_away ?? 0
  const repMult = repValueMult(rep)
  const theirCards = fittingLineup(traderId, arch, traits, realValue, repMult)
  if (theirCards.length === 0) return { ok: false, reply: '', error: `${trader.name} has nothing comparable on offer right now` }

  // Their acceptance math on YOUR side: perceived value of what they receive.
  const yourPerceived = perceivedValue(traits, arch, mine.card_id, (mine.condition as Condition) || 'NM', repMult)
  const theirSide = theirCards.reduce((a, c) => a + c.value, 0)
  const balance = yourPerceived + yourCashOffer - theirSide

  if (balance >= -realValue * tolerance(rep)) {
    // Good enough — but patient traders still push once in a while.
    if (traits.patience > 0.45 && Math.random() < 0.3) {
      return counterFrom(trader, theirCards, mine, yourCashOffer)
    }
    return executeTrade(trader, theirCards, inventoryId, yourCashOffer)
  }
  if (balance < -realValue * (0.9 + streak * 0.25)) {
    // Insulting lowball — hard no. A walk-away streak hardens the door.
    logActivity('trade', `${trader.name} turned you down flat on ${mine.name}.`)
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
  const ask = round2(gap * (0.6 + Math.random() * 0.4) * repCounterMult(rep))
  saveThread({
    traderId: trader.id,
    direction: 'outgoing',
    theirCards,
    theirCash: ask, // cash the TRADER wants FROM you to close the gap
    yourItems: [{ inventoryId: mine.id, cardId: mine.card_id, name: mine.name, image: mine.image_small, condition: mine.condition, value: valueOf(mine.card_id, mine.variant || 'normal', (mine.condition as Condition) || 'NM') }],
    yourCash: yourCashOffer,
    message: counterMsg(trader.name, ask),
    rounds: 1,
  })
  logActivity('trade', `${trader.name} wants $${ask.toFixed(2)} on top for the swap.`)
  return { ok: true, reply: counterMsg(trader.name, ask), accepted: false }
}

function counterMsg(name: string, ask: number) {
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
  return executeTrade(trader, theirCards, yourItems[0].inventoryId, netCash)
}

export function declineCounter(tradeId: number) {
  db.prepare(`UPDATE trade_offers SET status = 'rejected' WHERE id = ? AND status = 'pending'`).run(tradeId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Execution — the atomic swap
// ---------------------------------------------------------------------------

function executeTrade(
  trader: { id: number; name: string; cash: number; reputation?: number; walked_away?: number },
  theirCards: TheirCard[],
  inventoryId: number,
  cashToMe: number,
) {
  const mine = db
    .prepare(`SELECT i.*, c.name FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ? AND i.status = 'collection'`)
    .get(inventoryId) as { id: number; card_id: string; name: string; condition: string } | undefined
  if (!mine) return { ok: false, reply: '', error: 'Your card changed status — trade aborted' }
  if (cashToMe > 0 && trader.cash < cashToMe) return { ok: false, reply: '', error: 'Trader is out of cash' }

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
    | { id: number; name: string; archetype: string; cash: number; seed_cash: number; traits: string; reputation?: number; walked_away?: number }
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
  const theirCards = fittingLineup(trader.id, arch, traits, realValue, repValueMult(rep))
  if (theirCards.length === 0) return
  const theirSide = theirCards.reduce((a, c) => a + c.value, 0)
  // Cash sweetener out of their wallet, kept under seed budget pressure.
  let cash = 0
  if (theirSide < realValue * 0.95 && trader.cash > 20) {
    cash = Math.min(trader.cash * 0.25, round2((realValue - theirSide) * (0.5 + Math.random() * 0.5)))
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
  return executeTrade(trader, theirCards, yourItems[0].inventoryId, t.their_cash)
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
    const cards = db
      .prepare(
        `SELECT tc.id, tc.card_id, tc.condition, c.name, c.image_small, c.rarity, s.name AS set_name
         FROM trader_cards tc JOIN cards c ON c.id = tc.card_id JOIN sets s ON s.id = c.set_id
         WHERE tc.trader_id = ? ORDER BY RANDOM() LIMIT 8`,
      )
      .all(r.id) as Record<string, unknown>[]
    const rep = (r.reputation as number) ?? 0
    return {
      ...r,
      traits: JSON.parse(r.traits as string),
      reputation: rep,
      stance: stanceOf(rep),
      walked_away: (r.walked_away as number) ?? 0,
      cards: cards.map((c) => ({ ...c, value: valueOf(c.card_id as string, 'normal', (c.condition as Condition) || 'NM') })),
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
  return rows.map((r) => ({
    ...r,
    their_cards: JSON.parse(r.their_cards as string),
    your_items: JSON.parse(r.your_items as string),
  }))
}

export function tradeHistory(limit = 40) {
  return db.prepare(`SELECT * FROM activity_log WHERE kind = 'trade' ORDER BY id DESC LIMIT ?`).all(limit)
}
