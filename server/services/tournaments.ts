import { db, nowIso, logActivity } from '../lib/db'
import { valueOf, round2 } from './market'
import { rollProductPack } from './packs'
import { priceOf as sealedPriceOf, sellsProduct } from './sealed'
import { RIVALS, packsInBox, buildSpectatorChat, type RivalDef, type ChatLine } from './packbattles'
import * as schedule from './schedule'

// ---------------------------------------------------------------------------
// Pack Battle tournaments — single-elimination brackets among the rivals.
// Entry buys you in; every round both sides rip a real product and you keep
// every pull you open. Win the final and the whole purse (entry × field plus
// a house bonus) is yours.
// ---------------------------------------------------------------------------

type RoundDef = { kind: string; label: string }

const FORMAT: Record<number, { rounds: RoundDef[] }> = {
  4: {
    rounds: [
      { kind: 'booster', label: 'Semifinal — Booster rip' },
      { kind: 'bundle', label: 'Final — Booster Bundle rip' },
    ],
  },
  8: {
    rounds: [
      { kind: 'booster', label: 'Quarterfinal — Booster rip' },
      { kind: 'bundle', label: 'Semifinal — Booster Bundle rip' },
      { kind: 'etb', label: 'Championship — Elite Trainer Box rip' },
    ],
  },
}

type BracketSlot = { a: string; b: string; winner: string | null; aTotal: number | null; bTotal: number | null }
type Bracket = BracketSlot[][]

/**
 * One shared product per tournament round — everyone rips the SAME product,
 * a fair fight (the old code rolled a random product PER SIDE, so your semi
 * could rip a modern ETB while your rival's semi ripped a Base booster).
 * Deterministic per tournament+round so status re-fetches stay consistent.
 */
