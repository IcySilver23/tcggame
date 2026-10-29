import { db, nowIso, logActivity } from '../lib/db'
import { valueOf, CONDITION_MULT, round2, type Condition } from './market'
import * as vault from './vault'

// ---------------------------------------------------------------------------
// Estate lots: bundled mystery collections sold at conventions.
// The seller prices the lot with a noisy estimate; the true value (sum of real
// market anchors) is only revealed when you buy — and can be far above or
// below what the estate claimed.
// ---------------------------------------------------------------------------

const FLAVORS = [
  {
    id: 'bulk_clearout',
    label: 'Bulk Clearout',
    blurb: "Binders from someone who quit the hobby. Mostly filler — but filler is cheap.",
  },
  {
    id: 'mixed_vault',
    label: 'Mixed Vault',
    blurb: 'A lifetime of loose packs and forgotten boxes. Decent odds of something good.',
  },
  {
    id: 'collector_decay',
    label: "Collector's Estate",
    blurb: 'Cards untouched for decades. Hit it big or get nothing — the family wants it gone.',
  },
] as const

const SELLER_NAMES = [
  'the Henderson Estate', 'Aunt Carol\'s Attic', 'the Kowalski Collection',
  'Grandpa Joe\'s Shoebox', 'theMiller Family Sale', 'a Storage Unit Find',
  'the Reluctant Widow', 'Moving-Out Marty', 'the Garage Sale Gods',
]

type FlavorId = (typeof FLAVORS)[number]['id']

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}
function randInt(min: number, max: number) {
  return Math.floor(rand(min, max + 1))
}

// Flavor profiles: market-value band, lot size, condition weighting.
const PROFILE: Record<FlavorId, { minV: number; maxV: number; size: [number, number]; conds: Condition[]; vintageBias: boolean }> = {
  bulk_clearout: { minV: 0.25, maxV: 8, size: [25, 45], conds: ['MP', 'HP', 'LP', 'NM', 'DM'], vintageBias: false },
  mixed_vault: { minV: 0.25, maxV: 60, size: [12, 25], conds: ['NM', 'NM', 'LP', 'MP', 'HP'], vintageBias: false },
  collector_decay: { minV: 15, maxV: 600, size: [5, 12], conds: ['NM', 'NM', 'NM', 'LP', 'LP'], vintageBias: true },
}

// ---------------------------------------------------------------------------
// Lot generation — called when a show opens
// ---------------------------------------------------------------------------

