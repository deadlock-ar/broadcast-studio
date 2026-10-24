@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Observer.ps1"
if errorlevel 1 (
  echo.
  echo Setup could not finish. Check the message above and try again.
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0companion\observer.mjs"
pause
