// Unlock every system in the live save for testing.
//
// Goes through the real service paths (lease, open, hireDm, rentLocker,
// subscribeVault, buyCase, buySealed) wherever one exists, so the save keeps
// the invariants the app expects: ledger rows, meta markers, manager rows.
// Direct SQL only for play-history counters the nav reads (followers) and for
// counter staff, which no service exposes without the candidate flow.
//
// Idempotent: safe to run twice; anything already present is left alone.
// A timestamped backup is made by the caller before this runs.
import { db } from '../server/lib/db'
import * as shop from '../server/services/shop'
import * as franchise from '../server/services/franchise'
import * as vault from '../server/services/vault'
import * as packs from '../server/services/packs'
import * as binders from '../server/services/binders'
import { valueOf } from '../server/services/market'

const round2 = (n: number) => Math.round(n * 100) / 100
const out: string[] = []
const log = (s: string) => { out.push(s); console.log(s) }
const ok = (r: { ok: boolean; error?: string }) => (r.ok ? 'ok' : `FAILED — ${r.error ?? 'unknown'}`)

// --- 1. Money -------------------------------------------------------------
db.prepare(`UPDATE game_state SET cash = 250000 WHERE id = 1`).run()
log(`cash: $${(db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash.toFixed(2)}`)

// --- 2. Followers (the Stream nav gate reads stream_stats.followers) ------
if (!db.prepare(`SELECT 1 FROM stream_stats`).get()) db.prepare(`INSERT INTO stream_stats (followers) VALUES (0)`).run()
db.prepare(`UPDATE stream_stats SET followers = 500, total_streams = 12, total_packs = 240, total_donations = 75`).run()
log(`followers: ${(db.prepare(`SELECT followers FROM stream_stats`).get() as { followers: number }).followers}`)

// --- 3. Flagship shop, every display case --------------------------------
if (!shop.getShop()) log(`lease flagship: ${ok(shop.lease('Flagship Cards', 'flagship'))}`)
for (const c of shop.caseList()) {
  if (c.owned) continue
  log(`case "${c.label}" ($${c.price}): ${ok(shop.buyCase(c.id))}`)
}

// --- 4. Counter staff at the flagship ------------------------------------
const counterSlots = (db.prepare(`SELECT COUNT(*) n FROM shop_employees WHERE role = 'counter'`).get() as { n: number }).n
for (const [name, q] of [['Marlene', 4], ['Theo', 5]] as const) {
  const already = db.prepare(`SELECT 1 FROM shop_employees WHERE name = ?`).get(name)
  if (already) continue
  db.prepare(`INSERT INTO shop_employees (role, name, wage, quality, hired_at, sales_lift, mood) VALUES ('counter', ?, ?, ?, ?, ?, 65)`)
    .run(name, round2(4 + q * 3), q, new Date().toISOString(), 10 + q * 4)
  log(`hired counter staff ${name} (${q}★ @ $${round2(4 + q * 3)}/day)`)
}
void counterSlots

// --- 5. The chain: three satellites, 5★ district, 5★ regional ------------
const hasStore = (id: number) => !!db.prepare(`SELECT 1 FROM franchise WHERE id = ?`).get(id)
const managerWage = round2(6 + 5 * 3) // 5★ market: $21/day
if (!hasStore(1)) log(`satellite 1: ${ok(franchise.open('Satellite One', 'storefront', 5, managerWage, 'Mgr A', 1) as { ok: boolean; error?: string })}`)
if (!franchise.districtRow()) log(`district manager 5★: ${ok(franchise.hireDm({ name: 'Dell', quality: 5, wage: franchise.DM_BASE[5] }) as { ok: boolean; error?: string })}`)
if (!hasStore(2)) log(`satellite 2: ${ok(franchise.open('Satellite Two', 'storefront', 5, managerWage, 'Mgr B', 2) as { ok: boolean; error?: string })}`)
if (!franchise.regionalRow()) log(`regional manager 5★: ${ok(franchise.hireRegional('Renata', 5, franchise.REGIONAL_BASE[5]) as { ok: boolean; error?: string })}`)
if (!hasStore(3)) log(`satellite 3: ${ok(franchise.open('Satellite Three', 'storefront', 5, managerWage, 'Mgr C', 3) as { ok: boolean; error?: string })}`)

