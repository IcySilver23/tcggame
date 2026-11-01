const fs = require('fs')
const eol = (s) => (s.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s)

function patch(file, from, to) {
  let src = fs.readFileSync(file, 'utf8')
  if (!src.includes(eol(from))) throw new Error('anchor missing in ' + file + ': ' + from.slice(0, 80))
  src = src.replace(eol(from), eol(to))
  fs.writeFileSync(file, src)
  console.log('ok', file)
}

// Sit under the brand, above the nav sections, pinned so scrolling the long
// nav list never takes the bell away.
patch(
  'src/App.tsx',
  `        </div>
        {(() => {
          const snap: UnlockState | null = state?.progress`,
  `        </div>
        <NotificationBell />
        {(() => {
          const snap: UnlockState | null = state?.progress`,
)

patch(
  'src/App.tsx',
  `        <NotificationBell />
        <div className="nav-item" onClick={() => setShowChangelog(true)}>`,
  `        <div className="nav-item" onClick={() => setShowChangelog(true)}>`,
)

fs.appendFileSync(
  'src/styles.css',
  `
/* Pinned under the brand: the nav list scrolls, the bell does not. */
.notif-wrap{position:sticky;top:8px;z-index:7}
.notif-panel{top:118px;bottom:auto;left:12px;width:min(340px,calc(100vw - 24px));max-height:min(60vh,420px)}
`,
)
console.log('ok src/styles.css (appended)')
