import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { TradeOfferRow, TradeReply, TraderRow } from '../api'
import { useStore } from '../store'
import { CardImg, fmtUsd } from '../components'

// ---------------------------------------------------------------------------
// Trading Post — negotiate with collectors.
//
// Three jobs, three modes: the offers on the table (incoming approaches and
// counters to your proposals), the traders you can walk up to, and the ledger
// of how you've done against each of them.
//
// The old screen stacked all three as one column and rendered the ledger as a
// five-column table (Trader · Trades · Lifetime EV · Avg / trade · Took their
// offers) that simply ran off the right edge — the "Avg / trade" column was
// clipped mid-number. The haggling slider also shared a line with its two
// labels, which at this width squeezed the track to nothing. Rows and a mode
// bar fix both without touching the negotiation maths.
// ---------------------------------------------------------------------------

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

function CardChip({ cardId, name, image, value, condition }: { cardId?: string; name: string; image: string | null; value: number; condition?: string }) {
  return (
    <div className="offer-card-chip">
      <CardImg src={image} alt={name} cardId={cardId} className="offer-chip-art" />
      <div style={{ minWidth: 0 }}>
        <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
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
        <div style={{ flex: 1, height: 6, background: 'var(--track, #2a2a35)', borderRadius: 3, overflow: 'hidden' }}>
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
  const showTutorial = useStore((s) => (s.state ? !s.state.haggledOnce : false))
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
  return (
    <div className="haggle">
      {showTutorial && (
        <div className="faint small" style={{ marginBottom: 8, lineHeight: 1.5 }}>
          <b style={{ color: 'var(--gold)' }}>🤝 First time haggling?</b> Drag to name your cash number — <b style={{ color: 'var(--green)' }}>green</b> means they pay you, red means you add.
          Every trader has their own patience: a polite ask gets a counter-offer back (<i>"Best I can do is…"</i>),
          but push too hard and they'll <b>walk away for good</b>, taking the deal with them — and word gets around.
          {showFloorPct && <> The slider's bottom stop is a hard fairness floor: the game never lets a counter dip below <b>90%</b> of your card's worth.</>}
        </div>
      )}
      {/* Label and number on one line, track on its own — sharing a row squeezed
          the slider to nothing at this width. */}
      <div className="haggle-row">
        <span className="small">🤝 Haggle cash</span>
        <b className="small">
          {v > 0 ? <>they pay <span style={{ color: 'var(--green)' }}>{fmtUsd(v)}</span></> : v < 0 ? <>you add {fmtUsd(-v)}</> : 'no cash'}
        </b>
      </div>
      <input
        type="range"
        className="haggle-slider"
        min={floor}
        max={ceil}
        step={0.05}
        value={v}
        disabled={busy}
        onChange={(e) => setVal(Number(e.target.value))}
      />
      <div className="haggle-foot">
        <span className="faint small">
          Lands at <b style={{ color }}>{pct}%</b> of your card's worth
          {showFloorPct && <> · floor {pctFloor}%</>}
        </span>
        <button className="primary small" disabled={busy || v === h.current} onClick={go}>
          {/* Zero on an incoming offer used to print "Ask for $0.00" — with no
              number named, the button is simply taking their offer. */}
          {busy ? '…'
            : h.incoming
              ? (v > 0 ? `Ask for ${fmtUsd(v)}` : v < 0 ? `Ask to add ${fmtUsd(-v)}` : 'Take their offer')
              : (v > 0 ? `Ask ${fmtUsd(v)}` : v < 0 ? `Ask to add ${fmtUsd(-v)}` : 'Accept as-is')}
        </button>
      </div>
      {msg && <div className="small" style={{ marginTop: 6, fontStyle: 'italic' }}>{msg}</div>}
    </div>
  )
}

/** One offer on the table — both sides stacked, because a two-column swap bar
 *  at this width turns into two half-width stubs. */
function OfferCard({ o, onChanged }: { o: TradeOfferRow; onChanged: () => void }) {
  const { toast, refreshState } = useStore()
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<string | null>(null)

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
  const theirCards = o.their_cards.reduce((a, c) => a + c.value, 0)
  const theirTotal = theirCards + cashToYou
  const yourValue = o.your_items.reduce((a, i) => a + i.value, 0)

  const act = async (fn: () => Promise<{ ok: boolean; reply?: string; error?: string; improved?: boolean; bump?: number }>, what: string) => {
    setBusy(true)
    try {
      const res = await fn()
      if (res.reply) setReply(res.reply)
      if (res.ok) {
        toast(what, 'good')
        onChanged()
        refreshState()
      } else if (res.error) {
        toast(res.error, 'bad')
        onChanged()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={`offer${isCounter ? ' is-counter' : ''}`}>
      <header className="offer-head">
        <span className="offer-avatar">{o.avatar}</span>
        <div className="offer-who">
          <b className="small">{o.trader_name}</b>
          <div className="faint small">{o.handle}</div>
        </div>
        {isCounter ? (
          o.their_cash > 0
            ? <span className="badge warn" style={{ fontSize: 10, padding: '2px 8px' }}>counter — wants {fmtUsd(o.their_cash)}</span>
            : <span className="badge live" style={{ fontSize: 10, padding: '2px 8px' }}>counter — adds {fmtUsd(-o.their_cash)}</span>
        ) : (
          o.rounds > 0 && <span className="badge" style={{ fontSize: 10, padding: '2px 8px' }}>improved ×{o.rounds}</span>
        )}
      </header>

      <div className="offer-side">
        <div className="offer-side-label">They give</div>
        {o.their_cards.map((c) => (
          <CardChip key={c.cardId} cardId={c.cardId} name={c.name} image={c.image} value={c.value} condition={c.condition} />
        ))}
        {cashToYou > 0 && <div className="small" style={{ color: 'var(--green)' }}>+ {fmtUsd(cashToYou)} cash</div>}
      </div>

      <div className="offer-side">
        <div className="offer-side-label">You give</div>
        {o.your_items.map((i) => (
          <CardChip key={i.inventoryId} cardId={i.cardId} name={i.name} image={i.image} value={i.value} condition={i.condition} />
        ))}
        {cashFromYou > 0 && <div className="small" style={{ color: 'var(--red)' }}>+ {fmtUsd(cashFromYou)} cash</div>}
      </div>

      <div className="offer-total">
        <OfferDelta total={theirTotal} anchor={yourValue} />
        <span className="faint small">{fmtUsd(theirTotal)} vs {fmtUsd(yourValue)}</span>
      </div>

      {!reply && (
        <div className="offer-actions">
          {isCounter ? (
            <>
              <button className="primary small" disabled={busy} onClick={() => act(() => api.tradeAcceptCounter(o.id), 'Counter accepted — deal done')}>
                {netCash < 0 ? `Accept & pay ${fmtUsd(-netCash)}` : netCash > 0 ? `Accept & take ${fmtUsd(netCash)}` : 'Accept'}
              </button>
              <button className="small" disabled={busy} onClick={() => act(() => api.tradeDeclineCounter(o.id), 'Walked away')}>Walk away</button>
            </>
          ) : (
            <>
              <button className="primary small" disabled={busy} onClick={() => act(() => api.tradeAcceptIncoming(o.id), 'Trade accepted')}>Accept</button>
              <button className="small" disabled={busy} onClick={() => act(() => api.tradeRejectIncoming(o.id), 'Offer rejected')}>Reject</button>
            </>
          )}
        </div>
      )}

      <CounterFairness lineupValue={theirCards} yourValue={yourValue} netCash={cashToYou} variant={isCounter ? 'counter' : 'incoming'} />
      <HaggleBar offer={o} onChanged={onChanged} />
      <div className="faint small" style={{ marginTop: 8, fontStyle: 'italic' }}>{o.message}</div>
      {reply && <div className="trade-bubble" style={{ marginTop: 8 }}>{reply}</div>}
    </article>
  )
}

function TradersPanel({ traders, onChanged }: { traders: TraderRow[]; onChanged: () => void }) {
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
    <>
      <div className="panel">
        <div className="home-sec-head">
          <b className="small">🤝 The traders</b>
          <span className="faint small">{traders.length} regulars</span>
        </div>
        <div className="home-mini" style={{ marginBottom: 8 }}>Every trader values your cards through their own obsession.</div>
        <div className="pf-rows">
          {traders.map((t) => (
            <div
              key={t.id}
              className={`trade-trader${traderId === t.id ? ' sel' : ''}`}
              onClick={() => { setTraderId(t.id); setReply(null) }}
            >
              <span style={{ fontSize: 20, flex: 'none' }}>{t.avatar}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <b className="small">{t.name}</b>
                  <StanceChip stance={t.stance} rep={t.reputation} />
                </div>
                <div className="faint small">
                  {ARCH_LABEL[t.archetype] ?? t.archetype} · {t.card_count} cards · {t.trade_count} trades
                  {t.trade_count > 0 && <> · <EvCell v={t.ev_net} /></>}
                </div>
                {(t.guarding || t.generous) && (
                  <div className="row" style={{ gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                    {t.guarding && <span className="badge above" style={{ fontSize: 9, padding: '1px 6px' }}>🔒 guarding binder</span>}
                    {t.generous && <span className="badge live" style={{ fontSize: 9, padding: '1px 6px' }}>🤝 back of the binder</span>}
                  </div>
                )}
              </div>
              <div className="small" style={{ color: 'var(--gold)', flex: 'none' }}>{fmtUsd(t.cash)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel mt14">
        {!trader ? (
          <div className="home-mini">Pick a trader above to open negotiations.</div>
        ) : (
          <>
            <div className="row" style={{ gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{ fontSize: 24, flex: 'none' }}>{trader.avatar}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <b>{trader.name}</b>
                  <span className="faint small">{trader.handle}</span>
                  <StanceChip stance={trader.stance} rep={trader.reputation} />
                </div>
                <div className="faint small">{ARCH_LABEL[trader.archetype] ?? trader.archetype} — {trader.blurb}</div>
                <div className="faint small" style={{ marginTop: 2 }}>
                  {trader.stance === 'Neutral' && trader.trade_count === 0
                    ? 'No history yet — trades build trust, walk-aways sour it.'
                    : `${trader.stance} · reputation ${trader.reputation > 0 ? '+' : ''}${trader.reputation.toFixed(1)} — ${REP_SUMMARY[trader.stance] ?? ''}`}
                  {trader.walked_away > 0 ? ` · turned you away ${trader.walked_away}× lately` : ''}
                </div>
                {trader.guarding && (
                  <div className="small" style={{ marginTop: 2, color: 'var(--gold)' }}>
                    🔒 You're way up on them lifetime — they keep their best cards in the binder. Trade fair to open it back up.
                  </div>
                )}
                {trader.generous && (
                  <div className="small" style={{ marginTop: 2, color: 'var(--green)' }}>
                    🤝 You've had the rough end against them — they're courting your business: best cards surface, lineups get sweeter.
                  </div>
                )}
                {(trader.trade_count > 0 || trader.offer_accept_rate !== null) && (
                  <div className="small" style={{ marginTop: 3 }}>
                    Lifetime vs you: <EvCell v={trader.ev_net} per={trader.avg_ev} />
                    {trader.offer_accept_rate !== null && <span className="faint small"> · took {trader.offer_accept_rate}% of their offers</span>}
                  </div>
                )}
              </div>
            </div>

            <div className="offer-side-label">Their binder ({trader.cards.length})</div>
            <div className="trade-cards">
              {trader.cards.map((c) => (
                <div key={c.id} className="trade-card" onClick={() => openCard(c.card_id)}>
                  <CardImg src={c.image_small} alt={c.name} cardId={c.card_id} />
                  <div className="small" style={{ padding: '4px 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                  <div className="faint small" style={{ padding: '0 6px 6px' }}>{c.condition} · {fmtUsd(c.value)}</div>
                </div>
              ))}
            </div>

            <div className="offer-side-label" style={{ marginTop: 12 }}>Your offer</div>
            <div className="trade-propose">
              <select value={inventoryId} onChange={(e) => setInventoryId(e.target.value ? Number(e.target.value) : '')}>
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
                style={{ width: 92 }}
              />
              <button className="primary" disabled={!inventoryId || busy} onClick={propose}>
                {busy ? 'Negotiating…' : 'Propose trade'}
              </button>
            </div>
            {selected && (
              <div className="faint small" style={{ marginTop: 6 }}>
                Offering {selected.name} (market {fmtUsd(selected.value)}){Number(cash) > 0 ? ` + ${fmtUsd(Number(cash))} cash` : ''}
              </div>
            )}

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
    </>
  )
}

export function TradeView() {
  const [traders, setTraders] = useState<TraderRow[]>([])
  const [offers, setOffers] = useState<TradeOfferRow[]>([])
  const [history, setHistory] = useState<{ id: number; message: string; created_at: string }[]>([])
  const [tab, setTab] = useState<'offers' | 'traders' | 'ledger'>('offers')
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
  const netEv = lifetime.reduce((a, t) => a + t.ev_net, 0)

  return (
    <div>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>Trading Post</h1>
          <div className="sub">Negotiate with collectors — real prices, personal obsessions.</div>
        </div>
      </div>

      <div className="pf-stats" style={{ marginBottom: 12 }}>
        <div className="pf-stat">
          <div className="lbl">Trades done</div>
          <div className="val">{totalTrades}</div>
          <div className="note">{traders.length} traders in town</div>
        </div>
        <div className="pf-stat">
          <div className="lbl">On the table</div>
          <div className="val">{offers.length}</div>
          <div className="note">{offers.length === 0 ? 'nothing waiting' : 'offers expire'}</div>
        </div>
        <div className="pf-stat">
          <div className="lbl">Lifetime vs them</div>
          <div className="val" style={{ color: netEv > 0.5 ? 'var(--green)' : netEv < -0.5 ? 'var(--red)' : undefined }}>{fmtUsd(netEv)}</div>
          <div className="note">{lifetime.length} with history</div>
        </div>
        <div className="pf-stat">
          <div className="lbl">Cash</div>
          <div className="val">{fmtUsd(state?.cash)}</div>
          <div className="note">yours to sweeten offers</div>
        </div>
      </div>

      <div className="seg-bar" role="tablist" aria-label="Trading post modes">
        <button role="tab" aria-selected={tab === 'offers'} className={`seg-item${tab === 'offers' ? ' on' : ''}`}
          title="Offers on the table — incoming approaches and counters" onClick={() => setTab('offers')}>
          📥 Offers<span className="seg-count">{offers.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'traders'} className={`seg-item${tab === 'traders' ? ' on' : ''}`}
          title="Walk up to a trader and open negotiations" onClick={() => setTab('traders')}>
          🤝 Traders<span className="seg-count">{traders.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'ledger'} className={`seg-item${tab === 'ledger' ? ' on' : ''}`}
          title="How you've done against each trader, and the trade log" onClick={() => setTab('ledger')}>
          📊 Ledger
        </button>
      </div>

      {tab === 'offers' && (
        <div className="panel">
          <div className="home-sec-head">
            <b className="small">📥 On the table</b>
            <span className="faint small">answered offers disappear</span>
          </div>
          {offers.length === 0 ? (
            <div className="home-mini">
              No offers right now. Traders approach when you're active — or open negotiations yourself from the Traders tab.
            </div>
          ) : (
            <div className="offer-list">
              {offers.map((o) => <OfferCard key={o.id} o={o} onChanged={load} />)}
            </div>
          )}
        </div>
      )}

      {tab === 'traders' && <TradersPanel traders={traders} onChanged={load} />}

      {tab === 'ledger' && (
        <>
          <div className="panel">
            <div className="home-sec-head">
              <b className="small">📊 Trader report card</b>
              <span className="faint small">{lifetime.length} with history</span>
            </div>
            <div className="home-mini" style={{ marginBottom: 8 }}>
              Lifetime value won or lost against each trader — positive means their offers and haggles have favoured you.
              "Took" is how often you accepted what they put on the table.
            </div>
            {lifetime.length === 0 ? (
              <div className="home-mini">No history yet. Your first trade writes this card.</div>
            ) : (
              <div className="pf-rows">
                {lifetime.map((t) => (
                  <div key={t.id} className="pf-row">
                    <div className="pf-row-main">
                      <b className="pf-row-name">{t.avatar} {t.name}</b>
                      <div className="faint small">
                        {ARCH_LABEL[t.archetype] ?? t.archetype} · {t.trade_count} trade{t.trade_count === 1 ? '' : 's'}
                        {t.offer_accept_rate !== null ? ` · took ${t.offer_accept_rate}% of theirs` : ''}
                      </div>
                    </div>
                    <div className="pf-row-nums">
                      <EvCell v={t.ev_net} />
                      <div className="faint small">avg <EvCell v={t.avg_ev} /></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel mt14">
            <div className="home-sec-head">
              <b className="small">📜 Trade log</b>
              <span className="faint small">{history.length} entries</span>
            </div>
            {history.length === 0 ? (
              <div className="home-mini">Nothing logged yet.</div>
            ) : (
              <div className="stack">
                {history.slice(0, 20).map((h) => (
                  <div key={h.id} className="faint small" style={{ padding: '4px 0', borderBottom: '1px solid var(--border-soft)' }}>
                    {h.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="faint small mt14">
        Card values anchor to real TCGplayer / PriceCharting / eBay data; each trader's opinion of them is their own.
      </div>
    </div>
  )
}
