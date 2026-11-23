import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { gameDayEtaFor } from '../lib/gameday'
import type { GradingReveal, GradingService, GradingPendingRow, MarketIncomingRow, SealedStockRow, SuppliesStatus, InsuranceStatus, AuthSection, AuthReveal, SealedFuturesSection } from '../api'
import { useStore , setOpeningHandoff } from '../store'
import { byNum, byStr, CardImg, ConditionBadge, BrowseToggle, CapacityStrip, DensityToggle, EmptyState, FirstUseTip, fmtUsd, GRADE_BADGE, GradeRevealModal, LoadFailure, matchesQuery, OverflowMenu, PriceTag, SearchInput, SetSection, SlabCard, SortSelect, SourceBadge, TipList, VirtualGrid } from '../components'
import type { MenuItem } from '../components'
import type { InventoryRow } from '../types'
import type { SaleRow } from '../api'
import { variantTag } from '../variant-label'

/** Wrapper art for a sealed holding: the product photo, then the set logo,
 *  then the set symbol, then a box. The same ladder the Pack Shop shelf uses,
 *  so the box you bought looks the same in your binder — and the loan desk can
 *  use it too, because it only asks for the three art fields. */
type ThumbArt = { image_url?: string | null; set_logo?: string | null; set_symbol?: string | null }

function SealedThumb({ row, small }: { row?: ThumbArt; small?: boolean }) {
  const sources = [row?.image_url, row?.set_logo, row?.set_symbol].filter((x): x is string => Boolean(x))
  const [i, setI] = useState(0)
  const cls = `inv-seal-thumb${small ? ' sm' : ''}`
  if (i >= sources.length) return <span className={`${cls} ph`} aria-hidden>📦</span>
  return (
    <img
      className={cls}
      src={sources[i]}
      alt=""
      loading="lazy"
      onError={() => setI((n) => n + 1)}
    />
  )
}

