import { db, nowIso, logActivity } from '../lib/db'
import { round2, valueOf } from './market'
import { rollPack } from './packs'
import { listBattlableProducts } from './packbattles'
import { settleStream, sponsorForKind, maybeGenerateOffer } from './sponsors'
import { settleBreakFor, linkBreakFor } from './streamlinks'

// ---------------------------------------------------------------------------
// Streaming room — run your own pack-opening stream. Real product, real rips,
// simulated viewers whose count reacts to what you pull, chat that reacts to
// every card, donations that land on hits. Followers persist as channel stats.
// ---------------------------------------------------------------------------

type LiveRow = {
  id: number
  product_id: string
  product_name: string
  set_id: string
  kind: string
  price: number
  packs_opened: number
  packs_planned: number
  peak_viewers: number
  donations_total: number
  chat_lines: number
  best_card_id: string | null
  best_card_name: string | null
  best_card_value: number | null
  status: string
  started_at: string
  ended_at: string | null
}

type StreamStatsRow = {
  id: number
  followers: number
  total_streams: number
  total_packs: number
  total_donations: number
  best_card_name: string | null
  best_card_value: number | null
}

export type StreamChatLine = { at: number; who: string; avatar: string; text: string }

type RipCard = { cardId: string; isHit: boolean; value: number; variant: string }

const nameStmt = db.prepare('SELECT name FROM cards WHERE id = ?')
export function cardName(id: string): string {
  return (nameStmt.get(id) as { name: string } | undefined)?.name ?? id
}

export function liveStream(): LiveRow | undefined {
  return db
    .prepare(`SELECT * FROM streams WHERE status = 'live' ORDER BY id DESC LIMIT 1`)
    .get() as LiveRow | undefined
}

function stats(): StreamStatsRow {
  const row = db
    .prepare(`SELECT * FROM stream_stats WHERE id = 1`)
    .get() as StreamStatsRow | undefined
  if (!row) {
    db.prepare(`INSERT OR IGNORE INTO stream_stats (id, followers) VALUES (1, 120)`).run()
    return db.prepare(`SELECT * FROM stream_stats WHERE id = 1`).get() as StreamStatsRow
  }
  return row
}

function liveState() {
  const st = liveStream()
  if (!st) return null
  return {
    id: st.id,
    product: { id: st.product_id, name: st.product_name, set_id: st.set_id, kind: st.kind, price: st.price },
    packsOpened: st.packs_opened,
    packsPlanned: st.packs_planned,
    viewers: st.peak_viewers,
    peak: st.peak_viewers,
    donationsTotal: st.donations_total,
    chatLines: st.chat_lines,
    best: st.best_card_name ? { name: st.best_card_name, value: st.best_card_value ?? 0 } : null,
  }
}

export function channel() {
  const s = stats()
  const st = liveStream()
  return {
    followers: s.followers,
    totalStreams: s.total_streams,
    totalPacks: s.total_packs,
    totalDonations: s.total_donations,
    bestCardName: s.best_card_name,
    bestCardValue: s.best_card_value,
    live: liveState(),
    // The selling half of the room: the lot on camera, the room's receipts, and
    // the cards you could put up next. Empty while the channel is dark.
    lots: st
      ? streamLotsFor(st.id)
      : { live: null, recent: [], totals: { listed: 0, sold: 0, unsold: 0, gross: 0, fees: 0, net: 0, sellThrough: 0, feePct: Math.round(LOT_FEE * 100) } },
    sellable: st ? sellableCards(60) : [],
    contract: currentContractSafe(),
    offers: offersSafe(),
  }
}

import { currentContract, listOffers } from './sponsors'
function currentContractSafe() {
  try { return currentContract() } catch { return null }
}
function offersSafe() {
  try { return listOffers() } catch { return [] }
}

