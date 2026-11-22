import { db, nowIso } from '../lib/db'
import { valueOf, type Condition } from './market'

export const SLOTS_PER_PAGE = 9 // 3×3 pockets

export type Binder = { id: number; name: string; accent: string; cover: string; created_at: string }

export type BinderCover = { id: string; label: string; blurb: string; unlockAt: number; special: boolean }

/**
 * Cover stock. It is not sold anywhere: a cover is EARNED by filling binders,
 * so collecting is what unlocks the shelf rather than cash. `unlockAt` counts
 * cards slotted across every binder, and the server enforces it — the greyed-out
 * chips in the UI are the same rule, not the rule itself.
 */
export const BINDER_COVERS: BinderCover[] = [
  { id: 'vinyl', label: 'Black vinyl', blurb: 'The plain black binder every collection starts in.', unlockAt: 0, special: false },
  { id: 'canvas', label: 'Grey canvas', blurb: 'Stitched bookcloth — matte, no shine at all.', unlockAt: 0, special: false },
  { id: 'leather', label: 'Saddle leather', blurb: 'Brown leather with a gilt border and a real hinge.', unlockAt: 12, special: false },
  { id: 'holo', label: 'Galaxy holo', blurb: 'Foil stock that shifts as the light crosses it.', unlockAt: 36, special: true },
  { id: 'gold', label: 'Gold stamp', blurb: 'Gold leaf on black cloth and a blind-embossed frame.', unlockAt: 72, special: true },
  { id: 'monster', label: 'Monster ball', blurb: 'Red and white, stadium issue, 1999 on the spine.', unlockAt: 150, special: true },
]

const COVER_IDS = new Set(BINDER_COVERS.map((c) => c.id))

/** Cards slotted across every binder — what a cover is earned with. */
export function slottedTotal(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM binder_slots').get() as { n: number }).n
}

function coverDef(id: string): BinderCover | undefined {
  return BINDER_COVERS.find((c) => c.id === id)
}

export type BinderSlotRow = {
  page: number
  slot: number
  inventory_id: number
  card_id: string
  name: string
  image_small: string | null
  image_large: string | null
  rarity: string | null
  number: string
  set_name: string
  condition: string
  variant: string
  quantity: number
  value: number
  cost_basis: number
  status: string
  favorite: number
}

/** Home-dashboard rollup: binder count, slotted cards, and total slotted value. */
export function getStats() {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM binders').get() as { n: number }).n
  const rows = db
    .prepare(
      `SELECT i.card_id, i.variant, i.condition, i.quantity
       FROM binder_slots bs JOIN inventory i ON i.id = bs.inventory_id`,
    )
    .all() as { card_id: string; variant: string; condition: string; quantity: number }[]
  const value = rows.reduce((a, r) => a + r.quantity * valueOf(r.card_id, r.variant, r.condition as Condition), 0)
  return { count, slotted: rows.length, value: Math.round(value * 100) / 100 }
}

export function listBinders() {
  const binders = db.prepare('SELECT * FROM binders ORDER BY id ASC').all() as Binder[]
  const counts = db.prepare('SELECT binder_id, COUNT(*) AS n FROM binder_slots GROUP BY binder_id').all() as { binder_id: number; n: number }[]
  const countMap = new Map(counts.map((c) => [c.binder_id, c.n]))
  const rows = db
    .prepare(
      `SELECT bs.binder_id, i.card_id, i.variant, i.condition, i.quantity FROM binder_slots bs JOIN inventory i ON i.id = bs.inventory_id`,
    )
    .all() as { binder_id: number; card_id: string; variant: string; condition: string; quantity: number }[]
  const valueMap = new Map<number, number>()
  for (const r of rows) valueMap.set(r.binder_id, (valueMap.get(r.binder_id) ?? 0) + r.quantity * valueOf(r.card_id, r.variant, r.condition as Condition))
  return binders.map((b) => ({ ...b, cardCount: countMap.get(b.id) ?? 0, value: Math.round((valueMap.get(b.id) ?? 0) * 100) / 100 }))
}

