import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { gameDayMs } from '../lib/gameday'
import { resolvePrice, gradedPriceOf, round2, type Condition } from './market'
import * as sealed from './sealed'
import * as pnl from './pnl'
import * as vault from './vault'

// ---------------------------------------------------------------------------
// FACEBOOK MARKETPLACE & CRAIGSLIST — the wild west. No storefront, no fees,
// no protection. NPC locals list whatever they've got at whatever number they
// woke up believing: some clueless, some scam-adjacent. Meet in a parking lot,
// cash in hand, no recourse.
//
//   • Listings spawn continuously from real synced cards, asks 0.15×–3× the
//     real market at condition — a wider spread than any regulated surface.
//   • The "too good to be true" tell: deep deals over 10% of market carry a
//     counterfeit chance that scales with the discount. Buy it cheap enough
//     and you might be the mark. Detected fakes are sellable ONLY to buylist
//     shops at $1 flat.
//   • Meetups: cash in hand. 1-in-8 no-shows (ghosted), ~1-in-25 "sorry, sold
//     locally already" (a real buyer took it between message and lot), and
//     grumpy-haggler NPCs counter once ~30% of the time.
//   • Your own listings: post any raw collection card (one sale path at a
//     time, enforced against BidBay/shop/auctions). Local buyers message you:
//     full-price takers, lowballs at midnight, and ghosts. A meeting pings
//     you — accept and they show (mostly). Your sale is cash, in person, off
//     the books (no platform fee; this is a personal sale, not shop revenue).
// ---------------------------------------------------------------------------


const FAKE_VALUE = 1 // detected counterfeit: buylist shops pay a flat dollar

/** The raw local_listings row — resolution to a display shape happens in describe(). */
export type LocalRow = {
  id: number
  card_id: string | null
  kind: LocalKind
  item_ref: string | null
  item_json: string | null
  variant: string
  condition: Condition
  ask: number
  anchor_at_spawn: number
  seller: string
  source: 'facebook' | 'craigslist' | 'mine'
  inventory_id: number | null
  posted_at: string
  expires_at: string
  counter_offer: number | null
  counter_of: number | null
  ghosted: number
  is_fake: number
  sold: number
  sold_at: string | null
}

// A listing can be anything the locals will carry — raw cardboard, a sealed
// box, a lot, a mystery. That needs card_id nullable, and SQLite cannot drop
// NOT NULL with ALTER, so an old save gets the one-time 12-step rebuild. Ids
// are preserved verbatim: the buyer-message meta keys are `local:msg:<id>` and
// every live listing's message thread would otherwise be orphaned.
export function ensureColumns() {
  const info = db.prepare(`PRAGMA table_info(local_listings)`).all() as { name: string; notnull: number }[]
  const cols = info.map((c) => c.name)
  const cardId = info.find((c) => c.name === 'card_id')
  // Already current shape — card_id nullable AND the kind columns present.
  if (cardId && cardId.notnull === 0 && cols.includes('kind')) return

  // Carry over only what this save's table actually has, so a v0.x table
  // missing counter_of/ghosted still migrates.
  const carries = [
    'id', 'card_id', 'variant', 'condition', 'ask', 'anchor_at_spawn', 'seller', 'source',
    'inventory_id', 'posted_at', 'expires_at', 'counter_offer', 'counter_of', 'ghosted',
    'is_fake', 'sold', 'sold_at',
  ].filter((c) => cols.includes(c))

  const ddl = `
    CREATE TABLE local_listings_next (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT REFERENCES cards(id),
      variant TEXT NOT NULL DEFAULT 'normal',
      condition TEXT NOT NULL DEFAULT 'NM',
      ask REAL NOT NULL,
      anchor_at_spawn REAL NOT NULL,
      seller TEXT NOT NULL,
      source TEXT NOT NULL,
      inventory_id INTEGER,
      posted_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      counter_offer REAL,
      counter_of REAL,
      ghosted INTEGER NOT NULL DEFAULT 0,
      is_fake INTEGER NOT NULL DEFAULT 0,
      sold INTEGER NOT NULL DEFAULT 0,
      sold_at TEXT,
      kind TEXT NOT NULL DEFAULT 'card',
      item_ref TEXT,
      item_json TEXT
    );
    INSERT INTO local_listings_next (${carries.join(', ')}) SELECT ${carries.join(', ')} FROM local_listings;
    DROP TABLE local_listings;
    ALTER TABLE local_listings_next RENAME TO local_listings;
    CREATE INDEX idx_local_live ON local_listings (sold, expires_at);
  `
  // foreign_keys must be OFF across a DROP+RENAME, and that pragma is a no-op
  // inside a transaction — so this runs bare, not in db.transaction().
  db.pragma('foreign_keys = OFF')
  try {
    db.exec(ddl)
  } finally {
    db.pragma('foreign_keys = ON')
  }
}
ensureColumns()

// ---------------------------------------------------------------------------
// Spawning — the local feed.
// ---------------------------------------------------------------------------

const FB_NAMES = ['Mike (no scams)', 'Dave', 'Karen H.', 'Local Dad', 'HobbyHoarder88', 'Jess', 'Frank', 'TonyTwoSleeves', 'Craigslist Carl', 'anonymous user']
const MEET_SPOTS = ['the Walmart lot', 'the bank parking lot', 'the gas station on Route 9', 'the mall food court', 'the library steps']

function anchorOf(cardId: string, condition: Condition): number {
  return resolvePrice(cardId, 'normal', condition).usd ?? 0
}

// ---------------------------------------------------------------------------
// WHAT A LISTING CAN BE.
//
// Raw cardboard is only one of the things the locals move. The feed also
// carries sealed product, disclosed card lots and blind buys:
//
//   card          one raw card                  card_id
//   sealed        pack / bundle / ETB / box      item_ref → pack_products.id
//   bundle        a lot you can read             item_json { items: [...] }
//   mystery_slab  an unrevealed graded slab      item_json { card_id, grade }
//   mystery_box   an unrevealed box of cards     item_json { items: [...] }
//
// Mystery contents are rolled WHEN THE SELLER POSTS, never at purchase, so
// anchor_at_spawn is the true value of what is inside. The ask can then be
// compared honestly against it — a dream price on a mystery is a real signal
// rather than a coin flip — while the contents stay undisclosed until the meet.
// ---------------------------------------------------------------------------

export type LocalKind = 'card' | 'sealed' | 'bundle' | 'mystery_slab' | 'mystery_box'

