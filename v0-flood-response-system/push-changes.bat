@echo off
cd /d "%~dp0"
echo Checking git status...
git status
echo.
echo Staging all changes...
git add -A
echo.
echo Committing changes...
git commit -m "fix: Fix Supabase column name mapping and Groq model config

- Fixed data-tab.tsx to query obando_environmental_data with correct column names (Soil Moisture, Temperature, Humidity, Pressure, Final Distance, Date, Time)
- Fixed useSupabaseHistory.ts to map Supabase columns to internal format
- Fixed useSupabaseRealtime.ts to handle realtime updates with correct columns
- Fixed app/api/ai/interpret/route.ts to query correct table and columns
- Fixed app/api/ai/interpret/route.ts to use stable Groq model (llama-3.3-70b-versatile)
- Fixed lib/supabase.ts with lazy loading for better env var handling
- Added graceful fallbacks for serverless/Vercel SQLite routes
- Created .env.example documentation

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
echo.
echo Pushing to remote...
git push
echo.
echo Done!
pause
