import { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { fmtUsd } from '../components'

// ---------------------------------------------------------------------------
// Which door pays most — the four ways to sell one card, side by side, and the
// buttons that walk through them. Figures come from the server so this can
// never disagree with what the desk, the buylist, the pawn counter or a listing
// will actually pay; the sale itself is performed by the server, which checks
// the door's gate again before it pays.
//
// Two doors are gated on a young save (the Resale Desk at $400 cash and the
// Pawn Shop at 3 sales). They still show what they would pay, but they are
// dimmed with the requirement on the row, cannot win "best", and are not
// clickable.
// ---------------------------------------------------------------------------

type Route = {
  id: string
  label: string
  net: number
  pct: number
  wait: string
  note: string
  /** A nav gate, not a market condition: why this door is not open yet. */
  locked?: string
}

type Answer = {
  ok: boolean
  market: number
  routes: Route[]
  bestId: string
  spread: number
  error?: string
}

export function SellRoutes({ inventoryId, compact, onSold }: { inventoryId: number; compact?: boolean; onSold?: () => void }) {
  const toast = useStore((s) => s.toast)
  const [data, setData] = useState<Answer | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

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
  const best = sorted.find((r) => !r.locked) ?? sorted[0]
  const lockedCount = sorted.filter((r) => r.locked).length

  async function act(r: Route) {
    if (r.locked || busy) return
    setBusy(r.id)
    try {
      const res = await api.sellRoute(inventoryId, r.id)
      if (res.ok) {
        toast(res.message ?? 'Sold.', 'good')
        onSold?.()
      } else {
        toast(res.error ?? 'That door is closed.', 'bad')
      }
    } catch {
      toast('The sale did not go through.', 'bad')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={`sr ${compact ? 'sr-compact' : ''}`}>
      <div className="sr-head">
        <b>Which door pays most?</b>
        <span className="faint small">market {fmtUsd(data.market)}</span>
      </div>
      <div className="sr-rows">
        {sorted.map((r) => {
          const isBest = r.id === best.id && !r.locked
          return (
            <button
              type="button"
              key={r.id}
              className={`sr-row ${isBest ? 'best' : ''} ${r.locked ? 'locked' : ''}`}
              disabled={Boolean(r.locked) || busy !== null}
              title={r.locked ?? r.note}
              onClick={() => act(r)}
            >
              <div className="sr-label">
                {isBest && <span className="sr-tick" aria-hidden>✓</span>}
                {r.locked ? '🔒 ' : ''}{r.label}
                <em>{r.locked ?? r.wait}</em>
              </div>
              <div className="sr-bar" aria-hidden>
                <i style={{ width: `${Math.max(4, Math.round(r.pct * 100))}%` }} />
              </div>
              <div className="sr-net">
                <b>{fmtUsd(r.net)}</b>
                <em>{Math.round(r.pct * 100)}%</em>
              </div>
              <span className="sr-go">
                {r.locked ? 'Locked' : busy === r.id ? '…' : r.id === 'market' ? 'List' : 'Sell'}
              </span>
            </button>
          )
        })}
      </div>
      <div className="sr-foot">
        Best open door is <b>{best.label}</b> at {fmtUsd(best.net)}
        {' — '}{fmtUsd(data.spread)} more than the worst door
        {lockedCount > 0 ? ` (${lockedCount} door${lockedCount === 1 ? '' : 's'} still locked).` : '.'}
      </div>
    </div>
  )
}