export function InventoryView() {
  const { toast, refreshState, openCard, density, browse, state } = useStore()
  const [tab, setTab] = useState<'raw' | 'listed' | 'sealed' | 'grading' | 'incoming' | 'supplies' | 'auth'>('raw')
  const [authData, setAuthData] = useState<AuthSection | null>(null)
  const [authReveal, setAuthReveal] = useState<AuthReveal | null>(null)
  const [items, setItems] = useState<InventoryRow[]>([])
  const [sales, setSales] = useState<SaleRow[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [sealed, setSealed] = useState<SealedStockRow[]>([])
  const [futures, setFutures] = useState<SealedFuturesSection | null>(null)
  const [loanAmt, setLoanAmt] = useState<Record<string, string>>({})
  const [gradingSvc, setGradingSvc] = useState<GradingService[]>([])
  const [pendingGrading, setPendingGrading] = useState<GradingPendingRow[]>([])
  const [incoming, setIncoming] = useState<MarketIncomingRow[]>([])
  const [invQ, setInvQ] = useState('')
  const [invSort, setInvSort] = useState('value_desc')
  const [sealedQ, setSealedQ] = useState('')
  const [sealedSort, setSealedSort] = useState('value_desc')
  const [reveal, setReveal] = useState<GradingReveal | null>(null)
  const [gradePick, setGradePick] = useState<{ item: InventoryRow } | null>(null)
  const [authPick, setAuthPick] = useState<{ item: InventoryRow } | null>(null)
  const [supplies, setSupplies] = useState<SuppliesStatus | null>(null)
  const authCeremonyDone = useRef(false)
  const [protectPick, setProtectPick] = useState<{ item: InventoryRow } | null>(null)
  const [bulkPick, setBulkPick] = useState<{ items: InventoryRow[] } | null>(null)
  const [bulkGrade, setBulkGrade] = useState<{ items: InventoryRow[] } | null>(null)
  const [bulkReprice, setBulkReprice] = useState<{ items: InventoryRow[] } | null>(null)
  // Bulk-modal progress lives HERE, not inside the modal: the modals used to
  // be nested components whose identity changed every state poll, so React
  // remounted an open menu every 15s and reset busy/done/pct mid-action.
  const [bulkGradeBusy, setBulkGradeBusy] = useState(false)
  const [bulkGradeDone, setBulkGradeDone] = useState(0)
  const [repricePct, setRepricePct] = useState(0)
  const [repriceBusy, setRepriceBusy] = useState(false)
  // Every grading verdict pops its reveal ceremony exactly once, no matter
  // how many times load() runs (load fires after every action).
  const revealedIds = useRef(new Set<number>())
  // Backdrop-close grace window — see closeMenu().
  const menuOpenedAt = useRef(0)

  // The whole inventory load used to be one silent try/catch: a failed fetch
  // left the tabs showing an empty collection, as if every card were gone.
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async () => {
    try {
      // Ask the lab FIRST: /api/inventory resolves due grades server-side, so
      // the reveal must be captured before that call spends it. Each verdict
      // pops once (revealedIds) — a modal that re-opens after Close is exactly
      // the spam loop the auth ceremony got in trouble for.
      const g = await api.gradingPending()
      setPendingGrading(g.pending)
      const fresh = g.revealed.filter((r) => !revealedIds.current.has(r.inventoryId))
      for (const r of fresh) revealedIds.current.add(r.inventoryId)
      if (fresh.length > 0) {
        setReveal(fresh[0])
        toast(`${fresh[0].name} came back ${fresh[0].gradeLabel}!`, fresh[0].value >= fresh[0].costBasis ? 'good' : 'bad')
      }
      setItems(await api.inventory())
      setSales(await api.sales())
      api.supplies().then(setSupplies).catch(() => {})
      const sum = await api.pullsSummary()
      setSealed((sum.sealedInStock as SealedStockRow[]) ?? [])
      api.sealedFutures().then(setFutures).catch(() => {})
      api.gradingServices().then(setGradingSvc).catch(() => {})
      api.marketIncoming().then((r) => setIncoming(r.incoming)).catch(() => {})
      api.authSection().then(setAuthData).catch(() => {})
      setStatus('ready')
    } catch {
      // Keep the last good binder on screen; only a failure with nothing to
      // show is the error state.
      setStatus((s) => (s === 'ready' ? s : 'error'))
    }
  }, [])

  useEffect(() => { load() }, [load])

  // The verdict-landed-while-you-were-away ceremony: auto-pop an arrived lab
  // ticket ONCE, on view mount only. It must never live inside load() —
  // arrived tickets stay listed in /api/auth until a reveal spends them, so a
  // find() there re-opens the modal after every Close/action (the classic
  // "authentication panel keeps reopening" loop). Verdicts that arrive (or
  // remain) mid-session surface as manual reveals from the Auth tab's list.
  useEffect(() => {
    if (authCeremonyDone.current) return
    authCeremonyDone.current = true
    api.authSection().then((a) => {
      const arrived = a.tickets.find((t) => t.status === 'arrived')
      if (arrived) api.authReveal(arrived.inventoryId).then((r) => { if (r.ok) setAuthReveal(r) }).catch(() => {})
    }).catch(() => {})
  }, [])

  // Stamp every menu OPEN. A backdrop click inside the grace window is the
  // tail of the opening gesture — an impatient second click racing a slow
  // open-flush lands on the backdrop that just appeared and would bounce the
  // menu shut the instant it opened ("the grading menu keeps closing").
  useEffect(() => {
    if (gradePick || authPick || authReveal || protectPick || bulkPick || bulkGrade || bulkReprice || reveal) {
      menuOpenedAt.current = Date.now()
    }
  }, [gradePick, authPick, authReveal, protectPick, bulkPick, bulkGrade, bulkReprice, reveal])

  const closeMenu = (close: () => void) => {
    if (Date.now() - menuOpenedAt.current < 400) return
    close()
  }

  const raw = items.filter((i) => i.status === 'collection')
  const listed = items.filter((i) => i.status === 'listed')
  const shownRaw = useMemo(() => {
    const out = raw.filter((i) => matchesQuery(i, invQ, (x) => [x.name, x.set_name, x.rarity, x.variant, x.condition]))
    const sorters: Record<string, (a: InventoryRow, b: InventoryRow) => number> = {
      value_desc: byNum((i) => i.value, 'desc'),
      value_asc: byNum((i) => i.value, 'asc'),
      pl_desc: byNum((i) => i.value - i.cost_basis, 'desc'),
      pl_asc: byNum((i) => i.value - i.cost_basis, 'asc'),
      name_asc: byStr((i) => i.name, 'asc'),
      set_asc: byStr((i) => i.set_name, 'asc'),
      recent: byStr((i) => i.acquired_at, 'desc'),
    }
    return [...out].sort(sorters[invSort] ?? sorters.value_desc)
  }, [raw, invQ, invSort])
  // Loan-desk rows name their collateral by product id; the art comes from the
  // sealed holdings the same load already fetched, so there is one source of
  // truth for what a product looks like.
  const sealedById = useMemo(() => new Map(sealed.map((s) => [s.product_id, s])), [sealed])

  const shownSealed = useMemo(() => {
    const out = sealed.filter((s) => matchesQuery(s, sealedQ, (x) => [x.name]))
    const sorters: Record<string, (a: SealedStockRow, b: SealedStockRow) => number> = {
      value_desc: byNum((s) => s.market_value, 'desc'),
      value_asc: byNum((s) => s.market_value, 'asc'),
      pl_desc: byNum((s) => s.unrealized, 'desc'),
      pl_asc: byNum((s) => s.unrealized, 'asc'),
      name_asc: byStr((s) => s.name, 'asc'),
      qty_desc: byNum((s) => s.quantity, 'desc'),
    }
    return [...out].sort(sorters[sealedSort] ?? sorters.value_desc)
  }, [sealed, sealedQ, sealedSort])

  // Grouped browse: raw-collection cards bucketed by set, in the same order
  // the current sort produces — grouping re-organizes, it never rescrambles.
  const rawGroups = useMemo(() => {
    const m = new Map<string, InventoryRow[]>()
    for (const i of shownRaw) {
      const k = i.set_name || 'Unknown set'
      const arr = m.get(k)
      if (arr) arr.push(i)
      else m.set(k, [i])
    }
    return [...m.entries()]
  }, [shownRaw])

  const pickSet = (rows: InventoryRow[]) => {
    setSelected((s) => {
      const n = new Set(s)
      const all = rows.every((r) => n.has(r.id))
      for (const r of rows) {
        if (all) n.delete(r.id)
        else n.add(r.id)
      }
      return n
    })
  }

  // Select everything matching the current filter — one click picks a whole
  // set, rarity, or price band because shownRaw already applied it.
  const selectAllShown = () => {
    setSelected((s) => {
      const all = shownRaw.every((r) => s.has(r.id))
      return all ? new Set() : new Set(shownRaw.map((r) => r.id))
    })
  }

  const gradeSelected = () => {
    const eligible = pickedRows.filter((i) => !i.graded_grade && i.gradingHint)
    if (eligible.length === 0) {
      toast('None of the picked cards are worth grading — the ⚖ badge marks the ones with an edge', 'bad')
      return
    }
    setBulkGradeBusy(false)
    setBulkGradeDone(0)
    setBulkGrade({ items: eligible })
  }

  const toggle = (id: number) => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const pickedRows = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected])

  const listSelected = async () => {
    const targets = raw.filter((i) => selected.has(i.id))
    if (targets.length === 0) return
    let ok = 0
    for (const t of targets) {
      try {
        const price = t.source.usd ?? t.value
        if (!price) continue
        await api.listItem(t.id, Math.round(price * 100) / 100)
        ok++
      } catch { /* skip */ }
    }
    toast(`Listed ${ok} card${ok === 1 ? '' : 's'} at market — NPC buyers incoming`, 'good')
    setSelected(new Set())
    await load()
    refreshState()
  }

  const listOne = async (i: InventoryRow, price: number) => {
    try {
      await api.listItem(i.id, price)
      toast(`${i.name}${variantTag(i.variant) ? ` · ${variantTag(i.variant)}` : ''} listed for ${fmtUsd(price)}`, 'good')
      await load()
      refreshState()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Listing failed', 'bad')
    }
  }

  const cancelOne = async (i: InventoryRow) => {
    await api.cancelListing(i.id)
    await load()
    refreshState()
  }

  // One “⋯” menu per row — these four actions used to stack as four buttons
  // on every line of the table. The menu is built here so the grid, list and
  // set-browse densities all offer the same set.
  const rowActions = (i: InventoryRow): MenuItem[] => {
    const listPrice = i.graded_grade ? Math.round(i.value * 100) / 100 : Math.round((i.source.usd ?? i.value) * 100) / 100
    const out: MenuItem[] = [{
      label: `${i.graded_grade ? 'List graded' : 'List at market'} · ${fmtUsd(listPrice)}`,
      hint: i.graded_grade ? 'Slab goes up at its graded price' : 'NPC buyers sweep the feed',
      primary: true,
      disabled: !listPrice,
      onClick: () => listOne(i, listPrice),
    }]
    if (!i.graded_grade) {
      out.push({
        label: '⚖ Grade',
        hint: gradingSvc.length ? 'Send it to a grading company' : 'No grading service available yet',
        disabled: !gradingSvc.length,
        onClick: () => setGradePick({ item: i }),
      })
      if (i.status === 'collection') {
        out.push({ label: '🛡 Authenticate', hint: 'USPA panel checks this copy', onClick: () => setAuthPick({ item: i }) })
        out.push({ label: '🛡 Sleeve / toploader', hint: 'Wear stops while it is stored', onClick: () => setProtectPick({ item: i }) })
      }
    }
    return out
  }

  const openSealed = async (productId: string) => {
    try {
      // Ripping a bundle/ETB/display is a run of packs, so it belongs in the
      // ceremony — the first pack comes out here, the rest follow on stage.
      const first = await api.openBox(productId)
      setOpeningHandoff({ session: first as unknown as import('../types').OpenSession, productId })
      await load()
      refreshState()
      window.location.hash = '#/opening'
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Open failed', 'bad')
    }
  }

  const sellSealed = async (productId: string, qty: number) => {
    try {
      const r = await api.sellSealed(productId, qty)
      if (r.ok) {
        toast(`Sold ${r.units}× sealed for ${fmtUsd(r.proceeds)} (${r.profit >= 0 ? '+' : ''}${fmtUsd(r.profit)} vs cost)`, r.profit >= 0 ? 'good' : 'bad')
        await load()
        refreshState()
      } else {
        toast(r.error, 'bad')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sale failed', 'bad')
    }
  }

  const sellSealedCond = async (productId: string, qty: number, cond: 'fresh' | 'worn') => {
    try {
      const r = await api.sealedSellCond(productId, qty, cond)
      if (r.ok) {
        toast(`Sold ${r.units}× ${cond} sealed for ${fmtUsd(r.proceeds)} (${r.profit >= 0 ? '+' : ''}${fmtUsd(r.profit)} vs cost)`, r.profit >= 0 ? 'good' : 'bad')
        await load()
        refreshState()
      } else toast(r.error, 'bad')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sale failed', 'bad')
    }
  }

  const rewrap = async (productId: string, qty: number) => {
    try {
      const r = await api.sealedRewrap(productId, qty)
      if (r.ok) {
        toast(`Damage dock re-wrapped ${r.units}× for ${fmtUsd(r.fee)} — fresh shrink, same basis`, 'good')
        await load()
        refreshState()
      } else toast(r.error, 'bad')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Re-wrap failed', 'bad')
    }
  }

  const dumpWorn = async (productId: string, qty: number) => {
    try {
      const r = await api.sealedDump(productId, qty)
      if (r.ok) {
        toast(`Dumped ${r.units}× worn at ${fmtUsd(r.unitPrice)}/unit — ${fmtUsd(r.proceeds)} cash, no fee`, 'good')
        await load()
        refreshState()
      } else toast(r.error, 'bad')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Dump failed', 'bad')
    }
  }

  const borrow = async (productId: string, qty: number, amount?: number) => {
    try {
      const r = await api.sealedBorrow(productId, qty, amount)
      if (r.ok) {
        toast(`Loan desk advanced ${fmtUsd(r.principal)} against ${r.units}× — 0.6%/game-day, redeem anytime`, 'good')
        await load()
        refreshState()
      } else toast(r.error, 'bad')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Loan failed', 'bad')
    }
  }

  const loanAction = async (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
    try {
      const r = await fn()
      if (r.ok) {
        toast(okMsg, 'good')
        await load()
        refreshState()
      } else toast(r.error ?? 'Desk refused', 'bad')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Desk error', 'bad')
    }
  }

  const submitGrading = async (item: InventoryRow, serviceId: string) => {
    try {
      const res = await api.gradingSubmit(item.id, serviceId)
      toast(`Submitted to grading ($${res.cost.toFixed(2)}) — check back in a few game-days`, 'good')
      setGradePick(null)
      setTab('grading')
      await load()
      refreshState()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Submit failed', 'bad')
    }
  }

  function GradePicker() {
    if (!gradePick) return null
    return (
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeMenu(() => setGradePick(null)) }}>
        <div className="modal" style={{ width: 'min(560px, 95vw)' }}>
          <div className="modal-head">
            <div>
              <h1>Grade {gradePick.item.name}</h1>
              <div className="sub muted">Raw value {fmtUsd(gradePick.item.value)} · {gradePick.item.condition}</div>
            </div>
            <button className="ghost" onClick={() => setGradePick(null)}>✕</button>
          </div>
          <div className="stack">
            {gradingSvc.map((s) => (
              <div key={s.id} className="panel" style={{ margin: 0 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <b>{s.name}</b> <span className="badge">${s.cost}</span>
                    {gradePick.item.value < s.minRawValue && <span className="badge est">below min raw value</span>}
                    <div className="small muted mt4">{s.desc}</div>
                    <div className="faint small">Turnaround {s.daysMin}–{s.daysMax} game-days</div>
                  </div>
                  <button className="primary" disabled={gradePick.item.value < s.minRawValue} onClick={() => submitGrading(gradePick.item, s.id)}>SUBMIT</button>
                </div>
              </div>
            ))}
            <p className="small muted">
              Grade odds depend on raw condition (NM grades best). PSA, Beckett BGS and CGC return their own slabs;
              a BGS 10 Black Label is the rarest Beckett result, and a CGC Pristine 10 is CGC's gold-label step above Gem Mint. Values come from real PriceCharting graded data when available.
            </p>
          </div>
        </div>
      </div>
    )
  }

  function AuthPicker() {
    if (!authPick) return null
    const item = authPick.item
    const svcs = authData?.services ?? []
    const deskSvc = svcs.find((s) => 'requiresVouched' in s && s.requiresVouched)
    const reading = item.deskReading ?? null
    return (
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeMenu(() => setAuthPick(null)) }}>
        <div className="modal" style={{ width: 'min(720px, 94vw)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h1 style={{ margin: 0 }}>Authenticate {item.name}</h1>
            <button className="ghost" onClick={() => setAuthPick(null)}>✕</button>
          </div>
          <div className="sub muted">
            Raw value {fmtUsd(item.value)} · {item.condition} · acquired via {item.acquired_via}
          </div>
          <FirstUseTip surface="auth">
            High-value cardboard attracts forgers. The <b>free eye-ball scan</b> gives hints, never verdicts — the
            <b> USPA desk</b> ($15–75) is the only paper the market trusts: authenticated cards sell at full price
            everywhere, unvetted ones take a haircut, and a confirmed fake is worth <b>$1</b> to the buylist wall.
            Getting burned once is how everyone learns why they pay it. The <b>🔦 blacklight</b> and <b>⚖️ precision
            scale</b> put real instrument readings under the free scan — instruments hint too, and their reading
            sticks to the card, so no amount of re-scanning replaces the lab. A <b>complete kit's</b> clean readings
            open the <b>$8 desk review</b>; flagged readings close it.
          </FirstUseTip>
          <div className="row" style={{ gap: 8, margin: '10px 0' }}>
            <button
              onClick={async () => {
                try {
                  const r = await api.authSurvey(item.id)
                  if (r.ok) {
                    const kit = (r.tools ?? []).map((t) => t.reading).join(' · ')
                    toast(r.found ? `👁 ${r.name}: ${r.band} risk band (~${r.chance}% of this channel's buys are fake) — ${r.note}${kit ? ` — ${kit}` : ''}` : (r.message ?? 'Nothing needs the eye.'), r.band === 'hot' ? 'bad' : 'info')
                    // The scan just filed (or spent) this card's instrument
                    // paperwork — refresh the desk row without a modal round-trip.
                    if (r.found) {
                      api.deskReviewEligibility(item.id).then((v) => {
                        const dr: 'vouched' | 'flagged' | 'partial' = v.eligible ? 'vouched' : /flagged/.test(v.reason ?? '') ? 'flagged' : 'partial'
                        setAuthPick((p) => (p && p.item.id === item.id ? { item: { ...p.item, deskReading: dr } } : p))
                      }).catch(() => {})
                    }
                  } else toast('The eye has nothing to say.', 'info')
                } catch { toast('The eye has nothing to say.', 'info') }
              }}
            >
              👁 Free eye-ball scan
            </button>
            <span className="faint small">targets this card — hints only, the lab decides</span>
          </div>
          {(authData?.tools?.length ?? 0) > 0 && (
            <div className="row" style={{ gap: 14, flexWrap: 'wrap', margin: '0 0 10px' }}>
              {authData!.tools.map((t) => (
                <span key={t.id} className="row small" style={{ gap: 6, alignItems: 'center' }} title={t.blurb}>
                  <b>{t.icon} {t.name}</b>
                  {t.owned ? (
                    <span className="badge live">in kit</span>
                  ) : (
                    <button
                      className="small"
                      onClick={() => buyTool(t.id)}
                      title={`${t.blurb} The $8 desk review only opens when the COMPLETE kit (${authData!.tools.map((x) => x.icon).join(' ')}) is on the bench${authData!.tools.every((x) => x.owned || x.id === t.id) ? ' — this is the last piece' : ''}.`}
                    >
                      Buy {fmtUsd(t.cost)} · unlocks the desk
                    </button>
                  )}
                </span>
              ))}
              {reading === 'vouched' && deskSvc && <span className="badge live">✅ the full kit vouches for this card — {deskSvc.name} ({fmtUsd(deskSvc.cost)}) is open</span>}
              {reading === 'flagged' && <span className="badge" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>🔦 an instrument flagged this card — the desk review is closed; take it to the advanced lab or forensic panel</span>}
              {reading === 'partial' && <span className="badge est">{(authData?.tools?.some((t) => !t.owned)) ? 'desk closed — it fast-tracks the complete kit (🔦 ⚖️) only' : 'incomplete paperwork — run the free scan so every instrument has read this card'}</span>}
            </div>
          )}
          <table className="table">
            <thead><tr><th>Service</th><th className="right">Fee</th><th className="right">Verdict in</th><th className="right">Miss rate</th><th></th></tr></thead>
            <tbody>
              {svcs.map((s) => (
                <tr key={s.id}>
                  <td><b className="small">{s.name}</b><div className="faint small">{s.blurb}</div></td>
                  <td className="num">{fmtUsd(s.cost)}</td>
                  <td className="num">{s.daysMin === s.daysMax ? `${s.daysMin}d` : `${s.daysMin}–${s.daysMax}d`}</td>
                  <td className={`num ${s.miss >= 0.25 ? 'delta-down' : ''}`}>{s.miss === 0 ? 'never' : `${Math.round(s.miss * 100)}%`}</td>
                  <td className="right">
                    {deskSvc && s.id === deskSvc.id && reading !== 'vouched' ? (
                      <span className="faint small" title="The desk fast-tracks the complete kit's paperwork: both instruments on the bench, each having read this card clean — and it still misses over half the fakes the kit missed">{reading === 'flagged' ? '🚫 disputed' : (authData?.tools?.some((t) => !t.owned) ? '🔒 full kit only' : '🔒 no paperwork')}</span>
                    ) : (
                      <button className="small primary" onClick={() => submitAuth(item, s.id)}>{fmtUsd(s.cost)} · submit</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  async function submitAuth(item: InventoryRow, serviceId: string) {
    try {
      const r = await api.authSubmit(item.id, serviceId)
      if (r.ok) {
        toast(`Submitted to ${r.serviceName} — verdict in ${r.dueDays} game-day${r.dueDays === 1 ? '' : 's'}.`, 'good')
        setAuthPick(null)
        refreshState()
        load()
      } else toast(r.error ?? 'The desk waved you off.', 'bad')
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'bad') }
  }

  async function buyTool(toolId: string) {
    try {
      const r = await api.authBuyTool(toolId)
      if (r.ok) {
        toast(`${r.name} joins the kit — the scan reads deeper now.`, 'good')
        api.authSection().then(setAuthData).catch(() => {})
        // The kit changed, so this open picker's desk state changed with it.
        if (authPick) {
          const item = authPick.item
          api.deskReviewEligibility(item.id).then((v) => {
            const dr: 'vouched' | 'flagged' | 'partial' = v.eligible ? 'vouched' : /flagged/.test(v.reason ?? '') ? 'flagged' : 'partial'
            setAuthPick((p) => (p && p.item.id === item.id ? { item: { ...p.item, deskReading: dr } } : p))
          }).catch(() => {})
        }
        refreshState()
      } else toast(r.error ?? 'The shop is out.', 'bad')
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'bad') }
  }

  async function revealAuth(t: { inventoryId: number }) {
    try {
      const r = await api.authReveal(t.inventoryId)
      if (r.ok) {
        setAuthReveal(r)
        refreshState()
        load()
      } else toast(r.error ?? 'No verdict waiting.', 'bad')
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'bad') }
  }

  function AuthRevealModal() {
    if (!authReveal || !authReveal.ok) return null
    const fake = authReveal.verdict === 'fake'
    return (
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeMenu(() => setAuthReveal(null)) }}>
        <div className="modal" style={{ width: 'min(560px, 94vw)', textAlign: 'center' }}>
          <h1 style={{ margin: '4px 0 2px', color: fake ? 'var(--red)' : 'var(--green)' }}>{fake ? '🃏 COUNTERFEIT' : '✅ GENUINE'}</h1>
          <div className="sub muted" style={{ marginBottom: 10 }}>{authReveal.name}</div>
          <div style={{ maxWidth: 220, margin: '0 auto 10px' }}><CardImg src={authReveal.image} alt={authReveal.name ?? ''} cardId={authReveal.cardId} /></div>
          <div className="panel" style={{ padding: '10px 12px', background: 'var(--panel2)', textAlign: 'left' }}>
            <b>{authReveal.message}</b>
            <div className="small muted" style={{ marginTop: 6 }}>
              Lab fee {fmtUsd(authReveal.fee ?? 0)} · {fake ? `raw basis gone — the buylist wall pays $1` : `now worth ${fmtUsd(authReveal.rawValue ?? 0)} without the uncertainty haircut`}
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 12 }}>
            {fake && authReveal.inventoryId != null && (
              <button className="primary" onClick={async () => {
                try { await api.authSellFake(authReveal.inventoryId!) ; toast('Sold to the training wall for $1.', 'good'); setAuthReveal(null); refreshState(); load() } catch { toast('Failed', 'bad') }
              }}>
                💵 Sell to buylist for $1
              </button>
            )}
            <button onClick={() => { setAuthReveal(null); load() }}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  function AuthTab() {
    const d = authData
    if (!d) return null
    return (
      <div>
        <FirstUseTip surface="auth">
          The <b>🛡 Auth</b> button on any raw card sends it to the USPA desk. Verdicts arrive on the game clock:
          authenticated cards sell at full price everywhere, unvetted high-value raws take a haircut, and a confirmed
          counterfeit is worth <b>$1</b> to the buylist wall — basis and all.
        </FirstUseTip>
        {d.stats.fakesCaught > 0 && (
          <div className="panel mb14" style={{ padding: '10px 14px', borderColor: d.stats.burned ? 'var(--red)' : undefined }}>
            <div className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="small"><b>{d.stats.authenticatedCards}</b> <span className="muted">jacketed</span></span>
              <span className="small"><span className="muted">spent on auth</span> <b>{fmtUsd(d.stats.spentOnAuth)}</b></span>
              <span className="small"><b>{d.stats.fakesCaught}</b> <span className="muted">fakes caught</span></span>
              <span className="small" style={{ color: 'var(--red)' }}><span className="muted">basis lost to fakes</span> <b>{fmtUsd(d.stats.fakeBasisLost)}</b></span>
            </div>
          </div>
        )}
        {d.stats.burned && (
          <>
            <h2 className="mt14">The street</h2>
            <div className="faint small" style={{ marginBottom: 6 }}>
              Once a fake has been through your hands, the trade groups vote on you. Your defense is the paper trail:
              the complete kit, USPA jackets on the binder, and documented fakes caught — <b>{d.accusation ? `${d.accusation.evidence}/${d.accusation.needs} on the current case` : 'keep building it'}</b>.
              {d.suspicion && <b style={{ color: 'var(--red)' }}> A conviction is live: raw sells take a 10% suspicion haircut for 3 game days.</b>}
            </div>
            {d.accusation ? (
              <div className="panel mb14" style={{ padding: '10px 14px', borderColor: 'var(--red)' }}>
                <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <b className="small">⚖️ {d.accusation.accuser}</b> <span className="faint small">({d.accusation.persona})</span>
                    <div className="small muted mt4">
                      {d.accusation.cardName ? `The ${d.accusation.cardName} you sold me came back counterfeit. I want my ${fmtUsd(d.accusation.basis)} back and everyone needs to know.` : `That card you sold me came back counterfeit. I want my ${fmtUsd(d.accusation.basis)} back and everyone needs to know.`}
                    </div>
                    <div className="small mt4">
                      Paper trail: <b>{d.accusation.evidence}/{d.accusation.needs}</b> — {d.accusation.evidence >= d.accusation.needs ? 'you have the receipts. The thread should clear.' : 'thin. More jackets, more kit, more documented fakes before the vote.'}
                    </div>
                  </div>
                  <span className="badge est">the groups vote by tomorrow</span>
                </div>
              </div>
            ) : (
              <div className="panel mb14" style={{ padding: '8px 14px' }}>
                <span className="small"><span className="muted">fake-trade notoriety</span> <b>{d.notoriety}/3</b>
                  {d.history.length > 0 && <span className="faint small"> · last: {d.history[0].status} ({d.history[0].accuser})</span>}
                  {d.notoriety > 0 && <span className="faint small"> · accusations can land any day</span>}
                </span>
              </div>
            )}
            {d.history.length > 0 && d.accusation == null && (
              <table className="table" style={{ marginBottom: 14 }}>
                <thead><tr><th>Past cases</th><th className="right">Outcome</th></tr></thead>
                <tbody>
                  {d.history.map((h) => (
                    <tr key={h.id}>
                      <td className="small"><b>{h.accuser}</b> <span className="faint small">over the {h.cardName}</span></td>
                      <td className="right small">{h.status === 'cleared' ? '✅ cleared' : h.status === 'mistrial' ? '🌫 mistrial' : '🚫 convicted'}{h.verdict ? <div className="faint small" style={{ maxWidth: 420 }}>{h.verdict}</div> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
        {(d.tools?.length ?? 0) > 0 && (
          <>
            <h2 className="mt14">The toolkit</h2>
            <div className="faint small" style={{ marginBottom: 6 }}>One-time gear for the bench. Each owned tool adds an instrument reading to the free eye-ball scan — readings stick to the card, instruments hint, and the lab still decides. The <b>complete kit</b> is also what opens the <b>$8 desk review</b>: half a kit is half a vetting.</div>
            <div className="panel mb14" style={{ padding: '10px 14px' }}>
              <div className="stack" style={{ gap: 8 }}>
                {d.tools.map((t) => (
                  <div key={t.id} className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <b className="small">{t.icon} {t.name}</b>{' '}
                      {t.owned && <span className="badge live">in kit</span>}
                      <div className="faint small">{t.blurb}</div>
                    </div>
                    {!t.owned && (
                      <button
                        className="small"
                        onClick={() => buyTool(t.id)}
                        title={`${t.blurb} The $8 desk review only opens when the COMPLETE kit (${d.tools.map((x) => x.icon).join(' ')}) is on the bench${d.tools.every((x) => x.owned || x.id === t.id) ? ' — this is the last piece' : ''}.`}
                      >
                        Buy {fmtUsd(t.cost)}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        <h2 className="mt14">In the lab</h2>
        {d.tickets.length === 0 ? (
          <EmptyState icon="🔬" text="Nothing at the lab" sub="Use the 🛡 Auth button on a raw card to submit one ($15–75)." />
        ) : (
          <table className="table">
            <thead><tr><th>Card</th><th>Service</th><th className="right">Fee</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {d.tickets.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="row" style={{ cursor: 'pointer' }} onClick={() => openCard(t.cardId)}>
                      <div style={{ width: 32 }}><CardImg src={t.image} alt={t.name} cardId={t.cardId} /></div>
                      <b className="small">{t.name}</b>
                    </div>
                  </td>
                  <td className="small">{t.serviceName}</td>
                  <td className="num">{fmtUsd(t.fee)}</td>
                  <td className="small">{t.status === 'arrived' ? '🟢 verdict waiting' : `⏳ ${gameDayEtaFor(state?.day?.lengthHours ?? 2, t.hoursLeft * 3600000)}`}</td>
                  <td className="right">{t.status === 'arrived' && <button className="primary small" onClick={() => revealAuth(t)}>Open the envelope</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {d.fakes.length > 0 && (
          <>
            <h2 className="mt14">The wall of fakes</h2>
            <div className="faint small" style={{ marginBottom: 6 }}>Confirmed counterfeits. Nothing trades these except the buylist shops' training wall — $1 flat, basis gone.</div>
            <table className="table">
              <thead><tr><th>Card</th><th className="right">Cost you</th><th className="right">They pay</th><th></th></tr></thead>
              <tbody>
                {d.fakes.map((f) => (
                  <tr key={f.inventoryId}>
                    <td><b className="small">{f.name}</b> <span className="faint small">{f.setName}</span></td>
                    <td className="num faint">{fmtUsd(f.costBasis)}</td>
                    <td className="num">{fmtUsd(f.sellValue)}</td>
                    <td className="right"><button className="small" onClick={async () => { try { await api.authSellFake(f.inventoryId); toast('Sold to the training wall for $1.', 'good'); load(); refreshState() } catch { toast('Failed', 'bad') } }}>💵 Sell for $1</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    )
  }

  function ProtectPicker() {
    if (!protectPick) return null
    const item = protectPick.item
    const stock = supplies?.stock ?? []
    const options = [
      { kind: 'sleeve', label: 'Penny sleeve', icon: '🀄', note: 'stops wear · counters pay more' },
      { kind: 'toploader', label: 'Toploader', icon: '🛡️', note: 'stops wear · counters pay more' },
      { kind: 'one_touch', label: 'One-touch', icon: '💎', note: 'stops wear · counters pay more' },
    ] as const
    return (
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeMenu(() => setProtectPick(null)) }}>
        <div className="modal" style={{ width: 'min(520px, 95vw)' }}>
          <div className="modal-head">
            <div>
              <h1>Protect {item.name}</h1>
              <div className="sub muted">Currently: {item.protection ? PROT_LABEL[item.protection] : 'bare'} · {item.condition} · {fmtUsd(item.value)}</div>
            </div>
            <button className="ghost" onClick={() => setProtectPick(null)}>✕</button>
          </div>
          <div className="stack">
            {options.map((o) => {
              const s = stock.find((x) => x.kind === o.kind)
              const current = item.protection === o.kind
              const worse = item.protection && ['sleeve', 'toploader', 'one_touch'].indexOf(o.kind) < ['sleeve', 'toploader', 'one_touch'].indexOf(item.protection)
              return (
                <div key={o.kind} className="panel" style={{ margin: 0 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <b>{o.icon} {o.label}</b>{' '}
                      <span className="badge">{s?.quantity ?? 0} in stock</span>
                      {current && <span className="badge live">current</span>}
                      <div className="small muted mt4">{s?.blurb ?? o.note} · {fmtUsd((s?.unitCost ?? 0) * (s?.packSize ?? 1))} / {s?.packSize ?? '—'}</div>
                    </div>
                    <div className="right">
                      {current && <button className="small" onClick={async () => { const r = await api.unprotectCard(item.id); if (!r.ok) toast(r.error ?? 'Failed', 'bad'); setProtectPick(null); load() }}>Remove</button>}
                      {!current && <button className="primary" disabled={worse || (s?.quantity ?? 0) < 1} onClick={async () => { const r = await api.protectCard(item.id, o.kind); if (!r.ok) toast(r.error ?? 'Failed', 'bad'); else toast(`${item.name} ${PROT_LABEL[o.kind]} — wear stops.`, 'good'); setProtectPick(null); load() }}>
                        {worse ? 'Safer already' : (s?.quantity ?? 0) < 1 ? 'Out of stock' : item.protection ? 'Upgrade' : 'Protect'}
                      </button>}
                    </div>
                  </div>
                </div>
              )
            })}
            <p className="small muted">One unit covers the row (a stack shares its sleeve). Removing protection returns it to stock. A bare card sells for less at every counter that names its price — buylist, instant dealer, pawn, convention tables — and never changes your own asking price.</p>
          </div>
        </div>
      </div>
    )
  }

  function BulkGradeModal() {
    if (!bulkGrade) return null
    const items = bulkGrade.items
    const totalCost = items.reduce((a, i) => a + (i.gradingHint?.cost ?? 0), 0)
    const totalProfit = items.reduce((a, i) => a + (i.gradingHint?.expectedProfit ?? 0), 0)
    const submit = async () => {
      setBulkGradeBusy(true)
      let ok = 0
      let spent = 0
      for (const i of items) {
        try {
          const res = await api.gradingSubmit(i.id, i.gradingHint!.serviceId)
          ok++
          spent += res.cost
          setBulkGradeDone(ok)
        } catch (e) {
          toast(`${i.name}: ${e instanceof Error ? e.message : 'submit failed'}`, 'bad')
        }
      }
      toast(`Submitted ${ok} card${ok === 1 ? '' : 's'} to grading — $${spent.toFixed(2)} in fees, deductible at filing`, 'good')
      setBulkGradeBusy(false)
      setBulkGrade(null)
      setSelected(new Set())
      setTab('grading')
      await load()
      refreshState()
    }
    return (
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeMenu(() => setBulkGrade(null)) }}>
        <div className="modal" style={{ width: 'min(640px, 95vw)' }}>
          <div className="modal-head">
            <div>
              <h1>Grade {items.length} card{items.length === 1 ? '' : 's'}</h1>
              <div className="sub muted">Each goes to the best-value service the hint engine picked for it.</div>
            </div>
            <button className="ghost" onClick={() => setBulkGrade(null)}>✕</button>
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr><th style={{ textAlign: 'left' }}>Card</th><th>Service</th><th className="right">Raw</th><th className="right">Gem</th><th className="right">Exp. profit</th></tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td style={{ textAlign: 'left' }}>
                      <b className="small">{i.name}</b>
                      <span className="faint small"> · {i.set_name} · {i.condition}</span>
                    </td>
                    <td className="small">{i.gradingHint!.serviceName} <span className="faint small">(${i.gradingHint!.cost})</span></td>
                    <td className="num faint">{fmtUsd(i.value)}</td>
                    <td className="num">{i.gradingHint!.gemChance}%</td>
                    <td className="num delta-up">+{fmtUsd(i.gradingHint!.expectedProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row mt14" style={{ justifyContent: 'space-between' }}>
            <div className="small">
              {bulkGradeBusy ? <span className="faint">Submitting… {bulkGradeDone}/{items.length}</span> : <>
                Fees <b>{fmtUsd(totalCost)}</b> · expected profit <b style={{ color: 'var(--green)' }}>+{fmtUsd(totalProfit)}</b> if odds hold
              </>}
            </div>
            <button className="primary" disabled={bulkGradeBusy} onClick={submit}>
              {bulkGradeBusy ? `Submitting ${bulkGradeDone}/${items.length}…` : `Submit ${items.length} to grading`}
            </button>
          </div>
        </div>
      </div>
    )
  }

  function BulkRepriceModal() {
    if (!bulkReprice) return null
    const eligible = bulkReprice.items
    const pct = repricePct
    const busy = repriceBusy
    const tot = (f: (r: InventoryRow) => number) => eligible.reduce((a, r) => a + f(r) * (r.quantity || 1), 0)
    const before = tot((r) => r.listing_price ?? 0)
    const after = tot((r) => Math.max(0.01, (r.listing_price ?? 0) * (1 + pct / 100)))
    const belowBasis = eligible.filter((r) => (r.listing_price ?? 0) * (1 + pct / 100) < r.cost_basis).length
    const preview = (p: number) => {
      setRepricePct(Math.max(-50, Math.min(50, p)))
    }
    return (
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeMenu(() => setBulkReprice(null)) }}>
        <div className="modal" style={{ width: 'min(560px, 95vw)' }}>
          <div className="modal-head">
            <div>
              <h1>Reprice {eligible.length} listing{eligible.length === 1 ? '' : 's'}</h1>
              <div className="sub muted">Nudges the ask on every picked marketplace listing — local posts, shop cases, and auction lots reprice on their own surfaces.</div>
            </div>
            <button className="ghost" onClick={() => setBulkReprice(null)}>✕</button>
          </div>
          {eligible.length === 0 ? (
            <EmptyState icon="↻" text="Nothing to reprice" sub="Pick cards that are marketplace-listed (the 📃 Listed tab) — bare collection cards have no ask to nudge." />
          ) : (
            <>
              <div className="row" style={{ gap: 10, alignItems: 'center', margin: '10px 0' }}>
                <button className="small" onClick={() => preview(pct - 5)} title="Nudge 5% cheaper">−5</button>
                <input
                  type="range" min={-50} max={50} step={1} value={pct}
                  onChange={(e) => preview(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <button className="small" onClick={() => preview(pct + 5)} title="Nudge 5% pricier">+5</button>
                <b style={{ minWidth: 64, textAlign: 'right', color: pct > 0 ? 'var(--green)' : pct < 0 ? 'var(--red)' : undefined }}>{pct > 0 ? '+' : ''}{pct}%</b>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {[-25, -10, -5, 5, 10, 25].map((p) => (
                  <button key={p} className={`small ${pct === p ? 'primary' : ''}`} onClick={() => preview(p)}>{p > 0 ? `+${p}%` : `${p}%`}</button>
                ))}
              </div>
              <div className="panel" style={{ padding: '10px 14px', background: 'var(--panel2)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="small muted">Asking total</span>
                  <span className="small"><b>{fmtUsd(before)}</b> → <b style={{ color: pct > 0 ? 'var(--green)' : pct < 0 ? 'var(--red)' : undefined }}>{fmtUsd(after)}</b></span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                  <span className="small muted">Versus cost basis</span>
                  <span className="small">{after >= tot((r) => r.cost_basis) ? <b className="delta-up">still above basis overall</b> : <b style={{ color: 'var(--red)' }}>dips below basis overall</b>}</span>
                </div>
                {belowBasis > 0 && (
                  <div className="small mt4" style={{ color: 'var(--red)' }}>⚠ {belowBasis} card{belowBasis === 1 ? '' : 's'} would be priced under their own cost basis at this nudge.</div>
                )}
              </div>
              <div className="row mt14" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => setBulkReprice(null)}>Cancel</button>
                <button
                  className="primary"
                  disabled={busy || pct === 0}
                  onClick={async () => {
                    setRepriceBusy(true)
                    try {
                      const r = await api.repriceBulk(eligible.map((x) => x.id), pct)
                      if (r.ok) {
                        toast(`Repriced ${r.moved} listing${r.moved === 1 ? '' : 's'} ${pct > 0 ? '+' : ''}${pct}% — asking ${fmtUsd(r.after ?? 0)} total`, 'good')
                        setBulkReprice(null)
                        setSelected(new Set())
                        await load()
                        refreshState()
                      } else toast(r.error ?? 'Reprice failed', 'bad')
                    } catch (e) {
                      toast(e instanceof Error ? e.message : 'Reprice failed', 'bad')
                    } finally {
                      setRepriceBusy(false)
                    }
                  }}
                >
                  {busy ? 'Working…' : pct === 0 ? 'Pick a nudge' : `Reprice ${eligible.length} by ${pct > 0 ? '+' : ''}${pct}%`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  function BulkProtectPicker() {
    if (!bulkPick) return null
    const items = bulkPick.items
    const stock = supplies?.stock ?? []
    const options = [
      { kind: 'sleeve', label: 'Penny sleeves', icon: '🀄' },
      { kind: 'toploader', label: 'Toploaders', icon: '🛡️' },
      { kind: 'one_touch', label: 'One-touches', icon: '💎' },
    ] as const
    return (
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeMenu(() => setBulkPick(null)) }}>
        <div className="modal" style={{ width: 'min(560px, 95vw)' }}>
          <div className="modal-head">
            <div>
              <h1>Protect {items.length} card{items.length === 1 ? '' : 's'}</h1>
              <div className="sub muted">Best cardboard first — when stock runs short, the priciest picks get protected.</div>
            </div>
            <button className="ghost" onClick={() => setBulkPick(null)}>✕</button>
          </div>
          <div className="stack">
            {options.map((o) => {
              const s = stock.find((x) => x.kind === o.kind)
              const already = items.filter((x) => x.protection === o.kind).length
              const safer = items.filter((x) => x.protection && PROT_RANK[x.protection] > PROT_RANK[o.kind]).length
              const eligible = items.length - already - safer
              return (
                <div key={o.kind} className="panel" style={{ margin: 0 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <b>{o.icon} {o.label}</b>{' '}
                      <span className={`badge ${(s?.quantity ?? 0) > 0 ? '' : 'est'}`}>{s?.quantity ?? 0} in stock</span>
                      <div className="small muted mt4">
                        {eligible} of {items.length} eligible{already > 0 ? ` · ${already} already in one` : ''}{safer > 0 ? ` · ${safer} safer already` : ''}
                      </div>
                    </div>
                    <button
                      className="primary"
                      disabled={eligible < 1 || (s?.quantity ?? 0) < 1}
                      onClick={async () => {
                        const r = await api.protectBulk(items.map((x) => x.id), o.kind)
                        if (!r.ok) {
                          toast(r.error ?? 'Bulk protect failed', 'bad')
                        } else {
                          const parts = [`🛡 ${r.protected} card${r.protected === 1 ? '' : 's'} ${PROT_LABEL[o.kind]}`]
                          if (r.outOfStock) parts.push(`${r.outOfStock} left bare — out of stock`)
                          const sk = r.skipped?.length ?? 0
                          if (sk > 0) parts.push(`${sk} skipped (${[...new Set(r.skipped!.map((x) => x.reason))].join(', ')})`)
                          toast(parts.join(' · '), 'good')
                        }
                        setBulkPick(null)
                        load()
                      }}
                    >
                      {(s?.quantity ?? 0) < 1 ? 'Out of stock' : `Protect ${eligible}`}
                    </button>
                  </div>
                </div>
              )
            })}
            <p className="small muted">One unit covers the row. Upgrades reuse the old sleeve; removing protection returns it to stock.</p>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return <LoadFailure what="your inventory" sub="The local server did not answer. No card, listing or sealed box was touched." onRetry={() => { setStatus('loading'); load() }} />
  }
  if (status === 'loading') {
    return <EmptyState icon="🗃" text="Reading your inventory…" sub="Raw cards, active listings, sealed stock and their cost basis." />
  }

  return (
    <div>
      <div className="page-head desk">
        <div className="ph-id">
          <span className="ph-mark" aria-hidden>🗃</span>
          <div>
            <h1>Inventory</h1>
            <div className="sub">Raw cards, active listings, and sealed stock — with cost basis on everything.</div>
          </div>
        </div>
        {selected.size > 0 && (
          <div className="row">
            <span className="small muted">{selected.size} selected</span>
            <button className="primary" onClick={listSelected}>LIST ALL AT MARKET</button>
            <OverflowMenu
              title="More bulk actions"
              items={[
                {
                  label: '⚖ Grade them',
                  hint: 'Send every picked card with a grading edge to its best service',
                  onClick: gradeSelected,
                },
                {
                  label: '🛡 Protect them',
                  hint: 'Sleeve / toploader every picked card',
                  onClick: () => setBulkPick({ items: pickedRows }),
                },
                {
                  label: '↻ Reprice listings',
                  hint: "Nudge every picked marketplace listing's ask by a percentage",
                  onClick: () => {
                    setRepricePct(0)
                    setRepriceBusy(false)
                    setBulkReprice({ items: pickedRows.filter((r) => r.status === 'listed' && (r.listing_price ?? 0) > 0) })
                  },
                },
                { label: 'Clear selection', onClick: () => setSelected(new Set()) },
              ]}
            />
          </div>
        )}
      </div>

      <CapacityStrip />

      <div className="chip-row mb14">
        <span className={`chip ${tab === 'raw' ? 'on' : ''}`} onClick={() => setTab('raw')}>Raw cards ({raw.length})</span>
        <span className={`chip ${tab === 'listed' ? 'on' : ''}`} onClick={() => setTab('listed')}>Listed ({listed.length})</span>
        <span className={`chip ${tab === 'grading' ? 'on' : ''}`} onClick={() => setTab('grading')}>Grading ({pendingGrading.length}){(state?.counters?.gradingReady ?? 0) > 0 && <span className="chip-badge">{state!.counters!.gradingReady}</span>}</span>
        {incoming.length > 0 && <span className={`chip ${tab === 'incoming' ? 'on' : ''}`} onClick={() => setTab('incoming')}>📦 In transit ({incoming.length})</span>}
        <span className={`chip ${tab === 'supplies' ? 'on' : ''}`} onClick={() => setTab('supplies')}>🛡 Supplies</span>
        {authData && (authData.tickets.length > 0 || authData.fakes.length > 0 || authData.stats.burned) && (
          <span className={`chip ${tab === 'auth' ? 'on' : ''}`} onClick={() => setTab('auth')}>🛡 Authentication{authData.tickets.length > 0 ? ` (${authData.tickets.length})` : ''}{(state?.counters?.authVerdicts ?? 0) > 0 && <span className="chip-badge">{state!.counters!.authVerdicts}</span>}</span>
        )}
        <span className={`chip ${tab === 'sealed' ? 'on' : ''}`} onClick={() => setTab('sealed')}>Sealed ({sealed.reduce((a, s) => a + s.quantity, 0)})</span>
      </div>

      {tab === 'raw' && (
        raw.length === 0 ? (
          <EmptyState icon="🗃" text="No raw cards" sub="Pulls land here after pack openings." />
        ) : (
          <>
          <div className="filter-row" style={{ marginBottom: 10 }}>
            <SearchInput value={invQ} onChange={setInvQ} placeholder="Search inventory by card, set, variant…" />
            <SortSelect
              value={invSort}
              onChange={setInvSort}
              options={[
                { value: 'value_desc', label: 'Sort: Value high→low' },
                { value: 'value_asc', label: 'Sort: Value low→high' },
                { value: 'pl_desc', label: 'Sort: Biggest gainers' },
                { value: 'pl_asc', label: 'Sort: Biggest losers' },
                { value: 'name_asc', label: 'Sort: Name A→Z' },
                { value: 'set_asc', label: 'Sort: By set' },
                { value: 'recent', label: 'Sort: Recently acquired' },
              ]}
            />
            <span className="result-count faint small">{shownRaw.length} of {raw.length} cards</span>
            {shownRaw.length > 0 && (
              <button
                className="small"
                onClick={selectAllShown}
                title="Pick every card matching the current filter — the search box, set/rarity/type dropdowns, and sort all apply"
              >
                {shownRaw.length > 0 && shownRaw.every((r) => selected.has(r.id)) ? 'Unpick all shown' : `Pick all ${shownRaw.length} shown`}
              </button>
            )}
            <div style={{ marginLeft: 'auto' }} className="row">
              <BrowseToggle />
              <DensityToggle />
            </div>
          </div>
          {browse === 'byset' ? (
            <div className="set-sections">
              {rawGroups.map(([name, rows]) => {
                const value = rows.reduce((a, r) => a + r.value, 0)
                const pl = rows.reduce((a, r) => a + (r.value - r.cost_basis), 0)
                const picked = rows.filter((r) => selected.has(r.id)).length
                const allPicked = picked === rows.length
                return (
                  <SetSection
                    key={name}
                    setName={name}
                    stats={<>
                      {rows.length} card{rows.length === 1 ? '' : 's'} · {fmtUsd(value)} ·
                      <span style={{ color: pl >= 0 ? 'var(--green)' : 'var(--red)' }}> {pl >= 0 ? '+' : ''}{fmtUsd(pl)} P/L</span>
                      {picked > 0 && ` · ${picked} picked`}
                    </>}
                    actions={
                      <button className="small ghost" onClick={() => pickSet(rows)}>{allPicked ? 'unpick set' : 'pick set'}</button>
                    }
                  >
                    {rows.map((i) => {
                      const rpl = i.value - i.cost_basis
                      return (
                        <div key={i.id} className="inv-group-row">
                          <div style={{ width: 34, cursor: 'pointer', flex: '0 0 34px' }} onClick={() => openCard(i.card_id)}>
                            <SlabCard src={i.image_small} alt={i.name} grade={i.graded_grade} setName={i.set_name} cardNo={i.number} cardId={i.card_id} variant={i.variant} rarity={i.rarity} />
                          </div>
                          <div className="grow" style={{ minWidth: 0 }}>
                            <div className="small" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {i.name}
                              {i.graded_grade && <span className="badge hit" style={{ marginLeft: 6 }}>{GRADE_BADGE[i.graded_grade] ?? i.graded_grade}</span>}
                              {i.quantity > 1 && <span className="badge" style={{ marginLeft: 6 }}>×{i.quantity}</span>}
                            </div>
                            <div className="faint" style={{ fontSize: 11 }}>
                              {i.condition}
                              {variantTag(i.variant) ? ` · ${variantTag(i.variant)}` : ''}
                              {i.graded_grade ? '' : i.protection ? ` · 🛡 ${PROT_LABEL[i.protection]}` : ''}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div className="small price">{fmtUsd(i.value)}</div>
                            <span className={`small ${rpl >= 0 ? 'delta-up' : 'delta-down'}`}>{rpl >= 0 ? '+' : ''}{fmtUsd(rpl)}</span>
                          </div>
                          <div className="row" style={{ gap: 8 }}>
                            <input type="checkbox" checked={selected.has(i.id)} disabled={!i.value} onChange={() => toggle(i.id)} title="Select for bulk listing" style={{ width: 15, height: 15, margin: 0 }} />
                            <OverflowMenu title={`Actions for ${i.name}`} items={rowActions(i)} />
                          </div>
                        </div>
                      )
                    })}
                  </SetSection>
                )
              })}
            </div>
          ) : density !== 'comfortable' && (
            <div style={{ marginBottom: 14 }}>
              <VirtualGrid
                className={`card-grid ${density === 'list' ? 'density-list' : 'density-compact'}`}
                items={shownRaw}
                density={density}
                empty={null}
                render={(i) => (
                  <div className="card-cell">
                    <div onClick={() => openCard(i.card_id)} style={{ cursor: 'pointer' }}>
                      <SlabCard src={i.image_small} alt={i.name} grade={i.graded_grade} setName={i.set_name} cardNo={i.number} cardId={i.card_id} variant={i.variant} rarity={i.rarity} />
                    </div>
                    <div className="card-meta">
                      <div className="nm">{i.name}</div>
                      <div className="st">{i.set_name} · {i.condition}{variantTag(i.variant) ? ` · ${variantTag(i.variant)}` : ''}</div>
                      <div className="card-row-between">
                        <PriceTag price={i.source} />
                        {i.graded_grade && <span className="badge hit">{GRADE_BADGE[i.graded_grade] ?? i.graded_grade}</span>}
                      </div>
                    </div>
                    {density === 'list' ? (
                      <>
                        <input type="checkbox" checked={selected.has(i.id)} disabled={!i.value} onChange={() => toggle(i.id)} title="Select for bulk listing" />
                        <OverflowMenu title={`Actions for ${i.name}`} items={rowActions(i)} />
                      </>
                    ) : (
                      <div className="card-row-between">
                        <label className="pick-box" title="Select for bulk listing">
                          <input type="checkbox" checked={selected.has(i.id)} disabled={!i.value} onChange={() => toggle(i.id)} />
                          <span>{selected.has(i.id) ? 'picked' : 'pick'}</span>
                        </label>
                        <OverflowMenu title={`Actions for ${i.name}`} items={rowActions(i)} />
                      </div>
                    )}
                  </div>
                )}
              />
            </div>
          )}
          <table className="table" style={density !== 'comfortable' || browse === 'byset' ? { display: 'none' } : undefined}>
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Card</th><th>Condition</th><th>Set</th>
                <th className="right">Cost</th><th className="right">Value</th><th className="right">P/L</th><th>Price source</th><th></th>
              </tr>
            </thead>
            <tbody>
              {shownRaw.map((i) => {
                const pl = i.value - i.cost_basis
                return (
                  <tr key={i.id}>
                    <td><input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} /></td>
                    <td>
                      <div className="row" style={{ cursor: 'pointer' }} onClick={() => openCard(i.card_id)}>
                        <div style={{ width: 34 }}><SlabCard src={i.image_small} alt={i.name} grade={i.graded_grade} setName={i.set_name} cardNo={i.number} cardId={i.card_id} variant={i.variant} rarity={i.rarity} /></div>
                        <b className="small">{i.name}</b>
                      </div>
                    </td>
                    <td>
                      <ConditionBadge cond={i.condition} />
                      {variantTag(i.variant) && (
                        <span className="badge" title="A separate printing of this number, not a condition — priced at the ordinary card's anchor">{variantTag(i.variant)}</span>
                      )}
                      {!i.graded_grade && i.protection && <span className="badge prot" title="Protected — condition holds while stored">🛡 {PROT_LABEL[i.protection]}</span>}
                      {!i.graded_grade && !i.protection && i.value >= 1 && i.status === 'collection' && (
                        <span className="badge prot bare" title="Bare — loose cards can slip a grade (and lose value) over time">bare</span>
                      )}
                      {i.graded_grade && <span className="badge grade">{GRADE_BADGE[i.graded_grade] ?? i.graded_grade}</span>}
                      {!i.graded_grade && i.gradingHint && (
                        <span
                          className="badge grade"
                          title={`Grade with ${i.gradingHint.serviceName}: expected profit $${i.gradingHint.expectedProfit.toFixed(2)} vs $${i.value.toFixed(2)} raw (+$${i.gradingHint.edge.toFixed(2)} edge) · ${i.gradingHint.gemChance}% gem chance${i.substatNote ? ' · this copy' : ''}${i.authBadge === 'unvetted' ? ' · authenticate first — the lab refuses unvetted raws (🛡 Authentication)' : ''}`}
                        >
                          ⚖ WORTH GRADING
                        </span>
                      )}
                      {i.substatNote && <span className="small faint" title="This copy's hidden condition — inspect it from the card detail">{i.substatNote}</span>}
                      {i.authBadge === 'fake' && <span className="badge auth-fake" title="Confirmed counterfeit — buylist pays $1 flat (Inventory → 🛡 Authentication)">🃏 FAKE</span>}
                      {i.authBadge === 'authenticated' && <span className="badge auth-ok" title="USPA-authenticated — buyers stop discounting it">✅ AUTH</span>}
                      {i.authBadge === 'unvetted' && <span className="badge auth-unvetted" title="High-value raw without authentication — sells at a haircut, and a counter-test can't rule a fake out">unvetted</span>}
                    </td>
                    <td className="small muted">{i.set_name}</td>
                    <td className="num faint">{fmtUsd(i.cost_basis)}</td>
                    <td className="num">{fmtUsd(i.value)}</td>
                    <td className={`num ${pl >= 0 ? 'delta-up' : 'delta-down'}`}>{pl >= 0 ? '+' : ''}{fmtUsd(pl)}</td>
                    <td><SourceBadge price={i.source} /></td>
                    <td className="right">
                      <OverflowMenu title={`Actions for ${i.name}`} items={rowActions(i)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </>
        )
      )}

      {tab === 'listed' && (
        listed.length === 0 ? (
          <EmptyState icon="🏷" text="Nothing listed" sub="List cards from the Raw tab — lower price = faster sale." />
        ) : (
          <table className="table">
            <thead><tr><th>Card</th><th>Condition</th><th className="right">Listed at</th><th className="right">Market</th><th></th></tr></thead>
            <tbody>
              {listed.map((i) => (
                <tr key={i.id}>
                  <td><b className="small">{i.name}</b></td>
                  <td><ConditionBadge cond={i.condition} /></td>
                  <td className="num">{fmtUsd(i.listing_price)}</td>
                  <td className="num faint">{fmtUsd(i.value)}</td>
                  <td className="right"><button className="small" onClick={() => cancelOne(i)}>Cancel</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {tab === 'auth' && AuthTab()}

      {tab === 'grading' && (
        pendingGrading.length === 0 ? (
          <EmptyState icon="⚖" text="Nothing at the grading company" sub="Use the ⚖ Grade button on a raw card worth $15+. CGC takes cards from $15 and can return a gold-label Pristine 10; Beckett BGS accepts $50+ and can return a Black Label 10." />
        ) : (
          <table className="table">
            <thead><tr><th>Card</th><th>Service</th><th>Submitted as</th><th className="right">Back in</th></tr></thead>
            <tbody>
              {pendingGrading.map((p) => {
                const svc = gradingSvc.find((s) => s.id === p.grading_service)
                const msLeft = new Date(p.grading_due_at).getTime() - Date.now()
                // Game-days are 12h or 24h per the save's setting — same formatting as the Grading page.
                const back = gameDayEtaFor(state?.day?.lengthHours ?? 2, msLeft)
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="row" style={{ cursor: 'pointer' }} onClick={() => openCard(p.card_id)}>
                        <div style={{ width: 32 }}><CardImg src={p.image_small} alt={p.name} cardId={p.card_id} /></div>
                        <b className="small">{p.name}</b>
                      </div>
                    </td>
                    <td className="small">{svc?.name ?? p.grading_service}</td>
                    <td><ConditionBadge cond={p.condition} /></td>
                    <td className="num">{back}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )
      )}

      {tab === 'incoming' && (
        <table className="table">
          <thead><tr><th>Card</th><th>From</th><th>Channel</th><th>Condition</th><th className="right">Arrives in</th></tr></thead>
          <tbody>
            {incoming.map((d) => {
              const msLeft = new Date(d.due_at).getTime() - Date.now()
              const eta = gameDayEtaFor(state?.day?.lengthHours ?? 2, msLeft)
              return (
                <tr key={d.id}>
                  <td>
                    <div className="row" style={{ cursor: 'pointer' }} onClick={() => openCard(d.card_id)}>
                      <div style={{ width: 32 }}><CardImg src={d.image_small} alt={d.name} cardId={d.card_id} /></div>
                      <b className="small">{d.name}{d.quantity > 1 ? ` ×${d.quantity}` : ''}</b>
                    </div>
                  </td>
                  <td className="small">{d.seller ?? 'Distributor'}</td>
                  <td className="small">{d.via === 'ebay' ? 'BidBay' : 'Market'}</td>
                  <td><ConditionBadge cond={d.condition} /></td>
                  <td className="num">{eta}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {tab === 'sealed' && (
        <div>
          <FirstUseTip surface="futures">
            Sealed product trades like a commodity now, and <b>condition is the whole spread</b>: case-fresh boxes sell
            <b> above market</b> (up to +10% on new print runs — the premium fades on vintage, where every surviving
            fresh box is already a survivor), while <b>worn</b> boxes — shrink scuffed, corners dinged, or just aged on
            a bad shelf — sell below it. Fresh stock slips to worn a little every game-day; the <b>🧵 damage dock</b>
            re-wraps worn boxes back to fresh for 10% of unit value, or dumps them fee-free. And the <b>🏦 loan desk</b>
            lends against your sealed inventory like gold at the bank: post boxes as collateral (they sit in the vault,
            unrippable), borrow up to 60% of their worn value at 0.6%/game-day, redeem units early or walk away and let
            the bank keep them. The loan sits on your books — net worth stays honest.
          </FirstUseTip>
          {futures && (futures.activeLoans > 0 || futures.collateralUnits > 0) && (
            <div className="panel mb14" style={{ borderColor: futures.loans.some((l) => l.overhanging) ? 'rgba(239,68,68,0.4)' : 'rgba(255,203,5,0.35)' }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <b>🏦 Loan desk</b>
                <span className="small muted">
                  {futures.activeLoans} active ticket{futures.activeLoans === 1 ? '' : 's'} · {fmtUsd(futures.outstanding)} outstanding
                  {' · '}{futures.collateralUnits} unit{futures.collateralUnits === 1 ? '' : 's'} in the vault ({fmtUsd(futures.escrowedValue)} worn value)
                  {' · '}{fmtUsd(futures.collateral.maxLoan)} borrowable headroom
                </span>
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {futures.loans.map((l) => (
                  <div key={l.id} className="row small" style={{ gap: 8, padding: '6px 10px', background: 'var(--panel2)', borderRadius: 6, flexWrap: 'wrap' }}>
                    {/* Keyed by product so a ticket whose collateral changed starts
                        the fallback ladder over instead of inheriting a failure. */}
                    <SealedThumb key={l.collateralProductId ?? 'none'} row={sealedById.get(l.collateralProductId ?? '')} small />
                    <b style={{ minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>#{l.id} {l.collateralName}</b>
                    <span className="faint">{l.collateralLeft}× in vault</span>
                    <span className="faint">{(l.rateDaily * 100).toFixed(1)}%/day</span>
                    {l.overhanging && <span className="badge" style={{ background: 'rgba(239,68,68,0.2)', color: 'var(--red)' }} title={`Balance outgrew the collateral — whole ticket re-priced ×${futures.terms.overhangRateMult}`}>⚠ overhanging</span>}
                    <b>balance {fmtUsd(l.balance)}</b>
                    <input
                      type="number"
                      min={1}
                      max={l.collateralLeft}
                      value={loanAmt[`r${l.id}`] ?? ''}
                      placeholder="units"
                      style={{ width: 64 }}
                      onChange={(e) => setLoanAmt((m) => ({ ...m, [`r${l.id}`]: e.target.value }))}
                    />
                    <button className="small" onClick={() => loanAction(() => api.sealedRedeem(l.id, Math.max(1, Number(loanAmt[`r${l.id}`]) || 1)), `Redeemed from the vault — boxes back on the shelf`)}>Redeem</button>
                    <button className="small" onClick={() => loanAction(() => api.sealedSettle(l.id), `Settled in full — the vault opens and your boxes come home`)}>Settle {fmtUsd(l.balance)}</button>
                    <button className="small" onClick={() => loanAction(() => api.sealedForfeit(l.id), 'Walked away — the bank keeps the boxes')}>Forfeit</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {sealed.length === 0 ? (
            <EmptyState icon="📦" text="No sealed stock" sub="Buy from the Pack Shop — every purchase arrives sealed. Open it here whenever you want." />
          ) : (
            <div>
              <div className="filter-row" style={{ marginBottom: 10 }}>
                <SearchInput value={sealedQ} onChange={setSealedQ} placeholder="Search sealed stock…" />
                <SortSelect
                  value={sealedSort}
                  onChange={setSealedSort}
                  options={[
                    { value: 'value_desc', label: 'Sort: Position value' },
                    { value: 'value_asc', label: 'Sort: Position value ↑' },
                    { value: 'pl_desc', label: 'Sort: Biggest unrealized gains' },
                    { value: 'pl_asc', label: 'Sort: Biggest unrealized losses' },
                    { value: 'qty_desc', label: 'Sort: Most packs held' },
                    { value: 'name_asc', label: 'Sort: Name A→Z' },
                  ]}
                />
                <span className="result-count faint small">{shownSealed.length} of {sealed.length} products</span>
              </div>
              <div className="row mb14" style={{ gap: 22 }}>
                <div><div className="faint small">MARKET VALUE</div><div className="price" style={{ fontSize: 18 }}>{fmtUsd(sealed.reduce((a, s) => a + s.market_value, 0))}</div></div>
                <div><div className="faint small">COST BASIS</div><div className="price" style={{ fontSize: 18 }}>{fmtUsd(sealed.reduce((a, s) => a + s.basis, 0))}</div></div>
                <div>
                  <div className="faint small">UNREALIZED P&L</div>
                  <div className="price" style={{ fontSize: 18, color: sealed.reduce((a, s) => a + s.unrealized, 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {fmtUsd(sealed.reduce((a, s) => a + s.unrealized, 0))}
                  </div>
                </div>
              </div>
              <table className="table">
                <thead><tr><th>Product</th><th className="right">Fresh</th><th className="right">Worn</th><th className="right">Fresh px</th><th className="right">Worn px</th><th className="right">P&L</th><th></th></tr></thead>
                <tbody>
                  {shownSealed.map((s) => {
                    const f = futures?.rows.find((r) => r.productId === s.product_id)
                    const freshQty = f?.freshQty ?? (s.freshQty ?? s.quantity)
                    const wornQty = f?.wornQty ?? (s.wornQty ?? 0)
                    const vaultQty = f?.escrowQty ?? (s.escrowed ?? 0)
                    const freeQty = freshQty + wornQty
                    return (
                      <tr key={s.product_id}>
                        <td>
                          <div className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                            <SealedThumb row={s} />
                            <div style={{ minWidth: 0 }}>
                              <b className="small">{s.name}</b>{' '}
                              {s.oop && <span className="badge oop" title={`Print run ended ~${s.oop_months} months ago`}>📈 OOP</span>}
                              {wornQty > 0 && <span className="badge est" title="Worn: shrink scuffed, corners dinged — trades below market">worn ×{wornQty}</span>}
                              {vaultQty > 0 && <span className="badge live" title="Posted as loan-desk collateral — in the bank's vault, untouchable until redeemed">🏦 vault ×{vaultQty}</span>}
                              <div className="faint small">{s.source === 'pricecharting' ? 'PriceCharting' : 'est. price'} · {s.status}{f ? ` · fresh ${f.freshPremium > 0 ? '+' : ''}${f.freshPremium.toFixed(1)}%` : ''}</div>
                            </div>
                          </div>
                        </td>
                        <td className="num">{freshQty}</td>
                        <td className="num" style={{ color: wornQty > 0 ? 'var(--gold)' : undefined }}>{wornQty}</td>
                        <td className="num">{fmtUsd(f?.freshPrice ?? s.market_price)}</td>
                        <td className="num faint">{wornQty > 0 && f ? fmtUsd(f.wornPrice) : '—'}</td>
                        <td className="num" style={{ color: s.unrealized >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {s.unrealized >= 0 ? '+' : ''}{fmtUsd(s.unrealized)}
                        </td>
                        <td className="right">
                          <span className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            {freeQty > 0 && <button className="small" onClick={() => openSealed(s.product_id)}>{s.packs && s.packs > 1 ? `OPEN BOX · ${s.packs} packs` : 'OPEN 1'}</button>}
                            {freshQty > 0 && <button className="small primary" onClick={() => sellSealedCond(s.product_id, freshQty, 'fresh')}>SELL FRESH · {fmtUsd(freshQty * (f?.freshPrice ?? s.market_price) * 0.9)}</button>}
                            {wornQty > 0 && f && (
                              <>
                                <button className="small" title={`Damage dock re-wraps to fresh — fee ${fmtUsd(f.rewrapFee)}/unit`} onClick={() => rewrap(s.product_id, wornQty)}>🧵 RE-WRAP · {fmtUsd(f.rewrapFee * wornQty)}</button>
                                <button className="small" title="The dock on-sells worn boxes at their worn price, no dealer fee" onClick={() => dumpWorn(s.product_id, wornQty)}>DUMP · {fmtUsd(wornQty * f.wornPrice)}</button>
                              </>
                            )}
                            {f && (
                              <button
                                className="small"
                                title={`Loan desk: post these boxes as collateral, borrow ${(f.wornQty + f.freshQty) > 0 ? fmtUsd(Math.max(0, (f.freshQty + f.wornQty) * f.wornPrice * futures!.terms.collateralLtv)) : '$0'} at ${(futures!.terms.rateDaily * 100).toFixed(1)}%/game-day`}
                                onClick={() => borrow(s.product_id, f.freshQty + f.wornQty, undefined)}
                              >
                                🏦 POST ALL
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="small faint mt8">
                <TipList
                  items={[
                    { icon: '💵', label: 'Sell now', text: <>today's price at the box's condition, minus a 10% dealer fee</> },
                    { icon: '🗑️', label: 'Dump', text: <>worn price at the damage dock, no fee</> },
                    { icon: '📈', label: 'Hold', text: <>out-of-print sealed appreciates; case-fresh premium fades on vintage</> },
                  ]}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'supplies' && (
        <div>
          {supplies && supplies.wear.bareCards > 0 && (
            <div className="panel" style={{ borderColor: 'rgba(239,68,68,0.35)', marginBottom: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <b>⚠ {supplies.wear.bareCards.toLocaleString()} bare card{supplies.wear.bareCards === 1 ? '' : 's'} in the box</b>
                  <div className="small muted">Worth {fmtUsd(supplies.wear.bareValue)} at current grades. Each game-day, bare cards can slip a condition step — NM → LP is a 20% value hit. Listed, cased, and graded cards are safe.</div>
                </div>
              </div>
            </div>
          )}
          <div className="grid cols3 mb14">
            {(supplies?.stock ?? []).map((s) => (
              <SupplyCard key={s.kind} supply={s} onBought={load} />
            ))}
          </div>
          {supplies && (
            <div className="faint small">
              In stock: {Object.entries(supplies.wear.byProtection).map(([k, n]) => `${n} × ${PROT_LABEL[k] ?? k}`).join(' · ') || 'nothing protected yet'}
              {' · '}supplies spend books as shop overhead (deductible)
            </div>
          )}
          <p className="small muted mt14">
            Cards are physical objects. Left loose in a box, they wear — and condition is money: NM is 100% of market,
            LP 80%, MP 65%, HP 50%. The richer the card, the more carefully the world handles it, but nothing protects
            like a sleeve. Select "🛡" on any raw card to protect it; the shop's buyer sources cards pre-sleeved.
          </p>
          <InsurancePanel key="insurance" />
        </div>
      )}

      <div className="panel mt22">
        <h2>Sales log</h2>
        {sales.length === 0 ? (
          <EmptyState icon="💰" text="No sales yet" sub="Listed cards sell to NPC buyers over time." />
        ) : (
          <table className="table">
            <thead><tr><th>Card</th><th>Buyer</th><th className="right">Received</th><th className="right">Fee</th><th className="right">Profit</th><th className="right">When</th></tr></thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id}>
                  <td><b className="small">{s.name}</b> <span className="faint small">×{s.quantity}</span></td>
                  <td className="small muted">{s.buyer}</td>
                  <td className="num">{fmtUsd(s.sale_price)}</td>
                  <td className="num faint">{fmtUsd(s.fee)}</td>
                  <td className={`num ${s.profit >= 0 ? 'delta-up' : 'delta-down'}`}>{s.profit >= 0 ? '+' : ''}{fmtUsd(s.profit)}</td>
                  <td className="num faint small">{new Date(s.sold_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {gradePick && GradePicker()}
      {reveal && (
        <GradeRevealModal
          reveal={reveal}
          onClose={() => setReveal(null)}
          onBackdropClose={() => closeMenu(() => setReveal(null))}
          onSeeCollection={() => setTab('raw')}
        />
      )}
      {protectPick && ProtectPicker()}
      {bulkPick && BulkProtectPicker()}
      {bulkGrade && BulkGradeModal()}
      {bulkReprice && BulkRepriceModal()}
      {authPick && AuthPicker()}
      {authReveal && AuthRevealModal()}
    </div>
  )
}

const PROT_LABEL: Record<string, string> = { sleeve: 'sleeved', toploader: 'toploaded', one_touch: 'one-touch' }
const PROT_RANK: Record<string, number> = { sleeve: 0, toploader: 1, one_touch: 2 }

function SupplyCard({ supply, onBought }: { supply: SuppliesStatus['stock'][number]; onBought: () => void }) {
  const { toast, refreshState } = useStore()
  const [busy, setBusy] = useState(false)
  const buy = async () => {
    setBusy(true)
    try {
      const r = await api.buySupply(supply.kind)
      if (r.ok) toast(`${r.got} ${supply.label.toLowerCase()} for ${fmtUsd(r.spent ?? 0)}`, 'good')
      else toast(r.error ?? 'Purchase failed', 'bad')
      refreshState()
      onBought()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="panel" style={{ margin: 0 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{supply.icon} {supply.label}</b>
        <span className="badge">{supply.quantity} in stock</span>
      </div>
      <div className="small muted mt8">{supply.blurb}</div>
      <div className="row mt14" style={{ justifyContent: 'space-between' }}>
        <span className="small">{fmtUsd(supply.unitCost * supply.packSize)} <span className="faint small">/ {supply.packSize}</span></span>
        <button className="primary" disabled={busy} onClick={buy}>Buy</button>
      </div>
    </div>
  )
}

function InsurancePanel() {
  const { toast, refreshState } = useStore()
  const [ins, setIns] = useState<InsuranceStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const load = useCallback(() => { api.insurance().then(setIns).catch(() => {}) }, [])
  useEffect(() => { load() }, [load])

  const bind = async (tier: string) => {
    setBusy(true)
    try {
      const r = await api.insuranceBind(tier)
      if (r.ok) {
        toast(r.waitingDays ? `Policy bound — ${r.waitingDays}-day waiting period before claims are honored` : 'Policy bound — coverage is live', 'good')
        refreshState()
      } else toast(r.error ?? 'Could not bind the policy', 'bad')
      load()
    } finally { setBusy(false) }
  }
  const cancel = async () => {
    if (!confirm('Cancel the policy? Disasters are fully uninsured from this moment.')) return
    setBusy(true)
    try {
      const r = await api.insuranceCancel()
      if (r.ok) { toast('Policy cancelled', 'info'); refreshState() }
      else toast(r.error ?? 'Could not cancel', 'bad')
      load()
    } finally { setBusy(false) }
  }

  if (!ins) return null
  const p = ins.policy
  const day = (s: string | null) => (s ? new Date(s).toLocaleDateString() : '')

  let statusLine: JSX.Element
  if (!p) {
    statusLine = (
      <div className="small muted">
        No policy — {fmtUsd(ins.appraisal.total)} of cardboard sleeps naked. Roof leaks, spills, and break-ins are
        real: uninsured losses are gone forever. Premiums draft weekly and scale with the live appraisal.
      </div>
    )
  } else if (p.status === 'lapsed') {
    statusLine = (
      <div className="small" style={{ color: 'var(--red)' }}>
        ⚠ LAPSED — the premium draft bounced. {p.graceDaysLeft} day{p.graceDaysLeft === 1 ? '' : 's'} of grace to rebind
        without a new waiting period, then disasters are fully yours.
      </div>
    )
  } else if (p.waitingDaysLeft > 0) {
    statusLine = (
      <div className="small" style={{ color: 'var(--gold, #facc15)' }}>
        ⏳ Waiting period — {p.waitingDaysLeft} day{p.waitingDaysLeft === 1 ? '' : 's'} until claims are honored. You can't
        buy the umbrella in the rain.
      </div>
    )
  } else {
    statusLine = (
      <div className="small muted">
        Active: {Math.round(p.coverage * 100)}% of the {fmtUsd(ins.appraisal.total)} appraisal · {Math.round(p.deductibleFrac * 100)}% deductible ·
        claims capped at {fmtUsd(p.claimCap)} · {fmtUsd(p.weeklyPremium)}/wk{p.storageSurcharge ? ` (incl. ${fmtUsd(p.storageSurcharge)} locker surcharge)` : ''} (next draft {day(p.nextDraftAt)}).
        Premiums book as deductible overhead.
      </div>
    )
  }

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <b>{p ? `${p.tierIcon} Insurance — ${p.tierName}` : '🛡 Insurance'}</b>
        <div className="row" style={{ gap: 8 }}>
          {p && p.status === 'active' && <button className="ghost small" disabled={busy} onClick={cancel}>Cancel policy</button>}
          <button className="ghost small" onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Details & claims'}</button>
        </div>
      </div>
      <div className="mt8">{statusLine}</div>
      {open && (
        <>
          <div className="grid cols3 mt14">
            {ins.tiers.map((t) => (
              <div key={t.id} className="panel" style={{ margin: 0 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>{t.icon} {t.name}</b>
                  {p?.tier === t.id && p.status === 'active' && <span className="badge">held</span>}
                </div>
                <div className="small muted mt8">{t.blurb}</div>
                <div className="small mt8">{Math.round(t.coverage * 100)}% coverage · {Math.round(t.deductibleFrac * 100)}% deductible · cap {Math.round(t.capFrac * 100)}% of value</div>
                <div className="row mt14" style={{ justifyContent: 'space-between' }}>
                  <span className="small">{fmtUsd(ins.weeklyPremiums[t.id] ?? 0)} <span className="faint small">/ wk</span></span>
                  <button className="primary small" disabled={busy || (!!p && p.status === 'active')} onClick={() => bind(t.id)}>
                    {p?.tier === t.id && p.status === 'active' ? 'Bound' : 'Bind'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {p && (
            <div className="faint small mt8">
              Lifetime: {fmtUsd(p.lifetimePremium)} paid in premiums · {fmtUsd(p.lifetimeClaims)} recovered on claims.
              Appraisal: {fmtUsd(ins.appraisal.raw)} raw + {fmtUsd(ins.appraisal.slab)} slabs + {fmtUsd(ins.appraisal.sealed)} sealed.
              {p.vaultImmuneSlabs && ' 🏆 Vault rider: your slabs sleep off-site — leaks, spills, heat, and thieves can’t touch them.'}
              {!p.vaultImmuneSlabs && p.storageSurcharge ? ` 🗄 Storage surcharge: ${fmtUsd(p.storageSurcharge)}/wk for the lockers.` : ''}
              {p.vaultProtected != null && p.vaultProtected > 0 && p.vaultExposed != null && p.vaultExposed > 0 && (
                <span style={{ color: 'var(--gold, #eab308)' }}> The vault shields your {p.vaultProtected} most valuable slab{p.vaultProtected === 1 ? '' : 's'} — {p.vaultExposed} overflow slab{p.vaultExposed === 1 ? '' : 's'} still sleep{p.vaultExposed === 1 ? 's' : ''} at home, exposed.</span>
              )}
            </div>
          )}
          <div className="mt14">
            <b className="small">Claims history</b>
            {(!p || p.claims.length === 0) ? (
              <div className="faint small mt8">No claims — long may it last.</div>
            ) : (
              <table className="table mt8">
                <thead><tr><th>When</th><th>Event</th><th>Damage</th><th className="right">Loss</th><th className="right">Paid</th></tr></thead>
                <tbody>
                  {p.claims.map((c, i) => (
                    <tr key={i}>
                      <td className="small faint">{day(c.at)}</td>
                      <td className="small">{c.label}</td>
                      <td className="small muted">
                        {c.items.map((it, j) => (
                          <div key={j}>{it.name}: {it.from} → {it.to}</div>
                        ))}
                      </td>
                      <td className="num">{fmtUsd(c.loss)}</td>
                      <td className={`num ${c.payout > 0 ? 'delta-up' : 'delta-down'}`}>{c.payout > 0 ? fmtUsd(c.payout) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="small muted mt14">
            New policies carry a 7-day waiting period, and a bounced premium lapses the policy (7 days of grace to rebind,
            then it's a fresh policy with a fresh wait). Disasters hit collection boxes at home — slabs shrug off water and
            heat but not thieves, and severe break-ins remove cards outright: claimed at covered value, or gone forever.
            The 🏆 vault rider stores every slab off-site — immune to the whole disaster roll — and each rented locker
            adds a small surcharge to the weekly premium (more doors, more watch).
          </p>
        </>
      )
      }
    </div>
  )
}
