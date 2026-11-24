// 0.94.5: the sidebar nav stops growing a horizontal scrollbar on hover.
import fs from 'node:fs'

const log = JSON.parse(fs.readFileSync('CHANGELOG.json', 'utf8'))

const entry = {
  version: '0.94.5',
  date: '2026-11-24',
  title: 'The sidebar stops growing a bar',
  highlights: [
    'The sidebar no longer draws a horizontal scrollbar across its bottom when the pointer runs over a row.',
    'Rows still step 2px to the right under the pointer \u2014 the shift now happens inside the row instead of pushing it out of the list.',
    'The nav list scrolls one way only, so no hover state anywhere in it can bring the bar back.',
  ],
  features: [
    'Every row in the sidebar steps 2px to the right when you hover it. That shift was a `transform` on a row exactly as wide as the nav list, so the row counted as 2px of horizontal overflow \u2014 and because the list scrolls vertically, the browser had already turned its other axis into a scroller. The result was a full-width scrollbar across the bottom of the sidebar that appeared with the pointer and vanished as it left, complete with the little corner square. Measured on the sidebar: 188px of scrollable width inside 186px of list while hovering, and a 10px bar.',
    'The list now clips its horizontal axis instead of scrolling it, so it cannot grow a bar no matter what a hover state does, and the nudge itself moved from a transform to padding \u2014 2px is traded from the right side to the left, so the icon and label still step right while the row stays inside the list. Measured after the change: 186px of scrollable width in 186px of list, and no horizontal bar at all.',
    'The bar was easy to miss and cost more than it looked: it took 10px out of the sidebar for as long as the pointer was on a row, which shifted the footer note and could make the list jump under the pointer. Windows draws the styled scrollbars outright, so that is where it showed most plainly.',
  ],
}

if (!log.entries.some((e) => e.version === entry.version)) log.entries.unshift(entry)
fs.writeFileSync('CHANGELOG.json', JSON.stringify(log, null, 2) + '\n')

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
fs.writeFileSync('package.json', JSON.stringify({ ...pkg, version: entry.version }, null, 2) + '\n')
console.log(`changelog + package.json at ${entry.version}`)
