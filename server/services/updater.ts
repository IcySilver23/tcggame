import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// In-place updates from a downloaded setup file.
//
// TCG Life ships as a per-user Inno Setup install, so an update is the same
// setup exe that was used the first time — just run silently against the
// existing install. There is no release server to poll: when a newer
// TCG-Life-Setup-*.exe is sitting in one of the player's normal download
// folders, the running game offers it on open. The setup keeps the same AppId,
// so Inno upgrades the existing directory and leaves data/ (the save) alone.
//
// The hand-off is deliberately detached: this server cannot replace its own
// exe while it is running. A small PowerShell helper waits for the window and
// server to exit, runs the installer with /VERYSILENT, then launches the game
// again. A marker in %LOCALAPPDATA%\TCGLife tells the next launch that it just
// came through an update, which is what makes What's New open by itself.
// ---------------------------------------------------------------------------

const SETUP_RE = /^TCG-Life-Setup-(\d+(?:\.\d+){2,3})\.exe$/i
const MIN_SETUP_BYTES = 1_000_000
const DOWNLOAD_SETTLE_MS = 2_000

type Candidate = {
  file: string
  name: string
  version: string
  size: number
  mtime: number
}

function appRoot(): string {
  return path.dirname(process.execPath)
}

function appExe(): string {
  return path.join(appRoot(), 'TCG-Life.exe')
}

/** A portable release folder has no Inno uninstaller; only a real install can
 *  safely run the setup in place. */
function isInstalledCopy(): boolean {
  if (!fs.existsSync(appExe())) return false
  try {
    return fs.readdirSync(appRoot()).some((name) => /^unins\d+\.exe$/i.test(name))
  } catch {
    return false
  }
}

function parts(version: string): number[] {
  const out = version.split('.').map((n) => Number(n))
  while (out.length < 4) out.push(0)
  return out.slice(0, 4)
}

/** Numeric, padded comparison: 0.77.54.0 is newer than 0.77.53, and
 *  0.77.53.0 is exactly equal to 0.77.53. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

export function sameVersion(a: string, b: string): boolean {
  return compareVersions(a, b) === 0
}

function isExeFile(file: string): boolean {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const head = Buffer.alloc(2)
    const n = fs.readSync(fd, head, 0, 2, 0)
    return n === 2 && head[0] === 0x4d && head[1] === 0x5a
  } catch {
    return false
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch { /* already gone */ }
    }
  }
}

function downloadDirs(): string[] {
  const home = os.homedir()
  const dirs = [
    path.join(home, 'Downloads'),
    path.join(home, 'Desktop'),
    path.join(home, 'OneDrive', 'Desktop'),
    path.join(home, 'OneDrive', 'Downloads'),
  ]
  const seen = new Set<string>()
  return dirs.filter((dir) => {
    const key = dir.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    try { return fs.statSync(dir).isDirectory() } catch { return false }
  })
}

function findCandidate(currentVersion: string, wanted?: string): Candidate | null {
  const now = Date.now()
  const found: Candidate[] = []
  for (const dir of downloadDirs()) {
    let names: string[]
    try { names = fs.readdirSync(dir) } catch { continue }
    for (const name of names) {
      const match = SETUP_RE.exec(name)
      if (!match) continue
      const version = match[1]
      if (compareVersions(version, currentVersion) <= 0) continue
      if (wanted && !sameVersion(version, wanted)) continue
      const file = path.join(dir, name)
      let stat: fs.Stats
      try { stat = fs.statSync(file) } catch { continue }
      // A browser still writing a download leaves a growing .exe. Don't offer a
      // setup until it has been untouched for a moment and looks like a PE.
      if (!stat.isFile() || stat.size < MIN_SETUP_BYTES) continue
      if (now - stat.mtimeMs < DOWNLOAD_SETTLE_MS) continue
      if (!isExeFile(file)) continue
      found.push({ file, name, version, size: stat.size, mtime: stat.mtimeMs })
    }
  }
  found.sort((a, b) => compareVersions(b.version, a.version) || b.mtime - a.mtime)
  return found[0] ?? null
}

