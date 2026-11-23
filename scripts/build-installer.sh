#!/usr/bin/env bash
# Build the TCG Life Windows installer (Inno Setup).
#
#   Output: dist-server/TCG-Life-Setup-<version>.exe
#
# Pipeline: full app build (scripts/build-exe.sh) → prune the staging folder
# to factory-fresh (no player save, no logs) → compile installer.iss with
# ISCC. The installer itself is per-user (no admin) and installs to
# %LOCALAPPDATA%\Programs\TCG Life.
set -euo pipefail
cd "$(dirname "$0")/.."

# 0. Decide which save the installer carries. This must happen BEFORE step 1:
#    build-exe.sh archives release/data/tcglife.db and then wipes release/.
#    The payload is FACTORY-FRESH by default: neither the installer nor the
#    portable zip carries a player save unless one is named here. A release is a
#    public download, and it used to carry whatever save happened to be in
#    release/data — so anyone who downloaded it started on the developer's
#    playthrough instead of a new game.
#
#    Shipping one is not needed for upgrades: installer.iss stages the save with
#    `onlyifdoesntexist`, so installing over an existing game never touches
#    data/. The file only ever seeds a machine that has no game at all.
#      TCGLIFE_SHIP_SAVE=<path>   opt in: ship that file (a deliberate build)
#      TCGLIFE_SHIP_SAVE=none     explicit factory-fresh (same as unset)
#      unset                      factory-fresh — the default
mkdir -p dist-server
rm -f dist-server/ship-save.db

# inv/activity rows for a save, or ERR — never fails the build on its own.
rows_of() {
  node -e "try{const db=require('better-sqlite3')(process.argv[1],{readonly:true});const n=db.prepare('SELECT COUNT(*) c FROM inventory').get().c+'/'+db.prepare('SELECT COUNT(*) c FROM activity_log').get().c;db.close();console.log(n)}catch(e){console.log('ERR')}" "$1" 2>/dev/null || echo ERR
}

# Opt-in only. Nothing is picked up implicitly from release/data or saves/ — a
# build that has not been asked to carry a save cannot leak one by accident.
SHIP="${TCGLIFE_SHIP_SAVE:-}"
[ "$SHIP" = "none" ] && SHIP=""

if [ -n "$SHIP" ]; then
  [ -f "$SHIP" ] || { echo "!! ship save not found: $SHIP"; exit 1; }
  # Snapshot FIRST, then checkpoint/verify THE COPY — the source save (an
  # archive, or the live release/ save) is never mutated by this step.
  cp "$SHIP" dist-server/ship-save.db
  if ! node -e "const db=require('better-sqlite3')('dist-server/ship-save.db');db.pragma('wal_checkpoint(TRUNCATE)');const ic=db.pragma('integrity_check',{simple:true});db.close();if(ic!=='ok'){console.error(ic);process.exit(1)}"; then
    echo "!! ship save ($SHIP) failed integrity — refusing to ship it"
    rm -f dist-server/ship-save.db
    exit 1
  fi
  r=$(rows_of dist-server/ship-save.db)
  if [ "$r" = "0/0" ] || [ "$r" = "ERR" ]; then
    echo "!! ship save ($SHIP) has no play history (inventory/activity $r) — refusing to ship it"
    rm -f dist-server/ship-save.db
    exit 1
  fi
  echo "==> 0/6 ship save: $SHIP (inventory/activity $r) -> dist-server/ship-save.db"
else
  echo "==> 0/6 ship save: none requested — factory-fresh payload (opt in with TCGLIFE_SHIP_SAVE=<path>)"
fi

# 0.5 Release gate: the checks that must be green BEFORE anything is built —
#     the sealed audit, hit odds, the changelog rules, the Academy step proof and
#     the bulk rip. 0.90.0 shipped a display paying out 32% a rip because the
#     audit was only ever run by hand; this makes forgetting it impossible. It
#     runs first so a red check costs a minute, not a seven-minute build.
echo "==> 0.5/6 release gate: sealed + odds + changelog + Academy + bulk"
bash scripts/check-release.sh

