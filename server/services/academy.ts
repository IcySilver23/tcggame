// The Collector's Academy — the long, optional course that walks a player
// through every system in the game and pays for the WORK, not the reading.
//
// Each chapter is a short checklist: one real action in the game, and one
// question about the numbers the chapter just explained. The action is checked
// against the save — a pack in `pull_history`, a row in `sale_history`, a
// wishlist target — so no button can claim it. Only when every step is ticked
// does the chapter pay.
//
// The chapter LIST, the steps and the money live here, not in the screen: the
// reward is server truth, so a chapter can only be paid once per save even if
// the page is reset, reloaded or replayed. The prose lives in
// src/views/Academy.tsx, because it is interface copy and it ships with the
// screen's own chunk.
//
// THREE THINGS ARE OLDER THAN THE CHECKLIST, and the page has to be honest about
// all of them:
//  * a saved chapter finished under the read-and-claim build has no step
//    evidence and never can — it is WAIVED once, with a note, rather than shown
//    as a half-finished checklist;
//  * a chapter the player already knows can be SKIPPED: no reward, no progress,
//    just an end to the nagging, and it can be taken back;
//  * a chapter added after a save graduated is flagged, so a graduate opening
//    the page sees what is new instead of a course they thought they finished.
import { db, getMeta, setMeta, logActivity } from '../lib/db'
import { round2 } from './market'

export type AcademyStepState = {
  id: string
  kind: 'act' | 'answer'
  label: string
  /** Where to do it, or why the step is not ticked yet. */
  how: string
  /** The screen this step names, as a hash route the app already serves. */
  route?: string
  /** What to call that screen on the button ("Pack Shop", "Buylist"). */
  where?: string
  done: boolean
  /** Only for answer steps. */
  question?: string
  options?: string[]
}

export type AcademyChapter = {
  id: string
  title: string
  /** Cash paid the first time this chapter is completed on this save. */
  reward: number
  /**
   * The app version that put this chapter in the course. A save that graduated
   * before it gets a "new since you graduated" mark — which is the whole reason
   * the course can grow without silently gaining chapters nobody notices.
   * WHEN A RELEASE ADDS A SYSTEM, ADD ITS CHAPTER HERE WITH THAT VERSION.
   */
  addedIn: string
}

export type AcademyState = {
  chapters: {
    id: string
    title: string
    reward: number
    done: boolean
    paid: boolean
    steps: AcademyStepState[]
    stepsDone: number
    /** Every step ticked — the reward can be claimed. */
    ready: boolean
    /** Finished before the checklist existed: the steps are kept, not demanded. */
    waived: boolean
    /** The player said they already know this one; it pays nothing. */
    skipped: boolean
    addedIn: string
    /** Added after this save graduated. */
    fresh: boolean
  }[]
  doneCount: number
  total: number
  bonus: number
  bonusClaimed: boolean
  /** Every dollar this course has paid out, chapter rewards and bonus. */
  earned: number
  /** What the whole course is worth before any of it is done. */
  offerTotal: number
  /** False while the save is still owed nothing — the page shows the offer. */
  allDone: boolean
  /** Chapters added after this save graduated (0 for a save still on the course). */
  newSinceGraduation: number
}

type ActStep = {
  id: string
  kind: 'act'
  label: string
  how: string
  /**
   * Where the work is done, as a hash route the app shell already serves
   * (`market/buylist`, `collection/wishlist`, …). The screen puts a one-click
   * button on the step rather than making the player hold the route in their
   * head between the checklist and the game. Kept here, beside the check that
   * proves the step, so the button and the proof cannot point at different
   * screens.
   */
  route: string
  /** The screen's own name, for the button's label. */
  where: string
  /** True once the save shows this was actually done after the course started. */
  check: (since: string) => boolean
}

type AnswerStep = {
  id: string
  kind: 'answer'
  label: string
  how: string
  question: string
  options: string[]
  answer: number
  /**
   * WHY the right answer is right, sent back only when the pick was wrong.
   * "Not quite" teaches nothing; the chapter's own numbers are the correction,
   * so the reason travels with the verdict instead of living in the prose above
   * for the player to re-read.
   */
  why: string
}

