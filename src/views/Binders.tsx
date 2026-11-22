import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type BinderAvailableRow, type BinderCover, type BinderDetail, type BinderSlot, type BinderSummary } from '../api'
import { useStore } from '../store'
import { CardImg, DensityToggle, EmptyState, fmtUsd, LoadFailure } from '../components'

// ---------------------------------------------------------------------------
// Binders — the physical half of the collection.
//
// Two states, one verb: put cards in pockets and flip through them.
//
// The shelf shows CLOSED BINDERS: a board with a spine down the left, hinges,
// the cover stock you chose, a paper title label and the page block on the
// right edge. Opening one shows a real spread — two 3×3 pages around a ring
// spine — with the page controls under it. Covers are earned by filling
// binders (the server owns the unlock rule), not bought.
// ---------------------------------------------------------------------------

const SLOTS_PER_PAGE = 9
// Stored per binder, so the KEYS are save data — only the swatch values are
// themed (var(--blue) darkens in the dark theme).
const ACCENTS: Record<string, string> = {
  yellow: '#ffcb05', blue: 'var(--blue)', red: '#ff5d5d', green: '#2ee6a8', purple: '#a78bfa',
}
const ACCENT_KEYS = Object.keys(ACCENTS)

const PAGE_SLOTS = Array.from({ length: SLOTS_PER_PAGE }, (_, i) => i)

/** The cover catalogue plus the slotted count that unlocks it. */
function useCoverCatalog() {
  const [cat, setCat] = useState<{ covers: BinderCover[]; slotted: number } | null>(null)
  const reload = useCallback(() => {
    api.binderCovers().then(setCat).catch(() => {})
  }, [])
  useEffect(() => { reload() }, [reload])
  return { cat, reload }
}

/** A row of cover stocks. Locked ones say what earns them, and the server
 *  enforces the same rule on both create and update. */
