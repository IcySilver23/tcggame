const fs = require('fs')
const eol = (s) => (s.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s)

function patch(file, from, to) {
  let src = fs.readFileSync(file, 'utf8')
  if (!src.includes(eol(from))) throw new Error('anchor missing in ' + file + ': ' + from.slice(0, 80))
  src = src.replace(eol(from), eol(to))
  fs.writeFileSync(file, src)
  console.log('ok', file)
}

/* ------------------------------------------------------------------ */
/* 1. estimates.ts — researched anchors outrank the comparable model    */
/* ------------------------------------------------------------------ */
patch(
  'server/services/estimates.ts',
  `/** Estimated NM value for a card, or null if the model has no data at all. */`,
  `// ---------------------------------------------------------------------------
// Researched anchors
//
// Hand-checked market values for the cards the comparable model cannot price
// honestly: collector pieces whose nearest comparables are bulk printings, and
// phantom secret rares that no comparable set has ever contained. Each entry
// carries the month it was researched, so a stale number is obvious instead of
// silently wrong.
//
// Sources: TCGplayer market via Scrydex / Sparkl / PokeScope / Dittobase, eBay
// solds, PriceCharting, and Rare Candy's October 2026 RGB Mew write-up.
// ---------------------------------------------------------------------------

type Researched = { usd: number; asOf: string; note: string }

const RESEARCHED: Record<string, Researched> = {
  // 30th Celebration (me55) — the undocumented "RGB Rare" Mew trio: no set
  // symbol, collector numbers R/G/B, ~1 in 12,000 packs per colour by
  // community estimate (TPCi published no rate). Mid-October hype peaked near
  // $6,000 and has been falling since; these are late-Oct/Nov 2026 raw NM
  // levels, with blue ≥ red ≥ green by a small margin.
  'me55-R': { usd: 3850, asOf: '2026-11', note: 'RGB Mew (red), raw NM — $3.25k–$4.68k across trackers, down from ~$6k' },
  'me55-G': { usd: 3450, asOf: '2026-11', note: 'RGB Mew (green), raw NM — $3.09k–$3.58k' },
  'me55-B': { usd: 3950, asOf: '2026-11', note: 'RGB Mew (blue), raw NM — $3.75k–$4.10k' },

  // Worlds / event promos. The comparable model collapses these toward the
  // cheapest printing that shares their name, which undersells every one.
  'dpp-DP25': { usd: 795, asOf: '2026-11', note: 'Tropical Wind (2008 Worlds promo), ungraded ~$830' },
  'dpp-DP54': { usd: 12, asOf: '2026-11', note: 'Beginning Door promo — no quote on Scrydex/PokeScope, event-awarded, thin market' },
  'dpp-DP55': { usd: 95, asOf: '2026-11', note: 'Ultimate Zone promo — ~£79 in the UK, no US TCGplayer quote' },
  'bwp-BW77': { usd: 14, asOf: '2026-11', note: 'Pikachu BW77 — never sold at retail (cancelled product); eBay raw asks median ~$10' },
  'bwp-BW78': { usd: 12, asOf: '2026-11', note: 'Raichu BW78 — no sales history anywhere; illiquid, priced off its twin above' },

  // Chaos Rising (me4) energies and Emma printings: the set's own commons are
  // cheaper than the cross-set commodity pool the fallback reaches for.
  'me4-86': { usd: 0.19, asOf: '2026-11', note: 'Nitro Fire Energy holo — TCGplayer market $0.19' },
  'me4-84': { usd: 0.17, asOf: '2026-11', note: 'Bubbly Water Energy — $0.16–$0.19' },
  'me4-107': { usd: 2.05, asOf: '2026-11', note: 'Emma (Ultra Rare) — TCGplayer market $2.11–$2.14' },
  'me4-77': { usd: 0.25, asOf: '2026-11', note: 'Emma (Uncommon) — bulk trainer, ~$0.10–$0.50' },

  // Vintage/mid singles mispriced by rarity matching.
  'ecard2-103': { usd: 6.5, asOf: '2026-11', note: 'Porygon, Aquapolis #103 — 103a ~$4.78–$7.00, 103b ~$10.07' },
  'xy8-146a': { usd: 2, asOf: '2026-11', note: "Professor's Letter #146a — ~$0.95–$5.63 depending on finish" },
  'xy9-98a': { usd: 0.31, asOf: '2026-11', note: 'Delinquent #98a (regular print; the $52 card is the full art 98b)' },
}

/** A researched value for this card, if we have one. */
export function researchedAnchor(cardId: string): number | null {
  const hit = RESEARCHED[cardId]
  return hit ? hit.usd : null
}

/** Estimated NM value for a card, or null if the model has no data at all. */`,
)

