import { db, nowIso, logActivity } from '../lib/db'
import { round2 } from './market'
import { listBattlableProducts } from './packbattles'
import { rollPack } from './packs'
import { cardName, handlesFor, liveStream, pick, VIEWER_AVATARS } from './streaming'
import { registerBreakSettler, registerBreakLinker } from './streamlinks'

// Register the settle/link hooks so streaming.ts can drive breaks without a
// static import cycle back into this module.
registerBreakSettler(settleBreak)
registerBreakLinker(linkBreakToStream)

// ---------------------------------------------------------------------------
// Case breaks (Phase 5 — Empire): sell rip spots on your own channel. You buy
// the sealed product, viewers buy the spots (one Pokémon team each), and the
// pulls go to the spot-holders — the house keeps what it doesn't sell. List
// your product honestly: sell every spot at a markup and it's pure margin;
// leave some unsold and the house eats the cost, but the house keeps those
// pulls. Hype follows the rip: hits pack the room, dry spells bleed it.
// ---------------------------------------------------------------------------

type BreakRow = {
  id: number
  stream_id: number
  product_id: string
  product_name: string
  set_id: string
  spot_price: number
  product_cost: number
  spots_total: number
  spots_sold: number
  teams_json: string | null
  gross: number
  status: string
  created_at: string
  settled_at: string | null
}

type SpotRow = { id: number; spot_no: number; team: string; team_dex: number | null; holder: string; payout: number; pulls: number; claimed_at: string }

type TeamEntry = { team: string; dex: number }

const SPOT_MIN = 4
const SPOT_MAX = 16

const r2 = (n: number) => Math.round(n * 100) / 100

/** "Mega Darkrai ex" → "Darkrai" — spots are named for the species, not the printing. */
function baseSpecies(name: string): string {
  return name.replace(/^Mega\s+/i, '').replace(/\s+ex$/i, '').trim()
}

/**
 * The break's team board is drawn from the product's own set — only species that
 * can actually come out of the packs, so every spot sold can win. Ranked by
 * market value so the marquee Pokémon (the ones people buy spots for) make the
 * board; one entry per national dex so form variants don't duplicate a team.
 */
function rosterFor(setId: string, count: number): TeamEntry[] {
  const rows = db
    .prepare(
      `SELECT c.name, c.dex_numbers, MAX(pr.market) AS mkt FROM cards c
       JOIN price_records pr ON pr.card_id = c.id
       WHERE c.set_id = ? AND c.dex_numbers IS NOT NULL
       GROUP BY c.id ORDER BY mkt DESC`,
    )
    .all(setId) as { name: string; dex_numbers: string }[]
  const seen = new Set<number>()
  const out: TeamEntry[] = []
  for (const r of rows) {
    try {
      const dex = (JSON.parse(r.dex_numbers) as number[])[0]
      if (dex == null || seen.has(dex)) continue
      seen.add(dex)
      out.push({ team: baseSpecies(r.name), dex })
      if (out.length >= count) break
    } catch { /* skip malformed dex data */ }
  }
  return out
}

function liveBreakRow(): BreakRow | undefined {
  return db
    .prepare(
      `SELECT b.* FROM stream_breaks b JOIN streams s ON s.id = b.stream_id
       WHERE s.status = 'live' AND b.status = 'selling' ORDER BY b.id DESC LIMIT 1`,
    )
    .get() as BreakRow | undefined
}

/**
 * Open a break on the upcoming stream. Cash for the product leaves up front;
 * you set the per-spot price (a markup over even split is the house margin).
 */
