import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { ForumSection, ForumGroupBuy, ForumPost } from '../api'
import { useStore } from '../store'
import { EmptyState, fmtUsd, timeAgo } from '../components'

// ---------------------------------------------------------------------------
// 🫂 The community scene — the local collector forum. Where the street layer
// (auth) punishes passing fakes, this is the positive half of the same social
// layer: post pulls, answer newbies, write guides, and a standing score
// accrues that the rest of the scene actually reads. Standing unlocks real
// privileges — group-buys (10), estate first-refusal DMs (25), ship-first
// trade trust (40) — and the street's conviction flag bleeds in: gains halve
// while suspicion is up, and this page says so out loud.
// ---------------------------------------------------------------------------

const TIER_META: Record<ForumSection['tier'], { label: string; color: string; blurb: string }> = {
  lurker: { label: 'Lurker', color: 'var(--text-faint)', blurb: 'You read more than you post. The room has not noticed you yet.' },
  regular: { label: 'Regular', color: 'var(--accent, #9db4ff)', blurb: 'Faces nod when you show up at meets now.' },
  known: { label: 'Known', color: 'var(--gold)', blurb: 'People ask your opinion before they buy.' },
  trusted: { label: 'Trusted', color: 'var(--green)', blurb: 'The scene vouches for you unprompted.' },
  pillar: { label: 'Pillar', color: '#ffd700', blurb: 'You ARE the local scene. Newbies are told to find your posts first.' },
}

const KIND_META: Record<ForumPost['kind'], { icon: string; label: string }> = {
  pull: { icon: '📸', label: 'Pull' },
  guide: { icon: '📚', label: 'Guide' },
  reply: { icon: '💬', label: 'Answer' },
}

// Mirrors the server's GROUPBUY_POOL (the server validates the id — this is
// just the storefront for it).
const POOL: { cardId: string; name: string; flavor: string }[] = [
  { cardId: 'ecard2-149', name: 'Lugia', flavor: 'The forum\u2019s grail — the room has been hunting it for months' },
  { cardId: 'swsh4-181', name: 'Beauty', flavor: 'The chase card everyone pretends not to care about' },
  { cardId: 'base1-4', name: 'Charizard', flavor: 'The classic. Somebody always bites' },
  { cardId: 'neo1-7', name: 'Typhlosion', flavor: 'The mid-budget favorite — real card, real money, no drama' },
]

type Tab = 'threads' | 'post' | 'standing' | 'cobuys'
type Filter = 'all' | 'pull' | 'guide' | 'reply'

function RepBar({ rep, nextAt }: { rep: number; nextAt: number | null }) {
  return (
    <div className="rep-bar">
      <div className="rep-fill" style={{ width: `${Math.max(1.5, rep)}%` }} />
      {nextAt != null && <div className="rep-tick" style={{ left: `${nextAt}%` }} title={`${nextAt} standing`} />}
    </div>
  )
}

function ThreadRow({
  p,
  open,
  pinned,
  onOpen,
}: {
  p: ForumPost
  open: boolean
  pinned: boolean
  onOpen: () => void
}) {
  const k = KIND_META[p.kind] ?? KIND_META.reply
  const heat = Math.min(3, p.warmth)
  return (
    <button className={`thread${open ? ' open' : ''}`} onClick={onOpen} aria-expanded={open}>
      <span className={`thread-avatar kind-${p.kind}`}>{k.icon}</span>
      <span className="thread-body">
        <span className="thread-title">
          {pinned && <span className="thread-pin">📌 </span>}
          {p.title}
        </span>
        <span className="thread-meta">
          <span className={`thread-tag kind-${p.kind}`}>{k.label}</span>
          {p.cardName && <span className="thread-card">🃏 {p.cardName}</span>}
          <span>you · {timeAgo(p.createdAt)}</span>
          {open && <span className="thread-open-note">· expanded</span>}
        </span>
        {open && (
          <span className="thread-snippet">
            {p.body ?? 'No body on this one — just the headline and the photos.'}
          </span>
        )}
      </span>
      <span className="thread-vote" title={`${p.warmth} warmth`}>
        <b>{p.warmth > 0 ? '🔥'.repeat(heat) : '·'}</b>
        <span>{p.warmth > 0 ? `${p.warmth} heat` : 'quiet'}</span>
      </span>
    </button>
  )
}

function PerkRow({ at, icon, name, effect, open }: { at: number; icon: string; name: string; effect: string; open: boolean }) {
  return (
    <div className="pf-row" style={{ opacity: open ? 1 : 0.62 }}>
      <div className="pf-row-main">
        <b className="pf-row-name" style={{ color: open ? 'var(--green)' : undefined }}>
          {open ? icon : '🔒'} {name}
        </b>
        <div className="faint small">{effect}</div>
      </div>
      <div className="pf-row-nums">
        {open ? (
          <span className="badge" style={{ fontSize: 9, padding: '1px 6px', color: 'var(--green)', borderColor: 'var(--green)' }}>OPEN</span>
        ) : (
          <span className="small" style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{at}</span>
        )}
      </div>
    </div>
  )
}

