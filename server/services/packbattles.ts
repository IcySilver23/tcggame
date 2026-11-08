import { db, nowIso, logActivity } from '../lib/db'
import { valueOf, round2 } from './market'
import { rollPack } from './packs'
import { priceOf as sealedPriceOf, sellsOwnPacks } from './sealed'

// ---------------------------------------------------------------------------
// Pack Battles — head-to-head pack openings against NPC rivals.
// Both sides stake the product's real price, rip the same sealed product with
// the real pull tables, keep their pulls, and the higher total pull value
// takes the pot. Ties break on best single card.
// ---------------------------------------------------------------------------

export type RivalDef = {
  id: string
  name: string
  avatar: string
  style: string
  blurb: string
  /** Preferred product kinds — flavor only, they'll fight over anything. */
  likes: string[]
  /** Risk appetite: how eagerly they accept big-stake battles. */
  nerve: number // 0..1
}

export const RIVALS: RivalDef[] = [
  { id: 'holon', name: 'Holon Hank', avatar: '🧢', style: 'Chase-card chaser', blurb: 'Rips displays on stream. Believes the hit is coming on the next pack. Always.', likes: ['booster', 'bundle'], nerve: 0.9 },
  { id: 'vintage', name: 'Vera Vintage', avatar: '📜', style: 'Old-school purist', blurb: 'Prefers WotC cardboard but will duel over modern to prove a point.', likes: ['etb', 'booster'], nerve: 0.55 },
  { id: 'math', name: 'EV Evan', avatar: '🧮', style: 'Expected-value shark', blurb: 'Knows every pull rate by heart. Refuses bets with negative EV — which is why he rarely loses.', likes: ['bundle', 'etb'], nerve: 0.4 },
  { id: 'kid', name: 'Pack-Fresh Pri', avatar: '🍬', style: 'Sugar-fueled rookie', blurb: 'Battles anyone, any product, any stakes. Her binder is chaotic and she regrets nothing.', likes: ['booster'], nerve: 1 },
  { id: 'whale', name: 'Display Dai', avatar: '🐋', style: 'High-roller', blurb: 'Only shows up when the pot is big. Wins big, loses bigger, shrugs either way.', likes: ['display', 'special'], nerve: 0.95 },
  { id: 'grader', name: 'Slab Simon', avatar: '💎', style: 'PSA 10 or bust', blurb: 'Battles for extra funding. "Every dollar is one closer to the next submission." Prefers anything premium.', likes: ['bundle', 'etb', 'special'], nerve: 0.7 },
  { id: 'flipper', name: 'Flip Friday', avatar: '📈', style: 'Reseller on the rise', blurb: 'Not here for the cardboard, here for the content — and the flips. Will battle anything once.', likes: ['booster', 'bundle', 'display'], nerve: 0.85 },
]

export function listRivals() {
  const record = battleRecord()
  const byRival = new Map(record.byRival.map((r) => [r.opponent_id, r]))
  return RIVALS.map((r) => {
    const rec = byRival.get(r.id)
    const mem = memoryOf(r.id)
    const pendingProduct = mem.pending_product ? productName(mem.pending_product) : null
    const salty = mem.saltiest && mem.grudge >= GRUDGE_TRIGGER ? mem.saltiest : null
    return {
      ...r,
      wins: rec?.wins ?? 0,
      losses: rec?.losses ?? 0,
      grudge: round2(mem.grudge),
      grudgeMatch: mem.grudge >= GRUDGE_TRIGGER,
      pendingProduct,
      salty,
    }
  })
}

/** Duck a pending rematch: settles nothing, feeds the grudge. */
export function duckRematch(opponentId: string) {
  const opp = rival(opponentId)
  if (!opp) return { ok: false as const, error: 'No such collector' }
  const m = memoryOf(opponentId)
  if (!m.pending_product) return { ok: false as const, error: 'No rematch pending' }
  const grudge = Math.min(10, m.grudge + 1.5)
  db.prepare('UPDATE rival_memory SET grudge = ?, updated_at = ? WHERE opponent_id = ?').run(grudge, nowIso(), opponentId)
  logActivity('battle', `You ducked the rematch with ${opp.name}. Word travels.`)
  return { ok: true as const, grudge: round2(grudge), message: `${opp.name} watched you walk away. That's +1.5 grudge.` }
}