export function createBreak(productId: string, spots: number, spotPriceInput: number | null) {
  if (liveStream()) return { ok: false as const, error: 'End the current stream first — breaks open before you go live' }
  const products = listBattlableProducts()
  const p = products.find((x) => x.id === productId)
  if (!p) return { ok: false as const, error: 'Unknown product' }
  const total = Math.max(SPOT_MIN, Math.min(SPOT_MAX, Math.round(spots)))
  if (total !== Math.round(spots)) return { ok: false as const, error: `A break runs ${SPOT_MIN}–${SPOT_MAX} spots` }

  const cost = round2(p.market_price ?? p.msrp)
  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < cost) return { ok: false as const, error: `The ${p.name} costs $${cost.toFixed(2)} — not enough cash` }

  // The team board comes from the set itself — every sold spot can actually hit.
  const roster = rosterFor(p.set_id, total)
  if (roster.length < SPOT_MIN) return { ok: false as const, error: 'Not enough different Pokémon in this set to run a break' }
  const spotsTotal = Math.min(total, roster.length)

  // Suggested ask: even split + 25% house margin, rounded to a clean .50.
  const suggested = Math.max(0.5, Math.ceil((cost * 1.25) / spotsTotal * 2) / 2)
  const spotPrice = spotPriceInput != null ? round2(Math.max(0.25, spotPriceInput)) : suggested

  // Money and break row move together — a failed insert must not eat the cash.
  const breakId = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(cost)
    const info = db
      .prepare(
        `INSERT INTO stream_breaks (product_id, product_name, set_id, spot_price, product_cost, spots_total, teams_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'selling', ?)`,
      )
      .run(p.id, p.name, p.set_id, spotPrice, cost, spotsTotal, JSON.stringify(roster), nowIso())
    return Number(info.lastInsertRowid)
  })()

  logActivity(
    'stream',
    `📦 Break opened: selling ${spotsTotal} team spots at $${spotPrice.toFixed(2)} for a ${p.name} ($${cost.toFixed(2)} out of pocket). Board: ${roster.map((t) => t.team).join(', ')}. Full sellout = $${round2(spotsTotal * spotPrice).toFixed(2)} gross; unsold spots stay with the house.`,
    -cost,
  )

  return { ok: true as const, breakId, suggested, spotPrice, spotsTotal, productCost: cost }
}

/** The pending break (created, stream not started yet). */
export function pendingBreak(): BreakRow | undefined {
  return db.prepare(`SELECT * FROM stream_breaks WHERE stream_id IS NULL AND status = 'selling' ORDER BY id DESC LIMIT 1`).get() as BreakRow | undefined
}

/** Cancel a pending break — the product is refunded, no harm done. */
export function cancelBreak(breakId: number) {
  const b = db.prepare(`SELECT * FROM stream_breaks WHERE id = ? AND status = 'selling'`).get(breakId) as BreakRow | undefined
  if (!b) return { ok: false as const, error: 'Break not found or already live' }
  if (b.stream_id != null) return { ok: false as const, error: 'The break is live — it resolves when the stream ends' }
  db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(b.product_cost)
  db.prepare(`UPDATE stream_breaks SET status = 'cancelled' WHERE id = ?`).run(breakId)
  logActivity('stream', `Break cancelled — the ${b.product_name} goes back on the shelf, $${b.product_cost.toFixed(2)} refunded.`)
  return { ok: true as const }
}

/**
 * A viewer claims a spot for their team. Live breaks only — before the stream
 * starts the spots aren't on sale yet (the room forms when you go live).
 */
export function buySpot(breakId: number, team: string) {
  const b = db.prepare(`SELECT * FROM stream_breaks WHERE id = ?`).get(breakId) as BreakRow | undefined
  if (!b) return { ok: false as const, error: 'Break not found' }
  const st = liveStream()
  if (!st || st.id !== b.stream_id) return { ok: false as const, error: 'Spots go on sale when the break goes live' }

  const spot = db
    .prepare(`SELECT id FROM stream_break_spots WHERE break_id = ? AND team = ?`)
    .get(breakId, team) as { id: number } | undefined
  if (spot) return { ok: false as const, error: `${team} is already taken` }

  const sold = (db.prepare(`SELECT COUNT(*) n FROM stream_break_spots WHERE break_id = ?`).get(breakId) as { n: number }).n
  if (sold >= b.spots_total) return { ok: false as const, error: 'Every spot is sold' }

  const roster = JSON.parse(b.teams_json ?? '[]') as TeamEntry[]
  const entry = roster.find((r) => r.team === team)
  if (!entry) return { ok: false as const, error: 'That team is not on the board for this break' }

  const who = pick(handlesFor(st.id))
  db.prepare(
    `INSERT INTO stream_break_spots (break_id, spot_no, team, team_dex, holder, claimed_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(breakId, sold + 1, team, entry.dex, who, nowIso())
  db.prepare(`UPDATE stream_breaks SET spots_sold = spots_sold + 1, gross = gross + ? WHERE id = ?`).run(b.spot_price, breakId)
  db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(b.spot_price)

  logActivity('stream', `${who} bought the ${team} spot for $${b.spot_price.toFixed(2)} (${sold + 1}/${b.spots_total}).`, b.spot_price)

  return { ok: true as const, holder: who, spotsSold: sold + 1, spotsTotal: b.spots_total, chat: { who, avatar: pick(VIEWER_AVATARS), text: pick([
    `claimed ${team} — let's GO`,
    `${team} mine. rip it.`,
    `in for ${team} 🙏`,
    `${team} spot secured, no refunds`,
  ]) } }
}

