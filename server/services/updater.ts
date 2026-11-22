import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// In-place updates from a downloaded setup file.
//
// TCG Life ships as a per-user Inno Setup install, so an update is the same
// setup exe that was used the first time — just run silently against the
// existing install. The setup keeps the same AppId, so Inno upgrades the
// existing directory and leaves data/ (the save) alone.
//
// The release page is the source of truth: the newest published GitHub release
// is polled (cached, so a launch and a half-hourly check cost one request), and
// the setup attached to it is what an in-place update downloads. A newer
// TCG-Life-Setup-*.exe already sitting in Downloads or on the Desktop still
// wins when it is the same version, which keeps a hand-carried update working
// with no connection at all.
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

const GITHUB_REPO = 'IcySilver23/tcggame'
const LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
const RELEASE_PAGE = `https://github.com/${GITHUB_REPO}/`
const RELEASE_TTL_MS = 5 * 60_000
const RELEASE_TIMEOUT_MS = 8_000
const DOWNLOAD_TIMEOUT_MS = 180_000

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

export type RemoteRelease = {
  version: string
  tag: string
  pageUrl: string
  /** The Windows setup attached to the release, when it has one. */
  setup?: { name: string; url: string; size: number }
}

let releaseCache: { at: number; release: RemoteRelease | null } = { at: 0, release: null }

async function fetchWithTimeout(url: string, ms: number, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function versionFromTag(tag: string): string | null {
  const match = /^v?(\d+(?:\.\d+){1,3})$/.exec(tag.trim())
  return match ? match[1] : null
}

function setupVersion(name: string): string | undefined {
  return SETUP_RE.exec(name)?.[1]
}

/**
 * The newest published release on GitHub, or null when there is no connection,
 * the repo is unreachable, or the anonymous API rate limit is spent. Cached for
 * five minutes so the half-hourly check and a fresh launch share one request.
 */
export async function latestRelease(force = false): Promise<RemoteRelease | null> {
  if (!force && releaseCache.at > 0 && Date.now() - releaseCache.at < RELEASE_TTL_MS) {
    return releaseCache.release
  }
  let release: RemoteRelease | null = null
  try {
    const res = await fetchWithTimeout(LATEST_RELEASE_URL, RELEASE_TIMEOUT_MS, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'TCG-Life-Updater',
      },
    })
    if (res.ok) {
      const body = (await res.json()) as {
        tag_name?: string
        html_url?: string
        draft?: boolean
        prerelease?: boolean
        assets?: { name?: string; size?: number; browser_download_url?: string }[]
      }
      const version = body.tag_name ? versionFromTag(body.tag_name) : null
      if (version && body.draft !== true && body.prerelease !== true) {
        const setups = (body.assets ?? [])
          .map((asset) => ({
            name: asset.name ?? '',
            size: asset.size ?? 0,
            url: asset.browser_download_url ?? '',
          }))
          .filter((asset) => !!asset.url && !!setupVersion(asset.name))
        // The setup built for this release, else whatever setup it carries.
        const hit = setups.find((asset) => sameVersion(setupVersion(asset.name) ?? '', version)) ?? setups[0]
        release = {
          version,
          tag: body.tag_name ?? `v${version}`,
          pageUrl: body.html_url ?? `${RELEASE_PAGE}releases/tag/${body.tag_name}`,
          setup: hit ? { name: hit.name, url: hit.url, size: hit.size } : undefined,
        }
      }
    }
  } catch {
    release = null
  }
  releaseCache = { at: Date.now(), release }
  return release
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
// Downloaded setups live beside the update marker, not in the player's Downloads:
// a failed hand-off can be retried without fetching the file again.
const UPDATES_DIR = path.join(STATE_DIR, 'updates')

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
  /** False for a portable folder: it can be told, but not install itself. */
  canSelfUpdate: boolean
  /** Where the offered build came from — the release page or a local setup. */
  source?: 'github' | 'downloads'
  /** The release page, for the copy that has to download the new build itself. */
  pageUrl?: string
}

/**
 * The release's setup, downloaded into %LOCALAPPDATA%\TCGLife\updates. A file
 * from an earlier attempt at the same size is finished, so it is reused rather
 * than fetched again; anything else is replaced.
 */
