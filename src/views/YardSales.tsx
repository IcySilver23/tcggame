import { useEffect, useState } from 'react'
import { api } from '../api'
import type { YardCard, YardSaleRow, YardSection, YardBoxResult } from '../api'
import { useStore } from '../store'
import { EmptyState, FirstUseTip, fmtUsd } from '../components'

function hoursLeft(closesAt: string): number {
  return (new Date(closesAt).getTime() - Date.now()) / 3_600_000
}

export function YardSalesView() {
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<YardSection | null>(null)
  const [busy, setBusy] = useState(false)
  const [offer, setOffer] = useState<Record<number, string>>({})
  const [reveal, setReveal] = useState<YardBoxResult | null>(null)

  const load = () => api.yard().then(setData).catch(() => {})
  useEffect(() => { load() }, [])

  const run = async (fn: () => Promise<any>, okMsg: (r: any) => string) => {
    setBusy(true)
    try {
      const r = await fn()
      if (r.ok) { toast(okMsg(r), 'good'); refreshState(); load(); return r }
      toast(r.error ?? 'Rejected', 'bad')
      return r
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'bad')
      return null
    } finally {
      setBusy(false)
    }
  }

  const afterOffer = (r: any) => {
    if (r.accepted) return `Sold — ${r.card} for ${fmtUsd(r.paid ?? 0)}.`
    if (r.counter) return `${r.message} (counter: ${fmtUsd(r.counter)})`
    return r.message ?? 'They passed.'
  }

  const openBox = (s: YardSaleRow) =>
    run(() => api.yardBox(s.id), () => 'Box paid — tear it open.').then((r: any) => { if (r && r.ok && r.cards) setReveal(r) })

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🛗 Yard Sales</h1>
          <div className="sub">Saturday-morning driveways. Nobody prices from a database — read the table, make an offer, and grab the box before somebody else does.</div>
        </div>
      </div>

      <FirstUseTip surface="yard">
        Sellers price from vibes: some stacks are <b>4× overpriced</b>, some are <b>near-giveaways</b> — the one-line peek
        (calibrated around 30% of true value) is all you get. <b>Offers are welcome</b>, but lowball too hard and they'll
        wave you off — two counters, then the attitude sours; <b>pay the sticker</b> to stay friendly. Some households run a
        <b> mystery box</b>: flat price, contents unknown until you pay. Windows last a few hours — by Sunday evening the
        driveways are bare.
      </FirstUseTip>

      {data && !data.isWeekend && (
        <div className="faint small" style={{ marginBottom: 10 }}>It's a weekday — only the stray driveway is out. Real volume comes Saturday and Sunday morning.</div>
      )}

      {data && data.sales.length === 0 && (
        <EmptyState icon="🛗" text="No sales out right now" sub="Check back Saturday morning — that's when the card tables hit the driveways." />
      )}

      {data?.sales.map((s) => (
        <SaleCard key={s.id} s={s} busy={busy} offer={offer} setOffer={setOffer} reveal={reveal} setReveal={setReveal}
          onOffer={(rowId, amt) => run(() => api.yardOffer(rowId, amt), afterOffer)}
          onBuy={(rowId) => run(() => api.yardBuy(rowId), (r) => `Paid ${fmtUsd(r.paid ?? 0)} — ${r.card} is yours.`)}
          onBox={() => openBox(s)}
        />
      ))}

      {reveal && reveal.ok && reveal.cards && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setReveal(null)}>
          <div className="panel" style={{ maxWidth: 560, maxHeight: '80vh', overflow: 'auto', margin: 16 }} onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>📦 The box, torn open</b>
              <button className="small" onClick={() => setReveal(null)}>close</button>
            </div>
            <div className="small muted" style={{ margin: '6px 0 10px' }}>
              paid {fmtUsd(reveal.paid ?? 0)} · contents worth <b style={{ color: (reveal.trueTotal ?? 0) >= (reveal.paid ?? 0) ? 'var(--green)' : 'var(--red)' }}>{fmtUsd(reveal.trueTotal ?? 0)}</b>
              {' '}({(reveal.trueTotal ?? 0) >= (reveal.paid ?? 0) ? '+' : ''}{fmtUsd((reveal.trueTotal ?? 0) - (reveal.paid ?? 0))})
            </div>
            {reveal.cards.slice().sort((a, b) => b.value - a.value).map((c, i) => (
              <div key={i} className="row small" style={{ gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <b style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</b>
                <span className="faint">{c.condition} ×{c.qty}</span>
                <b>{fmtUsd(c.value)}</b>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SaleCard({ s, busy, offer, setOffer, reveal, setReveal, onOffer, onBuy, onBox }: {
  s: YardSaleRow
  busy: boolean
  offer: Record<number, string>
  setOffer: (v: Record<number, string>) => void
  reveal: YardBoxResult | null
  setReveal: (r: YardBoxResult | null) => void
  onOffer: (rowId: number, amt: number) => void
  onBuy: (rowId: number) => void
  onBox: () => void
}) {
  const hrs = hoursLeft(s.closesAt)
  const expired = s.expired || hrs <= 0
  return (
    <div className="panel mb14" style={{ opacity: expired ? 0.55 : undefined }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <b>🛗 {s.seller} <span className="faint small">· {s.neighborhood}</span></b>
        <span className="small muted">{expired ? 'packed up' : `${hrs < 1 ? `${Math.max(5, Math.round(hrs * 60))}m left` : `${Math.ceil(hrs)}h left`}`}</span>
      </div>

      {s.table.length === 0 ? (
        <EmptyState icon="🫥" text="Table's bare" sub="Someone got here first." />
      ) : (
        <table style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse' }}>
          <thead>
            <tr className="faint small" style={{ textAlign: 'left' }}>
              <th style={{ padding: '4px 6px' }}>the peek</th>
              <th style={{ padding: '4px 6px' }}>cond</th>
              <th style={{ padding: '4px 6px' }}>ask</th>
              <th style={{ padding: '4px 6px' }}>your offer</th>
            </tr>
          </thead>
          <tbody>
            {s.table.map((c: YardCard) => {
              const myOffer = Number(offer[c.id]) || 0
              return (
                <tr key={c.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                  <td style={{ padding: '6px', maxWidth: 340 }}>{c.peek}</td>
                  <td style={{ padding: '6px' }} className="small">{c.condition}{c.qty > 1 ? ` ×${c.qty}` : ''}</td>
                  <td style={{ padding: '6px' }}><b>{fmtUsd(c.ask)}</b></td>
                  <td style={{ padding: '6px' }}>
                    <div className="row" style={{ gap: 4 }}>
                      <input
                        className="small" style={{ width: 74 }} placeholder={(c.ask * 0.7).toFixed(0)}
                        value={offer[c.id] ?? ''}
                        onChange={(e) => setOffer({ ...offer, [c.id]: e.target.value })}
                      />
                      <button className="small" disabled={busy || expired || myOffer <= 0}
                        onClick={() => onOffer(c.id, myOffer)}
                        title={`offer ${fmtUsd(myOffer)}`}>
                        offer
                      </button>
                      <button className="small" disabled={busy || expired}
                        onClick={() => onBuy(c.id)}
                        title="pay the sticker">
                        buy {fmtUsd(c.ask)}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {s.boxAsk != null && !s.boxTaken && !expired && (
        <div className="row" style={{ marginTop: 10, padding: '8px 10px', background: 'var(--panel2)', borderRadius: 6, justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <span className="small">
            📦 <b>Mystery box</b> — {s.boxCount} cards, sealed, no peeks. {fmtUsd(s.boxAsk)} takes it.
          </span>
          <button className="primary small" disabled={busy} onClick={onBox}>take the box — {fmtUsd(s.boxAsk)}</button>
        </div>
      )}
      {s.boxTaken && <div className="faint small" style={{ marginTop: 8 }}>📦 the box went home with somebody.</div>}
    </div>
  )
}
