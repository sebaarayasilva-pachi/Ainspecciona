# Deploy Ainspecciona a Google Cloud Run
# Requisito: Habilitar billing en https://console.developers.google.com/billing/enable?project=ainspecciona

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Deploy Ainspecciona Web ===" -ForegroundColor Cyan
Write-Host ""

# Jobs/sesiones sin perfil interactivo a veces no tienen gcloud/firebase en PATH
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    $gcloudDirs = @(
        (Join-Path $env:LocalAppData "Google\Cloud SDK\google-cloud-sdk\bin"),
        (Join-Path $env:ProgramFiles "Google\Cloud SDK\google-cloud-sdk\bin"),
        "${env:ProgramFiles(x86)}\Google\Cloud SDK\google-cloud-sdk\bin"
    ) | Where-Object { $_ }
    foreach ($d in $gcloudDirs) {
        if (Test-Path (Join-Path $d "gcloud.cmd")) {
            $env:PATH = "$d;$env:PATH"
            break
        }
    }
}
if (-not (Get-Command firebase -ErrorAction SilentlyContinue) -and $env:APPDATA) {
    $npmGlobal = Join-Path $env:APPDATA "npm"
    if (Test-Path (Join-Path $npmGlobal "firebase.cmd")) {
        $env:PATH = "$npmGlobal;$env:PATH"
    }
}

# Verificar gcloud
try {
    gcloud --version | Out-Null
} catch {
    Write-Host "Error: gcloud CLI no encontrado. Instala: https://cloud.google.com/sdk/docs/install" -ForegroundColor Red
    exit 1
}

# Verificar proyecto
$project = gcloud config get-value project 2>$null
if ($project -ne "ainspecciona") {
    Write-Host "Configurando proyecto ainspecciona..."
    gcloud config set project ainspecciona
}

# DATABASE_URL: no heredar de entorno para evitar conflicto (Secret vs string literal)
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue

# DATABASE_URL: por defecto usa Secret Manager (secreto "DATABASE_URL").
# OPENAI_API_KEY: usa Secret Manager (secreto "OPENAI_API_KEY") para resumen ejecutivo y IA.
$dbSecretName = if ($env:DATABASE_URL_SECRET) { $env:DATABASE_URL_SECRET } else { "DATABASE_URL" }
$dbUrl = $env:DATABASE_URL
$useSecretManager = $env:USE_SECRET_MANAGER -eq "1" -or $env:USE_SECRET_MANAGER -eq "true"

$envVars = "NODE_ENV=production,STORAGE_DRIVER=gcs,GCS_BUCKET=ainspecciona-photos-852721861524"
$secretsArg = $null

