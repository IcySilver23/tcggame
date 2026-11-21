import { holoFor } from '../../src/holo'
const samples: [string, string][] = [
  ['me6-1', 'Common'],
  ['me6-45', 'Rare'],
  ['me6-11', 'Double Rare'],
  ['me6-104', 'Illustration Rare'],
  ['me6-118', 'Ultra Rare'],
  ['me6-141', 'Mega Hyper Rare'],
  ['me55-1', 'Common'],
  ['me55c-4', 'Rare Secret'],
]
for (const [cardId, rarity] of samples) {
  console.log(cardId, rarity, '->', JSON.stringify(holoFor({ cardId, rarity })))
}