// ---------------------------------------------------------------------------
// Rip engine — one pack per call, attributed to the spots.
// ---------------------------------------------------------------------------

/**
 * Which spot a pulled card belongs to. The card's national dex number is
 * matched against the claimed spots' dex — the same trick the roster uses, so
 * a Mega/EV printing still pays its species' spot. Trainers, energy, and
 * unrostered species stay with the house.
 */
function spotForCard(breakId: number, cardId: string): SpotRow | null {
  const row = db.prepare(`SELECT dex_numbers FROM cards WHERE id = ?`).get(cardId) as { dex_numbers: string | null } | undefined
  if (!row?.dex_numbers) return null
  const spots = db.prepare(`SELECT * FROM stream_break_spots WHERE break_id = ? AND team_dex IS NOT NULL`).all(breakId) as SpotRow[]
  if (spots.length === 0) return null
  try {
    const dexes = JSON.parse(row.dex_numbers) as number[]
    return spots.find((s) => dexes.includes(s.team_dex!)) ?? null
  } catch {
    return null
  }
}

export type BreakRip = {
  ok: true
  packNo: number
  cards: { cardId: string; name: string; value: number; isHit: boolean; spot: string | null; holder: string | null }[]
  packBest: { name: string; value: number; team: string | null; holder: string | null } | null
  viewers: number
  viewerDelta: number
  chat: { at: number; who: string; avatar: string; text: string }[]
  donations: { amount: number; who: string; text: string }[]
  spotsSold: number
  spotsTotal: number
  streamDone: boolean
  newBest: { name: string; value: number } | null
}