patch(
  'server/services/estimates.ts',
  `  if (!card) return null

  const m = getModel()`,
  `  if (!card) return null

  const curated = researchedAnchor(cardId)
  if (curated != null) return curated

  const m = getModel()`,
)

patch(
  'server/services/estimates.ts',
  `  return roundEstimate(Math.max(floor, est * factor))
}`,
  `  // A phantom tier can never be bulk, whatever its comparables say — if a
  // researched value ever goes missing this floor keeps it a chase card.
  const phantomFloor = /rgb rare/i.test(card.rarity ?? '') ? 1500 : 0

  return roundEstimate(Math.max(floor, est * factor, phantomFloor))
}`,
)

/* ------------------------------------------------------------------ */
/* 2. simmarket.ts — curated anchors short-circuit every inference      */
/* ------------------------------------------------------------------ */
patch(
  'server/services/simmarket.ts',
  `import { estimatePrice } from './estimates'`,
  `import { estimatePrice, researchedAnchor } from './estimates'`,
)

patch(
  'server/services/simmarket.ts',
  `export function simulatedAnchor(cardId: string): number | null {
  const row = ANY_ANCHOR.get(cardId) as { market: number } | undefined`,
  `export function simulatedAnchor(cardId: string): number | null {
  // Hand-researched values outrank every inference below. The sibling anchor
  // happily drags a $3,850 phantom Mew down to the $0.35 common it shares a
  // name with, which is the exact failure this table exists to correct.
  const curated = researchedAnchor(cardId)
  if (curated != null) return Math.round(curated * simJitter(cardId) * 100) / 100
  const row = ANY_ANCHOR.get(cardId) as { market: number } | undefined`,
)

/* ------------------------------------------------------------------ */
/* 3. packs.ts — a real RGB Rare tier with its own phantom pull         */
/* ------------------------------------------------------------------ */
patch(
  'server/services/packs.ts',
  `  'Rare Ultra': 5, 'Rare Break': 4, 'Rare Holo EX': 5, 'Radiant Rare': 4,
}`,
  `  'Rare Ultra': 5, 'Rare Break': 4, 'Rare Holo EX': 5, 'Radiant Rare': 4,
  'RGB Rare': 8,
}

// Rarities at or above this rank don't share the rare slot — they have their
// own dice (see PHANTOM_ODDS), because a ~1-in-12,000 card cannot be expressed
// as a share of a slot that appears in every pack.
const PHANTOM_RANK = 8
/** 30th Celebration RGB Mews: ~1 in 12,000 packs per colour (community estimate). */
const PHANTOM_PER_CARD_ODDS = 1 / 12_000`,
)

patch(
  'server/services/packs.ts',
  `  const commons: typeof cards = []
  const uncommons: typeof cards = []
  const holos: typeof cards = []
  const hits: typeof cards = []`,
  `  const commons: typeof cards = []
  const uncommons: typeof cards = []
  const holos: typeof cards = []
  const hits: typeof cards = []
  const phantoms: typeof cards = []`,
)

patch(
  'server/services/packs.ts',
  `    if (rank <= 1 && !special) commons.push(c)`,
  `    if (rank >= PHANTOM_RANK) phantoms.push(c)
    else if (rank <= 1 && !special) commons.push(c)`,
)

patch(
  'server/services/packs.ts',
  `    const wHit = hits.length ? 1 / hits.length : 0
    for (const c of hits) insert.run(pid, c.id, 'hit', wHit)`,
  `    const wHit = hits.length ? 1 / hits.length : 0
    for (const c of hits) insert.run(pid, c.id, 'hit', wHit)
    const wPhantom = phantoms.length ? 1 / phantoms.length : 0
    for (const c of phantoms) insert.run(pid, c.id, 'phantom', wPhantom)`,
)

