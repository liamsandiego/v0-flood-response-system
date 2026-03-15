@echo off
echo ========================================
echo   RapidRelay - Start All Services
echo ========================================
echo.

:: Kill any existing processes first
echo [1/5] Killing old processes...
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM python3.12.exe >nul 2>&1
taskkill /F /IM python.exe >nul 2>&1
timeout /t 3 /nobreak >nul

:: Clean .next (prevents EPERM .next\trace crash on Windows)
echo [2/5] Cleaning .next cache...
if exist "v0-flood-response-system\.next" (
    rmdir /s /q "v0-flood-response-system\.next" >nul 2>&1
    timeout /t 1 /nobreak >nul
    if exist "v0-flood-response-system\.next" (
        echo   WARNING: .next still locked. Retrying...
        rmdir /s /q "v0-flood-response-system\.next" >nul 2>&1
    )
)
echo   .next cleaned

:: Windows Defender exclusion hint
echo [3/5] Checking ports...
netstat -ano | findstr ":8001.*LISTEN" >nul 2>&1
if %errorlevel%==0 (
    echo   WARNING: Port 8001 still in use. Waiting...
    timeout /t 5 /nobreak >nul
)
netstat -ano | findstr ":3000.*LISTEN" >nul 2>&1
if %errorlevel%==0 (
    echo   WARNING: Port 3000 still in use. Waiting...
    timeout /t 5 /nobreak >nul
)

:: Start backend
echo [4/5] Starting Backend (port 8001)...
start "RapidRelay Backend" cmd /k "cd /d %~dp0backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload"

:: Wait for backend to be ready
timeout /t 6 /nobreak >nul

:: Start frontend (with NEXT_TELEMETRY_DISABLED to reduce file locking)
echo [5/5] Starting Frontend (port 3000)...
start "RapidRelay Frontend" cmd /k "cd /d %~dp0v0-flood-response-system && set NEXT_TELEMETRY_DISABLED=1 && npm run dev"

echo.
echo ========================================
echo   Services starting in new windows:
echo.
echo   Backend:  http://localhost:8001
echo   Frontend: http://localhost:3000
echo.
echo   Login with your Supabase credentials.
echo   Sensor data arrives via WebSocket (~5s).
echo ========================================
echo.
echo TIP: If frontend crashes with EPERM error,
echo      run kill.bat first, then start.bat again.
echo.
echo Close this window. Services run in their own windows.
echo To stop everything, run: kill.bat
echo.
pause