/** Rip the next pack of the live break. Pulls go to spot-holders, not you. */
export function ripBreak(): { ok: false; error: string } | BreakRip {
  const st = liveStream()
  if (!st) return { ok: false, error: 'Not live' }
  const b = liveBreakRow()
  if (!b || b.stream_id !== st.id) return { ok: false, error: 'No live break on this stream' }

  const sessionId = `break_${b.id}_${st.packs_opened + 1}`
  // Break pulls belong to spot-holders, not the player — world log only.
  const cards = rollPack(b.set_id, sessionId, 'booster', 10, 'other') ?? []
  if (cards.length === 0) return { ok: false, error: 'Pull engine returned nothing for this set' }

  const packNo = st.packs_opened + 1
  const insertPull = db.prepare(
    `INSERT INTO stream_break_pulls (break_id, spot_id, card_id, value, pack_no) VALUES (?, ?, ?, ?, ?)`,
  )
  const bumpSpot = db.prepare(`UPDATE stream_break_spots SET payout = payout + ?, pulls = pulls + 1 WHERE id = ?`)

  const out: BreakRip['cards'] = []
  let packBest: BreakRip['packBest'] = null
  for (const c of cards) {
    const spot = spotForCard(b.id, c.cardId)
    insertPull.run(b.id, spot?.id ?? null, c.cardId, c.value, packNo)
    if (spot) bumpSpot.run(c.value, spot.id)
    if (c.value > (packBest?.value ?? 0)) {
      packBest = { name: cardName(c.cardId), value: c.value, team: spot?.team ?? null, holder: spot?.holder ?? null }
    }
    out.push({ cardId: c.cardId, name: cardName(c.cardId), value: c.value, isHit: c.isHit, spot: spot?.team ?? null, holder: spot?.holder ?? null })
  }

  // Viewership rides the same curve as a normal rip — hits pack the room.
  const perPackValue = cards.reduce((a, c) => a + c.value, 0)
  let viewers = st.peak_viewers
  let viewerDelta = 0
  if (perPackValue >= 25) viewerDelta = Math.max(1, Math.round(viewers * (0.06 + Math.random() * 0.1)))
  else if (perPackValue >= 8) viewerDelta = Math.round(Math.random() * Math.max(1, viewers * 0.04))
  else viewerDelta = -Math.round(Math.random() * Math.max(0, viewers * 0.05))
  // Sold-out rooms are invested rooms — softens the bulk bleed.
  if (b.spots_sold >= b.spots_total && viewerDelta < 0) viewerDelta = Math.round(viewerDelta / 2)
  viewers = Math.max(2, viewers + viewerDelta)

  // Chat: holders scream for their spot, the room reacts like any rip.
  const pool = handlesFor(st.id)
  const chat: BreakRip['chat'] = []
  let at = packNo * 100
  for (const c of out) {
    if (c.spot && c.value >= 8) {
      chat.push({ at, who: c.holder!, avatar: pick(VIEWER_AVATARS), text: pick([
        `THAT'S MY ${c.spot.toUpperCase()}!!! 🚨`,
        `${c.spot} SPOT WINS AGAIN`,
        `holder of ${c.spot} here — I FREADED OUT`,
      ]) })
    } else if (Math.random() < 0.4) {
      chat.push({ at, who: pick(pool), avatar: pick(VIEWER_AVATARS), text: c.spot ? pick([
        `${c.spot} eat GOOD tonight`,
        `of course it's the ${c.spot} spot`,
      ]) : 'house card. shame. SHAME.' })
    }
    at += 1
  }
  if (packBest && packBest.value >= 30) {
    chat.push({ at, who: pick(pool), avatar: '📣', text: `CLIP IT — ${packBest.holder ? `${packBest.holder} just ate a ${packBest.name}` : `the HOUSE kept a ${packBest.name}`}` })
  }
  if (viewerDelta >= 2) chat.push({ at, who: 'STREAM', avatar: '📣', text: `${viewers} watching — word is spreading about this break` })

  // Tips land on big hits, same as a normal stream.
  const donations: BreakRip['donations'] = []
  let donationsTotal = 0
  if (packBest && packBest.value >= 30) {
    const d = { amount: round2(2 + Math.random() * 6), who: 'anonymous tip', text: `${packBest.holder ?? 'the house'} deserved that ${packBest.name}` }
    donations.push(d)
    donationsTotal = d.amount
    chat.push({ at, who: d.who, avatar: '💰', text: `tipped $${d.amount.toFixed(2)} — ${d.text}` })
  }

  const prevBest = st.best_card_value ?? 0
  const newBest = packBest && packBest.value > prevBest ? { name: packBest.name, value: packBest.value } : null

  db.prepare(
    `UPDATE streams SET packs_opened = packs_opened + 1, peak_viewers = ?, donations_total = donations_total + ?, chat_lines = chat_lines + ?, best_card_id = COALESCE(?, best_card_id), best_card_name = COALESCE(?, best_card_name), best_card_value = COALESCE(?, best_card_value) WHERE id = ?`,
  ).run(viewers, donationsTotal, chat.length, newBest ? out.find((c) => c.name === packBest!.name)?.cardId ?? null : null, newBest?.name ?? null, newBest?.value ?? null, st.id)

  return {
    ok: true,
    packNo,
    cards: out,
    packBest,
    viewers,
    viewerDelta,
    chat,
    donations,
    spotsSold: b.spots_sold,
    spotsTotal: b.spots_total,
    streamDone: packNo >= st.packs_planned,
    newBest,
  }
}

// ---------------------------------------------------------------------------
// Stream lifecycle — linkage at go-live, settlement at wrap-up.
// ---------------------------------------------------------------------------

/** Bind the pending break to the stream that's about to start (from goLive). */
export function linkBreakToStream(streamId: number): BreakRow | null {
  const b = pendingBreak()
  if (!b) return null
  db.prepare(`UPDATE stream_breaks SET stream_id = ? WHERE id = ?`).run(streamId, b.id)
  return b
}

