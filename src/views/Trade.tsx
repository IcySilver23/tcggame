import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { TradeOfferRow, TradeReply, TraderRow } from '../api'
import { useStore } from '../store'
import { fmtUsd } from '../components'

export const ARCH_LABEL: Record<string, string> = {
  grail_hunter: 'Grail Hunter',
  set_builder: 'Set Builder',
  flipper: 'Flipper',
  holo_hoarder: 'Holo Hoarder',
  vintage_purist: 'Vintage Purist',
  deal_seeker: 'Deal Seeker',
}

// Stance chips: warm → neutral → cold, matching the badge palette.
const STANCE_CLS: Record<string, string> = { Trusted: 'live', Friendly: 'live', Neutral: 'at', Wary: 'above', Hostile: 'above' }
const REP_SUMMARY: Record<string, string> = {
  Trusted: 'Best prices, soft counters, they seek you out',
  Friendly: 'Better prices, they initiate often',
  Neutral: 'Standard treatment',
  Wary: 'Lowball offers, harder counters',
  Hostile: 'Bitter prices, rarely approaches, may refuse outright',
}

export function StanceChip({ stance, rep }: { stance: string; rep: number }) {
  const sign = rep > 0 ? '+' : ''
  return (
    <span
      className={`badge ${STANCE_CLS[stance] ?? 'at'}`}
      title={REP_SUMMARY[stance] ?? ''}
      style={{ fontSize: 9, padding: '2px 7px' }}
    >
      {stance} {sign}{rep.toFixed(1)}
    </span>
  )
}

function CardChip({ name, image, value, condition, small }: { name: string; image: string | null; value: number; condition?: string; small?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
      <img
        src={image ?? ''}
        alt={name}
        style={{ width: small ? 38 : 52, borderRadius: 6, display: 'block', background: '#0d1017' }}
        onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
      />
      <div style={{ minWidth: 0 }}>
        <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 }}>{name}</div>
        <div className="faint small">
          {condition ? `${condition} · ` : ''}<span style={{ color: 'var(--yellow)' }}>{fmtUsd(value)}</span>
        </div>
      </div>
    </div>
  )
}

function OfferDelta({ total, anchor }: { total: number; anchor: number }) {
  if (anchor <= 0) return null
  const delta = total / anchor - 1
  const label = delta > 0.1 ? 'OVERPAY' : delta > -0.1 ? 'FAIR' : 'LOWBALL'
  const cls = delta > 0.1 ? 'above' : delta > -0.1 ? 'at' : 'below'
  return (
    <span className={`badge ${cls}`} style={{ fontSize: 10, padding: '2px 8px' }}>
      {label} {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(0)}%
    </span>
  )
}

