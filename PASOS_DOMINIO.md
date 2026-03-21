# Pasos para conectar tu dominio (GoDaddy)

## PASO 1: En tu computador (Terminal / PowerShell)

**Dónde:** Abre PowerShell o la terminal integrada de Cursor (Ctrl+`)

**Qué hacer:**
```powershell
cd "c:\Users\DELL 7520\OneDrive\Escritorio\Proyectos Web\Ainspecta\ainspecta_web"
firebase deploy --only hosting
```

**Resultado esperado:** Mensaje "Deploy complete!" y una URL tipo `https://ainspecciona.web.app`

---

## PASO 2: En Firebase Console (navegador)

**Dónde:** https://console.firebase.google.com

1. Haz clic en el proyecto **ainspecciona**
2. En el menú izquierdo → **Compilación** (Build) → **Hosting**
3. Haz clic en **"Conectar dominio"** o **"Add custom domain"**
4. Escribe tu dominio (ej: `app.ainspecciona.cl` o `www.ainspecciona.cl`)
5. Haz clic en **Continuar**
6. **Copia** los registros DNS que te muestre (tipo A o CNAME, nombre, valor)

---

## PASO 3: En GoDaddy (navegador)

**Dónde:** https://www.godaddy.com

1. Inicia sesión
2. **Mis productos** → busca tu dominio → **DNS** o **Administrar**
3. En **Registros DNS** → **Añadir** (o **Agregar**)
4. Crea el registro que te indicó Firebase:
   - **Tipo:** A o CNAME (el que diga Firebase)
   - **Nombre:** `app` (si usas app.tudominio.cl) o `www` (si usas www.tudominio.cl)
   - **Valor:** pega exactamente lo que copiaste de Firebase
   - **TTL:** 1 hora
5. **Guardar**

---

## PASO 4: Esperar

La propagación DNS tarda entre **5 minutos y 48 horas**. Firebase verificará automáticamente y te avisará cuando el dominio esté conectado.

---

## Resumen visual

| # | Dónde | Acción |
|---|-------|--------|
| 1 | Terminal (Cursor) | `firebase deploy --only hosting` |
| 2 | console.firebase.google.com → Hosting | Conectar dominio → copiar registros |
| 3 | godaddy.com → Mi dominio → DNS | Añadir registro A o CNAME |
| 4 | Esperar | 5 min - 48 h |