export const KIND_LABEL: Record<LocalKind, string> = {
  card: 'Single card',
  sealed: 'Sealed product',
  bundle: 'Card lot',
  mystery_slab: 'Mystery slab',
  mystery_box: 'Mystery box',
}

const SEALED_LABEL: Record<string, string> = {
  booster: 'Booster pack',
  bundle: 'Bundle',
  etb: 'Elite Trainer Box',
  display: 'Display box',
  special: 'Special collection',
}

type LotItem = { card_id: string; condition: Condition }
type SlabRoll = { card_id: string; grade: string }

function parseLot(json: string | null): LotItem[] {
  if (!json) return []
  try {
    const o = JSON.parse(json) as { items?: LotItem[] }
    return Array.isArray(o?.items) ? o.items : []
  } catch {
    return []
  }
}

function parseSlab(json: string | null): SlabRoll | null {
  if (!json) return null
  try {
    const o = JSON.parse(json) as SlabRoll
    return o && o.card_id ? o : null
  } catch {
    return null
  }
}

type ProductRow = { name: string; kind: string; packs: number | null; image_url: string | null }
function productOf(id: string): ProductRow | undefined {
  return db.prepare(`SELECT name, kind, packs, image_url FROM pack_products WHERE id = ?`).get(id) as ProductRow | undefined
}

type CardInfo = { id: string; name: string; image_small: string | null; set_name: string | null }
/** One query for every card the feed touches — singles, lot members, hidden contents. */
function cardInfo(ids: (string | null)[]): Map<string, CardInfo> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))]
  const out = new Map<string, CardInfo>()
  if (uniq.length === 0) return out
  const stmt = db.prepare(
    `SELECT c.id, c.name, c.image_small, s.name AS set_name
     FROM cards c LEFT JOIN sets s ON s.id = c.set_id
     WHERE c.id IN (${uniq.map(() => '?').join(',')})`,
  )
  for (const r of stmt.all(...uniq) as CardInfo[]) out.set(r.id, r)
  return out
}

export type FeedRow = {
  id: number
  kind: LocalKind
  kindLabel: string
  cardId: string | null
  name: string
  image: string | null
  imageCardId: string | null
  condition: string
  setName: string | null
  detail: string | null
  /** Card names for a disclosed lot; null for mysteries and singles. */
  contents: { name: string; condition: string }[] | null
  /** 'mkt' = live market value; 'est' = an estimate of undisclosed contents. */
  anchorLabel: 'mkt' | 'est'
  ask: number
  anchor: number
  seller: string
  source: 'facebook' | 'craigslist'
  postedAt: string
  expiresAt: string
  delta: number
  tell: '🐟' | '🤔' | null
  counterOffer: number | null
  counterOf: number | null
  ghosted: boolean
}

const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1))

