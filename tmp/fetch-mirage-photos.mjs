// Fetch candidate photographs/animations of the Scarlet & Violet Mirage paper.
//
// Run: node tmp/fetch-mirage-photos.mjs
//
// A flat catalogue scan cannot show Mirage: the foil is a reflection, so it needs a
// card shot at an angle under a point light. The candidates here are:
//
//   - PokéBeach's December 2022 reveal, whose GIFs animate the real sheen;
//   - Bulbapedia's Holofoil page, which carries "Three Mirage Holofoil cards displayed
//     in a Paldea Collection" — a product photograph, not a scan;
//   - folio.fyi's pattern guide, which shows "a real mirage holo card: Greavard".
//
// Downloads only; tmp/measure-mirage.ts does the measuring. The images are copyrighted
// and several hundred KB each, so they stay in tmp/ and are never committed.

import fs from 'node:fs'
import path from 'node:path'

const OUT = 'tmp/refs-mirage/photos'
fs.mkdirSync(OUT, { recursive: true })
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
const IMG = /https?:\/\/[^"'\s<>]+?\.(?:jpe?g|png|webp|gif)/gi

const PAGES = [
  'https://www.pokebeach.com/2022/12/scarlet-violet-holo-effects-revealed-includes-foil-card-borders',
  'https://www.pokebeach.com/forums/threads/scarlet-violet-holo-effects-revealed-includes-foil-card-borders.153565',
  'https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)',
  'https://folio.fyi/blog/pokemon-holo-patterns',
]

const SEEN = new Set()
let saved = 0

function keep(url) {
  return (
    !/logo|icon|sprite|avatar|banner|flag|placeholder|payment|visa|mastercard|paypal|emoji/i.test(url) &&
    !/\.svg/i.test(url) &&
    !SEEN.has(url)
  )
}

async function grab(url, tag) {
  if (!keep(url)) return
  SEEN.add(url)
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://www.pokebeach.com/' } })
    if (!r.ok) return
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 12000) return
    const ext = (url.split('?')[0].match(/\.(jpe?g|png|webp|gif)$/i) ?? ['.jpg'])[0].toLowerCase()
    const name = `${tag}-${String(saved + 1).padStart(2, '0')}${ext}`
    fs.writeFileSync(path.join(OUT, name), buf)
    saved++
    console.log(`   saved ${name} (${(buf.length / 1024).toFixed(0)} KB) <- ${url.slice(0, 110)}`)
  } catch {
    /* a dead image is not a finding */
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
  const tag = page.includes('pokebeach')
    ? 'pb'
    : page.includes('bulbapedia')
      ? 'bulba'
      : 'folio'
  // Prefer images whose URL or surrounding markup mentions Mirage / holo.
  const urls = [...new Set(html.match(IMG) ?? [])].filter(
    (u) => /mirage|holo|greavard|spri|fuec|quax|sheen|foil/i.test(u) || tag !== 'pb',
  )
  console.log(`   ${urls.length} candidate image urls`)
  for (const u of urls.slice(0, 20)) await grab(u, tag)
}

console.log(`\n${saved} new files in ${OUT}`)
