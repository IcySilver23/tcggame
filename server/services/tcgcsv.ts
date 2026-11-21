import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, getMeta, setMeta, nowIso, logActivity } from '../lib/db'
import { markPricesChanged } from '../lib/derived-cache'
import { fetchJson } from '../lib/http'

// ---------------------------------------------------------------------------
// TCGcsv — free, keyless daily mirror of TCGplayer's own pricing data
//
// TCGplayer closed its API to new developers, but tcgcsv.com re-publishes the
// full TCGplayer catalog (products + prices per set) as open JSON, refreshed
// once per day. No key, no quota. This is the FIRST free source we try: it
// uses the exact same TCGplayer prices the main sync carries, so cards priced
// here are labeled LIVE · TCGplayer.
//
// Join strategy: TCGplayer groups == sets. We map our sets to TCGcsv groups by
// set code (ptcgo_code) and normalized name, then within a group we join
// products to cards by the card number in extendedData ("021/128" → 21) with a
// name-similarity guard.
// ---------------------------------------------------------------------------

function mapFile(): string {
  if (process.env.TCGLIFE_HOME) return path.join(process.env.TCGLIFE_HOME, 'data', 'tcgcsv-groups.json')
  // exe/script-relative (SEA-safe: no import.meta inside single-executable apps)
  const self = typeof __filename !== 'undefined' ? __filename : process.execPath
  let dir = path.dirname(self)
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'server', 'schema.sql')) || fs.existsSync(path.join(dir, 'schema.sql'))) return path.join(dir, 'data', 'tcgcsv-groups.json')
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return path.join(process.cwd(), 'data', 'tcgcsv-groups.json')
}
const MAP_FILE = mapFile()

type TcgGroup = { groupId: number; name: string; abbr: string }
type GroupMap = { fetchedAt: string; groups: TcgGroup[] }

type TcgProduct = {
  productId: number
  name: string
  cleanName: string
  subTypeName?: string
  extendedData?: { name: string; value: string }[]
}
type TcgPrice = {
  productId: number
  subTypeName: string
  lowPrice: number | null
  midPrice: number | null
  highPrice: number | null
  marketPrice: number | null
  directLowPrice: number | null
}

let syncRunning = false

// tcgcsv.com answers 401 to requests without a User-Agent header (bare Node
// fetch sends none) — identify ourselves politely on every call. It now ALSO
// 401s any UA that claims to be a plain browser: the old "Mozilla/5.0
// (compatible; …)" string started failing on every endpoint, which silently
// killed both the pack-art backfill and the price mirror — every call came
// back 401, so the matcher had no products to match and nothing to price. A
// self-identifying, non-browser UA is what the mirror accepts.
const UA = { 'User-Agent': 'TCGLife/0.6.1 (collector-sim; local card game)' }

// --- group map -------------------------------------------------------------

function readGroupMap(): GroupMap | null {
  try {
    const raw = JSON.parse(fs.readFileSync(MAP_FILE, 'utf-8')) as GroupMap
    return raw.groups && Array.isArray(raw.groups) ? raw : null
  } catch {
    return null
  }
}

function writeGroupMap(m: GroupMap): void {
  try {
    fs.writeFileSync(MAP_FILE, JSON.stringify(m))
  } catch { /* non-fatal */ }
}

