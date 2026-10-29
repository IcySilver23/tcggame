import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { CardImg, EmptyState, fmtUsd, TearPack, glowClass, packHue } from '../components'
// The official Pokémon card back, bundled into the build (no network, works
// in the packaged exe) — every reveal turns from this print.
import cardBack from '../assets/card-back.png'
import { takeOpeningHandoff } from '../store'
import { flipSwish, hitStinger } from '../audio'
import type { OpenSession, OpenedCard, ProductRow } from '../types'

type Phase = 'idle' | 'pack' | 'revealing' | 'summary'
type Stage = 'hold' | 'flip' | 'landed' // where the card on stage is in its ceremony
type Tier = 'common' | 'super' | 'epic' | 'massive' | 'ghost'

// Ceremony timing per tier (ms): the back swings in and holds its breath
// (hold), turns over (flip), then sits with its value while the beat lands
// (beat) before the next card. Big pulls hold longer on purpose — the
// anticipation IS the pull.
const TIMING: Record<Tier, { hold: number; flip: number; beat: number }> = {
  common: { hold: 400, flip: 460, beat: 480 },
  super: { hold: 650, flip: 560, beat: 700 },
  epic: { hold: 1000, flip: 660, beat: 1050 },
  massive: { hold: 1250, flip: 740, beat: 1300 },
  ghost: { hold: 1250, flip: 740, beat: 1300 },
}
const FAST_TIMING = { hold: 60, flip: 160, beat: 160 }

function tierOf(card: OpenedCard): Tier {
  if (card.variant && card.variant.startsWith('1stEdition')) return 'ghost'
  if (card.value >= 150) return 'massive'
  if (card.value >= 60 || (card.isHit && card.value >= 40)) return 'epic'
  if (card.isHit || card.value >= 8) return 'super'
  return 'common'
}

// ---------------------------------------------------------------------------
// Reactive card-image lookup (the open API returns IDs; images come from cards)
// ---------------------------------------------------------------------------

const imgCache = new Map<string, string | null>()
const imgPending = new Set<string>()
const imgWaiters = new Set<() => void>()

function useCardImage(cardId: string): string | null {
  const [, bump] = useState(0)
  useEffect(() => {
    const notify = () => bump((n) => n + 1)
    imgWaiters.add(notify)
    if (!imgCache.has(cardId) && !imgPending.has(cardId)) {
      imgPending.add(cardId)
      api
        .cardDetail(cardId)
        .then((d) => imgCache.set(cardId, d.card.image_small))
        .catch(() => imgCache.set(cardId, null))
        .finally(() => {
          imgPending.delete(cardId)
          imgWaiters.forEach((w) => w())
        })
    }
    return () => { imgWaiters.delete(notify) }
  }, [cardId])
  return imgCache.get(cardId) ?? null
}

