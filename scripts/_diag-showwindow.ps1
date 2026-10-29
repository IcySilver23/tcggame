Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ShowWin {
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
}
'@
$targetPid = (Get-Process TCG-Life -ErrorAction SilentlyContinue | Select-Object -First 1).Id
if (-not $targetPid) { Write-Host 'no TCG-Life process'; exit 1 }
$hits = New-Object System.Collections.ArrayList
$cb = [ShowWin+EnumWindowsProc]{ param($h, $lp)
  $procId = 0
  [ShowWin]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
  if ($procId -eq $script:targetPid -and [ShowWin]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 256
    [ShowWin]::GetWindowText($h, $sb, 256) | Out-Null
    if ($sb.ToString() -eq 'TCG Life') { [void]$hits.Add($h) }
  }
  return $true
}
[ShowWin]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
if ($hits.Count -eq 0) { Write-Host 'no visible TCG Life window'; exit 1 }
$cmd = 6 # SW_MINIMIZE
if ($args.Count -gt 0 -and $args[0] -eq 'restore') { $cmd = 9 } # SW_RESTORE
if ($args.Count -gt 0 -and $args[0] -eq 'max') { $cmd = 3 } # SW_MAXIMIZE
$ok = [ShowWin]::ShowWindow($hits[0], $cmd)
Write-Host ('ShowWindow(' + $hits[0] + ',' + $cmd + ') -> ' + $ok)
