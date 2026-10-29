import { db, getMeta, setMeta } from '../lib/db'

// ---------------------------------------------------------------------------
// HIDDEN CONDITION SUB-STATS — two "NM" copies of the same card are not the
// same card. Every raw copy rolls four hidden traits at acquisition:
//
//   centering  — front/back borders (0–100, 50 = perfect)
//   whitening  — edge whitening (0 = pristine, 100 = snow-capped)
//   corners    — sharpness (0–100, 100 = razor)
//   printLine  — the horizontal print line of ink dots across the artwork
//                (0–100, 100 = the clean strike everyone wants; rare rolls
//                are a below-the-eye-line smudge that caps any grade)
//
// They stay hidden until you LOOK — an imperfect eye-training action whose
// read carries error that shrinks as you look at more copies (and as your
// grading results come back, which teach double). Together they make a
// gradeAdjustment (roughly −2..+0.7 grade-steps) that drives the grading
// engine, and a copyMultiplier — the sub-grade the MARKET actually pays for
// this exact copy once it's been seen (Condition Wars).
// ---------------------------------------------------------------------------

export type SubStats = { centering: number; whitening: number; corners: number; printLine: number; adjustment: number }

// ---------------------------------------------------------------------------
// The hidden seed — deterministic per copy, no columns needed
// ---------------------------------------------------------------------------

