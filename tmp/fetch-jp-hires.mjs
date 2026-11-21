// Upgrade the Japanese listing photographs that showed the emboss to their largest
// available size, and collect every frame from those listings.
//
// Run: node tmp/fetch-jp-hires.mjs
//
// Why: tmp/fetch-jp-photos.mjs takes the gallery images the search results hand
// back, and Yahoo serves those at 900px on the long edge. An emboss whose period is
// a few pixels needs more than that, so this pass opens the same item pages and
// asks for the 1200px variant and, failing that, the unsized original. It only
// downloads; tmp/measure-textured.ts still does the measuring.

import fs from 'node:fs'
import path from 'node:path'

const OUT = 'tmp/refs-textured/jp-hi'
fs.mkdirSync(OUT, { recursive: true })
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
const HEADERS = { 'user-agent': UA, 'accept-language': 'ja,en;q=0.8' }

// Listings that photographed the card tilted: t1249971628 is the pair that shows
// the weave, x1238905421 a dark raking shot, o1244665200 a card on cork.
const ITEMS = ['t1249971628', 'x1238905421', 'o1244665200', 'm1246368532', 't1165449779']

/** Every plausible size of one gallery image, largest first. */
function variants(url) {
  const out = [url]
  for (const size of ['1200x1200', '1000x1000']) {
    out.push(url.replace(/i-img\d+x\d+-/i, `i-img${size}-`))
  }
  // The unsized original: drop the i-imgWxH- prefix entirely.
  out.push(url.replace(/i-img\d+x\d+-/i, 'i-img-'))
  out.push(url.replace(/-?\d+x\d+-/, '-'))
  return [...new Set(out)]
}

async function best(url) {
  let winner = null
  for (const candidate of variants(url)) {
    try {
      const res = await fetch(candidate, { headers: HEADERS })
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 40000) continue
      if (!winner || buf.length > winner.buf.length) winner = { candidate, buf }
      // A 1200px JPEG is usually 400–900 KB; stop once something big lands.
      if (buf.length > 350000) break
    } catch {
      /* a dead size is not a finding */
    }
  }
  return winner
}

let saved = 0
for (const id of ITEMS) {
  const url = `https://auctions.yahoo.co.jp/jp/auction/${id}`
  let text = ''
  try {
    const res = await fetch(url, { headers: HEADERS })
    text = await res.text()
    console.log(`== ${id} HTTP ${res.status}, ${text.length} bytes`)
  } catch (err) {
    console.log(`== ${id} failed: ${err.message}`)
    continue
  }
  const imgs = [
    ...new Set(
      (text.match(/https:\/\/[^"'\\ ]*yimg\.jp[^"'\\ ]*?\.(?:jpe?g|png|webp)/gi) ?? []).map((u) =>
        u.replace(/\\\//g, '/'),
      ),
    ),
  ].filter((u) => !/logo|sprite|banner|common\//i.test(u))
  console.log(`   ${imgs.length} gallery urls`)
  for (const img of imgs.slice(0, 6)) {
    const got = await best(img)
    if (!got) continue
    const name = `${id}-${String(saved + 1).padStart(2, '0')}.jpg`
    fs.writeFileSync(path.join(OUT, name), got.buf)
    saved++
    console.log(`   ${name} ${Math.round(got.buf.length / 1024)} KB <- ${got.candidate.slice(-70)}`)
  }
}
console.log(`\n${saved} photographs in ${OUT}`)