export function spawnPass() {
  // Keep the feed stocked: ~6 rows, older ones culled on expiry.
  const live = (db.prepare('SELECT COUNT(*) n FROM local_listings WHERE sold = 0 AND expires_at > ?').get(nowIso()) as { n: number }).n
  if (live >= 6) return 0
  const want = 2

  const pool = db
    .prepare(
      `WITH latest AS (
         SELECT card_id, market,
                ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY retrieved_at DESC) rn
         FROM price_records WHERE kind = 'tcgplayer' AND market IS NOT NULL
       )
       SELECT c.id, c.name, l.market FROM latest l JOIN cards c ON c.id = l.card_id
       WHERE l.rn = 1 AND l.market BETWEEN 0.25 AND 300 ORDER BY RANDOM() LIMIT ?`,
    )
    .all(want * 40) as { id: string; name: string; market: number }[]
  if (pool.length < 20) return 0

  const insert = db.prepare(
    `INSERT INTO local_listings
       (card_id, variant, condition, ask, anchor_at_spawn, seller, source, posted_at, expires_at, is_fake, kind, item_ref, item_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const expiresAt = () => new Date(Date.now() + (1.5 + Math.random() * 2.5) * gameDayMs()).toISOString()
  const seller = () => FB_NAMES[Math.floor(Math.random() * FB_NAMES.length)]
  const source = (): 'facebook' | 'craigslist' => (Math.random() < 0.5 ? 'facebook' : 'craigslist')
  const conds: Condition[] = ['NM', 'LP', 'MP', 'HP']

  // The wild-west spread, shared by every kind: most asks wander around
  // value, but the tails are long — clueless (under) and dreamers (way over).
  const wildAsk = (anchor: number) => {
    const roll = Math.random()
    const mult = roll < 0.22 ? 0.15 + Math.random() * 0.35
      : roll < 0.7 ? 0.55 + Math.random() * 0.7
      : 1.3 + Math.random() * 1.7
    return { ask: Math.max(0.5, round2(anchor * mult)), mult }
  }

  const rollKind = (): LocalKind => {
    const r = Math.random()
    if (r < 0.5) return 'card'
    if (r < 0.72) return 'sealed'
    if (r < 0.84) return 'bundle'
    if (r < 0.92) return 'mystery_slab'
    return 'mystery_box'
  }

  let made = 0
  for (let i = 0; i < want; i++) {
    const kind = rollKind()

    if (kind === 'card') {
      const c = pool[Math.floor(Math.random() * pool.length)]
      const condition = conds[Math.floor(Math.random() * conds.length)]
      const anchor = anchorOf(c.id, condition)
      if (anchor < 0.5) continue
      const { ask, mult } = wildAsk(anchor)
      // Counterfeit risk: only the too-good zone is dangerous, scaling with depth.
      const fakeChance = mult < 0.5 ? Math.min(0.65, (0.5 - mult) * 1.4 + 0.05) : 0
      insert.run(c.id, 'normal', condition, ask, anchor, seller(), source(), nowIso(), expiresAt(),
        fakeChance > 0 && Math.random() < fakeChance ? 1 : 0, 'card', null, null)
      made++
      continue
    }

    if (kind === 'sealed') {
      // Only products that carry real wrapper art — a sealed tile with no
      // photo would otherwise fall back to the mystery card back and imply
      // the contents are hidden, which for a sealed box is simply untrue.
      const p = db.prepare(`SELECT id FROM pack_products WHERE image_url IS NOT NULL AND image_url != '' ORDER BY RANDOM() LIMIT 1`).get() as { id: string } | undefined
      if (!p) continue
      const anchor = round2(sealed.priceDetail(p.id).market)
      // Sealed has no price band of its own, so bound it here: a parking-lot
      // feed listing a five-figure vintage display box reads as a sim artifact,
      // not as a wild-west seller.
      if (anchor < 2 || anchor > 500) continue
      const { ask } = wildAsk(anchor)
      insert.run(null, 'normal', '', ask, anchor, seller(), source(), nowIso(), expiresAt(), 0, 'sealed', p.id, null)
      made++
      continue
    }

    if (kind === 'bundle' || kind === 'mystery_box') {
      const n = kind === 'bundle' ? randInt(3, 8) : randInt(6, 14)
      const items: LotItem[] = []
      const used = new Set<string>()
      let anchor = 0
      for (let k = 0; k < n; k++) {
        const c = pool[Math.floor(Math.random() * pool.length)]
        if (used.has(c.id)) continue
        const condition = conds[Math.floor(Math.random() * conds.length)]
        const a = anchorOf(c.id, condition)
        if (a <= 0) continue
        used.add(c.id)
        items.push({ card_id: c.id, condition })
        anchor += a
      }
      if (items.length < (kind === 'bundle' ? 3 : 5)) continue
      anchor = round2(anchor)
      const { ask } = wildAsk(anchor)
      insert.run(null, 'normal', '', ask, anchor, seller(), source(), nowIso(), expiresAt(), 0, kind, null,
        JSON.stringify({ items }))
      made++
      continue
    }

    // mystery_slab — bagged by someone who never had it graded.
    const c = pool[Math.floor(Math.random() * pool.length)]
    const GRADES = ['PSA4', 'PSA5', 'PSA6', 'PSA7', 'PSA8', 'PSA8', 'PSA9', 'PSA9', 'PSA10', 'BGS8', 'BGS9', 'CGC8', 'CGC9', 'SGC7', 'SGC9']
    const grade = GRADES[Math.floor(Math.random() * GRADES.length)]
    const anchor = round2(gradedPriceOf(c.id, grade).usd || 0)
    if (anchor < 1) continue
    const { ask } = wildAsk(anchor)
    insert.run(null, 'normal', '', ask, anchor, seller(), source(), nowIso(), expiresAt(), 0, 'mystery_slab', null,
      JSON.stringify({ card_id: c.id, grade }))
    made++
  }
  return made
}

/** The tell the UI is allowed to show: discount depth as an emoji risk hint. */
function tellFor(ask: number, anchor: number): '🐟' | '🤔' | null {
  if (anchor <= 0) return null
  const ratio = ask / anchor
  if (ratio < 0.25) return '🐟' // smells fishy
  if (ratio < 0.5) return '🤔' // suspicious
  return null
}

// ---------------------------------------------------------------------------
// Reading the feed.
// ---------------------------------------------------------------------------

export function feed(): FeedRow[] {
  spawnPass()
  const rows = db
    .prepare(`SELECT * FROM local_listings WHERE sold = 0 AND expires_at > ? ORDER BY posted_at DESC LIMIT 30`)
    .all(nowIso()) as LocalRow[]

  const ids: (string | null)[] = []
  for (const r of rows) {
    ids.push(r.card_id)
    if (r.kind === 'bundle' || r.kind === 'mystery_box') ids.push(...parseLot(r.item_json).map((l) => l.card_id))
    if (r.kind === 'mystery_slab') ids.push(parseSlab(r.item_json)?.card_id ?? null)
  }
  const cards = cardInfo(ids)
  return rows.map((r) => describe(r, cards)).filter((x): x is FeedRow => x !== null)
}

function describe(r: LocalRow, cards: Map<string, CardInfo>): FeedRow | null {
  const kind: LocalKind = (r.kind ?? 'card') as LocalKind
  const anchor = r.anchor_at_spawn
  const base = (over: Partial<FeedRow>): FeedRow => ({
    id: r.id,
    kind,
    kindLabel: KIND_LABEL[kind] ?? 'Listing',
    cardId: r.card_id,
    name: '',
    image: null,
    imageCardId: null,
    condition: r.condition,
    setName: null,
    detail: null,
    contents: null,
    anchorLabel: 'mkt',
    ask: r.ask,
    anchor: round2(anchor),
    seller: r.seller,
    source: r.source as 'facebook' | 'craigslist',
    postedAt: r.posted_at,
    expiresAt: r.expires_at,
    delta: anchor > 0 ? round2(r.ask / anchor - 1) : 0,
    tell: tellFor(r.ask, anchor),
    counterOffer: r.counter_offer,
    counterOf: r.counter_of,
    ghosted: !!r.ghosted,
    ...over,
  })

  if (kind === 'card') {
    const c = r.card_id ? cards.get(r.card_id) : undefined
    if (!c) return null
    return base({ name: c.name, image: c.image_small, imageCardId: c.id, setName: c.set_name })
  }

  if (kind === 'sealed') {
    const p = r.item_ref ? productOf(r.item_ref) : undefined
    if (!p) return null
    const label = SEALED_LABEL[p.kind] ?? 'Sealed product'
    const packs = p.kind === 'booster' || !p.packs ? 1 : Math.max(1, p.packs)
    return base({
      name: p.name,
      image: p.image_url,
      condition: '',
      setName: label,
      detail: `${label} · ${packs} pack${packs === 1 ? '' : 's'}`,
    })
  }

  if (kind === 'bundle') {
    const items = parseLot(r.item_json)
    if (items.length === 0) return null
    const first = cards.get(items[0].card_id)
    return base({
      name: `${items.length}-card lot`,
      image: first?.image_small ?? null,
      imageCardId: first?.id ?? null,
      condition: '',
      detail: `${items.length} cards · contents listed`,
      contents: items.map((i) => ({ name: cards.get(i.card_id)?.name ?? 'Unknown card', condition: i.condition })),
    })
  }

  if (kind === 'mystery_slab') {
    if (!parseSlab(r.item_json)) return null
    return base({ name: 'Mystery slab', condition: '', anchorLabel: 'est', detail: 'Graded slab · grade undisclosed' })
  }

  const items = parseLot(r.item_json)
  if (items.length === 0) return null
  return base({ name: `Mystery box · ${items.length} cards`, condition: '', anchorLabel: 'est', detail: 'Contents undisclosed' })
}

// ---------------------------------------------------------------------------
// Buying: message → meetup → cash.
// ---------------------------------------------------------------------------

/** What was actually in the bag — handed over only at the meet, so the UI
 *  can stage the unboxing instead of burying the reveal in a text line. */
export type RevealCard = {
  cardId: string
  name: string
  image: string | null
  set: string | null
  rarity: string | null
  condition: string
  value: number
  grade?: string
}
export type Reveal = {
  kind: 'mystery_slab' | 'mystery_box'
  paid: number
  total: number
  items: RevealCard[]
}

export type MeetResult =
  | { ok: true; outcome: 'bought' | 'sold'; paid: number; card?: string; inspected?: 'genuine' | 'fake'; basis?: number; message?: string; reveal?: Reveal }
  | { ok: true; outcome: 'ghosted'; message: string }
  | { ok: true; outcome: 'sold_elsewhere'; message: string }
  | { ok: true; outcome: 'counter'; counter: number; card: string; message: string }
  | { ok: false; error: string }

/** A human-readable name for the activity feed, per kind. */
function listingName(r: LocalRow): string {
  const kind = (r.kind ?? 'card') as LocalKind
  if (kind === 'card') {
    const row = r.card_id ? (db.prepare('SELECT name FROM cards WHERE id = ?').get(r.card_id) as { name: string } | undefined) : undefined
    return row?.name ?? 'a card'
  }
  if (kind === 'sealed') return productOf(r.item_ref ?? '')?.name ?? 'a sealed product'
  if (kind === 'bundle') return `a lot of ${parseLot(r.item_json).length} cards`
  if (kind === 'mystery_slab') return 'a mystery slab'
  return `a mystery box (${parseLot(r.item_json).length} cards)`
}

export function meet(listingId: number, offered?: number): MeetResult {
  const r = db.prepare(`SELECT * FROM local_listings WHERE id = ? AND sold = 0`).get(listingId) as LocalRow | undefined
  if (!r || r.expires_at <= nowIso()) return { ok: false, error: 'That listing is gone.' }
  const price = offered != null && offered > 0 ? round2(offered) : r.ask
  const name = listingName(r)

  // A counter that's still open resolves on this meet.
  if (r.counter_offer != null && offered == null) return { ok: false, error: `They're holding at $${r.counter_offer.toFixed(2)} — pay it or move on.` }

  // The dice of the parking lot.
  const roll = Math.random()
  if (roll < 0.12) {
    db.prepare('UPDATE local_listings SET ghosted = ghosted + 1 WHERE id = ?').run(listingId)
    logActivity('local', `💬 ${r.seller} never showed at ${MEET_SPOTS[Math.floor(Math.random() * MEET_SPOTS.length)]}. Left you on read since.`)
    return { ok: true, outcome: 'ghosted', message: `${r.seller} never showed. Left on read.` }
  }
  if (roll < 0.16) {
    db.prepare('UPDATE local_listings SET sold = 1, sold_at = ? WHERE id = ?').run(nowIso(), listingId)
    logActivity('local', `💬 ${r.seller}: "sorry sold it locally already" — someone got there first.`)
    return { ok: true, outcome: 'sold_elsewhere', message: '"Sorry, sold it locally already." Someone got there first.' }
  }
  if (offered != null && offered < r.ask && r.counter_of == null && roll < 0.45) {
    const counter = round2((price + r.ask) / 2)
    db.prepare('UPDATE local_listings SET counter_offer = ?, counter_of = ? WHERE id = ?').run(counter, price, listingId)
    return { ok: true, outcome: 'counter', counter, card: name, message: `${r.seller}: "Meet me at $${counter.toFixed(2)} and it's yours."` }
  }

  // Sold — cash changes hands. What lands in your hands depends on the kind.
  const kind = (r.kind ?? 'card') as LocalKind
  const lot = kind === 'bundle' || kind === 'mystery_box' ? parseLot(r.item_json) : []
  const slab = kind === 'mystery_slab' ? parseSlab(r.item_json) : null
  if (kind === 'card' && !r.card_id) return { ok: false, error: 'That listing is broken.' }
  if (kind === 'bundle' && lot.length === 0) return { ok: false, error: 'That lot is empty.' }
  if (kind === 'mystery_slab' && !slab) return { ok: false, error: 'That slab is unaccounted for.' }
  if (kind === 'mystery_box' && lot.length === 0) return { ok: false, error: 'That box is empty.' }

  const isFake = kind === 'card' && !!r.is_fake
  // How many binder slots this meet has to have free — a lot or a box takes many.
  const rawCount = kind === 'card' ? 1 : kind === 'sealed' ? 0 : kind === 'mystery_slab' ? 1 : lot.length

  const state = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number }
  if (state.cash < price) return { ok: false, error: 'Not enough cash on you.' }
  // Storage & the vault: no trunk space, no deal (unless auto-scrap makes some).
  if (rawCount > 0) {
    const admit = vault.admitRawFor(rawCount, 'Parking-lot deal')
    if (!admit.ok) return { ok: false, error: admit.error }
  }

  const delivered: number[] = []
  const insertRaw = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, acquired_ref, cost_basis, acquired_at, is_fake, graded_grade)
     VALUES (?, ?, ?, 1, 'collection', 'local_deal', ?, ?, ?, ?, ?)`,
  )
  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(price)
    if (kind === 'card') {
      delivered.push(Number(insertRaw.run(r.card_id, r.variant, r.condition, String(r.id), price, nowIso(), isFake ? 1 : 0, null).lastInsertRowid))
    } else if (kind === 'sealed') {
      // Sealed has no binder row to reserve — the unit joins the shelf directly.
      db.prepare(`INSERT INTO sealed_inventory (product_id, quantity, cost, acquired_at) VALUES (?, 1, ?, ?)`).run(r.item_ref, price, nowIso())
    } else if (kind === 'mystery_slab' && slab) {
      delivered.push(Number(insertRaw.run(slab.card_id, 'normal', 'NM', String(r.id), price, nowIso(), 0, slab.grade).lastInsertRowid))
    } else {
      const each = round2(price / lot.length)
      for (const it of lot) delivered.push(Number(insertRaw.run(it.card_id, 'normal', it.condition, String(r.id), each, nowIso(), 0, null).lastInsertRowid))
    }
    db.prepare('UPDATE local_listings SET sold = 1, sold_at = ? WHERE id = ?').run(nowIso(), listingId)
  })
  tx()

  // Belt-and-suspenders: the meet reveals the pre-rolled fakes, and the
  // authentication meta can still stamp a hidden risk on the ones that passed
  // the corner test (high-value wide-buy chance, auth.ts). Blind buys roll the
  // mystery risk profile — auth.ts rates counterfeits far hotter out of a box
  // than off a storefront.
  const via = kind === 'mystery_box' ? 'mystery_box' : kind === 'mystery_slab' ? 'mystery_slab' : 'local_deal'
  for (const invId of delivered) {
    const row = db.prepare('SELECT card_id, variant, condition FROM inventory WHERE id = ?').get(invId) as
      | { card_id: string; variant: string; condition: Condition }
      | undefined
    if (!row) continue
    const blind = kind === 'mystery_box'
    if (kind === 'mystery_slab') continue // already graded — nothing hidden to stamp
    if (!isFake || blind) import('./auth').then((a) => a.stampRisk(invId, row.card_id, row.variant, row.condition, via)).catch(() => {})
  }

  const basis = price
  const what = kind === 'card' ? `${name} (${r.condition})` : name
  if (isFake) {
    logActivity('local', `🃏 Paid ${r.seller} $${price.toFixed(2)} for "${name}" — and the second you held it, the corners told the truth: COUNTERFEIT. Real one sells for ${fmt(r.anchor_at_spawn)}. Buylist shops pay a flat $${FAKE_VALUE} for fake cardboard.`, -price)
  } else {
    const verdict = price < r.anchor_at_spawn * 0.75 ? 'The deal of the week.' : price > r.anchor_at_spawn * 1.3 ? 'Overpaid like a tourist.' : 'About right for a parking-lot deal.'
    const reveal = kind === 'mystery_slab' && slab ? ` — it was a ${slab.grade}` : kind === 'mystery_box' ? ` — inside: ${lot.length} cards` : ''
    logActivity('buy', `Met ${r.seller} (found via ${r.source}) and paid $${price.toFixed(2)} cash for ${what}${reveal}. ${verdict}`, -price)
  }
  const reveal = isFake ? undefined : revealOf(kind, lot, slab, price, r.anchor_at_spawn)
  return { ok: true, outcome: 'bought', paid: price, card: name, inspected: isFake ? 'fake' : 'genuine', basis, reveal }
}

/**
 * Build the reveal payload for a blind buy. The contents were rolled at post
 * time, so this is a read of what is already decided — never a roll made
 * after the cash moved.
 */
function revealOf(kind: LocalKind, lot: LotItem[], slab: SlabRoll | null, paid: number, anchor: number): Reveal | undefined {
  if (kind === 'mystery_slab') {
    if (!slab) return undefined
    const row = db
      .prepare(`SELECT c.id, c.name, c.image_large, c.image_small, c.rarity, s.name AS set_name
                FROM cards c LEFT JOIN sets s ON s.id = c.set_id WHERE c.id = ?`)
      .get(slab.card_id) as { id: string; name: string; image_large: string | null; image_small: string | null; rarity: string | null; set_name: string | null } | undefined
    if (!row) return undefined
    return {
      kind: 'mystery_slab',
      paid: round2(paid),
      total: round2(anchor),
      items: [{
        cardId: row.id, name: row.name, image: row.image_large ?? row.image_small,
        set: row.set_name, rarity: row.rarity, condition: 'NM', value: round2(anchor), grade: slab.grade,
      }],
    }
  }
  if (kind !== 'mystery_box' || lot.length === 0) return undefined
  const ids = [...new Set(lot.map((l) => l.card_id))]
  const rows = db
    .prepare(`SELECT c.id, c.name, c.image_large, c.image_small, c.rarity, s.name AS set_name
              FROM cards c LEFT JOIN sets s ON s.id = c.set_id
              WHERE c.id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as { id: string; name: string; image_large: string | null; image_small: string | null; rarity: string | null; set_name: string | null }[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  const items: RevealCard[] = []
  for (const it of lot) {
    const row = byId.get(it.card_id)
    if (!row) continue
    items.push({
      cardId: row.id, name: row.name, image: row.image_large ?? row.image_small,
      set: row.set_name, rarity: row.rarity, condition: it.condition,
      value: round2(anchorOf(it.card_id, it.condition)),
    })
  }
  if (items.length === 0) return undefined
  return {
    kind: 'mystery_box',
    paid: round2(paid),
    total: round2(items.reduce((sum, i) => sum + i.value, 0)),
    items,
  }
}

