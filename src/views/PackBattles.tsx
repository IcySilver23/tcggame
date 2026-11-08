import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type BattleCard,
  type BattleProduct,
  type BattleRecord,
  type BattleRival,
  type BattleResult,
  type BracketSlot,
  type TournamentPlayResult,
  type TournamentStatus,
} from '../api'
import { useStore } from '../store'
import { byNum, CardImg, Chip, EmptyState, fmtUsd, matchesQuery, SearchInput, SortSelect, TearPack, RecordMoment, glowClass } from '../components'
import { hitStinger } from '../audio'

// ---------------------------------------------------------------------------
// Pack Battles — pick a rival, pick a product, both sides rip, best total wins.
// Tournaments: single-elimination brackets with escalating rounds.
// ---------------------------------------------------------------------------

export function PackBattlesView() {
  const { toast, refreshState, openCard, state } = useStore()
  const [tab, setTab] = useState<'versus' | 'tournament'>('versus')
  const [rivals, setRivals] = useState<BattleRival[]>([])
  const [record, setRecord] = useState<BattleRecord | null>(null)
  const [reloading, setReloading] = useState(false)
  const [products, setProducts] = useState<BattleProduct[]>([])
  const [rivalId, setRivalId] = useState<string | null>(null)
  const [productId, setProductId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BattleResult | null>(null)
  // The rip comes first now: both packs land on screen — you tear yours, the
  // rival's rips itself open right after, then the duel resolves.
  const [pendingBattle, setPendingBattle] = useState<BattleResult | null>(null)
  // The record chase: prevBest is the all-time single-card best BEFORE this
  // battle ripped; a bigger pull in my cards lights the whole stage up.
  const [prevBest, setPrevBest] = useState(0)
  const [prevBestPack, setPrevBestPack] = useState(0)
  const [rivalQ, setRivalQ] = useState('')
  const [productQ, setProductQ] = useState('')
  const [productKind, setProductKind] = useState('all')
  const [productSort, setProductSort] = useState('price_asc')
  // The affordability chip: hide products whose stake is more cash than you hold.
  const [affordableOnly, setAffordableOnly] = useState(false)
  const cash = state?.cash ?? null

  const load = () => {
    api.battleRivals().then(setRivals).catch(() => {})
    api.battleProducts().then(setProducts).catch(() => {})
    api.battleRecord().then(setRecord).catch(() => {})
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
  // The stake is the whole box — a battle opens every pack in it (1/6/9/36),
  // so you pay for exactly the cardboard that hits the table.
  const stake = product ? product.stake ?? product.market_price ?? product.msrp : 0

  const shownRivals = rivals
    .filter((r) => matchesQuery(r, rivalQ, (x) => [x.name, x.style, x.blurb]))
    .sort((a, b) => Number(b.grudgeMatch) - Number(a.grudgeMatch) || b.grudge - a.grudge || a.name.localeCompare(b.name))
  const shownProducts = useMemo(() => {
    const out = products.filter((p) => {
      if (!matchesQuery(p, productQ, (x) => [x.name, x.kind])) return false
      if (productKind !== 'all' && p.kind !== productKind) return false
      if (affordableOnly && cash != null && (p.stake ?? p.market_price ?? p.msrp) > cash) return false
      return true
    })
    // Sort by the number the picker actually displays and charges — the stake
    // (the whole box) — so "Stake low→high" leads with the affordable modern
    // product and the five-figure out-of-print boxes sort to the bottom.
    return [...out].sort(byNum((p) => p.stake ?? p.market_price ?? p.msrp, productSort === 'price_desc' ? 'desc' : 'asc'))
  }, [products, productQ, productKind, productSort, affordableOnly, cash])
  const battleKinds = useMemo(() => [...new Set(products.map((p) => p.kind))].sort(), [products])

  const fight = async () => {
    if (!rival || !product) return
    setBusy(true)
    try {
      // Read the all-time record BEFORE the battle rips — the server writes
      // these pulls into pull_history during battleStart, so any later fetch
      // would compare the battle against itself.
      const best = await api.pullsBest().catch(() => ({ value: 0, bestPackTotal: 0 }))
      const res = await api.battleStart(product.id, rival.id)
      if (res.ok) {
        setPrevBest(best.value)
        setPrevBestPack(best.bestPackTotal ?? 0)
        setPendingBattle(res)
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

  if (pendingBattle) {
    const recordCard = prevBest > 0 ? (pendingBattle.mine ?? []).find((c) => c.value > prevBest) : undefined
    // Second chase: the best SINGLE pack of the duel (myBestPack is already
    // per-pack on the server, so bundles can't smuggle a two-pack sum in).
    const packRecord = prevBestPack > 0 && (pendingBattle.myBestPack ?? 0) > prevBestPack
    return (
      <div className={glowClass(!!recordCard, packRecord)}>
        <RecordMoment active={!!recordCard} value={recordCard?.value} />
        <RecordMoment active={packRecord} value={packRecord ? pendingBattle.myBestPack : null} variant="pack" />
        <DuelTearStage
          label={pendingBattle.product?.name ?? product?.name ?? 'Booster pack'}
          symbol={product?.symbol_url ?? null}
          image={product?.image_url ?? null}
          opponent={pendingBattle.opponent}
          myTotal={pendingBattle.myTotal}
          hasHit={(pendingBattle.mine ?? []).some((c) => c.isHit)}
          onDone={() => { setResult(pendingBattle); setPendingBattle(null) }}
        />
      </div>
    )
  }

  if (result) return <BattleCeremony result={result} onDone={() => { setResult(null) }} onOpenCard={openCard} />

  return (
    <div>
      <div className="page-head desk">
        <div className="ph-id">
          <span className="ph-mark" aria-hidden>⚔️</span>
          <div style={{ minWidth: 0 }}>
            <h1>Pack Battles</h1>
            <div className="sub">Both sides rip the same sealed product — best total pull value takes the pot. Everyone keeps their pulls.</div>
          </div>
        </div>
      </div>

      <div className="seg-bar" role="tablist" aria-label="Battle modes">
        <button role="tab" aria-selected={tab === 'versus'} className={`seg-item${tab === 'versus' ? ' on' : ''}`}
          title="Pick a rival and a box, rip them head to head" onClick={() => setTab('versus')}>
          ⚔️ Versus
        </button>
        <button role="tab" aria-selected={tab === 'tournament'} className={`seg-item${tab === 'tournament' ? ' on' : ''}`}
          title="Single-elimination bracket — escalating rounds" onClick={() => setTab('tournament')}>
          🏆 Tournament
        </button>
      </div>

      {tab === 'tournament' ? (
        <TournamentTab onOpenCard={openCard} />
      ) : (
        <>
          <div className="pf-stats" style={{ marginBottom: 12 }}>
            <div className="pf-stat">
              <div className="lbl">Record</div>
              <div className="val">{record ? `${record.wins}–${record.losses}` : '—'}</div>
              <div className="note">{record ? `${record.wins + record.losses} duels fought` : 'no duels yet'}</div>
            </div>
            <div className="pf-stat">
              <div className="lbl">Net</div>
              <div className="val" style={{ color: record && record.net > 0.5 ? 'var(--green)' : record && record.net < -0.5 ? 'var(--red)' : undefined }}>
                {record ? `${record.net >= 0 ? '+' : ''}${fmtUsd(record.net)}` : '—'}
              </div>
              <div className="note">pot minus stake</div>
            </div>
            <div className="pf-stat">
              <div className="lbl">Rivals</div>
              <div className="val">{rivals.length}</div>
              <div className="note">{rivals.filter((r) => r.grudgeMatch).length > 0 ? `${rivals.filter((r) => r.grudgeMatch).length} demanding a rematch` : 'nobody grudge-matching'}</div>
            </div>
            <div className="pf-stat">
              <div className="lbl">Cash</div>
              <div className="val">{fmtUsd(cash ?? 0)}</div>
              <div className="note">staked whole-box</div>
            </div>
          </div>

          <div className="battle-steps">
            <div className="battle-step">
              <div className="step-head">
                <span className="step-n">1</span> Pick your rival
                <span className="faint small" style={{ marginLeft: 'auto' }}>{shownRivals.length} in town</span>
              </div>
              {rivals.length === 0 && <EmptyState icon="⚔️" text="No challengers around" />}
              {rivals.length > 4 && (
                <div className="battle-filters">
                  <SearchInput value={rivalQ} onChange={setRivalQ} placeholder="Find a rival…" />
                </div>
              )}
              <div className="rival-list">
                {shownRivals.map((r) => {
                  const known = r.wins + r.losses > 0
                  return (
                    <div
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      className={`rival${rivalId === r.id ? ' on' : ''}${r.grudgeMatch ? ' grudge' : ''}`}
                      onClick={() => setRivalId(r.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRivalId(r.id) } }}
                    >
                      <span className="rival-av">{r.avatar}</span>
                      <span className="rival-main">
                        <span className="rival-name">
                          {r.name}
                          {r.grudgeMatch && <span className="rival-tag grudge">🩸 grudge {r.grudge.toFixed(1)}</span>}
                        </span>
                        <span className="rival-meta">{r.style} · nerve {r.nerve}/10</span>
                        <span className="rival-blurb">
                          {r.grudgeMatch && r.pendingProduct
                            ? `demands a rematch: ${r.pendingProduct}`
                            : r.salty ? `still salty about ${r.salty}` : r.blurb}
                        </span>
                      </span>
                      <span className="rival-nums">
                        <b>{known ? `${r.wins}–${r.losses}` : 'new'}</b>
                        <span>{known ? 'vs you' : 'blood'}</span>
                        {r.pendingProduct && !r.grudgeMatch && (
                          <button
                            className="small rival-duck"
                            disabled={reloading}
                            onClick={(e) => { e.stopPropagation(); duck(r.id) }}
                          >
                            Duck 🏃
                          </button>
                        )}
                      </span>
                      {rivalId === r.id && <span className="rival-check">✓</span>}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="battle-step">
              <div className="step-head">
                <span className="step-n">2</span> Pick the product
                <span className="faint small" style={{ marginLeft: 'auto' }}>{shownProducts.length} of {products.length}</span>
              </div>
              <div className="battle-filters">
                <SearchInput value={productQ} onChange={setProductQ} placeholder="Search battle products…" />
                <div className="chip-row">
                  <Chip on={productKind === 'all'} onClick={() => setProductKind('all')}>All</Chip>
                  {battleKinds.map((k) => (
                    <Chip key={k} on={productKind === k} onClick={() => setProductKind(productKind === k ? 'all' : k)}>{k}</Chip>
                  ))}
                  <Chip
                    on={affordableOnly}
                    onClick={() => {
                      const next = !affordableOnly
                      setAffordableOnly(next)
                      // A product hidden by the chip shouldn't stay selected and armed.
                      if (next && product && cash != null && (product.stake ?? product.market_price ?? product.msrp) > cash) setProductId(null)
                    }}
                  >
                    💵 Affordable{cash != null ? ` · ${fmtUsd(cash)}` : ''}
                  </Chip>
                </div>
                <SortSelect
                  value={productSort}
                  onChange={setProductSort}
                  options={[
                    { value: 'price_asc', label: 'Stake low→high' },
                    { value: 'price_desc', label: 'Stake high→low' },
                  ]}
                />
              </div>
              <div className="bprod-list">
                {shownProducts.length === 0 && (
                  <div className="faint small" style={{ padding: 8 }}>
                    {affordableOnly && cash != null
                      ? `Nothing you can afford under ${fmtUsd(cash)} — flip the chip off to browse the full catalog.`
                      : 'No products match.'}
                  </div>
                )}
                {shownProducts.map((p) => {
                  const price = p.stake ?? p.market_price ?? p.msrp
                  const short = cash != null && price > cash
                  return (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      className={`bprod${productId === p.id ? ' on' : ''}`}
                      onClick={() => setProductId(p.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setProductId(p.id) } }}
                    >
                      <span className="bprod-main">
                        <b className="bprod-name">{p.name}</b>
                        <span className="faint small">{p.kind.toUpperCase()} · {p.packs} pack{p.packs === 1 ? '' : 's'} a side{short ? ` · short ${fmtUsd(price - (cash ?? 0))}` : ''}</span>
                      </span>
                      <span className="bprod-nums">
                        <b style={{ color: short ? 'var(--red)' : undefined }}>{fmtUsd(price)}</b>
                        <span>stake</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className={`duel-slip${rival && product ? ' ready' : ''}${rival?.grudgeMatch ? ' grudge' : ''}`}>
            {rival && product ? (
              <>
                <div className="duel-title">
                  {rival.avatar} {rival.name} <span className="vs">vs</span> you
                </div>
                {rival.grudgeMatch && (
                  <div className="small grudge-note">🩸 GRUDGE MATCH — stakes doubled, no nerve roll, pride on the line</div>
                )}
                <div className="duel-facts">
                  <div><span>Product</span><b>{product.name}</b></div>
                  <div><span>Stake each</span><b>{fmtUsd(stake)}</b></div>
                  <div><span>Pot</span><b>{fmtUsd(stake * 2)}</b></div>
                </div>
                <button className="primary" disabled={busy} onClick={fight}>
                  {busy ? 'Ripping…' : rival.grudgeMatch ? 'Settle it 🩸' : '⚔️ Battle'}
                </button>
                <div className="faint small">Pulls are kept win or lose.</div>
              </>
            ) : (
              <div className="duel-pending">
                <div className={`duel-slot${rival ? ' done' : ''}`}>
                  {rival ? `${rival.avatar} ${rival.name}` : '① Pick a rival'}
                </div>
                <div className={`duel-slot${product ? ' done' : ''}`}>
                  {product ? product.name : '② Pick a product'}
                </div>
              </div>
            )}
          </div>

          {record && record.history.length > 0 && (
            <div className="panel" style={{ padding: '13px 14px' }}>
              <div className="section-head">Recent duels<span className="faint small" style={{ marginLeft: 'auto' }}>newest first</span></div>
              <div className="pf-rows">
                {record.history.slice(0, 6).map((h) => {
                  const won = h.winner === 'player'
                  return (
                    <div className="pf-row" key={h.id}>
                      <div className="pf-row-main">
                        <b className="pf-row-name">
                          <span className={won ? 'delta-up' : 'delta-down'}>{won ? 'W' : 'L'}</span> · {h.opponent}
                        </b>
                        <div className="faint small">
                          {h.productName} · {fmtUsd(h.stake)} stake{h.tiebreak ? ' · tiebreak' : ''}
                          {h.bestPull ? ` · best ${h.bestPull.name}` : ''}
                        </div>
                      </div>
                      <div className="pf-row-nums">
                        <b className={h.net >= 0 ? 'delta-up' : 'delta-down'}>{h.net >= 0 ? '+' : ''}{fmtUsd(h.net)}</b>
                        <div className="faint small">{fmtUsd(h.playerTotal)} vs {fmtUsd(h.opponentTotal)}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
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
  const [pendingRound, setPendingRound] = useState<TournamentPlayResult | null>(null)
  const [prevBestRound, setPrevBestRound] = useState(0)
  const [prevBestRoundPack, setPrevBestRoundPack] = useState(0)
  const [symbols, setSymbols] = useState<Record<string, string | null>>({})
  const [arts, setArts] = useState<Record<string, string | null>>({})
  useEffect(() => {
    api.battleProducts().then((ps) => {
      setSymbols(Object.fromEntries(ps.map((p) => [p.id, p.symbol_url ?? null])))
      setArts(Object.fromEntries(ps.map((p) => [p.id, p.image_url ?? null])))
    }).catch(() => {})
  }, [])

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
      // Same record chase as versus: read the bar before the round rips.
      const best = await api.pullsBest().catch(() => ({ value: 0, bestPackTotal: 0 }))
      const res = await api.tournamentPlay()
      if (res.ok) {
        setPrevBestRound(best.value)
        setPrevBestRoundPack(best.bestPackTotal ?? 0)
        setPendingRound(res)
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

  if (pendingRound) {
    const recordCard = prevBestRound > 0 ? (pendingRound.mine ?? []).find((c) => c.value > prevBestRound) : undefined
    const packRecord = prevBestRoundPack > 0 && (pendingRound.myBestPack ?? 0) > prevBestRoundPack
    return (
      <div className={glowClass(!!recordCard, packRecord)}>
        <RecordMoment active={!!recordCard} value={recordCard?.value} />
        <RecordMoment active={packRecord} value={packRecord ? pendingRound.myBestPack : null} variant="pack" />
        <DuelTearStage
          label={pendingRound.product?.name ?? 'Booster pack'}
          symbol={symbols[pendingRound.product?.id ?? ''] ?? null}
          image={arts[pendingRound.product?.id ?? ''] ?? null}
          opponent={pendingRound.opponent}
          myTotal={pendingRound.myTotal}
          hasHit={(pendingRound.mine ?? []).some((c) => c.isHit)}
          onDone={() => { setResult(pendingRound); setPendingRound(null) }}
        />
      </div>
    )
  }

  if (result) return <TournamentCeremony result={result} onDone={() => { setResult(null); load() }} onOpenCard={onOpenCard} />

  if (!status) return <div className="empty"><span className="spinner" /> Setting up the bracket…</div>

  if (!status.active) {
    const brackets: { icon: string; name: string; size: number; rounds: string; entry: number; prize: number; label: string }[] = [
      { icon: '🥉', name: 'Mini Invitational', size: 4, rounds: '2 rounds · booster rip → final bundle', entry: status.mini?.entry ?? 0, prize: status.mini?.prize ?? 0, label: 'four players' },
      { icon: '🏆', name: 'Grand Slam', size: 8, rounds: '3 rounds · booster → bundle → ETB final', entry: status.grand?.entry ?? 0, prize: status.grand?.prize ?? 0, label: 'eight players' },
    ]
    return (
      <div>
        <div className="tourn-list">
          {brackets.map((b) => (
            <div className="tourn" key={b.name}>
              <span className="tourn-icon">{b.icon}</span>
              <div className="tourn-main">
                <b className="tourn-name">{b.name}</b>
                <div className="faint small">{b.label} · {b.rounds}</div>
                <div className="tourn-facts">
                  <span>entry <b>{fmtUsd(b.entry)}</b></span>
                  <span>champion <b style={{ color: 'var(--gold)' }}>{fmtUsd(b.prize)}</b></span>
                </div>
              </div>
              <button className="primary small" disabled={busy} onClick={() => join(b.size)}>Enter</button>
            </div>
          ))}
        </div>
        <div className="faint small" style={{ marginTop: 8, lineHeight: 1.5 }}>
          Single elimination — you rip every round, and whoever totals more keeps the pot. Your pulls stay yours either way.
        </div>
      </div>
    )
  }

  const nextMatch = status.bracket[status.round]?.find((s) => !s.winner && (s.a === '__you__' || s.b === '__you__'))
  const nextOpponentId = nextMatch ? (nextMatch.a === '__you__' ? nextMatch.b : nextMatch.a) : null
  const roundLabel = status.rounds[status.round]?.label ?? 'Final'

  return (
    <div>
      <div className="duel-slip ready">
        <div className="duel-title">🏆 {status.title} <span className="vs">·</span> <span className="small">{status.size} players</span></div>
        <div className="duel-facts">
          <div><span>Round</span><b>{roundLabel}</b></div>
          <div><span>Prize</span><b style={{ color: 'var(--gold)' }}>{fmtUsd(status.prize)}</b></div>
          <div><span>Paid in</span><b>{fmtUsd(status.entry)}</b></div>
        </div>
        {nextOpponentId ? (
          <>
            <div className="small">Next up: <b>{names[nextOpponentId] ?? nextOpponentId}</b></div>
            <button className="primary" disabled={busy} onClick={play}>{busy ? 'Ripping…' : '⚔️ Play the round'}</button>
          </>
        ) : (
          <div className="faint small">Bracket complete.</div>
        )}
        <button className="small" disabled={busy} onClick={withdraw}>Withdraw</button>
      </div>

      <BracketView bracket={status.bracket} names={names} />
    </div>
  )
}

function BracketView({ bracket, names }: { bracket: BracketSlot[][]; names: Record<string, string> }) {

  return (
    <div className="row mt14" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {bracket.map((round, ri) => (
        <div key={ri} className="grow bracket-round" style={{ minWidth: 210 }}>
          <div className="bracket-round-name">{ri === bracket.length - 1 ? 'Final' : `Round ${ri + 1}`}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {round.map((s, si) => {
              const live = s.a === '__you__' || s.b === '__you__'
              return (
                <div key={si} className={`bracket-slot${live && !s.winner ? ' live' : ''}`}>
                  {(['a', 'b'] as const).map((side) => {
                    const out = s.winner && s.winner !== s[side]
                    return (
                      <div key={side} className={`bracket-line${s.winner === s[side] ? ' won' : ''}`} style={{ opacity: out ? 0.45 : 1 }}>
                        <span className="bracket-who">
                          {s.winner === s[side] ? '✓ ' : ''}{names[s[side]] ?? s[side]}
                        </span>
                        <span className="bracket-total">{side === 'a' ? (s.aTotal != null ? fmtUsd(s.aTotal) : '—') : (s.bTotal != null ? fmtUsd(s.bTotal) : '—')}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
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
  // One card per beat, alternating sides — a display now rips 360 cards a side,
  // so the beat compresses to keep a whole-box rip near a minute (booster duels
  // keep their original 1.1s cadence; Skip is always one click away).
  const beat = Math.max(110, Math.min(1100, Math.round(55000 / Math.max(1, steps))))

  useEffect(() => {
    if (revealed >= steps) { setFinished(true); return }
    const t = setTimeout(() => setRevealed((n) => Math.min(n + 1, steps)), revealed === 0 ? 900 : beat)
    return () => clearTimeout(t)
  }, [revealed, steps, beat])

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
              <div className="price" style={{ fontSize: 26, color: 'var(--gold)' }}>+{fmtUsd(result.prizePaid ?? 0)}</div>
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

  // Auto-play the rip cadence, alternating sides. The beat compresses for
  // big boxes (see `beat`) so a 36-pack display doesn't run 13 minutes of reveal.
  const beat = Math.max(110, Math.min(1100, Math.round(55000 / Math.max(1, steps))))

  useEffect(() => {
    if (revealed >= steps) { setFinished(true); return }
    const t = setTimeout(() => setRevealed((n) => Math.min(n + 1, steps)), revealed === 0 ? 900 : beat)
    return () => clearTimeout(t)
  }, [revealed, steps, beat])

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
        {CardColumn({ title: 'Your pulls (kept)', cards: myShown, total: myTotal, highlight: won })}
        {CardColumn({ title: `${opp?.name}'s pulls (theirs to keep)`, cards: theirShown, total: theirTotal, highlight: !won })}
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
  return <CardImg src={src} alt={name} cardId={cardId} />
}

const imgCache = new Map<string, string | null>()
const imgPending = new Set<string>()
const imgWaiters = new Set<() => void>()

// ---------------------------------------------------------------------------
// DuelTearStage — both packs on the table before the duel resolves. You tear
// yours (pointer or keyboard); the rival's rips itself a beat later. Skippers
// (Space on the stage) rip everything at once.
// ---------------------------------------------------------------------------

function DuelTearStage({ label, symbol, image, opponent, onDone, myTotal = 0, hasHit = false }: { label: string; symbol: string | null; image: string | null; opponent?: { id: string; name: string; avatar: string; style: string }; onDone: () => void; myTotal?: number; hasHit?: boolean }) {
  const [mineTorn, setMineTorn] = useState(false)
  const [theirsTorn, setTheirsTorn] = useState(false)
  const [count, setCount] = useState(0)

  // Choreography: your rip → 400ms beat → the rival's auto-rip → 620ms → resolve.
  useEffect(() => {
    if (!mineTorn) return
    const t = setTimeout(() => setTheirsTorn(true), 400)
    return () => clearTimeout(t)
  }, [mineTorn])
  useEffect(() => {
    if (!theirsTorn) return
    const t = setTimeout(onDone, 620)
    return () => clearTimeout(t)
  }, [theirsTorn, onDone])

  // The resolution stinger: scaled to YOUR total, win or lose — the duel's
  // price of admission deserves a note, big pulls deserve the fanfare.
  useEffect(() => {
    if (!mineTorn || !theirsTorn) return
    hitStinger(myTotal, hasHit)
  }, [mineTorn, theirsTorn, myTotal, hasHit])

  const skipAll = useCallback(() => { setMineTorn(true); setTheirsTorn(true); setCount((c) => c + 1000) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === ' ' && !mineTorn) { e.preventDefault(); skipAll() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mineTorn, skipAll])

  const opp = opponent
  return (
    <div className="po-stage" onDoubleClick={skipAll} title="Double-click to skip the tear">
      <div className="row" style={{ gap: 34, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="faint small" style={{ marginBottom: 8 }}>YOUR RIP</div>
          <TearPack
            symbolUrl={symbol}
            imageUrl={image}
            name={label}
            sub="tear it yourself"
            ariaLabel={`Tear open your ${label} — press Enter or Space`}
            onTorn={() => setMineTorn(true)}
            globalEnter
          />
          {mineTorn && <div className="badge" style={{ marginTop: 8, color: 'var(--green)', borderColor: 'var(--green)' }}>✓ ripped</div>}
        </div>
        <div style={{ fontSize: 30, opacity: 0.7 }}>⚔️</div>
        <div style={{ textAlign: 'center' }}>
          <div className="faint small" style={{ marginBottom: 8 }}>{opp?.avatar ?? '🤖'} {opp?.name?.toUpperCase() ?? 'RIVAL'}'S RIP</div>
          <TearPack
            key={`rival-${count}`}
            symbolUrl={symbol}
            imageUrl={image}
            name={label}
            sub={`${opp?.name ?? 'rival'} is ripping…`}
            ariaLabel={`${opp?.name ?? 'Rival'} is tearing their ${label}`}
            onTorn={() => {}}
            autoRip={mineTorn}
          />
        </div>
      </div>
      <div className="faint small mt14">{mineTorn ? 'the duel resolves…' : 'tear your pack — double-click (or Space) to skip'}</div>
    </div>
  )
}
