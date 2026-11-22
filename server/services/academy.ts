// The Collector's Academy — the long, optional course that walks a player
// through every system in the game, one chapter at a time, and pays for the
// reading. The starting tutorial (tut:start) is a welcome; this is the manual.
//
// The chapter LIST and the money live here, not in the screen: the reward is
// server truth, so a chapter can only be paid once per save even if the page is
// reset, reloaded or replayed. The prose lives in src/views/Academy.tsx, because
// it is interface copy and it ships with the screen's own chunk.
import { db, getMeta, setMeta, logActivity } from '../lib/db'
import { round2 } from './market'

export type AcademyChapter = {
  id: string
  title: string
  /** Cash paid the first time this chapter is completed on this save. */
  reward: number
}

export type AcademyState = {
  chapters: { id: string; title: string; reward: number; done: boolean; paid: boolean }[]
  doneCount: number
  total: number
  bonus: number
  bonusClaimed: boolean
  /** Every dollar this course has paid out, chapter rewards and bonus. */
  earned: number
  /** What the whole course is worth before any of it is read. */
  offerTotal: number
  /** False while the save is still owed nothing — the page shows the offer. */
  allDone: boolean
}

/**
 * THE list: ids, titles, order and money. The screen renders these and holds
 * only the prose, so a chapter cannot exist in two places with two prices.
 *
 * The course is a thank-you, not a bank. $25 a chapter with a $50 graduation
 * bonus is $300 for the whole thing — deliberately under the $400 Resale Desk
 * and $500 Card Shop gates, so reading the manual can never buy a business. It
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

/** Paid once, when the last chapter is done. */
export const ACADEMY_BONUS = 50

const chKey = (id: string) => `academy:ch:${id}`
const paidKey = (id: string) => `academy:paid:${id}`
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

function addCash(amount: number) {
  db.prepare('UPDATE game_state SET cash = cash + ? WHERE id = 1').run(round2(amount))
}

export function academyState(): AcademyState {
  const chapters = ACADEMY_CHAPTERS.map((c) => ({
    ...c,
    done: getMeta(chKey(c.id)) === '1',
    paid: paidAmount(c.id) > 0,
  }))
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
 * Mark one chapter learned. Pays its reward the first time only — the flag is
 * separate from the completion flag on purpose, because the page can be reset
 * to read it again and a course is not a wage.
 */
export function completeChapter(id: string): { ok: true; awarded: number; state: AcademyState } | { ok: false; error: string } {
  const chapter = ACADEMY_CHAPTERS.find((c) => c.id === id)
  if (!chapter) return { ok: false, error: 'No such chapter' }
  let awarded = 0
  const wasDone = getMeta(chKey(chapter.id)) === '1'
  if (!wasDone) setMeta(chKey(chapter.id), '1')
  if (paidAmount(chapter.id) === 0) {
    setMeta(paidKey(chapter.id), String(chapter.reward))
    addCash(chapter.reward)
    awarded += chapter.reward
    logActivity('academy', `Collector's Academy — ${chapter.title}: $${chapter.reward.toFixed(2)} for the reading.`, chapter.reward)
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
 * Start the course again for a fresh read. Completion flags clear, the paid
 * flags do not — so replaying is free to do and earns nothing twice.
 */
export function resetAcademy(): { ok: true; state: AcademyState } {
  for (const c of ACADEMY_CHAPTERS) setMeta(chKey(c.id), '')
  setMeta(BONUS_KEY, '')
  return { ok: true, state: academyState() }
}
