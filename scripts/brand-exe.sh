#!/usr/bin/env bash
# Brand a built TCG-Life exe: app icon + Windows version metadata.
# Usage: scripts/brand-exe.sh <path-to-exe> [binary-name]   (default: release/TCG-Life.exe)
set -euo pipefail
cd "$(dirname "$0")/.."

EXE="${1:-release/TCG-Life.exe}"
BIN_NAME="${2:-TCG-Life.exe}"

# Single source of truth: package.json. Every build stamps the exe metadata
# (and the installer name, which reads it off the branded exe) from here.
APP_VERSION=$(node -p "require('./package.json').version")
# PE file versions are four uint16s — keep the numeric triplet, drop any
# prerelease suffix (0.2.0-beta.1 → 0.2.0.0).
VER4=$(echo "$APP_VERSION" | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+' ).0
TMP="$EXE.branding.tmp"

npx resedit "$EXE" --out "$TMP" \
  --ignore-signed \
  --icon assets/icon.ico \
  --product-name "TCG Life" \
  --file-description "TCG Life — Collector Simulator" \
  --company-name "TCG Life" \
  --copyright "© 2026 TCG Life" \
  --original-filename "$BIN_NAME" \
  --internal-name "${BIN_NAME%.exe}" \
  --file-version "$VER4" \
  --product-version "$VER4"

mv "$TMP" "$EXE"
echo "branded $EXE (icon + version metadata, v$APP_VERSION)"