type Step = ActStep | AnswerStep

const count = (sql: string, args: unknown[] = []): number => {
  try {
    const row = db.prepare(sql).get(...args) as { c?: number } | undefined
    return Number(row?.c ?? 0)
  } catch {
    return 0
  }
}

/** Any activity of these kinds since `since`. */
const sawActivity = (kinds: string[], since: string): boolean =>
  count(
    `SELECT COUNT(*) c FROM activity_log WHERE datetime(created_at) > datetime(?) AND kind IN (${kinds.map(() => '?').join(',')})`,
    [since, ...kinds],
  ) > 0

/** A row written since `since` in a table with a timestamp column. */
const wroteSince = (table: string, col: string, since: string, where = ''): boolean =>
  count(`SELECT COUNT(*) c FROM ${table} WHERE datetime(${col}) > datetime(?) ${where}`, [since]) > 0

/**
 * THE list: ids, titles, order and money, plus each chapter's steps. The screen
 * renders these and holds only the prose, so a chapter cannot exist in two
 * places with two prices.
 *
 * The course is a thank-you, not a bank. $25 a chapter with a $50 graduation
 * bonus is $300 for the whole thing — deliberately under the $400 Resale Desk
 * and $500 Card Shop gates, so the course can never buy you a business. It
 * still pays for itself in product: about a booster bundle and a couple of
 * packs of whatever is in print.
 */
export const ACADEMY_CHAPTERS: AcademyChapter[] = [
  { id: 'economy', title: 'The economy: real prices and the clock', reward: 25, addedIn: '0.87.0' },
  { id: 'packs', title: 'Packs, pull tables and the ceremony', reward: 25, addedIn: '0.87.0' },
  { id: 'condition', title: 'Condition, inspection and grading', reward: 25, addedIn: '0.87.0' },
  { id: 'buying', title: 'Buying: the market and its seven venues', reward: 25, addedIn: '0.87.0' },
  { id: 'selling', title: 'Selling: the four counters and the fees', reward: 25, addedIn: '0.87.0' },
  { id: 'storage', title: 'Storage, capacity and the vault', reward: 25, addedIn: '0.87.0' },
  { id: 'collecting', title: 'Collecting: binders, sets, wishlist and trophies', reward: 25, addedIn: '0.87.0' },
  { id: 'events', title: 'Events: calendar, conventions and your own shows', reward: 25, addedIn: '0.87.0' },
  { id: 'business', title: 'The business: shop, staff, tax and credit', reward: 25, addedIn: '0.87.0' },
  { id: 'showbiz', title: 'Showbiz: streams, battles, live rooms and fakes', reward: 25, addedIn: '0.87.0' },
]

export const ACADEMY_BONUS = 50

/**
 * The app version the chapter list last changed at. A save that graduates is
 * stamped with it, so the next chapter added (with a newer `addedIn`) reads as
 * new. Bump this whenever ACADEMY_CHAPTERS changes.
 */
const COURSE_VERSION = '0.88.0'

/**
 * Every chapter's work. An `act` step is proved by the save, an `answer` step by
 * the server checking the choice — the client is told the options and whether
 * it passed, never the answer.
 */
