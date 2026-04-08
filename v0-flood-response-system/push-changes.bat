@echo off
cd /d "%~dp0"
echo Checking git status...
git status
echo.
echo Staging all changes...
git add -A
echo.
echo Committing changes...
git commit -m "fix: Simplify Supabase client and add debug endpoint

- Reverted supabase.ts to simple direct createClient (removed Proxy that broke auth)
- Added debug info to /api/sync-status endpoint to diagnose deployment issues
- After deploy, visit your-domain.vercel.app/api/sync-status to see env var status

Test the deployment:
1. Push these changes
2. Visit https://YOUR_APP.vercel.app/api/sync-status
3. Check if supabaseTest.connected is true
4. If false, the debug info will show which env vars are missing

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
echo.
echo Pushing to remote...
git push
echo.
echo ========================================
echo IMPORTANT: After Vercel deploys, visit:
echo https://YOUR_APP.vercel.app/api/sync-status
echo to check if Supabase is connecting properly
echo ========================================
pause
