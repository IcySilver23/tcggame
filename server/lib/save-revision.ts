// Save-level events (restoring a snapshot, resetting the save) rewind rows the
// shelf response was built from without looking like a price or catalogue
// write. Keep their revision separate from the derived-data signal so the Shop
// cache can key on it without clearing every EV cache on every save write.

let revision = 0

/** A save snapshot was restored or the save was reset. */
export function markSaveChanged(): void {
  revision++
}

/** Monotonic counter; resets with the process along with the in-memory cache. */
export function saveRevision(): number {
  return revision
}
