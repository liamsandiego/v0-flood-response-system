@echo off
echo ========================================
echo   RapidRelay - Kill All Processes
echo ========================================
echo.

echo Killing Node.js processes...
taskkill /F /IM node.exe >nul 2>&1
if %errorlevel%==0 (echo   Killed node.exe) else (echo   No node.exe running)

echo Killing Python processes...
taskkill /F /IM python3.12.exe >nul 2>&1
if %errorlevel%==0 (echo   Killed python3.12.exe) else (echo   No python3.12.exe running)
taskkill /F /IM python.exe >nul 2>&1

echo.
echo Cleaning .next cache...
if exist "v0-flood-response-system\.next" (
    rmdir /s /q "v0-flood-response-system\.next" >nul 2>&1
    echo   .next deleted
) else (
    echo   .next already clean
)

echo.
echo All processes killed and cache cleaned.
echo You can now run: start.bat
echo.
pause
