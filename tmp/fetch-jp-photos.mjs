// Hunt Japanese-market listings for the Team Plasma Gift Set / BW73 Darkrai.
//
// Run: node tmp/fetch-jp-photos.mjs
//
// Why Japan: the card shipped in the プラズマ団ギフトセット (Team Plasma Gift Set,
// 005/016) months before the English Team Plasma Box, and Japanese sellers
// routinely photograph holo cards tilted to show the surface — which is the only
// way an emboss becomes visible. Yahoo!オークション item pages carry several
// photographs per listing; Mercari keeps its originals at full resolution.
//
// This script only finds and downloads. tmp/measure-textured.ts does the measuring,
// and a Japanese print is evidence about the PAPER, not about the English printing.

import fs from 'node:fs'
import path from 'node:path'

const OUT = 'tmp/refs-textured/jp'
fs.mkdirSync(OUT, { recursive: true })
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
const HEADERS = { 'user-agent': UA, 'accept-language': 'ja,en;q=0.8' }

const QUERIES = [
  'ダークライ BW73',
  'ダークライ プラズマ団 ギフトセット',
  'プラズマ団ギフトセット ダークライ',
  'ダークライ プロモ フルアート',
  'BW73 ダークライ 美品',
]

const seenItems = new Set()
const seenImages = new Set()
let saved = 0

async function get(url, headers = HEADERS) {
  const res = await fetch(url, { headers })
  const text = await res.text()
  return { status: res.status, text }
}

async function grab(url, tag) {
  if (seenImages.has(url)) return
  seenImages.add(url)
  try {
    const res = await fetch(url, { headers: HEADERS })
    if (!res.ok) return
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 30000) return
    const ext = (url.split('?')[0].match(/\.(jpe?g|png|webp)$/i) ?? ['.jpg'])[0].toLowerCase()
    const name = `${tag}-${String(saved + 1).padStart(2, '0')}${ext}`
    fs.writeFileSync(path.join(OUT, name), buf)
    saved++
    console.log(`   saved ${name} (${buf.length} bytes) <- ${url.slice(0, 96)}`)
  } catch {
    /* a dead image is not a finding */
  }
}

// ---------------------------------------------------------------------------
// Yahoo!オークション
// ---------------------------------------------------------------------------

const yahooItems = new Set()
for (const q of QUERIES) {
  const url = `https://auctions.yahoo.co.jp/search/search?p=${encodeURIComponent(q)}&ei=UTF-8&n=30`
  try {
    const { status, text } = await get(url)
    const ids = [
      ...new Set(
        [...text.matchAll(/auctions\.yahoo\.co\.jp\/jp\/auction\/([a-z0-9]+)/gi)].map((m) => m[1]),
      ),
    ]
    console.log(`== yahoo "${q}" HTTP ${status}, ${text.length} bytes, ${ids.length} item ids`)
    for (const id of ids.slice(0, 8)) yahooItems.add(id)
  } catch (err) {
    console.log(`== yahoo "${q}" failed: ${err.message}`)
  }
}

console.log(`\n${yahooItems.size} Yahoo items to open`)
let opened = 0
for (const id of yahooItems) {
  if (opened >= 10) break
  const url = `https://auctions.yahoo.co.jp/jp/auction/${id}`
  try {
    const { status, text } = await get(url)
    // The gallery images live on yimg; the first is the listing's main photo.
    const imgs = [
      ...new Set(
        (text.match(/https:\/\/[^"'\\ ]*yimg\.jp[^"'\\ ]*?\.(?:jpe?g|png|webp)/gi) ?? []).map((u) =>
          u.replace(/\\\//g, '/'),
        ),
      ),
    ]
    const title = (text.match(/<title>([^<]{0,120})<\/title>/i) ?? [, ''])[1].trim()
    console.log(`== item ${id} HTTP ${status}: ${title.slice(0, 70)} — ${imgs.length} images`)
    opened++
    for (const img of imgs.slice(0, 4)) await grab(img, id)
  } catch (err) {
    console.log(`== item ${id} failed: ${err.message}`)
  }
}

// ---------------------------------------------------------------------------
// Mercari
// ---------------------------------------------------------------------------

for (const q of ['ダークライ BW73', 'プラズマ団 ダークライ']) {
  const url = `https://jp.mercari.com/search?keyword=${encodeURIComponent(q)}`
  try {
    const { status, text } = await get(url)
    const imgs = [
      ...new Set(
        (text.match(/https:\/\/[^"'\\ ]*mercdn\.net[^"'\\ ]*?\.(?:jpe?g|png|webp)/gi) ?? []).map((u) =>
          u.replace(/\\\//g, '/'),
        ),
      ),
    ]
    console.log(`== mercari "${q}" HTTP ${status}, ${text.length} bytes, ${imgs.length} image urls`)
    for (const img of imgs.slice(0, 6)) await grab(img.replace(/\/thumb\//, '/orig/'), 'mercari')
  } catch (err) {
    console.log(`== mercari "${q}" failed: ${err.message}`)
  }
}

console.log(`\n${saved} photographs in ${OUT}`)
