import { useEffect, useState } from 'react'
import { api } from './api'

/** Semver-ish compare: is version a strictly newer than b? */
export function verNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0
  }
  return false
}

/**
 * Sidebar badge: how many changelog entries landed since this save last
 * caught up. 0 for brand-new saves (no baseline yet) and caught-up saves.
 * Returns [count, refresh] so the app can re-check after the modal closes.
 *
 * Kept out of views/WhatsNew.tsx so the shell does not statically import the
 * modal (roadmap 16.0 — the modal is its own chunk).
 */
export function useWhatsNewBadge(): [number, () => void] {
  const [count, setCount] = useState(0)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    Promise.all([api.changelogSummary(), api.changelogSeen()])
      .then(([log, seen]) => {
        if (!alive) return
        if (!seen.seen) {
          // Never opened the changelog: a fresh save stays quiet, but a save
          // with play history is a RETURNING player — badge the whole list.
          setCount(seen.veteran ? log.versions.length : 0)
          return
        }
        const unseen = log.versions.filter((v) => verNewer(v, seen.seen!)).length
        setCount(unseen)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [tick])
  return [count, () => setTick((t) => t + 1)]
}