function rival(id: string) {
  return RIVALS.find((r) => r.id === id)
}

// ---------------------------------------------------------------------------
// Rivalry memory — grudge level, pending rematches, what they're salty about
// ---------------------------------------------------------------------------

const GRUDGE_TRIGGER = 3

// Lazy migration: battles saved before grudge matches existed.
try {
  db.prepare('SELECT grudge_flag FROM pack_battles LIMIT 1').get()
} catch {
  db.prepare('ALTER TABLE pack_battles ADD COLUMN grudge_flag INTEGER NOT NULL DEFAULT 0').run()
}

type RivalMemory = {
  opponent_id: string
  grudge: number
  battles: number
  pending_product: string | null
  saltiest: string | null
}

function memoryOf(id: string): RivalMemory {
  let m = db.prepare('SELECT * FROM rival_memory WHERE opponent_id = ?').get(id) as RivalMemory | undefined
  if (!m) {
    db.prepare('INSERT INTO rival_memory (opponent_id, grudge, battles, pending_product, saltiest, updated_at) VALUES (?, 0, 0, NULL, NULL, ?)').run(id, nowIso())
    m = db.prepare('SELECT * FROM rival_memory WHERE opponent_id = ?').get(id) as RivalMemory
  }
  return m
}

/** The card that broke them — stored for the salt line. */
function saltiestPull(cards: { cardId: string; value: number; isHit: boolean }[], theirTotal: number, myTotal: number): string | null {
  const best = [...cards].sort((a, b) => b.value - a.value)[0]
  if (!best || myTotal <= theirTotal) return null
  const name = cardName(best.cardId)
  return best.value >= 30 ? `${name} ($${best.value.toFixed(0)})` : null
}

function updateMemoryAfterBattle(opp: RivalDef, r: { playerWon: boolean; margin: number; stake: number; grudgeMatch: boolean; myTotal: number; theirTotal: number; saltiest: string | null }) {
  const m = memoryOf(opp.id)
  let grudge = m.grudge
  let pending = m.pending_product
  let salt = m.saltiest
  if (!r.playerWon) {
    // Their revenge: the score is settled — grudge drops hard, salt avenged.
    grudge = Math.max(0, grudge - 8)
    pending = null
    salt = null
  } else {
    // Their loss: grudge grows with the margin, doubled for grudge matches.
    grudge = Math.min(10, grudge + 1.5 + Math.min(3, r.margin / Math.max(1, r.stake)) * 2 + (r.grudgeMatch ? 1.5 : 0))
    // A big-enough loss makes them demand a rematch over the same product.
    if (r.margin > r.stake * 3 && !pending) pending = lastProductId(opp.id)
    if (r.saltiest) salt = r.saltiest
  }
  db.prepare('UPDATE rival_memory SET grudge = ?, battles = battles + 1, pending_product = ?, saltiest = ?, updated_at = ? WHERE opponent_id = ?')
    .run(grudge, pending, salt, nowIso(), opp.id)
  return grudge
}

function lastProductId(opponentId: string): string | null {
  const row = db.prepare('SELECT product_id FROM pack_battles WHERE opponent_id = ? ORDER BY id DESC LIMIT 1').get(opponentId) as { product_id: string } | undefined
  return row?.product_id ?? null
}

/**
 * A battle rips the WHOLE box, per side — a bundle battle opens all 6 packs,
 * an ETB all 9, a display all 36 (the catalog's pack count is the truth; the
 * picker prints it). The stake is the whole product price because that's the
 * cardboard that hits the table.
 *
 * The old scheme staked a "ripped share" (2 of 6 bundle packs, 3 of 36 display
 * packs) — the per-pack honesty was right, but the battle only ever opened a
 * fraction of the box, so the product's own pack count and the rip disagreed.
 */
