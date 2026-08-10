# Aplica migrate promo (si hace falta) y crea/activa un código en PROD vía Cloud SQL Proxy.
# Uso: .\scripts\promo-add-code-prod.ps1 BIENVENIDO
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Code,
  [string]$Label = "",
  [int]$Credits = 1
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$proxyPort = if ($env:CLOUD_SQL_PROXY_PORT) { $env:CLOUD_SQL_PROXY_PORT } else { "3307" }

$dbUrl = gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona 2>$null
if (-not $dbUrl) { Write-Host "Error: DATABASE_URL secret" -ForegroundColor Red; exit 1 }

if ($dbUrl -match '\?socket=') {
  $tcpHost = '127.0.0.1:' + $proxyPort + '/'
  $dbUrl = $dbUrl -replace '@[^/]+/', ('@' + $tcpHost)
  $dbUrl = $dbUrl -replace '\?socket=[^&]+&?', '?'
  $dbUrl = $dbUrl.TrimEnd('?')
}

$proxyExe = Join-Path (Get-Location) "cloud-sql-proxy.exe"
if (-not (Test-Path $proxyExe)) { Write-Host "Error: cloud-sql-proxy.exe missing" -ForegroundColor Red; exit 1 }

$listening = Get-NetTCPConnection -LocalPort $proxyPort -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Start-Process -FilePath $proxyExe -ArgumentList "ainspecciona:southamerica-west1:ainspecciona-mysql", "--port=$proxyPort" -WindowStyle Hidden
  Start-Sleep -Seconds 6
}

$env:KICKOFF_DATABASE_URL = $dbUrl
$env:DATABASE_URL = $dbUrl

Write-Host "=== prisma migrate deploy (prod tunnel) ===" -ForegroundColor Cyan
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$args = @($Code, "--credits=$Credits")
if ($Label) { $args += "--label=$Label" }
Write-Host "=== add-promo-code $Code ===" -ForegroundColor Cyan
& node "scripts/add-promo-code.mjs" @args
exit $LASTEXITCODE
