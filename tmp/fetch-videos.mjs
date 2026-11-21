// Hunt YouTube (and check Mercari) for a video of a BW textured promo shot tilted,
// where the emboss throws highlights.
//
// Run: node tmp/fetch-videos.mjs
//
// Why video: the still photographs only exist at 900–1200 px, and a tilted card in
// one frame is foreshortened and hand-cropped. A video offers dozens of frames at
// one focal length under one light, so a tilt sweep can be measured frame by frame
// and the ridge pitch read from the frame where the card is most nearly square-on.
//
// This script only finds candidates. tmp/fetch-video-frames.mjs downloads and cuts
// frames, and tmp/measure-textured.ts does the measuring.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
const HEADERS = { 'user-agent': UA, 'accept-language': 'ja,en;q=0.8' }

const QUERIES = [
  'BW73 ダークライ プロモ',
  'ダークライ BW73 テクスチャ',
  'プラズマ団ギフトセット ダークライ 開封',
  'BW73 ダークライ ホロ',
  'ダークライ フルアート プロモ 紹介',
  'BW73 Darkrai promo textured',
  'Darkrai BW73 team plasma promo',
  'BW プロモ テクスチャ ホロ 比較',
]

const seen = new Map()

for (const q of QUERIES) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`
  try {
    const res = await fetch(url, { headers: HEADERS })
    const text = await res.text()
    // Each result carries a videoId and a title; pair them by walking the JSON in
    // order rather than trying to parse the whole page.
    const ids = [...text.matchAll(/"videoId":"([\w-]{11})"/g)].map((m) => m[1])
    const titles = [...text.matchAll(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.){0,140})"/g)].map((m) =>
      m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\"/g, '"'),
    )
    console.log(`== youtube "${q}" HTTP ${res.status}: ${ids.length} ids, ${titles.length} titles`)
    const uniq = [...new Set(ids)]
    uniq.slice(0, 6).forEach((id, i) => {
      if (!seen.has(id)) seen.set(id, titles[i] ?? '?')
    })
  } catch (err) {
    console.log(`== youtube "${q}" failed: ${err.message}`)
  }
}

console.log(`\n${seen.size} candidate videos\n`)
for (const [id, title] of seen) console.log(`${id}  ${title}`)

// Mercari: listings carry photographs only. Checked so the record can say so.
for (const q of ['ダークライ BW73', 'プラズマ団 ダークライ']) {
  try {
    const res = await fetch(`https://jp.mercari.com/search?keyword=${encodeURIComponent(q)}`, { headers: HEADERS })
    const text = await res.text()
    const video = /<video|\.mp4|"videoUrl"/i.test(text)
    console.log(`\n== mercari "${q}" HTTP ${res.status}, ${text.length} bytes, video markup: ${video ? 'yes' : 'none'}`)
  } catch (err) {
    console.log(`\n== mercari "${q}" failed: ${err.message}`)
  }
}
