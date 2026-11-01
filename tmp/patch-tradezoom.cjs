const fs = require('fs')
const eol = (s) => (s.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s)

function patch(file, from, to) {
  let src = fs.readFileSync(file, 'utf8')
  if (!src.includes(eol(from))) throw new Error('anchor missing in ' + file + ': ' + from.slice(0, 90))
  src = src.replace(eol(from), eol(to))
  fs.writeFileSync(file, src)
  console.log('ok', file)
}

patch('src/views/Trade.tsx', `import { fmtUsd } from '../components'`, `import { CardImg, fmtUsd } from '../components'`)

// Offer chips: hand CardImg the card id so the thumbnail arms the same
// hover preview + click-to-open the rest of the game has.
patch(
  'src/views/Trade.tsx',
  `function CardChip({ name, image, value, condition }: { name: string; image: string | null; value: number; condition?: string }) {
  return (
    <div className="offer-card-chip">
      <img
        src={image ?? ''}
        alt={name}
        style={{ width: 38, borderRadius: 6, display: 'block', background: '#0d1017', flex: 'none' }}
        onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
      />`,
  `function CardChip({ cardId, name, image, value, condition }: { cardId?: string; name: string; image: string | null; value: number; condition?: string }) {
  return (
    <div className="offer-card-chip">
      <CardImg src={image} alt={name} cardId={cardId} className="offer-chip-art" />`,
)

patch(
  'src/views/Trade.tsx',
  `          <CardChip key={c.cardId} name={c.name} image={c.image} value={c.value} condition={c.condition} />`,
  `          <CardChip key={c.cardId} cardId={c.cardId} name={c.name} image={c.image} value={c.value} condition={c.condition} />`,
)

patch(
  'src/views/Trade.tsx',
  `          <CardChip key={i.inventoryId} name={i.name} image={i.image} value={i.value} condition={i.condition} />`,
  `          <CardChip key={i.inventoryId} cardId={i.cardId} name={i.name} image={i.image} value={i.value} condition={i.condition} />`,
)

// The trader's binder grid: same treatment.
patch(
  'src/views/Trade.tsx',
  `                <div key={c.id} className="trade-card" onClick={() => openCard(c.card_id)}>
                  <img src={c.image_small ?? ''} alt={c.name}
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />`,
  `                <div key={c.id} className="trade-card" onClick={() => openCard(c.card_id)}>
                  <CardImg src={c.image_small} alt={c.name} cardId={c.card_id} />`,
)

patch(
  'src/styles.css',
  `.offer-card-chip + .offer-card-chip{margin-top:6px}`,
  `.offer-card-chip + .offer-card-chip{margin-top:6px}
.offer-chip-art{width:38px;flex:0 0 38px;border-radius:6px}
.trade-card .card-img-wrap{width:100%;border-radius:0}`,
)
