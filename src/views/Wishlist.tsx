import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { byNum, byStr, CardImg, DensityToggle, EmptyState, fmtUsd, matchesQuery, PriceTag, SearchInput, SortSelect, SourceBadge } from '../components'
import type { WishlistRow, AgentsSection } from '../api'

export function WishlistView() {
  const { toast, openCard, refreshState, density } = useStore()
  const [rows, setRows] = useState<WishlistRow[]>([])
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('added_desc')
  const [agents, setAgents] = useState<AgentsSection | null>(null)

  const load = () => {
    api.wishlist().then(setRows).catch(() => {})
    api.agents().then(setAgents).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const armAgent = async (cardId: string, name: string, enabled: boolean, currentMax: number | null, market: number | null) => {
    if (enabled) {
      const r = await api.agentsSet(cardId, false, null, 'NM')
      if (r.ok) { toast(`🤖 Agent disarmed: ${name}`, 'info'); load() }
      return
    }
    const hint = currentMax ?? market ?? undefined
    const input = window.prompt(
      `Arm a WISHLIST AGENT for ${name}?\n\nIt sweeps the market feed and BidBay once per game-day and auto-buys any NM lot at or under this cap (per-order cash cap $${agents?.orderCap.toFixed(2) ?? '250.00'} bounds every buy).\n\nMax price ($):`,
      hint != null ? hint.toFixed(2) : '',
    )
    if (input === null) return
    const max = Number(input.trim())
    if (!input.trim() || !Number.isFinite(max) || max < 0.5) { toast('Enter a max price of at least $0.50', 'bad'); return }
    const r = await api.agentsSet(cardId, true, max, 'NM')
    if (r.ok) { toast(`🤖 AGENT ARMED: ${name} — auto-buy NM at ≤ $${max.toFixed(2)}. Sweeps once a game-day.`, 'good'); load(); refreshState() }
    else toast(r.error ?? 'Could not arm the agent', 'bad')
  }

  const setCap = async (current: number) => {
    const input = window.prompt(`Agent per-order cash cap\n(no single agent buy can exceed this, and an overnight sweep spends at most this much total):`, current.toFixed(2))
    if (input === null) return
    const cap = Number(input.trim())
    if (!Number.isFinite(cap) || cap < 1) { toast('Cap must be at least $1', 'bad'); return }
    const r = await api.agentsCap(cap)
    if (r.ok) { toast(`🤖 Agent per-order cash cap: $${cap.toFixed(2)}`, 'good'); load() }
    else toast(r.error ?? 'Rejected', 'bad')
  }

  const runNow = async () => {
    const r = await api.agentsRun()
    if (r.ok) {
      const buys = r.buys ?? []
      if (buys.length === 0) toast('Agents swept the feeds — nothing at or under cap right now.', 'info')
      else { toast(`🤖 ${buys.length} buy${buys.length === 1 ? '' : 's'}: ${buys.map((b) => b.name).join(', ')}`, 'good'); refreshState() }
      load()
    } else toast(r.error ?? 'Sweep failed', 'bad')
  }

  const remove = async (cardId: string) => {
    await api.wishlistToggle(cardId)
    toast('Removed from wishlist')
    load()
    refreshState()
  }

  const setAlert = async (cardId: string, current: number | null, now: number | null) => {
    const hint = current ?? now ?? undefined
    const input = window.prompt(
      `Price alert target for this card\n(fire when market drops to or below — clear to remove):`,
      hint != null ? hint.toFixed(2) : '',
    )
    if (input === null) return
    const trimmed = input.trim()
    const target = trimmed === '' ? null : Math.max(0.01, Number(trimmed) || 0)
    if (trimmed !== '' && (!target || !Number.isFinite(target))) { toast('Enter a dollar amount'); return }
    await api.setWishlistAlert(cardId, target).catch(() => {})
    toast(target ? `Alert set at $${target.toFixed(2)}` : 'Alert cleared')
    load()
  }

  const total = rows.reduce((a, r) => a + (r.price.usd ?? 0), 0)
  const alertCount = rows.filter((r) => r.target_price != null).length

  const shown = useMemo(() => {
    const out = rows.filter((r) => matchesQuery(r, q, (x) => [x.name, x.set_name, x.rarity]))
    const sorters: Record<string, (a: WishlistRow, b: WishlistRow) => number> = {
      added_desc: byStr((r) => r.added_at, 'desc'),
      added_asc: byStr((r) => r.added_at, 'asc'),
      price_desc: byNum((r) => r.price.usd, 'desc'),
      price_asc: byNum((r) => r.price.usd, 'asc'),
      name_asc: byStr((r) => r.name, 'asc'),
      set_asc: byStr((r) => r.set_name, 'asc'),
    }
    return [...out].sort(sorters[sort] ?? sorters.added_desc)
  }, [rows, q, sort])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Wishlist</h1>
          <div className="sub">Cards you're hunting — priced live from TCGplayer data.</div>
        </div>
        <div className="right">
          <div className="faint small">Total to acquire all</div>
          <div className="price" style={{ fontSize: 18 }}>{fmtUsd(total)}</div>
          {alertCount > 0 && <div className="faint small mt8">🔔 {alertCount} price alert{alertCount === 1 ? '' : 's'} armed</div>}
          {agents && agents.armed.length > 0 && (
            <div className="faint small mt8">🤖 {agents.armed.length} agent{agents.armed.length === 1 ? '' : 's'} on duty · cap {fmtUsd(agents.orderCap)}/order</div>
          )}
          {agents && agents.armed.length > 0 && (
            <div className="row mt8" style={{ gap: 6, justifyContent: 'flex-end' }}>
              <button className="small" onClick={runNow}>🤖 Sweep now</button>
              <button className="small ghost" title="No single agent buy can exceed this, and an overnight sweep spends at most this much" onClick={() => setCap(agents.orderCap)}>💵 Cash cap</button>
            </div>
          )}
        </div>
      </div>

      {agents && agents.armed.length > 0 && (
        <div className="panel mb14" style={{ padding: '10px 14px' }}>
          <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>🤖 On duty</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {agents.armed.map((a) => (
              <span key={a.cardId} className="badge" style={{ gap: 6, padding: '4px 10px' }} title={`Auto-buys ${a.condition} at ≤ ${fmtUsd(a.cap)} on the market feed and BidBay`}>
                {a.name} · ≤ {fmtUsd(a.cap)} · {a.condition}
              </span>
            ))}
          </div>
          <div className="faint small mt8">Agents sweep once per game-day (overnight) — or sweep manually any time. Listed lots only: they never pay distributor market price.</div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon="★" text="Wishlist is empty" sub="Open any card and choose ADD TO WISHLIST." />
      ) : (
        <>
        <div className="filter-row">
          <SearchInput value={q} onChange={setQ} placeholder="Search your wishlist…" />
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
          <span className="result-count faint small">{shown.length} of {rows.length} cards · {fmtUsd(shown.reduce((a, r) => a + (r.price.usd ?? 0), 0))} shown</span>
          <div style={{ marginLeft: 'auto' }}><DensityToggle /></div>
        </div>
        {density === 'list' ? (
          <div className="card-grid density-list">
            {shown.map((r) => (
              <div key={r.card_id} className="card-cell" onClick={() => openCard(r.card_id)}>
                <CardImg src={r.image_small} alt={r.name} cardId={r.card_id} />
                <div className="card-meta">
                  <div className="nm">{r.name}</div>
                  <div className="st">{r.set_name}</div>
                  <div className="card-row-between">
                    <PriceTag price={r.price} />
                    <SourceBadge price={r.price} />
                  </div>
                </div>
                {r.target_price != null && <span className="badge live" title={`Alert target ${fmtUsd(r.target_price)}`}>🔔 {fmtUsd(r.target_price)}</span>}
                <button className="small ghost" title="Set price alert" onClick={(e) => { e.stopPropagation(); setAlert(r.card_id, r.target_price, r.price.usd) }}>🔔</button>
                <button
                  className="small ghost"
                  title={r.agent_enabled ? 'Disarm this agent' : 'Arm a standing auto-buy for this card'}
                  style={r.agent_enabled ? { color: 'var(--green)' } : undefined}
                  onClick={(e) => { e.stopPropagation(); armAgent(r.card_id, r.name, !!r.agent_enabled, r.agent_max_price ?? null, r.price.usd) }}
                >
                  {r.agent_enabled ? '🤖 ON' : '🤖'}
                </button>
                <button className="small ghost" title="Remove" onClick={(e) => { e.stopPropagation(); remove(r.card_id) }}>✕</button>
              </div>
            ))}
          </div>
        ) : (
          <div className={`grid ${density === 'compact' ? 'cols4' : 'cols3'}`}>
            {shown.map((r) => (
              <div key={r.card_id} className="panel" style={{ margin: 0 }}>
                <div className="row">
                  <div style={{ width: density === 'compact' ? 52 : 74, cursor: 'pointer' }} onClick={() => openCard(r.card_id)}>
                    <img src={r.image_small ?? ''} alt={r.name} style={{ width: '100%', borderRadius: 8, display: 'block' }} onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
                  </div>
                  <div className="grow">
                    <b className="small" style={{ cursor: 'pointer' }} onClick={() => openCard(r.card_id)}>{r.name}</b>
                    <div className="faint small">{r.set_name}</div>
                    <div className="mt8"><PriceTag price={r.price} /></div>
                    {density !== 'compact' && <div className="mt8"><SourceBadge price={r.price} /></div>}
                    {r.target_price != null && (
                      <div className="small mt8" style={{ color: 'var(--green, var(--green))' }} title="Fires into the activity feed when the market drops to your target">
                        🔔 Target {fmtUsd(r.target_price)}
                        {r.price.usd != null && r.price.usd <= r.target_price && ' · HIT — go buy it'}
                      </div>
                    )}
                    <div className="row mt8" style={{ gap: 6 }}>
                      <button className="ghost small" onClick={() => setAlert(r.card_id, r.target_price, r.price.usd)}>
                        {r.target_price != null ? 'Edit alert' : '🔔 Set price alert'}
                      </button>
                      <button
                        className={r.agent_enabled ? 'primary small' : 'ghost small'}
                        title={r.agent_enabled ? 'Disarm this agent' : 'Arm a standing auto-buy: sweeps the feeds once a game-day, buys at or under your cap'}
                        onClick={() => armAgent(r.card_id, r.name, !!r.agent_enabled, r.agent_max_price ?? null, r.price.usd)}
                      >
                        {r.agent_enabled ? '🤖 Agent ON' : '🤖 Arm agent'}
                      </button>
                    </div>
                    {r.agent_enabled && (
                      <div className="faint small mt8" style={{ color: 'var(--green, var(--green))' }}>🤖 Auto-buy {r.agent_condition} at ≤ {fmtUsd(r.agent_max_price ?? r.target_price ?? 0)} — sweeps once a game-day.</div>
                    )}
                  </div>
                  <button className="small ghost" onClick={() => remove(r.card_id)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
        </>
      )}
    </div>
  )
}
