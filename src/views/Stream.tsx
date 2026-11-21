import { useEffect, useRef, useState } from 'react'
import {
  api,
  type StreamProduct,
  type BreakRipResult,
  type BreakStatus,
  type StreamChannel,
  type StreamChat,
  type StreamEndResult,
  type StreamRipResult,
} from '../api'
import { useStore } from '../store'
import { CardImg, EmptyState, fmtUsd, LoadFailure, TipList } from '../components'

// ---------------------------------------------------------------------------
// Streaming room — go live, rip real packs, chat reacts, donations land.
// Case breaks: sell team spots on the stream; pulls go to spot-holders.
// ---------------------------------------------------------------------------

const SPOT_MIN = 4
const SPOT_MAX = 16

export function StreamView() {
  const { toast, refreshState, openCard } = useStore()
  const [channel, setChannel] = useState<StreamChannel | null>(null)
  const [products, setProducts] = useState<StreamProduct[]>([])
  const [selProduct, setSelProduct] = useState('')
  const [packs, setPacks] = useState(6)
  const [busy, setBusy] = useState(false)
  const [chat, setChat] = useState<StreamChat[]>([])
  const [lastRip, setLastRip] = useState<StreamRipResult | null>(null)
  const [viewers, setViewers] = useState(0)
  const [summary, setSummary] = useState<StreamEndResult | null>(null)
  const [breakState, setBreakState] = useState<BreakStatus>(null)
  const [lastBreakRip, setLastBreakRip] = useState<BreakRipResult | null>(null)
  const [spotsInput, setSpotsInput] = useState(8)
  const [priceInput, setPriceInput] = useState('')
  // A dead channel fetch used to render a go-live panel with an empty product
  // list — it read as "you own nothing", not "the server is down".
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const loadChannel = () =>
    api.streamChannel()
      .then((c) => { setChannel(c); setStatus('ready') })
      .catch(() => setStatus((s) => (s === 'ready' ? s : 'error')))
  const loadBreak = () => api.breakStatus().then(setBreakState).catch(() => {})
  useEffect(() => {
    loadChannel()
    loadBreak()
    api.streamProducts().then((ps) => {
      setProducts(ps)
      if (ps.length > 0) setSelProduct((s) => s || ps[0].id)
    }).catch(() => {})
  }, [])

  // Going back online after an ended stream resets the local scene.
  useEffect(() => {
    if (channel && !channel.live) {
      setChat([])
      setLastRip(null)
      setLastBreakRip(null)
      loadBreak()
    } else if (channel?.live) {
      setViewers(channel.live.viewers)
      loadBreak()
    }
  }, [channel?.live?.id])

  const goLive = async () => {
    if (!selProduct) return
    setBusy(true)
    try {
      const res = await api.streamGoLive(selProduct, packs)
      if (res.ok) {
        toast(breakState && breakState.status === 'selling' && !breakState.live ? 'You are LIVE — break spots are on sale' : 'You are LIVE — chat is rolling in', 'good')
        refreshState()
        loadChannel()
        loadBreak()
      } else {
        toast(res.error ?? 'Could not go live', 'bad')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not go live', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const createBreak = async () => {
    if (!selProduct) return
    setBusy(true)
    try {
      const res = await api.breakCreate(selProduct, spotsInput, priceInput ? Number(priceInput) : null)
      if (res.ok) {
        toast(`Break listed — ${res.spotsTotal} spots at ${fmtUsd(res.spotPrice ?? 0)}`, 'good')
        setPriceInput('')
        refreshState()
        loadBreak()
      } else {
        toast(res.error ?? 'Could not open the break', 'bad')
      }
    } finally {
      setBusy(false)
    }
  }

  const cancelBreak = async () => {
    if (!breakState) return
    setBusy(true)
    try {
      const res = await api.breakCancel(breakState.id)
      if (res.ok) {
        toast('Break cancelled — product refunded', 'good')
        refreshState()
        loadBreak()
      } else {
        toast(res.error ?? 'Could not cancel', 'bad')
      }
    } finally {
      setBusy(false)
    }
  }

  const sellSpot = async (team: string) => {
    if (!breakState) return
    setBusy(true)
    try {
      const res = await api.breakBuy(breakState.id, team)
      if (res.ok) {
        if (res.chat) setChat((c) => [...c, { at: Date.now(), ...res.chat! }].slice(-80))
        refreshState()
        loadBreak()
      } else {
        toast(res.error ?? 'Spot sale failed', 'bad')
      }
    } finally {
      setBusy(false)
    }
  }

  const ripBreak = async () => {
    setBusy(true)
    try {
      const res = await api.breakRip()
      if (res.ok) {
        setLastBreakRip(res)
        if (res.viewers != null) setViewers(res.viewers)
        if (res.chat) setChat((c) => [...c, ...res.chat!].slice(-80))
        loadChannel()
        loadBreak()
      } else {
        toast(res.error ?? 'Break rip failed', 'bad')
      }
    } finally {
      setBusy(false)
    }
  }

  const rip = async () => {
    setBusy(true)
    try {
      const res = await api.streamRip()
      if (res.ok) {
        setLastRip(res)
        if (res.viewers != null) setViewers(res.viewers)
        if (res.chat) setChat((c) => [...c, ...res.chat!].slice(-80))
        loadChannel()
      } else {
        toast(res.error ?? 'Rip failed', 'bad')
      }
    } finally {
      setBusy(false)
    }
  }

  const end = async () => {
    setBusy(true)
    try {
      const res = await api.streamEnd()
      if (res.ok) {
        setSummary(res)
        refreshState()
        loadChannel()
        loadBreak()
      } else {
        toast(res.error ?? 'Could not end stream', 'bad')
      }
    } finally {
      setBusy(false)
    }
  }

  const acceptOffer = async (id: number) => {
    setBusy(true)
    try {
      const res = await api.sponsorAccept(id)
      if (res.ok) {
        toast('Deal signed — open the required packs on stream to get paid', 'good')
        loadChannel()
      } else {
        toast(res.error ?? 'Could not sign', 'bad')
      }
    } finally {
      setBusy(false)
    }
  }

  const declineOffer = async (id: number) => {
    setBusy(true)
    try {
      await api.sponsorDecline(id)
      loadChannel()
    } finally {
      setBusy(false)
    }
  }

  if (!channel) return <div className="empty"><span className="spinner" /> Loading channel…</div>

  if (summary) {
    return (
      <div>
        <StreamHead />
        <div className="panel mt14" style={{ textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 34 }}>📡</div>
          <h2 style={{ margin: '6px 0' }}>Stream ended</h2>
          <div className="row" style={{ justifyContent: 'center', gap: 26, flexWrap: 'wrap', marginTop: 8 }}>
            <div><div className="faint small">PACKS OPENED</div><b>{summary.packs}</b></div>
            <div><div className="faint small">PEAK VIEWERS</div><b>{summary.peakViewers}</b></div>
            <div><div className="faint small">TIPS</div><b style={{ color: 'var(--green)' }}>{fmtUsd(summary.donationsTotal ?? 0)}</b></div>
            <div><div className="faint small">NEW FOLLOWERS</div><b style={{ color: 'var(--green)' }}>+{summary.followersGain}</b></div>
          </div>
          {summary.best && summary.best.value > 0 && (
            <div className="mt8">Best pull: <b>{summary.best.name}</b> — {fmtUsd(summary.best.value)}</div>
          )}
          {summary.sponsor && (
            <div className="stream-donation mt8" style={{ display: 'inline-block' }}>
              💼 <b>{summary.sponsor.brand}</b> — {summary.sponsor.packs} pack{summary.sponsor.packs === 1 ? '' : 's'} delivered · <b>{fmtUsd(summary.sponsor.payout)}</b> paid
              {summary.sponsor.completed
                ? ` · deal complete, +${summary.sponsor.followerBonus} followers`
                : ` · ${summary.sponsor.remaining} to go`}
            </div>
          )}
          {summary.break && (
            <div className="panel mt8" style={{ display: 'inline-block', textAlign: 'left', padding: '10px 16px' }}>
              <b>📦 Break settled</b> — {summary.break.spotsSold}/{summary.break.spotsTotal} spots sold · {fmtUsd(summary.break.gross)} gross − {fmtUsd(summary.break.productCost)} product ={' '}
              <b style={{ color: summary.break.net >= 0 ? 'var(--green)' : 'var(--red)' }}>{summary.break.net >= 0 ? '+' : ''}{fmtUsd(summary.break.net)} net</b>
              {summary.break.houseCards > 0 && <> · house kept {summary.break.houseCards} card{summary.break.houseCards === 1 ? '' : 's'}</>}
              {summary.break.best && (
                <div className="small mt8">
                  Best pull: <b>{summary.break.best.name}</b> ({fmtUsd(summary.break.best.value)})
                  {summary.break.best.holder ? <> → {summary.break.best.holder} ({summary.break.best.team})</> : <> → the house</>}
                </div>
              )}
            </div>
          )}
          <div className="faint small mt8">{summary.followers} followers and counting</div>
          <button className="primary mt14" onClick={() => setSummary(null)}>Back to the channel</button>
        </div>
      </div>
    )
  }

  const live = channel.live
  const liveBreak = breakState && breakState.live && breakState.status === 'selling' ? breakState : null
  if (live && liveBreak) {
    return (
      <div>
        <StreamHead />
        <div className="panel mt14" style={{ borderColor: 'var(--red)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="stream-badge">● LIVE</span>
              <div>
                <b>📦 BREAK · {liveBreak.productName}</b>
                <div className="faint small">
                  {liveBreak.spotsSold}/{liveBreak.spotsTotal} spots sold · {fmtUsd(liveBreak.spotPrice)} each · gross {fmtUsd(liveBreak.gross)}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="stream-viewers">👁 {viewers || live.viewers}</span>
              <span className="faint small">tips {fmtUsd(live.donationsTotal)}</span>
              <button className="primary" disabled={busy || !!lastBreakRip?.streamDone} onClick={ripBreak}>
                {busy ? 'Ripping…' : lastBreakRip?.streamDone ? 'Product done' : `📺 Rip pack ${live.packsOpened + 1}`}
              </button>
              <button disabled={busy} onClick={end}>End stream & settle</button>
            </div>
          </div>
        </div>

        <div className="row mt14" style={{ alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <b className="small">The spots</b>
            <div className="small faint">Sell spots from chat — holders keep every pull from their Pokémon team. Unsold spots are yours: their pulls stay with the house.</div>
            <div className="grid cols3 mt8">
              {liveBreak.spots.map((s) => (
                <div key={s.id} className="panel" style={{ margin: 0, padding: 8 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <b>{s.team}</b>
                    <span className="faint small">{fmtUsd(s.payout)} earned</span>
                  </div>
                  <div className="faint small">{s.holder} · {s.pulls} pull{s.pulls === 1 ? '' : 's'}</div>
                </div>
              ))}
            </div>
            {liveBreak.openTeams.length > 0 && (
              <div className="panel mt8" style={{ padding: 10 }}>
                <b className="small">Sell a spot</b>
                <div className="row mt8" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {liveBreak.openTeams.map((t) => (
                    <button key={t} className="small" disabled={busy} onClick={() => sellSpot(t)}>+ {t}</button>
                  ))}
                </div>
              </div>
            )}
            <b className="small mt14" style={{ display: 'block' }}>Last pack on camera</b>
            {!lastBreakRip ? (
              <EmptyState icon="📦" text="Rip the first pack of the break" sub="Every pull goes to its team's spot — or to the house." />
            ) : (
              <div className="grid cols3 mt8">
                {lastBreakRip.cards?.map((c, i) => (
                  <div key={i} className="panel" style={{ margin: 0, padding: 6, cursor: 'pointer' }} onClick={() => openCard(c.cardId)}>
                    <CardImgById cardId={c.cardId} name={c.name} />
                    <div className="row" style={{ justifyContent: 'space-between', gap: 4 }}>
                      <span className="badge" style={{ fontSize: 9, padding: '1px 5px' }}>{c.spot ?? 'HOUSE'}</span>
                      <span className="faint small">{fmtUsd(c.value)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {lastBreakRip?.ok && lastBreakRip.packBest && (
              <div className="stream-donation mt8">
                🔥 Pack best: <b>{lastBreakRip.packBest.name}</b> ({fmtUsd(lastBreakRip.packBest.value)})
                {lastBreakRip.packBest.holder ? <> → {lastBreakRip.packBest.holder} ({lastBreakRip.packBest.team})</> : <> → house keeps it</>}
              </div>
            )}
            {lastBreakRip?.donations && lastBreakRip.donations.length > 0 && (
              <div className="stream-donation mt8">
                💰 {lastBreakRip.donations.map((d) => `${d.who} tipped ${fmtUsd(d.amount)} — ${d.text}`).join(' · ')}
              </div>
            )}
          </div>
          <div className="battle-chat" style={{ width: 270, flexShrink: 0 }}>
            <b className="small">💬 Break chat</b>
            <ChatBox lines={chat} />
          </div>
        </div>
      </div>
    )
  }
  if (live) {
    return (
      <div>
        <StreamHead />
        <div className="panel mt14" style={{ borderColor: 'var(--red)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="stream-badge">● LIVE</span>
              <div>
                <b>{live.product.name}</b>
                <div className="faint small">
                  Pack {live.packsOpened} of {live.packsPlanned} · best pull {live.best ? `${live.best.name} (${fmtUsd(live.best.value)})` : '— none yet'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="stream-viewers">👁 {viewers || live.viewers}</span>
              <span className="faint small">tips {fmtUsd(live.donationsTotal)}</span>
              {channel.contract && channel.contract.kind === live.product.kind && (
                <span className="stream-sponsor-chip" title={`Sponsor deal: ${fmtUsd(channel.contract.payoutPerPack)} per pack`}>
                  💼 {channel.contract.brand} · {channel.contract.packsDelivered}/{channel.contract.packsRequired} sponsored
                </span>
              )}
              <button className="primary" disabled={busy || !!lastRip?.streamDone} onClick={rip}>
                {busy ? 'Ripping…' : lastRip?.streamDone ? 'Queue empty' : '📺 Rip next pack'}
              </button>
              <button disabled={busy} onClick={end}>End stream</button>
            </div>
          </div>
          {lastRip && lastRip.ok && lastRip.viewerDelta != null && lastRip.viewerDelta !== 0 && (
            <div className="small mt8" style={{ color: lastRip.viewerDelta > 0 ? 'var(--green)' : 'var(--red)' }}>
              {lastRip.sponsored && '💼 '}
              {lastRip.viewerDelta > 0 ? `+${lastRip.viewerDelta}` : lastRip.viewerDelta} viewers after that pack
              {lastRip.sponsored && lastRip.viewerDelta > 0 && ' — sponsor push boosting the room'}
              {lastRip.sponsored && lastRip.viewerDelta < 0 && ' — sponsor promo softening the loss'}
            </div>
          )}
        </div>

        <div className="row mt14" style={{ alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <b className="small">Last pack on camera</b>
            {!lastRip ? (
              <EmptyState icon="🎥" text="Open your first pack on stream" sub="Chat is waiting. Don't fumble the shuffle." />
            ) : (
              <div className="grid cols3 mt8">
                {lastRip.cards?.map((c, i) => (
                  <div key={i} className="panel" style={{ margin: 0, padding: 6, cursor: 'pointer' }} onClick={() => openCard(c.cardId)}>
                    <CardImgById cardId={c.cardId} name={c.name} />
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="badge" style={{ fontSize: 9, padding: '1px 5px' }}>{c.isHit ? 'HIT' : '—'}</span>
                      <span className="faint small">{fmtUsd(c.value)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {lastRip?.donations && lastRip.donations.length > 0 && (
              <div className="stream-donation mt8">
                💰 {lastRip.donations.map((d) => `${d.who} tipped ${fmtUsd(d.amount)} — ${d.text}`).join(' · ')}
              </div>
            )}
          </div>
          <div className="battle-chat" style={{ width: 270, flexShrink: 0 }}>
            <b className="small">💬 Stream chat</b>
            <ChatBox lines={chat} />
          </div>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return <LoadFailure what="your channel" sub="The local server did not answer. You are not live and nothing was sold." onRetry={() => { setStatus('loading'); loadChannel(); loadBreak() }} />
  }
  if (!channel) {
    return <EmptyState icon="📡" text="Opening the stream room…" sub="Reading your channel, your break status and the products you can rip." />
  }

  // Offline — channel hub + go-live setup.
  const product = products.find((p) => p.id === selProduct)
  const price = product ? product.market_price ?? product.msrp : 0
  const cost = Math.round(price * packs * 100) / 100

  return (
    <div>
      <StreamHead />
      <div className="kpi-row mt14" style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <div><div className="faint small">FOLLOWERS</div><b>{channel.followers}</b></div>
        <div><div className="faint small">STREAMS</div><b>{channel.totalStreams}</b></div>
        <div><div className="faint small">PACKS RIPPED LIVE</div><b>{channel.totalPacks}</b></div>
        <div><div className="faint small">TIPS EARNED</div><b style={{ color: 'var(--green)' }}>{fmtUsd(channel.totalDonations)}</b></div>
        <div>
          <div className="faint small">CHANNEL BEST PULL</div>
          <b>{channel.bestCardName ? `${channel.bestCardName} · ${fmtUsd(channel.bestCardValue ?? 0)}` : '—'}</b>
        </div>
      </div>

      {breakState && breakState.status === 'selling' && (
        <div className="panel mt14" style={{ borderColor: 'var(--yellow)' }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <b>📦 Break pending — {breakState.productName}</b>
              <div className="small faint">
                {breakState.spotsTotal} spots · go live to put them on sale. Product cost {fmtUsd(breakState.productCost)} is already out of pocket.
              </div>
            </div>
            <button className="small" onClick={cancelBreak}>Cancel break (refund)</button>
          </div>
        </div>
      )}

      <div className="panel mt14">
        <b>Open a case break</b>
        <div className="small faint" style={{ margin: '4px 0 8px' }}>
          <TipList
            items={[
              { icon: '💳', label: 'Buy first', text: <>the product is out of pocket before a spot sells</> },
              { icon: '🎟️', label: `Sell ${SPOT_MIN}–${SPOT_MAX} spots`, text: <>at your price; every pull goes to that Pokémon's holder</> },
              { icon: '📉', label: 'Unsold spots', text: <>mean the house keeps those pulls; a full sellout is pure margin</> },
            ]}
          />
        </div>
        {products.length === 0 ? (
          <EmptyState icon="📦" text="Nothing to break" sub="Seed the pack shop catalog first."
          />
        ) : (
          <div className="row mt8" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={selProduct}
              onChange={(e) => {
                setSelProduct(e.target.value)
                setPriceInput('')
              }}
              style={{ minWidth: 280 }}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {fmtUsd(p.market_price ?? p.msrp)}
                </option>
              ))}
            </select>
            <label className="small">
              spots{' '}
              <input
                type="number"
                min={SPOT_MIN}
                max={SPOT_MAX}
                value={spotsInput}
                onChange={(e) => setSpotsInput(Math.max(SPOT_MIN, Math.min(SPOT_MAX, Number(e.target.value) || SPOT_MIN)))}
                style={{ width: 60 }}
              />
            </label>
            <label className="small" title="Leave blank for the suggested ask: even split + 25% house margin">
              spot price{' '}
              <input
                type="number"
                min={0.25}
                step={0.25}
                placeholder={`auto · ${(() => {
                  const p = products.find((x) => x.id === selProduct)
                  const cost = p ? p.market_price ?? p.msrp : 0
                  return fmtUsd(Math.max(0.5, Math.ceil((cost * 1.25) / Math.max(SPOT_MIN, Math.min(SPOT_MAX, spotsInput)) * 2) / 2))
                })()}`}
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                style={{ width: 90 }}
              />
            </label>
            <button className="primary" disabled={busy || !selProduct} onClick={createBreak}>
              {busy ? 'Listing…' : '📦 Open the break'}
            </button>
            <span className="faint small">out of pocket {fmtUsd((products.find((p) => p.id === selProduct)?.market_price ?? products.find((p) => p.id === selProduct)?.msrp ?? 0))}</span>
          </div>
        )}
      </div>

      <div className="panel mt14">
        <b>Go live</b>
        <div className="small faint">The cards are yours to keep — the stream pays in tips and followers. Cost below is just buying the product.</div>
        {products.length === 0 ? (
          <EmptyState icon="📦" text="No streamable products" sub="Seed the pack shop catalog first." />
        ) : (
          <div className="row mt8" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={selProduct} onChange={(e) => setSelProduct(e.target.value)} style={{ minWidth: 280 }}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {fmtUsd(p.market_price ?? p.msrp)}
                </option>
              ))}
            </select>
            <label className="small">
              packs{' '}
              <input
                type="number"
                min={1}
                max={20}
                value={packs}
                onChange={(e) => setPacks(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                style={{ width: 60 }}
              />
            </label>
            <span className="faint small">cost {fmtUsd(cost)}</span>
            <button className="primary" disabled={busy || !selProduct} onClick={goLive}>
              {busy ? 'Starting…' : breakState && breakState.status === 'selling' ? '🔴 Go live — open the break' : '🔴 Go live'}
            </button>
            {breakState && breakState.status === 'selling' && (
              <span className="faint small">the break rides this stream — packs sets how many rips it gets</span>
            )}
          </div>
        )}
      </div>

      <SponsorSection
        contract={channel.contract ?? null}
        offers={channel.offers ?? []}
        busy={busy}
        onAccept={acceptOffer}
        onDecline={declineOffer}
      />

      <AnalyticsSection followers={channel.followers} />

      <h2 className="mt14">Recent streams</h2>
      <StreamHistory />
    </div>
  )
}

function StreamHead() {
  return (
    <div className="page-head desk">
      <div className="ph-id">
        <span className="ph-mark" aria-hidden>📡</span>
        <div>
          <h1>Stream</h1>
          <div className="sub">Run your own pack-opening stream — real product, real rips, chat that never sleeps.</div>
        </div>
      </div>
    </div>
  )
}

function SponsorSection({
  contract,
  offers,
  busy,
  onAccept,
  onDecline,
}: {
  contract: import('../api').SponsorContract | null
  offers: import('../api').SponsorOffer[]
  busy: boolean
  onAccept: (id: number) => void
  onDecline: (id: number) => void
}) {
  const safeOffers = offers ?? []
  return (
    <div className="mt14">
      {contract && (
        <div className="panel" style={{ borderColor: 'var(--yellow)' }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <b>💼 {contract.brand}</b>
              <div className="small faint">
                Open {contract.packsRequired} {contract.kind} pack{contract.packsRequired === 1 ? '' : 's'} on stream — {fmtUsd(contract.payoutPerPack)} each + {contract.followerBonus} followers on completion
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <b style={{ color: contract.remaining === 0 ? 'var(--green)' : undefined }}>
                {contract.remaining === 0 ? '✅ Delivered — pays at stream end' : `${contract.packsDelivered}/${contract.packsRequired} delivered · ${contract.remaining} to go`}
              </b>
              <div className="faint small">worth {fmtUsd(contract.payoutPerPack * contract.packsRequired)} total</div>
            </div>
          </div>
        </div>
      )}
      {safeOffers.length > 0 && (
        <div>
          <b className="small">📩 Sponsor offers</b>
          <div className="grid cols2 mt8">
            {safeOffers.map((o) => (
              <div key={o.id} className="panel" style={{ margin: 0 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <b>{o.brand}</b>
                    <div className="faint small" style={{ fontStyle: 'italic' }}>"{o.tagline}"</div>
                  </div>
                  <span className="badge">{o.kind}</span>
                </div>
                <div className="small mt8">
                  <b>{o.packsRequired}</b> × {o.kind} pack{o.packsRequired === 1 ? '' : 's'} · <b style={{ color: 'var(--green)' }}>{fmtUsd(o.totalPayout)}</b> ({fmtUsd(o.payoutPerPack)}/pack) · +{o.followerBonus} followers
                </div>
                <div className="row mt8" style={{ justifyContent: 'flex-end', gap: 8 }}>
                  <button className="small" disabled={busy} onClick={() => onDecline(o.id)}>Pass</button>
                  <button className="primary small" disabled={busy || !!contract} onClick={() => onAccept(o.id)}>
                    {contract ? 'Deal active' : 'Sign deal'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AnalyticsSection({ followers }: { followers: number }) {
  const [data, setData] = useState<import('../api').StreamAnalytics | null>(null)
  useEffect(() => {
    api.streamAnalytics().then(setData).catch(() => setData(null))
  }, [])
  if (!data || data.totals.streams === 0) return null
  const maxPeak = Math.max(...data.history.map((h) => h.peak), 1)
  const maxFpp = Math.max(...data.ranking.map((r) => r.followersPerPack), 0.001)

  return (
    <div className="panel mt14">
      <b>📊 Channel analytics</b>
      <div className="row mt8" style={{ gap: 22, flexWrap: 'wrap' }}>
        <div><div className="faint small">FOLLOWERS / STREAM</div><b>+{data.totals.followersPerStream}</b></div>
        <div><div className="faint small">AVG PEAK VIEWERS</div><b>{data.totals.avgPeak}</b></div>
        <div><div className="faint small">FOLLOWERS GAINED</div><b style={{ color: 'var(--green)' }}>+{data.totals.followersGained}</b></div>
        <div><div className="faint small">CURRENT FOLLOWERS</div><b>{followers}</b></div>
      </div>

      {data.history.length > 1 && (
        <div className="mt14">
          <b className="small">Viewer history (peak per stream)</b>
          <div className="row mt8" style={{ alignItems: 'flex-end', gap: 4, height: 90 }}>
            {[...data.history].reverse().map((h) => (
              <div key={h.id} style={{ flex: 1, minWidth: 8 }} title={`${h.product} — peak ${h.peak}, +${h.gain ?? '?'} followers`}>
                <div
                  style={{
                    height: `${Math.max(6, (h.peak / maxPeak) * 90)}px`,
                    background: 'linear-gradient(180deg, var(--green), transparent)',
                    borderRadius: '3px 3px 0 0',
                  }}
                />
              </div>
            ))}
          </div>
          <div className="faint small">oldest → newest · {data.history.length} streams · followers {followers - data.totals.followersGained} → {followers}</div>
        </div>
      )}

      {data.ranking.length > 0 && (
        <div className="mt14">
          <b className="small">Growth by product (followers per pack opened)</b>
          <div className="mt8">
            {data.ranking.map((r, i) => (
              <div key={r.product} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                <span className="small" style={{ flex: '0 0 auto', maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.product}>
                  {i === 0 && '⭐ '}{r.product}
                </span>
                <div style={{ flex: 1, height: 8, background: 'color-mix(in srgb, var(--green) 15%, transparent)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(4, (r.followersPerPack / maxFpp) * 100)}%`, height: '100%', background: 'var(--green)', borderRadius: 4 }} />
                </div>
                <span className="faint small" style={{ flex: '0 0 auto' }}>
                  +{r.followersPerPack}/pack · {r.streams} stream{r.streams === 1 ? '' : 's'} · peak {r.avgPeak}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StreamHistory() {
  const [rows, setRows] = useState<import('../api').StreamHistoryRow[] | null>(null)
  useEffect(() => {
    api.streamHistory().then(setRows).catch(() => setRows([]))
  }, [])
  if (!rows) return null
  if (rows.length === 0) return <div className="faint small">No streams yet — your first broadcast writes itself here.</div>
  return (
    <div className="table-wrap mt8">
      <table>
        <thead>
          <tr><th>Product</th><th>Packs</th><th>Peak viewers</th><th>Tips</th><th>Best pull</th><th>Date</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.product}</td>
              <td>{r.packsOpened}</td>
              <td>{r.peakViewers}</td>
              <td>{fmtUsd(r.donationsTotal)}</td>
              <td>{r.best ? `${r.best.name} (${fmtUsd(r.best.value)})` : '—'}</td>
              <td className="faint small">{new Date(r.startedAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChatBox({ lines }: { lines: StreamChat[] }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: 999999, behavior: 'smooth' })
  }, [lines.length])
  return (
    <div className="chat-box" ref={ref}>
      {lines.length === 0 && <div className="faint small">Chat is quiet… rip a pack.</div>}
      {lines.map((l, i) => (
        <div key={i} className={`chat-line${l.who === 'anonymous tip' ? ' donation' : ''}${l.who === 'STREAM' ? ' system' : ''}`}>
          <span className="chat-avatar">{l.avatar}</span>
          <div className="grow"><b>{l.who}</b> <span>{l.text}</span></div>
        </div>
      ))}
    </div>
  )
}

// Image lookup with a module-level cache (same pattern as the battle ceremony).
const imgCache = new Map<string, string | null>()
const imgPending = new Set<string>()
const imgWaiters = new Set<() => void>()

function CardImgById({ cardId, name }: { cardId: string; name: string }) {
  const [src, setSrc] = useState<string | null>(imgCache.get(cardId) ?? null)
  useEffect(() => {
    if (imgCache.has(cardId)) { setSrc(imgCache.get(cardId) ?? null); return }
    if (imgPending.has(cardId)) return
    imgPending.add(cardId)
    api.cardDetail(cardId)
      .then((d) => { imgCache.set(cardId, d.card.image_small); imgWaiters.forEach((n) => n()); imgPending.delete(cardId) })
      .catch(() => { imgCache.set(cardId, null); imgPending.delete(cardId) })
  }, [cardId])
  useEffect(() => {
    const notify = () => setSrc(imgCache.get(cardId) ?? null)
    imgWaiters.add(notify)
    return () => { imgWaiters.delete(notify) }
  }, [cardId])
  return <CardImg src={src} alt={name} cardId={cardId} />
}
