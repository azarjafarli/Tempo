@echo off
rem EVA RECOVERY - one-click launcher: runs setup when needed, then starts the app.
cd /d "%~dp0"
if not exist "backend\.venv\Scripts\python.exe" (
  echo First run: installing dependencies, this takes a few minutes...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
  if errorlevel 1 ( echo Setup failed - see messages above. & pause & exit /b 1 )
)
rem Rebuild the interface whenever its source has changed (marker file records the build version).
if not exist "frontend\dist\.build-v3" (
  echo Building the interface...
  pushd frontend
  call npm install
  call npm run build
  if errorlevel 1 ( popd & echo Frontend build failed - see messages above. & pause & exit /b 1 )
  echo v3> dist\.build-v3
  popd
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
