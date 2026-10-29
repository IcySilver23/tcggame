Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class BtnClick {
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
$targetPid = (Get-Process TCG-Life -ErrorAction SilentlyContinue | Select-Object -First 1).Id
if (-not $targetPid) { Write-Host 'no TCG-Life process'; exit 1 }
$want = if ($args.Count -gt 0) { $args[0] } else { 'Close' }
$found = [IntPtr]::Zero

# locate the splash (visible top-level window of the process)
$tops = New-Object System.Collections.ArrayList
$cbTop = [BtnClick+EnumWindowsProc]{ param($h, $lp)
  $procId = 0
  [BtnClick]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
  if ($procId -eq $script:targetPid -and [BtnClick]::IsWindowVisible($h)) { [void]$script:tops.Add($h) }
  return $true
}
[BtnClick]::EnumWindows($cbTop, [IntPtr]::Zero) | Out-Null

$cbChild = [BtnClick+EnumWindowsProc]{ param($h, $lp)
  $sb = New-Object System.Text.StringBuilder 256
  [BtnClick]::GetWindowText($h, $sb, 256) | Out-Null
  if ($sb.ToString() -eq $script:want) { $script:found = $h; return $false }
  return $true
}
foreach ($t in $tops) { [BtnClick]::EnumChildWindows($t, $cbChild, [IntPtr]::Zero) | Out-Null; if ($found -ne [IntPtr]::Zero) { break } }

if ($found -eq [IntPtr]::Zero) { Write-Host ('button not found: ' + $want); exit 1 }
[BtnClick]::SendMessage($found, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null  # BM_CLICK
Write-Host ('clicked ' + $want + ' at hwnd ' + $found)
Start-Sleep -Seconds 3
$alive = Get-Process TCG-Life -ErrorAction SilentlyContinue
if ($alive) { Write-Host 'process still alive'; exit 1 } else { Write-Host 'process exited cleanly' }