const STEPS: Record<string, Step[]> = {
  economy: [
    {
      // The clock is the chapter's subject, so the step moves it rather than
      // watching it. Two real hours of waiting is not a step anyone can do now,
      // so the day pass is the way in — and the boundary it opens settles rent,
      // wages, the deals board and the market, which is the whole lesson. Catching
      // the clock turning on its own still counts, so a player with no fee in the
      // drawer is never locked out; nobody has to sit and watch a timer either.
      id: 'pass',
      kind: 'act',
      label: 'Move the clock — buy the day pass',
      route: 'home',
      where: 'Home dashboard',
      how: 'The clock in the top bar sells a day pass: it skips the wait to the next game day at the fee printed there, and the boundary settles rent, wages, the deals board and the market. Being there when the clock turns by itself counts too — the pass is just how you do it now.',
      check: (since) =>
        count("SELECT COUNT(*) c FROM activity_log WHERE datetime(created_at) > datetime(?) AND message LIKE '%Day pass%'", [since]) > 0 ||
        count('SELECT COUNT(*) c FROM game_state WHERE id = 1 AND datetime(last_tick_at) > datetime(?)', [since]) > 0,
    },
    {
      id: 'q',
      kind: 'answer',
      label: 'Answer the clock question',
      how: 'The chapter opens with the answer.',
      question: 'One game day is how much real time, by default?',
      options: ['12 hours', '2 hours', '24 hours'],
      answer: 1,
      why: 'A game day is two real hours unless you change the pace in Settings. The pass skips the wait to the next boundary — it does not make a day shorter.',
    },
  ],
  packs: [
    {
      id: 'rip',
      kind: 'act',
      label: 'Open a sealed pack',
      route: 'packs',
      where: 'Pack Shop',
      how: 'Pack Shop → any product (it rings up sealed), then Inventory → Sealed → OPEN 1.',
      check: (since) => wroteSince('pull_history', 'opened_at', since),
    },
    {
      id: 'q',
      kind: 'answer',
      label: 'Answer the pack question',
      how: 'You just saw it on the summary.',
      question: "A booster's shelf price buys you what, exactly?",
      options: ['The average value of the cards inside', 'A guaranteed hit', 'The wrapper — its contents can be worth less'],
      answer: 2,
      why: 'The shelf price is the wrapper’s own market value. The tile’s TYP and P50 show what the cards inside tend to be worth, and that is often less than the pack cost.',
    },
  ],
  condition: [
    {
      id: 'protect',
      kind: 'act',
      label: 'Protect or grade one copy',
      route: 'grading',
      where: 'Grading',
      how: 'Inventory → any row → sleeve or toploader it, or send a card to Grading. Bare cards wear while they sit.',
      check: (since) => wroteSince('inventory', 'protected_at', since) || sawActivity(['grading'], since),
    },
    {
      id: 'q',
      kind: 'answer',
      label: 'Answer the grading question',
      how: 'The numbers are in the chapter.',
      question: 'Which copy is worth paying a grader for?',
      options: ['A whitened $3 common', 'A clean, well-centred $40 card', 'Any copy without a sleeve'],
      answer: 1,
      why: 'Grading costs $18–$190 a card. The fee only comes back on a clean, mid-value card — whitening and ragged corners cap the grade whatever you pay.',
    },
  ],
  buying: [
    {
      id: 'buy',
      kind: 'act',
      label: 'Buy something at one of the venues',
      route: 'market',
      where: 'Market',
      how: 'Market (feed, auction, buylist shelves), a Deals venue, or a convention booth — any purchase counts.',
      check: (since) => sawActivity(['market', 'buy', 'ebay', 'auction', 'pawn', 'local', 'flea', 'estate', 'live'], since),
    },
    {
      id: 'q',
      kind: 'answer',
      label: 'Answer the venue question',
      how: 'The gate list is in the chapter.',
      question: 'The Deals hub itself opens at 3 sales. BidBay, inside it, needs how many?',
      options: ['8', '3', '12'],
      answer: 0,
      why: 'The venue gates run 3, 3, 5, 6, 8, 10 and 12 sales. BidBay is the eight-sale one, so the hub can open long before it does.',
    },
  ],
  selling: [
    {
      id: 'sell',
      kind: 'act',
      label: 'Sell one card',
      route: 'market/buylist',
      where: 'Buylist',
      how: 'Buylist pays now, a market listing pays later at your ask, a trading post pays in cards. Any of them counts.',
      check: (since) => wroteSince('sale_history', 'sold_at', since) || sawActivity(['sale'], since),
    },
    {
      id: 'q',
      kind: 'answer',
      label: 'Answer the counter question',
      how: 'It is the one you just used.',
      question: 'You want bulk gone today. Which counter pays fastest?',
      options: ['A stubborn market listing', 'Buylist', 'A trading post offer'],
      answer: 1,
      why: 'The Buylist pays under market the moment you hand the card over. A listing pays your ask, but only when someone takes it — and bulk rarely moves fast.',
    },
  ],
  storage: [
    {
      id: 'space',
      kind: 'act',
      label: 'Do one storage job',
      route: 'inventory/storage',
      where: 'Storage & Auctions',
      how: 'Rent a locker, move cards into a bulk box, or buy sleeves and toploaders. The storage and supplies counters both count.',
      check: (since) => sawActivity(['storage', 'supplies'], since),
    },
    {
      id: 'q',
      kind: 'answer',
      label: 'Answer the shelf question',
      how: 'Your overflow policy is the answer.',
      question: 'The free shelf holds 100 raw cards. What happens to the 101st?',
      options: ['It is sold automatically', 'It disappears', 'Whatever your overflow policy says'],
      answer: 2,
      why: 'Past the shelf, your overflow policy decides: scrap at your floor price, refuse the card at the door, or let it sit on the shelf as overflow.',
    },
  ],
  collecting: [
    {
      id: 'watch',
      kind: 'act',
      label: 'Put one card on your wishlist',
      route: 'collection/wishlist',
      where: 'Wishlist',
      how: 'Collection → Wishlist → add a target price. The agent watches the market for you.',
      check: (since) => wroteSince('wishlist', 'added_at', since),
    },
    {
      id: 'q',
      kind: 'answer',
      label: 'Answer the set question',
      how: 'Set Detail prints it for every set.',
      question: "A set's completion cost measures what?",
      options: [
        'The missing cards at today’s market',
        'The set’s original retail price',
        'What you already paid for your copies',
      ],
      answer: 0,
      why: 'Completion cost prices the cards you are missing at today’s market, so it moves with the market rather than with what you paid for the copies you have.',
    },
  ],
  events: [
    {
      id: 'venue',
      kind: 'act',
      label: 'Work one event or venue',
      route: 'events/calendar',
      where: 'Calendar',
      how: 'Attend a convention, host a card show, or trade at a local meetup or flea bin. Entry and hall fees are real, so pick the one your cash covers.',
      check: (since) => sawActivity(['convention', 'show', 'local', 'flea'], since),
    },
    {
      id: 'q',
      kind: 'answer',
      label: 'Answer the show question',
      how: 'A hosted show has three income lines.',
      question: 'A hosted card show pays for its hall from what?',
      options: ['Nothing — it always runs at a loss', 'The gate, the dealer tables and booth sales', 'The Card Shop’s rent'],
      answer: 1,
      why: 'A hosted show earns on three lines — the gate, the dealer tables and whatever your own booth sells — and the hall comes out of that.',
    },
  ],
  business: [
    {
      id: 'counter',
      kind: 'act',
      label: 'Do one business job',
      route: 'shop',
      where: 'Card Shop',
      how: 'Ring a shop sale or stock a case, run a repack, lend at the desk, or open the books and file tax. Any one counts.',
      check: (since) => sawActivity(['shop', 'finance', 'tax', 'loan', 'repack', 'lending', 'resale'], since),
    },
    {
      id: 'q',
      kind: 'answer',
      label: 'Answer the books question',
      how: 'The chapter names the beat.',
      question: 'When do rent, payroll and the rest draft?',
      options: ['Once a week on Mondays', 'Only when you open the shop', 'At every game-day boundary'],
      answer: 2,
      why: 'Rent, payroll and the rest draft at every game-day boundary — which is why the day clock in the top bar is the books’ real heartbeat.',
    },
  ],
  showbiz: [
    {
      id: 'audience',
      kind: 'act',
      label: 'Do one audience action',
      route: 'forum',
      where: 'Community',
      how: 'Post in Community, run a stream, play a pack battle, or submit a suspect card for authentication.',
      check: (since) => sawActivity(['forum', 'stream', 'battle', 'auth'], since),
    },
    {
      id: 'q',
      kind: 'answer',
      label: 'Answer the fake question',
      how: 'Authentication is cheaper than being wrong.',
      question: 'Until someone proves otherwise, a counterfeit in your collection is priced how?',
      options: ['Like the real card', 'At zero', 'At half the real card'],
      answer: 0,
      why: 'An unflagged fake is priced like the real card — the haircut only lands when a verdict flags it. Submitting a suspect costs less than being wrong.',
    },
  ],
}

