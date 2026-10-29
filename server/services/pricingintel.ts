import { db, logActivity } from '../lib/db'
import { valueOf, liquidityFactor, round2, type Condition } from './market'
import { allStores, getFranchise, dmSuppression, stock as franchiseStock, shelfMax, type FranchiseRow } from './franchise'
import * as shopSvc from './shop'
import { getShop } from './shop'
import { counterBoost } from './staff'
import { isNonprofit } from './tax'

// ---------------------------------------------------------------------------
// Chain pricing intel — the advisory panel.
//
// The point of a chain is that your storefronts are not interchangeable: the
// flagship with trained counter staff sells grails; the hole-in-the-wall
// across town moves bulk. But nothing told you which shelf a card belongs on —
// stock pooled wherever it shipped and hoped.
//
// This module reads the SAME walk-in math the sale engines run (chance per
// 15-minute tick = 0.05 × hour × rep × draw × priceFactor × liquidity, capped
// at 0.24–0.26) and scores every venue per card: how fast does it sell HERE,
// at its current ask? Recommendations are honest about the trade: a
// cross-store transfer costs a day on the truck and rolls the shrink dice,
// so moving only pays when the destination's edge is real (≥ half a
// business day of expected wait saved).
//
// Venues: every satellite shelf plus the flagship's cases — one advisory for
// the whole empire. The flagship's nonprofit conversion trades revenue for
// goodwill; its score is still cash-velocity, but the note says so.
// ---------------------------------------------------------------------------

const CAP = { flagship: 0.26, satellite: 0.24 } as const

type StockedRow = {
  inventory_id: number
  card_id: string
  variant: string
  condition: string
  quantity: number
  listing_price: number | null
  name: string
  image_small: string | null
  rarity: string | null
  set_name: string
}

export type IntelVenue = {
  kind: 'flagship' | 'satellite'
  id: number
  name: string
  /** Expected wait in hours at peak traffic, at the card's current ask. */
  etaHours: number
  /** 100 = the fastest venue for this card; lower = proportionally slower. */
  score: number
  note: string
  nonprofit?: boolean
}

export type IntelCard = {
  inventoryId: number
  name: string
  setName: string
  imageSmall: string | null
  rarity: string | null
  condition: string
  quantity: number
  anchor: number
  ask: number
  /** Where the card sits right now. */
  here: { kind: 'flagship' | 'satellite'; id: number; name: string; etaHours: number; score: number } | null
  /** The venue the math says should sell it. */
  best: IntelVenue | null
  /** Other venues worth a glance (top 3 overall, best first). */
  venues: IntelVenue[]
  /** Expected hours saved by moving to `best` (null when already home). */
  gainHours: number | null
  /** Ship-day + shrink-risk note for a cross-store move (null otherwise). */
  transferNote: string | null
  verdict: 'move' | 'leave' | 'unknown'
}

function franchiseDraw(f: FranchiseRow): number {
  const rep = Math.max(0.55, 1 + f.reputation / 100)
  const managerDraw = 1 + (f.manager_quality - 3) * 0.06
  return rep * managerDraw
}

function flagshipDraw(): number {
  const shop = getShop()
  if (!shop) return 0
  const rep = Math.max(0.55, 1 + shop.reputation / 100)
  // Mirrors shopTick's counter engine exactly: rep × counter staff. (The
  // global traffic factor feeds the host-booth engine, not the counter.)
  return rep * counterBoost()
}

function etaFor(draw: number, anchor: number, ratio: number, kind: 'flagship' | 'satellite'): number | null {
  if (draw <= 0 || anchor <= 0) return null
  const priceFactor = Math.min(1.5, Math.max(0.02, 1.45 - ratio))
  const liq = 1 / liquidityFactor(anchor)
  const perTick = Math.min(CAP[kind], 0.05 * 1.0 * draw * priceFactor * liq)
  if (perTick <= 0) return null
  return round2(0.25 / perTick) // ticks are 15 minutes
}

