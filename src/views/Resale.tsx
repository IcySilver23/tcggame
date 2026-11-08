import { useEffect, useMemo, useState } from 'react'
import { api, type FlipStock, type ResaleDeal, type ResaleLedger } from '../api'
import { useStore } from '../store'
import { byNum, CardImg, EmptyState, FirstUseTip, fmtUsd, SortSelect } from '../components'
import { variantTag } from '../variant-label'

// ---------------------------------------------------------------------------
// 💼 Resale desk — the business screen.
//
// Three lanes over one standing ledger: the inbox is a stack of notes sellers
// have left on the desk, the shelf is what those lots turned into, and the
// statement is where the money has gone. The ledger tape stays visible in every
// lane, because "am I up?" is the question this screen exists to answer.
// ---------------------------------------------------------------------------

const COND_COLOR: Record<string, string> = {
  NM: 'var(--green)',
  LP: '#9acd32',
  MP: 'var(--yellow)',
  HP: '#e08030',
  DM: 'var(--red)',
}

function untilText(iso: string, now: number): string {
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return 'closing'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m left`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m left`
}

function heldText(iso: string): string {
  const days = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000))
  return days === 0 ? 'today' : `${days}d`
}

const pnl = (n: number) => (n >= 0 ? 'rd-pos' : 'rd-neg')
const sign = (n: number) => (n >= 0 ? '+' : '−')