// The chase strip should show what people actually chase — resolved value
// (real or simulated), and phantom tiers included.
patch(
  'server/services/packs.ts',
  `  const chases = db
    .prepare(
      \`SELECT c.id, c.name, c.rarity, pr.market FROM pack_product_cards ppc
       JOIN cards c ON c.id = ppc.card_id
       JOIN price_records pr ON pr.card_id = c.id AND pr.kind = 'tcgplayer' AND pr.variant = 'normal'
       WHERE ppc.pack_product_id = ? AND ppc.slot = 'hit'
         AND pr.retrieved_at = (SELECT MAX(retrieved_at) FROM price_records p2 WHERE p2.card_id = pr.card_id AND p2.kind = 'tcgplayer' AND p2.variant = 'normal')
       ORDER BY pr.market DESC LIMIT 5\`,
    )
    .all(\`\${setId}-booster\`) as { id: string; name: string; rarity: string; market: number }[]`,
  `  const chases = (
    db
      .prepare(
        \`SELECT c.id, c.name, c.rarity FROM pack_product_cards ppc
         JOIN cards c ON c.id = ppc.card_id
         WHERE ppc.pack_product_id = ? AND ppc.slot IN ('hit', 'phantom')\`,
      )
      .all(\`\${setId}-booster\`) as { id: string; name: string; rarity: string }[]
  )
    .map((c) => ({ ...c, market: valueOf(c.id) }))
    .filter((c) => c.market > 0)
    .sort((a, b) => b.market - a.market)
    .slice(0, 5)`,
)

// Roll the phantom tier on its own dice, on top of the normal pack.
patch(
  'server/services/packs.ts',
  `        results.push({ cardId, isHit, value, variant })
      }
    }
  })`,
  `        results.push({ cardId, isHit, value, variant })
      }
    }
    // Phantom tier — the 30th Celebration RGB Mews. No published rate exists;
    // ~1 in 12,000 packs per colour is the community estimate, so a 36-pack
    // display very rarely holds one. It rides on top of the pack rather than
    // taking the rare slot, matching how these appear in real openings.
    const phantomPool = rows.filter((r) => r.slot === 'phantom')
    if (phantomPool.length > 0 && Math.random() < phantomPool.length * PHANTOM_PER_CARD_ODDS) {
      const cardId = weightedPick(phantomPool)
      const value = valueOf(cardId)
      const rarity = (db.prepare('SELECT rarity FROM cards WHERE id = ?').get(cardId) as { rarity: string | null } | undefined)?.rarity ?? null
      insertPull.run(sessionId, pid, cardId, 'normal', value, rarity ?? null, 1, at, owner)
      results.push({ cardId, isHit: true, value, variant: 'normal' })
    }
  })`,
)

/* ------------------------------------------------------------------ */
/* 4. index.ts — the catalog can't re-tag the phantom rares as Commons  */
/* ------------------------------------------------------------------ */
patch(
  'server/index.ts',
  `function rebuildPullTables() {`,
  `// The catalog ships the three 30th Celebration RGB Mews mistagged as Common.
// They are the set's undocumented phantom secret rares — no set symbol,
// collector numbers R/G/B, ~$3.2k–$4.7k each at ~1 in 12,000 packs per colour.
// Treated as Commons they price like bulk and deal like bulk, so every boot
// repairs the rarity and rebuilds that set's pull table to match. Idempotent.
function repairPhantomRarities() {
  const updated = db
    .prepare(
      \`UPDATE cards SET rarity = 'RGB Rare'
       WHERE id IN ('me55-R', 'me55-G', 'me55-B') AND (rarity IS NULL OR rarity <> 'RGB Rare')\`,
    )
    .run().changes
  if (updated > 0) {
    packs.buildPullTable('me55', 10)
    console.log('[server] repaired', updated, 'phantom rarity row(s); rebuilt the me55 pull table')
  }
}

function rebuildPullTables() {`,
)

patch(
  'server/index.ts',
  `
ensurePackCatalog()
`,
  `repairPhantomRarities()
ensurePackCatalog()
`,
)
