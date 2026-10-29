#!/usr/bin/env bash
# Regenerate data/catalog-seed.db from the dev catalog (data/tcglife.db).
#
# The seed carries ONLY the catalog: sets, cards, and the LATEST price row per
# (card, kind, variant). No game tables, no price history (it regrows as the
# game plays), journal_mode DELETE so it's a single portable file. The server
# absorbs it on boot via sync.applyCatalogSeed() — any save missing sets or
# cards tops up in seconds, offline, zero API requests.
#
# Run after major catalog growth (new sets synced) or before shipping:
#   bash scripts/make-catalog-seed.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f data/tcglife.db ] || { echo "no data/tcglife.db — nothing to seed from"; exit 1; }

node -e "
const D = require('better-sqlite3')
const src = new D('data/tcglife.db', { readonly: true })
const out = 'data/catalog-seed.tmp.db'
try { require('fs').unlinkSync(out) } catch {}
// VACUUM INTO gives a compact, defragmented copy without touching the dev save.
src.exec(\"VACUUM INTO '\" + out + \"'\")
const dst = new D(out)
dst.exec('PRAGMA journal_mode=DELETE')
// Keep only the LATEST price row per (card, kind, variant) — the seed prices
// the catalog; price HISTORY regrows as the game plays.
const before = dst.prepare('SELECT COUNT(*) n FROM price_records').get().n
dst.exec(\"DELETE FROM price_records WHERE id NOT IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY card_id, kind, variant ORDER BY retrieved_at DESC) rn FROM price_records) WHERE rn=1)\")
const after = dst.prepare('SELECT COUNT(*) n FROM price_records').get().n
// Drop the game layer: the seed is catalog only (schema stays via CREATE
// statements already applied; dropping non-catalog tables keeps it lean).
const tables = dst.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('sets','cards','price_records','sqlite_sequence')\").all()
dst.exec('PRAGMA foreign_keys=OFF')
for (const t of tables) dst.exec('DROP TABLE IF EXISTS \"' + t.name + '\"')
dst.exec('VACUUM')
console.log('price rows:', before, '→', after)
console.log('cards:', dst.prepare('SELECT COUNT(*) n FROM cards').get().n, '| sets:', dst.prepare('SELECT COUNT(*) n FROM sets').get().n)
const sz = require('fs').statSync(out).size
console.log('seed size:', (sz / 1024 / 1024).toFixed(1), 'MB')
dst.close()
src.close()
require('fs').renameSync(out, 'data/catalog-seed.db')
console.log('WROTE data/catalog-seed.db')
"
