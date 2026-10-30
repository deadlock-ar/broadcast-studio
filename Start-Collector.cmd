@echo off
setlocal
cd /d "%~dp0"
set "DLAR_NODE=node"
if exist "runtime\node.exe" set "DLAR_NODE=%~dp0runtime\node.exe"
"%DLAR_NODE%" -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)" >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 24 or newer from https://nodejs.org then open this file again.
  echo The portable Windows download includes its own runtime.
  pause
  exit /b 1
)
if not exist "collector\node_modules\deadem\package.json" (
  echo Installing the collector dependencies...
  call npm ci --prefix collector --ignore-scripts
  if errorlevel 1 goto failed
)
if not exist "dist\index.html" (
  echo Building the studio...
  call npm ci --ignore-scripts
  if errorlevel 1 goto failed
  call npm run build
  if errorlevel 1 goto failed
)
echo.
echo Open http://127.0.0.1:8766/?tab=live
echo Keep this window open during the game and while displaying OBS sources.
echo Results are saved in .dlar-collector beside this file.
echo.
"%DLAR_NODE%" collector\server.mjs
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo The collector could not start. Read the error above.
pause
exit /b 1
