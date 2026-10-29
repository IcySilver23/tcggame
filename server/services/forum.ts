import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayMs, gameDayKey } from '../lib/gameday'
import { round2 } from './market'
import { fakeNotoriety } from './auth'

// ---------------------------------------------------------------------------
// THE COMMUNITY SCENE — the roadmap's local collector forum. Where the street
// (auth.ts) punishes passing fakes, the forum is the positive half of the same
// social layer: post pulls, answer newbies, and build a standing score that
// the rest of the scene actually reads. Reputation unlocks real privileges:
//   • 10 rep  — group-buy access: co-fund a big lot with other collectors and
//               split the cards by draft order
//   • 25 rep  — estate first-refusal: you get the DM before the estate goes
//               public, with a 1-game-day exclusive window
//   • 40 rep  — ship-first trust: trade partners mail you their card before
//               you've mailed yours (the last-trade escrow anxiety, gone)
// Notoriety from the street bleeds in: a convicted fake-passer posts to an
// empty room until the suspicion fades (rep gains halved while the flag is up
// and the forum shows the warning).
// ---------------------------------------------------------------------------

const GROUP_BUY_MIN_REP = 10
const FIRST_REFUSAL_REP = 25
const SHIP_FIRST_REP = 40

try {
  db.exec(`CREATE TABLE IF NOT EXISTS forum_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,               -- pull | guide | reply
    title TEXT NOT NULL,
    body TEXT,
    card_name TEXT,
    card_id TEXT,
    warmth INTEGER NOT NULL DEFAULT 0, -- 🔥 the thread earned from the room
    day_key TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_forum_posts_day ON forum_posts (day_key)`)

  db.exec(`CREATE TABLE IF NOT EXISTS forum_groupbuys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_name TEXT NOT NULL,
    card_id TEXT,
    total_cost REAL NOT NULL,
    my_share REAL NOT NULL,
    split_n INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',   -- open | filled | delivered
    eta_days INTEGER NOT NULL DEFAULT 2,
    created_at TEXT NOT NULL,
    due_at TEXT
  )`)
} catch (e) {
  console.log('[forum] table setup skipped:', e instanceof Error ? e.message : e)
}

export function forumRep(): number {
  return Math.min(100, Math.max(0, Number(getMeta('forum:rep') ?? '0')))
}

export function repTier(): { tier: 'lurker' | 'regular' | 'known' | 'trusted' | 'pillar'; groupBuys: boolean; firstRefusal: boolean; shipFirst: boolean; nextAt: number | null; nextLabel: string | null } {
  const rep = forumRep()
  const tier = rep >= 40 ? 'pillar' : rep >= 25 ? 'trusted' : rep >= 10 ? 'known' : rep >= 3 ? 'regular' : 'lurker'
  const ladders: [number, string][] = [
    [3, 'post 2 more times to become a regular'],
    [GROUP_BUY_MIN_REP, 'group-buy access'],
    [FIRST_REFUSAL_REP, 'estate first-refusal'],
    [SHIP_FIRST_REP, 'ship-first trade trust'],
  ]
  const next = ladders.find(([at]) => rep < at)
  return {
    tier,
    groupBuys: rep >= GROUP_BUY_MIN_REP,
    firstRefusal: rep >= FIRST_REFUSAL_REP,
    shipFirst: rep >= SHIP_FIRST_REP,
    nextAt: next ? next[0] : null,
    nextLabel: next ? next[1] : null,
  }
}

/** Rep gains halve while the street's conviction flag is up — the forum can
 * see the fake-trade gossip too. */
function gainMultiplier(): number {
  return fakeNotoriety() >= 1 && getMeta('auth:suspicionUntil') ? 0.5 : 1
}

function addRep(n: number, why: string): void {
  const before = forumRep()
  const gained = Math.max(0, Math.round(n * gainMultiplier() * 10) / 10)
  if (gained <= 0) return
  const after = Math.min(100, before + gained)
  setMeta('forum:rep', String(round2(after)))
  const tierBefore = repTier()
  logActivity('forum', `💬 ${why} (+${gained} forum standing${gainMultiplier() < 1 ? ', halved — the street is watching' : ''})`)
  // unlock moments
  if (before < GROUP_BUY_MIN_REP && after >= GROUP_BUY_MIN_REP) logActivity('forum', '🔓 GROUP-BUY ACCESS unlocked — the forum will co-fund big lots with you now (🫂 Community → Group-buys).')
  if (before < FIRST_REFUSAL_REP && after >= FIRST_REFUSAL_REP) logActivity('forum', '🔓 ESTATE FIRST-REFUSAL unlocked — the heirs\' DMs reach you before a lot goes public, with a 1-day exclusive window.')
  if (before < SHIP_FIRST_REP && after >= SHIP_FIRST_REP) logActivity('forum', '🔓 SHIP-FIRST TRUST unlocked — trade partners mail you their card before you mail yours (Trading Post).')
  void tierBefore
}

