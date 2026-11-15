# Tempo - one-time setup (Windows PowerShell)
# Usage:  powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Invoke-Py([string]$cmd, [string[]]$rest) {
    $parts = @($cmd.Split(" "))
    $exe = $parts[0]
    $pre = @()
    if ($parts.Length -gt 1) { $pre = $parts[1..($parts.Length - 1)] }
    & $exe @pre @rest
}

function Find-Python {
    foreach ($c in @("py -3.12", "py -3.11", "py -3.13", "python")) {
        try {
            $v = Invoke-Py $c @("-c", "import sys; print('%d.%d' % sys.version_info[:2])") 2>$null
            if ($LASTEXITCODE -eq 0 -and $v -and [version]$v -ge [version]"3.11") { return $c }
        } catch {}
    }
    throw "Python 3.11+ not found. Install it from https://www.python.org/downloads/ (tick 'Add python.exe to PATH')."
}

Write-Host "== Backend ==" -ForegroundColor Cyan
$py = Find-Python
Write-Host "Using: $py"
Set-Location "$root\backend"
if (-not (Test-Path ".venv")) { Invoke-Py $py @("-m", "venv", ".venv") }
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
& .\.venv\Scripts\python.exe -m app.cli reset

Write-Host "== Frontend ==" -ForegroundColor Cyan
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Node.js (npm) not found. Install Node.js 18+ LTS from https://nodejs.org/"
}
Set-Location "$root\frontend"
npm install
npm run build

Set-Location $root
Write-Host "`nSetup complete. Start the app with:  powershell -ExecutionPolicy Bypass -File .\start.ps1" -ForegroundColor Green
