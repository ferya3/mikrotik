# MikroTik NMS - one-step setup for Windows (Docker Desktop).
# Run by double-clicking setup-windows.cmd, or:
#   powershell -ExecutionPolicy Bypass -File setup-windows.ps1
# Safe to run again: existing .env, certificate and users are kept.
# Compatible with Windows PowerShell 5.1.

# Native tools (docker, openssl) write progress to stderr; with 'Stop' Windows PowerShell 5.1
# would treat that as a fatal error. Exit codes are checked explicitly instead.
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ''; Write-Host "ERROR: $text" -ForegroundColor Red; exit 1 }

function New-RandomBytes([int]$n) {
  $bytes = New-Object byte[] $n
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ,$bytes
}
function New-RandomBase64([int]$n) { return [Convert]::ToBase64String((New-RandomBytes $n)) }
function New-RandomHex([int]$n) { return -join ((New-RandomBytes $n) | ForEach-Object { $_.ToString('x2') }) }

function Test-PortInUse([int]$port) {
  try { return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop) } catch { return $false }
}

function Invoke-Docker {
  # Runs docker, shows its output, returns only the exit code.
  & docker @args | Out-Host
  return $LASTEXITCODE
}

# ---------------------------------------------------------------- 1. Docker
Step 'Checking Docker Desktop'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail 'Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ , start it, then run this again.'
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Fail 'Docker Desktop is not running. Start it (whale icon in the taskbar), wait until it says "Engine running", then run this again.'
}
Write-Host 'Docker is running.'

# ---------------------------------------------------------------- 2. .env
Step 'Preparing settings (.env)'
if (Test-Path '.env') {
  Write-Host '.env already exists - keeping it.'
} else {
  if (-not (Test-Path '.env.example')) { Fail '.env.example not found. Run this script from the project folder.' }
  $secrets = @{
    'POSTGRES_PASSWORD'  = (New-RandomHex 16)
    'REDIS_PASSWORD'     = (New-RandomHex 16)
    'JWT_SECRET'         = (New-RandomBase64 48)
    'CREDENTIALS_KEY_V1' = (New-RandomBase64 32)
    'METRICS_TOKEN'      = (New-RandomHex 24)
  }
  if (Test-PortInUse 443) { $secrets['HTTPS_PORT'] = '8443'; Write-Host 'Port 443 is busy - the panel will use 8443.' }
  if (Test-PortInUse 80) { $secrets['HTTP_PORT'] = '8080'; Write-Host 'Port 80 is busy - HTTP will use 8080.' }

  $lines = (Get-Content '.env.example' -Raw) -split "`r?`n"
  $out = foreach ($line in $lines) {
    $m = [regex]::Match($line, '^([A-Z0-9_]+)=(.*)$')
    if ($m.Success -and $secrets.ContainsKey($m.Groups[1].Value) -and
        ($m.Groups[2].Value.Trim() -eq '' -or $m.Groups[1].Value -like '*_PORT')) {
      "$($m.Groups[1].Value)=$($secrets[$m.Groups[1].Value])"
    } else { $line }
  }
  Set-Content -Path '.env' -Value $out -Encoding Ascii
  Write-Host 'Created .env with random secrets.'
  Write-Host 'IMPORTANT: back up .env - without CREDENTIALS_KEY_V1 saved router passwords cannot be decrypted.' -ForegroundColor Yellow
}

$envValues = @{}
foreach ($line in (Get-Content '.env')) {
  $m = [regex]::Match($line, '^([A-Z0-9_]+)=(.*)$')
  if ($m.Success) { $envValues[$m.Groups[1].Value] = $m.Groups[2].Value.Trim('"') }
}
$httpsPort = '443'
if ($envValues['HTTPS_PORT']) { $httpsPort = $envValues['HTTPS_PORT'] }

# Prometheus reads its token from a file (only used with --profile monitoring).
$tokenFile = 'deploy/prometheus/metrics_token'
if ($envValues['METRICS_TOKEN'] -and -not (Test-Path $tokenFile)) {
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot $tokenFile), $envValues['METRICS_TOKEN'])
}

