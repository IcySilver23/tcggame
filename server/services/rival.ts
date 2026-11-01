import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayKey, gameDayMs } from '../lib/gameday'
import { valueOf, round2, type Condition } from './market'
import { getShop } from './shop'

// ---------------------------------------------------------------------------
// The rival shop across the street.
//
// Once your shop proves the block has foot traffic (rep 15+), an NPC opens
// across the street: a handful of display cases, staff priced by quality, and
// a till that has to eat what it buys. It runs the same walk-in math you do —
// fair asks sell, gouging doesn't — so its edge is posture:
//
//   • aggression 0..1 sets how sharp it undercuts (price wars), how fast it
//     restocks, and how hard it fights for the door;
//   • price wars: when its stock ages, it undercuts your comparable cases by
//     5–20% for a few days. Your traffic dips (poaching), your rep pressure
//     rises if you pretend nothing is happening;
//   • poaching: while it's open, a slice of your walk-ins crosses the street
//     — bigger when it's cheaper, smaller when your rep is a fortress;
//   • buyout: you can buy the whole block back. The ask is its book value —
//     cases, stock at market, staff quality — times a pride multiplier that
//     grows 25% every time you lowball it. Buy it and the rival closes for
//     good (sold = 1): the block remembers, no successor opens.
//
// It's a business, not a villain: it buys from the same distributors' lists
// (market-priced picks), pays itself a wage, and can quietly struggle.
// ---------------------------------------------------------------------------

const RIVAL_NAMES = ['Second Spin Cards', 'The Other Case', 'Cornerbox Collectibles', 'Flipside Hobbies', 'Walk-In Wonders', 'The Binder & Kettle']
const STAFF_NAMES = ['Maren', 'Cobb', 'Jules', 'Tamsin', 'Rory', 'Petra']
const RIVAL_BUYERS = ['Dev', 'Sam', 'Ana', 'Theo', 'Kit', 'Lena', 'Omar', 'Vee']

export type RivalRow = {
  id: number
  name: string
  quality: number
  reputation: number
  aggression: number
  cash: number
  price_war_until: string | null
  buyout_bump: number
  sold: number
  spawned_at: string
}

const OPEN_THRESHOLD_REP = 15 // your success draws competition

export function rivalRow(): RivalRow | null {
  const r = db.prepare(`SELECT * FROM rival_shop WHERE id = 1`).get() as RivalRow | undefined
  return r && !r.sold ? r : null
}

function inWar(r: RivalRow): boolean {
  return !!r.price_war_until && r.price_war_until >= gameDayKey() // war clocks run on 12h game-days
}

