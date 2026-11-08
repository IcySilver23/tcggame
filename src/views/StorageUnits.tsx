import { useEffect, useState } from 'react'
import { api } from '../api'
import type { StorageUnitsSection, StorageOpenResult, StorageCapacity } from '../api'
import { useStore } from '../store'
import { CardImg, EmptyState, FirstUseTip, fmtUsd } from '../components'

// ---------------------------------------------------------------------------
// Storage & the vault — capacity meter, locker rental, and the graded-slab
// rider policy. The bedroom shelf holds 100 raw cards free; slabs are metered
// separately and stack nowhere without the vault rider.
// ---------------------------------------------------------------------------

function meterColor(pct: number): string {
  if (pct >= 1) return 'var(--red)'
  if (pct >= 0.75) return 'var(--yellow)'
  return 'var(--green)'
}

function CapacityMeter({ label, used, cap, pct }: { label: string; used: number; cap: number; pct: number }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: 'center' }}>
      <span className="small" style={{ width: 110, flexShrink: 0 }}>{label}</span>
      <div style={{ height: 8, background: 'var(--panel2)', borderRadius: 4, overflow: 'hidden', flex: 1 }}>
        <div style={{ width: `${Math.round(pct * 100)}%`, height: '100%', background: meterColor(pct), transition: 'width .3s' }} />
      </div>
      <span className="small" style={{ width: 92, textAlign: 'right', flexShrink: 0, color: pct >= 1 ? 'var(--red)' : undefined }}>
        {used}/{cap} {pct >= 1 ? 'FULL' : ''}
      </span>
    </div>
  )
}

