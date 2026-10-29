import { db, nowIso, logActivity } from '../lib/db'
import { round2 } from './market'

// ---------------------------------------------------------------------------
// Sponsors — as your channel grows, brands offer paid contracts: open N packs
// of their product kind on stream and they pay per pack (plus a follower bump
// when you complete the deal). Offers appear when a stream ends — that's when
// sponsors are watching.
// ---------------------------------------------------------------------------

type Brand = {
  brand: string
  label: string
  kinds: string[]
  minFollowers: number
  tagline: string
}

const BRANDS: Brand[] = [
  { brand: 'ripfuel', label: 'RipFuel Energy', kinds: ['booster', 'bundle'], minFollowers: 100, tagline: 'Fueled rips. Crisp pulls. Chat stays awake.' },
  { brand: 'sleevekings', label: 'SleeveKings', kinds: ['booster'], minFollowers: 150, tagline: 'Sleeves so clean the chat asks what they are.' },
  { brand: 'toploadco', label: 'Topload & Co.', kinds: ['bundle'], minFollowers: 300, tagline: 'Protection for the pulls that matter.' },
  { brand: 'bindguard', label: 'BindGuard', kinds: ['etb'], minFollowers: 600, tagline: 'Nine pockets. Zero regrets.' },
  { brand: 'gradedream', label: 'GradeDream Submissions', kinds: ['special'], minFollowers: 1000, tagline: 'Every PSA 10 starts with a sponsor.' },
  { brand: 'casecrown', label: 'CaseCrown Displays', kinds: ['display'], minFollowers: 2500, tagline: 'For channels that rip by the case.' },
]

type OfferRow = {
  id: number
  brand: string
  product_kind: string
  brand_label: string
  tagline: string
  packs_required: number
  payout_per_pack: number
  follower_bonus: number
  expires_at: string
}

type ContractRow = {
  id: number
  brand: string
  product_kind: string
  brand_label: string
  packs_required: number
  packs_delivered: number
  payout_per_pack: number
  follower_bonus: number
  accepted_at: string
  completed_at: string | null
}

function productKindPrice(kind: string): number {
  const row = db
    .prepare(`SELECT AVG(COALESCE(market_price, msrp)) AS p FROM pack_products WHERE kind = ?`)
    .get(kind) as { p: number | null }
  return row.p ?? 4.5
}

function followersNow(): number {
  const row = db.prepare(`SELECT followers FROM stream_stats WHERE id = 1`).get() as { followers: number } | undefined
  return row?.followers ?? 120
}

function activeContract(): ContractRow | undefined {
  return db
    .prepare(`SELECT * FROM sponsor_contracts WHERE completed_at IS NULL ORDER BY id DESC LIMIT 1`)
    .get() as ContractRow | undefined
}

function pendingOfferCount(): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM sponsor_offers WHERE expires_at > ?`)
    .get(nowIso()) as { n: number }
  return row.n
}

function packsRequiredFor(kind: string): number {
  const table: Record<string, [number, number]> = {
    booster: [4, 8],
    bundle: [2, 4],
    etb: [1, 2],
    display: [1, 1],
    special: [1, 1],
  }
  const [lo, hi] = table[kind] ?? [3, 5]
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

function payoutPerPackFor(kind: string): number {
  // Roughly 25–40% of the product's per-pack market value as sponsor money.
  const price = productKindPrice(kind)
  const perBoosterPack = price / (kind === 'booster' ? 1 : kind === 'bundle' ? 6 : kind === 'etb' ? 9 : kind === 'special' ? 15 : 36)
  return round2(perBoosterPack * (0.25 + Math.random() * 0.15))
}

/** Called when a stream ends — sponsors just watched your numbers. */
export function maybeGenerateOffer() {
  const followers = followersNow()
  const eligible = BRANDS.filter((b) => followers >= b.minFollowers && !activeContract() && !db.prepare(`SELECT id FROM sponsor_contracts WHERE brand = ? AND completed_at IS NOT NULL AND accepted_at > datetime('now', '-14 days')`).get(b.brand))
  if (eligible.length === 0) return null

  const totalOffers = (db.prepare(`SELECT COUNT(*) AS n FROM sponsor_offers`).get() as { n: number }).n
  const everContracted = (db.prepare(`SELECT COUNT(*) AS n FROM sponsor_contracts`).get() as { n: number }).n
  // First taste is guaranteed soon after hitting 100 followers so the feature presents itself.
  const chance = everContracted === 0 ? 1 : totalOffers === 0 ? 0.55 : 0.3
  if (Math.random() > chance) return null

  const brand = eligible[Math.floor(Math.random() * eligible.length)]
  const kind = brand.kinds[Math.floor(Math.random() * brand.kinds.length)]
  const packs = packsRequiredFor(kind)
  const per = payoutPerPackFor(kind)
  const bonus = Math.max(3, Math.round(followers * (0.05 + Math.random() * 0.1)))

  const info = db
    .prepare(
      `INSERT INTO sponsor_offers (brand, product_kind, brand_label, tagline, packs_required, payout_per_pack, follower_bonus, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    // ISO expiry to match the nowIso() readers — SQLite's datetime('now')
    // format sorts below ISO on the same date, cutting offers off at UTC
    // midnight of their last day instead of the full 48 hours.
    .run(brand.brand, kind, brand.label, brand.tagline, packs, per, bonus, new Date(Date.now() + 48 * 3600_000).toISOString(), nowIso())

  logActivity('stream', `📩 Sponsor offer: ${brand.label} will pay $${per.toFixed(2)}/pack for ${packs} ${kind} packs on stream (+${bonus} followers on completion).`)
  return Number(info.lastInsertRowid)
}

