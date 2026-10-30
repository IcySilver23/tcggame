import { useEffect, useState } from 'react'
import { api, type LocalFeedRow, type MyLocalListing } from '../api'
import { useStore } from '../store'
import { CardImg, EmptyState, FirstUseTip, fmtUsd, OverflowHint, TipList } from '../components'

/**
 * Local Deals — Facebook Marketplace & Craigslist. The wild west: no fees,
 * no protection, no recourse. Browse the feed, message a seller, meet at a
 * parking lot. Some deals are legendary; some sellers never show; and the
 * too-good ones might bite.
 */

const SRC_ICON: Record<string, string> = { facebook: '📘', craigslist: '📋', mine: '🪧' }

function DeltaTag({ delta }: { delta: number }) {
  const pct = Math.round(delta * 100)
  if (pct <= -50) return <span className="badge hit" title="Deep discount — check the tell">🔥 {pct}%</span>
  if (pct <= -15) return <span className="badge" style={{ color: 'var(--green)' }}>{pct}% vs market</span>
  if (pct <= 15) return <span className="badge faint">≈ market</span>
  return <span className="badge" style={{ color: 'var(--red)' }}>+{pct}% dreamer</span>
}

function MeetResultModal({ result, onClose }: { result: any; onClose: () => void }) {
  const { refreshState } = useStore()
  if (!result) return null
  const r = result
  const isBuy = r.outcome === 'bought'
  const header = isBuy
    ? (r.inspected === 'fake' ? '🃏 The corner test failed' : '🤝 Deal done')
    : r.outcome === 'sold'
      ? '💵 Cash in hand'
      : r.outcome === 'ghosted'
        ? '👻 Ghosted'
        : r.outcome === 'sold_elsewhere'
          ? '⏱ Sold already'
          : r.ok ? '💬 Counter' : '🚫'
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); refreshState() } }}>
      <div className="modal" style={{ width: 'min(460px, 94vw)' }}>
        <div className="modal-head">
          <div>
            <h2 style={{ margin: 0 }}>{header}</h2>
          </div>
          <button className="ghost" onClick={() => { onClose(); refreshState() }}>✕</button>
        </div>
        {isBuy ? (
          <div>
            <div className="trade-bubble" style={{ marginBottom: 12 }}>
              {r.inspected === 'fake'
                ? `You paid ${fmtUsd(r.paid)} for the "${r.card}" — and the second you held it, the corners told the truth. COUNTERFEIT. It's yours forever (or until a buylist shop takes it off your hands for a dollar).`
                : `${r.card} is yours for ${fmtUsd(r.paid)} cash, no receipts, no paper trail.`}
            </div>
            <button className="primary" onClick={() => { onClose(); refreshState() }}>Done</button>
          </div>
        ) : (
          <div>
            <div className="trade-bubble" style={{ marginBottom: 12 }}>{r.message ?? r.error}</div>
            <button className="ghost" onClick={() => { onClose(); refreshState() }}>Walk back to the car</button>
          </div>
        )}
      </div>
    </div>
  )
}

