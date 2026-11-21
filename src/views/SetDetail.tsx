import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { byNum, byStr, CardImg, Chip, DensityToggle, EmptyState, fmtUsd, LoadFailure, matchesQuery, PriceTag, RarityBadge, SearchInput, SortSelect, VirtualGrid } from '../components'
import type { SetDetailResponse, SetRow } from '../types'

/**
 * Set art for the gallery: the real expansion logo, with the tiny set symbol as
 * a fallback and a card glyph after that. The gallery used to show only the
 * 72px symbol floating in a dark box, which read as missing art.
 */
function SetArt({ set }: { set: SetRow }) {
  const chain = useMemo(() => [set.logo_url, set.symbol_url].filter((u): u is string => !!u), [set.logo_url, set.symbol_url])
  const [stage, setStage] = useState(0)
  useEffect(() => { setStage(0) }, [set.id])
  const url = chain[stage]
  if (!url) return <div className="set-art"><span className="set-art-fallback" aria-hidden>🎴</span></div>
  return (
    <div className="set-art">
      <img
        key={url}
        className={stage === 0 ? undefined : 'set-art-sym'}
        src={url}
        alt={set.name}
        loading="lazy"
        onError={() => setStage((s) => s + 1)}
      />
    </div>
  )
}

export function SetsGalleryView() {
  const [sets, setSets] = useState<SetRow[]>([])
  const [q, setQ] = useState('')
  const [series, setSeries] = useState('all')
  const [sort, setSort] = useState('release_desc')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = () => {
    setStatus('loading')
    api.sets()
      .then((d) => { setSets(d); setStatus('ready') })
      .catch(() => setStatus('error'))
  }
  useEffect(() => { load() }, [])

  const seriesList = useMemo(() => [...new Set(sets.map((s) => s.series))], [sets])
  const shown = useMemo(() => {
    const out = sets.filter((s) => {
      if (!matchesQuery(s, q, (r) => [r.name, r.series, r.ptcgo_code])) return false
      if (series !== 'all' && s.series !== series) return false
      return true
    })
    const syncPct = (s: SetRow) => (s.total > 0 ? (s.cards_synced ?? 0) / s.total : 0)
    const sorters: Record<string, (a: SetRow, b: SetRow) => number> = {
      release_desc: byStr((s) => s.release_date, 'desc'),
      release_asc: byStr((s) => s.release_date, 'asc'),
      name_asc: byStr((s) => s.name, 'asc'),
      name_desc: byStr((s) => s.name, 'desc'),
      cards_desc: byNum((s) => s.total, 'desc'),
      cards_asc: byNum((s) => s.total, 'asc'),
      sync_desc: byNum(syncPct, 'desc'),
      // Most complete first: the sets you are actually closest to finishing.
      // Ties break on raw owned count, so a 50% slice of a 300-card set edges
      // out a 50% slice of a 60-card one rather than flipping on row order.
      complete_desc: (a, b) => {
        const pct = (s: SetRow) => (s.total > 0 ? (s.owned ?? 0) / s.total : 0)
        return pct(b) - pct(a) || (b.owned ?? 0) - (a.owned ?? 0)
      },
    }
    return [...out].sort(sorters[sort] ?? sorters.release_desc)
  }, [sets, q, series, sort])

  if (status === 'error') return <LoadFailure what="the set gallery" onRetry={load} />
  if (status === 'loading' && sets.length === 0) return <EmptyState icon="🎴" text="Loading the sets…" sub="Opening the expansion index." />

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Sets</h1>
          <div className="sub">Every real Pokémon TCG expansion. {sets.length} sets on file.</div>
        </div>
      </div>
      <div className="filter-row">
        <SearchInput value={q} onChange={setQ} placeholder="Search sets by name, series, code…" />
        <SortSelect
          value={sort}
          onChange={setSort}
          options={[
            { value: 'complete_desc', label: 'Sort: Most complete' },
            { value: 'release_desc', label: 'Sort: Newest first' },
            { value: 'release_asc', label: 'Sort: Oldest first' },
            { value: 'name_asc', label: 'Sort: Name A→Z' },
            { value: 'name_desc', label: 'Sort: Name Z→A' },
            { value: 'cards_desc', label: 'Sort: Biggest sets' },
            { value: 'cards_asc', label: 'Sort: Smallest sets' },
            { value: 'sync_desc', label: 'Sort: Most synced' },
          ]}
        />
        <span className="result-count faint small">{shown.length} of {sets.length} sets</span>
      </div>
      <div className="filter-row">
        <div className="chip-row">
          <Chip on={series === 'all'} onClick={() => setSeries('all')}>All series</Chip>
          {seriesList.map((s) => (
            <Chip key={s} on={series === s} onClick={() => setSeries(series === s ? 'all' : s)}>{s}</Chip>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptyState
          icon="🎴"
          text={sets.length === 0 ? 'No sets on file yet' : 'No sets match'}
          sub={sets.length === 0 ? 'The catalog is still syncing expansions — try again in a moment.' : 'Try a different name or clear the filters.'}
          action={sets.length === 0 ? { label: 'Try again', onClick: load } : undefined}
        />
      ) : (
      <div className="card-grid">
        {shown.map((s) => {
          // The dex read: how far through THIS set you are, not how much of the
          // catalog has synced. Secret rares count — a finished set is a
          // finished set, master printings included.
          const owned = s.owned ?? 0
          const pct = s.total > 0 ? Math.min(100, (owned / s.total) * 100) : 0
          const done = s.total > 0 && owned >= s.total
          return (
          <div key={s.id} className="card-cell" onClick={() => (window.location.hash = `#/set/${s.id}`)}>
            <SetArt set={s} />
            <div className="card-meta">
              <div className="nm">{s.name}</div>
              <div className="st">{s.series} · {s.release_date}</div>
              <div className={`set-progress ${done ? 'done' : ''}`}>
                <div
                  className="set-progress-bar"
                  role="progressbar"
                  aria-label={`${s.name} completion`}
                  aria-valuemin={0}
                  aria-valuemax={s.total}
                  aria-valuenow={owned}
                >
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div className="set-progress-meta">
                  <span>{owned} of {s.total}</span>
                  {s.ptcgo_code && <span className="set-code">{s.ptcgo_code}</span>}
                </div>
              </div>
            </div>
          </div>
          )
        })}
      </div>
      )}
    </div>
  )
}

