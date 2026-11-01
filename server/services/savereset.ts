// Full save reset — "Reset save (keeps card database)" in Settings.
//
// The contract: after reset the save is FRESH — cash $1,000, day 1, and not
// one trace of the old world survives except the card database (sets, cards,
// prices, pack products, price history) and the config layer (the settings
// table — API keys, day length — and the meta KEEP-list below: sync
// checkpoints, API quotas, price pipelines, migration stamps, UI prefs).
// The PSA special, tutorial flags, reps, policies, businesses, records,
// achievements, world feeds — everything goes.
//
// Two rules keep this safe:
//   1. child tables before their parents (no ON DELETE CASCADE means an
//      out-of-order delete throws FOREIGN KEY, the transaction rolls back,
//      and the old save survives intact — the original 0.5.86 bug class:
//      pawn_shelf → pawn_loans → inventory shipped inverted).
//   2. everything must already tolerate emptiness: a fresh save HAS empty
//      tables and empty meta, so every reader self-heals by construction
//      (single-row helpers like stream_stats INSERT OR IGNORE on read;
//      finance is re-seeded right here because its row is schema-seeded and
//      schema only runs at boot).
//
// Meta is wiped by KEEP-LIST, not blacklist: every key not in META_KEEP is
// deleted, so keys added by future features (psarush:state was missed by the
// old blacklist — the bug that motivated this rewrite) can never survive a
// reset again.
//
// The wipe lives here so reset-trap.ts can regression-test it against a
// seeded save, and every statement is annotated — a failure reports the exact
// statement instead of a bare "FOREIGN KEY constraint failed".
import { db, nowIso } from '../lib/db'

// Config / external-pipeline meta that survives a reset. Everything else —
// gameplay, world state, records, tutorial flags, daily gates — is deleted.
export const META_KEEP = new Set([
  // catalog sync checkpoints
  'sync:set', 'sync:doneIds', 'sync:currentSetName', 'cardsLastSyncedAt', 'setsLastSyncedAt',
  'catalogDeltaLastRunAt', 'catalogDeltaLastSummary',
  // external API quotas & price pipelines
  'quotaResetAt', 'pcQuotaBudget', 'pcQuotaExhaustedAt', 'pcQuotaLimit',
  'ebayQuotaBudget', 'ebayQuotaExhaustedAt', 'ebayQuotaLimit', 'tcgcsvLastAttempt', 'tcgcsvLastSync',
  'priceBackfillDone', 'priceBackfillFinishedAt', 'priceBackfillMissAt', 'priceBackfillMissCount',
  'priceBackfillMissSrcKey', 'priceBackfillPriced', 'priceBackfillStartedAt',
  // external feed cadence / caches
  'lastBenchFetchAt', 'lastBenchFetchOkAt', 'lastBenchHost', 'lastOwnedPriceRefreshAt',
  'lastTickAt', 'listingsGeneratedAt', 'eurUsdRate',
  'lastPriceSnapshotDay', 'lastSimMarketDay', 'lastOwnedPriceRefreshDay', 'lastOwnedRefreshFailAt',
  // migration & build stamps (re-running them on a fresh save is at best noise:
  // econ:12hDay re-halves wages, estateCondRollMigrated re-rolls conditions)
  'sealedBackfilledAt', 'estateCondRollMigrated', 'pullTablesBuiltAt', 'econ:12hDay',
  // UI / market parameters
  'changelog:seenVersion', 'authDiscountPct',
])

