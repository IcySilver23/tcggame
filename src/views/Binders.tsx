import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type BinderAvailableRow, type BinderDetail, type BinderSlot, type BinderSummary } from '../api'
import { useStore } from '../store'
import { CardImg, DensityToggle, EmptyState, fmtUsd } from '../components'

const SLOTS_PER_PAGE = 9
// Stored per binder, so the KEYS are save data — only the swatch values are
// themed (var(--blue) darkens in the dark theme).
const ACCENTS: Record<string, string> = {
  yellow: '#ffcb05', blue: 'var(--blue)', red: '#ff5d5d', green: '#2ee6a8', purple: '#a78bfa',
}

export function BindersView() {
  const { toast } = useStore()
  const [binders, setBinders] = useState<BinderSummary[]>([])
  const [openId, setOpenId] = useState<number | null>(null)

  const load = useCallback(() => api.binders().then(setBinders).catch(() => {}), [])
  useEffect(() => { load() }, [load])

  const create = async () => {
    const name = prompt('Binder name?')?.trim()
    if (!name) return
    await api.createBinder(name, 'yellow')
    toast(`Binder "${name}" created`, 'good')
    load()
  }

  if (openId != null) {
    return <BinderDetailV id={openId} onBack={() => { setOpenId(null); load() }} onChanged={load} />
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Binders</h1>
          <div className="sub">Organize your collection into physical-feeling 9-pocket binders.</div>
        </div>
        <button className="primary" onClick={create}>+ New Binder</button>
      </div>

      {binders.length === 0 ? (
        <EmptyState icon="📔" text="No binders yet" sub="Create one and start filling pockets." />
      ) : (
        <div className="grid cols3">
          {binders.map((b) => (
            <div key={b.id} className="panel" style={{ margin: 0, cursor: 'pointer', borderTop: `3px solid ${ACCENTS[b.accent] ?? ACCENTS.yellow}` }} onClick={() => setOpenId(b.id)}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2>📔 {b.name}</h2>
                <span className="badge">{b.cardCount} cards</span>
              </div>
              <div className="row mt8" style={{ justifyContent: 'space-between' }}>
                <span className="muted small">Value {fmtUsd(b.value)}</span>
                <button className="small ghost" onClick={async (e) => {
                  e.stopPropagation()
                  if (!confirm(`Delete binder "${b.name}"? Cards return to your collection.`)) return
                  await api.deleteBinder(b.id)
                  toast('Binder deleted — cards kept')
                  load()
                }}>Delete</button>
              </div>
            </div>
          ))}
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

  /** Drop onto a page-flip arrow: relocate to the first free pocket of that page. */
  const dropOnPage = async (targetPage: number) => {
    const from = dragging
    if (!from) return
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

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="ghost small" onClick={onBack}>← All binders</button>
          <div className="row mt8" style={{ gap: 10 }}>
            {renaming ? (
              <>
                <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus
                  onKeyDown={async (e) => { if (e.key === 'Enter') { await updateMeta({ name: nameDraft }); setRenaming(false) } }} />
                <button className="small primary" onClick={async () => { await updateMeta({ name: nameDraft }); setRenaming(false) }}>Save</button>
              </>
            ) : (
              <h1 onClick={() => { setNameDraft(binder.name); setRenaming(true) }} style={{ cursor: 'pointer' }} title="Click to rename">
                📔 {binder.name} <span className="faint small">✎</span>
              </h1>
            )}
            {Object.entries(ACCENTS).map(([key, color]) => (
              <span key={key} onClick={() => updateMeta({ accent: key })}
                style={{ width: 16, height: 16, borderRadius: '50%', background: color, cursor: 'pointer', opacity: binder.accent === key ? 1 : 0.35, border: '2px solid transparent', outline: binder.accent === key ? `2px solid ${color}` : 'none' }} />
            ))}
          </div>
          <div className="sub">{detail.cardCount} cards · {detail.pages} page{detail.pages === 1 ? '' : 's'} · value {fmtUsd(detail.value)}</div>
        </div>
        <div className="row">
          <button className="primary" onClick={() => { setPickerOpen(true); setTimeout(() => searchRef.current?.focus(), 50) }}>+ ADD CARDS</button>
          {dragging && <span className="badge warn">Drop the card on a pocket — Esc to cancel</span>}
        </div>
      </div>

      {/* Binder page */}
      <div className="binder-book" style={{ '--accent': ACCENTS[binder.accent] ?? ACCENTS.yellow } as React.CSSProperties}>
        <button className="binder-flip flip-prev" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
          onDragOver={(e) => { if (page > 0 && dragging) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('drag-over') } }}
          onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); dropOnPage(page - 1) }}>‹</button>

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
          <div className="binder-page-num">Page {page + 1} / {Math.max(1, maxPage + 1)}</div>
        </div>

        <button className="binder-flip flip-next" disabled={page >= maxPage} onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
          onDragOver={(e) => { if (page < maxPage && dragging) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('drag-over') } }}
          onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); dropOnPage(page + 1) }}>›</button>
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
      <div className="binder-drag-handle" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title="Drag to another pocket">
        <CardImg src={slotData.image_small} alt={slotData.name} cardId={slotData.card_id} />
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
