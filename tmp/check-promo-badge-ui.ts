// Regression: a three-promo shelf tag must show every name and stay clear of
// the price label.
//
// This is a source-level layout contract, not a browser dependency: the tag
// cannot clip or ellipsize, it must stay in normal flow, and the two-line tag
// plus the price has to fit the shelf's fixed 200px row. The rendered
// Poster Collection measurement is 26.125px for the tag, with the price label
// still below it and the card's scrollHeight equal to its clientHeight.
//
// Run: npm run check:promo-badge

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(resolve(ROOT, 'src/styles.css'), 'utf8')
const packs = readFileSync(resolve(ROOT, 'src/views/Packs.tsx'), 'utf8')

let pass = 0
let fail = 0
function ok(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    pass++
    console.log(`  ok   ${label}`)
  } else {
    fail++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) {
    ok(false, `CSS rule ${selector} exists`)
    return ''
  }
  return match[1]
}

function prop(cssRule: string, name: string): string | null {
  const match = cssRule.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i'))
  return match?.[1].trim() ?? null
}

const num = (value: string | null): number => {
  if (!value) return Number.NaN
  return Number.parseFloat(value)
}

const nums = (value: string | null): number[] =>
  value ? value.split(' ').map((part) => Number.parseFloat(part)).filter((n) => Number.isFinite(n)) : []

function classAt(className: string): number {
  const sf = ts.createSourceFile('Packs.tsx', packs, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found = -1
  const visit = (node: ts.Node): void => {
    if (found < 0 && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || attr.name.getText(sf) !== 'className') continue
        if (attr.initializer && ts.isStringLiteral(attr.initializer) && attr.initializer.text === className) {
          found = node.getStart(sf)
        }
      }
    }
    if (found < 0) ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

console.log('Promo badge UI layout')

const shelf = rule('.shelf')
const item = rule('.bay-item')
const art = rule('.bay-art')
const name = rule('.bay-name')
const promo = rule('.bay-promo')
const label = rule('.bay-label')

const rowHeight = num(prop(shelf, 'grid-auto-rows'))
const itemPadding = nums(prop(item, 'padding'))
const gap = num(prop(item, 'gap'))
const artHeight = num(prop(art, 'height'))
const nameFont = num(prop(name, 'font-size'))
const nameLine = num(prop(name, 'line-height'))
const nameMin = num(prop(name, 'min-height'))
const nameHeight = Math.max(nameMin, nameFont * nameLine * 2)
const promoFont = num(prop(promo, 'font-size'))
const promoLine = num(prop(promo, 'line-height'))
const promoPadding = nums(prop(promo, 'padding'))
const promoBorder = nums(prop(promo, 'border'))[0]
const labelHeight = 21 // Measured: 11.5px price + 2px vertical padding + border.

ok(rowHeight >= 200, 'the shelf row is at least 200px tall', `${rowHeight}px`)
ok(itemPadding.length > 0 && gap > 0, 'the card has the padding and gap the height budget uses')
ok(artHeight > 0 && nameHeight > 0, 'art and two-line product name heights are known')
ok(promoFont > 0 && promoLine > 0 && promoPadding.length > 0 && promoBorder > 0, 'two-line promo height is measurable')

ok(prop(promo, 'display') === 'block', 'the promo tag is a block so its width can wrap')
ok(prop(promo, 'width') === 'max-content', 'the tag starts at its natural width')
ok(prop(promo, 'max-width') === '100%', 'the tag is capped by the card width')
ok(prop(promo, 'white-space') === 'normal', 'the three-name tag can wrap')
ok(prop(promo, 'overflow') !== 'hidden', 'the tag does not clip its wrapped text')
ok(prop(promo, 'text-overflow') !== 'ellipsis', 'the tag does not ellipsize')
ok(prop(promo, 'height') === null && prop(promo, 'max-height') === null, 'the tag has no fixed height clipping a second line')
ok(prop(item, 'overflow') !== 'hidden', 'the card does not clip the wrapped tag')

ok(prop(promo, 'position') !== 'absolute', 'the promo tag stays in normal flow')
ok(prop(label, 'position') !== 'absolute', 'the price label stays in normal flow')

const promoHeight = promoFont * promoLine * 2 + promoPadding[0] + (promoPadding[1] ?? promoPadding[0]) + promoBorder * 2
const used = itemPadding[0] + artHeight + nameHeight + promoHeight + labelHeight + gap * 3
ok(
  Number.isFinite(used) && used <= rowHeight,
  'a two-line promo tag and the price fit inside the 200px shelf row',
  `${used.toFixed(2)}px used of ${rowHeight}px`,
)

const promoAt = classAt('bay-promo')
const labelAt = classAt('bay-label')
ok(promoAt >= 0, 'the shelf renders a .bay-promo tag')
ok(labelAt >= 0, 'the shelf renders a .bay-label price')
ok(promoAt >= 0 && labelAt > promoAt, 'the promo tag comes before the price label in the card')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