function fmt(n: number): string {
  return `$${round2(n).toFixed(2)}`
}

// ---------------------------------------------------------------------------
// Selling: your own listings + the messages that arrive.
// ---------------------------------------------------------------------------

/** One INSERT for every kind of post — the seller is always 'you'. */
function postListing(a: {
  kind: LocalKind
  ask: number
  anchor: number
  cardId?: string | null
  variant?: string
  condition?: string
  itemRef?: string | null
  itemJson?: string | null
  inventoryId?: number | null
}) {
  db.prepare(
    `INSERT INTO local_listings
       (card_id, variant, condition, ask, anchor_at_spawn, seller, source, inventory_id, posted_at, expires_at, is_fake, kind, item_ref, item_json)
     VALUES (?, ?, ?, ?, ?, 'you', 'mine', ?, ?, ?, 0, ?, ?, ?)`,
  ).run(
    a.cardId ?? null, a.variant ?? 'normal', a.condition ?? '', round2(a.ask), round2(a.anchor),
    a.inventoryId ?? null, nowIso(), new Date(Date.now() + 3 * gameDayMs()).toISOString(),
    a.kind, a.itemRef ?? null, a.itemJson ?? null,
  )
}

const NOT_YET = (ask: number): { ok: boolean; error?: string } =>
  ask > 0 ? { ok: true } : { ok: false, error: 'Set an ask first' }

