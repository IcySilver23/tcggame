import { db, logActivity } from '../lib/db'
import { advanceClock, clockOffsetMs, clockSkips, noteClockSkip } from '../lib/clock'
import { gameDayEnd, gameDayHours, gameDayKey, gameDayMs, gameDayNumber } from '../lib/gameday'
import { markSkippedDay } from '../lib/skipped-days'

// ---------------------------------------------------------------------------
// THE DAY PASS — pay to skip the wait to the next game-day.
//
// A game-day rolls at 00:00/12:00 UTC (Settings can stretch it to 24h), and
// rent, payroll, interest, the deals board, the price tick, condition wear, the
// disaster roll and the save snapshot all wait for that boundary. The pass buys
// the WAIT, not the rolls: it moves the save's clock forward one game-day
// (lib/clock), so exactly the rollovers a real boundary would fire do fire —
// same day-key gates, same charges, nothing invented.
//
// THE TICKET IS FLAT AND THE BOARD PAYS WHEN USED. Pricing the ticket off the
// board it opened made an unlucky pass cost $2,000+ (the box lane draws from a
// pool whose top rows are five-figure vintage displays), which is not a price
// for skipping a wait — it is a price for a lottery ticket. Instead:
//
//   • the pass costs the same rate per hour of wait whatever the pace, so its
//     price follows the game-day length (see dayPassFee);
//   • the day it opened is marked (lib/skipped-days), and a Daily Deal claimed
//     on a marked day pays its own resale margin on top of its discounted
//     price — `(discount% − the resale desk's 10%) × shelf`.
//
// So a pass is affordable whenever a player wants to jump a boundary, and the
// board cannot be farmed at any discount: a claim costs discounted price plus
// its margin, which is exactly the shelf price minus the resale fee — the same
// number the resale desk pays. A 30% deal and a 12% deal are both worth zero.
// A board you never touch costs the ticket and nothing else.
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * What a day pass costs per real hour of wait bought. The ticket's job is to buy
 * the WAIT, so its price has to follow the wait: $50 for a 12-hour day is
 * $4.1667 an hour, and that rate is what keeps a skipped 2-hour day honest at
 * $8.33 and a 24-hour one at $100. The rate doubles the old $25 anchor because
 * $4.17 a skip came out cheaper than the pack a pass was meant to buy time for —
 * jumping the clock should be a purchase, not the cheapest thing in the shop.
 * There is still one rate for every pace, so a longer day costs more only
 * because it buys a longer wait, and the rolls it buys arrive either way.
 */
export const PASS_RATE_PER_HOUR = 50 / 12

/** Price of one pass at the save's current game-day length (or a given one). */
export function dayPassFee(hours: number = gameDayHours()): number {
  return round2(PASS_RATE_PER_HOUR * hours)
}

export type DaySnapshot = { number: number; resetsAt: string; offsetMs: number; skips: number }

function snapshot(): DaySnapshot {
  const row = db.prepare('SELECT created_at FROM game_state WHERE id = 1').get() as { created_at: string } | undefined
  const now = new Date()
  return {
    number: gameDayNumber(row?.created_at ?? now.toISOString(), now),
    resetsAt: gameDayEnd(now).toISOString(),
    offsetMs: clockOffsetMs(),
    skips: clockSkips(),
  }
}

export type SkipResult =
  | { ok: true; fee: number; cash: number; day: DaySnapshot; message: string }
  | { ok: false; fee: number; error: string }

/** Charge the flat fee, move the save's clock one game-day, mark the day it opened. */
export function skipToNextDay(): SkipResult {
  const row = db.prepare('SELECT cash FROM game_state WHERE id = 1').get() as { cash: number } | undefined
  const cash = round2(row?.cash ?? 0)
  const fee = dayPassFee()
  if (cash < fee) {
    return {
      ok: false,
      fee,
      error: `A day pass costs $${fee.toFixed(2)} — the drawer holds $${cash.toFixed(2)}.`,
    }
  }
  db.prepare('UPDATE game_state SET cash = cash - ? WHERE id = 1').run(fee)
  advanceClock(gameDayMs())
  noteClockSkip()
  // The day this pass opened: its deals pay their own resale margin when
  // claimed. The marker is written after the move, so it is the day the player
  // now stands in.
  const opened = gameDayKey()
  markSkippedDay(opened)
  const day = snapshot()
  logActivity(
    'system',
    `⏭ Day pass — $${fee.toFixed(2)} to skip the wait. It is now ${opened} (game day ${day.number}); rent, payroll, the deals board and the market rolled. Deals claimed on this day pay their own resale margin on top.`,
    -fee,
  )
  return {
    ok: true,
    fee,
    cash: round2(cash - fee),
    day,
    message: `Skipped a day for $${fee.toFixed(2)} — this is game day ${day.number}.`,
  }
}
