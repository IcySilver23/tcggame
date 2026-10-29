import { useEffect, useState } from 'react'
import { api } from '../api'
import type { BuylistSection, BuylistOffers, BuylistShelf, BuylistShopOut } from '../api'
import { useStore } from '../store'
import { EmptyState, FirstUseTip, fmtUsd } from '../components'

const SPLITS: { label: string; value: number }[] = [
  { label: 'All cash', value: 0 },
  { label: '25% credit', value: 0.25 },
  { label: '50% credit', value: 0.5 },
  { label: 'All credit', value: 1 },
]

/** One flat, honest "offer" line: market → payout, with the % visible. */
function OfferRow({
  name, sub, market, payout, want, picked, onToggle, onOpen,
}: {
  name: React.ReactNode
  sub: string
  market: number
  payout: number
  want?: boolean
  picked?: boolean
  onToggle?: () => void
  onOpen?: () => void
}) {
  const pct = market > 0 ? Math.round((payout / market) * 100) : 0
  return (
    <div
      className="row small bl-row"
      style={{
        gap: 10,
        padding: '6px 10px',
        borderRadius: 6,
        background: picked ? 'rgba(255,203,5,0.07)' : 'transparent',
        border: picked ? '1px solid rgba(255,203,5,0.35)' : '1px solid transparent',
        cursor: onToggle ? 'pointer' : undefined,
      }}
      onClick={onToggle}
    >
      {onToggle != null && (
        <input type="checkbox" checked={!!picked} onChange={onToggle} onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }} />
      )}
      <span
        style={{ minWidth: 0, flex: '1 1 200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: onOpen ? 'pointer' : undefined }}
        onClick={(e) => { if (onOpen) { e.stopPropagation(); onOpen() } }}
      >
        {name} <span className="faint">· {sub}</span>
      </span>
      {want && (
        <span className="badge hit" title="On this shop's want list — they pay over their usual rate for it" style={{ flexShrink: 0 }}>🔥 want</span>
      )}
      <span className="faint" style={{ width: 78, textAlign: 'right', flexShrink: 0 }} title="Current market value">{fmtUsd(market)}</span>
      <b style={{ width: 80, textAlign: 'right', flexShrink: 0 }} title="What they hand you in cash">{fmtUsd(payout)}</b>
      <span className="faint" style={{ width: 38, textAlign: 'right', flexShrink: 0 }} title="Payout as a share of market">{pct}%</span>
    </div>
  )
}

/** Column header matching OfferRow's widths. */
function OfferHead() {
  return (
    <div className="row small faint" style={{ gap: 10, padding: '2px 10px 6px', borderBottom: '1px solid var(--border-soft)' }}>
      <span style={{ width: 24, flexShrink: 0 }} />
      <span style={{ flex: '1 1 200px', minWidth: 0 }}>Card</span>
      <span style={{ width: 78, textAlign: 'right', flexShrink: 0 }}>Market</span>
      <span style={{ width: 80, textAlign: 'right', flexShrink: 0 }}>They pay</span>
      <span style={{ width: 38, textAlign: 'right', flexShrink: 0 }}>%</span>
    </div>
  )
}

