# Ainspecciona Web - MVP Demo Local

Sistema de inspección y gestión automatizada de propiedades inmobiliarias

## 🚀 Inicio Rápido

### Instalación

```bash
# Instalar dependencias
npm install
```

### Ejecutar

```bash
npm run dev
```

Luego abre tu navegador en: **http://localhost:3000**

### Funcionalidad

- Carga una imagen de una propiedad
- El sistema analiza automáticamente:
  - **Brillo**: Si es muy oscura (mean < 35) → Badge Rojo
  - **Tamaño**: Si es muy pequeña (< 800x600) → Badge Amarillo
  - **OK**: Si cumple requisitos → Badge Verde

## 📁 Estructura del Proyecto

```
ainspecta_web/
├── server.js        # Backend Fastify
├── public/          # Archivos estáticos
│   └── index.html   # Frontend MVP Demo
├── package.json     # Configuración
└── README.md        # Este archivo
```

## 🛠️ Tecnologías

### Backend
- **Fastify**: Servidor web rápido
- **Sharp**: Procesamiento de imágenes
- **@fastify/static**: Servir archivos estáticos
- **@fastify/multipart**: Manejo de uploads
- **Prisma + MySQL**: Persistencia de Casos y Slots

### Frontend
- HTML5 + CSS3 + JavaScript vanilla
- Preview de imágenes
- Visualización de resultados JSON

## 🗄️ Base de datos (MySQL con Prisma)

1) Copia `.env.example` a `.env` y ajusta `DATABASE_URL`:

```
DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/ainspecta"
```

2) Ejecuta migraciones:

```bash
npm run prisma:migrate
```

## 📝 Notas

Este es el MVP demo local del proyecto Ainspecciona.

# Ainspecciona