function pickRoundProduct(kind: string, seed: string): { id: string; set_id: string; name: string; kind: string; packs: number | null; msrp: number; market_price: number | null } {
  const rows = db
    .prepare(
      `SELECT p.id, p.set_id, p.name, p.kind, p.packs, p.msrp, p.market_price,
              (SELECT COUNT(*) FROM pack_product_cards ppc WHERE ppc.pack_product_id = p.set_id || '-booster') AS pool
       FROM pack_products p WHERE p.kind = ?`,
    )
    .all(kind) as { id: string; set_id: string; name: string; kind: string; packs: number | null; msrp: number; market_price: number | null; pool: number }[]
  const battlable = rows.filter((r) => r.pool > 0 && sellsProduct(r.id, r.set_id))
  if (battlable.length > 0) {
    const pick = battlable[fnv1a(seed) % battlable.length]
    return { id: pick.id, set_id: pick.set_id, name: pick.name, kind: pick.kind, packs: pick.packs, msrp: pick.msrp, market_price: sealedPriceOf(pick.id).market || pick.msrp }
  }
  // Fallback: any synced booster (first row — deterministic).
  const fb = db
    .prepare(
      `SELECT p.id, p.set_id, p.name, p.kind, p.packs, p.msrp, p.market_price
       FROM pack_products p WHERE p.kind = 'booster' LIMIT 1`,
    )
    .get() as { id: string; set_id: string; name: string; kind: string; packs: number | null; msrp: number; market_price: number | null } | undefined
  return fb && fb.id ? { ...fb, market_price: fb.market_price ?? fb.msrp } : { id: '', set_id: '', name: 'Booster Pack', kind: 'booster', packs: null, msrp: 0, market_price: 0 }
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function prizeFor(size: number, entry: number): number {
  // Purse = your entry × field, house sweetens it by a third.
  return round2(entry * size * (4 / 3))
}

// One flat entry per bracket — the price of the prize ladder, not of the
// products (rounds never charge; the entry covers the whole bracket). The old
// math staked 1.5× a RANDOM etb from all 176 sets, so entry swung $80–$450
// day to day and the finals ripped a box nobody paid for.
const ENTRY: Record<number, number> = { 4: 25, 8: 60 }
function entryFor(size: number): number {
  return ENTRY[size] ?? 25
}

export function tournamentStatus() {
  const t = db
    .prepare(`SELECT * FROM tournaments WHERE status = 'active' ORDER BY id DESC LIMIT 1`)
    .get() as TournamentRow | undefined
  if (!t) {
    // Entry preview so the lobby can show real numbers before you commit.
    const preview = (size: number) => {
      const entry = entryFor(size)
      return { entry, prize: prizeFor(size, entry) }
    }
    const window = schedule.tournamentAllowed()
    return { active: false as const, mini: preview(4), grand: preview(8), window }
  }
  const bracket = JSON.parse(t.bracket) as Bracket
  return {
    active: true as const,
    id: t.id,
    size: t.size,
    entry: t.entry,
    round: t.round,
    prize: t.prize,
    rounds: FORMAT[t.size].rounds,
    bracket,
    title: title(t.size),
  }
}

function title(size: number): string {
  return size === 4 ? 'Mini Invitational' : 'Grand Slam'
}

export function joinTournament(size: number) {
  if (![4, 8].includes(size)) return { ok: false as const, error: 'Bracket must be 4 or 8' }
  if (size - 1 > RIVALS.length) return { ok: false as const, error: 'Not enough rivals in the scene for this bracket' }
  const existing = db.prepare(`SELECT id FROM tournaments WHERE status = 'active'`).get()
  if (existing) return { ok: false as const, error: 'Finish your current bracket first' }
  // The bracket scene runs on the event calendar — Wednesday minis, Friday grands.
  const window = schedule.tournamentAllowed()
  if (!window) return { ok: false as const, error: 'No tournament window is open — check the 📅 Calendar for bracket nights' }
  if (window !== (size === 4 ? 'mini' : 'grand')) return { ok: false as const, error: `This window is for the ${window === 'mini' ? 'Mini Invitational (4-player)' : 'Grand Slam (8-player)'} — the ${size === 4 ? 'Grand Slam runs Friday evening' : 'Mini runs Wednesday evening'}` }

  // One flat entry covers the whole bracket (see ENTRY).
  const entry = entryFor(size)
  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < entry) return { ok: false as const, error: `Entry is $${entry.toFixed(2)} — not enough cash` }

  // Seed: you plus random rivals.
  const pool = [...RIVALS].sort(() => Math.random() - 0.5).slice(0, size - 1)
  const seeds = [you(), ...pool.map((r) => r.id)]
  // Shuffle pairing so round 1 is fresh.
  for (let i = seeds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[seeds[i], seeds[j]] = [seeds[j], seeds[i]]
  }
  const first: BracketSlot[] = []
  for (let i = 0; i < seeds.length; i += 2) first.push({ a: seeds[i], b: seeds[i + 1], winner: null, aTotal: null, bTotal: null })
  const bracket: Bracket = [first]
  let n = first.length
  while (n > 1) {
    bracket.push(Array.from({ length: n / 2 }, () => ({ a: '', b: '', winner: null, aTotal: null, bTotal: null })))
    n /= 2
  }

  const prize = prizeFor(size, entry)
  db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(entry)
  const info = db
    .prepare(`INSERT INTO tournaments (size, entry, round, bracket, status, prize, created_at) VALUES (?, ?, 0, ?, 'active', ?, ?)`)
    .run(size, entry, JSON.stringify(bracket), prize, nowIso())
  logActivity('battle', `Entered the ${title(size)} — $${entry.toFixed(2)} entry, ${size} players, $${prize.toFixed(2)} to the champion.`, -entry)

  const next = nextPlayerMatch(bracket, 0)
  return {
    ok: true as const,
    id: Number(info.lastInsertRowid),
    size,
    entry,
    prize,
    title: title(size),
    rounds: FORMAT[size].rounds,
    bracket,
    yourNextOpponent: next ? rivalName(next.opponentId) : null,
  }
}

function you(): string {
  return '__you__'
}

function rivalName(id: string): string {
  if (id === you()) return 'You'
  return RIVALS.find((r) => r.id === id)?.name ?? id
}