export function BuylistView() {
  const { toast, refreshState, openCard } = useStore()
  const [data, setData] = useState<BuylistSection | null>(null)
  const [shopId, setShopId] = useState<number | null>(null)
  const [offers, setOffers] = useState<BuylistOffers | null>(null)
  const [shelf, setShelf] = useState<BuylistShelf | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [split, setSplit] = useState(0)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'sell' | 'shop'>('sell')

  const loadAll = () => api.buylist().then(setData).catch(() => {})
  useEffect(() => { loadAll() }, [])
  useEffect(() => {
    if (shopId == null && data && data.shops.length > 0) setShopId(data.shops[0].id)
  }, [data, shopId])
  useEffect(() => {
    if (shopId == null) return
    setPicked(new Set())
    api.buylistOffers(shopId).then(setOffers).catch(() => setOffers(null))
    api.buylistShelf(shopId).then(setShelf).catch(() => setShelf(null))
  }, [shopId])

  const shop: BuylistShopOut | undefined = data?.shops.find((s) => s.id === shopId)
  const pickedRows = (offers?.offers ?? []).filter((o) => picked.has(o.inventoryId))
  const pickedCash = pickedRows.reduce((a, o) => a + o.payoutCash, 0)
  const pickedCredit = pickedRows.reduce((a, o) => a + o.payoutCredit, 0)
  const splitCash = pickedCash * (1 - split)
  const splitCredit = pickedCredit * split

  const doSell = async () => {
    if (shopId == null || picked.size === 0) return
    setBusy(true)
    try {
      const r = await api.buylistSell(shopId, [...picked], split, pickedCash)
      if (r.ok) {
        // Name what the shop actually paid — the sheet is an offer, the
        // register receipt is the truth.
        const cash = r.cash ?? 0
        const credit = r.credit ?? 0
        toast(`Sold ${picked.size} card${picked.size === 1 ? '' : 's'} — ${fmtUsd(cash)} cash${credit > 0 ? ` + ${fmtUsd(credit)} store credit` : ''}.`, 'good')
        setPicked(new Set())
        refreshState()
        loadAll()
        api.buylistOffers(shopId).then(setOffers).catch(() => {})
        api.buylistShelf(shopId).then(setShelf).catch(() => {})
      } else {
        // A refused stale quote isn't a failure — the shop re-checked its
        // sheet, so show the fresh numbers and keep the player's picks.
        const moved = !!r.error && r.error.includes('now offers')
        if (moved) api.buylistOffers(shopId).then(setOffers).catch(() => {})
        toast(r.error ?? 'Sale failed', moved ? 'info' : 'bad')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sale failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const doBuy = async (rowId: number, payCredit: boolean) => {
    if (shopId == null) return
    setBusy(true)
    try {
      const r = await api.buylistBuyShelf(shopId, rowId, payCredit)
      if (r.ok) {
        toast(`Bought off the shelf — ${fmtUsd(r.paid ?? 0)} ${r.method === 'credit' ? 'store credit' : 'cash'}.`, 'good')
        refreshState()
        loadAll()
        api.buylistShelf(shopId).then(setShelf).catch(() => {})
      } else toast(r.error ?? 'Purchase failed', 'bad')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Purchase failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  // Whole-collection offer header numbers, so the sheet's top line says what
  // a full walk-out looks like before you pick anything.
  const whole = offers?.totals

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🧾 The Buylist</h1>
          <div className="sub">Shops buy your cards outright — instant cash, no listing wait, no sell fee, but they keep a cut. Pick a shop below; sell on the SELL tab, spend credit on the SHOP tab.</div>
        </div>
      </div>

      <FirstUseTip surface="buylist">
        Every store pays a flat rate (55–75% of market) for anything, and a <b>want list</b> premium for the four cards it's
        hunting. Take part of the payout as <b>store credit</b> and they pay a bonus rate on that leg — credit only spends at
        that shop, on its own shelf. Selling to the buylist is trading margin for money today.
      </FirstUseTip>

      {/* Shop picker — one compact card per shop: name, rate, credit held. */}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'stretch' }}>
        {(data?.shops ?? []).map((s) => (
          <div
            key={s.id}
            className="panel"
            style={{
              margin: 0,
              padding: '8px 12px',
              minWidth: 168,
              flex: '1 1 168px',
              cursor: 'pointer',
              borderColor: s.id === shopId ? 'var(--yellow)' : undefined,
              background: s.id === shopId ? 'var(--panel2)' : undefined,
            }}
            onClick={() => setShopId(s.id)}
          >
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>{s.name}</div>
            <div className="small faint" style={{ marginTop: 2 }}>
              pays ~{Math.round(s.basePct)}% cash{s.bonusRate > 0 && <> · credit leg pays +{Math.round(s.bonusRate)}%</>}
            </div>
            {s.credit > 0 ? (
              <div className="small" style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmtUsd(s.credit)} credit here</div>
            ) : (
              <div className="small faint">no credit held</div>
            )}
          </div>
        ))}
      </div>

      {shop && (
        <div className="panel mb14">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <b>🔥 {shop.name}'s want list</b>
              <span className="faint small" style={{ marginLeft: 8 }}>rotates weekly — these pay over their usual rate</span>
            </div>
            {shop.credit > 0 && <span className="badge hit">🏪 {fmtUsd(shop.credit)} store credit here</span>}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {shop.wants.map((w) => {
              const est = w.market * Math.min(1.15, (shop.basePct / 100) * (1 + w.premium / 100))
              return (
                <div key={w.cardId} className="panel" style={{ margin: 0, padding: '8px 12px', background: 'var(--panel2)', cursor: 'pointer', minWidth: 150, flex: '0 1 auto' }} onClick={() => openCard(w.cardId)}>
                  <div style={{ fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 210 }}>{w.name}</div>
                  <div className="small faint" style={{ marginTop: 2 }}>
                    {fmtUsd(w.market)} market · they'd pay <b style={{ color: 'var(--green)' }}>≈{fmtUsd(est)}</b>
                    <span title={`Their usual ${Math.round(shop.basePct)}% rate plus the +${Math.round(w.premium)}% want premium`}> · +{Math.round(w.premium)}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        <button className={tab === 'sell' ? 'primary small' : 'small'} onClick={() => setTab('sell')}>💰 Sell to {shop?.name ?? 'the buylist'}</button>
        <button className={tab === 'shop' ? 'primary small' : 'small'} onClick={() => setTab('shop')}>
          🏪 Shop {shop?.credit ? `· ${fmtUsd(shop.credit)} credit` : ''} <span className="badge est" style={{ marginLeft: 4 }}>{shelf?.rows.length ?? 0}</span>
        </button>
      </div>

      {tab === 'sell' ? (
        <div className="panel mb14">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <b>Your offer sheet{offers?.shop ? <> — {offers.shop.name}</> : ''}</b>
            {whole && (offers?.offers.length ?? 0) > 0 && (
              <span className="small muted">whole collection: {fmtUsd(whole.cash)} cash / {fmtUsd(whole.credit)} as credit</span>
            )}
          </div>

          {(offers?.offers ?? []).length === 0 ? (
            <EmptyState icon="🧾" text="Nothing on your sheet they'd buy" sub="Pull cards, grade them, or wait — offers refresh with your collection." />
          ) : (
            <div style={{ marginTop: 8 }}>
              <OfferHead />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                {offers!.offers.map((o) => (
                  <OfferRow
                    key={o.inventoryId}
                    name={o.name}
                    sub={o.condition}
                    market={o.market}
                    payout={o.payoutCash}
                    want={o.want}
                    picked={picked.has(o.inventoryId)}
                    onToggle={() =>
                      setPicked((p) => { const n = new Set(p); if (n.has(o.inventoryId)) n.delete(o.inventoryId); else n.add(o.inventoryId); return n })
                    }
                    onOpen={() => openCard(o.cardId)}
                  />
                ))}
              </div>
            </div>
          )}

          {picked.size > 0 && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--panel2)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <span className="small"><b>{picked.size}</b> picked · offer <b>{fmtUsd(pickedCash)}</b> cash / {fmtUsd(pickedCredit)} as credit</span>
                <div className="row" style={{ gap: 6 }}>
                  <button className="ghost small" onClick={() => setPicked(new Set((offers?.offers ?? []).map((o) => o.inventoryId)))}>Pick all</button>
                  <button className="ghost small" onClick={() => setPicked(new Set())}>Clear</button>
                </div>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="small faint">payout split:</span>
                {SPLITS.map((s) => (
                  <button key={s.label} className={split === s.value ? 'small primary' : 'small ghost'} onClick={() => setSplit(s.value)}>{s.label}</button>
                ))}
              </div>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <span className="small">
                  → you'd walk out with <b>{fmtUsd(splitCash)}</b> cash{splitCredit > 0 && <> + <b>{fmtUsd(splitCredit)}</b> store credit</>}
                </span>
                <button className="primary" disabled={busy} onClick={doSell}>Sell {picked.size} card{picked.size === 1 ? '' : 's'}</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="panel mb14">
          {shelf && shelf.rows.length > 0 ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <b>{shelf.shop.name}'s shelf</b>
                <span className="small muted">credit here: <b>{fmtUsd(shelf.credit)}</b> · cash works too</span>
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {shelf.rows.map((r) => (
                  <OfferRow
                    key={r.id}
                    name={r.name}
                    sub={r.condition}
                    market={r.market}
                    payout={r.price}
                    want={r.wantStock}
                    onOpen={() => openCard(r.cardId)}
                  />
                ))}
              </div>
              {shelf.history.length > 0 && (
                <div className="small faint" style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border-soft)' }}>
                  {shelf.history.slice(0, 5).map((h, i) => (
                    <div key={i}>{h.delta >= 0 ? '+' : ''}{fmtUsd(h.delta)} — {h.note}</div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <EmptyState icon="🏪" text="The shelf is empty right now" sub="Shops restock weekly — check back after the next rotation." />
          )}
        </div>
      )}
    </div>
  )
}
