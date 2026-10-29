Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinFront {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
}
'@
$p = Get-Process TCG-Life -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p -or $p.MainWindowHandle -eq [IntPtr]::Zero) { Write-Host 'no window handle'; exit 1 }
[WinFront]::ShowWindow($p.MainWindowHandle, 9) | Out-Null   # SW_RESTORE
[WinFront]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 700
$p2 = Get-Process TCG-Life -ErrorAction SilentlyContinue | Select-Object -First 1
Write-Host ("foregrounded handle=" + $p2.MainWindowHandle + " title=[" + $p2.MainWindowTitle + "]")
