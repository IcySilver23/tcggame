// The Pack Shop's shelf rows are now deliberately cheap (catalogue, deal terms
// and OOP/source badges), but a timestamp is still the wrong thing to cache
// them under: a price sync, catalogue rebuild, daily-deal claim, restore or
// reset can change the rows inside any TTL. This cache names the inputs instead.
//
//   price/catalogue revision  → card prices, sealed prices, pull tables
//   daily-deal revision       → game day and today's claims
//   save revision             → snapshot restore or full save reset
//
// A response is reused only while all three are unchanged. There is no time
// component, so the shelf cannot go stale by waiting and cannot be rebuilt just
// because twenty seconds passed.
import { derivedDataRevision, markCatalogChanged, markPricesChanged } from '../lib/derived-cache'
import { markSaveChanged, saveRevision } from '../lib/save-revision'
import * as dailydeals from './dailydeals'

export type ShopShelfRow = Record<string, unknown>

let cache: { key: string; rows: ShopShelfRow[] } | null = null

/** The complete identity of the inputs behind one shelf response. */
export function shopShelfKey(): string {
  return `${derivedDataRevision()}|${dailydeals.shelfRevision()}|${saveRevision()}`
}

/** The cached rows, or null when any input has moved since they were built. */
export function cachedShopRows(): ShopShelfRow[] | null {
  if (!cache) return null
  return cache.key === shopShelfKey() ? cache.rows : null
}

/** Store rows under the inputs they were actually built from. */
export function cacheShopRows(rows: ShopShelfRow[]): void {
  cache = { key: shopShelfKey(), rows }
}

/** Drop the shelf without waiting for a revision to change. */
export function clearShopRows(): void {
  cache = null
}

/**
 * A restored snapshot or a reset can rewind prices, catalogue rows and daily
 * claims in one step. Announce all three so the shelf and the EV caches are
 * rebuilt from the restored world.
 */
export function invalidateAfterSaveChange(): void {
  markSaveChanged()
  markCatalogChanged()
  markPricesChanged()
  dailydeals.resetDailyDealsCache()
  clearShopRows()
}
