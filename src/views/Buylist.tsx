import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { BuylistOfferRow, BuylistOffers, BuylistSection, BuylistShelf, BuylistShopOut } from '../api'
import { useStore } from '../store'
import { EmptyState, FirstUseTip, fmtUsd, LoadFailure, TipList } from '../components'

// ---------------------------------------------------------------------------
// 🧾 The Buylist — the counter (roadmap: one verb per venue).
//
// The verb is DUMP: you walk in with a stack, a buyer flips through it, and you
// leave with money. The old screen was a checkbox list with the total hidden
// under it — a spreadsheet, not a counter. So the screen is a transaction:
//
//   • the shop rail ranks every buyer by what they'd pay for the stack you are
//     actually holding, so "who pays most" is a glance, not six tabs;
//   • the sheet is built with buckets (everything, wants, under $2, worn) —
//     dumping is bulk work, so selecting 40 cards takes one click;
//   • the receipt sits beside it the whole time: market value, what the shop
//     keeps, the cash/credit split, and the number you walk out with.
//
// No mechanic changed: 55–75% base rates, want-list premiums, credit bonus
// rates, the stale-quote guard and the shop-siloed credit are the same calls.
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100

type Bucket = 'all' | 'wants' | 'cheap' | 'big' | 'worn'
const BUCKETS: { id: Bucket; label: string; hint: string }[] = [
  { id: 'all', label: 'Everything', hint: 'Every card on this shop’s sheet' },
  { id: 'wants', label: '🔥 Wants', hint: 'Only the cards this shop is hunting — they pay a premium' },
  { id: 'cheap', label: 'Under $2', hint: 'Bulk under $2 of market — the usual dump' },
  { id: 'big', label: '$25+', hint: 'The big cards, where the haircut costs the most' },
  { id: 'worn', label: 'LP or worse', hint: 'Played copies — the shop discounts these hardest' },
]

const inBucket = (o: BuylistOfferRow, b: Bucket) =>
  b === 'all' ? true
    : b === 'wants' ? o.want
      : b === 'cheap' ? o.market < 2
        : b === 'big' ? o.market >= 25
          : o.condition !== 'NM'

const SPLITS: { label: string; value: number }[] = [
  { label: 'All cash', value: 0 },
  { label: '25% credit', value: 0.25 },
  { label: '50% credit', value: 0.5 },
  { label: 'All credit', value: 1 },
]