export function resetSave(): void {
  const run = (sql: string, ...params: unknown[]) => {
    try {
      db.prepare(sql).run(...params)
    } catch (e) {
      throw new Error(`reset stopped at "${sql.slice(0, 80)}" — ${(e as Error).message}`)
    }
  }

  // Table deletes are existence-checked: a save predating a feature may not
  // have its table (services CREATE IF NOT EXISTS at boot, but a wipe should
  // never bet on it) — nothing to wipe is not an error.
  const present = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name),
  )
  const del = (table: string) => {
    if (present.has(table)) run(`DELETE FROM ${table}`)
  }

  const wipe = () => {
    // ---------------- children of inventory, before the inventory wipe -------
    del('ebay_feedback')             // → ebay_listings (no cascade)
    del('ebay_watches')
    del('ebay_listings')             // → inventory (no cascade)
    del('ebay_market')
    del('ebay_auctions')             // → inventory (no cascade)
    del('ebay_npc_auctions')
    del('shipments')                 // sold BidBay orders (ref_id, no FK)
    del('vendor_sales')              // child of inventory AND vendor_tables
    del('vendor_tables')             // before conventions/card_shows (cascade would also take it)
    del('auth_tickets')              // → inventory (cascade, but child-first reads better)
    del('auth_accusations')
    run("UPDATE inventory SET status = 'collection' WHERE status = 'pawned'") // free the cards first…
    del('pawn_shelf')                // …then drop the shelf (→ pawn_loans)…
    del('pawn_loans')                // …then the loan book (→ inventory). All three
                                     //   BEFORE inventory: this chain shipped inverted.
    del('binder_slots')              // children of inventory
    del('binders')                   // empty shells would carry over; a fresh save starts with one Main Collection binder
    run('INSERT INTO binders (name, accent, created_at) VALUES (?, ?, ?)', 'Main Collection', 'yellow', nowIso())

    del('inventory')
    del('sealed_inventory')
    del('sealed_loans')              // the futures loan book rides with the boxes
    del('sale_history')
    del('pull_history')
    del('activity_log')
    del('wishlist')
    del('listings')
    del('trade_offers')
    del('trader_cards')
    del('traders')
    del('convention_items')
    del('convention_booths')
    del('estate_lot_cards')
    del('estate_lots')
    del('conventions')
    run("DELETE FROM meta WHERE key LIKE 'conventionEntry:%'")
    del('auctions')
    del('pack_battles')
    del('rival_memory')
    del('tournaments')
    del('stream_break_pulls')        // children of stream_breaks
    del('stream_break_spots')
    del('stream_breaks')             // references streams
    del('streams')
    del('stream_stats')
    del('sponsor_offers')
    del('sponsor_contracts')
    del('resale_deal_cards')
    del('resale_deals')
    del('buylist_wants')             // NPC shop wants rotate on their own
    del('buylist_credit_history')
    del('buylist_shelf')
    del('yard_sale_cards')           // child first — FK to yard_sales
    del('yard_sales')
    del('local_listings')

    // ---------------- the player's businesses, records, and holdings ---------
    del('shop_case_cards')           // → shop_cases (cascade), children of inventory
    del('shop_cases')
    del('shop_consignments')
    del('shop_sales')
    del('shop_ledger')
    del('shop_daily')
    del('shop_employees')
    del('shop')
    del('franchise_shelf_cards')
    del('franchise_sales')
    del('regional_managers')
    del('franchise')
    del('storage_unit_cards')        // stored cards die with inventory — dangling rows otherwise
    del('storage_units')
    del('storage_rentals')           // lockers the player rents
    del('vault_policy')              // single-row policy: absence = uninsured (fresh-save state)
    del('bulk_box_cards')
    del('bulk_boxes')
    del('grab_bag_cards')
    del('grab_bags')
    del('supplies')
    del('loans')                     // bank loans
    del('finance')                   // credit score …
    if (present.has('finance')) run('INSERT OR IGNORE INTO finance (id) VALUES (1)') // … back to its schema-seeded default (row is boot-seeded)
    del('tax_filings')
    del('tax_filings_old')
    del('tax_payments')
    del('sales_tax_filings')
    del('achievements')
    del('networth_history')
    del('market_digests')

    // ---------------- the living world: feeds, events, NPC infrastructure -----
    del('flea_bin_cards')            // child first — no cascades in this chain
    del('flea_bins')
    del('flea_markets')
    del('live_team_spots')           // child first — no cascades in this chain
    del('live_items')
    del('live_shows')
    del('live_hosts')
    del('card_show_dealers')
    del('card_shows')
    del('estate_sale_cards')         // buyout listings (≠ convention estate_lots)
    del('estate_sales')
    del('incoming_deliveries')
    del('forum_groupbuys')
    del('forum_posts')
    del('rival_sales')
    del('rival_cases')
    del('rival_shop')
    del('reprint_shocks')
    del('set_demand')                // cohort oscillators re-seed from defaults on read

    // ---------------- meta: KEEP-list sweep ----------------------------------
    // Every key not in META_KEEP is game state and goes: the PSA special
    // (psarush:state — the key the old blacklist missed), tutorial flags,
    // reps, policies, daily gates, demo/boom/regime/seasonal state, tax
    // stamps, achievement stamps… A fresh save has empty meta, so every
    // reader already handles absence.
    const keepers = db.prepare('SELECT key FROM meta').all() as { key: string }[]
    for (const row of keepers) {
      if (!META_KEEP.has(row.key)) run('DELETE FROM meta WHERE key = ?', row.key)
    }
    // Daily gates for the NEW day 1 are simply absent now — the stale
    // "already ran today" stamps that used to need a blacklist are meta state,
    // so the sweep above already cleared them (saves:lastBackupDay, the wear
    // pass, the disaster roll, payroll, the license quarter, dayrecap…).

    // created_at IS the day counter (day 1 = its UTC date); re-stamping it to
    // now rewinds to day 1. last_tick_at follows so the next tick doesn't try
    // to sim the whole rewind gap in one catch-up pass.
    run('UPDATE game_state SET cash = 1000, created_at = ?, last_tick_at = ? WHERE id = 1', nowIso(), nowIso())
  }

  try {
    db.transaction(wipe)()
  } catch (e) {
    // A stray external writer (second server instance, backup tooling) can
    // briefly lock the file — one retry covers it. Anything else (FK, logic)
    // fails identically twice and surfaces annotated above.
    const msg = (e as Error).message.toLowerCase()
    if (msg.includes('busy') || msg.includes('locked')) {
      db.transaction(wipe)()
    } else throw e
  }
}