export function packsInBox(kind: string, packs?: number | null): number {
  if (packs && packs > 0) return Math.floor(packs)
  if (kind === 'bundle') return 6
  if (kind === 'etb') return 9
  if (kind === 'display') return 36
  if (kind === 'special') return 15
  return 1
}

/** Products eligible for battle: booster tables built, modest price band. */
export function listBattlableProducts() {
  const rows = db
    .prepare(
      `SELECT p.id, p.set_id, p.name, p.kind, p.packs, p.msrp, p.market_price, p.image_url, s.symbol_url, s.release_date,
              (SELECT COUNT(*) FROM pack_product_cards ppc WHERE ppc.pack_product_id = p.set_id || '-booster') AS pool
       FROM pack_products p JOIN sets s ON s.id = p.set_id
       ORDER BY p.msrp ASC`,
    )
    .all() as { id: string; set_id: string; name: string; kind: string; packs: number | null; msrp: number; market_price: number | null; image_url: string | null; symbol_url: string | null; release_date: string | null; pool: number }[]
  // Price at market (OOP appreciation included), not the stale stored column.
  for (const r of rows) r.market_price = sealedPriceOf(r.id).market || r.msrp
  // The stake the UI (and startBattle) charges: the whole box — the battle
  // opens every pack in it, so you pay for exactly that cardboard.
  //
  // Lead with the affordable modern product: sort the final list by the actual
  // stake, cheapest first — and within a price tier, the NEWEST set first — so
  // in-print modern boxes lead every picker and five-figure out-of-print boxes
  // sink to the bottom. The old ORDER BY msrp put out-of-print boxes first
  // within every price tier, and any consumer rendering this list raw (the
  // stream/break product selects) inherited that order.
  return rows
    .filter((r) => r.pool > 0 && sellsOwnPacks(r.set_id))
    .map((r) => ({ ...r, packs: packsInBox(r.kind, r.packs), stake: round2(r.market_price ?? r.msrp) }))
    .sort(
      (a, b) =>
        a.stake - b.stake ||
        (b.release_date ?? '').localeCompare(a.release_date ?? '') ||
        a.name.localeCompare(b.name),
    )
}

export function battleRecord() {
  const rows = db
    .prepare(`SELECT * FROM pack_battles ORDER BY created_at DESC LIMIT 100`)
    .all() as BattleRow[]
  const byRival = new Map<string, { opponent_id: string; wins: number; losses: number }>()
  let wins = 0
  let losses = 0
  let net = 0
  const history: BattleOut[] = rows.slice(0, 15).map((r) => {
    const pot = round2(r.stake * 2)
    const myMargin = r.winner === 'player' ? pot - r.stake : -r.stake
    if (r.winner === 'player') wins++
    else losses++
    net += myMargin
    const opp = rival(r.opponent_id)
    const rid = r.opponent_id
    const cur = byRival.get(rid) ?? { opponent_id: rid, wins: 0, losses: 0 }
    if (r.winner === 'player') cur.wins++
    else cur.losses++
    byRival.set(rid, cur)
    return {
      id: r.id,
      opponent: opp ? `${opp.avatar} ${opp.name}` : rid,
      productName: productName(r.product_id),
      stake: r.stake,
      playerTotal: r.player_total,
      opponentTotal: r.opponent_total,
      winner: r.winner,
      tiebreak: Boolean(r.tiebreak),
      net: myMargin,
      bestPull: bestOf(JSON.parse(r.player_cards)),
      at: r.created_at,
    }
  })
  return {
    wins,
    losses,
    net: round2(net),
    byRival: [...byRival.values()],
    history,
  }
}

function productName(pid: string): string {
  const row = db.prepare('SELECT name FROM pack_products WHERE id = ?').get(pid) as { name: string } | undefined
  return row?.name ?? pid
}

