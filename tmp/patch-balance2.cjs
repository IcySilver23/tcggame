const fs = require('fs')
function patch(file, from, to, label) {
  const raw = fs.readFileSync(file, 'utf8')
  const crlf = raw.includes('\r\n')
  const src = raw.replace(/\r\n/g, '\n').replace(from, to)
  fs.writeFileSync(file, crlf ? src.replace(/\n/g, '\r\n') : src)
  console.log('ok', label)
}
// Asking prices stay (sellers know the market); the dealer's rate goes back to
// 0.70–0.92. Overcorrecting both at once turned a +26% loop into a −0.6% one.
patch('server/services/resale.ts', `return 0.62 + frac * 0.18`, `return 0.7 + frac * 0.22`, 'dealer rate restored')
patch('server/services/franchise.ts', `deposit: 3000, rent: 36`, `deposit: 3000, rent: 20`, 'flagship rent')
patch('server/services/franchise.ts', `deposit: 6500, rent: 82`, `deposit: 6500, rent: 46`, 'region rent')
