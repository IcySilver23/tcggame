const fs = require('fs')
const eol = (s) => (s.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s)

function patch(file, from, to) {
  let src = fs.readFileSync(file, 'utf8')
  if (!src.includes(eol(from))) throw new Error('anchor missing in ' + file + ': ' + from.slice(0, 90))
  src = src.replace(eol(from), eol(to))
  fs.writeFileSync(file, src)
  console.log('ok', file)
}

/* ------------------------------------------------------------------ */
/* 1. /api/sets — carry the player's completion count per set           */
/* ------------------------------------------------------------------ */
patch(
  'server/index.ts',
  `app.get('/api/sets', (c) => {
  const rows = db.prepare(\`
    SELECT s.*, COUNT(c.id) AS cards_synced
    FROM sets s LEFT JOIN cards c ON c.set_id = s.id
    GROUP BY s.id ORDER BY s.release_date DESC
  \`).all()
  return c.json(jsonRows(rows))
})`,
  `app.get('/api/sets', (c) => {
  // One pass for owned counts rather than a correlated subquery per set: the
  // gallery needs a completion bar on every row, and it needs to be cheap
  // enough to refetch on every visit. Same statuses the set page counts
  // (collection + in-grading), distinct by card so a playset counts once.
  const rows = db.prepare(\`
    WITH owned AS (
      SELECT c.set_id, COUNT(DISTINCT i.card_id) AS n
      FROM inventory i JOIN cards c ON c.id = i.card_id
      WHERE i.status IN ('collection','grading')
      GROUP BY c.set_id
    )
    SELECT s.*, COUNT(c.id) AS cards_synced, COALESCE(o.n, 0) AS owned
    FROM sets s
    LEFT JOIN cards c ON c.set_id = s.id
    LEFT JOIN owned o ON o.set_id = s.id
    GROUP BY s.id ORDER BY s.release_date DESC
  \`).all()
  return c.json(jsonRows(rows))
})`,
)

/* ------------------------------------------------------------------ */
/* 2. SetRow gains the completion count                                 */
/* ------------------------------------------------------------------ */
patch(
  'src/types.ts',
  `  logo_url: string | null
  cards_synced?: number
}`,
  `  logo_url: string | null
  cards_synced?: number
  /** Cards in this set the player owns (collection + in-grading), distinct. */
  owned?: number
}`,
)

/* ------------------------------------------------------------------ */
/* 3. The gallery card gets the dex-style completion read               */
/* ------------------------------------------------------------------ */
patch(
  'src/views/SetDetail.tsx',
  `        {shown.map((s) => (
          <div key={s.id} className="card-cell" onClick={() => (window.location.hash = \`#/set/\${s.id}\`)}>
            <SetArt set={s} />
            <div className="card-meta">
              <div className="nm">{s.name}</div>
              <div className="st">{s.series} · {s.release_date}</div>
              <div className="faint small">{s.cards_synced ?? 0} / {s.total} cards synced</div>
            </div>
          </div>
        ))}`,
  `        {shown.map((s) => {
          // The dex read: how far through THIS set you are, not how much of the
          // catalog has synced. Secret rares count — a finished set is a
          // finished set, master printings included.
          const owned = s.owned ?? 0
          const pct = s.total > 0 ? Math.min(100, (owned / s.total) * 100) : 0
          const done = s.total > 0 && owned >= s.total
          return (
          <div key={s.id} className="card-cell" onClick={() => (window.location.hash = \`#/set/\${s.id}\`)}>
            <SetArt set={s} />
            <div className="card-meta">
              <div className="nm">{s.name}</div>
              <div className="st">{s.series} · {s.release_date}</div>
              <div className={\`set-progress \${done ? 'done' : ''}\`}>
                <div
                  className="set-progress-bar"
                  role="progressbar"
                  aria-label={\`\${s.name} completion\`}
                  aria-valuemin={0}
                  aria-valuemax={s.total}
                  aria-valuenow={owned}
                >
                  <span style={{ width: \`\${pct}%\` }} />
                </div>
                <div className="set-progress-meta">
                  <span>{owned} of {s.total}</span>
                  {s.ptcgo_code && <span className="set-code">{s.ptcgo_code}</span>}
                </div>
              </div>
            </div>
          </div>
          )
        })}`,
)

/* ------------------------------------------------------------------ */
/* 4. Styles for the bar                                                */
/* ------------------------------------------------------------------ */
patch(
  'src/styles.css',
  `.set-art .set-art-fallback{font-size:40px;opacity:.45}`,
  `.set-art .set-art-fallback{font-size:40px;opacity:.45}
/* Set completion — the dex read: a slim track, "51 of 161" under it, and the
   set code stamped opposite. The bar is the whole point of the card, so it
   sits at full width whether or not the logo loaded. */
.set-progress{display:flex;flex-direction:column;gap:6px;margin-top:2px}
.set-progress-bar{height:7px;background:var(--track);border:1px solid var(--border-soft);border-radius:999px;overflow:hidden}
.set-progress-bar>span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--blue),var(--blue-text));transition:width .35s ease}
.set-progress-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--text-dim);font-variant-numeric:tabular-nums}
.set-progress-meta .set-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:1px 5px;border-radius:4px;border:1px solid var(--border-soft);color:var(--text-faint)}
.set-progress.done .set-progress-bar>span{background:linear-gradient(90deg,var(--green),var(--green))}
.set-progress.done .set-progress-meta{color:var(--green)}`,
)