# ---------------------------------------------------------------- 3. TLS certificate
Step 'Preparing HTTPS certificate'
$certDir = Join-Path $PSScriptRoot 'deploy/nginx/certs'
$certFile = Join-Path $certDir 'fullchain.pem'
$keyFile = Join-Path $certDir 'privkey.pem'
if ((Test-Path $certFile) -and (Test-Path $keyFile)) {
  Write-Host 'Certificate already exists - keeping it.'
} else {
  $openssl = $null
  $cmd = Get-Command openssl -ErrorAction SilentlyContinue
  if ($cmd) { $openssl = $cmd.Source }
  if (-not $openssl) {
    foreach ($p in @("$env:ProgramFiles\Git\usr\bin\openssl.exe", "$env:ProgramFiles\Git\mingw64\bin\openssl.exe",
                     "${env:ProgramFiles(x86)}\Git\usr\bin\openssl.exe")) {
      if ($p -and (Test-Path $p)) { $openssl = $p; break }
    }
  }
  if ($openssl) {
    $env:MSYS_NO_PATHCONV = '1'
    & $openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout $keyFile -out $certFile -subj '/CN=nms.local' *> $null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $certFile)) { Fail 'openssl could not create the certificate.' }
  } else {
    # No openssl on this machine: create it inside the nginx image (already needed for the panel).
    Write-Host 'openssl not found - creating the certificate with Docker.'
    $code = Invoke-Docker run --rm -v "${certDir}:/certs" alpine/openssl req -x509 -newkey rsa:2048 -nodes -days 825 `
      -keyout /certs/privkey.pem -out /certs/fullchain.pem -subj '/CN=nms.local'
    if ($code -ne 0) { Fail 'Could not create the certificate. Install Git for Windows (it includes openssl) and run this again.' }
  }
  Write-Host 'Self-signed certificate created (the browser will show a warning - that is expected).'
}

# ---------------------------------------------------------------- 4. Build & start
Step 'Building and starting the containers (first time takes several minutes)'
$code = Invoke-Docker compose up -d --build
if ($code -ne 0) {
  Write-Host ''
  Write-Host 'If the error mentions 403 / Forbidden / "export control" while pulling images, Docker Hub is blocked' -ForegroundColor Yellow
  Write-Host 'from your network. In Docker Desktop > Settings > Docker Engine add a registry mirror, e.g.' -ForegroundColor Yellow
  Write-Host '  "registry-mirrors": ["https://docker.arvancloud.ir"]' -ForegroundColor Yellow
  Write-Host 'click "Apply & restart", then run this script again.' -ForegroundColor Yellow
  Fail 'docker compose up failed (see the messages above).'
}

Step 'Waiting for the API to become ready'
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  & docker compose exec -T api node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" *> $null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 5
}
if (-not $ready) { Fail 'The API did not start. See the log with:  docker compose logs api' }
Write-Host 'API is ready.'

# ---------------------------------------------------------------- 5. Roles & first admin
Step 'Creating roles and the admin account'
$userCount = (& docker compose exec -T postgres psql -U nms -d nms -tAc 'select count(*) from users' 2>$null | Out-String).Trim()
if ($userCount -eq '0') {
  $policy = '^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$'
  # Unattended install: set NMS_ADMIN_PASSWORD before running the script.
  $plain = $env:NMS_ADMIN_PASSWORD
  $ok = $plain -and ($plain -cmatch $policy)
  if ($plain -and -not $ok) { Write-Host 'NMS_ADMIN_PASSWORD is too weak - asking instead.' -ForegroundColor Yellow }
  while (-not $ok) {
    $secure = Read-Host 'Choose a password for user "admin" (12+ chars, upper + lower case + digit)' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    $ok = $plain -cmatch $policy
    if (-not $ok) { Write-Host 'Too weak - try again.' -ForegroundColor Yellow }
  }
  # The password goes to the seed script on stdin - never on a command line.
  $OutputEncoding = New-Object System.Text.UTF8Encoding $false
  $plain | & docker compose exec -T api npx ts-node prisma/seed.ts | Out-Host
  $code = $LASTEXITCODE
  $plain = $null
  if ($code -ne 0) { Fail 'Creating the admin account failed (see the messages above).' }
} else {
  # Keep the role/permission catalogue up to date after upgrades.
  & docker compose exec -T api npx ts-node prisma/seed.ts | Out-Host
  Write-Host 'Users already exist - roles refreshed, no new admin created.'
}

# ---------------------------------------------------------------- 6. Done
$suffix = ''
if ($httpsPort -ne '443') { $suffix = ":$httpsPort" }
$ips = @()
try {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and
                   $_.InterfaceAlias -notmatch 'vEthernet|WSL|Docker|Loopback|VirtualBox|VMware' } |
    Select-Object -ExpandProperty IPAddress
} catch { }

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host ' MikroTik NMS is running' -ForegroundColor Green
Write-Host "   This computer:   https://localhost$suffix"
foreach ($ip in $ips) { Write-Host "   From the LAN:    https://$ip$suffix" }
Write-Host '   Login:           admin  (the password you chose)'
Write-Host ''
Write-Host ' The browser warns about the certificate: Advanced -> Continue.'
Write-Host ' Stop:  docker compose stop      Start again:  docker compose up -d'
Write-Host '============================================================' -ForegroundColor Green
