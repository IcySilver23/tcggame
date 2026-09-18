import { useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type BattleCard,
  type BattleProduct,
  type BattleRival,
  type BattleResult,
  type BracketSlot,
  type TournamentPlayResult,
  type TournamentStatus,
} from '../api'
import { useStore } from '../store'
import { byNum, CardImg, Chip, EmptyState, fmtUsd, matchesQuery, SearchInput, SortSelect } from '../components'

// ---------------------------------------------------------------------------
// Pack Battles — pick a rival, pick a product, both sides rip, best total wins.
// Tournaments: single-elimination brackets with escalating rounds.
// ---------------------------------------------------------------------------

export function PackBattlesView() {
  const { toast, refreshState, openCard } = useStore()
  const [tab, setTab] = useState<'versus' | 'tournament'>('versus')
  const [rivals, setRivals] = useState<BattleRival[]>([])
  const [reloading, setReloading] = useState(false)
  const [products, setProducts] = useState<BattleProduct[]>([])
  const [rivalId, setRivalId] = useState<string | null>(null)
  const [productId, setProductId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BattleResult | null>(null)
  const [rivalQ, setRivalQ] = useState('')
  const [productQ, setProductQ] = useState('')
  const [productKind, setProductKind] = useState('all')
  const [productSort, setProductSort] = useState('price_asc')

  const load = () => {
    api.battleRivals().then(setRivals).catch(() => {})
    api.battleProducts().then(setProducts).catch(() => {})
  }

  const duck = async (id: string) => {
    setReloading(true)
    try {
      const res = await api.battleDuck(id)
      toast(res.ok ? res.message ?? 'You walked away.' : res.error ?? 'Failed', res.ok ? 'bad' : 'bad')
      if (res.ok) load()
    } finally {
      setReloading(false)
    }
  }
  useEffect(() => { load() }, [])

  const rival = rivals.find((r) => r.id === rivalId) ?? null
  const product = products.find((p) => p.id === productId) ?? null
  const stake = product ? product.market_price ?? product.msrp : 0

  const shownRivals = rivals
    .filter((r) => matchesQuery(r, rivalQ, (x) => [x.name, x.style, x.blurb]))
    .sort((a, b) => Number(b.grudgeMatch) - Number(a.grudgeMatch) || b.grudge - a.grudge || a.name.localeCompare(b.name))
  const shownProducts = useMemo(() => {
    const out = products.filter((p) => {
      if (!matchesQuery(p, productQ, (x) => [x.name, x.kind])) return false
      if (productKind !== 'all' && p.kind !== productKind) return false
      return true
    })
    return [...out].sort(byNum((p) => p.market_price ?? p.msrp, productSort === 'price_desc' ? 'desc' : 'asc'))
  }, [products, productQ, productKind, productSort])
  const battleKinds = useMemo(() => [...new Set(products.map((p) => p.kind))].sort(), [products])

  const fight = async () => {
    if (!rival || !product) return
    setBusy(true)
    try {
      const res = await api.battleStart(product.id, rival.id)
      if (res.ok) {
        setResult(res)
        refreshState()
        load()
      } else {
        toast(res.error ?? 'Battle failed', 'bad')
        load()
      }
    } finally {
      setBusy(false)
    }
  }

  if (result) return <BattleCeremony result={result} onDone={() => { setResult(null) }} onOpenCard={openCard} />

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>⚔️ Pack Battles</h1>
          <div className="sub">Both sides rip the same sealed product — best total pull value takes the pot. Everyone keeps their pulls.</div>
        </div>
        <div className="right">
          <button className={tab === 'versus' ? 'primary small' : 'small'} onClick={() => setTab('versus')}>Versus</button>{' '}
          <button className={tab === 'tournament' ? 'primary small' : 'small'} onClick={() => setTab('tournament')}>🏆 Tournament</button>
        </div>
      </div>

      {tab === 'tournament' ? (
        <TournamentTab onOpenCard={openCard} />
      ) : (
      <>

      <div className="grid cols2 mt14">
        <div>
          <h2 style={{ marginBottom: 8 }}>Pick your rival</h2>
          {rivals.length === 0 && <EmptyState icon="⚔️" text="No challengers around" />}
          {rivals.length > 6 && (
            <div className="filter-row" style={{ marginBottom: 8 }}>
              <SearchInput value={rivalQ} onChange={setRivalQ} placeholder="Find a rival…" />
              <span className="result-count faint small">{shownRivals.length} shown</span>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shownRivals.map((r) => (
              <div
                key={r.id}
                className="panel"
                style={{
                  margin: 0,
                  padding: 12,
                  cursor: 'pointer',
                  borderColor: rivalId === r.id ? 'var(--yellow)' : r.grudgeMatch ? 'var(--red)' : undefined,
                  background: rivalId === r.id ? 'var(--panel2)' : undefined,
                }}
                onClick={() => setRivalId(r.id)}
              >
                <div className="row">
                  <div style={{ fontSize: 28 }}>{r.avatar}</div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b>{r.name}</b>
                    <div className="faint small">{r.style}</div>
                    <div className="faint small" style={{ marginTop: 2 }}>{r.blurb}</div>
                    {r.grudgeMatch && (
                      <div style={{ marginTop: 4 }}>
                        <span className="badge" style={{ color: 'var(--red)', borderColor: 'var(--red)' }} title={`Grudge ${r.grudge.toFixed(1)}/10 — next battle costs DOUBLE`}>🩸 GRUDGE {r.grudge.toFixed(1)}</span>
                        {r.pendingProduct && <span className="badge" style={{ marginLeft: 6 }}>demands rematch: {r.pendingProduct}</span>}
                      </div>
                    )}
                    {!r.grudgeMatch && r.salty && (
                      <div className="faint small" style={{ marginTop: 4, fontStyle: 'italic' }} title={`Grudge ${r.grudge.toFixed(1)}/10`}>still salty about {r.salty}</div>
                    )}
                  </div>
                  <div className="right" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    {(r.wins > 0 || r.losses > 0) ? (
                      <span className="badge">you {r.wins}–{r.losses}</span>
                    ) : (
                      <span className="badge">new blood</span>
                    )}
                    {r.pendingProduct && !r.grudgeMatch && (
                      <button
                        className="small"
                        style={{ fontSize: 10, padding: '2px 8px' }}
                        disabled={reloading}
                        onClick={(e) => { e.stopPropagation(); duck(r.id) }}
                      >
                        Duck 🏃
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>Pick the product</h2>
          <div className="filter-row" style={{ marginBottom: 8 }}>
            <SearchInput value={productQ} onChange={setProductQ} placeholder="Search battle products…" />
            <SortSelect
              value={productSort}
              onChange={setProductSort}
              options={[
                { value: 'price_asc', label: 'Sort: Stake low→high' },
                { value: 'price_desc', label: 'Sort: Stake high→low' },
              ]}
            />
          </div>
          <div className="filter-row" style={{ marginBottom: 8 }}>
            <div className="chip-row">
              <Chip on={productKind === 'all'} onClick={() => setProductKind('all')}>All kinds</Chip>
              {battleKinds.map((k) => (
                <Chip key={k} on={productKind === k} onClick={() => setProductKind(productKind === k ? 'all' : k)}>{k}</Chip>
              ))}
              <span className="result-count faint small">{shownProducts.length} of {products.length}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 480, overflowY: 'auto' }}>
            {shownProducts.map((p) => {
              const price = p.market_price ?? p.msrp
              return (
                <div
                  key={p.id}
                  className="panel"
                  style={{
                    margin: 0,
                    padding: 12,
                    cursor: 'pointer',
                    borderColor: productId === p.id ? 'var(--yellow)' : undefined,
                    background: productId === p.id ? 'var(--panel2)' : undefined,
                  }}
                  onClick={() => setProductId(p.id)}
                >
                  <div className="row">
                    <div className="grow" style={{ minWidth: 0 }}>
                      <b className="small">{p.name}</b>
                      <div className="faint small">{p.kind.toUpperCase()} · both sides rip {p.kind === 'booster' ? 1 : p.kind === 'bundle' ? 2 : 3} pack{p.kind === 'booster' ? '' : 's'}</div>
                    </div>
                    <div className="right price">{fmtUsd(price)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {rival && product && (
        <div className="panel mt14" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', borderColor: rival.grudgeMatch ? 'var(--red)' : undefined }}>
          <div>
            <b>{rival.avatar} {rival.name} vs you</b>
            {rival.grudgeMatch && <div style={{ color: 'var(--red)', fontWeight: 700 }} className="small">🩸 GRUDGE MATCH — stakes doubled, no nerve roll, pride on the line</div>}
            <div className="faint small">
              {product.name} · stake {fmtUsd(stake)} each · pot {fmtUsd(stake * 2)} · pulls are kept win or lose
            </div>
          </div>
          <button className="primary" disabled={busy} onClick={fight}>{busy ? 'Ripping…' : rival.grudgeMatch ? 'Settle it 🩸' : 'Battle!'}</button>
        </div>
      )}
      </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tournament tab
// ---------------------------------------------------------------------------

function TournamentTab({ onOpenCard }: { onOpenCard: (id: string) => void }) {
  const { toast, refreshState } = useStore()
  const [status, setStatus] = useState<TournamentStatus | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<TournamentPlayResult | null>(null)

  const load = () => api.tournamentStatus().then(setStatus).catch(() => {})
  useEffect(() => {
    load()
    api.battleRivals().then((rs) => {
      const m: Record<string, string> = { __you__: 'You' }
      for (const r of rs) m[r.id] = `${r.avatar} ${r.name}`
      setNames(m)
    }).catch(() => {})
  }, [])

  const join = async (size: number) => {
    setBusy(true)
    try {
      const res = await api.tournamentJoin(size)
      if (res.ok) {
        toast(`You're in the ${res.title} — ${size} players, ${fmtUsd(res.prize ?? 0)} to the champion`, 'good')
        refreshState()
        load()
      } else {
        toast(res.error ?? 'Join failed', 'bad')
      }
    } finally {
      setBusy(false)
    }
  }

  const play = async () => {
    setBusy(true)
    try {
      const res = await api.tournamentPlay()
      if (res.ok) {
        setResult(res)
        refreshState()
      } else {
        toast(res.error ?? 'Round failed', 'bad')
        load()
      }
    } finally {
      setBusy(false)
    }
  }

  const withdraw = async () => {
    setBusy(true)
    try {
      await api.tournamentAbandon()
      toast('You withdrew — entry forfeited.', 'bad')
      refreshState()
      load()
    } finally {
      setBusy(false)
    }
  }

  if (result) return <TournamentCeremony result={result} onDone={() => { setResult(null); load() }} onOpenCard={onOpenCard} />

  if (!status) return <div className="empty"><span className="spinner" /> Setting up the bracket…</div>

  if (!status.active) {
    return (
      <div className="grid cols2 mt14">
        <div className="panel" style={{ textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 36 }}>🥉</div>
          <h2 style={{ margin: '6px 0' }}>Mini Invitational</h2>
          <div className="faint small">4 players · 2 rounds</div>
          <div className="small mt8">Semifinal: Booster rip → Final: Booster Bundle</div>
          <div className="row" style={{ justifyContent: 'center', gap: 16, marginTop: 10 }}>
            <div><div className="faint small">ENTRY</div><b>{fmtUsd(status.mini?.entry ?? 0)}</b></div>
            <div><div className="faint small">CHAMPION TAKES</div><b style={{ color: 'var(--yellow)' }}>{fmtUsd(status.mini?.prize ?? 0)}</b></div>
          </div>
          <button className="primary mt8" disabled={busy} onClick={() => join(4)}>Enter the bracket</button>
        </div>
        <div className="panel" style={{ textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 36 }}>🏆</div>
          <h2 style={{ margin: '6px 0' }}>Grand Slam</h2>
          <div className="faint small">8 players · 3 rounds</div>
          <div className="small mt8">Quarterfinal: Booster → Semi: Bundle → Championship: ETB</div>
          <div className="row" style={{ justifyContent: 'center', gap: 16, marginTop: 10 }}>
            <div><div className="faint small">ENTRY</div><b>{fmtUsd(status.grand?.entry ?? 0)}</b></div>
            <div><div className="faint small">CHAMPION TAKES</div><b style={{ color: 'var(--yellow)' }}>{fmtUsd(status.grand?.prize ?? 0)}</b></div>
          </div>
          <button className="primary mt8" disabled={busy} onClick={() => join(8)}>Enter the bracket</button>
        </div>
      </div>
    )
  }

  const nextMatch = status.bracket[status.round]?.find((s) => !s.winner && (s.a === '__you__' || s.b === '__you__'))
  const nextOpponentId = nextMatch ? (nextMatch.a === '__you__' ? nextMatch.b : nextMatch.a) : null
  const roundLabel = status.rounds[status.round]?.label ?? 'Final'

  return (
    <div>
      <div className="panel mt14" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <b>🏆 {status.title}</b>
          <div className="faint small">{status.size} players · prize {fmtUsd(status.prize)} · you've paid {fmtUsd(status.entry)} in</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {nextOpponentId ? (
            <>
              <span className="small">Next: <b>{roundLabel}</b> vs <b>{names[nextOpponentId] ?? nextOpponentId}</b></span>
              <button className="primary" disabled={busy} onClick={play}>{busy ? 'Ripping…' : 'Play round'}</button>
            </>
          ) : (
            <span className="faint small">Bracket complete</span>
          )}
          <button className="small" disabled={busy} onClick={withdraw}>Withdraw</button>
        </div>
      </div>

      <BracketView bracket={status.bracket} names={names} />
    </div>
  )
}

function BracketView({ bracket, names }: { bracket: BracketSlot[][]; names: Record<string, string> }) {

  return (
    <div className="row mt14" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {bracket.map((round, ri) => (
        <div key={ri} className="grow" style={{ minWidth: 210 }}>
          <div className="faint small" style={{ marginBottom: 6 }}>{ri === bracket.length - 1 ? 'FINAL' : `ROUND ${ri + 1}`}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {round.map((s, si) => (
              <div key={si} className="panel" style={{ margin: 0, padding: 8 }}>
                {(['a', 'b'] as const).map((side) => (
                  <div key={side} className="row" style={{ justifyContent: 'space-between', fontSize: 12, opacity: s.winner && s.winner !== s[side] ? 0.45 : 1 }}>
                    <span>
                      {s.winner === s[side] && '✓ '}{names[s[side]] ?? s[side]}
                    </span>
                    <span className="faint">{side === 'a' ? (s.aTotal != null ? fmtUsd(s.aTotal) : '—') : (s.bTotal != null ? fmtUsd(s.bTotal) : '—')}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function TournamentCeremony({ result, onDone, onOpenCard }: { result: TournamentPlayResult; onDone: () => void; onOpenCard: (id: string) => void }) {
  const mine = result.mine ?? []
  const theirs = result.theirs ?? []
  const chat = result.chat ?? []
  const steps = Math.max(mine.length, theirs.length) * 2
  const [revealed, setRevealed] = useState(0)
  const [finished, setFinished] = useState(false)
  const [showVerdict, setShowVerdict] = useState(false)
  const chatBoxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (revealed >= steps) { setFinished(true); return }
    const t = setTimeout(() => setRevealed((n) => Math.min(n + 1, steps)), revealed === 0 ? 900 : 1100)
    return () => clearTimeout(t)
  }, [revealed, steps])

  useEffect(() => {
    if (finished && !showVerdict) {
      const t = setTimeout(() => setShowVerdict(true), 1600)
      return () => clearTimeout(t)
    }
  }, [finished, showVerdict])

  useEffect(() => { chatBoxRef.current?.scrollTo({ top: 999999, behavior: 'smooth' }) }, [revealed, finished])

  const skip = () => { setRevealed(steps); setFinished(true); setShowVerdict(true) }

  const myShown = mine.filter((_, i) => 2 * i < revealed)
  const theirShown = theirs.filter((_, i) => 2 * i + 1 < revealed)
  const myTotal = Math.round(myShown.reduce((a, c) => a + c.value, 0) * 100) / 100
  const theirTotal = Math.round(theirShown.reduce((a, c) => a + c.value, 0) * 100) / 100
  const visibleChat = finished ? chat : chat.filter((l) => l.at < revealed)
  const opp = result.opponent
  const won = result.winner === 'player'

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{showVerdict ? (result.champion ? '🏆 CHAMPION!' : won ? '✅ Through!' : '💀 Eliminated') : '⚔️ Ripping…'}</h1>
          <div className="sub">{result.roundLabel} vs {opp?.avatar} {opp?.name}</div>
        </div>
        <div className="right">
          {!finished && <button className="small" onClick={skip}>Skip ⏭</button>}
        </div>
      </div>

      <div className="panel" style={{ textAlign: 'center', padding: 14 }}>
        <div className="row" style={{ justifyContent: 'center', gap: 30, flexWrap: 'wrap' }}>
          <div>
            <div className="faint small">YOUR RIP</div>
            <div className="price" style={{ fontSize: 26 }}>{fmtUsd(myTotal)}</div>
          </div>
          <div>
            <div className="faint small">{opp?.name.toUpperCase()}'S RIP</div>
            <div className="price" style={{ fontSize: 26 }}>{fmtUsd(theirTotal)}</div>
          </div>
          {showVerdict && result.champion && (
            <div>
              <div className="faint small">PRIZE</div>
              <div className="price" style={{ fontSize: 26, color: 'var(--yellow)' }}>+{fmtUsd(result.prizePaid ?? 0)}</div>
            </div>
          )}
        </div>
      </div>

      <div className="row mt14" style={{ alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <b className="small">Your pulls (kept)</b>
          <div className="grid cols3 mt8">
            {myShown.map((c, i) => (
              <div key={i} className="panel" style={{ margin: 0, padding: 6, cursor: 'pointer' }} onClick={() => onOpenCard(c.cardId)}>
                <CardImgById cardId={c.cardId} name={c.name} />
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="badge" style={{ fontSize: 9, padding: '1px 5px' }}>{c.isHit ? 'HIT' : '—'}</span>
                  <span className="faint small">{fmtUsd(c.value)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="battle-chat" style={{ width: 250, flexShrink: 0 }}>
          <b className="small">💬 Crowd</b>
          <div className="chat-box" ref={chatBoxRef}>
            {visibleChat.map((l, i) => (
              <div key={i} className="chat-line">
                <span className="chat-avatar">{l.avatar}</span>
                <div className="grow"><b>{l.who}</b> <span>{l.text}</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showVerdict && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="primary" onClick={onDone}>Back to the bracket</button>
        </div>
      )}
    </div>
  )
}

function BattleCeremony({ result, onDone, onOpenCard }: { result: BattleResult; onDone: () => void; onOpenCard: (id: string) => void }) {
  const mine = result.mine ?? []
  const theirs = result.theirs ?? []
  const chat = result.chat ?? []
  const steps = Math.max(mine.length, theirs.length) * 2
  const [revealed, setRevealed] = useState(0)
  const [finished, setFinished] = useState(false)
  const [showVerdict, setShowVerdict] = useState(false)
  const chatBoxRef = useRef<HTMLDivElement | null>(null)

  // Auto-play the rip cadence, alternating sides.
  useEffect(() => {
    if (revealed >= steps) { setFinished(true); return }
    const t = setTimeout(() => setRevealed((n) => Math.min(n + 1, steps)), revealed === 0 ? 900 : 1100)
    return () => clearTimeout(t)
  }, [revealed, steps])

  // Let the finale chat land before the verdict stamps in.
  useEffect(() => {
    if (finished && !showVerdict) {
      const t = setTimeout(() => setShowVerdict(true), 1600)
      return () => clearTimeout(t)
    }
  }, [finished, showVerdict])

  useEffect(() => { chatBoxRef.current?.scrollTo({ top: 999999, behavior: 'smooth' }) }, [revealed, finished])

  const skip = () => { setRevealed(steps); setFinished(true); setShowVerdict(true) }

  const myShown = mine.filter((_, i) => 2 * i < revealed)
  const theirShown = theirs.filter((_, i) => 2 * i + 1 < revealed)
  const myTotal = Math.round(myShown.reduce((a, c) => a + c.value, 0) * 100) / 100
  const theirTotal = Math.round(theirShown.reduce((a, c) => a + c.value, 0) * 100) / 100
  const visibleChat = finished ? chat : chat.filter((l) => l.at < revealed)
  const opp = result.opponent
  const won = result.winner === 'player'
  const turnLabel = finished
    ? 'Final totals'
    : revealed % 2 === 0 ? 'You rip…' : `${opp?.avatar ?? ''} ${opp?.name ?? 'Rival'} rips…`

  const CardColumn = ({ title, cards, total, highlight }: { title: string; cards: BattleCard[]; total: number; highlight: boolean }) => (
    <div className="grow" style={{ minWidth: 0 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b className="small">{title}</b>
        <span className="price" style={{ color: highlight && finished ? (highlight ? 'var(--green)' : undefined) : undefined }}>{fmtUsd(total)}</span>
      </div>
      <div className="grid cols3 mt8">
        {cards.map((c, i) => (
          <div key={i} className="panel" style={{ margin: 0, padding: 6, cursor: 'pointer' }} onClick={() => onOpenCard(c.cardId)}>
            <CardImgById cardId={c.cardId} name={c.name} />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="badge" style={{ fontSize: 9, padding: '1px 5px' }}>{c.isHit ? 'HIT' : '—'}</span>
              <span className="faint small">{fmtUsd(c.value)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{showVerdict ? (won ? '🏆 Victory!' : '💀 Defeat') : '⚔️ Ripping…'}</h1>
          <div className="sub">
            {result.grudgeMatch && <span style={{ color: 'var(--red)', fontWeight: 700 }}>🩸 GRUDGE MATCH — stakes doubled · </span>}
            {result.product?.name} vs {opp?.avatar} {opp?.name}
            {showVerdict && result.tiebreak && ' — decided on best single card'}
          </div>
        </div>
        <div className="right">
          {!finished && <button className="small" onClick={skip}>Skip ⏭</button>}
        </div>
      </div>

      <div className="panel" style={{ textAlign: 'center', padding: 14 }}>
        <div className="faint small" style={{ marginBottom: 6 }}>{turnLabel}</div>
        <div className="row" style={{ justifyContent: 'center', gap: 30, flexWrap: 'wrap' }}>
          <div>
            <div className="faint small">YOUR RIP</div>
            <div className="price" style={{ fontSize: 26 }}>{fmtUsd(myTotal)}</div>
          </div>
          <div>
            <div className="faint small">{opp?.name.toUpperCase()}'S RIP</div>
            <div className="price" style={{ fontSize: 26 }}>{fmtUsd(theirTotal)}</div>
          </div>
          {showVerdict && (
            <div>
              <div className="faint small">{won ? 'POT WON' : 'STAKE LOST'}</div>
              <div className="price" style={{ fontSize: 26, color: won ? 'var(--green)' : 'var(--red)' }}>{won ? '+' : '-'}{fmtUsd(Math.abs(result.net ?? 0))}</div>
            </div>
          )}
        </div>
      </div>

      <div className="row mt14" style={{ alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <CardColumn title="Your pulls (kept)" cards={myShown} total={myTotal} highlight={won} />
        <CardColumn title={`${opp?.name}'s pulls (theirs to keep)`} cards={theirShown} total={theirTotal} highlight={!won} />
        <div className="battle-chat" style={{ width: 250, flexShrink: 0 }}>
          <b className="small">💬 Spectators</b>
          <div className="chat-box" ref={chatBoxRef}>
            {visibleChat.map((l, i) => (
              <div key={i} className="chat-line">
                <span className="chat-avatar">{l.avatar}</span>
                <div className="grow">
                  <b>{l.who}</b> <span>{l.text}</span>
                </div>
              </div>
            ))}
            {visibleChat.length === 0 && <div className="faint small">chat is warming up…</div>}
          </div>
        </div>
      </div>

      {showVerdict && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="primary" onClick={onDone}>Back to the lobby</button>
        </div>
      )}
    </div>
  )
}

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
  return <CardImg src={src} alt={name} />
}

const imgCache = new Map<string, string | null>()
const imgPending = new Set<string>()
const imgWaiters = new Set<() => void>()
