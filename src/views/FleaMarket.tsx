import { useEffect, useState } from 'react'
import { api } from '../api'
import type { FleaSection, FleaMarketRow, FleaBin, FleaDigResult } from '../api'
import { useStore } from '../store'
import { ConditionBadge, fmtUsd } from '../components'

export function FleaMarketView() {
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<FleaSection | null>(null)
  const [digging, setDigging] = useState<number | null>(null)
  const [lastFind, setLastFind] = useState<(FleaDigResult & { binPrice: number }) | null>(null)

  const load = () => {
    api.flea().then(setData).catch(() => {})
  }
  useEffect(() => { load() }, [])
  // The grounds breathe: pickers drain bins live, so poll while anything is live.
  const anyLive = (data?.markets ?? []).some((m) => !m.expired)
  useEffect(() => {
    if (!anyLive) return
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [anyLive])

  const dig = async (bin: FleaBin) => {
    setDigging(bin.id)
    try {
      const r = await api.fleaDig(bin.id)
      if (r.ok && r.card) {
        setLastFind({ ...r.card, binPrice: bin.price })
        refreshState()
      } else {
        toast(r.error ?? 'The bin is empty', 'bad')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Dig failed', 'bad')
    }
    setDigging(null)
    load()
  }

  const priceColor = (p: number) =>
    p === 0.25 ? 'var(--green)' : p === 0.5 ? 'var(--blue)' : p === 1 ? 'var(--violet)' : p === 2 ? 'var(--amber)' : 'var(--red)'

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Flea Markets</h1>
          <div className="sub">
            Weekend junk bins at flat prices — 25¢ for a shadowless is the dream. The grounds open at 6 AM and the pickers are already digging.
          </div>
        </div>
      </div>

      {data && !data.isWeekend && (
        <div className="panel mt14">
          <p className="small muted" style={{ margin: 0 }}>
            🛒 The flea grounds are quiet — it's a weekday. Markets spawn weekend mornings from {data.openHour}:00 AM
            (and the 6 AM crew takes the good stuff early). Check the Calendar for what's live.
          </p>
        </div>
      )}

      {(data?.markets ?? []).map((m) => (
        <MarketPanel key={m.id} market={m} digging={digging} onDig={dig} priceColor={priceColor} pickersActive={!!data?.pickersActive} />
      ))}

      {data && data.markets.length === 0 && data.isWeekend && (
        <div className="panel mt14">
          <p className="small muted" style={{ margin: 0 }}>
            No flea grounds open at the moment — they pop up weekend mornings. Keep an eye on the feed.
          </p>
        </div>
      )}

      {lastFind && (
        <div className="panel mt14" style={lastFind.trueMarket >= lastFind.binPrice * 10 ? { borderColor: 'var(--good, var(--green))', boxShadow: '0 0 24px rgba(62,207,116,0.25)' } : undefined}>
          <h2>Last dig</h2>
          <div className="row" style={{ alignItems: 'center', gap: 12 }}>
            <div>
              <b>{lastFind.name}</b> <ConditionBadge cond={lastFind.condition} />
              <div className="small muted">
                Paid {fmtUsd(lastFind.paid)} from the {fmtUsd(lastFind.binPrice)} bin · comps ~{fmtUsd(lastFind.trueMarket)}
                {lastFind.trueMarket >= lastFind.binPrice * 10 && (
                  <b style={{ color: 'var(--good, var(--green))' }}> — SCORE, {Math.round(lastFind.trueMarket / lastFind.binPrice)}× the bin</b>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {(data?.myDigs ?? []).length > 0 && (
        <div className="panel mt14">
          <h2>Your digs <span className="badge">last {(data?.myDigs ?? []).length}</span></h2>
          <table className="table">
            <thead><tr><th>Card</th><th>Condition</th><th className="right">Paid</th><th className="right">Comps</th><th className="right">Multiple</th></tr></thead>
            <tbody>
              {(data?.myDigs ?? []).map((d, i) => (
                <tr key={i}>
                  <td>{d.name}</td>
                  <td><ConditionBadge cond={d.condition} /></td>
                  <td className="num">{fmtUsd(d.paid)}</td>
                  <td className="num">~{fmtUsd(d.trueMarket)}</td>
                  <td className="num" style={{ color: d.trueMarket >= d.paid * 10 ? 'var(--good, var(--green))' : d.trueMarket >= d.paid ? undefined : 'var(--red)' }}>
                    {d.paid > 0 ? `${(d.trueMarket / d.paid).toFixed(1)}×` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function MarketPanel({ market: m, digging, onDig, priceColor, pickersActive }: {
  market: FleaMarketRow
  digging: number | null
  onDig: (b: FleaBin) => void
  priceColor: (p: number) => string
  pickersActive: boolean
}) {
  const closesIn = Math.max(0, new Date(m.closesAt).getTime() - Date.now())
  const hoursLeft = Math.floor(closesIn / 3_600_000)
  const minsLeft = Math.floor((closesIn % 3_600_000) / 60_000)
  const totalLeft = m.bins.reduce((a, b) => a + b.remaining, 0)
  return (
    <div className="panel mt14">
      <h2>
        🛒 {m.grounds}
        <span className="badge live" style={{ marginLeft: 8 }}>
          {m.expired ? 'packing up' : `${hoursLeft}h ${minsLeft}m left`}
        </span>
        {pickersActive && <span className="badge est" style={{ marginLeft: 6 }}>pickers digging</span>}
      </h2>
      <p className="small muted">
        {totalLeft} cards still in the bins. Every card in a bin is one flat price — the score is the card that
        doesn't belong. Nobody tells you which.
      </p>
      <table className="table">
        <thead><tr><th>Bin</th><th className="right">Price</th><th className="right">Remaining</th><th className="right">Heat</th><th></th></tr></thead>
        <tbody>
          {m.bins.map((b) => (
            <tr key={b.id}>
              <td>
                <b>{b.label}</b>
                {b.hotScores > 0 && <span className="badge hit" style={{ marginLeft: 6 }} title="Cards still in this bin worth 20×+ the bin price">🔥 {b.hotScores}</span>}
              </td>
              <td className="num" style={{ color: priceColor(b.price), fontWeight: 700 }}>{fmtUsd(b.price)}</td>
              <td className="num">{b.remaining}/{b.total}</td>
              <td className="num faint">
                {b.total > 0 ? `${Math.round((b.remaining / b.total) * 100)}% left` : '—'}
              </td>
              <td className="right">
                <button className="primary" disabled={digging === b.id || b.remaining === 0 || m.expired} onClick={() => onDig(b)}>
                  {digging === b.id ? 'Digging…' : b.remaining === 0 ? 'Picked clean' : 'Dig a card'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
