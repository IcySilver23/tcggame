import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { byNum, byStr, CardImg, EmptyState, fmtUsd, matchesQuery, PriceTag, SearchInput, SortSelect, SourceBadge } from '../components'
import type { WishlistRow, AgentsSection } from '../api'

// ---------------------------------------------------------------------------
// Wishlist — the hunt board.
//
// Two jobs hide in here: the cards you're hunting (with a price you'd pay) and
// the agents that hunt them for you overnight. The old screen stacked them: a
// header with the total, an "On duty" panel, then a grid of cards whose four
// little buttons each opened a window.prompt() — and in a three-up grid at this
// width those buttons wrapped around a 74px thumbnail.
//
// So the cards are rows now, each one carrying its own hunt status: a meter
// from today's price down to your target, a HIT flag when the market is already
// under it, and inline editors instead of prompts. The agents get one panel at
// the bottom where all of them live together, because they're a policy, not a
// per-card chore.
// ---------------------------------------------------------------------------

type HuntFilter = 'all' | 'targets' | 'hits'

const FILTERS: { id: HuntFilter; label: string; verb: string }[] = [
  { id: 'all', label: 'All', verb: 'Everything on the list, cheapest target first' },
  { id: 'targets', label: 'Targets', verb: 'Only cards with a price you decided to pay' },
  { id: 'hits', label: 'Hits', verb: 'Cards already at or under your target — go buy them' },
]

