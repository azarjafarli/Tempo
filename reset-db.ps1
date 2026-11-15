# Tempo - drop and recreate the database with the demo mission and NASA CSV
# Usage: powershell -ExecutionPolicy Bypass -File .\reset-db.ps1 [-Profile declining|stable]
param([ValidateSet("declining","stable")][string]$Profile = "declining")
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$root\backend"
& .\.venv\Scripts\python.exe -m app.cli reset --profile $Profile
Set-Location $root
