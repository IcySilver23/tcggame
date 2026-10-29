import { db, nowIso, logActivity, getMeta, setMeta } from '../lib/db'
import { valueOf, gradedPriceOf, round2, type Condition } from './market'
import * as estate from './estate'
import * as schedule from './schedule'

// ---------------------------------------------------------------------------
// Vendor personalities — each prices the same real market differently
// ---------------------------------------------------------------------------

type Specialty = {
  id: string
  label: string
  blurb: string
  avatar: string
  /** Price multiplier band [min, max] over the real market anchor. */
  range: [number, number]
  /** Which cards this booth wants for its table. */
  wants: (card: { rarity: string | null; supertype: string | null; setYear: number; market: number }) => number
  graded?: boolean
}

const SPECIALTIES: Specialty[] = [
  {
    id: 'deals',
    label: 'Deal Bins',
    blurb: 'Undercut everyone to move volume. Hunt here first.',
    avatar: '🎯',
    range: [0.55, 0.85],
    wants: ({ market }) => (market >= 0.5 && market <= 30 ? 1.4 : 0.6),
  },
  {
    id: 'bulk',
    label: 'Bulk Tables',
    blurb: 'Dollar boxes and quarter bins. Mostly junk, occasional gold.',
    avatar: '🗃️',
    range: [0.5, 0.95],
    wants: ({ market }) => (market < 5 ? 1.5 : 0.2),
  },
  {
    id: 'vintage',
    label: 'Vintage Specialist',
    blurb: 'WotC-era cardboard, priced like it belongs in a museum.',
    avatar: '🕰️',
    range: [0.9, 1.35],
    wants: ({ setYear }) => (setYear <= 2007 ? 2 : setYear <= 2015 ? 0.8 : 0.1),
  },
  {
    id: 'modern',
    label: 'Modern Chaser',
    blurb: 'Current sets, chase rares, everything near retail.',
    avatar: '🔥',
    range: [0.9, 1.2],
    wants: ({ setYear, rarity }) => (setYear >= 2020 && rarity && /Rare|Holo/i.test(rarity) ? 1.5 : 0.5),
  },
  {
    id: 'graded',
    label: 'Slab Dealer',
    blurb: 'PSA/BGS cases only. Knows exactly what a 10 is worth.',
    avatar: '🛡️',
    range: [0.95, 1.3],
    wants: () => 1,
    graded: true,
  },
  {
    id: 'trap',
    label: 'Tourist Trap',
    blurb: 'Beautiful table, ruthless margins. Check the badge before you pay.',
    avatar: '🎡',
    range: [1.3, 1.9],
    wants: () => 1,
  },
]

const SHOW_NAMES = [
  ['Gem City Card Show', 'Weekend convention hall — 200 tables of cardboard and hustle.'],
  ['Big Lizard Collectors Expo', 'The regional show everyone pretends not to care about.'],
  ['Pacific Coast Trade Night', 'Evening swap meet: binders out, deals loud, coffee bad.'],
  ['Midwest Grading Gala', 'Slabs on slabs on slabs. Bring a loupe.'],
  ['Summer Mega Mash', 'The biggest show of the season — every vendor in the scene.'],
]