export function listOffers() {
  const rows = db
    .prepare(`SELECT * FROM sponsor_offers WHERE expires_at > ? ORDER BY payout_per_pack * packs_required DESC`)
    .all(nowIso()) as OfferRow[]
  return rows.map((o) => ({
    id: o.id,
    brand: o.brand_label,
    tagline: o.tagline,
    kind: o.product_kind,
    packsRequired: o.packs_required,
    payoutPerPack: o.payout_per_pack,
    totalPayout: round2(o.payout_per_pack * o.packs_required),
    followerBonus: o.follower_bonus,
    expiresAt: o.expires_at,
  }))
}

export function acceptOffer(id: number) {
  if (activeContract()) return { ok: false as const, error: 'Finish your current sponsor deal first' }
  const o = db
    .prepare(`SELECT * FROM sponsor_offers WHERE id = ? AND expires_at > ?`)
    .get(id, nowIso()) as OfferRow | undefined
  if (!o) return { ok: false as const, error: 'That offer expired' }
  db.prepare(`DELETE FROM sponsor_offers WHERE id = ?`).run(id)
  db.prepare(
    `INSERT INTO sponsor_contracts (brand, product_kind, brand_label, packs_required, packs_delivered, payout_per_pack, follower_bonus, accepted_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(o.brand, o.product_kind, o.brand_label, o.packs_required, o.payout_per_pack, o.follower_bonus, nowIso())
  logActivity('stream', `Signed with ${o.brand_label}: ${o.packs_required} ${o.product_kind} packs on stream for $${round2(o.payout_per_pack * o.packs_required).toFixed(2)}.`)
  return { ok: true as const, contract: contractOut() }
}

export function declineOffer(id: number) {
  db.prepare(`DELETE FROM sponsor_offers WHERE id = ?`).run(id)
  return { ok: true as const }
}

function contractOut() {
  const c = activeContract()
  if (!c) return null
  return {
    id: c.id,
    brand: c.brand_label,
    kind: c.product_kind,
    packsRequired: c.packs_required,
    packsDelivered: c.packs_delivered,
    payoutPerPack: c.payout_per_pack,
    followerBonus: c.follower_bonus,
    remaining: Math.max(0, c.packs_required - c.packs_delivered),
  }
}

export function currentContract() {
  return contractOut()
}

/** Live progress for the on-stream banner. */
export function sponsorForKind(kind: string) {
  const c = activeContract()
  if (!c || c.product_kind !== kind) return null
  return { brand: c.brand_label, delivered: c.packs_delivered, required: c.packs_required }
}

/**
 * Settle the active sponsor contract against a finished stream.
 * Called from endStream with the stream's product kind and pack count.
 * Returns the settlement for the summary card.
 */
export function settleStream(kind: string, packsOpened: number, currentFollowers: number): {
  brand: string
  packs: number
  payout: number
  completed: boolean
  followerBonus: number
  remaining: number
} | null {
  const c = activeContract()
  if (!c || c.product_kind !== kind || packsOpened <= 0) return null

  const remaining = c.packs_required - c.packs_delivered
  const packs = Math.min(packsOpened, remaining)
  if (packs <= 0) return null

  const delivered = c.packs_delivered + packs
  const completed = delivered >= c.packs_required
  const payout = round2(packs * c.payout_per_pack)

  db.prepare(`UPDATE sponsor_contracts SET packs_delivered = ?, completed_at = ? WHERE id = ?`)
    .run(delivered, completed ? nowIso() : null, c.id)

  logActivity(
    'stream',
    completed
      ? `✅ Sponsor deal complete: ${c.brand_label} paid $${payout.toFixed(2)} for ${packs} packs. Channel +${c.follower_bonus} followers.`
      : `Sponsor progress: ${c.brand_label} — ${delivered}/${c.packs_required} ${c.product_kind} packs. $${payout.toFixed(2)} earned so far.`,
    payout,
  )
  db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(payout)

  return {
    brand: c.brand_label,
    packs,
    payout,
    completed,
    followerBonus: completed ? c.follower_bonus : 0,
    remaining: completed ? 0 : c.packs_required - delivered,
  }
}