export function ResaleView() {
  const { toast, refreshState, openCard, state } = useStore()
  const [tab, setTab] = useState<'inbox' | 'stock' | 'ledger'>('inbox')
  const [inbox, setInbox] = useState<ResaleDeal[] | null>(null)
  const [stock, setStock] = useState<FlipStock | null>(null)
  const [ledger, setLedger] = useState<ResaleLedger | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [stockSort, setStockSort] = useState('edge_desc')
  const [now, setNow] = useState(() => Date.now())

  // Countdowns want to move; 30s is enough for a two-hour window.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const shownLots = useMemo(() => {
    const lots = [...(stock?.lots ?? [])]
    const sorters: Record<string, (a: FlipStock['lots'][number], b: FlipStock['lots'][number]) => number> = {
      edge_desc: byNum((l) => l.marginPct, 'desc'),
      edge_asc: byNum((l) => l.marginPct, 'asc'),
      offer_desc: byNum((l) => l.offer, 'desc'),
      market_desc: byNum((l) => l.market, 'desc'),
      held_desc: byNum((l) => new Date(l.heldSince).getTime(), 'asc'),
    }
    return lots.sort(sorters[stockSort] ?? sorters.edge_desc)
  }, [stock, stockSort])

  const shelfOffer = useMemo(
    () => Math.round(shownLots.reduce((a, l) => a + l.offer, 0) * 100) / 100,
    [shownLots],
  )

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
        toast(`Bought ${r.bought} cards for ${fmtUsd(r.spent ?? 0)} — they're on the shelf`, 'good')
        refreshState()
        setExpanded(null)
        load()
        setTab('stock')
      } else toast(r.error ?? 'Buy failed', 'bad')
    } finally { setBusy(false) }
  }

  const walk = async (id: number) => {
    setBusy(true)
    try {
      await api.resaleWalk(id)
      setExpanded(null)
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

  const deals = inbox?.length ?? 0
  const shelfCount = stock?.lots.length ?? 0

  return (
    <div className="rd">
      <header className="rd-top">
        <div className="rd-id">
          <span className="rd-mark" aria-hidden>💼</span>
          <div>
            <h1>Resale Desk</h1>
            <div className="rd-tag">
              Buy the lot, flip the cardboard.
              {stock?.dealer ? <> <b>{stock.dealer}</b> is on the phone today.</> : null}
            </div>
          </div>
        </div>
        <div className="rd-tabs" role="tablist">
          <button className={`rd-tab ${tab === 'inbox' ? 'on' : ''}`} onClick={() => setTab('inbox')} role="tab">
            📬 Inbox<i>{deals}</i>
          </button>
          <button className={`rd-tab ${tab === 'stock' ? 'on' : ''}`} onClick={() => setTab('stock')} role="tab">
            📦 Shelf<i>{shelfCount}</i>
          </button>
          <button className={`rd-tab ${tab === 'ledger' ? 'on' : ''}`} onClick={() => setTab('ledger')} role="tab">
            🧾 Statement
          </button>
        </div>
      </header>

      {ledger && (
        <div className="rd-tape" aria-label="Ledger summary">
          <div className="rd-cell">
            <span>Out</span>
            <b>{fmtUsd(ledger.capitalDeployed)}</b>
            <em>capital</em>
          </div>
          <div className="rd-cell">
            <span>Realized</span>
            <b className={pnl(ledger.realized)}>{sign(ledger.realized)}{fmtUsd(Math.abs(ledger.realized))}</b>
            <em>{ledger.instantSales + ledger.marketSales} sales</em>
          </div>
          <div className="rd-cell">
            <span>Unrealized</span>
            <b className={pnl(ledger.unrealized)}>{sign(ledger.unrealized)}{fmtUsd(Math.abs(ledger.unrealized))}</b>
            <em>{ledger.stockCount} on shelf</em>
          </div>
          <div className="rd-cell">
            <span>ROI</span>
            <b className={pnl(ledger.roiPct)}>{sign(ledger.roiPct)}{ledger.roiPct}%</b>
            <em>all in</em>
          </div>
        </div>
      )}

      {tab === 'inbox' && (
        <div>
          <FirstUseTip surface="resale">
            <b style={{ color: 'var(--gold)' }}>💼 Reading the notes.</b> Sellers leave a lot on the desk priced under what's inside —
            the <b>edge bar</b> is how far under. It is an estimate until you <b>haggle</b>, which costs you nothing but also reveals
            the true value. Buy, then sell fast off the <b>shelf</b> at dealer rates or list at full market from your Collection.
            Notes expire; the clock is on each one.
          </FirstUseTip>

          {!inbox ? (
            <div className="empty"><span className="spinner" /> Loading the inbox…</div>
          ) : inbox.length === 0 ? (
            <EmptyState icon="📬" text="No notes on the desk" sub="Sellers drift in while you play — check back or keep grinding." />
          ) : (
            <div className="rd-list">
              {inbox.map((d) => {
                const hot = d.margin >= 15
                const cold = d.margin < 0
                const ratio = d.ask > 0 ? d.estTrueValue / d.ask : 1
                const fill = Math.max(4, Math.min(100, (ratio / 2) * 100))
                const msLeft = new Date(d.expiresAt).getTime() - now
                const open = expanded === d.id
                return (
                  <article key={d.id} className={`rd-deal ${hot ? 'hot' : cold ? 'cold' : ''}`}>
                    <div className="rd-deal-top">
                      <div className="rd-seller">
                        <b>{d.seller}</b>
                        <span className="rd-kind">{d.sellerType}</span>
                      </div>
                      <span className={`rd-clock ${msLeft < 30 * 60_000 ? 'urgent' : ''}`}>⏳ {untilText(d.expiresAt, now)}</span>
                    </div>

                    <p className="rd-quote">“{d.message}”</p>

                    <div className="rd-fan" onClick={() => setExpanded(open ? null : d.id)} title={open ? 'Hide the lot' : 'Look through the lot'}>
                      {d.preview.slice(0, 4).map((c, i) => (
                        <CardImg key={`${c.cardId}-${i}`} src={c.image} alt={c.name} cardId={c.cardId} />
                      ))}
                      {d.cards > Math.min(4, d.preview.length) && (
                        <span className="rd-fan-more">+{d.cards - Math.min(4, d.preview.length)}</span>
                      )}
                    </div>

                    <div className="rd-metrics">
                      <div><span>Ask</span><b>{fmtUsd(d.ask)}</b></div>
                      <div><span>{d.trueValueKnown ? 'True value' : 'Est. value'}</span><b>{fmtUsd(d.estTrueValue)}</b></div>
                      <div><span>Cards</span><b>{d.cards}</b></div>
                    </div>

                    <div className="rd-meter" aria-hidden>
                      <i style={{ width: `${fill}%` }} />
                      <u />
                    </div>
                    <div className="rd-edge">
                      <span>{d.trueValueKnown ? 'Checked against market' : 'Estimate — haggle to know'}</span>
                      <b className={pnl(d.margin)}>{sign(d.margin)}{d.margin}% edge</b>
                    </div>

                    <div className="rd-actions">
                      <button className="primary small" disabled={busy} onClick={() => buy(d.id)}>
                        Buy {fmtUsd(d.ask)}
                      </button>
                      <button className="small" disabled={busy || d.trueValueKnown} onClick={() => haggle(d.id)}>
                        {d.trueValueKnown ? '✓ Value known' : 'Haggle'}
                      </button>
                      <button className="small" disabled={busy} onClick={() => setExpanded(open ? null : d.id)}>
                        {open ? 'Close lot' : 'Look'}
                      </button>
                      <button className="small ghost" disabled={busy} onClick={() => walk(d.id)}>Pass</button>
                    </div>

                    {open && (
                      <div className="rd-lot">
                        {d.preview.map((c, i) => (
                          <div key={`${c.cardId}-${i}`} className="rd-lot-card" onClick={() => openCard(c.cardId)}>
                            <CardImg src={c.image} alt={c.name} cardId={c.cardId} />
                            <span>
                              <b style={{ color: COND_COLOR[c.condition] ?? 'var(--text-faint)' }}>{c.condition}</b>
                              <b>{fmtUsd(c.market)}</b>
                            </span>
                          </div>
                        ))}
                        {d.cards > d.preview.length && (
                          <span className="faint small" style={{ alignSelf: 'center' }}>
                            +{d.cards - d.preview.length} more
                          </span>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'stock' && (
        <div>
          {!stock ? (
            <div className="empty"><span className="spinner" /> Counting the boxes…</div>
          ) : stock.lots.length === 0 ? (
            <EmptyState icon="📦" text="The shelf is empty" sub="Buy a lot from the inbox and it lands here." />
          ) : (
            <>
              <div className="rd-banner">
                <div>
                  <b>{stock.dealer}</b> will take the whole shelf today for <b>{fmtUsd(shelfOffer)}</b>
                  <span className="faint small"> — dealer offers run 70–92% of market, cash now. Listing at full market in Collection pays more, slower.</span>
                </div>
                <SortSelect
                  value={stockSort}
                  onChange={setStockSort}
                  options={[
                    { value: 'edge_desc', label: 'Best return first' },
                    { value: 'edge_asc', label: 'Worst return first' },
                    { value: 'offer_desc', label: 'Biggest offer' },
                    { value: 'market_desc', label: 'Most valuable' },
                    { value: 'held_desc', label: 'Longest held' },
                  ]}
                />
              </div>

              <div className="rd-shelf">
                {shownLots.map((l) => (
                  <div key={l.inventoryId} className="rd-flip">
                    <div className="rd-flip-art" onClick={() => openCard(l.cardId)}>
                      <CardImg src={l.image} alt={l.name} cardId={l.cardId} />
                    </div>
                    <div className="rd-flip-body">
                      <div className="rd-flip-name">{l.name}</div>
                      <div className="rd-flip-meta">
                        {l.condition}{variantTag(l.variant) ? ` · ${variantTag(l.variant)}` : ''} · held {heldText(l.heldSince)}
                      </div>
                      <div className="rd-flip-nums">
                        <span>cost {fmtUsd(l.costBasis)}</span>
                        <span>market {fmtUsd(l.market)}</span>
                      </div>
                      <div className="rd-flip-offer">
                        <b>{fmtUsd(l.offer)}</b>
                        <em className={pnl(l.marginPct)}>{sign(l.marginPct)}{Math.abs(l.marginPct)}%</em>
                        <span className="faint small">vs cost</span>
                      </div>
                      <button className="primary small" disabled={busy} onClick={() => instant(l.inventoryId)}>
                        Sell now
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'ledger' && ledger && (
        <div className="rd-statement">
          <div className="rd-st-head">
            <span>Statement</span>
            <span>Day {state?.day?.number ?? '—'}</span>
          </div>
          <div className="rd-line"><span>Capital deployed</span><b>{fmtUsd(ledger.capitalDeployed)}</b></div>
          <div className="rd-line"><span>Shelf at cost</span><b>{fmtUsd(ledger.stockBasis)}</b></div>
          <div className="rd-line"><span>Shelf at market ({ledger.stockCount} cards)</span><b>{fmtUsd(ledger.stockValue)}</b></div>
          <div className="rd-line">
            <span>Unrealized</span>
            <b className={pnl(ledger.unrealized)}>{sign(ledger.unrealized)}{fmtUsd(Math.abs(ledger.unrealized))}</b>
          </div>
          <div className="rd-line">
            <span>Dealer sales — proceeds ({ledger.instantSales})</span>
            <b>{fmtUsd(ledger.instantProceeds)}</b>
          </div>
          <div className="rd-line">
            <span>Market sales — profit ({ledger.marketSales})</span>
            <b className={pnl(ledger.realized)}>{sign(ledger.realized)}{fmtUsd(Math.abs(ledger.realized))} profit</b>
          </div>
          <div className="rd-total">
            <span>Total ROI</span>
            <b className={pnl(ledger.roiPct)}>{sign(ledger.roiPct)}{ledger.roiPct}%</b>
          </div>
          <div className="rd-note">
            ROI counts realized profit plus what the shelf would fetch at today's market, over every dollar you put into lots.
            Dealer sales pay 70–92% of market immediately with no fee; market listings pay full price when a buyer bites, minus the usual 10%.
          </div>
        </div>
      )}
    </div>
  )
}
