# Conectar dominio personalizado a Ainspecciona

## Importante: southamerica-west1 no soporta dominios directos

Cloud Run en **southamerica-west1** (Santiago) **no permite** asignar dominios personalizados directamente. La solución es usar **Firebase Hosting** como proxy hacia Cloud Run.

---

## Solución: Firebase Hosting + Cloud Run

El `firebase.json` ya está configurado para enviar todo el tráfico a Cloud Run.

### 1. Vincular Firebase al proyecto GCP

Si aún no lo has hecho:

```powershell
cd ainspecta_web
firebase login
firebase use ainspecciona
```

(Si el proyecto Firebase no existe, créalo en [Firebase Console](https://console.firebase.google.com) y vincúlalo al proyecto GCP `ainspecciona`.)

### 2. Desplegar Firebase Hosting

```powershell
firebase deploy --only hosting
```

### 3. Conectar tu dominio en Firebase

1. Ve a [Firebase Console](https://console.firebase.google.com) → proyecto **ainspecciona**
2. **Hosting** → **Conectar dominio** (o "Add custom domain")
3. Ingresa tu dominio (ej: `app.ainspecciona.cl` o `www.ainspecciona.cl`)
4. Firebase te mostrará los registros DNS que debes crear

### 4. Configurar DNS en GoDaddy

1. Entra a [GoDaddy](https://www.godaddy.com) → **Mis productos** → tu dominio
2. **DNS** → **Registros DNS** → **Añadir**
3. Crea el registro que indique Firebase (normalmente **A** o **CNAME**):

| Campo GoDaddy | Valor |
|---------------|-------|
| **Tipo** | A o CNAME (según lo que pida Firebase) |
| **Nombre** | `app` (para app.tudominio.cl) o `www` |
| **Valor** | El que muestre Firebase (ej: IPs o `project.web.app`) |
| **TTL** | 1 hora |

4. **Guardar**

**Ruta en GoDaddy:** Mi cuenta → Mis productos → Dominios → [tu dominio] → DNS → Administrar zonas

---

## Resumen rápido

| Paso | Acción |
|------|--------|
| 1 | `firebase deploy --only hosting` |
| 2 | Firebase Console → Hosting → Conectar dominio |
| 3 | Crear en GoDaddy el registro que indique Firebase |
| 4 | Esperar propagación (5 min–48 h) |

---

## URLs

- **Cloud Run (directo):** https://ainspecciona-api-852721861524.southamerica-west1.run.app
- **Firebase Hosting (tras deploy):** https://ainspecciona.web.app
