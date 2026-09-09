<#
  Installs Immoba on a Windows server as a background service listening on localhost:3000.
  Run in an elevated PowerShell:   powershell -ExecutionPolicy Bypass -File install-windows.ps1 -Domain immoba.example.com
  Prerequisites: Node.js 22+ (nodejs.org) and git. NSSM is installed through winget if missing.
  Re-running the script updates the code and restarts the service; the .env (and its APP_SECRET) is kept.
#>
param(
  [Parameter(Mandatory = $true)] [string] $Domain,
  [string] $InstallDir = 'C:\immoba',
  [string] $DataDir = 'C:\immoba-data',
  [string] $Repo = 'https://github.com/reyespatrick/20160101.git',
  [string] $Branch = 'main'
)
$ErrorActionPreference = 'Stop'

function Need($cmd, $hint) { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd not found. $hint" } }
Need node 'Install Node.js 22 LTS from https://nodejs.org'
Need git 'Install Git for Windows from https://git-scm.com'
if ([version]((node -v).TrimStart('v')) -lt [version]'22.5.0') { throw 'Node.js 22.5 or newer is required (node:sqlite).' }
if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing NSSM (service wrapper) with winget...'
  winget install --id NSSM.NSSM -e --accept-source-agreements --accept-package-agreements | Out-Null
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  Need nssm 'Download nssm.exe from https://nssm.cc and put it in C:\Windows\System32'
}

# --- code ---
if (-not (Test-Path "$InstallDir\.git")) { git clone --branch $Branch $Repo $InstallDir } else { git -C $InstallDir pull --ff-only }
Push-Location $InstallDir
npm ci --no-audit --no-fund
npm run build
Pop-Location

# --- data + environment ---
New-Item -ItemType Directory -Force -Path $DataDir, "$DataDir\photos" | Out-Null
$envFile = "$InstallDir\.env"
if (-not (Test-Path $envFile)) {
  $secret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
  @"
PORT=3000
DATA_DIR=$DataDir
PHOTOS_DIR=$DataDir\photos
PHOTO_TTL_DAYS=30
PUBLIC_URL=https://$Domain
APP_SECRET=$secret
SIGNUP_CODE=
INMOVILLA_API_URL=https://apiweb.inmovilla.com/apiweb/apiweb.php
INMOVILLA_REST_URL=https://procesos.inmovilla.com/api/v1
INMOVILLA_DOMAIN=
INMOVILLA_MOCK=0
"@ | Set-Content -Encoding ascii $envFile
  Write-Host "Created $envFile with a new APP_SECRET (keep it: it encrypts the agencies' keys)."
}

# --- Windows service ---
$node = (Get-Command node).Source
if (-not (Get-Service immoba -ErrorAction SilentlyContinue)) {
  nssm install immoba $node "--env-file-if-exists=.env server/index.js" | Out-Null
  nssm set immoba AppDirectory $InstallDir | Out-Null
  nssm set immoba DisplayName 'Immoba relay (Inmovilla gateway)' | Out-Null
  nssm set immoba Start SERVICE_AUTO_START | Out-Null
  nssm set immoba AppStdout "$DataDir\immoba.log" | Out-Null
  nssm set immoba AppStderr "$DataDir\immoba.log" | Out-Null
  nssm set immoba AppRotateFiles 1 | Out-Null
  nssm set immoba AppRotateBytes 10000000 | Out-Null
  nssm set immoba AppExit Default Restart | Out-Null
}
nssm restart immoba | Out-Null
Start-Sleep -Seconds 3
try {
  $health = Invoke-RestMethod http://localhost:3000/api/health
  Write-Host "Relay is up on localhost:3000 (mock=$($health.mock), needsSetup=$($health.needsSetup))."
} catch { Write-Warning "The service did not answer yet; check $DataDir\immoba.log" }

Write-Host ''
Write-Host "Next: create the IIS site for $Domain with deploy\web.config (see deploy\windows-iis.md)."
Write-Host "Public IP to whitelist in Inmovilla: $((Invoke-RestMethod https://api.ipify.org) 2>$null)"