export function createBinder(name: string, accent = 'yellow', cover = 'vinyl'): Binder {
  const def = coverDef(cover)
  if (!def) throw new Error('Unknown cover')
  if (slottedTotal() < def.unlockAt) {
    throw new Error(`${def.label} unlocks at ${def.unlockAt} cards in binders — you have ${slottedTotal()}.`)
  }
  const res = db
    .prepare('INSERT INTO binders (name, accent, cover, created_at) VALUES (?, ?, ?, ?)')
    .run(name.trim() || 'New Binder', accent, def.id, nowIso())
  return db.prepare('SELECT * FROM binders WHERE id = ?').get(res.lastInsertRowid) as Binder
}

export function updateBinder(
  id: number,
  patch: { name?: string; accent?: string; cover?: string },
): { ok: boolean; error?: string } {
  if (patch.cover !== undefined && !COVER_IDS.has(patch.cover)) return { ok: false, error: 'Unknown cover' }
  if (patch.cover !== undefined) {
    const def = coverDef(patch.cover)!
    const slotted = slottedTotal()
    if (slotted < def.unlockAt) {
      return { ok: false, error: `${def.label} unlocks at ${def.unlockAt} cards in binders — you have ${slotted}.` }
    }
  }
  if (patch.name !== undefined) db.prepare('UPDATE binders SET name = ? WHERE id = ?').run(patch.name.trim() || 'Binder', id)
  if (patch.accent !== undefined) db.prepare('UPDATE binders SET accent = ? WHERE id = ?').run(patch.accent, id)
  if (patch.cover !== undefined) db.prepare('UPDATE binders SET cover = ? WHERE id = ?').run(patch.cover, id)
  return { ok: true }
}

export function deleteBinder(id: number) {
  // Slots cascade; cards return to the raw collection implicitly (inventory rows untouched).
  db.prepare('DELETE FROM binders WHERE id = ?').run(id)
}

export function getBinderDetail(id: number) {
  const binder = db.prepare('SELECT * FROM binders WHERE id = ?').get(id) as Binder | undefined
  if (!binder) return null
  const slots = db
    .prepare(
      `SELECT bs.page, bs.slot, bs.inventory_id, i.card_id, i.status, i.condition, i.variant, i.quantity, i.cost_basis, i.favorite,
              c.name, c.image_small, c.image_large, c.rarity, c.number, s.name AS set_name
       FROM binder_slots bs
       JOIN inventory i ON i.id = bs.inventory_id
       JOIN cards c ON c.id = i.card_id
       JOIN sets s ON s.id = c.set_id
       WHERE bs.binder_id = ?
       ORDER BY bs.page ASC, bs.slot ASC`,
    )
    .all(id) as (Omit<BinderSlotRow, 'value'>)[]

  const out: BinderSlotRow[] = slots.map((s) => ({ ...s, value: valueOf(s.card_id, s.variant, s.condition as Condition) }))
  const pages = out.length > 0 ? out[out.length - 1].page + 1 : 1
  return { binder, slots: out, pages, cardCount: out.length, value: Math.round(out.reduce((a, s) => a + s.value * s.quantity, 0) * 100) / 100 }
}

/** First free pocket: fill pages left→right, top→bottom. */
function firstFreeSlot(binderId: number): { page: number; slot: number } | null {
  const taken = db.prepare('SELECT page, slot FROM binder_slots WHERE binder_id = ?').all(binderId) as { page: number; slot: number }[]
  const occupied = new Set(taken.map((t) => t.page * SLOTS_PER_PAGE + t.slot))
  const maxPage = taken.length ? Math.max(...taken.map((t) => t.page)) : 0
  for (let p = 0; p <= maxPage + 1; p++) {
    for (let s = 0; s < SLOTS_PER_PAGE; s++) {
      if (!occupied.has(p * SLOTS_PER_PAGE + s)) return { page: p, slot: s }
    }
  }
  return null
}

