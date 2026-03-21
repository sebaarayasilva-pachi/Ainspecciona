# Problema: dos proyectos diferentes

- **Cloud Run** está en el proyecto GCP **ainspecciona** (852721861524)
- **Firebase Hosting** está en el proyecto **ainspecciona-49d14** (726562195554)

Firebase Hosting solo puede hacer proxy a Cloud Run cuando ambos están en el **mismo proyecto**.

---

## Solución: agregar Firebase al proyecto GCP correcto

### 1. Agregar Firebase al proyecto "ainspecciona"

1. Ve a **https://console.firebase.google.com**
2. Haz clic en **"Agregar proyecto"** o **"Crear proyecto"**
3. Elige **"Agregar Firebase a un proyecto de Google Cloud existente"**
4. Selecciona el proyecto **ainspecciona** (el de Cloud Run)
5. Completa el asistente

### 2. Configurar Hosting en ese proyecto

1. En el proyecto **ainspecciona** (el vinculado a GCP)
2. **Compilación** → **Hosting** → **Comenzar**
3. Crea el sitio siguiendo el asistente

### 3. Desplegar desde la terminal

```powershell
cd "c:\Users\DELL 7520\OneDrive\Escritorio\Proyectos Web\Ainspecta\ainspecta_web"
firebase use ainspecciona
firebase deploy --only hosting
```

---

## Alternativa: usar solo la URL de Cloud Run

Si prefieres no configurar Firebase ahora, puedes usar directamente:

**https://ainspecciona-api-852721861524.southamerica-west1.run.app**
