// Derived EV caches (pack odds, sealed pricing, mini packs) depend on both the
// card prices and the catalogue rows behind their pools. Writers announce a
// change here instead of reaching into four services, so a price sync, a
// simulated-market roll, a catalogue seed or a pull-table rebuild cannot leave
// one of them stale.

export type DerivedDataChange = 'price' | 'catalog'

type Listener = (reason: DerivedDataChange) => void

const listeners = new Set<Listener>()
let revision = 0

/** Subscribe a cache's clear function. Returns an unsubscribe for tests. */
export function onDerivedDataChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function announce(reason: DerivedDataChange): void {
  revision++
  for (const listener of [...listeners]) {
    try {
      listener(reason)
    } catch (err) {
      console.error('[derived-cache] invalidation listener failed:', err instanceof Error ? err.message : err)
    }
  }
}

/** A card/sealed price row was written or replaced. */
export function markPricesChanged(): void {
  announce('price')
}

/** A set, card, pull table or sealed product changed. */
export function markCatalogChanged(): void {
  announce('catalog')
}

/** Monotonic counter, useful for diagnostics and tests. */
export function derivedDataRevision(): number {
  return revision
}
