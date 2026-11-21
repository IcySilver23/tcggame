// One-off: fetch the MEP Black Star Promos programme from TCGdex.
//
// TCGdex is the source used elsewhere in this repo for promos the main catalogue
// API lacks (it also carries TCGplayer USD market prices). pokemontcg.io has no
// Mega Evolution promo set at all, so the promo printings the 30th Celebration
// and Ascended Heroes boxes carry cannot come from the normal sync.
//
// Output: tmp/mep/cards.json — the same card shape local-releases.json uses, so
// merge.mjs can append it without a translation step at load time.

import { mkdirSync, writeFileSync } from 'node:fs'

const SET_ID = 'mep'
const BASE = 'https://api.tcgdex.net/v2/en'
const OUT_DIR = 'tmp/mep'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(url, tries = 5) {
  let lastError = null
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'tcg-life catalog import' } })
      if (res.ok) return await res.json()
      lastError = new Error(`HTTP ${res.status} ${url}`)
      if (res.status === 404) break
    } catch (err) {
      lastError = err
    }
    await sleep(400 * (attempt + 1))
  }
  throw lastError ?? new Error(`failed ${url}`)
}

const set = await get(`${BASE}/sets/${SET_ID}`)
const ids = set.cards.map((c) => c.id)
console.log(`set ${set.id} "${set.name}": ${ids.length} cards`)

const details = []
for (let i = 0; i < ids.length; i += 6) {
  const batch = ids.slice(i, i + 6)
  details.push(...(await Promise.all(batch.map((id) => get(`${BASE}/cards/${id}`)))))
  process.stdout.write(`\rfetched ${details.length}/${ids.length}`)
}
process.stdout.write('\n')

/** Highest TCGplayer USD market price across the card's printed variants. */
function usdMarket(card) {
  const rows = []
  for (const variant of card.variants_detailed ?? []) {
    for (const [key, price] of Object.entries(variant.pricing?.tcgplayer ?? {})) {
      const market = Number(price?.marketPrice)
      if (Number.isFinite(market) && market > 0) rows.push({ variant: key, market })
    }
  }
  rows.sort((a, b) => b.market - a.market)
  return rows[0] ?? null
}

const cards = details.map((c) => {
  const priced = usdMarket(c)
  return {
    id: c.id,
    set_id: SET_ID,
    name: c.name,
    // TCGdex calls a Pokémon "Pokemon"; the catalogue uses the accented name.
    supertype: c.category === 'Pokemon' ? 'Pokémon' : c.category,
    // TCGdex publishes a stage/suffix, but the catalogue's local releases leave
    // uncatalogued subtypes null rather than deriving them, and nothing in this
    // product work depends on a promo's stage.
    subtypes: null,
    number: String(c.localId),
    position: Number.parseInt(c.localId, 10) || 9999,
    rarity: c.rarity ?? 'Promo',
    types: c.types ?? null,
    hp: typeof c.hp === 'number' ? c.hp : null,
    artist: c.illustrator ?? null,
    dex_numbers: c.dexId ?? null,
    image_small: `https://images.scrydex.com/pokemon/${c.id}/small`,
    image_large: `https://images.scrydex.com/pokemon/${c.id}/large`,
    regulation_mark: null,
    price: priced ? { market: Math.round(priced.market * 100) / 100, variant: priced.variant } : null,
  }
})

const unpriced = cards.filter((c) => c.price === null).map((c) => c.id)
const out = {
  source: {
    label: 'TCGdex — MEP Black Star Promos (card identity, rarity, artwork and TCGplayer USD market)',
    url: `${BASE}/sets/${SET_ID}`,
    retrieved: new Date().toISOString().slice(0, 10),
  },
  set: {
    id: SET_ID,
    name: 'MEP Black Star Promos',
    series: 'Mega Evolution',
    printed_total: Number(set.cardCount?.official) || cards.length,
    total: cards.length,
    ptcgo_code: 'MEP',
    release_date: '2025/09/26',
    symbol_url: 'https://images.scrydex.com/pokemon/mep-symbol/symbol',
    logo_url: 'https://images.scrydex.com/pokemon/mep-logo/logo',
  },
  unpriced,
  cards,
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(`${OUT_DIR}/cards.json`, JSON.stringify(out, null, 1) + '\n')
console.log(`wrote ${OUT_DIR}/cards.json — ${cards.length} cards, ${unpriced.length} without a TCGplayer market price`)
if (unpriced.length) console.log(`  unpriced: ${unpriced.slice(0, 12).join(', ')}${unpriced.length > 12 ? '…' : ''}`)
