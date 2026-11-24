// 0.94.2: the mode switch acts on the press, and the queue stays out of totals.
import fs from 'node:fs'

const log = JSON.parse(fs.readFileSync('CHANGELOG.json', 'utf8'))
const prev = log.entries.find((e) => e.version === '0.94.1')
if (prev && prev.highlights.length > 1) {
  const [first, ...rest] = prev.highlights
  prev.highlights = [first]
  prev.features[0] = `${prev.features[0]} ${rest.join(' ')}`
}

const entry = {
  version: '0.94.2',
  date: '2026-11-24',
  title: 'The switch answers on the press',
  highlights: [
    'One card / A stack now flips the moment you press it, instead of waiting for a click the settling panel could swallow.',
    'A queued pile no longer counts as a listing, so the night\u2019s sell-through holds steady while it waits for the hammer.',
    'The binder list reserves its own height, so the sell panel stops jumping while the first page of cards loads.',
  ],
  features: [
    'The mode switch only listened for a click, and a click is a promise the browser makes about two events: the press has to start and end on the same element. Right after the page loads the sell panel is still settling \u2014 the picker swaps its placeholder for a hundred rows and the list can move or gain a scrollbar under the cursor \u2014 so a press that began on One card or A stack could finish somewhere else and produce no click at all. The switch now acts on pointerdown, which cannot be lost that way, and still listens for click so a keyboard still works; switching to the mode you are already in is a no-op. The switch is also no longer disabled while a request is in flight, and the results list has a minimum height so the panel does not resize under the pointer. The simplification to admit: the swallowed press could not be reproduced at the raw event level in this build\u2019s own harness, so this removes the two code paths that can lose a first press rather than pointing at a single proven culprit \u2014 the toggle is verified working on the first press after a fresh load, in both directions.',
    'The block\u2019s totals now leave the queue out. Listed, sold, unsold, gross and fees all count only the lots that actually faced the room, so a pile sitting in the wings no longer drags the sell-through percentage down for a night it has not been offered on. The block\u2019s arithmetic is pinned in the playtest: listed must equal sold plus passed plus the one live lot, with a queued pile excluded.',
  ],
}

if (!log.entries.some((e) => e.version === entry.version)) log.entries.unshift(entry)
fs.writeFileSync('CHANGELOG.json', JSON.stringify(log, null, 2) + '\n')

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
fs.writeFileSync('package.json', JSON.stringify({ ...pkg, version: entry.version }, null, 2) + '\n')
console.log(`changelog + package.json at ${entry.version}`)
