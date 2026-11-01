const fs = require('fs')
const eol = (s) => (s.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s)

function patch(file, from, to) {
  let src = fs.readFileSync(file, 'utf8')
  if (!src.includes(eol(from))) throw new Error('anchor missing in ' + file + ': ' + from.slice(0, 90))
  src = src.replace(eol(from), eol(to))
  fs.writeFileSync(file, src)
  console.log('ok', file)
}

patch(
  'src/views/SetDetail.tsx',
  `      sync_desc: byNum(syncPct, 'desc'),
    }`,
  `      sync_desc: byNum(syncPct, 'desc'),
      // Most complete first: the sets you are actually closest to finishing.
      // Ties break on raw owned count, so a 50% slice of a 300-card set edges
      // out a 50% slice of a 60-card one rather than flipping on row order.
      complete_desc: (a, b) => {
        const pct = (s: SetRow) => (s.total > 0 ? (s.owned ?? 0) / s.total : 0)
        return pct(b) - pct(a) || (b.owned ?? 0) - (a.owned ?? 0)
      },
    }`,
)

patch(
  'src/views/SetDetail.tsx',
  `            { value: 'release_desc', label: 'Sort: Newest first' },`,
  `            { value: 'complete_desc', label: 'Sort: Most complete' },
            { value: 'release_desc', label: 'Sort: Newest first' },`,
)