const chKey = (id: string) => `academy:ch:${id}`
const paidKey = (id: string) => `academy:paid:${id}`
const answerKey = (chapter: string, step: string) => `academy:ans:${chapter}:${step}`
const SINCE_KEY = 'academy:since'
const STEP_KEY = (chapter: string, step: string) => `academy:step:${chapter}:${step}`
const WAIVED_KEY = (id: string) => `academy:waived:${id}`
const SKIP_KEY = (id: string) => `academy:skip:${id}`
const GRADUATED_KEY = 'academy:graduatedIn'
const BONUS_KEY = 'academy:bonus'
const CHECKLIST_MIGRATION = 'academy:migrated:checklist'

// The flag stores the AMOUNT paid, not a bare 1, so `earned` reports what the
// save was actually paid even after a retune. The first build wrote a bare '1'
// against a flat $150 a chapter and a $1,000 bonus; a legacy flag migrates to
// what that build paid, once, here.
const LEGACY_CHAPTER_PAY = 150
const LEGACY_BONUS = 1000

function amountIn(key: string, legacy: number): number {
  const raw = getMeta(key)
  if (!raw) return 0
  if (raw === '1') {
    setMeta(key, String(legacy))
    return legacy
  }
  return Number(raw) || 0
}

const paidAmount = (id: string) => amountIn(paidKey(id), LEGACY_CHAPTER_PAY)
const bonusPaid = () => amountIn(BONUS_KEY, LEGACY_BONUS)

