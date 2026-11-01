const fs = require('fs')

const entry = {
  version: '0.6.2',
  date: '2026-11-01',
  title: 'Real prices, real packs',
  features: [
    'The market wakes up with the in-game day. Price history points, the simulated market and the real re-quote of everything you own or watch now run once per game day — 12 real hours at the default pace, 24 at the slow one — instead of on a 24-hour wall-clock timer that a 12-hour day could outrun. Portfolio values, watchlist alerts and every badge that reads a comp stop being a day stale, and a failed re-quote retries in 30 minutes instead of waiting for tomorrow.',
    'A researched floor under the price model. The comparable model valued collector pieces off the bulk cards they share a name with, which is how Tropical Wind sat at $60 and Ultimate Zone at 13 cents. Fifteen hand-checked values now override inference — Tropical Wind $829, Ultimate Zone $102, Beginning Door $12, Pikachu BW77 $12.84, Aquapolis Porygon $5.90 — each stamped with the month it was researched, so a stale number is visible instead of silent. Bulk that was already right (Sun & Moon basic energies at 20–56 cents) was left alone.',
    "The RGB Mews are chase cards again. 30th Celebration's three phantom secret rares — Mew R, G and B, no set symbol, collector numbers R/RGB — shipped mislabelled as Commons, so they priced like bulk at 86 cents and dealt from the common slot. They are 'RGB Rare' now, carry researched values of roughly $3,450–$3,950 raw NM (late 2026, down from a ~$6,000 October peak), and roll on their own dice at about 1 in 12,000 packs per colour. A display almost never holds one, and the pack shop's chase strip finally names them.",
    "Set completion reads like a dex. Every set in Collection → Sets carries its own bar: how many of that set's cards you own against the total including secret rares, with the set code stamped opposite and the bar going green when the set is finished. A new 'Most complete' sort floats the sets you are closest to closing to the top instead of sorting by release date.",
    'Packs deal their real cards. The rarity ladder only knew about fifteen labels and dropped everything else — Pikachu Rare, LEGEND, Trainer Gallery, ACE SPEC, the shiny tiers — into the common pool; packs were built from Pokémon only, so Trainers and Energy could never appear; and the special slot drew flat, making a Special Illustration Rare exactly as likely as a Double Rare. Every label has its rank now, Trainers and Energy are in the pools, and hits are weighted by real tier odds (SIR ≈ 4.9% against Double Rare ≈ 21%). 30th Celebration packs close on a guaranteed one of the 30 Pikachus — 200 of 200 test packs did — and Classic Collection packs are pure 30-card reprint subset, because that is what the product is. Honest caveat: the game\'s ten-card packs still include a hit every time, so absolute special rates run about double the real six-card product; the ratios between tiers are what match.',
  ],
}

const file = 'CHANGELOG.json'
const src = fs.readFileSync(file, 'utf8')
if (src.includes('"version": "0.6.2"')) throw new Error('0.6.2 entry already present')
const anchor = '  "entries": [\n'
if (!src.includes(anchor)) throw new Error('entries anchor missing')
const block = '    ' + JSON.stringify(entry, null, 2).split('\n').join('\n    ') + ',\n'
fs.writeFileSync(file, src.replace(anchor, anchor + block))
const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
console.log('changelog ok — entries:', parsed.entries.length, '| newest:', parsed.entries[0].version, parsed.entries[0].title)

for (const p of ['package.json', 'package-lock.json']) {
  if (!fs.existsSync(p)) continue
  const json = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (p === 'package-lock.json') {
    json.version = '0.6.2'
    if (json.packages && json.packages['']) json.packages[''].version = '0.6.2'
  } else {
    json.version = '0.6.2'
  }
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n')
  console.log('bumped', p, '->', json.version)
}