const STATE_DIR = path.join(
  process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
  'TCGLife',
)
const STATE_FILE = path.join(STATE_DIR, 'update-state.json')
// Keep the helper beside the state marker instead of trusting %TEMP%: a shell
// can launch the game with a POSIX-style TEMP, which Windows PowerShell cannot
// execute. LocalAppData is always a real Windows path.
const TMP_DIR = path.join(STATE_DIR, 'tmp')

type AppliedUpdate = { from: string; to: string; at: string }

/** Read the marker written just before the installer ran. It only counts once
 *  the running version is the version that was installed. */
export function readAppliedUpdate(currentVersion: string): AppliedUpdate | null {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Partial<AppliedUpdate>
    if (!raw || typeof raw.from !== 'string' || typeof raw.to !== 'string') return null
    if (!sameVersion(raw.to, currentVersion)) return null
    return { from: raw.from, to: raw.to, at: typeof raw.at === 'string' ? raw.at : new Date().toISOString() }
  } catch {
    return null
  }
}

export function clearAppliedUpdate(): void {
  try { fs.rmSync(STATE_FILE, { force: true }) } catch { /* nothing to clear */ }
}

function markPending(from: string, to: string): void {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  const marker: AppliedUpdate = { from, to, at: new Date().toISOString() }
  fs.writeFileSync(STATE_FILE, JSON.stringify(marker), 'utf8')
}

export type UpdateStatus = {
  currentVersion: string
  available: boolean
  version?: string
  installerName?: string
  size?: number
  justUpdated: AppliedUpdate | null
}

export function checkForUpdate(currentVersion: string): UpdateStatus {
  const justUpdated = readAppliedUpdate(currentVersion)
  if (!isInstalledCopy()) {
    return { currentVersion, available: false, justUpdated }
  }
  const candidate = findCandidate(currentVersion)
  if (!candidate) {
    return { currentVersion, available: false, justUpdated }
  }
  return {
    currentVersion,
    available: true,
    version: candidate.version,
    installerName: candidate.name,
    size: candidate.size,
    justUpdated,
  }
}

const POWERSHELL_SCRIPT = String.raw`
param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$AppExe,
  [int]$HostProcessId = 0,
  [int]$ServerProcessId = 0,
  [Parameter(Mandatory=$true)][string]$LogPath,
  [string]$TaskName = '',
  [string]$LauncherPath = ''
)
$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message) {
  try { Add-Content -LiteralPath $LogPath -Value ((Get-Date).ToString('s') + ' ' + $Message) } catch { }
}

function Wait-ForExit([int]$ProcessId) {
  if ($ProcessId -le 0) { return }
  try {
    $p = [System.Diagnostics.Process]::GetProcessById($ProcessId)
    if ($p -ne $null) { [void]$p.WaitForExit(30000) }
  } catch { }
}

Write-Log "updater started for $Installer"
Wait-ForExit $HostProcessId
Wait-ForExit $ServerProcessId
# The host closes its window a few seconds after the server exits; give the
# installer a clean desktop and no locked exe files.
Start-Sleep -Milliseconds 1200

$launched = $false
try {
  $installerArgs = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS', '/FORCECLOSEAPPLICATIONS')
  $proc = Start-Process -FilePath $Installer -ArgumentList $installerArgs -Wait -PassThru
  Write-Log "installer exited $($proc.ExitCode)"
  if ($proc.ExitCode -ne 0) { throw "installer exit code $($proc.ExitCode)" }
  Start-Sleep -Milliseconds 1000
  if (Test-Path -LiteralPath $AppExe) {
    Start-Process -FilePath $AppExe | Out-Null
    $launched = $true
    Write-Log "reopened $AppExe"
  } else {
    throw "game exe not found at $AppExe"
  }
} catch {
  Write-Log "update failed: $($_.Exception.Message)"
  # Never leave the player with no game: on any failure, reopen what is there.
  if (-not $launched -and (Test-Path -LiteralPath $AppExe)) {
    Start-Process -FilePath $AppExe | Out-Null
  }
} finally {
  if ($TaskName) { & schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null }
  if ($LauncherPath) { Remove-Item -LiteralPath $LauncherPath -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
}
`