# Cargar SMTP y Admin desde .env si existe
if (Test-Path "$PSScriptRoot\.env") {
    Get-Content "$PSScriptRoot\.env" | ForEach-Object {
        if ($_ -match '^\s*SMTP_HOST=(.+)$') { $env:SMTP_HOST = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*SMTP_PORT=(.+)$') { $env:SMTP_PORT = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*SMTP_USER=(.+)$') { $env:SMTP_USER = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*SMTP_PASS=(.+)$') { $env:SMTP_PASS = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*EMAIL_FROM=(.+)$') { $env:EMAIL_FROM = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*ADMIN_USER=(.+)$') { $env:ADMIN_USER = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*ADMIN_PASS=(.+)$') { $env:ADMIN_PASS = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*MERCADOPAGO_ACCESS_TOKEN=(.+)$') { $env:MERCADOPAGO_ACCESS_TOKEN = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*OPENAI_VISION_MODEL=(.+)$') { $env:OPENAI_VISION_MODEL = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*OPENAI_SLOT_MATCH_MODEL=(.+)$') { $env:OPENAI_SLOT_MATCH_MODEL = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*OPENAI_API_KEY=(.+)$') { $env:OPENAI_API_KEY = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*HUBSPOT_ACCESS_TOKEN=(.+)$') { $env:HUBSPOT_ACCESS_TOKEN = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*HUBSPOT_AGENDAR_URL=(.+)$') { $env:HUBSPOT_AGENDAR_URL = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*HUBSPOT_COMPANY_RUT_PROPERTY=(.+)$') { $env:HUBSPOT_COMPANY_RUT_PROPERTY = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*TRIAL_DURATION_DAYS=(.+)$') { $env:TRIAL_DURATION_DAYS = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*TRIAL_INITIAL_REAL_INSPECTIONS=(.+)$') { $env:TRIAL_INITIAL_REAL_INSPECTIONS = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*PUBLIC_URL=(.+)$') { $env:PUBLIC_URL = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*MERCADOPAGO_WEBHOOK_BASE_URL=(.+)$') { $env:MERCADOPAGO_WEBHOOK_BASE_URL = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*ALLOW_SIMULATE_SIMPLEFACTURA=(.+)$') { $env:ALLOW_SIMULATE_SIMPLEFACTURA = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*WEB_APP_ORIGIN=(.+)$') { $env:WEB_APP_ORIGIN = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*GOOGLE_PLAY_INTERNAL_TEST_URL=(.+)$') { $env:GOOGLE_PLAY_INTERNAL_TEST_URL = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*EXECUTIVE_PLAY_STORE_URL=(.+)$') { $env:EXECUTIVE_PLAY_STORE_URL = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*EXECUTIVE_APP_STORE_URL=(.+)$') { $env:EXECUTIVE_APP_STORE_URL = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*ELEVENLABS_API_KEY=(.+)$') { $env:ELEVENLABS_API_KEY = $matches[1].Trim().Trim('"').Trim("'") }
        if ($_ -match '^\s*ELEVENLABS_AGENT_ID=(.+)$') { $env:ELEVENLABS_AGENT_ID = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*ELEVENLABS_WIDGET_VARIANT=(.+)$') { $env:ELEVENLABS_WIDGET_VARIANT = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*ELEVENLABS_WIDGET_DISMISSIBLE=(.+)$') { $env:ELEVENLABS_WIDGET_DISMISSIBLE = $matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*PROPERTYCHECK_INGRESS_SECRET=(.+)$') {
            $env:PROPERTYCHECK_INGRESS_SECRET = $matches[1].Trim().Trim('"').Trim("'")
        }
        if ($_ -match '^\s*POSTVENTA_DEMO_ACCEPT_ANY_ADDRESS=(.+)$') {
            $env:POSTVENTA_DEMO_ACCEPT_ANY_ADDRESS = $matches[1].Trim().Trim('"').Trim("'")
        }
        if ($_ -match '^\s*POSTVENTA_AGENT_SECRET=(.+)$') {
            $env:POSTVENTA_AGENT_SECRET = $matches[1].Trim().Trim('"').Trim("'")
        }
        if ($_ -match '^\s*ELEVENLABS_ENTREGA_AGENT_ID=(.+)$') {
            $env:ELEVENLABS_ENTREGA_AGENT_ID = $matches[1].Trim().Trim('"')
        }
        if ($_ -match '^\s*ELEVENLABS_POSTVENTA_AGENT_ID=(.+)$') {
            $env:ELEVENLABS_POSTVENTA_AGENT_ID = $matches[1].Trim().Trim('"')
        }
        if ($_ -match '^\s*ELEVENLABS_POSTVENTA_WIDGET_VARIANT=(.+)$') {
            $env:ELEVENLABS_POSTVENTA_WIDGET_VARIANT = $matches[1].Trim().Trim('"')
        }
        if ($_ -match '^\s*ELEVENLABS_POSTVENTA_WIDGET_DISMISSIBLE=(.+)$') {
            $env:ELEVENLABS_POSTVENTA_WIDGET_DISMISSIBLE = $matches[1].Trim().Trim('"')
        }
    }
    # SimpleFactura + precios CLP: segundo paso (claves no listadas arriba)
    Get-Content "$PSScriptRoot\.env" | ForEach-Object {
        $line = $_ -replace '^\s+|\s+$', ''
        if ($line -match '^\s*#' -or -not $line) { return }
        if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { return }
        $name = $matches[1]
        if ($name -notlike 'SIMPLEFACTURA_*' -and $name -notmatch '^(SF_USERNAME|SF_PASSWORD|SF_BASE_URL|SF_SUCURSAL)$' -and $name -notmatch '^(STARTER_PRICE_CLP|BUSINESS_PRICE_CLP)$') { return }
        $val = $matches[2].Trim().Trim('"')
        Set-Item -Path "env:$name" -Value $val -Force
    }
}

# Webhooks Mercado Pago → API (Cloud Run), no al front (Firebase). Si no está en .env, usar URL del servicio.
if (-not $env:MERCADOPAGO_WEBHOOK_BASE_URL) {
    try {
        $crUrl = gcloud run services describe ainspecciona-api --region southamerica-west1 --project ainspecciona --format="value(status.url)" 2>$null
        if ($crUrl) {
            $env:MERCADOPAGO_WEBHOOK_BASE_URL = $crUrl.Trim().TrimEnd('/')
            Write-Host "MERCADOPAGO_WEBHOOK_BASE_URL = Cloud Run ($($env:MERCADOPAGO_WEBHOOK_BASE_URL))" -ForegroundColor Green
        }
    } catch {}
}

# Añadir SMTP a envVars si están configurados (valores con coma o = van entre comillas para gcloud)
# También & y # rompen el parseo de gcloud / shell si no van entre comillas.
$quoteIfNeeded = { param($v) if ($v -match '[,=&\#]') { return '"' + ($v -replace '"', '\"') + '"' }; return $v }
if ($env:SMTP_HOST -and $env:SMTP_USER -and $env:SMTP_PASS) {
    $port = ($env:SMTP_PORT -replace '[^\d]','')
    if (-not $port) { $port = "587" }
    $smtpPassQuoted = & $quoteIfNeeded $env:SMTP_PASS
    $smtpVars = "SMTP_HOST=$($env:SMTP_HOST),SMTP_PORT=$port,SMTP_USER=$($env:SMTP_USER),SMTP_PASS=$smtpPassQuoted"
    if ($env:EMAIL_FROM) { $smtpVars += ",EMAIL_FROM=$(& $quoteIfNeeded $env:EMAIL_FROM)" }
    $envVars = "$envVars,$smtpVars"
    Write-Host "SMTP configurado desde .env (emails activos)" -ForegroundColor Green
} else {
    Write-Host "SMTP no configurado en .env. Agrega SMTP_HOST, SMTP_USER, SMTP_PASS para envío de emails." -ForegroundColor Gray
}

# Añadir ADMIN a envVars si está configurado
if ($env:ADMIN_USER -and $env:ADMIN_PASS) {
    $envVars = "$envVars,ADMIN_USER=$($env:ADMIN_USER),ADMIN_PASS=$($env:ADMIN_PASS)"
    Write-Host "Admin user/pass configurados desde .env" -ForegroundColor Green
}

# Añadir MercadoPago a envVars si está configurado (mismo criterio de comillas que SMTP: = , & # rompen gcloud)
if ($env:MERCADOPAGO_ACCESS_TOKEN) {
    $mpTok = & $quoteIfNeeded $env:MERCADOPAGO_ACCESS_TOKEN
    $envVars = "$envVars,MERCADOPAGO_ACCESS_TOKEN=$mpTok"
    Write-Host "MercadoPago Access Token configurado desde .env" -ForegroundColor Green
} elseif (Test-Path "$PSScriptRoot\.env") {
    Write-Host "AVISO: .env existe pero MERCADOPAGO_ACCESS_TOKEN no se leyó (revisa una sola linea MERCADOPAGO_ACCESS_TOKEN=... sin comillas rotas)." -ForegroundColor Yellow
}

# SimpleFactura + precios CLP (opcional; mismas claves que en local)
$sfKeys = @(
    'SIMPLEFACTURA_EMAIL', 'SIMPLEFACTURA_PASSWORD', 'SIMPLEFACTURA_RUT_EMISOR', 'SIMPLEFACTURA_RZN_SOC',
    'SIMPLEFACTURA_GIRO_EMIS', 'SIMPLEFACTURA_DIR_ORIGEN', 'SIMPLEFACTURA_CMNA_ORIGEN', 'SIMPLEFACTURA_CIUDAD_ORIGEN',
    'SIMPLEFACTURA_CORREO_EMISOR', 'SIMPLEFACTURA_SUCURSAL', 'SIMPLEFACTURA_BASE_URL', 'SIMPLEFACTURA_AMBIENTE',
    'SIMPLEFACTURA_ACTECO', 'SIMPLEFACTURA_TIPO_DTE', 'SIMPLEFACTURA_STARTER_TIPO_DTE', 'SIMPLEFACTURA_IND_SERVICIO',
    'SIMPLEFACTURA_INVOICE_VALIDA_MONTOS', 'SF_USERNAME', 'SF_PASSWORD', 'SF_BASE_URL', 'SF_SUCURSAL',
    'STARTER_PRICE_CLP', 'BUSINESS_PRICE_CLP'
)
$sfCount = 0
foreach ($k in $sfKeys) {
    $v = [Environment]::GetEnvironmentVariable($k, 'Process')
    if ([string]::IsNullOrWhiteSpace($v)) { continue }
    $sfCount++
    $envVars = "$envVars,$k=$(& $quoteIfNeeded $v)"
}
if ($sfCount -gt 0) {
    Write-Host "SimpleFactura / precios CLP: $sfCount variables desde .env" -ForegroundColor Green
}

if ($env:HUBSPOT_ACCESS_TOKEN) {
    $envVars = "$envVars,HUBSPOT_ACCESS_TOKEN=$($env:HUBSPOT_ACCESS_TOKEN)"
    Write-Host "HubSpot Access Token configurado desde .env" -ForegroundColor Green
}
if ($env:HUBSPOT_AGENDAR_URL) {
    $envVars = "$envVars,HUBSPOT_AGENDAR_URL=$($env:HUBSPOT_AGENDAR_URL)"
}
if ($env:HUBSPOT_COMPANY_RUT_PROPERTY) {
    $envVars = "$envVars,HUBSPOT_COMPANY_RUT_PROPERTY=$($env:HUBSPOT_COMPANY_RUT_PROPERTY)"
}
if ($env:TRIAL_DURATION_DAYS) {
    $envVars = "$envVars,TRIAL_DURATION_DAYS=$($env:TRIAL_DURATION_DAYS)"
}
if ($env:TRIAL_INITIAL_REAL_INSPECTIONS) {
    $envVars = "$envVars,TRIAL_INITIAL_REAL_INSPECTIONS=$($env:TRIAL_INITIAL_REAL_INSPECTIONS)"
}

# Añadir modelos OpenAI a envVars si están configurados
if ($env:OPENAI_VISION_MODEL) {
    $envVars = "$envVars,OPENAI_VISION_MODEL=$($env:OPENAI_VISION_MODEL)"
    Write-Host "OPENAI_VISION_MODEL configurado desde .env: $($env:OPENAI_VISION_MODEL)" -ForegroundColor Green
}
if ($env:OPENAI_SLOT_MATCH_MODEL) {
    $envVars = "$envVars,OPENAI_SLOT_MATCH_MODEL=$($env:OPENAI_SLOT_MATCH_MODEL)"
    Write-Host "OPENAI_SLOT_MATCH_MODEL configurado desde .env: $($env:OPENAI_SLOT_MATCH_MODEL)" -ForegroundColor Green
}
if ($env:OPENAI_API_KEY) {
    $envVars = "$envVars,OPENAI_API_KEY=$(& $quoteIfNeeded $env:OPENAI_API_KEY)"
    Write-Host "OPENAI_API_KEY configurado desde .env (resumen ejecutivo + IA)" -ForegroundColor Green
}

if ($env:PUBLIC_URL) {
    $envVars = "$envVars,PUBLIC_URL=$(& $quoteIfNeeded $env:PUBLIC_URL)"
    Write-Host "PUBLIC_URL configurado (enlaces en emails al dominio público)" -ForegroundColor Green
}
if ($env:MERCADOPAGO_WEBHOOK_BASE_URL) {
    $envVars = "$envVars,MERCADOPAGO_WEBHOOK_BASE_URL=$(& $quoteIfNeeded $env:MERCADOPAGO_WEBHOOK_BASE_URL)"
    Write-Host "MERCADOPAGO_WEBHOOK_BASE_URL configurado (notification_url de MP al API)" -ForegroundColor Green
}
if ($env:ALLOW_SIMULATE_SIMPLEFACTURA) {
    $envVars = "$envVars,ALLOW_SIMULATE_SIMPLEFACTURA=$($env:ALLOW_SIMULATE_SIMPLEFACTURA)"
    Write-Host "ALLOW_SIMULATE_SIMPLEFACTURA: emisión DTE de prueba vía POST /api/starter/simulate-payment (demo)" -ForegroundColor Yellow
}
if ($env:WEB_APP_ORIGIN) {
    $envVars = "$envVars,WEB_APP_ORIGIN=$(& $quoteIfNeeded $env:WEB_APP_ORIGIN)"
}
if ($env:GOOGLE_PLAY_INTERNAL_TEST_URL) {
    $envVars = "$envVars,GOOGLE_PLAY_INTERNAL_TEST_URL=$(& $quoteIfNeeded $env:GOOGLE_PLAY_INTERNAL_TEST_URL)"
    Write-Host "GOOGLE_PLAY_INTERNAL_TEST_URL configurado (mail invitación ejecutivo)" -ForegroundColor Green
}
if ($env:EXECUTIVE_PLAY_STORE_URL) {
    $envVars = "$envVars,EXECUTIVE_PLAY_STORE_URL=$(& $quoteIfNeeded $env:EXECUTIVE_PLAY_STORE_URL)"
}
if ($env:EXECUTIVE_APP_STORE_URL) {
    $envVars = "$envVars,EXECUTIVE_APP_STORE_URL=$(& $quoteIfNeeded $env:EXECUTIVE_APP_STORE_URL)"
}
if ($env:ELEVENLABS_API_KEY) {
    $envVars = "$envVars,ELEVENLABS_API_KEY=$(& $quoteIfNeeded $env:ELEVENLABS_API_KEY)"
    Write-Host "ELEVENLABS_API_KEY configurado (TTS directo postventa)" -ForegroundColor Green
} else {
    Write-Host "ELEVENLABS_API_KEY no está en .env (endpoint TTS devolverá 503)." -ForegroundColor Yellow
}
if ($env:ELEVENLABS_AGENT_ID) {
    $envVars = "$envVars,ELEVENLABS_AGENT_ID=$(& $quoteIfNeeded $env:ELEVENLABS_AGENT_ID)"
    Write-Host "ELEVENLABS_AGENT_ID configurado (widget voz en home)" -ForegroundColor Green
}
if ($env:ELEVENLABS_WIDGET_VARIANT) {
    $envVars = "$envVars,ELEVENLABS_WIDGET_VARIANT=$(& $quoteIfNeeded $env:ELEVENLABS_WIDGET_VARIANT)"
}
if ($env:ELEVENLABS_WIDGET_DISMISSIBLE) {
    $envVars = "$envVars,ELEVENLABS_WIDGET_DISMISSIBLE=$($env:ELEVENLABS_WIDGET_DISMISSIBLE)"
}
if ($env:PROPERTYCHECK_INGRESS_SECRET) {
    $envVars = "$envVars,PROPERTYCHECK_INGRESS_SECRET=$(& $quoteIfNeeded $env:PROPERTYCHECK_INGRESS_SECRET)"
    Write-Host "PROPERTYCHECK_INGRESS_SECRET configurado (API Property-chk)" -ForegroundColor Green
} else {
    Write-Host "PROPERTYCHECK_INGRESS_SECRET no está en .env (informes Property-chk fallarán con 401)." -ForegroundColor Yellow
}
if ($env:POSTVENTA_AGENT_SECRET) {
    $envVars = "$envVars,POSTVENTA_AGENT_SECRET=$(& $quoteIfNeeded $env:POSTVENTA_AGENT_SECRET)"
    Write-Host "POSTVENTA_AGENT_SECRET configurado (webhooks agente postventa)" -ForegroundColor Green
} else {
    Write-Host "POSTVENTA_AGENT_SECRET no está en .env (tools ElevenLabs postventa fallarán con 401)." -ForegroundColor Yellow
}
if ($env:ELEVENLABS_ENTREGA_AGENT_ID) {
    $envVars = "$envVars,ELEVENLABS_ENTREGA_AGENT_ID=$(& $quoteIfNeeded $env:ELEVENLABS_ENTREGA_AGENT_ID)"
    Write-Host "ELEVENLABS_ENTREGA_AGENT_ID configurado (captura Entrega)" -ForegroundColor Green
} else {
    Write-Host "ELEVENLABS_ENTREGA_AGENT_ID no está en .env (captura /entrega/captura desactivada)." -ForegroundColor Yellow
}
if ($env:ELEVENLABS_POSTVENTA_AGENT_ID) {
    $envVars = "$envVars,ELEVENLABS_POSTVENTA_AGENT_ID=$(& $quoteIfNeeded $env:ELEVENLABS_POSTVENTA_AGENT_ID)"
    Write-Host "ELEVENLABS_POSTVENTA_AGENT_ID configurado (widget postventa)" -ForegroundColor Green
}
if ($env:ELEVENLABS_POSTVENTA_WIDGET_VARIANT) {
    $envVars = "$envVars,ELEVENLABS_POSTVENTA_WIDGET_VARIANT=$(& $quoteIfNeeded $env:ELEVENLABS_POSTVENTA_WIDGET_VARIANT)"
}
if ($env:ELEVENLABS_POSTVENTA_WIDGET_DISMISSIBLE) {
    $envVars = "$envVars,ELEVENLABS_POSTVENTA_WIDGET_DISMISSIBLE=$($env:ELEVENLABS_POSTVENTA_WIDGET_DISMISSIBLE)"
}
$demoAcceptAddr = if ($env:POSTVENTA_DEMO_ACCEPT_ANY_ADDRESS) { $env:POSTVENTA_DEMO_ACCEPT_ANY_ADDRESS } else { '1' }
$envVars = "$envVars,POSTVENTA_DEMO_ACCEPT_ANY_ADDRESS=$demoAcceptAddr"
Write-Host "POSTVENTA_DEMO_ACCEPT_ANY_ADDRESS=$demoAcceptAddr (maqueta: acepta cualquier dirección)" -ForegroundColor Green

if ($useSecretManager -or -not $dbUrl) {
    Write-Host "Usando Secret Manager para DATABASE_URL (secreto: $dbSecretName)" -ForegroundColor Cyan
    $env:DATABASE_URL = $null
    $secretsArg = "DATABASE_URL=$dbSecretName`:latest"
} elseif ($dbUrl) {
    $envVars = "$envVars,DATABASE_URL=$dbUrl"
} else {
    Write-Host "ERROR: Define DATABASE_URL o crea el secreto '$dbSecretName' en Secret Manager." -ForegroundColor Red
    Write-Host "Para usar Secret Manager: `$env:USE_SECRET_MANAGER = '1'" -ForegroundColor Gray
    exit 1
}

# OPENAI_API_KEY: configurar en Cloud Run como variable de entorno (Variables del entorno).

Write-Host "OPENAI_API_KEY: agregar en Cloud Run > Variables del entorno si no está." -ForegroundColor Gray
Write-Host ""
Write-Host "Ejecutando migraciones (Cloud SQL Proxy en 127.0.0.1:3307 salvo otro CLOUD_SQL_PROXY_PORT)..." -ForegroundColor Yellow
$migrateScript = Join-Path $PSScriptRoot "migrate.ps1"
if ($env:DEPLOY_ALLOW_NO_MIGRATE -eq "1" -or $env:DEPLOY_ALLOW_NO_MIGRATE -eq "true") {
    Write-Host "DEPLOY_ALLOW_NO_MIGRATE=1: se omite migrate.ps1 (solo para emergencias)." -ForegroundColor Yellow
} else {
    # Subproceso: rutas con espacios rompen Start-Process -ArgumentList; usar ProcessStartInfo con -File entrecomillado.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "powershell.exe"
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$migrateScript`""
    $psi.WorkingDirectory = $PSScriptRoot
    $psi.UseShellExecute = $false
    $migrateProc = New-Object System.Diagnostics.Process
    $migrateProc.StartInfo = $psi
    [void]$migrateProc.Start()
    $migrateProc.WaitForExit()
    if ($migrateProc.ExitCode -ne 0) {
        Write-Host ""
        Write-Host "ERROR: migrate.ps1 falló (código $($migrateProc.ExitCode)). No se desplegará Cloud Run hasta que la migración aplique." -ForegroundColor Red
        Write-Host "1) Terminal con proxy: cloud-sql-proxy ainspecciona:southamerica-west1:ainspecciona-mysql --port=3307" -ForegroundColor Gray
        Write-Host "2) .\migrate.ps1   luego   npx prisma migrate status" -ForegroundColor Gray
        Write-Host "Solo si debes desplegar sin tocar la BD (no recomendado): `$env:DEPLOY_ALLOW_NO_MIGRATE='1'; .\deploy.ps1" -ForegroundColor Gray
        exit 1
    }
}
Write-Host ""
Write-Host "Desplegando a Cloud Run (southamerica-west1)..." -ForegroundColor Yellow
Write-Host ""

