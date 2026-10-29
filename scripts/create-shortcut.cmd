@echo off
rem Creates a TCG Life shortcut on your desktop - no installer, just a .lnk
rem pointing at TCG-Life.exe in this folder (the icon comes from the exe itself).
rem Run once, after moving the release folder wherever you want it to live.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$desk = [Environment]::GetFolderPath('Desktop');" ^
  "$lnk = $ws.CreateShortcut((Join-Path $desk 'TCG Life.lnk'));" ^
  "$lnk.TargetPath = (Join-Path $PSScriptRoot 'TCG-Life.exe');" ^
  "$lnk.WorkingDirectory = $PSScriptRoot;" ^
  "$lnk.Description = 'TCG Life — Collector Simulator';" ^
  "$lnk.IconLocation = (Join-Path $PSScriptRoot 'TCG-Life.exe,0');" ^
  "$lnk.Save();" ^
  "Write-Host ('Shortcut created: ' + (Join-Path $desk 'TCG Life.lnk'))"
pause
