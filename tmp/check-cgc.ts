// CGC must be a real service with its own grade ladder, and Pristine 10 must
// be a distinct, rarer rung with its own valuation. Runs against a COPY of the
// save under tmp/cgc-home.
//
//   npx tsx tmp/check-cgc.ts

import fs from 'node:fs'
import path from 'node:path'

let checks = 0
const fails: string[] = []
function ok(cond: unknown, label: string) {
  checks++
  if (!cond) fails.push(label)
}

const home = path.resolve('tmp/cgc-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'server'), { recursive: true })
fs.mkdirSync(path.join(home, 'data'), { recursive: true })
fs.copyFileSync('server/schema.sql', path.join(home, 'server', 'schema.sql'))
for (const suffix of ['', '-wal', '-shm']) {
  const src = path.join('data', `tcglife.db${suffix}`)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(home, 'data', `tcglife.db${suffix}`))
}
process.env.TCGLIFE_HOME = home

const { db } = await import('../server/lib/db')
const grading = await import('../server/services/grading')
const market = await import('../server/services/market')
const substats = await import('../server/services/substats')

try {
  const cgc = grading.GRADING_SERVICES.find((s) => s.company === 'CGC')
  ok(!!cgc, 'CGC is a grading company')
  ok(cgc?.id === 'cgc' && cgc?.name === 'CGC Cards Grading', 'CGC has its own service row')
  ok(cgc?.cost === 20 && cgc?.minRawValue === 15, 'CGC uses its $20 / $15 floor')
  ok(cgc?.daysMin === 6 && cgc?.daysMax === 10, 'CGC quotes its own turnaround')
  ok(grading.listServices().some((s) => s.id === 'cgc'), 'listServices publishes CGC')

  const odds = grading.oddsFor('NM', cgc?.gradeBias ?? 0, 0, 'CGC')
  const byGrade = Object.fromEntries(odds)
  const sum = odds.reduce((n, [, p]) => n + p, 0)
  ok(Math.abs(sum - 1) < 1e-9, 'CGC odds sum to 1')
  ok(odds.length === 4, 'CGC returns four rungs')
  ok(odds.every(([g, p]) => ['CGC10P', 'CGC10', 'CGC9', 'CGC8'].includes(g) && p > 0), 'CGC rungs are Pristine, Gem Mint, Mint and NM-MT')
  ok((byGrade.CGC10P ?? 0) > 0, 'Pristine 10 is reachable')
  ok((byGrade.CGC10P ?? 0) < (byGrade.CGC10 ?? 0), 'Pristine 10 is rarer than Gem Mint 10')
  const gem = (byGrade.CGC10P ?? 0) + (byGrade.CGC10 ?? 0)
  ok(Math.abs((byGrade.CGC10P ?? 0) / gem - 0.02) < 1e-9, 'an unknown copy uses the 2% average Pristine share')
  ok(grading.GRADE_LABELS.CGC10P === 'CGC PRISTINE 10', 'Pristine has its own reveal label')
  ok(grading.GRADE_LABELS.CGC10 === 'CGC GEM MINT 10', 'ordinary CGC 10 is Gem Mint')

  // Copy quality gates the gold label. A dead-centred, clean-edged, sharp copy
  // can be Pristine; a gem-grade copy with a real centering or whitening flaw
  // cannot. These are the same hidden stats the eye reads on inspection.
  const perfect = { centering: 50, whitening: 0, corners: 100 }
  const rough = { centering: 70, whitening: 40, corners: 30 }
  ok(grading.pristineFactor(perfect) === 1, 'a flawless copy earns the full Pristine factor')
  ok(grading.pristineFactor(rough) === 0, 'an off-centre, whitened, soft copy has no Pristine path')
  const perfectOdds = Object.fromEntries(grading.oddsFor('NM', cgc?.gradeBias ?? 0, 0, 'CGC', perfect))
  const roughOdds = Object.fromEntries(grading.oddsFor('NM', cgc?.gradeBias ?? 0, 0, 'CGC', rough))
  ok((perfectOdds.CGC10P ?? 0) > (byGrade.CGC10P ?? 0), 'a flawless copy beats the average Pristine chance')
  ok((roughOdds.CGC10P ?? 0) === 0, 'a flawed copy cannot roll Pristine')
  ok(Math.abs(((roughOdds.CGC10P ?? 0) + (roughOdds.CGC10 ?? 0)) - gem) < 1e-9, 'a flawed copy keeps the same total CGC gem chance, just not the gold label')

  // Put a real CGC 10 quote on a raw card with a real anchor, then prove the
  // Pristine fallback is a distinct premium rather than the same rung.
  const card = db
    .prepare(
      `SELECT c.id, c.name, c.number, s.name AS set_name
       FROM cards c JOIN sets s ON s.id = c.set_id
       WHERE EXISTS (SELECT 1 FROM price_records p WHERE p.card_id = c.id AND p.kind = 'tcgplayer' AND p.market >= 15)
       ORDER BY c.id LIMIT 1`,
    )
    .get() as { id: string; name: string; number: string; set_name: string } | undefined
  ok(!!card, 'the copied save has a gradeable card')
  if (card) {
    db.prepare(`DELETE FROM price_records WHERE card_id = ? AND variant IN ('CGC10', 'CGC10P')`).run(card.id)
    db.prepare(
      `INSERT INTO price_records (card_id, kind, variant, market, retrieved_at)
       VALUES (?, 'pc-graded', 'CGC10', 100, ?)`,
    ).run(card.id, new Date().toISOString())
    const cgc10 = market.gradedPriceOf(card.id, 'CGC10')
    const pristine = market.gradedPriceOf(card.id, 'CGC10P')
    ok(cgc10.usd > 0 && pristine.usd > 0, 'CGC 10 and Pristine both price')
    ok(Math.abs(pristine.usd / cgc10.usd - 1.45) < 0.01, 'Pristine falls back to a disclosed 1.45x CGC 10 estimate')
    ok(pristine.basis === 'estimated' && pristine.kind === null, 'the Pristine fallback is labelled estimated, not sold')
    ok(cgc10.basis === 'sold', 'PriceCharting CGC 10 stays sold-based')

    const advice = grading.adviceForCard(card.id, 'NM', cgc!, undefined, 100)
    ok(advice.serviceId === 'cgc' && advice.gemChance > 0, 'CGC advice reads its own odds')
    ok(advice.upside > 0, 'CGC advice values the Pristine upside')

    // Wire a real copy through the same advice and ROI paths the UI uses. An
    // off-centre/whitened copy cannot list Pristine as its upside; a clean copy
    // can. This proves the hidden copy stats reach the odds, not just oddsFor.
    const maxId = (db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM inventory').get() as { n: number }).n
    let roughId = 0
    let cleanId = 0
    for (let id = maxId + 1; id < maxId + 50000 && (!roughId || !cleanId); id++) {
      const factor = grading.pristineFactor(substats.trueStats(id))
      if (!roughId && factor === 0) roughId = id
      else if (!cleanId && factor >= 0.5) cleanId = id
    }
    ok(roughId > 0 && cleanId > 0, 'the seed has both a flawed and a strong CGC copy')
    if (roughId > 0 && cleanId > 0) {
      const insert = db.prepare(
        `INSERT INTO inventory (id, card_id, variant, condition, quantity, status, acquired_via, cost_basis, acquired_at)
         VALUES (?, ?, 'normal', 'NM', 1, 'collection', 'pack', 0, ?)`,
      )
      insert.run(roughId, card.id, new Date().toISOString())
      insert.run(cleanId, card.id, new Date().toISOString())
      const roughAdvice = grading.adviceForCard(card.id, 'NM', cgc!, roughId, 100)
      const cleanAdvice = grading.adviceForCard(card.id, 'NM', cgc!, cleanId, 100)
      const cgc10Net = Math.round((cgc10.usd * 0.9 - cgc!.cost) * 100) / 100
      const pristineNet = Math.round((pristine.usd * 0.9 - cgc!.cost) * 100) / 100
      ok(roughAdvice.pristineChance === null && cleanAdvice.pristineChance === null, 'uninspected copies hide their Pristine odds')
      ok(roughAdvice.upside === cgc10Net && cleanAdvice.upside === cgc10Net, 'uninspected copies only promise Gem Mint upside')
      ok(grading.bestRoiRung(card.id, 'NM', roughId)?.find((r) => r.serviceId === 'cgc')?.pristineChance === null, 'ROI hides Pristine before inspection')

      // Publish a read for each copy (what the UI gets after an inspection),
      // then the same advice must expose the copy-specific Pristine path.
      const seedRead = db.prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      seedRead.run(`substatRead:${roughId}`, JSON.stringify({ ...rough, printLine: 90 }))
      seedRead.run(`substatRead:${cleanId}`, JSON.stringify({ ...perfect, printLine: 90 }))
      const roughSeen = grading.adviceForCard(card.id, 'NM', cgc!, roughId, 100)
      const cleanSeen = grading.adviceForCard(card.id, 'NM', cgc!, cleanId, 100)
      ok(roughSeen.pristineChance === 0, 'the Grading UI sees 0% Pristine on a flawed inspected copy')
      ok((cleanSeen.pristineChance ?? 0) > 0, 'the Grading UI sees a real Pristine chance on a clean inspected copy')
      ok(roughSeen.upside === cgc10Net, 'a flawed copy targets Gem Mint 10, not an impossible Pristine')
      ok(cleanSeen.upside === pristineNet, 'a clean copy keeps Pristine as its top-end upside')
      const roughRoi = grading.bestRoiRung(card.id, 'NM', roughId)?.find((r) => r.serviceId === 'cgc')
      const cleanRoi = grading.bestRoiRung(card.id, 'NM', cleanId)?.find((r) => r.serviceId === 'cgc')
      ok(roughRoi?.pristineChance === 0, 'ROI math charges the flawed copy no Pristine odds')
      ok((cleanRoi?.pristineChance ?? 0) > 0, 'ROI math prices the clean copy with Pristine odds')
    }
  }
} finally {
  db.close()
  fs.rmSync(home, { recursive: true, force: true })
}

if (fails.length > 0) {
  console.error(`cgc checks failed (${fails.length}/${checks}):`)
  for (const f of fails) console.error('  ✗', f)
  process.exit(1)
}
console.log(`cgc checks passed (${checks})`)
