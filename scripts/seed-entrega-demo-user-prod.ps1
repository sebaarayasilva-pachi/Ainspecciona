# Seed usuario demo Recepción/Entrega en PROD (Cloud SQL Proxy).
# Uso: .\scripts\seed-entrega-demo-user-prod.ps1
param(
  [string]$Email = "recepcion@demo.ainspecciona.com",
  [string]$Password = "RecepcionDemo2026!",
  [string]$Name = "Demo Recepcion",
  [string]$TenantSlug = "exxacon",
  [string]$Role = "ADMIN"
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

$env:DATABASE_URL = $dbUrl

Write-Host "=== seed Entrega demo $Email ===" -ForegroundColor Cyan
& node "scripts/seed-entrega-demo-user.mjs" --email $Email --password $Password --name $Name --tenant-slug $TenantSlug --role $Role
exit $LASTEXITCODE
