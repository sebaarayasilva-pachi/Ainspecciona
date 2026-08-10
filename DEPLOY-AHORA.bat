@echo off
cd /d "%~dp0"
echo === Deploy Ainspecciona (fix puntajes reporte) ===
set DEPLOY_ALLOW_NO_MIGRATE=1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1"
echo.
if errorlevel 1 (
  echo ERROR en deploy. Revisa el mensaje arriba.
) else (
  echo OK. Abre https://ainspecciona.com/cases/BGG3PLVA/report con Ctrl+F5
  echo Debe verse cabecera X-Report-Scoring: v3-admin-sync
)
pause