async function ensureGroupMap(force = false): Promise<GroupMap | null> {
  const cached = readGroupMap()
  const ageDays = cached ? (Date.now() - new Date(cached.fetchedAt).getTime()) / 86_400_000 : Infinity
  if (!force && cached && ageDays < 7) return cached
  try {
    const res = await fetchJson<{ results: { groupId: number; name: string; abbreviation: string }[] }>(
      'https://tcgcsv.com/tcgplayer/3/groups',
      { ...UA },
      { attempts: 2 },
    )
    const map: GroupMap = {
      fetchedAt: nowIso(),
      groups: (res.results ?? []).map((g) => ({ groupId: g.groupId, name: g.name, abbr: g.abbreviation ?? '' })),
    }
    if (map.groups.length > 0) {
      writeGroupMap(map)
      return map
    }
  } catch { /* fall through to cache */ }
  return cached // stale cache is better than nothing
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

// Catalog-name normalization: fold diacritics (our DB stores "Poké Pad" from
// pokemontcg.io while TCGplayer's catalog says "Poke Pad") and treat the word
// "and" as "&" ("Darkrai and Cresselia LEGEND" vs "Darkrai & Cresselia LEGEND").
function normalizeName(s: string): string {
  let t = (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  t = t.replace(/\band\b/g, '&')
  return t.replace(/[^a-z0-9&]+/g, '')
}

// Sets whose TCGplayer catalog name differs from pokemontcg.io's set name.
// Matched exactly (score 4) against the TCGcsv group list.
const SET_NAME_ALIASES: Record<string, string> = {
  mcd14: "McDonald's Promos 2014",
  mcd15: "McDonald's Promos 2015",
  mcd17: "McDonald's Promos 2017",
  mcd18: "McDonald's Promos 2018",
  dpp: 'Diamond and Pearl Promos',
  bwp: 'Black and White Promos',
  // Our DB splits each Trainer Kit into two deck sets (tkNa / tkNb); TCGplayer
  // catalogs the whole kit as one group. Exact names from the TCGcsv group list.
  tk1a: 'EX Trainer Kit 1: Latias & Latios',
  tk1b: 'EX Trainer Kit 1: Latias & Latios',
  tk2a: 'EX Trainer Kit 2: Plusle & Minun',
  tk2b: 'EX Trainer Kit 2: Plusle & Minun',
}

/** Score how well a TCGcsv group matches one of our sets (higher = better). */
function groupScore(g: TcgGroup, setName: string, ptcgoCode: string | null): number {
  const gn = norm(stripCodePrefix(g.name))
  const sn = norm(setName)
  let score = 0
  if (ptcgoCode && g.abbr && g.abbr.toUpperCase() === ptcgoCode.toUpperCase()) score += 2
  if (gn === sn) score += 4
  else if (gn.includes(sn) && sn.length >= 5) score += 1
  else if (sn.includes(gn) && gn.length >= 5) score += 1
  return score
}

// TCGplayer's set-code prefix ("SWSH12: Silver Tempest", "SV: Scarlet & Violet
// 151") — stripped before comparing, exactly as the pack-art matcher below has
// always done. Without this, every set whose group carries a code needed an
// abbr hit to score above the floor, so whole sets ("151", "Silver Tempest",
// "Lost Origin"…) were skipped with no group match and their cards kept old
// prices forever.
function stripCodePrefix(name: string): string {
  return name.replace(GROUP_CODE_PREFIX, '')
}

function matchGroup(map: GroupMap, setName: string, ptcgoCode: string | null): TcgGroup | null {
  let best: TcgGroup | null = null
  let bestScore = 2 // require at least an abbr match or a name containment
  for (const g of map.groups) {
    const s = groupScore(g, setName, ptcgoCode)
    // Tie-break toward the shorter group name (closer match, e.g. plain "30th
    // Celebration" over the Classic Collection variant).
    if (s > bestScore || (s === bestScore && best && g.name.length < best.name.length)) {
      best = g
      bestScore = s
    }
  }
  return best
}

// --- per-set sync ----------------------------------------------------------

/**
 * Normalized card number for joining: lowercase, "…/total" suffix stripped,
 * leading zeros dropped on pure numbers. Keeps ALPHANUMERIC promo numbers
 * ("DP05", "146a", "SV01") joinable instead of collapsing them to a bare int.
 */
function normCardNumber(v: string): string {
  const t = (v ?? '').trim().toLowerCase().replace(/\/\s*\d+\s*$/, '')
  if (/^\d+$/.test(t)) return String(Number(t))
  return t
}

function cardNumberFromProduct(p: TcgProduct): string | null {
  const entry = (p.extendedData ?? []).find((e) => e.name === 'Number')
  if (!entry) return null
  const n = normCardNumber(entry.value ?? '')
  return n || null
}

function variantFromSubType(sub: string | undefined): string | null {
  if (sub === 'Normal') return 'normal'
  if (sub === 'Holofoil') return 'holofoil'
  if (sub === 'Reverse Holofoil') return 'reverseHolofoil'
  return null
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.length >= 5 && nb.includes(na)) return true
  if (nb.length >= 5 && na.includes(nb)) return true
  return false
}

// Trainer Kit sets exist as ONE TCGplayer group per kit ("EX Trainer Kit 2:
// Plusle & Minun") holding BOTH decks, with duplicate card numbers across the
// decks and deck-marked shared-trainer names ("Potion Plusle" / "Potion Minun").
// Our sets split the decks (tk2a / tk2b), so deck-marked products belonging to
// the OTHER deck must be skipped or they'd price the wrong card.
const TK_DECK_RE = /^(tk\d+)([ab])$/
function trainerKitMarkers(setId: string, groupName: string): { own: string | null; other: string | null } {
  const m = TK_DECK_RE.exec(setId)
  if (!m) return { own: null, other: null }
  const after = groupName.includes(':') ? groupName.split(':')[1] ?? '' : groupName
  const parts = after.split('&').map((x) => normalizeName(x)).filter(Boolean)
  if (parts.length < 2) return { own: null, other: null }
  return m[2] === 'a' ? { own: parts[0], other: parts[1] } : { own: parts[1], other: parts[0] }
}

const storedToday = db.prepare(
  `SELECT 1 FROM price_records WHERE card_id = ? AND kind = 'tcgplayer' AND variant = ? AND retrieved_at >= date('now') LIMIT 1`,
)
const insertTcgPrice = db.prepare(
  `INSERT INTO price_records (card_id, kind, variant, low, mid, high, market, direct_low, avg1, avg7, avg30, retrieved_at)
   VALUES (?, 'tcgplayer', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
)

async function syncTcgcsvSet(setId: string, group: TcgGroup): Promise<{ priced: number; art: number }> {
  const base = `https://tcgcsv.com/tcgplayer/3/${group.groupId}`
  const [prodRes, priceRes] = await Promise.all([
    fetchJson<{ results: TcgProduct[] }>(`${base}/products`, { ...UA }, { attempts: 2 }),
    fetchJson<{ results: TcgPrice[] }>(`${base}/prices`, { ...UA }, { attempts: 2 }),
  ])
  const pricesByProduct = new Map<number, TcgPrice[]>()
  for (const pr of priceRes.results ?? []) {
    if (pr.marketPrice == null || pr.marketPrice <= 0) continue
    const arr = pricesByProduct.get(pr.productId) ?? []
    arr.push(pr)
    pricesByProduct.set(pr.productId, arr)
  }

  const cards = db.prepare('SELECT id, name, number FROM cards WHERE set_id = ?').all(setId) as { id: string; name: string; number: string }[]
  const byNumber = new Map<string, { id: string; name: string }[]>()
  for (const c of cards) {
    const key = normCardNumber(c.number)
    if (key) {
      const arr = byNumber.get(key) ?? []
      arr.push(c)
      byNumber.set(key, arr)
    }
  }
  const tk = trainerKitMarkers(setId, group.name)

  let priced = 0
  const tx = db.transaction(() => {
    for (const p of prodRes.results ?? []) {
      const num = cardNumberFromProduct(p)
      if (num == null) continue // sealed products / missing numbering — no safe card join
      // Trainer-kit deck guard: a product explicitly named for the OTHER deck
      // ("Potion Minun" while syncing the Plusle deck) must not price this deck's card.
      if (tk.own && tk.other) {
        const pn = normalizeName(p.cleanName || p.name)
        if (pn.includes(tk.other) && !pn.includes(tk.own)) continue
      }
      const candidates = byNumber.get(num) ?? []
      // Prefer the SHORTEST matching name: promo groups often carry several
      // catalog entries for one number ("Tropical Wind DP05 Worlds 07" and the
      // "Staff" stamped variant share DP05) — the plain entry is the shorter
      // name, and first-write-wins keeps stamped duplicates from overwriting it.
      const name = p.cleanName || p.name
      const card = candidates
        .filter((c) => namesMatch(c.name, name))
        .sort((a, b) => a.name.length - b.name.length)[0]
      if (!card) continue
      // NOTE: TCGcsv PRODUCTS carry no subTypeName — the Normal/Holofoil/
      // Reverse Holofoil variant lives on each PRICE row, so the variant is
      // taken from there, not from the product.
      for (const pr of pricesByProduct.get(p.productId) ?? []) {
        const v = variantFromSubType(pr.subTypeName)
        if (!v || pr.marketPrice == null) continue
        if (storedToday.get(card.id, v)) continue
        insertTcgPrice.run(card.id, v, pr.lowPrice, pr.midPrice, pr.highPrice, pr.marketPrice, pr.directLowPrice, nowIso())
        priced++
      }
    }
  })
  tx()
  // Free wrapper art: this same products fetch already carries the set's
  // sealed products — fill any pack_product still missing its image.
  const sealed = (prodRes.results ?? []).filter((p) => cardNumberFromProduct(p) == null)
  const art = applyPackArt(setId, group.name, sealed)
  if (priced > 0) markPricesChanged()
  return { priced, art }
}

// --- sealed pack art --------------------------------------------------------
// TCGplayer's product images are id-addressable on their CDN
// (tcgplayer-cdn.tcgplayer.com/product/<id>_in_400x400.jpg), and every set's
// sealed products (booster packs, ETBs, boxes) live in the SAME tcgcsv group
// as its cards. Sealed rows carry no card Number — exactly what the pricing
// join skips — so the same products fetch that prices a set also hands us the
// real wrapper art for its packs.

// Which TCGplayer name fragment identifies each generated product kind.
const PACK_ART_KEYS: Record<string, string[]> = {
  booster: ['boosterpack'],
  bundle: ['boosterbundle'],
  etb: ['elitetrainerbox'],
  display: ['boosterbox', 'boosterdisplay'],
}
// Variant veto: cases, exclusives and sleeved/kit packaging photograph worse
// than the plain product (an ETB "Case" image is a shrink-wrapped pallet).
// Applied to the fallback tier only — an exact name match always wins.
const PACK_ART_VETO = /(case|exclusive|pokemoncenter|buildandbattle|setof|artbundle|sleeved|lot)/

const packArtUrl = (productId: number) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_400x400.jpg`

// TCGplayer's code prefix on group names ("SV08: Surging Sparks",
// "SM - Unbroken Bonds") — stripped before comparing to our set names.
const GROUP_CODE_PREFIX = /^[a-z]{1,5}\s*\d*(?:\.\d+)?[a-z]?\s*[:\-]\s*/i

// Set ids whose name never matches a TCGplayer group name even after prefix
// stripping ("Sun & Moon" vs "SM Base Set", McDonald's "Collection" vs
// "Promos"). Keyed by OUR set id → the TCGplayer catalog name.
const ART_GROUP_ALIASES: Record<string, string> = {
  sm1: 'SM Base Set',
  mcd11: "McDonald's Promos 2011",
  mcd12: "McDonald's Promos 2012",
  mcd16: "McDonald's Promos 2016",
  mcd19: "McDonald's Promos 2019",
  mcd21: "McDonald's 25th Anniversary Promos",
  mcd22: "McDonald's Promos 2022",
}

/**
 * Group matcher for ART. The price join (matchGroup) demands a score ≥ 3 —
 * an abbr match PLUS name overlap — because a wrong group would write wrong
 * prices. Art is cosmetic, so this matcher trusts a single strong signal:
 * an exact group name after stripping the code prefix, a name overlap, or
 * the set code alone. Shorter group name wins ties (base set over a Trainer
 * Gallery / supplemental twin).
 */
function matchArtGroup(map: GroupMap, setName: string, ptcgoCode: string | null): TcgGroup | null {
  const sn = normalizeName(setName)
  if (!sn) return null
  let best: TcgGroup | null = null
  let bestScore = 0
  for (const g of map.groups) {
    const gn = normalizeName(g.name.replace(GROUP_CODE_PREFIX, ''))
    let s = 0
    if (gn === sn) s = 100
    else if (sn.length >= 5 && gn.includes(sn)) s = 60
    else if (gn.length >= 5 && sn.includes(gn)) s = 55
    if (ptcgoCode && g.abbr && g.abbr.toUpperCase() === ptcgoCode.toUpperCase()) s = Math.max(s, 40)
    if (s > bestScore || (s === bestScore && s > 0 && best && g.name.length < best.name.length)) {
      best = g
      bestScore = s
    }
  }
  return bestScore > 0 ? best : null
}

/** Candidate spellings of this set's name in TCGplayer's catalog: ours, the
 * alias table's, plus the group name with its code prefix stripped. */
function packArtBases(names: string[], groupName: string): string[] {
  const bases: string[] = []
  const push = (s: string) => { const n = normalizeName(s); if (n && !bases.includes(n)) bases.push(n) }
  for (const n of names) push(n)
  push(groupName.replace(GROUP_CODE_PREFIX, ''))
  push(groupName)
  return bases
}

// Sub-sets that never got their own sealed product on TCGplayer — a Trainer
// Gallery / Shiny Vault / Classic Collection "set" is printed inside the
// parent set's packs, so the pack you actually rip is the parent's.
const PARENT_SET_SUFFIX = /[:\-]?\s*(trainer gallery|galarian gallery|shiny vault|classic collection|energies)$/i

/** Every name worth trying for this set's art, most specific first. */
function artNameCandidates(setId: string, rawName: string): string[] {
  const out: string[] = []
  const push = (s: string) => { if (s && !out.includes(s)) out.push(s) }
  push(ART_GROUP_ALIASES[setId] ?? SET_NAME_ALIASES[setId] ?? rawName)
  push(rawName)
  push(out[0].replace(PARENT_SET_SUFFIX, ''))
  return out
}

function artNamesFor(setId: string): string[] | null {
  const set = db.prepare('SELECT name FROM sets WHERE id = ?').get(setId) as { name: string } | undefined
  return set ? artNameCandidates(setId, set.name) : null
}

/** Pick the TCGplayer sealed product whose image becomes this pack's art. */
function packArtProduct(bases: string[], kind: string, sealed: TcgProduct[]): number | null {
  const keys = PACK_ART_KEYS[kind]
  if (!keys) return null
  const all = sealed
    .map((p) => ({ p, n: normalizeName(p.cleanName || p.name) }))
    .filter((c) => c.n.length > 0 && keys.some((k) => c.n.includes(k)))
  if (all.length === 0) return null
  // Prefer products named after THIS set — but a tcgcsv group IS one set, so
  // when our name and TCGplayer's disagree ("151" vs "Scarlet & Violet—151",
  // "30th Celebration: Classic Collection" vs "Celebrations …"), fall back to
  // every kind-appropriate product in the group rather than shipping no art.
  const named = all.filter((c) => bases.some((b) => b.length >= 3 && c.n.includes(b)))
  const cands = named.length > 0 ? named : all
  // 1) exact "<set><kind>" — the plain product, never a variant.
  const exact = cands.find((c) => keys.some((k) => bases.some((b) => c.n === b + k)))
  if (exact) return exact.p.productId
  // 2) otherwise the plainest remaining candidate: veto variants, shortest wins.
  const clean = cands.filter((c) => !PACK_ART_VETO.test(c.n))
  return (clean.length > 0 ? clean : cands).sort((a, b) => a.n.length - b.n.length)[0].p.productId
}

/** Fill image_url for one set's still-unmatched pack_products. */
function applyPackArt(setId: string, groupName: string, sealed: TcgProduct[]): number {
  if (sealed.length === 0) return 0
  const names = artNamesFor(setId)
  if (!names) return 0
  const rows = db
    .prepare('SELECT id, kind FROM pack_products WHERE set_id = ? AND image_url IS NULL')
    .all(setId) as { id: string; kind: string }[]
  if (rows.length === 0) return 0
  const bases = packArtBases(names, groupName)
  const upd = db.prepare('UPDATE pack_products SET image_url = ? WHERE id = ? AND image_url IS NULL')
  let matched = 0
  const tx = db.transaction(() => {
    for (const r of rows) {
      const pid = packArtProduct(bases, r.kind, sealed)
      if (pid == null) continue
      upd.run(packArtUrl(pid), r.id)
      matched++
    }
  })
  tx()
  return matched
}

let artRunning = false

/**
 * Backfill pack wrapper art from TCGplayer's sealed catalog. Visits only sets
 * that still have unmatched pack_products, so after the first run it touches
 * nothing but newly synced sets. Cooldown-gated (12h) unless forced.
 */
export async function syncPackArt(force = false): Promise<{ ok: boolean; matched: number; error?: string }> {
  if (artRunning) return { ok: false, matched: 0, error: 'Pack art sync already running.' }
  if (!force) {
    const last = getMeta('packArtLastSync')
    if (last && Date.now() - new Date(last).getTime() < 12 * 3600_000) return { ok: true, matched: 0 }
  }
  artRunning = true
  try {
    const map = await ensureGroupMap(force)
    if (!map || map.groups.length === 0) return { ok: false, matched: 0, error: 'Could not reach tcgcsv.com — try again later.' }
    const sets = db
      .prepare(
        `SELECT DISTINCT s.id, s.name, s.ptcgo_code, s.release_date
         FROM sets s JOIN pack_products p ON p.set_id = s.id
         WHERE p.image_url IS NULL
         ORDER BY s.release_date DESC`,
      )
      .all() as { id: string; name: string; ptcgo_code: string | null; release_date: string | null }[]
    let matched = 0
    let fetchErrors = 0
    for (const s of sets) {
      // Try each candidate name in turn: the specific group first (its own
      // sealed listing), then the parent set's group for sub-sets that were
      // never printed as their own pack. Stop as soon as something matched.
      const tried = new Set<number>()
      for (const name of artNameCandidates(s.id, s.name)) {
        const g = matchArtGroup(map, name, s.ptcgo_code)
        if (!g || tried.has(g.groupId)) continue
        tried.add(g.groupId)
        try {
          const res = await fetchJson<{ results: TcgProduct[] }>(`https://tcgcsv.com/tcgplayer/3/${g.groupId}/products`, { ...UA }, { attempts: 2 })
          const sealed = (res.results ?? []).filter((p) => cardNumberFromProduct(p) == null)
          const n = applyPackArt(s.id, g.name, sealed)
          if (n > 0) {
            matched += n
            console.log(`[tcgcsv] pack art: ${n} product image(s) matched for ${s.name}`)
            break
          }
        } catch (e) {
          fetchErrors++
          console.warn(`[tcgcsv] pack art for ${s.name} failed:`, e instanceof Error ? e.message : e)
          break // network problem — don't hammer the sibling groups
        }
      }
    }
    // Arm the cooldown on a completed run even when nothing matched (some
    // sets simply have no TCGplayer sealed listing) — only network failures
    // should leave the job retrying on every boot.
    if (fetchErrors === 0 || matched > 0) setMeta('packArtLastSync', nowIso())
    return { ok: true, matched }
  } finally {
    artRunning = false
  }
}

