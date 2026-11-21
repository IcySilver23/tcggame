// Fetch candidate macro/oblique photographs of Shiny Vault cards.
//
// Run: node tmp/fetch-shiny-etch.mjs
//
// The etch only exists when a photo is shot under a point light at an angle: the
// official scans are lit diffusely and cannot show it. Japanese marketplace
// listings photograph shiny cards tilted precisely because the finish is the
// selling point, so Yahoo!オークション is the source. Paldean Fates' Japanese
// release is Shiny Treasure ex (sv4a) and Shining Fates' is Shiny Star V (s4a);
// the search also asks for the English product names in case a seller uses them.
//
// Flat catalogue scans are downloaded too, as CONTROLS: an estimator that finds a
// strong period on a diffuse scan is reading artwork, not a press.
//
// This script only downloads; tmp/measure-shiny-etch.py measures.

import fs from 'node:fs'
import path from 'node:path'

const OUT = 'tmp/refs-shiny'
fs.mkdirSync(path.join(OUT, 'photos'), { recursive: true })
fs.mkdirSync(path.join(OUT, 'controls'), { recursive: true })

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
const IMG = /https?:\/\/[^"'\s<>]+?\.(?:jpe?g|png|webp)/gi
const SEEN = new Set()
let saved = 0

async function grab(url, dir, tag) {
  if (SEEN.has(url)) return
  if (/logo|icon|sprite|avatar|banner|flag|placeholder|payment|visa|mastercard|paypal|banner/i.test(url)) return
  SEEN.add(url)
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA } })
    if (!r.ok) return
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 40000) return
    const ext = (url.split('?')[0].match(/\.(jpe?g|png|webp)$/i) ?? ['.jpg'])[0].toLowerCase()
    const name = `${tag}-${String(saved + 1).padStart(2, '0')}${ext}`
    fs.writeFileSync(path.join(OUT, dir, name), buf)
    saved++
    console.log(`   ${dir}/${name} (${Math.round(buf.length / 1024)} KB)`)
  } catch {
    /* a dead image is not a finding */
  }
}

const QUERIES = [
  'シャイニートレジャーex SAR',
  'シャイニートレジャーex リザードン',
  'シャイニースターV リザードンVMAX',
  'Shiny Treasure ex SAR',
  'Paldean Fates shiny',
  'Shining Fates shiny vault',
]

for (const q of QUERIES) {
  const url = `https://auctions.yahoo.co.jp/search/search?p=${encodeURIComponent(q)}&ei=UTF-8&n=40`
  let html = ''
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA } })
    html = await r.text()
    console.log(`== ${q}: HTTP ${r.status}, ${html.length} bytes`)
  } catch (err) {
    console.log(`== ${q}: failed ${err.message}`)
    continue
  }
  const urls = [...new Set(html.match(IMG) ?? [])].filter((u) => /auctions\.c\.yimg\.jp|auction\.cdn|i\.ebayimg/i.test(u))
  console.log(`   ${urls.length} listing photographs`)
  for (const u of urls.slice(0, 8)) await grab(u, 'photos', 'auction')
}

// Flat scans, as controls. The catalogue's own image host serves large fronts.
const SCANS = [
  'https://images.pokemontcg.io/sv4pt5/59_hires.png',
  'https://images.pokemontcg.io/sv4pt5/33_hires.png',
  'https://images.pokemontcg.io/sv4pt5/232_hires.png',
]
for (const u of SCANS) await grab(u, 'controls', 'scan')

console.log(`\n${saved} images in ${OUT}`)
