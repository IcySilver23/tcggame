#!/usr/bin/env bash
# The release gate: the checks that must be green before an installer or a
# portable zip is allowed to exist.
#
#   npm run check:sealed        sealed audit + hit odds + daily deals + failure path
#   npm run check:odds          hit odds on their own (no rarity on the generic weight)
#   npm run check:changelog     the ✨ What's New rules
#   npm run check:promo-badge   the shelf's promo tag: no clipping, no price collision
#   tmp/check-academy-steps.ts  every Academy step, plus the legacy-waiver edge
#   tmp/check-generations.ts    the fifteen Generations boxes: packs, promos, art, price
#   tmp/check-hit-ladders.ts    every set's hit ladder against the pull table it deals
#   tmp/check-bulk.ts           quantity buys and bulk rips, wrapper by wrapper
#
# Called by scripts/build-installer.sh BEFORE anything is built, so a red check
# costs a minute instead of a seven-minute build and a public download. 0.90.0
# shipped a display that paid out 32% on every rip because the sealed audit had
# not been run since the bulk code landed; this is what stops that being a
# memory exercise.
#
#   bash scripts/check-release.sh
#
# The player's save is never touched. The sealed audit resolves its own isolated
# copy; the Academy and bulk checks each get a scratch copy of that home, because
# one deletes the save's academy:* meta and the other buys and rips stock.
set -euo pipefail
cd "$(dirname "$0")/.."

TMP=tmp/release-check
rm -rf "$TMP"
mkdir -p "$TMP/reports"

step() { echo; echo "==> $1"; }

# 1. Static and instant: fail here before a single save is copied.
step "release gate 1/8: changelog rules"
npm run --silent check:changelog

# 2. Also static: a three-promo shelf tag must show every name and stay clear of
#    the price label. It reads src/styles.css and src/views/Packs.tsx.
step "release gate 2/8: promo badge layout"
npm run --silent check:promo-badge

# 3. The sealed audit resolves its own isolated home (a copy of data/tcglife.db,
#    a prepared snapshot, or a catalogue seeded from data/catalog-seed.db) and
#    runs the hit-odds and daily-deal checks underneath the audit.
#    Its reports go to tmp/ as well: refreshing the tracked reports/ copies stays
#    a deliberate act (`npm run check:sealed` by hand), so a release build never
#    leaves the working tree dirty mid-release.
step "release gate 3/8: sealed audit"
SEALED_AUDIT_REPORT_DIR="$PWD/$TMP/reports" npm run --silent check:sealed

# 4. Whatever that just resolved is what the remaining checks copy: already
#    isolated from the player's save, and on a checkout with no dev save it is
#    the freshly seeded catalogue.
SAVE=""
for home in tmp/sealed-audit-home tmp/audit-home; do
  if [ -f "$home/data/tcglife.db" ]; then SAVE="$home/data/tcglife.db"; break; fi
done
if [ -z "$SAVE" ] && [ -f data/tcglife.db ]; then SAVE="data/tcglife.db"; fi
if [ -z "$SAVE" ]; then
  echo "!! the sealed audit left no save to copy for the Academy and bulk checks"
  exit 1
fi
SOURCE_HOME=$(dirname "$(dirname "$SAVE")")
echo "gate save: $SAVE"

# 5. The hit-odds check on its own name, against that save. Its report goes to
#    tmp/ so a release build never rewrites the tracked reports/ copies.
step "release gate 4/8: hit odds"
TCGLIFE_HOME="$SOURCE_HOME" HIT_ODDS_REPORT_DIR="$PWD/$TMP/reports" npm run --silent check:odds

# A scratch home: the save plus the schema the services expect to find beside it.
scratch() {
  local dir="$TMP/$1"
  mkdir -p "$dir/data"
  local suffix
  for suffix in '' '-wal' '-shm'; do
    if [ -f "$SAVE$suffix" ]; then cp "$SAVE$suffix" "$dir/data/tcglife.db$suffix"; fi
  done
  if [ -f "$SOURCE_HOME/schema.sql" ]; then cp "$SOURCE_HOME/schema.sql" "$dir/schema.sql"
  else cp server/schema.sql "$dir/schema.sql"; fi
  echo "$dir"
}

ACADEMY=$(scratch academy)
BULK=$(scratch bulk)

# Generations runs on a FACTORY-FRESH catalogue rather than a copy of the dev
# save. 0.91.1 first went out with boxes that could not be opened on a new
# machine — the wrapper row they deal from was only ever seeded into saves that
# predated it — and a check against a played save cannot see that shape at all.
# So this home starts from the seed and schema and grows everything the way a
# first boot does.
GENERATIONS="$TMP/generations"
if [ -f data/catalog-seed.db ]; then
  rm -rf "$GENERATIONS"
  mkdir -p "$GENERATIONS/data"
  cp data/catalog-seed.db "$GENERATIONS/data/catalog-seed.db"
  cp server/schema.sql "$GENERATIONS/schema.sql"
else
  GENERATIONS=$(scratch generations)
fi

# The bulk check buys a few boosters, so a dev save that has been spent down
# would fail it for the wrong reason. The COPY is topped up; the real save is
# never opened.
node -e 'const db=require("better-sqlite3")(process.argv[1]);const r=db.prepare("SELECT cash FROM game_state WHERE id=1").get();if(r&&r.cash<200){db.prepare("UPDATE game_state SET cash=200 WHERE id=1").run();console.log("gate: scratch cash",r.cash,"-> 200")}db.close()' "$BULK/data/tcglife.db"

# 5-8. The proofs that live in tmp/ rather than in package.json.
TSX=./node_modules/tsx/dist/cli.mjs

# The ladder is what the panels quote and the pull table is what the roller
# deals; nothing compared them until 0.94.10 got the first one wrong.
step "release gate 5/8: hit ladders"
TCGLIFE_HOME="$SOURCE_HOME" node "$TSX" tmp/check-hit-ladders.ts | tail -3

step "release gate 6/8: Academy steps"
TCGLIFE_HOME="$ACADEMY" node "$TSX" tmp/check-academy-steps.ts | tail -3

step "release gate 7/8: Generations boxes"
TCGLIFE_HOME="$GENERATIONS" node "$TSX" tmp/check-generations.ts | tail -3

step "release gate 8/8: bulk buy and rip"
TCGLIFE_HOME="$BULK" node "$TSX" tmp/check-bulk.ts | tail -4

echo
echo "release gate passed: changelog, promo badge, sealed audit, hit odds, hit ladders, Academy steps, Generations boxes, bulk rip"
