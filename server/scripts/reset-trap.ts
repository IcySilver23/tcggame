// Regression trap for the save-reset wipe (Settings → "Reset save").
//
// Run: npx tsx server/scripts/reset-trap.ts
//
// Builds a fresh save, seeds EVERY chain the wipe touches — the FK chains
// that can BLOCK a reset (pawn shipped inverted in 0.5.86: shelf → loans →
// inventory deleted after inventory, so any save with an open pawn loan threw
// FOREIGN KEY, the transaction rolled back, and cash never reached $1,000),
// the businesses/records/world tables added by the 0.5.87 "absolutely
// everything resets" rewrite, and both flavors of meta (state that must die —
// psarush:state was the key the old blacklist missed — and config keepers).
//
// Asserts three things:
//   1. the trap is ARMED — replaying the old wipe order (DELETE FROM
//      inventory while a pawn loan exists) must throw, so a "passing" run can't
//      be a silently-disarmed seed;
//   2. resetSave() commits on that same save: cash $1,000, day-1 stamps, one
//      Main Collection binder, every wiped table at zero, finance back to
//      schema defaults, meta exactly the keepers, card database untouched;
//   3. a second resetSave() is idempotent.
//
// Service modules are imported only for their boot-time CREATE TABLE side
// effect (liveshopping/fleamarket/forum/deliveries/salestax/vault/demographics
// tables live outside schema.sql); none of them start timers at load.
import fs from 'node:fs'
import path from 'node:path'

// TCGLIFE_HOME must be set before anything touches ../lib/db.
const home = path.join(process.cwd().replace(/\\/g, '/'), 'tmp-reset-trap')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'server'), { recursive: true })
fs.copyFileSync('server/schema.sql', path.join(home, 'server', 'schema.sql'))
process.env.TCGLIFE_HOME = home

const { db } = await import('../lib/db')
// Service DDL side effects (tables not in schema.sql):
await import('../services/vault')
await import('../services/salestax')
await import('../services/deliveries')
await import('../services/forum')
await import('../services/fleamarket')
await import('../services/liveshopping')
await import('../services/demographics')
const { resetSave, META_KEEP } = await import('../services/savereset')

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) { failures++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
  else console.log(`  ✓ ${label}`)
}
const TABLES = new Set(
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name),
)
const n = (table: string) => (db.prepare(`SELECT COUNT(*) c FROM "${table}"`).get() as { c: number }).c
const T = '2026-09-01T00:00:00.000Z'
const NOW = new Date().toISOString()

// pawn tables live in pawn.ts (not schema.sql) — mirror the DDL so the test
// doesn't drag the whole pawn service graph in.
db.exec(`CREATE TABLE IF NOT EXISTS pawn_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id),
  card_id TEXT NOT NULL REFERENCES cards(id),
  principal REAL NOT NULL,
  rate_daily REAL NOT NULL,
  interest_paid REAL NOT NULL DEFAULT 0,
  issued_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  last_accrual_day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  repaid_at TEXT, repaid_amount REAL, defaulted_at TEXT
)`)
db.exec(`CREATE TABLE IF NOT EXISTS pawn_shelf (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id INTEGER NOT NULL REFERENCES pawn_loans(id),
  card_id TEXT NOT NULL REFERENCES cards(id),
  ask REAL NOT NULL,
  listed_at TEXT NOT NULL,
  sold_to TEXT
)`)
// auth_tickets lives in auth.ts (not schema.sql) — cascade child of inventory.
db.exec(`CREATE TABLE IF NOT EXISTS auth_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  fee REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_lab',
  created_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  arrived_at TEXT
)`)
TABLES.add('pawn_loans'); TABLES.add('pawn_shelf'); TABLES.add('auth_tickets')

// ---------------------------------------------------------------- helpers
const ins = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...p)

/** Insert one row with every required column auto-filled by convention:
 *  card_id → trap-card, set_id → trapset, *_id → parent id 1 (inventory → 3),
 *  *_at → now, TEXT → 'trap', numbers → 1; defaults and nullables skipped.
 *  `extra` overrides anything (single-row ids, unusual NOT NULLs). */
