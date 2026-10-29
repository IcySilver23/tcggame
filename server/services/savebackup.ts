import fs from 'node:fs'
import path from 'node:path'
import { db, getMeta, setMeta, logActivity } from '../lib/db'
import { gameDayKey } from '../lib/gameday'
import { recordSnapshot } from './networth'
import * as sync from './sync'

// ---------------------------------------------------------------------------
// Rolling save backups — one snapshot per game day, the last 3 kept.
//
// The engine's day unit is one ~20s market tick batch (rent, wear, disasters
// all gate on a UTC day-key, 1 game-day = 1 real UTC day). A "real-time" snapshot cadence
// would take ~20 minutes to notice a save-ruining mistake; per-tick would
// churn 3 snapshots a minute. So a snapshot fires on the FIRST tick batch of
// each new UTC day — the same heartbeat every other daily system uses.
//
// Snapshots are real SQLite databases written by better-sqlite3's backup API
// (the same online-backup the sqlite CLI and DB browsers use): it copies the
// database page-by-page from the live WAL connection into a fresh file, so
// the snapshot is never torn even though the game keeps writing.
//
// Restore runs the same primitive in reverse: a second readonly connection on
// the snapshot backs up ONTO the live file while the game connection is open.
// sqlite's backup step resets the destination's WAL and the live connection
// sees the restored world immediately (verified — no restart, no locks).
// ---------------------------------------------------------------------------

const KEEP = 3
const DAY_KEY = 'saves:lastBackupDay'

// Same native class as the live connection (db.constructor) — used to open
// snapshots for conversion and inspection. Inspect opens get a short busy
// timeout so a locked/torn file fails fast instead of parking the event
// loop for the 5s default × every file in the directory.
const SqliteFile = db.constructor as new (p: string, o?: { readonly?: boolean; timeout?: number }) => typeof db

// data/ resolves the same way everywhere: db.ts has already created it under
// APP_ROOT, so the live file's own directory is the one source of truth.
export const BACKUP_DIR = path.join(path.dirname(db.name), 'backups')

export type SaveBackup = {
  file: string
  createdAt: string
  bytes: number
  inventory: number
  sealed: number
  cash: number | null
}

type SnapshotRow = { cash: number | null; inventory: number; sealed: number }

function inspectSnapshot(file: string): SnapshotRow {
  const fallback: SnapshotRow = { cash: null, inventory: 0, sealed: 0 }
  try {
    // Torn residue from an interrupted copy (0-byte files) opens fine as an
    // empty db and then throws "no such table" per query — reject by size
    // before ever touching sqlite.
    if (fs.statSync(file).size < 4096) return fallback
    const s = new SqliteFile(file, { readonly: true, timeout: 250 })
    try {
      const cash = s.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number } | undefined
      return {
        cash: cash?.cash ?? null,
        inventory: (s.prepare(`SELECT COALESCE(SUM(quantity),0) AS n FROM inventory WHERE status IN ('collection','grading','listed')`).get() as { n: number }).n,
        sealed: (s.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM sealed_inventory').get() as { n: number }).n,
      }
    } finally {
      s.close()
    }
  } catch (err) {
    // Locked or torn file — report once per call but never rethrow, so a
    // bad snapshot can't take out the listing/prune pass.
    console.error('[saves] inspect failed for', path.basename(file), ':', err instanceof Error ? err.message : err)
    return fallback
  }
}

