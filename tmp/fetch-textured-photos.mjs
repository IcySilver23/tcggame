// Fetch real photographs of the three BW textured promos (BW43, BW73, BW74).
//
// Run: node tmp/fetch-textured-photos.mjs
//
// Flat catalogue scans cannot show embossing: the official database images are
// lit diffusely, so the relief is invisible in them. Seller photographs are the
// one place a card is shot at an angle under a point light, with the surface
// catching glare — the only way to see whether a paper is textured and which way
// its ridges run.
//
// This script only downloads; tmp/measure-textured.ts does the measuring.

import fs from 'node:fs'
import path from 'node:path'

const OUT = 'tmp/refs-textured/photos'
fs.mkdirSync(OUT, { recursive: true })
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
const IMG = /https?:\/\/[^"'\s<>]+?\.(?:jpe?g|png|webp)/gi

const SHOPS = ['https://doubleinfinitygaming.com', 'https://knightanddaygames.com', 'https://www.evvgamingguild.com']
const PAGES = [
  'https://www.cardtrader.com/it-IT/cards/111006-landorus-holo-promo-bw43-bw-black-star-promos',
  'https://www.cardtrader.com/en/cards/111006-landorus-holo-promo-bw43-bw-black-star-promos',
]

const SEEN = new Set()
let saved = 0

function keep(url) {
  return (
    !/logo|icon|sprite|avatar|banner|flag|placeholder|payment|visa|mastercard|paypal/i.test(url) &&
    !/\.svg/i.test(url) &&
    !SEEN.has(url)
  )
}

async function grab(url, tag) {
  if (!keep(url)) return
  SEEN.add(url)
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA } })
    if (!r.ok) return
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 25000) return
    const ext = (url.split('?')[0].match(/\.(jpe?g|png|webp)$/i) ?? ['.jpg'])[0].toLowerCase()
    const name = `${tag}-${String(saved + 1).padStart(2, '0')}${ext}`
    fs.writeFileSync(path.join(OUT, name), buf)
    saved++
    console.log(`   saved ${name} (${buf.length} bytes) <- ${url.slice(0, 100)}`)
  } catch {
    /* a dead image is not a finding */
  }
}

for (const shop of SHOPS) {
  for (let page = 1; page <= 4; page++) {
    let data
    try {
      const r = await fetch(`${shop}/products.json?limit=250&page=${page}`, { headers: { 'user-agent': UA } })
      if (!r.ok) break
      data = await r.json()
    } catch {
      break
    }
    const products = data.products ?? []
    console.log(`== ${shop} page ${page}: ${products.length} products`)
    if (!products.length) break
    for (const p of products) {
      if (!/\bBW ?(43|73|74)\b/i.test(p.title)) continue
      console.log(`   ${p.title} — ${(p.images ?? []).length} image(s)`)
      for (const img of (p.images ?? []).slice(0, 4)) await grab(img.src, p.title.replace(/[^\w]+/g, '_').slice(0, 24))
    }
  }
}

for (const page of PAGES) {
  let html = ''
  try {
    const r = await fetch(page, { headers: { 'user-agent': UA } })
    html = await r.text()
    console.log(`== ${page}\n   HTTP ${r.status}, ${html.length} bytes`)
  } catch (err) {
    console.log(`== ${page}\n   failed: ${err.message}`)
    continue
  }
  const urls = [...new Set(html.match(IMG) ?? [])]
  console.log(`   ${urls.length} image urls`)
  for (const u of urls.slice(0, 14)) await grab(u, path.basename(page.split('/')[4] ?? 'page').slice(0, 12))
}

console.log(`\n${saved} new photographs in ${OUT}`)
