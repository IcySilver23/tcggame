// One-off harness: sit in front of the API and hold BACK the cheap-pool page
// request, so the sell panel's "rows land" moment happens on a schedule we
// choose instead of whenever the machine feels like it.
//
//   node tmp/slow-sellable-proxy.mjs 8787 8788 2500
//
// Everything is forwarded untouched; only /api/stream/sellable is delayed.
import http from 'node:http'

const LISTEN = Number(process.argv[2] ?? 8787)
const TARGET = Number(process.argv[3] ?? 8788)
const DELAY = Number(process.argv[4] ?? 2500)

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const slow = req.url?.startsWith('/api/stream/sellable')
    const fire = () => {
      const up = http.request(
        { hostname: '127.0.0.1', port: TARGET, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${TARGET}` } },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers)
          r.pipe(res)
        },
      )
      up.on('error', () => { res.writeHead(502); res.end('proxy: api down') })
      if (body.length) up.write(body)
      up.end()
    }
    if (slow) setTimeout(fire, DELAY)
    else fire()
  })
})

server.listen(LISTEN, '127.0.0.1', () => console.log(`proxy ${LISTEN} -> ${TARGET}, sellable held ${DELAY}ms`))
