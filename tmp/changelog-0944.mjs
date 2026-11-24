// 0.94.4: the advanced foil switch is gone, and so is the treatment behind it.
import fs from 'node:fs'

const log = JSON.parse(fs.readFileSync('CHANGELOG.json', 'utf8'))

const entry = {
  version: '0.94.4',
  date: '2026-11-24',
  title: 'One paper, one light',
  highlights: [
    'Settings \u2192 Appearance has no advanced foil switch any more \u2014 every holo card shows its own paper at a fixed tilt, exactly as it did with the switch off.',
    'The pointer sweep, the iridescent colour and the embossed relief that switch turned on are gone with it, so a card is painted once and left alone.',
    'Cards in the binder, the shelf and a pulled card all light the same way now, because nothing in the save or the browser decides how a card is lit.',
  ],
  features: [
    'The advanced foil switch is removed from Settings \u2192 Appearance, and the treatment behind it is removed from the renderer with it. What every card keeps is the paper it always had: its printing\u2019s coverage mask and pattern, lit at a fixed neutral tilt at 60% intensity with no colour layered on top \u2014 the frame a card drew with the switch off, which was the default. The pointer-driven sweep, the iridescence and the embossed relief were only ever drawn while that switch was on, so nothing you can see is lost from a card that was already at rest.',
    'The honest note: this removes the advanced treatment rather than repairing it. It was reported broken, and it was never the default, so it is gone rather than tuned. A browser that still holds the old `tcglife.foil` value is simply ignored now, and a card that used to sit under a half-applied highlight is back to its own paper. The dev inspector behind Shift+H is untouched: it still draws the same composite one stage at a time, with sliders, for anyone checking a printing against a source.',
  ],
}

if (!log.entries.some((e) => e.version === entry.version)) log.entries.unshift(entry)
fs.writeFileSync('CHANGELOG.json', JSON.stringify(log, null, 2) + '\n')

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
fs.writeFileSync('package.json', JSON.stringify({ ...pkg, version: entry.version }, null, 2) + '\n')
console.log(`changelog + package.json at ${entry.version}`)
