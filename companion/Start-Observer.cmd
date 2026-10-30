@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0runtime\node.exe" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Observer.ps1"
)
if not exist "%~dp0runtime\node.exe" (
  echo.
  echo Setup could not finish. Check the message above and try again.
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0companion\observer.mjs"
pause