function powershellPath(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const full = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return fs.existsSync(full) ? full : 'powershell.exe'
}

export type BeginUpdateResult = {
  version: string
  installerName: string
}

/** Write the hand-off marker, launch the detached helper, and let the caller
 *  shut the server down after it has answered the HTTP request. */
export function beginUpdate(currentVersion: string, wantedVersion: string): BeginUpdateResult {
  if (!isInstalledCopy()) throw new Error('This copy was not installed, so it cannot update itself.')
  const candidate = findCandidate(currentVersion, wantedVersion)
  if (!candidate) throw new Error('That update setup file is no longer available.')

  const exe = appExe()
  if (!fs.existsSync(exe)) throw new Error('Could not find TCG-Life.exe next to the server.')

  markPending(currentVersion, candidate.version)

  fs.mkdirSync(TMP_DIR, { recursive: true })
  const stamp = `${process.pid}-${Date.now()}`
  const logPath = path.join(TMP_DIR, 'tcglife-update.log')
  const scriptPath = path.join(TMP_DIR, `tcglife-update-${stamp}.ps1`)
  const launcherPath = path.join(TMP_DIR, `tcglife-update-${stamp}.vbs`)
  const taskName = `TCG Life Update ${stamp}`
  fs.writeFileSync(scriptPath, POWERSHELL_SCRIPT, 'utf8')

  // A detached PowerShell child is killed with the game's process tree on some
  // Windows shells. Task Scheduler owns the helper instead: it survives the
  // server, runs in the player's session, and is deleted by the helper itself.
  // The VBS wrapper starts PowerShell hidden, so the player only sees the game
  // close, the installer work, and the game reopen.
  const vbsPath = (value: string) => value.replace(/"/g, '""')
  const vbs = `Set sh = CreateObject("WScript.Shell")
Dim cmd
cmd = "${powershellPath()}" & " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & "${vbsPath(scriptPath)}" & Chr(34) & " -Installer " & Chr(34) & "${vbsPath(candidate.file)}" & Chr(34) & " -AppExe " & Chr(34) & "${vbsPath(exe)}" & Chr(34) & " -HostProcessId ${Number(process.env.TCGLIFE_PARENT_PID) || 0} -ServerProcessId ${process.pid} -LogPath " & Chr(34) & "${vbsPath(logPath)}" & Chr(34) & " -TaskName " & Chr(34) & "${vbsPath(taskName)}" & Chr(34) & " -LauncherPath " & Chr(34) & "${vbsPath(launcherPath)}" & Chr(34)
sh.Run cmd, 0, False
`
  fs.writeFileSync(launcherPath, vbs, 'utf8')

  const wscript = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wscript.exe')
  const action = `"${wscript}" "${launcherPath}"`
  const create = spawnSync('schtasks.exe', [
    '/Create', '/TN', taskName, '/TR', action,
    '/SC', 'ONCE', '/ST', '23:59', '/RL', 'LIMITED', '/F',
  ], { windowsHide: true, encoding: 'utf8' })
  if (create.status !== 0) {
    clearAppliedUpdate()
    try { fs.rmSync(scriptPath, { force: true }) } catch { /* best effort */ }
    try { fs.rmSync(launcherPath, { force: true }) } catch { /* best effort */ }
    throw new Error(create.stderr?.trim() || create.error?.message || 'Could not schedule the update helper.')
  }

  const run = spawnSync('schtasks.exe', ['/Run', '/TN', taskName], { windowsHide: true, encoding: 'utf8' })
  if (run.status !== 0) {
    spawnSync('schtasks.exe', ['/Delete', '/TN', taskName, '/F'], { windowsHide: true })
    clearAppliedUpdate()
    throw new Error(run.stderr?.trim() || run.error?.message || 'Could not start the update helper.')
  }

  return { version: candidate.version, installerName: candidate.name }
}
