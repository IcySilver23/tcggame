// 0.94.3 said the window had not taken focus. The repro never showed that —
// only that no mouse event reached the page. Correct the entry in place.
import fs from 'node:fs'

const log = JSON.parse(fs.readFileSync('CHANGELOG.json', 'utf8'))
const entry = log.entries.find((e) => e.version === '0.94.3')
if (!entry) throw new Error('0.94.3 entry missing')

entry.highlights[0] =
  'One card / A stack answers a click again \u2014 the press change was chasing a click that never reached the page at all.'

entry.features[0] = entry.features[0]
  .replace(
    'A click that never reaches the page cannot be a handler\u2019s fault \u2014 the window had not taken focus yet, and any other button behaved the same until the page was reloaded.',
    'A click that never reaches the page cannot be a handler\u2019s fault: the input was lost somewhere above the page, where this build cannot see it, and a reload brought the same click back. What the repro proves is where the click did NOT go \u2014 the page \u2014 not what stopped it.',
  )
  .replace('it is disabled while a request is in flight as before', 'it is disabled while a request is in flight, as before')

fs.writeFileSync('CHANGELOG.json', JSON.stringify(log, null, 2) + '\n')
console.log(entry.highlights[0])
console.log('---')
console.log(entry.features[0].slice(-420))