export function SetDetailView({ setId }: { setId: string }) {
  const { openCard, density } = useStore()
  const [data, setData] = useState<SetDetailResponse | null>(null)
  const [hideOwned, setHideOwned] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('number_asc')
  const [rarity, setRarity] = useState('all')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = () => {
    setStatus('loading')
    api.setDetail(setId)
      .then((d) => { setData(d); setStatus('ready') })
      .catch(() => setStatus('error'))
  }
  useEffect(() => { setData(null); load() }, [setId])

  const cards = data?.cards ?? []

  const rarityList = useMemo(() => [...new Set(cards.map((c) => c.rarity).filter(Boolean) as string[])], [cards])
  const shownCards = useMemo(() => {
    const out = cards.filter((c) => {
      if (hideOwned && (c.ownedQty ?? 0) > 0) return false
      if (!matchesQuery(c, q, (r) => [r.name, r.number, r.rarity])) return false
      if (rarity !== 'all' && c.rarity !== rarity) return false
      return true
    })
    const numKey = (c: SetDetailResponse['cards'][number]) => {
      const m = c.number.match(/(\d+)/)
      return m ? Number(m[1]) : 0
    }
    const sorters: Record<string, (a: SetDetailResponse['cards'][number], b: SetDetailResponse['cards'][number]) => number> = {
      number_asc: (a, b) => numKey(a) - numKey(b),
      number_desc: (a, b) => numKey(b) - numKey(a),
      name_asc: byStr((c) => c.name, 'asc'),
      name_desc: byStr((c) => c.name, 'desc'),
      price_desc: byNum((c) => c.price?.usd, 'desc'),
      price_asc: byNum((c) => c.price?.usd, 'asc'),
    }
    return [...out].sort(sorters[sort] ?? sorters.number_asc)
  }, [cards, hideOwned, q, rarity, sort])

  if (status === 'error') return <LoadFailure what="that set" sub="The catalog did not answer. Your collection is safe — this was only the set page." onRetry={load} />
  if (!data) return <EmptyState icon="⏳" text="Loading set…" sub="Pulling every card, price and owned count for this expansion." />
  if (cards.length === 0) return <EmptyState icon="🃏" text="This set has no cards yet" sub="The catalog is still filling it — try again in a moment." action={{ label: 'Try again', onClick: load }} />

  const missing = cards.filter((c) => (c.ownedQty ?? 0) === 0)

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="ghost small" onClick={() => { window.location.hash = '#/collection/sets' }}>← All sets</button>
          <h1 style={{ marginTop: 8 }}>{data.set.name}</h1>
          <div className="sub">{data.set.series} · Released {data.set.release_date} · {data.set.total} cards</div>
        </div>
      </div>

      <div className="grid cols4">
        <div className="kpi"><div className="lbl">Completion</div><div className="val">{data.completion.pct}%</div><div className="note">{data.completion.owned} / {data.completion.total} cards</div></div>
        <div className="kpi"><div className="lbl">Cards Owned</div><div className="val">{data.completion.owned}</div><div className="note">{data.completion.total - data.completion.owned} missing</div></div>
        <div className="kpi"><div className="lbl">Collection Value</div><div className="val">{fmtUsd(data.completion.collectionValue)}</div><div className="note">owned cards at market</div></div>
        <div className="kpi">
          <div className="lbl">Est. Cost to Complete</div>
          <div className="val">{fmtUsd(data.completion.missingValue)}</div>
          <div className="note">sum of missing cards' market prices</div>
        </div>
      </div>

      <div className="filter-row mt14">
        <SearchInput value={q} onChange={setQ} placeholder={`Search ${data.set.name}…`} />
        <SortSelect
          value={sort}
          onChange={setSort}
          options={[
            { value: 'number_asc', label: 'Sort: Card number ↑' },
            { value: 'number_desc', label: 'Sort: Card number ↓' },
            { value: 'name_asc', label: 'Sort: Name A→Z' },
            { value: 'name_desc', label: 'Sort: Name Z→A' },
            { value: 'price_desc', label: 'Sort: Price high→low' },
            { value: 'price_asc', label: 'Sort: Price low→high' },
          ]}
        />
        <select value={rarity} onChange={(e) => setRarity(e.target.value)} aria-label="Rarity">
          <option value="all">All rarities</option>
          {rarityList.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <Chip on={hideOwned} onClick={() => setHideOwned(!hideOwned)}>Show missing only</Chip>
        <span className="result-count faint small">{shownCards.length} of {data.cards.length} cards</span>
        <div style={{ marginLeft: 'auto' }}><DensityToggle /></div>
      </div>
      <div className="filter-row">
        <span className="faint small">Silhouettes are cards you don't own yet — click any card for ways to get it.</span>
      </div>

      <VirtualGrid
        className={`card-grid ${density !== 'comfortable' ? `density-${density}` : ''}`}
        items={shownCards}
        density={density}
        empty={null}
        render={(c) => (
          <div className={`card-cell ${(c.ownedQty ?? 0) === 0 ? 'silhouette' : ''}`} onClick={() => openCard(c.id)}>
            <CardImg src={c.image_small} alt={c.name} cardId={c.id} rarity={c.rarity} />
            <div className="card-meta">
              <div className="nm">{c.name}</div>
              <div className="st">{c.number} · {c.rarity ?? '—'}</div>
              <div className="card-row-between">
                <PriceTag price={c.price} />
                {(c.ownedQty ?? 0) > 0 && <span className="badge live">×{c.ownedQty}</span>}
              </div>
            </div>
          </div>
        )}
      />

      {missing.length === 0 && data.completion.total > 0 && (
        <div className="panel mt22" style={{ textAlign: 'center', borderColor: 'rgba(46,230,168,0.5)' }}>
          <h2>🏆 Set complete!</h2>
          <p className="muted small">Every single card in {data.set.name} — you absolute completionist.</p>
        </div>
      )}
    </div>
  )
}
