import type Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// Native addon loading: resolve better-sqlite3 from DISK. Inside Node
// single-executable builds the embedder's `require` only knows builtins and
// import.meta is unavailable — so the resolution base is the exe/script path.
function selfBase(): string {
  if (typeof __filename !== 'undefined') return __filename
  if (process.argv[1] && fs.existsSync(process.argv[1])) return path.resolve(process.argv[1])
  return process.execPath
}
const SELF_PATH = selfBase()
const SELF_DIR = path.dirname(SELF_PATH)
const nodeRequire = createRequire(SELF_PATH)
const Sqlite = nodeRequire('better-sqlite3') as unknown as typeof Database

const __dirname = SELF_DIR
// Packaged layouts (SEA/exe): resolve the app root from TCGLIFE_HOME when set,
// otherwise walk up to the dir that owns schema.sql. Two layouts exist:
//   repo:    <root>/server/schema.sql  → root is the PARENT of the schema dir
//   release: <root>/schema.sql         → root is the dir itself
function resolveAppRoot(): string {
  if (process.env.TCGLIFE_HOME) return process.env.TCGLIFE_HOME
  let dir = __dirname
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'server', 'schema.sql'))) return dir
    if (fs.existsSync(path.join(dir, 'schema.sql'))) {
      return path.basename(dir) === 'server' ? path.dirname(dir) : dir
    }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return __dirname
}
function schemaUnder(dir: string): string | null {
  const repo = path.join(dir, 'server', 'schema.sql')
  if (fs.existsSync(repo)) return repo
  const flat = path.join(dir, 'schema.sql')
  if (fs.existsSync(flat)) return flat
  return null
}
function walkForSchema(dir: string): string | null {
  for (let i = 0; i < 6; i++) {
    const found = schemaUnder(dir)
    if (found) return found
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

const APP_ROOT = resolveAppRoot()
const DATA_DIR = path.join(APP_ROOT, 'data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

export const db = new Sqlite(path.join(DATA_DIR, 'tcglife.db')) as unknown as ReturnType<typeof Database>
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// TCGLIFE_HOME normally holds both the save and the schema (packaged layouts).
// A bare data folder — a fresh TCGLIFE_HOME, or a save copied somewhere without
// schema.sql — has no schema of its own, so fall back to the copy beside the
// running code instead of failing on a missing file before the game can boot.
const schemaPath = schemaUnder(APP_ROOT) ?? walkForSchema(__dirname) ?? path.join(APP_ROOT, 'schema.sql')
const schema = fs.readFileSync(schemaPath, 'utf-8')
db.exec(schema)

// A box (bundle/ETB/display) opens one pack at a time; this row remembers how
// many wrappers are left so closing the tab mid-box resumes at the next pack.
db.exec(`CREATE TABLE IF NOT EXISTS sealed_box_open (
  id INTEGER PRIMARY KEY,
  product_id TEXT NOT NULL,
  set_id TEXT NOT NULL,
  cards_per_pack INTEGER NOT NULL,
  packs_left INTEGER NOT NULL,
  packs_total INTEGER NOT NULL,
  per_pack_cost REAL NOT NULL,
  total_cost REAL NOT NULL,
  created_at TEXT NOT NULL
)`)
// Migrations for databases created before these columns existed.
try { db.exec('ALTER TABLE activity_log ADD COLUMN href TEXT') } catch { /* exists */ }
try { db.exec('ALTER TABLE pack_products ADD COLUMN image_url TEXT') } catch { /* exists */ }
try { db.exec("INSERT INTO supplies (kind, quantity) VALUES ('mailer', 0)") } catch { /* exists */ }
try { db.exec("ALTER TABLE inventory ADD COLUMN protection TEXT") } catch { /* exists */ }
try { db.exec("ALTER TABLE card_shows ADD COLUMN guests TEXT NOT NULL DEFAULT '[]'") } catch { /* exists */ }
try { db.exec("ALTER TABLE shop_ledger ADD COLUMN location TEXT NOT NULL DEFAULT 'main'") } catch { /* exists */ }
try { db.exec("ALTER TABLE inventory ADD COLUMN protected_at TEXT") } catch { /* exists */ }
try { db.exec("ALTER TABLE inventory ADD COLUMN worn_at TEXT") } catch { /* exists */ }
try { db.exec("ALTER TABLE franchise ADD COLUMN promoted_from INTEGER") } catch { /* exists */ }
try { db.exec("ALTER TABLE franchise ADD COLUMN promoted_wage REAL") } catch { /* exists */ }
// Manager loyalty & ambition: tenure and fair pay build trust; stars walk when
// the store outgrows their paycheck. wage_start anchors fairness; raise_demand
// holds the open ask as JSON ({ asked, filed }).
try { db.exec("ALTER TABLE franchise ADD COLUMN loyalty REAL NOT NULL DEFAULT 50") } catch { /* exists */ }
try { db.exec("ALTER TABLE franchise ADD COLUMN wage_start REAL") } catch { /* exists */ }
try { db.exec("ALTER TABLE franchise ADD COLUMN manager_since TEXT") } catch { /* exists */ }
try { db.exec("ALTER TABLE franchise ADD COLUMN raise_demand TEXT") } catch { /* exists */ }
try { db.exec('ALTER TABLE stream_breaks ADD COLUMN teams_json TEXT') } catch { /* exists */ }
try { db.exec('ALTER TABLE stream_break_spots ADD COLUMN team_dex INTEGER') } catch { /* exists */ }
try { db.exec('ALTER TABLE shop_sales ADD COLUMN roundup REAL NOT NULL DEFAULT 0') } catch { /* exists */ }
// Employees with lives: mood drifts with fair pay, xp trains quality stars up,
// day_off/day_off_ask hold granted and pending days off (game-day keys), poach
// and huff hold open crisis JSON ({ offered, rival, filed } / { kind, filed }).
try { db.exec('ALTER TABLE shop_employees ADD COLUMN xp REAL NOT NULL DEFAULT 0') } catch { /* exists */ }
try { db.exec('ALTER TABLE shop_employees ADD COLUMN mood REAL NOT NULL DEFAULT 50') } catch { /* exists */ }
try { db.exec('ALTER TABLE shop_employees ADD COLUMN day_off TEXT') } catch { /* exists */ }
try { db.exec('ALTER TABLE shop_employees ADD COLUMN day_off_ask TEXT') } catch { /* exists */ }
try { db.exec('ALTER TABLE shop_employees ADD COLUMN poach TEXT') } catch { /* exists */ }
try { db.exec('ALTER TABLE shop_employees ADD COLUMN huff TEXT') } catch { /* exists */ }
// The chain (three locations): store column on satellite rows + per-satellite ledger keys.
try { db.exec("ALTER TABLE franchise_shelf_cards ADD COLUMN store INTEGER NOT NULL DEFAULT 1") } catch { /* exists */ }
// stream_breaks on old saves may carry a NOT NULL stream_id — rebuild it NULLable.
// NOTE: plain `ALTER TABLE ... RENAME TO` rewrites REFERENCES clauses in *other*
// tables, which repointed the spots/pulls foreign keys at the dropped _old table
// the first time this ran. legacy_alter_table keeps the rename literal, and the
// block below self-heals any save that already got bitten.
try {
  const col = (db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stream_breaks'`).get() as { sql: string } | undefined)?.sql ?? ''
  if (col.includes('stream_id INTEGER NOT NULL')) {
    db.pragma('foreign_keys = OFF')
    db.pragma('legacy_alter_table = ON')
    db.exec(`ALTER TABLE stream_breaks RENAME TO stream_breaks_old;
             CREATE TABLE stream_breaks (
               id INTEGER PRIMARY KEY,
               stream_id INTEGER REFERENCES streams(id),
               product_id TEXT NOT NULL,
               product_name TEXT NOT NULL,
               set_id TEXT NOT NULL,
               spot_price REAL NOT NULL,
               product_cost REAL NOT NULL,
               spots_total INTEGER NOT NULL,
               spots_sold INTEGER NOT NULL DEFAULT 0,
               gross REAL NOT NULL DEFAULT 0,
               status TEXT NOT NULL DEFAULT 'selling',
               created_at TEXT NOT NULL,
               settled_at TEXT
             );
             INSERT INTO stream_breaks SELECT * FROM stream_breaks_old;
             DROP TABLE stream_breaks_old;`)
    db.pragma('legacy_alter_table = OFF')
    db.pragma('foreign_keys = ON')
  }
} catch { /* fresh or already migrated */ }
// Self-heal: a save that ran the pre-legacy_alter_table migration still has
// spots/pulls tables whose REFERENCES point at the dropped stream_breaks_old.
const BREAK_CHILD_DDL: Record<string, string> = {
  stream_break_spots: `CREATE TABLE stream_break_spots (
    id INTEGER PRIMARY KEY,
    break_id INTEGER NOT NULL REFERENCES stream_breaks(id),
    spot_no INTEGER NOT NULL,
    team TEXT NOT NULL,
    team_dex INTEGER,
    holder TEXT NOT NULL,
    payout REAL NOT NULL DEFAULT 0,
    pulls INTEGER NOT NULL DEFAULT 0,
    claimed_at TEXT NOT NULL
  )`,
  stream_break_pulls: `CREATE TABLE stream_break_pulls (
    id INTEGER PRIMARY KEY,
    break_id INTEGER NOT NULL REFERENCES stream_breaks(id),
    spot_id INTEGER,
    card_id TEXT NOT NULL,
    value REAL NOT NULL,
    pack_no INTEGER NOT NULL
  )`,
}
for (const [child, ddl] of Object.entries(BREAK_CHILD_DDL)) {
  try {
    const sql = (db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(child) as { sql: string } | undefined)?.sql ?? ''
    if (!sql.includes('stream_breaks_old')) continue
    db.pragma('foreign_keys = OFF')
    db.exec(`ALTER TABLE ${child} RENAME TO ${child}_fix;
             ${ddl};
             INSERT INTO ${child} SELECT * FROM ${child}_fix;
             DROP TABLE ${child}_fix;`)
    db.pragma('foreign_keys = ON')
  } catch { /* rebuilt already */ }
}
try { db.exec("ALTER TABLE franchise_sales ADD COLUMN store INTEGER NOT NULL DEFAULT 1") } catch { /* exists */ }
try { db.exec("ALTER TABLE franchise_shelf_cards ADD COLUMN arrived_at TEXT") } catch { /* exists */ }
try { db.exec('CREATE INDEX IF NOT EXISTS idx_franchise_shelf_store ON franchise_shelf_cards (store)') } catch { /* exists */ }
{
  // Rebuild the satellite CHECK constraint on saves from before the region
  // era (id = 1 only, or id IN (1, 2)). The DDL mirrors schema.sql exactly —
  // column order matters, the copy is positional.
  const chk = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'franchise'").get() as { sql: string } | undefined)?.sql ?? ''
  if (chk && !chk.includes('id IN (1, 2, 3)')) {
    try {
      db.exec('ALTER TABLE franchise RENAME TO franchise_old')
      db.exec("CREATE TABLE franchise (\n  id INTEGER PRIMARY KEY CHECK (id IN (1, 2, 3)),\n  name TEXT NOT NULL,\n  tier TEXT NOT NULL,\n  manager_name TEXT NOT NULL,\n  manager_quality INTEGER NOT NULL,\n  manager_wage REAL NOT NULL,\n  opened_at TEXT NOT NULL,\n  last_rent_day TEXT,\n  reputation INTEGER NOT NULL DEFAULT 0,\n  lifetime_revenue REAL NOT NULL DEFAULT 0,\n  lifetime_cost REAL NOT NULL DEFAULT 0,\n  customer_count INTEGER NOT NULL DEFAULT 0,\n  today_customers INTEGER NOT NULL DEFAULT 0,\n  today_revenue REAL NOT NULL DEFAULT 0,\n  no_sale_streak INTEGER NOT NULL DEFAULT 0,\n  skim_streak INTEGER NOT NULL DEFAULT 0,\n  promoted_from INTEGER,\n  promoted_wage REAL,\n  loyalty REAL NOT NULL DEFAULT 50,\n  wage_start REAL,\n  manager_since TEXT,\n  raise_demand TEXT\n)")
      // Explicit columns, never SELECT *: pre-loyalty saves carry 18 columns
      // and a positional copy would mismatch the 22-column rebuild — and the
      // catch block would leave the save with NO franchise table.
      db.exec(`INSERT INTO franchise (id, name, tier, manager_name, manager_quality, manager_wage, opened_at, last_rent_day, reputation, lifetime_revenue, lifetime_cost, customer_count, today_customers, today_revenue, no_sale_streak, skim_streak, promoted_from, promoted_wage)
               SELECT id, name, tier, manager_name, manager_quality, manager_wage, opened_at, last_rent_day, reputation, lifetime_revenue, lifetime_cost, customer_count, today_customers, today_revenue, no_sale_streak, skim_streak, promoted_from, promoted_wage FROM franchise_old`)
      db.exec('DROP TABLE franchise_old')
    } catch (e) {
      // Never brick a boot over the rebuild — restore whatever happened.
      try { db.exec('DROP TABLE IF EXISTS franchise_old') } catch { /* ignore */ }
      console.log('[migrate] franchise CHECK rebuild skipped:', e instanceof Error ? e.message : e)
    }
  }
}
try { db.exec("UPDATE shop_ledger SET location = 'satellite:1' WHERE location = 'satellite'") } catch { /* rebuilt already */ }
{
  // Host-show booths: vendor_tables predates the nullable convention_id +
  // host_show_id columns — rebuild it. Same RENAME trap as stream_breaks
  // (vendor_sales REFERENCES would be rewritten), so legacy_alter_table is on
  // and foreign keys off for the swap.
  const vt = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vendor_tables'").get() as { sql: string } | undefined)?.sql ?? ''
  if (vt.includes('convention_id INTEGER NOT NULL')) {
    try {
      db.pragma('foreign_keys = OFF')
      db.pragma('legacy_alter_table = ON')
      db.exec(`ALTER TABLE vendor_tables RENAME TO vendor_tables_old;
               CREATE TABLE vendor_tables (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 convention_id INTEGER REFERENCES conventions(id) ON DELETE CASCADE,
                 host_show_id INTEGER REFERENCES card_shows(id) ON DELETE CASCADE,
                 fee REAL NOT NULL,
                 location TEXT NOT NULL DEFAULT 'main floor',
                 revenue REAL NOT NULL DEFAULT 0,
                 cost_out REAL NOT NULL DEFAULT 0,
                 buyer_count INTEGER NOT NULL DEFAULT 0,
                 settled INTEGER NOT NULL DEFAULT 0,
                 opened_at TEXT NOT NULL
               );
               INSERT INTO vendor_tables (id, convention_id, fee, location, revenue, cost_out, buyer_count, settled, opened_at)
                 SELECT id, convention_id, fee, location, revenue, cost_out, buyer_count, settled, opened_at FROM vendor_tables_old;
               DROP TABLE vendor_tables_old;`)
      db.pragma('legacy_alter_table = OFF')
      db.pragma('foreign_keys = ON')
    } catch { /* rebuilt already */ }
  }
}

export const nowIso = () => new Date().toISOString()

// Local marketplace (Facebook Marketplace / Craigslist) — table + fake flag on
// existing DBs. local.ts also self-migrates columns, but the table must exist
// before its first ensureColumns() PRAGMA call.
try {
  db.exec(`CREATE TABLE IF NOT EXISTS local_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL REFERENCES cards(id),
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
    sold_at TEXT
  )`)
  const invCols = (db.prepare(`PRAGMA table_info(inventory)`).all() as { name: string }[]).map((c) => c.name)
  if (!invCols.includes('is_fake')) db.exec(`ALTER TABLE inventory ADD COLUMN is_fake INTEGER NOT NULL DEFAULT 0`)
} catch { /* migration runs after schema load in fresh installs */ }

// price_records had NO unique constraint, so on every boot the catalog seed's
//   INSERT OR IGNORE INTO price_records ... SELECT ... FROM seed.price_records
// re-inserted all ~53k seed prices as brand-new duplicates (OR IGNORE ignores
// nothing when there is no constraint to violate). Daily takeSnapshot() also
// copied the latest price for ALL ~20k catalog cards into history. The table
// grew past 3.3M rows / 800MB, and the boot-time "unpriced" scans
//   ... NOT IN (SELECT card_id FROM price_records WHERE market IS NOT NULL ...)
// are O(table): they blocked the single-threaded event loop for ~20-66s, so the
// port bound but no request was answered and the WebView2 splash never cleared —
// i.e. "the game won't launch."
//
// Self-heal, guarded by the index's existence so it runs once per save: dedupe,
// cap history (owned/wishlist keep 90 points for the portfolio chart, every
// other card keeps only its newest price), then add the unique index so the
// seed becomes a genuine no-op. Fresh saves skip the dedupe/cap (index is added
// against an empty/tiny table). Kept OUT of schema.sql on purpose: a
// CREATE UNIQUE INDEX there would abort db.exec(schema) on a bloated save and
// brick the boot before this guard could run.
try {
  const hasIdx = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'ux_price_records_natural'`).get()
  if (!hasIdx) {
    const row = db.prepare('SELECT COUNT(*) AS n FROM price_records').get() as { n: number }
    if (row.n > 0) {
      db.transaction(() => {
        db.exec(`DELETE FROM price_records WHERE id NOT IN (
                   SELECT MAX(id) FROM price_records GROUP BY card_id, kind, variant, retrieved_at)`)
        db.exec(`DELETE FROM price_records WHERE id NOT IN (
                   SELECT id FROM (
                     SELECT id, card_id,
                            ROW_NUMBER() OVER (
                              PARTITION BY card_id, kind, variant
                              ORDER BY retrieved_at DESC, id DESC
                            ) AS rn
                     FROM price_records
                   ) ranked
                   WHERE ranked.rn <= CASE
                     WHEN ranked.card_id IN (
                       SELECT DISTINCT card_id FROM inventory WHERE status != 'sold'
                       UNION
                       SELECT DISTINCT card_id FROM wishlist
                     ) THEN 90
                     ELSE 1
                   END)`)
      })()
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_price_records_natural
             ON price_records (card_id, kind, variant, retrieved_at)`)
    if (row.n > 0) console.log(`[migrate] price_records self-heal: deduped + capped history, added unique index (was ${row.n.toLocaleString()} rows)`)
  }
} catch (e) {
  // Never brick a boot over this — the game still runs without the index; it
  // just won't be protected from future seed duplication on this save.
  console.warn('[migrate] price_records self-heal skipped:', e instanceof Error ? e.message : e)
}

export function getMeta(key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setMeta(key: string, value: string) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function getSetting(key: string, fallback: string | null = null): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? fallback
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function logActivity(kind: string, message: string, amount?: number, href?: string) {
  db.prepare('INSERT INTO activity_log (kind, message, amount, created_at, href) VALUES (?, ?, ?, ?, ?)')
    .run(kind, message, amount ?? null, nowIso(), href ?? null)
}
