import { useEffect, useMemo, useState } from 'react'
import { api, type FlipStock, type ResaleDeal, type ResaleLedger, type ResaleCard } from '../api'
import { useStore } from '../store'
import { byNum, byStr, CardImg, EmptyState, FirstUseTip, fmtUsd, SortSelect } from '../components'

// ---------------------------------------------------------------------------
// 💼 Resale desk — Phase 4. Buy undervalued lots from sellers, flip through
// the instant dealer or list at market, and watch the ledger.
// ---------------------------------------------------------------------------

const CONDITION_COLORS: Record<string, string> = {
  NM: 'var(--green)',
  LP: '#9acd32',
  MP: 'var(--yellow)',
  HP: '#e08030',
  DM: 'var(--red)',
}

export function ResaleView() {
  const { toast, refreshState, openCard } = useStore()
  const [tab, setTab] = useState<'inbox' | 'stock' | 'ledger'>('inbox')
  const [inbox, setInbox] = useState<ResaleDeal[] | null>(null)
  const [stock, setStock] = useState<FlipStock | null>(null)
  const [ledger, setLedger] = useState<ResaleLedger | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [stockQ, setStockQ] = useState('')
  const [stockSort, setStockSort] = useState('edge_desc')

  const shownLots = useMemo(() => {
    const lots = [...(stock?.lots ?? [])]
    const sorters: Record<string, (a: FlipStock['lots'][number], b: FlipStock['lots'][number]) => number> = {
      edge_desc: byNum((l) => l.marginPct, 'desc'),
      edge_asc: byNum((l) => l.marginPct, 'asc'),
      offer_desc: byNum((l) => l.offer, 'desc'),
      market_desc: byNum((l) => l.market, 'desc'),
      held_desc: byStr((l) => l.heldSince, 'asc'), // oldest held first
    }
    return lots.sort(sorters[stockSort] ?? sorters.edge_desc)
  }, [stock, stockSort])

  const load = () => {
    api.resaleInbox().then(setInbox).catch(() => setInbox([]))
    api.resaleStock().then(setStock).catch(() => setStock(null))
    api.resaleLedger().then(setLedger).catch(() => setLedger(null))
  }
  useEffect(() => { load() }, [])

  const haggle = async (id: number) => {
    setBusy(true)
    try {
      const r = await api.resaleHaggle(id)
      if (r.ok) {
        toast(r.sellerReply ?? 'Counteroffer received', 'good')
        load()
      } else toast(r.error ?? 'Haggle failed', 'bad')
    } finally { setBusy(false) }
  }

  const buy = async (id: number) => {
    setBusy(true)
    try {
      const r = await api.resaleBuy(id)
      if (r.ok) {
        toast(`Bought ${r.bought} cards for ${fmtUsd(r.spent ?? 0)}`, 'good')
        refreshState()
        load()
      } else toast(r.error ?? 'Buy failed', 'bad')
    } finally { setBusy(false) }
  }

  const walk = async (id: number) => {
    setBusy(true)
    try {
      await api.resaleWalk(id)
      load()
    } finally { setBusy(false) }
  }

  const instant = async (inventoryId: number) => {
    setBusy(true)
    try {
      const r = await api.resaleInstant(inventoryId)
      if (r.ok) {
        const profit = r.profit ?? 0
        toast(`Sold for ${fmtUsd(r.proceeds ?? 0)} — ${profit >= 0 ? 'profit' : 'loss'} ${fmtUsd(Math.abs(profit))}`, profit >= 0 ? 'good' : 'bad')
        refreshState()
        load()
      } else toast(r.error ?? 'Sale failed', 'bad')
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>💼 Resale Desk</h1>
          <div className="sub">Buy undervalued lots, flip them fast or at market — the first step of the business.</div>
        </div>
        <div className="right">
          <button className={tab === 'inbox' ? 'primary small' : 'small'} onClick={() => setTab('inbox')}>📬 Inbox</button>{' '}
          <button className={tab === 'stock' ? 'primary small' : 'small'} onClick={() => setTab('stock')}>📦 Flip stock</button>{' '}
          <button className={tab === 'ledger' ? 'primary small' : 'small'} onClick={() => setTab('ledger')}>🧾 Ledger</button>
        </div>
      </div>

      {tab === 'inbox' && (
        <div>
          <FirstUseTip surface="resale">
            <b style={{ color: 'var(--gold)' }}>💼 First lot?</b> Sellers drift in with bulk lots priced <b>below</b> what's inside —
            the "edge" is the estimated gap between ask and true value, but it's only an estimate until you <b>inspect</b> the cards.
            You can <b>haggle the ask</b> once per deal (that also reveals the true value — you'll know exactly what you're buying),
            then flip through the <b>instant dealer</b> for quick cash or list at market for more, slower money. Expired deals are gone — sellers don't wait.
          </FirstUseTip>
          {!inbox ? <div className="empty"><span className="spinner" /> Loading deals…</div> : inbox.length === 0 ? (
            <EmptyState icon="📬" text="No offers right now" sub="Sellers drift in while you play — check back or keep grinding." />
          ) : (
            <div className="mt14">
              {inbox.map((d) => (
                <div key={d.id} className="panel" style={{ marginBottom: 12 }}>
                  <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <b>{d.seller}</b> <span className="badge small">{d.sellerType}</span>
                      <div className="small" style={{ fontStyle: 'italic' }}>"{d.message}"</div>
                      <div className="faint small mt4">
                        {d.cards} cards · ask <b>{fmtUsd(d.ask)}</b> · {d.trueValueKnown ? `true value ${fmtUsd(d.estTrueValue)}` : `est. value ~${fmtUsd(d.estTrueValue)}`}
                        {' '}· <span style={{ color: d.margin >= 0 ? 'var(--green)' : 'var(--red)' }}>{d.margin >= 0 ? '+' : ''}{d.margin}% edge</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="small" disabled={busy} onClick={() => setExpanded(expanded === d.id ? null : d.id)}>
                        {expanded === d.id ? 'Hide lot' : 'Inspect lot'}
                      </button>
                      {!(d.trueValueKnown) && (
                        <button className="small" disabled={busy || d.trueValueKnown} onClick={() => haggle(d.id)}>Haggle</button>
                      )}
                      <button className="primary small" disabled={busy} onClick={() => buy(d.id)}>Buy {fmtUsd(d.ask)}</button>
                      <button className="small" disabled={busy} onClick={() => walk(d.id)}>Pass</button>
                    </div>
                  </div>
                  {expanded === d.id && (
                    <div className="grid cols3 mt8">
                      {d.preview.map((c, i) => (
                        <div key={i} className="panel" style={{ margin: 0, padding: 6, cursor: 'pointer' }} onClick={() => openCard(c.cardId)}>
                          <CardImg src={c.image} alt={c.name} cardId={c.cardId} />
                          <div className="row" style={{ justifyContent: 'space-between' }}>
                            <span className="badge" style={{ fontSize: 9, padding: '1px 5px', color: CONDITION_COLORS[c.condition] }}>{c.condition}</span>
                            <span className="faint small">{fmtUsd(c.market)}</span>
                          </div>
                        </div>
                      ))}
                      {d.cards > d.preview.length && (
                        <div className="faint small" style={{ alignSelf: 'center' }}>+ {d.cards - d.preview.length} more in the lot</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'stock' && (
        <div>
          {!stock ? <div className="empty"><span className="spinner" /> Counting the boxes…</div> : stock.lots.length === 0 ? (
            <EmptyState icon="📦" text="No flip stock" sub="Buy a lot from the inbox and it lands here." />
          ) : (
            <div className="mt14">
              <div className="faint small mb8">
                Instant offers from <b>{stock.dealer}</b> — cash today at 70–92% of market. Or list anything at full market from the Collection page.
              </div>
              <div className="filter-row" style={{ marginBottom: 10 }}>
                <SortSelect
                  value={stockSort}
                  onChange={setStockSort}
                  options={[
                    { value: 'edge_desc', label: 'Sort: Best dealer edge' },
                    { value: 'edge_asc', label: 'Sort: Worst dealer edge' },
                    { value: 'offer_desc', label: 'Sort: Offer size high→low' },
                    { value: 'market_desc', label: 'Sort: Market value high→low' },
                    { value: 'held_desc', label: 'Sort: Longest held' },
                  ]}
                />
                <span className="result-count faint small">{shownLots.length} lots in stock</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Card</th><th>Cost</th><th>Market</th><th>Dealer offer</th><th>Edge</th><th></th></tr>
                  </thead>
                  <tbody>
                    {shownLots.map((l) => (
                      <FlipRow key={l.inventoryId} lot={l} busy={busy} onSell={instant} onOpen={openCard} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'ledger' && ledger && (
        <div className="mt14">
          <div className="kpi-row" style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
            <div><div className="faint small">CAPITAL DEPLOYED</div><b>{fmtUsd(ledger.capitalDeployed)}</b></div>
            <div><div className="faint small">STOCK HELD</div><b>{ledger.stockCount} cards · {fmtUsd(ledger.stockValue)}</b></div>
            <div><div className="faint small">UNREALIZED</div><b style={{ color: ledger.unrealized >= 0 ? 'var(--green)' : 'var(--red)' }}>{ledger.unrealized >= 0 ? '+' : ''}{fmtUsd(ledger.unrealized)}</b></div>
            <div><div className="faint small">REALIZED</div><b style={{ color: ledger.realized >= 0 ? 'var(--green)' : 'var(--red)' }}>{ledger.realized >= 0 ? '+' : ''}{fmtUsd(ledger.realized)}</b></div>
            <div><div className="faint small">TOTAL ROI</div><b style={{ color: ledger.roiPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{ledger.roiPct >= 0 ? '+' : ''}{ledger.roiPct}%</b></div>
          </div>
          <div className="panel mt14">
            <b>How the money moves</b>
            <div className="small faint mt4">
              {ledger.instantSales} instant dealer sale{ledger.instantSales === 1 ? '' : 's'} ({fmtUsd(ledger.instantProceeds)}) · {ledger.marketSales} market sale{ledger.marketSales === 1 ? '' : 's'} · stock cost basis {fmtUsd(ledger.stockBasis)} vs {fmtUsd(ledger.stockValue)} at today's market.
              Instant sales pay 70–92% of market immediately; market listings pay full price when a buyer bites, minus the usual 10% fee.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FlipRow({ lot, busy, onSell, onOpen }: {
  lot: { inventoryId: number; cardId: string; costBasis: number; market: number; offer: number; marginPct: number }
  busy: boolean
  onSell: (id: number) => void
  onOpen: (id: string) => void
}) {
  const [img, setImg] = useState<string | null>(null)
  const [name, setName] = useState('')
  useEffect(() => {
    api.cardDetail(lot.cardId).then((d) => { setImg(d.card.image_small); setName(d.card.name) }).catch(() => {})
  }, [lot.cardId])

  return (
    <tr>
      <td>
        <span className="row" style={{ gap: 8, cursor: 'pointer', alignItems: 'center' }} onClick={() => onOpen(lot.cardId)}>
          <CardImg src={img} alt={name} cardId={lot.cardId} />
          <span>{name || lot.cardId}</span>
        </span>
      </td>
      <td>{fmtUsd(lot.costBasis)}</td>
      <td>{fmtUsd(lot.market)}</td>
      <td><b>{fmtUsd(lot.offer)}</b></td>
      <td style={{ color: lot.marginPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
        {lot.marginPct >= 0 ? '+' : ''}{lot.marginPct}%
      </td>
      <td>
        <button className="primary small" disabled={busy} onClick={() => onSell(lot.inventoryId)}>Sell now</button>
      </td>
    </tr>
  )
}