export function goLive(productId: string, packs: number) {
  if (liveStream()) return { ok: false as const, error: 'You are already live' }
  const products = listBattlableProducts()
  const p = products.find((x) => x.id === productId)
  if (!p) return { ok: false as const, error: 'Unknown product' }
  const planned = Math.max(1, Math.min(20, Math.round(packs)))
  const price = round2(p.market_price ?? p.msrp)

  // A pending break owns its product already — this stream rips THAT product
  // free of charge (the break paid up front). Nothing else may ride along.
  const pendingBreakRow = db
    .prepare(`SELECT * FROM stream_breaks WHERE stream_id IS NULL AND status = 'selling' ORDER BY id DESC LIMIT 1`)
    .get() as { id: number; product_id: string; product_name: string; spots_total: number; product_cost: number } | undefined
  if (pendingBreakRow && productId !== pendingBreakRow.product_id) {
    return { ok: false as const, error: `A break is pending for ${pendingBreakRow.product_name} — break that, or cancel it first` }
  }

  const cost = pendingBreakRow ? 0 : round2(price * planned)
  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < cost) return { ok: false as const, error: `Streaming ${planned} × ${p.name} costs $${cost.toFixed(2)} — not enough cash` }

  if (cost > 0) db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(cost)
  const info = db
    .prepare(
      `INSERT INTO streams (product_id, product_name, set_id, kind, price, packs_planned, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(p.id, p.name, p.set_id, p.kind, price, planned, nowIso())
  const streamId = Number(info.lastInsertRowid)

  // A slice of the follower base shows up; exact count rolls per stream.
  // Sponsored product? The brand promotes the stream — a bigger room arrives.
  const followers = stats().followers
  const base = Math.max(3, Math.round(followers * 0.22))
  const sponsorActive = !!sponsorForKind(p.kind)
  const boostedBase = sponsorActive ? Math.round(base * 1.5) : base
  db.prepare(`UPDATE streams SET peak_viewers = ? WHERE id = ?`).run(boostedBase + Math.floor(Math.random() * 5), streamId)

  // A pending case break rides this stream — bind it synchronously (the
  // registry avoids a static import cycle), and the room skews bigger
  // (break viewers are a different crowd than pack rips).
  const linkedBreak = linkBreakFor(streamId) as { spots_total: number } | null
  if (linkedBreak) {
    const bump = Math.max(2, Math.round(followers * 0.08))
    db.prepare(`UPDATE streams SET peak_viewers = peak_viewers + ? WHERE id = ?`).run(bump, streamId)
  }

  logActivity('stream', pendingBreakRow
    ? `Went live with the ${p.name} break — ${pendingBreakRow.spots_total} spots are on sale (product already paid). ${boostedBase} viewers for the rip.`
    : sponsorActive
      ? `Went live opening ${planned} × ${p.name} — sponsor promo pulled in a bigger room (${boostedBase} viewers). Cost $${cost.toFixed(2)}.`
      : `Went live opening ${planned} × ${p.name} — ${base} viewers showed up. Cost $${cost.toFixed(2)}.`,
    cost > 0 ? -cost : undefined)

  return { ok: true as const, live: liveState() }
}

// Viewer handle pool — stable within a stream, reshuffled each stream.
const VIEWER_NAMES = [
  'PikaPump', 'holo_hunter', 'RipKing', 'slabking88', 'nostalgia', 'BulkGoblin', 'toploader_ted',
  'CharizardCarl', 'packgod_ry', 'BinderBee', 'moonbreon_mia', 'EV_Evelyn', 'FOMO_Finn', 'grail_greg',
  'ShinySam', 'reverse_foil_fan', 'WOTC_Wes', 'psa10_pat', 'crimpedpacks', 'InvestorIke',
  'etb_andy', 'chasethechase', 'sealedsarah', 'boosterboxben', 'rainbow_rhonda', 'zero_apm', 'ladderluck',
  'ThePullGuru', 'vintonly', 'casebreaker', 'gold_gus', 'JumboJenny', 'PromoPedro', 'shill_slayer',
]
export const VIEWER_AVATARS = ['🦎', '🐸', '🦊', '🐼', '🐧', '🦉', '🐙', '🦝']

const viewerHandles = new Map<number, string[]>()

export function handlesFor(streamId: number): string[] {
  let list = viewerHandles.get(streamId)
  if (!list) {
    list = [...VIEWER_NAMES].sort(() => Math.random() - 0.5).slice(0, 14)
    viewerHandles.set(streamId, list)
  }
  return list
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Chat flavor per card tier — mirrors how real pack-stream chat reacts.
function chatFor(name: string, value: number): string {
  if (value >= 100)
    return pick([
      `NO WAY. ${name}?! CLIP IT`,
      `${name} ON STREAM?? I'M SCREAMING`,
      'THE ALGORITHM BLESSED YOU TODAY',
      'THAT PAYS RENT. FRAMED BY FRIDAY.',
    ])
  if (value >= 30)
    return pick([
      `HIT!!! ${name} 🚨`,
      `${name}?? chat we witnessed that live`,
      `GRAIL ALERT 🚨 ${name}`,
      "okay okay OKAY that's a banger",
    ])
  if (value >= 8)
    return pick([
      `${name} — binder card, no debate`,
      'clean pull o7',
      `${name} slaps`,
      "that's a keep for sure",
    ])
  if (value >= 1.5)
    return pick([
      'decent holo',
      `${name} nice`,
      'trade bait',
      'bout it',
    ])
  return pick([
    'quarter-bin special',
    'the bulk cometh',
    'o7 to the bulk',
    'F for that slot',
    'bulk god',
    'nature is healing',
  ])
}

