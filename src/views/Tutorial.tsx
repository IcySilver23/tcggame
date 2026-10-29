import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { useStore } from '../store'

/**
 * The starting tutorial — a five-step welcome walkthrough for brand-new
 * saves. Gated server-side: only saves with no play history (no sales, no
 * inventory) are offered it, veterans never see it, and finishing (or
 * skipping) flips the `tut:start` flag so it never nags again. Settings can
 * replay it any time. Step position survives a reload via localStorage, but
 * the "seen" state is per-save server truth, like every other tutorial flag.
 */

type Step = {
  tag: string
  title: string
  body: ReactNode
}

const STEPS: Step[] = [
  {
    tag: '👋',
    title: 'Welcome to TCG Life',
    body: (
      <>
        <p>
          You've got <b>$1,000</b> and a hobby. This town runs on <b>real card prices</b> — every
          dollar in the game, from a junk common to a grail slab, anchors to live market data.
        </p>
        <p className="faint">60-second tour. Five stops. Then it's your collection.</p>
      </>
    ),
  },
  {
    tag: '▤',
    title: 'Collect: the loop',
    body: (
      <>
        <p>
          Cards come from <b>ripping packs</b> (real pull tables from the actual catalog),{' '}
          <b>hunting the Market</b> for underpriced NPC listings, and the deal surfaces below.
        </p>
        <p>
          <b>Hover any card art</b> for a zoom, <b>click it</b> for the full detail sheet — market
          price, your copies, grading advice.
        </p>
      </>
    ),
  },
  {
    tag: '⚖',
    title: 'Grade: turn NM into gold',
    body: (
      <>
        <p>
          Two "NM" copies are never the same card. <b>👁 Inspect</b> your copies to read the hidden
          tells — centering, whitening, corners — then send the right ones to <b>PSA, BGS, or CGC</b>.
        </p>
        <p className="faint">A whitening-disaster NM grades a 6. A dead-centered one is a gem machine. The eye can be trained.</p>
      </>
    ),
  },
  {
    tag: '🛒',
    title: 'Hunt: the deals are everywhere',
    body: (
      <>
        <p>
          <b>BidBay</b> — NPC sellers and rival snipers. <b>Pawn Shop</b> — 40¢ fire sales and
          collateral loans. <b>Yard Sales</b> — weekend driveways priced from vibes.{' '}
          <b>Storage Auctions</b> — blind lockers, hidden collections.
        </p>
        <p>
          And <b>📺 Live Shopping</b> — Whatnot-style streams with $1 sudden deaths and
          rip-it-or-ship-it. The <b>Calendar</b> tells you when the scene happens.
        </p>
      </>
    ),
  },
  {
    tag: '🏪',
    title: 'Build: from binder to empire',
    body: (
      <>
        <p>
          When you're ready: a <b>🏪 Card Shop</b> with cases and staff, a second store, a third —
          managers, a rival across the street, your own card shows, your own stream.
        </p>
        <p className="faint">The 🧾 accountant watches the books. The tax man is real. Good luck.</p>
      </>
    ),
  },
  {
    tag: '🚀',
    title: 'First moves',
    body: (
      <>
        <p>Suggested opening:</p>
        <p>
          📦 Rip a pack from the Pack Shop · ⇄ scan the Market for a deal · ★ wishlist a grail and
          let the 🔔 watch it for you · 📅 check what's happening this week
        </p>
        <p className="faint">Everything else waits for you. Welcome to the hobby.</p>
      </>
    ),
  },
]

const STEP_KEY = 'tcglife.tutorialStep'

export function StartingTutorial() {
  const { state, refreshState, toast } = useStore()
  const [step, setStep] = useState(() => {
    const v = Number(localStorage.getItem(STEP_KEY) ?? '0')
    return Number.isFinite(v) && v >= 0 && v < STEPS.length ? v : 0
  })

  useEffect(() => {
    localStorage.setItem(STEP_KEY, String(step))
  }, [step])

  const finish = async () => {
    localStorage.removeItem(STEP_KEY)
    await api.tutorialDone()
    await refreshState()
    toast('Tutorial skipped — the 🏪 Settings panel can replay it any time', 'info')
  }

  if (!state || state.tutorials.start || !state.tutorialEligible) return null

  const s = STEPS[step]
  const last = step === STEPS.length - 1

  return (
    <div className="tut-backdrop">
      <div className="tut-card">
        <div className="tut-tag">{s.tag}</div>
        <h2>{s.title}</h2>
        <div className="tut-body">{s.body}</div>
        <div className="tut-dots">
          {STEPS.map((_, i) => (
            <button
              key={i}
              className={i === step ? 'dot on' : 'dot'}
              aria-label={`Step ${i + 1}`}
              onClick={() => setStep(i)}
            />
          ))}
        </div>
        <div className="tut-actions">
          <button className="ghost" onClick={finish}>Skip</button>
          <div className="row" style={{ gap: 8 }}>
            {step > 0 && (
              <button className="ghost" onClick={() => setStep(step - 1)}>← Back</button>
            )}
            {last ? (
              <button className="primary" onClick={finish}>Let's go 🚀</button>
            ) : (
              <button className="primary" onClick={() => setStep(step + 1)}>Next →</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