function BuyRow({ b }: { b: ForumGroupBuy }) {
  const landed = b.status === 'filled'
  return (
    <div className="pf-row">
      <div className="pf-row-main">
        <b className="pf-row-name">{b.cardName} · {b.splitN}-way split</b>
        <div className="faint small">
          Lot {fmtUsd(b.totalCost)} · your share {fmtUsd(b.myShare)} paid · lands in ~{b.etaDays} day{b.etaDays === 1 ? '' : 's'}
        </div>
      </div>
      <div className="pf-row-nums">
        <span className="badge" style={{ fontSize: 9, padding: '1px 6px' }}>{landed ? '📬 boxing up' : '🚚 gathering'}</span>
      </div>
    </div>
  )
}

export function ForumView() {
  const toast = useStore((s) => s.toast)
  const refreshState = useStore((s) => s.refreshState)
  const [s, setS] = useState<ForumSection | null>(null)
  const [collection, setCollection] = useState<{ id: number; label: string; name: string }[]>([])
  const [pullId, setPullId] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tab>('threads')
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<number | null>(null)

  const load = () => api.forum().then(setS).catch(() => {})
  useEffect(() => {
    load()
    api.inventory()
      .then((rows) =>
        setCollection(
          rows
            .filter((r) => r.status === 'collection' && !r.graded_grade)
            .sort((a, b) => b.cost_basis - a.cost_basis)
            .map((r) => ({ id: r.id as number, label: `${r.name} (${r.condition}${r.favorite ? ' · ♥' : ''})`, name: r.name })),
        ),
      )
      .catch(() => {})
  }, [])

  const run = async (fn: () => Promise<any>, onOk: (r: any) => void) => {
    setBusy(true)
    try {
      const r = await fn()
      if (r.ok !== false) onOk(r)
      else toast(r.error ?? 'The forum is not interested', 'bad')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Post failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const posts = s?.posts ?? []
  const counts = useMemo(
    () => ({
      all: posts.length,
      pull: posts.filter((p) => p.kind === 'pull').length,
      guide: posts.filter((p) => p.kind === 'guide').length,
      reply: posts.filter((p) => p.kind === 'reply').length,
    }),
    [posts],
  )
  const shown = filter === 'all' ? posts : posts.filter((p) => p.kind === filter)
  const pinnedId = (posts.find((p) => p.kind === 'guide' && p.warmth >= 2) ?? ({} as ForumPost)).id
  const selected = collection.find((c) => String(c.id) === pullId)
  const tier = s ? TIER_META[s.tier] : null

  return (
    <div>
      <div className="page-head desk">
        <div className="ph-id">
          <span className="ph-mark" aria-hidden>💬</span>
          <div style={{ minWidth: 0 }}>
            <h1>Community</h1>
            <div className="sub">The local collector forum. Post pulls, answer newbies, write guides — standing here unlocks real privileges around town.</div>
          </div>
        </div>
      </div>

      <div className="forum-mast">
        <div className="forum-mast-icon">🫂</div>
        <div className="forum-mast-main">
          <div className="forum-mast-name">The Binder Board</div>
          <div className="forum-mast-tag">
            the local sub · {posts.length} thread{posts.length === 1 ? '' : 's'} on the board
            {s && s.deliveredBuys > 0 ? ` · ${s.deliveredBuys} co-buys delivered` : ''}
          </div>
        </div>
        {s && tier && (
          <span className="forum-mast-tier" style={{ color: tier.color }}>
            {tier.label} {s.rep.toFixed(1)}
          </span>
        )}
      </div>

      {s && s.streetHot && (
        <div className="forum-alert">
          🚨 Street gossip reached the board — <b>rep gains are HALVED</b> while suspicion is up. Lay low, let it fade.
        </div>
      )}

      {s && repHint(s) && tab === 'threads' && (
        <div className="forum-help">
          Lurking is free, standing is earned: <b>post a pull</b>, <b>answer newbies</b> (3/day), <b>write a guide</b> (1/day).
          Code {s.thresholds.groupBuy} opens co-buys, {s.thresholds.firstRefusal} estate first-refusal, {s.thresholds.shipFirst} ship-first trades.
        </div>
      )}

      <div className="seg-bar" role="tablist" aria-label="Community modes">
        <button role="tab" aria-selected={tab === 'threads'} className={`seg-item${tab === 'threads' ? ' on' : ''}`}
          title="The board — every thread you have posted" onClick={() => setTab('threads')}>
          🗂 Threads<span className="seg-count">{posts.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'post'} className={`seg-item${tab === 'post' ? ' on' : ''}`}
          title="Compose — pulls, answers and guides" onClick={() => setTab('post')}>
          ✍️ Post
        </button>
        <button role="tab" aria-selected={tab === 'standing'} className={`seg-item${tab === 'standing' ? ' on' : ''}`}
          title="Your standing and the perk ladder" onClick={() => setTab('standing')}>
          🏅 Standing<span className="seg-count">{s ? s.rep.toFixed(0) : 0}</span>
        </button>
        <button role="tab" aria-selected={tab === 'cobuys'} className={`seg-item${tab === 'cobuys' ? ' on' : ''}`}
          title="Co-buys — the room splits a big lot with you" onClick={() => setTab('cobuys')}>
          🫂 Co-buys<span className="seg-count">{s?.groupBuyList.length ?? 0}</span>
        </button>
      </div>

      {tab === 'threads' && s && (
        <>
          <div className="forum-filters">
            {(['all', 'pull', 'guide', 'reply'] as Filter[]).map((f) => (
              <button key={f} className={`forum-chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : KIND_META[f].icon + ' ' + KIND_META[f].label + 's'}
                <span className="n">{counts[f]}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div className="panel" style={{ padding: 4 }}>
              <EmptyState
                icon="🫂"
                text={posts.length === 0 ? 'The board is quiet' : 'Nothing under that tag yet'}
                sub={posts.length === 0 ? 'Be the first to post — a pull from the collection always warms the room up.' : 'Switch the tag back to All, or post something new.'}
              />
            </div>
          ) : (
            <div className="thread-list">
              {shown.map((p) => (
                <ThreadRow
                  key={p.id}
                  p={p}
                  pinned={p.id === pinnedId}
                  open={openId === p.id}
                  onOpen={() => setOpenId(openId === p.id ? null : p.id)}
                />
              ))}
            </div>
          )}

          <div className="faint small" style={{ marginTop: 8, lineHeight: 1.5 }}>
            Tap a thread to open it. The board keeps the last 12 threads — the room reads everything, but old posts slide off.
          </div>
        </>
      )}

      {tab === 'post' && s && (
        <>
          <div className="composer">
            <div className="composer-head">
              📸 Post a pull
              <span className="composer-sub">the room loves these</span>
            </div>
            <select value={pullId} onChange={(e) => setPullId(e.target.value)}>
              <option value="">Choose a card from your collection…</option>
              {collection.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <div className="composer-preview">
              <div className="lbl">Your thread</div>
              <div className="thread-preview">
                <span className="thread-avatar kind-pull">📸</span>
                <div style={{ minWidth: 0 }}>
                  <div className="thread-title">
                    {selected ? `Pulled a ${selected.name} — found in the wild` : 'Pulled a … — found in the wild'}
                  </div>
                  <div className="thread-meta">
                    <span className="thread-tag kind-pull">Pull</span>
                    {selected && <span className="thread-card">🃏 {selected.name}</span>}
                    <span>you · just now</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="composer-actions">
              <button
                className="primary"
                disabled={busy || !pullId}
                onClick={() =>
                  run(() => api.forumPull(Number(pullId)), (r) => {
                    toast(`Pull posted — the thread earned ${'🔥'.repeat(r.warmth ?? 1)} (+${r.rep} standing)`, 'good')
                    setPullId('')
                    setTab('threads')
                    setFilter('all')
                    load()
                  })
                }
              >
                Post to the board
              </button>
              <span className="faint small">Warmth scales with the card’s story — favorites flex harder.</span>
            </div>
          </div>

          <div className="composer">
            <div className="composer-head">
              💬 Answer a newbie
              <span className="composer-sub">{s.repliesToday}/3 today</span>
            </div>
            <div className="faint small" style={{ lineHeight: 1.5 }}>
              Someone asked a basic question in the help thread. Answering is the cheapest +1 standing on the board.
            </div>
            <div className="composer-actions">
              <button
                disabled={busy || s.repliesToday >= 3}
                onClick={() =>
                  run(() => api.forumReply(), (r) => {
                    toast(`Newbie helped: “${r.reply}” (+1 standing)`, 'good')
                    load()
                  })
                }
              >
                {s.repliesToday >= 3 ? 'Bin is empty today' : 'Answer one'}
              </button>
            </div>
          </div>

          <div className="composer">
            <div className="composer-head">
              📚 Write a guide
              <span className="composer-sub">{s.guideToday}/1 today</span>
            </div>
            <div className="faint small" style={{ lineHeight: 1.5 }}>
              Long-form, photos, receipts. One a day, and the warmth it earns is the biggest single jump on the ladder.
            </div>
            <div className="composer-actions">
              <button
                disabled={busy || s.guideToday >= 1}
                onClick={() =>
                  run(() => api.forumGuide(), (r) => {
                    toast(`Guide up: “${r.title}” — ${'🔥'.repeat(r.warmth ?? 1)} (+${r.rep} standing)`, 'good')
                    load()
                  })
                }
              >
                {s.guideToday >= 1 ? 'Already posted today' : 'Publish a guide'}
              </button>
            </div>
          </div>
        </>
      )}

      {tab === 'standing' && s && tier && (
        <>
          <div className="panel" style={{ padding: '13px 14px' }}>
            <div className="standing-head">
              <div>
                <span className="forum-mast-tier" style={{ color: tier.color }}>{tier.label}</span>
                <div className="standing-rep">
                  {s.rep.toFixed(1)}<small> / 100 standing</small>
                </div>
              </div>
              <div className="faint small" style={{ textAlign: 'right', maxWidth: 170, lineHeight: 1.45 }}>
                {s.nextAt != null ? <>next perk at <b style={{ color: 'var(--gold)' }}>{s.nextAt}</b> — {s.nextLabel}</> : 'every perk on the board is yours'}
              </div>
            </div>
            <div style={{ marginTop: 10 }}><RepBar rep={s.rep} nextAt={s.nextAt} /></div>
            <div className="faint small" style={{ marginTop: 7 }}>{tier.blurb}</div>
          </div>

          <div className="panel" style={{ padding: '13px 14px' }}>
            <div className="section-head">Perk ladder</div>
            <div className="pf-rows">
              <PerkRow at={s.thresholds.groupBuy} icon="🫂" name="Group-buys" effect="Co-fund a big lot with the room and split the entry cost" open={s.groupBuys} />
              <PerkRow at={s.thresholds.firstRefusal} icon="📩" name="Estate first-refusal" effect="Heirs DM you before a lot goes public — a 1-day exclusive window" open={s.firstRefusal} />
              <PerkRow at={s.thresholds.shipFirst} icon="📦" name="Ship-first trade trust" effect="Partners mail their card before you mail yours (Trading Post)" open={s.shipFirst} />
            </div>
          </div>
        </>
      )}

      {tab === 'cobuys' && s && (
        <>
          <div className="panel" style={{ padding: '13px 14px' }}>
            <div className="section-head">
              In flight
              {!s.groupBuys && <span className="faint small" style={{ marginLeft: 'auto' }}>unlocks at {s.thresholds.groupBuy}</span>}
            </div>
            {!s.groupBuys ? (
              <div className="forum-help" style={{ margin: 0 }}>
                🔒 The room co-funds one big card at a time: everyone throws in a share, the lot lands on the game clock, and it ships to you.
                Earn <b>{s.thresholds.groupBuy}</b> standing to open the board.
              </div>
            ) : s.groupBuyList.length === 0 ? (
              <div className="faint small" style={{ lineHeight: 1.5 }}>
                Nothing in flight. Start one below — the room splits the cost, the card lands in your binder at the full-lot basis
                {s.deliveredBuys > 0 ? ` (${s.deliveredBuys} delivered so far)` : ''}.
              </div>
            ) : (
              <div className="pf-rows">
                {s.groupBuyList.map((b) => <BuyRow key={b.id} b={b} />)}
              </div>
            )}
          </div>

          {s.groupBuys && (
            <div className="panel" style={{ padding: '13px 14px' }}>
              <div className="section-head">Start a co-buy<span className="faint small" style={{ marginLeft: 'auto' }}>one at a time</span></div>
              <div className="cobuy-grid">
                {POOL.map((p) => (
                  <button
                    key={p.cardId}
                    className="cobuy"
                    disabled={busy || s.groupBuyList.length > 0}
                    title={p.flavor}
                    onClick={() =>
                      run(() => api.forumGroupBuy(p.cardId), (r) => {
                        toast(`Co-buy started: ${r.cardName}, ${r.splitN} collectors splitting the lot — your share ${fmtUsd(r.myShare)}`, 'good')
                        refreshState()
                        load()
                      })
                    }
                  >
                    <div className="cobuy-name">🫂 {p.name}</div>
                    <div className="cobuy-fl">{p.flavor}</div>
                  </button>
                ))}
              </div>
              <div className="faint small" style={{ marginTop: 8 }}>
                {s.groupBuyList.length > 0 ? 'One co-buy at a time — the last one has to land first.' : 'The room votes with its wallet; a full split means a smaller share for you.'}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function repHint(s: ForumSection): boolean {
  return !s.groupBuys
}
