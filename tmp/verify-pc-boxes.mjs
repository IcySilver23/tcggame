// Is each PriceCharting box value a sold price, and does it match the sold
// listings on its own page?
//
//   node tmp/verify-pc-boxes.mjs
//
// PriceCharting's sale table puts the completed-sale price in
// <td class="numeric"><span class="js-price">$…</span> and, when the seller had a
// live listing, its ask in <td class="numeric listed-price">. Reading only the
// first is what separates sales from asks — the first pass counted every dollar
// figure on the page, which is the mistake this checks for.
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', Accept: 'text/html' }

const SETS = [
  ['base1', 'pokemon-base-set'], ['base2', 'pokemon-jungle'], ['base5', 'pokemon-team-rocket'],
  ['gym2', 'pokemon-gym-challenge'], ['neo1', 'pokemon-neo-genesis'], ['neo2', 'pokemon-neo-discovery'],
  ['neo3', 'pokemon-neo-revelation'], ['ecard1', 'pokemon-expedition'], ['ecard2', 'pokemon-aquapolis'],
  ['ecard3', 'pokemon-skyridge'], ['ex5', 'pokemon-hidden-legends'], ['ex7', 'pokemon-team-rocket-returns'],
  ['ex8', 'pokemon-deoxys'], ['ex9', 'pokemon-emerald'], ['ex10', 'pokemon-unseen-forces'],
  ['ex12', 'pokemon-legend-maker'], ['ex14', 'pokemon-crystal-guardians'], ['ex16', 'pokemon-power-keepers'],
  ['dp2', 'pokemon-mysterious-treasures'], ['dp3', 'pokemon-secret-wonders'], ['dp5', 'pokemon-majestic-dawn'],
  ['dp6', 'pokemon-legends-awakened'], ['dp7', 'pokemon-stormfront'], ['pl1', 'pokemon-platinum'],
  ['pl2', 'pokemon-rising-rivals'], ['pl3', 'pokemon-supreme-victors'], ['pl4', 'pokemon-arceus'],
  ['hgss3', 'pokemon-undaunted'], ['hgss4', 'pokemon-triumphant'], ['bw11', 'pokemon-legendary-treasures'],
  ['xy2', 'pokemon-flashfire'], ['xy4', 'pokemon-phantom-forces'], ['xy9', 'pokemon-breakpoint'],
  ['base3', 'pokemon-fossil'], ['base4', 'pokemon-base-set-2'], ['gym1', 'pokemon-gym-heroes'],
  ['neo4', 'pokemon-neo-destiny'], ['base6', 'pokemon-legendary-collection'], ['ex13', 'pokemon-holon-phantoms'],
  ['ex15', 'pokemon-dragon-frontiers'], ['dp4', 'pokemon-great-encounters'], ['col1', 'pokemon-call-of-legends'],
  ['bw2', 'pokemon-emerging-powers'], ['bw3', 'pokemon-noble-victories'], ['bw4', 'pokemon-next-destinies'],
  ['bw5', 'pokemon-dark-explorers'], ['bw6', 'pokemon-dragons-exalted'], ['bw7', 'pokemon-boundaries-crossed'],
  ['bw8', 'pokemon-plasma-storm'], ['bw9', 'pokemon-plasma-freeze'], ['bw10', 'pokemon-plasma-blast'],
]

const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null)
const num = (s) => Number(s.replace(/,/g, ''))

const SALE_RE = /<tr id="[^"]*">\s*<td class="date">([^<]*)<\/td>[\s\S]*?<td class="numeric">\s*<span class="js-price"\s*>\$([0-9][0-9,]*\.[0-9]{2})<\/span>[\s\S]*?<\/tr>/g
const ASK_RE = /<td class="numeric listed-price">([\s\S]*?)<\/td>/g

for (const [setId, slug] of SETS) {
  const url = `https://www.pricecharting.com/game/${slug}/booster-box`
  let html = ''
  try {
    const res = await fetch(url, { headers: UA })
    html = await res.text()
  } catch {
    console.log(`${setId}\tFETCH-FAIL`)
    continue
  }
  const guide = html.match(/Full Price Guide[\s\S]*?Ungraded[\s\S]{0,200}?\$([0-9][0-9,]*\.[0-9]{2})/)
  const sales = [...html.matchAll(SALE_RE)].map((m) => ({ date: m[1].trim(), price: num(m[2]) }))
  const asks = [...html.matchAll(ASK_RE)].flatMap((m) => [...m[1].matchAll(/\$([0-9][0-9,]*\.[0-9]{2})/g)].map((x) => num(x[1])))
  const med = median(sales.map((s) => s.price))
  const g = guide ? num(guide[1]) : null
  const ratio = g && med ? g / med : null
  const verdict =
    g == null ? 'no-guide'
    : sales.length < 3 ? `few-sales(${sales.length})`
    : ratio >= 0.67 && ratio <= 1.5 ? 'sold-ok'
    : `disagrees(${ratio.toFixed(2)})`
  const asksDiffer = asks.length > 0 && med != null && asks.some((a) => a !== med)
  console.log(
    `${setId}\tguide=${g ?? '-'}\tsold=${sales.length}\tmedianSold=${med ?? '-'}\tratio=${ratio ? ratio.toFixed(2) : '-'}` +
      `\tnewest=${sales[0]?.date ?? '-'}\toldest=${sales[sales.length - 1]?.date ?? '-'}\tasks=${asks.length}${asksDiffer ? '(distinct)' : ''}\t${verdict}`,
  )
  await new Promise((r) => setTimeout(r, 1200))
}