/** Compare dotted versions: negative when a < b. */
function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0)
  const pb = b.split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * When this save started the course. Every action step counts only work done
 * AFTER it, so a long-running save cannot tick the whole course with history it
 * already had — the point is to do the thing, once, now.
 */
function courseStart(): string {
  const existing = getMeta(SINCE_KEY)
  if (existing) return existing
  const now = new Date().toISOString()
  setMeta(SINCE_KEY, now)
  return now
}

function addCash(amount: number) {
  db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(round2(amount))
}

/**
 * A chapter finished under the read-and-claim build has a completion flag and no
 * step evidence, and it never will: those steps did not exist when it was read.
 * Rather than showing a veteran a checklist they cannot satisfy (and a replay
 * would erase their progress to prove it), such a chapter is WAIVED once — its
 * steps are marked kept, with a note on the page saying when they were learned.
 *
 * This runs once per save. Any chapter that gains a completion flag after this
 * build must have earned it through the steps, because completeChapter refuses
 * otherwise, so a valid flag with no step evidence is exactly the legacy case.
 */
function migrateLegacy(): void {
  if (getMeta(CHECKLIST_MIGRATION) === '1') return
  for (const c of ACADEMY_CHAPTERS) {
    if (getMeta(chKey(c.id)) !== '1') continue
    for (const s of STEPS[c.id] ?? []) {
      setMeta(STEP_KEY(c.id, s.id), '1')
      if (s.kind === 'answer') setMeta(answerKey(c.id, s.id), '1')
    }
    setMeta(WAIVED_KEY(c.id), '1')
  }
  // A legacy graduate is not shown every chapter as "new": the course they read
  // was the whole course. Only chapters added after this build fire the mark.
  if (bonusPaid() > 0 && !getMeta(GRADUATED_KEY)) setMeta(GRADUATED_KEY, COURSE_VERSION)
  setMeta(CHECKLIST_MIGRATION, '1')
}