async function downloadSetup(remote: RemoteRelease): Promise<Candidate> {
  const setup = remote.setup
  if (!setup) throw new Error('That release has no Windows setup attached, so it cannot install itself.')
  fs.mkdirSync(UPDATES_DIR, { recursive: true })
  const file = path.join(UPDATES_DIR, setup.name)

  const current = (() => {
    try { return fs.statSync(file) } catch { return null }
  })()
  const complete = !!current && current.isFile() && current.size >= MIN_SETUP_BYTES &&
    (setup.size <= 0 || current.size === setup.size) && isExeFile(file)

  if (!complete) {
    const res = await fetchWithTimeout(setup.url, DOWNLOAD_TIMEOUT_MS, {
      headers: { 'user-agent': 'TCG-Life-Updater' },
    })
    if (!res.ok) throw new Error(`Could not download the update (GitHub answered ${res.status}).`)
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length < MIN_SETUP_BYTES || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
      throw new Error('The downloaded file is not a Windows installer.')
    }
    const part = `${file}.part`
    fs.writeFileSync(part, bytes)
    fs.rmSync(file, { force: true })
    fs.renameSync(part, file)
  }

  // Superseded setups are dead weight once a newer one has landed.
  for (const name of (() => { try { return fs.readdirSync(UPDATES_DIR) } catch { return [] } })()) {
    if (name !== setup.name && (SETUP_RE.test(name) || name.endsWith('.part'))) {
      try { fs.rmSync(path.join(UPDATES_DIR, name), { force: true }) } catch { /* best effort */ }
    }
  }

  const stat = fs.statSync(file)
  return { file, name: setup.name, version: remote.version, size: stat.size, mtime: stat.mtimeMs }
}

export async function checkForUpdate(currentVersion: string): Promise<UpdateStatus> {
  const justUpdated = readAppliedUpdate(currentVersion)
  const canSelfUpdate = isInstalledCopy()
  // A portable copy has no uninstaller and no setup beside it, so it is told
  // about the release and sent to the page instead of being offered an install.
  const local = canSelfUpdate ? findCandidate(currentVersion) : null
  const remote = await latestRelease()
  const newer = remote && compareVersions(remote.version, currentVersion) > 0 ? remote : null

  if (newer && (!local || compareVersions(newer.version, local.version) > 0)) {
    return {
      currentVersion,
      available: true,
      version: newer.version,
      installerName: newer.setup?.name,
      size: newer.setup?.size,
      justUpdated,
      canSelfUpdate,
      source: 'github',
      pageUrl: newer.pageUrl,
    }
  }
  if (local) {
    return {
      currentVersion,
      available: true,
      version: local.version,
      installerName: local.name,
      size: local.size,
      justUpdated,
      canSelfUpdate,
      source: 'downloads',
      pageUrl: newer?.pageUrl ?? remote?.pageUrl,
    }
  }
  return {
    currentVersion,
    available: false,
    justUpdated,
    canSelfUpdate,
    pageUrl: remote?.pageUrl,
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
export async function beginUpdate(currentVersion: string, wantedVersion: string): Promise<BeginUpdateResult> {
  if (!isInstalledCopy()) {
    throw new Error('This copy was not installed, so it cannot update itself — download the new build from the release page.')
  }
  // A setup in Downloads is used as-is; otherwise the release's own installer is
  // fetched now. The player pressed the button on this version, so the cache is
  // bypassed: a release pulled in the last five minutes should still be found.
  let candidate = findCandidate(currentVersion, wantedVersion)
  if (!candidate) {
    const remote = await latestRelease(true)
    if (!remote || !sameVersion(remote.version, wantedVersion)) {
      throw new Error('That update is no longer on the release page.')
    }
    candidate = await downloadSetup(remote)
  }

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

/**
 * Open this project's release page in the player's browser. The URL is checked
 * against the repo's own prefix, so the endpoint can never be turned into a
 * general "open anything" launcher.
 */
export function openReleasePage(url?: string): string {
  const href = url && url.startsWith(RELEASE_PAGE) ? url : `${RELEASE_PAGE}releases/latest`
  if (process.platform === 'win32') {
    spawnSync('cmd.exe', ['/c', 'start', '', href], { windowsHide: true })
  } else if (process.platform === 'darwin') {
    spawnSync('open', [href])
  } else {
    spawnSync('xdg-open', [href])
  }
  return href
}
