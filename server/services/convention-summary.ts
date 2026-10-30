import { db, nowIso } from '../lib/db'
import { valueOfRow, round2 } from './market'
import * as schedule from './schedule'

// ---------------------------------------------------------------------------
// Per-show economics for the Home dashboard Conventions panel.
// Spent = entry fee + every booth/estate purchase tagged to the show.
// Current value = today's real market anchors for cards still held, or the
// net sale proceeds for cards already flipped.
// ---------------------------------------------------------------------------

function ensureAcquiredRefColumn() {
  const cols = db.prepare(`PRAGMA table_info(inventory)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'acquired_ref')) {
    db.prepare(`ALTER TABLE inventory ADD COLUMN acquired_ref TEXT`).run()
  }
}

/** One-time: tag pre-existing show purchases to the show that was open when they were bought. */
export function backfillAcquiredRefs() {
  ensureAcquiredRefColumn()
  const untagged = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM inventory WHERE acquired_via IN ('convention','estate_lot') AND acquired_ref IS NULL`)
      .get() as { n: number }
  ).n
  if (untagged === 0) return
  const rows = db
    .prepare(`SELECT id, acquired_at FROM inventory WHERE acquired_via IN ('convention','estate_lot') AND acquired_ref IS NULL`)
    .all() as { id: number; acquired_at: string }[]
  const shows = db.prepare(`SELECT id, opened_at FROM conventions ORDER BY id`).all() as { id: number; opened_at: string }[]
  const upd = db.prepare(`UPDATE inventory SET acquired_ref = ? WHERE id = ?`)
  for (const r of rows) {
    // Most recent show that had opened at purchase time.
    let ref: string | null = null
    for (const s of shows) if (s.opened_at <= r.acquired_at) ref = String(s.id)
    if (ref) upd.run(ref, r.id)
  }
}

function activeShow() {
  return db
    .prepare(`SELECT * FROM conventions WHERE closes_at > ? ORDER BY id DESC LIMIT 1`)
    .get(nowIso()) as { id: number; name: string; blurb: string; entry_fee: number; opened_at: string; closes_at: string } | undefined
}

export function conventionSummary() {
  ensureAcquiredRefColumn()

  const show = activeShow()
  const next = show
    ? {
        open: true as const,
        showName: show.name,
        entryFee: show.entry_fee,
        entered: Boolean(db.prepare(`SELECT value FROM meta WHERE key = ?`).get(`conventionEntry:${show.id}`)),
        minutesLeft: Math.max(0, Math.round((new Date(show.closes_at).getTime() - Date.now()) / 60_000)),
      }
    : (() => {
        // The calendar is the source of truth for "when's the next one" — the
        // old last-close arithmetic answered 0 (nonsense) whenever the previous
        // show had ended more than 45 minutes ago.
        const next = schedule.nextConvention()
        if (next) {
          const ms = new Date(next.start).getTime() - schedule.nowMs()
          return {
            open: false as const,
            nextShowInMin: Math.max(0, Math.round(ms / 60_000)),
            nextShowAt: next.start,
            nextShowTitle: next.title,
            liveNow: next.live,
          }
        }
        const last = db.prepare(`SELECT MAX(closes_at) AS last FROM conventions`).get() as { last: string | null }
        const gapMin = last.last ? Math.max(0, 45 - (Date.now() - new Date(last.last).getTime()) / 60_000) : 0
        return { open: false as const, nextShowInMin: Math.round(gapMin), nextShowAt: null, nextShowTitle: null, liveNow: false }
      })()

  // Shows you actually attended (paid entry or bought something on the floor).
  const shows = db
    .prepare(
      `SELECT id, name, closes_at FROM conventions
       WHERE id IN (SELECT CAST(acquired_ref AS INTEGER) FROM inventory WHERE acquired_via IN ('convention','estate_lot') AND acquired_ref IS NOT NULL)
          OR id IN (SELECT CAST(SUBSTR(key, 17) AS INTEGER) FROM meta WHERE key LIKE 'conventionEntry:%')
       ORDER BY id DESC
       LIMIT 8`,
    )
    .all() as { id: number; name: string; closes_at: string }[]

  const history = shows.map((s) => {
    // Entry fee from the activity log ("Paid $10.00 entry at <show>.").
    const entryMsg = db
      .prepare(`SELECT message FROM activity_log WHERE message LIKE ? ORDER BY id DESC LIMIT 1`)
      .get(`Paid $% entry at ${s.name}%`) as { message: string } | undefined
    const m = entryMsg?.message.match(/\$([\d.]+)/)
    const entryFee = m ? Number(m[1]) : 0

    const rows = db
      .prepare(
        `SELECT i.card_id, i.variant, i.condition, i.graded_grade, i.quantity, i.status, i.cost_basis,
                (SELECT sh.sale_price - COALESCE(sh.fee, 0) FROM sale_history sh WHERE sh.inventory_id = i.id ORDER BY sh.id DESC LIMIT 1) AS net_sold
         FROM inventory i
         WHERE i.acquired_via IN ('convention','estate_lot') AND i.acquired_ref = ?`,
      )
      .all(String(s.id)) as { card_id: string; variant: string; condition: string; graded_grade: string | null; quantity: number; status: string; cost_basis: number; net_sold: number | null }[]

    let spent = entryFee
    let value = 0
    let cards = 0
    for (const r of rows) {
      spent += r.quantity * r.cost_basis
      cards += r.quantity
      if (r.status === 'sold') value += r.net_sold ?? 0
      else value += valueOfRow(r) * r.quantity
    }
    return {
      id: s.id,
      name: s.name,
      date: s.closes_at,
      entryFee: round2(entryFee),
      cards,
      spent: round2(spent),
      value: round2(value),
      net: round2(value - spent),
      active: Boolean(show && show.id === s.id),
    }
  })

  const totals = history.reduce(
    (a, h) => ({ spent: a.spent + h.spent, value: a.value + h.value }),
    { spent: 0, value: 0 },
  )

  return {
    next,
    lastShow: history.find((h) => !h.active) ?? null,
    activeShow: history.find((h) => h.active) ?? null,
    totals: { shows: history.length, spent: round2(totals.spent), value: round2(totals.value), net: round2(totals.value - totals.spent) },
  }
}