/** Spawn check — your reputation is the advertisement they answered. */
export function rivalSpawnTick() {
  if (rivalRow() || getMeta('rival:closed')) return
  const shop = getShop()
  if (!shop) return
  if (shop.reputation < OPEN_THRESHOLD_REP) return
  if (getMeta(`rival:spawncheck:${gameDayKey()}`)) return
  setMeta(`rival:spawncheck:${gameDayKey()}`, '1')
  // Roughly a coin flip per day once you're on the map — the block notices.
  if (Math.random() >= 0.5) return
  const name = pick(RIVAL_NAMES)
  const quality = 1 + Math.floor(Math.random() * 4) // 1..4 — you've never met a perfect rival
  db.prepare(`INSERT INTO rival_shop (id, name, quality, reputation, aggression, cash, spawned_at) VALUES (1, ?, ?, 20, ?, 500, ?)`)
    .run(name, quality, round2(0.35 + Math.random() * 0.5), nowIso())
  stockCases(12)
  logActivity('shop', `🏪 A new shop opened across the street: ${name}. ${quality}★ staff, sharp prices, and a look at your window display that lasted a little too long.`, 0)
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Fill empty cases from the same price lists everyone buys from. (Exported for the headless sim.) */
export function stockCases(maxAdds: number) {
  const r = rivalRow()
  if (!r) return
  const rows = db
    .prepare(`SELECT c.id, c.rarity FROM cards c JOIN sets s ON s.id = c.set_id
              WHERE c.rarity IN ('Common','Uncommon','Rare') AND c.id NOT LIKE '%-psa%' ORDER BY RANDOM() LIMIT ?`)
    .all(maxAdds) as { id: string; rarity: string }[]
  let added = 0
  for (const row of rows) {
    const anchor = valueOf(row.id)
    if (anchor <= 0 || anchor > 400) continue
    const caseNo = 1 + (added % 6)
    // Their buy price tracks the market; their margin lives in the ask.
    const basis = round2(anchor * (0.8 + Math.random() * 0.15))
    // Humbled rivals price to sell (1.02× anchor + noise) — how they claw rep
    // and cash back: fair asks move, gouging rots.
    const humbled = humbledUntilRep()
    const fairFloor = humbled != null && r.reputation < humbled ? 1.02 : 1.12
    const ask = round2(anchor * (fairFloor + r.aggression * 0.1 + Math.random() * 0.08))
    db.prepare(`INSERT INTO rival_cases (case_no, card_id, variant, condition, quantity, ask, basis, listed_at) VALUES (?, ?, 'normal', 'NM', 1, ?, ?, ?)`)
      .run(caseNo, row.id, ask, basis, nowIso())
    r.cash = round2(r.cash - basis)
    added++
    if (added >= maxAdds) break
  }
  if (r.cash < 0) db.prepare(`UPDATE rival_shop SET cash = 0 WHERE id = 1`).run()
  else db.prepare(`UPDATE rival_shop SET cash = ? WHERE id = 1`).run(r.cash)
}

/** Cheapest competing ask within 15% of this card's anchor, if the rival has one. */
function undercutAnchor(cardId: string): number | null {
  const r = rivalRow()
  if (!r) return null
  const row = db.prepare(`SELECT ask FROM rival_cases WHERE card_id = ? LIMIT 1`).get(cardId) as { ask: number } | undefined
  if (!row) return null
  const anchor = valueOf(cardId)
  if (anchor <= 0) return null
  // Only counts as pressure when they're actually cheaper than market.
  return row.ask < anchor ? row.ask : null
}

/** Traffic multiplier applied to YOUR walk-in chance: 1.0 = no rival or no edge. */
export function rivalPoachFactor(): number {
  const r = rivalRow()
  if (!r) return 1
  const shop = getShop()
  if (!shop) return 1
  // Their rep vs yours sets the baseline pull; a war widens it.
  const edge = Math.max(0, (r.reputation - shop.reputation) / 100) // 0..~0.3
  let factor = 1 - Math.min(0.18, edge * 0.6 + (inWar(r) ? 0.08 : 0))
  // A beloved fortress bleeds less: rep 75+ shrugs off most of the pull.
  if (shop.reputation >= 75) factor = Math.max(0.9, factor + 0.06)
  return round2(factor)
}

/**
 * End the war: clear the stamp and walk every cut back to its pre-war ask,
 * keyed by card — rows sold or restocked into existence mid-war just aren't
 * the same cardboard (and a reused row id can't smuggle a stranger's price
 * onto a fresh card). Returns how many rows moved.
 */
function endWarRestore(): number {
  let restored = 0
  const raw = getMeta('rival:warasks')
  if (raw) {
    try {
      for (const [cardId, ask] of JSON.parse(raw) as [string, number][]) {
        restored += db.prepare(`UPDATE rival_cases SET ask = ? WHERE card_id = ?`).run(ask, cardId).changes
      }
    } catch { /* corrupt snapshot — nothing to restore */ }
    db.prepare(`DELETE FROM meta WHERE key IN ('rival:warasks', 'rival:warstart', 'rival:warstartat')`).run()
  }
  db.prepare(`UPDATE rival_shop SET price_war_until = NULL WHERE id = 1`).run()
  return restored
}

/**
 * The comeback arc: after blinking first, the rival eats humble pie until its
 * reputation climbs back to this pre-blink level (meta key; null = proud).
 * While humbled it won't start wars and its fresh stock prices to sell.
 */
function humbledUntilRep(): number | null {
  const raw = getMeta('rival:humbled')
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** Daily rival economy: wage, restock, sales, repricing, wars. */
export function rivalTick() {
  const r = rivalRow()
  if (!r) return
  const today = new Date().toISOString().slice(0, 10)
  if (getMeta(`rival:tick:${today}`)) return
  setMeta(`rival:tick:${today}`, '1')

  // Staff wage — quality isn't free.
  const wage = round2(4 + r.quality * 3)
  r.cash = round2(r.cash - wage)

  // Walk-in sales, same engine as yours: fair asks sell, gouging rots.
  const stock = db.prepare(`SELECT id, card_id, condition, quantity, ask, basis FROM rival_cases`).all() as { id: number; card_id: string; condition: string; quantity: number; ask: number; basis: number }[]
  let soldCount = 0
  for (const s of stock) {
    const anchor = valueOf(s.card_id, s.quantity > 1 ? 'normal' : 'normal', (s.condition as Condition) || 'NM')
    if (anchor <= 0) continue
    const ratio = s.ask / anchor
    const priceFactor = Math.min(1.5, Math.max(0.02, 1.45 - ratio))
    const rep = Math.max(0.55, 1 + r.reputation / 100)
    const staffDraw = 0.9 + r.quality * 0.06
    const chance = Math.min(0.22, 0.05 * 0.8 * rep * staffDraw * priceFactor)
    if (Math.random() < chance) {
      const proceeds = round2(s.ask * s.quantity)
      r.cash = round2(r.cash + proceeds)
      db.prepare(`INSERT INTO rival_sales (card_id, quantity, price, basis, buyer, sold_at) VALUES (?, ?, ?, ?, ?, ?)`).run(s.card_id, s.quantity, proceeds, s.basis, pick(RIVAL_BUYERS), nowIso())
      db.prepare(`DELETE FROM rival_cases WHERE id = ?`).run(s.id)
      r.reputation = Math.max(5, Math.min(90, r.reputation + (ratio < 0.95 ? 1 : ratio > 1.25 ? -1 : 0)))
      soldCount++
    }
  }

  // Restock from the till — a fat rival is a fighting rival.
  const cases = (db.prepare(`SELECT COUNT(*) n FROM rival_cases`).get() as { n: number }).n
  // stockCases debits the till in the DB (spawn and restock both pay basis);
  // fold that debit into r.cash so the final write below doesn't hand the
  // rival its stock for free — without clobbering the wage and sales above,
  // which only exist in memory until then.
  const cashBeforeRestock = (db.prepare(`SELECT cash FROM rival_shop WHERE id = 1`).get() as { cash: number }).cash
  if (cases < 10 && r.cash > 60) stockCases(Math.min(6, Math.floor(r.cash / 25)))
  const cashAfterRestock = (db.prepare(`SELECT cash FROM rival_shop WHERE id = 1`).get() as { cash: number }).cash
  r.cash = round2(r.cash + (cashAfterRestock - cashBeforeRestock))

  // The comeback arc: a rival that blinked first rebuilds a reputation point
  // a day while the till can breathe (fair stock sells, word spreads), and
  // once it's back at its old pride the humility lifts — with a warning.
  // A broke, humbled rival with empty cases would deadlock otherwise (no cash
  // to restock, no stock to sell, no rep to rebuild), so the owner stakes the
  // comeback from their own pocket — a few times, then the block moves on.
  const humbledUntil = humbledUntilRep()
  if (humbledUntil != null && r.reputation >= humbledUntil) {
    db.prepare(`DELETE FROM meta WHERE key IN ('rival:humbled', 'rival:stakes')`).run()
    logActivity('shop', `😤 ${r.name} has its confidence back — the till recovered, the rep rebuilt, and your window displays are being sized up again. The peace across the street may not last.`, 0)
  } else if (humbledUntil != null && r.cash >= 60) {
    r.reputation = Math.min(90, r.reputation + 1)
  } else if (humbledUntil != null && r.cash < 20 && (db.prepare(`SELECT COUNT(*) n FROM rival_cases`).get() as { n: number }).n === 0 && Number(getMeta('rival:stakes') ?? 0) < 3) {
    setMeta('rival:stakes', String(Number(getMeta('rival:stakes') ?? 0) + 1))
    r.cash = round2(r.cash + 75)
    logActivity('shop', `🪙 ${r.name}'s owner dipped into savings to restock the empty cases — the pride is hurt, but the doors stay open.`, 0)
  }

  // Price wars: slow stock + confidence = a sale across the street.
  // Expired = the until date has passed (so inWar is false) but the stamp is
  // still set — time to stand down, walk the cuts back, and log the peace.
  // What the till held when this war opened (stamped below), so "the money is
  // gone" can mean "half the war chest is gone" rather than a fixed $25 that a
  // funded war never touches.
  const warStart = Number(getMeta('rival:warstart') ?? 0)
  const warAt = getMeta('rival:warstartat')
  const warDays = warAt ? (Date.now() - Date.parse(warAt)) / gameDayMs() : 0
  const warSales = warAt
    ? (db.prepare(`SELECT COUNT(*) AS n FROM rival_sales WHERE sold_at > ?`).get(warAt) as { n: number }).n
    : 0
  const warDone = !inWar(r) && !!r.price_war_until
  if (warDone) {
    endWarRestore()
    // Outlasted: holding your shelf — never matching, never flinching — while
    // their war chest bled out on the calendar pays in word of mouth.
    const held = db.prepare(`UPDATE shop SET reputation = MAX(0, MIN(100, reputation + 2)) WHERE id = 1`).run().changes > 0
    logActivity('shop', `The price war across the street is over — ${r.name} walked the cuts back and restocked at sane prices. Your window display is yours again.${held ? ' The block watched you hold your nerve through the whole fight — word of mouth is spreading (+2 rep).' : ''}`, 0)
  } else if (
    inWar(r) &&
    warStart > 0 &&
    warDays >= 2 &&
    r.cash <= warStart &&   // the fight has cost them money
    warSales === 0 &&       // ...and won them nothing
    Math.random() < 0.15    // a slow fold, not the routine exit
  ) {
    // They blink first: a till this DRY can't fund a fight. Wars are meant to
    // end on the calendar most days — the blink is a last-resort fold, not the
    // routine exit, so the threshold sits deep and the odds run slow.
    const restored = endWarRestore()
    // The retreat humbles them: wars stay off the table and fresh stock prices
    // to sell until the rep climbs back to its PRE-BLINK pride (the comeback
    // arc) — the bar is captured before the −2 lands.
    setMeta('rival:humbled', String(Math.min(90, r.reputation)))
    r.reputation = Math.max(5, r.reputation - 2)
    logActivity('shop', `🏳️ ${r.name} blinks first — the till ran dry, so the war cuts came off their cases${restored > 0 ? ` (${restored} price${restored === 1 ? '' : 's'} walked back up)` : ''} and word gets around that the block isn't a bargain after all (−2 rep). Your shelf never had to flinch.`, 0)
  } else if (!inWar(r) && humbledUntilRep() == null && r.aggression > 0.45 && cases >= 6 && Math.random() < r.aggression * 0.35) {
    const until = gameDayKey(Date.now() + (2 + Math.floor(Math.random() * 3)) * gameDayMs())
    // Undercut every one of YOUR cased cards they can compete with, 5–20%.
    const mine = db.prepare(`SELECT i.id, i.card_id, i.listing_price FROM shop_case_cards scc JOIN inventory i ON i.id = scc.inventory_id WHERE i.listing_price IS NOT NULL`).all() as { id: number; card_id: string; listing_price: number }[]
    let cuts = 0
    const snapshot: [string, number][] = []
    for (const m of mine) {
      const their = db.prepare(`SELECT id, ask FROM rival_cases WHERE card_id = ? LIMIT 1`).get(m.card_id) as { id: number; ask: number } | undefined
      if (!their) continue
      const newAsk = round2(m.listing_price * (0.8 + Math.random() * 0.15))
      if (newAsk < their.ask) {
        // Pre-war ask keyed by CARD, not row id: rows come and go mid-war
        // (sales, restocks, rowid reuse) — the card is what the war repriced.
        if (!snapshot.some((s) => s[0] === m.card_id)) snapshot.push([m.card_id, their.ask])
        db.prepare(`UPDATE rival_cases SET ask = ? WHERE id = ?`).run(newAsk, their.id)
        cuts++
      }
    }
    if (cuts > 0) {
      db.prepare(`UPDATE rival_shop SET price_war_until = ? WHERE id = 1`).run(until)
      setMeta('rival:warasks', JSON.stringify(snapshot))
      // The owner commits a war chest up front — fights start funded, so most
      // run to their planned end instead of collapsing into an early fold.
      r.cash = round2(r.cash + 60)
      // Stamp the war chest so the blink branch can tell a funded fight from a
      // losing one. Cleared by endWarRestore() like the price snapshot.
      setMeta('rival:warstart', String(r.cash))
      setMeta('rival:warstartat', nowIso())
      logActivity('shop', `⚔️ Price war: ${r.name} is undercutting your cases on ${cuts} card${cuts === 1 ? '' : 's'} by 5–20% through ${until}. Hold your price and lose browse time, match them and lose margin, or wait them out — the owner just dropped a war chest in the register, and their till isn't bottomless.`, 0)
    }
  }

  // Struggle: a broke, unloved rival quietly thins out (the block moves on).
  if (r.cash < 20 && r.reputation < 15 && Math.random() < 0.3) {
    db.prepare(`DELETE FROM rival_cases WHERE id IN (SELECT id FROM rival_cases LIMIT 2)`).run()
    r.reputation = Math.max(5, r.reputation)
  }

  // The till can't owe money: wages stop mattering when the wallet is empty.
  db.prepare(`UPDATE rival_shop SET cash = ?, reputation = ? WHERE id = 1`).run(Math.max(0, r.cash), r.reputation)
  void soldCount
}

// ---------------------------------------------------------------------------
// Buyout — the block, purchased
// ---------------------------------------------------------------------------

export function buyoutPrice(): number {
  const r = rivalRow()
  if (!r) return 0
  const stockValue = (db.prepare(`SELECT COALESCE(SUM(ask * quantity),0) v FROM rival_cases`).get() as { v: number }).v
  const fixtures = 120 + r.quality * 80 // cases, counters, the neon sign
  const book = round2(fixtures + stockValue + Math.max(0, r.cash))
  // Pride multiplier: grows every time you make them an offer they refuse.
  return round2(book * r.buyout_bump)
}

export function offerBuyout(amount: number) {
  const r = rivalRow()
  if (!r) return { ok: false as const, error: getMeta('rival:closed') ? 'The block already has your name on it — no successor ever opened' : 'No rival across the street' }
  const ask = buyoutPrice()
  if (amount < ask * 0.999) {
    // Refused. Pride grows; the lowball is remembered.
    const bump = round2(Math.min(3, r.buyout_bump * 1.25))
    db.prepare(`UPDATE rival_shop SET buyout_bump = ? WHERE id = 1`).run(bump)
    logActivity('shop', `${r.name}'s owner laughs at your ${fmt(amount)} offer — "the block is worth every cent of ${fmt(ask)}." The price just went up.`, 0)
    return { ok: false as const, refused: true as const, ask, bump: bump }
  }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < amount) return { ok: false as const, error: `You need ${fmt(amount)} in cash — you have ${fmt(state.cash)}` }
  const stockValue = (db.prepare(`SELECT COALESCE(SUM(ask * quantity),0) v FROM rival_cases`).get() as { v: number }).v
  const tx = db.transaction(() => {
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(amount)
    db.prepare(`UPDATE rival_shop SET sold = 1, buyout_bump = 1 WHERE id = 1`).run()
    db.prepare(`DELETE FROM rival_cases`).run()
    db.prepare(`DELETE FROM meta WHERE key IN ('rival:closed', 'rival:humbled', 'rival:warasks', 'rival:stakes', 'rival:warstart', 'rival:warstartat')`).run()
    db.prepare(`INSERT INTO meta (key, value) VALUES ('rival:closed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(nowIso())
    pnlBook(amount, stockValue)
  })
  tx()
  logActivity('shop', `🔑 Deal. ${r.name} is yours — ${fmt(amount)}, keys, fixtures, and the good scissors from behind the counter. The rival sign comes down tomorrow; the block is finally all yours.`, -amount)
  return { ok: true as const, paid: amount, stockValue: round2(stockValue) }
}

/**
 * Match their war cuts card-for-card: reprice every contested case to the
 * rival's ask — the margin goes, the walk-ins stay — and the war ends at
 * parity. The feed promised "match them and lose margin"; this is that button.
 */
export function matchPrices() {
  const r = rivalRow()
  if (!r) return { ok: false as const, error: 'No rival across the street' }
  if (!inWar(r)) return { ok: false as const, error: 'Nobody is undercutting you — your prices stand' }
  const mine = db
    .prepare(`SELECT i.id, i.card_id, i.listing_price FROM shop_case_cards scc JOIN inventory i ON i.id = scc.inventory_id WHERE i.listing_price IS NOT NULL`)
    .all() as { id: number; card_id: string; listing_price: number }[]
  let matched = 0
  let surrendered = 0
  const tx = db.transaction(() => {
    for (const m of mine) {
      const their = db.prepare(`SELECT id, ask FROM rival_cases WHERE card_id = ? LIMIT 1`).get(m.card_id) as { id: number; ask: number } | undefined
      if (!their || their.ask >= m.listing_price) continue // never raise your own price to "match"
      surrendered = round2(surrendered + (m.listing_price - their.ask))
      db.prepare(`UPDATE inventory SET listing_price = ?, listed_at = ? WHERE id = ?`).run(their.ask, nowIso(), m.id)
      matched++
    }
    // Parity is peace — the war ends the moment you match (no cuts left to walk back).
    db.prepare(`UPDATE rival_shop SET price_war_until = NULL WHERE id = 1`).run()
    db.prepare(`DELETE FROM meta WHERE key IN ('rival:warasks', 'rival:warstart', 'rival:warstartat')`).run()
  })
  tx()
  if (matched > 0) {
    logActivity('shop', `⚔️ You met ${r.name} in the mud: ${matched} case${matched === 1 ? '' : 's'} repriced to their number, ${fmt(surrendered)} of margin on the table. The war ends at parity — your walk-ins are yours again.`, 0)
  } else {
    logActivity('shop', `The price war across the street fizzles — ${r.name} isn't undercutting anything on your shelves anymore.`, 0)
  }
  return { ok: true as const, matched, surrendered: round2(surrendered) }
}

function pnlBook(paid: number, stockValue: number) {
  // Book it honestly: the fixtures/goodwill premium is overhead; inventory at
  // market walks into the ledger as an asset write-up (no instant profit).
  import('./pnl').then((p) => p.append('overhead', -round2(Math.max(0, paid - stockValue)), 'Rival shop buyout — fixtures & goodwill')).catch(() => {})
}

export function status() {
  const r = rivalRow()
  if (!r) {
    const closed = !!getMeta('rival:closed')
    return { exists: false as const, closed, poach: 1, war: null, buyoutPrice: 0, bump: 1 }
  }
  const stock = db
    .prepare(`SELECT rc.case_no, rc.card_id, rc.quantity, rc.ask, rc.basis, c.name, c.image_small, c.rarity, s.name AS set_name
              FROM rival_cases rc JOIN cards c ON c.id = rc.card_id JOIN sets s ON s.id = c.set_id
              ORDER BY rc.case_no, rc.id LIMIT 24`)
    .all() as { case_no: number; card_id: string; condition: string; quantity: number; ask: number; basis: number; name: string; image_small: string | null; rarity: string | null; set_name: string }[]
  const recent = db
    .prepare(`SELECT rs.*, c.name FROM rival_sales rs JOIN cards c ON c.id = rs.card_id ORDER BY rs.id DESC LIMIT 6`)
    .all() as { id: number; name: string; quantity: number; price: number; buyer: string; sold_at: string }[]
  const war = inWar(r)
  return {
    exists: true as const,
    closed: false,
    name: r.name,
    quality: r.quality,
    reputation: r.reputation,
    aggression: round2(r.aggression),
    cashHint: r.cash > 400 ? 'healthy' : r.cash > 120 ? 'getting by' : 'hurting',
    stock: stock.map((s) => {
      const anchor = valueOf(s.card_id, 'normal', (s.condition as Condition) || 'NM')
      // "Undercuts you" = they're under market AND under my live ask (a card I
      // don't carry counts — it's the war they could start). At parity the
      // badge clears: matched prices are not an undercut.
      const myAsk = (db.prepare(`SELECT MIN(i.listing_price) p FROM shop_case_cards scc JOIN inventory i ON i.id = scc.inventory_id WHERE i.card_id = ? AND i.listing_price IS NOT NULL`).get(s.card_id) as { p: number | null }).p
      return { ...s, anchor, delta: anchor > 0 ? s.ask / anchor - 1 : null, undercutsYou: undercutAnchor(s.card_id) != null && (myAsk == null || s.ask < myAsk) }
    }),
    recent,
    poach: rivalPoachFactor(),
    war: war ? { until: r.price_war_until } : null,
    humbled: humbledUntilRep() != null,
    buyoutPrice: buyoutPrice(),
    bump: round2(r.buyout_bump),
  }
}

function fmt(n: number): string {
  return `$${round2(n).toFixed(2)}`
}
