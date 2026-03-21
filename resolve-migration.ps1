# Resuelve migraciones fallidas: marca como applied cuando las tablas/columnas ya existen
# Requiere: Cloud SQL Proxy corriendo (cloud-sql-proxy ainspecciona:southamerica-west1:ainspecciona-mysql)
# Uso: .\resolve-migration.ps1  (luego .\migrate.ps1)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$dbUrl = gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona 2>$null
if (-not $dbUrl) {
    Write-Host "Error: No se pudo obtener DATABASE_URL. Ejecuta: gcloud auth login" -ForegroundColor Red
    exit 1
}

$proxyPort = if ($env:CLOUD_SQL_PROXY_PORT) { $env:CLOUD_SQL_PROXY_PORT } else { "3307" }
if ($dbUrl -match '\?socket=') {
    $dbUrl = $dbUrl -replace '@[^/]+/', "@127.0.0.1:$proxyPort/"
    $dbUrl = $dbUrl -replace '\?socket=[^&]+&?', '?'
    $dbUrl = $dbUrl.TrimEnd('?')
}

$env:DATABASE_URL = $dbUrl

# Migraciones que fallaron pero aplicaron parcialmente (columnas/tablas ya existen)
$migrationsToApply = @(
    "20260209140000_add_credit_system",
    "20260209190000_add_starter_case_fields",
    "20260209200000_add_starter_payment_fields"
)

foreach ($m in $migrationsToApply) {
    Write-Host "Marcando $m como applied..." -ForegroundColor Yellow
    $out = npx prisma migrate resolve --applied $m 2>&1
    if ($LASTEXITCODE -eq 0) { Write-Host "  OK" -ForegroundColor Green } else { $out | Out-Host }
}

Write-Host ""
Write-Host "Proxy debe estar en 127.0.0.1:$proxyPort" -ForegroundColor Gray
Write-Host "  .\cloud-sql-proxy.exe ainspecciona:southamerica-west1:ainspecciona-mysql --port=$proxyPort" -ForegroundColor Gray
Write-Host ""
Write-Host "Listo. Ahora ejecuta: .\migrate.ps1" -ForegroundColor Green
