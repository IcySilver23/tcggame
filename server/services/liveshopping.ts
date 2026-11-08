import { db, nowIso, logActivity } from '../lib/db'
import { round2, valueOf } from './market'
import { rollPack } from './packs'
import { priceOf as sealedPriceOf, sellsOwnPacks } from './sealed'
import { nowMs } from './schedule'
import { VIEWER_AVATARS, cardName } from './streaming'
import { walkInMultiplier } from './seasonal'

/** "Mega Darkrai ex" → "Darkrai" — spots are named for the species, not the printing. */
function baseSpecies(name: string): string {
  return name.replace(/^Mega\s+/i, '').replace(/\s+ex$/i, '').trim()
}

// ---------------------------------------------------------------------------
// NPC LIVE SHOPPING — the Whatnot wing of the scene. The sellers you've been
// out-hustling all game went live: hosts open scheduled channels on the event
// calendar, rip real sealed product on camera, and move every card across one
// of three rails:
//
//   • BUY-IT-NOW DROPS   a card flashes on screen at a fixed ask — underpriced
//                        ones vanish in seconds to faster thumbs (a hidden
//                        fuse), overpriced ones linger like a yard-sale dusty
//   • RAPID AUCTIONS     2–4 minute lots with the rolling hammer: any bid in
//                        the final 15 seconds resets the clock, the classic
//                        Whatnot war — and NPC viewers bid with their own
//                        ceilings until the gavel
//   • MYSTERY RIP BIDS   a flat-price pile of unopened cards; pay and the
//                        reveal is yours, gems or junk — the host's integrity
//                        decides the ratio
//
// Every price anchors to the real market (valueOf), purchases land in the
// binder with "won on [host]'s show" provenance, and hosts have honest
// personalities: some shill (ceiling over market, mystery boxes full of
// bulk), some run fair rooms, and the generous ones occasionally misprice —
// camping the right channel is a real skill. Shows ride the same weekly
// calendar as conventions and tournaments (Friday night + Sunday matinee
// slots), so the scene's sellers have a pulse you can plan around.
// ---------------------------------------------------------------------------

// Migration: live shopping (existing DBs predate the tables).
db.exec(`
CREATE TABLE IF NOT EXISTS live_hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL,
  style TEXT NOT NULL,               -- rip | auction | mystery | sudden | teambreak | ripship
  integrity REAL NOT NULL,           -- 0 = shill … 1 = generous saint
  price_bias REAL NOT NULL,          -- BIN ask multiplier around market
  followers INTEGER NOT NULL DEFAULT 0,
  rating REAL NOT NULL DEFAULT 4.2,  -- seller stars the scene gives them
  slot TEXT NOT NULL                 -- fri | sun calendar slot
)`)
// Rebuild the roster when a deploy changes the host lineup (style column).
// Only the truly-removed style counts as legacy — 'auction'/'mystery' exist
// in the current lineup too, and matching them would wipe the roster (and
// every host's follower/rating drift) on every module load.
{
  const cols = (db.prepare(`PRAGMA table_info(live_hosts)`).all() as { name: string }[]).map((c) => c.name)
  if (cols.includes('style')) {
    // v0.5.43: SlabDaddyDee's room became a dedicated mystery-box channel —
    // match on the host+old-style pair so the rebuild fires exactly once
    // ('auction' alone would also match TheVintageVault and wipe the roster
    // on every load; the pair stops matching after the rebuild flips the style).
    const legacy = db.prepare(`SELECT COUNT(*) AS n FROM live_hosts WHERE style = 'rip' OR (style = 'auction' AND name = 'SlabDaddyDee')`).get() as { n: number }
    if (legacy.n > 0) {
      // Children first — foreign keys are ON and the legacy shows reference
      // the roster being deleted.
      db.exec('DELETE FROM live_team_spots')
      db.exec('DELETE FROM live_items')
      db.exec('DELETE FROM live_shows')
      db.exec('DELETE FROM live_hosts')
    }
  }
}
db.exec(`
CREATE TABLE IF NOT EXISTS live_shows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES live_hosts(id),
  status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | live | done
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_cost REAL NOT NULL,
  rips_done INTEGER NOT NULL DEFAULT 0,
  rips_planned INTEGER NOT NULL DEFAULT 0,
  peak_viewers INTEGER NOT NULL DEFAULT 0,
  chat TEXT NOT NULL DEFAULT '[]',
  last_rip_at TEXT,
  last_npc_bid_at TEXT,
  proceeds REAL NOT NULL DEFAULT 0,   -- player money taken in (host's gross)
  best_card_id TEXT, best_card_name TEXT, best_card_value REAL
)`)
db.exec(`
CREATE TABLE IF NOT EXISTS live_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id INTEGER NOT NULL REFERENCES live_shows(id),
  kind TEXT NOT NULL,                -- drop | auction | mystery | sudden | teamspot | ripship
  card_id TEXT REFERENCES cards(id),
  variant TEXT NOT NULL DEFAULT 'normal',
  qty INTEGER NOT NULL DEFAULT 1,
  bin_price REAL,                    -- drop ask
  ask REAL,                          -- auction start / mystery ask / SD flat price / RIOS keep ask
  contents_ev REAL,                  -- mystery: hidden EV of the pile
  contents TEXT,                     -- mystery: JSON, hidden until reveal
  current_bid REAL,
  player_bid REAL,
  bids INTEGER NOT NULL DEFAULT 0,
  npc_ceiling REAL,                  -- hidden top of the NPC war
  ends_at TEXT,
  extended INTEGER NOT NULL DEFAULT 0,
  npc_fuse_s INTEGER,                -- drop: NPC thumbs beat you after N seconds
  status TEXT NOT NULL DEFAULT 'open',  -- open | sold | passed
  winner TEXT,                       -- 'you' | npc label
  created_at TEXT NOT NULL
)`)
// teamspot payload (v2): the break's roster board + who holds which species.
db.exec(`
CREATE TABLE IF NOT EXISTS live_team_spots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES live_items(id),
  team TEXT NOT NULL,
  team_dex INTEGER,
  holder TEXT NOT NULL,              -- 'you' | npc handle
  ask REAL NOT NULL,
  claimed_at TEXT NOT NULL
)`)
// v3 — RIP IT OR SHIP IT is a sealed-pack auction: the room bids on the
// product, and the winner chooses rip-on-stream or take-it-home. Lots carry
// their pack product; player-won lots park in 'pending' until the choice.
{
  const cols = (db.prepare('PRAGMA table_info(live_items)').all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('product_id')) db.exec('ALTER TABLE live_items ADD COLUMN product_id TEXT')
  if (!cols.includes('ship_choice')) db.exec("ALTER TABLE live_items ADD COLUMN ship_choice TEXT")  // rip | ship (set on player choice)
}

export const TERMS = {
  ripIntervalMs: 90_000,         // one rip every ~90s of live air (7 channels × constant rips = a busy platform)
  dropFuseUnder: [4, 75] as [number, number],   // seconds before faster thumbs take an underpriced drop
  dropLifeMs: 15 * 60_000,       // unsold overpriced drops linger 15 min, then pass
  auctionMs: [2, 4] as [number, number],        // auction lot lifetime
  extensionMs: 15_000,           // the rolling hammer
  extensionMax: 12,              // …but wars have to end
  npcBidEveryMs: 45_000,         // NPC war tempo
  npcBidChance: 0.65,
  minIncrement: 1,
  viewersBase: 90,
  hitViewerBump: 340,
  sdLotS: [6, 10] as [number, number],   // $1 sudden-death lot: 6–10s, the timer NEVER extends
  sdGapS: 8,                     // stagger between lots — one card on screen at a time
  sdPrice: 1,                    // the whole gimmick
  riosThinkMs: 75_000,           // how long you get to decide rip-or-ship
  riosNpcStealS: [20, 55] as [number, number],     // NPC takers hover before pouncing
  riosAuctionMs: [90_000, 150_000] as [number, number], // pack-auction lot lifetime
}

// The roster — fixed faces, persistent followers/ratings. Integrity steers
// everything: shills ask 1.2× market, run mystery boxes at 0.6 of contents,
// and drum auctions to 1.25×; saints underprice, fill boxes honestly, and
// let grails go at a discount.
const HOST_POOL = [
  { name: 'DollarDuke',      avatar: '💰', style: 'sudden',     integrity: 0.70, price_bias: 1.05, followers: 9600, rating: 4.1, slot: 'fri' },
  { name: 'BreakMasterBex',  avatar: '🧩', style: 'teambreak',  integrity: 0.80, price_bias: 1.00, followers: 7300, rating: 4.3, slot: 'fri' },
  { name: 'ShipItOrZipIt',   avatar: '🚚', style: 'ripship',    integrity: 0.55, price_bias: 1.18, followers: 5400, rating: 3.7, slot: 'fri' },
  { name: 'SlabDaddyDee',    avatar: '🕶',  style: 'mystery',    integrity: 0.75, price_bias: 1.02, followers: 8100, rating: 4.4, slot: 'sun' },
  { name: 'BuckRipBenny',    avatar: '💵', style: 'sudden',     integrity: 0.60, price_bias: 1.12, followers: 6200, rating: 3.9, slot: 'sun' },
  { name: 'TeamBreakTalia',  avatar: '🎲', style: 'teambreak',  integrity: 0.85, price_bias: 0.97, followers: 4700, rating: 4.6, slot: 'sun' },
  { name: 'TheVintageVault', avatar: '🏛',  style: 'auction',    integrity: 0.90, price_bias: 1.14, followers: 12400, rating: 4.7, slot: 'sun' },
]

