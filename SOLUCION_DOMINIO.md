# Solución: Conectar dominio con Cloud Run

## El problema

- **Cloud Run** está en el proyecto GCP **ainspecciona** (número 852721861524)
- **Firebase Hosting** está en **ainspecciona-49d14** (número 726562195554) — otro proyecto

Firebase Hosting solo puede hacer proxy a Cloud Run cuando ambos están en el **mismo proyecto**.

---

## Solución: Agregar Firebase al proyecto GCP correcto

### Paso 1: En Firebase Console

1. Ve a **https://console.firebase.google.com**
2. Haz clic en **"Agregar proyecto"** (o el ícono +)
3. **Importante:** Elige **"Agregar Firebase a un proyecto de Google Cloud existente"**
4. En la lista, selecciona el proyecto **ainspecciona** (el que tiene Cloud Run)
   - Si hay varios "ainspecciona", elige el que tenga el número **852721861524**
5. Completa el asistente (puedes desactivar Analytics si quieres)

### Paso 2: Configurar Hosting en ese proyecto

1. En el proyecto **ainspecciona** (el que acabas de vincular)
2. **Compilación** → **Hosting** → **Comenzar**
3. Crea el sitio siguiendo el asistente

### Paso 3: Desplegar desde la terminal

```powershell
cd "c:\Users\DELL 7520\OneDrive\Escritorio\Proyectos Web\Ainspecta\ainspecta_web"
firebase use ainspecciona
firebase deploy --only hosting
```

> Si `firebase use ainspecciona` no aparece, usa el ID que muestre `firebase projects:list` para el proyecto con número 852721861524.

### Paso 4: Conectar tu dominio

1. Firebase Console → **Hosting** → **Agregar un dominio personalizado**
2. Ingresa **ainspecciona.com** (o el subdominio que prefieras)
3. Crea en GoDaddy los registros DNS que indique Firebase

---

## Resumen

| Dónde | Acción |
|-------|--------|
| Firebase Console | Agregar proyecto → Agregar Firebase a GCP existente → ainspecciona (852721861524) |
| Firebase Console | Hosting → Comenzar |
| Terminal | `firebase use ainspecciona` + `firebase deploy --only hosting` |
| Firebase Console | Hosting → Agregar dominio personalizado |
| GoDaddy | Crear registros DNS |
