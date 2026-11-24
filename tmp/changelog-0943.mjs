// 0.94.3: the press experiment is reverted; the totals fix stands.
import fs from 'node:fs'

const log = JSON.parse(fs.readFileSync('CHANGELOG.json', 'utf8'))

// 0.94.2 keeps one line, and it is the one that survived the experiment.
const prev = log.entries.find((e) => e.version === '0.94.2')
if (prev) {
  prev.highlights = [
    'A queued pile no longer counts as a listing, so the night\u2019s sell-through holds steady while it waits for the hammer.',
  ]
}

log.entries = log.entries.filter((e) => e.version !== '0.94.3')
log.entries.unshift({
  version: '0.94.3',
  date: '2026-11-24',
  title: 'The switch was never the problem',
  highlights: [
    'One card / A stack answers a click again \u2014 the press change went looking for a bug that lives in the window, not in the sell panel.',
    'A queued pile still stays out of the block\u2019s totals, so the sell-through does not dip while it waits for the hammer.',
    'The binder list stopped reserving an empty height, and the switch is disabled while a request is in flight, as it was before.',
  ],
  features: [
    '0.94.2 made the sell panel\u2019s mode switch act on pointerdown as well as click, on the theory that the binder\u2019s first page was landing under the cursor and swallowing the click. It was not. A test page that presses the switch, lets a hundred rows arrive, then releases shows the click surviving whenever the content grows BELOW the switch \u2014 which is where the binder list is \u2014 and only breaking when the growth shoves the switch down the page between the press and the release. The sell panel\u2019s switch sits at the same pixel before and after the rows land, so its click was never in danger. The presses that did vanish arrived at the page as no mouse event at all: no press, no release, no click anywhere in the document, while the switch was still on top at the point clicked. A click that never reaches the page cannot be a handler\u2019s fault \u2014 the window had not taken focus yet, and any other button behaved the same until the page was reloaded. The switch is a plain click again, it is disabled while a request is in flight as before, and the binder list no longer reserves an empty height.',
    'The queue staying out of the block\u2019s totals is 0.94.2\u2019s real fix and it is still in: a pile waiting behind the live lot is not a listing, so the night\u2019s sell-through no longer dips while it waits for the hammer.',
  ],
})

fs.writeFileSync('CHANGELOG.json', JSON.stringify(log, null, 2) + '\n')

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
fs.writeFileSync('package.json', JSON.stringify({ ...pkg, version: '0.94.3' }, null, 2) + '\n')
console.log('changelog + package.json at 0.94.3')
