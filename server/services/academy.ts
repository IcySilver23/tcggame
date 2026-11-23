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
import { db, getMeta, setMeta, logActivity } from '../lib/db'
import { round2 } from './market'

export type AcademyStepState = {
  id: string
  kind: 'act' | 'answer'
  label: string
  /** Where to do it, or why the step is not ticked yet. */
  how: string
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
}

type ActStep = {
  id: string
  kind: 'act'
  label: string
  how: string
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
  { id: 'economy', title: 'The economy: real prices and the clock', reward: 25 },
  { id: 'packs', title: 'Packs, pull tables and the ceremony', reward: 25 },
  { id: 'condition', title: 'Condition, inspection and grading', reward: 25 },
  { id: 'buying', title: 'Buying: the market and its seven venues', reward: 25 },
  { id: 'selling', title: 'Selling: the four counters and the fees', reward: 25 },
  { id: 'storage', title: 'Storage, capacity and the vault', reward: 25 },
  { id: 'collecting', title: 'Collecting: binders, sets, wishlist and trophies', reward: 25 },
  { id: 'events', title: 'Events: calendar, conventions and your own shows', reward: 25 },
  { id: 'business', title: 'The business: shop, staff, tax and credit', reward: 25 },
  { id: 'showbiz', title: 'Showbiz: streams, battles, live rooms and fakes', reward: 25 },
]

export const ACADEMY_BONUS = 50

/**
 * Every chapter's work. An `act` step is proved by the save, an `answer` step by
 * the server checking the choice — the client is told the options and whether
 * it passed, never the answer.
 */
const STEPS: Record<string, Step[]> = {
  economy: [
    {
      id: 'clock',
      kind: 'act',
      label: 'Let one game day run',
      how: 'Two real hours a day, or a day pass from the header clock. Rent, wages and wear settle on that beat — come back after it turns.',
      check: (since) =>
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
    },
  ],
  packs: [
    {
      id: 'rip',
      kind: 'act',
      label: 'Open a sealed pack',
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
    },
  ],
  condition: [
    {
      id: 'protect',
      kind: 'act',
      label: 'Protect or grade one copy',
      how: 'Inventory → any row → sleeve or toploader it, or send a card to Grading. Bare cards wear while they sit.',
      check: (since) => wroteSince('inventory', 'protected_at', since) || sawActivity(['grading'], since),
    },
    {
      id: 'q',
      kind: 'answer',
      label: 'Answer the grading question',
      how: 'The numbers are in the chapter.',
      question: 'Which copy is worth paying a grader for?',
      options: [
        'A whitened $3 common',
        'A clean, well-centred $40 card',
        'Any copy without a sleeve',
      ],
      answer: 1,
    },
  ],
  buying: [
    {
      id: 'buy',
      kind: 'act',
      label: 'Buy something at one of the venues',
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
    },
  ],
  selling: [
    {
      id: 'sell',
      kind: 'act',
      label: 'Sell one card',
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
    },
  ],
  storage: [
    {
      id: 'space',
      kind: 'act',
      label: 'Do one storage job',
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
    },
  ],
  collecting: [
    {
      id: 'watch',
      kind: 'act',
      label: 'Put one card on your wishlist',
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
    },
  ],
  events: [
    {
      id: 'venue',
      kind: 'act',
      label: 'Work one event or venue',
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
    },
  ],
  business: [
    {
      id: 'counter',
      kind: 'act',
      label: 'Do one business job',
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
    },
  ],
  showbiz: [
    {
      id: 'audience',
      kind: 'act',
      label: 'Do one audience action',
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
    },
  ],
}

const chKey = (id: string) => `academy:ch:${id}`
const paidKey = (id: string) => `academy:paid:${id}`
const answerKey = (chapter: string, step: string) => `academy:ans:${chapter}:${step}`
const SINCE_KEY = 'academy:since'
const STEP_KEY = (chapter: string, step: string) => `academy:step:${chapter}:${step}`
const BONUS_KEY = 'academy:bonus'

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

function stepStates(chapterId: string, since: string): AcademyStepState[] {
  const steps = STEPS[chapterId] ?? []
  return steps.map((s) => {
    if (s.kind === 'act') {
      const done = getMeta(STEP_KEY(chapterId, s.id)) === '1' ? true : s.check(since)
      if (done) setMeta(STEP_KEY(chapterId, s.id), '1')
      return { id: s.id, kind: s.kind, label: s.label, how: s.how, done }
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
  const since = courseStart()
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
  }
}

/**
 * Answer one question in a chapter. The answer index never leaves the server:
 * the client sends a choice and is told only whether it was right.
 */
export function answerStep(chapterId: string, stepId: string, choice: number):
  | { ok: true; correct: boolean; state: AcademyState }
  | { ok: false; error: string } {
  const step = (STEPS[chapterId] ?? []).find((s) => s.id === stepId)
  if (!step) return { ok: false, error: 'No such step' }
  if (step.kind !== 'answer') return { ok: false, error: 'That step is not a question' }
  const correct = choice === step.answer
  if (correct) setMeta(answerKey(chapterId, stepId), '1')
  return { ok: true, correct, state: academyState() }
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
    addCash(ACADEMY_BONUS)
    awarded += ACADEMY_BONUS
    logActivity(
      'academy',
      `Collector's Academy — every chapter done. Graduation bonus $${ACADEMY_BONUS.toFixed(2)} paid; the whole hobby is on the page now.`,
      ACADEMY_BONUS,
    )
  }
  return { ok: true, awarded: round2(awarded), state: academyState() }
}

/**
 * Start the course again for a fresh run. Completion flags, answered questions
 * and the work baseline clear — the paid flags do not, so replaying costs
 * nothing and earns nothing twice.
 */
export function resetAcademy(): { ok: true; state: AcademyState } {
  for (const c of ACADEMY_CHAPTERS) {
    setMeta(chKey(c.id), '')
    for (const s of STEPS[c.id] ?? []) {
      setMeta(STEP_KEY(c.id, s.id), '')
      setMeta(answerKey(c.id, s.id), '')
    }
  }
  setMeta(BONUS_KEY, '')
  setMeta(SINCE_KEY, new Date().toISOString())
  return { ok: true, state: academyState() }
}