const seedAuto = (table: string, extra: Record<string, unknown> = {}) => {
  if (!TABLES.has(table)) { console.error(`  ! seed skipped, no table: ${table}`); return }
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[]
  const values: Record<string, unknown> = {}
  for (const c of cols) {
    if (extra[c.name] !== undefined) { values[c.name] = extra[c.name]; continue }
    if (c.pk) {
      // integer primary key = rowid alias: omit it and one is assigned (works
      // with or without AUTOINCREMENT — and avoids colliding with rows the
      // schema itself seeds, like shop_cases). TEXT pks fall through.
      if (c.type.toUpperCase() === 'INTEGER') continue
    } else {
      if (c.dflt_value !== null) continue            // column default applies
      if (!c.notnull) continue                       // nullable → NULL
    }
    if (c.name === 'card_id') values[c.name] = 'trap-card'
    else if (c.name === 'set_id') values[c.name] = 'trapset'
    else if (c.name === 'pack_product_id' || c.name === 'product_id') values[c.name] = 'trap-pack'
    else if (c.name === 'inventory_id') values[c.name] = 3
    else if (c.name.endsWith('_id')) values[c.name] = 1
    else if (/_at$/.test(c.name)) values[c.name] = NOW
    else if (c.type.toUpperCase() === 'TEXT') values[c.name] = 'trap'
    else values[c.name] = 1
  }
  const names = Object.keys(values)
  if (!names.length) { ins(`INSERT INTO "${table}" DEFAULT VALUES`); return }
  ins(`INSERT INTO "${table}" (${names.map((x) => `"${x}"`).join(',')}) VALUES (${names.map(() => '?').join(',')})`, ...names.map((k) => values[k]))
}

// ---------------------------------------------------------------- seed: core
ins(`INSERT OR IGNORE INTO game_state (id, cash, created_at, last_tick_at) VALUES (1, 1000, ?, ?)`, T, T)
ins(`UPDATE game_state SET cash = 7777, created_at = ?, last_tick_at = ? WHERE id = 1`, T, T)
ins(`INSERT INTO sets (id, name, series) VALUES ('trapset', 'Trap Set', 'Trap Series')`)
ins(`INSERT INTO cards (id, set_id, name, number) VALUES ('trap-card', 'trapset', 'Trap Card', '1')`)
ins(`INSERT INTO pack_products (id, set_id, name, kind, packs, cards_per_pack) VALUES ('trap-pack', 'trapset', 'Trap Booster', 'booster', 6, 10)`)
ins(`INSERT INTO inventory (card_id, status, acquired_at) VALUES ('trap-card', 'listed', ?)`, T)          // inv 1
ins(`INSERT INTO inventory (card_id, status, acquired_at) VALUES ('trap-card', 'pawned', ?)`, T)           // inv 2
ins(`INSERT INTO inventory (card_id, acquired_at) VALUES ('trap-card', ?)`, T)                             // inv 3

// THE regression chain: shelf → loan → inventory
ins(`INSERT INTO pawn_loans (inventory_id, card_id, principal, rate_daily, issued_at, due_at, last_accrual_day) VALUES (2, 'trap-card', 50, 0.0075, ?, ?, ?)`, T, T, T)
ins(`INSERT INTO pawn_shelf (loan_id, card_id, ask, listed_at) VALUES (1, 'trap-card', 80, ?)`, T)

// binder chain (child of inventory, cascade)
ins(`INSERT INTO binders (name, accent, created_at) VALUES ('Old Binder', 'red', ?)`, T)
ins(`INSERT INTO binder_slots (binder_id, page, slot, inventory_id, placed_at) VALUES (1, 0, 0, 3, ?)`, T)

// eBay chain: feedback → listings → inventory; auctions → inventory; market/watches/npc → cards
ins(`INSERT INTO ebay_listings (inventory_id, card_id, ask, market_at_list, listed_at) VALUES (1, 'trap-card', 10, 12, ?)`, T)
ins(`INSERT INTO ebay_feedback (listing_id, buyer, stars, comment, created_at) VALUES (1, 'Buyer', 5, 'ok', ?)`, T)
ins(`INSERT INTO ebay_watches (card_id, created_at) VALUES ('trap-card', ?)`, T)
ins(`INSERT INTO ebay_market (card_id, ask, market_at_list, seller, listed_at, expires_at) VALUES ('trap-card', 9, 11, 'Seller', ?, ?)`, T, T)
ins(`INSERT INTO ebay_auctions (inventory_id, card_id, start, market_at_list, listed_at, closes_at) VALUES (1, 'trap-card', 10, 12, ?, ?)`, T, T)
ins(`INSERT INTO ebay_npc_auctions (card_id, market_at_list, min_next, listed_at, closes_at) VALUES ('trap-card', 12, 11, ?, ?)`, T, T)

