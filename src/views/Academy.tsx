import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { fmtUsd } from '../format'
import type { AcademyState } from '../types'

/**
 * The Collector's Academy — the optional long course. The starting tutorial
 * (views/Tutorial.tsx) is a welcome; this is the manual: one chapter per system
 * cluster, every mechanic the game runs, and a cash reward for each chapter
 * read plus a graduation bonus. Nothing here is gated and nothing is required —
 * it sits in the sidebar for anyone who wants to understand the whole hobby
 * before they spend a dollar of it.
 *
 * ONE source for the course: server/services/academy.ts owns the chapter ids,
 * titles, order and money, and this screen renders whatever `/api/academy`
 * returns. The only thing here is the PROSE, keyed by id, because it is
 * interface copy and it ships with the screen's chunk. A chapter that exists in
 * the list with no prose still renders (with a short fallback) rather than
 * disappearing; prose for an id the server no longer lists is not rendered at
 * all. Never add a title or a dollar figure to this file.
 */

type Prose = {
  icon: string
  lede: string
  points: string[]
  numbers?: string
  where: string
}

const PROSE: Record<string, Prose> = {
  economy: {
    icon: '💵',
    lede:
      'Every dollar in TCG Life is anchored to a real card. The catalogue holds the actual Pokémon TCG, and each printing carries its TCGplayer USD market price, so a junk common is worth cents because it really is, and a grail slab is worth thousands for the same reason.',
    points: [
      'Cash is the only money you can spend. Collection value is what your cards would fetch — it moves with the market whether you act or not.',
      'Net worth is cash plus collection plus sealed stock. Profit and loss compares today’s value against what each copy actually cost you, so a card you pulled and a card you bought are not the same position.',
      'Prices refresh on a sync loop, and the Home dashboard shows what changed while you were away. The Portfolio screen keeps the record: best pull, best flip, week by week.',
      'The day clock in the top bar is the game’s economy running: rent, payroll, wear, disasters and save snapshots all roll at day boundaries (two real hours a day by default). A day pass buys a skipped day when you need something to settle now.',
    ],
    numbers: 'A game day is 2 real hours. Rent, wages and roll events land at every even UTC hour.',
    where: 'Cash and net worth sit in the top bar; Home, Portfolio and Inventory break them down.',
  },
  packs: {
    icon: '📦',
    lede:
      'Packs are the hobby’s engine, and they are not a slot machine with made-up odds: each set has a pull table built from its real rarity structure — commons, uncommons, the reverse slot, and a rare slot that can upgrade into a hit.',
    points: [
      'The Pack Shop rings every purchase up sealed at the shelf price, which is the market price of that wrapper, not its contents. A pack can cost more than the cards inside it are worth on average — the tile prints TYP, P50, P90 and the average so you can see that before you buy.',
      'Open it from Inventory → Sealed. The ceremony deals the cards one at a time and the summary lands the whole pack in your collection, with new-to-binder marks and the pack’s return.',
      'Sets differ on purpose. Special sets have two reverse-ish slots and ball patterns, the oldest sets can throw first-edition stamps, some products carry a guaranteed card, and Delta Reign’s Legendary Stadiums arrive as a matched pair — both halves or neither, never a lone half.',
      'Pull History keeps every wrapper you ever opened, card by card, so a bad night is data rather than a feeling.',
      'Sealed is also an asset: hold it, and the shelf price drifts. Products that go out of print climb, and the OOP tag on the tile tells you the market has started paying for the box rather than the cards.',
    ],
    numbers: 'Delta Reign’s booster is 10 cards: 4 commons, 3 uncommons, 2 reverse-or-foil slots and one rare-or-better. A Legendary Stadium turns up in about one pack in twelve.',
    where: 'Pack Shop → any product; Inventory → Sealed to open it; Pull History for the receipts.',
  },
  condition: {
    icon: '⚖',
    lede:
      'Two copies of the same card are never the same object. Every copy carries hidden traits — centering, edge whitening, corner sharpness — and those traits, not luck alone, decide what a grader says about it.',
    points: [
      'Inspect a copy (👁 on the inventory row) before you spend anything on it. The tells are readable: a dead-centred, clean-edged copy is a gem candidate; a whitening disaster will grade a 6 no matter which lab you pay.',
      'Cards wear over time while they sit unprotected. A sleeve or toploader stops the wear clock; it does not restore damage already done.',
      'Grading is a real submission with a real fee and a real wait. PSA Standard $18 (3–6 days), PSA Express $45 (1–2 days, better handling), PSA Premium $190 for grails, Beckett BGS $60 for subgrades and the Black Label chase, CGC $20 for the strictest centering and the only route to a CGC Pristine 10. Every service prints a minimum raw value — do not grade a $3 card.',
      'Slabs come back priced from real graded comps, so the uplift is the market’s, not the game’s guess: a PSA 10 can multiply a card that a PSA 8 barely moves.',
    ],
    numbers: 'Fees run $18–$190 a card; turnaround 1–10 game days. The value pick is usually PSA Standard on a clean $20–$60 card.',
    where: 'Grading screen for submissions; 👁 Inspect on any inventory row for the hidden tells.',
  },
  buying: {
    icon: '🛒',
    lede:
      'There are two ways to buy: at the market price from the feed, or from somebody who does not know what they have. The second is the game.',
    points: [
      'Market → Marketplace is the singles feed. Listings are anchored to real market prices and occasionally sit under them; that gap is your margin.',
      'Market → Auction House runs escrowed lots: bid on other people’s cards, or consign your own and let the room fight over them.',
      'Market → Buylist is the other direction — shops publish want-lists and pay under market for bulk. It also has shelves you can buy from.',
      'The Deals hub unlocks at 3 sales and holds seven venues, each with its own gate: Pawn Shop (3 — hock a card for cash now, or take a 30-day loan you must service), Yard Sales (3 — read a driveway table from one-line peeks and haggle), Local Deals (5 — a parking-lot meetup, cheap and risky or inspected and clean), Flea Markets (6 — flat-price bins that NPC pickers are draining beside you), BidBay (8 — snipers who scan the feed twice a tick), Estate Buyouts (10 — a whole collection, sight unseen) and Live Shopping (12 — live rooms, six formats, a clock that does not wait).',
      'Haggling is a skill with a memory: lowball everything and sellers stop answering.',
    ],
    numbers: 'Deals opens at 3 sales; the venues gate at 3, 3, 5, 6, 8, 10 and 12 sales.',
    where: 'Market (three modes) and Deals (seven venues, each a tab).',
  },
  selling: {
    icon: '🏷',
    lede:
      'Every exit has a different price and a different speed, and the difference between them is the whole trading game.',
    points: [
      'List on the Market: you set the ask, the market decides whether it moves, and the sale pays after fees. Undercut to sell fast; hold firm to keep the margin.',
      'Buylist is instant and pays under market — the right answer for bulk and for cards too cheap to list.',
      'Trading Post is card-for-card: offers are capped at a maximum card count (the server enforces it), and both sides have to want the deal.',
      'Card Shop cases are the retail counter once you own a shop: stock a copy at an ask and let walk-in buyers find it. Cases fill, prices drift, and a well-stocked case earns while you sleep.',
      'Every one of these writes to sale history, and sale history is what unlocks the Deals venues and feeds the accountant.',
    ],
    numbers: 'Selling under market moves in hours; a stubborn ask can sit for game-days. Fees differ per counter — read the net, not the gross.',
    where: 'Market, Buylist, Trading Post, and the Card Shop’s cases.',
  },
  storage: {
    icon: '🗝️',
    lede:
      'A collection is also a space problem. The free shelf holds 100 raw cards and 2 slabs; after that you are paying rent on your own hobby.',
    points: [
      'Inventory → Storage & Auctions is the capacity screen: what is on the shelf, what is in lockers, what the vault rider covers, and what overflow will do to the next rip that does not fit.',
      'Overflow is a policy, not an accident: you choose whether extra cards are scrapped at your floor price, refused at the door, or allowed onto the shelf as overflow. Set the scrap floor before the shelf fills, not after.',
      'Lockers are weekly rent for real space. Miss the payments and the delinquent-locker auction takes the contents — the same auction you can bid in.',
      'Bulk boxes take the junk that is not worth a listing; the scrap floor is what you will accept for it.',
      'Sealed stock takes room too, and protective supplies (sleeves, toploaders) both stop wear and cost money.',
    ],
    numbers: 'Free shelf: 100 raw, 2 slabs. Lockers charge weekly; the vault rider covers what you want protected.',
    where: 'Inventory → Storage & Auctions; bulk boxes and supplies sit on the inventory tabs.',
  },
  collecting: {
    icon: '📔',
    lede:
      'The collection is the point, and there are four ways to look at it: the grid, the binder, the set, and the want list.',
    points: [
      'Cards is the working grid — filter by set, rarity, type, price or condition.',
      'Binders group cards onto pages you can flip through; a slot holds one copy and the pages are the display.',
      'Sets is completion, set by set: what you own, what is missing, and what finishing it would cost at today’s prices. Set detail shows the same per card.',
      'Wishlist sets targets and lets agents watch the market for you — the notification bell is where a watched card announces itself.',
      'Achievements are the trophy shelf: 30 goals across collecting, selling and building, each with the exact requirement printed so you can plan for it.',
    ],
    numbers: 'A set’s completion cost is priced from the missing cards at market, so it moves as the market does.',
    where: 'Collection (four modes), Set Detail, Wishlist agents, Achievements.',
  },
  events: {
    icon: '🎪',
    lede:
      'The hobby has a social calendar, and the best prices in the game are usually on a folding table at a convention rather than on a screen.',
    points: [
      'Calendar is the index: convention weekends, tournament nights, sponsor drops and your own show windows, all on the same clock as the day counter.',
      'Conventions put you on the floor: vendor tables, deal bins, haggling across the aisle, and back-room buyouts that are worth the trip.',
      'Card Shows are the other side of the table: book a hall, set the gate, sell dealer tables, and work a booth stocked from your own inventory. A good show pays for the hall; a bad one is a story.',
      'Attending costs money and time, and the good tables are not there every weekend — the calendar is what tells you when to go.',
    ],
    numbers: 'Conventions run on scheduled weekends; a hosted show’s profit is gate plus tables plus booth sales minus the hall.',
    where: 'Events (three modes: Calendar, Conventions, Card Shows).',
  },
  business: {
    icon: '🏪',
    lede:
      'Past a certain point the hobby becomes a storefront. This is where the game stops being about pull luck and starts being about margin, payroll and the tax man.',
    points: [
      'The Card Shop unlocks at $500 cash. Lease it ($250) or buy the building — asking price is 400× the tier’s base rent, a 25% cash down payment and a mortgage that drafts daily.',
      'Rent day is real: rent, payroll, insurance and the rest draft at day boundaries. A stocked shop with open cases earns while walk-ins browse; an empty shop just costs money.',
      'Staff have roles and wages, and a manager can be promoted to run a second store through the franchise track. The rival across the street competes for the same customers.',
      'The accountant costs $45 a week and shows you the books — profit and loss per day, per case, per store. Taxes are calculated from what you actually earned, so the records matter.',
      'Credit exists: borrowing against a line prices the money by your credit score, and clean repayment builds it. Sealed futures go further and lend against sealed stock, with escrow, a daily rate and a re-wrap fee if the collateral comes back damaged.',
    ],
    numbers: 'Shop lease $250 · building 400× base rent with 25% down · accountant $45/week · rent and payroll draft every game day.',
    where: 'Card Shop (cases, staff, building), Resale Desk, Inventory → Storage for futures, the accountant in the shop screens.',
  },
  showbiz: {
    icon: '📡',
    lede: 'The last layer is the audience — and the fact that not every card in circulation is real.',
    points: [
      'Stream earns followers by putting your rips and your stock on camera. The channel grows from what you actually do, and stream revenue is its own line in the books.',
      'Pack Battles put your box against a rival’s: both sides open, the better pull wins the record, and a grudge rematch is always available.',
      'Live Shopping is the deal venue that behaves like a live room: six formats, $1 sudden deaths, rip-it-or-ship-it, and a clock that does not wait for you to decide.',
      'Authentication matters because counterfeits are in the world. Buying tools and surveying a copy is cheaper than being wrong: submit a suspect for authentication and the verdict, and the haircut a flagged copy takes, are both real. An unflagged fake in your collection is priced like the real thing until someone proves otherwise.',
      'Community is the forum — the room where the hobby talks, and where a rumour about a set moves a price.',
    ],
    numbers: 'Pack Battles is box against box, best pull takes it. Authentication fees are cheaper than the haircut a flagged card takes.',
    where: 'Stream, Pack Battles, Deals → Live Shopping, Inventory → Authentication, Community.',
  },
}

