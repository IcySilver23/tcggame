import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { TearPack, RecordMoment, RECORD_GLOW_CLASS, PACK_GLOW_CLASS, glowClass } from '../components'
import type { LiveItem, LiveSection, LiveChannel } from '../api'
import { useStore } from '../store'
import { CardImg, EmptyState, FirstUseTip, fmtUsd } from '../components'

// ---------------------------------------------------------------------------
// 📺 Live Shopping — the Whatnot wing. NPC sellers run scheduled channels:
// rip streams feed flash BIN drops, rapid auctions with the rolling 15-second
// hammer, and flat-price mystery piles. Camping the right host is the skill —
// shills overprice, saints misprice. Purchases land in the binder with
// "won on [host]'s show" provenance.
// ---------------------------------------------------------------------------

function countdown(target: string, nowMs: number): string {
  const ms = new Date(target).getTime() - nowMs
  if (ms <= 0) return 'now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// Sealed/no-card lots stay inert — there's nothing to inspect behind the box.
// Card-lot thumbs arm CardImg's built-in hover-zoom + click-to-open via cardId.
function ZoomThumb({ item, small }: { item: LiveItem; small?: boolean }) {
  if (!item.image || !item.cardId) return <CardImg src={item.image} alt={item.name} className={small ? 'live-thumb-sm' : 'live-thumb'} />
  return <CardImg src={item.image} alt={item.name} className={small ? 'live-thumb-sm' : 'live-thumb'} cardId={item.cardId} />
}

const STYLE_ICON: Record<string, string> = { rip: '🎞', auction: '🔨', mystery: '🎁', sudden: '💵', teambreak: '🧩', ripship: '🚚' }
const STYLE_LABEL: Record<string, string> = { rip: 'rip stream', auction: 'auction house', mystery: 'mystery boxes', sudden: '$1 sudden death', teambreak: 'team pack breaks', ripship: 'rip-it-or-ship-it' }

// The HIT-CAM — full-screen pull art when a hit comes out of YOUR pack (or the
// room's). One hit at a time; Next steps through multi-hit packs. Chat-eruption
// flavor runs along the bottom like the real thing.
function HitCam({ hits, idx, onNext }: { hits: { name: string; image: string | null; value: number }[]; idx: number; onNext: () => void }) {
  const hit = hits[idx]
  if (!hit) return null
  const more = idx + 1 < hits.length
  return (
    <div className="hitcam" onClick={onNext}>
      <div className="hitcam-tag">🔥 HIT-CAM</div>
      <div className="hitcam-glow" />
      <div className="hitcam-card">
        <CardImg src={hit.image} alt={hit.name} />
      </div>
      <div className="hitcam-name">{hit.name}</div>
      <div className="hitcam-value">market {fmtUsd(hit.value)}</div>
      <div className="hitcam-chat">
        <span>LETS GOOO</span><span>clip it clip it clip it</span><span>NO WAY</span><span>chat im shaking</span><span>THE ROOM IS ON FIRE</span>
      </div>
      <button className="btn hitcam-btn" onClick={(e) => { e.stopPropagation(); onNext() }}>
        {more ? `Next hit (${idx + 2}/${hits.length}) →` : 'Back to the stream'}
      </button>
    </div>
  )
}

export function LiveShoppingView() {
  const { toast, refreshState, openCard } = useStore()
  const [data, setData] = useState<LiveSection | null>(null)
  const [busy, setBusy] = useState(false)
  const [bidAmt, setBidAmt] = useState<Record<number, string>>({})
  const snipedRef = useRef<Set<number>>(new Set())
  const [reveal, setReveal] = useState<{ paid: number; cards: { name: string; value: number }[]; total: number } | null>(null)
  // The tear comes before the list: won a ripship (or bought a mystery pile)?
  // The pack lands on screen first — tear it open, then the reveal modal shows.
  const [tearing, setTearing] = useState<{ name: string; symbol: string | null; image: string | null; reveal: { paid: number; cards: { name: string; value: number }[]; total: number }; hits: { name: string; cardId: string; image: string | null; value: number }[] | null; recordValue: number | null; packRecordValue: number | null } | null>(null)
  const [hitcam, setHitcam] = useState<{ name: string; cardId: string; image: string | null; value: number }[] | null>(null)
  const [camIdx, setCamIdx] = useState(0)
  const [clockSkew, setClockSkew] = useState(0)
  const [tick, setTick] = useState(0)

  const [watched, setWatched] = useState<number | null>(null)
  const load = () => api.live(watched ?? undefined).then((d) => { setData(d); if (d.currentShow) setClockSkew(Date.now() - new Date(d.currentShow.serverNow).getTime()) }).catch(() => {})
  useEffect(() => { load() }, [watched])
  useEffect(() => { load() }, [])
  // Live room polls like a stream; a 1s ticker keeps countdowns honest.
  // Re-created when `watched` changes so the poll fetches the watched room,
  // not the mount-time closure (stale `watched` would snap the room back).
  useEffect(() => {
    const p = setInterval(load, 5000)
    const t = setInterval(() => setTick((x) => x + 1), 1000)
    return () => { clearInterval(p); clearInterval(t) }
  }, [watched])

  const now = Date.now() - clockSkew
  void tick // re-render trigger for countdowns

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

  const show = data?.currentShow
  // Channel switcher: the always-on lineup. `watched` rides the /api/live
  // request, so the FULL room (header, chat, format rails) is the watched
  // channel's — the server falls back to the newest room when a watched
  // channel wraps between polls.
  const channels = data?.channels ?? []
  const watchedShow = watched != null ? channels.find((c) => c.showId === watched) : null
  useEffect(() => {
    if (watched != null && !watchedShow) setWatched(null) // channel wrapped — snap back to the main room
  }, [watched, watchedShow])
  const watchingOther = watchedShow != null && show != null && watchedShow.showId === show.id
  const drops = show ? show.items.filter((i) => i.kind === 'drop') : []
  const auctions = show ? show.items.filter((i) => i.kind === 'auction') : []
  const mysteries = show ? show.items.filter((i) => i.kind === 'mystery') : []
  const sudden = show ? show.items.filter((i) => i.kind === 'sudden') : []
  const ripships = show ? show.items.filter((i) => i.kind === 'ripship') : []

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>📺 Live Shopping</h1>
          <div className="sub">Every channel is a real show — $1 sudden-death rooms where every card goes for a buck, team breaks where you claim a species, rip-it-or-ship-it pack auctions, sealed mystery boxes, and rapid auction rooms. Camp the honest hosts; let the shills keep their rooms.</div>
        </div>
      </div>

      <FirstUseTip surface="live">
        Every channel runs a real format: 💵 <b>$1 sudden death</b> puts every card in the pack on the block for a buck, 🧩 <b>team breaks</b> let you claim
        a species and own its pulls, 🚚 <b>rip it or ship it</b> auctions the sealed pack — the winner calls rip-on-stream or take-it-home — and
        🕶 <b>mystery boxes</b> hide a hit under the bulk. Prices anchor to the real market, but hosts have <b>personalities</b>: shills ask ~1.2× market,
        generous sellers <b>occasionally misprice</b>. Late bids <b>reset the hammer 15 seconds</b>; the room bids back, and wars have to end somewhere.
      </FirstUseTip>

      {channels.length > 1 && (
        <div className="panel" style={{ padding: 12, marginBottom: 14 }}>
          <b className="small" style={{ letterSpacing: '0.08em' }}>CHANNELS — {channels.length} LIVE NOW</b>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {channels.map((c) => {
              const active = show?.id === c.showId && (watched == null || watched === c.showId)
              return (
                <button
                  key={c.showId}
                  className={active ? 'primary' : 'ghost'}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderRadius: 8 }}
                  onClick={() => setWatched(active ? null : c.showId)}
                title={`Watch ${c.host}'s ${STYLE_LABEL[c.style] ?? c.style} room`}
                >
                  <span style={{ fontSize: 16 }}>{c.avatar}</span>
                  <span className="small" style={{ textAlign: 'left' }}>
                    <b>{c.host}</b>
                    <span className="faint" style={{ display: 'block', fontSize: 11 }}>
                      {STYLE_ICON[c.style] ?? '📺'} {STYLE_LABEL[c.style] ?? c.style} · {c.viewers.toLocaleString()} watching
                    </span>
                  </span>
                  <span className="live-dot" style={{ marginLeft: 2 }} />
                </button>
              )
            })}
          </div>
        </div>
      )}

      {watchingOther && watchedShow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 8px' }}>
          <span className="live-dot" />
          <span className="small faint">watching {watchedShow.host} — the full room below is their channel · <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setWatched(null)}>back to the main room</button></span>
        </div>
      )}

      {show && <LiveRoom show={show} now={now} busy={busy} bidAmt={bidAmt} setBidAmt={setBidAmt}
        drops={drops} auctions={auctions} mysteries={mysteries} sudden={sudden} ripships={ripships}
        onBid={(id, amt) => run(() => api.liveBid(id, amt), (r) => r.leading ? `You're leading at ${fmtUsd(r.current)}${r.extended ? ' — hammer extended' : ''}.` : `Outbid — the room is at ${fmtUsd(r.current)}.`)}
        onSnipe={(id) => {
          if (snipedRef.current.has(id)) return
          snipedRef.current.add(id)
          run(() => api.liveSnipe(id), (r) => r.stolen ? `⚡ SNIPE! Stolen at the buzzer for ${fmtUsd(r.paid)} — ${r.card} is yours.` : `Bid landed at ${fmtUsd(r.paid)} — the window hadn't opened yet.`)
            .then((r) => { setTimeout(() => snipedRef.current.delete(id), 4000) })
        }}
        onBin={(id) => run(() => api.liveBin(id), (r) => `Won — ${r.card} for ${fmtUsd(r.paid)}. In the binder.`)}
        onMystery={async (id) => {
          // Record chase: the bar as it stood BEFORE the pile opens — the
          // server writes these pulls during the call, so fetching after
          // would compare the pile against itself.
          const best = await api.pullsBest().catch(() => ({ value: 0, bestPackTotal: 0 }))
          run(() => api.liveMystery(id), () => 'Paid — the reveal is up.').then((r) => {
            if (r && r.ok) {
              const product = data?.currentShow?.product
              const recordCard = best.value > 0 ? (r.cards as { value: number }[]).find((c) => c.value > best.value) : undefined
              const packRecordValue = (best.bestPackTotal ?? 0) > 0 && r.total! > best.bestPackTotal! ? r.total! : null
              // Mystery reveals carry names only (no cardId), so the record
              // moment fires but the crown stays on Pack Opening surfaces.
              setTearing({ name: product?.name ?? 'Mystery pile', symbol: product?.symbol ?? null, image: product?.image ?? null, reveal: { paid: r.paid, cards: r.cards, total: r.total }, hits: null, recordValue: recordCard ? recordCard.value : null, packRecordValue })
            }
          })
        }}
        onSpot={(itemId, spotId) => run(() => api.liveSpot(itemId, spotId), (r) => `Spot claimed — ${r.team} is yours; its pulls land at settle.`)}
        onChoose={async (id, choice) => {
          // Same ordering as mystery: read the bar BEFORE the host rips.
          const best = await api.pullsBest().catch(() => ({ value: 0, bestPackTotal: 0 }))
          run(() => api.liveRipshipChoose(id, choice), (r) =>
            r.choice === 'rip' ? `RIPPED ON STREAM — ${r.cards!.length} cards for ${fmtUsd(r.paid)} (worth ${fmtUsd(r.total)}). In the binder.`
              : `SHIPPED — sealed ${r.product} is yours for ${fmtUsd(r.paid)}. It's in the Pack Shop stash.`)
            .then((r) => {
              if (r && r.ok && r.choice === 'rip') {
                const hits = r.hits && r.hits.length > 0 ? r.hits : null
                const maxVal = ((r.cards ?? []) as { value: number }[]).reduce((a, c) => Math.max(a, c.value), 0)
                const recordValue = best.value > 0 && maxVal > best.value ? maxVal : null
              const packRecordValue = (best.bestPackTotal ?? 0) > 0 && r.total! > best.bestPackTotal! ? r.total! : null
                const revealData = { paid: r.paid!, cards: r.cards!, total: r.total! }
                const product = data?.currentShow?.product
                setTearing({ name: product?.name ?? 'Booster pack', symbol: product?.symbol ?? null, image: product?.image ?? null, reveal: revealData, hits, recordValue, packRecordValue })
              }
            })
        }}
      />}

      {!show && data && (
        <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>📺</span>
            <div>
              <b>Channels warming up</b>
              <div className="faint small">The roster is spinning rooms up — the lineup above fills in as hosts go live. There is never dead air for long.</div>
            </div>
          </div>
        </div>
      )}

      {data && data.upcoming.length > 0 && (
        <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
          <b className="small" style={{ letterSpacing: '0.08em' }}>SCHEDULE</b>
          {data.upcoming.slice(0, 4).map((u, i) => (
            <div key={i} className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <span style={{ fontSize: 18 }}>{u.avatar}</span>
                <div>
                  <b className="small">{u.title}</b>
                  <div className="faint small">{u.host} · {new Date(u.start).toLocaleDateString([], { weekday: 'short' })} {localTime(u.start)}–{localTime(u.end)}</div>
                </div>
              </div>
              <span className={`small ${u.now ? '' : 'faint'}`} style={{ color: u.now ? 'var(--green)' : undefined }}>{u.now ? 'LIVE NOW' : `in ${countdown(u.start, now)}`}</span>
            </div>
          ))}
        </div>
      )}


      {data && data.hosts.length > 0 && (
        <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
          <b className="small" style={{ letterSpacing: '0.08em' }}>THE HOSTS</b>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10, marginTop: 8 }}>
            {data.hosts.map((h, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontSize: 20 }}>{h.avatar}</span>
                  <div style={{ minWidth: 0 }}>
                    <b className="small">{h.name}</b>
                    <div className="faint small">{STYLE_ICON[h.style] ?? '📺'} {STYLE_LABEL[h.style] ?? h.style} · {h.followers.toLocaleString()} followers · ★ {h.rating.toFixed(1)}</div>
                  </div>
                </div>
                <div className="faint small" style={{ marginTop: 6 }}>{h.note}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && data.recentShows.length > 0 && (
        <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
          <b className="small" style={{ letterSpacing: '0.08em' }}>RECENT SHOWS</b>
          {data.recentShows.map((s) => (
            <div key={s.id} className="row small" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
              <span>{s.avatar} <b>{s.host}</b> · {s.rips} rips{s.bestPull ? ` · best: ${s.bestPull.name} (${fmtUsd(s.bestPull.value)})` : ''}</span>
              <span className="faint">{fmtUsd(s.proceeds)} across the room</span>
            </div>
          ))}
        </div>
      )}

      {data && data.wins.length > 0 && (
        <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
          <b className="small" style={{ letterSpacing: '0.08em' }}>YOUR WINS</b>
          {data.wins.slice(0, 10).map((w, i) => (
            <div key={i} className="row small" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
              <span>{w.card}{w.variant !== 'normal' ? ` (${w.variant})` : ''} <span className="faint">from {w.host}</span></span>
              <span style={{ color: w.value >= w.paid ? 'var(--green)' : 'var(--red, #e0644d)' }}>{fmtUsd(w.paid)} → {fmtUsd(w.value)}</span>
            </div>
          ))}
        </div>
      )}

      {tearing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
          <div className={`panel ${tearing.recordValue != null || tearing.packRecordValue != null ? glowClass(tearing.recordValue != null, tearing.packRecordValue != null) : ''}`} style={{ maxWidth: 420, width: '92vw', textAlign: 'center', padding: '18px 14px' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>📺 Ripped on stream</h2>
            {tearing.recordValue != null && <RecordMoment active value={tearing.recordValue} />}
            {tearing.packRecordValue != null && <RecordMoment active value={tearing.packRecordValue} variant="pack" />}
            <div className="faint small" style={{ marginBottom: 6 }}>{tearing.recordValue != null ? 'A new best pull on record — tear it open' : tearing.packRecordValue != null ? 'A new best pack on record — tear it open' : 'Tear it open to see what the host pulled'}</div>
            <TearPack
              compact
              symbolUrl={tearing.symbol}
              imageUrl={tearing.image}
              name={tearing.name}
              sub={`you paid ${fmtUsd(tearing.reveal.paid)}`}
              globalEnter
              onTorn={() => {
                setTimeout(() => {
                  if (tearing.hits) { setHitcam(tearing.hits); setCamIdx(0) }
                  setReveal(tearing.reveal)
                  setTearing(null)
                }, 520)
              }}
            />
          </div>
        </div>
      )}

      {hitcam && hitcam.length > 0 && (
        <HitCam hits={hitcam} idx={camIdx} onNext={() => (camIdx + 1 < hitcam.length ? setCamIdx(camIdx + 1) : setHitcam(null))} />
      )}

      {reveal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setReveal(null)}>
          <div className="panel" style={{ maxWidth: 520, maxHeight: '80vh', overflow: 'auto', margin: 16 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>🎁 The reveal</h2>
            <div className="faint small" style={{ marginBottom: 10 }}>Paid {fmtUsd(reveal.paid)} — worth {fmtUsd(reveal.total)} ({reveal.total >= reveal.paid ? '+' : ''}{fmtUsd(reveal.total - reveal.paid)}).</div>
            {reveal.cards.map((c, i) => (
              <div key={i} className="row small" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', padding: '6px 0' }}>
                <span>{c.name}</span><span>{fmtUsd(c.value)}</span>
              </div>
            ))}
            <button className="btn" style={{ marginTop: 10 }} onClick={() => setReveal(null)}>Sick. Close it.</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The live room: host header, chat rail, and the three rails of cardboard.
// ---------------------------------------------------------------------------

function LiveRoom(props: {
  show: NonNullable<LiveSection['currentShow']>
  now: number
  busy: boolean
  bidAmt: Record<number, string>
  setBidAmt: (x: Record<number, string>) => void
  drops: LiveItem[]
  auctions: LiveItem[]
  mysteries: LiveItem[]
  sudden: LiveItem[]
  ripships: LiveItem[]
  onBid: (id: number, amt: number) => void
  onSnipe: (id: number) => void
  onBin: (id: number) => void
  onMystery: (id: number) => void
  onSpot: (itemId: number, spotId: number) => void
  onChoose: (id: number, choice: 'rip' | 'ship') => void
}) {
  const { show, now, drops, auctions, mysteries, sudden, ripships } = props
  const chatRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [show.chat.length])

  const dealTag = (item: LiveItem): string | null => {
    if (item.kind === 'mystery') return item.ask != null && item.market > 0 ? (item.ask < item.market * 0.9 ? 'UNDER' : item.ask > item.market * 1.1 ? 'RICH' : null) : null
    if (item.ask == null || item.market <= 0) return null
    const ratio = item.ask / item.market
    return ratio < 0.85 ? 'DEAL' : ratio > 1.25 ? 'RICH' : null
  }

  return (
    <div className="panel" style={{ padding: 0, marginBottom: 14, overflow: 'hidden' }}>
      {/* header */}
      <div className="row" style={{ justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'var(--panel-head, var(--panel2))' }}>
        <div className="row" style={{ gap: 10 }}>
          <span className="live-dot" />
          <span style={{ fontSize: 20 }}>{show.host?.avatar}</span>
          <div>
            <b>{show.host?.name}</b> <span className="faint small">★ {show.host?.rating.toFixed(1)} · {show.host?.followers.toLocaleString()} followers</span>
            <div className="faint small">{show.product.name} · {STYLE_LABEL[show.style] ?? 'rip stream'} · rip {show.rips.done}/{show.rips.planned}{show.bestPull ? ` · best: ${show.bestPull.name} (${fmtUsd(show.bestPull.value)})` : ''}</div>
          </div>
        </div>
        <div className="row" style={{ gap: 14 }}>
          <span className="small"><b style={{ color: 'var(--red, #e0644d)' }}>{show.viewers.toLocaleString()}</b> <span className="faint">watching</span></span>
          <span className="small faint">ends in {countdown(show.endsAt, now)}</span>
        </div>
      </div>

      <div className="live-room-grid">
        {/* rails */}
        <div style={{ padding: 14, minWidth: 0 }}>
          {auctions.length > 0 && (
            <>
              <b className="small" style={{ letterSpacing: '0.08em' }}>🔨 ON THE BLOCK</b>
              {auctions.map((a) => {
                const endsMs = new Date(a.endsAt ?? 0).getTime() - now
                return (
                  <div key={a.id} style={{ border: `1px solid ${a.leading ? 'var(--green)' : a.outbid ? 'var(--yellow, #e8b73a)' : 'var(--border)'}`, borderRadius: 8, padding: 10, marginTop: 8, display: 'flex', gap: 10 }}>
                    <ZoomThumb item={a} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <b className="small">{a.name}</b>
                        {dealTag(a) && <span className="badge" style={{ marginLeft: 6, background: dealTag(a) === 'RICH' ? 'var(--yellow, #e8b73a)' : 'var(--green)', color: '#111' }}>{dealTag(a)}</span>}
                        <div className="faint small">market {fmtUsd(a.market)} · {a.bids} bids</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div><b>{fmtUsd(a.currentBid ?? 0)}</b>{a.myBid != null && <span className="small faint"> (you {fmtUsd(a.myBid)})</span>}</div>
                        <div className="small" style={{ color: endsMs < 15_000 ? 'var(--red, #e0644d)' : undefined }}>
                          {endsMs <= 0 ? 'hammer…' : `${countdown(a.endsAt ?? '', now)}${endsMs < 15_000 ? ' ⏱' : ''}`}
                        </div>
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6, marginTop: 8 }}>
                      <input className="input" style={{ width: 110 }} placeholder={fmtUsd((a.currentBid ?? 0) + 1)} value={props.bidAmt[a.id] ?? ''}
                        onChange={(e) => props.setBidAmt({ ...props.bidAmt, [a.id]: e.target.value })} />
                      <button className="btn" disabled={props.busy} onClick={() => props.onBid(a.id, Number(props.bidAmt[a.id]) || (a.currentBid ?? 0) + 1)}>BID</button>
                      {a.leading && <span className="small" style={{ color: 'var(--green)' }}>you're leading</span>}
                      {a.outbid && <span className="small" style={{ color: 'var(--gold, #e8b73a)' }}>outbid — they came back</span>}
                    </div>
                    </div>
                  </div>
                )
              })}
            </>
          )}

          {drops.length > 0 && (
            <>
              <b className="small" style={{ letterSpacing: '0.08em', display: 'block', marginTop: auctions.length ? 14 : 0 }}>⚡ DROPS — GONE IN SECONDS</b>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginTop: 8 }}>
                {drops.map((d) => {
                  const tag = dealTag(d)
                  return (
                    <div key={d.id} style={{ border: `1px solid ${tag === 'DEAL' ? 'var(--green)' : 'var(--border)'}`, borderRadius: 8, padding: 10, display: 'flex', gap: 8 }}>
                      <ZoomThumb item={d} small />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b className="small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</b>
                        <div className="faint small">market {fmtUsd(d.market)}</div>
                        <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
                          <b>{fmtUsd(d.ask ?? 0)}</b>
                          <button className="btn" disabled={props.busy} onClick={() => props.onBin(d.id)}>TAKE</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {mysteries.length > 0 && (
            <>
              <b className="small" style={{ letterSpacing: '0.08em', display: 'block', marginTop: 14 }}>🎁 MYSTERY PILES — PAY TO SEE</b>
              {mysteries.map((m) => (
                <div key={m.id} className="row" style={{ justifyContent: 'space-between', border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginTop: 8 }}>
                  <div>
                    <b className="small">{m.name}</b>
                    <div className="faint small">contents hidden — the host's honesty is the only tell</div>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <b>{fmtUsd(m.ask ?? 0)}</b>
                    <button className="btn" disabled={props.busy} onClick={() => props.onMystery(m.id)}>BUY &amp; REVEAL</button>
                  </div>
                </div>
              ))}
            </>
          )}

          {sudden.length > 0 && (
            <>
              <b className="small" style={{ letterSpacing: '0.08em', display: 'block', marginTop: auctions.length || drops.length ? 14 : 0 }}>💵 $1 SUDDEN DEATH — EVERYTHING MUST GO</b>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginTop: 8 }}>
                {sudden.map((s) => {
                  const endsMs = new Date(s.endsAt ?? 0).getTime() - now
                  const hot = s.market > (s.currentBid ?? 0) * 4
                  return (
                    <div key={s.id} style={{ border: `1px solid ${s.leading ? 'var(--green)' : s.outbid ? 'var(--yellow, #e8b73a)' : 'var(--border)'}`, borderRadius: 8, padding: 10, display: 'flex', gap: 8 }}>
                      <ZoomThumb item={s} small />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b className="small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</b>
                        <div className="faint small">market {fmtUsd(s.market)}{hot ? ' · 🔥' : ''}</div>
                        <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
                          <b style={{ color: 'var(--gold, #e8b73a)' }}>{fmtUsd(s.currentBid ?? s.ask ?? 1)}</b>
                          {endsMs > 0 && endsMs <= 2_000
                            ? <button className="btn" style={{ background: 'var(--red, #e0644d)', color: '#fff', fontWeight: 700, animation: 'dayurgent 1s ease-in-out infinite' }} disabled={props.busy} onClick={() => props.onSnipe(s.id)}>⚡ SNIPE {fmtUsd((s.currentBid ?? 0) + 1)}</button>
                            : <button className="btn" disabled={props.busy} onClick={() => props.onBid(s.id, (s.currentBid ?? 0) + 1)}>{s.leading ? 'LEADING' : s.outbid ? 'REBID' : 'BID $1'}</button>}
                        </div>
                        <div className="small faint" style={{ marginTop: 4 }}>{endsMs <= 0 ? 'closing…' : `${countdown(s.endsAt ?? '', now)} left`}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {(show.boards ?? []).length > 0 && (
            <>
              <b className="small" style={{ letterSpacing: '0.08em', display: 'block', marginTop: 14 }}>🧩 TEAM BREAK BOARD — CLAIM A SPECIES</b>
              {show.boards.map((b) => (
                <div key={b.itemId} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginTop: 8 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="small faint">{b.spots.filter((s) => s.holder).length}/{b.spots.length} spots claimed — pulls pay to the species owner at settle</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6, marginTop: 8 }}>
                    {b.spots.map((s) => (
                      <div key={s.id} style={{ border: `1px solid ${s.mine ? 'var(--green)' : 'var(--border)'}`, borderRadius: 6, padding: '6px 8px', opacity: s.holder && !s.mine ? 0.55 : 1 }}>
                        <b className="small" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.team}</b>
                        <div className="faint small">{s.mine ? 'yours ✓' : s.holder ? `${s.holder}` : fmtUsd(s.ask)}</div>
                        {!s.holder && <button className="btn" style={{ marginTop: 4, width: '100%', fontSize: 11, padding: '3px 0' }} disabled={props.busy} onClick={() => props.onSpot(b.itemId, s.id)}>CLAIM</button>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {ripships.length > 0 && (
            <>
              <b className="small" style={{ letterSpacing: '0.08em', display: 'block', marginTop: 14 }}>🚚 RIP IT OR SHIP IT — BID ON THE SEALED PACK</b>
              {ripships.map((r) => {
                if (r.status === 'pending') {
                  return (
                    <div key={r.id} style={{ border: '1px solid var(--green)', borderRadius: 8, padding: 10, marginTop: 8, background: 'rgba(80,200,120,0.06)' }}>
                      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                        <b className="small">🏆 YOU WON — {r.name} at {fmtUsd(r.currentBid ?? 0)}</b>
                      </div>
                      <div className="faint small" style={{ margin: '4px 0 8px' }}>Winner's call: the host rips it on stream, or it ships home sealed.</div>
                      <div className="row" style={{ gap: 8 }}>
                        <button className="btn" disabled={props.busy} onClick={() => props.onChoose(r.id, 'rip')}>📺 RIP IT ON STREAM</button>
                        <button className="btn" disabled={props.busy} onClick={() => props.onChoose(r.id, 'ship')}>📦 SHIP IT SEALED</button>
                      </div>
                    </div>
                  )
                }
                const endsMs = new Date(r.endsAt ?? 0).getTime() - now
                const deal = dealTag(r)
                return (
                  <div key={r.id} style={{ border: `1px solid ${r.leading ? 'var(--green)' : r.outbid ? 'var(--yellow, #e8b73a)' : 'var(--border)'}`, borderRadius: 8, padding: 10, marginTop: 8, display: 'flex', gap: 10 }}>
                    <div className="sealed-thumb" aria-hidden>📦</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <b className="small">{r.name}</b>
                          {deal && <span className="badge" style={{ marginLeft: 6, background: deal === 'RICH' ? 'var(--yellow, #e8b73a)' : 'var(--green)', color: '#111' }}>{deal}</span>}
                          <div className="faint small">sealed market {fmtUsd(r.market)} · {r.bids} bids{r.bids === 0 ? ' yet — open bid' : ''}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div><b>{fmtUsd(r.currentBid ?? 0)}</b>{r.myBid != null && <span className="small faint"> (you {fmtUsd(r.myBid)})</span>}</div>
                          <div className="small" style={{ color: endsMs < 15_000 ? 'var(--red, #e0644d)' : undefined }}>
                            {endsMs <= 0 ? 'hammer…' : `${countdown(r.endsAt ?? '', now)}${endsMs < 15_000 ? ' ⏱' : ''}`}
                          </div>
                        </div>
                      </div>
                      <div className="row" style={{ gap: 6, marginTop: 8 }}>
                        <input className="input" style={{ width: 110 }} placeholder={fmtUsd((r.currentBid ?? 0) + 1)} value={props.bidAmt[r.id] ?? ''}
                          onChange={(e) => props.setBidAmt({ ...props.bidAmt, [r.id]: e.target.value })} />
                        <button className="btn" disabled={props.busy} onClick={() => props.onBid(r.id, Number(props.bidAmt[r.id]) || (r.currentBid ?? 0) + 1)}>BID</button>
                        {r.leading && <span className="small" style={{ color: 'var(--green)' }}>you're leading</span>}
                        {r.outbid && <span className="small" style={{ color: 'var(--gold, #e8b73a)' }}>outbid — they came back</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </>
          )}

          {show.items.length === 0 && <div className="faint small" style={{ padding: '10px 0' }}>Nothing on the rails yet — the host is working up to the first rip.</div>}
        </div>

        {/* chat rail */}
        <div style={{ borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', maxHeight: 420 }}>
          <div className="small faint" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>CHAT</div>
          <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
            {show.chat.slice(-40).map((c, i) => (
              <div key={i} className="small" style={{ marginBottom: 4, overflowWrap: 'anywhere' }}>
                <span>{c.avatar} </span><b>{c.who}</b> <span className="faint">{c.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
