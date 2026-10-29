Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinShot {
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  public struct RECT { public int L, T, R, B; }
}
'@
Add-Type -AssemblyName System.Drawing
$procId = (Get-Process TCG-Life -ErrorAction SilentlyContinue | Select-Object -First 1).Id
if (-not $procId) { Write-Host 'no TCG-Life process'; exit 1 }
$target = [IntPtr]::Zero
$cb = [WinShot+EnumWindowsProc]{ param($h, $lp)
  $wpid = 0
  [WinShot]::GetWindowThreadProcessId($h, [ref]$wpid) | Out-Null
  if ($wpid -eq $script:procId -and [WinShot]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 256
    [WinShot]::GetWindowText($h, $sb, 256) | Out-Null
    if ($sb.ToString() -eq 'TCG Life') { $script:target = $h; return $false }
  }
  return $true
}
[WinShot]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
if ($target -eq [IntPtr]::Zero) { Write-Host 'game window not found'; exit 1 }
$r = New-Object WinShot+RECT
[WinShot]::GetWindowRect($target, [ref]$r) | Out-Null
$w = $r.R - $r.L; $h2 = $r.B - $r.T
Write-Host ("window " + $w + "x" + $h2 + " at " + $r.L + "," + $r.T)
$bmp = New-Object System.Drawing.Bitmap $w, $h2
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# PW_RENDERFULLCONTENT (2): captures DirectComposition/WebView2 surfaces
$ok = [WinShot]::PrintWindow($target, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
$bmp.Save('C:\Users\cscha\AppData\Local\Temp\game-window.png', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host ("printwindow ok=" + $ok + " saved game-window.png")
