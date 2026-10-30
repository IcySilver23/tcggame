import type { ComponentType } from 'react'
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
export type DealVenueId = 'pawn' | 'yard' | 'local' | 'flea' | 'bidbay' | 'estate' | 'live'

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

export const DEAL_VENUES: DealVenue[] = [
  { id: 'pawn', label: 'Pawn Shop', icon: '💠', gate: 3, hint: 'Make 3 sales', verb: 'Hock a card for cash now, or take a 30-day loan you have to service', Component: PawnShopView },
  { id: 'yard', label: 'Yard Sales', icon: '🛗', gate: 3, hint: 'Make 3 sales', verb: 'Read a driveway table from one-line peeks and haggle across the hood', Component: YardSalesView },
  { id: 'local', label: 'Local Deals', icon: '🪧', gate: 5, hint: 'Make 5 sales', verb: 'Meet a stranger in a parking lot — cheap and risky, or inspected and clean', Component: LocalDealsView },
  { id: 'flea', label: 'Flea Markets', icon: '🛒', gate: 6, hint: 'Make 6 sales', verb: 'Dig flat-price bins while NPC pickers drain the same bins beside you', Component: FleaMarketView },
  { id: 'bidbay', label: 'BidBay', icon: '🌐', gate: 8, hint: 'Make 8 sales', verb: 'Undercut the room — price against snipers who scan the feed twice a tick', Component: BidBayView },
  { id: 'estate', label: 'Estate Buyouts', icon: '📑', gate: 10, hint: 'Make 10 sales', verb: 'Buy a whole collection sight unseen and find out what you actually got', Component: EstateSalesView },
  { id: 'live', label: 'Live Shopping', icon: '📺', gate: 12, hint: 'Make 12 sales', verb: 'Pounce in a live room — six formats, a clock that does not wait', Component: LiveShoppingView },
]

/** Earliest venue gate — also the hub's own gate in the sidebar. */
export const DEALS_GATE = Math.min(...DEAL_VENUES.map((v) => v.gate))

export function dealVenueLabel(id?: string): string | undefined {
  return DEAL_VENUES.find((v) => v.id === id)?.label
}

export function isDealVenue(id?: string): id is DealVenueId {
  return !!id && DEAL_VENUES.some((v) => v.id === id)
}

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