function scoreFor(eta: number | null, fastest: number | null): number {
  if (eta == null || fastest == null || eta <= 0) return 1
  return round2(Math.max(1, Math.min(100, (fastest / eta) * 100)))
}

/** Ship-day + transfer-shrink risk, phrased like the transfer itself. */
function transferRisk(from: number): string | null {
  const f = getFranchise(from)
  if (!f) return null
  const lossChance = Math.min(0.1, 0.02 * (1.15 - f.manager_quality * 0.18) * (1 - 0.65 * dmSuppression(from)))
  const pct = round2(lossChance * 100)
  return `a day on the truck${pct > 0 ? ` · ${pct}% shrink risk (${f.manager_quality <= 2 ? `${f.manager_quality}★ manager` : 'the road'})` : ''}`
}

export type IntelStatus = {
  ok: true
  venues: { kind: 'flagship' | 'satellite'; id: number; name: string; note: string }[]
  cards: IntelCard[]
  summary: { total: number; moves: number; pooled: number; pooledCap: number }
}

/** The advisory read model: every listed chain card, scored against every venue. */
export function status(): IntelStatus {
  const shop = shopSvc.getShop()
  const stores = allStores()
  if (!shop && stores.length === 0) {
    // Unreachable via the API route (it checks the shop first) but keeps the module honest.
    return { ok: true, venues: [], cards: [], summary: { total: 0, moves: 0, pooled: 0, pooledCap: 0 } }
  }

  // Satellite shelf rows + flagship case rows — the whole listed empire.
  const shelfRows = stores.length
    ? (db
        .prepare(
          `SELECT fsc.inventory_id, fsc.store, i.card_id, i.variant, i.condition, i.quantity, i.listing_price,
                  c.name, c.image_small, c.rarity, s.name AS set_name
           FROM franchise_shelf_cards fsc
           JOIN inventory i ON i.id = fsc.inventory_id
           JOIN cards c ON c.id = i.card_id
           JOIN sets s ON s.id = c.set_id
           WHERE i.status = 'on_shelf'`,
        )
        .all() as (StockedRow & { store: number })[])
    : []
  const caseRows = shop
    ? (db
        .prepare(
          `SELECT i.id AS inventory_id, i.card_id, i.variant, i.condition, i.quantity, i.listing_price,
                  c.name, c.image_small, c.rarity, s.name AS set_name
           FROM shop_case_cards scc
           JOIN inventory i ON i.id = scc.inventory_id
           JOIN cards c ON c.id = i.card_id
           JOIN sets s ON s.id = c.set_id
           WHERE i.status = 'in_case'`,
        )
        .all() as StockedRow[])
    : []

  const fDraws = new Map(stores.map((f) => [f.id, franchiseDraw(f)]))
  const flDraw = flagshipDraw()
  const nonprofit = shop ? isNonprofit() : false

  const build = (r: StockedRow, hereStore: number | null): IntelCard => {
    const anchor = valueOf(r.card_id, r.variant || 'normal', (r.condition as Condition) || 'NM')
    const ask = r.listing_price ?? 0
    const ratio = ask > 0 && anchor > 0 ? ask / Math.max(1, r.quantity) / anchor : 1

    const venues: IntelVenue[] = []
    if (shop) {
      const eta = etaFor(flDraw, anchor, ratio, 'flagship')
      venues.push({
        kind: 'flagship',
        id: 0,
        name: shop.name,
        etaHours: eta ?? Number.MAX_SAFE_INTEGER,
        score: 0,
        note: nonprofit ? 'nonprofit — sales fund the cause, not the margin' : 'trained counter staff, showcase lighting, the main drag',
        ...(nonprofit ? { nonprofit: true } : {}),
      })
    }
    for (const f of stores) {
      const eta = etaFor(fDraws.get(f.id) ?? 0, anchor, ratio, 'satellite')
      venues.push({
        kind: 'satellite',
        id: f.id,
        name: f.name,
        etaHours: eta ?? Number.MAX_SAFE_INTEGER,
        score: 0,
        note:
          f.manager_quality >= 4
            ? `${f.manager_name} (${f.manager_quality}★) draws regulars`
            : f.manager_quality <= 2
              ? `${f.manager_name} (${f.manager_quality}★) — cheap, and the foot traffic knows it`
              : `${f.manager_name} (${f.manager_quality}★) holds a steady counter`,
      })
    }

    const realEtas = venues.map((v) => v.etaHours).filter((e) => e !== Number.MAX_SAFE_INTEGER && e > 0)
    const fastest = realEtas.length ? Math.min(...realEtas) : null
    for (const v of venues) v.score = scoreFor(v.etaHours === Number.MAX_SAFE_INTEGER ? null : v.etaHours, fastest)
    venues.sort((a, b) => b.score - a.score)
    const best = venues[0] ?? null

    const hereVenue = hereStore != null ? venues.find((v) => v.kind === 'satellite' && v.id === hereStore) : (venues.find((v) => v.kind === 'flagship') ?? null)
    const gainHours = hereVenue && best && hereVenue.id !== best.id && hereVenue.etaHours !== Number.MAX_SAFE_INTEGER && best.etaHours !== Number.MAX_SAFE_INTEGER
      ? round2(hereVenue.etaHours - best.etaHours)
      : null
    const meaningful = gainHours != null && gainHours >= 6 // half a business day of expected difference
    // Any cross-floor move that lands on a satellite rides the truck — even
    // out of the flagship, where the risk is the road itself, not a cheap manager.
    const movingToSatellite = !!best && best.kind === 'satellite' && !(hereVenue && hereVenue.kind === 'satellite' && hereVenue.id === best.id)
    const transferNote = hereVenue && movingToSatellite
      ? hereVenue.kind === 'satellite'
        ? transferRisk(hereVenue.id)
        : 'a day on the road out of the flagship'
      : null

    return {
      inventoryId: r.inventory_id,
      name: r.name,
      setName: r.set_name,
      imageSmall: r.image_small,
      rarity: r.rarity,
      condition: r.condition,
      quantity: r.quantity,
      anchor: round2(anchor),
      ask: round2(ask),
      here: hereVenue ? { kind: hereVenue.kind, id: hereVenue.id, name: hereVenue.name, etaHours: hereVenue.etaHours === Number.MAX_SAFE_INTEGER ? 0 : hereVenue.etaHours, score: hereVenue.score } : null,
      best,
      venues: venues.slice(0, 3),
      gainHours,
      transferNote,
      verdict: anchor <= 0 ? 'unknown' : meaningful ? 'move' : 'leave',
    }
  }

  const cards: IntelCard[] = []
  const seen = new Set<number>()
  // Shelf rows win any duplicate: a legacy damaged save could carry both a
  // shelf and a case row for one card, which would read as two listings.
  for (const r of shelfRows) if (!seen.has(r.inventory_id)) { seen.add(r.inventory_id); cards.push(build(r, r.store)) }
  for (const r of caseRows) if (!seen.has(r.inventory_id)) { seen.add(r.inventory_id); cards.push(build(r, null)) }
  cards.sort((a, b) => {
    if (a.verdict !== b.verdict) return a.verdict === 'move' ? -1 : b.verdict === 'move' ? 1 : a.verdict === 'leave' ? -1 : 1
    if (a.verdict === 'move') return (b.gainHours ?? 0) - (a.gainHours ?? 0)
    return b.anchor - a.anchor
  })

  const venueList: IntelStatus['venues'] = []
  if (shop) venueList.push({ kind: 'flagship', id: 0, name: shop.name, note: nonprofit ? 'nonprofit conversion' : `rep ${shop.reputation} · the original floor` })
  for (const f of stores) venueList.push({ kind: 'satellite', id: f.id, name: f.name, note: `${f.manager_name} · ${f.manager_quality}★ · rep ${f.reputation}` })

  return {
    ok: true,
    venues: venueList,
    cards,
    summary: {
      total: cards.length,
      moves: cards.filter((c) => c.verdict === 'move').length,
      pooled: shelfRows.length,
      pooledCap: stores.reduce((a, f) => a + shelfMax(f.id), 0),
    },
  }
}

