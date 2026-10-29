#!/usr/bin/env bash
# Build TCG Life as a real desktop app for Windows.
#
#   Output: release/TCG-Life.exe          the window (WebView2 host)
#           release/TCG-Life-Server.exe   the game server (Node SEA)
#           release/ + support files
#
#   Run it: double-click release\TCG-Life.exe — a native window with the
#   game inside, own taskbar icon, no browser. It spawns the server exe as
#   a child; closing the window stops the game.
#
# The exe embeds the bundled API server; the release folder carries the SPA
# (dist/), the SQLite catalog (data/), schema.sql, and the better-sqlite3
# native addon (node_modules/better-sqlite3 + bindings + file-uri-to-path).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 1/6 typecheck"
npm run typecheck

echo "==> 2/6 build SPA (vite)"
npm run build

echo "==> 3/6 bundle API server (esbuild, better-sqlite3 external)"
mkdir -p dist-server
# __TCGLIFE_VERSION__ is inlined from package.json so the packaged server
# reports its real version (tsx dev boots fall back to 'dev').
APP_VERSION=$(node -p "require('./package.json').version")
npx esbuild server/index.ts --bundle --platform=node --format=cjs \
  --define:__TCGLIFE_VERSION__=\"$APP_VERSION\" \
  --outfile=dist-server/index.cjs --external:better-sqlite3

cp server/schema.sql dist-server/schema.sql

echo "==> 3b/6 app icon (generate + pack)"
npx tsx scripts/make-icon.ts
python scripts/png-to-ico.py

echo "==> 4/6 SEA blob + server exe (node --experimental-sea-config + postject)"
cd dist-server
node --experimental-sea-config sea-config.json
cp "$(node -p "process.execPath")" TCG-Life-Server.exe
npx postject TCG-Life-Server.exe NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
cd ..

echo "==> 4b/6 brand server exe (icon + version metadata)"
bash scripts/brand-exe.sh dist-server/TCG-Life-Server.exe TCG-Life-Server.exe

echo "==> 4b2/6 prepare UPX (compresses the release copy, not the installer payload)"
# Measured: Inno's solid LZMA2 already compresses the raw 85MB node runtime
# better than UPX (~25MB vs ~26MB in the setup), so the installer ships the
# unpacked exe. The portable release/ folder gets the UPX-packed one
# (85MB → 22MB on disk). UPX must run AFTER all resource embedding.
UPX=tools/upx-5.2.1-win64/upx.exe
[ -f "$UPX" ] || {
  echo "==> fetching UPX 5.2.1"
  mkdir -p tools
  curl -sL -o /tmp/upx.zip "https://github.com/upx/upx/releases/download/v5.2.1/upx-5.2.1-win64.zip"
  (cd tools && unzip -oq /tmp/upx.zip)
}

echo "==> 4c/6 window host (WebView2)"
bash scripts/build-host.sh

echo "==> 5/6 assemble release/"
# Archive a save with real play history BEFORE the wipe — rm bypasses the
# Recycle Bin, and the installer's own guard (build-installer.sh) runs only
# AFTER this rm, so this is the last moment the save still exists. The
# smoke-test save (inventory 0) is ignored and simply deleted.
if [ -f release/data/tcglife.db ]; then
  rows=$(node -e "try{const db=require('better-sqlite3')('release/data/tcglife.db',{readonly:true});console.log(db.prepare(\"SELECT COUNT(*) c FROM inventory\").get().c + '/' + db.prepare('SELECT COUNT(*) c FROM activity_log').get().c)}catch(e){console.log('ERR')}")
  # A count error (file locked right after a taskkill, corrupt wal, anything)
  # must ABORT the build — silently proceeding would wipe a played save that
  # we simply couldn't read. Only a genuine smoke-test save (0 rows) passes.
  if [ "$rows" = "ERR" ] || [ -z "$rows" ]; then
    echo "!! could not read release/data/tcglife.db to archive it (count: '$rows') — refusing to wipe release/."
    echo "!! Wait a few seconds for the killed game to release the file, then re-run."
    exit 1
  fi
  if [ "$rows" != "0/0" ] && [ -n "$rows" ]; then
    # Fold the WAL into the main file BEFORE copying it: taskkill -F never
    # runs a clean SQLite close, so since the last checkpoint everything the
    # player did lives only in tcglife.db-wal. A main-file-only cp captured a
    # stale image and the `rm -rf release` below then destroyed the WAL with
    # it — this actually shipped (a session's play was lost to it), so refuse
    # to back up if the fold fails rather than archive a stale save.
    if ! node -e "try{const db=require('better-sqlite3')('release/data/tcglife.db');db.pragma('wal_checkpoint(TRUNCATE)');db.close()}catch(e){console.error(e.message);process.exit(1)}"; then
      echo "!! could not fold the WAL into release/data/tcglife.db — refusing to wipe release/."
      exit 1
    fi
    mkdir -p saves
    base="saves/save-$(date +%Y%m%d-%H%M%S)-inv${rows%%/*}.db"
    cp release/data/tcglife.db "$base"
    # Belt and braces: carry any WAL/SHM residue alongside so a restore can
    # put it back instead of dropping it.
    if [ -f release/data/tcglife.db-wal ]; then cp release/data/tcglife.db-wal "$base-wal"; fi
    if [ -f release/data/tcglife.db-shm ]; then cp release/data/tcglife.db-shm "$base-shm"; fi
    echo "==> backed up played save (inventory ${rows%%/*}, WAL folded) to saves/ BEFORE the release/ rebuild"
  fi
