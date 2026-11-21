// Fetch every card in a Pokumon promo_set through the WordPress REST API, with
// the taxonomy classes that carry the holofoil treatment.
//
//   node tmp/promo/rest-cards.mjs bw best-of-game
//
// Writes tmp/promo/rest/<set>.json — an array of { id, slug, title, classes }.
import fs from 'node:fs'
import path from 'node:path'

const OUT = 'tmp/promo/rest'
fs.mkdirSync(OUT, { recursive: true })

const sets = process.argv.slice(2)
if (!sets.length) {
  console.error('usage: node tmp/promo/rest-cards.mjs <promo_set-slug...>')
  process.exit(2)
}

const base = 'https://pokumon.com/wp-json/wp/v2'
const headers = { 'User-Agent': 'Mozilla/5.0 (research; tcggame foil catalogue)' }

async function getJson(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers })
    if (res.ok) {
      const total = Number(res.headers.get('x-wp-totalpages') || '1')
      return { body: await res.json(), totalPages: total }
    }
    if (res.status === 400) return { body: await res.json(), totalPages: 0 }
    await new Promise((r) => setTimeout(r, 400 * attempt))
  }
  throw new Error(`failed: ${url}`)
}

for (const slug of sets) {
  // Resolve the promo_set term id by slug.
  const { body: terms } = await getJson(`${base}/promo_set?slug=${encodeURIComponent(slug)}&_fields=id,slug,count`)
  const term = terms[0]
  if (!term) {
    console.log(`${slug}: no promo_set term`)
    continue
  }
  const cards = []
  let page = 1
  let totalPages = 1
  do {
    const { body, totalPages: pages } = await getJson(
      `${base}/card?promo_set=${term.id}&per_page=100&page=${page}&_fields=id,slug,title,class_list`,
    )
    totalPages = pages
    if (!Array.isArray(body)) break
    for (const card of body) {
      cards.push({
        id: card.id,
        slug: card.slug,
        title: card.title?.rendered ?? '',
        classes: card.class_list ?? [],
      })
    }
    page++
  } while (page <= totalPages)

  fs.writeFileSync(path.join(OUT, `${slug}.json`), JSON.stringify(cards, null, 2))
  console.log(`${slug}: ${cards.length} cards (taxonomy count ${term.count})`)
}
