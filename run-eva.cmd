@echo off
rem EVA RECOVERY - one-click launcher: runs setup the first time, then starts the app.
cd /d "%~dp0"
if not exist "backend\.venv\Scripts\python.exe" (
  echo First run: installing dependencies, this takes a few minutes...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
  if errorlevel 1 ( echo Setup failed - see messages above. & pause & exit /b 1 )
)
if not exist "frontend\dist\index.html" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