function IncomingOffers({ offers, onChanged }: { offers: TradeOfferRow[]; onChanged: () => void }) {
  const { toast, refreshState } = useStore()
  const [busy, setBusy] = useState<number | null>(null)
  const [replies, setReplies] = useState<Record<number, string>>({})

  const act = async (id: number, fn: () => Promise<{ ok: boolean; reply?: string; error?: string; improved?: boolean; bump?: number }>, what: string) => {
    setBusy(id)
    try {
      const res = await fn()
      if (res.reply) setReplies((r) => ({ ...r, [id]: res.reply! }))
      if (res.ok) {
        toast(what, 'good')
        onChanged()
        refreshState()
      } else if (res.error) {
        toast(res.error, 'bad')
        onChanged()
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h2 style={{ marginBottom: 4 }}>📥 Incoming offers</h2>
      <div className="faint small" style={{ marginBottom: 10 }}>
        Collectors who approached you. Offers expire — answered offers disappear.
      </div>
      {offers.length === 0 && <div className="faint small">No offers on the table right now. Traders approach when you're active.</div>}
      {offers.map((o) => {
        const theirTotal = o.their_cards.reduce((a, c) => a + c.value, 0) + o.their_cash
        const yourValue = o.your_items.reduce((a, i) => a + i.value, 0)
        const isCounter = o.direction === 'outgoing'
        const netCash = o.your_cash - o.their_cash // <0 on a counter: you must add cash
        return (
          <div key={o.id} style={{ borderTop: '1px solid var(--border-soft)', padding: '12px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>{o.avatar}</span>
              <b className="small">{o.trader_name}</b>
              <span className="faint small">{o.handle}</span>
              {isCounter ? (
                <span className="badge warn" style={{ fontSize: 10, padding: '2px 8px' }}>counter — they want {fmtUsd(o.their_cash)} on top</span>
              ) : (
                o.rounds > 0 && <span className="badge" style={{ fontSize: 10, padding: '2px 8px' }}>improved ×{o.rounds}</span>
              )}
            </div>
            <div className="trade-swap">
              <div>
                <div className="nav-section" style={{ padding: 0, marginBottom: 6 }}>They give</div>
                {o.their_cards.map((c) => (
                  <div key={c.cardId} style={{ marginBottom: 6 }}><CardChip name={c.name} image={c.image} value={c.value} condition={c.condition} /></div>
                ))}
                {o.their_cash > 0 && netCash >= 0 && <div className="small" style={{ color: 'var(--green)' }}>+ {fmtUsd(netCash)} cash</div>}
              </div>
              <div className="trade-arrow">⇄</div>
              <div>
                <div className="nav-section" style={{ padding: 0, marginBottom: 6 }}>You give</div>
                {o.your_items.map((i) => (
                  <div key={i.inventoryId}><CardChip name={i.name} image={i.image} value={i.value} condition={i.condition} /></div>
                ))}
                {netCash < 0 && <div className="small" style={{ color: 'var(--red)', marginTop: 4 }}>+ {fmtUsd(-netCash)} cash</div>}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                <OfferDelta total={theirTotal} anchor={yourValue} />
                <div className="faint small">{fmtUsd(theirTotal)} vs {fmtUsd(yourValue)}</div>
                {!replies[o.id] && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {isCounter ? (
                      <>
                        <button className="primary small" disabled={busy === o.id} onClick={() => act(o.id, () => api.tradeAcceptCounter(o.id), 'Counter accepted — deal done')}>
                          Accept & pay {netCash < 0 ? fmtUsd(-netCash) : ''}
                        </button>
                        <button className="small" disabled={busy === o.id} onClick={() => act(o.id, () => api.tradeDeclineCounter(o.id), 'Walked away')}>
                          Walk away
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="primary small" disabled={busy === o.id} onClick={() => act(o.id, () => api.tradeAcceptIncoming(o.id), 'Trade accepted')}>
                          Accept
                        </button>
                        <button className="small" disabled={busy === o.id} onClick={() => act(o.id, () => api.tradeRejectIncoming(o.id), 'Offer rejected')}>
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="faint small" style={{ marginTop: 8, fontStyle: 'italic' }}>{o.message}</div>
            {replies[o.id] && <div className="trade-bubble" style={{ marginTop: 8 }}>{replies[o.id]}</div>}
          </div>
        )
      })}
    </div>
  )
}

function TradeMaker({ traders, onChanged }: { traders: TraderRow[]; onChanged: () => void }) {
  const { toast, refreshState, openCard } = useStore()
  const [traderId, setTraderId] = useState<number | null>(null)
  const [collection, setCollection] = useState<{ id: number; name: string; condition: string; value: number }[]>([])
  const [inventoryId, setInventoryId] = useState<number | ''>('')
  const [cash, setCash] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<TradeReply | null>(null)

  useEffect(() => {
    api
      .inventory()
      .then((rows) =>
        setCollection(
          rows
            .filter((r) => r.status === 'collection' && !r.graded_grade && (r.quantity as number) === 1)
            .map((r) => ({ id: r.id as number, name: `${r.name} (${r.condition})`, condition: r.condition as string, value: r.value as number })),
        ),
      )
      .catch(() => {})
  }, [])

  const trader = traders.find((t) => t.id === traderId) ?? null
  const selected = collection.find((c) => c.id === inventoryId)

  const propose = async () => {
    if (!traderId || !inventoryId) return
    setBusy(true)
    setReply(null)
    try {
      const res = await api.tradePropose(traderId, inventoryId, Number(cash) || 0)
      setReply(res)
      if (res.ok) {
        if (res.accepted) {
          toast('Trade complete', 'good')
          onChanged()
          refreshState()
        }
        // After any reply, refresh the trader list (their lineup may have changed)
        api.traders().then(() => {})
      } else if (res.error) {
        toast(res.error, 'bad')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="trade-maker">
      <div className="panel" style={{ margin: 0 }}>
        <h2 style={{ marginBottom: 4 }}>🤝 The traders</h2>
        <div className="faint small" style={{ marginBottom: 10 }}>Every trader values your cards through their own obsession.</div>
        {traders.map((t) => (
          <div
            key={t.id}
            className={`trade-trader ${traderId === t.id ? 'sel' : ''}`}
            onClick={() => { setTraderId(t.id); setReply(null) }}
          >
            <span style={{ fontSize: 22 }}>{t.avatar}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <b className="small">{t.name}</b>
                <StanceChip stance={t.stance} rep={t.reputation} />
              </div>
              <div className="faint small">{ARCH_LABEL[t.archetype] ?? t.archetype} · {t.card_count} cards · {t.trade_count} trades</div>
            </div>
            <div className="small" style={{ color: 'var(--yellow)' }}>{fmtUsd(t.cash)}</div>
          </div>
        ))}
      </div>

      <div className="panel" style={{ margin: 0 }}>
        {!trader ? (
          <div className="faint small">Pick a trader to open negotiations.</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 26 }}>{trader.avatar}</span>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0 }}>
                  {trader.name} <span className="faint small" style={{ fontWeight: 400 }}>{trader.handle}</span>
                  <span style={{ marginLeft: 8 }}><StanceChip stance={trader.stance} rep={trader.reputation} /></span>
                </h2>
                <div className="faint small">{ARCH_LABEL[trader.archetype] ?? trader.archetype} — {trader.blurb}</div>
                <div className="faint small" style={{ marginTop: 2 }}>
                  {trader.stance === 'Neutral'
                    ? 'No history yet — trades build trust, walk-aways sour it.'
                    : `${trader.stance} · reputation ${trader.reputation > 0 ? '+' : ''}${trader.reputation.toFixed(1)} — ${REP_SUMMARY[trader.stance] ?? ''}`}
                  {trader.walked_away > 0 ? ` · turned you away ${trader.walked_away}× lately` : ''}
                </div>
              </div>
            </div>
            <div className="trade-cards">
              {trader.cards.map((c) => (
                <div key={c.id} className="trade-card" onClick={() => openCard(c.card_id)}>
                  <img src={c.image_small ?? ''} alt={c.name}
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
                  <div className="small" style={{ padding: '4px 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                  <div className="faint small" style={{ padding: '0 6px 6px' }}>{c.condition} · {fmtUsd(c.value)}</div>
                </div>
              ))}
            </div>

            <div className="nav-section" style={{ padding: 0, margin: '12px 0 6px' }}>Your offer</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={inventoryId} onChange={(e) => setInventoryId(e.target.value ? Number(e.target.value) : '')} style={{ flex: 1, minWidth: 220 }}>
                <option value="">Choose a card from your collection…</option>
                {collection.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — {fmtUsd(c.value)}</option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="0.5"
                placeholder="+ cash"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
                style={{ width: 90 }}
              />
              <button className="primary" disabled={!inventoryId || busy} onClick={propose}>
                {busy ? 'Negotiating…' : 'Propose trade'}
              </button>
            </div>
            {selected && <div className="faint small" style={{ marginTop: 6 }}>Offering {selected.name} (market {fmtUsd(selected.value)}){Number(cash) > 0 ? ` + $${Number(cash).toFixed(2)} cash` : ''}</div>}

            {reply?.reply && (
              <div className="trade-bubble" style={{ marginTop: 12 }}>
                {reply.reply}
                {reply.accepted && reply.gained !== undefined && reply.gave !== undefined && (
                  <div className="small" style={{ marginTop: 6, color: reply.gained >= reply.gave ? 'var(--green)' : 'var(--red)' }}>
                    Received {fmtUsd(reply.gained)} in value · gave {fmtUsd(reply.gave)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function TradeView() {
  const [traders, setTraders] = useState<TraderRow[]>([])
  const [offers, setOffers] = useState<TradeOfferRow[]>([])
  const [history, setHistory] = useState<{ id: number; message: string; created_at: string }[]>([])
  const { state } = useStore()

  const load = () => {
    api.traders().then(setTraders).catch(() => {})
    api.tradePending().then(setOffers).catch(() => {})
    api.tradeHistory().then(setHistory).catch(() => {})
  }
  useEffect(() => { load() }, [])
  // Offers arrive on the game tick — poll alongside the state cycle. Traders
  // refresh too, so reputation shifts show up without leaving the screen.
  useEffect(() => {
    const t = setInterval(() => {
      api.tradePending().then(setOffers).catch(() => {})
      api.traders().then(setTraders).catch(() => {})
    }, 15000)
    return () => clearInterval(t)
  }, [])

  const totalTrades = useMemo(() => traders.reduce((a, t) => a + t.trade_count, 0), [traders])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Trading Post</h1>
          <div className="sub">Negotiate with collectors — real prices, personal obsessions.</div>
        </div>
        <div className="right">
          <div className="faint small">Trades completed</div>
          <div className="price" style={{ fontSize: 18 }}>{totalTrades}</div>
        </div>
      </div>

      <IncomingOffers offers={offers} onChanged={load} />
      <TradeMaker traders={traders} onChanged={load} />

      {history.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h2 style={{ marginBottom: 8 }}>📜 Trade log</h2>
          {history.slice(0, 12).map((h) => (
            <div key={h.id} className="faint small" style={{ padding: '4px 0', borderBottom: '1px solid var(--border-soft)' }}>
              {h.message}
            </div>
          ))}
        </div>
      )}

      <div className="faint small" style={{ marginTop: 10 }}>
        Cash: {fmtUsd(state?.cash)} · Card values anchor to real TCGplayer / PriceCharting / eBay data; each trader's opinion of them is their own.
      </div>
    </div>
  )
}
