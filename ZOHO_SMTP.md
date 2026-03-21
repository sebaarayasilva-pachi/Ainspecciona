# Configurar Zoho Mail para envío de correos

## 1. Crear cuenta en Zoho

1. Ve a [mail.zoho.com](https://mail.zoho.com) o [zoho.com/mail](https://www.zoho.com/mail/)
2. Regístrate (plan gratuito disponible)
3. Si usas dominio propio (ej. ainspecciona.com), verifica el dominio en Zoho

## 2. Configuración SMTP de Zoho

| Variable | Valor |
|----------|-------|
| SMTP_HOST | `smtp.zoho.com` |
| SMTP_PORT | `465` (SSL, recomendado) o `587` (TLS) |
| SMTP_USER | Tu email completo (ej. `inspecciones@ainspecciona.com`) |
| SMTP_PASS | Contraseña de la cuenta o **contraseña de aplicación** (recomendado si tienes 2FA) |
| EMAIL_FROM | `Ainspecciona <inspecciones@ainspecciona.com>` (opcional) |

**Si falla con error 535 (Authentication failed):** en Zoho Mail ve a **Configuración → Seguridad → Contraseñas de aplicaciones**, genera una contraseña solo para SMTP y usa esa en `SMTP_PASS`.

**Regiones Zoho:**
- Global: `smtp.zoho.com`
- Europa: `smtp.zoho.eu`
- India: `smtp.zoho.in`

## 3. Añadir a .env

```env
SMTP_HOST="smtp.zoho.com"
SMTP_PORT="465"
SMTP_USER="inspecciones@ainspecciona.com"
SMTP_PASS="tu-contraseña"
EMAIL_FROM="Ainspecciona <inspecciones@ainspecciona.com>"
```

## 4. Desplegar

```powershell
.\deploy.ps1
```

El deploy leerá las variables SMTP desde `.env` y las subirá a Cloud Run.
