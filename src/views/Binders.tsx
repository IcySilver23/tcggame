import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type BinderAvailableRow, type BinderDetail, type BinderSlot, type BinderSummary } from '../api'
import { useStore } from '../store'
import { CardImg, DensityToggle, EmptyState, fmtUsd } from '../components'

// ---------------------------------------------------------------------------
// Binders — the physical-feeling half of the collection.
//
// Two states, one verb: put cards in pockets and flip through them.
//
// The shelf used to be a grid of nearly empty panels ("name, 0 cards, value,
// Delete") and the book put its page-flip arrows beside the pockets, which at
// this game's width squeezed a 3×3 page into nine narrow strips and pushed the
// right edge of the book off screen. So: the shelf now shows what is actually
// inside each binder (a paper peek at the first pockets, a fill meter, how many
// pockets are free), and the book carries its page controls in a bar under the
// page instead of flanking it.
// ---------------------------------------------------------------------------

const SLOTS_PER_PAGE = 9
// Stored per binder, so the KEYS are save data — only the swatch values are
// themed (var(--blue) darkens in the dark theme).
const ACCENTS: Record<string, string> = {
  yellow: '#ffcb05', blue: 'var(--blue)', red: '#ff5d5d', green: '#2ee6a8', purple: '#a78bfa',
}
const ACCENT_KEYS = Object.keys(ACCENTS)