export function StoragePanel() {
  const { toast, refreshState } = useStore()
  const [cap, setCap] = useState<StorageCapacity | null>(null)
  const [busy, setBusy] = useState(false)
  const [floorDraft, setFloorDraft] = useState('')

  const load = () => api.storageCapacity().then(setCap).catch(() => {})
  useEffect(() => { load() }, [])
  if (!cap) return null

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, good: string) => {
    setBusy(true)
    try {
      const r = await fn()
      if (!r.ok) { toast(r.error ?? 'Failed', 'bad'); return }
      toast(good, 'good')
      refreshState()
      load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel mt14">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <b>📦 Your storage</b>
        {cap.monthlyTotal > 0
          ? <span className="small muted">storage bills: {fmtUsd(cap.monthlyTotal)}/mo</span>
          : <span className="small faint">the shelf is free — lockers rent monthly</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        <CapacityMeter label="🃏 Raw cards" used={cap.rawOwned} cap={cap.rawCapacity} pct={cap.rawPct} />
        <CapacityMeter label="🏆 Graded slabs" used={cap.slabOwned} cap={cap.slabCapacity} pct={cap.slabPct} />
      </div>
      {cap.slabOwned > 0 && cap.slabOwned > cap.slabCapacity && (
        <div className="small" style={{ marginTop: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(230,180,40,0.10)', border: '1px solid rgba(230,180,40,0.4)', color: 'var(--gold, #eab308)' }}>
          ⚠️ {cap.slabOwned - cap.slabCapacity} slab{cap.slabOwned - cap.slabCapacity === 1 ? '' : 's'} beyond the vault slots sleep{cap.slabOwned - cap.slabCapacity === 1 ? 's' : ''} at home — disasters can reach them. Rent more vault coverage or move a slab out.
        </div>
      )}
      <div className="grid cols3" style={{ marginTop: 10 }}>
        {cap.tiers.map((t) => (
          <div key={t.id} className="panel" style={{ margin: 0, background: 'var(--panel2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b className="small">🗄 {t.label}</b>
              <span className="small">{fmtUsd(t.monthly)}/mo</span>
            </div>
            <div className="small muted" style={{ flex: 1 }}>{t.blurb}</div>
            <div className="small">+{t.capacity} card slots</div>
            <button className="primary small" disabled={busy} onClick={() =>
              act(() => api.storageRentLocker(t.id), `${t.label} rented — +${t.capacity} slots, first month paid.`)
            }>Rent</button>
          </div>
        ))}
      </div>
      {cap.lockers.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <b className="small">Your lockers</b>
          {cap.lockers.map((l) => (
            <div key={l.id} className="row small" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span>🗄 {l.label}</span>
              <span className="faint">+{l.capacity} slots</span>
              <span className="faint">{fmtUsd(l.monthly)}/mo</span>
              <button className="small ghost" disabled={busy} onClick={() =>
                act(() => api.storageCloseLocker(l.id), 'Locker turned in — key back, one less bill.')
              }>Turn in</button>
            </div>
          ))}
        </div>
      )}
      <div className="panel" style={{ margin: '10px 0 0', padding: '8px 10px', background: 'var(--panel2)' }}>
        <div className="row small" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <span>♻️ <b>When the shelf is full</b> — what happens to a delivery that doesn't fit:</span>
          <div className="row" style={{ gap: 6 }}>
            <button
              className={cap.overflowPolicy === 'refuse' ? 'small primary' : 'small ghost'}
              disabled={busy}
              onClick={() => act(() => api.storageOverflowPolicy('refuse'), 'Overflow policy: refuse — a full shelf turns deliveries away, nothing you own is touched.')}
            >Refuse the buy</button>
            <button
              className={cap.overflowPolicy === 'scrap' ? 'small primary' : 'small ghost'}
              disabled={busy}
              onClick={() => act(() => api.storageOverflowPolicy('scrap'), `Overflow policy: auto-scrap — the cheapest bulk sells at ${Math.round(cap.bulkRate * 100)}¢ on the dollar until the delivery fits. Favorites are spared.`)}
            >Auto-scrap for room</button>
          </div>
        </div>
        <div className="small faint" style={{ marginTop: 4 }}>
          {cap.overflowPolicy === 'refuse'
            ? 'Refuse the buy — market buys and shop shelves bounce with the count; pack rips and lots leave their overflow behind. Nothing you own is ever sold for room.'
            : `Auto-scrap is on for ${cap.overflowSurfaces.map((s) => s.label.toLowerCase()).join(', ')}: each full-shelf buy sells your cheapest spare cardboard first. Favorites, binder pockets, cases, and bulk boxes are never touched.`}
        </div>
        {cap.overflowPolicy === 'scrap' && (
          <div className="row small" style={{ marginTop: 6, gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>Floor: never auto-scrap cards worth more than</span>
            <input
              className="input"
              style={{ width: 76 }}
              inputMode="decimal"
              placeholder="$0 (off)"
              value={floorDraft}
              onChange={(e) => setFloorDraft(e.target.value)}
            />
            <button
              className="small ghost"
              disabled={busy}
              onClick={() => {
                const v = Number(floorDraft)
                if (floorDraft.trim() !== '' && (!Number.isFinite(v) || v < 0)) { toast('Enter a dollar amount, or clear it to disable', 'bad'); return }
                act(() => api.storageScrapFloor(floorDraft.trim() === '' ? 0 : v), floorDraft.trim() === '' || v <= 0 ? 'Scrap floor cleared — any spare is fair game.' : `Scrap floor set at ${fmtUsd(v)} — collector cardboard stays.`)
                setFloorDraft('')
              }}
            >Set floor</button>
            {cap.scrapFloor > 0 && (
              <>
                <span className="badge hit">floor at {fmtUsd(cap.scrapFloor)}</span>
                <button className="small ghost" disabled={busy} onClick={() =>
                  act(() => api.storageScrapFloor(0), 'Scrap floor cleared — any spare is fair game.')
                }>Clear</button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="panel" style={{ margin: '10px 0 0', padding: '8px 10px', background: 'var(--panel2)' }}>
        {cap.vault ? (
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <span className="small">🏆 <b>Vault rider active</b> — {cap.vault.capacity} insured slab slots under camera and glass, {fmtUsd(cap.vault.monthly)}/mo. Slabs stored off-site are untouchable: leaks, spills, heat, and break-ins can't reach them.</span>
            <button className="small ghost" disabled={busy} onClick={() =>
              act(() => api.storageVaultCancel(), 'Vault rider cancelled — the slabs come home to the dresser.')
            }>Cancel rider</button>
          </div>
        ) : (
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <span className="small">🏆 <b>Vault rider</b> — graded slabs don't stack. {fmtUsd(12)}/mo for 25 insured slab slots beyond your 2 dresser spots — and vault slabs are immune to the insurance disaster roll.</span>
            <button className="small primary" disabled={busy} onClick={() =>
              act(() => api.storageVaultSubscribe(), 'Vault rider active — the slabs are safe now.')
            }>Add the rider</button>
          </div>
        )}
      </div>
    </div>
  )
}

export function StorageUnitsView() {
  const { toast, refreshState, openCard } = useStore()
  const [data, setData] = useState<StorageUnitsSection | null>(null)
  const [bid, setBid] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [openHaul, setOpenHaul] = useState<StorageOpenResult | null>(null)
  const [keep, setKeep] = useState<Set<string>>(new Set())
  const [racksFree, setRacksFree] = useState<number | null>(null)

  const load = () => {
    api.storageUnits().then(setData).catch(() => {})
    api.storageCapacity().then((c) => setRacksFree(c.rawFree)).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const doBid = async (unitId: number, amount: number) => {
    setBusy(true)
    try {
      const r = await api.storageBid(unitId, amount)
      if (!r.ok) { toast(r.error ?? 'Bid failed', 'bad'); load(); return }
      if (r.won) {
        toast(`SOLD — locker is yours for ${fmtUsd(r.paid ?? 0)}. Go open the door.`, 'good')
        const h = await api.storageOpen(unitId)
        if (h.ok) { setOpenHaul(h); setKeep(new Set()) }
        refreshState()
        load()
      } else if (r.counter) {
        toast(`${r.bidder} counters at ${fmtUsd(r.counter)} — raise or walk.`, 'bad')
        load()
      } else {
        toast('Your bid stands — no challenge. The gavel is falling.', 'good')
        load()
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Bid failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const sortHaul = async () => {
    if (!openHaul?.unit) return
    setBusy(true)
    try {
      const r = await api.storageSort(openHaul.unit.id, [...keep])
      if (r.ok) {
        toast(`Haul sorted — ${r.kept} to the binder, ${r.bulkCount} to scrap for ${fmtUsd(r.bulkCash ?? 0)}.`, 'good')
        setOpenHaul(null)
        refreshState()
        load()
      } else toast(r.error ?? 'Sort failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  if (openHaul?.ok && openHaul.unit) {
    const cards = openHaul.cards ?? []
    const keptValue = cards.filter((c) => keep.has(c.card_id)).reduce((a, c) => a + c.value, 0)
    const scrapValue = cards.filter((c) => !keep.has(c.card_id)).reduce((a, c) => a + c.value, 0) * (data?.bulkRate ?? 0.08)
    return (
      <div>
        <div className="page-head">
          <div>
            <h1>🚪 Unit {openHaul.unit.unit_code} — the haul</h1>
            <div className="sub">
              {openHaul.unit.facility} · paid {fmtUsd(openHaul.unit.paid ?? 0)} · contents worth {fmtUsd(openHaul.contentsValue ?? 0)} at market
              {openHaul.collectionFound && ' · 🏆 A COLLECTION — card-savers, near-mint, the real thing'}
            </div>
          </div>
        </div>
        <div className="panel mb14">            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <b>Sort it: keep for the binder, scrap the rest</b>
              <div className="row" style={{ gap: 10 }}>
                {racksFree != null && keep.size > racksFree && (
                  <span className="small" style={{ color: 'var(--red)' }}>racks only take {racksFree} more — overflows go to scrap</span>
                )}
                <span className="small">Keeping <b>{keep.size}</b> · {fmtUsd(keptValue)}</span>
              <span className="small muted">Scrap pays {fmtUsd(scrapValue)} now ({Math.round((data?.bulkRate ?? 0.08) * 100)}¢ on the dollar)</span>
              <button className="primary" disabled={busy} onClick={sortHaul}>Lock it in</button>
              <button className="ghost" onClick={() => setKeep(new Set(cards.map((c) => c.card_id)))}>Keep everything</button>
            </div>
          </div>
        </div>
        <div className="grid cols3">
          {cards.map((c) => {
            const isKept = keep.has(c.card_id)
            return (
              <div key={c.card_id} className="panel" style={{ margin: 0, opacity: isKept ? 1 : 0.75, borderLeft: `4px solid ${isKept ? 'var(--yellow)' : 'transparent'}` }}>
                <div className="row" style={{ alignItems: 'stretch' }}>
                  <div style={{ width: 72, cursor: 'pointer' }} onClick={() => openCard(c.card_id)}>
                    <CardImg src={c.image_small} alt={c.name} cardId={c.card_id} />
                  </div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                      <b style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</b>
                      {c.hidden_collection === 1 && c.value >= 8 && <span className="badge hit" title="Part of the found collection">🏆</span>}
                    </div>
                    <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.set_name} · {c.condition}</div>
                    <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                      <span style={{ fontWeight: 750 }}>{fmtUsd(c.value)}</span>
                      <button className={isKept ? 'small' : 'small primary'} onClick={() =>
                        setKeep((k) => { const n = new Set(k); if (n.has(c.card_id)) n.delete(c.card_id); else n.add(c.card_id); return n })
                      }>{isKept ? '✓ keeping' : 'keep'}</button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head desk">
        <div className="ph-id">
          <span className="ph-mark" aria-hidden>🗝️</span>
          <div>
            <h1>Storage & Auctions</h1>
            <div className="sub">Your shelf holds 100 cards free — rent extra storage in the panel below when it fills. The auctions? Delinquent lockers sold sight-unseen to the highest bidder: bid, win, sort the haul — keep the good stuff, scrap the rest for fast cash.</div>
          </div>
        </div>
      </div>

      <FirstUseTip surface="storage">
        The locker gamble: you get one look through the door gap and a starting bid — everything else is a read. Pickers
        with better info than you will run bids up, so the discipline is knowing when the locker is worth more to you than
        to them. Win one and the haul sorts card by card: keep, or scrap for ~8¢ on the dollar, cash on the spot.
      </FirstUseTip>

      <StoragePanel />

      {data && data.units.length === 0 && (
        <EmptyState icon="🗝️" text="No lockers on the block" sub="Facilities clear delinquencies every few days — check back." />
      )}
      <div className="grid cols2">
        {(data?.units ?? []).map((u) => (
          <div key={u.id} className="panel" style={{ margin: 0 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>🗄 Unit {u.unit_code}</b>
              <span className={`badge ${u.minutes_left < 30 ? 'above' : 'est'}`}>{u.minutes_left >= 60 ? `${Math.round(u.minutes_left / 60)}h left` : `${u.minutes_left}m left`}</span>
            </div>
            <div className="small muted">{u.facility}</div>
            <div className="panel" style={{ margin: '8px 0', padding: '8px 10px', background: 'var(--panel2)' }}>
              <div className="small"><b>Through the door gap:</b> {u.peek.line}</div>
              <div className="small faint" style={{ marginTop: 2 }}>{u.peek.label} — {u.peek.blurb}</div>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
              <span className="small">Current: <b>{fmtUsd(u.current_bid)}</b> <span className="faint">({u.current_bidder})</span></span>
              <span className="small muted">opening {fmtUsd(u.street_price)}</span>
            </div>
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              <input
                className="input"
                style={{ width: 100 }}
                inputMode="decimal"
                placeholder={String(Math.ceil(u.current_bid * 1.1))}
                value={bid[u.id] ?? ''}
                onChange={(e) => setBid((b) => ({ ...b, [u.id]: e.target.value }))}
              />
              <button className="primary" disabled={busy} onClick={() => {
                const amt = Number(bid[u.id])
                if (!Number.isFinite(amt) || amt <= 0) { toast('Enter a bid first', 'bad'); return }
                doBid(u.id, amt)
              }}>PLACE BID</button>
            </div>
          </div>
        ))}
      </div>

      {data && data.history.length > 0 && (
        <div className="panel mt14">
          <b className="small">Locker history</b>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.history.map((h) => (
              <div key={h.id} className="row small" style={{ gap: 8 }}>
                <span className="faint">{h.facility} · {h.unit_code}</span>
                <span>{h.flavor_label}</span>
                {h.won ? (
                  <>
                    <span>paid {fmtUsd(h.paid ?? 0)}</span>
                    <span>worth {fmtUsd(h.contents_value ?? 0)}</span>
                    <b style={{ color: (h.profit ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {(h.profit ?? 0) >= 0 ? '+' : ''}{fmtUsd(h.profit ?? 0)}
                    </b>
                  </>
                ) : (
                  <span className="faint">lost to another bidder</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
