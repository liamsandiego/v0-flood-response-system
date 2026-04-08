@echo off
echo =========================================================
echo   RAPID RELAY — Kill All Services
echo =========================================================
echo.

echo [1/3] Stopping Node.js (dashboard)...
taskkill /F /IM node.exe >nul 2>&1

echo [2/3] Stopping Python (bridge + sync)...
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM python3.exe >nul 2>&1

echo [3/3] Stopping Ollama...
taskkill /F /IM ollama.exe >nul 2>&1
taskkill /F /IM ollama_llama_server.exe >nul 2>&1

echo.
echo All services stopped.
echo Run start.bat to restart.
timeout /t 2 /nobreak >nul