// vendor chain: vendor_sales → vendor_tables (+inventory row)
ins(`INSERT INTO vendor_tables (fee, opened_at) VALUES (25, ?)`, T)
ins(`INSERT INTO vendor_sales (table_id, inventory_id, card_id, variant, condition, quantity, price, cost_basis, sold_at) VALUES (1, 3, 'trap-card', 'normal', 'NM', 1, 10, 4, ?)`, T)

// trader chain: trade_offers / trader_cards → traders
ins(`INSERT INTO traders (name, handle, archetype, cash, seed_cash, traits, blurb, avatar, created_at) VALUES ('Trap Trader', 'trap', 'flipper', 500, 500, '{}', 'b', 'a', ?)`, T)
ins(`INSERT INTO trader_cards (trader_id, card_id, acquired_at) VALUES (1, 'trap-card', ?)`, T)
ins(`INSERT INTO trade_offers (trader_id, direction, expires_at, created_at) VALUES (1, 'incoming', ?, ?)`, T, T)

// convention chain: items → booths → conventions; estate_lot_cards → estate_lots → conventions
ins(`INSERT INTO conventions (name, blurb, entry_fee, opened_at, closes_at) VALUES ('TrapCon', 'b', 5, ?, ?)`, T, T)
ins(`INSERT INTO convention_booths (convention_id, vendor_name, avatar, specialty, blurb) VALUES (1, 'V', 'a', 'deals', 'b')`)
ins(`INSERT INTO convention_items (booth_id, card_id, ask) VALUES (1, 'trap-card', 10)`)
ins(`INSERT INTO estate_lots (convention_id, seller_name, flavor, card_count, ask, seller_estimate) VALUES (1, 'E', 'bulk_clearout', 5, 20, 30)`)
ins(`INSERT INTO estate_lot_cards (lot_id, card_id) VALUES (1, 'trap-card')`)

// auctions (player consignment) → inventory
ins(`INSERT INTO auctions (card_id, inventory_id, anchor, estimate_low, estimate_high, opened_at, closes_at) VALUES ('trap-card', 1, 10, 8, 14, ?, ?)`, T, T)

// stream chain: pulls/spots → breaks → streams; stats; sponsors
ins(`INSERT INTO streams (id, product_id, product_name, set_id, kind, price, packs_planned, started_at) VALUES (1, 'trap-pack', 'Trap Booster', 'trapset', 'booster', 30, 6, ?)`, T)
ins(`INSERT INTO stream_breaks (id, stream_id, product_id, product_name, set_id, spot_price, product_cost, spots_total, created_at) VALUES (1, 1, 'trap-pack', 'Trap Booster', 'trapset', 10, 20, 4, ?)`, T)
ins(`INSERT INTO stream_break_spots (break_id, spot_no, team, holder, claimed_at) VALUES (1, 1, 'Team', 'You', ?)`, T)
ins(`INSERT INTO stream_break_pulls (break_id, spot_id, card_id, value, pack_no) VALUES (1, 1, 'trap-card', 5, 1)`)
ins(`INSERT INTO stream_stats (id) VALUES (1)`)
ins(`INSERT INTO sponsor_offers (brand, product_kind, brand_label, tagline, packs_required, payout_per_pack, follower_bonus, expires_at, created_at) VALUES ('B', 'booster', 'L', 't', 10, 5, 10, ?, ?)`, T, T)
ins(`INSERT INTO sponsor_contracts (brand, product_kind, brand_label, packs_required, payout_per_pack, follower_bonus, accepted_at) VALUES ('B', 'booster', 'L', 10, 5, 10, ?)`, T)

