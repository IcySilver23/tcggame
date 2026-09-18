import { db, nowIso, logActivity } from '../lib/db'
import { valueOf, round2 } from './market'
import { rollPack } from './packs'
import { RIVALS, buildSpectatorChat, type RivalDef, type ChatLine } from './packbattles'
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

function productForKind(kind: string) {
  const row = db
    .prepare(
      `SELECT p.id, p.set_id, p.name, p.kind, p.msrp, p.market_price,
              (SELECT COUNT(*) FROM pack_product_cards ppc WHERE ppc.pack_product_id = p.set_id || '-booster') AS pool
       FROM pack_products p WHERE p.kind = ? ORDER BY RANDOM() LIMIT 1`,
    )
    .get(kind) as { id: string; set_id: string; name: string; kind: string; msrp: number; market_price: number | null; pool: number } | undefined
  if (!row || row.pool === 0) {
    // Fallback: any battlable booster.
    return db
      .prepare(
        `SELECT p.id, p.set_id, p.name, p.kind, p.msrp, p.market_price
         FROM pack_products p WHERE p.kind = 'booster' LIMIT 1`,
      )
      .get() as { id: string; set_id: string; name: string; kind: string; msrp: number; market_price: number | null }
  }
  return row
}

function prizeFor(size: number, entry: number): number {
  // Purse = your entry × field, house sweetens it by a third.
  return round2(entry * size * (4 / 3))
}

export function tournamentStatus() {
  const t = db
    .prepare(`SELECT * FROM tournaments WHERE status = 'active' ORDER BY id DESC LIMIT 1`)
    .get() as TournamentRow | undefined
  if (!t) {
    // Entry preview so the lobby can show real numbers before you commit.
    const entryFor = (size: number) => {
      const heaviest = productForKind(FORMAT[size].rounds[FORMAT[size].rounds.length - 1].kind)
      const entry = round2((heaviest.market_price ?? heaviest.msrp) * 1.5)
      return { entry, prize: prizeFor(size, entry) }
    }
    const window = schedule.tournamentAllowed()
    return { active: false as const, mini: entryFor(4), grand: entryFor(8), window }
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

  const rounds = FORMAT[size].rounds
  // Entry scales with the heaviest round so the purse is worth the ladder.
  const heaviest = productForKind(rounds[rounds.length - 1].kind)
  const entry = round2((heaviest.market_price ?? heaviest.msrp) * 1.5)
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

/** Rip N packs of a kind for a side; returns cards + total. */
function rip(kind: string, count: number): { cards: { cardId: string; value: number; isHit: boolean }[]; total: number } {
  const product = productForKind(kind)
  const cards: { cardId: string; value: number; isHit: boolean }[] = []
  for (let i = 0; i < count; i++) {
    const res = rollPack(product.set_id, `tourney_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`)
    if (res) cards.push(...res.map((c) => ({ cardId: c.cardId, value: c.value, isHit: c.isHit })))
  }
  return { cards, total: round2(cards.reduce((a, c) => a + c.value, 0)) }
}

/** NPC vs NPC: both sides simulated straight from the pull tables. */
function simulateNpcMatch(kind: string): { aTotal: number; bTotal: number } {
  const a = rip(kind, kind === 'booster' ? 1 : kind === 'bundle' ? 2 : 3)
  const b = rip(kind, kind === 'booster' ? 1 : kind === 'bundle' ? 2 : 3)
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

  const product = productForKind(roundDef.kind)
  const packs = roundDef.kind === 'booster' ? 1 : roundDef.kind === 'bundle' ? 2 : 3

  // Player side: real rips into their collection.
  const mine = rip(roundDef.kind, packs)
  const perCard = round2((product.market_price ?? product.msrp) / Math.max(1, mine.cards.length))
  const addInv = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
     VALUES (?, ?, 'NM', 1, 'collection', 'tournament', ?, ?)`,
  )
  for (const c of mine.cards) addInv.run(c.cardId, (c as { variant?: string }).variant || 'normal', perCard, nowIso())

  // Opponent side: real rips too (kept by them, in the fiction).
  const theirRip = rip(roundDef.kind, packs)

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
    const sim = simulateNpcMatch(roundDef.kind)
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