function ensureHosts(): void {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM live_hosts').get() as { n: number }).n
  if (n > 0) return
  const ins = db.prepare('INSERT INTO live_hosts (name, avatar, style, integrity, price_bias, followers, rating, slot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  for (const h of HOST_POOL) ins.run(h.name, h.avatar, h.style, h.integrity, h.price_bias, h.followers, h.rating, h.slot)
}

function host(id: number) {
  return db.prepare('SELECT * FROM live_hosts WHERE id = ?').get(id) as
    | { id: number; name: string; avatar: string; style: string; integrity: number; price_bias: number; followers: number; rating: number; slot: string }
    | undefined
}

// ---------------------------------------------------------------------------
// Calendar slots — Friday night + Sunday matinee, rotating hosts weekly.
// Anchored to the same Monday-anchored week the event calendar uses.
// ---------------------------------------------------------------------------

const SLOTS: { slot: 'fri' | 'sun'; day: number; hour: number; durationH: number; title: string; blurb: string }[] = [
  { slot: 'fri', day: 5, hour: 18, durationH: 3, title: 'Friday Night Live Rips', blurb: "The scene's sellers go live — drops flash, hammers roll, boxes open on camera." },
  { slot: 'sun', day: 0, hour: 13, durationH: 3, title: 'Sunday Matinee Streams', blurb: 'Weekend rip streams and grail auctions while the driveways are still open.' },
]

// ALWAYS-ON WING: the scene's sellers run real channels now — every host is
// live at once, all week, like the platform this parodies. The old Friday /
// Sunday windows live on only as flavor in the slot field.

function weekStartOf(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d
}

function slotWindow(slot: (typeof SLOTS)[number], weekStart: Date): { start: Date; end: Date } {
  const start = new Date(weekStart)
  start.setUTCDate(start.getUTCDate() + ((slot.day + 6) % 7))
  start.setUTCHours(slot.hour, 0, 0, 0)
  return { start, end: new Date(start.getTime() + slot.durationH * 3600_000) }
}

/** Which live-shopping slot is open right now (schedule.nowMs respects the debug clock). */
function openSlot(): (typeof SLOTS)[number] | null {
  const now = nowMs()
  const weekStart = weekStartOf(new Date(now))
  for (const slot of SLOTS) {
    const { start, end } = slotWindow(slot, weekStart)
    if (now >= start.getTime() && now < end.getTime()) return slot
  }
  return null
}

// ---------------------------------------------------------------------------
// Product + card safety — a show only goes live if its rip pool is real.
// ---------------------------------------------------------------------------

/** Each channel rips its OWN product, like real channels: the $1 rooms run
 *  the cheapest booster on the shelf (a buck a card has to make sense), the
 *  vintage auction room rips the most expensive thing it can move, and the
 *  break / RIOS / mystery rooms take a mid-tier modern product. */
function showProductFor(h: { style: string }): { id: string; name: string; cost: number; setId: string } {
  const rows = db.prepare(
    `SELECT p.id, p.name, p.set_id, p.msrp FROM pack_products p
     WHERE EXISTS (SELECT 1 FROM pack_product_cards ppc WHERE ppc.pack_product_id = p.id)
     ORDER BY COALESCE(p.msrp, 999) ASC`,
  ).all() as { id: string; name: string; set_id: string; msrp: number | null }[]
  // A show cannot rip a subset-only set: there is no honest pack to deal.
  const sold = rows.filter((r) => sellsOwnPacks(r.set_id))
  if (sold.length === 0) throw new Error('no-seed-product')
  // $1 rooms rotate between the two cheapest; the auction room takes the
  // priciest (vintage msrps sort last); everyone else lands mid-tier.
  const idx = h.style === 'sudden'
    ? Math.floor(Math.random() * Math.min(2, sold.length))
    : h.style === 'auction'
      ? sold.length - 1
      : Math.min(sold.length - 1, Math.floor(sold.length / 2))
  const row = sold[idx]
  return { id: row.id, name: row.name, cost: round2(sealedPriceOf(row.id).market || row.msrp || 4), setId: row.set_id }
}

/** One line of format identity per room — welcomes and LIVE feed lines. */
const FORMAT_TAGLINE: Record<string, string> = {
  rip: 'drops flash fast, the hammer rolls',
  auction: 'rapid-fire lots, the hammer never rests',
  mystery: 'sealed mystery boxes — every box hides a hit',
  sudden: 'every card $1 — sudden death, no mercy',
  teambreak: 'pack breaks — claim a species, own its pulls',
  ripship: 'rip it or ship it — win the pack, make the call',
}

function ensureSeedProducts(slot: string): { id: string; name: string; cost: number; setId: string } {
  // Friday runs the modern hit-heavy product; Sunday goes vintage.
  const productId = slot === 'fri' ? 'sv3pt5-booster' : 'base1-booster'
  const row = db.prepare('SELECT * FROM pack_products WHERE id = ?').get(productId) as { id: string; name: string; set_id: string; msrp: number } | undefined
  if (row) {
    const pool = (db.prepare('SELECT COUNT(*) AS n FROM pack_product_cards WHERE pack_product_id = ?').get(productId) as { n: number }).n
    if (pool > 0) return { id: row.id, name: row.name, cost: round2(sealedPriceOf(row.id).market || row.msrp), setId: row.set_id }
  }
  // Fallback: any synced booster pool.
  const any = (
    db.prepare(
      `SELECT p.id, p.name, p.set_id, p.msrp FROM pack_products p
       WHERE EXISTS (SELECT 1 FROM pack_product_cards ppc WHERE ppc.pack_product_id = p.id)
       ORDER BY p.msrp ASC`,
    ).all() as { id: string; name: string; set_id: string; msrp: number }[]
  ).find((r) => sellsOwnPacks(r.set_id))
  if (!any) throw new Error('no-seed-product')
  return { id: any.id, name: any.name, cost: round2(sealedPriceOf(any.id).market || any.msrp), setId: any.set_id }
}

/** Purge catalog ghosts: items/cards that vanished from the synced catalog. */
function purgeOrphans(): void {
  const shows = db.prepare(`SELECT id, product_id FROM live_shows WHERE status IN ('scheduled','live')`).all() as { id: number; product_id: string }[]
  for (const s of shows) {
    const pool = (db.prepare('SELECT COUNT(*) AS n FROM pack_product_cards WHERE pack_product_id = ?').get(s.product_id) as { n: number }).n
    if (pool === 0) db.prepare(`UPDATE live_shows SET status = 'cancelled', end_at = ? WHERE id = ?`).run(nowIsoGame(), s.id)
  }
  db.prepare(`DELETE FROM live_items WHERE card_id IS NOT NULL AND card_id NOT IN (SELECT id FROM cards) AND status = 'open'`).run()
}

// ---------------------------------------------------------------------------
// Chat — a small self-contained pool; hits and bid wars inject their own lines.
// ---------------------------------------------------------------------------

const AMBIENT = [
  'first time catching the stream, this channel is unreal',
  'who else camping the drops tonight',
  'chat be honest, are we bidding or eating this month',
  'that pull was criminal',
  'W chat W host',
  'im broke but im watching',
  'the hammer extension wars are back',
  'someone please take that before i do',
  'mods can we get a rip count on screen',
  'these asks are spicy tonight',
]
const BID_WAR = [
  '{amt}?? im in',
  'ok ok ok {amt} is my limit',
  'guess ill die {amt}',
  'CHILLS, {amt}',
  'take my rent money {amt}',
  'sniping at {amt}',
]
const HIT = [
  'NO WAY',
  'LETS GOOO',
  'clip it clip it clip it',
  'chat im shaking',
  'that settles the whole show',
]

function pushChat(showId: number, lines: { who: string; avatar: string; text: string }[]): void {
  const row = db.prepare('SELECT chat FROM live_shows WHERE id = ?').get(showId) as { chat: string } | undefined
  if (!row) return
  const arr = JSON.parse(row.chat) as { at: number; who: string; avatar: string; text: string }[]
  const at = Date.now()
  for (const l of lines) arr.push({ at, who: l.who, avatar: l.avatar, text: l.text })
  while (arr.length > 140) arr.shift()
  db.prepare('UPDATE live_shows SET chat = ? WHERE id = ?').run(JSON.stringify(arr), showId)
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** The HIT-CAM: a pulled hit stops the show. The host screams, chat erupts,
 *  and the room viewer count spikes — the same treatment rip streams give
 *  their own hits. `cards` are rollPack results (isHit flagged). Returns the
 *  hits with full art for the client's full-screen overlay. */
function eruptHits(showId: number, h: { name: string; avatar: string } | undefined, cards: { cardId: string; isHit: boolean; value: number; variant: string }[]): { name: string; cardId: string; image: string | null; value: number }[] {
  const hits = cards.filter((c) => c.isHit)
  if (hits.length === 0) return []
  const img = db.prepare('SELECT image_large FROM cards WHERE id = ?')
  const out: { name: string; cardId: string; image: string | null; value: number }[] = []
  for (const hit of hits) {
    const name = cardName(hit.cardId)
    const image = (img.get(hit.cardId) as { image_large: string | null } | undefined)?.image_large ?? null
    out.push({ name, cardId: hit.cardId, image, value: round2(hit.value) })
    // Name the show after it if it's the best pull tonight.
    const best = db.prepare('SELECT best_card_value FROM live_shows WHERE id = ?').get(showId) as { best_card_value: number | null } | undefined
    if (best && (best.best_card_value == null || hit.value > best.best_card_value)) {
      db.prepare('UPDATE live_shows SET best_card_id = ?, best_card_name = ?, best_card_value = ? WHERE id = ?').run(hit.cardId, name, round2(hit.value), showId)
    }
  }
  const lines: { who: string; avatar: string; text: string }[] = []
  for (const hit of out) {
    lines.push({ who: h?.name ?? 'host', avatar: h?.avatar ?? '📺', text: `🔥 THE HIT — ${hit.name}! Market says ${fmtMoney(hit.value)}!` })
    const viewers = 3 + Math.floor(Math.random() * 3)
    for (let i = 0; i < viewers; i++) {
      lines.push({ who: pick(['slabseeker', 'wagie_gradr', 'holo_hannah', 'dextright', 'packripper88', 'casechaser']), avatar: pick(VIEWER_AVATARS), text: pick(HIT) })
    }
  }
  pushChat(showId, lines)
  const bump = db.prepare('SELECT peak_viewers FROM live_shows WHERE id = ?').get(showId) as { peak_viewers: number }
  db.prepare('UPDATE live_shows SET peak_viewers = ? WHERE id = ?').run(bump.peak_viewers + TERMS.hitViewerBump, showId)
  return out
}

/** Game-clock ISO — item lifetimes ride the (shiftable) schedule clock so
 *  debug time-travel doesn't instantly age every lot. Feed/inventory stamps
 *  stay on the real clock (logActivity handles those). */
const nowIsoGame = () => new Date(nowMs()).toISOString()

// ---------------------------------------------------------------------------
// Show lifecycle
// ---------------------------------------------------------------------------

function openShow(slot: (typeof SLOTS)[number], hostId: number, weekStart: Date): void {
  const h = host(hostId)
  if (!h) return
  const product = ensureSeedProducts(slot.slot)
  const { start, end } = slotWindow(slot, weekStart)
  const planned = 12 + Math.floor(Math.random() * 7)
  db.prepare(
    `INSERT INTO live_shows (host_id, status, start_at, end_at, product_id, product_name, product_cost, rips_planned, last_rip_at, last_npc_bid_at)
     VALUES (?, 'live', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(hostId, start.toISOString(), end.toISOString(), product.id, product.name, product.cost, planned, nowIsoGame(), nowIsoGame())
  const showId = (db.prepare('SELECT id FROM live_shows ORDER BY id DESC LIMIT 1').get() as { id: number }).id
  pushChat(showId, [
    { who: h.name, avatar: h.avatar, text: `welcome to the show — ${product.name} all night, drops flash fast, no refund feelings` },
    { who: pick(['slabseeker', 'wagie_gradr', 'holo_hannah', 'dextright']), avatar: pick(VIEWER_AVATARS), text: pick(AMBIENT) },
  ])
  logActivity('live', `📺 ${h.name} is LIVE — ${product.name}, ${planned} rips on deck. Drops flash fast; the hammer rolls.`, undefined, '#/live')
}

// ---------------------------------------------------------------------------
// Always-on lineup — the scene's channels never go dark. Every host runs a
// live room around the clock, like the platform this wing parodies: you open
// the page and there are always several streams mid-rip.
// ---------------------------------------------------------------------------

/** Channel runtime: long sessions (was 3h windows) that stagger so wraps
 *  and fresh rooms alternate — the lineup always has variety. */
const CHANNEL_HOURS = [4, 8] as [number, number]

function ensureLiveShows(): void {
  const hosts = db.prepare('SELECT id FROM live_hosts ORDER BY id').all() as { id: number }[]
  for (const h of hosts) {
    const live = db.prepare(`SELECT id FROM live_shows WHERE host_id = ? AND status = 'live' LIMIT 1`).get(h.id) as { id: number } | undefined
    if (live) continue
    try {
      openAlwaysOnShow(h.id)
    } catch { /* no seed product yet (fresh save mid-sync) — next tick retries */ }
  }

  // THE FLOOR. The breather below is a shuffle device, not a shutdown: when
  // every room wraps at once (which happens — they all run 4-8h and open
  // together), seven 40-minute cooldowns used to black out the whole wing and
  // leave the feed saying "channels warming up" while the page promises there
  // is never dead air. A minimum of LIVE_FLOOR rooms are always live; if the
  // breather would take us under that, the hosts who have waited longest
  // reopen immediately.
  const liveCount = () => (db.prepare(`SELECT COUNT(*) n FROM live_shows WHERE status = 'live'`).get() as { n: number }).n
  const floor = Math.min(LIVE_FLOOR, hosts.length)
  let live = liveCount()
  if (live >= floor) return
  const waiting = db.prepare(
    `SELECT h.id
       FROM live_hosts h
      WHERE NOT EXISTS (SELECT 1 FROM live_shows s WHERE s.host_id = h.id AND s.status = 'live')
      ORDER BY COALESCE((SELECT MAX(s2.end_at) FROM live_shows s2 WHERE s2.host_id = h.id AND s2.status = 'done'), '') ASC`,
  ).all() as { id: number }[]
  for (const w of waiting) {
    if (live >= floor) break
    try {
      if (openAlwaysOnShow(w.id, true)) live++
    } catch { /* no seed product yet — the next tick retries */ }
  }
}

/** Rooms that are always live, even if the breather would rather they rest. */
const LIVE_FLOOR = 3

/** How long a wrapped channel rests so the lineup shuffles instead of restarting in lockstep. */
const BREATHER_MS = 40 * 60_000

/** Opens a host's room. Returns false when the room is still on its breather. */
function openAlwaysOnShow(hostId: number, force = false): boolean {
  const h = host(hostId)
  if (!h) return false
  const product = showProductFor(h)
  // A channel that just wrapped gets a short breather before reopening,
  // so the lineup shuffles instead of everyone restarting at once. `force`
  // skips it — used only to keep the LIVE_FLOOR from going dark.
  const lastDone = db.prepare(`SELECT MAX(end_at) AS e FROM live_shows WHERE host_id = ? AND status = 'done'`).get(hostId) as { e: string | null }
  if (!force && lastDone.e && nowMs() - new Date(lastDone.e).getTime() < BREATHER_MS) return false
  const hours = CHANNEL_HOURS[0] + Math.random() * (CHANNEL_HOURS[1] - CHANNEL_HOURS[0])
  const start = nowMs() - Math.random() * 40 * 60_000 // mid-rotation: rooms start slightly staggered
  const end = start + hours * 3_600_000
  const planned = 12 + Math.floor(Math.random() * 7)
  db.prepare(
    `INSERT INTO live_shows (host_id, status, start_at, end_at, product_id, product_name, product_cost, rips_planned, last_rip_at, last_npc_bid_at)
     VALUES (?, 'live', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(hostId, new Date(start).toISOString(), new Date(end).toISOString(), product.id, product.name, product.cost, planned, nowIsoGame(), nowIsoGame())
  const showId = (db.prepare('SELECT id FROM live_shows ORDER BY id DESC LIMIT 1').get() as { id: number }).id
  const tagline = FORMAT_TAGLINE[h.style] ?? 'drops flash fast, the hammer rolls'
  pushChat(showId, [
    { who: h.name, avatar: h.avatar, text: `welcome in — ${product.name} all night: ${tagline}` },
    { who: pick(['slabseeker', 'wagie_gradr', 'holo_hannah', 'dextright']), avatar: pick(VIEWER_AVATARS), text: pick(AMBIENT) },
  ])
  logActivity('live', `📺 ${h.name} is LIVE — ${product.name}. ${tagline.charAt(0).toUpperCase()}${tagline.slice(1)}.`, undefined, '#/live')
  return true
}

export function closeShow(showId: number, reason: 'natural' | 'hard-stop'): void {
  const show = db.prepare('SELECT * FROM live_shows WHERE id = ?').get(showId) as ShowRow
  const h = host(show.host_id)
  // Settle any live team breaks first — claimed spots pay out at the bell.
  for (const brk of db.prepare(`SELECT * FROM live_items WHERE show_id = ? AND kind = 'teamspot' AND status = 'open'`).all(showId) as ItemRow[]) {
    settleTeamBreak(brk, h?.name ?? 'the host')
  }
  // Hammer everything still open the way the room would.
  const open = db.prepare(`SELECT * FROM live_items WHERE show_id = ? AND status = 'open'`).all(showId) as ItemRow[]
  for (const it of open) {
    if (it.kind === 'ripship') {
      settleRipship(it, show, h!)
    } else if (it.kind === 'auction' || it.kind === 'sudden') {
      if (it.player_bid != null && it.current_bid != null && it.player_bid >= it.current_bid && (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash >= it.current_bid) {
        awardToPlayer(it, it.current_bid, it.kind === 'sudden' ? 'live_sudden' : 'live_auction', h?.name ?? 'the host')
      } else {
        db.prepare(`UPDATE live_items SET status = 'passed' WHERE id = ?`).run(it.id)
      }
    } else {
      db.prepare(`UPDATE live_items SET status = 'passed' WHERE id = ?`).run(it.id)
    }
  }
  // A pending RIOS pack the player never decided auto-ships sealed — the
  // show is over, the mailbox decides.
  const stragglers = db.prepare(`SELECT * FROM live_items WHERE show_id = ? AND kind = 'ripship' AND status = 'pending'`).all(showId) as ItemRow[]
  for (const st of stragglers) {
    const paid = round2(st.current_bid ?? 0)
    const sealed = db.prepare('SELECT id, quantity, cost FROM sealed_inventory WHERE product_id = ?').get(st.product_id!) as { id: number; quantity: number; cost: number } | undefined
    const tx = db.transaction(() => {
      db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(paid)
      if (sealed) {
        const newQty = sealed.quantity + 1
        const newCost = round2((sealed.cost * sealed.quantity + paid) / newQty)
        db.prepare('UPDATE sealed_inventory SET quantity = ?, cost = ? WHERE id = ?').run(newQty, newCost, sealed.id)
      } else {
        db.prepare('INSERT INTO sealed_inventory (product_id, quantity, cost, acquired_at) VALUES (?, 1, ?, ?)').run(st.product_id!, paid, nowIso())
      }
      db.prepare(`UPDATE live_items SET status = 'sold', winner = 'you (shipped it)', ship_choice = 'ship' WHERE id = ?`).run(st.id)
      db.prepare('UPDATE live_shows SET proceeds = proceeds + ? WHERE id = ?').run(paid, showId)
    })
    tx()
    logActivity('live', `📦 Your rip-it-or-ship-it win shipped sealed at show close — ${fmtMoney(paid)} to ${st.product_id}. In the Pack Shop stash.`, -paid, '#/live')
  }
  db.prepare(`UPDATE live_shows SET status = 'done' WHERE id = ?`).run(showId)
  if (!h) return
  // Rating + followers drift by realized honesty — simple, no rollup needed
  // (value-vs-paid lives in the section payload and wins history).
  const drift = h.integrity >= 0.75 ? 0.05 : h.integrity <= 0.5 ? -0.05 : 0.01
  db.prepare('UPDATE live_hosts SET rating = MAX(1.0, MIN(5.0, rating + ?)), followers = followers + ? WHERE id = ?')
    .run(drift, 8 + Math.floor(Math.random() * 40), h.id)
  if (reason === 'hard-stop' && show.rips_done < show.rips_planned) return // cut short: no summary spam
  logActivity('live', `📺 ${h.name}'s show wrapped — ${show.rips_done} rips, ${show.rips_planned > 0 ? Math.round((show.rips_done / show.rips_planned) * 100) : 0}% of the deck, ${fmtMoney(show.proceeds)} taken across the room.`, undefined, '#/live')
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`
}

type ShowRow = { id: number; host_id: number; status: string; start_at: string; end_at: string; product_id: string; product_name: string; product_cost: number; rips_done: number; rips_planned: number; peak_viewers: number; chat: string; last_rip_at: string | null; last_npc_bid_at: string | null; proceeds: number; best_card_id: string | null; best_card_name: string; best_card_value: number | null }
type ItemRow = { id: number; show_id: number; kind: string; card_id: string | null; variant: string; qty: number; bin_price: number | null; ask: number | null; contents_ev: number | null; contents: string | null; current_bid: number | null; player_bid: number | null; bids: number; npc_ceiling: number | null; ends_at: string | null; extended: number; npc_fuse_s: number | null; status: string; winner: string | null; created_at: string; product_id: string | null; ship_choice: string | null }

// ---------------------------------------------------------------------------
// Ripping — the host opens product and routes the results across the rails.
// ---------------------------------------------------------------------------

export function ripOnce(showId: number): void {
  const show = db.prepare('SELECT * FROM live_shows WHERE id = ?').get(showId) as ShowRow
  const h = host(show.host_id)
  if (!h) return
  const sessionId = `live_${showId}_${show.rips_done + 1}`
  // The HOST is ripping — their pulls are the room's, not the player's.
  const setId = show.product_id.replace(/-booster$/, '')
  const cards = rollPack(setId, sessionId, 'booster', 10, 'other')
  if (!cards || cards.length === 0) return
  const chat: { who: string; avatar: string; text: string }[] = []
  let bump = 0

  const hits = cards.filter((c) => c.isHit)
  // WotC-era pools have no `hit` slot — their chase cards live in `holo`.
  // A stream always features SOMETHING: fall back to the rip's best card
  // when the pack came back hitless (like a real stream doing a "best of
  // the pack" moment).
  let featured: { cardId: string; isHit: boolean; value: number; variant: string }[] | null = hits.length > 0 ? hits : null
  if (!featured) {
    const best = [...cards].sort((a, b) => b.value - a.value)[0]
    if (best && best.value > 1) featured = [best]
  }
  const bulk = (featured ? cards.filter((c) => !featured!.includes(c)) : cards).sort(() => Math.random() - 0.5)

  // Format routing — the Whatnot formats override the classic rails.
  if (h.style === 'sudden' || h.style === 'teambreak' || h.style === 'ripship' || h.style === 'mystery') {
    runWhatnotFormat(show, h, cards, featured, chat)
    recordBest(show, cards)
    finishRip(showId, h, bumpForStyle(h.style, cards), chat)
    return
  }

  // Featured cards go on the block: auctions for the room, BIN for the fast.
  for (const hit of featured ?? []) {
    const market = valueOf(hit.cardId, hit.variant)
    const toAuction = Math.random() < 0.6
    if (toAuction) {
      const life = TERMS.auctionMs[0] + Math.random() * (TERMS.auctionMs[1] - TERMS.auctionMs[0])
      const ceiling = market * (h.integrity <= 0.5 ? 1.25 : h.integrity >= 0.8 ? 0.95 : 1.05) * (0.95 + Math.random() * 0.2)
      db.prepare(
        `INSERT INTO live_items (show_id, kind, card_id, variant, ask, current_bid, npc_ceiling, ends_at, status, created_at)
         VALUES (?, 'auction', ?, ?, ?, ?, ?, ?, 'open', ?)`,
      ).run(showId, hit.cardId, hit.variant, round2(Math.max(0.99, market * 0.35)), round2(Math.max(0.99, market * 0.35)), round2(ceiling), new Date(nowMs() + life).toISOString(), nowIsoGame())
      chat.push({ who: h.name, avatar: h.avatar, text: `${hit.cardId ? 'THE HIT' : 'HIT'} is on the block — market says ~${fmtMoney(market)}, who wants it` })
    } else {
      createDrop(showId, hit.cardId, hit.variant, market, h)
      chat.push({ who: h.name, avatar: h.avatar, text: `DROP — ${fmtMoney(round2(market * h.price_bias))}, thumbs fast` })
    }
    bump = TERMS.hitViewerBump
    if (market > (show.best_card_value ?? 0)) {
      const nm = (db.prepare('SELECT name FROM cards WHERE id = ?').get(hit.cardId) as { name: string } | undefined)?.name ?? hit.cardId
      db.prepare('UPDATE live_shows SET best_card_id = ?, best_card_name = ?, best_card_value = ? WHERE id = ?').run(hit.cardId, nm, market, showId)
    }
    for (const c of HIT) chat.push({ who: pick(['slabseeker', 'wagie_gradr', 'holo_hannah', 'dextright', 'packripper88']), avatar: pick(VIEWER_AVATARS), text: c })
  }

  // Bulk: a quarter to BIN drops, a chunk to the mystery pile, the rest is bleed.
  const nBulk = bulk.length
  const nDrop = Math.ceil(nBulk * 0.25)
  const nMystery = Math.ceil(nBulk * 0.4)
  const mysteryPool: { cardId: string; variant: string; value: number }[] = []
  bulk.forEach((c, i) => {
    const market = valueOf(c.cardId, c.variant)
    if (i < nDrop) createDrop(showId, c.cardId, c.variant, market, h)
    else if (i < nDrop + nMystery) mysteryPool.push({ cardId: c.cardId, variant: c.variant, value: market })
  })
  if (mysteryPool.length >= 4) createMystery(showId, mysteryPool, h)

  recordBest(show, cards)
  finishRip(showId, h, bump, chat)
}

function recordBest(show: ShowRow, cards: { cardId: string; value: number }[]): void {
  const best = [...cards].sort((a, b) => b.value - a.value)[0]
  if (best && best.value > (show.best_card_value ?? 0)) {
    const nm = (db.prepare('SELECT name FROM cards WHERE id = ?').get(best.cardId) as { name: string } | undefined)?.name ?? best.cardId
    db.prepare('UPDATE live_shows SET best_card_id = ?, best_card_name = ?, best_card_value = ? WHERE id = ?').run(best.cardId, nm, best.value, show.id)
  }
}

function bumpForStyle(style: string, cards: { value: number }[]): number {
  if (style === 'sudden') return cards.some((c) => c.value > 20) ? TERMS.hitViewerBump : 60
  if (style === 'teambreak') return 80
  if (style === 'ripship') return 70
  if (style === 'mystery') return 50
  return 0
}

// ---------------------------------------------------------------------------
// The Whatnot formats — $1 sudden death, team pack breaks, rip-it-or-ship-it.
// ---------------------------------------------------------------------------

function runWhatnotFormat(
  show: ShowRow,
  h: NonNullable<ReturnType<typeof host>>,
  cards: { cardId: string; isHit: boolean; value: number; variant: string }[],
  featured: { cardId: string; isHit: boolean; value: number; variant: string }[] | null,
  chat: { who: string; avatar: string; text: string }[],
): void {
  const showId = show.id
  if (h.style === 'mystery') {
    // MYSTERY BOX CHANNEL: the rip never touches the rails — it becomes
    // sealed boxes. When the pack hid a hit, a PREMIUM box buries it with
    // half the bulk; the rest becomes a standard filler box. Integrity sets
    // the ratio: shills ask ~0.85 of EV, saints underprice.
    const hits = cards.filter((c) => c.isHit)
    const bulk = cards.filter((c) => !c.isHit)
    if (hits.length > 0 && bulk.length >= 2) {
      const premium = [...hits, ...bulk.slice(0, Math.ceil(bulk.length / 2))]
      const standard = bulk.slice(Math.ceil(bulk.length / 2))
      const evP = premium.reduce((a, c) => a + c.value, 0)
      const ratio = 0.55 + h.integrity * 0.6
      const askP = round2(Math.max(2, evP * ratio * (0.95 + Math.random() * 0.1)))
      db.prepare(
        `INSERT INTO live_items (show_id, kind, qty, ask, contents_ev, contents, status, created_at)
         VALUES (?, 'mystery', ?, ?, ?, ?, 'open', ?)`,
      ).run(showId, premium.length, askP, round2(evP), JSON.stringify(premium.map((c) => ({ cardId: c.cardId, variant: c.variant, value: c.value }))), nowIsoGame())
      chat.push({ who: h.name, avatar: h.avatar, text: `PREMIUM BOX live — ${premium.length} cards, one of them is the hit, ${fmtMoney(askP)} takes it` })
      if (standard.length >= 3) createMystery(showId, standard, h)
    } else {
      createMystery(showId, cards, h)
      chat.push({ who: h.name, avatar: h.avatar, text: `standard box live — ${cards.length} cards, ${fmtMoney(cards.reduce((a, c) => a + c.value, 0) * (0.55 + h.integrity * 0.6))}ish, you know the game` })
    }
  } else if (h.style === 'sudden') {
    // $1 SUDDEN DEATH (the real format): ONE card on screen at a time, $1
    // opens, a hard 6–10 second clock that NO bid can extend — when it hits
    // 0:01 the card is gone to whoever holds the high bid. Cards run cheap-
    // to-rich so the rip's hit closes the sequence as the climax. NPC heat
    // is capped in DOLLARS, not multiples: the room chases a common to a
    // buck or two and a grail maybe $10–30 over market — nobody pays 2× for
    // anything, exactly like the real rooms.
    const byValue = [...cards].sort((a, b) => a.value - b.value)
    byValue.forEach((c, i) => {
      const lifeS = TERMS.sdLotS[0] + i * TERMS.sdGapS + Math.random() * (TERMS.sdLotS[1] - TERMS.sdLotS[0])
      const heatCap = h.integrity <= 0.5 ? 18 + Math.random() * 14 : h.integrity >= 0.8 ? 5 + Math.random() * 6 : 9 + Math.random() * 9
      const premium = Math.min(c.value * (0.35 + Math.random() * 0.55), heatCap)
      const ceiling = round2(Math.max(TERMS.sdPrice + TERMS.minIncrement, c.value + premium))
      db.prepare(
        `INSERT INTO live_items (show_id, kind, card_id, variant, ask, current_bid, npc_ceiling, ends_at, status, created_at)
         VALUES (?, 'sudden', ?, ?, ?, ?, ?, ?, 'open', ?)`,
      ).run(showId, c.cardId, c.variant, TERMS.sdPrice, TERMS.sdPrice, ceiling, new Date(nowMs() + lifeS * 1000).toISOString(), nowIsoGame())
    })
    chat.push({ who: h.name, avatar: h.avatar, text: `SUDDEN DEATH — ${cards.length} cards, one at a time: $1 opens, ${TERMS.sdLotS[0]}–${TERMS.sdLotS[1]}s a card, NO extensions. you blink, you lose it` })
  } else if (h.style === 'teambreak') {
    // TEAM PACK BREAK: the pack's cards are attributed to species spots the
    // room claims; unsold spots are the house's, and the house keeps those
    // pulls' value in the proceeds line.
    const ev = cards.reduce((a, c) => a + c.value, 0)
    const ask = round2(Math.max(TERMS.sdPrice, (ev * (0.85 + h.integrity * 0.5)) / Math.max(1, cards.length)))
    const item = db.prepare(
      `INSERT INTO live_items (show_id, kind, qty, ask, contents_ev, contents, status, created_at)
       VALUES (?, 'teamspot', ?, ?, ?, ?, 'open', ?)`,
    ).run(showId, cards.length, ask, round2(ev), JSON.stringify(cards.map((c) => ({ cardId: c.cardId, variant: c.variant, value: c.value }))), nowIsoGame())
    const itemId = item.lastInsertRowid as number
    const insSpot = db.prepare('INSERT INTO live_team_spots (item_id, team, team_dex, holder, ask, claimed_at) VALUES (?, ?, ?, ?, ?, ?)')
    for (const c of cards) {
      const dexRow = db.prepare('SELECT name, dex_numbers FROM cards WHERE id = ?').get(c.cardId) as { name: string; dex_numbers: string | null } | undefined
      let team = 'the house'
      let dex: number | null = null
      if (dexRow?.dex_numbers) {
        try {
          dex = (JSON.parse(dexRow.dex_numbers) as number[])[0] ?? null
          team = baseSpecies(dexRow.name)
        } catch { /* keep defaults */ }
      }
      insSpot.run(itemId, team, dex, 'open', ask, nowIsoGame())
    }
    chat.push({ who: h.name, avatar: h.avatar, text: `PACK BREAK — claim your species at ${fmtMoney(ask)} a spot, ${cards.length} spots live` })
  } else if (h.style === 'ripship') {
    // RIP IT OR SHIP IT (the real Whatnot gimmick): the room bids on a SEALED
    // pack, not a card. Winner's choice — the host rips it on stream (cards
    // roll into the binder) or it ships sealed to the house. Opening ask is
    // host-biased around sealed market; the NPC war ceilings follow sealed
    // value the same way classic auctions do.
    const product = ensureSeedProducts(h.slot)
    const life = TERMS.riosAuctionMs[0] + Math.random() * (TERMS.riosAuctionMs[1] - TERMS.riosAuctionMs[0])
    const startBid = round2(Math.max(1, product.cost * h.price_bias * 0.5))
    const ceiling = round2(product.cost * (h.integrity <= 0.5 ? 1.35 : h.integrity >= 0.8 ? 0.95 : 1.1) * (0.95 + Math.random() * 0.25))
    db.prepare(
      `INSERT INTO live_items (show_id, kind, product_id, ask, current_bid, npc_ceiling, ends_at, status, created_at)
       VALUES (?, 'ripship', ?, ?, ?, ?, ?, 'open', ?)`,
    ).run(showId, product.id, startBid, startBid, ceiling, new Date(nowMs() + life).toISOString(), nowIsoGame())
    chat.push({ who: h.name, avatar: h.avatar, text: `RIP IT OR SHIP IT — sealed ${product.name} on the block at ${fmtMoney(startBid)}: winner picks rip-on-stream or shipped home` })
  }
}

function finishRip(showId: number, h: NonNullable<ReturnType<typeof host>>, bump: number, chat: { who: string; avatar: string; text: string }[]): void {
  const viewers = Math.round(TERMS.viewersBase + Math.sqrt(h.followers) * 6 + bump + (Math.random() - 0.3) * 120)
  db.prepare(
    `UPDATE live_shows SET rips_done = rips_done + 1, last_rip_at = ?, peak_viewers = MAX(peak_viewers, ?) WHERE id = ?`,
  ).run(nowIsoGame(), Math.max(1, viewers), showId)
  if (chat.length > 0) pushChat(showId, chat)
}

function createDrop(showId: number, cardId: string, variant: string, market: number, h: NonNullable<ReturnType<typeof host>>): void {
  const biasJitter = h.price_bias * (0.97 + Math.random() * 0.08)
  // The generous misprice: occasionally the ask just… isn't the market.
  const ask = round2(Math.max(0.25, market * (Math.random() < 0.12 * (h.integrity - 0.4) ? biasJitter * 0.72 : biasJitter)))
  const under = ask < market * 0.98
  const fuse = under ? Math.round(TERMS.dropFuseUnder[0] + Math.random() * (TERMS.dropFuseUnder[1] - TERMS.dropFuseUnder[0])) : null
  db.prepare(
    `INSERT INTO live_items (show_id, kind, card_id, variant, qty, bin_price, npc_fuse_s, status, created_at)
     VALUES (?, 'drop', ?, ?, 1, ?, ?, 'open', ?)`,
  ).run(showId, cardId, variant, ask, fuse, nowIsoGame())
}

function createMystery(showId: number, pool: { cardId: string; variant: string; value: number }[], h: NonNullable<ReturnType<typeof host>>): void {
  const ev = pool.reduce((a, c) => a + c.value, 0)
  const ratio = 0.55 + h.integrity * 0.6 // shill 0.82 → generous 1.12 of EV
  const ask = round2(Math.max(1, ev * ratio * (0.95 + Math.random() * 0.1)))
  db.prepare(
    `INSERT INTO live_items (show_id, kind, qty, ask, contents_ev, contents, status, created_at)
     VALUES (?, 'mystery', ?, ?, ?, ?, 'open', ?)`,
  ).run(showId, pool.length, ask, round2(ev), JSON.stringify(pool), nowIsoGame())
}

/** Award a won item to the player — money, binder, provenance, feed. */
function awardToPlayer(it: ItemRow, paid: number, via: string, hostName: string): void {
  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(paid)
    if (it.kind === 'mystery' && it.contents) {
      const contents = JSON.parse(it.contents) as { cardId: string; variant: string }[]
      const per = round2(paid / Math.max(1, contents.length))
      const ins = db.prepare(
        `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, acquired_ref, cost_basis, acquired_at)
         VALUES (?, ?, 'NM', 1, 'collection', ?, ?, ?, ?)`,
      )
      for (const c of contents) ins.run(c.cardId, c.variant, via, `show:${it.show_id}`, per, nowIso())
    } else if (it.card_id) {
      db.prepare(
        `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, acquired_ref, cost_basis, acquired_at)
         VALUES (?, ?, 'NM', ?, 'collection', ?, ?, ?, ?)`,
      ).run(it.card_id, it.variant, it.qty, via, `show:${it.show_id}`, round2(paid / Math.max(1, it.qty)), nowIso())
    }
    db.prepare(`UPDATE live_items SET status = 'sold', winner = 'you', current_bid = ?, player_bid = ? WHERE id = ?`).run(paid, paid, it.id)
    db.prepare('UPDATE live_shows SET proceeds = proceeds + ? WHERE id = ?').run(paid, it.show_id)
  })
  tx()
  logActivity('live', `📺 Won on ${hostName}'s show — ${describeItem(it)} for ${fmtMoney(paid)}.`, -paid, '#/live')
}

function describeItem(it: ItemRow): string {
  if (it.kind === 'mystery') return `a mystery pile of ${it.qty} cards`
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(it.card_id) as { name: string } | undefined)?.name ?? it.card_id
  const variantTag = it.variant !== 'normal' ? ` (${it.variant})` : ''
  return `${name}${variantTag}`
}

// ---------------------------------------------------------------------------
// The tick — scheduled shows open/close, rips land, wars rage, fuses burn.
// ---------------------------------------------------------------------------

let lastTickAt = 0

export function liveShoppingTick(): void {
  const now = nowMs()
  if (now - lastTickAt < 20_000) return
  lastTickAt = now

  ensureHosts()
  purgeOrphans()

  // ALWAYS-ON: every host's channel is live. ensureLiveShows opens any
  // missing room (fresh save, new roster, wrapped shows re-arm here).
  ensureLiveShows()

  const liveShows = db.prepare(`SELECT * FROM live_shows WHERE status = 'live' ORDER BY id ASC`).all() as ShowRow[]
  for (const live of liveShows) {
    const endMs = new Date(live.end_at).getTime()
    const hardStop = now >= endMs

    // Rips — a capped catch-up burst per tick covers time the game was
    // closed (a week away drains over a few ticks, not one giant gulp).
    // last_rip_at is RE-READ each pass so the elapsed check actually gates.
    let burst = 0
    while (live.rips_done < live.rips_planned && !hardStop && burst < 2) {
      const lastRip = live.last_rip_at ? new Date(live.last_rip_at).getTime() : now - TERMS.ripIntervalMs
      if (now - lastRip < TERMS.ripIntervalMs) break
      ripOnce(live.id)
      live.rips_done++
      burst++
      live.last_rip_at = nowIsoGame()
      db.prepare('UPDATE live_shows SET last_rip_at = ? WHERE id = ?').run(live.last_rip_at, live.id)
    }

    // Drops: fuses burn, lingers expire.
    const drops = db.prepare(`SELECT * FROM live_items WHERE show_id = ? AND kind = 'drop' AND status = 'open'`).all(live.id) as ItemRow[]
    for (const d of drops) {
      const ageS = (now - new Date(d.created_at).getTime()) / 1000
      if (d.npc_fuse_s != null && ageS >= d.npc_fuse_s) {
        db.prepare(`UPDATE live_items SET status = 'sold', winner = 'faster thumbs' WHERE id = ?`).run(d.id)
        db.prepare('UPDATE live_shows SET proceeds = proceeds + ? WHERE id = ?').run(d.bin_price ?? 0, live.id)
      } else if (now - new Date(d.created_at).getTime() > TERMS.dropLifeMs) {
        db.prepare(`UPDATE live_items SET status = 'passed' WHERE id = ?`).run(d.id)
      }
    }

    // Auctions + sudden death + rip-it-or-ship-it: NPC wars, then the hammer.
    npcBidWars(live.id, now)
    const auctions = db.prepare(`SELECT * FROM live_items WHERE show_id = ? AND kind IN ('auction','sudden','ripship') AND status = 'open'`).all(live.id) as ItemRow[]
    for (const a of auctions) {
      if (now < new Date(a.ends_at ?? '').getTime()) continue
      if (a.kind === 'ripship') {
        settleRipship(a, live, host(live.host_id)!)
        continue
      }
      const sdSold = a.kind === 'sudden'
      if (a.player_bid != null && a.current_bid != null && a.player_bid >= a.current_bid) {
        const cash = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
        if (cash >= a.current_bid) {
          awardToPlayer(a, a.current_bid, sdSold ? 'live_sudden' : 'live_auction', host(live.host_id)?.name ?? 'the host')
          pushChat(live.id, [{ who: host(live.host_id)?.name ?? 'host', avatar: host(live.host_id)?.avatar ?? '📺', text: sdSold ? 'SOLD — next card, get ready' : 'gone — pay the man' }])
          continue
        }
      }
      if (sdSold) {
        // A $1 sudden-death card always finds a taker — the $1 openers exist
        // so nobody leaves with nothing; passed lots break the format.
        const take = Math.max(TERMS.sdPrice, a.current_bid ?? TERMS.sdPrice)
        db.prepare(`UPDATE live_items SET status = 'sold', winner = 'the room', current_bid = ? WHERE id = ?`).run(take, a.id)
        db.prepare('UPDATE live_shows SET proceeds = proceeds + ? WHERE id = ?').run(take, live.id)
        continue
      }
      // NPC take at their own last raise, else passed.
      if (a.bids > 0 && a.current_bid != null) {
        db.prepare(`UPDATE live_items SET status = 'sold', winner = 'the room' WHERE id = ?`).run(a.id)
        db.prepare('UPDATE live_shows SET proceeds = proceeds + ? WHERE id = ?').run(a.current_bid, live.id)
      } else {
        db.prepare(`UPDATE live_items SET status = 'passed' WHERE id = ?`).run(a.id)
      }
    }

    // Team breaks: NPC viewers claim the marquee spots over time.
    npcClaimTeamSpots(live.id, now)

    // Mystery lots pass unopened at hard stop.
    if (hardStop) {
      db.prepare(`UPDATE live_items SET status = 'passed' WHERE show_id = ? AND kind = 'mystery' AND status = 'open'`).run(live.id)
    }

    if (hardStop || (live.rips_done >= live.rips_planned && now - new Date(live.last_rip_at ?? now).getTime() > 2 * TERMS.ripIntervalMs)) {
      closeShow(live.id, hardStop ? 'hard-stop' : 'natural')
    }
  }

  // Re-arm in THIS tick rather than the next one. A wrapped room either takes
  // its breather (the lineup shuffles) or — if that would drop the wing under
  // LIVE_FLOOR — reopens immediately. Either way the feed never sits empty.
  ensureLiveShows()
}

function npcBidWars(showId: number, now: number): void {
  const show = db.prepare('SELECT last_npc_bid_at FROM live_shows WHERE id = ?').get(showId) as { last_npc_bid_at: string | null }
  const last = show.last_npc_bid_at ? new Date(show.last_npc_bid_at).getTime() : 0
  if (now - last < TERMS.npcBidEveryMs) return
  db.prepare('UPDATE live_shows SET last_npc_bid_at = ? WHERE id = ?').run(nowIsoGame(), showId)

  const chat: { who: string; avatar: string; text: string }[] = []

  // Classic auctions and rip-it-or-ship-it sealed packs.
  const open = db.prepare(`SELECT * FROM live_items WHERE show_id = ? AND kind IN ('auction','ripship') AND status = 'open'`).all(showId) as ItemRow[]
  for (const a of open) {
    if (Math.random() > TERMS.npcBidChance) continue
    const inc = round2(Math.max(TERMS.minIncrement, (a.current_bid ?? 0) * 0.06))
    const next = round2((a.current_bid ?? 0) + inc)
    if (a.npc_ceiling == null || next > a.npc_ceiling) continue
    db.prepare(`UPDATE live_items SET current_bid = ?, bids = bids + 1, extended = extended + 1, ends_at = ? WHERE id = ? AND extended < ${TERMS.extensionMax}`)
      .run(next, new Date(now + TERMS.extensionMs).toISOString(), a.id)
    if (a.player_bid != null && a.player_bid >= a.current_bid!) {
      // They outbid the player's standing bid — war chat.
      chat.push({ who: pick(['slabseeker', 'wagie_gradr', 'holo_hannah', 'dextright', 'packripper88']), avatar: pick(VIEWER_AVATARS), text: pick(BID_WAR).replace('{amt}', fmtMoney(next)) })
    }
  }

  if (chat.length > 0) pushChat(showId, chat)
}

/**
 * SNIPE — the reaction steal. In the final 2 seconds of a sudden-death lot
 * you can fire a snipe: it takes the lot at current + $1, OUTRIGHT — NPC
 * snipers never get a counter (that's the whole point of a reaction play).
 * Fire outside the window and it costs you the moment: too early is a normal
 * bid, too late and the hammer has already fallen. Same sudden-death heat
 * ceiling as every other bid.
 */
export function snipe(itemId: number): { ok: true; stolen: boolean; paid: number; card: string } | { ok: false; error: string } {
  const it = db.prepare(`SELECT * FROM live_items WHERE id = ? AND status = 'open' AND kind = 'sudden'`).get(itemId) as ItemRow | undefined
  if (!it) return { ok: false, error: 'Too late — the hammer already fell on that one.' }
  const show = db.prepare(`SELECT * FROM live_shows WHERE id = ? AND status = 'live'`).get(it.show_id) as ShowRow | undefined
  if (!show) return { ok: false, error: 'The channel is offline.' }
  const now = nowMs()
  const msLeft = new Date(it.ends_at ?? now).getTime() - now
  if (msLeft > 2_000) {
    // Early pull: lands as a normal $+1 bid. The SNIPE is for the final two.
    const r = bid(itemId, (it.current_bid ?? 0) + TERMS.minIncrement)
    if (!r.ok) return r
    return { ok: true, stolen: false, paid: r.current, card: describeItem(it) }
  }
  const market = valueOf(it.card_id ?? '', it.variant)
  const heatCap = market > 0 ? Math.max(TERMS.sdPrice + TERMS.minIncrement, market * 1.6 + 10) : 25
  const take = round2((it.current_bid ?? 0) + TERMS.minIncrement)
  if (take > heatCap) return { ok: false, error: 'The room won\'t chase it that far — sudden death tops out near market (+~$10).' }
  const cash = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
  if (cash < take) return { ok: false, error: 'Not enough cash to cover the steal.' }
  const h = host(show.host_id)
  const tx = db.transaction(() => {
    // Re-check inside the write lock: the micro-tick may have hammered it a
    // heartbeat ago. status='open' guard makes this race-safe.
    const fresh = db.prepare(`SELECT status FROM live_items WHERE id = ? AND status = 'open'`).get(itemId)
    if (!fresh) return false
    awardToPlayer(it, take, 'live_sudden', h?.name ?? 'the host')
    return true
  })
  const won = tx()
  if (!won) return { ok: false, error: 'Too late — the hammer already fell on that one.' }
  pushChat(show.id, [
    { who: 'you', avatar: '🫵', text: `SNIPE! ${fmtMoney(take)} at the buzzer` },
    { who: h?.name ?? 'host', avatar: h?.avatar ?? '📺', text: 'and THAT is why you watch the clock — SOLD, next card' },
  ])
  return { ok: true, stolen: true, paid: take, card: describeItem(it) }
}

// ---------------------------------------------------------------------------
// SD micro-tick — $1 sudden death runs on a 2.5s server interval (the main
// game tick's ~20s heartbeat is far too slow for 6–10 second lots). Two jobs:
// NPC snipes at war tempo, and the hard hammer — the timer hits 0:01 and the
// card is GONE, to the player if they lead, else to the room. A $1 opener
// always finds a taker; that's the format.
// ---------------------------------------------------------------------------

export function sdMicroTick(): void {
  const now = nowMs()
  const shows = db.prepare(`SELECT id FROM live_shows WHERE status = 'live'`).all() as { id: number }[]
  for (const s of shows) {
    const open = db.prepare(`SELECT * FROM live_items WHERE show_id = ? AND kind = 'sudden' AND status = 'open'`).all(s.id) as ItemRow[]
    if (open.length === 0) continue
    const h = host((db.prepare('SELECT host_id FROM live_shows WHERE id = ?').get(s.id) as { host_id: number }).host_id)
    for (const a of open) {
      const endsMs = new Date(a.ends_at ?? '').getTime()
      // Hammer first — expired lots settle before anything bids on them.
      if (now >= endsMs) {
        if (a.player_bid != null && a.current_bid != null && a.player_bid >= a.current_bid) {
          const cash = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
          if (cash >= a.current_bid) {
            awardToPlayer(a, a.current_bid, 'live_sudden', h?.name ?? 'the host')
            pushChat(s.id, [{ who: h?.name ?? 'host', avatar: h?.avatar ?? '📺', text: `SOLD to you at ${fmtMoney(a.current_bid)} — NEXT CARD` }])
            continue
          }
        }
        const take = Math.max(TERMS.sdPrice, a.current_bid ?? TERMS.sdPrice)
        db.prepare(`UPDATE live_items SET status = 'sold', winner = 'the room', current_bid = ? WHERE id = ?`).run(take, a.id)
        db.prepare('UPDATE live_shows SET proceeds = proceeds + ? WHERE id = ?').run(take, s.id)
        if (take > TERMS.sdPrice && Math.random() < 0.4) {
          pushChat(s.id, [{ who: pick(BREAKER_HANDLES), avatar: pick(VIEWER_AVATARS), text: pick(BID_WAR).replace('{amt}', fmtMoney(take)) }])
        }
        continue
      }
      // NPC snipes: hotter late in the lot (the last-second shot is the format).
      const secsLeft = (endsMs - now) / 1000
      const chance = secsLeft <= 2.5 ? 0.5 : 0.3
      if (Math.random() > chance) continue
      const next = round2((a.current_bid ?? 0) + TERMS.minIncrement)
      if (a.npc_ceiling == null || next > a.npc_ceiling) continue
      db.prepare(`UPDATE live_items SET current_bid = ?, bids = bids + 1 WHERE id = ?`).run(next, a.id)
      if (a.player_bid != null && a.player_bid >= a.current_bid!) {
        pushChat(s.id, [{ who: pick(['slabseeker', 'wagie_gradr', 'holo_hannah', 'dextright', 'packripper88']), avatar: pick(VIEWER_AVATARS), text: pick(BID_WAR).replace('{amt}', fmtMoney(next)) }])
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Team breaks: spot claiming + settlement.
// ---------------------------------------------------------------------------

const BREAKER_HANDLES = ['slabseeker', 'wagie_gradr', 'holo_hannah', 'dextright', 'packripper88', 'vintageVick', 'dexhole', 'packsbyanna']

/** NPC viewers slowly claim the most valuable unclaimed species spots. */
function npcClaimTeamSpots(showId: number, now: number): void {
  const show = db.prepare('SELECT last_npc_bid_at FROM live_shows WHERE id = ?').get(showId) as { last_npc_bid_at: string | null }
  const last = show.last_npc_bid_at ? new Date(show.last_npc_bid_at).getTime() : 0
  if (now - last < TERMS.npcBidEveryMs) return
  const spots = db.prepare(
    `SELECT ts.id, ts.team, ts.ask
     FROM live_team_spots ts JOIN live_items it ON it.id = ts.item_id
     WHERE it.show_id = ? AND it.kind = 'teamspot' AND it.status = 'open' AND ts.holder = 'open'
     ORDER BY ts.ask DESC LIMIT 3`,
  ).all(showId) as { id: number; team: string; ask: number }[]
  if (spots.length === 0) return
  const claim = spots[Math.floor(Math.random() * spots.length)]
  db.prepare(`UPDATE live_team_spots SET holder = ?, claimed_at = ? WHERE id = ? AND holder = 'open'`)
    .run(pick(BREAKER_HANDLES), nowIsoGame(), claim.id)
  pushChat(showId, [{ who: pick(BREAKER_HANDLES), avatar: pick(VIEWER_AVATARS), text: `claimed ${claim.team} — ${fmtMoney(claim.ask)} sent` }])
}

/** Claim a species spot on the live team break (cash up front, like the room). */
export function claimTeamSpot(itemId: number, spotId: number): { ok: true; team: string; paid: number } | { ok: false; error: string } {
  const item = db.prepare(`SELECT * FROM live_items WHERE id = ? AND status = 'open' AND kind = 'teamspot'`).get(itemId) as ItemRow | undefined
  if (!item) return { ok: false, error: 'That break is off the board.' }
  const show = db.prepare(`SELECT * FROM live_shows WHERE id = ? AND status = 'live'`).get(item.show_id) as ShowRow | undefined
  if (!show) return { ok: false, error: 'The channel is offline.' }
  const spot = db.prepare(`SELECT * FROM live_team_spots WHERE id = ? AND item_id = ? AND holder = 'open'`).get(spotId, itemId) as { team: string; ask: number } | undefined
  if (!spot) return { ok: false, error: 'Someone beat you to that species.' }
  const cash = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
  if (cash < spot.ask) return { ok: false, error: 'Not enough cash — spots pay up front.' }
  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(spot.ask)
    db.prepare(`UPDATE live_team_spots SET holder = 'you', claimed_at = ? WHERE id = ?`).run(nowIsoGame(), spotId)
    db.prepare('UPDATE live_shows SET proceeds = proceeds + ? WHERE id = ?').run(spot.ask, show.id)
  })
  tx()
  logActivity('live', `📺 Team break: claimed ${spot.team} on ${host(show.host_id)?.name}'s board for ${fmtMoney(spot.ask)} — its pulls are yours at settle.`, -spot.ask, '#/live')
  return { ok: true, team: spot.team, paid: spot.ask }
}

/** Settle a finished break: every claimed spot's cards go to its holder; the
 *  player's land in the binder (provenance), the house's stay as proceeds. */
function settleTeamBreak(item: ItemRow, hostName: string): void {
  const contents = JSON.parse(item.contents ?? '[]') as { cardId: string; variant: string; value: number }[]
  const spots = db.prepare('SELECT * FROM live_team_spots WHERE item_id = ?').all(item.id) as { team: string; team_dex: number | null; holder: string; ask: number }[]
  const ins = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, acquired_ref, cost_basis, acquired_at)
     VALUES (?, ?, 'NM', 1, 'collection', 'live_break', ?, ?, ?)`,
  )
  const perCard = round2((item.ask ?? 0) / Math.max(1, spots.length))
  const tx = db.transaction(() => {
    for (const c of contents) {
      const dexRow = db.prepare('SELECT dex_numbers FROM cards WHERE id = ?').get(c.cardId) as { dex_numbers: string | null } | undefined
      let dex: number | null = null
      try { dex = dexRow?.dex_numbers ? (JSON.parse(dexRow.dex_numbers) as number[])[0] ?? null : null } catch { /* keep null */ }
      const spot = spots.find((s) => s.team_dex != null && s.team_dex === dex)
      if (spot && spot.holder === 'you') {
        ins.run(c.cardId, c.variant, `show:${item.show_id}`, perCard, nowIso())
      }
      // House-held spots keep value in the room (proceeds already booked the ask).
    }
    db.prepare(`UPDATE live_items SET status = 'sold', winner = 'settled' WHERE id = ?`).run(item.id)
  })
  tx()
  const mine = spots.filter((s) => s.holder === 'you').length
  if (mine > 0) logActivity('live', `📺 Break settled on ${hostName}'s stream — your ${mine} spot${mine === 1 ? '' : 's'} paid out; check the binder.`, 0, '#/live')
}

// ---------------------------------------------------------------------------
// Rip-it-or-ship-it: the room bids on a SEALED pack. At the hammer the winner
// chooses — RIP IT (host opens it on stream, cards roll into the binder) or
// SHIP IT (the sealed pack goes home with them). Pending lots show the
// chooser until decided; the show's close-out auto-ships stragglers.
// ---------------------------------------------------------------------------

const riosProduct = (it: ItemRow) =>
  db.prepare('SELECT id, name FROM pack_products WHERE id = ?').get(it.product_id ?? '') as { id: string; name: string } | undefined

function settleRipship(it: ItemRow, live: ShowRow, h: NonNullable<ReturnType<typeof host>>): void {
  const product = riosProduct(it)
  const prodName = product?.name ?? it.product_id ?? 'the pack'
  if (it.player_bid != null && it.current_bid != null && it.player_bid >= it.current_bid) {
    // Player won — hold the lot open as a pending choice.
    db.prepare(`UPDATE live_items SET status = 'pending' WHERE id = ?`).run(it.id)
    pushChat(live.id, [{ who: h.name, avatar: h.avatar, text: `sealed ${prodName} goes to YOU at ${fmtMoney(it.current_bid)} — rip it on stream or take it home?` }])
    logActivity('live', `📺 You won ${h.name}'s rip-it-or-ship-it at ${fmtMoney(it.current_bid)} — choose rip-on-stream or ship-it-home.`, undefined, '#/live')
    return
  }
  if (it.bids > 0 && it.current_bid != null) {
    // NPC won. Their choice mirrors the room's mood: hits tonight lean rip.
    const rip = Math.random() < 0.5
    if (rip) {
      const setId = (it.product_id ?? '').replace(/-booster$/, '')
      const sessionId = `live_${live.id}_rios_${it.id}`
      const cards = rollPack(setId, sessionId, 'booster', 10, 'other')
      if (cards && cards.length > 0) {
        const best = [...cards].sort((a, b) => b.value - a.value)[0]
        const nm = best ? cardName(best.cardId) : 'bulk'
        db.prepare(`UPDATE live_items SET status = 'sold', winner = 'the room (ripped it)' WHERE id = ?`).run(it.id)
        db.prepare('UPDATE live_shows SET proceeds = proceeds + ? WHERE id = ?').run(it.current_bid, live.id)
        pushChat(live.id, [{ who: h.name, avatar: h.avatar, text: `the room said RIP IT — best of the pack: ${nm}` }])
        eruptHits(live.id, h, cards)
        return
      }
    }
    db.prepare(`UPDATE live_items SET status = 'sold', winner = 'the room (shipped it)' WHERE id = ?`).run(it.id)
    db.prepare('UPDATE live_shows SET proceeds = proceeds + ? WHERE id = ?').run(it.current_bid, live.id)
    pushChat(live.id, [{ who: h.name, avatar: h.avatar, text: 'winner took it home sealed — smart, honestly' }])
    return
  }
  db.prepare(`UPDATE live_items SET status = 'passed' WHERE id = ?`).run(it.id)
}

/** The winner's choice: rip the sealed pack on stream, or take it home sealed. */
export function ripshipChoose(itemId: number, choice: 'rip' | 'ship'):
  | { ok: true; choice: 'rip'; paid: number; cards: { name: string; value: number }[]; total: number; hits: { name: string; cardId: string; image: string | null; value: number }[]; firstHit: string | null }
  | { ok: true; choice: 'ship'; paid: number; product: string }
  | { ok: false; error: string } {
  const it = db.prepare(`SELECT * FROM live_items WHERE id = ? AND kind = 'ripship' AND status = 'pending'`).get(itemId) as ItemRow | undefined
  if (!it) return { ok: false, error: 'No pack waiting on you — the hammer has not fallen or the choice is made.' }
  const show = db.prepare(`SELECT * FROM live_shows WHERE id = ?`).get(it.show_id) as ShowRow | undefined
  if (!show) return { ok: false, error: 'The channel is offline.' }
  const h = host(show.host_id)
  const product = riosProduct(it)
  if (!product) return { ok: false, error: 'That product is gone from the catalog.' }
  const paid = round2(it.current_bid ?? 0)
  const cash = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
  if (cash < paid) return { ok: false, error: 'Not enough cash to cover your winning bid.' }

  if (choice === 'rip') {
    // The host opens your pack on stream — cards roll into the binder.
    const setId = it.product_id!.replace(/-booster$/, '')
    const sessionId = `live_${show.id}_rios_you_${it.id}`
    const cards = rollPack(setId, sessionId, 'booster', 10)
    if (!cards || cards.length === 0) return { ok: false, error: 'The pack was a dud — the host owes you one. Try again.' }
    const rows: { name: string; value: number }[] = []
    const hits: { name: string; cardId: string; image: string | null; value: number }[] = []
    const ins = db.prepare(
      `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, acquired_ref, cost_basis, acquired_at)
       VALUES (?, ?, 'NM', 1, 'collection', 'live_rios', ?, ?, ?)`,
    )
    const per = round2(paid / cards.length)
    const tx = db.transaction(() => {
      db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(paid)
      for (const c of cards) {
        ins.run(c.cardId, c.variant, `show:${show.id}`, per, nowIso())
        rows.push({ name: cardName(c.cardId), value: round2(c.value) })
      }
      db.prepare(`UPDATE live_items SET status = 'sold', winner = 'you (ripped it)', ship_choice = 'rip' WHERE id = ?`).run(it.id)
      db.prepare('UPDATE live_shows SET proceeds = proceeds + ? WHERE id = ?').run(paid, show.id)
    })
    tx()
    const total = round2(rows.reduce((a, r) => a + r.value, 0))
    // Hit-cam: any hit in YOUR pack stops the show. Full art back to the
    // client for the overlay; the room erupts in chat and spikes viewers.
    const erupted = eruptHits(show.id, h, cards)
    if (erupted.length > 0) hits.push(...erupted)
    const firstHit = erupted[0] ?? null
    if (firstHit) {
      logActivity('live', `🔥 HIT-CAM on ${h?.name ?? 'the show'} — your pack hit ${firstHit.name} (${fmtMoney(firstHit.value)})!`, undefined, '#/live')
    }
    return { ok: true, choice: 'rip', paid, cards: rows, total, hits: erupted, firstHit: firstHit?.cardId ?? null }
  }

  // Ship it: the sealed pack lands in the house inventory.
  const sealed = db.prepare('SELECT id, quantity, cost FROM sealed_inventory WHERE product_id = ?').get(it.product_id!) as { id: number; quantity: number; cost: number } | undefined
  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(paid)
    if (sealed) {
      const newQty = sealed.quantity + 1
      const newCost = round2((sealed.cost * sealed.quantity + paid) / newQty)
      db.prepare('UPDATE sealed_inventory SET quantity = ?, cost = ? WHERE id = ?').run(newQty, newCost, sealed.id)
    } else {
      db.prepare('INSERT INTO sealed_inventory (product_id, quantity, cost, acquired_at) VALUES (?, 1, ?, ?)').run(it.product_id!, paid, nowIso())
    }
    db.prepare(`UPDATE live_items SET status = 'sold', winner = 'you (shipped it)', ship_choice = 'ship' WHERE id = ?`).run(it.id)
    db.prepare('UPDATE live_shows SET proceeds = proceeds + ? WHERE id = ?').run(paid, show.id)
  })
  tx()
  pushChat(show.id, [{ who: h?.name ?? 'host', avatar: h?.avatar ?? '📺', text: 'shipped — enjoy the sealed. No peeking before the mailbox.' }])
  return { ok: true, choice: 'ship', paid, product: product.name }
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

export function bid(itemId: number, amount: number): { ok: true; leading: boolean; current: number; extended: boolean } | { ok: false; error: string } {
  // Bidding works on hammer formats — classic auctions, $1 sudden death,
  // and rip-it-or-ship-it sealed packs.
  const it = db.prepare(`SELECT * FROM live_items WHERE id = ? AND status = 'open' AND kind IN ('auction','sudden','ripship')`).get(itemId) as ItemRow | undefined
  const isSd = it?.kind === 'sudden'
  if (isSd && it) {
    // Sudden-death heat ceiling: the room pays a buck or two over market for
    // junk and maybe $10–30 over for the grail — never double. Your bid over
    // that line just doesn't land (the host moves on, no sale to you).
    const market = valueOf(it.card_id ?? '', it.variant)
    const heatCap = market > 0 ? Math.max(TERMS.sdPrice + TERMS.minIncrement, market * 1.6 + 10) : 25
    if (round2(Math.max(0, amount || 0)) > heatCap) {
      return { ok: false, error: `The room won't chase it that far — sudden death tops out near market (+~$10).` }
    }
  }
  if (!it) return { ok: false, error: 'That lot is gone — the hammer fell or the show ended.' }
  const show = db.prepare(`SELECT * FROM live_shows WHERE id = ? AND status = 'live'`).get(it.show_id) as ShowRow | undefined
  if (!show) return { ok: false, error: 'The channel is offline.' }
  const cash = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
  const min = round2((it.current_bid ?? 0) + TERMS.minIncrement)
  const amount2 = round2(Math.max(0, amount || 0))
  if (amount2 < min) return { ok: false, error: `Bid at least ${fmtMoney(min)} — the room is at ${fmtMoney(it.current_bid ?? 0)}.` }
  if (amount2 > cash) return { ok: false, error: 'Not enough cash — the room does not take IOUs.' }

  const now = nowMs()
  const endsMs = new Date(it.ends_at ?? now).getTime()
  // SUDDEN DEATH never extends — the timer hits 0:01 and the card is gone,
  // that's the entire format. Other formats keep the rolling hammer.
  const inWindow = !isSd && endsMs - now <= TERMS.extensionMs
  const extended = inWindow && it.extended < TERMS.extensionMax
  const newEnds = extended ? new Date(now + TERMS.extensionMs).toISOString() : it.ends_at

  const leading = it.npc_ceiling == null || amount2 > it.npc_ceiling
  db.prepare(`UPDATE live_items SET current_bid = MAX(COALESCE(current_bid,0), ?), player_bid = ?, bids = bids + 1, ends_at = ?, extended = extended + ? WHERE id = ?`)
    .run(amount2, amount2, newEnds, extended ? 1 : 0, itemId)

  if (!leading) {
    // NPC snaps back over you if their ceiling allows; the bid war chat tells you.
    const snap = round2(Math.min(it.npc_ceiling ?? amount2, amount2 + round2(Math.max(TERMS.minIncrement, amount2 * 0.05))))
    if (snap > amount2) {
      db.prepare(`UPDATE live_items SET current_bid = ?, bids = bids + 1, extended = extended + 1, ends_at = ? WHERE id = ?`)
        .run(snap, new Date(now + TERMS.extensionMs).toISOString(), itemId)
      pushChat(show.id, [{ who: pick(['slabseeker', 'wagie_gradr', 'holo_hannah', 'dextright']), avatar: pick(VIEWER_AVATARS), text: pick(BID_WAR).replace('{amt}', fmtMoney(snap)) }])
      return { ok: true, leading: false, current: snap, extended: true }
    }
  }
  return { ok: true, leading, current: amount2, extended }
}

export function buyBin(itemId: number): { ok: true; paid: number; card: string } | { ok: false; error: string } {
  const it = db.prepare(`SELECT * FROM live_items WHERE id = ? AND status = 'open' AND kind = 'drop'`).get(itemId) as ItemRow | undefined
  if (!it) return { ok: false, error: 'Gone — someone out-thumbed you.' }
  const show = db.prepare(`SELECT * FROM live_shows WHERE id = ? AND status = 'live'`).get(it.show_id) as ShowRow | undefined
  if (!show) return { ok: false, error: 'The channel is offline.' }
  const cash = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
  if (cash < (it.bin_price ?? 0)) return { ok: false, error: 'Not enough cash.' }
  awardToPlayer(it, it.bin_price ?? 0, 'live_drop', host(show.host_id)?.name ?? 'the host')
  pushChat(show.id, [{ who: host(show.host_id)?.name ?? 'host', avatar: host(show.host_id)?.avatar ?? '📺', text: 'SOLD — inbox me, next drop in a minute' }])
  return { ok: true, paid: it.bin_price ?? 0, card: describeItem(it) }
}

export function buyMystery(itemId: number): { ok: true; paid: number; cards: { name: string; value: number }[]; total: number } | { ok: false; error: string } {
  const it = db.prepare(`SELECT * FROM live_items WHERE id = ? AND status = 'open' AND kind = 'mystery'`).get(itemId) as ItemRow | undefined
  if (!it) return { ok: false, error: 'That pile just walked out the door.' }
  const show = db.prepare(`SELECT * FROM live_shows WHERE id = ? AND status = 'live'`).get(it.show_id) as ShowRow | undefined
  if (!show) return { ok: false, error: 'The channel is offline.' }
  const cash = (db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }).cash
  if (cash < (it.ask ?? 0)) return { ok: false, error: 'Not enough cash.' }
  awardToPlayer(it, it.ask ?? 0, 'live_mystery', host(show.host_id)?.name ?? 'the host')
  const contents = JSON.parse(it.contents ?? '[]') as { cardId: string; variant: string }[]
  const cards = contents.map((c) => ({ name: (db.prepare('SELECT name FROM cards WHERE id = ?').get(c.cardId) as { name: string } | undefined)?.name ?? c.cardId, value: round2(valueOf(c.cardId, c.variant)) }))
  const total = round2(cards.reduce((a, c) => a + c.value, 0))
  logActivity('live', `📺 Mystery reveal on ${host(show.host_id)?.name}'s show — ${cards.length} cards worth ${fmtMoney(total)} for ${fmtMoney(it.ask ?? 0)} (${total >= (it.ask ?? 0) ? '+' : ''}${fmtMoney(total - (it.ask ?? 0))}).`, 0, '#/live')
  return { ok: true, paid: it.ask ?? 0, cards, total }
}

// ---------------------------------------------------------------------------
// Section payload
// ---------------------------------------------------------------------------

export function section(showId?: number) {
  const now = nowMs()
  ensureHosts()
  const hosts = db.prepare('SELECT * FROM live_hosts ORDER BY followers DESC').all() as { id: number; name: string; avatar: string; style: string; integrity: number; price_bias: number; followers: number; rating: number; slot: string }[]

  // ALWAYS-ON lineup: every host's channel is live (the tick guarantees it).
  // The old schedule slots live on only as flavor — there is no 'next show'
  // because there is never dead air.
  const channels = db.prepare(
    `SELECT ls.id, ls.host_id, ls.product_id, ls.product_name, ls.rips_done, ls.rips_planned, ls.peak_viewers, ls.end_at, ls.best_card_value, ls.best_card_name
     FROM live_shows ls WHERE ls.status = 'live' ORDER BY ls.peak_viewers DESC`,
  ).all() as { id: number; host_id: number; product_id: string | null; product_name: string; rips_done: number; rips_planned: number; peak_viewers: number; end_at: string; best_card_value: number | null; best_card_name: string | null }[]

  // The room to render: the requested channel when the player has hopped to
  // one (full room switch — header, chat, and format rails), else the newest
  // live room. A stale showId (channel wrapped mid-hop) falls back cleanly.
  let live = (showId
    ? db.prepare(`SELECT * FROM live_shows WHERE status = 'live' AND id = ?`).get(showId) as ShowRow | undefined
    : undefined)
  if (!live) live = db.prepare(`SELECT * FROM live_shows WHERE status = 'live' ORDER BY id DESC LIMIT 1`).get() as ShowRow | undefined
  let currentShow: Record<string, unknown> | null = null
  if (live) {
    const h = host(live.host_id)
    const items = db.prepare(`SELECT * FROM live_items WHERE show_id = ? AND status IN ('open','pending') ORDER BY id DESC LIMIT 60`).all(live.id) as ItemRow[]
    const recent = db.prepare(`SELECT * FROM live_items WHERE show_id = ? AND status != 'open' ORDER BY id DESC LIMIT 12`).all(live.id) as ItemRow[]
    const seasonalMult = walkInMultiplier()
    // Team-break board: spots for the show's open breaks, holders masked to
    // the room's handles (yours says 'you').
    const teamBoards = db.prepare(
      `SELECT id FROM live_items WHERE show_id = ? AND kind = 'teamspot' AND status = 'open' ORDER BY id DESC`,
    ).all(live.id) as { id: number }[]
    const boards = teamBoards.map((b) => ({
      itemId: b.id,
      spots: (db.prepare('SELECT id, team, holder, ask FROM live_team_spots WHERE item_id = ? ORDER BY ask DESC').all(b.id) as { id: number; team: string; holder: string; ask: number }[])
        .map((s) => ({ id: s.id, team: s.team, ask: s.ask, mine: s.holder === 'you', holder: s.holder === 'you' ? 'you' : s.holder === 'open' ? null : s.holder })),
    }))
    currentShow = {
      id: live.id,
      host: h ? { name: h.name, avatar: h.avatar, rating: h.rating, followers: h.followers, integrity: h.integrity, style: h.style } : null,
      product: { name: live.product_name, market: live.product_cost, symbol: productSymbol(live.product_id), image: productArt(live.product_id) },
      rips: { done: live.rips_done, planned: live.rips_planned },
      viewers: Math.round((TERMS.viewersBase + Math.sqrt(h?.followers ?? 100) * 6) * seasonalMult),
      peakViewers: live.peak_viewers,
      proceeds: round2(live.proceeds),
      bestPull: live.best_card_value ? { name: live.best_card_name ?? live.best_card_id, value: live.best_card_value } : null,
      chat: JSON.parse(live.chat) as { at: number; who: string; avatar: string; text: string }[],
      items: items.map(publicItem),
      recent: recent.map(publicItem),
      boards,
      style: h?.style ?? 'rip',
      endsAt: live.end_at,
      serverNow: new Date(now).toISOString(),
    }
  }

  const history = db.prepare(`SELECT * FROM live_shows WHERE status = 'done' ORDER BY id DESC LIMIT 8`).all() as ShowRow[]
  const won = db.prepare(
    `SELECT i.card_id, i.variant, i.cost_basis, i.acquired_at, c.name, c.image_small, s2.host_id
     FROM inventory i JOIN cards c ON c.id = i.card_id
     LEFT JOIN live_shows s2 ON i.acquired_ref = 'show:' || s2.id
     WHERE i.acquired_via IN ('live_drop','live_auction','live_mystery','live_sudden','live_rios','live_break') ORDER BY i.acquired_at DESC LIMIT 20`,
  ).all() as { card_id: string; variant: string; cost_basis: number; acquired_at: string; name: string; image_small: string | null; host_id: number | null }[]

  return {
    now: Boolean(live),
    // Channel lineup — the always-on wing replaces the weekly schedule.
    channels: channels.map((c) => {
      const h = host(c.host_id)
      return {
        showId: c.id,
        host: h?.name ?? '?',
        avatar: h?.avatar ?? '📺',
        style: h?.style ?? 'rip',
        rating: h ? round2(h.rating) : 0,
        followers: h?.followers ?? 0,
        integrity: h?.integrity ?? 0.5,
        product: c.product_name,
        image: productArt(c.product_id),
        rips: { done: c.rips_done, planned: c.rips_planned },
        viewers: Math.round((TERMS.viewersBase + Math.sqrt(h?.followers ?? 100) * 6) * walkInMultiplier()),
        peakViewers: c.peak_viewers,
        endsAt: c.end_at,
        bestPull: c.best_card_value ? { name: c.best_card_name ?? '', value: c.best_card_value } : null,
      }
    }),
    upcoming: [] as { start: string; end: string; title: string; host: string; avatar: string; now: boolean }[],
    currentShow,
    hosts: hosts.map((h) => ({ name: h.name, avatar: h.avatar, style: h.style, followers: h.followers, rating: round2(h.rating), note: hostNote(h.integrity) })),
    recentShows: history.map((s) => {
      const h = host(s.host_id)
      const spent = round2(s.proceeds)
      return { id: s.id, host: h?.name ?? '?', avatar: h?.avatar ?? '📺', rips: s.rips_done, bestPull: s.best_card_value ? { name: s.best_card_name, value: s.best_card_value } : null, proceeds: spent, at: s.end_at }
    }),
    wins: won.map((w) => ({
      card: w.name, variant: w.variant, paid: round2(w.cost_basis),
      value: round2(w.card_id ? valueOf(w.card_id, w.variant) : 0),
      host: w.host_id ? host(w.host_id)?.name ?? '?' : '?',
      at: w.acquired_at,
    })),
  }
}

function hostNote(integrity: number): string {
  if (integrity <= 0.5) return 'reputation says: reads the room before it reads the card'
  if (integrity >= 0.85) return 'reputation says: occasional misprices, honest boxes'
  return 'reputation says: fair-ish, watch the late bids'
}

/** The show product's set symbol — foil art for the tear-open overlay. */
function productSymbol(productId: string | null | undefined): string | null {
  if (!productId) return null
  const row = db.prepare(`SELECT s.symbol_url AS sym FROM pack_products p JOIN sets s ON s.id = p.set_id WHERE p.id = ?`).get(productId) as { sym: string | null } | undefined
  return row?.sym ?? null
}

/** The show product's real wrapper art — the pack photo the tear splits. */
function productArt(productId: string | null | undefined): string | null {
  if (!productId) return null
  const row = db.prepare(`SELECT image_url AS art FROM pack_products WHERE id = ?`).get(productId) as { art: string | null } | undefined
  return row?.art ?? null
}

function publicItem(it: ItemRow) {
  const sealed = it.kind === 'ripship' && it.product_id
  const sealedRow = sealed ? (db.prepare('SELECT name FROM pack_products WHERE id = ?').get(it.product_id!) as { name: string } | undefined) : undefined
  const market = it.kind === 'mystery' || it.kind === 'teamspot' ? it.contents_ev ?? 0
    : sealed ? round2(sealedPriceOf(it.product_id!).market || 0)
    : it.card_id ? round2(valueOf(it.card_id, it.variant)) : 0
  const name = it.kind === 'mystery' ? `Mystery pile × ${it.qty}`
    : it.kind === 'teamspot' ? `Pack break — ${it.qty} species spots`
    : sealed ? `${sealedRow?.name ?? it.product_id} — sealed`
    : describeItem(it)
  const img = sealed ? null : it.card_id ? (db.prepare('SELECT image_small FROM cards WHERE id = ?').get(it.card_id) as { image_small: string | null } | undefined)?.image_small ?? null : null
  return {
    id: it.id,
    kind: it.kind,
    name,
    cardId: it.kind === 'mystery' || it.kind === 'teamspot' ? null : it.card_id,
    variant: it.variant,
    image: img,
    status: it.status,
    shipChoice: it.ship_choice ?? null,
    ask: it.kind === 'drop' ? it.bin_price : it.ask,
    market,
    currentBid: it.current_bid,
    bids: it.bids,
    endsAt: it.ends_at,
    leading: it.player_bid != null && it.current_bid != null && it.player_bid >= it.current_bid && it.status === 'open',
    outbid: it.player_bid != null && it.current_bid != null && it.player_bid < it.current_bid && it.status === 'open',
    myBid: it.player_bid,
  }
}

// Provenance label helper for inventory surfaces.
export const VIA_LABELS: Record<string, string> = {
  live_drop: '📺 live drop',
  live_auction: '📺 live auction',
  live_mystery: '📺 live mystery',
  live_sudden: '💵 $1 sudden death',
  live_rios: '🚚 rip-it-or-ship-it',
  live_break: '🧩 team pack break',
}