function CoverPicker({ cat, value, onPick, busy }: {
  cat: { covers: BinderCover[]; slotted: number } | null
  value: string
  onPick: (id: string) => void
  busy?: boolean
}) {
  if (!cat) return <div className="faint small">Checking the cover stock…</div>
  return (
    <div className="binder-covers" role="radiogroup" aria-label="Cover stock">
      {cat.covers.map((c) => {
        const locked = cat.slotted < c.unlockAt
        return (
          <button
            key={c.id}
            role="radio"
            aria-checked={value === c.id}
            disabled={locked || busy}
            className={`binder-cover-opt cover-${c.id}${value === c.id ? ' on' : ''}${locked ? ' locked' : ''}`}
            title={locked
              ? `${c.label} — unlocks at ${c.unlockAt} cards in binders (you have ${cat.slotted})`
              : `${c.label} — ${c.blurb}`}
            onClick={() => onPick(c.id)}
          >
            <span className="bco-face" aria-hidden>{locked ? '🔒' : c.special ? '★' : ''}</span>
            <span className="bco-label">{c.label}</span>
            {locked && <span className="bco-lock">{c.unlockAt}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function BindersView() {
  const { toast } = useStore()
  const [binders, setBinders] = useState<BinderSummary[]>([])
  // One detail read per binder so the shelf can show a real peek and a real
  // fill meter — the summary only carries counts, not what's in the pockets.
  const [covers, setCovers] = useState<Record<number, BinderDetail>>({})
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftAccent, setDraftAccent] = useState('yellow')
  const [draftCover, setDraftCover] = useState('vinyl')
  const [busy, setBusy] = useState(false)

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const { cat, reload: reloadCovers } = useCoverCatalog()

  const load = useCallback(async () => {
    // A failed shelf read used to become an empty array, which rendered the
    // "No binders yet" invitation over binders that still existed.
    const rows = await api.binders().catch(() => null)
    if (!rows) { setStatus((s) => (s === 'ready' ? s : 'error')); return }
    setBinders(rows)
    setStatus('ready')
    reloadCovers()
    // Every binder, not the first twelve: a capped slice made binder 13 and up
    // silently lose its peek and its page count on the shelf.
    const pairs = await Promise.all(
      rows.map(async (b) => {
        const d = await api.binderDetail(b.id).catch(() => null)
        return [b.id, d] as const
      }),
    )
    const next: Record<number, BinderDetail> = {}
    for (const [id, d] of pairs) if (d) next[id] = d
    setCovers(next)
  }, [reloadCovers])

  useEffect(() => { load() }, [load])

  const create = async () => {
    const name = draft.trim()
    if (!name) { toast('Name the binder first', 'bad'); return }
    setBusy(true)
    try {
      const b = await api.createBinder(name, draftAccent, draftCover)
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
    return <BinderDetailV id={openId} cat={cat} onCovers={reloadCovers} onBack={() => { setOpenId(null); load() }} onChanged={load} />
  }

  // Summed from the shelf rows, not from /api/state: a binding or a removal
  // has to move this number immediately, and the shelf is what just reloaded.
  const slotted = binders.reduce((n, b) => n + b.cardCount, 0)
  const totalValue = binders.reduce((n, b) => n + b.value, 0)

  return (
    <div>
      <div className="page-head desk">
        <div className="ph-id">
          <span className="ph-mark" aria-hidden>📒</span>
          <div style={{ minWidth: 0 }}>
            <h1>Binders</h1>
            <div className="sub">Nine pockets a page, two pages a spread. Pick the cover, fill the pockets, flip through the book.</div>
          </div>
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
          <div className="mt8">
            <span className="faint small" style={{ letterSpacing: 1 }}>COVER</span>
            <CoverPicker cat={cat} value={draftCover} onPick={setDraftCover} />
          </div>
          <div className="row mt8" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="small ghost" onClick={() => { setCreating(false); setDraft('') }}>Cancel</button>
            <button className="primary small" disabled={busy} onClick={create}>Create binder</button>
          </div>
        </div>
      )}

      {status === 'error' && binders.length === 0 ? (
        <div className="panel mt14">
          <LoadFailure what="your binders" sub="The binder shelf did not load. Nothing was changed." onRetry={load} />
        </div>
      ) : binders.length === 0 ? (
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
            const peek = (d?.slots ?? []).slice(0, 3)
            const stock = cat?.covers.find((c) => c.id === b.cover)
            return (
              <div
                key={b.id}
                className={`binder-cover cover-${b.cover ?? 'vinyl'}${stock?.special ? ' special' : ''}`}
                style={{ '--accent': ACCENTS[b.accent] ?? ACCENTS.yellow } as React.CSSProperties}
                onClick={() => setOpenId(b.id)}
                title={`Open ${b.name} — ${stock?.label ?? 'vinyl'}`}
              >
                <div className="binder-cover-spine" aria-hidden>
                  <span className="binder-spine-rings" />
                  <b className="binder-spine-text">{b.name}</b>
                </div>
                <div className="binder-cover-body">
                  <div className="binder-cover-label">
                    <b>{b.name}</b>
                    <span className="faint small">{b.cardCount} card{b.cardCount === 1 ? '' : 's'} · {pages} page{pages === 1 ? '' : 's'} · {stock?.label ?? 'black vinyl'}</span>
                  </div>
                  <div className="binder-peek">
                    {peek.map((s) => (
                      <div key={s.inventory_id} className="binder-peek-cell">
                        <CardImg src={s.image_small} alt={s.name} cardId={s.card_id} />
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, 3 - peek.length) }, (_, i) => (
                      <div key={`gap-${i}`} className="binder-peek-cell is-empty" aria-hidden />
                    ))}
                  </div>
                  <div className="binder-cover-foot">
                    <div className="binder-fill" title={`${b.cardCount} of ${cap} pockets used`}>
                      <span style={{ width: `${pct * 100}%` }} />
                    </div>
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <span className="faint small">{free === 0 ? 'full — add another binder' : `${free} pocket${free === 1 ? '' : 's'} free`}</span>
                      <b className="small" style={{ color: 'var(--gold)' }}>{fmtUsd(b.value)}</b>
                    </div>
                  </div>
                  {stock?.special && <span className="binder-sheen" aria-hidden />}
                  <button
                    className="small ghost binder-cover-kill"
                    title="Delete this binder"
                    onClick={(e) => { e.stopPropagation(); destroy(b) }}
                  >✕</button>
                </div>
                <div className="binder-cover-edges" aria-hidden />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function BinderDetailV({ id, cat, onCovers, onBack, onChanged }: {
  id: number
  cat: { covers: BinderCover[]; slotted: number } | null
  onCovers: () => void
  onBack: () => void
  onChanged: () => void
}) {
  const { toast, openCard, density } = useStore()
  const [detail, setDetail] = useState<BinderDetail | null>(null)
  // A spread is TWO pages: left = 2·spread, right = 2·spread + 1.
  const [spread, setSpread] = useState(0)
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
  const pageCount = Math.max(1, maxPage + 1)
  const leftPage = spread * 2
  const rightPage = leftPage + 1
  // The open spread always shows two pages, so the count has to include the
  // blank right-hand sheet of a one-page binder.
  const shownPages = Math.max(pageCount, rightPage + 1)
  const spreadCount = Math.max(1, Math.ceil(shownPages / 2))
  const slotsOn = (p: number) => slots.filter((s) => s.page === p)
  const freeOnPage = (p: number) => PAGE_SLOTS.filter((i) => !slots.some((s) => s.page === p && s.slot === i))
  const stock = cat?.covers.find((c) => c.id === binder.cover)

  const place = async (inventoryId: number, target?: { page: number; slot: number }) => {
    try {
      const res = await api.binderPlace(id, inventoryId, target?.page, target?.slot)
      toast(target ? 'Moved' : 'Placed in binder', 'good')
      // Follow the card: a new placement can land on a page you cannot see.
      if (res && typeof res.page === 'number') setSpread(Math.floor(res.page / 2))
      await load()
      onChanged()
      onCovers()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Placement failed', 'bad')
    }
  }

  const remove = async (inventoryId: number) => {
    await api.binderRemove(id, inventoryId)
    toast('Removed from binder')
    await load()
    onChanged()
    onCovers()
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

  /** The arrows move a whole spread, so a dropped card takes the first gap in it. */
  const dropOnSpread = async (target: number) => {
    if (!dragging) return
    if (target < 0) return
    const first = target * 2
    const gap = freeOnPage(first)[0]
    if (gap !== undefined) { await dropOn({ page: first, slot: gap }); return }
    const second = freeOnPage(first + 1)[0]
    if (second !== undefined) { await dropOn({ page: first + 1, slot: second }); return }
    toast('Both pages of that spread are full', 'bad')
  }

  const updateMeta = async (patch: { name?: string; accent?: string; cover?: string }) => {
    try {
      await api.updateBinder(id, patch)
      await load()
      onChanged()
      onCovers()
      if (patch.cover) toast(`Cover changed to ${cat?.covers.find((c) => c.id === patch.cover)?.label ?? patch.cover}`, 'good')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change the binder', 'bad')
    }
  }

  const flipTarget = (target: number) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragging || target < 0 || target >= spreadCount) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      e.currentTarget.classList.add('drag-over')
    },
    onDragLeave: (e: React.DragEvent) => e.currentTarget.classList.remove('drag-over'),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); dropOnSpread(target) },
  })

  const pageSheet = (pageNo: number) => {
    const onPage = slotsOn(pageNo)
    const beyond = pageNo > maxPage
    return (
      <div className={`binder-page${beyond ? ' blank' : ''}`} key={`p${pageNo}`}>
        <div className="binder-page-tag">
          Page {pageNo + 1}
          <span>{onPage.length}/{SLOTS_PER_PAGE}</span>
        </div>
        <div className="binder-pockets">
          {PAGE_SLOTS.map((i) => {
            const s = onPage.find((x) => x.slot === i)
            const pos = { page: pageNo, slot: i }
            return (
              <Pocket
                key={i}
                slotData={s}
                dragging={dragging !== null}
                isDragOver={dragOver === `${pageNo}:${i}`}
                onDragStart={() => setDragging(pos)}
                onDragEnd={() => { setDragging(null); setDragOver(null) }}
                onDragOverPocket={() => setDragOver(`${pageNo}:${i}`)}
                onDragLeavePocket={() => setDragOver(null)}
                onDropPocket={() => dropOn(pos)}
                onClick={() => { if (s && !dragging) openCard(s.card_id) }}
                onRemove={() => s && remove(s.inventory_id)}
              />
            )
          })}
        </div>
      </div>
    )
  }

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
            {detail.cardCount} card{detail.cardCount === 1 ? '' : 's'} · {pageCount} page{pageCount === 1 ? '' : 's'}
            {' · '}{stock?.label ?? 'black vinyl'} cover · value {fmtUsd(detail.value)}
          </div>
          <div className="mt8">
            <span className="faint small" style={{ letterSpacing: 1 }}>COVER</span>
            <CoverPicker cat={cat} value={binder.cover ?? 'vinyl'} onPick={(cover) => updateMeta({ cover })} />
          </div>
        </div>
        <button className="primary" onClick={() => { setPickerOpen(true); setTimeout(() => searchRef.current?.focus(), 50) }}>+ Add cards</button>
      </div>

      {dragging && (
        <div className="binder-drag-hint">
          <span className="badge warn">Drop on a pocket to move it — or on ‹ › to send it to another spread</span>
          <button className="small ghost" onClick={() => { setDragging(null); setDragOver(null) }}>Cancel</button>
        </div>
      )}

      <div
        className={`binder-book cover-${binder.cover ?? 'vinyl'}${stock?.special ? ' special' : ''}`}
        style={{ '--accent': ACCENTS[binder.accent] ?? ACCENTS.yellow } as React.CSSProperties}
      >
        <div className="binder-spread" key={spread}>
          {pageSheet(leftPage)}
          <div className="binder-rings" aria-hidden>
            <span /><span /><span /><span /><span />
          </div>
          {pageSheet(rightPage)}
        </div>

        <div className="binder-nav">
          <button className="binder-flip" disabled={spread === 0} onClick={() => setSpread((s) => Math.max(0, s - 1))} {...flipTarget(spread - 1)} title="Previous spread">‹</button>
          <div className="binder-page-num">
            Pages {leftPage + 1}–{rightPage + 1} / {shownPages}
            <span>{slotsOn(leftPage).length + slotsOn(rightPage).length}/{SLOTS_PER_PAGE * 2} pockets on this spread · {spreadCount} spread{spreadCount === 1 ? '' : 's'}</span>
          </div>
          <button className="binder-flip" disabled={spread >= spreadCount - 1} onClick={() => setSpread((s) => Math.min(spreadCount - 1, s + 1))} {...flipTarget(spread + 1)} title="Next spread">›</button>
        </div>
      </div>

      <div className="faint small mt8" style={{ textAlign: 'center' }}>
        {(freeOnPage(leftPage).length + freeOnPage(rightPage).length) > 0
          ? `${freeOnPage(leftPage).length + freeOnPage(rightPage).length} empty pocket${(freeOnPage(leftPage).length + freeOnPage(rightPage).length) === 1 ? '' : 's'} on this spread — Add cards drops straight into the first one, and the book follows the card.`
          : 'This spread is full. Flip on, or drop a card on › to start the next page.'}
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
              <div className={`card-grid binder-picker ${density !== 'comfortable' ? `density-${density}` : ''}`} style={{ maxHeight: '52vh', overflowY: 'auto' }}>
                {available.map((a) => (
                  // CardImg's wrapper opens the card on click; capture here so a
                  // tile means "add" wherever in the tile it is clicked.
                  <div
                    key={a.id}
                    className="card-cell"
                    onClickCapture={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      place(a.id).then(() => setAvailable((rows) => rows.filter((r) => r.id !== a.id)))
                    }}
                  >
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