export type TcgcsvResult = { ok: boolean; setsSynced: number; cardsPriced: number; error?: string }

/**
 * Sync TCGplayer prices from the free tcgcsv.com mirror for every set that
 * still has unpriced cards. Cooldown-gated (12h) unless forced.
 *
 * `allSets` re-quotes EVERY set instead of only the ones with holes — that is
 * the whole-catalog refresh the shipped catalog seed wants before a release
 * build (same once-per-card-per-day guard, so a second call in a day is free).
 */
export async function syncAllTcgcsv(force = false, allSets = false): Promise<TcgcsvResult> {
  if (syncRunning) return { ok: false, setsSynced: 0, cardsPriced: 0, error: 'Mirror sync already running.' }
  if (!force) {
    // Cooldown arms on SUCCESS only — a failed attempt (network down, HTTP
    // 401, …) must be retryable on the next boot, not locked out for 12h.
    const last = getMeta('tcgcsvLastSync')
    if (last && Date.now() - new Date(last).getTime() < 12 * 3600_000) {
      return { ok: false, setsSynced: 0, cardsPriced: 0, error: 'Mirror sync ran recently — cooldown active.' }
    }
  }
  syncRunning = true
  setMeta('tcgcsvLastAttempt', nowIso())
  try {
    const map = await ensureGroupMap(force)
    if (!map || map.groups.length === 0) return { ok: false, setsSynced: 0, cardsPriced: 0, error: 'Could not reach tcgcsv.com — try again later.' }

    // Sets with any card still missing a REAL price (any tier) — not just
    // fully unpriced sets. Stragglers inside otherwise-priced sets (promo-pack
    // variants, basic energies, the odd uncataloged number) otherwise never
    // get reached, because the set-level check sees the set as "priced".
    // `allSets` skips the filter entirely: quote every set, fresh prices for
    // the whole catalog.
    const staleOnly = allSets
      ? ''
      : `WHERE c.id NOT IN (
           SELECT card_id FROM price_records
           WHERE kind IN ('tcgplayer','pricecharting','ebay','tcgcsv','cardmarket') AND market IS NOT NULL)`
    const sets = db
      .prepare(
        `SELECT DISTINCT s.id, s.name, s.ptcgo_code FROM sets s
         JOIN cards c ON c.set_id = s.id
         ${staleOnly}
         ORDER BY s.release_date DESC`,
      )
      .all() as { id: string; name: string; ptcgo_code: string | null }[]

    let setsSynced = 0
    let cardsPriced = 0
    let throttled = 0
    for (const s of sets) {
      const g = matchGroup(map, SET_NAME_ALIASES[s.id] ?? s.name, s.ptcgo_code)
      if (!g) {
        // A silent skip here looks exactly like "the mirror priced it" from
        // the outside — log it whenever we're deliberately quoting everything.
        if (allSets) console.log(`[tcgcsv] no group match for "${s.name}" — skipped`)
        continue
      }
      // Pace the burst: tcgcsv answers 401 to a hammering client (measured —
      // the first unpaced full pass got 124 of 176 sets refused).
      await new Promise((r) => setTimeout(r, 350))
      try {
        const r = await syncTcgcsvSet(s.id, g)
        if (r.art > 0) console.log(`[tcgcsv] pack art: ${r.art} product image(s) matched for ${s.name}`)
        if (r.priced > 0) {
          setsSynced++
          cardsPriced += r.priced
          console.log(`[tcgcsv] ${s.name}: ${r.priced} price rows from group ${g.groupId}`)
        } else if (allSets) {
          console.log(`[tcgcsv] ${s.name}: 0 rows (group ${g.groupId} answered, but no card join or already quoted today)`)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        // 401 here is a throttle, not a bad credential: once the mirror starts
        // refusing, every remaining set would refuse too, so stop the pass and
        // let the caller fall through to another price source instead of
        // burning minutes logging 150 identical failures.
        if (msg.includes('401') && ++throttled >= 3) {
          console.warn(`[tcgcsv] mirror throttled us (401) — stopping this pass; re-run in a few minutes. ${cardsPriced} row(s) landed first.`)
          break
        }
        console.warn(`[tcgcsv] set ${s.name} failed:`, e instanceof Error ? e.message : e)
      }
    }
    if (cardsPriced > 0) {
      setMeta('tcgcsvLastSync', nowIso())
      logActivity('system', `Free TCGplayer mirror (tcgcsv.com) — ${cardsPriced} cards priced across ${setsSynced} set(s).`)
    }
    return { ok: true, setsSynced, cardsPriced }
  } finally {
    syncRunning = false
  }
}

export function tcgcsvStatus(): { lastSync: string | null; lastAttempt: string | null } {
  return { lastSync: getMeta('tcgcsvLastSync'), lastAttempt: getMeta('tcgcsvLastAttempt') }
}
