@echo off
cd /d "%~dp0"
echo Checking git status...
git status
echo.
echo Staging all changes...
git add -A
echo.
echo Committing changes...
git commit -m "fix: Skip SSE on Vercel to prevent status override

- useLocalSSE now skips SSE connection on Vercel deployments
- This prevents the DISCONNECTED status override when SSE fails
- Supabase Realtime properly shows LIVE status on Vercel now

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
echo.
echo Pushing to remote...
git push
echo.
echo Done! The DISCONNECTED badge should now show LIVE after deploy.
pause
