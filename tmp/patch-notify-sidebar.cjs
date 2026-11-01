const fs = require('fs')
const eol = (s) => (s.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s)

function patch(file, from, to) {
  let src = fs.readFileSync(file, 'utf8')
  if (!src.includes(eol(from))) throw new Error('anchor missing in ' + file + ': ' + from.slice(0, 80))
  src = src.replace(eol(from), eol(to))
  fs.writeFileSync(file, src)
  console.log('ok', file)
}

// The topbar stat strip overflows on a narrow window, which put the bell past
// the right edge. The sidebar is always on screen — it lives there now.
patch('src/App.tsx', `            <NotificationBell />
            <ThemeToggle />`, `            <ThemeToggle />`)

patch(
  'src/App.tsx',
  `        <div className="nav-item" onClick={() => setShowChangelog(true)}>`,
  `        <NotificationBell />
        <div className="nav-item" onClick={() => setShowChangelog(true)}>`,
)

patch(
  'src/views/Notifications.tsx',
  `      <button
        className={\`notif-bell \${unread > 0 ? 'live' : ''}\`}
        onClick={() => { setOpen((o) => !o); load() }}
        title={unread > 0 ? \`\${unread} unread notification\${unread === 1 ? '' : 's'}\` : 'Notifications'}
        aria-label={\`Notifications\${unread > 0 ? \`, \${unread} unread\` : ''}\`}
      >
        🔔{unread > 0 && <span className="notif-dot">{unread > 9 ? '9+' : unread}</span>}
      </button>`,
  `      <button
        className={\`notif-bell nav-item \${unread > 0 ? 'live' : ''} \${open ? 'active' : ''}\`}
        onClick={() => { setOpen((o) => !o); load() }}
        title={unread > 0 ? \`\${unread} unread notification\${unread === 1 ? '' : 's'}\` : 'Notifications'}
        aria-label={\`Notifications\${unread > 0 ? \`, \${unread} unread\` : ''}\`}
      >
        <span className="ico">🔔</span>
        <span className="nav-label">Notifications</span>
        {unread > 0 && <span className="nav-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>`,
)

fs.appendFileSync(
  'src/styles.css',
  `
/* Bell lives in the sidebar (the topbar strip overflows on narrow windows), so
   the panel is fixed above it rather than anchored to an off-screen edge. */
.notif-wrap{display:block;position:static}
.notif-bell.nav-item{width:100%;background:none;border:none;text-align:left;cursor:pointer;font:inherit;color:inherit;border-radius:10px}
.notif-bell.nav-item .ico{font-size:14px}
.notif-bell.nav-item.live{color:var(--yellow)}
.notif-bell.nav-item.live .nav-badge{background:var(--yellow);color:#1a1206}
.notif-panel{position:fixed;left:12px;bottom:76px;top:auto;right:auto;width:min(340px,calc(100vw - 24px));max-height:min(58vh,400px);z-index:80}
`,
)
console.log('ok src/styles.css (appended)')