/**
 * Settle the break when the stream ends. The house keeps every unsold-spot
 * pull (straight into inventory); sold spots were paid at claim time. The
 * stream's tips still pay out through the normal endStream path.
 */
export function settleBreak(streamId: number) {
  const b = db
    .prepare(`SELECT * FROM stream_breaks WHERE stream_id = ? AND status = 'selling' ORDER BY id DESC LIMIT 1`)
    .get(streamId) as BreakRow | undefined
  if (!b) return null

  // House keeps the pulls from unsold spots.
  const houseCards = db
    .prepare(
      `SELECT p.card_id, p.value, p.spot_id FROM stream_break_pulls p
       WHERE p.break_id = ? AND p.spot_id IS NULL`,
    )
    .all(b.id) as { card_id: string; value: number; spot_id: number | null }[]
  const perCardCost = round2(b.product_cost / Math.max(1, b.spots_total * 10))
  const addInv = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
     VALUES (?, ?, 'NM', 1, 'collection', 'break_house', ?, ?)`,
  )
  for (const h of houseCards) addInv.run(h.card_id, 'normal', perCardCost, nowIso())

  const best = db
    .prepare(
      `SELECT p.value, c.name, s.team, s.holder FROM stream_break_pulls p
       JOIN cards c ON c.id = p.card_id
       LEFT JOIN stream_break_spots s ON s.id = p.spot_id
       WHERE p.break_id = ? ORDER BY p.value DESC LIMIT 1`,
    )
    .get(b.id) as { value: number; name: string; team: string | null; holder: string | null } | undefined

  db.prepare(`UPDATE stream_breaks SET status = 'settled', settled_at = ? WHERE id = ?`).run(nowIso(), b.id)

  const net = round2(b.gross - b.product_cost)
  const unsold = b.spots_total - b.spots_sold
  logActivity(
    'stream',
    `📦 Break settled: ${b.spots_sold}/${b.spots_total} spots sold, $${b.gross.toFixed(2)} gross − $${b.product_cost.toFixed(2)} product = ${net >= 0 ? '+' : ''}$${net.toFixed(2)} net${unsold > 0 ? ` · the house kept ${unsold} spot${unsold === 1 ? '' : 's'} (${houseCards.length} cards pulled)` : ' · sold out — pure margin'}.${best ? ` Best pull: ${best.name} ($${best.value.toFixed(2)})${best.holder ? ` to ${best.holder} (${best.team})` : ' — house kept it'}.` : ''}`,
    net,
  )

  return {
    breakId: b.id,
    spotsSold: b.spots_sold,
    spotsTotal: b.spots_total,
    gross: b.gross,
    productCost: b.product_cost,
    net,
    houseCards: houseCards.length,
    best: best ? { name: best.name, value: best.value, team: best.team, holder: best.holder } : null,
  }
}

/** Read model for the Stream view's break panel. */
export function breakForStream(streamId: number) {
  const b = db
    .prepare(`SELECT * FROM stream_breaks WHERE stream_id = ? OR (stream_id IS NULL AND status = 'selling') ORDER BY id DESC LIMIT 1`)
    .get(streamId) as BreakRow | undefined
  const row = b ?? pendingBreak()
  if (!row) return null
  const spots = db.prepare(`SELECT * FROM stream_break_spots WHERE break_id = ? ORDER BY spot_no`).all(row.id) as SpotRow[]
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    spotPrice: row.spot_price,
    spotsTotal: row.spots_total,
    spotsSold: row.spots_sold,
    gross: round2(row.gross),
    productCost: row.product_cost,
    housePot: round2(row.spot_price * (row.spots_total - row.spots_sold)),
    status: row.status,
    live: row.stream_id != null,
    spots: spots.map((s) => ({ id: s.id, spotNo: s.spot_no, team: s.team, holder: s.holder, payout: round2(s.payout), pulls: s.pulls })),
    openTeams: (JSON.parse(row.teams_json ?? '[]') as TeamEntry[]).map((t) => t.team).filter((t) => !spots.some((s) => s.team === t)),
  }
}
