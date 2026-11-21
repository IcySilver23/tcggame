// Last evidence route for the BW textured relief: a source with enough resolution
// to show the ridges, either as a raking-light still or a high-bitrate upload.
//
// Run: node tmp/fetch-4k-videos.mjs
//
// The 720p sweep (tmp/fetch-videos.mjs -> tmp/fetch-video-frames.mjs) found the card
// flat under one lamp but could not resolve the emboss: at that resolution the
// ridges blur into the artwork. So this pass looks for the same thing at 4K — card
// channels shoot 4K macros of holo surfaces specifically to show the texture — and
// probes Nicovideo, where Japanese collectors also upload card footage.
//
// This script only finds candidates and reports their available formats. Frame
// extraction stays in tmp/fetch-video-frames.mjs and measuring in
// tmp/measure-textured.ts.

import { execFileSync } from 'node:child_process'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
const HEADERS = { 'user-agent': UA, 'accept-language': 'ja,en;q=0.8' }
const PY = process.platform === 'win32' ? 'tmp/.venv/Scripts/python.exe' : 'tmp/.venv/bin/python'

const QUERIES = [
  'ポケカ 4K 開封',
  'ポケモンカード 4K ホロ',
  'BW73 ダークライ 4K',
  'ダークライ プロモ 4K',
  'テクスチャ ホロ ポケカ 4K',
  '超高画質 ポケカ 紹介',
  'BW プロモ テクスチャ 4K',
  'Pokemon card 4K holo close up',
  'Pokemon card texture macro 4K',
  'BW73 Darkrai 4K',
]

const seen = new Map()
for (const q of QUERIES) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`
  try {
    const res = await fetch(url, { headers: HEADERS })
    const text = await res.text()
    const ids = [...text.matchAll(/"videoId":"([\w-]{11})"/g)].map((m) => m[1])
    const titles = [...text.matchAll(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.){0,140})"/g)].map((m) =>
      m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\"/g, '"'),
    )
    const uniq = [...new Set(ids)]
    console.log(`== "${q}" HTTP ${res.status}: ${uniq.length} ids`)
    uniq.slice(0, 6).forEach((id, i) => {
      if (!seen.has(id)) seen.set(id, titles[i] ?? '?')
    })
  } catch (err) {
    console.log(`== "${q}" failed: ${err.message}`)
  }
}

// Rank the candidates by the words that suggest a close-up or a high-resolution
// master, because those are the only ones worth a download.
const scored = [...seen.entries()]
  .map(([id, title]) => ({
    id,
    title,
    score:
      (/\b4k\b|2160|uhd/i.test(title) ? 3 : 0) +
      (/高画質|超高画質|接写|マクロ|拡大|テクスチャ|ホロ|holo|texture|macro|close/i.test(title) ? 2 : 0) +
      (/BW|ダークライ|darkrai|プラズマ|team plasma/i.test(title) ? 1 : 0),
  }))
  .sort((a, b) => b.score - a.score)

console.log(`\n${scored.length} candidates, best first:\n`)
for (const s of scored.slice(0, 14)) console.log(`${s.score}  ${s.id}  ${s.title}`)

// What the two videos already measured actually offer, in case a better stream of
// the same footage exists.
for (const id of ['dFI0NbvBygY', 'eufTQfegapg']) {
  try {
    const out = execFileSync(PY, ['-m', 'yt_dlp', '-F', '--no-warnings', `https://www.youtube.com/watch?v=${id}`], {
      encoding: 'utf8',
    })
    const video = out
      .split('\n')
      .filter((l) => /\b(video|mp4|webm)\b/i.test(l) && /\d{3,4}x\d{3,4}/.test(l))
      .slice(0, 6)
    console.log(`\n== formats for ${id} (highest last-seen first):`)
    for (const line of video) console.log('   ' + line.trim().slice(0, 120))
  } catch (err) {
    console.log(`\n== formats for ${id} failed: ${String(err).slice(0, 120)}`)
  }
}

// Nicovideo: Japanese collectors upload card footage there too.
try {
  const res = await fetch(`https://www.nicovideo.jp/search/${encodeURIComponent('BW73 ダークライ')}`, {
    headers: HEADERS,
  })
  const text = await res.text()
  console.log(`\n== nicovideo HTTP ${res.status}, ${text.length} bytes, video ids: ${(text.match(/sm\d+/g) ?? []).length}`)
} catch (err) {
  console.log(`\n== nicovideo failed: ${err.message}`)
}