export function spawnEstateLots(conventionId: number, showName: string) {
  const lotsToMake = randInt(1, 3)
  const year = (setId: string): number => {
    const row = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(setId) as { release_date: string } | undefined
    return row ? Number(row.release_date.slice(0, 4)) : 2025
  }
  const insertLot = db.prepare(
    `INSERT INTO estate_lots (convention_id, seller_name, flavor, card_count, ask, seller_estimate, true_value, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'available')`,
  )
  const insertCard = db.prepare(
    `INSERT INTO estate_lot_cards (lot_id, card_id, condition) VALUES (?, ?, ?)`,
  )

  const tx = db.transaction(() => {
    for (let i = 0; i < lotsToMake; i++) {
      const flavor = pick(FLAVORS)
      const prof = PROFILE[flavor.id]

      // Candidate pool from real synced cards with real prices.
      const pool = db
        .prepare(
          `SELECT c.id, c.set_id,
                  (SELECT market FROM price_records pr WHERE pr.card_id = c.id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) AS m
           FROM cards c WHERE c.rarity IS NOT NULL AND c.rarity != ''
           ORDER BY RANDOM() LIMIT 500`,
        )
        .all() as { id: string; set_id: string; m: number | null }[]
      let valued = pool.filter((p) => p.m != null && p.m >= prof.minV && p.m <= prof.maxV)
      if (prof.vintageBias) {
        const wotc = valued.filter((p) => year(p.set_id) <= 2007)
        if (wotc.length >= 2) valued = wotc
      }
      if (valued.length < 4) continue // not enough real-priced stock for this flavor

      const n = Math.min(randInt(prof.size[0], prof.size[1]), valued.length)
      const chosen: { id: string; cond: Condition; v: number }[] = []
      const used = new Set<string>()
      for (let k = 0; k < n; k++) {
        const c = pick(valued)
        if (used.has(c.id)) continue
        used.add(c.id)
        const cond = pick(prof.conds)
        const mult = CONDITION_MULT[cond] ?? 1
        chosen.push({ id: c.id, cond, v: valueOf(c.id, 'normal', cond) })
      }
      if (chosen.length < 3) continue

      const trueValue = round2(chosen.reduce((a, c) => a + c.v, 0))
      // Seller's estimate is a noisy opinion — sometimes badly wrong either way.
      const estimate = Math.max(1, round2(trueValue * rand(0.45, 1.6)))
      // Estates price to move: 55–90% of their own estimate.
      const ask = Math.max(2, round2(estimate * rand(0.55, 0.9)))

      const res = insertLot.run(
        conventionId,
        pick(SELLER_NAMES),
        flavor.id,
        chosen.length,
        ask,
        estimate,
        trueValue,
      )
      const lotId = Number(res.lastInsertRowid)
      for (const c of chosen) insertCard.run(lotId, c.id, c.cond)
    }
  })
  tx()

  const made = (db.prepare(`SELECT COUNT(*) AS n FROM estate_lots WHERE convention_id = ?`).get(conventionId) as { n: number }).n
  if (made > 0) logActivity('convention', `${showName}: ${made} estate lot${made === 1 ? '' : 's'} on the floor — one price, no peeking.`)
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

function flavorInfo(id: string) {
  return FLAVORS.find((f) => f.id === id) ?? FLAVORS[0]
}

/** Preview = one from the top, middle, and bottom of the lot by value. */
function previewFor(lotId: number, total: number) {
  const cards = db
    .prepare(
      `SELECT elc.card_id, elc.condition, c.name, c.image_small, c.rarity, s.name AS set_name
       FROM estate_lot_cards elc JOIN cards c ON c.id = elc.card_id JOIN sets s ON s.id = c.set_id
       WHERE elc.lot_id = ?`,
    )
    .all(lotId) as { card_id: string; condition: string; name: string; image_small: string | null; rarity: string | null; set_name: string; _v?: number }[]
  for (const c of cards) {
    ;(c as any)._v = valueOf(c.card_id, 'normal', c.condition as Condition)
  }
  cards.sort((a, b) => (b._v as number) - (a._v as number))
  const idx = [0, Math.floor(total / 2), total - 1].filter((i, k, arr) => arr.indexOf(i) === k && i < cards.length)
  return idx.map((i) => {
    const c = cards[i]
    return { card_id: c.card_id, name: c.name, image_small: c.image_small, rarity: c.rarity, set_name: c.set_name, condition: c.condition, value: round2(c._v as number) }
  })
}

export function estateLotsForActiveShow() {
  const show = db
    .prepare(`SELECT * FROM conventions WHERE closes_at > ? ORDER BY id DESC LIMIT 1`)
    .get(nowIso()) as { id: number; name: string } | undefined
  if (!show) return [] as EstateLotOut[]
  const rows = db
    .prepare(`SELECT * FROM estate_lots WHERE convention_id = ? AND status = 'available' ORDER BY ask ASC`)
    .all(show.id) as EstateLotRow[]
  return rows.map((r) => ({
    id: r.id,
    seller_name: r.seller_name,
    flavor: r.flavor,
    flavor_label: flavorInfo(r.flavor).label,
    flavor_blurb: flavorInfo(r.flavor).blurb,
    card_count: r.card_count,
    ask: r.ask,
    seller_estimate: r.seller_estimate,
    preview: previewFor(r.id, r.card_count),
  }))
}

export function estateLedger() {
  const rows = db
    .prepare(
      `SELECT el.*, cv.name AS show_name FROM estate_lots el JOIN conventions cv ON cv.id = el.convention_id
       WHERE el.status = 'sold' ORDER BY el.bought_at DESC LIMIT 20`,
    )
    .all() as (EstateLotRow & { show_name: string })[]
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS lots, SUM(ask) AS spent, SUM(true_value) AS realized
       FROM estate_lots WHERE status = 'sold'`,
    )
    .get() as { lots: number; spent: number | null; realized: number | null }
  const best = db
    .prepare(
      `SELECT seller_name, ask, true_value, (true_value - ask) AS gain FROM estate_lots
       WHERE status = 'sold' ORDER BY (true_value - ask) DESC LIMIT 1`,
    )
    .get() as { seller_name: string; ask: number; true_value: number; gain: number } | undefined
  const lots = agg.lots
  return {
    history: rows.map((r) => ({
      id: r.id,
      seller_name: r.seller_name,
      flavor_label: flavorInfo(r.flavor).label,
      show_name: r.show_name,
      card_count: r.card_count,
      ask: r.ask,
      estimate: r.seller_estimate,
      realized: r.true_value ?? 0,
      profit: round2((r.true_value ?? 0) - r.ask),
      bought_at: r.bought_at,
    })),
    stats: {
      lotsBought: lots,
      totalSpent: round2(agg.spent ?? 0),
      totalRealized: round2(agg.realized ?? 0),
      netProfit: round2((agg.realized ?? 0) - (agg.spent ?? 0)),
      beatEstimateRate: null as number | null, // filled below
      best: best ? { seller: best.seller_name, ask: best.ask, realized: best.true_value, gain: round2(best.gain) } : null,
    },
  }
}

export function estateSection() {
  const show = db
    .prepare(`SELECT * FROM conventions WHERE closes_at > ? ORDER BY id DESC LIMIT 1`)
    .get(nowIso()) as { id: number } | undefined
  const lots = show ? estateLotsForActiveShow() : []
  const ledger = estateLedger()
  // beat-estimate rate: realized > seller estimate
  const beat = (db.prepare(`SELECT COUNT(*) AS n FROM estate_lots WHERE status = 'sold' AND true_value > seller_estimate`).get() as { n: number }).n
  if (ledger.stats.lotsBought > 0) ledger.stats.beatEstimateRate = Math.round((beat / ledger.stats.lotsBought) * 100)
  return { lots, ...ledger }
}

type EstateLotRow = {
  id: number
  convention_id: number
  seller_name: string
  flavor: string
  card_count: number
  ask: number
  seller_estimate: number
  true_value: number | null
  status: string
  bought_at: string | null
}

type EstateLotOut = {
  id: number
  seller_name: string
  flavor: string
  flavor_label: string
  flavor_blurb: string
  card_count: number
  ask: number
  seller_estimate: number
  preview: { card_id: string; name: string; image_small: string | null; rarity: string | null; set_name: string; condition: string; value: number }[]
}

// ---------------------------------------------------------------------------
// Buying — the reveal
// ---------------------------------------------------------------------------

export function buyEstateLot(lotId: number) {
  const show = db
    .prepare(`SELECT * FROM conventions WHERE closes_at > ? ORDER BY id DESC LIMIT 1`)
    .get(nowIso()) as { id: number; name: string } | undefined
  if (!show) return { ok: false as const, error: 'No show running' }
  const lot = db
    .prepare(`SELECT * FROM estate_lots WHERE id = ? AND convention_id = ? AND status = 'available'`)
    .get(lotId, show.id) as EstateLotRow | undefined
  if (!lot) return { ok: false as const, error: 'That lot already sold' }
  // Estate tables sit past the door: wristband required, same as booths.
  const paid = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(`conventionEntry:${show.id}`)
  if (!paid) return { ok: false as const, error: 'Pay entry at the door first' }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < lot.ask) return { ok: false as const, error: `Not enough cash (need $${lot.ask.toFixed(2)})` }

  const cards = db
    .prepare(
      `SELECT elc.card_id, elc.condition, c.name, c.image_small, c.rarity, s.name AS set_name
       FROM estate_lot_cards elc JOIN cards c ON c.id = elc.card_id JOIN sets s ON s.id = c.set_id
       WHERE elc.lot_id = ? ORDER BY elc.rowid`,
    )
    .all(lotId) as { card_id: string; condition: string; name: string; image_small: string | null; rarity: string | null; set_name: string }[]
  if (cards.length === 0) return { ok: false as const, error: 'Lot is empty — vendor error' }

  const realized = round2(
    cards.reduce((a, c) => a + valueOf(c.card_id, 'normal', c.condition as Condition), 0),
  )
  const perCard = round2(lot.ask / cards.length)

  const insertInv = db.prepare(
    `INSERT INTO inventory (card_id, variant, condition, quantity, status, acquired_via, acquired_ref, cost_basis, acquired_at)
     VALUES (?, 'normal', ?, 1, 'collection', 'estate_lot', ?, ?, ?)`,
  )

  // Storage & the vault: make room per the overflow policy — whatever still
  // doesn't fit stays with the estate (the lot still costs what it costs).
  const admitted = vault.makeRoomFor(cards.length, 'Estate lot')
  if (admitted <= 0) {
    return { ok: false as const, error: 'Estate lot: no room on the shelf — sell or scrap before buying another lot.' }
  }

  const tx = db.transaction(() => {
    db.prepare(`UPDATE estate_lots SET status = 'sold', bought_at = ?, true_value = ? WHERE id = ?`).run(nowIso(), realized, lotId)
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(lot.ask)
    for (const c of cards.slice(0, admitted)) insertInv.run(c.card_id, c.condition, String(show.id), perCard, nowIso())
    const delta = realized - lot.ask
    const pct = lot.ask > 0 ? Math.round((delta / lot.ask) * 100) : 0
    const verdict =
      realized >= lot.ask * 2
        ? 'You robbed the estate.'
        : realized > lot.seller_estimate
          ? 'Better than the estate claimed.'
          : realized >= lot.ask * 0.9
            ? 'About what you paid for.'
            : 'The estate won this one.'
    logActivity(
      'buy',
      `Bought ${lot.seller_name} (${cards.length} cards) at ${show.name} for $${lot.ask.toFixed(2)} — worth $${realized.toFixed(2)} (${delta >= 0 ? '+' : ''}${pct}%)`,
      -lot.ask,
    )
  })
  tx()

  const delta = round2(realized - lot.ask)
  const pct = lot.ask > 0 ? Math.round((delta / lot.ask) * 100) : 0
  const verdict =
    realized >= lot.ask * 2
      ? 'You robbed the estate.'
      : realized > lot.seller_estimate
        ? 'Better than the estate claimed.'
        : realized >= lot.ask * 0.9
          ? 'About what you paid for.'
          : 'The estate won this one.'

  return {
    ok: true as const,
    paid: lot.ask,
    estimate: lot.seller_estimate,
    realized,
    profit: delta,
    pct,
    verdict,
    cards: cards
      .map((c) => ({
        card_id: c.card_id,
        name: c.name,
        condition: c.condition,
        rarity: c.rarity,
        set_name: c.set_name,
        image_small: c.image_small,
        value: round2(valueOf(c.card_id, 'normal', c.condition as Condition)),
      }))
      .sort((a, b) => b.value - a.value),
  }
}

// ---------------------------------------------------------------------------
// Tick housekeeping — unsold lots expire with the show
// ---------------------------------------------------------------------------

export function estateTick() {
  const active = db
    .prepare(`SELECT id FROM conventions WHERE closes_at > ?`)
    .all(nowIso()) as { id: number }[]
  const activeIds = new Set(active.map((a) => a.id))
  const stale = db
    .prepare(`SELECT id, seller_name, convention_id FROM estate_lots WHERE status = 'available'`)
    .all() as { id: number; seller_name: string; convention_id: number }[]
  let expired = 0
  for (const l of stale) {
    if (!activeIds.has(l.convention_id)) {
      db.prepare(`UPDATE estate_lots SET status = 'expired' WHERE id = ?`).run(l.id)
      expired++
    }
  }
  return expired
}
