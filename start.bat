@echo off
echo =========================================================
echo   RAPID RELAY OBANDO - Starting Services
echo =========================================================
echo.

set "ROOT=%~dp0"
set "WEB_DIR=%ROOT%v0-flood-response-system"

:: Start backend (FastAPI on port 8001)
echo Opening Backend terminal...
start "RapidRelay - Backend (port 8001)" cmd /k "cd /d "%ROOT%backend" && py -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload"

:: Start frontend (Next.js on port 3000)
echo Opening Dashboard terminal...
start "RapidRelay - Dashboard (port 3000)" cmd /k "cd /d "%WEB_DIR%" && set NEXT_TELEMETRY_DISABLED=1 && npm run dev"

echo.
echo =========================================================
echo   2 terminals opened:
echo   - Backend:   http://localhost:8001
echo   - Dashboard: http://localhost:3000  (click link in terminal)
echo.
echo   To stop everything: run kill.bat
echo =========================================================
echo.
echo Close this window. Services run in their own windows.
exit
