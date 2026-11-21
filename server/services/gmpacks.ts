import { db, nowIso } from '../lib/db'
import { onDerivedDataChanged } from '../lib/derived-cache'
import { valueOf, round2 } from './market'
import { MINI_PACKS, miniPackFor, type MiniPackDef, type MiniPoolEntry, type MiniSlot } from '../catalog/general-mills'
import { SEQUIN_VARIANT } from '../../src/foil/printing-db'

// ---------------------------------------------------------------------------
// General Mills mini packs: seeding, rolling and the shop's estimate.
//
// A Sequin card is the same number as a plain promo — the pack has to hand out
// the General Mills printing, so the roll comes from the researched composition
// in `server/catalog/general-mills.ts`, not from `pack_product_cards` (which has
// no variant column) and not from `rollPack` (which deals a ten-card booster).
// ---------------------------------------------------------------------------

export { miniPackFor }

/** Seed the three products. Idempotent; refreshes copy and price on an old row. */
export function ensureMiniPacks(): number {
  const upsert = db.prepare(
    `INSERT INTO pack_products (id, set_id, name, kind, msrp, market_price, packs, cards_per_pack, release_date, description)
     SELECT @id, @setId, @name, 'special', @msrp, NULL, 1, 3, @releaseDate, @description
       FROM sets s WHERE s.id = @setId
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       kind = excluded.kind,
       msrp = excluded.msrp,
       packs = excluded.packs,
       cards_per_pack = excluded.cards_per_pack,
       release_date = excluded.release_date,
       description = excluded.description`,
  )
  let touched = 0
  db.transaction(() => {
    for (const p of MINI_PACKS) {
      touched += upsert.run({
        id: p.id,
        setId: p.setId,
        name: p.name,
        msrp: p.msrp,
        releaseDate: p.releaseDate,
        description: p.description,
      }).changes
    }
  })()
  return touched
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

const hostCache = new Map<string, MiniPoolEntry[]>()

/**
 * The host expansion's own commons and uncommons — what "two straight reprints"
 * means when no source names them. Weights come from the set's booster table, so
 * a scarce uncommon stays scarce.
 */
function hostPool(setId: string): MiniPoolEntry[] {
  const cached = hostCache.get(setId)
  if (cached) return cached
  const read = (sql: string) =>
    db.prepare(sql).all(`${setId}-booster`) as { card_id: string; weight: number }[]
  let rows = read(`SELECT card_id, weight FROM pack_product_cards WHERE pack_product_id = ? AND slot IN ('common','uncommon')`)
  if (rows.length === 0) rows = read(`SELECT card_id, weight FROM pack_product_cards WHERE pack_product_id = ?`)
  const pool = rows.map((r) => ({
    cardId: r.card_id,
    variant: 'normal',
    weight: Math.max(1e-9, r.weight),
  }))
  hostCache.set(setId, pool)
  return pool
}

function poolFor(def: MiniPackDef, slot: MiniSlot): MiniPoolEntry[] {
  return slot.hostFill ? [...slot.entries, ...hostPool(def.setId)] : slot.entries
}

const metaCache = new Map<string, { rarity: string | null; supertype: string }>()

function cardMeta(cardId: string): { rarity: string | null; supertype: string } {
  const hit = metaCache.get(cardId)
  if (hit) return hit
  const row = db.prepare('SELECT rarity, supertype FROM cards WHERE id = ?').get(cardId) as
    | { rarity: string | null; supertype: string }
    | undefined
  const meta = { rarity: row?.rarity ?? null, supertype: row?.supertype ?? '' }
  metaCache.set(cardId, meta)
  return meta
}

function pickWeighted(pool: MiniPoolEntry[]): MiniPoolEntry {
  let total = 0
  for (const e of pool) if (e.weight > 0) total += e.weight
  if (total <= 0) return pool[Math.floor(Math.random() * pool.length)]
  let roll = Math.random() * total
  for (const e of pool) {
    if (e.weight <= 0) continue
    roll -= e.weight
    if (roll <= 0) return e
  }
  return pool[pool.length - 1]
}

// ---------------------------------------------------------------------------
// Rolling
// ---------------------------------------------------------------------------

export type MiniPull = { cardId: string; isHit: boolean; value: number; variant: string }

/**
 * Rip one mini pack. Returns null for a product that is not a General Mills
 * mini pack, so callers can fall through to the ordinary booster roll.
 */
export function rollMiniPack(
  productId: string,
  sessionId: string,
  owner: 'player' | 'other' = 'player',
): MiniPull[] | null {
  const def = miniPackFor(productId)
  if (!def) return null
  const picked: { cardId: string; variant: string; value: number; rarity: string | null; isHit: boolean }[] = []
  for (const slot of def.slots) {
    const pool = poolFor(def, slot)
    if (pool.length === 0) continue
    for (let i = 0; i < slot.count; i++) {
      const entry = pickWeighted(pool)
      const meta = cardMeta(entry.cardId)
      picked.push({
        cardId: entry.cardId,
        variant: entry.variant,
        value: round2(valueOf(entry.cardId, entry.variant)),
        rarity: meta.rarity,
        // The Sequin card is the pack's whole point — it is the hit.
        isHit: entry.variant === SEQUIN_VARIANT,
      })
    }
  }
  if (picked.length === 0) return null

  const insert = db.prepare(
    `INSERT INTO pull_history (session_id, pack_product_id, card_id, variant, value, rarity, is_hit, opened_at, owner)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const at = nowIso()
  db.transaction(() => {
    for (const c of picked) {
      insert.run(sessionId, productId, c.cardId, c.variant, c.value, c.rarity, c.isHit ? 1 : 0, at, owner)
    }
  })()
  return picked.map((c) => ({ cardId: c.cardId, isHit: c.isHit, value: c.value, variant: c.variant }))
}

// ---------------------------------------------------------------------------
// Shop estimate — the same shape as a booster estimate, over 3 cards not 10
// ---------------------------------------------------------------------------

export type MiniEstimate = {
  avg: number
  p50: number
  p90: number
  topChases: { id: string; name: string; rarity: string; value: number }[]
}

const estimateCache = new Map<string, MiniEstimate>()

export function estimateMiniPack(productId: string): MiniEstimate {
  const cached = estimateCache.get(productId)
  if (cached) return cached
  const def = miniPackFor(productId)
  if (!def) return { avg: 0, p50: 0, p90: 0, topChases: [] }

  const slots = def.slots
    .map((s) => ({
      count: s.count,
      pool: poolFor(def, s).map((e) => ({ ...e, v: valueOf(e.cardId, e.variant) })),
    }))
    .filter((s) => s.pool.length > 0)

  const weightedAvg = (pool: { weight: number; v: number }[]) => {
    let tw = 0
    let tv = 0
    for (const e of pool) {
      tw += e.weight
      tv += e.weight * e.v
    }
    return tw > 0 ? tv / tw : 0
  }
  const draw = (pool: { weight: number; v: number }[]) => {
    let total = 0
    for (const e of pool) if (e.weight > 0) total += e.weight
    if (total <= 0) return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)].v : 0
    let roll = Math.random() * total
    for (const e of pool) {
      if (e.weight <= 0) continue
      roll -= e.weight
      if (roll <= 0) return e.v
    }
    return pool[pool.length - 1].v
  }
  const avg = slots.reduce((a, s) => a + s.count * weightedAvg(s.pool), 0)

  const sims: number[] = []
  for (let i = 0; i < 300; i++) {
    let v = 0
    for (const s of slots) for (let k = 0; k < s.count; k++) v += draw(s.pool)
    sims.push(v)
  }
  sims.sort((a, b) => a - b)
  const p = (q: number) => round2(sims[Math.floor(q * (sims.length - 1))])

  const all = slots.flatMap((s) => s.pool)
  const seen = new Set<string>()
  const chases = all
    .filter((e) => Number.isFinite(e.v) && e.v > 0)
    .sort((a, b) => b.v - a.v)
    .filter((e) => {
      const key = `${e.cardId}|${e.variant}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 5)
    .map((e) => {
      const row = db.prepare('SELECT name, rarity FROM cards WHERE id = ?').get(e.cardId) as
        | { name: string; rarity: string | null }
        | undefined
      return { id: e.cardId, name: row?.name ?? e.cardId, rarity: row?.rarity ?? '', value: round2(e.v) }
    })

  const result: MiniEstimate = { avg: round2(avg), p50: p(0.5), p90: p(0.9), topChases: chases }
  estimateCache.set(productId, result)
  return result
}

// ---------------------------------------------------------------------------
// Sequin odds — what a three-card pack can actually hand you
// ---------------------------------------------------------------------------

export type MiniSequinOdds = {
  /** Cards one rip deals. */
  cardsPerPack: number
  /** Sequin printings this pack can show, with the chance a rip holds each. */
  cards: { id: string; name: string; value: number; chance: number }[]
  /** Named entries the Sequin draws pick from (the widest Sequin slot). */
  pool: number
  /** Draws that can land a Sequin card besides one stamped into every pack. */
  draws: number
  /** Chance a rip holds at least one Sequin card, 0–1. */
  anyChance: number
  /** Sequin printings that are in every pack, by card id. */
  guaranteed: string[]
}

const sequinOddsCache = new Map<string, MiniSequinOdds>()
const nameCache = new Map<string, string>()

// A price move changes every mini estimate and Sequin value; a catalogue move
// can also change the host pool, rarity lookup and card names.
onDerivedDataChanged(() => {
  estimateCache.clear()
  sequinOddsCache.clear()
  hostCache.clear()
  metaCache.clear()
  nameCache.clear()
})

function cardName(id: string): string {
  const hit = nameCache.get(id)
  if (hit) return hit
  const row = db.prepare('SELECT name FROM cards WHERE id = ?').get(id) as { name: string } | undefined
  const name = row?.name ?? id
  nameCache.set(id, name)
  return name
}

/**
 * The Sequin slot's odds for one mini pack, in the shape the shelf needs: which
 * named printings can appear, how often each one does, and the chance a rip
 * holds at least one. A slot that always deals a single named Sequin card is
 * reported as guaranteed rather than as a draw, because that is what the source
 * says about the 25th-anniversary Pikachu.
 */
export function miniSequinOdds(productId: string): MiniSequinOdds | null {
  const cached = sequinOddsCache.get(productId)
  if (cached) return cached
  const def = miniPackFor(productId)
  if (!def) return null
  const chance = new Map<string, number>()
  const variant = new Map<string, string>()
  const guaranteed: string[] = []
  let noSequin = 1
  let pool = 0
  let draws = 0
  for (const slot of def.slots) {
    const sequin = slot.entries.filter((e) => e.variant === SEQUIN_VARIANT)
    if (sequin.length === 0) continue
    const total = slot.entries.reduce((a, e) => a + e.weight, 0)
    if (total <= 0) continue
    const sequinWeight = sequin.reduce((a, e) => a + e.weight, 0)
    // Probability this slot's draws show no Sequin card at all.
    noSequin *= Math.pow(1 - sequinWeight / total, slot.count)
    if (slot.count === 1 && sequin.length === 1 && sequinWeight === total) {
      guaranteed.push(sequin[0].cardId)
      variant.set(sequin[0].cardId, sequin[0].variant)
      chance.set(sequin[0].cardId, 1)
      continue
    }
    pool = Math.max(pool, slot.entries.length)
    draws = Math.max(draws, slot.count)
    for (const e of sequin) {
      // At least one of this slot's draws landing that exact printing.
      const p = 1 - Math.pow(1 - e.weight / total, slot.count)
      chance.set(e.cardId, Math.max(chance.get(e.cardId) ?? 0, p))
      variant.set(e.cardId, e.variant)
    }
  }
  const cards = [...chance.entries()]
    .map(([id, p]) => ({
      id,
      name: cardName(id),
      value: round2(valueOf(id, variant.get(id) ?? SEQUIN_VARIANT)),
      chance: p,
    }))
    .sort((a, b) => b.value - a.value || b.chance - a.chance)
  const result: MiniSequinOdds = {
    cardsPerPack: def.slots.reduce((a, s) => a + s.count, 0),
    cards,
    pool,
    draws,
    anyChance: 1 - noSequin,
    guaranteed,
  }
  sequinOddsCache.set(productId, result)
  return result
}

/** Every card the three products can hand out, variant included — for the suite. */
export function miniPackEntries(productId: string): MiniPoolEntry[] {
  const def = miniPackFor(productId)
  if (!def) return []
  return def.slots.flatMap((s) => poolFor(def, s))
}