export function BindersView() {
  const { toast, state } = useStore()
  const [binders, setBinders] = useState<BinderSummary[]>([])
  // One detail read per binder so the shelf can show a real peek and a real
  // fill meter — the summary only carries counts, not what's in the pockets.
  const [covers, setCovers] = useState<Record<number, BinderDetail>>({})
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftAccent, setDraftAccent] = useState('yellow')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const rows = await api.binders().catch(() => [] as BinderSummary[])
    setBinders(rows)
    const pairs = await Promise.all(
      rows.slice(0, 12).map(async (b) => {
        const d = await api.binderDetail(b.id).catch(() => null)
        return [b.id, d] as const
      }),
    )
    const next: Record<number, BinderDetail> = {}
    for (const [id, d] of pairs) if (d) next[id] = d
    setCovers(next)
  }, [])

  useEffect(() => { load() }, [load])

  const create = async () => {
    const name = draft.trim()
    if (!name) { toast('Name the binder first', 'bad'); return }
    setBusy(true)
    try {
      const b = await api.createBinder(name, draftAccent)
      toast(`Binder "${name}" created`, 'good')
      setDraft('')
      setCreating(false)
      await load()
      if (b?.id) setOpenId(b.id)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create the binder', 'bad')
    } finally { setBusy(false) }
  }

  const destroy = async (b: BinderSummary) => {
    if (!confirm(`Delete binder "${b.name}"? The cards go back to your collection — nothing is lost.`)) return
    await api.deleteBinder(b.id)
    toast('Binder deleted — cards kept')
    load()
  }

  if (openId != null) {
    return <BinderDetailV id={openId} onBack={() => { setOpenId(null); load() }} onChanged={load} />
  }

  const slotted = state?.binders?.slotted ?? 0
  const totalValue = state?.binders?.value ?? 0

  return (
    <div>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>Binders</h1>
          <div className="sub">Nine pockets a page. Group cards, flip through them, keep the good stuff where you can see it.</div>
        </div>
        {!creating && <button className="primary" onClick={() => setCreating(true)}>+ New binder</button>}
      </div>

      {binders.length > 0 && (
        <div className="binder-summary">
          <div><span className="faint small">Binders</span><b>{binders.length}</b></div>
          <div><span className="faint small">Slotted</span><b>{slotted.toLocaleString()}</b></div>
          <div><span className="faint small">Value</span><b style={{ color: 'var(--gold)' }}>{fmtUsd(totalValue)}</b></div>
        </div>
      )}

      {creating && (
        <div className="panel mt14 binder-new">
          <b className="small">📔 New binder</b>
          <div className="row mt8" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input
              autoFocus
              className="input"
              placeholder="Name it — “Trade Binder”, “Vintage”…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') create() }}
              style={{ flex: 1, minWidth: 140 }}
            />
            <div className="binder-accents" role="radiogroup" aria-label="Spine colour">
              {ACCENT_KEYS.map((k) => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={draftAccent === k}
                  aria-label={k}
                  title={k}
                  className={`binder-swatch${draftAccent === k ? ' on' : ''}`}
                  style={{ background: ACCENTS[k] }}
                  onClick={() => setDraftAccent(k)}
                />
              ))}
            </div>
          </div>
          <div className="row mt8" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="small ghost" onClick={() => { setCreating(false); setDraft('') }}>Cancel</button>
            <button className="primary small" disabled={busy} onClick={create}>Create binder</button>
          </div>
        </div>
      )}

      {binders.length === 0 ? (
        <div className="panel mt14">
          <EmptyState
            icon="📔"
            text="No binders yet"
            sub="A binder is where a pile of cards becomes a collection you can flip through. Make one, then drop cards in."
            action={creating ? undefined : { label: '+ New binder', onClick: () => setCreating(true) }}
          />
        </div>
      ) : (
        <div className="binder-shelf">
          {binders.map((b) => {
            const d = covers[b.id]
            const pages = d?.pages ?? Math.max(1, Math.ceil(b.cardCount / SLOTS_PER_PAGE))
            const cap = pages * SLOTS_PER_PAGE
            const free = Math.max(0, cap - b.cardCount)
            const pct = cap > 0 ? Math.min(1, b.cardCount / cap) : 0
            const peek = (d?.slots ?? []).slice(0, 4)
            return (
              <div
                key={b.id}
                className="binder-cover"
                style={{ '--accent': ACCENTS[b.accent] ?? ACCENTS.yellow } as React.CSSProperties}
                onClick={() => setOpenId(b.id)}
                title={`Open ${b.name}`}
              >
                <div className="binder-cover-spine" />
                <div className="binder-cover-body">
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <b className="binder-cover-name">📔 {b.name}</b>
                    <button className="small ghost binder-cover-kill" title="Delete this binder"
                      onClick={(e) => { e.stopPropagation(); destroy(b) }}>✕</button>
                  </div>
                  <div className="faint small">{b.cardCount} card{b.cardCount === 1 ? '' : 's'} · {pages} page{pages === 1 ? '' : 's'}</div>
                  <div className="binder-peek">
                    {peek.map((s) => (
                      <div key={s.inventory_id} className="binder-peek-cell">
                        <CardImg src={s.image_small} alt={s.name} cardId={s.card_id} />
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, 4 - peek.length) }, (_, i) => (
                      <div key={`gap-${i}`} className="binder-peek-cell is-empty" aria-hidden />
                    ))}
                  </div>
                  <div className="binder-fill" title={`${b.cardCount} of ${cap} pockets used`}>
                    <span style={{ width: `${pct * 100}%` }} />
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <span className="faint small">{free === 0 ? 'full — add another binder' : `${free} pocket${free === 1 ? '' : 's'} free`}</span>
                    <b className="small" style={{ color: 'var(--gold)' }}>{fmtUsd(b.value)}</b>
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

// ---------------------------------------------------------------------------

function BinderDetailV({ id, onBack, onChanged }: { id: number; onBack: () => void; onChanged: () => void }) {
  const { toast, openCard, density } = useStore()
  const [detail, setDetail] = useState<BinderDetail | null>(null)
  const [page, setPage] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQ, setPickerQ] = useState('')
  const [available, setAvailable] = useState<BinderAvailableRow[]>([])
  const [dragging, setDragging] = useState<{ page: number; slot: number } | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try { setDetail(await api.binderDetail(id)) } catch { /* keep */ }
  }, [id])

  useEffect(() => { load() }, [load])

  const loadAvailable = useCallback(async (q: string) => {
    try { setAvailable(await api.binderAvailable(q)) } catch { /* keep */ }
  }, [])

  useEffect(() => {
    if (!pickerOpen) return
    const t = setTimeout(() => loadAvailable(pickerQ), 180)
    return () => clearTimeout(t)
  }, [pickerQ, pickerOpen, loadAvailable])

  // Esc cancels an in-progress drag.
  useEffect(() => {
    if (!dragging) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDragging(null); setDragOver(null) } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [dragging])

  if (!detail) return <EmptyState icon="⏳" text="Loading binder…" />

  const { binder, slots } = detail
  const maxPage = Math.max(0, ...slots.map((s) => s.page), 0)
  const pageSlots = slots.filter((s) => s.page === page)
  const emptyOnPage = SLOTS_PER_PAGE - pageSlots.length

  const place = async (inventoryId: number, target?: { page: number; slot: number }) => {
    try {
      await api.binderPlace(id, inventoryId, target?.page, target?.slot)
      toast(target ? 'Moved' : 'Placed in binder', 'good')
      await load()
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Placement failed', 'bad')
    }
  }

  const remove = async (inventoryId: number) => {
    await api.binderRemove(id, inventoryId)
    toast('Removed from binder')
    await load()
    onChanged()
  }

  /** Drop a dragged card onto a pocket: moves it, or swaps if the pocket is occupied. */
  const dropOn = async (to: { page: number; slot: number }) => {
    const from = dragging
    setDragging(null)
    setDragOver(null)
    if (!from) return
    if (from.page === to.page && from.slot === to.slot) return
    try {
      const res = await api.binderMove(id, from, to)
      toast(res.swapped ? 'Swapped pockets' : 'Moved to new pocket', 'good')
      await load()
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Move failed', 'bad')
    }
  }

  /** Drop onto a page-flip control: relocate to the first free pocket of that page. */
  const dropOnPage = async (targetPage: number) => {
    const from = dragging
    if (!from || targetPage < 0) return
    const taken = new Set(slots.filter((s) => s.page === targetPage).map((s) => s.slot))
    const free = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((i) => !taken.has(i))
    if (free === undefined) { toast('That page is full', 'bad'); return }
    await dropOn({ page: targetPage, slot: free })
  }

  const updateMeta = async (patch: { name?: string; accent?: string }) => {
    await api.updateBinder(id, patch)
    await load()
    onChanged()
  }

  const flipTarget = (target: number) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragging || target < 0 || target > maxPage) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      e.currentTarget.classList.add('drag-over')
    },
    onDragLeave: (e: React.DragEvent) => e.currentTarget.classList.remove('drag-over'),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); dropOnPage(target) },
  })

  return (
    <div>
      <div className="page-head binder-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <button className="ghost small" onClick={onBack}>← All binders</button>
          <div className="binder-title-row">
            {renaming ? (
              <>
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  autoFocus
                  className="input"
                  style={{ flex: 1, minWidth: 120 }}
                  onKeyDown={async (e) => {
                    if (e.key === 'Escape') { setRenaming(false); return }
                    if (e.key === 'Enter') { await updateMeta({ name: nameDraft }); setRenaming(false) }
                  }}
                />
                <button className="small primary" onClick={async () => { await updateMeta({ name: nameDraft }); setRenaming(false) }}>Save</button>
              </>
            ) : (
              <h1
                onClick={() => { setNameDraft(binder.name); setRenaming(true) }}
                style={{ cursor: 'pointer', minWidth: 0, overflowWrap: 'anywhere' }}
                title="Click to rename"
              >📔 {binder.name} <span className="faint small">✎</span></h1>
            )}
          </div>
          <div className="binder-accents" role="radiogroup" aria-label="Spine colour">
            <span className="faint small" style={{ marginRight: 2 }}>spine</span>
            {ACCENT_KEYS.map((key) => (
              <button
                key={key}
                role="radio"
                aria-checked={binder.accent === key}
                aria-label={key}
                title={`${key} spine`}
                className={`binder-swatch${binder.accent === key ? ' on' : ''}`}
                style={{ background: ACCENTS[key] }}
                onClick={() => updateMeta({ accent: key })}
              />
            ))}
          </div>
          <div className="sub">
            {detail.cardCount} card{detail.cardCount === 1 ? '' : 's'} · {detail.pages} page{detail.pages === 1 ? '' : 's'} · value {fmtUsd(detail.value)}
          </div>
        </div>
        <button className="primary" onClick={() => { setPickerOpen(true); setTimeout(() => searchRef.current?.focus(), 50) }}>+ Add cards</button>
      </div>

      {dragging && (
        <div className="binder-drag-hint">
          <span className="badge warn">Drop on a pocket to move it — or on ‹ › to send it to another page</span>
          <button className="small ghost" onClick={() => { setDragging(null); setDragOver(null) }}>Cancel</button>
        </div>
      )}

      <div className="binder-book" style={{ '--accent': ACCENTS[binder.accent] ?? ACCENTS.yellow } as React.CSSProperties}>
        <div className="binder-page" key={page}>
          <div className="binder-pockets">
            {Array.from({ length: SLOTS_PER_PAGE }, (_, i) => {
              const s = pageSlots.find((x) => x.slot === i)
              const pos = { page, slot: i }
              return (
                <Pocket
                  key={i}
                  slotData={s}
                  dragging={dragging !== null}
                  isDragOver={dragOver === `${page}:${i}`}
                  onDragStart={() => setDragging(pos)}
                  onDragEnd={() => { setDragging(null); setDragOver(null) }}
                  onDragOverPocket={() => setDragOver(`${page}:${i}`)}
                  onDragLeavePocket={() => setDragOver(null)}
                  onDropPocket={() => dropOn(pos)}
                  onClick={() => { if (s && !dragging) openCard(s.card_id) }}
                  onRemove={() => s && remove(s.inventory_id)}
                />
              )
            })}
          </div>
        </div>

        <div className="binder-nav">
          <button className="binder-flip" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} {...flipTarget(page - 1)} title="Previous page">‹</button>
          <div className="binder-page-num">
            Page {page + 1} / {Math.max(1, maxPage + 1)}
            <span>{pageSlots.length}/{SLOTS_PER_PAGE} pockets</span>
          </div>
          <button className="binder-flip" disabled={page >= maxPage} onClick={() => setPage((p) => Math.min(maxPage, p + 1))} {...flipTarget(page + 1)} title="Next page">›</button>
        </div>
      </div>

      <div className="faint small mt8" style={{ textAlign: 'center' }}>
        {emptyOnPage > 0
          ? `${emptyOnPage} empty pocket${emptyOnPage === 1 ? '' : 's'} on this page — Add cards drops straight into the first one.`
          : 'This page is full. Flip on to the next one, or add another binder.'}
      </div>

      {/* Card picker modal */}
      {pickerOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setPickerOpen(false) }}>
          <div className="modal" style={{ width: 'min(860px, 96vw)' }}>
            <div className="modal-head">
              <h2>Add cards to {binder.name}</h2>
              <button className="ghost" onClick={() => setPickerOpen(false)}>✕</button>
            </div>
            <div className="row" style={{ marginBottom: 12 }}>
              <input ref={searchRef} type="search" placeholder="Search your un-slotted cards…" value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} style={{ flex: 1 }} />
              <DensityToggle />
            </div>
            {available.length === 0 ? (
              <EmptyState icon="🗃" text="Nothing to add" sub="Every raw card is already in a binder." />
            ) : (
              <div className={`card-grid ${density !== 'comfortable' ? `density-${density}` : ''}`} style={{ maxHeight: '52vh', overflowY: 'auto' }}>
                {available.map((a) => (
                  <div key={a.id} className="card-cell" onClick={() => place(a.id).then(() => setAvailable((rows) => rows.filter((r) => r.id !== a.id)))}>
                    <CardImg src={a.image_small} alt={a.name} cardId={a.card_id} />
                    <div className="card-meta">
                      <div className="nm">{a.name}</div>
                      <div className="st">{a.set_name} · {a.condition}</div>
                      <div className="card-row-between">
                        <span className="price small">{fmtUsd(a.value)}</span>
                        <span className="badge">add +</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Pocket({ slotData, dragging, isDragOver, onDragStart, onDragEnd, onDragOverPocket, onDragLeavePocket, onDropPocket, onClick, onRemove }: {
  slotData?: BinderSlot
  dragging: boolean
  isDragOver: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDragOverPocket: () => void
  onDragLeavePocket: () => void
  onDropPocket: () => void
  onClick: () => void
  onRemove: () => void
}) {
  const acceptDrop = (e: React.DragEvent) => { if (dragging) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; onDragOverPocket() } }
  if (!slotData) {
    return (
      <div
        className={`binder-pocket empty ${dragging ? 'move-target' : ''} ${isDragOver ? 'drag-over' : ''}`}
        onDragOver={acceptDrop}
        onDragLeave={onDragLeavePocket}
        onDrop={(e) => { e.preventDefault(); onDropPocket() }}
        onClick={onClick}
      >
        {isDragOver ? '⬇' : ''}
      </div>
    )
  }
  return (
    <div
      className={`binder-pocket filled ${dragging && !isDragOver ? 'drag-source' : ''} ${isDragOver ? 'drag-over' : ''}`}
      onClick={onClick}
      onDragOver={acceptDrop}
      onDragLeave={onDragLeavePocket}
      onDrop={(e) => { e.preventDefault(); onDropPocket() }}
    >
      <div className="binder-pocket-art">
        <div className="binder-drag-handle" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title="Drag to another pocket">
          <CardImg src={slotData.image_small} alt={slotData.name} cardId={slotData.card_id} />
        </div>
      </div>
      <div className="binder-pocket-label">
        <span className="binder-pocket-name">{slotData.name}</span>
        <span className="binder-pocket-value">{fmtUsd(slotData.value)}</span>
      </div>
      <div className="binder-pocket-actions" onClick={(e) => e.stopPropagation()}>
        <button className="small ghost" title="Remove" onClick={onRemove}>✕</button>
      </div>
    </div>
  )
}
