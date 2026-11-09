@echo off
setlocal
cd /d "%~dp0"
title INTUIT3D Evaluation Workbench
echo.
echo  INTUIT3D  ^|  Windows evaluation build
echo  ----------------------------------
echo  Keep this window open while using Firefox.
echo  Open http://127.0.0.1:5173 after READY appears.
echo  Ctrl+C closes the local servers.
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer ^(x64^) is required.
  echo Install Node.js and retry. See START-HERE.md.
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo This build needs Node.js 22 or newer.
  node --version
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo The bundled dependencies are missing.
  echo Extract the entire ZIP before using this launcher. See START-HERE.md.
  pause
  exit /b 1
)
node "tooling\dev-local.mjs"
set "status=%ERRORLEVEL%"
if not "%status%"=="0" (
  echo.
  echo Local launch did not complete successfully ^(exit %status%^).
  echo Do not share the LOCAL_PAIRING_TOKEN from the console.
  pause
)
exit /b %status%