// Donation flavor — viewers tip when the stream delivers.
function donationFor(name: string, value: number): { amount: number; who: string; text: string } {
  if (value >= 100)
    return { amount: round2(5 + Math.random() * 10), who: 'anonymous tip', text: `for the ${name}. INSANE pull.` }
  if (value >= 30)
    return { amount: round2(2 + Math.random() * 5), who: 'anonymous tip', text: `the ${name} made my week` }
  return { amount: round2(1 + Math.random() * 2), who: 'anonymous tip', text: 'great stream as always' }
}

export type StreamRip = {
  cards: { cardId: string; name: string; value: number; isHit: boolean; variant: string }[]
  viewers: number
  viewerDelta: number
  sponsored: boolean
  chat: StreamChatLine[]
  donations: { amount: number; who: string; text: string }[]
  donationsTotal: number
  packsOpened: number
  packsPlanned: number
  streamDone: boolean
  newBest: { name: string; value: number } | null
}

export function ripOnStream(): { ok: false; error: string } | ({ ok: true } & StreamRip) {
  const st = liveStream()
  if (!st) return { ok: false, error: 'Not live' }
  if (st.packs_opened >= st.packs_planned) return { ok: false, error: 'Stream queue is empty — wrap it up' }
  // A break stream rips through the break engine, not the house-keep path.
  const liveBreak = db.prepare(`SELECT id FROM stream_breaks WHERE stream_id = ? AND status = 'selling'`).get(st.id)
  if (liveBreak) return { ok: false, error: 'This is a break stream — rip with the break button, the spots own the pulls' }

  const sessionId = `stream_${st.id}_${Date.now()}`
  const cards: RipCard[] = rollPack(st.set_id, sessionId) ?? []
  if (cards.length === 0) return { ok: false, error: 'Pull engine returned nothing for this set' }

  // The cards are yours to keep — straight into the collection, ghosts included.
  // Cost basis is the stream's per-pack price split across the rip.
  const perCardCost = round2(st.price / Math.max(1, cards.length))
  const addInv = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
     VALUES (?, ?, 'NM', 1, 'collection', 'stream', ?, ?)`,
  )
  for (const c of cards) addInv.run(c.cardId, c.variant || 'normal', perCardCost, nowIso())

  const prevBest = st.best_card_value ?? 0
  const packBest = cards.reduce((m, c) => (c.value > m.value ? c : m), cards[0])
  const newBest = packBest.value > prevBest ? { name: cardName(packBest.cardId), value: packBest.value } : null

  // Viewership: grows on big pulls, leaks on bulk. Floor of 2.
  // Sponsored stream: the brand shills in chat and pays to boost the clip —
  // gains are +50%, bulk bleed is halved.
  const sponsor = sponsorForKind(st.kind)
  let viewers = st.peak_viewers
  const perPackValue = cards.reduce((a, c) => a + c.value, 0)
  let viewerDelta = 0
  if (perPackValue >= 25) viewerDelta = Math.max(1, Math.round(viewers * (0.06 + Math.random() * 0.1)))
  else if (perPackValue >= 8) viewerDelta = Math.round(Math.random() * Math.max(1, viewers * 0.04))
  else viewerDelta = -Math.round(Math.random() * Math.max(0, viewers * 0.05))
  if (sponsor) {
    viewerDelta = viewerDelta >= 0 ? Math.round(viewerDelta * 1.5) : Math.round(viewerDelta / 2)
  }
  viewers = Math.max(2, viewers + viewerDelta)

  const pool = handlesFor(st.id)
  const chat: StreamChatLine[] = []
  let at = st.packs_opened * 100
  for (const c of cards) {
    if (Math.random() < 0.45) {
      chat.push({ at, who: pick(pool), avatar: pick(VIEWER_AVATARS), text: chatFor(cardName(c.cardId), c.value) })
    }
    at += 1
  }
  if (viewerDelta >= 2) chat.push({ at, who: 'STREAM', avatar: '📣', text: `${viewers} watching — the room is GROWING${sponsor ? ' — sponsor push working' : ''}` })
  if (sponsor && Math.random() < 0.35) {
    chat.push({ at: at + 1, who: pick(pool), avatar: pick(VIEWER_AVATARS), text: pick([
      `wait this stream is ${sponsor.brand} sponsored? based`,
      `came here from the ${sponsor.brand} promo, staying for the hits`,
      `${sponsor.brand} ad between packs is actually fire ngl`,
    ]) })
  }

  // Donations land on the pack's best card if it's tip-worthy.
  const donations: { amount: number; who: string; text: string }[] = []
  let donationsTotal = 0
  if (packBest.value >= 30) {
    const d = donationFor(cardName(packBest.cardId), packBest.value)
    donations.push(d)
    donationsTotal = d.amount
    chat.push({ at: at + 1, who: d.who, avatar: '💰', text: `tipped $${d.amount.toFixed(2)} — ${d.text}` })
  }

  const bestName = newBest ? cardName(packBest.cardId) : st.best_card_name
  const bestId = newBest ? packBest.cardId : st.best_card_id
  const bestValue = newBest ? packBest.value : st.best_card_value
  db.prepare(
    `UPDATE streams SET packs_opened = packs_opened + 1, peak_viewers = ?, donations_total = donations_total + ?, chat_lines = chat_lines + ?, best_card_id = ?, best_card_name = ?, best_card_value = ? WHERE id = ?`,
  ).run(viewers, donationsTotal, chat.length, bestId, bestName, bestValue, st.id)

  return {
    ok: true,
    cards: cards.map((c) => ({ cardId: c.cardId, name: cardName(c.cardId), value: c.value, isHit: c.isHit, variant: c.variant || 'normal' })),
    viewers,
    viewerDelta,
    sponsored: !!sponsor,
    chat,
    donations,
    donationsTotal,
    packsOpened: st.packs_opened + 1,
    packsPlanned: st.packs_planned,
    streamDone: st.packs_opened + 1 >= st.packs_planned,
    newBest,
  }
}

export function endStream() {
  const st = liveStream()
  if (!st) return { ok: false as const, error: 'Not live' }
  const s = stats()
  const packs = st.packs_opened
  let followersGain = Math.max(1, Math.round(packs * (0.8 + Math.random() * 1.2) + (st.peak_viewers > 10 ? 3 : 0)))

  // A live break settles with the stream: house keeps unsold-spot pulls,
  // sold spots were already paid at claim time, and the crowd swells the
  // follower gain (breaks are the channel's best growth content).
  const breakSettled = settleBreakFor(st.id)
  if (breakSettled) {
    followersGain += Math.max(2, Math.round(breakSettled.spotsSold * (0.6 + Math.random() * 0.8)))
  }

  // Sponsor settlement rides the stream's actual product kind + pack count.
  const sponsor = settleStream(st.kind, packs, s.followers)
  const followersGainTotal = followersGain + (sponsor?.followerBonus ?? 0)
  const newFollowers = s.followers + followersGainTotal

  // Migration: followers_gain column (added for channel analytics).
  try { db.prepare(`ALTER TABLE streams ADD COLUMN followers_gain INTEGER`).run() } catch { /* exists */ }

  const streamBest = st.best_card_value ?? 0
  const channelBest = s.best_card_value ?? 0
  const bestName = streamBest > channelBest ? st.best_card_name : s.best_card_name
  const bestValue = streamBest > channelBest ? streamBest : channelBest

  db.prepare(
    `UPDATE stream_stats SET followers = ?, total_streams = total_streams + 1, total_packs = total_packs + ?, total_donations = total_donations + ?, best_card_name = ?, best_card_value = ? WHERE id = 1`,
  ).run(newFollowers, packs, st.donations_total, bestName, bestValue)

  // A lot still on camera when you wrap goes back to the binder untouched.
  returnOpenLots(st.id)
  const sales = streamLotsFor(st.id).totals

  db.prepare(`UPDATE streams SET status = 'ended', ended_at = ?, followers_gain = ? WHERE id = ?`).run(nowIso(), followersGainTotal, st.id)
  viewerHandles.delete(st.id)

  logActivity(
    'stream',
    `Stream ended — ${packs} packs opened, peak ${st.peak_viewers} viewers, $${st.donations_total.toFixed(2)} in tips, +${followersGainTotal} followers.`,
    st.donations_total || undefined,
  )
  if (st.donations_total > 0) {
    db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(round2(st.donations_total))
  }

  // Sponsors slide in right after the numbers are public.
  maybeGenerateOffer()

  return {
    ok: true as const,
    followersGain: followersGainTotal,
    followers: newFollowers,
    packs,
    sales,
    peakViewers: st.peak_viewers,
    donationsTotal: round2(st.donations_total),
    best: st.best_card_name ? { name: st.best_card_name, value: st.best_card_value ?? 0 } : null,
    sponsor: sponsor
      ? {
          brand: sponsor.brand,
          packs: sponsor.packs,
          payout: sponsor.payout,
          completed: sponsor.completed,
          followerBonus: sponsor.followerBonus,
          remaining: sponsor.remaining,
        }
      : null,
    break: breakSettled,
  }
}

// ---------------------------------------------------------------------------
// SELLING ON STREAM — the other half of a live channel. Ripping is the show;
// selling is the business, and the business is not guaranteed. You put one card
// on the block at a time, the room bids what it thinks the card is worth, and a
// lot that never reaches your reserve comes back to the binder untouched. Sales
// pay out minus the platform's cut, the same way every live-selling app takes
// one. Audience size is the only lever you control: a dead room has a low
// ceiling, so a thin crowd means unsold lots, not free money.
// ---------------------------------------------------------------------------

db.exec(`
CREATE TABLE IF NOT EXISTS stream_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_id INTEGER NOT NULL,
  inventory_id INTEGER,                 -- the escrowed copy; null once sold
  card_id TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT 'normal',
  start_price REAL NOT NULL,
  reserve REAL NOT NULL,
  current_bid REAL,
  bids INTEGER NOT NULL DEFAULT 0,
  ceiling REAL,                         -- hidden top of the room's interest
  status TEXT NOT NULL DEFAULT 'live',  -- live | sold | passed
  sold_price REAL,
  winner TEXT,
  chat TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  ends_at TEXT NOT NULL
)`)

const LOT_FEE = 0.08            // the platform's cut on a streamed sale
const LOT_MS = 75_000           // a lot gets a little over a minute on camera
const LOT_BID_EVERY_MS = 6_000

const BIDDER_HANDLES = ['slabseeker', 'wagie_gradr', 'holo_hannah', 'dextright', 'packripper88', 'vintageVick', 'dexhole', 'packsbyanna', 'moonbreon_mia', 'binderbee']

type LotRow = {
  id: number; stream_id: number; inventory_id: number | null; card_id: string; variant: string
  start_price: number; reserve: number; current_bid: number | null; bids: number; ceiling: number | null
  status: string; sold_price: number | null; winner: string | null; chat: string; created_at: string; ends_at: string
}

function pushLotChat(lotId: number, lines: { who: string; avatar: string; text: string }[]): void {
  const row = db.prepare('SELECT chat FROM stream_lots WHERE id = ?').get(lotId) as { chat: string } | undefined
  if (!row) return
  const arr = JSON.parse(row.chat) as { at: number; who: string; avatar: string; text: string }[]
  const at = Date.now()
  for (const l of lines) arr.push({ at, who: l.who, avatar: l.avatar ?? '💬', text: l.text })
  while (arr.length > 40) arr.shift()
  db.prepare('UPDATE stream_lots SET chat = ? WHERE id = ?').run(JSON.stringify(arr), lotId)
}

function lotView(l: LotRow) {
  const name = cardName(l.card_id)
  const image = (db.prepare('SELECT image_small FROM cards WHERE id = ?').get(l.card_id) as { image_small: string | null } | undefined)?.image_small ?? null
  const net = l.status === 'sold' ? round2((l.sold_price ?? 0) * (1 - LOT_FEE)) : 0
  return {
    id: l.id,
    cardId: l.card_id,
    variant: l.variant,
    name,
    image,
    market: round2(valueOf(l.card_id, l.variant)),
    start: l.start_price,
    reserve: l.reserve,
    currentBid: l.current_bid,
    bids: l.bids,
    status: l.status,
    soldPrice: l.sold_price,
    net,
    fee: l.status === 'sold' ? round2((l.sold_price ?? 0) * LOT_FEE) : 0,
    winner: l.winner,
    endsAt: l.ends_at,
    chat: JSON.parse(l.chat) as { at: number; who: string; avatar: string; text: string }[],
  }
}

/** Cards in the binder you could put up tonight, dearest first. */
export function sellableCards(limit = 12) {
  const rows = db
    .prepare(
      `SELECT i.id, i.card_id, i.variant, i.quantity, c.name, c.image_small, c.rarity, c.set_id
       FROM inventory i JOIN cards c ON c.id = i.card_id
       WHERE i.status = 'collection' AND i.graded_grade IS NULL AND i.quantity > 0
       ORDER BY i.id DESC LIMIT 300`,
    )
    .all() as { id: number; card_id: string; variant: string; quantity: number; name: string; image_small: string | null; rarity: string | null; set_id: string }[]
  return rows
    .map((r) => ({ ...r, id: r.id, cardId: r.card_id, name: r.name, image: r.image_small, market: round2(valueOf(r.card_id, r.variant)) }))
    .sort((a, b) => b.market - a.market)
    .slice(0, limit)
}

export function streamLotsFor(streamId: number) {
  const live = db.prepare(`SELECT * FROM stream_lots WHERE stream_id = ? AND status = 'live' ORDER BY id DESC LIMIT 1`).get(streamId) as LotRow | undefined
  const recent = db.prepare(`SELECT * FROM stream_lots WHERE stream_id = ? AND status != 'live' ORDER BY id DESC LIMIT 6`).all(streamId) as LotRow[]
  const row = db
    .prepare(
      `SELECT COUNT(*) AS listed,
              SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) AS sold,
              SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) AS unsold,
              COALESCE(SUM(CASE WHEN status = 'sold' THEN sold_price ELSE 0 END), 0) AS gross,
              COALESCE(SUM(CASE WHEN status = 'sold' THEN sold_price * ? ELSE 0 END), 0) AS fees
       FROM stream_lots WHERE stream_id = ?`,
    )
    .get(LOT_FEE, streamId) as { listed: number; sold: number | null; unsold: number | null; gross: number; fees: number }
  const sold = row.sold ?? 0
  const unsold = row.unsold ?? 0
  return {
    live: live ? lotView(live) : null,
    recent: recent.map(lotView),
    totals: {
      listed: row.listed,
      sold,
      unsold,
      gross: round2(row.gross),
      fees: round2(row.fees),
      net: round2(row.gross - row.fees),
      sellThrough: row.listed > 0 ? Math.round((sold / row.listed) * 100) : 0,
      feePct: Math.round(LOT_FEE * 100),
    },
  }
}

export function listStreamLot(inventoryId: number, startPrice?: number | null, reserve?: number | null) {
  const st = liveStream()
  if (!st) return { ok: false as const, error: 'Go live first — a lot needs a room.' }
  const openLot = db.prepare(`SELECT id FROM stream_lots WHERE stream_id = ? AND status = 'live'`).get(st.id)
  if (openLot) return { ok: false as const, error: 'One thing at a time — hammer the card on camera first.' }
  const inv = db
    .prepare(`SELECT id, card_id, variant, quantity, cost_basis FROM inventory WHERE id = ? AND status = 'collection' AND graded_grade IS NULL`)
    .get(inventoryId) as { id: number; card_id: string; variant: string; quantity: number; cost_basis: number } | undefined
  if (!inv) return { ok: false as const, error: 'That card is not free to sell — it is listed, graded or already escrowed.' }
  const market = round2(valueOf(inv.card_id, inv.variant))
  const start = round2(Math.max(0.99, startPrice && startPrice > 0 ? startPrice : market * 0.3))
  const reserveWanted = reserve && reserve > 0 ? reserve : market * 0.65
  const floor = round2(Math.max(start, reserveWanted))

  // Escrow exactly one copy: the lot must be able to come back untouched.
  let escrowId = inv.id
  const tx = db.transaction(() => {
    if (inv.quantity > 1) {
      db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(inv.id)
      const info = db
        .prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at) VALUES (?, ?, 'NM', 1, 'escrowed', 'stream_sale', ?, ?)`)
        .run(inv.card_id, inv.variant, inv.cost_basis, nowIso())
      escrowId = Number(info.lastInsertRowid)
    } else {
      db.prepare(`UPDATE inventory SET status = 'escrowed' WHERE id = ?`).run(inv.id)
    }
  })
  tx()

  // The room's interest is not your reserve. A big room chases close to market;
  // a thin one stalls well under it, which is exactly how a real lot passes.
  const heat = 0.35 + Math.random() * 0.6 + Math.min(0.35, st.peak_viewers / 900)
  const ceiling = round2(market * heat)
  const info = db
    .prepare(
      `INSERT INTO stream_lots (stream_id, inventory_id, card_id, variant, start_price, reserve, ceiling, created_at, ends_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(st.id, escrowId, inv.card_id, inv.variant, start, floor, ceiling, nowIso(), new Date(Date.now() + LOT_MS).toISOString())
  const lotId = Number(info.lastInsertRowid)
  pushLotChat(lotId, [
    { who: 'STREAM', avatar: '📣', text: `${cardName(inv.card_id)} is ON CAMERA — opens at $${start.toFixed(2)}, reserve $${floor.toFixed(2)}` },
  ])
  logActivity('stream', `Went on the block: ${cardName(inv.card_id)} — opens $${start.toFixed(2)}, reserve $${floor.toFixed(2)}.`)
  return { ok: true as const, lot: lotView(db.prepare('SELECT * FROM stream_lots WHERE id = ?').get(lotId) as LotRow), market, ceiling }
}

/** Hammer one lot: sold if the room reached the reserve, otherwise it goes home. */
function settleLot(l: LotRow): void {
  const name = cardName(l.card_id)
  const bid = l.current_bid ?? 0
  const reached = l.bids > 0 && bid >= l.reserve
  if (reached) {
    const net = round2(bid * (1 - LOT_FEE))
    const fee = round2(bid * LOT_FEE)
    const tx = db.transaction(() => {
      if (l.inventory_id) db.prepare('DELETE FROM inventory WHERE id = ?').run(l.inventory_id)
      db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(net)
      db.prepare(`UPDATE stream_lots SET status = 'sold', sold_price = ?, winner = ? WHERE id = ?`).run(bid, 'the room', l.id)
    })
    tx()
    pushLotChat(l.id, [{ who: 'STREAM', avatar: '🔨', text: `SOLD — ${name} at $${bid.toFixed(2)} to ${pick(BIDDER_HANDLES)}. You keep $${net.toFixed(2)} after the $${fee.toFixed(2)} fee.` }])
    logActivity('stream', `Sold ${name} on stream for $${bid.toFixed(2)} — $${net.toFixed(2)} after fees.`, net)
    return
  }
  // No sale. The copy goes back to the binder exactly as it left it.
  const tx = db.transaction(() => {
    if (l.inventory_id) db.prepare(`UPDATE inventory SET status = 'collection' WHERE id = ?`).run(l.inventory_id)
    db.prepare(`UPDATE stream_lots SET status = 'passed' WHERE id = ?`).run(l.id)
  })
  tx()
  const why = l.bids === 0 ? 'nobody opened it' : `the room stopped at $${bid.toFixed(2)}`
  pushLotChat(l.id, [{ who: 'STREAM', avatar: '🚫', text: `NO SALE — ${name} went back to the binder: ${why}, under your $${l.reserve.toFixed(2)} reserve.` }])
  logActivity('stream', `No sale on ${name} — ${why}, under the $${l.reserve.toFixed(2)} reserve. Card returned.`)
}

/** 2.5s heartbeat: the room raises, the hammer falls. */
export function streamLotTick(): void {
  const st = liveStream()
  if (!st) return
  const lots = db.prepare(`SELECT * FROM stream_lots WHERE stream_id = ? AND status = 'live'`).all(st.id) as LotRow[]
  for (const l of lots) {
    const now = Date.now()
    const ends = new Date(l.ends_at).getTime()
    if (now >= ends) { settleLot(l); continue }
    // The room needs a beat to see the card before anyone opens it.
    if (now - new Date(l.created_at).getTime() < LOT_BID_EVERY_MS) continue
    if (Math.random() > 0.55) continue
    const target = l.ceiling ?? l.start_price
    const bid = l.current_bid ?? 0
    if (bid >= target) continue // the room is at its ceiling; it just watches now
    // Bidding is not linear: a cold lot sits on one low bid, a contested one
    // climbs fast toward whatever the room is actually willing to pay.
    const next =
      bid === 0
        ? round2(l.start_price)
        : round2(Math.min(target, bid + Math.max(1, (target - bid) * (0.25 + Math.random() * 0.4))))
    db.prepare('UPDATE stream_lots SET current_bid = ?, bids = bids + 1 WHERE id = ?').run(next, l.id)
    if (Math.random() < 0.45) pushLotChat(l.id, [{ who: pick(BIDDER_HANDLES), avatar: pick(VIEWER_AVATARS), text: pick([`$${next.toFixed(2)}`, `I'm in at $${next.toFixed(2)}`, `$${next.toFixed(2)} — that's my ceiling`, `let me have it at $${next.toFixed(2)}`]) }])
  }
}

/** Every live lot returns to the binder when the stream ends. */
function returnOpenLots(streamId: number): void {
  const lots = db.prepare(`SELECT * FROM stream_lots WHERE stream_id = ? AND status = 'live'`).all(streamId) as LotRow[]
  const tx = db.transaction(() => {
    for (const l of lots) {
      if (l.inventory_id) db.prepare(`UPDATE inventory SET status = 'collection' WHERE id = ?`).run(l.inventory_id)
      db.prepare(`UPDATE stream_lots SET status = 'passed' WHERE id = ?`).run(l.id)
    }
  })
  tx()
}

// ---------------------------- Channel analytics ----------------------------

export function ensureFollowersGainColumn() {
  try { db.prepare(`ALTER TABLE streams ADD COLUMN followers_gain INTEGER`).run() } catch { /* exists */ }
}

/**
 * Backfill followers_gain for streams ended before analytics existed.
 * Honest source: the end-of-stream activity line's "+N followers" suffix.
 */
export function backfillFollowersGain() {
  ensureFollowersGainColumn()
  const rows = db
    .prepare(
      `SELECT s.id, s.started_at,
              (SELECT MIN(s2.started_at) FROM streams s2 WHERE s2.id > s.id) AS next_start
       FROM streams s WHERE s.status = 'ended' AND s.followers_gain IS NULL`,
    )
    .all() as { id: number; started_at: string; next_start: string | null }[]
  if (rows.length === 0) return
  const upd = db.prepare(`UPDATE streams SET followers_gain = ? WHERE id = ?`)
  for (const r of rows) {
    // The stream's own end line is the earliest 'Stream ended' entry between
    // its start and the next stream's start.
    const line = r.next_start
      ? (db
          .prepare(`SELECT message FROM activity_log WHERE kind = 'stream' AND message LIKE 'Stream ended —%' AND created_at >= ? AND created_at < ? ORDER BY created_at ASC LIMIT 1`)
          .get(r.started_at, r.next_start) as { message: string } | undefined)
      : (db
          .prepare(`SELECT message FROM activity_log WHERE kind = 'stream' AND message LIKE 'Stream ended —%' AND created_at >= ? ORDER BY created_at ASC LIMIT 1`)
          .get(r.started_at) as { message: string } | undefined)
    const m = line?.message.match(/\+(\d+) followers\.?$/)
    upd.run(m ? Number(m[1]) : 0, r.id)
  }
}

export type ProductGrowth = {
  product: string
  kind: string
  streams: number
  packs: number
  avgPeak: number
  followersPerPack: number
  totalFollowers: number
}

export function streamAnalytics() {
  ensureFollowersGainColumn()
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(followers_gain), 0) AS followers, COALESCE(AVG(peak_viewers), 0) AS avg_peak,
              COUNT(*) AS streams, COALESCE(SUM(packs_opened), 0) AS packs
       FROM streams WHERE status = 'ended'`,
    )
    .get() as { followers: number; avg_peak: number; streams: number; packs: number }

  const byProduct = db
    .prepare(
      `SELECT product_name AS product, kind,
              COUNT(*) AS streams, SUM(packs_opened) AS packs,
              AVG(peak_viewers) AS avg_peak, SUM(followers_gain) AS total_followers
       FROM streams WHERE status = 'ended'
       GROUP BY product_name, kind`,
    )
    .all() as { product: string; kind: string; streams: number; packs: number; avg_peak: number; total_followers: number | null }[]

  const ranking: ProductGrowth[] = byProduct
    .map((r) => ({
      product: r.product,
      kind: r.kind,
      streams: r.streams,
      packs: r.packs,
      avgPeak: Math.round(r.avg_peak * 10) / 10,
      followersPerPack: r.packs > 0 ? Math.round(((r.total_followers ?? 0) / r.packs) * 1000) / 1000 : 0,
      totalFollowers: r.total_followers ?? 0,
    }))
    .sort((a, b) => b.followersPerPack - a.followersPerPack)

  const history = db
    .prepare(`SELECT id, product_name AS product, peak_viewers AS peak, followers_gain AS gain, packs_opened AS packs, started_at AS at FROM streams WHERE status = 'ended' ORDER BY id DESC LIMIT 20`)
    .all() as { id: number; product: string; peak: number; gain: number | null; packs: number; at: string }[]

  return {
    totals: {
      streams: totals.streams,
      packs: totals.packs,
      followersGained: totals.followers,
      followersPerStream: totals.streams > 0 ? Math.round((totals.followers / totals.streams) * 10) / 10 : 0,
      avgPeak: Math.round(totals.avg_peak * 10) / 10,
    },
    ranking,
    history,
  }
}

export function streamHistory() {
  const rows = db
    .prepare(`SELECT * FROM streams WHERE status = 'ended' ORDER BY id DESC LIMIT 15`)
    .all() as LiveRow[]
  return rows.map((r) => ({
    id: r.id,
    product: r.product_name,
    packsOpened: r.packs_opened,
    peakViewers: r.peak_viewers,
    donationsTotal: r.donations_total,
    best: r.best_card_name ? { name: r.best_card_name, value: r.best_card_value ?? 0 } : null,
    startedAt: r.started_at,
  }))
}

export function listStreamProducts() {
  return listBattlableProducts()
}

// Boot-time safety: if the process died mid-stream, quietly archive it.
// Donations earned before the crash are still paid out — chat saw them happen.
export function recoverOrphanStreams() {
  const st = liveStream()
  if (st) {
    returnOpenLots(st.id)
    if (st.donations_total > 0) {
      db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(round2(st.donations_total))
    }
    db.prepare(`UPDATE streams SET status = 'ended', ended_at = ? WHERE id = ?`).run(nowIso(), st.id)
  }
}
