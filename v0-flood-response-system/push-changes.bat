@echo off
cd /d "%~dp0"
echo Checking git status...
git status
echo.
echo Staging all changes...
git add -A
echo.
echo Committing changes...
git commit -m "fix: Add better error logging for Realtime + SQL fix

- Added detailed error logging for Supabase Realtime CHANNEL_ERROR
- Created supabase-realtime-fix.sql to enable RLS policies
- The error means obando_environmental_data needs Realtime enabled in Supabase

To fix the Realtime error:
1. Run supabase-realtime-fix.sql in Supabase SQL Editor
2. Go to Database → Replication → Enable for obando_environmental_data
3. Redeploy

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
echo.
echo Pushing to remote...
git push
echo.
echo ========================================
echo IMPORTANT: Fix Supabase Realtime Error
echo ========================================
echo.
echo 1. Go to Supabase Dashboard SQL Editor
echo 2. Run the file: supabase-realtime-fix.sql
echo 3. Then go to Database -^> Replication
echo 4. Enable Realtime for: obando_environmental_data
echo 5. Redeploy on Vercel
echo.
pause
