# Corrige DATABASE_URL: quita :3306 para que Cloud Run use socket Unix
# Ejecutar: .\fix-db-secret.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Corrigiendo DATABASE_URL para Cloud Run ===" -ForegroundColor Cyan

$dbUrl = gcloud secrets versions access latest --secret=DATABASE_URL --project=ainspecciona 2>$null
if (-not $dbUrl) {
    Write-Host "Error: No se pudo leer el secreto." -ForegroundColor Red
    exit 1
}

# Quitar :3306 (Prisma usa TCP si ve puerto; Cloud Run necesita socket)
$fixed = $dbUrl -replace '@localhost:3306/', '@localhost/'
$fixed = $fixed -replace '@127\.0\.0\.1:3306/', '@localhost/'

# Codificar $ en contraseña (rompe el parsing de URL si no)
if ($fixed -match 'mysql://([^:]+):([^@]+)@') {
    $user = $Matches[1]
    $pass = $Matches[2]
    $passEnc = $pass -replace '\$', '%24' -replace '#', '%23' -replace '@', '%40' -replace ' ', '%20'
    if ($passEnc -ne $pass) {
        $fixed = $fixed -replace "mysql://$([regex]::Escape($user)):$([regex]::Escape($pass))@", "mysql://$user`:$passEnc@"
    }
}

if ($fixed -eq $dbUrl) {
    Write-Host "El secreto ya tiene formato correcto (sin :3306)." -ForegroundColor Green
    exit 0
}

Write-Host "Actualizando secreto (sin :3306)..." -ForegroundColor Yellow
[System.IO.File]::WriteAllText("$env:TEMP\dburl-fix.txt", $fixed)
gcloud secrets versions add DATABASE_URL --data-file=$env:TEMP\dburl-fix.txt --project=ainspecciona

if ($LASTEXITCODE -eq 0) {
    Write-Host "Secreto actualizado correctamente." -ForegroundColor Green
    Write-Host ""
    Write-Host "Redeploy para aplicar cambios:" -ForegroundColor Cyan
    Write-Host "  .\deploy.ps1"
} else {
    Write-Host "Error al actualizar." -ForegroundColor Red
    exit 1
}