const SITE = () => (Math.random() < 0.5 ? 'Facebook Marketplace' : 'Craigslist')

export function listMine(inventoryId: number, ask: number): { ok: boolean; error?: string } {
  const row = db.prepare(`SELECT * FROM inventory WHERE id = ? AND status = 'collection'`).get(inventoryId) as
    | { id: number; card_id: string; variant: string; condition: string; quantity: number; graded_grade: string | null; is_fake: number; fake_revealed: number } | undefined
  if (!row) return { ok: false, error: 'Card is not in your collection' }
  if (row.graded_grade) return { ok: false, error: 'Graded slabs sell at the auction house — the locals want raw cardboard' }
  // AUTH META: known fakes (corner-test or USPA verdict) stay off the feed —
  // the buylist training wall is the only market that will touch them.
  if (row.is_fake || row.fake_revealed) return { ok: false, error: 'Known counterfeit — buylist shops pay $1 flat for it (Inventory → 🛡 Authentication)' }
  const allowed = NOT_YET(ask)
  if (!allowed.ok) return allowed
  // One sale path at a time, same as BidBay.
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM local_listings WHERE inventory_id = ? AND sold = 0 AND expires_at > ?`).get(inventoryId, nowIso()) as { n: number }
  if (existing.n > 0) return { ok: false, error: 'That card is already posted locally' }
  db.prepare('UPDATE inventory SET status = ?, listing_price = ?, listed_at = ? WHERE id = ?').run('local_listed', round2(ask), nowIso(), row.id)
  postListing({ kind: 'card', ask, anchor: anchorOf(row.card_id, row.condition as Condition), cardId: row.card_id, variant: row.variant, condition: row.condition, inventoryId: row.id })
  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(row.card_id) as { name: string }).name
  logActivity('local', `Posted ${name} on ${SITE()} at $${round2(ask).toFixed(2)} — cash only, no scams, meet at a public lot.`)
  return { ok: true }
}

/** A sealed unit — pack, bundle, ETB or display box — straight off your shelf. */
export function listSealed(productId: string, ask: number): { ok: boolean; error?: string } {
  // Take the oldest free unit, exactly as the open-pack flow does — a unit
  // pledged to the loan desk is never sellable.
  const row = db
    .prepare(`SELECT * FROM sealed_inventory WHERE product_id = ? AND quantity > 0 AND escrow_loan IS NULL ORDER BY acquired_at ASC LIMIT 1`)
    .get(productId) as { id: number; product_id: string; quantity: number; escrow_loan: number | null } | undefined
  if (!row) return { ok: false, error: 'That sealed item is not on your shelf' }
  const allowed = NOT_YET(ask)
  if (!allowed.ok) return allowed
  const existing = db.prepare(`SELECT COUNT(*) n FROM local_listings WHERE inventory_id = ? AND sold = 0 AND expires_at > ?`).get(row.id, nowIso()) as { n: number }
  if (existing.n > 0) return { ok: false, error: 'That item is already posted locally' }
  const anchor = round2(sealed.priceDetail(row.product_id).market)
  postListing({ kind: 'sealed', ask, anchor, itemRef: row.product_id, inventoryId: row.id, condition: '' })
  const p = productOf(row.product_id)
  logActivity('local', `Posted ${p?.name ?? 'a sealed box'} on ${SITE()} at $${round2(ask).toFixed(2)} — sealed, cash only, meet at a public lot.`)
  return { ok: true }
}

/** A lot: several raw cards sold as one listing, reserved together. */
export function listBundle(inventoryIds: number[], ask: number): { ok: boolean; error?: string } {
  const ids = [...new Set(inventoryIds)]
  if (ids.length < 2) return { ok: false, error: 'A lot needs at least two cards' }
  const allowed = NOT_YET(ask)
  if (!allowed.ok) return allowed
  const marks = ids.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT id, card_id, variant, condition, graded_grade, is_fake, fake_revealed
     FROM inventory WHERE id IN (${marks}) AND status = 'collection'`,
  ).all(...ids) as { id: number; card_id: string; variant: string; condition: string; graded_grade: string | null; is_fake: number; fake_revealed: number }[]
  if (rows.length !== ids.length) return { ok: false, error: 'One of those cards already left your collection' }
  if (rows.some((r) => r.graded_grade)) return { ok: false, error: 'Graded slabs sell at the auction house — lots are raw cardboard' }
  if (rows.some((r) => r.is_fake || r.fake_revealed)) return { ok: false, error: 'A known counterfeit is in that pile — buylist shops pay $1 flat for it' }
  const existing = db.prepare(`SELECT COUNT(*) n FROM local_listings WHERE inventory_id IN (${marks}) AND sold = 0 AND expires_at > ?`).get(...ids, nowIso()) as { n: number }
  if (existing.n > 0) return { ok: false, error: 'A card in that lot is already posted locally' }

  const items = rows.map((r) => ({ card_id: r.card_id, condition: r.condition as Condition }))
  const anchor = round2(rows.reduce((sum, r) => sum + anchorOf(r.card_id, r.condition as Condition), 0))
  db.prepare(`UPDATE inventory SET status = 'local_listed', listing_price = ?, listed_at = ? WHERE id IN (${marks})`)
    .run(round2(ask), nowIso(), ...ids)
  postListing({ kind: 'bundle', ask, anchor, condition: '', inventoryId: ids[0], itemJson: JSON.stringify({ items, inventoryIds: ids }) })
  logActivity('local', `Posted a lot of ${rows.length} cards on ${SITE()} at $${round2(ask).toFixed(2)} — cash only, meet at a public lot.`)
  return { ok: true }
}