# 1. The app itself (window host + server exe + support files)
bash scripts/build-exe.sh

# 2. Stage factory-fresh: no player save, no log residue in the payload.
# A save with real play history gets a timestamped backup FIRST — this wipe
# once destroyed the only copy of a played save (rm bypasses the Recycle Bin).
if [ -f release/data/tcglife.db ]; then
  rows=$(node -e "try{const db=require('better-sqlite3')('release/data/tcglife.db',{readonly:true});console.log(db.prepare(\"SELECT COUNT(*) c FROM inventory\").get().c + '/' + db.prepare('SELECT COUNT(*) c FROM activity_log').get().c)}catch(e){console.log('ERR')}")
  # Same rule as build-exe.sh: an unreadable save aborts the build instead of
  # being silently wiped. Only a genuine smoke-test save (0 rows) passes.
  if [ "$rows" = "ERR" ] || [ -z "$rows" ]; then
    echo "!! could not read release/data/tcglife.db to archive it (count: '$rows') — refusing to wipe release/."
    echo "!! Wait a few seconds for the killed game to release the file, then re-run."
    exit 1
  fi
  if [ "$rows" != "0/0" ] && [ -n "$rows" ]; then
    # Fold the WAL into the main file BEFORE copying it: taskkill -F never runs
    # a clean SQLite close, so since the last checkpoint everything the player
    # did lives only in tcglife.db-wal — a plain cp of the main file would
    # silently roll the save back to its last checkpoint (losing a reset, a
    # day of play, anything since). Refuse to back up if the fold fails.
    if ! node -e "try{const db=require('better-sqlite3')('release/data/tcglife.db');db.pragma('wal_checkpoint(TRUNCATE)');db.close()}catch(e){console.error(e.message);process.exit(1)}"; then
      echo "!! could not fold the WAL into release/data/tcglife.db — refusing to back up a possibly-stale save."
      exit 1
    fi
    mkdir -p saves
    base="saves/save-$(date +%Y%m%d-%H%M%S)-inv${rows%%/*}.db"
    cp release/data/tcglife.db "$base"
    # Belt and braces: carry any WAL residue that reappeared alongside, so a
    # restore can copy it back instead of dropping it.
    [ -f release/data/tcglife.db-wal ] && cp release/data/tcglife.db-wal "$base-wal"
    [ -f release/data/tcglife.db-shm ] && cp release/data/tcglife.db-shm "$base-shm"
    echo "==> backed up played save (inventory ${rows%%/*}, WAL folded) to saves/"
  fi
fi
rm -f release/data/tcglife.db release/data/tcglife.db-wal release/data/tcglife.db-shm
rm -rf release/data/backups
rm -f release/TCG-Life-Server.log
# schema.sql + tcgcsv-groups.json stay: the catalog seeds itself on first boot.

# ...but if the installer carries a save, release/ carries the SAME save. The
# two artifacts must never disagree about what game a player gets (step 1 left
# release/ with the repo's fresh dev copy, which is not the real game).
if [ -f dist-server/ship-save.db ]; then
  mkdir -p release/data
  cp dist-server/ship-save.db release/data/tcglife.db
  rm -f release/data/tcglife.db-wal release/data/tcglife.db-shm
  echo "==> release/data/tcglife.db kept in sync with the installer payload"
fi

# 3. Compile the installer. ISCC flags start with / — stop MSYS path mangling.
ISCC="$LOCALAPPDATA/Programs/Inno Setup 6/ISCC.exe"
[ -f "$ISCC" ] || ISCC="/c/Program Files (x86)/Inno Setup 6/ISCC.exe"
[ -f "$ISCC" ] || { echo "Inno Setup 6 not found — install it from https://jrsoftware.org/isdl.php"; exit 1; }

echo "==> compiling installer"
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" "$ISCC" "scripts\\installer.iss"

SETUP=$(ls -t dist-server/TCG-Life-Setup-*.exe | head -1)
echo "installer ready: $SETUP ($(du -h "$SETUP" | cut -f1))"
