import type { ComponentType } from 'react'
import { DEAL_VENUE_META, DEALS_GATE, dealVenueLabel, isDealVenue, type DealVenueId } from '../route-meta'
import { useStore } from '../store'
import { EmptyState } from '../components'
import { PawnShopView } from './PawnShop'
import { YardSalesView } from './YardSales'
import { FleaMarketView } from './FleaMarket'
import { EstateSalesView } from './EstateSales'
import { LocalDealsView } from './LocalDeals'
import { BidBayView } from './BidBay'
import { LiveShoppingView } from './LiveShopping'

/**
 * The DEALS hub (roadmap item 1.0).
 *
 * Seven venues used to be seven sidebar rows, seven gates and seven hint rows.
 * They're one door now — but nothing about the progression moved: every venue
 * keeps its own sales threshold, it just prints on a tab instead of the nav.
 *
 * Tab order is BY GATE and then fixed forever. It must never re-sort by live
 * progress: where BidBay lives in the row has to be the same on day 1 and day
 * 200, or muscle memory is worthless. Gate order happens to read as a ladder,
 * and the "next goal" line always points at the first locked rung.
 */
export type { DealVenueId }
export { DEALS_GATE, dealVenueLabel, isDealVenue }

export type DealVenue = {
  id: DealVenueId
  label: string
  icon: string
  /** Sales count required to open this venue — unchanged from the old nav rows. */
  gate: number
  hint: string
  /** What you come here to do. Hover-only: the tabs stay uncluttered. */
  verb: string
  Component: ComponentType
}

const DEAL_COMPONENTS: Record<DealVenueId, ComponentType> = {
  pawn: PawnShopView,
  yard: YardSalesView,
  local: LocalDealsView,
  flea: FleaMarketView,
  bidbay: BidBayView,
  estate: EstateSalesView,
  live: LiveShoppingView,
}

export const DEAL_VENUES: DealVenue[] = DEAL_VENUE_META.map((v) => ({ ...v, Component: DEAL_COMPONENTS[v.id] }))

const go = (id: DealVenueId) => {
  window.location.hash = `#/deals/${id}`
}

export function DealsView({ venue }: { venue?: string }) {
  const { state } = useStore()
  // Before state lands, App renders nothing as locked either — showing seven
  // 🔒 tabs for half a second on a veteran save would read as a regression.
  const ready = !!state?.progress
  const sales = state?.progress?.salesCount ?? 0
  const isOpen = (v: DealVenue) => !ready || sales >= v.gate

  const active =
    DEAL_VENUES.find((v) => v.id === venue) ??
    DEAL_VENUES.find((v) => isOpen(v)) ??
    DEAL_VENUES[0]
  const activeLocked = ready && sales < active.gate
  const next = ready ? DEAL_VENUES.find((v) => sales < v.gate) : undefined
  const nearestOpen = DEAL_VENUES.find((v) => isOpen(v))
  const Body = active.Component

  return (
    <div className="deals-hub">
      <div className="deals-bar">
        <div className="tab-bar deals-tabs" role="tablist" aria-label="Deal venues">
          {DEAL_VENUES.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={v.id === active.id}
              className={`tab ${v.id === active.id ? 'on' : ''} ${isOpen(v) ? '' : 'is-locked'}`}
              title={`${v.label} — ${v.verb}`}
              onClick={() => go(v.id)}
            >
              <span aria-hidden>{isOpen(v) ? v.icon : '🔒'}</span> {v.label}
              {!isOpen(v) && (
                <span className="tab-gate" aria-label={v.hint}>
                  {sales}/{v.gate}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* One line replacing six sidebar hint rows — this IS the
            consolidation win, and it keeps the exact visual language the
            nav rows used (hint + gold counter). */}
        {next && (
          <div className="deals-next" title={`${next.label} — ${next.hint}`}>
            🔒 Next: <b>{next.label}</b> · {next.hint}{' '}
            <span className="lock-progress">{sales}/{next.gate}</span>
          </div>
        )}
      </div>

      {activeLocked ? (
        <EmptyState
          icon="🔒"
          text={`${active.label} opens at ${active.gate} sales`}
          sub={`You've made ${sales}. ${active.gate - sales} more ${
            active.gate - sales === 1 ? 'sale' : 'sales'
          } unlocks it — every path counts: the Market, the Buylist, the Trading Post, your shop cases.`}
          action={
            nearestOpen && nearestOpen.id !== active.id
              ? { label: `Head to ${nearestOpen.label} →`, onClick: () => go(nearestOpen.id) }
              : undefined
          }
        />
      ) : (
        <Body />
      )}
    </div>
  )
}