const FALLBACK: Prose = {
  icon: '📘',
  lede: 'This chapter is new — its page is still being written.',
  points: [],
  where: 'The rest of the course is unaffected; read the chapters either side of it.',
}

const CHAPTER_KEY = 'tcglife.academyChapter'

export function AcademyView() {
  const { refreshState, toast } = useStore()
  const [state, setState] = useState<AcademyState | null>(null)
  const [open, setOpen] = useState<string | null>(() => localStorage.getItem(CHAPTER_KEY))
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const next = await api.academy()
      setState(next)
      // Keep the remembered chapter only while the server still lists it.
      setOpen((cur) => (cur && next.chapters.some((c) => c.id === cur) ? cur : next.chapters[0]?.id ?? null))
    } catch {
      toast('Could not read the course — the local server did not answer', 'bad')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (open) localStorage.setItem(CHAPTER_KEY, open)
  }, [open])

  const chapters = state?.chapters ?? []
  const done = useMemo(() => new Set(chapters.filter((c) => c.done).map((c) => c.id)), [chapters])
  const index = chapters.findIndex((c) => c.id === open)
  const chapter = chapters[index] ?? chapters[0]
  const prose = chapter ? PROSE[chapter.id] ?? FALLBACK : null

  const learn = async () => {
    if (!chapter) return
    setBusy(true)
    try {
      const r = await api.academyChapter(chapter.id)
      setState(r.state)
      await refreshState()
      toast(
        r.awarded > 0
          ? `Chapter done — +${fmtUsd(r.awarded)}${r.state.allDone ? ' including the graduation bonus' : ''}`
          : 'Chapter done — the reward for this one was already paid',
        r.awarded > 0 ? 'good' : 'info',
      )
      const next = r.state.chapters.find((c) => !c.done)
      if (next) setOpen(next.id)
    } catch (err) {
      // The server refuses a chapter with steps left, and says which ones.
      toast(err instanceof Error ? err.message : 'Could not save that chapter', 'bad')
      void load()
    } finally {
      setBusy(false)
    }
  }

  // One question per chapter: the choice goes up, the verdict comes back. A wrong
  // answer costs nothing and the options stay put, so it is a check, not a gate.
  const answer = async (stepId: string, choice: number) => {
    if (!chapter) return
    setBusy(true)
    try {
      const r = await api.academyAnswer(chapter.id, stepId, choice)
      setState(r.state)
      toast(r.correct ? 'Correct — step ticked.' : 'Not quite. The numbers are in the chapter above.', r.correct ? 'good' : 'bad')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save that answer', 'bad')
    } finally {
      setBusy(false)
    }
  }

  // The action steps are proved by the save, so re-reading the state is how you
  // see one tick after doing it in another screen.
  const recheck = async () => {
    setBusy(true)
    try {
      await load()
      toast('Checked the save again', 'info')
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      const r = await api.academyReset()
      setState(r.state)
      setOpen(r.state.chapters[0]?.id ?? null)
      toast('Course reset — the reading is free, the rewards are once', 'info')
    } catch {
      toast('Could not reset the course', 'bad')
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return (
      <div className="academy">
        <h1 className="academy-title">Collector’s Academy</h1>
        <div className="faint small">Opening the course…</div>
      </div>
    )
  }

  return (
    <div className="academy">
      <div className="academy-head">
        <div>
          <h1 className="academy-title">Collector’s Academy</h1>
          <div className="faint small">
            {state.total} chapters, every system in the game — {fmtUsd(state.offerTotal)} across the course, paid for the
            work: each chapter is a short checklist of doing and answering, with a {fmtUsd(state.bonus)} graduation bonus
            at the end. Optional: nothing here is required, and the course can be run again at any time.
          </div>
        </div>
        <div className="academy-progress">
          <div className="academy-count">
            <b>{state.doneCount}</b>
            <span className="faint">/{state.total} chapters</span>
          </div>
          <div className="academy-bar">
            <div className="fill" style={{ width: `${(state.doneCount / Math.max(1, state.total)) * 100}%` }} />
          </div>
          <div className="faint small">
            {state.earned > 0 ? `${fmtUsd(state.earned)} banked from the course` : 'Nothing banked yet'}
          </div>
        </div>
      </div>

      {state.allDone && (
        <div className="academy-graduated">
          <span className="ico">🎓</span>
          <div>
            <b>Course complete.</b>{' '}
            {state.bonusClaimed ? `The ${fmtUsd(state.bonus)} graduation bonus is in your cash.` : ''} You know the whole
            game now — the rest is margin, patience and a good eye.
          </div>
        </div>
      )}

      <div className="academy-body">
        <div className="academy-list">
          {chapters.map((c, i) => {
            const isDone = done.has(c.id)
            return (
              <button
                key={c.id}
                className={`academy-item ${c.id === chapter?.id ? 'on' : ''} ${isDone ? 'done' : ''}`}
                onClick={() => setOpen(c.id)}
                title={isDone ? `${c.title} — done` : `${c.title} — ${fmtUsd(c.reward)} for the work`}
              >
                <span className="num">{String(i + 1).padStart(2, '0')}</span>
                <span className="ico">{PROSE[c.id]?.icon ?? FALLBACK.icon}</span>
                <span className="label">{c.title}</span>
                <span className="tick">{isDone ? '✓' : <span className="faint reward">{fmtUsd(c.reward)}</span>}</span>
              </button>
            )
          })}
          <button className="ghost small academy-reset" disabled={busy} onClick={reset}>
            Run the course again (fresh checklist, rewards are once only)
          </button>
        </div>

        {chapter && prose && (
          <div className="academy-chapter card">
            <div className="faint small">
              CHAPTER {index + 1} OF {state.total}
            </div>
            <h2>
              <span className="ico">{prose.icon}</span> {chapter.title}
            </h2>
            <p className="academy-lede">{prose.lede}</p>
            {prose.points.length > 0 && (
              <ul className="academy-points">
                {prose.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
            {prose.numbers && (
              <div className="academy-numbers">
                <b>Numbers that matter:</b> {prose.numbers}
              </div>
            )}
            <div className="academy-where">
              <b>Where it lives:</b> {prose.where}
            </div>
            <div className="academy-steps">
              <div className="academy-steps-head">
                <b>Your work in this chapter</b>
                <span className="faint small">
                  {chapter.stepsDone}/{chapter.steps.length} done{chapter.ready ? ' — the reward is unlocked' : ''}
                </span>
              </div>
              {chapter.steps.map((s, i) => (
                <div key={s.id} className={`academy-step ${s.done ? 'done' : ''}`}>
                  <span className="mark" aria-hidden>{s.done ? '✓' : i + 1}</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="academy-step-label">{s.label}</div>
                    {!s.done && <div className="faint small academy-step-how">{s.how}</div>}
                    {s.kind === 'answer' && !s.done && s.options && (
                      <div className="academy-choices">
                        {s.options.map((o, k) => (
                          <button key={k} className="chip" disabled={busy} onClick={() => answer(s.id, k)}>
                            {o}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="academy-actions">
              <span className="faint small">
                {done.has(chapter.id)
                  ? 'Chapter done'
                  : chapter.ready
                    ? `Every step ticked — ${fmtUsd(chapter.reward)} is waiting`
                    : `${chapter.steps.length - chapter.stepsDone} step${chapter.steps.length - chapter.stepsDone === 1 ? '' : 's'} left before this chapter pays`}
              </span>
              <div className="row" style={{ gap: 8 }}>
                {index > 0 && (
                  <button className="ghost" onClick={() => setOpen(chapters[index - 1].id)}>
                    ← Previous
                  </button>
                )}
                {!done.has(chapter.id) && (
                  <button className="ghost" disabled={busy} onClick={recheck}>
                    Check the save again
                  </button>
                )}
                {done.has(chapter.id) ? (
                  index + 1 < chapters.length && (
                    <button className="primary" onClick={() => setOpen(chapters[index + 1].id)}>
                      Next chapter →
                    </button>
                  )
                ) : (
                  <button className="primary" disabled={busy || !chapter.ready} onClick={learn}>
                    {chapter.ready ? `Claim ${fmtUsd(chapter.reward)}` : 'Finish the steps first'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
