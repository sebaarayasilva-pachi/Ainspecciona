# Verifica que DATABASE_URL en Secret Manager tenga formato correcto para Cloud Run
# Ejecutar: .\verify-db-secret.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Verificación DATABASE_URL (Secret Manager) ===" -ForegroundColor Cyan
Write-Host ""

$dbUrl = gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona 2>$null
if (-not $dbUrl) {
    Write-Host "Error: No se pudo leer el secreto DATABASE_URL." -ForegroundColor Red
    Write-Host "Verifica: gcloud auth login && gcloud config set project ainspecciona" -ForegroundColor Gray
    exit 1
}

# Mostrar formato (ocultar password)
$masked = $dbUrl -replace ':( [^@]+)@', ':****@'
$masked = $masked -replace '://([^:]+):([^@]+)@', '://$1:****@'
Write-Host "Formato actual (password oculto):" -ForegroundColor Yellow
Write-Host $masked
Write-Host ""

$ok = $true
$hints = @()

if ($dbUrl -notmatch 'mysql://') {
    $ok = $false
    $hints += "Debe empezar con mysql://"
}

if ($dbUrl -match ':3306') {
    $ok = $false
    $hints += "NO debe incluir :3306. En Cloud Run se usa socket Unix, no TCP."
}

if ($dbUrl -notmatch '\?socket=') {
    $ok = $false
    $hints += "Debe incluir ?socket=/cloudsql/ainspecciona:southamerica-west1:ainspecciona-mysql"
}

if ($dbUrl -notmatch '/cloudsql/ainspecciona:southamerica-west1:ainspecciona-mysql') {
    $ok = $false
    $hints += "El socket debe ser /cloudsql/ainspecciona:southamerica-west1:ainspecciona-mysql"
}

if ($dbUrl -match '@127\.0\.0\.1/') {
    $hints += "Usa @localhost/ en lugar de @127.0.0.1/ para socket"
    $ok = $false
}

if ($ok) {
    Write-Host "Formato correcto para Cloud Run." -ForegroundColor Green
    Write-Host ""
    Write-Host "Si el login sigue fallando, revisa:" -ForegroundColor Cyan
    Write-Host "  1. Cloud Run > ainspecciona-api > Logs (busca errores de conexión)"
    Write-Host "  2. Cloud SQL: instancia ainspecciona-mysql activa"
    Write-Host "  3. GET https://ainspecciona.com/api/health (debe devolver db:connected)"
    exit 0
}

Write-Host "Formato incorrecto. Correcciones:" -ForegroundColor Red
$hints | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "Formato correcto:" -ForegroundColor Yellow
Write-Host '  mysql://ainspecciona:PASSWORD@localhost/ainspecciona?socket=/cloudsql/ainspecciona:southamerica-west1:ainspecciona-mysql'
Write-Host ""
Write-Host "Actualizar secreto (PowerShell):" -ForegroundColor Cyan
Write-Host '  $url = "mysql://ainspecciona:TU_PASSWORD@localhost/ainspecciona?socket=/cloudsql/ainspecciona:southamerica-west1:ainspecciona-mysql"'
Write-Host '  [System.IO.File]::WriteAllText("$env:TEMP\dburl.txt", $url)'
Write-Host '  gcloud secrets versions add DATABASE_URL --data-file=$env:TEMP\dburl.txt --project=ainspecciona'
Write-Host ""
Write-Host "Luego redeploy: .\deploy.ps1" -ForegroundColor Gray
exit 1
