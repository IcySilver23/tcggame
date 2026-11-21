// Download the specific images that might show a real Mirage card under a light.
//
// Run: node tmp/fetch-mirage-targets.mjs
//
// The general crawl (tmp/fetch-mirage-photos.mjs) found only flat catalogue images. These
// are the named ones: PokéBeach's 2022 reveal of the Scarlet & Violet promos, its GIFs of
// the same card tilting, Bulbapedia's Paldea Collection photograph, and folio.fyi's
// Greavard. Only images that answer 200 are kept.

import fs from 'node:fs'
import path from 'node:path'

const OUT = 'tmp/refs-mirage/targets'
fs.mkdirSync(OUT, { recursive: true })
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

const URLS = [
  'https://www.pokebeach.com/news/2022/12/Sprigatito-Set-Promo.jpg',
  'https://www.pokebeach.com/news/2022/12/Fuecoco-Set-Promo.jpg',
  'https://www.pokebeach.com/news/2022/12/Quaxly-Set-Promo.jpg',
  'https://www.pokebeach.com/news/2022/12/Sprigatito-Paldea-Collection.jpg',
  'https://www.pokebeach.com/news/2022/12/Fuecoco-Paldea-Collection.jpg',
  'https://www.pokebeach.com/news/2022/12/Quaxly-Paldea-Collection.jpg',
  'https://www.pokebeach.com/news/2022/12/Sprigatito-Holo.gif',
  'https://www.pokebeach.com/news/2022/12/Fuecoco-Promo.gif',
  'https://www.pokebeach.com/news/2022/12/Quaxly-Promo.gif',
  'https://archives.bulbagarden.net/wiki/Special:Redirect/file/Paldea_Collection_Sprigatito.jpg',
  'https://archives.bulbagarden.net/media/upload/9/9c/Paldea_Collection_Sprigatito.jpg',
]

let saved = 0
for (const url of URLS) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://www.pokebeach.com/' }, redirect: 'follow' })
    console.log(`HTTP ${r.status} ${url}`)
    if (!r.ok) continue
    const buf = Buffer.from(await r.arrayBuffer())
    const type = r.headers.get('content-type') ?? ''
    if (!/image/.test(type) || buf.length < 20000) {
      console.log(`   skipped: ${type || 'no type'}, ${buf.length} bytes`)
      continue
    }
    const ext = (/\.(jpe?g|png|gif)$/i.exec(new URL(r.url).pathname) ?? ['.jpg'])[0].toLowerCase()
    const name = path.basename(new URL(r.url).pathname, ext) + ext
    fs.writeFileSync(path.join(OUT, name), buf)
    saved++
    console.log(`   saved ${name} (${(buf.length / 1024).toFixed(0)} KB)`)
  } catch (err) {
    console.log(`failed ${url}: ${err.message}`)
  }
}

// folio.fyi writes its figure captions next to the image, so ask the page which file is
// the Greavard and which is the Mirage comparison.
try {
  const r = await fetch('https://folio.fyi/blog/pokemon-holo-patterns', { headers: { 'user-agent': UA } })
  const html = await r.text()
  const urls = [...new Set(html.match(/https:\/\/cdn\.sanity\.io\/[^"'\s)]+/g) ?? [])]
  for (const u of urls) {
    const at = html.indexOf(u)
    const near = html.slice(Math.max(0, at - 600), at + 200)
    if (!/greavard|mirage/i.test(near)) continue
    const res = await fetch(u, { headers: { 'user-agent': UA } })
    if (!res.ok) continue
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 20000) continue
    const name = `folio-${path.basename(new URL(u).pathname).slice(0, 10)}.jpg`
    fs.writeFileSync(path.join(OUT, name), buf)
    saved++
    console.log(`   saved ${name} (folio caption mentions Greavard/Mirage)`)
  }
} catch (err) {
  console.log(`folio pass failed: ${err.message}`)
}

console.log(`\n${saved} files in ${OUT}`)
