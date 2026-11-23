// Release notes for 0.90.0: every changelog entry newer than the last shipped
// version. 0.88.0 through 0.89.4 were folded into 0.90.0, so this is one entry.
//   node tmp/gen-release-notes-0900.mjs
import fs from 'node:fs'

const LAST_SHIPPED = '0.87.0'
const log = JSON.parse(fs.readFileSync('CHANGELOG.json', 'utf8'))
const cut = log.entries.findIndex((e) => e.version === LAST_SHIPPED)
if (cut < 0) throw new Error(LAST_SHIPPED + ' not found')
const fresh = log.entries.slice(0, cut)
if (fresh.length === 0) throw new Error('nothing newer than ' + LAST_SHIPPED)
const version = fresh[0].version

const out = [
  'Everything that has changed since ' + LAST_SHIPPED + '. The patch releases in between were folded into this one entry, so there is a single story to read.',
  '',
]
for (const e of fresh) {
  out.push('## ' + e.title + ' (' + e.version + ')', '')
  for (const h of (e.highlights ?? e.features)) out.push('- ' + h, '')
  if (e.highlights && e.features.length) {
    out.push('<details><summary>In full</summary>', '')
    for (const f of e.features) out.push('- ' + f, '')
    out.push('</details>', '')
  }
}
out.push(
  '---',
  '',
  '### Downloads',
  '',
  '- **TCG-Life-Setup-' + version + '.0.exe** — Windows installer, per-user (no admin), Start Menu entry, optional desktop shortcut. Uninstalling keeps your save.',
  '- **TCG-Life-' + version + '-portable-win64.zip** — unzip anywhere and run TCG-Life.exe.',
  '',
  'Both start a new game: neither carries a save. Installing over an existing game never touches `data/`.',
  '',
  'Both need Windows 10/11 with the Microsoft Edge WebView2 runtime, which ships with the OS.',
  '',
)
const path = 'tmp/release-notes-' + version + '.md'
fs.writeFileSync(path, out.join('\n'))
console.log('wrote ' + path + ': ' + fresh.map((e) => e.version + ' (' + (e.highlights ?? e.features).length + 'h/' + e.features.length + 'f)').join(', '))