// misc wipes: pack_battles, rival_memory, tournaments, resale, buylist, local, sealed
ins(`INSERT INTO pack_battles (product_id, opponent_id, stake, player_total, opponent_total, player_cards, opponent_cards, winner, created_at) VALUES ('trap-pack', 'opp', 10, 20, 15, '[]', '[]', 'player', ?)`, T)
ins(`INSERT INTO rival_memory (opponent_id, updated_at) VALUES ('opp', ?)`, T)
ins(`INSERT INTO tournaments (size, entry, bracket, created_at) VALUES (4, 10, '[]', ?)`, T)
ins(`INSERT INTO resale_deals (id, seller, seller_type, message, ask, true_value, created_at, expires_at) VALUES (1, 'S', 'collection', 'm', 30, 40, ?, ?)`, T, T)
ins(`INSERT INTO resale_deal_cards (deal_id, card_id, position) VALUES (1, 'trap-card', 1)`)
ins(`INSERT INTO buylist_shelf (shop_id, card_id, price, listed_at) VALUES (1, 'trap-card', 12, ?)`, T)
ins(`INSERT INTO buylist_credit_history (shop_id, delta, created_at, note) VALUES (1, 5, ?, 'n')`, T)
ins(`INSERT INTO yard_sales (seller, neighborhood, opens_at, closes_at, created_at) VALUES ('Y', 'N', ?, ?, ?)`, T, T, T)
ins(`INSERT INTO yard_sale_cards (sale_id, card_id, condition, ask, peek, true_market) VALUES (1, 'trap-card', 'NM', 10, 'p', 12)`)
ins(`INSERT INTO local_listings (card_id, ask, anchor_at_spawn, seller, source, posted_at, expires_at) VALUES ('trap-card', 10, 12, 'S', 'facebook', ?, ?)`, T, T)
ins(`INSERT INTO sealed_inventory (product_id, cost, acquired_at) VALUES ('trap-pack', 40, ?)`, T)
ins(`INSERT INTO wishlist (card_id, added_at) VALUES ('trap-card', ?)`, T)
ins(`INSERT INTO listings (id, card_id, condition, price, seller_name, listed_at, expires_at) VALUES ('l1', 'trap-card', 'NM', 10, 'S', ?, ?)`, T, T)
ins(`INSERT INTO sale_history (inventory_id, card_id, quantity, sale_price, cost_basis, profit, sold_at) VALUES (3, 'trap-card', 1, 10, 4, 6, ?)`, T)
ins(`INSERT INTO pull_history (session_id, pack_product_id, card_id, value, opened_at) VALUES ('s1', 'trap-pack', 'trap-card', 5, ?)`, T)
ins(`INSERT INTO auth_tickets (inventory_id, service_id, fee, created_at, due_at) VALUES (3, 'psa', 5, ?, ?)`, T, T) // cascade child of inventory

// ------------------------------------------------- seed: everything else (0.5.87)
// Businesses, records, holdings — auto-filled by convention.
seedAuto('shop')
seedAuto('shop_cases')
seedAuto('shop_case_cards')
seedAuto('shop_consignments')
seedAuto('shop_sales')
seedAuto('shop_ledger')
seedAuto('shop_daily')
seedAuto('shop_employees')
seedAuto('franchise')
seedAuto('regional_managers')
seedAuto('franchise_shelf_cards')
seedAuto('franchise_sales')
seedAuto('storage_units')
seedAuto('storage_unit_cards')
seedAuto('storage_rentals')
seedAuto('vault_policy', { id: 1 })
seedAuto('bulk_boxes')
seedAuto('bulk_box_cards')
seedAuto('grab_bags')
seedAuto('grab_bag_cards')
seedAuto('supplies')
seedAuto('loans')
// finance's id=1 row is schema-seeded on creation — poison it instead of inserting a duplicate
if (TABLES.has('finance')) {
  ins(`INSERT OR IGNORE INTO finance (id) VALUES (1)`)
  ins(`UPDATE finance SET credit_score = 780, total_borrowed = 12345 WHERE id = 1`)
}
seedAuto('tax_filings')
seedAuto('tax_filings_old')
seedAuto('tax_payments')
seedAuto('sales_tax_filings')
seedAuto('achievements')
seedAuto('networth_history')
seedAuto('market_digests')
seedAuto('shipments')
seedAuto('sealed_loans')
seedAuto('auth_accusations')
seedAuto('buylist_wants')
seedAuto('set_demand', { set_id: 'trapset' })
// The living world: feeds and NPC infrastructure (parent → child order).
seedAuto('flea_markets')
seedAuto('flea_bins')
seedAuto('flea_bin_cards')
seedAuto('live_hosts')
seedAuto('live_shows')
seedAuto('live_items')
seedAuto('live_team_spots')
seedAuto('card_shows')
seedAuto('card_show_dealers')
seedAuto('estate_sales')
seedAuto('estate_sale_cards')
seedAuto('incoming_deliveries')
seedAuto('forum_posts')
seedAuto('forum_groupbuys')
seedAuto('rival_shop')
seedAuto('rival_cases')
seedAuto('rival_sales')
seedAuto('reprint_shocks')

