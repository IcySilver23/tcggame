// Regression: the foil variant must survive the UI hand-off.
//
// A ball reverse is stored on the copy, so the binder row and the card-detail
// hero both have to pass that copy's variant down through SlabCard/CardImg to
// FoilOverlay. This check reads the JSX with the TypeScript parser rather than
// matching source text, so formatting and line wrapping do not matter, but a
// dropped `variant` attribute fails.
//
// Run: ./node_modules/.bin/tsx tmp/check-foil-variant-ui.ts

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

type Tag = { name: string; attrs: Map<string, string> }

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

function tagOf(node: ts.Node, sf: ts.SourceFile): Tag | null {
  let attributes: ts.JsxAttributes
  if (ts.isJsxElement(node)) attributes = node.openingElement.attributes
  else if (ts.isJsxSelfClosingElement(node)) attributes = node.attributes
  else return null

  const attrs = new Map<string, string>()
  for (const p of attributes.properties) {
    if (!ts.isJsxAttribute(p)) continue
    attrs.set(p.name.getText(sf), p.initializer ? p.initializer.getText(sf) : 'true')
  }
  return { name: node.openingElement?.tagName.getText(sf) ?? (node as ts.JsxSelfClosingElement).tagName.getText(sf), attrs }
}

function tags(file: string, tagName: string, withinFunction?: string): Tag[] {
  const path = resolve(ROOT, file)
  const sf = ts.createSourceFile(file, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let scope: ts.Node = sf
  if (withinFunction) {
    let found: ts.Node | undefined
    walk(sf, (n) => {
      if (!found && ts.isFunctionDeclaration(n) && n.name?.text === withinFunction) found = n
    })
    if (!found) return []
    scope = found
  }
  const out: Tag[] = []
  walk(scope, (n) => {
    const tag = tagOf(n, sf)
    if (tag?.name === tagName) out.push(tag)
  })
  return out
}

function expr(tag: Tag, attr: string): string {
  return tag.attrs.get(attr) ?? ''
}

let pass = 0
let fail = 0
function ok(cond: boolean, msg: string): void {
  if (cond) {
    pass++
    console.log(`  ok   ${msg}`)
  } else {
    fail++
    console.log(`  FAIL ${msg}`)
  }
}

console.log('Foil variant UI plumbing')

// SlabCard has two paths: a raw card returns CardImg directly, and a graded card
// nests CardImg in the slab well. Both must forward the copy's variant.
const slabImages = tags('src/components.tsx', 'CardImg', 'SlabCard')
ok(slabImages.length === 2, `SlabCard has both CardImg paths — found ${slabImages.length}`)
ok(slabImages.every((t) => expr(t, 'variant').includes('variant')), 'every SlabCard path passes variant to CardImg')
ok(slabImages.every((t) => expr(t, 'rarity').includes('rarity')), 'every SlabCard path passes rarity too')

// CardImg ends at FoilOverlay; this is where a variant that survived SlabCard
// would still be dropped.
const foils = tags('src/components.tsx', 'FoilOverlay', 'CardImg')
ok(foils.length === 1, `CardImg renders one FoilOverlay — found ${foils.length}`)
ok(foils.every((t) => expr(t, 'variant').includes('variant')), 'CardImg hands the variant to FoilOverlay')

// The detail hero is not a collection row: it must use the owned copy's variant,
// preferring the sellable collection copy and falling back to a graded copy.
const heroSlabs = tags('src/views/CardDetail.tsx', 'SlabCard').filter((t) => expr(t, 'cardId').includes('card.id'))
ok(heroSlabs.length === 1, `the detail hero renders one SlabCard for the card — found ${heroSlabs.length}`)
ok(heroSlabs.every((t) => expr(t, 'variant').includes('compareRow')), 'the detail hero can take the collection copy variant')
ok(heroSlabs.every((t) => expr(t, 'variant').includes('firstOwnedSlab')), 'the detail hero can fall back to the graded copy variant')

// Every binder row is an owned copy, so every SlabCard there gets its own row
// variant rather than the card's set-level default.
const binderSlabs = tags('src/views/Inventory.tsx', 'SlabCard')
ok(binderSlabs.length > 0, `inventory renders owned copies through SlabCard — found ${binderSlabs.length}`)
ok(binderSlabs.every((t) => expr(t, 'variant').includes('i.variant')), 'every inventory SlabCard passes the row variant')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