const REPLY_LINES = [
  'actually the print line matters more than centering on that one',
  'those came in both glossy and matte — check the coating before you price it',
  'post better photos of the holo and someone here will buy it today',
  'the stamp on the back dates it — you have the earlier print run',
  'graded prices for that card are soft right now, sell it raw',
  'keep it in a sleeve, that one yellowed in three binders I know of',
]

const GUIDES = [
  { title: 'PSA label variations, a field guide', warmth: 3 },
  { title: 'How I spot resealed boosters (with photos)', warmth: 2 },
  { title: 'Every 1st Edition stamp position, WotC era', warmth: 2 },
  { title: 'The real cost of grading a $20 card', warmth: 1 },
  { title: 'Storage locker haul etiquette', warmth: 1 },
]

/** Post a pull from the collection — the forum loves pulls. Warmth scales the
 * rep; the card is named, never moved. */
export function postPull(inventoryId: number): { ok: true; warmth: number; rep: number; title: string } | { ok: false; error: string } {
  const row = db
    .prepare(`SELECT i.id, i.cost_basis, i.favorite, c.name, i.card_id FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ? AND i.status = 'collection'`)
    .get(inventoryId) as { id: number; cost_basis: number; favorite: number; name: string; card_id: string } | undefined
  if (!row) return { ok: false, error: 'That card is not in your collection' }
  const value = round2(row.cost_basis * 3) // the forum prices pulls by story, not by market
  const warmth = Math.min(5, 1 + Math.floor(value / 150) + (row.favorite ? 1 : 0))
  const day = gameDayKey()
  db.prepare(`INSERT INTO forum_posts (kind, title, body, card_name, card_id, warmth, day_key, created_at) VALUES ('pull', ?, ?, ?, ?, ?, ?, ?)`)
    .run(`Pulled a ${row.name} — found in the wild`, `Story time: ${row.name}, and yes it's staying in the binder.`, row.name, row.card_id, warmth, day, nowIso())
  const rep = 0.5 + warmth * 0.5
  addRep(rep, `Posted the ${row.name} pull — the thread earned ${'🔥'.repeat(warmth)}`)
  return { ok: true, warmth, rep, title: `Pulled a ${row.name}` }
}

/** Answer a newbie question — up to 3 per game-day, the classic rep farm. */
export function answerNewbie(): { ok: true; reply: string; rep: number } | { ok: false; error: string } {
  const day = gameDayKey()
  const today = db.prepare(`SELECT COUNT(*) AS n FROM forum_posts WHERE kind = 'reply' AND day_key = ?`).get(day) as { n: number }
  if (today.n >= 3) return { ok: false, error: 'The newbie bin is empty for today — you answered everyone already (3/day).' }
  const reply = REPLY_LINES[Math.floor(Math.random() * REPLY_LINES.length)]
  db.prepare(`INSERT INTO forum_posts (kind, title, body, warmth, day_key, created_at) VALUES ('reply', ?, ?, 0, ?, ?)`)
    .run('Newbie question answered', reply, day, nowIso())
  addRep(1, `Answered a newbie's question — "${reply}"`)
  return { ok: true, reply, rep: 1 }
}

/** Write a guide — once per game-day, high effort, high warmth. */
export function writeGuide(): { ok: true; title: string; warmth: number; rep: number } | { ok: false; error: string } {
  const day = gameDayKey()
  const today = db.prepare(`SELECT COUNT(*) AS n FROM forum_posts WHERE kind = 'guide' AND day_key = ?`).get(day) as { n: number }
  if (today.n >= 1) return { ok: false, error: 'You already posted a guide today — the sub has a quality bar.' }
  const g = GUIDES[Math.floor(Math.random() * GUIDES.length)]
  db.prepare(`INSERT INTO forum_posts (kind, title, body, warmth, day_key, created_at) VALUES ('guide', ?, 'Long-form post with photos and receipts.', ?, ?, ?)`)
    .run(g.title, g.warmth, day, nowIso())
  addRep(1 + g.warmth, `Wrote a guide — "${g.title}" earned ${'🔥'.repeat(g.warmth)}`)
  return { ok: true, title: g.title, warmth: g.warmth, rep: 1 + g.warmth }
}

