import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { TradeOfferRow, TradeReply, TraderRow } from '../api'
import { useStore } from '../store'
import { fmtUsd } from '../components'

/** Lifetime value won/lost trading with this NPC, colored. */
function EvCell({ v, per }: { v: number; per?: number }) {
  const cls = v > 0.5 ? 'below' : v < -0.5 ? 'above' : 'at'
  return (
    <span style={{ color: v > 0.5 ? 'var(--green)' : v < -0.5 ? 'var(--red)' : undefined, whiteSpace: 'nowrap' }}>
      {v >= 0 ? '+' : '−'}{fmtUsd(Math.abs(v))}{per !== undefined && <span className="faint"> /trade</span>}
      <span className={`badge ${cls}`} style={{ fontSize: 9, padding: '1px 6px', marginLeft: 6 }}>
        {v > 0.5 ? 'WIN' : v < -0.5 ? 'LOSS' : 'EVEN'}
      </span>
    </span>
  )
}

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
          {condition ? `${condition} · ` : ''}<span style={{ color: 'var(--gold)' }}>{fmtUsd(value)}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * Fairness math, in the open. Counters: the game caps any counter ask so
 * accepting always lands you at ≥ ~90% of your card's real market value
 * (lineup + net cash). Incoming offers: no guarantee — it's the trader's
 * opening gambit, and the block just shows the arithmetic honestly.
 */
function CounterFairness({ lineupValue, yourValue, netCash, variant = 'counter' }: { lineupValue: number; yourValue: number; netCash: number; variant?: 'counter' | 'incoming' }) {
  if (yourValue <= 0) return null
  const landed = (lineupValue + netCash) / yourValue
  const pct = Math.round(landed * 100)
  const color = landed >= 0.9 ? 'var(--green)' : landed >= 0.8 ? 'var(--yellow)' : 'var(--red)'
  return (
    <div className="small" style={{ marginTop: 8, padding: '8px 10px', background: 'var(--panel2)', borderRadius: 6, border: '1px solid var(--border-soft)' }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>⚖ Why this number</div>
      <div className="faint small">Their cards at market: <b style={{ color: 'var(--gold)' }}>${lineupValue.toFixed(2)}</b> · your card at market: ${yourValue.toFixed(2)} · {netCash > 0 ? <>they add <b style={{ color: 'var(--green)' }}>${netCash.toFixed(2)}</b></> : netCash < 0 ? <>you add ${(-netCash).toFixed(2)}</> : 'no cash moves'}</div>
      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 6, background: 'var(--panel-border, #2a2a35)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', background: color }} />
        </div>
        <b style={{ color, fontSize: 12 }}>{pct}%</b>
      </div>
      <div className="faint small" style={{ marginTop: 4 }}>
        {variant === 'counter' ? (
          landed >= 0.9 ? (
            <>Accepting lands you at <b style={{ color }}>{pct}%</b> of your card's market value — counters are capped so you never dip below ~90%.</>
          ) : (
            <>Accepting lands you at <b style={{ color }}>{pct}%</b> of your card's market value — that's below the ~90% fairness cap, so this trader is squeezing you.</>
          )
        ) : landed > 1.05 ? (
          <>They're offering <b style={{ color }}>{pct}%</b> of your card's market value — they want this card badly. Take the money.</>
        ) : landed >= 0.9 ? (
          <>A fair opening number — <b style={{ color }}>{pct}%</b> of your card's market value across cards and cash.</>
        ) : (
          <>A lowball at <b style={{ color }}>{pct}%</b> of your card's market value — traders open cheap hoping you don't check the math. No guarantee here; counter by proposing your card back to them.</>
        )}
      </div>
    </div>
  )
}

function OfferDelta({ total, anchor }: { total: number; anchor: number }) {
  if (anchor <= 0) return null
  const delta = total / anchor - 1
  const label = delta > 0.1 ? 'OVERPAY' : delta > -0.1 ? 'FAIR' : 'LOWBALL'
  // Trade semantics, not price semantics: an OVERPAY is a windfall for you
  // (green), a LOWBALL shortchanges you (red) — so both map opposite to the
  // app's price-oriented below/above palette.
  const cls = delta > 0.1 ? 'below' : delta > -0.1 ? 'at' : 'above'
  return (
    <span className={`badge ${cls}`} style={{ fontSize: 10, padding: '2px 8px' }}>
      {label} {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(0)}%
    </span>
  )
}

/**
 * Live haggle slider on any pending thread. On counters it's clamped at the
 * bottom by the fairness floor (the 90%-of-fair guarantee the ⚖ block
 * explains — dragging below it is impossible). On incoming offers it starts
 * at the current sweetener and asks for more — the trader's patience decides
 * concede or walk. The patience ceiling is deliberately NOT shown: push and
 * find out.
 */