// ------------------------------------------------- seed: meta (state dies, keepers stay)
const STATE_KEYS: [string, string][] = [
  // the reported bug — the PSA special survived reset
  ['psarush:state', JSON.stringify({ active: true, startedAt: T, endsAt: T, backlog: 6, used: 8, npcUsed: 5 })],
  ['psarush:rolled', '2026-10-03'], ['psarush:npcWave', '2026-10-03'], ['psarush:drainDay', '2026-10-03'],
  // tutorials, reps, policies, records
  ['tut:start', '1'], ['tut:yard', '1'], ['tut:auth', '1'], ['tut:pawn', '1'], ['tut:ebay', '1'], ['tut:local', '1'],
  ['forum:rep', '42'], ['flea:myDigs', '[]'], ['rival:stakes', 'x'], ['shows:rep', '7'],
  ['chain:districtManager', '{"wage":50}'], ['accountant', 'x'], ['agentsRan', '1'], ['haggledOnce', '1'],
  ['eye:looks', '{"1":2}'], ['substatRead:103', '1'], ['seal:wear:2026-10-03-am', '1'],
  ['sponsorDropWeek', '1'], ['businessDigest:2026-10-03', '1'], ['pulls:tourneySelfHeal', '1'],
  ['estateSpawnDay', '2026-10-01'], ['lastNetworthSnapAt', T], ['storage:overflowPolicy', 'vault'],
  ['taxCreditCarry', '55'], ['taxStrategy', 'x'], ['taxFiled:2026-Q4', '1'], ['salesTaxRemit:2026-10-03', '1'],
  ['shopNonprofit', '1'], ['shopRoundUps', '1'], ['businessLicenseExpires', T], ['licenseQuarterCharged', '1'],
  // world sim state
  ['demo:pop', '{}'], ['demo:booms', '[]'], ['demo:day', '2026-10-03'], ['regime:phase', '{}'], ['seasonal:active', 'x'],
  ['insurance:policy', '{}'], ['insurance:lastRollDay', '2026-10-03'], ['saves:lastBackupDay', '2026-10-03'],
  ['lastSnapshotAt', T], ['supplies:lastWearDay', '2026-10-03'], ['dayrecap:pendingDay', '4'],
  ['dayrecap:pendingRolls', '[]'], ['payrollDrafted', '1'], ['licenseRenewalDue', T],
  ['local:msgs:1', '[]'], ['buylist:shelf:1', T], ['buylist:wants:1', T], ['conventionEntry:1', T],
  ['auth:rep', '3'], ['auth:suspicionUntil', T], ['vault:rentChargedAt', T], ['auditFindings', '[]'],
]
const KEEP_SEEDED = ['sync:set', 'sync:doneIds', 'cardsLastSyncedAt', 'setsLastSyncedAt', 'catalogDeltaLastRunAt',
  'quotaResetAt', 'pcQuotaBudget', 'ebayQuotaBudget', 'tcgcsvLastAttempt', 'priceBackfillStartedAt',
  'lastBenchFetchAt', 'lastTickAt', 'listingsGeneratedAt', 'eurUsdRate', 'econ:12hDay',
  'sealedBackfilledAt', 'estateCondRollMigrated', 'pullTablesBuiltAt', 'changelog:seenVersion', 'authDiscountPct']