function hash32(n: number): number {
  let h = (n | 0) ^ 0x9e3779b9
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

function unit(n: number, salt: number): number {
  return hash32(n * 2654435761 + salt * 40503) / 4294967296
}

/** A roughly-normal 0..1 sample (mean 0.5, sd ~0.18) from three uniform draws. */
function bell(n: number, salt: number): number {
  return (unit(n, salt) + unit(n, salt + 17) + unit(n, salt + 53)) / 3
}

/** The hidden truth for one raw copy. */
export function trueStats(inventoryId: number): SubStats {
  const centering = Math.round(bell(inventoryId, 1) * 100)
  // Skew clean: most copies barely whiten; a cursed minority snow-caps.
  const whitening = Math.round(Math.pow(bell(inventoryId, 2), 3) * 100)
  const corners = Math.round(bell(inventoryId, 3) * 100)
  // Print lines are RARE and usually mild — 92% of copies roll one under 25.
  const pl = bell(inventoryId, 91)
  const printLine = pl >= 0.965 ? Math.round(12 + pl * 28) : Math.round(60 + pl * 40)
  return { centering, whitening, corners, printLine, adjustment: gradeAdjustment({ centering, whitening, corners, printLine }) }
}

/** Grade adjustment in grade-steps: ~−2..+0.7. Exposed for the grading engine. */
export function gradeAdjustment(s: { centering: number; whitening: number; corners: number; printLine?: number }): number {
  const centerPenalty = Math.abs(s.centering - 50) >= 30 ? -1 : Math.abs(s.centering - 50) >= 20 ? -0.5 : 0
  const whitenPenalty = s.whitening >= 60 ? -1.5 : s.whitening >= 35 ? -0.75 : s.whitening >= 18 ? -0.3 : 0
  const cornerBonus = s.corners >= 90 && s.whitening < 12 ? 0.5 : s.corners >= 82 ? 0.2 : 0
  const printPenalty = (s.printLine ?? 0) < 40 ? -1 : 0
  return centerPenalty + whitenPenalty + cornerBonus + printPenalty
}

// ---------------------------------------------------------------------------
// Copy quality — how the market pays for THIS copy, not just the band
// ---------------------------------------------------------------------------

/**
 * The buyer-perceived sub-grade drift for one copy, as a multiplier on the
 * card's condition-band value. 1 = the band average. Caps at ±8% — a real
 * collector pays more for a clean copy, but nobody mistakes it for a slab.
 */
export function copyMultiplier(inventoryId: number): number {
  const s = trueStats(inventoryId)
  const centerDrift = (50 - Math.abs(s.centering - 50)) / 50 // 0..1, 1 = perfect centering
  const cornerDrift = s.corners / 100 // 0..1
  // Whitening is pure damage: 0 = no drift, snow-capped = the full −8%.
  const whitenDrift = s.whitening / 100
  // Print line: the crown jewel (≥90) pays a premium; a smudge (≤40) is a defect
  // on top of its grade penalty.
  const printDrift = s.printLine >= 90 ? 0.3 : s.printLine >= 60 ? 0.1 : s.printLine <= 40 ? -0.5 : 0
  const raw = 0.08 * (0.45 * (centerDrift - 0.5) / 0.5 + 0.25 * (cornerDrift - 0.5) / 0.5 + 0.3 * printDrift - 0.8 * whitenDrift)
  return Math.max(0.92, Math.min(1.08, 1 + raw))
}

// ---------------------------------------------------------------------------
// Looking — an imperfect read whose error shrinks with practice
// ---------------------------------------------------------------------------

/**
 * Eye skill 0..1. Every inspect counts a little; every GRADED result teaches
 * double — gems and duds are the lessons that train an eye (and every grade
 * the sub-stats shifted feeds back: you learn what a 0-centering feels like
 * by breaking down the slabs that came back wrong).
 */
function eyeSkill(): number {
  const looks = Number(getMeta('eye:looks') ?? '0')
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN graded_grade = 'PSA10' THEN 1 ELSE 0 END) AS gems,
              SUM(CASE WHEN graded_grade = 'PSA7' THEN 1 ELSE 0 END) AS duds
       FROM inventory WHERE graded_grade IS NOT NULL`,
    )
    .get() as { n: number; gems: number | null; duds: number | null }
  const graded = row.n + ((row.gems ?? 0) + (row.duds ?? 0))
  return Math.min(1, (looks + 2 * graded) / 90)
}

/** Public read of the eye skill for UI (0..1). */
export function eyeSkillPublic(): number {
  return eyeSkill()
}

export type EyeRead = {
  stats: { centering: number; whitening: number; corners: number; printLine: number }
  error: number // 0..~24 — how many points of distrust the read carries (shown to the player)
  skill: number
  summary: string
}

/** A one-line plain-language verdict for a READ (or a truth, with flag). */
function summarize(read: { centering: number; whitening: number; corners: number; printLine: number }, trusted: boolean): string {
  const parts: string[] = []
  const c = read.centering
  if (c >= 45 && c <= 55) parts.push('dead-centered')
  else if (c >= 38 && c <= 62) parts.push('well-centered')
  else if (c < 20 || c > 80) parts.push('badly off-center')
  else parts.push(c < 50 ? 'top-heavy' : 'bottom-heavy')
  if (read.whitening >= 55) parts.push('heavy edge whitening')
  else if (read.whitening >= 25) parts.push('light whitening')
  else if (read.whitening <= 8) parts.push('clean edges')
  if (read.corners >= 88) parts.push('razor corners')
  else if (read.corners <= 30) parts.push('soft corners')
  if (read.printLine <= 40) parts.push('visible print line')
  else if (read.printLine >= 90) parts.push('clean strike')
  const tail = trusted ? '' : ' (read is shaky)'
  return parts.slice(0, 3).join(', ') + tail
}

/**
 * Inspect a copy: you see all four stats, ± error by your eye skill. The read
 * (never the truth) is persisted per inventory row and shown in the UI.
 */
export function inspect(inventoryId: number): EyeRead | { error: string } {
  const row = db
    .prepare(`SELECT id, graded_grade FROM inventory WHERE id = ?`)
    .get(inventoryId) as { id: number; graded_grade: string | null } | undefined
  if (!row) return { error: 'Card not found' }
  if (row.graded_grade) return { error: 'It is a slab — the grade is on the label' }
  const truth = trueStats(inventoryId)
  const skill = eyeSkill()
  const spread = Math.round(24 * (1 - skill))
  const jitter = (v: number) => Math.max(0, Math.min(100, Math.round(v + (Math.random() * 2 - 1) * spread)))
  const read = {
    centering: jitter(truth.centering),
    whitening: jitter(truth.whitening),
    corners: jitter(truth.corners),
    printLine: jitter(truth.printLine),
  }
  // Count the look, then persist the READ — this copy's face to the market.
  setMeta('eye:looks', String(Number(getMeta('eye:looks') ?? '0') + 1))
  setRead(inventoryId, read)
  const summary = summarize(read, spread > 4)
  return { stats: read, error: spread, skill: Math.round(skill * 100), summary }
}

// ---------------------------------------------------------------------------
// Persisted reads — the market pays for what has been SEEN
// ---------------------------------------------------------------------------

type StoredRead = { centering: number; whitening: number; corners: number; printLine: number }

const READ_KEY = (id: number) => `substatRead:${id}`

function setRead(inventoryId: number, read: StoredRead) {
  setMeta(READ_KEY(inventoryId), JSON.stringify(read))
}

function storedRead(inventoryId: number): StoredRead | null {
  const raw = getMeta(READ_KEY(inventoryId))
  if (!raw) return null
  try {
    const r = JSON.parse(raw) as StoredRead
    if (typeof r.centering !== 'number' || typeof r.whitening !== 'number' || typeof r.corners !== 'number') return null
    // Old saves predate the print-line read — treat missing as never-seen.
    if (typeof r.printLine !== 'number') return null
    return r
  } catch {
    return null
  }
}

/**
 * The market's drift for this copy: 1.0 until a look has been PUBLISHED
 * (list it, stock it, or offer it to a buylist with the read attached —
 * see revealWithRead). After that, buyers pay the copy's sub-grade.
 */
export function marketFactor(inventoryId: number): number {
  if (storedRead(inventoryId) == null) return 1
  return copyMultiplier(inventoryId)
}

/**
 * Reveal with the read attached: list/stock/consign/buylist use this so the
 * copy's sub-grade becomes public knowledge the moment it hits a market.
 */
export function revealWithRead(inventoryId: number): number {
  if (storedRead(inventoryId) == null) inspect(inventoryId)
  return marketFactor(inventoryId)
}

/** The player-facing read for UI (null = never inspected). */
export function readFor(inventoryId: number): { stats: StoredRead; summary: string } | null {
  const r = storedRead(inventoryId)
  if (!r) return null
  return { stats: r, summary: summarize(r, false) }
}

// ---------------------------------------------------------------------------
// Transactional read model for the UI (never reveals truth — only your look)
// ---------------------------------------------------------------------------

export function substatSummary(inventoryId: number) {
  const truth = trueStats(inventoryId)
  return {
    adjustment: truth.adjustment, // used by grading math; UI may not show it raw
  }
}