export function placeCard(binderId: number, inventoryId: number, page?: number, slot?: number) {
  const inv = db.prepare(`SELECT id, status FROM inventory WHERE id = ?`).get(inventoryId) as { id: number; status: string } | undefined
  if (!inv) throw new Error('Card not found in inventory')
  if (inv.status !== 'collection') throw new Error('Only raw collection cards can be placed in a binder')

  const existing = db.prepare('SELECT binder_id FROM binder_slots WHERE inventory_id = ?').get(inventoryId) as { binder_id: number } | undefined
  if (existing) {
    if (existing.binder_id === binderId && page === undefined) throw new Error('Already in this binder')
    db.prepare('DELETE FROM binder_slots WHERE inventory_id = ?').run(inventoryId)
  }

  let target = { page, slot }
  if (target.page === undefined || target.slot === undefined) {
    const free = firstFreeSlot(binderId)
    if (!free) throw new Error('Binder is full')
    target = free
  } else {
    const occupied = db.prepare('SELECT 1 FROM binder_slots WHERE binder_id = ? AND page = ? AND slot = ?').get(binderId, target.page, target.slot)
    if (occupied) throw new Error('That pocket is occupied — empty it first')
  }
  db.prepare('INSERT INTO binder_slots (binder_id, page, slot, inventory_id, placed_at) VALUES (?, ?, ?, ?, ?)').run(
    binderId, target.page, target.slot, inventoryId, nowIso(),
  )
  return { page: target.page, slot: target.slot }
}

/**
 * Drag-and-drop move: relocate the card in `from` to pocket `to` in one atomic step.
 * If `to` is occupied, the two cards swap pockets. Same-binder only.
 */
export function moveCard(binderId: number, from: { page: number; slot: number }, to: { page: number; slot: number }) {
  const src = db.prepare('SELECT inventory_id FROM binder_slots WHERE binder_id = ? AND page = ? AND slot = ?').get(binderId, from.page, from.slot) as { inventory_id: number } | undefined
  if (!src) throw new Error('No card in the source pocket')
  if (from.page === to.page && from.slot === to.slot) return { swapped: false }

  const occupant = db.prepare('SELECT inventory_id FROM binder_slots WHERE binder_id = ? AND page = ? AND slot = ?').get(binderId, to.page, to.slot) as { inventory_id: number } | undefined
  const clear = db.prepare('DELETE FROM binder_slots WHERE binder_id = ? AND page = ? AND slot = ?')
  const insert = db.prepare('INSERT INTO binder_slots (binder_id, page, slot, inventory_id, placed_at) VALUES (?, ?, ?, ?, ?)')

  const tx = db.transaction(() => {
    clear.run(binderId, from.page, from.slot)
    if (occupant) clear.run(binderId, to.page, to.slot)
    insert.run(binderId, to.page, to.slot, src.inventory_id, nowIso())
    if (occupant) insert.run(binderId, from.page, from.slot, occupant.inventory_id, nowIso())
  })
  tx()
  return { swapped: occupant !== undefined, movedId: src.inventory_id, swappedId: occupant?.inventory_id }
}

export function removeCard(binderId: number, inventoryId: number) {
  db.prepare('DELETE FROM binder_slots WHERE binder_id = ? AND inventory_id = ?').run(binderId, inventoryId)
}

/** When a slotted card gets sold or listed elsewhere, its pocket must free up. */
export function cleanupSlotsForInventory(inventoryIds: number[]) {
  if (inventoryIds.length === 0) return
  db.prepare(`DELETE FROM binder_slots WHERE inventory_id IN (${inventoryIds.map(() => '?').join(',')})`).run(...inventoryIds)
}

/** Cards eligible for binder placement: raw, owned, not already slotted. */
export function availableCards(q = '', limit = 60) {
  const rows = db
    .prepare(
      `SELECT i.id, i.card_id, i.condition, i.variant, i.quantity, i.cost_basis, i.acquired_at,
              c.name, c.image_small, c.rarity, c.number, s.name AS set_name
       FROM inventory i
       JOIN cards c ON c.id = i.card_id
       JOIN sets s ON s.id = c.set_id
       WHERE i.status = 'collection'
         AND i.id NOT IN (SELECT inventory_id FROM binder_slots)
         ${q ? 'AND c.name LIKE ?' : ''}
       ORDER BY i.acquired_at DESC
       LIMIT ?`,
    )
    .all(...(q ? [`%${q}%`] : []), limit) as Record<string, unknown>[]
  return rows.map((r) => ({ ...r, value: valueOf(r.card_id as string, r.variant as string, r.condition as Condition) }))
}