export function LocalDealsView() {
  const { toast, refreshState, openCard } = useStore()
  const [feed, setFeed] = useState<LocalFeedRow[] | null>(null)
  const [mine, setMine] = useState<MyLocalListing[] | null>(null)
  const [tab, setTab] = useState<'feed' | 'mine'>('feed')
  const [busy, setBusy] = useState<number | null>(null)
  const [result, setResult] = useState<any>(null)
  const [offerFor, setOfferFor] = useState<LocalFeedRow | null>(null)

  const load = () => {
    api.local().then(setFeed).catch(() => {})
    api.localMine().then(setMine).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const meet = async (row: LocalFeedRow, offer?: number) => {
    setBusy(row.id)
    try {
      const r = await api.localMeet(row.id, offer)
      if (r.ok) {
        setResult(r)
        if (r.outcome === 'bought') refreshState()
      } else toast(r.error ?? 'Meetup failed', 'bad')
      load()
    } finally { setBusy(null) }
  }

  const accept = async (l: MyLocalListing, buyer: string, amount?: number) => {
    setBusy(l.id)
    try {
      const r = await api.localAccept(l.id, buyer, amount)
      if (r.ok) {
        setResult(r)
        refreshState()
      } else toast(r.error ?? 'Meetup failed', 'bad')
      load()
    } finally { setBusy(null) }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🪧 Local Deals</h1>
          <div className="sub">Facebook Marketplace & Craigslist — no fees, no protection, no recourse. Cash in a parking lot.</div>
        </div>
      </div>

      <FirstUseTip surface="local">
        <TipList
          title="🪧 The wild west — read this first"
          items={[
            { icon: '🐟', label: 'Too good = fake', text: <>a 🐟 tell means the deal is <i>too</i> good — cheap enough to be a counterfeit</> },
            { icon: '👻', label: '1 in 8 ghost', text: <>meetups vanish and sellers go quiet; nobody owes you an explanation</> },
            { icon: '🚫', label: 'No protection', text: <>no fees either — but once the cash changes hands it's just the corners in your hand</> },
            { icon: '🎲', label: 'Read the ask', text: <>local prices are vibes: clueless, dreaming, or scam-adjacent</> },
          ]}
        />
      </FirstUseTip>

      <div className="chip-row mb14">
        <span className={`chip ${tab === 'feed' ? 'on' : ''}`} onClick={() => { setTab('feed'); load() }}>The feed</span>
        <span className={`chip ${tab === 'mine' ? 'on' : ''}`} onClick={() => { setTab('mine'); load() }}>My posts {mine && mine.length > 0 ? `(${mine.length})` : ''}</span>
      </div>

      {tab === 'feed' && (
        feed == null ? (
          <EmptyState icon="🕰" text="Loading the feed…" sub="Scrolling past the furniture ads." />
        ) : feed.length === 0 ? (
          <EmptyState icon="🪧" text="Nothing local right now" sub="New posts land as the day goes on." />
        ) : (
          <div className="grid cols3">
            {feed.map((r) => (
              <div key={r.id} className="panel conv-item" style={{ margin: 0 }}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ width: 66, cursor: 'pointer' }} onClick={() => openCard(r.cardId)}>
                    <CardImg src={r.image} alt={r.name} className="row-thumb" cardId={r.cardId} />
                  </div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                      <b className="small" style={{ cursor: 'pointer' }} onClick={() => openCard(r.cardId)}>{r.name}</b>
                      <span title={r.source === 'facebook' ? 'Facebook Marketplace' : 'Craigslist'}>{SRC_ICON[r.source]}</span>
                    </div>
                    <div className="faint small">{r.setName} · {r.condition}</div>
                    <div className="row mt8" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <DeltaTag delta={r.delta} />
                      {r.tell && <span title="Too good to be true? Cheap deals can be counterfeits — inspect in the parking lot.">{r.tell}</span>}
                    </div>
                    <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
                      <span className="price">{fmtUsd(r.ask)}</span>
                      <span className="faint small">mkt {fmtUsd(r.anchor)}</span>
                    </div>
                    <div className="faint small">seller: {r.seller}{r.ghosted ? ' · 👻 ghosted you before' : ''}</div>
                    <OverflowHint count={1} align="left" />
                    {r.counterOffer != null ? (
                      <div className="row" style={{ marginTop: 6, gap: 6 }}>
                        <button className="primary small grow" disabled={busy === r.id} onClick={() => meet(r, r.counterOffer!)}>Pay {fmtUsd(r.counterOffer)}</button>
                      </div>
                    ) : (
                      <div className="row" style={{ marginTop: 6, gap: 6 }}>
                        <button className="primary small grow" disabled={busy === r.id} onClick={() => meet(r)}>Message & meet</button>
                        <button className="small" disabled={busy === r.id} onClick={() => setOfferFor(r)}>Offer less</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'mine' && (
        mine == null ? (
          <EmptyState icon="🕰" text="Loading…" />
        ) : mine.length === 0 ? (
          <div>
            <EmptyState icon="🪧" text="No local posts" sub="Post raw cards from the Inventory rows — cash sales, no fees." />
            <LocalLister onPosted={load} />
          </div>
        ) : (
          <>
            <div className="panel mt14">
              {mine.map((l) => (
                <div key={l.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--border-soft)', flexWrap: 'wrap', gap: 8 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <div style={{ width: 44 }}><CardImg src={l.image} alt={l.name} className="row-thumb" /></div>
                    <div>
                      <b className="small">{l.name}</b> <span className="faint small">{l.condition} · ask {fmtUsd(l.ask)}</span>
                      <div className="faint small">posted {new Date(l.postedAt).toLocaleDateString()} · expires {new Date(l.expiresAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div style={{ minWidth: 260 }}>
                    {l.messages.length === 0 ? (
                      <span className="faint small">No messages yet — the algorithm is resting.</span>
                    ) : (
                      l.messages.slice(0, 3).map((m, i) => (
                        <div key={i} className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 4 }}>
                          <span className="faint small" style={{ minWidth: 210 }}>
                            {m.kind === 'ghost' ? '👻' : m.kind === 'lowball' ? '🌙' : '💬'} <b>{m.buyer}</b> {m.kind === 'lowball' && m.amount ? `offered ${fmtUsd(m.amount)}` : m.kind === 'full' && m.amount ? `wants it at ${fmtUsd(m.amount)}` : `— "${m.note}"`}
                          </span>
                          {m.kind !== 'ghost' && (
                            <button className="small" disabled={busy === l.id} onClick={() => accept(l, m.buyer, m.amount ?? undefined)}>Meet</button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  <button className="ghost small" disabled={busy === l.id} onClick={async () => { await api.localCancel(l.id); load(); toast('Post taken down', 'info') }}>Take down</button>
                </div>
              ))}
            </div>
            <LocalLister onPosted={load} />
          </>
        )
      )}

      {offerFor && (
        <OfferModal
          row={offerFor}
          onClose={() => setOfferFor(null)}
          onSend={async (num) => { await meet(offerFor, num); setOfferFor(null) }}
        />
      )}
      <MeetResultModal result={result} onClose={() => setResult(null)} />
    </div>
  )
}

function OfferModal({ row, onClose, onSend }: { row: LocalFeedRow; onClose: () => void; onSend: (num: number) => void }) {
  const [val, setVal] = useState(String(Math.max(0.5, Math.round(row.ask * 0.7 * 100) / 100)))
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(430px, 94vw)' }}>
        <div className="modal-head">
          <div>
            <h2 style={{ margin: 0 }}>💬 Your offer</h2>
            <div className="faint small">{row.name} · asking {fmtUsd(row.ask)} · market {fmtUsd(row.anchor)}</div>
          </div>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="faint">$</span>
          <input className="input" style={{ width: 110 }} value={val} inputMode="decimal" onChange={(e) => setVal(e.target.value)} />
          <button className="primary" onClick={() => { const n = Number(val); if (n > 0) onSend(n) }}>Send & meet</button>
        </div>
        <div className="faint small mt8">They might counter, ghost you, or just take it. Cash rules.</div>
      </div>
    </div>
  )
}

/** Post a raw collection card locally. */
function LocalLister({ onPosted }: { onPosted: () => void }) {
  const { toast, refreshState } = useStore()
  const [pick, setPick] = useState(false)
  const [rows, setRows] = useState<any[] | null>(null)
  const [askFor, setAskFor] = useState<any | null>(null)
  const [val, setVal] = useState('')

  const open = () => {
    setPick(true)
    fetch('/api/inventory').then((r) => r.json()).then((rows) => {
      setRows(rows.filter((r: any) => r.status === 'collection' && !r.graded_grade && !r.is_fake && !r.fake_revealed))
    }).catch(() => setRows([]))
  }

  const post = async () => {
    const n = Number(val)
    if (!(n > 0)) { toast('Set an ask first', 'bad'); return }
    const r = await api.localList(askFor.id, n)
    if (r.ok) {
      toast('Posted locally — cash only, meet at a public lot', 'good')
      refreshState()
      setAskFor(null)
      setPick(false)
      onPosted()
    } else toast(r.error ?? 'Post failed', 'bad')
  }

  return (
    <div className="panel mt14">
      {!pick ? (
        <button className="ghost" onClick={open}>🪧 Post a card from your binder</button>
      ) : (
        <>
          <b className="small">Pick a raw card to post</b>
          {rows == null ? <div className="faint small">Loading binder…</div> : rows.length === 0 ? (
            <div className="faint small mt8">Nothing postable — raw collection cards only (no slabs, no known fakes).</div>
          ) : (
            <div className="grid cols3 mt8" style={{ maxHeight: 260, overflowY: 'auto' }}>
              {rows.slice(0, 60).map((r: any) => (
                <div key={r.id} className="panel" style={{ margin: 0, cursor: 'pointer', padding: 8 }} onClick={() => { setAskFor(r); setVal(String(r.market ?? '')) }}>
                  <b className="small">{r.name}</b>
                  <div className="faint small">{r.condition}{r.quantity > 1 ? ` ×${r.quantity}` : ''} · mkt {fmtUsd(r.market)}</div>
                </div>
              ))}
            </div>
          )}
          {askFor && (
            <div className="row mt8" style={{ gap: 8, alignItems: 'center' }}>
              <span className="small">Ask for <b>{askFor.name}</b>:</span>
              <span className="faint">$</span>
              <input className="input" style={{ width: 100 }} value={val} inputMode="decimal" onChange={(e) => setVal(e.target.value)} />
              <button className="primary small" onClick={post}>Post it</button>
            </div>
          )}
          <button className="ghost small mt8" onClick={() => { setPick(false); setAskFor(null) }}>Cancel</button>
        </>
      )}
    </div>
  )
}