// ---------------------------------------------------------------------------
// One-click transfer — route a card to the venue the advisory named.
// ---------------------------------------------------------------------------

export function transfer(inventoryId: number, toKind: 'flagship' | 'satellite', toStore: number) {
  const shelfRow = db.prepare(`SELECT store FROM franchise_shelf_cards WHERE inventory_id = ?`).get(inventoryId) as { store: number } | undefined
  const caseRow = db.prepare(`SELECT scc.case_id FROM shop_case_cards scc WHERE scc.inventory_id = ?`).get(inventoryId) as { case_id: number } | undefined
  if (!shelfRow && !caseRow) return { ok: false as const, error: 'That card is not listed anywhere in the chain' }

  const inv = db.prepare(`SELECT card_id, listing_price FROM inventory WHERE id = ?`).get(inventoryId) as { card_id: string; listing_price: number | null } | undefined
  if (!inv) return { ok: false as const, error: 'Card not found' }
  const ask = inv.listing_price ?? 0
  if (ask <= 0) return { ok: false as const, error: 'Set a price before transferring — the advisory priced this card at its current ask' }

  if (shelfRow && toKind === 'satellite' && shelfRow.store === toStore) {
    return { ok: false as const, error: 'Already on that shelf — reprice it instead' }
  }
  if (caseRow && toKind === 'flagship') {
    return { ok: false as const, error: 'Already in a flagship case' }
  }

  const name = (db.prepare(`SELECT name FROM cards WHERE id = ?`).get(inv.card_id) as { name: string }).name

  if (toKind === 'flagship') {
    const shop = getShop()
    if (!shop) return { ok: false as const, error: 'No flagship to transfer to' }
    const cases = db.prepare(`SELECT id, slots FROM shop_cases ORDER BY id`).all() as { id: number; slots: number }[]
    const free = cases.find((c) => (db.prepare(`SELECT COUNT(*) AS n FROM shop_case_cards WHERE case_id = ?`).get(c.id) as { n: number }).n < c.slots)
    if (!free) return { ok: false as const, error: 'Every flagship case is full — pull a card or buy a case' }
    // shop.stock() requires the card back in the collection first; do the
    // pull + case insert as one nested transaction (savepoint).
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM franchise_shelf_cards WHERE inventory_id = ?`).run(inventoryId)
      db.prepare(`UPDATE inventory SET status = 'collection', listed_at = NULL WHERE id = ?`).run(inventoryId)
      const res = shopSvc.stock(free.id, inventoryId, ask)
      if (!res.ok) throw new Error(res.error)
    })
    try {
      tx()
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Transfer failed' }
    }
    logIntel(`🧭 Pricing intel: ${name} moves to the ${shop.name} floor (case ${free.id}) at $${round2(ask).toFixed(2)}.`)
    return { ok: true as const, to: shop.name }
  }

  const f = getFranchise(toStore)
  if (!f) return { ok: false as const, error: 'No such location' }
  const res = franchiseStock(inventoryId, ask, toStore)
  if (!res.ok) return res
  // Defensive: a legacy double-listed card (shelf + case row) would leave the
  // stale case row behind — the pool transfer only cleans shelf state.
  if (shelfRow) db.prepare(`DELETE FROM shop_case_cards WHERE inventory_id = ?`).run(inventoryId)
  if ('lost' in res && res.lost) return { ok: true as const, to: f.name, lost: true as const }
  logIntel(`🧭 Pricing intel: ${name} ships to ${f.name} at $${round2(ask).toFixed(2)} — on the road until tomorrow.`)
  return { ok: true as const, to: f.name }
}

function logIntel(line: string) {
  logActivity('shop', line, 0)
}
