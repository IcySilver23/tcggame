// MEP Black Star Promos shipped with no art: the image service the catalogue
// uses (and pokemontcg.io behind it) answers most of them with the same
// card-back placeholder, which renders as a card with no face. TCGplayer has a
// photograph of nearly every one of those promos, so the catalogue takes its
// art from there.
//
//   node tmp/fill-mep-art.mjs            # rewrite server/catalog/local-releases.json
//   node tmp/fill-mep-art.mjs --dry-run  # report only, no write
//
// Only a card whose image IS the placeholder (or has none at all) is touched,
// so art a source actually provides is left alone and the script can be re-run
// as the set grows. The replacement is a TCGplayer photograph, not a scan.
import crypto from 'node:crypto'
import fs from 'node:fs'

const DRY = process.argv.includes('--dry-run')
const FILE = 'server/catalog/local-releases.json'
const GROUP = 24451 // TCGplayer: ME: Mega Evolution Promo (MEP)
// sha1[:12] of the 45551-byte card back the catalogue's image service returns
// for a promo it has no photograph of. Read from the live service, not guessed:
// it is the file 100 of these cards shared on 2026-11-23.
const PLACEHOLDER = 'cb391fa10c73'

const log = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const hash = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)
const cards = log.cards.filter((c) => c.set_id === 'mep')
if (cards.length === 0) throw new Error('no MEP cards in local-releases.json')

// 1. Which cards are wearing the card back (or nothing)?
const state = new Map()
let i = 0
const probe = async () => {
  while (i < cards.length) {
    const card = cards[i++]
    if (!card.image_small) { state.set(card.id, 'none'); continue }
    try {
      const res = await fetch(card.image_small)
      if (!res.ok) { state.set(card.id, 'err'); continue }
      state.set(card.id, hash(Buffer.from(await res.arrayBuffer())) === PLACEHOLDER ? 'placeholder' : 'art')
    } catch { state.set(card.id, 'err') }
  }
}
await Promise.all(Array.from({ length: 8 }, probe))
const needsArt = cards.filter((c) => state.get(c.id) === 'placeholder' || state.get(c.id) === 'none')
console.log(`needs art: ${needsArt.length}/${cards.length} (placeholder ${cards.filter((c) => state.get(c.id) === 'placeholder').length}, none ${cards.filter((c) => state.get(c.id) === 'none').length})`)
const unknown = cards.filter((c) => state.get(c.id) === 'err')
if (unknown.length > 0) console.log(`could not read: ${unknown.map((c) => c.id).join(', ')}`)

// 2. TCGplayer's own photographs for this group.
const CACHE = 'tmp/tcgcsv-mep-products.json'
let products = []
try {
  const res = await fetch(`https://tcgcsv.com/tcgplayer/3/${GROUP}/products`, { headers: { 'user-agent': 'curl/8.7.1' } })
  if (!res.ok) throw new Error(`tcgcsv answered ${res.status}`)
  products = (await res.json()).results ?? []
  fs.writeFileSync(CACHE, JSON.stringify({ results: products }, null, 1))
} catch (e) {
  if (!fs.existsSync(CACHE)) throw e
  console.log(`tcgcsv unreachable (${e.message}) — using the saved snapshot`)
  products = (JSON.parse(fs.readFileSync(CACHE, 'utf8')).results ?? [])
}
const byNumber = new Map()
for (const p of products) {
  const num = (p.extendedData ?? []).find((e) => e.displayName === 'Card Number')?.value
  // A number can carry two products (Cosmos Holo and Non-Holo printings): the
  // art is the same card either way, so the plain-looking name wins.
  if (num && (!byNumber.has(num) || /holo/i.test(byNumber.get(num).name))) byNumber.set(num, p)
}
console.log(`tcgplayer products: ${products.length} (${byNumber.size} numbered)`)

// 3. Point those cards at the photograph. A promo with no photograph anywhere
// (the Museum card is not sold there) loses its URL instead: an honest empty
// frame beats a card back pretending to be art.
let filled = 0
const missing = []
for (const card of needsArt) {
  const p = byNumber.get(card.number)
  if (!p) {
    missing.push(`${card.id} ${card.name}`)
    if (!DRY) { card.image_small = null; card.image_large = null }
    continue
  }
  if (DRY) { console.log(`  ${card.id} -> ${p.name} (${p.productId})`); filled++; continue }
  card.image_small = `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_200w.jpg`
  card.image_large = `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_in_1000x1000.jpg`
  filled++
}
console.log(`filled: ${filled}, no photograph: ${missing.length}${missing.length ? ' — ' + missing.join(', ') : ''}`)
if (DRY) process.exit(0)
fs.writeFileSync(FILE, JSON.stringify(log, null, 1) + '\n')
console.log('wrote', FILE)
