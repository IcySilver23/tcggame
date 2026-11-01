import { useEffect, useState } from 'react'
import { fmtUsd } from '../components'

// ---------------------------------------------------------------------------
// Which door pays most — the four ways to sell one card, side by side.
// Figures come from the server so this can never disagree with what the desk,
// the buylist, the pawn counter or a listing will actually pay.
// ---------------------------------------------------------------------------

type Route = {
  id: string
  label: string
  net: number
  pct: number
  wait: string
  note: string
}

type Answer = {
  ok: boolean
  market: number
  routes: Route[]
  bestId: string
  spread: number
  error?: string
}

export function SellRoutes({ inventoryId, compact }: { inventoryId: number; compact?: boolean }) {
  const [data, setData] = useState<Answer | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/sell-routes/${inventoryId}`)
      .then((r) => r.json())
      .then((d: Answer) => { if (live) setData(d) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [inventoryId])

  if (failed) return null
  if (!data) return null
  if (!data.ok) return null

  const sorted = [...data.routes].sort((a, b) => b.net - a.net)
  const best = sorted[0]

  return (
    <div className={`sr ${compact ? 'sr-compact' : ''}`}>
      <div className="sr-head">
        <b>Which door pays most?</b>
        <span className="faint small">market {fmtUsd(data.market)}</span>
      </div>
      <div className="sr-rows">
        {sorted.map((r) => {
          const isBest = r.id === best.id
          return (
            <div key={r.id} className={`sr-row ${isBest ? 'best' : ''}`}>
              <div className="sr-label">
                {isBest && <span className="sr-tick" aria-hidden>✓</span>}
                {r.label}
                <em>{r.wait}</em>
              </div>
              <div className="sr-bar" aria-hidden>
                <i style={{ width: `${Math.max(4, Math.round(r.pct * 100))}%` }} />
              </div>
              <div className="sr-net">
                <b>{fmtUsd(r.net)}</b>
                <em>{Math.round(r.pct * 100)}%</em>
              </div>
            </div>
          )
        })}
      </div>
      <div className="sr-foot">
        Best here is <b>{best.label}</b> at {fmtUsd(best.net)} — {fmtUsd(data.spread)} more than the worst door.
      </div>
    </div>
  )
}
