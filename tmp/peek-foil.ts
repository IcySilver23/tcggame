import { foilMaskFor } from '../src/foil/mask'
import { printingFor } from '../src/foil/printing-db'
import { holoFor } from '../src/holo'
const cards: [string, string, string][] = [
  ['me6-111', 'Illustration Rare', 'normal'],
  ['me6-107', 'Illustration Rare', 'normal'],
  ['me6-45', 'Rare', 'holofoil'],
  ['me6-26', 'Rare', 'holofoil'],
  ['me6-82', 'Rare', 'holofoil'],
  ['me55-36', 'Pikachu Rare', 'holofoil'],
  ['ecard1-13', 'Rare Holo', 'holofoil'],
  ['sv1-81', 'Rare Holo', 'holofoil'],
  ['swsh1-25', 'Rare Holo', 'holofoil'],
  ['base1-4', 'Rare Holo', 'holofoil'],
]
for (const [cardId, rarity, variant] of cards) {
  const h = holoFor({ cardId, rarity, variant }) as any
  const p = printingFor({ cardId, rarity, variant }) as any
  const m = foilMaskFor({ cardId, rarity, variant }) as any
  console.log(cardId, '| holo.pattern:', h?.pattern ?? null,
    '| printing:', p ? `${p.printingId} pattern=${p.pattern} mask=${p.mask} status=${p.status} verified=${p.maskVerified}` : null,
    '| mask:', m ? `${m.kind} ${JSON.stringify(m.rect)} verified=${m.verified}` : null)
}