function bundleInventoryIds(r: LocalRow): number[] {
  if (!r.item_json) return []
  try {
    const o = JSON.parse(r.item_json) as { inventoryIds?: number[] }
    return Array.isArray(o.inventoryIds) ? o.inventoryIds : []
  } catch {
    return []
  }
}

/** Give an unsold listing back to the shelf. Sealed has no status column to reset. */
function freeListing(r: LocalRow) {
  const kind = (r.kind ?? 'card') as LocalKind
  const ids = kind === 'bundle' ? bundleInventoryIds(r) : r.inventory_id ? [r.inventory_id] : []
  if (ids.length === 0) return
  const marks = ids.map(() => '?').join(',')
  db.prepare(
    `UPDATE inventory SET status = 'collection', listing_price = NULL, listed_at = NULL WHERE id IN (${marks}) AND status = 'local_listed'`,
  ).run(...ids)
}

export function myListings() {
  const rows = db
    .prepare(`SELECT * FROM local_listings WHERE source = 'mine' AND sold = 0 AND expires_at > ?`)
    .all(nowIso()) as LocalRow[]
  const ids: (string | null)[] = []
  for (const r of rows) {
    ids.push(r.card_id)
    if ((r.kind ?? 'card') === 'bundle') ids.push(...parseLot(r.item_json).map((l) => l.card_id))
  }
  const cards = cardInfo(ids)
  return rows
    .map((r) => {
      const d = describe(r, cards)
      if (!d) return null
      return {
        id: r.id,
        kind: d.kind,
        kindLabel: d.kindLabel,
        name: d.name,
        image: d.image,
        imageCardId: d.imageCardId,
        condition: d.condition,
        detail: d.detail,
        contents: d.contents,
        ask: r.ask,
        postedAt: r.posted_at,
        expiresAt: r.expires_at,
        inventoryId: r.inventory_id,
        messages: messagesFor(r.id),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

type Msg = { kind: 'full' | 'lowball' | 'ghost' | 'meeting'; buyer: string; amount: number | null; note: string }

function messagesFor(listingId: number): Msg[] {
  return (JSON.parse(getMeta(`local:msg:${listingId}`) ?? '[]') as Msg[])
}

function pushMessage(listingId: number, m: Msg) {
  const all = messagesFor(listingId)
  all.unshift(m)
  setMeta(`local:msg:${listingId}`, JSON.stringify(all.slice(0, 6)))
}

export function cancelMine(listingId: number) {
  const r = db.prepare(`SELECT * FROM local_listings WHERE id = ? AND source = 'mine' AND sold = 0`).get(listingId) as LocalRow | undefined
  if (!r) return { ok: false as const, error: 'Listing not found.' }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE local_listings SET sold = 1, sold_at = ? WHERE id = ?`).run(nowIso(), listingId)
    freeListing(r)
  })
  tx()
  return { ok: true as const }
}

/** Re-relist a local listing whose expiry came and went (frees the binder rows). */
function expireMine() {
  const rows = db.prepare(`SELECT * FROM local_listings WHERE source = 'mine' AND sold = 0 AND expires_at <= ?`).all(nowIso()) as LocalRow[]
  for (const r of rows) {
    db.prepare(`UPDATE local_listings SET sold = 1, sold_at = ? WHERE id = ?`).run(nowIso(), r.id)
    freeListing(r)
  }
}

// ---------------------------------------------------------------------------
// The tick — spawns, expiries, and buyer messages on my listings.
// ---------------------------------------------------------------------------

const LOWBALL_NOTES = ['cash today, no questions', 'best I can do', 'taking a risk here at this price', "it's been listed for hours, brother"]
const FULL_NOTES = ["I'll take it, don't sell it to anyone else", 'can meet in 20', 'deal — where do I meet you?']

export function localTick() {
  expireMine()
  db.prepare(`UPDATE local_listings SET sold = 1, sold_at = ? WHERE source != 'mine' AND sold = 0 AND expires_at <= ?`).run(nowIso(), nowIso())
  spawnPass()

  // Buyer messages on my live listings — a couple per tick at most.
  const mine = db.prepare(`SELECT * FROM local_listings WHERE source = 'mine' AND sold = 0 AND expires_at > ?`).all(nowIso()) as LocalRow[]
  for (const l of mine) {
    if (Math.random() > 0.25) continue
    // Cards track their live market; everything else can only fall back to the
    // value it was posted at (no card_id to re-price).
    const anchor = l.card_id ? anchorOf(l.card_id, l.condition) : l.anchor_at_spawn
    const buyer = FB_NAMES[Math.floor(Math.random() * FB_NAMES.length)]
    const roll = Math.random()
    if (roll < 0.3 && anchor > 0) {
      // Midnight lowball: half price or less.
      const low = round2(Math.max(0.5, anchor * (0.2 + Math.random() * 0.3)))
      pushMessage(l.id, { kind: 'lowball', buyer, amount: low, note: LOWBALL_NOTES[Math.floor(Math.random() * LOWBALL_NOTES.length)] })
    } else if (roll < 0.5) {
      pushMessage(l.id, { kind: 'full', buyer, amount: l.ask, note: FULL_NOTES[Math.floor(Math.random() * FULL_NOTES.length)] })
    } else {
      pushMessage(l.id, { kind: 'ghost', buyer, amount: null, note: 'is this still available? is this still available?' })
    }
  }

  // Somebody actually takes it. One sale per tick at most — a board that
  // clears itself is a fire sale, a board that never clears is a ghost town.
  // A listing also has to be up for a beat first: nothing sells the instant
  // it is posted, so the player always gets to see what they listed.
  for (const l of mine) {
    if (Date.now() - new Date(l.posted_at).getTime() < 45_000) continue
    const chance = npcBuyChance(l)
    if (chance <= 0 || Math.random() >= chance) continue
    const buyer = FB_NAMES[Math.floor(Math.random() * FB_NAMES.length)]
    if (!settleSale(l, l.ask, buyer).ok) continue
    recordMineSale(l, buyer, l.ask)
    break
  }
}

/**
 * Cash changes hands on an agreed listing: release the goods, take the cash,
 * log the sale. Shared by the player's accept path and by NPC buyers, so the
 * two can never diverge on what "sold" means.
 */
function settleSale(l: LocalRow, paid: number, buyer: string): { ok: true } | { ok: false; error: string } {
  const kind = (l.kind ?? 'card') as LocalKind
  const name = listingName(l)

  // The goods have to still exist before cash changes hands — a lot or a box
  // releases every member, a sealed unit releases one from the shelf.
  const release: { table: 'inventory' | 'sealed'; id: number }[] = []
  if (kind === 'sealed') {
    if (!l.inventory_id) return { ok: false, error: 'That unit already moved.' }
    const row = db.prepare(`SELECT id FROM sealed_inventory WHERE id = ? AND quantity > 0`).get(l.inventory_id) as { id: number } | undefined
    if (!row) return { ok: false, error: 'That box already moved.' }
    release.push({ table: 'sealed', id: row.id })
  } else {
    const ids = kind === 'bundle' ? bundleInventoryIds(l) : l.inventory_id ? [l.inventory_id] : []
    if (ids.length === 0) return { ok: false, error: 'The card already moved.' }
    const marks = ids.map(() => '?').join(',')
    const rows = db.prepare(`SELECT id FROM inventory WHERE id IN (${marks}) AND status = 'local_listed'`).all(...ids) as { id: number }[]
    if (rows.length !== ids.length) return { ok: false, error: 'Part of that lot already moved.' }
    for (const row of rows) release.push({ table: 'inventory', id: row.id })
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(paid)
    db.prepare(`UPDATE local_listings SET sold = 1, sold_at = ? WHERE id = ?`).run(nowIso(), l.id)
    for (const item of release) {
      if (item.table === 'sealed') {
        db.prepare(`UPDATE sealed_inventory SET quantity = quantity - 1 WHERE id = ?`).run(item.id)
        db.prepare(`DELETE FROM sealed_inventory WHERE id = ? AND quantity <= 0`).run(item.id)
      } else {
        db.prepare(`UPDATE inventory SET quantity = quantity - 1 WHERE id = ?`).run(item.id)
        db.prepare('DELETE FROM inventory WHERE id = ? AND quantity <= 0').run(item.id)
      }
    }
  })
  tx()
  logActivity('sale', `Parking-lot sale: ${name} to ${buyer} for ${fmt(paid)} cash. No fees, no paper trail.`, paid)
  return { ok: true }
}

/** The board's memory of what you just sold — the UI shows it as "Just sold". */
type MineSale = { id: number; name: string; kind: LocalKind; kindLabel: string; paid: number; buyer: string; at: string }

function mineSaleName(l: LocalRow): { name: string; kindLabel: string } {
  const ids: (string | null)[] = [l.card_id]
  if ((l.kind ?? 'card') === 'bundle') ids.push(...parseLot(l.item_json).map((x) => x.card_id))
  const d = describe(l, cardInfo(ids))
  return d ? { name: d.name, kindLabel: d.kindLabel } : { name: listingName(l), kindLabel: KIND_LABEL[(l.kind ?? 'card') as LocalKind] }
}

function recordMineSale(l: LocalRow, buyer: string, paid: number) {
  const { name, kindLabel } = mineSaleName(l)
  const list = JSON.parse(getMeta('local:mine_sold') ?? '[]') as MineSale[]
  list.unshift({ id: l.id, name, kind: (l.kind ?? 'card') as LocalKind, kindLabel, paid: round2(paid), buyer, at: nowIso() })
  setMeta('local:mine_sold', JSON.stringify(list.slice(0, 5)))
}

export function mineSales(): MineSale[] {
  try {
    const list = JSON.parse(getMeta('local:mine_sold') ?? '[]') as MineSale[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/**
 * How likely an NPC is to take a listing on any given tick. Pricing is the
 * whole game here: at or under market it moves quickly, a dreaming ask never
 * moves at all — which is the lesson the board is supposed to teach.
 */
function npcBuyChance(l: LocalRow): number {
  // Cards track their live market; everything else can only fall back to the
  // value it was posted at (no card_id to re-price).
  const anchor = l.card_id ? anchorOf(l.card_id, l.condition) : l.anchor_at_spawn
  if (!(anchor > 0) || !(l.ask > 0)) return 0
  const ratio = l.ask / anchor
  if (ratio <= 1) return 0.07
  if (ratio <= 1.25) return 0.045
  if (ratio <= 1.5) return 0.02
  if (ratio <= 2) return 0.006
  return 0 // listed at 2× market or more — nobody local is that naive
}

/** Accept a buyer message: full price or lowball. Meeting risk applies. */
export function acceptOffer(listingId: number, buyer: string, amount: number | null): MeetResult {
  const l = db.prepare(`SELECT * FROM local_listings WHERE id = ? AND source = 'mine' AND sold = 0`).get(listingId) as LocalRow | undefined
  if (!l) return { ok: false, error: 'That listing is gone.' }
  const msg = messagesFor(listingId).find((m) => m.buyer === buyer && (amount == null || m.amount === amount))
  if (!msg) return { ok: false, error: 'That message expired.' }

  // The meeting dice: buyers ghost too, and sometimes the card is "already gone".
  const roll = Math.random()
  if (roll < 0.1) {
    pushMessage(listingId, { kind: 'ghost', buyer, amount, note: 'sorry something came up' })
    logActivity('local', `💬 Your buyer never showed at ${MEET_SPOTS[Math.floor(Math.random() * MEET_SPOTS.length)]}. The card is still yours.`)
    return { ok: true, outcome: 'ghosted', message: 'They never showed. Card stays yours.' }
  }

  const paid = amount ?? l.ask
  const sold = settleSale(l, paid, buyer)
  if (!sold.ok) return { ok: false, error: sold.error }
  const name = listingName(l)
  return { ok: true, outcome: 'sold', paid, message: `Sold ${name} to ${buyer} for ${fmt(paid)} cash — no fees, no receipts, no paper trail.` }
}

// ---------------------------------------------------------------------------
// Counterfeit economy — fakes circulate, get caught, and re-enter the market.
// ---------------------------------------------------------------------------

/** Fake cards re-surface on the local feed from sellers who "have no idea". */
function seedFakes() {
  const fakes = db.prepare(`SELECT id, card_id FROM inventory WHERE is_fake = 1 AND status != 'sold' AND quantity > 0 LIMIT 1`).all() as { id: number; card_id: string }[]
  // Fakes don't jump back to market on their own — the *player* usually resells
  // them. Kept as a hook for future NPC-to-NPC churn.
}

/** The buylist route for a burned buyer: shops pay a flat $1. */
export function sellFakeToBuylist(inventoryId: number) {
  const inv = db.prepare(`SELECT i.*, c.name FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ? AND i.is_fake = 1 AND i.status = 'collection'`).get(inventoryId) as { id: number; name: string } | undefined
  if (!inv) return { ok: false as const, error: 'Not a known fake in your collection.' }
  const tx = db.transaction(() => {
    db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(FAKE_VALUE)
    db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(inv.id)
    db.prepare('DELETE FROM inventory WHERE id = ? AND quantity <= 0').run(inv.id)
    pnl.append('overhead', FAKE_VALUE, `🃏 sold a detected counterfeit to a buylist shop — ${inv.name}`)
  })
  tx()
  logActivity('sale', `A buylist shop paid $${FAKE_VALUE.toFixed(2)} for the ${inv.name} fake. They keep a wall of them as training aids.`, FAKE_VALUE)
  return { ok: true as const, paid: FAKE_VALUE }
}

/** Inspect a copy you already own — catches fakes you were shipped or bought blind. */
export function inspectForFake(inventoryId: number): { ok: true; fake: boolean; message: string } | { ok: false; error: string } {
  const inv = db.prepare(`SELECT i.*, c.name FROM inventory i JOIN cards c ON c.id = i.card_id WHERE i.id = ? AND i.status = 'collection' AND i.graded_grade IS NULL`).get(inventoryId) as { id: number; is_fake: number; name: string } | undefined
  if (!inv) return { ok: false, error: 'Card not found in your collection (raw cards only).' }
  return {
    ok: true,
    fake: !!inv.is_fake,
    message: inv.is_fake
      ? `The ${inv.name} fails every test — wrong texture, wrong font, wrong weight. It's counterfeit: sellable only to buylist shops for $${FAKE_VALUE}.`
      : `The ${inv.name} passes: correct texture, print lines, and weight. Genuine.`,
  }
}