function bestOf(cards: { cardId: string; value: number }[]) {
  const best = [...cards].sort((a, b) => b.value - a.value)[0]
  if (!best) return null
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(best.cardId) as { name: string } | undefined)?.name
  return { name: name ?? best.cardId, value: round2(best.value) }
}

// ---------------------------------------------------------------------------
// The battle itself
// ---------------------------------------------------------------------------

export function startBattle(productId: string, opponentId: string) {
  const opp = rival(opponentId)
  if (!opp) return { ok: false as const, error: 'No such collector around' }

  const mem = memoryOf(opponentId)
  const product = db
    .prepare(`SELECT p.*, s.name AS set_name FROM pack_products p JOIN sets s ON s.id = p.set_id WHERE p.id = ?`)
    .get(productId) as { id: string; set_id: string; name: string; kind: string; packs: number | null; msrp: number; market_price: number | null; set_name: string } | undefined
  if (product) product.market_price = sealedPriceOf(productId).market || product.msrp
  if (!product) return { ok: false as const, error: 'Unknown product' }
  if (!sellsOwnPacks(product.set_id)) return { ok: false as const, error: 'That product is not sold' }

  const pool = (db.prepare(`SELECT COUNT(*) AS n FROM pack_product_cards WHERE pack_product_id = ?`).get(`${product.set_id}-booster`) as { n: number }).n
  if (pool === 0) return { ok: false as const, error: 'Pull table missing for this set — sync it first' }

  // Stake = the whole box, because the battle opens the whole box (per side).
  let stake = round2(product.market_price ?? product.msrp)
  const grudgeMatch = mem.grudge >= GRUDGE_TRIGGER || Boolean(mem.pending_product && mem.pending_product === productId && mem.grudge >= GRUDGE_TRIGGER - 1)
  if (grudgeMatch) stake = round2(stake * 2)

  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < stake) return { ok: false as const, error: grudgeMatch ? `Grudge match costs double — you need $${stake.toFixed(2)}` : `You need $${stake.toFixed(2)} to sit down` }

  // A pending rematch can only be fought over the demanded product.
  if (mem.pending_product && mem.pending_product !== productId) {
    const demanded = productName(mem.pending_product)
    return { ok: false as const, declined: true as const, error: `${opp.name} only wants the rematch over ${demanded} — settle that first` }
  }

  // Rival appetite: nerve gates how big a stake they'll take, with some noise.
  // Grudge matches skip the roll — pride is on the line, they're showing up.
  if (!grudgeMatch) {
    const appetite = stake <= 10 ? 1 : stake <= 40 ? opp.nerve + 0.15 : stake <= 120 ? opp.nerve - 0.05 : opp.nerve - 0.2
    if (appetite < 0.25 * Math.random() + 0.15) {
      return { ok: false as const, declined: true as const, error: `${opp.name} waves you off — "${stake > 40 ? 'Too rich for me, friend.' : 'Not feeling it today.'}"` }
    }
  }

  // Packs per side = the product's real pack count: 1 / 6 / 9 / 36.
  const packsPerSide = packsInBox(product.kind, product.packs)

  const rip = (who: 'player' | 'opponent') => {
    const cards: { cardId: string; value: number; isHit: boolean }[] = []
    const packTotals: number[] = []
    for (let i = 0; i < packsPerSide; i++) {
      // Session id per side so pull_history stays attributable; the opponent
      // side is an NPC rip and must never surface in the player's records.
      const res = rollPack(
        product.set_id,
        `battle_${who}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        'booster',
        10,
        who === 'player' ? 'player' : 'other',
      )
      if (res) {
        cards.push(...res.map((c) => ({ cardId: c.cardId, value: c.value, isHit: c.isHit })))
        packTotals.push(round2(res.reduce((a, c) => a + c.value, 0)))
      }
    }
    return { cards, packTotals }
  }

  const mineRip = rip('player')
  const mine = mineRip.cards
  const theirs = rip('opponent').cards
  if (mine.length === 0 || theirs.length === 0) return { ok: false as const, error: 'Pull table came up empty — try another product' }

  const myTotal = round2(mine.reduce((a, c) => a + c.value, 0))
  const theirTotal = round2(theirs.reduce((a, c) => a + c.value, 0))
  // Best SINGLE-pack total (bundles/ETBs roll several sessions) — the chase
  // number for the pack-total record, kept honest for multi-pack products.
  const myBestPack = round2(Math.max(0, ...mineRip.packTotals))

  // Give the pulls to the player (they keep what they rip — win or lose).
  const perCard = round2(stake / Math.max(1, mine.length))
  const addInv = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, acquired_ref, cost_basis, acquired_at)
     VALUES (?, ?, 'NM', 1, 'collection', 'pack_battle', ?, ?, ?)`,
  )
  const pot = round2(stake * 2)
  const iWin = myTotal > theirTotal || (myTotal === theirTotal && bestCardValue(mine) > bestCardValue(theirs))
  const tiebreak = myTotal === theirTotal && bestCardValue(mine) > bestCardValue(theirs) ? 1 : 0
  const margin = Math.abs(myTotal - theirTotal)
  const saltiest = iWin ? saltiestPull(mine, theirTotal, myTotal) : null

  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(stake)
    for (const c of mine) addInv.run(c.cardId, (c as { variant?: string }).variant || 'normal', product.id, perCard, nowIso())
    if (iWin) db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(pot)
    const info = db
      .prepare(
        `INSERT INTO pack_battles (product_id, opponent_id, stake, player_total, opponent_total, player_cards, opponent_cards, winner, tiebreak, grudge_flag, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(product.id, opponentId, stake, myTotal, theirTotal, JSON.stringify(mine), JSON.stringify(theirs), iWin ? 'player' : 'opponent', tiebreak, grudgeMatch ? 1 : 0, nowIso())
    logActivity(
      'battle',
      iWin
        ? `Won ${grudgeMatch ? 'the GRUDGE match' : 'a pack battle'} vs ${opp.name} — ${myTotal.toFixed(2)} vs ${theirTotal.toFixed(2)}, took the $${pot.toFixed(2)} pot`
        : `Lost ${grudgeMatch ? 'the GRUDGE match' : 'a pack battle'} vs ${opp.name} — ${myTotal.toFixed(2)} vs ${theirTotal.toFixed(2)}`,
      iWin ? pot - stake : -stake,
    )
    return Number(info.lastInsertRowid)
  })
  const battleId = tx()
  const grudgeAfter = updateMemoryAfterBattle(opp, { playerWon: iWin, margin, stake, grudgeMatch, myTotal, theirTotal, saltiest })

  return {
    ok: true as const,
    battleId,
    opponent: { id: opp.id, name: opp.name, avatar: opp.avatar, style: opp.style },
    product: { id: product.id, name: product.name, stake, packsPerSide },
    mine: mine.map((c) => ({ ...c, name: cardName(c.cardId) })),
    theirs: theirs.map((c) => ({ ...c, name: cardName(c.cardId) })),
    myTotal,
    theirTotal,
    myBestPack,
    winner: iWin ? 'player' as const : 'opponent' as const,
    tiebreak: Boolean(tiebreak),
    grudgeMatch,
    pot,
    net: round2(iWin ? pot - stake : -stake),
    grudgeAfter: round2(grudgeAfter),
    chat: buildSpectatorChat(opp, mine, theirs, iWin, grudgeMatch),
  }
}

function bestCardValue(cards: { value: number }[]): number {
  return cards.reduce((a, c) => Math.max(a, c.value), 0)
}

// ---------------------------------------------------------------------------
// Spectator chat — the other rivals watch the rip and react per card.
// Steps are the interleaved reveal order: even = player card, odd = theirs.
// ---------------------------------------------------------------------------

export type ChatLine = { at: number; who: string; avatar: string; text: string }

const CHAT_TIERS: Record<string, string[]> = {
  low: ['the bulk cometh', 'quarter-bin special', 'blessed with filler once again', 'bind it and forget it', 'saw that in my sleep'],
  mid: ['respectable filler', 'solid cardboard', 'that covers a scrap of the stake', 'fine. fine.'],
  high: ['okay okay 👀', "now we're talking", 'binder card, no debate', 'getting spicy in here'],
  huge: ['CLIP IT', 'LETS GOOOO', 'NO WAY 🤯', 'GRAIL ALERT 🚨', 'framed by friday, calling it now'],
}

function chatTier(v: number): string {
  return v >= 30 ? 'huge' : v >= 3 ? 'high' : v >= 0.3 ? 'mid' : 'low'
}

export function buildSpectatorChat(opp: RivalDef, mine: { value: number; isHit: boolean }[], theirs: { value: number; isHit: boolean }[], playerWon: boolean, grudgeMatch = false): ChatLine[] {
  const spectators = RIVALS.filter((r) => r.id !== opp.id)
  const say = (at: number, r: RivalDef | undefined, text: string): ChatLine =>
    r ? { at, who: r.name, avatar: r.avatar, text } : { at, who: 'zapper_99', avatar: '💬', text }
  const anyone = () => (Math.random() < 0.25 ? undefined : spectators[Math.floor(Math.random() * spectators.length)])

  const lines: ChatLine[] = [
    say(-3, spectators[0], 'rip em'),
    say(-2, spectators[1] ?? spectators[0], 'GLGLGL'),
    say(-1, anyone(), grudgeMatch ? `GRUDGE MATCH 🩸 ${opp.name} has been waiting for this` : `${opp.name} thinks they're ready 💀`),
  ]

  const steps = Math.max(mine.length, theirs.length) * 2
  let myRun = 0
  let theirRun = 0
  for (let k = 0; k < steps; k++) {
    const card = k % 2 === 0 ? mine[k / 2] : theirs[(k - 1) / 2]
    if (!card) continue
    if (k % 2 === 0) myRun += card.value
    else theirRun += card.value

    if (Math.random() < 0.62) {
      const tier = chatTier(card.value)
      const s = anyone()
      let text = CHAT_TIERS[tier][Math.floor(Math.random() * CHAT_TIERS[tier].length)]
      if (s?.id === 'math' && card.value >= 1) text = `$${card.value.toFixed(2)} — the math holds`
      if (s?.id === 'vintage' && card.value >= 3) text = 'not WotC but I respect it'
      lines.push(say(k, s, text))
    }
    if (card.isHit && Math.random() < 0.85) {
      lines.push(say(k, anyone(), 'HIT!!! 🎉'))
    }
    // Blowout taunts once one side is clearly running away with it.
    if (myRun > theirRun * 5 + 5 && k % 4 === 3) lines.push(say(k, anyone(), `${opp.name} in shambles`))
    if (theirRun > myRun * 5 + 5 && k % 4 === 3) lines.push(say(k, anyone(), 'chat… our side is cooked'))
  }

  const finaleAt = steps
  const finaleTexts = playerWon
    ? ['gg gg', 'worth every penny', 'the pot leaves the chat 🤑', 'rematch when?']
    : ['oof', 'F in the chat', 'the bulk has spoken', 'rematch. NOW.']
  for (let i = 0; i < 3; i++) {
    lines.push(say(finaleAt, spectators[(i * 2) % spectators.length], finaleTexts[(i + Math.floor(Math.random() * 2)) % finaleTexts.length]))
  }
  return lines.sort((a, b) => a.at - b.at)
}

function cardName(cardId: string): string {
  return (db.prepare('SELECT name FROM cards WHERE id = ?').get(cardId) as { name: string } | undefined)?.name ?? cardId
}

type BattleRow = {
  id: number
  product_id: string
  opponent_id: string
  stake: number
  player_total: number
  opponent_total: number
  player_cards: string
  opponent_cards: string
  winner: string
  tiebreak: number
  created_at: string
}

type BattleOut = {
  id: number
  opponent: string
  productName: string
  stake: number
  playerTotal: number
  opponentTotal: number
  winner: string
  tiebreak: boolean
  net: number
  bestPull: { name: string; value: number } | null
  at: string
}
