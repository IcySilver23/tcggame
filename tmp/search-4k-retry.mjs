// Retry the 4K/high-resolution YouTube search with backoff, and rank the hits.
//
// Run: node tmp/search-4k-retry.mjs
//
// The first attempt at these queries failed at the network layer ("fetch failed")
// after a long afternoon of YouTube requests, so each query is retried with a pause
// and the failures are reported rather than silently swallowed. Ranking prefers
// titles that promise a 4K master or a close-up, because those are the only ones
// worth downloading at this point.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
const HEADERS = { 'user-agent': UA, 'accept-language': 'ja,en;q=0.8' }

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function search(q) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS })
      const text = await res.text()
      const ids = [...new Set([...text.matchAll(/"videoId":"([\w-]{11})"/g)].map((m) => m[1]))]
      const titles = [...text.matchAll(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.){0,140})"/g)].map((m) =>
        m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\"/g, '"'),
      )
      if (!ids.length) throw new Error('no ids in page')
      console.log(`== "${q}" HTTP ${res.status}: ${ids.length} ids`)
      return ids.map((id, i) => ({ id, title: titles[i] ?? '?' }))
    } catch (err) {
      console.log(`== "${q}" attempt ${attempt} failed: ${err.message}`)
      if (attempt < 3) await sleep(2500 * attempt)
    }
  }
  return []
}

const seen = new Map()
for (const q of QUERIES) {
  for (const hit of await search(q)) if (!seen.has(hit.id)) seen.set(hit.id, hit.title)
  await sleep(800)
}

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

console.log(`\n${scored.length} candidates total; the best-scoring are:\n`)
for (const s of scored.filter((s) => s.score >= 3).slice(0, 16)) console.log(`${s.score}  ${s.id}  ${s.title.slice(0, 96)}`)
