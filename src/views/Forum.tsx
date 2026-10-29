import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ForumSection, ForumGroupBuy, ForumPost } from '../api'
import { useStore } from '../store'
import { EmptyState, fmtUsd } from '../components'

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
  reply: { icon: '💬', label: 'Reply' },
}

// Mirrors the server's GROUPBUY_POOL (the server validates the id — this is
// just the storefront for it).
const POOL: { cardId: string; name: string; flavor: string }[] = [
  { cardId: 'ecard2-149', name: 'Lugia', flavor: 'The forum\u2019s grail — the room has been hunting it for months' },
  { cardId: 'swsh4-181', name: 'Beauty', flavor: 'The chase card everyone pretends not to care about' },
  { cardId: 'base1-4', name: 'Charizard', flavor: 'The classic. Somebody always bites' },
  { cardId: 'neo1-7', name: 'Typhlosion', flavor: 'The mid-budget favorite — real card, real money, no drama' },
]

function RepBar({ rep, nextAt }: { rep: number; nextAt: number | null }) {
  return (
    <div style={{ position: 'relative', height: 10, background: 'var(--panel2)', borderRadius: 5, overflow: 'hidden' }}>
      <div style={{ width: `${rep}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent, #9db4ff), var(--green))', borderRadius: 5 }} />
      {nextAt != null && (
        <div
          title={`${nextAt} standing`}
          style={{ position: 'absolute', left: `${nextAt}%`, top: 0, bottom: 0, width: 2, background: 'var(--yellow)' }}
        />
      )}
    </div>
  )
}

function PerkRow({ at, icon, name, effect, open }: { at: number; icon: string; name: string; effect: string; open: boolean }) {
  return (
    <div
      className="row"
      style={{
        gap: 10, alignItems: 'center', padding: '7px 10px', borderRadius: 6,
        border: '1px solid var(--border-soft)',
        background: open ? 'rgba(70, 200, 140, 0.07)' : 'transparent',
        opacity: open ? 1 : 0.65,
      }}
    >
      <span style={{ fontSize: 18 }}>{open ? icon : '🔒'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="small" style={{ fontWeight: 700, color: open ? 'var(--green)' : undefined }}>
          {name} <span className="faint">· {at} standing</span>
        </div>
        <div className="faint small">{effect}</div>
      </div>
      {open && <span className="badge" style={{ fontSize: 9, padding: '1px 6px', color: 'var(--green)' }}>OPEN</span>}
    </div>
  )
}

function OpenBuyRow({ b }: { b: ForumGroupBuy }) {
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', padding: '7px 10px', border: '1px solid var(--border-soft)', borderRadius: 6 }}>
      <span style={{ fontSize: 18 }}>{b.status === 'filled' ? '📬' : '🚚'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="small" style={{ fontWeight: 700 }}>
          {b.cardName} <span className="faint">· {b.splitN}-way split</span>
        </div>
        <div className="faint small">
          Lot {fmtUsd(b.totalCost)} · your share <b>{fmtUsd(b.myShare)}</b> (already paid) · lands in ~{b.etaDays} game-day{b.etaDays === 1 ? '' : 's'}
        </div>
      </div>
      <span className="badge" style={{ fontSize: 9, padding: '1px 6px' }}>{b.status === 'filled' ? 'BOXING UP' : 'GATHERING'}</span>
    </div>
  )
}

function PostRow({ p }: { p: ForumPost }) {
  const k = KIND_META[p.kind] ?? KIND_META.reply
  return (
    <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-soft)' }}>
      <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
        <span>{k.icon}</span>
        <span className="small" style={{ fontWeight: 700, flex: 1, minWidth: 0 }}>
          {p.title}
          {p.cardName && <span className="badge" style={{ fontSize: 9, padding: '1px 6px', marginLeft: 6 }}>{p.cardName}</span>}
        </span>
        {p.warmth > 0 && <span title={`${p.warmth} warmth`} style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{'🔥'.repeat(p.warmth)}</span>}
      </div>
      {p.body && <div className="faint small" style={{ marginTop: 2, paddingLeft: 24 }}>{p.body}</div>}
    </div>
  )
}

export function ForumView() {
  const toast = useStore((s) => s.toast)
  const refreshState = useStore((s) => s.refreshState)
  const [s, setS] = useState<ForumSection | null>(null)
  const [collection, setCollection] = useState<{ id: number; label: string }[]>([])
  const [pullId, setPullId] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api.forum().then(setS).catch(() => {})
  useEffect(() => {
    load()
    api.inventory()
      .then((rows) =>
        setCollection(
          rows
            .filter((r) => r.status === 'collection' && !r.graded_grade)
            .sort((a, b) => b.cost_basis - a.cost_basis)
            .map((r) => ({ id: r.id as number, label: `${r.name} (${r.condition}${r.favorite ? ' · ♥' : ''})` })),
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

  const tier = s ? TIER_META[s.tier] : null

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🫂 Community</h1>
          <div className="sub">The local collector forum. Post pulls, answer newbies, write guides — standing here unlocks real privileges around town.</div>
        </div>
      </div>

      {s && s.rep < 3 && (
        <div className="faint small" style={{ marginBottom: 10, padding: '8px 10px', background: 'var(--panel2)', borderRadius: 6, border: '1px solid var(--border-soft)', lineHeight: 1.5 }}>
          Lurking is free, but standing is earned. <b>Post a pull</b> from your collection (the room loves those), <b>answer newbie questions</b> (3/day),
          or <b>write a guide</b> (1/day). At <b>10</b> standing the forum co-funds big cards with you, at <b>25</b> estate heirs DM you before lots go public,
          and at <b>40</b> trade partners ship their side first. The street’s gossip travels: while suspicion is up, rep gains are halved.
        </div>
      )}

      {s && s.streetHot && (
        <div className="row small" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, alignItems: 'center', gap: 10, background: 'rgba(220, 60, 60, 0.12)', border: '1px solid rgba(220, 60, 60, 0.45)', color: 'var(--red)' }}>
          <span>🚨 The forum reads the street gossip — <b>rep gains are HALVED</b> while suspicion is up. Lay low, let it fade.</span>
        </div>
      )}

      {s && tier && (
        <div className="panel mb14" style={{ padding: '12px 14px' }}>
          <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <span className="badge" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--panel2)', color: tier.color, borderColor: tier.color }}>{tier.label}</span>
            </div>
            <div style={{ fontWeight: 800, fontSize: 22 }}>{s.rep.toFixed(1)}<span className="faint" style={{ fontSize: 12, fontWeight: 400 }}> / 100 standing</span></div>
            <div className="faint small" style={{ marginLeft: 'auto', textAlign: 'right' }}>
              {s.nextAt != null ? <>next perk at <b style={{ color: 'var(--gold)' }}>{s.nextAt}</b> — {s.nextLabel}</> : <>every perk on the board is yours</>}
              {s.deliveredBuys > 0 && <><br />{s.deliveredBuys} group-buy{s.deliveredBuys === 1 ? '' : 's'} delivered</>}
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <RepBar rep={s.rep} nextAt={s.nextAt} />
          </div>
          <div className="faint small" style={{ marginTop: 6 }}>{tier.blurb}</div>
        </div>
      )}

      {s && (
        <div className="panel mb14" style={{ padding: '12px 14px' }}>
          <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Perk ladder</div>
          <div style={{ display: 'grid', gap: 6 }}>
            <PerkRow at={s.thresholds.groupBuy} icon="🫂" name="Group-buys" effect="Co-fund a big lot with the room and split the entry cost" open={s.groupBuys} />
            <PerkRow at={s.thresholds.firstRefusal} icon="📩" name="Estate first-refusal" effect="Estate heirs DM you before a lot goes public — a 1-day exclusive window" open={s.firstRefusal} />
            <PerkRow at={s.thresholds.shipFirst} icon="📦" name="Ship-first trade trust" effect="Trade partners mail their card before you mail yours — escrow anxiety over (Trading Post)" open={s.shipFirst} />
          </div>
        </div>
      )}

      <div className="panel mb14" style={{ padding: '12px 14px' }}>          <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Today’s posting desk</div>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={pullId} onChange={(e) => setPullId(e.target.value)} style={{ flex: 1, minWidth: 200 }}>
            <option value="">Choose a pull from your collection…</option>
            {collection.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <button
            className="primary"
            disabled={busy || !pullId}
            onClick={() =>
              run(() => api.forumPull(Number(pullId)), (r) => {
                toast(`Pull posted — the thread earned ${'🔥'.repeat(r.warmth ?? 1)} (+${r.rep} standing)`, 'good')
                setPullId('')
                load()
              })
            }
          >
            📸 Post the pull
          </button>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button
            disabled={busy || (s?.repliesToday ?? 0) >= 3}
            onClick={() =>
              run(() => api.forumReply(), (r) => {
                toast(`Newbie helped: \u201c${r.reply}\u201d (+1 standing)`, 'good')
                load()
              })
            }
          >
            💬 Answer a newbie ({s?.repliesToday ?? 0}/3 today)
          </button>
          <button
            disabled={busy || (s?.guideToday ?? 0) >= 1}
            onClick={() =>
              run(() => api.forumGuide(), (r) => {
                toast(`Guide up: \u201c${r.title}\u201d — ${'🔥'.repeat(r.warmth ?? 1)} (+${r.rep} standing)`, 'good')
                load()
              })
            }
          >
            📚 Write a guide ({s?.guideToday ?? 0}/1 today)
          </button>
          <span className="faint small" style={{ marginLeft: 'auto' }}>Pull warmth scales with the card’s story — favorites flex harder.</span>
        </div>
      </div>

      <div className="panel mb14" style={{ padding: '12px 14px' }}>
        <div className="row" style={{ alignItems: 'center', marginBottom: 6 }}>
          <div className="small" style={{ fontWeight: 700 }}>🫂 Group-buy board</div>
          {s && !s.groupBuys && <span className="faint small" style={{ marginLeft: 'auto' }}>unlocks at {s.thresholds.groupBuy} standing</span>}
        </div>
        {s && !s.groupBuys ? (
          <div className="faint small" style={{ padding: '8px 10px', border: '1px dashed var(--border-soft)', borderRadius: 6 }}>
            🔒 The room co-funds one big card at a time — everyone throws in their share, the lot lands on the game clock, and it goes to whoever organized it.
            Earn {s.thresholds.groupBuy} standing and the board opens to you.
          </div>
        ) : (
          <>
            {s && s.groupBuyList.length > 0 && (
              <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
                {s.groupBuyList.map((b) => <OpenBuyRow key={b.id} b={b} />)}
              </div>
            )}
            {s && s.groupBuyList.length === 0 && (
              <div className="faint small" style={{ marginBottom: 10 }}>
                Nothing in flight. Start one below — the room splits the cost, the card lands in your binder at the full-lot basis{ s.deliveredBuys > 0 ? ` (${s.deliveredBuys} delivered so far)` : '' }.
              </div>
            )}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {POOL.map((p) => (
                <button
                  key={p.cardId}
                  disabled={busy || (s?.groupBuyList.length ?? 0) > 0}
                  title={p.flavor}
                  onClick={() =>
                    run(() => api.forumGroupBuy(p.cardId), (r) => {
                      toast(`Group-buy started: ${r.cardName}, ${r.splitN} collectors splitting the lot — your share ${fmtUsd(r.myShare)}`, 'good')
                      refreshState()
                      load()
                    })
                  }
                  style={{ textAlign: 'left', minWidth: 150 }}
                >
                  <div style={{ fontWeight: 700 }}>{p.name}</div>
                  <div className="faint" style={{ fontSize: 10, maxWidth: 200, whiteSpace: 'normal' }}>{p.flavor}</div>
                </button>
              ))}
            </div>
            {s && (s.groupBuyList.length ?? 0) > 0 && <div className="faint small mt8">One group-buy at a time — the last one has to land first.</div>}
          </>
        )}
      </div>

      <div className="panel" style={{ padding: '12px 14px' }}>
        <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>The feed</div>
        {s && s.posts.length === 0 && (
          <EmptyState icon="🫂" text="The forum is quiet" sub="Be the first to post — a pull from the collection always warms the room up." />
        )}
        {s && s.posts.length > 0 && (
          <div style={{ border: '1px solid var(--border-soft)', borderRadius: 6 }}>
            {s.posts.map((p) => <PostRow key={p.id} p={p} />)}
          </div>
        )}
      </div>
    </div>
  )
}
