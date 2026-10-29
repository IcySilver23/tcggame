#!/usr/bin/env bash
# Build the WebView2 window host (TCG-Life-Host.exe) with the stock .NET
# Framework C# compiler — no Visual Studio, no NuGet restore.
#
#   dist-server/TCG-Life-Host.exe   the window: spawns TCG-Life-Server.exe,
#                                   hosts http://localhost:8787 in WebView2
#
# The WebView2 SDK (managed assemblies + native loader) is fetched on first
# run from NuGet and cached in dist-server/webview-sdk/.
set -euo pipefail
cd "$(dirname "$0")/.."

SDK_DIR=dist-server/webview-sdk
WV2_VER=1.0.2903.40

# --- 1. SDK (cached; fetched from NuGet on first run) ---
if [ ! -f "$SDK_DIR/lib/net462/Microsoft.Web.WebView2.WinForms.dll" ]; then
  echo "==> fetching WebView2 SDK $WV2_VER"
  mkdir -p "$SDK_DIR"
  curl -sL -o /tmp/webview2.nupkg "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$WV2_VER"
  (cd "$SDK_DIR" && unzip -oq /tmp/webview2.nupkg "build/native/x64/*" "lib/net462/*.dll")
fi

# --- 2. Compile (C# 5 is fine — the host uses nothing newer) ---
CSC="/c/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe"
[ -f "$CSC" ] || { echo "csc.exe not found — .NET Framework 4.x is required"; exit 1; }

echo "==> compiling window host (csc.exe)"
# Note: backslash paths — csc.exe is a native Windows tool and mangles
# forward-slash relative paths passed through from bash.
CSC_OUT=$("$CSC" -nologo -target:winexe -platform:x64 -optimize+ \
  -out:'dist-server\TCG-Life-Host.exe' \
  -r:"$SDK_DIR\lib\net462\Microsoft.Web.WebView2.Core.dll" \
  -r:"$SDK_DIR\lib\net462\Microsoft.Web.WebView2.WinForms.dll" \
  -r:System.Windows.Forms.dll -r:System.Drawing.dll \
  -win32manifest:'assets\app.manifest' \
  -res:'assets\icon.png,icon.png' \
  'scripts\webview-host.cs' 2>&1) || { echo "$CSC_OUT"; exit 1; }
[ -n "$CSC_OUT" ] && echo "$CSC_OUT"

# Native loader must sit beside the exe (net462 pair P/Invokes it by name),
# and the managed pair must ship with the host too (loaded at runtime).
cp "$SDK_DIR/build/native/x64/WebView2Loader.dll" dist-server/
cp "$SDK_DIR/lib/net462/Microsoft.Web.WebView2.Core.dll" \
   "$SDK_DIR/lib/net462/Microsoft.Web.WebView2.WinForms.dll" dist-server/

# --- 3. Brand with the app icon + version metadata ---
bash scripts/brand-exe.sh dist-server/TCG-Life-Host.exe TCG-Life-Host.exe
echo "host built: dist-server/TCG-Life-Host.exe"
