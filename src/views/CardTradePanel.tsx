import { useEffect, useState } from 'react'
import { api, type TradeReply, type TraderRow } from '../api'
import { useStore } from '../store'
import { fmtUsd } from '../components'
import { ARCH_LABEL, StanceChip } from './Trade'

/**
 * Inline negotiation from the card-detail modal: pick a trader, optionally
 * sweeten with cash, see their live reply. Reuses the Trade view's stance chips.
 */
export function CardTradePanel({ inventoryId, cardName, cardValue, onDone }: {
  inventoryId: number
  cardName: string
  cardValue: number | null
  onDone: () => void
}) {
  const { toast, refreshState } = useStore()
  const [traders, setTraders] = useState<TraderRow[]>([])
  const [traderId, setTraderId] = useState<number | null>(null)
  const [cash, setCash] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<TradeReply | null>(null)
  const [afford, setAfford] = useState(true)

  useEffect(() => {
    api.traders().then(setTraders).catch(() => {})
    api.state().then((s) => setAfford(s.cash >= 0)).catch(() => {})
  }, [])

  const trader = traders.find((t) => t.id === traderId) ?? null

  const propose = async () => {
    if (!traderId) return
    setBusy(true)
    setReply(null)
    try {
      const res = await api.tradePropose(traderId, inventoryId, Number(cash) || 0)
      setReply(res)
      if (res.ok && res.accepted) {
        toast(`Traded ${cardName} — ${trader?.name ?? 'collector'} accepted`, 'good')
        refreshState()
        onDone()
      } else if (res.error) {
        toast(res.error, 'bad')
      }
    } finally {
      setBusy(false)
    }
  }

  if (traders.length === 0) {
    return <div className="faint small" style={{ padding: '8px 0' }}>Loading traders…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {traders.map((t) => (
          <div
            key={t.id}
            className={`trade-trader ${traderId === t.id ? 'sel' : ''}`}
            style={{ padding: '6px 8px', minWidth: 0, flex: '1 1 180px' }}
            onClick={() => { setTraderId(t.id); setReply(null) }}
          >
            <span style={{ fontSize: 18 }}>{t.avatar}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b className="small">{t.name.split(' ')[0]}</b>
              <div className="faint small" style={{ fontSize: 10 }}>{ARCH_LABEL[t.archetype] ?? t.archetype}</div>
            </div>
            <StanceChip stance={t.stance} rep={t.reputation} />
          </div>
        ))}
      </div>

      {trader && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="faint small">Offering {cardName}{cardValue != null ? ` (${fmtUsd(cardValue)})` : ''} to {trader.name}</span>
          <input
            type="number"
            min="0"
            step="0.5"
            placeholder="+ cash"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            style={{ width: 90 }}
          />
          <button className="primary small" disabled={busy} onClick={propose}>
            {busy ? 'Negotiating…' : 'Send offer'}
          </button>
        </div>
      )}

      {reply?.reply && (
        <>
          <div className="trade-bubble">{reply.reply}</div>
          {!reply.accepted && (
            <div className="faint small">
              {reply.ok ? 'Their counter, if any, lands in the Trading Post inbox.' : ''}
            </div>
          )}
        </>
      )}
    </div>
  )
}
