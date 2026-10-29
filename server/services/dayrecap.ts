import { getMeta, setMeta, logActivity } from '../lib/db'
import { gameDayMs, gameDayKey, gameDayKeyStartMs } from '../lib/gameday'
import { round2 } from './market'
import { todayRolls } from './today'

// ---------------------------------------------------------------------------
// DAY RECAP — the morning-after line. Game days are UTC days, so at midnight
// every roll fires at once and the Today panel's checkboxes reset. This
// service keeps a rolling snapshot of the panel (fired states included) all
// day; at the first tick after midnight the final snapshot becomes
// yesterday's story in the feed — what fired, what each roll cost, and the
// new day number — posted once, before the new day's systems stamp over it.
// ---------------------------------------------------------------------------

function dayKey(): string {
  return gameDayKey() // a game-day is 12 real hours — recap rolls at 00:00/12:00 UTC
}

let lastCheck = 0

export function dayRecapTick(): void {
  const now = Date.now()
  if (now - lastCheck < 30_000) return
  lastCheck = now

  const today = dayKey()
  const pendingDay = getMeta('dayrecap:pendingDay')
  const pendingRolls = getMeta('dayrecap:pendingRolls')

  if (!pendingDay || pendingDay === today) {
    // Capture/refresh phase: keep the snapshot current for the running day —
    // the last write before midnight carries the fullest fired-state picture.
    try {
      setMeta('dayrecap:pendingDay', today)
      setMeta('dayrecap:pendingRolls', JSON.stringify(todayRolls().rolls))
    } catch { /* systems not ready (fresh save) — next tick retries */ }
    return
  }

  // Rollover: pendingDay is in the past. Post the recap only when the pending
  // day is exactly yesterday — a longer gap means the save sat closed, and a
  // three-day-old "morning after" is nobody's morning.
  const gapDays = Math.round((gameDayKeyStartMs(today) - gameDayKeyStartMs(pendingDay)) / gameDayMs())
  let newDayNumber = 0
  try { newDayNumber = todayRolls().dayNumber } catch { /* keep 0 — skip post */ }
  if (gapDays === 1 && pendingRolls && newDayNumber > 0) {
    try {
      const rolls = JSON.parse(pendingRolls) as { kind: string; label: string; amount: number | null; cadence: string; firedKey: string }[]
      const daily = rolls.filter((r) => r.cadence === 'daily')
      const parts: string[] = []
      let total = 0
      for (const r of daily.slice(0, 6)) {
        const name = r.label.replace(/^💾 /, '').toLowerCase()
        if (r.firedKey === '1') {
          if (r.amount != null && r.amount > 0) {
            total += r.amount
            parts.push(`${name} -$${r.amount.toFixed(2)} ✓`)
          } else {
            parts.push(`${name} ✓`)
          }
        } else {
          parts.push(`${name} didn't roll`)
        }
      }
      if (daily.length > 6) parts.push(`+${daily.length - 6} more`)
      const totalBit = total > 0 ? ` Day cost: -$${round2(total).toFixed(2)}.` : ''
      logActivity('system', `🌅 Day ${newDayNumber} begins. ${pendingDay.slice(0, 10)}'s rolls: ${parts.join(' · ')}.${totalBit}`)
    } catch { /* corrupt snapshot — reset below, never crash the request */ }
  }

  // Reset capture for the new day, whether or not a recap posted.
  setMeta('dayrecap:pendingDay', today)
  try { setMeta('dayrecap:pendingRolls', JSON.stringify(todayRolls().rolls)) } catch { /* next tick */ }
}