for (const [k, v] of STATE_KEYS) ins(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, k, v)
for (const k of KEEP_SEEDED) ins(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, 'x')`, k)
for (const k of KEEP_SEEDED) if (!META_KEEP.has(k)) { failures++; console.error(`  ✗ keeper '${k}' missing from META_KEEP export`) }

// ------------------------------------------------- 1. the trap is armed
console.log('1) trap armed — the pre-0.5.86 wipe order must throw:')
let armed = false
try {
  db.transaction(() => { db.prepare('DELETE FROM inventory').run() })()
} catch (e) {
  armed = true
  console.log(`   old order throws: ${(e as Error).message.slice(0, 60)}`)
}
check('DELETE FROM inventory blocked by open pawn loan', armed)
check('rollback kept the save (cash still 7777)', (db.prepare('SELECT cash c FROM game_state WHERE id=1').get() as { c: number }).c === 7777)

// ------------------------------------------------- 2. resetSave commits
console.log('2) resetSave() on the trap save:')
const before = STATE_KEYS.map(([k]) => k).filter((k) => n_meta(k))
function n_meta(k: string) { return db.prepare('SELECT 1 r FROM meta WHERE key = ?').get(k) != null }
const seededState = STATE_KEYS.map(([k]) => k).filter(n_meta)
resetSave()
const wipedTables = [
  'ebay_feedback', 'ebay_watches', 'ebay_listings', 'ebay_market', 'ebay_auctions', 'ebay_npc_auctions',
  'shipments', 'vendor_sales', 'vendor_tables', 'auth_tickets', 'auth_accusations', 'binder_slots', 'inventory',
  'sealed_inventory', 'sealed_loans', 'sale_history', 'pull_history', 'activity_log', 'wishlist', 'listings',
  'trade_offers', 'trader_cards', 'traders', 'convention_items', 'convention_booths', 'estate_lot_cards',
  'estate_lots', 'conventions', 'auctions', 'pack_battles', 'rival_memory', 'tournaments', 'stream_break_pulls',
  'stream_break_spots', 'stream_breaks', 'streams', 'stream_stats', 'sponsor_offers', 'sponsor_contracts',
  'resale_deal_cards', 'resale_deals', 'pawn_loans', 'pawn_shelf', 'buylist_wants', 'buylist_credit_history',
  'buylist_shelf', 'yard_sale_cards', 'yard_sales', 'local_listings', 'auth_tickets',
  // 0.5.87 additions
  'shop', 'shop_cases', 'shop_case_cards', 'shop_consignments', 'shop_sales', 'shop_ledger', 'shop_daily',
  'shop_employees', 'franchise', 'regional_managers', 'franchise_shelf_cards', 'franchise_sales',
  'storage_units', 'storage_unit_cards', 'storage_rentals', 'vault_policy', 'bulk_boxes', 'bulk_box_cards',
  'grab_bags', 'grab_bag_cards', 'supplies', 'loans', 'tax_filings', 'tax_filings_old', 'tax_payments',
  'sales_tax_filings', 'achievements', 'networth_history', 'market_digests',
  'flea_markets', 'flea_bins', 'flea_bin_cards', 'live_hosts', 'live_shows', 'live_items', 'live_team_spots',
  'card_shows', 'card_show_dealers', 'estate_sales', 'estate_sale_cards', 'incoming_deliveries',
  'forum_posts', 'forum_groupbuys', 'rival_shop', 'rival_cases', 'rival_sales', 'reprint_shocks', 'set_demand',
]
const dirty = wipedTables.filter((t) => TABLES.has(t) && n(t) !== 0)
const missingSeeds = wipedTables.filter((t) => !TABLES.has(t))
check(`all ${wipedTables.length - missingSeeds.length} wiped tables are zero`, dirty.length === 0, dirty.join(', '))
check('cash is $1,000', (db.prepare('SELECT cash c FROM game_state WHERE id=1').get() as { c: number }).c === 1000)
const gs = db.prepare('SELECT created_at a, last_tick_at l FROM game_state WHERE id=1').get() as { a: string; l: string }
check('created_at re-stamped to now (day 1)', Math.abs(Date.now() - Date.parse(gs.a)) < 60_000, gs.a)
check('last_tick_at follows created_at', gs.l === gs.a)
const binders = db.prepare('SELECT COUNT(*) c FROM binders').get() as { c: number }
check('exactly one Main Collection binder', binders.c === 1 &&
  (db.prepare('SELECT name n FROM binders').get() as { n: string }).n === 'Main Collection')
check('card database kept (sets/cards/pack_products)', n('sets') === 1 && n('cards') === 1 && n('pack_products') === 1)
const fin = db.prepare('SELECT credit_score cs, total_borrowed tb FROM finance WHERE id = 1').get() as { cs: number; tb: number } | undefined
check('finance re-seeded to schema defaults', !!fin && fin.cs === 600 && fin.tb === 0, JSON.stringify(fin))

const metaKeys = (db.prepare('SELECT key k FROM meta').all() as { k: string }[]).map((r) => r.k).sort()
const survivors = metaKeys.filter((k) => !KEEP_SEEDED.includes(k))
const lostKeepers = KEEP_SEEDED.filter((k) => !metaKeys.includes(k))
check('meta state all gone (incl. psarush:state — the reported bug)', survivors.length === 0 && !n_meta('psarush:state'), survivors.join(','))
check('meta keepers all survive', lostKeepers.length === 0, lostKeepers.join(','))
check('activity log empty (index.ts logs AFTER commit)', n('activity_log') === 0)
void before; void seededState

// ------------------------------------------------- 3. idempotent
console.log('3) second resetSave():')
resetSave()
check('still one binder (no duplicate starter)', (db.prepare('SELECT COUNT(*) c FROM binders').get() as { c: number }).c === 1)
check('cash still $1,000', (db.prepare('SELECT cash c FROM game_state WHERE id=1').get() as { c: number }).c === 1000)

db.close()
if (failures) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nreset-trap: all checks passed')
process.exit(0)