// --- 6. Storage: a big locker and the vault rider ------------------------
if (!db.prepare(`SELECT 1 FROM storage_rentals WHERE kind = 'locker'`).get()) {
  const r = vault.rentLocker('large')
  log(`locker (large): ${ok(r as { ok: boolean; error?: string })}`)
}
if (!vault.vaultActive()) log(`vault rider: ${ok(vault.subscribeVault() as { ok: boolean; error?: string })}`)

// --- 7. Binders ----------------------------------------------------------
for (const [name, accent] of [['Vintage', 'red'], ['Modern Hits', 'blue']] as const) {
  if (db.prepare(`SELECT 1 FROM binders WHERE name = ?`).get(name)) continue
  binders.createBinder(name, accent)
  log(`binder "${name}" created`)
}

// --- 8. Sealed inventory -------------------------------------------------
const wanted = db.prepare(`SELECT id, name FROM pack_products WHERE kind IN ('display','booster') AND set_id IN ('base1','swsh1','sv1','sv3') ORDER BY kind DESC, RANDOM() LIMIT 6`).all() as { id: string; name: string }[]
for (const p of wanted) {
  try {
    const r = packs.buySealed(p.id, 1) as { ok?: boolean; error?: string }
    if (r && r.ok === false) log(`sealed ${p.name}: FAILED — ${r.error}`)
    else log(`sealed ${p.name}: bought`)
  } catch (e) {
    log(`sealed ${p.name}: FAILED — ${(e as Error).message}`)
  }
}

// --- 9. Some real collection cards across the value bands ----------------
const already = (db.prepare(`SELECT COUNT(*) n FROM inventory`).get() as { n: number }).n
if (already < 60) {
  const cards = db.prepare(`SELECT id FROM cards WHERE rarity IN ('Rare','Rare Holo','Ultra Rare','Secret Rare') AND id NOT LIKE '%-psa%' ORDER BY RANDOM() LIMIT 24`).all() as { id: string }[]
  let added = 0
  for (const c of cards) {
    const m = valueOf(c.id)
    if (!m || m < 1) continue
    db.prepare(`INSERT INTO inventory (card_id, variant, condition, quantity, status, cost_basis, acquired_at, acquired_via) VALUES (?, 'normal', 'NM', 1, 'collection', ?, ?, 'market')`)
      .run(c.id, round2(m * 0.8), new Date().toISOString())
    added++
  }
  log(`collection cards added: ${added}`)
} else {
  log(`collection cards: ${already} already present, left alone`)
}

// --- 10. What the save looks like now ------------------------------------
const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n
log('\n--- state ---')
log(`cash:        $${(db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }).cash.toFixed(2)}`)
log(`shop:        ${shop.getShop() ? `${shop.getShop()!.name} (${shop.getShop()!.tier})` : 'none'}`)
log(`shop cases:  ${count(`SELECT COUNT(*) n FROM meta WHERE key LIKE 'shopCase:%'`)} owned`)
log(`satellites:  ${count(`SELECT COUNT(*) n FROM franchise`)} doors`)
log(`offices:     DM ${franchise.districtRow()?.quality ?? 0}★ · regional ${franchise.regionalRow()?.quality ?? 0}★`)
log(`employees:   ${count(`SELECT COUNT(*) n FROM shop_employees`)} counter`)
log(`lockers:     ${count(`SELECT COUNT(*) n FROM storage_rentals WHERE kind = 'locker'`)} · vault ${vault.vaultActive() ? 'on' : 'off'}`)
log(`binders:     ${count(`SELECT COUNT(*) n FROM binders`)}`)
log(`sealed:      ${count(`SELECT COALESCE(SUM(quantity),0) n FROM sealed_inventory`)} units`)
log(`inventory:   ${count(`SELECT COUNT(*) n FROM inventory WHERE status = 'collection'`)} collection rows`)
log(`followers:   ${count(`SELECT followers n FROM stream_stats`)}`)
log(`sales:       ${count(`SELECT COUNT(*) n FROM sale_history`)} (Deals gate is 3)`)

const problems: string[] = []
if (!shop.getShop()) problems.push('no shop')
if (!franchise.districtRow()) problems.push('no DM')
if (!franchise.regionalRow()) problems.push('no regional')
if (count(`SELECT COUNT(*) n FROM franchise`) < 3) problems.push('fewer than 3 satellites')
if (count(`SELECT followers n FROM stream_stats`) < 5) problems.push('stream still locked')
console.log(problems.length ? `\nPROBLEMS: ${problems.join(', ')}` : '\nOK — all gates clear')