const VENDOR_NAMES: Record<string, string[]> = {
  deals: ['Bargain Ben', 'Clearout Carrie', 'Dollar-Box Dave'],
  bulk: ['Bulk Bob', 'Quarter-Bin Quinn', 'Two-Buck Tessa'],
  vintage: ['WotC Wanda', 'Base Set Bruno', 'Old-School Oswald'],
  modern: ['Chase-Card Chad', 'Prismatic Priya', 'Current-Set Cynthia'],
  graded: ['Slab Sergeant Sutter', 'PSA Peggy', 'Ten-Grade Todd'],
  trap: ['Shiny Steve', 'Markup Marge', 'Giftshop Garry'],
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ---------------------------------------------------------------------------
// Show lifecycle — one show at a time, opens and closes on the game clock
// ---------------------------------------------------------------------------

export function getActiveShow() {
  return db
    .prepare(`SELECT * FROM conventions WHERE closes_at > ? ORDER BY id DESC LIMIT 1`)
    .get(nowIso()) as
    | { id: number; name: string; blurb: string; entry_fee: number; opened_at: string; closes_at: string }
    | undefined
}

export function showStatus() {
  const show = getActiveShow()
  if (!show) {
    const last = db.prepare(`SELECT MAX(closes_at) AS last FROM conventions`).get() as { last: string | null }
    const gapMin = last.last ? Math.max(0, 45 - (Date.now() - new Date(last.last).getTime()) / 60_000) : 0
    return { open: false as const, nextShowInMin: Math.round(gapMin) }
  }
  const booths = db
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM convention_items ci WHERE ci.booth_id = b.id AND ci.status = 'available') AS stock
       FROM convention_booths b WHERE b.convention_id = ? ORDER BY b.id`,
    )
    .all(show.id) as Record<string, unknown>[]
  const totalStock = booths.reduce((a, b) => a + (b.stock as number), 0)
  return {
    open: true as const,
    show,
    entered: hasPaidEntry(show.id),
    minutesLeft: Math.max(0, Math.round((new Date(show.closes_at).getTime() - Date.now()) / 60_000)),
    booths: booths.map((b) => ({ ...b })),
    totalStock,
  }
}

export function ensureShow() {
  if (getActiveShow()) return
  // Shows run on the event calendar — weekend flea markets and the Sunday mega
  // show. Outside those windows the hall stays empty.
  if (!schedule.conventionAllowed()) return
  openShow()
}

function openShow() {
  const [name, blurb] = pick(SHOW_NAMES)
  const entry = pick([5, 8, 10, 15])
  const hours = rand(1.5, 3)
  const info = db
    .prepare(`INSERT INTO conventions (name, blurb, entry_fee, opened_at, closes_at) VALUES (?, ?, ?, ?, ?)`)
    .run(name, blurb, entry, nowIso(), new Date(Date.now() + hours * 3600_000).toISOString())
  const showId = Number(info.lastInsertRowid)

  // 4–6 booths, always including a deals table and — at bigger shows — a slab dealer.
  // No duplicate specialties: two PSA Pegges at one show breaks the fiction.
  const chosen: Specialty[] = [SPECIALTIES[0], pick(SPECIALTIES.slice(1, 4))]
  if (Math.random() < 0.7) chosen.push(SPECIALTIES[4]) // graded
  if (Math.random() < 0.5) chosen.push(SPECIALTIES[5]) // trap
  if (Math.random() < 0.4) {
    const rest = SPECIALTIES.slice(1, 4).filter((s) => !chosen.includes(s))
    if (rest.length > 0) chosen.push(pick(rest))
  }

  const insertBooth = db.prepare(
    `INSERT INTO convention_booths (convention_id, vendor_name, avatar, specialty, blurb) VALUES (?, ?, ?, ?, ?)`,
  )
  const tx = db.transaction(() => {
    for (const spec of chosen) {
      const vendor = pick(VENDOR_NAMES[spec.id])
      const booth = insertBooth.run(showId, vendor, spec.avatar, spec.id, spec.blurb)
      stockBooth(Number(booth.lastInsertRowid), spec)
    }
  })
  tx()
  // Estate lots: mystery bundles from sellers who priced their own stuff.
  try { estate.spawnEstateLots(showId, name) } catch (e) { console.error('[estate] spawn failed:', e) }
  logActivity('convention', `${name} opened its doors — $${entry} entry, ${chosen.length} booths.`)
}

function stockBooth(boothId: number, spec: Specialty) {
  const year = (setId: string): number => {
    const row = db.prepare('SELECT release_date FROM sets WHERE id = ?').get(setId) as { release_date: string } | undefined
    return row ? Number(row.release_date.slice(0, 4)) : 2025
  }
  // Candidate pool from real synced cards with real prices.
  const pool = db
    .prepare(
      `SELECT c.id, c.rarity, c.supertype, c.set_id,
              (SELECT market FROM price_records pr WHERE pr.card_id = c.id AND pr.kind = 'tcgplayer' AND pr.market IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1) AS m
       FROM cards c WHERE c.rarity IS NOT NULL AND c.rarity != ''
       ORDER BY RANDOM() LIMIT 500`,
    )
    .all() as { id: string; rarity: string | null; supertype: string | null; set_id: string; m: number | null }[]
  // Cutoff at $0.25 market: penny-stock asks would just slam into the price
  // floor and show up as fake "pricey" badges.
  const valued = pool.filter((p) => p.m != null && p.m >= 0.25 && p.m < 600)
  const scored = valued
    .map((p) => ({ ...p, want: spec.wants({ rarity: p.rarity, supertype: p.supertype, setYear: year(p.set_id), market: p.m ?? 0 }) }))
    .filter((p) => p.want > 0.2)
    .sort((a, b) => b.want - a.want)
  const top = scored.slice(0, Math.max(30, Math.floor(scored.length * 0.35)))
  const n = spec.id === 'bulk' ? 60 : 20
  const insert = db.prepare(
    `INSERT INTO convention_items (booth_id, card_id, variant, condition, graded_grade, ask) VALUES (?, ?, 'normal', ?, ?, ?)`,
  )
  const conds: Condition[] = ['NM', 'NM', 'NM', 'LP', 'MP']
  for (let i = 0; i < n && top.length > 0; i++) {
    const card = pick(top)
    const cond = pick(conds)
    const market = card.m ?? 0
    // Freeze the ask: vendor margin over the real anchor at their condition.
    const condMult = cond === 'NM' ? 1 : cond === 'LP' ? 0.8 : 0.65
    const ask = Math.max(0.1, round2(market * condMult * rand(spec.range[0], spec.range[1])))
    insert.run(boothId, card.id, cond, null, ask)
  }
}

// ---------------------------------------------------------------------------
// NPC shoppers — real bargains disappear while you browse
// ---------------------------------------------------------------------------

export function snipePass() {
  // Deals under ~90% of market get taken by other shoppers over time.
  const rows = db
    .prepare(
      `SELECT ci.id, ci.ask, ci.graded_grade, ci.card_id
       FROM convention_items ci JOIN convention_booths cb ON cb.id = ci.booth_id
       JOIN conventions cv ON cv.id = cb.convention_id
       WHERE ci.status = 'available' AND cv.closes_at > ?`,
    )
    .all(nowIso()) as { id: number; ask: number; graded_grade: string | null; card_id: string }[]
  let taken = 0
  for (const r of rows) {
    const anchor = r.graded_grade ? gradedPriceOf(r.card_id, r.graded_grade).usd : valueOf(r.card_id, 'normal', 'NM')
    if (anchor <= 0) continue
    const deal = r.ask / anchor
    if (deal < 0.9 && Math.random() < 0.06) {
      db.prepare(`UPDATE convention_items SET status = 'sold', sold_at = ? WHERE id = ?`).run(nowIso(), r.id)
      taken++
    }
  }
  return taken
}

export function closeExpiredShow() {
  const show = getActiveShow()
  if (!show) return
  // Closing time: any unsold stock leaves with the vendors.
  const info = db.prepare(`SELECT name FROM conventions WHERE id = ?`).get(show.id) as { name: string }
  const left = (db.prepare(`SELECT COUNT(*) AS n FROM convention_items ci JOIN convention_booths cb ON cb.id = ci.booth_id WHERE cb.convention_id = ? AND ci.status = 'available'`).get(show.id) as { n: number }).n
  if (new Date(show.closes_at).getTime() <= Date.now()) {
    db.prepare(`UPDATE convention_items SET status = 'sold', sold_at = ? WHERE status = 'available' AND booth_id IN (SELECT id FROM convention_booths WHERE convention_id = ?)`).run(nowIso(), show.id)
    logActivity('convention', `${info.name} packed up. ${left} items went home unsold.`)
  }
}

// ---------------------------------------------------------------------------
// Buying
// ---------------------------------------------------------------------------

export function buyEntry() {
  const show = getActiveShow()
  if (!show) return { ok: false, error: 'No show is running right now' }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < show.entry_fee) return { ok: false, error: 'Not enough cash for entry' }
  db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(show.entry_fee)
  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(`conventionEntry:${show.id}`, nowIso())
  // First-use tutorial gate: walking through the doors counts as taught.
  if (getMeta('tut:convention') !== '1') setMeta('tut:convention', '1')
  logActivity('convention', `Paid $${show.entry_fee.toFixed(2)} entry at ${show.name}.`, -show.entry_fee)
  return { ok: true, paid: show.entry_fee }
}

export function hasPaidEntry(showId: number) {
  return Boolean(db.prepare(`SELECT value FROM meta WHERE key = ?`).get(`conventionEntry:${showId}`))
}

export function boothStock(boothId: number) {
  const show = getActiveShow()
  if (!show) return { ok: false as const, error: 'No show running' }
  const booth = db.prepare(`SELECT * FROM convention_booths WHERE id = ? AND convention_id = ?`).get(boothId, show.id) as
    | { id: number; vendor_name: string; avatar: string; specialty: string; blurb: string }
    | undefined
  if (!booth) return { ok: false as const, error: 'Booth not found' }
  if (!hasPaidEntry(show.id)) return { ok: false as const, error: 'Pay entry at the door first' }

  const rows = db
    .prepare(
      `SELECT ci.id, ci.card_id, ci.variant, ci.condition, ci.graded_grade, ci.ask, c.name, c.image_small, c.rarity, s.name AS set_name
       FROM convention_items ci JOIN cards c ON c.id = ci.card_id JOIN sets s ON s.id = c.set_id
       WHERE ci.booth_id = ? AND ci.status = 'available'
       ORDER BY ci.ask ASC`,
    )
    .all(boothId) as Record<string, unknown>[]
  const out = rows.map((r) => {
    const anchor = r.graded_grade ? gradedPriceOf(r.card_id as string, r.graded_grade as string).usd : valueOf(r.card_id as string, 'normal', 'NM')
    const ask = r.ask as number
    return {
      ...r,
      anchor,
      delta: anchor > 0 ? ask / anchor - 1 : 0,
    }
  })
  return { ok: true as const, booth, items: out }
}

export function buyConventionItem(itemId: number) {
  const show = getActiveShow()
  if (!show) return { ok: false, error: 'No show running' }
  if (!hasPaidEntry(show.id)) return { ok: false, error: 'Pay entry at the door first' }
  const item = db
    .prepare(
      `SELECT ci.*, cb.vendor_name FROM convention_items ci JOIN convention_booths cb ON cb.id = ci.booth_id
       WHERE ci.id = ? AND ci.status = 'available' AND cb.convention_id = ?`,
    )
    .get(itemId, show.id) as { id: number; card_id: string; variant: string; condition: string; graded_grade: string | null; ask: number; vendor_name: string } | undefined
  if (!item) return { ok: false, error: 'Someone else grabbed it — sold out' }
  const state = db.prepare(`SELECT cash FROM game_state WHERE id = 1`).get() as { cash: number }
  if (state.cash < item.ask) return { ok: false, error: 'Not enough cash' }

  const name = (db.prepare('SELECT name FROM cards WHERE id = ?').get(item.card_id) as { name: string }).name
  const tx = db.transaction(() => {
    db.prepare(`UPDATE convention_items SET status = 'sold', sold_at = ? WHERE id = ?`).run(nowIso(), item.id)
    db.prepare(`UPDATE game_state SET cash = cash - ? WHERE id = 1`).run(round2(item.ask))
    db.prepare(
      `INSERT INTO inventory (card_id, variant, condition, quantity, status, graded_grade, acquired_via, acquired_ref, cost_basis, acquired_at)
       VALUES (?, ?, ?, 1, 'collection', ?, 'convention', ?, ?, ?)`,
    ).run(item.card_id, item.variant, item.condition, item.graded_grade, String(show.id), item.ask, nowIso())
    logActivity('buy', `Bought ${name}${item.graded_grade ? ` (${item.graded_grade})` : ` (${item.condition})`} from ${item.vendor_name} at ${show.name} for $${item.ask.toFixed(2)}`, -item.ask)
  })
  tx()
  const anchor = item.graded_grade ? gradedPriceOf(item.card_id, item.graded_grade).usd : valueOf(item.card_id, item.variant, 'NM')
  const verdict = anchor > 0 ? (item.ask < anchor * 0.9 ? 'Steal.' : item.ask > anchor * 1.15 ? 'You paid tourist price.' : 'About market.') : ''
  return { ok: true, paid: item.ask, anchor, verdict, message: `${name} secured — ${verdict}` }
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export function conventionTick() {
  closeExpiredShow()
  ensureShow()
  if (getActiveShow()) snipePass()
  try { estate.estateTick() } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export function listBooths() {
  const st = showStatus()
  if (!st.open) return st
  const booths = db
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM convention_items ci WHERE ci.booth_id = b.id AND ci.status = 'available') AS stock
       FROM convention_booths b WHERE b.convention_id = ? ORDER BY b.id`,
    )
    .all(st.show.id) as Record<string, unknown>[]
  return { ...st, booths }
}
