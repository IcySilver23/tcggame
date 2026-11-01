import { db, nowIso } from '../lib/db'

// ---------------------------------------------------------------------------
// Notifications — the things you need to be told, not the things that scroll by.
//
// The activity feed is a diary: it records everything and forgets nothing, so a
// parcel landing or a trade offer expiring can slide past while you are in
// another screen. This is the other half — a short, dismissible list of events
// that want an answer, with an unread count the header can badge.
//
// Every event carries a dedupe key so a re-run of the tick that produced it
// cannot stack duplicates, and the table is pruned to the newest few hundred.
// ---------------------------------------------------------------------------

export type NotifyKind = 'delivery' | 'trade' | 'sale' | 'system'

export type NotificationRow = {
  id: number
  kind: NotifyKind
  title: string
  body: string | null
  href: string | null
  read_at: string | null
  created_at: string
}

let ensured = false

function ensure(): void {
  if (ensured) return
  db.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    href TEXT,
    dedupe_key TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC)')
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications (dedupe_key) WHERE dedupe_key IS NOT NULL')
  ensured = true
}

/**
 * Raise a notification. `dedupeKey` makes the call idempotent: the same parcel
 * or the same offer never badges twice, and an unread copy gets its copy
 * refreshed instead of duplicated.
 */
export function push(
  kind: NotifyKind,
  title: string,
  body: string | null = null,
  href: string | null = null,
  dedupeKey: string | null = null,
): void {
  try {
    ensure()
    const r = db
      .prepare('INSERT OR IGNORE INTO notifications (kind, title, body, href, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kind, title, body, href, dedupeKey, nowIso())
    if (r.changes === 0 && dedupeKey) {
      db.prepare('UPDATE notifications SET title = ?, body = ?, href = ? WHERE dedupe_key = ? AND read_at IS NULL')
        .run(title, body, href, dedupeKey)
    }
  } catch (err) {
    // A notification must never take a game action down with it.
    console.warn('[notify] push failed:', err instanceof Error ? err.message : err)
  }
}

export function list(limit = 40): NotificationRow[] {
  ensure()
  return db
    .prepare('SELECT id, kind, title, body, href, read_at, created_at FROM notifications ORDER BY id DESC LIMIT ?')
    .all(limit) as NotificationRow[]
}

export function unreadCount(): number {
  ensure()
  return (db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL').get() as { n: number }).n
}

export function markRead(id: number): void {
  ensure()
  db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL').run(nowIso(), id)
}

export function markAllRead(): void {
  ensure()
  db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(nowIso())
}

/** Keep the list short enough to read — newest 200 survive. */
export function prune(keep = 200): void {
  ensure()
  db.prepare('DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT ?)').run(keep)
}
