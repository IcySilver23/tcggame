Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnum {
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct WINDOWPLACEMENT { public int length, flags, showCmd, ptMinX, ptMinY, ptMaxX, ptMaxY, rcNormalL, rcNormalT, rcNormalR, rcNormalB; }
  [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
}
'@
$targetPid = (Get-Process TCG-Life -ErrorAction SilentlyContinue | Select-Object -First 1).Id
if (-not $targetPid) { Write-Host 'no TCG-Life process'; exit }
Write-Host "enumerating windows of pid $targetPid"
$cb = [WinEnum+EnumWindowsProc]{ param($h, $lp)
  $procId = 0
  [WinEnum]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
  if ($procId -eq $script:targetPid) {
    $sb = New-Object System.Text.StringBuilder 256
    [WinEnum]::GetWindowText($h, $sb, 256) | Out-Null
    $title = $sb.ToString()
    $cls = New-Object System.Text.StringBuilder 256
    [WinEnum]::GetClassName($h, $cls, 256) | Out-Null
    $pl = New-Object WinEnum+WINDOWPLACEMENT
    $pl.length = [System.Runtime.InteropServices.Marshal]::SizeOf($pl)
    [WinEnum]::GetWindowPlacement($h, [ref]$pl) | Out-Null
    $state = switch ($pl.showCmd) { 1 { 'normal' } 2 { 'minimized' } 3 { 'maximized' } default { $pl.showCmd } }
    Write-Host ("hwnd=" + $h + " vis=" + [WinEnum]::IsWindowVisible($h) + " iconic=" + [WinEnum]::IsIconic($h) + " state=" + $state + " class=[" + $cls.ToString() + "] title=[" + $title + "]")
  }
  return $true
}
[WinEnum]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
Write-Host 'done'
