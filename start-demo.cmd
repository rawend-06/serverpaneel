@echo off
title Rawendpaneel - demo
cd /d "%~dp0app"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is niet geinstalleerd.
  echo  Download de LTS-versie van https://nodejs.org , installeer en dubbelklik daarna opnieuw op start-demo.cmd
  echo.
  start "" https://nodejs.org
  pause
  exit /b
)
if not exist node_modules\ical.js (
  echo Eerste keer: onderdelen installeren, even geduld...
  call npm install --omit=dev --no-audit --no-fund
)
set DEMO=1
set PORT=3000
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000/?start=%RANDOM%"
echo.
echo  Laat dit venster open zolang je het paneel gebruikt. Sluiten = paneel stopt.
echo.
node server.js
pause