export function listBackups(): SaveBackup[] {
  let entries: string[] = []
  try {
    entries = fs.readdirSync(BACKUP_DIR).filter((f) => /^save-\d{8}-\d{6}(\.\d+)?\.db$/.test(f))
  } catch {
    return []
  }
  const rows: SaveBackup[] = []
  for (const f of entries) {
    try {
      const st = fs.statSync(path.join(BACKUP_DIR, f))
      rows.push({ file: f, createdAt: st.mtime.toISOString(), bytes: st.size, ...inspectSnapshot(path.join(BACKUP_DIR, f)) })
    } catch {
      // vanishing mid-list (prune raced us) — skip it
    }
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return rows
}

function pruneOldBackups() {
  // Stat-only scan: prune never needs cash/inventory, and a piled-up
  // directory must not turn the keep-3 trim into hundreds of sqlite opens.
  let entries: string[] = []
  try {
    entries = fs.readdirSync(BACKUP_DIR).filter((f) => /^save-\d{8}-\d{6}(\.\d+)?\.db$/.test(f))
  } catch {
    return
  }
  const rows: { file: string; mtime: string; bytes: number }[] = []
  for (const f of entries) {
    try {
      const st = fs.statSync(path.join(BACKUP_DIR, f))
      rows.push({ file: f, mtime: st.mtime.toISOString(), bytes: st.size })
    } catch {
      // vanishing mid-scan — skip
    }
  }
  rows.sort((a, b) => b.mtime.localeCompare(a.mtime))
  let kept = 0
  for (const r of rows) {
    // Torn residue (0-byte files) is never a keeper — drop it first so a
    // pile of them can't squat the keep-3 slots.
    if (r.bytes >= 4096 && kept < KEEP) {
      kept++
      continue
    }
    try { fs.unlinkSync(path.join(BACKUP_DIR, r.file)) } catch { /* next pass */ }
  }
}

/** UI status: the last game day that produced a snapshot (day-key gate). */
export function saveBackupStatus() {
  return { lastDay: getMeta(DAY_KEY) }
}

/**
 * In-flight guard: at most ONE snapshot exists at a time. The day-key lands
 * only after a backup resolves, so while one was starved the tick re-fired
 * every ~20s and stacked another — each stacked pass then re-inspected every
 * file in the directory, and the pile-up wedged the event loop.
 */
let inFlight: Promise<SaveBackup | null> | null = null

/** True once per game day (first tick batch that crosses a 00:00/12:00 UTC boundary). */
export function saveBackupTick() {
  if (inFlight) return // one snapshot at a time — the next tick retries
  if (getMeta(DAY_KEY) === dayKeyNow()) return
  // Catalog churn (full sync or the weekly delta) is the one moment a
  // snapshot would waste its turn describing a half-updated catalog — defer
  // to the next 20s tick. Either way the image stays transactionally sound.
  if (sync.getSyncProgress().running || sync.catalogDeltaStatus().running) return
  void snapshot('daily') // marks the day itself, only on success
}

/**
 * Take a snapshot right now. reason: 'daily' (the game-day tick) or 'manual'
 * (pre-restore safety copy and the Settings button). opts.prune=false skips
 * the keep-3 trim — the pre-restore safety copy uses this, because pruning
 * BEFORE the restore could delete the very snapshot being restored.
 */
export function snapshot(reason: 'daily' | 'manual', opts: { prune?: boolean } = {}): Promise<SaveBackup | null> {
  // Serialize onto whatever is already running (the tick guard is the real
  // gate; this just makes a manual/restore safety copy queue behind a daily
  // instead of interleaving two page-by-page backups).
  const run = (inFlight ?? Promise.resolve(null)).then(() => takeSnapshot(reason, opts))
  inFlight = run
  run.finally(() => { if (inFlight === run) inFlight = null }).catch(() => {}) // detached chain; takeSnapshot never rejects
  return run
}

async function takeSnapshot(reason: 'daily' | 'manual', opts: { prune?: boolean } = {}): Promise<SaveBackup | null> {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    const suffix = reason === 'daily' ? '' : `.${Date.now()}`
    const target = path.join(BACKUP_DIR, `save-${stamp()}${suffix}.db`)
    // 1024 pages (4MB) per event-loop turn instead of better-sqlite3's 100:
    // on a loaded server the default stretches a big save's copy into
    // thousands of interleaved steps (minutes), which kept the day-key unset
    // and let the tick re-fire. A handful of larger steps finishes the copy
    // in a few turns while still yielding to requests.
    await db.backup(target, { progress: () => 1024 })
    // The backup inherits the live db's WAL journaling (stray -wal/-shm
    // sidecars and all), and a READONLY open of a WAL db fails outright on
    // Windows while the server process is busy — so convert every snapshot
    // to a plain single-file db (checkpoints + drops the sidecars). Also
    // makes snapshots trivially portable for the user.
    try {
      const t = new SqliteFile(target)
      t.pragma('journal_mode = DELETE')
      t.close()
      for (const side of ['-wal', '-shm']) fs.rmSync(target + side, { force: true })
    } catch { /* still a valid db either way */ }
    // A guaranteed-rollback safety copy before a restore can never be the
    // day's snapshot, so it skips the day-key too (repeated restores within
    // one day each earn their own safety net).
    if (reason === 'daily') setMeta(DAY_KEY, dayKeyNow())
    const st = fs.statSync(target)
    const row = { file: path.basename(target), createdAt: st.mtime.toISOString(), bytes: st.size, ...inspectSnapshot(target) }
    if (opts.prune !== false) pruneOldBackups()
    if (reason === 'daily') {
      logActivity('system', `💾 Save snapshot taken (day ${dayKeyNow()}) — the last 3 live in Settings → Save backups.`)
      console.log(`[saves] daily snapshot -> ${row.file} (${(row.bytes / 1024).toFixed(0)} KB)`)
    } else {
      console.log(`[saves] ${reason} snapshot -> ${row.file} (${(row.bytes / 1024).toFixed(0)} KB)`)
    }
    return row
  } catch (err) {
    console.error('[saves] snapshot failed:', err instanceof Error ? err.message : err)
    return null
  }
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function dayKeyNow(): string {
  return gameDayKey() // snapshots ride the 12h game-day clock
}

/**
 * Copy a snapshot back over the live save. Safe to call while the server is
 * running: the restore is a sqlite online backup FROM the snapshot ONTO the
 * live file, so no locks, no restart — the game just continues from the
 * snapshot's moment. A pre-restore safety snapshot is taken first, so a
 * restore is always itself undoable.
 */
export async function restoreBackup(file: string): Promise<{ ok: boolean; error?: string; safety?: string }> {
  if (!/^save-\d{8}-\d{6}(\.\d+)?\.db$/.test(file)) return { ok: false, error: 'Not a valid snapshot name' }
  const src = path.join(BACKUP_DIR, file)
  if (!fs.existsSync(src)) return { ok: false, error: 'Snapshot not found' }
  const live = path.join(path.dirname(db.name), 'tcglife.db')
  if (path.resolve(src) === path.resolve(live)) return { ok: false, error: 'Refusing to restore the live save onto itself' }

  // Safety copy of the current world BEFORE anything is touched — taken
  // without pruning, since the restore source is often the oldest snapshot
  // and a trim here would delete it mid-restore. The trim runs after success.
  const safety = await snapshot('manual', { prune: false })
  if (!safety) return { ok: false, error: 'Could not take the pre-restore safety snapshot — restore aborted' }

  try {
    const srcDb = new SqliteFile(src, { readonly: true })
    try {
      await srcDb.backup(live)
    } finally {
      srcDb.close()
    }
  } catch (err) {
    console.error('[saves] restore failed:', err instanceof Error ? err.message : err)
    return { ok: false, error: `Restore failed: ${err instanceof Error ? err.message : 'unknown error'}` }
  }

  // Log into the RESTORED world (the insert lands in the same db the snapshot
  // describes) and refresh the weekly net-worth point against restored numbers.
  logActivity('system', `⏪ Restored save snapshot ${file} — the game continues from its moment. Your pre-restore state was kept as ${safety.file}.`)
  try { recordSnapshot() } catch { /* net-worth refresh is cosmetic */ }
  pruneOldBackups()
  return { ok: true, safety: safety.file }
}
