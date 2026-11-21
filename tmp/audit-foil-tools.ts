// One-off audit: which foil reports, generated indexes, shipped sheets and
// checks still have a live caller, and which have been orphaned.
import fs from 'node:fs'
import path from 'node:path'

const read = (p: string) => {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}
const list = (dir: string, pred: (f: string) => boolean) => fs.readdirSync(dir).filter(pred)

const srcFiles: string[] = []
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(e.name)) srcFiles.push(p)
  }
}
walk('src')

const scripts = list('scripts', (f) => f.endsWith('.ts'))
const checks = list('tmp', (f) => /^check-.*\.ts$/.test(f))
const reports = list('reports', (f) => f.endsWith('.json'))
const docs = read('AGENTS.md') + '\n' + read('HOLOFOIL_ROADMAP.md')
const scriptTexts = new Map(scripts.map((f) => [f, read('scripts/' + f)]))
const srcText = srcFiles.map(read).join('\n')
const allCode = srcText + '\n' + [...scriptTexts.values()].join('\n')

const out = {
  reports: [] as { report: string; generators: string[]; inDocs: boolean }[],
  indexes: [] as { file: string; by: string[] }[],
  sheets: [] as { file: string; referenced: boolean }[],
  checks: [] as { check: string; lines: string; missingImports: string[]; documented: boolean }[],
  generators: [] as { script: string; writes: string[] }[],
}

for (const r of reports) {
  const base = r.replace(/\.json$/, '')
  const generators = scripts.filter((f) => (scriptTexts.get(f) ?? '').includes(base))
  out.reports.push({ report: r, generators, inDocs: docs.includes(base) })
}

const indexish = list('src/foil', (x) => x.endsWith('-index.ts') || x === 'tile-data.ts')
for (const f of indexish) {
  const base = f.replace(/\.ts$/, '')
  const needles = [`'./${base}'`, `'../foil/${base}'`, `'./foil/${base}'`, `'../src/foil/${base}'`]
  const by = srcFiles.filter((p) => !p.endsWith(f) && needles.some((n) => read(p).includes(`from ${n}`)))
  out.indexes.push({ file: 'src/foil/' + f, by: by.slice(0, 4) })
}

const sheets: string[] = []
const walkSheet = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walkSheet(p)
    else if (/\.(png|webp|jpg)$/.test(e.name)) sheets.push(p)
  }
}
if (fs.existsSync('public/foil')) walkSheet('public/foil')
for (const s of sheets) {
  const web = '/' + s.split(path.sep).slice(1).join('/').replace(/\\/g, '/')
  out.sheets.push({ file: web, referenced: allCode.includes(web) })
}

for (const c of checks) {
  const text = read('tmp/' + c)
  const bad: string[] = []
  for (const m of text.matchAll(/from '(\.{1,2}\/[^']+)'/g)) {
    const rel = m[1]
    const candidates = [rel, rel + '.ts', rel + '.tsx', rel + '/index.ts']
    if (!candidates.some((p) => fs.existsSync(path.resolve('tmp', p)))) bad.push(rel)
  }
  const lines = text.split('\n').length
  out.checks.push({ check: c, lines: String(lines), missingImports: bad, documented: docs.includes(c.replace(/\.ts$/, '')) })
}

for (const s of scripts) {
  const text = scriptTexts.get(s) ?? ''
  const written = [...text.matchAll(/(reports\/[a-z0-9-]+\.(?:json|md))/g)].map((m) => m[1])
  out.generators.push({ script: s, writes: [...new Set(written)] })
}

console.log(JSON.stringify(out, null, 1))
