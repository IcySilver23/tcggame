import type { ComponentType } from 'react'
import { CollectionView } from './Collection'
import { BindersView } from './Binders'
import { SetsGalleryView } from './SetDetail'
import { WishlistView } from './Wishlist'

/**
 * The COLLECTION hub (roadmap item 8.0).
 *
 * Four sidebar rows — Collection, Binders, Set Completion, Wishlist — were four
 * ways of looking at the same cards. They're one door now, with the modes as
 * tabs. This is the same shape the DEALS hub proved: a param route
 * (`#/collection/sets`), a fixed-order mode bar, and old hashes normalizing into
 * the hub instead of bouncing home.
 *
 * Tab order is fixed forever. Unlike DEALS there are no gates here — everything
 * in this hub is available from the first card you own — so the bar carries
 * nothing but the modes themselves.
 */
export type CollectionModeId = 'cards' | 'binders' | 'sets' | 'wishlist'

export type CollectionMode = {
  id: CollectionModeId
  label: string
  icon: string
  /** What this mode is for. Hover-only: the tabs stay uncluttered. */
  verb: string
  Component: ComponentType
}

export const COLLECTION_MODES: CollectionMode[] = [
  { id: 'cards', label: 'Cards', icon: '▤', verb: 'Everything you own in one grid — filter by set, rarity, type, price or condition', Component: CollectionView },
  { id: 'binders', label: 'Binders', icon: '📔', verb: 'Group cards onto pages and flip through them like a real binder', Component: BindersView },
  { id: 'sets', label: 'Sets', icon: '🏸', verb: 'Completion set by set — what you have, what is missing, what it costs to finish', Component: SetsGalleryView },
  { id: 'wishlist', label: 'Wishlist', icon: '★', verb: 'Cards you want with targets set, and agents watching the market for them', Component: WishlistView },
]

export function collectionModeLabel(id?: string): string | undefined {
  return COLLECTION_MODES.find((m) => m.id === id)?.label
}

export function isCollectionMode(id?: string): id is CollectionModeId {
  return !!id && COLLECTION_MODES.some((m) => m.id === id)
}

const go = (id: CollectionModeId) => {
  window.location.hash = `#/collection/${id}`
}

export function CollectionHubView({ mode }: { mode?: string }) {
  const active = COLLECTION_MODES.find((m) => m.id === mode) ?? COLLECTION_MODES[0]
  const Body = active.Component

  return (
    <div className="hub">
      <div className="hub-bar">
        <div className="tab-bar hub-tabs" role="tablist" aria-label="Collection modes">
          {COLLECTION_MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={m.id === active.id}
              className={`tab ${m.id === active.id ? 'on' : ''}`}
              title={`${m.label} — ${m.verb}`}
              onClick={() => go(m.id)}
            >
              <span aria-hidden>{m.icon}</span> {m.label}
            </button>
          ))}
        </div>
      </div>
      <Body />
    </div>
  )
}
