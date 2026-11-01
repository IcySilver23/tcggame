const fs = require('fs')
const eol = (s) => (s.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s)

function patch(file, from, to) {
  let src = fs.readFileSync(file, 'utf8')
  if (!src.includes(eol(from))) throw new Error('anchor missing in ' + file + ': ' + from.slice(0, 90))
  src = src.replace(eol(from), eol(to))
  fs.writeFileSync(file, src)
  console.log('ok', file)
}

const component = fs.readFileSync('tmp/meetupscene.tsx.txt', 'utf8').replace(/\r?\n/g, '\n')
const css = fs.readFileSync('tmp/meetup.css.txt', 'utf8').replace(/\r?\n/g, '\n')

// 1. The scene component, right above the old result modals.
patch(
  'src/views/LocalDeals.tsx',
  `// --- result + offer modals (unchanged behaviour) ----------------------------`,
  `${component}
// --- result + offer modals (unchanged behaviour) ----------------------------`,
)

// 2. Keep the listing the meetup happened on — the popup used to throw it away,
//    which is why the result could only ever be a line of text.
patch(
  'src/views/LocalDeals.tsx',
  `  const [result, setResult] = useState<any>(null)`,
  `  const [result, setResult] = useState<any>(null)
  // The listing behind the last meetup, so the scene can put a face and a car
  // in it. Selling your own post has no row — that keeps the plain modal.
  const [sceneRow, setSceneRow] = useState<LocalFeedRow | null>(null)`,
)

patch(
  'src/views/LocalDeals.tsx',
  `      if (r.ok) {
        setResult(r)
        if (r.outcome === 'bought') refreshState()
        if (r.ok && r.outcome === 'bought') setOpen(null)
      } else toast(r.error ?? 'Meetup failed', 'bad')`,
  `      if (r.ok) {
        setResult(r)
        setSceneRow(row)
        if (r.outcome === 'bought') refreshState()
        if (r.ok && r.outcome === 'bought') setOpen(null)
      } else toast(r.error ?? 'Meetup failed', 'bad')`,
)

patch(
  'src/views/LocalDeals.tsx',
  `      if (r.ok) { setResult(r); refreshState() }`,
  `      if (r.ok) { setResult(r); setSceneRow(null); refreshState() }`,
)

// 3. Route buying through the scene; mystery buys keep the reveal, sales keep
//    the plain modal (there is no parking lot when you are the one selling).
patch(
  'src/views/LocalDeals.tsx',
  `      <MeetResultModal result={result} onClose={() => setResult(null)} />`,
  `      {result && sceneRow && (result.outcome !== 'bought' || !result.reveal) ? (
        <MeetupScene
          row={sceneRow}
          result={result}
          onClose={() => { setResult(null); setSceneRow(null); refreshState() }}
          onCounter={(n) => {
            const next = sceneRow
            setResult(null)
            setSceneRow(null)
            void meet(next, n)
          }}
        />
      ) : (
        <MeetResultModal result={result} onClose={() => setResult(null)} />
      )}`,
)

// 4. Styles.
fs.appendFileSync('src/styles.css', css)
console.log('ok src/styles.css (appended)')
