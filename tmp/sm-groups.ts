const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json',
}
const res = (await (
  await fetch('https://tcgcsv.com/tcgplayer/3/groups', { headers: UA })
).json()) as {
  results: { groupId: number; name: string; abbreviation: string; publishedOn: string }[]
}
for (const g of res.results) {
  if (/sun|moon|guardian|burning|crimson|prism|forbidden|celestial|lost thunder|team up|unbroken|unified|cosmic|shining|dragon majesty|hidden fates|detective/i.test(g.name)) {
    console.log(JSON.stringify([g.groupId, g.abbreviation, g.name, g.publishedOn]))
  }
}
