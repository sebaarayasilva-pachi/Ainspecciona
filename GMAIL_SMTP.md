# Envío de correos con Google Workspace (contacto@ainspecciona.com)

La cuenta de correo del proyecto es **contacto@ainspecciona.com** (Google Workspace). Para que la app envíe correos (Recuperar cuenta, etc.) hay que usar SMTP con una **contraseña de aplicación**.

## 1. Generar contraseña de aplicación

**Enlace directo (con la cuenta ya iniciada):**  
[https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)

### Si no ves "Contraseñas de aplicaciones"

Google solo muestra esta opción si tienes **Verificación en dos pasos** activada. Haz esto en orden:

1. Entra a [Google Cuenta](https://myaccount.google.com/) con **contacto@ainspecciona.com**.
2. Menú izquierdo → **Seguridad**.
3. En **Cómo iniciar sesión en Google**, entra a **Verificación en dos pasos**.
4. Si está **desactivada**, actívala (te pedirá el teléfono y un código).
5. Cuando la verificación en dos pasos esté **activada**, vuelve a **Seguridad** y baja hasta la sección **Cómo iniciar sesión en Google**. Ahí debe aparecer **Contraseñas de aplicaciones** (debajo de “Verificación en dos pasos”). Entra ahí.
6. En “Seleccionar app” elige **Correo**, en “Seleccionar dispositivo” elige **Otro** y escribe "Ainspecciona". Pulsa **Generar**.
7. Copia la contraseña de 16 caracteres (puedes pegarla en `.env` con o sin espacios).

### Si usas Google Workspace (cuenta de empresa)

- Si **no** ves la opción "Contraseñas de aplicaciones" ni después de activar verificación en dos pasos, el administrador de Workspace puede tenerla desactivada.
- El admin debe ir a [Admin de Google](https://admin.google.com) → **Seguridad** → **Configuración de verificación en dos pasos** y permitir que los usuarios creen contraseñas de aplicaciones.
- Si no puedes activar 2 pasos ni usar contraseñas de aplicación, la alternativa es usar otro proveedor de correo (por ejemplo Zoho o SendGrid) solo para envíos SMTP; la guía de Zoho está en `ZOHO_SMTP.md`.

## 2. Configuración en .env

En la carpeta `ainspecta_web`, en tu archivo `.env`, usa estos valores (o reemplaza los que ya tengas de SMTP):

```env
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="contacto@ainspecciona.com"
SMTP_PASS="tu-contraseña-de-aplicacion-16-chars"
EMAIL_FROM="Ainspecciona <contacto@ainspecciona.com>"
```

`SMTP_PASS` debe ser la contraseña de aplicación generada en el paso 1 (puedes pegarla con o sin espacios).

## 3. Desplegar

```powershell
cd ainspecta_web
.\deploy.ps1
```

El deploy sube estas variables a Cloud Run. Los correos (recuperar clave, etc.) saldrán desde contacto@ainspecciona.com.
