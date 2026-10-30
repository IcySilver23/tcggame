import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { TearPack, RecordMoment, glowClass, CardImg, EmptyState, FirstUseTip, fmtUsd } from '../components'
import type { LiveItem, LiveSection, LiveChannel, LiveBreakBoard } from '../api'
import { useStore } from '../store'

// ---------------------------------------------------------------------------
// 📺 Live Shopping — the Whatnot wing, drawn 1:1 on Whatnot's own chrome:
// a dark home grid of LIVE show cards (For You / Following, category chips),
// then a room: video stage with the host overlay and viewer pill, chat along
// the bottom-left, the pinned product bar with the Bid/Buy button, and the
// show's listings rail on the right. Six formats ride underneath unchanged —
// rip streams, rapid auctions, $1 sudden death (skull on the timer), team
// breaks, rip-it-or-ship-it and sealed mystery boxes.
// ---------------------------------------------------------------------------

const STYLE_ICON: Record<string, string> = { rip: '🎞', auction: '🔨', mystery: '🎁', sudden: '💵', teambreak: '🧩', ripship: '🚚' }
const STYLE_LABEL: Record<string, string> = { rip: 'Rip streams', auction: 'Auctions', mystery: 'Mystery boxes', sudden: 'Sudden death', teambreak: 'Team breaks', ripship: 'Rip it or ship it' }
/** Chip order on the home grid — fixed, so muscle memory holds. */
const CAT_ORDER = ['rip', 'auction', 'mystery', 'sudden', 'teambreak', 'ripship']

const hueOf = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

/** Auction clocks read like the real thing: 0:12, not "12s". */
function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

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

// Following lives on the device, like the real app's local follow state.
const FOLLOW_KEY = 'wn-following'
function readFollow(): string[] {
  try { return JSON.parse(localStorage.getItem(FOLLOW_KEY) ?? '[]') as string[] } catch { return [] }
}

