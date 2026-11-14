# EVA RECOVERY - start the app (single server: API + built frontend on http://127.0.0.1:8000)
# Usage:  powershell -ExecutionPolicy Bypass -File .\start.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$root\backend"
if (-not (Test-Path ".venv\Scripts\python.exe")) { throw "Run setup.ps1 first." }
if (-not (Test-Path "$root\frontend\dist\index.html")) { throw "Frontend not built. Run setup.ps1 (or: cd frontend; npm run build)." }
Start-Job -ScriptBlock { Start-Sleep -Seconds 3; Start-Process "http://127.0.0.1:8000" } | Out-Null
Write-Host "EVA RECOVERY running at http://127.0.0.1:8000  (Ctrl+C to stop)" -ForegroundColor Green
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