function CountUp({ value, dur }: { value: number; dur: number }) {
  const [n, setN] = useState(dur <= 0 ? value : 0)
  useEffect(() => {
    if (dur <= 0) { setN(value); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      setN(value * (1 - Math.pow(1 - p, 3))) // ease-out: races up, settles soft
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, dur])
  return <>{fmtUsd(n)}</>
}

function RevealCard({ card, tier, stage, fast, hold, flip, hue }: {
  card: OpenedCard
  tier: Tier
  stage: Stage
  fast: boolean
  hold: number
  flip: number
  hue: number
}) {
  const src = useCardImage(card.cardId)
  const flipped = stage === 'flip' || stage === 'landed'
  const big = tier === 'epic' || tier === 'massive' || tier === 'ghost'
  const glowy = big || tier === 'super'
  return (
    <div
      className={`po-flip-wrap ${flipped ? 'flipped' : ''} ${fast ? 'snap' : ''}`}
      data-tier={tier}
      style={{
        '--bh': hue,
        '--swing': '360ms',
        '--hold': `${Math.max(120, hold - 360)}ms`,
        '--flipdur': `${flip}ms`,
      } as CSSProperties}
    >
      {glowy && <div className="po-aura" aria-hidden />}
      {big && <div className="po-rays" aria-hidden />}
      <div className="po-flipper">
        <div className="po-face po-back po-back-real">
          <img className="po-back-art" src={cardBack} alt="" />
        </div>
        <div className="po-face po-front">
          <CardImg src={src} alt={card.cardId} cardId={card.cardId} />
        </div>
      </div>
      {stage === 'landed' && big && <div className="po-flash" aria-hidden />}
      {stage === 'landed' && card.isNew && <div className="po-new-tag">✨ NEW</div>}
    </div>
  )
}



// ---------------------------------------------------------------------------

export function PackOpeningView() {
  const { toast, refreshState } = useStore()
  const [products, setProducts] = useState<ProductRow[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [queue, setQueue] = useState<OpenedCard[]>([])
  const [idx, setIdx] = useState(0) // card currently on stage
  const [stage, setStage] = useState<Stage>('hold')
  const stungRef = useRef(-1) // last idx whose landing played its stinger
  // The back's face: the pack's hue, kept for the whole ceremony (the card
  // back itself is the official Pokémon print; the hue drives aura/glow).
  const [backArt, setBackArt] = useState<{ hue: number }>({ hue: 215 })
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true, [])
  const [session, setSession] = useState<OpenSession | null>(null)
  const [fast, setFast] = useState(false)
  const [sealedStock, setSealedStock] = useState<{ product_id: string; quantity: number }[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  // The tear-open ceremony: the pack exists on screen first — hold and pull
  // down (or press Enter) to rip the foil, then the card reveal begins.
  const [pendingPack, setPendingPack] = useState<{ name: string; sub: string; cards: number; spent: number; symbol: string | null; image: string | null } | null>(null)
  const [wantAuto, setWantAuto] = useState(false)
  // The record chase: when a pack beats your best pull on record, the screen
  // edges catch fire and the summary wears the crown. previousBest is the
  // record *before* this session (fetched when the ceremony begins), so the
  // comparison is fair even though the server has already written the pulls.
  const [previousBest, setPreviousBest] = useState(0)
  const [record, setRecord] = useState<{ cardId: string; value: number } | null>(null)
  // The second chase: best single-PACK total (the whole rip's worth, not one
  // card). Same fairness rule as the card record — the bar is the value
  // BEFORE this session existed.
  const [prevBestPack, setPrevBestPack] = useState(0)
  // Pack Shop handoff, captured into state on mount: state survives React
  // StrictMode's double effect-invoke, a module slot does not — the first
  // effect run would otherwise consume the handoff and be thrown away.
  const [handoff, setHandoff] = useState<import('../store').OpeningHandoff | null>(null)

  const loadSealed = useCallback(() => {
    api.pullsSummary().then((r) => {
      setSealedStock((r.sealedInStock as { product_id: string; quantity: number }[]) ?? [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    api.products().then(setProducts).catch(() => {})
    loadSealed()
    const h = takeOpeningHandoff()
    if (h) setHandoff(h)
  }, [loadSealed])

  // Pack Shop handoff: the purchase already happened (and wrote pull
  // history), so fetch both record bars now — this is the honest "before"
  // for any record this session set — then run the ceremony.
  useEffect(() => {
    if (!handoff) return
    api.pullsBest().then((best) => {
      beginCeremony(handoff.session, products.find((x) => x.id === handoff.productId), best.value, best.bestPackTotal ?? 0)
    }).catch(() => beginCeremony(handoff.session, products.find((x) => x.id === handoff.productId), 0, 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff])

  const beginCeremony = (s: OpenSession, product?: ProductRow, prevBest = 0, prevPack = 0) => {
    setSession(s)
    setQueue(s.cards)
    setIdx(0)
    setStage('hold')
    stungRef.current = -1
    // The record chase: the caller fetched the all-time best BEFORE opening
    // (the server writes this session's pulls during the open call, so any
    // later fetch would already include them and the comparison would lie).
    setPreviousBest(prevBest)
    setPrevBestPack(prevPack ?? 0)
    setRecord(null)
    const first = s.cards[0]
    const setName = product?.set_name ?? first?.setName ?? 'Booster pack'
    setBackArt({ hue: packHue(product?.name ?? setName) })
    const packsInBox = (s as OpenSession & { packsInBox?: number }).packsInBox ?? 1
    setPendingPack({
      name: product?.name ?? setName,
      sub: `${setName} · ${packsInBox > 1 ? `${packsInBox} packs · ${s.cards.length} cards` : `${s.cards.length} cards`}`,
      cards: s.cards.length,
      spent: s.spent,
      symbol: product?.set_symbol ?? null,
      image: product?.image_url ?? null,
    })
    setWantAuto(false)
    setPhase('pack')
    refreshState()
  }

  // Did this session's best beat the pre-session record?
  const sessionBest = useMemo(() => session?.cards.reduce((a, c) => (c.value > a.value ? c : a), session.cards[0]) ?? null, [session])
  const isRecord = !!sessionBest && sessionBest.value > previousBest && previousBest > 0

  // The shared TearPack fires onTorn the moment the rip completes; hold the
  // stage ~760ms so the flash and falling foil shards play out, then the
  // first card back swings in.
  const finishTear = useCallback(() => {
    setTimeout(() => {
      setPendingPack(null)
      setPhase('revealing')
    }, 760)
  }, [])

  const startSession = async (productId: string, qty: number) => {
    setBusy(productId)
    try {
      const best = await api.pullsBest().catch(() => ({ value: 0, bestPackTotal: 0 }))
      const res = await api.buyProduct(productId, qty, true)
      const opened = res.opened ?? []
      if (opened.length === 0) { toast('Nothing opened', 'bad'); return }
      const cards = opened.flatMap((s) => s.cards)
      const spent = opened.reduce((a, s) => a + s.spent, 0)
      const totalValue = opened.reduce((a, s) => a + s.totalValue, 0)
      // Boxes report per-pack sessions; across qty boxes the best single pack
      // is the max of every box's perPack list.
      const perPack = opened.flatMap((s) => (s as OpenSession & { perPack?: { totalValue: number }[] }).perPack ?? [])
      const packsInBox = opened.reduce((a, s) => a + ((s as OpenSession & { packsInBox?: number }).packsInBox ?? 1), 0)
      beginCeremony({ sessionId: opened[0].sessionId, cards, totalValue, spent, perPack, packsInBox } as OpenSession, products.find((x) => x.id === productId), best.value, best.bestPackTotal ?? 0)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Open failed', 'bad')
    } finally {
      setBusy(null)
    }
  }

  const openSealedOne = async (productId: string) => {
    setBusy(productId)
    try {
      const best = await api.pullsBest().catch(() => ({ value: 0, bestPackTotal: 0 }))
      beginCeremony(await api.openPack(productId), products.find((p) => p.id === productId), best.value, best.bestPackTotal ?? 0)
      loadSealed()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Open failed', 'bad')
    } finally {
      setBusy(null)
    }
  }

  // The card on stage: where it is in its ceremony, and how long this tier
  // takes. Big pulls hold longer on purpose — the anticipation IS the pull.
  const current = phase === 'revealing' ? queue[idx] : undefined
  const tier: Tier = current ? tierOf(current) : 'common'
  const timing = fast || reduced ? FAST_TIMING : TIMING[tier]
  const landed = stage === 'landed'
  const showHitBanner = Boolean(landed && current && (current.isHit || current.value >= 40))
  const remaining = queue.length - idx - (landed ? 1 : 0)

  // Stage machine: back swings in → turns over → lands with its value, then
  // a beat, then the next card (or the summary). Timers restart whenever the
  // player clicks (advance) or toggles Skip — nothing can desync the card
  // you're looking at from the timer driving it.
  useEffect(() => {
    if (phase !== 'revealing') return
    if (!queue[idx]) {
      const t = setTimeout(() => setPhase('summary'), 400)
      return () => clearTimeout(t)
    }
    if (stage === 'hold') {
      const t = setTimeout(() => setStage('flip'), timing.hold)
      return () => clearTimeout(t)
    }
    if (stage === 'flip') {
      const t = setTimeout(() => setStage('landed'), timing.flip)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      if (idx >= queue.length - 1) setPhase('summary')
      else { setIdx((i) => i + 1); setStage('hold') }
    }, timing.beat)
    return () => clearTimeout(t)
  }, [phase, stage, idx, queue, timing])

  // The turn-over swish: exactly when the card starts flipping.
  useEffect(() => {
    if (phase !== 'revealing' || stage !== 'flip') return
    const c = queue[idx]
    if (!c) return
    const t = tierOf(c)
    flipSwish(t === 'epic' || t === 'massive' || t === 'ghost')
  }, [phase, stage, idx, queue])

  // Landings: the stinger fires when a card's face lands, scaled to the pull.
  // Skipped reveals land as one jump — play only the best of the batch so it
  // doesn't turn into one long blast. The record banner rides the same moment
  // (a record pull is definitionally $150+ territory or a first-hit).
  useEffect(() => {
    if (phase !== 'revealing' || stage !== 'landed' || idx <= stungRef.current) return
    const batch = queue.slice(stungRef.current + 1, idx + 1)
    stungRef.current = idx
    if (batch.length === 0) return
    const best = batch.reduce((a, c) => (c.value > a.value ? c : a), batch[0])
    hitStinger(best.value, best.isHit)
    if (previousBest > 0 && !record && best.value > previousBest) setRecord({ cardId: best.cardId, value: best.value })
  }, [phase, stage, idx, queue, previousBest, record])

  // Click anywhere on the stage to walk the ceremony faster: hold → flip →
  // land → next card. A landed last card pushes straight to the summary.
  const advance = () => {
    if (phase !== 'revealing' || !queue[idx]) return
    if (stage === 'hold') setStage('flip')
    else if (stage === 'flip') setStage('landed')
    else if (idx < queue.length - 1) { setIdx((i) => i + 1); setStage('hold') }
    else setPhase('summary')
  }
  const revealAll = () => {
    if (queue.length === 0) return
    setIdx(queue.length - 1)
    setStage('landed')
  }

  const roi = useMemo(() => {
    if (!session || session.spent === 0) return null
    return session.totalValue / session.spent - 1
  }, [session])

  // Summary-facing record state: true when this session's best beats the
  // pre-session record (the server has already counted this session's pulls,
  // so previousBest is the honest "before" number).
  const beatRecord = !!session && !!sessionBest && sessionBest.value > previousBest && previousBest > 0
  // Second chase: this rip's best SINGLE PACK beats the pre-session
  // pack-total record. For boxes (bundle/ETB/display) the session total spans
  // many packs, so the honest number is the best per-pack session the server
  // reported — a 6-pack box shouldn't fake-beat a single-pack record.
  const bestPackOfSession = useMemo(() => {
    if (!session) return 0
    const per = (session as OpenSession & { perPack?: { totalValue: number }[] }).perPack
    if (per && per.length > 0) return Math.max(...per.map((p) => p.totalValue))
    return session.totalValue
  }, [session])
  const beatPackRecord = !!session && prevBestPack > 0 && bestPackOfSession > prevBestPack
  // How many of this rip's pulls you didn't own a single copy of before it.
  const newCount = session?.cards.filter((c) => c.isNew).length ?? 0

  const sealedProducts = products.filter((p) => sealedStock.some((s) => s.product_id === p.id))

  return (
    <div className={glowClass(beatRecord, beatPackRecord)}>
      <div className="page-head">
        <div>
          <h1>Pack Opening</h1>
          <div className="sub">The ceremony. Cards reveal one at a time — hits get the full treatment.</div>
        </div>
        <div className="chip-row">
          <span className={`chip ${!fast ? 'on' : ''}`} onClick={() => setFast(false)}>Slow reveal</span>
          <span className={`chip ${fast ? 'on' : ''}`} onClick={() => setFast(true)}>Skip animation</span>
        </div>
      </div>

      {record && (
        <div className="po-banner massive" style={{ marginBottom: 12 }}>👑 NEW BEST PULL — {fmtUsd(record.value)}!</div>
      )}

      {phase === 'idle' && (
        <div>
          <div className="panel mb14">
            <h2>Buy & open now</h2>
            <div className="grid cols2 mt8">
              {products.map((p) => (
                <div key={p.id} className="row" style={{ justifyContent: 'space-between', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '10px 12px' }}>
                  <div>
                    <b className="small">{p.name}</b>
                    <div className="faint small">{fmtUsd(p.msrp)} · {p.packs} pack{p.packs > 1 ? 's' : ''}</div>
                  </div>
                  <button className="primary small" disabled={busy === p.id} onClick={() => startSession(p.id, 1)}>OPEN</button>
                </div>
              ))}
            </div>
            {products.length === 0 && <EmptyState icon="📦" text="Shop loading…" sub="Products appear as sets sync." />}
          </div>

          {sealedProducts.length > 0 && (
            <div className="panel">
              <h2>Your sealed inventory</h2>
              <div className="grid cols2 mt8">
                {sealedProducts.map((p) => {
                  const stock = sealedStock.find((s) => s.product_id === p.id)
                  return (
                    <div key={p.id} className="row" style={{ justifyContent: 'space-between', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '10px 12px' }}>
                      <div>
                        <b className="small">{p.name}</b>
                        <div className="faint small">{stock?.quantity ?? 0} sealed</div>
                      </div>
                      <button className="small" disabled={busy === p.id} onClick={() => openSealedOne(p.id)}>OPEN 1</button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'pack' && pendingPack && (
        <div className="po-stage">          <TearPack
            symbolUrl={pendingPack.symbol}
            imageUrl={pendingPack.image}
            name={pendingPack.name}
            sub={pendingPack.sub}
            onTorn={finishTear}
            autoRip={fast || wantAuto}
            globalEnter
          />
          <div className="faint small">{pendingPack.cards} cards inside — {fmtUsd(pendingPack.spent)}</div>
          <div className="po-actions">
            <button className="small btn-red" onClick={(e) => { e.stopPropagation(); setWantAuto(true) }}>Tear it open</button>
          </div>
        </div>
      )}

      {phase === 'revealing' && current && (
        <div className="po-stage" onClick={advance}>
          <div className="po-reveal">
            <RevealCard
              key={idx}
              card={current}
              tier={tier}
              stage={stage}
              fast={fast || reduced}
              hold={timing.hold}
              flip={timing.flip}
              hue={backArt.hue}
            />
            {landed && (
              <div className="po-value">
                <CountUp value={current.value} dur={fast || reduced ? 0 : Math.min(900, timing.beat)} />
              </div>
            )}
            {landed && current.variant && current.variant.startsWith('1stEdition') && (
              <div className="po-banner massive ghost-banner">👻 1ST EDITION GHOST PULL — {fmtUsd(current.value)}</div>
            )}
            {showHitBanner && !(current.variant && current.variant.startsWith('1stEdition')) && (
              <div className={`po-banner ${current.value >= 150 ? 'massive' : ''}`}>
                {current.value >= 150 ? '🔥 MASSIVE PULL' : current.value >= 60 ? '⭐ HUGE PULL' : '✨ HIT!'}
              </div>
            )}
          </div>
          <div className="po-progress">
            {queue.map((_, i) => (
              <span key={i} className={`dot ${i < idx || (i === idx && landed) ? (queue[i].isHit ? 'hit-shown' : 'shown') : ''}`} />
            ))}
          </div>
          <div className="faint small">{remaining > 0 ? `${remaining} card${remaining > 1 ? 's' : ''} left — click to reveal faster` : landed ? 'session complete' : ''}</div>
          <div className="po-actions">
            <button className="small" onClick={(e) => { e.stopPropagation(); setFast(true) }}>Skip animation</button>
            <button className="small ghost" onClick={(e) => { e.stopPropagation(); revealAll() }}>Reveal all</button>
          </div>
        </div>
      )}

      {phase === 'summary' && session && (
        <div className="po-stage">
          <div className="po-banner" style={{ fontSize: 20 }}>SESSION COMPLETE</div>
          {beatPackRecord && (
            <div className="po-banner massive pack-record-banner" style={{ marginBottom: 6 }}>📦 BEST PACK EVER — {fmtUsd(bestPackOfSession)}!</div>
          )}
          <div className="row mt8" style={{ gap: 26, flexWrap: 'wrap', justifyContent: 'center' }}>
            <div className="right"><div className="faint small">CARDS PULLED</div><div className="po-value">{session.cards.length}</div></div>
            {newCount > 0 && (
              <div className="right"><div className="faint small">NEW TO BINDER</div><div className="po-value" style={{ color: 'var(--green)' }}>✨ {newCount}</div></div>
            )}
            <div className="right"><div className="faint small">TOTAL PULL VALUE</div><div className="po-value" style={{ color: 'var(--yellow)' }}><CountUp value={session.totalValue} dur={fast || reduced ? 0 : 900} /></div></div>
            <div className="right"><div className="faint small">MONEY SPENT</div><div className="po-value">{fmtUsd(session.spent)}</div></div>
            {beatRecord && (
              <div className="right"><div className="faint small">PREVIOUS BEST</div><div className="po-value" style={{ textDecoration: 'line-through', opacity: 0.65 }}>{fmtUsd(previousBest)}</div></div>
            )}
            {beatPackRecord && (
              <div className="right"><div className="faint small">BEST PACK BEFORE</div><div className="po-value" style={{ textDecoration: 'line-through', opacity: 0.65 }}>{fmtUsd(prevBestPack)}</div></div>
            )}
            {!beatPackRecord && prevBestPack > 0 && (
              <div className="right"><div className="faint small">BEST PACK ON RECORD</div><div className="po-value" style={{ opacity: 0.85 }}>{fmtUsd(prevBestPack)}</div></div>
            )}
            <div className="right">
              <div className="faint small">PACK ROI</div>
              <div className="po-value" style={{ color: (roi ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {roi == null ? '—' : `${roi >= 0 ? '+' : ''}${(roi * 100).toFixed(0)}%`}
              </div>
            </div>
          </div>
          <div className="po-summary-grid mt14">
            {session.cards.map((c, i) => (
              <SummaryCell
                key={i}
                card={c}
                index={i}
                fast={fast || reduced}
                record={beatRecord && sessionBest != null && c.cardId === sessionBest.cardId && c.value === sessionBest.value}
              />
            ))}
          </div>
          <div className="po-actions">
            <button className="primary" onClick={() => { setPhase('idle'); setSession(null) }}>OPEN MORE</button>
            <button className="btn-blue" onClick={() => (window.location.hash = '#/pulls-history')}>View pull history</button>
            <button className="ghost" onClick={() => (window.location.hash = '#/collection')}>See it in your collection</button>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCell({ card, index = 0, fast = false, record }: { card: OpenedCard; index?: number; fast?: boolean; record?: boolean }) {
  const src = useCardImage(card.cardId)
  return (
    <div
      className={`po-summary-cell ${record ? 'record-cell' : ''}`}
      title={record ? 'Your best pull on record' : undefined}
      style={{ '--i': index, '--sd': fast ? '0ms' : undefined } as CSSProperties}
    >
      {record && <span className="record-tag">👑 BEST</span>}
      {card.isNew && <span className="new-tag">✨ NEW</span>}
      {card.variant && card.variant.startsWith('1stEdition') && <span className="ghost-tag">1st</span>}
      <CardImg src={src} alt={card.cardId} cardId={card.cardId} />
      <div className="val">{card.isHit ? 'HIT · ' : ''}{fmtUsd(card.value)}</div>
    </div>
  )
}