function stepStates(chapterId: string, since: string): AcademyStepState[] {
  const steps = STEPS[chapterId] ?? []
  return steps.map((s) => {
    if (s.kind === 'act') {
      const done = getMeta(STEP_KEY(chapterId, s.id)) === '1' ? true : s.check(since)
      if (done) setMeta(STEP_KEY(chapterId, s.id), '1')
      return { id: s.id, kind: s.kind, label: s.label, how: s.how, route: s.route, where: s.where, done }
    }
    return {
      id: s.id,
      kind: s.kind,
      label: s.label,
      how: s.how,
      question: s.question,
      options: s.options,
      done: getMeta(answerKey(chapterId, s.id)) === '1',
    }
  })
}

export function academyState(): AcademyState {
  migrateLegacy()
  const since = courseStart()
  const graduatedIn = getMeta(GRADUATED_KEY) ?? ''
  const chapters = ACADEMY_CHAPTERS.map((c) => {
    const steps = stepStates(c.id, since)
    const stepsDone = steps.filter((s) => s.done).length
    return {
      ...c,
      done: getMeta(chKey(c.id)) === '1',
      paid: paidAmount(c.id) > 0,
      steps,
      stepsDone,
      ready: steps.length > 0 && stepsDone === steps.length,
      waived: getMeta(WAIVED_KEY(c.id)) === '1',
      skipped: getMeta(SKIP_KEY(c.id)) === '1',
      fresh: graduatedIn !== '' && compareVersion(c.addedIn, graduatedIn) > 0,
    }
  })
  const paidBonus = bonusPaid()
  const bonusClaimed = paidBonus > 0
  const doneCount = chapters.filter((c) => c.done).length
  const earned = round2(ACADEMY_CHAPTERS.reduce((sum, c) => sum + paidAmount(c.id), 0) + paidBonus)
  return {
    chapters,
    doneCount,
    total: chapters.length,
    bonus: ACADEMY_BONUS,
    bonusClaimed,
    earned,
    offerTotal: round2(ACADEMY_CHAPTERS.reduce((sum, c) => sum + c.reward, 0) + ACADEMY_BONUS),
    allDone: doneCount === chapters.length,
    newSinceGraduation: chapters.filter((c) => c.fresh).length,
  }
}

/**
 * How many chapters are sitting there with every step ticked and no money paid
 * yet — the sidebar reads this for its badge, so a claimable reward is visible
 * from any screen instead of hiding behind the Academy tab.
 *
 * Memoised for fifteen seconds: /api/state is polled on that beat, the checks
 * are a dozen small queries, and the answer cannot change without the player
 * doing something that also asks the server anyway.
 */
let readyCache: { at: number; n: number } | null = null
export function academyReadyCount(): number {
  const now = Date.now()
  if (readyCache && now - readyCache.at < 15000) return readyCache.n
  migrateLegacy()
  const since = courseStart()
  let n = 0
  for (const c of ACADEMY_CHAPTERS) {
    if (getMeta(chKey(c.id)) === '1' || getMeta(SKIP_KEY(c.id)) === '1') continue
    const steps = stepStates(c.id, since)
    if (steps.length > 0 && steps.every((s) => s.done)) n++
  }
  readyCache = { at: now, n }
  return n
}

/**
 * Answer one question in a chapter. The answer index never leaves the server:
 * the client sends a choice and is told whether it was right — and, when it was
 * not, why the right one is right.
 */
export function answerStep(chapterId: string, stepId: string, choice: number):
  | { ok: true; correct: boolean; why?: string; state: AcademyState }
  | { ok: false; error: string } {
  const step = (STEPS[chapterId] ?? []).find((s) => s.id === stepId)
  if (!step) return { ok: false, error: 'No such step' }
  if (step.kind !== 'answer') return { ok: false, error: 'That step is not a question' }
  const correct = choice === step.answer
  if (correct) setMeta(answerKey(chapterId, stepId), '1')
  readyCache = null
  return { ok: true, correct, why: correct ? undefined : step.why, state: academyState() }
}

