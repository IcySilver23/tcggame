const fs = require('fs')
const eol = (s) => (s.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s)

function patch(file, from, to) {
  let src = fs.readFileSync(file, 'utf8')
  if (!src.includes(eol(from))) throw new Error('anchor missing in ' + file + ': ' + from.slice(0, 90))
  src = src.replace(eol(from), eol(to))
  fs.writeFileSync(file, src)
  console.log('ok', file)
}

/* ---------------- API ------------------------------------------------------ */

patch('server/index.ts', `import pkg from '../package.json'`, `import pkg from '../package.json'
import * as notify from './services/notify'`)

patch(
  'server/index.ts',
  `app.get('/api/changelog', (c) => c.json({ current: APP_VERSION, entries: CHANGELOG }))`,
  `app.get('/api/changelog', (c) => c.json({ current: APP_VERSION, entries: CHANGELOG }))

// Notifications — the header bell. A short list, newest first, with read state.
app.get('/api/notifications', (c) => {
  notify.prune()
  return c.json(notify.list(40))
})

app.post('/api/notifications/read', async (c) => {
  const body = await c.req.json<{ id?: number }>().catch(() => ({}) as { id?: number })
  if (body && typeof body.id === 'number') notify.markRead(body.id)
  return c.json({ ok: true, unread: notify.unreadCount() })
})

app.post('/api/notifications/read-all', (c) => {
  notify.markAllRead()
  return c.json({ ok: true, unread: 0 })
})`,
)

/* ---------------- producer: parcels ---------------------------------------- */

patch(
  'server/services/deliveries.ts',
  `    logActivity(
      channel,
      \`📦 \${d.quantity > 1 ? \`\${d.quantity}× \` : ''}\${name} arrived — \${d.seller ? \`from \${d.seller}, \` : ''}\${d.eta_days} game-day\${d.eta_days === 1 ? '' : 's'} on the road.\`,
      0,
    )`,
  `    logActivity(
      channel,
      \`📦 \${d.quantity > 1 ? \`\${d.quantity}× \` : ''}\${name} arrived — \${d.seller ? \`from \${d.seller}, \` : ''}\${d.eta_days} game-day\${d.eta_days === 1 ? '' : 's'} on the road.\`,
      0,
    )
    // A parcel landing is the classic "you weren't looking" event — badge it.
    void import('./notify')
      .then((n) => n.push(
        'delivery',
        \`📦 \${d.quantity > 1 ? \`\${d.quantity}× \` : ''}\${name} arrived\`,
        \`\${d.seller ? \`From \${d.seller}. \` : ''}\${d.eta_days} game-day\${d.eta_days === 1 ? '' : 's'} on the road — it's in your binder.\`,
        '#/inventory',
        \`delivery:\${d.id}\`,
      ))
      .catch(() => {})`,
)

/* ---------------- producer: incoming trade offers --------------------------- */

patch(
  'server/services/trading.ts',
  `  if (o.direction === 'incoming') db.prepare(\`UPDATE traders SET offers_made = offers_made + 1 WHERE id = ?\`).run(o.traderId)`,
  `  if (o.direction === 'incoming') {
    db.prepare(\`UPDATE traders SET offers_made = offers_made + 1 WHERE id = ?\`).run(o.traderId)
    // An offer that expires unanswered is a real loss, so it wants a badge.
    const lead = o.theirCards[0]?.name ?? 'a card'
    const more = o.theirCards.length > 1 ? \` + \${o.theirCards.length - 1} more\` : ''
    void import('./notify')
      .then((n) => n.push(
        'trade',
        '🤝 New trade offer',
        \`\${lead}\${more} on the table\${o.theirCash > 0 ? \` with $\${o.theirCash.toFixed(2)}\` : ''} — it expires if you sit on it.\`,
        '#/trade',
      ))
      .catch(() => {})
  }`,
)

/* ---------------- header --------------------------------------------------- */

patch(
  'src/App.tsx',
  `import { ChangelogModal, useWhatsNewBadge } from './views/WhatsNew'`,
  `import { ChangelogModal, useWhatsNewBadge } from './views/WhatsNew'
import { NotificationBell } from './views/Notifications'`,
)

patch('src/App.tsx', `            <ThemeToggle />`, `            <NotificationBell />
            <ThemeToggle />`)

/* ---------------- styles --------------------------------------------------- */

fs.appendFileSync(
  'src/styles.css',
  `
/* Notifications — the header bell and its panel. Sits in the stat strip, opens
   under the header, and never covers the whole screen on a narrow window. */
.notif-wrap{position:relative;display:flex;align-items:center}
.notif-bell{position:relative;border:1px solid var(--border-soft);background:var(--panel2);color:var(--text);border-radius:9px;padding:4px 7px;font-size:14px;line-height:1;cursor:pointer}
.notif-bell:hover{border-color:var(--border)}
.notif-bell.live{border-color:var(--yellow-line);box-shadow:0 0 0 2px rgba(255,203,5,.15)}
.notif-dot{position:absolute;top:-6px;right:-6px;min-width:16px;height:16px;border-radius:999px;background:var(--yellow);color:#1a1206;font-size:10px;font-weight:850;display:grid;place-items:center;padding:0 4px;border:1px solid var(--yellow-line)}
.notif-panel{position:absolute;top:calc(100% + 8px);right:0;width:min(340px,86vw);max-height:min(420px,70vh);overflow-y:auto;background:var(--panel);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 44px rgba(0,0,0,.45);z-index:65}
.notif-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border-soft)}
.notif-all{background:none;border:none;color:var(--blue-text);font-size:11.5px;cursor:pointer;padding:0}
.notif-all:hover{text-decoration:underline}
.notif-empty{padding:16px 12px;font-size:12.5px;color:var(--text-faint);line-height:1.5}
.notif-list{display:flex;flex-direction:column}
.notif-row{display:flex;gap:9px;align-items:flex-start;text-align:left;padding:10px 12px;background:none;border:none;border-bottom:1px solid var(--border-soft);cursor:pointer;color:var(--text)}
.notif-row:last-child{border-bottom:none}
.notif-row:hover{background:var(--panel-hi)}
.notif-row.read{opacity:.6}
.notif-ico{font-size:16px;line-height:1.2;flex:none}
.notif-txt{display:flex;flex-direction:column;gap:2px;min-width:0}
.notif-txt b{font-size:12.5px;line-height:1.35}
.notif-txt em{font-size:11.5px;color:var(--text-dim);font-style:normal;line-height:1.4}
.notif-txt i{font-size:10.5px;color:var(--text-faint);font-style:normal}
`,
)
console.log('ok src/styles.css (appended)')