fi
rm -rf release
mkdir -p release/data release/node_modules
cp dist-server/TCG-Life-Host.exe release/TCG-Life.exe
cp dist-server/TCG-Life-Server.exe release/
echo "==> 5b/6 pack release server copy (UPX-LZMA: 85MB → 22MB on disk)"
"$UPX" --lzma -q release/TCG-Life-Server.exe
# WebView2 runtime files the window host needs beside it:
cp dist-server/WebView2Loader.dll dist-server/Microsoft.Web.WebView2.Core.dll \
   dist-server/Microsoft.Web.WebView2.WinForms.dll release/
cp dist-server/schema.sql release/
cp scripts/create-shortcut.cmd release/CreateDesktopShortcut.cmd
cp -r dist release/dist
# Ship the current save + catalog (delete data/tcglife.db here first for a factory-fresh exe).
cp data/tcglife.db release/data/ 2>/dev/null || true
cp data/tcgcsv-groups.json release/data/ 2>/dev/null || true
# Catalog seed: the offline full-card-catalog snapshot (sets + cards + latest
# real price per card, ~14MB) so fresh installs and old saves stock the whole
# catalog in seconds instead of re-crawling the API on every boot.
cp data/catalog-seed.db release/data/ 2>/dev/null || echo "WARN: no data/catalog-seed.db — regen with scripts/make-catalog-seed.sh"

# Native addon runtime trio (resolved from disk via createRequire at boot)
mkdir -p release/node_modules/better-sqlite3 release/node_modules/bindings release/node_modules/file-uri-to-path
cp node_modules/better-sqlite3/package.json release/node_modules/better-sqlite3/
cp node_modules/better-sqlite3/LICENSE release/node_modules/better-sqlite3/ 2>/dev/null || true
cp -r node_modules/better-sqlite3/build release/node_modules/better-sqlite3/build
cp -r node_modules/better-sqlite3/lib release/node_modules/better-sqlite3/lib
cp node_modules/bindings/package.json release/node_modules/bindings/
cp node_modules/bindings/bindings.js release/node_modules/bindings/
cp node_modules/file-uri-to-path/package.json release/node_modules/file-uri-to-path/
cp node_modules/file-uri-to-path/index.js release/node_modules/file-uri-to-path/

echo "==> 6/6 smoke test (server exe, headless boot on :8792)"
TCGLIFE_PORT=8792 TCGLIFE_NO_OPEN=1 ./release/TCG-Life-Server.exe > /tmp/tcglife-exe-smoke.log 2>&1 &
SMOKE_PID=$!
SMOKE_OK=0
for _ in $(seq 1 20); do
  sleep 2
  CODE=$(curl -s --noproxy '*' -m 5 -o /dev/null -w '%{http_code}' http://localhost:8792/api/state || true)
  if [ "$CODE" = "200" ]; then SMOKE_OK=1; break; fi
  if ! kill -0 $SMOKE_PID 2>/dev/null; then
    # bash lost track of the pid (Windows detached it) — is the port live anyway?
    netstat -ano | grep ':8792' | grep -q LISTENING && break
    echo "SMOKE TEST FAILED — server exited during boot; see /tmp/tcglife-exe-smoke.log"
    exit 1
  fi
done
[ "$SMOKE_OK" = 1 ] || { echo "SMOKE TEST FAILED — /api/state never answered; see /tmp/tcglife-exe-smoke.log"; exit 1; }
# SPA must serve too: a broken APP_ROOT previously shipped a 404 on / while the API looked healthy.
SPA_OK=0
for _ in $(seq 1 10); do
  CODE=$(curl -s --noproxy '*' -m 5 -o /dev/null -w '%{http_code}' http://localhost:8792/ || true)
  [ "$CODE" = "200" ] && SPA_OK=1 && break
  sleep 1
done
[ "$SPA_OK" = 1 ] || { echo "SMOKE TEST FAILED — / does not serve the SPA shell (static path broken)"; exit 1; }
echo "smoke ok — v$(node -p "require('./package.json').version")" + SPA
kill $SMOKE_PID 2>/dev/null || true
# kill by port on Windows (the exe detaches from the shell PID)
PID=$(netstat -ano | grep ':8792' | grep LISTENING | awk '{print $NF}' | head -1 || true)
[ -n "$PID" ] && taskkill //F //PID "$PID" > /dev/null 2>&1 || true
taskkill //F //IM TCG-Life-Server.exe > /dev/null 2>&1 || true
rm -f release/data/tcglife.db-wal release/data/tcglife.db-shm
# The smoke boot ran against a factory-fresh release/ — its save is this
# build's smoke save, never the player's (their save was archived before the
# wipe above). Delete it: leaving it made the next gate archive a 158MB
# "played save" with zero inventory and boot the game on a fresh $1,000.
rm -f release/data/tcglife.db
# The smoke boot runs the game-day tick, which now takes a save snapshot —
# drop it so builds don't accumulate 137 MB backup folders in release/.
rm -rf release/data/backups

echo ""
echo "Done. Ship the release/ folder — TCG-Life.exe is your game (window + server)."
