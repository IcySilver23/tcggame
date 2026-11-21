import type { ComponentType } from 'react'
import { INVENTORY_MODES_META, inventoryModeLabel, isInventoryMode, type InventoryModeId } from '../route-meta'
import { InventoryView } from './Inventory'
import { StorageUnitsView } from './StorageUnits'

/**
 * The INVENTORY hub (roadmap item 11.0).
 *
 * Storage & Auctions was the last extra door onto the same cards. Inventory
 * already shows the shelf's contents; storage is the capacity and the locker
 * desk behind it. They're two modes of one door now, with the same param-route
 * shape as the DEALS, COLLECTION, MARKET and EVENTS hubs: `#/inventory/storage`,
 * fixed-order tabs, and `#/storage` normalized into the hub by App.
 *
 * Cards keeps the existing sub-tabs (Raw, Listed, Grading, In Transit,
 * Supplies, Authentication, Sealed). Storage keeps the capacity meters, locker
 * rental, overflow policy, vault rider and delinquent-locker auctions.
 */
export type { InventoryModeId }
export { inventoryModeLabel, isInventoryMode }

export type InventoryMode = {
  id: InventoryModeId
  label: string
  icon: string
  /** What this mode is for. Hover-only: the tabs stay uncluttered. */
  verb: string
  Component: ComponentType
}

const INVENTORY_COMPONENTS: Record<InventoryModeId, ComponentType> = {
  cards: InventoryView,
  storage: StorageUnitsView,
}

export const INVENTORY_MODES: InventoryMode[] = INVENTORY_MODES_META.map((m) => ({ ...m, Component: INVENTORY_COMPONENTS[m.id] }))

const go = (id: InventoryModeId) => {
  window.location.hash = `#/inventory/${id}`
}

export function InventoryHubView({ mode }: { mode?: string }) {
  const active = INVENTORY_MODES.find((m) => m.id === mode) ?? INVENTORY_MODES[0]
  const Body = active.Component

  return (
    <div className="hub">
      <div className="hub-bar">
        <div className="tab-bar hub-tabs" role="tablist" aria-label="Inventory modes">
          {INVENTORY_MODES.map((m) => (
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
