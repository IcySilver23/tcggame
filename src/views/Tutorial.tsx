import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { useStore } from '../store'

/**
 * The starting tutorial — a six-step welcome walkthrough for brand-new
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
        <p className="faint">60-second tour. Six stops. Then it's your collection.</p>
      </>
    ),
  },
  {
    tag: '▤',
    title: 'Collect: the loop',
    body: (
      <>
        <p>
          Cards come from <b>opening packs</b> (real pull tables from the actual catalog),{' '}
          <b>hunting the Market</b> for underpriced NPC listings, and the deal surfaces below.
        </p>
        <p>
          The <b>Pack Shop</b> rings every purchase up <b>sealed</b> — open it from{' '}
          <b>Inventory → Sealed</b> whenever you like, one product at a time.
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
        <p>
          CGC's <b>Pristine 10</b> is the gold label: it needs near-perfect centering, clean edges and
          sharp corners, so inspect before you pay the fee. The copy's hidden traits <i>are</i> the odds.
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
          collateral loans. <b>Yard Sales</b> and <b>Flea Markets</b> — driveway tables and flat-price
          dig bins. <b>Local Deals</b> — parking-lot meetups. <b>Estate Buyouts</b> — a whole
          collection, sight unseen.
        </p>
        <p>
          And <b>📺 Live Shopping</b> — Whatnot-style streams with $1 sudden deaths and
          rip-it-or-ship-it. Blind lockers wait under <b>Inventory → Storage</b>, and the{' '}
          <b>📅 Calendar</b> tells you when the scene happens.
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
          📦 Purchase a pack at the Pack Shop and open it in Inventory → Sealed · 🧾 take the dupes
          to the Buylist — the first three sales unlock Deals · ⇄ scan the Market for a deal · ★
          wishlist a grail and let the 🔔 watch it for you · 📅 check what's happening this week
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

  const finish = async (completed: boolean) => {
    localStorage.removeItem(STEP_KEY)
    await api.tutorialDone()
    await refreshState()
    toast(
      completed
        ? "Welcome in — purchase a pack, open it in Inventory → Sealed, then take what you don't keep to the 🧾 Buylist."
        : 'Tutorial skipped — ⚙ Settings can replay it any time',
      completed ? 'good' : 'info',
    )
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
          <button className="ghost" onClick={() => finish(false)}>Skip</button>
          <div className="row" style={{ gap: 8 }}>
            {step > 0 && (
              <button className="ghost" onClick={() => setStep(step - 1)}>← Back</button>
            )}
            {last ? (
              <button className="primary" onClick={() => finish(true)}>Let's go 🚀</button>
            ) : (
              <button className="primary" onClick={() => setStep(step + 1)}>Next →</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