/**
 * "I already know this." A skipped chapter pays nothing and counts for nothing —
 * it is not progress, so it cannot shortcut the graduation bonus — but the page
 * stops asking. Reversible, because the page can be read again.
 */
export function setChapterSkipped(id: string, skipped: boolean):
  | { ok: true; state: AcademyState }
  | { ok: false; error: string; state: AcademyState } {
  const chapter = ACADEMY_CHAPTERS.find((c) => c.id === id)
  if (!chapter) return { ok: false, error: 'No such chapter', state: academyState() }
  if (getMeta(chKey(id)) === '1') return { ok: false, error: 'This chapter is already done', state: academyState() }
  setMeta(SKIP_KEY(id), skipped ? '1' : '')
  readyCache = null
  return { ok: true, state: academyState() }
}

/**
 * Mark one chapter complete. Refuses unless every step is ticked, and pays the
 * reward the first time only — the flag is separate from the completion flag on
 * purpose, because the page can be reset to run the course again and a course is
 * not a wage.
 */
export function completeChapter(id: string):
  | { ok: true; awarded: number; state: AcademyState }
  | { ok: false; error: string; state: AcademyState } {
  const chapter = ACADEMY_CHAPTERS.find((c) => c.id === id)
  if (!chapter) return { ok: false, error: 'No such chapter', state: academyState() }
  if (getMeta(SKIP_KEY(id)) === '1') {
    return { ok: false, error: 'This chapter is skipped — take the skip back to claim it.', state: academyState() }
  }
  const steps = stepStates(chapter.id, courseStart())
  const pending = steps.filter((s) => !s.done)
  if (pending.length > 0) {
    return {
      ok: false,
      error: `Not yet — ${pending.length} step${pending.length === 1 ? '' : 's'} left: ${pending.map((s) => s.label).join(', ')}.`,
      state: academyState(),
    }
  }
  let awarded = 0
  const wasDone = getMeta(chKey(chapter.id)) === '1'
  if (!wasDone) setMeta(chKey(chapter.id), '1')
  if (paidAmount(chapter.id) === 0) {
    setMeta(paidKey(chapter.id), String(chapter.reward))
    addCash(chapter.reward)
    awarded += chapter.reward
    logActivity('academy', `Collector's Academy — ${chapter.title}: $${chapter.reward.toFixed(2)} for the work.`, chapter.reward)
  }
  const allDone = ACADEMY_CHAPTERS.every((c) => getMeta(chKey(c.id)) === '1')
  if (allDone && bonusPaid() === 0) {
    setMeta(BONUS_KEY, String(ACADEMY_BONUS))
    setMeta(GRADUATED_KEY, COURSE_VERSION)
    addCash(ACADEMY_BONUS)
    awarded += ACADEMY_BONUS
    logActivity(
      'academy',
      `Collector's Academy — every chapter done. Graduation bonus $${ACADEMY_BONUS.toFixed(2)} paid; the whole hobby is on the page now.`,
      ACADEMY_BONUS,
    )
  }
  readyCache = null
  return { ok: true, awarded: round2(awarded), state: academyState() }
}

/**
 * Start the course again for a fresh run. Completion flags, answered questions,
 * skips, waivers and the work baseline clear — the paid flags do not, so
 * replaying costs nothing and earns nothing twice.
 */
export function resetAcademy(): { ok: true; state: AcademyState } {
  for (const c of ACADEMY_CHAPTERS) {
    setMeta(chKey(c.id), '')
    setMeta(WAIVED_KEY(c.id), '')
    setMeta(SKIP_KEY(c.id), '')
    for (const s of STEPS[c.id] ?? []) {
      setMeta(STEP_KEY(c.id, s.id), '')
      setMeta(answerKey(c.id, s.id), '')
    }
  }
  setMeta(BONUS_KEY, '')
  setMeta(SINCE_KEY, new Date().toISOString())
  readyCache = null
  return { ok: true, state: academyState() }
}