# Deploy (--update-env-vars preserva OPENAI_API_KEY si ya está en Cloud Run)
# --cpu-boost: CPU completa durante arranque (evita timeout por cold start)
# --memory 512Mi: más memoria para Node + Prisma
# min-instances: 1 evita cold start (503 en primera petición). Coste ~$15/mes. Para desactivar: MIN_INSTANCES=0 .\deploy.ps1
# Invocar gcloud con lista de argumentos (evita Invoke-Expression: las comillas internas en --update-env-vars
# cortaban el string y gcloud recibía la URL del Play Store como argumento suelto).
$gcloudArgs = @(
    "run", "deploy", "ainspecciona-api",
    "--source", ".",
    "--region", "southamerica-west1",
    "--allow-unauthenticated",
    "--project", "ainspecciona",
    "--add-cloudsql-instances", "ainspecciona:southamerica-west1:ainspecciona-mysql",
    "--update-env-vars", $envVars,
    "--timeout", "600",
    "--cpu-boost",
    "--memory", "512Mi"
)
if ($env:MIN_INSTANCES -ne "0") {
    $gcloudArgs += @("--min-instances", "1")
}
if ($secretsArg) {
    $gcloudArgs += "--set-secrets=$secretsArg"
}
& gcloud @gcloudArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Desplegando Firebase Hosting (home + proxy a Cloud Run)..." -ForegroundColor Yellow
    firebase deploy --only hosting 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Firebase Hosting desplegado." -ForegroundColor Green
    } else {
        Write-Host "Firebase Hosting: ejecuta 'firebase deploy --only hosting' manualmente." -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "=== Deploy exitoso ===" -ForegroundColor Green
    $url = gcloud run services describe ainspecciona-api --region southamerica-west1 --project ainspecciona --format="value(status.url)" 2>$null
    if ($url) {
        Write-Host "URL: $url" -ForegroundColor Green
    }
} else {
    Write-Host ""
    Write-Host "Si falla por billing: habilitar en https://console.developers.google.com/billing/enable?project=ainspecciona" -ForegroundColor Yellow
    exit 1
}