export function WishlistView() {
  const { toast, openCard, refreshState } = useStore()
  const [rows, setRows] = useState<WishlistRow[]>([])
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('added_desc')
  const [filter, setFilter] = useState<HuntFilter>('all')
  const [agents, setAgents] = useState<AgentsSection | null>(null)

  // Which row has an open editor, and what's typed in it.
  const [targetFor, setTargetFor] = useState<string | null>(null)
  const [targetDraft, setTargetDraft] = useState('')
  const [agentFor, setAgentFor] = useState<string | null>(null)
  const [agentCap, setAgentCap] = useState('')
  const [agentCond, setAgentCond] = useState('NM')
  const [capDraft, setCapDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    api.wishlist().then(setRows).catch(() => {})
    api.agents().then((a) => { setAgents(a); setCapDraft(a.orderCap.toFixed(2)) }).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const priceOf = (r: WishlistRow) => r.price.usd ?? null

  const isHit = (r: WishlistRow) => {
    const p = priceOf(r)
    return r.target_price != null && p != null && p <= r.target_price
  }

  const armAgent = async (r: WishlistRow, max: number) => {
    setBusy(true)
    try {
      const res = await api.agentsSet(r.card_id, true, max, agentCond)
      if (res.ok) {
        toast(`🤖 Agent armed: ${r.name} — auto-buys ${agentCond} at ≤ ${fmtUsd(max)}. Sweeps once a game-day.`, 'good')
        setAgentFor(null)
        load(); refreshState()
      } else toast(res.error ?? 'Could not arm the agent', 'bad')
    } finally { setBusy(false) }
  }

  const disarmAgent = async (r: WishlistRow) => {
    setBusy(true)
    try {
      const res = await api.agentsSet(r.card_id, false, null, 'NM')
      if (res.ok) { toast(`🤖 Agent disarmed: ${r.name}`, 'info'); load() }
      else toast(res.error ?? 'Could not disarm', 'bad')
    } finally { setBusy(false) }
  }

  const saveTarget = async (r: WishlistRow, raw: string) => {
    const trimmed = raw.trim()
    const target = trimmed === '' ? null : Math.max(0.01, Number(trimmed) || 0)
    if (trimmed !== '' && (!target || !Number.isFinite(target))) { toast('Enter a dollar amount, or clear it', 'bad'); return }
    await api.setWishlistAlert(r.card_id, target).catch(() => {})
    toast(target ? `🔔 Alert at ${fmtUsd(target)} — fires when the market drops to it.` : 'Alert cleared')
    setTargetFor(null)
    load()
  }

  const saveCap = async () => {
    const cap = Number(capDraft.trim())
    if (!Number.isFinite(cap) || cap < 1) { toast('Cap must be at least $1', 'bad'); return }
    const res = await api.agentsCap(cap)
    if (res.ok) { toast(`🤖 Agent per-order cash cap: ${fmtUsd(cap)}`, 'good'); load() }
    else toast(res.error ?? 'Rejected', 'bad')
  }

  const runNow = async () => {
    setBusy(true)
    try {
      const res = await api.agentsRun()
      if (res.ok) {
        const buys = res.buys ?? []
        if (buys.length === 0) toast('Agents swept the feeds — nothing at or under cap right now.', 'info')
        else { toast(`🤖 ${buys.length} buy${buys.length === 1 ? '' : 's'}: ${buys.map((b) => b.name).join(', ')}`, 'good'); refreshState() }
        load()
      } else toast(res.error ?? 'Sweep failed', 'bad')
    } finally { setBusy(false) }
  }

  const remove = async (r: WishlistRow) => {
    await api.wishlistToggle(r.card_id)
    toast('Removed from wishlist')
    load()
    refreshState()
  }

  const totals = useMemo(() => {
    const priced = rows.filter((r) => priceOf(r) != null)
    return {
      all: rows.reduce((a, r) => a + (priceOf(r) ?? 0), 0),
      targets: rows.filter((r) => r.target_price != null).length,
      hits: rows.filter(isHit).length,
      priced: priced.length,
    }
  }, [rows])

  const shown = useMemo(() => {
    let out = rows.filter((r) => matchesQuery(r, q, (x) => [x.name, x.set_name, x.rarity]))
    if (filter === 'targets') out = out.filter((r) => r.target_price != null)
    if (filter === 'hits') out = out.filter(isHit)
    const sorters: Record<string, (a: WishlistRow, b: WishlistRow) => number> = {
      added_desc: byStr((r) => r.added_at, 'desc'),
      added_asc: byStr((r) => r.added_at, 'asc'),
      price_desc: byNum((r) => r.price.usd, 'desc'),
      price_asc: byNum((r) => r.price.usd, 'asc'),
      name_asc: byStr((r) => r.name, 'asc'),
      set_asc: byStr((r) => r.set_name, 'asc'),
    }
    return [...out].sort(sorters[sort] ?? sorters.added_desc)
  }, [rows, q, sort, filter])

  const shownValue = shown.reduce((a, r) => a + (priceOf(r) ?? 0), 0)

  return (
    <div>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>Wishlist</h1>
          <div className="sub">Cards you're hunting — priced live, with a target you'd actually pay and agents that buy for you.</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon="★"
            text="Nothing on the hunt board"
            sub="Open any card from the market or your collection and choose ADD TO WISHLIST. Set a target and the board watches the price for you."
            action={{ label: 'Browse the market', onClick: () => { window.location.hash = '#/market' } }}
          />
        </div>
      ) : (
        <>
          <div className="wish-summary">
            <div>
              <span className="faint small">To acquire all</span>
              <b style={{ color: 'var(--gold)' }}>{fmtUsd(totals.all)}</b>
            </div>
            <div>
              <span className="faint small">Wishes</span>
              <b>{rows.length}</b>
            </div>
            <div>
              <span className="faint small">Targets</span>
              <b>{totals.targets}</b>
            </div>
            <div>
              <span className="faint small">Hits</span>
              <b style={{ color: totals.hits > 0 ? 'var(--green)' : undefined }}>{totals.hits}</b>
            </div>
            {agents && agents.armed.length > 0 && (
              <div>
                <span className="faint small">Agents</span>
                <b style={{ color: 'var(--green)' }}>{agents.armed.length} on duty</b>
              </div>
            )}
          </div>

          <div className="seg-bar" role="tablist" aria-label="Wishlist filters">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                className={`seg-item${filter === f.id ? ' on' : ''}`}
                title={f.verb}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                <span className="seg-count">{f.id === 'all' ? rows.length : f.id === 'targets' ? totals.targets : totals.hits}</span>
              </button>
            ))}
          </div>

          <div className="filter-row">
            <SearchInput value={q} onChange={setQ} placeholder="Search the hunt board…" />
            <SortSelect
              value={sort}
              onChange={setSort}
              options={[
                { value: 'added_desc', label: 'Sort: Recently added' },
                { value: 'added_asc', label: 'Sort: Oldest wishes' },
                { value: 'price_desc', label: 'Sort: Price high→low' },
                { value: 'price_asc', label: 'Sort: Cheapest first' },
                { value: 'name_asc', label: 'Sort: Name A→Z' },
                { value: 'set_asc', label: 'Sort: By set' },
              ]}
            />
            <span className="result-count faint small">{shown.length} of {rows.length} · {fmtUsd(shownValue)}</span>
          </div>

          {shown.length === 0 ? (
            <div className="panel">
              <EmptyState
                icon="🔍"
                text={filter === 'hits' ? 'No hits yet' : filter === 'targets' ? 'No targets set' : 'Nothing matches'}
                sub={filter === 'hits'
                  ? 'Every price is still above your targets. The board fires the moment one drops to it.'
                  : filter === 'targets'
                    ? 'Set a target on a card and it moves here — the market fires the alert when it gets there.'
                    : 'Try a different search, or switch back to All.'}
              />
            </div>
          ) : (
            <div className="wish-list">
              {shown.map((r) => {
                const price = priceOf(r)
                const hit = isHit(r)
                const gap = r.target_price != null && price != null ? price - r.target_price : null
                // How close today's price is to the target: full bar = already there.
                const pct = r.target_price != null && price != null && price > 0
                  ? Math.min(1, r.target_price / price)
                  : hit ? 1 : 0
                const editing = targetFor === r.card_id
                const arming = agentFor === r.card_id
                return (
                  <div key={r.card_id} className={`wish-row${hit ? ' is-hit' : ''}`}>
                    <div className="wish-art" onClick={() => openCard(r.card_id)}>
                      <CardImg src={r.image_small} alt={r.name} cardId={r.card_id} />
                    </div>
                    <div className="wish-body">
                      <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 0 }}>
                          <b className="wish-name" onClick={() => openCard(r.card_id)}>{r.name}</b>
                          <div className="faint small">{r.set_name}{r.rarity ? ` · ${r.rarity}` : ''}</div>
                        </div>
                        <button className="small ghost wish-kill" title="Remove from wishlist" onClick={() => remove(r)}>✕</button>
                      </div>

                      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                        <PriceTag price={r.price} />
                        <SourceBadge price={r.price} />
                      </div>

                      {r.target_price != null ? (
                        <div className="wish-target">
                          <div className="wish-meter" title={`target ${fmtUsd(r.target_price)} · market ${price != null ? fmtUsd(price) : '—'}`}>
                            <span style={{ width: `${pct * 100}%`, background: hit ? 'var(--green)' : 'var(--yellow)' }} />
                          </div>
                          <div className="wish-target-line">
                            {hit ? (
                              <span style={{ color: 'var(--green)', fontWeight: 750 }}>
                                🔔 HIT — market {fmtUsd(price!)} is at or under your {fmtUsd(r.target_price)}. Go buy it.
                              </span>
                            ) : (
                              <span className="small">
                                🔔 target {fmtUsd(r.target_price)}
                                {gap != null && gap > 0 && <span className="faint"> · {fmtUsd(gap)} to go</span>}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="wish-target-line">
                          <span className="faint small">No target — set one and this row watches the price for you.</span>
                        </div>
                      )}

                      {editing ? (
                        <div className="wish-editor">
                          <span className="faint small">Alert when market ≤</span>
                          <input
                            className="input"
                            style={{ width: 88 }}
                            inputMode="decimal"
                            autoFocus
                            placeholder="dollars"
                            value={targetDraft}
                            onChange={(e) => setTargetDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setTargetFor(null)
                              if (e.key === 'Enter') saveTarget(r, targetDraft)
                            }}
                          />
                          <button className="small primary" onClick={() => saveTarget(r, targetDraft)}>Save</button>
                          {r.target_price != null && <button className="small ghost" onClick={() => saveTarget(r, '')}>Clear</button>}
                          <button className="small ghost" onClick={() => setTargetFor(null)}>Cancel</button>
                        </div>
                      ) : arming ? (
                        <div className="wish-editor">
                          <span className="faint small">Auto-buy</span>
                          <select className="input" style={{ width: 74 }} value={agentCond} onChange={(e) => setAgentCond(e.target.value)}>
                            {(agents?.conditions ?? ['NM', 'LP', 'MP']).map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <span className="faint small">at ≤</span>
                          <input
                            className="input"
                            style={{ width: 78 }}
                            inputMode="decimal"
                            autoFocus
                            placeholder="cap"
                            value={agentCap}
                            onChange={(e) => setAgentCap(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setAgentFor(null)
                              if (e.key === 'Enter') {
                                const max = Number(agentCap.trim())
                                if (!Number.isFinite(max) || max < 0.5) toast('Enter a cap of at least $0.50', 'bad')
                                else armAgent(r, max)
                              }
                            }}
                          />
                          <button className="small primary" disabled={busy} onClick={() => {
                            const max = Number(agentCap.trim())
                            if (!Number.isFinite(max) || max < 0.5) { toast('Enter a cap of at least $0.50', 'bad'); return }
                            armAgent(r, max)
                          }}>Arm</button>
                          <button className="small ghost" onClick={() => setAgentFor(null)}>Cancel</button>
                        </div>
                      ) : (
                        <div className="wish-actions">
                          <button className="small" onClick={() => {
                            setAgentFor(null)
                            setTargetFor(r.card_id)
                            setTargetDraft(r.target_price != null ? r.target_price.toFixed(2) : (price != null ? (price * 0.85).toFixed(2) : ''))
                          }}>
                            {r.target_price != null ? '🔔 Edit target' : '🔔 Set target'}
                          </button>
                          <button
                            className={r.agent_enabled ? 'small primary' : 'small'}
                            title={r.agent_enabled
                              ? 'Disarm this agent'
                              : 'Arm a standing auto-buy: sweeps the market feed and BidBay once a game-day, buys at or under your cap'}
                            onClick={() => {
                              if (r.agent_enabled) { disarmAgent(r); return }
                              setTargetFor(null)
                              setAgentFor(r.card_id)
                              setAgentCap((r.agent_max_price ?? r.target_price ?? price ?? 0).toFixed(2))
                            }}
                          >
                            {r.agent_enabled ? `🤖 ON · ≤ ${fmtUsd(r.agent_max_price ?? r.target_price ?? 0)}` : '🤖 Arm agent'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {agents && (agents.armed.length > 0 || rows.length > 0) && (
        <div className="panel mt14">
          <div className="home-sec-head">
            <b className="small">🤖 Agents</b>
            <span className="faint small">
              {agents.armed.length > 0
                ? `${agents.armed.length} on duty · ${fmtUsd(agents.orderCap)} cap per buy`
                : 'none armed — arm one from any wish'}
            </span>
          </div>

          {agents.armed.length === 0 ? (
            <div className="home-mini">
              An armed agent sweeps the market feed and BidBay once per game-day and auto-buys a listed lot at or under your cap.
              It never pays distributor price, and one sweep can't spend more than the cash cap below.
            </div>
          ) : (
            <>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {agents.armed.map((a) => (
                  <span key={a.cardId} className="wish-agent-chip" title={`Auto-buys ${a.condition} at ≤ ${fmtUsd(a.cap)} on the market feed and BidBay`}>
                    🤖 {a.name} · ≤ {fmtUsd(a.cap)} · {a.condition}
                    {a.needsTarget && <span className="faint"> (no target)</span>}
                  </span>
                ))}
              </div>
              <div className="wish-cap">
                <span className="faint small">Per-buy / per-sweep cash cap</span>
                <input
                  className="input"
                  style={{ width: 92 }}
                  inputMode="decimal"
                  value={capDraft}
                  onChange={(e) => setCapDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveCap() }}
                />
                <button className="small" onClick={saveCap}>Save cap</button>
                <button className="small primary" style={{ marginLeft: 'auto' }} disabled={busy} onClick={runNow}>🤖 Sweep now</button>
              </div>
              <div className="home-mini" style={{ marginTop: 6 }}>
                Sweeps run overnight; sweep manually any time. Listed lots only — agents never pay distributor market price.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