type PendingMatch = { round: number; slotIndex: number; opponentId: string; opponentSlot: 'a' | 'b' }

function nextPlayerMatch(bracket: Bracket, round: number): { opponentId: string; opponentSlot: 'a' | 'b' } | null {
  const slots = bracket[round]
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    if (s.winner) continue
    if (s.a === you()) return { opponentId: s.b, opponentSlot: 'b' }
    if (s.b === you()) return { opponentId: s.a, opponentSlot: 'a' }
  }
  return null
}

/** Rip N packs of ONE fixed product for a side; returns cards + total. */
function rip(product: { id: string; set_id: string }, count: number, owner: 'player' | 'other' = 'player'): { cards: { cardId: string; value: number; isHit: boolean }[]; total: number; bestPack: number } {
  const cards: { cardId: string; value: number; isHit: boolean }[] = []
  const packTotals: number[] = []
  for (let i = 0; i < count; i++) {
    const res = rollProductPack(product, i, `tourney_${owner}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, 10, owner)
    if (res) {
      cards.push(...res.map((c) => ({ cardId: c.cardId, value: c.value, isHit: c.isHit })))
      packTotals.push(round2(res.reduce((a, c) => a + c.value, 0)))
    }
  }
  return { cards, total: round2(cards.reduce((a, c) => a + c.value, 0)), bestPack: round2(Math.max(0, ...packTotals)) }
}

/** NPC vs NPC: both sides simulated from the SAME product's pull tables. */
function simulateNpcMatch(product: { id: string; set_id: string }, packs: number): { aTotal: number; bTotal: number } {
  const a = rip(product, packs, 'other')
  const b = rip(product, packs, 'other')
  return { aTotal: a.total, bTotal: b.total }
}

export function playRound() {
  const t = db.prepare(`SELECT * FROM tournaments WHERE status = 'active' ORDER BY id DESC LIMIT 1`).get() as TournamentRow | undefined
  if (!t) return { ok: false as const, error: 'No active tournament' }
  const bracket = JSON.parse(t.bracket) as Bracket
  const round = t.round
  const format = FORMAT[t.size]
  if (round >= format.rounds.length) return { ok: false as const, error: 'Bracket already complete' }
  const roundDef = format.rounds[round]
  const pending = nextPlayerMatch(bracket, round)
  if (!pending) return { ok: false as const, error: 'No match to play — advance first' }
  const opp = RIVALS.find((r) => r.id === pending.opponentId)
  if (!opp) return { ok: false as const, error: 'Opponent missing' }

  const product = pickRoundProduct(roundDef.kind, `t${t.id}-r${round}`)
  // Every round rips the WHOLE box — a bundle final opens all 6 packs, the
  // ETB championship all 9 — the product's catalog count, not a fixed 2/3.
  const packs = packsInBox(roundDef.kind, product.packs)

  // Player side: real rips into their collection. Tournaments never charge per
  // round — the entry covered the whole bracket.
  const mine = rip(product, packs)
  // Whole-box price over every card in the box = per-pack price ÷ cards per pack.
  const perCard = round2((product.market_price ?? product.msrp) / Math.max(1, mine.cards.length))
  const addInv = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
     VALUES (?, ?, 'NM', 1, 'collection', 'tournament', ?, ?)`,
  )
  for (const c of mine.cards) addInv.run(c.cardId, (c as { variant?: string }).variant || 'normal', perCard, nowIso())

  // Opponent side: real rips too (kept by them, in the fiction) — same product.
  const theirRip = rip(product, packs, 'other')

  const myTotal = mine.total
  const theirTotal = theirRip.total
  const iWin = myTotal >= theirTotal

  // My slot in the bracket.
  const slots = bracket[round]
  const idx = slots.findIndex((s) => !s.winner && (s.a === you() || s.b === you()))
  slots[idx].aTotal = slots[idx].a === you() ? myTotal : theirTotal
  slots[idx].bTotal = slots[idx].b === you() ? myTotal : theirTotal
  slots[idx].winner = iWin ? you() : pending.opponentId

  // Simulate the rest of this round's matches (NPC vs NPC).
  const chatLines: { who: string; avatar: string; text: string }[] = []
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].winner) continue
    const sim = simulateNpcMatch(product, packs)
    slots[i].aTotal = sim.aTotal
    slots[i].bTotal = sim.bTotal
    slots[i].winner = sim.aTotal >= sim.bTotal ? slots[i].a : slots[i].b
  }

  // Seed the next round.
  const eliminated = !iWin
  let finished = false
  let prizePaid = 0
  if (!eliminated) {
    if (round + 1 < bracket.length) {
      const nextSlots = bracket[round + 1]
      const target = nextSlots[Math.floor(idx / 2)]
      if (idx % 2 === 0) target.a = you()
      else target.b = you()
      // Fill opponents from simulated winners.
      for (let i = 0; i < slots.length; i += 2) {
        const targetSlot = nextSlots[i / 2]
        const wA = slots[i].winner
        const wB = slots[i + 1]?.winner ?? null
        if (wA && wA !== you() && !targetSlot.a) targetSlot.a = wA
        if (wB && wB !== you() && !targetSlot.b) targetSlot.b = wB
      }
    } else {
      // Won the final.
      finished = true
      prizePaid = t.prize
      db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(prizePaid)
      logActivity('battle', `🏆 Champion of the ${title(t.size)}! Prize $${prizePaid.toFixed(2)}.`, prizePaid)
    }
  }

  const status = finished ? 'won' : eliminated ? 'eliminated' : 'active'
  db.prepare(`UPDATE tournaments SET bracket = ?, round = ?, status = ?, prize = ?, finished_at = ? WHERE id = ?`)
    .run(JSON.stringify(bracket), round + 1, status, prizePaid || t.prize, finished ? nowIso() : null, t.id)

  if (eliminated) logActivity('battle', `Knocked out of the ${title(t.size)} in ${roundDef.label} — ${opp.name} took it ${theirTotal.toFixed(2)} vs ${myTotal.toFixed(2)}.`)

  const chat: ChatLine[] = buildSpectatorChat(opp, mine.cards, theirRip.cards, iWin, false)
  chat.unshift({ at: -4, who: 'Ring Announcer', avatar: '🎤', text: `${roundDef.label} — ${opp.name} across the table. Rip well.` })
  void chatLines

  return {
    ok: true as const,
    round,
    roundLabel: roundDef.label,
    opponent: { id: opp.id, name: opp.name, avatar: opp.avatar, style: opp.style },
    product: { id: product.id, name: product.name, stake: round2(product.market_price ?? product.msrp), packsPerSide: packs },
    mine: mine.cards.map((c) => ({ ...c, name: cardName(c.cardId) })),
    theirs: theirRip.cards.map((c) => ({ ...c, name: cardName(c.cardId) })),
    myTotal,
    theirTotal,
    myBestPack: mine.bestPack,
    winner: iWin ? ('player' as const) : ('opponent' as const),
    eliminated,
    champion: finished,
    prizePaid,
    bracket,
    chat,
  }
}

/** Walk away from an active bracket: entry forfeited, bracket closed. */
export function abandonTournament() {
  const t = db.prepare(`SELECT * FROM tournaments WHERE status = 'active' ORDER BY id DESC LIMIT 1`).get() as TournamentRow | undefined
  if (!t) return { ok: false as const, error: 'No active tournament' }
  db.prepare(`UPDATE tournaments SET status = 'abandoned', finished_at = ? WHERE id = ?`).run(nowIso(), t.id)
  logActivity('battle', `Withdrew from the ${title(t.size)}. Entry forfeited.`)
  return { ok: true as const }
}

function cardName(cardId: string): string {
  return (db.prepare('SELECT name FROM cards WHERE id = ?').get(cardId) as { name: string } | undefined)?.name ?? cardId
}

type TournamentRow = {
  id: number
  size: number
  entry: number
  round: number
  bracket: string
  status: string
  prize: number
  created_at: string
  finished_at: string | null
}
