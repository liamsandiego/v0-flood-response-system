@echo off
cd /d "%~dp0"
echo Checking git status...
git status
echo.
echo Staging all changes...
git add -A
echo.
echo Committing changes...
git commit -m "fix: Simplify Supabase client to fix auth issues

- Reverted supabase.ts to simple direct createClient (removed Proxy pattern that was causing auth issues)
- Supabase client now initializes properly with NEXT_PUBLIC_ env vars
- Added debug logging to help troubleshoot deployment issues
- Auth should now work correctly on Vercel deployment

Previous fixes still in place:
- Correct column name mapping for obando_environmental_data table
- Stable Groq model (llama-3.3-70b-versatile)
- Serverless detection for SQLite routes

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
echo.
echo Pushing to remote...
git push
echo.
echo Done!
pause
