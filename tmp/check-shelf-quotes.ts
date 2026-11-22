// The shelf's pricing contract: every in-print line sells at a sourced quote,
// every quote is what the shelf shows, and every modern booster answers the same
// question (its own single-pack market on 13 Nov 2026) instead of a model.
//
// Read-only against a COPY of the save.
import fs from 'node:fs'
import path from 'node:path'

const HOME = path.resolve('tmp/shelf-home')
fs.rmSync(HOME, { recursive: true, force: true })
fs.mkdirSync(path.join(HOME, 'data'), { recursive: true })
fs.copyFileSync(path.resolve('data/tcglife.db'), path.join(HOME, 'data', 'tcglife.db'))
process.env.TCGLIFE_HOME = HOME

const { db } = await import('../server/lib/db')
const sealed = await import('../server/services/sealed')
const { shelfPriceFor, unsellableReason } = await import('../server/catalog/sealed-evidence')

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? ` (${detail})` : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`) }
}

type Row = { id: string; name: string; kind: string; msrp: number }
const rows = (db.prepare('SELECT id, name, kind, msrp FROM pack_products ORDER BY id').all() as Row[]).filter(
  (r) => !unsellableReason(r.id),
)
const priced = rows.map((r) => ({ ...r, price: sealed.priceDetail(r.id), shelf: shelfPriceFor(r.id) }))
const inPrint = priced.filter((p) => !p.price.oop)

console.log('1. nothing in print is a model any more')
const modelled = inPrint.filter((p) => !p.shelf).map((p) => p.id)
check(`${inPrint.length} in-print lines, all quoted`, modelled.length === 0, modelled.join(', ') || 'no model left')

console.log('\n1b. the three rows RiftCompare could not price read from the mirror')
const mirror = [
  ['me2pt5-2pack-blister', 29.1],
  ['me2pt5-premium-poster', 136.93],
  ['sv9-half-display', 333.33],
] as const
for (const [id, want] of mirror) {
  const q = shelfPriceFor(id)
  check(`${id} is quoted`, q != null && Math.abs(q.market - want) < 0.02, q ? `$${q.market} ${q.asOf}` : 'no quote')
}

console.log('\n2. a quote is always what the shelf charges')
const drift = priced.filter((p) => p.shelf && Math.abs(p.price.market - p.shelf.market) > 0.02)
check(`${priced.filter((p) => p.shelf).length} quoted lines agree with their quote`, drift.length === 0, drift.map((p) => p.id).join(', ') || 'no drift')
const floored = priced.filter((p) => p.shelf && p.price.source !== (p.shelf.kind ?? 'tcgplayer'))
check('no quote is overridden by the pull-EV floor', floored.length === 0, floored.map((p) => `${p.id}:${p.price.source}`).join(', ') || 'all quoted')

console.log('\n3. every modern booster answers the same question')
const boosters = db.prepare("SELECT id FROM pack_products WHERE kind = 'booster'").all() as { id: string }[]
const inPrintBoosters = boosters.filter((b) => !sealed.priceDetail(b.id).oop)
const boosterQuotes = inPrintBoosters.map((b) => ({ id: b.id, q: shelfPriceFor(b.id) }))
check(`${inPrintBoosters.length} in-print boosters on the shelf`, inPrintBoosters.length >= 10, inPrintBoosters.map((b) => b.id).join(', '))
check('every one is quoted', boosterQuotes.every((b) => b.q != null), boosterQuotes.filter((b) => !b.q).map((b) => b.id).join(', ') || 'all quoted')
check(
  'every one uses the 13 Nov 2026 snapshot',
  boosterQuotes.every((b) => b.q?.asOf === '2026-11-13'),
  [...new Set(boosterQuotes.map((b) => b.q?.asOf))].join(', '),
)
check(
  'every one cites the same source',
  new Set(boosterQuotes.map((b) => b.q?.source.label)).size === 1,
  [...new Set(boosterQuotes.map((b) => b.q?.source.label))].join(' | '),
)
check(
  'the 30th pack is priced by that rule, not by its own',
  shelfPriceFor('me55-booster')?.source.label === shelfPriceFor('me6-booster')?.source.label,
  `me55 ${shelfPriceFor('me55-booster')?.market} vs me6 ${shelfPriceFor('me6-booster')?.market}`,
)

console.log('\n4. the sanity rails still hold')
// A quote may sit far over sticker (a scarce blister, a sold-out PC ETB); only a
// MODELLED line that far above its own sticker means the model has drifted.
const absurd = inPrint.filter((p) => !p.shelf && p.msrp > 0 && p.price.market / p.msrp > 6)
check('no in-print line is more than 6x its sticker', absurd.length === 0, absurd.map((p) => `${p.id}=${(p.price.market / p.msrp).toFixed(1)}x`).join(', ') || 'none')
const under = inPrint.filter((p) => p.msrp > 0 && p.price.market / p.msrp > 0 && p.price.market / p.msrp < 0.6)
check('no in-print line is under 60% of its sticker', under.length === 0, under.map((p) => `${p.id}=${(p.price.market / p.msrp).toFixed(2)}x`).join(', ') || 'none')

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass + fail} checks (${pass} ok, ${fail} failed)`)
process.exit(fail === 0 ? 0 : 1)
