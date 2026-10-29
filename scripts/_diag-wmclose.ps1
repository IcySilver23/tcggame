Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WmClose2 {
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
$targetPid = (Get-Process TCG-Life -ErrorAction SilentlyContinue | Select-Object -First 1).Id
if (-not $targetPid) { Write-Host 'no TCG-Life process'; exit 1 }
$hits = New-Object System.Collections.ArrayList
$cb = [WmClose2+EnumWindowsProc]{ param($h, $lp)
  $procId = 0
  [WmClose2]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
  if ($procId -eq $script:targetPid -and [WmClose2]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 256
    [WmClose2]::GetWindowText($h, $sb, 256) | Out-Null
    if ($sb.ToString() -eq 'TCG Life') { [void]$hits.Add($h) }
  }
  return $true
}
[WmClose2]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
if ($hits.Count -eq 0) { Write-Host 'no visible TCG Life window'; exit 1 }
$owner = $hits[0]
[WmClose2]::PostMessage($owner, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
Write-Host ('WM_CLOSE posted to hwnd ' + $owner)