function HaggleBar({ offer, onChanged }: { offer: TradeOfferRow; onChanged: () => void }) {
  const { toast, refreshState } = useStore()
  const h = offer.haggle
  const [val, setVal] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => setVal(null), [h?.current])
  if (!h) return null
  const v = Math.round((val ?? h.current) * 100) / 100
  const floor = h.min
  const ceil = Math.max(h.current + 12, floor + 15)
  const lineup = offer.their_cards.reduce((a, c) => a + c.value, 0)
  const yourV = offer.your_items.reduce((a, i) => a + i.value, 0)
  const pct = yourV > 0 ? Math.round(((lineup + v) / yourV) * 100) : 100
  const showFloorPct = !h.incoming
  const pctFloor = yourV > 0 ? Math.round(((lineup + floor) / yourV) * 100) : 100
  const color = pct >= 90 ? 'var(--green)' : pct >= 80 ? 'var(--yellow)' : 'var(--red)'
  const go = async () => {
    setBusy(true)
    try {
      const res = await api.tradeHaggle(offer.id, v)
      if (res.result === 'accepted') {
        toast('Haggle accepted — deal done', 'good')
        refreshState()
        onChanged()
      } else if (res.result === 'countered') {
        setMsg(res.reply ?? null)
        toast('They came back with another number', 'good')
        onChanged()
      } else if (res.result === 'walked') {
        toast('They walked — thread closed', 'bad')
        onChanged()
      } else if (res.error) toast(res.error, 'bad')
    } finally {
      setBusy(false)
    }
  }
  // One-time negotiation tutorial: server flips `haggledOnce` on the first
  // real haggle attempt, so this block shows until the mechanics have been
  // exercised once (any outcome — even a walk teaches the lesson).
  const showTutorial = useStore((s) => s.state ? !s.state.haggledOnce : false)
  return (
    <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--panel2)', borderRadius: 6, border: '1px solid var(--border-soft)' }}>
      {showTutorial && (
        <div className="faint small" style={{ marginBottom: 8, lineHeight: 1.5 }}>
          <b style={{ color: 'var(--gold)' }}>🤝 First time haggling?</b> Drag to name your cash number — <b style={{ color: 'var(--green)' }}>green</b> means they pay you, red means you add.
          Every trader has their own patience: a polite ask gets a counter-offer back (<i>"Best I can do is…"</i>),
          but push too hard and they'll <b>walk away for good</b>, taking the deal with them — and word gets around.
          {showFloorPct && <> The slider's bottom stop is a hard fairness floor: the game never lets a counter dip below <b>90%</b> of your card's worth.</>}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="small" style={{ whiteSpace: 'nowrap' }}>🤝 Haggle cash</span>
        <input
          type="range"
          min={floor}
          max={ceil}
          step={0.05}
          value={v}
          disabled={busy}
          onChange={(e) => setVal(Number(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--yellow)' }}
        />
        <b className="small" style={{ whiteSpace: 'nowrap', minWidth: 128, textAlign: 'right' }}>
          {v > 0 ? <>they pay <b style={{ color: 'var(--green)' }}>{fmtUsd(v)}</b></> : v < 0 ? <>you add {fmtUsd(-v)}</> : 'no cash'}
        </b>
      </div>
      <div className="faint small" style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span>
          Lands at <b style={{ color }}>{pct}%</b> of your card's worth
          {showFloorPct && <> · fairness floor {pctFloor}%</>}
        </span>
        <button className="primary small" disabled={busy || v === h.current} onClick={go}>
          {busy ? '…' : h.incoming ? `Ask for ${fmtUsd(v)}` : v > 0 ? `Ask ${fmtUsd(v)}` : v < 0 ? `Ask to add ${fmtUsd(-v)}` : 'Accept as-is'}
        </button>
      </div>
      {msg && <div className="small" style={{ marginTop: 6, fontStyle: 'italic' }}>{msg}</div>}
    </div>
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
        const isCounter = o.direction === 'outgoing'
        const netCash = o.your_cash - o.their_cash // counters: what cash moves TO you (>0) or from you (<0)
        // Incoming offers store their_cash as the sweetener PAID TO YOU
        // (your_cash is always 0), so netCash would read negative there — the
        // sign convention differs by direction. Normalize to what actually
        // moves and in which direction:
        const cashToYou = isCounter ? netCash : o.their_cash
        const cashFromYou = isCounter ? -netCash : 0
        // Value you receive: their cards plus cash in your favor. On counters
        // the stored their_cash is the ask (money you'd owe), so use net cash —
        // otherwise a positive ask would inflate the apparent value.
        const theirTotal = o.their_cards.reduce((a, c) => a + c.value, 0) + cashToYou
        const yourValue = o.your_items.reduce((a, i) => a + i.value, 0)
        return (
          <div key={o.id} style={{ borderTop: '1px solid var(--border-soft)', padding: '12px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>{o.avatar}</span>
              <b className="small">{o.trader_name}</b>
              <span className="faint small">{o.handle}</span>
              {isCounter ? (
                o.their_cash > 0 ? (
                  <span className="badge warn" style={{ fontSize: 10, padding: '2px 8px' }}>counter — they want {fmtUsd(o.their_cash)} on top</span>
                ) : (
                  <span className="badge live" style={{ fontSize: 10, padding: '2px 8px' }}>counter — they'll throw in {fmtUsd(-o.their_cash)}</span>
                )
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
                {cashToYou > 0 && <div className="small" style={{ color: 'var(--green)' }}>+ {fmtUsd(cashToYou)} cash</div>}
              </div>
              <div className="trade-arrow">⇄</div>
              <div>
                <div className="nav-section" style={{ padding: 0, marginBottom: 6 }}>You give</div>
                {o.your_items.map((i) => (
                  <div key={i.inventoryId}><CardChip name={i.name} image={i.image} value={i.value} condition={i.condition} /></div>
                ))}
                {cashFromYou > 0 && <div className="small" style={{ color: 'var(--red)', marginTop: 4 }}>+ {fmtUsd(cashFromYou)} cash</div>}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                <OfferDelta total={theirTotal} anchor={yourValue} />
                <div className="faint small">{fmtUsd(theirTotal)} vs {fmtUsd(yourValue)}</div>
                {!replies[o.id] && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {isCounter ? (
                      <>
                        <button className="primary small" disabled={busy === o.id} onClick={() => act(o.id, () => api.tradeAcceptCounter(o.id), 'Counter accepted — deal done')}>
                          {netCash < 0 ? `Accept & pay ${fmtUsd(-netCash)}` : netCash > 0 ? `Accept & take ${fmtUsd(netCash)}` : 'Accept'}
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
            <CounterFairness lineupValue={o.their_cards.reduce((a, c) => a + c.value, 0)} yourValue={o.your_items.reduce((a, i) => a + i.value, 0)} netCash={cashToYou} variant={isCounter ? 'counter' : 'incoming'} />
            <HaggleBar offer={o} onChanged={onChanged} />
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
            {t.trade_count > 0 && (
              <div className="small" style={{ marginTop: 2 }}>
                Lifetime: <EvCell v={t.ev_net} />
                {t.guarding && <span className="badge above" style={{ fontSize: 9, padding: '1px 6px', marginLeft: 6 }}>🔒 guarding binder</span>}
                {t.generous && <span className="badge live" style={{ fontSize: 9, padding: '1px 6px', marginLeft: 6 }}>🤝 back of the binder</span>}
              </div>
            )}
            </div>
            <div className="small" style={{ color: 'var(--gold)' }}>{fmtUsd(t.cash)}</div>
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
                  {trader.stance === 'Neutral' && trader.trade_count === 0
                    ? 'No history yet — trades build trust, walk-aways sour it.'
                    : `${trader.stance} · reputation ${trader.reputation > 0 ? '+' : ''}${trader.reputation.toFixed(1)} — ${REP_SUMMARY[trader.stance] ?? ''}`}
                  {trader.walked_away > 0 ? ` · turned you away ${trader.walked_away}× lately` : ''}
                </div>
                {trader.guarding && (
                  <div className="small" style={{ marginTop: 2, color: 'var(--gold)' }}>
                    🔒 You're way up on them lifetime — they've wised up and keep their best cards in the binder. Trade fair (take a fair price, not a fleecing) to open it back up.
                  </div>
                )}
                {trader.generous && (
                  <div className="small" style={{ marginTop: 2, color: 'var(--green)' }}>
                    🤝 You've had the rough end against them — they're courting your business: their best cards surface in trades, and they sweeten lineups more often.
                  </div>
                )}
                {(trader.trade_count > 0 || trader.offer_accept_rate !== null) && (
                  <div className="small" style={{ marginTop: 2 }}>
                    Lifetime vs you: <EvCell v={trader.ev_net} per={trader.avg_ev} />{trader.offer_accept_rate !== null && <> · took {trader.offer_accept_rate}% of their offers</>}
                  </div>
                )}
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
  const lifetime = useMemo(
    () => traders.filter((t) => t.trade_count > 0 || t.ev_net !== 0 || t.offer_accept_rate !== null).sort((a, b) => b.ev_net - a.ev_net),
    [traders],
  )

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

      {lifetime.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h2 style={{ marginBottom: 4 }}>📊 Trader report card</h2>
          <div className="faint small" style={{ marginBottom: 10 }}>
            Lifetime value won or lost against each trader — positive means their offers (and haggles) have favored you. "Took" is how often you accepted what they put on the table.
          </div>
          <table className="table">
            <thead>
              <tr><th>Trader</th><th>Trades</th><th>Lifetime EV</th><th>Avg / trade</th><th>Took their offers</th></tr>
            </thead>
            <tbody>
              {lifetime.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span style={{ marginRight: 6 }}>{t.avatar}</span><b className="small">{t.name}</b>
                    <span className="faint small" style={{ marginLeft: 6 }}>{ARCH_LABEL[t.archetype] ?? t.archetype}</span>
                  </td>
                  <td className="num">{t.trade_count}</td>
                  <td><EvCell v={t.ev_net} /></td>
                  <td><EvCell v={t.avg_ev} /></td>
                  <td className="num">{t.offer_accept_rate !== null ? `${t.offer_accept_rate}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