// ---------------------------------------------------------------------------
// Group-buys — rep 10+: the forum co-funds a big card with you and splits the
// entry cost. You pay YOUR share up front, the card arrives on the game clock,
// and it lands straight in your binder (a forum co-buy, not a market buy).
// ---------------------------------------------------------------------------

const GROUPBUY_POOL = [
  { cardId: 'ecard2-149', name: 'Lugia', mult: 1.0 },      // e-Card Lugia — the forum's grail
  { cardId: 'swsh4-181', name: 'Beauty', mult: 0.35 },
  { cardId: 'base1-4', name: 'Charizard', mult: 1.2 },
  { cardId: 'neo1-7', name: 'Typhlosion', mult: 0.5 },
]

export function groupBuysOpen(): boolean {
  return forumRep() >= GROUP_BUY_MIN_REP
}

export function listGroupBuys(): { ok: true; buys: { id: number; cardName: string; totalCost: number; myShare: number; splitN: number; status: string; etaDays: number }[] } | { ok: false; error: string } {
  if (!groupBuysOpen()) return { ok: false, error: `Group-buys unlock at ${GROUP_BUY_MIN_REP} forum standing` }
  const buys = db.prepare(`SELECT * FROM forum_groupbuys WHERE status != 'delivered' ORDER BY id DESC LIMIT 10`).all() as { id: number; card_name: string; total_cost: number; my_share: number; split_n: number; status: string; eta_days: number }[]
  return {
    ok: true,
    buys: buys.map((b) => ({ id: b.id, cardName: b.card_name, totalCost: round2(b.total_cost), myShare: round2(b.my_share), splitN: b.split_n, status: b.status, etaDays: b.eta_days })),
  }
}

/** Start a group-buy: pick a target card, the forum splits the market cost. */
export function startGroupBuy(cardId: string): { ok: true; cardName: string; myShare: number; splitN: number } | { ok: false; error: string } {
  if (!groupBuysOpen()) return { ok: false, error: `Group-buys unlock at ${GROUP_BUY_MIN_REP} forum standing` }
  const open = db.prepare(`SELECT id FROM forum_groupbuys WHERE status = 'open'`).get()
  if (open) return { ok: false, error: 'One group-buy at a time — the last one has to land first' }
  const pool = GROUPBUY_POOL.find((p) => p.cardId === cardId)
  if (!pool) return { ok: false, error: 'No forum interest in that card right now — pick from the board' }
  const price = round2(Math.max(80, Number(getMeta(`simPrice:${cardId}`) ?? 0) || 250 * pool.mult))
  // The forum's appetite: 3–6 co-buyers, each covering an equal share.
  const splitN = 3 + Math.floor(Math.random() * 4)
  const myShare = round2(price / splitN)
  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < myShare) return { ok: false, error: `Your share is $${myShare.toFixed(2)} — not enough cash` }
  const eta = 2 + Math.floor(Math.random() * 2)
  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(myShare)
    db.prepare(`INSERT INTO forum_groupbuys (card_name, card_id, total_cost, my_share, split_n, status, eta_days, created_at, due_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
      .run(pool.name, pool.cardId, price, myShare, splitN, eta, nowIso(), new Date(Date.now() + eta * gameDayMs()).toISOString())
  })
  tx()
  logActivity('forum', `🫂 Group-buy started: ${pool.name}, ${splitN} collectors splitting $${price.toFixed(2)} — your share $${myShare.toFixed(2)}, arriving in ~${eta} game-days.`, -myShare)
  addRep(1, `Organized the ${pool.name} group-buy`)
  return { ok: true, cardName: pool.name, myShare, splitN }
}

/** Group-buy deliveries ride the game clock. */
export function forumTick(): void {
  const due = db.prepare(`SELECT * FROM forum_groupbuys WHERE status = 'open' AND due_at <= ?`).all(nowIso()) as { id: number; card_name: string; card_id: string | null; my_share: number; total_cost: number; split_n: number }[]
  for (const b of due) {
    const admit = db.prepare(`SELECT COUNT(*) AS n FROM inventory WHERE status = 'collection'`).get() as { n: number }
    void admit
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, cost_basis, acquired_via, status, graded_grade, fake_flag, is_fake, fake_revealed, auth_status, acquired_at)
        VALUES (?, 'normal', 'NM', 1, ?, 'forum_groupbuy', 'collection', NULL, 0, 0, 0, NULL, ?)`)
        .run(b.card_id, round2(b.total_cost), nowIso())
      db.prepare(`UPDATE forum_groupbuys SET status = 'delivered' WHERE id = ?`).run(b.id)
    })
    tx()
    logActivity('forum', `📦 The ${b.card_name} group-buy delivered — your co-buy lands in the binder at ${'$' + round2(b.total_cost).toFixed(2)} basis (${b.split_n} collectors split it, your share was ${'$' + round2(b.my_share).toFixed(2)}).`)
  }
}