export function BuylistView() {
  const { toast, refreshState, openCard } = useStore()
  const [data, setData] = useState<BuylistSection | null>(null)
  // Every shop's sheet is fetched, not just the active one: a counter can tell
  // you who pays most for the stack in your hands, and that comparison is the
  // whole reason to walk to a different buyer.
  const [sheets, setSheets] = useState<Record<number, BuylistOffers>>({})
  const [shelf, setShelf] = useState<BuylistShelf | null>(null)
  const [shopId, setShopId] = useState<number | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [split, setSplit] = useState(0)
  const [sort, setSort] = useState<'spread' | 'payout' | 'name'>('spread')
  const [tab, setTab] = useState<'sell' | 'spend'>('sell')
  const [busy, setBusy] = useState(false)
  const [loadingSheets, setLoadingSheets] = useState(true)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const loadSheets = async (initial = false) => {
    if (initial) { setStatus('loading'); setLoadingSheets(true) }
    try {
      const section = await api.buylist()
      setData(section)
      const pairs = await Promise.all(
        section.shops.map((s) => api.buylistOffers(s.id).then((o) => [s.id, o] as const).catch(() => null)),
      )
      const next: Record<number, BuylistOffers> = {}
      for (const p of pairs) if (p) next[p[0]] = p[1]
      setSheets(next)
      setShopId((cur) => cur ?? section.shops[0]?.id ?? null)
      setStatus('ready')
    } catch {
      /* keep the last sheet on screen rather than blanking the counter */
      if (initial) setStatus('error')
    } finally { setLoadingSheets(false) }
  }

  useEffect(() => { loadSheets(true) }, [])

  useEffect(() => {
    if (shopId == null) return
    api.buylistShelf(shopId).then(setShelf).catch(() => setShelf(null))
  }, [shopId])

  // Voicing a new shop re-quotes the sheet, so a stale split/pick set can't
  // ride along from the previous counter.
  useEffect(() => { setPicked(new Set()) }, [shopId])

  const shop: BuylistShopOut | undefined = data?.shops.find((s) => s.id === shopId)
  const offers: BuylistOfferRow[] = useMemo(
    () => (shopId != null ? sheets[shopId]?.offers ?? [] : []),
    [sheets, shopId],
  )

  const rows = useMemo(() => {
    const arr = [...offers]
    if (sort === 'payout') arr.sort((a, b) => b.payoutCash - a.payoutCash)
    else if (sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name))
    return arr
  }, [offers, sort])

  const pickedRows = useMemo(() => offers.filter((o) => picked.has(o.inventoryId)), [offers, picked])
  const grossCash = round2(pickedRows.reduce((a, o) => a + o.payoutCash, 0))
  const grossCredit = round2(pickedRows.reduce((a, o) => a + o.payoutCredit, 0))
  const marketTotal = round2(pickedRows.reduce((a, o) => a + o.market, 0))
  const cashOut = round2(grossCash * (1 - split))
  const creditOut = round2(grossCredit * split)
  const kept = round2(Math.max(0, marketTotal - cashOut - creditOut))

  // Who pays most for what you're holding. With an empty stack the rail still
  // answers the useful question — what each shop would pay for everything.
  const stackTotals = useMemo(() => {
    const shops = data?.shops ?? []
    return shops.map((s) => {
      const list = sheets[s.id]?.offers ?? []
      const ids = picked.size > 0 ? picked : new Set(list.map((o) => o.inventoryId))
      const cash = round2(list.filter((o) => ids.has(o.inventoryId)).reduce((a, o) => a + o.payoutCash, 0))
      return { shop: s, cash }
    }).sort((a, b) => b.cash - a.cash)
  }, [data, sheets, picked])
  const best = stackTotals[0]
  const activeTotal = stackTotals.find((t) => t.shop.id === shopId)?.cash ?? 0
  const beatBy = best && shopId !== best.shop.id ? round2(best.cash - activeTotal) : 0

  const toggle = (id: number) =>
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const doSell = async () => {
    if (shopId == null || picked.size === 0) return
    setBusy(true)
    try {
      const r = await api.buylistSell(shopId, [...picked], split, grossCash)
      if (r.ok) {
        const cash = r.cash ?? 0
        const credit = r.credit ?? 0
        toast(`Sold ${picked.size} card${picked.size === 1 ? '' : 's'} — ${fmtUsd(cash)} cash${credit > 0 ? ` + ${fmtUsd(credit)} store credit` : ''}.`, 'good')
        setPicked(new Set())
        refreshState()
        loadSheets()
        if (shopId != null) api.buylistShelf(shopId).then(setShelf).catch(() => {})
      } else {
        // A refused stale quote isn't a failure — the shop re-checked its
        // sheet, so show the fresh numbers and keep the player's picks.
        const moved = !!r.error && r.error.includes('now offers')
        if (moved) loadSheets()
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
        loadSheets()
        api.buylistShelf(shopId).then(setShelf).catch(() => {})
      } else toast(r.error ?? 'Purchase failed', 'bad')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Purchase failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🧾 The Buylist</h1>
          <div className="sub">
            Six shops buy outright — instant cash, no listing wait, no sell fee, and they keep a cut. Build a stack,
            watch the receipt, take part of it in store credit if the bonus is worth it.
          </div>
        </div>
        <div className="chip-row">
          <button className={tab === 'sell' ? 'primary small' : 'small'} onClick={() => setTab('sell')}>Dump cards</button>
          <button className={tab === 'spend' ? 'primary small' : 'small'} onClick={() => setTab('spend')}>
            Spend credit{shop?.credit ? ` · ${fmtUsd(shop.credit)}` : ''}
          </button>
        </div>
      </div>

      <FirstUseTip surface="buylist">
        <TipList
          title="The counter rules"
          items={[
            { icon: '💵', label: 'Flat rate', text: 'every buyer pays 55–75% of market — their cut is what instant money costs.' },
            { icon: '🔥', label: 'Want lists', text: 'four cards each, paying a premium over their usual rate — sell into demand.' },
            { icon: '🏪', label: 'Store credit', text: 'the credit leg pays a bonus rate at that shop, but only spends on that shop’s shelf.' },
            { icon: '🀄', label: 'Bare cards', text: 'a raw card with no sleeve is quoted under a protected copy — the counter pays for how it is stored, not just what it is.' },
            { icon: '🧾', label: 'The receipt', text: 'the sheet is an offer; the register is the truth, so the quote is re-checked when you sell.' },
          ]}
        />
      </FirstUseTip>

      {status === 'error' ? (
        <LoadFailure what="the buylist" onRetry={() => loadSheets(true)} />
      ) : !data || loadingSheets ? (
        <EmptyState icon="🧾" text="Counting the tills…" sub="Every shop is quoting your collection." />
      ) : data.shops.length === 0 ? (
        <EmptyState
          icon="🧾"
          text="No shop is buying today"
          sub="The counters rotate their sheets — try again in a moment."
          action={{ label: 'Try again', onClick: () => loadSheets(true) }}
        />
      ) : tab === 'sell' ? (
        <div className="counter">
          {/* BUYER RAIL — ranked by what they'd pay for the stack in hand. */}
          <div className="counter-rail">
            <div className="counter-rail-head">
              <span>{picked.size > 0 ? 'Who pays most for this stack' : 'Who pays most for everything'}</span>
            </div>
            {stackTotals.map(({ shop: s, cash }) => {
              const active = s.id === shopId
              return (
                <button
                  key={s.id}
                  className={`counter-shop ${active ? 'on' : ''}`}
                  onClick={() => setShopId(s.id)}
                  title={s.blurb}
                >
                  <span className="counter-shop-name">
                    {s.name}
                    {best && s.id === best.shop.id && <span className="counter-best">BEST</span>}
                  </span>
                  <span className="counter-shop-rate">
                    {Math.round(s.basePct)}% cash{s.bonusRate > 0 ? ` · credit +${Math.round(s.bonusRate)}%` : ''}
                  </span>
                  <span className="counter-shop-quote">{fmtUsd(cash)}</span>
                  {s.credit > 0 && <span className="counter-shop-credit">{fmtUsd(s.credit)} credit</span>}
                </button>
              )
            })}
          </div>

          {/* THE SHEET — buckets first, because dumping is bulk work. */}
          <div className="counter-main">
            <div className="counter-wants">
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <b>🔥 {shop?.name} is hunting</b>
                <span className="faint small">rotates weekly · pays over their usual rate</span>
              </div>
              <div className="counter-wants-row">
                {(shop?.wants ?? []).map((w) => {
                  const est = w.market * Math.min(1.15, ((shop?.basePct ?? 0) / 100) * (1 + w.premium / 100))
                  return (
                    <button key={w.cardId} className="want-chip" onClick={() => openCard(w.cardId)} title={`Market ${fmtUsd(w.market)} · they pay ≈${fmtUsd(est)}`}>
                      <b>{w.name}</b>
                      <span>≈{fmtUsd(est)} <span className="faint">+{Math.round(w.premium)}%</span></span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="counter-sheet">
              <div className="counter-sheet-head">
                <div className="buckets">
                  {BUCKETS.map((b) => {
                    const ids = offers.filter((o) => inBucket(o, b.id)).map((o) => o.inventoryId)
                    const on = ids.length > 0 && ids.every((id) => picked.has(id))
                    return (
                      <button
                        key={b.id}
                        className={`bucket ${on ? 'on' : ''}`}
                        title={`${b.hint} — ${ids.length} card${ids.length === 1 ? '' : 's'}`}
                        onClick={() => setPicked(new Set(ids))}
                      >
                        {b.label} <span className="faint">{ids.length}</span>
                      </button>
                    )
                  })}
                  <button className="bucket ghost" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>Clear</button>
                </div>
                <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort the sheet" className="list-sort">
                  <option value="spread">Sort: Best relative deal</option>
                  <option value="payout">Sort: Biggest payout</option>
                  <option value="name">Sort: Name A→Z</option>
                </select>
              </div>

              {offers.length === 0 ? (
                <EmptyState icon="🧾" text="Nothing on your sheet they'd buy" sub="Pull cards, grade them, or wait — offers refresh with your collection." />
              ) : (
                <div className="sheet">
                  <div className="sheet-head">
                    <span />
                    <span>Card</span>
                    <span className="right">Market</span>
                    <span className="right">They pay</span>
                    <span className="right">Rate</span>
                  </div>
                  {rows.map((o) => {
                    const on = picked.has(o.inventoryId)
                    const rate = o.market > 0 ? Math.round((o.payoutCash / o.market) * 100) : 0
                    return (
                      <label key={o.inventoryId} className={`sheet-row ${on ? 'on' : ''}`}>
                        <input type="checkbox" checked={on} onChange={() => toggle(o.inventoryId)} />
                        <span className="sheet-name">
                          <b onClick={(e) => { e.preventDefault(); openCard(o.cardId) }}>{o.name}</b>
                          <span className="faint">
                            {o.condition}
                            {o.want && <span className="sheet-want">🔥 want</span>}
                          </span>
                        </span>
                        <span className="right faint">{fmtUsd(o.market)}</span>
                        <span className="right sheet-pay">{fmtUsd(o.payoutCash)}</span>
                        <span className={`right sheet-rate ${rate < 55 ? 'low' : rate > 75 ? 'high' : ''}`} title={`${rate}% of market in cash`}>{rate}%</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* THE RECEIPT — the number you walk out with, always visible. */}
          <aside className="receipt">
            <div className="receipt-head">Receipt</div>
            <div className="receipt-line"><span>Picked</span><b>{picked.size} card{picked.size === 1 ? '' : 's'}</b></div>
            <div className="receipt-line"><span>Market value</span><b>{fmtUsd(marketTotal)}</b></div>
            <div className="receipt-line"><span>{shop?.name ?? 'Shop'} pays</span><b>{fmtUsd(grossCash)}</b></div>

            <div className="receipt-splits">
              <div className="faint small" style={{ marginBottom: 4 }}>PAYOUT SPLIT</div>
              {SPLITS.map((s) => (
                <button key={s.label} className={`split ${split === s.value ? 'on' : ''}`} onClick={() => setSplit(s.value)}>{s.label}</button>
              ))}
              <div className="faint small" style={{ marginTop: 4 }}>
                Credit leg pays {shop ? `+${Math.round(shop.bonusRate)}%` : 'a bonus'} at this shop, and spends only here.
              </div>
            </div>

            <div className="receipt-total">
              <div className="faint small">YOU WALK OUT WITH</div>
              <div className="receipt-cash">{fmtUsd(cashOut)}</div>
              {creditOut > 0 && <div className="receipt-credit">+ {fmtUsd(creditOut)} store credit</div>}
            </div>
            <div className="receipt-line"><span>The shop keeps</span><b className="faint">{fmtUsd(kept)}</b></div>

            {beatBy > 0 && (
              <div className="receipt-tip" onClick={() => best && setShopId(best.shop.id)} role="button" title={`${best?.shop.name} pays ${fmtUsd(best?.cash ?? 0)} for this stack`}>
                💡 {best?.shop.name} pays <b>{fmtUsd(beatBy)} more</b> for this stack — switch counter.
              </div>
            )}

            <button className="primary receipt-go" disabled={picked.size === 0 || busy} onClick={doSell}>
              {picked.size === 0 ? 'Pick a stack' : busy ? '…' : `CASH OUT ${fmtUsd(cashOut + creditOut)}`}
            </button>
            <div className="faint small" style={{ marginTop: 6, lineHeight: 1.4 }}>
              Instant — no fee, no wait. The quote is re-checked at the register in case a want rotated.
            </div>
          </aside>
        </div>
      ) : (
        <div className="counter counter-spend">
          <div className="counter-rail">
            <div className="counter-rail-head"><span>Spend at</span></div>
            {(data?.shops ?? []).map((s) => (
              <button key={s.id} className={`counter-shop ${s.id === shopId ? 'on' : ''}`} onClick={() => setShopId(s.id)} title={s.blurb}>
                <span className="counter-shop-name">{s.name}</span>
                <span className="counter-shop-rate">{Math.round(s.basePct)}% buylist rate</span>
                <span className="counter-shop-quote">{fmtUsd(s.credit)}</span>
                <span className="counter-shop-credit">store credit</span>
              </button>
            ))}
          </div>

          <div className="counter-main">
            <div className="counter-sheet">
              <div className="counter-sheet-head">
                <b>{shelf?.shop.name ?? shop?.name}’s shelf</b>
                <span className="small muted">Credit here: <b>{fmtUsd(shelf?.credit ?? shop?.credit ?? 0)}</b> · cash works too</span>
              </div>
              {!shelf || shelf.rows.length === 0 ? (
                <EmptyState icon="🏪" text="The shelf is empty right now" sub="Shops restock weekly — check back after the next rotation." />
              ) : (
                <div className="sheet">
                  <div className="sheet-head">
                    <span />
                    <span>Card</span>
                    <span className="right">Market</span>
                    <span className="right">Price</span>
                    <span className="right">Buy</span>
                  </div>
                  {shelf.rows.map((r) => (
                    <div key={r.id} className="sheet-row">
                      <span />
                      <span className="sheet-name">
                        <b onClick={() => openCard(r.cardId)}>{r.name}</b>
                        <span className="faint">
                          {r.condition}
                          {r.wantStock && <span className="sheet-want">🔥 stocked for their wants</span>}
                        </span>
                      </span>
                      <span className="right faint">{fmtUsd(r.market)}</span>
                      <span className={`right sheet-pay ${r.price < r.market * 0.95 ? 'deal' : ''}`}>{fmtUsd(r.price)}</span>
                      <span className="right" style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="small primary" disabled={busy || (shelf.credit < r.price)} onClick={() => doBuy(r.id, true)} title="Pay with store credit">Credit</button>
                        <button className="small" disabled={busy} onClick={() => doBuy(r.id, false)} title="Pay cash">Cash</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {(shelf?.history.length ?? 0) > 0 && (
                <div className="small faint" style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border-soft)' }}>
                  {shelf!.history.slice(0, 5).map((h, i) => (
                    <div key={i}>{h.delta >= 0 ? '+' : ''}{fmtUsd(h.delta)} — {h.note}</div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="receipt">
            <div className="receipt-head">Credit</div>
            <div className="receipt-line"><span>At {shop?.name ?? 'this shop'}</span><b>{fmtUsd(shop?.credit ?? 0)}</b></div>
            <div className="receipt-total">
              <div className="faint small">SPENDABLE HERE</div>
              <div className="receipt-cash">{fmtUsd(shelf?.credit ?? shop?.credit ?? 0)}</div>
            </div>
            <div className="faint small" style={{ lineHeight: 1.45 }}>
              Credit is siloed to the shop that paid it. Dump a stack with part of the payout as credit and this
              balance grows — the credit leg pays a bonus rate, which is the whole point.
            </div>
            <button className="primary receipt-go" onClick={() => setTab('sell')}>Build a stack to earn credit</button>
          </aside>
        </div>
      )}
    </div>
  )
}
