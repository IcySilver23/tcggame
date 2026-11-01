const fs = require('fs')

// Match on LF regardless of the file's line endings, then write back in the
// file's own style. (The first pass checked the *anchor* for CRLF instead of the
// file, which is why Shop's CRLF source refused to match.)
function patch(file, from, to, label) {
  const raw = fs.readFileSync(file, 'utf8')
  const crlf = raw.includes('\r\n')
  const src = raw.replace(/\r\n/g, '\n')
  const find = from.replace(/\r\n/g, '\n')
  const repl = to.replace(/\r\n/g, '\n')
  if (!src.includes(find)) throw new Error('anchor missing (' + label + ') in ' + file + ': ' + find.slice(0, 70))
  const out = src.replace(find, repl)
  fs.writeFileSync(file, crlf ? out.replace(/\n/g, '\r\n') : out)
  console.log('ok', file, '-', label)
}

patch(
  'src/views/Shop.tsx',
  `      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>Open a Card Shop</h1>
          <div className="sub">Sign a lease, fill your cases, and let the walk-ins come to you.</div>
        </div>
      </div>`,
  `      <div className="page-head desk">
        <div className="ph-id">
          <span className="ph-mark" aria-hidden>🏪</span>
          <div>
            <h1>Open a Card Shop</h1>
            <div className="sub">Sign a lease, fill your cases, and let the walk-ins come to you.</div>
          </div>
        </div>
      </div>`,
  'shop signup head',
)

patch(
  'src/views/Shop.tsx',
  `      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>{s.name}</h1>
          <div className="sub">{s.tierLabel} · {propertyHeadline(s.property)} · {s.displayedUnits} {s.displayedUnits === 1 ? 'card' : 'cards'} on display</div>
        </div>
        <div className="right"><RepBadge rep={s.reputation} /></div>
      </div>`,
  `      <div className="page-head desk">
        <div className="ph-id">
          <span className="ph-mark" aria-hidden>🏪</span>
          <div style={{ minWidth: 0 }}>
            <h1>{s.name}</h1>
            <div className="sub">{s.tierLabel} · {propertyHeadline(s.property)} · {s.displayedUnits} {s.displayedUnits === 1 ? 'card' : 'cards'} on display</div>
          </div>
        </div>
        <div className="right"><RepBadge rep={s.reputation} /></div>
      </div>`,
  'shop running head',
)

patch(
  'src/views/Convention.tsx',
  `      <div className="page-head">
        <div>
          <h1>🎪 Conventions</h1>
          <div className="sub">Pop-up card shows that come to town on the game clock.</div>
        </div>
      </div>`,
  `      <div className="page-head desk">
        <div className="ph-id">
          <span className="ph-mark" aria-hidden>🎪</span>
          <div>
            <h1>Conventions</h1>
            <div className="sub">Pop-up card shows that come to town on the game clock.</div>
          </div>
        </div>
      </div>`,
  'convention closed head',
)

patch(
  'src/views/Convention.tsx',
  `      <div className="page-head">
        <div>
          <h1>🎪 {status.show.name}</h1>
          <div className="sub">{status.show.blurb}</div>
        </div>`,
  `      <div className="page-head desk">
        <div className="ph-id">
          <span className="ph-mark" aria-hidden>🎪</span>
          <div style={{ minWidth: 0 }}>
            <h1>{status.show.name}</h1>
            <div className="sub">{status.show.blurb}</div>
          </div>
        </div>`,
  'convention floor head',
)

patch(
  'src/views/Convention.tsx',
  `      <div className="page-head">
        <div>
          <h1>{data.booth!.avatar} {data.booth!.vendorName} <span style={{ fontSize: 18 }}>{MOOD_FACE[data.moodSeen!] ?? ''}</span></h1>
          <div className="sub">{SPECIALTY_LABEL[data.booth!.specialty] ?? data.booth!.specialty} — {data.booth!.blurb}</div>
        </div>`,
  `      <div className="page-head desk">
        <div className="ph-id">
          <span className="ph-mark" aria-hidden>{data.booth!.avatar}</span>
          <div style={{ minWidth: 0 }}>
            <h1>{data.booth!.vendorName} <span style={{ fontSize: 18 }}>{MOOD_FACE[data.moodSeen!] ?? ''}</span></h1>
            <div className="sub">{SPECIALTY_LABEL[data.booth!.specialty] ?? data.booth!.specialty} — {data.booth!.blurb}</div>
          </div>
        </div>`,
  'booth head',
)

fs.appendFileSync(
  'src/styles.css',
  `
/* ===== The counter pass ====================================================
   One header identity across the screens: a mark, a title, a tagline. The
   title stops shouting in caps (the page-head default for headings that had no
   identity of their own) and the mark lines them up with the desk screens. */
.page-head.desk{align-items:flex-start}
.page-head .ph-id{display:flex;gap:10px;align-items:center;min-width:0}
.ph-mark{width:38px;height:38px;flex:none;display:grid;place-items:center;font-size:19px;background:var(--panel2);border:2px solid var(--edge);border-radius:11px;box-shadow:0 3px 0 var(--edge)}
.page-head.desk h1{padding-left:0;text-transform:none;letter-spacing:-.4px;font-size:23px;line-height:1.15}
.page-head.desk h1::before{display:none}
.page-head.desk .sub{margin-top:2px;font-size:11.5px;line-height:1.4}

/* Tables stop mangling buttons: "Sell now" was folding onto two lines inside
   every narrow table in the game. */
.table-wrap button,.table-wrap .btn{white-space:nowrap}
.table-wrap thead th{position:sticky;top:0;z-index:1;background:var(--panel2);backdrop-filter:blur(2px)}
`,
)
console.log('ok src/styles.css (appended)')
