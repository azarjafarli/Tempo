# Tempo - run all automated tests
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "== Backend (pytest) ==" -ForegroundColor Cyan
Set-Location "$root\backend"; & .\.venv\Scripts\python.exe -m pytest
Write-Host "== Frontend (vitest) ==" -ForegroundColor Cyan
Set-Location "$root\frontend"; npm test
Set-Location $root