// Sealed/no-card lots stay inert — there's nothing to inspect behind the box.
// Card-lot thumbs arm CardImg's built-in hover-zoom + click-to-open via cardId.
function ZoomThumb({ item, small }: { item: LiveItem; small?: boolean }) {
  if (!item.image || !item.cardId) return <CardImg src={item.image} alt={item.name} className={small ? 'live-thumb-sm' : 'live-thumb'} />
  return <CardImg src={item.image} alt={item.name} className={small ? 'live-thumb-sm' : 'live-thumb'} cardId={item.cardId} />
}

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
  const { toast, refreshState } = useStore()
  const [data, setData] = useState<LiveSection | null>(null)
  const [busy, setBusy] = useState(false)
  const [bidAmt, setBidAmt] = useState<Record<number, string>>({})
  const snipedRef = useRef<Set<number>>(new Set())
  const [reveal, setReveal] = useState<{ paid: number; cards: { name: string; value: number }[]; total: number } | null>(null)
  const [tearing, setTearing] = useState<{ name: string; symbol: string | null; image: string | null; reveal: { paid: number; cards: { name: string; value: number }[]; total: number }; hits: { name: string; cardId: string; image: string | null; value: number }[] | null; recordValue: number | null; packRecordValue: number | null } | null>(null)
  const [hitcam, setHitcam] = useState<{ name: string; cardId: string; image: string | null; value: number }[] | null>(null)
  const [camIdx, setCamIdx] = useState(0)
  const [clockSkew, setClockSkew] = useState(0)
  const [tick, setTick] = useState(0)

  // Browsing vs. being in a room. `null` = home grid, like the app's feed.
  const [watched, setWatched] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'foryou' | 'following'>('foryou')
  const [cat, setCat] = useState<string>('all')
  const [following, setFollowing] = useState<string[]>(() => readFollow())
  // Chat you type yourself — the room echoes it locally, no server write.
  const [myChat, setMyChat] = useState<{ at: number; who: string; avatar: string; text: string }[]>([])
  const [draft, setDraft] = useState('')

  const load = () => api.live(watched ?? undefined).then((d) => {
    setData(d)
    if (d.currentShow) setClockSkew(Date.now() - new Date(d.currentShow.serverNow).getTime())
  }).catch(() => {})
  useEffect(() => { load() }, [watched])
  // Live room polls like a stream; a 1s ticker keeps countdowns honest.
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
  const channels = data?.channels ?? []
  const watchedShow = watched != null ? channels.find((c) => c.showId === watched) : null
  useEffect(() => {
    if (watched != null && !watchedShow) setWatched(null) // channel wrapped — snap back home
  }, [watched, watchedShow])

  const toggleFollow = (host: string) => {
    setFollowing((prev) => {
      const next = prev.includes(host) ? prev.filter((h) => h !== host) : [...prev, host]
      try { localStorage.setItem(FOLLOW_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }

  // A stale watched id (fetched a beat ago) shows a tuning state rather than
  // flashing another host's room.
  const roomPending = watched != null && (!show || show.id !== watched)

  const catList = CAT_ORDER.filter((s) => channels.some((c) => c.style === s))

  const handleMystery = async (id: number) => {
    const best = await api.pullsBest().catch(() => ({ value: 0, bestPackTotal: 0 }))
    run(() => api.liveMystery(id), () => 'Paid — the reveal is up.').then((r) => {
      if (r && r.ok) {
        const product = show?.product
        const recordCard = best.value > 0 ? (r.cards as { value: number }[]).find((c) => c.value > best.value) : undefined
        const packRecordValue = (best.bestPackTotal ?? 0) > 0 && r.total! > best.bestPackTotal! ? r.total! : null
        setTearing({ name: product?.name ?? 'Mystery pile', symbol: product?.symbol ?? null, image: product?.image ?? null, reveal: { paid: r.paid, cards: r.cards, total: r.total }, hits: null, recordValue: recordCard ? recordCard.value : null, packRecordValue })
      }
    })
  }

  const handleChoose = async (id: number, choice: 'rip' | 'ship') => {
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
          const product = show?.product
          setTearing({ name: product?.name ?? 'Booster pack', symbol: product?.symbol ?? null, image: product?.image ?? null, reveal: { paid: r.paid!, cards: r.cards!, total: r.total! }, hits, recordValue, packRecordValue })
        }
      })
  }

  const onBid = (id: number, amt: number) =>
    run(() => api.liveBid(id, amt), (r) => r.leading ? `You're leading at ${fmtUsd(r.current)}${r.extended ? ' — hammer extended' : ''}.` : `Outbid — the room is at ${fmtUsd(r.current)}.`)
  const onSnipe = (id: number) => {
    if (snipedRef.current.has(id)) return
    snipedRef.current.add(id)
    run(() => api.liveSnipe(id), (r) => r.stolen ? `⚡ SNIPE! Stolen at the buzzer for ${fmtUsd(r.paid)} — ${r.card} is yours.` : `Bid landed at ${fmtUsd(r.paid)} — the window hadn't opened yet.`)
      .then(() => { setTimeout(() => snipedRef.current.delete(id), 4000) })
  }
  const onBin = (id: number) => run(() => api.liveBin(id), (r) => `Won — ${r.card} for ${fmtUsd(r.paid)}. In the binder.`)

  // Entering a room clears your typed lines — chat belongs to that show.
  const enter = (showId: number) => { setMyChat([]); setDraft(''); setWatched(showId) }

  const sendChat = () => {
    const text = draft.trim()
    if (!text) return
    setMyChat((m) => [...m, { at: Date.now(), who: 'you', avatar: '🧢', text }])
    setDraft('')
  }

  const followingSet = useMemo(() => new Set(following), [following])
  const q = query.trim().toLowerCase()
  const gridChannels = channels.filter((c) => {
    if (tab === 'following' && !followingSet.has(c.host)) return false
    if (cat !== 'all' && c.style !== cat) return false
    if (q && !(`${c.host} ${c.product}`.toLowerCase().includes(q))) return false
    return true
  })

  return (
    <div className="wn">
      {watched == null ? (
        // ------------------------------------------------------------- HOME
        <>
          <header className="wn-top">
            <span className="wn-logo">whatnot</span>
            <div className="wn-search">
              <span aria-hidden>🔍</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search shows, sellers and cards" />
            </div>
          </header>

          <FirstUseTip surface="live">
            Tap a show to enter. 🔨 <b>Auctions</b> anti-snipe · 💀 <b>Sudden Death</b> never extends · 🧩 <b>Breaks</b> claim a species · 🚚 <b>Rip it or ship it</b> · 🎁 <b>Mystery boxes</b> hide a hit
          </FirstUseTip>

          <div className="wn-tabs" role="tablist" aria-label="Feed">
            {(['foryou', 'following'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={`wn-tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
                {t === 'foryou' ? 'For You' : 'Following'}
              </button>
            ))}
          </div>

          <div className="wn-cats">
            {[['all', 'All'], ...catList.map((s) => [s, STYLE_LABEL[s]])].map(([id, label]) => (
              <button key={id} className={`wn-chip ${cat === id ? 'on' : ''}`} onClick={() => setCat(id)}>
                <span aria-hidden>{id === 'all' ? '✨' : STYLE_ICON[id]}</span> {label}
              </button>
            ))}
          </div>

          {channels.length === 0 ? (
            <EmptyState icon="📺" text="Channels warming up" sub="The pack catalog is still seeding — rooms open the moment there are products to rip. Three rooms are always live once it lands." />
          ) : gridChannels.length === 0 ? (
            <EmptyState
              icon={tab === 'following' ? '🫥' : '🔍'}
              text={tab === 'following' ? "You're not following anyone yet" : 'Nothing matches that'}
              sub={tab === 'following'
                ? 'Follow a seller from any show card and their rooms land here first.'
                : 'Clear the search or pick another category — six formats are running right now.'}
              action={{ label: 'Show everything', onClick: () => { setQuery(''); setCat('all'); setTab('foryou') } }}
            />
          ) : (
            <div className="wn-grid">
              {gridChannels.map((c) => (
                <ShowCard key={c.showId} c={c} now={now} following={followingSet.has(c.host)} onFollow={() => toggleFollow(c.host)} onEnter={() => enter(c.showId)} />
              ))}
            </div>
          )}

          {data && data.hosts.length > 0 && (
            <section className="wn-shelf">
              <h2 className="wn-shelf-h">Top sellers</h2>
              <div className="wn-sellers">
                {data.hosts.map((h) => (
                  <div key={h.name} className="wn-seller">
                    <span className="wn-ava lg" style={{ background: `linear-gradient(140deg,hsl(${hueOf(h.name)} 45% 32%),hsl(${(hueOf(h.name) + 40) % 360} 45% 20%))` }}>{h.avatar}</span>
                    <div className="wn-seller-b">
                      <b>{h.name}</b>
                      <span className="wn-dim">{STYLE_ICON[h.style] ?? '📺'} {STYLE_LABEL[h.style] ?? h.style} · {h.followers.toLocaleString()} followers · ★ {h.rating.toFixed(1)}</span>
                      <span className="wn-dim wn-note">{h.note}</span>
                    </div>
                    <button className={`wn-follow ${followingSet.has(h.name) ? 'on' : ''}`} onClick={() => toggleFollow(h.name)}>
                      {followingSet.has(h.name) ? 'Following' : 'Follow'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data && data.recentShows.length > 0 && (
            <section className="wn-shelf">
              <h2 className="wn-shelf-h">Recent shows</h2>
              <div className="wn-list">
                {data.recentShows.map((s) => (
                  <div key={s.id} className="wn-line">
                    <span className="wn-ava" style={{ background: `linear-gradient(140deg,hsl(${hueOf(s.host)} 45% 32%),hsl(${(hueOf(s.host) + 40) % 360} 45% 20%))` }}>{s.avatar}</span>
                    <span className="wn-line-b"><b>{s.host}</b><span className="wn-dim">{s.rips} rips{s.bestPull ? ` · best ${s.bestPull.name} (${fmtUsd(s.bestPull.value)})` : ''}</span></span>
                    <span className="wn-line-r">{fmtUsd(s.proceeds)} <span className="wn-dim">spent</span></span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data && data.wins.length > 0 && (
            <section className="wn-shelf">
              <h2 className="wn-shelf-h">Your wins</h2>
              <div className="wn-list">
                {data.wins.slice(0, 8).map((w, i) => (
                  <div key={i} className="wn-line">
                    <span className="wn-line-b"><b>{w.card}{w.variant !== 'normal' ? ` (${w.variant})` : ''}</b><span className="wn-dim">from {w.host}</span></span>
                    <span className={`wn-line-r ${w.value >= w.paid ? 'up' : 'down'}`}>{fmtUsd(w.paid)} → {fmtUsd(w.value)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data && data.upcoming.length > 0 && (
            <section className="wn-shelf">
              <h2 className="wn-shelf-h">Scheduled</h2>
              <div className="wn-list">
                {data.upcoming.slice(0, 4).map((u, i) => (
                  <div key={i} className="wn-line">
                    <span className="wn-ava" style={{ background: `linear-gradient(140deg,hsl(${hueOf(u.host)} 45% 32%),hsl(${(hueOf(u.host) + 40) % 360} 45% 20%))` }}>{u.avatar}</span>
                    <span className="wn-line-b"><b>{u.title}</b><span className="wn-dim">{u.host} · {new Date(u.start).toLocaleDateString([], { weekday: 'short' })} {localTime(u.start)}–{localTime(u.end)}</span></span>
                    <span className={`wn-line-r ${u.now ? 'up' : ''}`}>{u.now ? 'LIVE' : `in ${countdown(u.start, now)}`}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        // ------------------------------------------------------------- ROOM
        <>
          <div className="wn-room-bar">
            <button className="wn-back" onClick={() => setWatched(null)}>← All shows</button>
            <span className="wn-dim">{watchedShow ? `${watchedShow.host}'s room · ${STYLE_LABEL[watchedShow.style] ?? 'live'}` : 'tuning in…'}</span>
          </div>

          {roomPending || !show ? (
            <div className="wn-tuning">
              <span className="wn-tuning-dot" />
              Tuning in…
            </div>
          ) : (
            <div className="wn-room">
              <div className="wn-stage" style={{ '--h': hueOf(show.host?.name ?? 'live') } as React.CSSProperties}>
                {/* the stream */}
                <div className="wn-cam">
                  <div className="wn-cam-glow" />
                  {show.product.image
                    ? <img className="wn-cam-art" src={show.product.image} alt="" />
                    : <span className="wn-cam-emoji">{show.host?.avatar ?? '📺'}</span>}
                </div>

                {/* host overlay, top-left */}
                <div className="wn-ov">
                  <span className="wn-live">LIVE</span>
                  <span className="wn-ava sm">{show.host?.avatar}</span>
                  <span className="wn-handle">{show.host?.name}</span>
                  <button className={`wn-follow sm ${followingSet.has(show.host?.name ?? '') ? 'on' : ''}`} onClick={() => show.host && toggleFollow(show.host.name)}>
                    {followingSet.has(show.host?.name ?? '') ? 'Following' : 'Follow'}
                  </button>
                  <span className="wn-pill">★ {show.host?.rating.toFixed(1)}</span>
                </div>

                {/* viewers, top-right — the viewer list lives behind this pill */}
                <div className="wn-ov-r">
                  <span className="wn-pill">👁 {show.viewers.toLocaleString()}</span>
                  <span className="wn-pill">ends in {countdown(show.endsAt, now)}</span>
                </div>

                {/* chat ticker along the bottom-left, like the real overlay */}
                <div className="wn-ticker">
                  {[...show.chat, ...myChat].slice(-3).map((c, i) => (
                    <div key={i}><b>{c.who}</b> {c.text}</div>
                  ))}
                </div>

                {/* pinned product bar */}
                <PinnedBar
                  item={pickPinned(show.items)}
                  now={now}
                  busy={busy}
                  bid={bidAmt}
                  setBid={setBidAmt}
                  leading={(i) => show.items.find((x) => x.id === i)?.leading ?? false}
                  onBid={onBid}
                  onSnipe={onSnipe}
                  onBin={onBin}
                  onMystery={handleMystery}
                  onChoose={handleChoose}
                />
              </div>

              <aside className="wn-side">
                <div className="wn-panel wn-listings">
                  <div className="wn-panel-h">
                    <b>Show listings</b>
                    <span className="wn-dim">{show.items.filter((i) => i.kind !== 'teamspot').length} items</span>
                  </div>
                  <ListingRail
                    show={show}
                    now={now}
                    busy={busy}
                    bid={bidAmt}
                    setBid={setBidAmt}
                    onBid={onBid}
                    onSnipe={onSnipe}
                    onBin={onBin}
                    onMystery={handleMystery}
                    onSpot={(itemId, spotId) => run(() => api.liveSpot(itemId, spotId), (r) => `Spot claimed — ${r.team} is yours; its pulls land at settle.`)}
                    onChoose={handleChoose}
                  />
                </div>

                <div className="wn-panel wn-chat">
                  <div className="wn-panel-h"><b>Chat</b><span className="wn-dim">{show.viewers.toLocaleString()} watching</span></div>
                  <div className="wn-chat-log">
                    {[...show.chat, ...myChat].slice(-40).map((c, i) => (
                      <div key={i} className="wn-msg"><b>{c.who}</b> {c.text}</div>
                    ))}
                  </div>
                  <div className="wn-chat-in">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') sendChat() }}
                      placeholder="Say something…"
                      maxLength={120}
                    />
                    <button className="wn-send" onClick={sendChat} aria-label="Send message">➤</button>
                  </div>
                </div>
              </aside>
            </div>
          )}
        </>
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
// HOME — a show card from the feed.
// ---------------------------------------------------------------------------

function ShowCard({ c, now, following, onFollow, onEnter }: { c: LiveChannel; now: number; following: boolean; onFollow: () => void; onEnter: () => void }) {
  const h = hueOf(c.host)
  return (
    <div className="wn-card">
      <button className="wn-thumb" onClick={onEnter} style={{ '--h': h } as React.CSSProperties} title={`Watch ${c.host}`}>
        {c.image
          ? <img className="wn-thumb-art" src={c.image} alt="" loading="lazy" />
          : <span className="wn-thumb-ava">{c.avatar}</span>}
        <span className="wn-live">LIVE</span>
        <span className="wn-thumb-view">👁 {c.viewers.toLocaleString()}</span>
        <span className="wn-thumb-title">{c.product}</span>
        <span className="wn-thumb-foot">
          <span aria-hidden>{STYLE_ICON[c.style] ?? '📺'}</span> {STYLE_LABEL[c.style] ?? c.style}
        </span>
      </button>
      <div className="wn-card-b">
        <span className="wn-ava sm" style={{ background: `linear-gradient(140deg,hsl(${h} 45% 32%),hsl(${(h + 40) % 360} 45% 20%))` }}>{c.avatar}</span>
        <span className="wn-card-names">
          <b>{c.host}</b>
          <span className="wn-dim">{c.followers.toLocaleString()} followers · ★ {c.rating.toFixed(1)} · ends in {countdown(c.endsAt, now)}</span>
        </span>
        <button className={`wn-follow sm ${following ? 'on' : ''}`} onClick={onFollow}>{following ? 'Following' : 'Follow'}</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PINNED BAR — Whatnot pins one product to the bottom of the stage with its
// image, title, price and the one button you need. Ours pins the most urgent
// thing in the room: your won rip-pack, the auction closing soonest, or the
// next buy-it-now.
// ---------------------------------------------------------------------------

function pickPinned(items: LiveItem[]): LiveItem | null {
  const won = items.find((i) => i.kind === 'ripship' && i.status === 'pending')
  if (won) return won
  const timed = items
    .filter((i) => (i.kind === 'auction' || i.kind === 'sudden') && i.status === 'open' && i.endsAt)
    .sort((a, b) => new Date(a.endsAt ?? 0).getTime() - new Date(b.endsAt ?? 0).getTime())
  if (timed.length) return timed[0]
  return items.find((i) => i.kind === 'drop' && i.status === 'open')
    ?? items.find((i) => i.kind === 'mystery' && i.status === 'open')
    ?? items.find((i) => i.kind === 'ripship' && i.status === 'open')
    ?? null
}

function PinnedBar({ item, now, busy, bid, setBid, onBid, onSnipe, onBin, onMystery, onChoose, leading }: {
  item: LiveItem | null
  now: number
  busy: boolean
  bid: Record<number, string>
  setBid: (x: Record<number, string>) => void
  leading: (id: number) => boolean
  onBid: (id: number, amt: number) => void
  onSnipe: (id: number) => void
  onBin: (id: number) => void
  onMystery: (id: number) => void
  onChoose: (id: number, choice: 'rip' | 'ship') => void
}) {
  if (!item) return null
  const endsMs = item.endsAt ? new Date(item.endsAt).getTime() - now : 0
  const isTimed = item.kind === 'auction' || item.kind === 'sudden'
  const isSudden = item.kind === 'sudden'
  const lead = leading(item.id)
  const outbid = !lead && item.outbid
  const price = isTimed ? (item.currentBid ?? item.ask ?? 0) : (item.ask ?? 0)

  return (
    <div className={`wn-pin ${lead ? 'lead' : outbid ? 'out' : ''}`}>
      <ZoomThumb item={item} small />
      <div className="wn-pin-b">
        <b>{item.kind === 'ripship' && item.status === 'pending' ? `🏆 You won ${item.name}` : item.name}</b>
        <span className="wn-dim">
          {item.kind === 'mystery' ? 'contents hidden — the host’s honesty is the only tell'
            : isTimed ? `${item.bids} bids · market ${fmtUsd(item.market)}`
            : <>market {fmtUsd(item.market)}{item.bids ? ` · ${item.bids} bids` : ''}</>}
        </span>
      </div>
      <div className="wn-pin-price">
        <b>{fmtUsd(price)}</b>
        {isTimed && (
          <span className={`wn-clock ${endsMs < 15_000 ? 'hot' : ''}`}>
            {isSudden && <span title="Sudden Death — no extensions">☠ </span>}
            {endsMs <= 0 ? 'hammer…' : mmss(endsMs)}
          </span>
        )}
      </div>
      <div className="wn-pin-act">
        {item.kind === 'ripship' && item.status === 'pending' ? (
          <>
            <button className="wn-cta" disabled={busy} onClick={() => onChoose(item.id, 'rip')}>Rip it on stream</button>
            <button className="wn-cta ghost" disabled={busy} onClick={() => onChoose(item.id, 'ship')}>Ship it sealed</button>
          </>
        ) : isTimed ? (
          endsMs <= 0 ? (
            <button className="wn-cta" disabled={busy}>Hammering…</button>
          ) : isSudden && endsMs <= 2_000 ? (
            <button className="wn-cta snipe" disabled={busy} onClick={() => onSnipe(item.id)}>⚡ Snipe {fmtUsd((item.currentBid ?? 0) + 1)}</button>
          ) : (
            <>
              <input className="wn-bidin" value={bid[item.id] ?? ''} placeholder={fmtUsd((item.currentBid ?? 0) + 1)}
                onChange={(e) => setBid({ ...bid, [item.id]: e.target.value })} />
              <button className="wn-cta" disabled={busy} onClick={() => onBid(item.id, Number(bid[item.id]) || (item.currentBid ?? 0) + 1)}>
                {lead ? 'Leading' : 'Bid'}
              </button>
            </>
          )
        ) : (
          <button className="wn-cta" disabled={busy} onClick={() => (item.kind === 'mystery' ? onMystery(item.id) : onBin(item.id))}>
            {item.kind === 'mystery' ? 'Buy & reveal' : 'Buy now'}
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LISTING RAIL — the right-hand "Show listings" panel: filter chips, then one
// row per listing. Sudden Death rows carry the skull on the timer, because
// that hammer never extends.
// ---------------------------------------------------------------------------

type Filt = 'all' | 'buy' | 'auction' | 'sudden' | 'break' | 'rip'

function ListingRail({ show, now, busy, bid, setBid, onBid, onSnipe, onBin, onMystery, onSpot, onChoose }: {
  show: NonNullable<LiveSection['currentShow']>
  now: number
  busy: boolean
  bid: Record<number, string>
  setBid: (x: Record<number, string>) => void
  onBid: (id: number, amt: number) => void
  onSnipe: (id: number) => void
  onBin: (id: number) => void
  onMystery: (id: number) => void
  onSpot: (itemId: number, spotId: number) => void
  onChoose: (id: number, choice: 'rip' | 'ship') => void
}) {
  const [filt, setFilt] = useState<Filt>('all')
  const items = show.items.filter((i) => i.kind !== 'teamspot')
  const counts: Record<Filt, number> = {
    all: items.length,
    buy: items.filter((i) => i.kind === 'drop' || i.kind === 'mystery').length,
    auction: items.filter((i) => i.kind === 'auction').length,
    sudden: items.filter((i) => i.kind === 'sudden').length,
    rip: items.filter((i) => i.kind === 'ripship').length,
    break: (show.boards ?? []).length,
  }
  const match = (i: LiveItem) =>
    filt === 'all' ? true
      : filt === 'buy' ? (i.kind === 'drop' || i.kind === 'mystery')
      : filt === 'auction' ? i.kind === 'auction'
      : filt === 'sudden' ? i.kind === 'sudden'
      : filt === 'rip' ? i.kind === 'ripship'
      : false

  // Order reads the way a room moves: your won pack, live clocks, then buy-now.
  const rank = (i: LiveItem) =>
    i.status === 'pending' ? 0
      : i.kind === 'auction' ? 1
      : i.kind === 'sudden' ? 2
      : i.kind === 'ripship' ? 3
      : i.kind === 'drop' ? 4 : 5
  const rows = items.filter(match).sort((a, b) => {
    const r = rank(a) - rank(b)
    if (r !== 0) return r
    return new Date(a.endsAt ?? 0).getTime() - new Date(b.endsAt ?? 0).getTime()
  })
  const showBoards = filt === 'all' || filt === 'break'

  const chips: [Filt, string][] = [
    ['all', 'All'], ['buy', 'Buy it now'], ['auction', 'Auctions'], ['sudden', '☠ Sudden Death'], ['rip', 'Rip it or ship it'], ['break', 'Breaks'],
  ]

  return (
    <>
      <div className="wn-filters">
        {chips.map(([id, label]) => (
          <button key={id} className={`wn-chip sm ${filt === id ? 'on' : ''}`} onClick={() => setFilt(id)} disabled={counts[id] === 0 && id !== 'all'}>
            {label}{counts[id] > 0 && <span className="wn-chip-n">{counts[id]}</span>}
          </button>
        ))}
      </div>

      <div className="wn-rows">
        {rows.length === 0 && !(showBoards && (show.boards ?? []).length > 0) && (
          <div className="wn-empty">Nothing on the rails yet — the host is working up to the first rip.</div>
        )}

        {rows.map((it) => (
          <RailRow key={it.id} it={it} now={now} busy={busy} bid={bid} setBid={setBid}
            onBid={onBid} onSnipe={onSnipe} onBin={onBin} onMystery={onMystery} onChoose={onChoose} />
        ))}

        {showBoards && (show.boards ?? []).map((b) => (
          <BoardCard key={b.itemId} b={b} busy={busy} onSpot={onSpot} />
        ))}
      </div>
    </>
  )
}

function RailRow({ it, now, busy, bid, setBid, onBid, onSnipe, onBin, onMystery, onChoose }: {
  it: LiveItem
  now: number
  busy: boolean
  bid: Record<number, string>
  setBid: (x: Record<number, string>) => void
  onBid: (id: number, amt: number) => void
  onSnipe: (id: number) => void
  onBin: (id: number) => void
  onMystery: (id: number) => void
  onChoose: (id: number, choice: 'rip' | 'ship') => void
}) {
  const endsMs = it.endsAt ? new Date(it.endsAt).getTime() - now : 0
  const isTimed = it.kind === 'auction' || it.kind === 'sudden'
  const isSudden = it.kind === 'sudden'
  const price = isTimed ? (it.currentBid ?? it.ask ?? 0) : (it.ask ?? 0)
  const deal = dealTag(it)
  const state = it.status === 'pending' ? 'won' : it.leading ? 'lead' : it.outbid ? 'out' : ''

  if (it.status === 'pending') {
    return (
      <div className="wn-row won">
        <ZoomThumb item={it} small />
        <div className="wn-row-b">
          <b className="wn-ell">🏆 You won — {it.name}</b>
          <span className="wn-dim">Winner's call: rip it on stream, or it ships home sealed.</span>
          <div className="wn-row-act">
            <button className="wn-cta sm" disabled={busy} onClick={() => onChoose(it.id, 'rip')}>📺 Rip it</button>
            <button className="wn-cta sm ghost" disabled={busy} onClick={() => onChoose(it.id, 'ship')}>📦 Ship it</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`wn-row ${state}`}>
      <ZoomThumb item={it} small />
      <div className="wn-row-b">
        <b className="wn-ell" title={it.name}>{it.name}</b>
        <span className="wn-dim">
          {it.kind === 'mystery' ? 'contents hidden' : <>market {fmtUsd(it.market)}</>}
          {deal && <span className={`wn-deal ${deal === 'RICH' ? 'rich' : ''}`}>{deal === 'DEAL' ? 'DEAL' : 'OVERPRICED'}</span>}
          {isSudden && <span className="wn-sd">Sudden Death</span>}
        </span>
        <div className="wn-row-act">
          <span className="wn-price">
            {fmtUsd(price)}
            {isTimed && <span className={`wn-clock ${endsMs < 15_000 ? 'hot' : ''}`}>{isSudden && '☠ '}{endsMs <= 0 ? 'hammer…' : mmss(endsMs)}</span>}
            {it.leading && <span className="wn-flag lead">you're leading</span>}
            {it.outbid && !it.leading && <span className="wn-flag out">outbid</span>}
          </span>
          {isTimed ? (
            endsMs <= 0 ? <span className="wn-cta sm ghost">closing</span>
              : isSudden && endsMs <= 2_000
                ? <button className="wn-cta sm snipe" disabled={busy} onClick={() => onSnipe(it.id)}>⚡ Snipe</button>
                : <>
                    <input className="wn-bidin sm" value={bid[it.id] ?? ''} placeholder={fmtUsd((it.currentBid ?? 0) + 1)}
                      onChange={(e) => setBid({ ...bid, [it.id]: e.target.value })} />
                    <button className="wn-cta sm" disabled={busy} onClick={() => onBid(it.id, Number(bid[it.id]) || (it.currentBid ?? 0) + 1)}>Bid</button>
                  </>
          ) : (
            <button className="wn-cta sm" disabled={busy} onClick={() => (it.kind === 'mystery' ? onMystery(it.id) : onBin(it.id))}>
              {it.kind === 'mystery' ? 'Reveal' : 'Buy'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function BoardCard({ b, busy, onSpot }: { b: LiveBreakBoard; busy: boolean; onSpot: (itemId: number, spotId: number) => void }) {
  const taken = b.spots.filter((s) => s.holder).length
  return (
    <div className="wn-board">
      <div className="wn-board-h">
        <b>🧩 Team break</b>
        <span className="wn-dim">{taken}/{b.spots.length} claimed · pulls pay the species owner at settle</span>
      </div>
      <div className="wn-spots">
        {b.spots.map((s) => (
          <div key={s.id} className={`wn-spot ${s.mine ? 'mine' : ''} ${s.holder && !s.mine ? 'taken' : ''}`}>
            <b className="wn-ell">{s.team}</b>
            <span>{s.mine ? 'yours ✓' : s.holder ? s.holder : fmtUsd(s.ask)}</span>
            {!s.holder && (
              <button className="wn-cta sm" disabled={busy} onClick={() => onSpot(b.itemId, s.id)}>Claim</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function dealTag(item: LiveItem): 'DEAL' | 'RICH' | null {
  if (item.kind === 'mystery') return item.ask != null && item.market > 0 ? (item.ask < item.market * 0.9 ? 'DEAL' : item.ask > item.market * 1.1 ? 'RICH' : null) : null
  if (item.ask == null || item.market <= 0) return null
  const ratio = item.ask / item.market
  return ratio < 0.85 ? 'DEAL' : ratio > 1.25 ? 'RICH' : null
}