// ---------------------------------------------------------------------------
// Estate first-refusal — rep 25+: when an estate listing is about to spawn,
// you get the DM first with a 1-game-day exclusive window.
// Wired from estatebuyout.spawnSale via the forum hook below.
// ---------------------------------------------------------------------------

export function firstRefusalOpen(): boolean {
  return forumRep() >= FIRST_REFUSAL_REP
}

/** Called by estatebuyout.spawnSale when a new listing is about to go public. */
export function offerFirstRefusal(saleId: number, sellerName: string, ask: number, cardCount: number): void {
  if (!firstRefusalOpen()) return
  const day = gameDayKey()
  if (getMeta('forum:refusalDay') === day) return // one DM per game-day
  setMeta('forum:refusalDay', day)
  setMeta('forum:refusalSale', String(saleId))
  setMeta('forum:refusalUntil', String(Date.now() + gameDayMs()))
  logActivity('forum', `📩 FIRST REFUSAL: ${sellerName}'s estate (${cardCount} cards, asking $${ask.toFixed(2)}) is about to go public — the heirs heard you're good people. You have until tomorrow before everyone else sees it. (📑 Estate Buyouts — it's on the board now, and it's yours if you move.)`)
}

/** Is the first-refusal window live for this sale? */
export function refusalWindowFor(saleId: number): boolean {
  if (!firstRefusalOpen()) return false
  if (getMeta('forum:refusalSale') !== String(saleId)) return false
  const until = Number(getMeta('forum:refusalUntil') ?? '0')
  return until > Date.now()
}

// ---------------------------------------------------------------------------
// Ship-first trade trust — rep 40+: the Trading Post's escrow anxiety ends.
// The trade service reads this flag and lets the partner ship first.
// ---------------------------------------------------------------------------

export function shipFirstOpen(): boolean {
  return forumRep() >= SHIP_FIRST_REP
}

// ---------------------------------------------------------------------------
// Read model — the 🫂 Community view.
// ---------------------------------------------------------------------------

export function section() {
  const rep = forumRep()
  const tier = repTier()
  const posts = db.prepare(`SELECT id, kind, title, body, card_name, warmth, created_at FROM forum_posts ORDER BY id DESC LIMIT 12`).all() as { id: number; kind: string; title: string; body: string | null; card_name: string | null; warmth: number; created_at: string }[]
  const today = gameDayKey()
  const repliesToday = db.prepare(`SELECT COUNT(*) AS n FROM forum_posts WHERE kind = 'reply' AND day_key = ?`).get(today) as { n: number }
  const guideToday = db.prepare(`SELECT COUNT(*) AS n FROM forum_posts WHERE kind = 'guide' AND day_key = ?`).get(today) as { n: number }
  const buys = db.prepare(`SELECT id, card_name, card_id, total_cost, my_share, split_n, status, eta_days FROM forum_groupbuys WHERE status != 'delivered' ORDER BY id DESC`).all() as { id: number; card_name: string; card_id: string | null; total_cost: number; my_share: number; split_n: number; status: string; eta_days: number }[]
  const delivered = db.prepare(`SELECT COUNT(*) AS n FROM forum_groupbuys WHERE status = 'delivered'`).get() as { n: number }
  const streetHot = fakeNotoriety() >= 1 && !!getMeta('auth:suspicionUntil')
  return {
    rep,
    ...tier,
    posts: posts.map((p) => ({ id: p.id, kind: p.kind, title: p.title, body: p.body, cardName: p.card_name, warmth: p.warmth, createdAt: p.created_at })),
    repliesToday: repliesToday.n,
    guideToday: guideToday.n,
    groupBuyList: buys.map((b) => ({ id: b.id, cardName: b.card_name, cardId: b.card_id, totalCost: round2(b.total_cost), myShare: round2(b.my_share), splitN: b.split_n, status: b.status as 'open' | 'filled', etaDays: b.eta_days })),
    deliveredBuys: delivered.n,
    streetHot,
    thresholds: { groupBuy: GROUP_BUY_MIN_REP, firstRefusal: FIRST_REFUSAL_REP, shipFirst: SHIP_FIRST_REP },
  }
}
