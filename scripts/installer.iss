; TCG Life — Windows installer (Inno Setup 6)
;
; Per-user install (no admin): everything lives under %LOCALAPPDATA%.
; The game writes its save next to its exe (data/), which is exactly why
; this installer does NOT target Program Files.
;
;   • Start Menu entry + optional desktop shortcut (task, default on)
;   • WebView2 runtime check — evergreen engine the window host needs;
;     offered silently if missing (official Microsoft bootstrapper)
;   • Seeds the save the build staged (scripts/build-installer.sh) — but only
;     onto a machine that has no save yet: upgrades never touch an existing
;     data/ folder, and uninstalling preserves the save (only a manual
;     "Remove save data" task deletes it)
;
; Build: scripts/build-installer.sh  →  dist-server/TCG-Life-Setup-<ver>.exe

#define AppName "TCG Life"
#define AppExe "TCG-Life.exe"
; ISPP resolves paths relative to this script's folder (scripts/), so walk up.
#define AppVersion GetVersionNumbersString("..\dist-server\TCG-Life-Host.exe")
#define AppPublisher "TCG Life"

[Setup]
AppId={{8C1B2D64-9E33-4A57-BCB2-6D41C0A5F001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\TCG Life
; [Files]/SetupIconFile paths are relative to SourceDir — project root.
SourceDir=..
DisableDirPage=no
DisableProgramGroupPage=yes
OutputDir=dist-server
OutputBaseFilename=TCG-Life-Setup-{#AppVersion}
SetupIconFile=assets\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce

[Files]
; The app: window host + game server + WebView2 runtime files
Source: "dist-server\TCG-Life-Host.exe"; DestDir: "{app}"; DestName: "{#AppExe}"; Flags: ignoreversion
; Measured both ways: LZMA2/ultra64 on the unpacked server beats storing the
; UPX-packed copy uncompressed (24.5 vs 26.0 MiB) — solid LZMA2 out-compresses
; UPX --lzma, so the installer takes the dist-server (unpacked) exe and the
; packed copy is a release/-folder-only win.
Source: "dist-server\TCG-Life-Server.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist-server\WebView2Loader.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist-server\Microsoft.Web.WebView2.Core.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist-server\Microsoft.Web.WebView2.WinForms.dll"; DestDir: "{app}"; Flags: ignoreversion
; The game world: built SPA + offline catalog
Source: "release\dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "release\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "dist-server\schema.sql"; DestDir: "{app}"; Flags: ignoreversion
; The offline catalog seed (sets + cards + latest prices): a fresh install
; starts fully stocked without crawling the API on first boot.
Source: "data\catalog-seed.db"; DestDir: "{app}\data"; Flags: ignoreversion
; A player save, only when the build was told to carry one on purpose
; (TCGLIFE_SHIP_SAVE=<path> in build-installer.sh — the default build stages no
; save at all). Absent → factory-fresh payload, data/ is created on first boot
; from schema.sql. onlyifdoesntexist is the safety rail: installing over an
; existing game never touches data/, it only seeds a machine that has no save
; yet — which is why an upgrade does not need the save to be shipped.
Source: "dist-server\ship-save.db"; DestDir: "{app}\data"; DestName: "tcglife.db"; \
  Flags: skipifsourcedoesntexist onlyifdoesntexist
Source: "assets\WebView2Bootstrapper.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; Comment: "TCG Life — Collector Simulator"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
; Offer the WebView2 runtime (silent) only if the Evergreen runtime is absent.
Filename: "{tmp}\WebView2Bootstrapper.exe"; Parameters: "/silent /install"; \
  StatusMsg: "Installing the WebView2 runtime (one-time)..."; \
  Check: NeedWebView2; Flags: skipifdoesntexist waituntilterminated
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; \
  Flags: nowait postinstall skipifsilent

[UninstallRun]
; Make sure the game and its server are stopped before files are removed.
Filename: "{cmd}"; Parameters: "/C taskkill /F /IM TCG-Life-Server.exe /T 2>nul & taskkill /F /IM TCG-Life.exe /T 2>nul"; \
  Flags: runhidden; RunOnceId: "StopGame"

[UninstallDelete]
; The WebView2 browser profile belongs to the app, not the player;
; the server log is disposable too.
Type: filesandordirs; Name: "{localappdata}\TCGLife"
Type: files; Name: "{app}\TCG-Life-Server.log"

[Code]
const
  WebView2Key = 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function NeedWebView2(): Boolean;
var
  Pv, Key: String;
begin
  Key := WebView2Key;
  Result := not RegQueryStringValue(HKLM, Key, 'pv', Pv);
  if Result then
  begin
    // Some installs register under the 64-bit hive instead.
    StringChangeEx(Key, 'WOW6432Node\', '', True);
    Result := not RegQueryStringValue(HKLM, Key, 'pv', Pv);
  end;
end;

// Keep the player's save (app\data) on uninstall unless they explicitly
// opt in to wiping it. Everything else under {app} is removed normally.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  SaveDir: String;
  Wipe: Boolean;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    SaveDir := ExpandConstant('{app}\data');
    if DirExists(SaveDir) then
    begin
      if UninstallSilent() then
        Wipe := False // silent uninstall: never destroy data unasked
      else
        Wipe := MsgBox('Delete your saved game (the data folder in the install directory)?' #13#10
                       'Choose No to keep the save — it will be picked up again if you reinstall.',
                       mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
      if Wipe then
        DelTree(SaveDir, True, True, True);
    end;
  end;
end;
