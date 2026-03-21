# Iniciar Cloud SQL Proxy para conectar a producción
# Coloca cloud-sql-proxy_x64.exe en esta carpeta (ainspecta_web) o ajusta $proxyPath

$proxyPath = Join-Path $PSScriptRoot "cloud-sql-proxy_x64.exe"
if (-not (Test-Path $proxyPath)) {
    $proxyPath = Join-Path $PSScriptRoot "cloud-sql-proxy.exe"
}
if (-not (Test-Path $proxyPath)) {
    Write-Host "No se encontró cloud-sql-proxy. Descárgalo de:" -ForegroundColor Yellow
    Write-Host "  https://github.com/GoogleCloudPlatform/cloud-sql-proxy/releases" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Guárdalo en: $PSScriptRoot" -ForegroundColor Gray
    Write-Host "  Como: cloud-sql-proxy_x64.exe" -ForegroundColor Gray
    exit 1
}

Write-Host "Iniciando Cloud SQL Proxy en puerto 3307..." -ForegroundColor Cyan
Write-Host "  (Ctrl+C para detener)" -ForegroundColor Gray
& $proxyPath --port=3307 ainspecciona:southamerica-west1:ainspecciona-mysql
