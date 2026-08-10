# Ainspecciona Platform — Plan de Reordenamiento Arquitectónico

## 1. Objetivo

Reordenar Ainspecciona para que funcione y se entienda como una **plataforma única**, evitando que cada producto mantenga su propio sistema de tenants, usuarios, logins, permisos y administración.

La prioridad es **ordenar la arquitectura actual sin reescribir todo el sistema**.

La estrategia recomendada es evolucionar el backend actual hacia un **modular monolith**:

- Mantener Fastify.
- Mantener Prisma.
- Mantener inicialmente un solo Cloud Run.
- Mantener Firebase/infraestructura actual.
- Centralizar identidad, organizaciones, permisos, proyectos y propiedades.
- Migrar los productos uno por uno sobre ese core común.
- Separar servicios solo cuando exista una necesidad real de escalabilidad o aislamiento.

---

# 2. Problema actual

Hoy Ainspecciona creció por producto.

Estructura aproximada:

```text
Capture / STI
Postventa
Entrega / Recepción
In & Out
Scan
Admin / AI
WhatsApp
```

Rutas actuales aproximadas:

```text
/
/capture
/tenant
/executive
/postventa
/entrega
/inout
/scan
/admin
/review
/api/whatsapp
```

Módulos actuales:

```text
server.js
src/routes
src/scoring
src/analysis
src/postventa
src/entrega
src/inout
src/scan
src/admin
src/aintelligence
src/whatsapp
```

Esto genera varios problemas:

1. Los tenants aparecen en distintos lugares y con lógicas diferentes.
2. Existen múltiples accesos y logins.
3. Los roles están asociados a productos en vez de a la plataforma.
4. `admin` no representa toda la operación.
5. WhatsApp está tratado como módulo de negocio cuando en realidad es un canal.
6. IA / Intelligence aparece mezclada con administración.
7. Los productos comparten clientes, proyectos y propiedades, pero no necesariamente comparten esas entidades a nivel de modelo.
8. Cada nuevo producto corre el riesgo de duplicar autenticación, usuarios, configuración y permisos.

---

# 3. Principio arquitectónico nuevo

La nueva lógica debe ser:

```text
Usuario
  ↓
Login único
  ↓
Organization
  ↓
Project / Property
  ↓
Producto habilitado
```

Regla central:

> Un usuario tiene una sola identidad Ainspecciona.  
> Una empresa existe una sola vez.  
> Una empresa puede tener uno o varios productos habilitados.  
> Los productos utilizan el mismo core de plataforma.

---

# 4. Nueva arquitectura conceptual

```text
                        AINSPECCIONA PLATFORM
                               │
             ┌─────────────────┼─────────────────┐
             │                 │                 │
        IDENTITY          ORGANIZATIONS        PLATFORM
        & ACCESS            / TENANTS           CONTROL
             │                 │                 │
        Usuarios          Empresas/clientes   Operación global
        Login único       Miembros            Soporte
        Roles             Proyectos           IA / RAG
        Permisos          Propiedades         Billing
                          Productos activos    Auditoría
                               │
                               ▼
                        PRODUCT LAYER
                               │
       ┌───────────────┬───────┼────────┬───────────────┐
       ▼               ▼       ▼        ▼               ▼
   Inspection       Reception Postventa In & Out       Scan
```

---

# 5. Nuevo Core de Plataforma

Crear un core transversal independiente de los productos.

```text
src/
│
├── platform/
│   ├── auth/
│   ├── users/
│   ├── organizations/
│   ├── memberships/
│   ├── roles/
│   ├── permissions/
│   ├── projects/
│   ├── properties/
│   ├── spaces/
│   ├── files/
│   ├── notifications/
│   └── audit/
│
├── products/
│   ├── inspection/
│   ├── reception/
│   ├── postsale/
│   ├── inout/
│   └── scan/
│
├── intelligence/
│   ├── vision/
│   ├── rag/
│   ├── classification/
│   ├── scoring/
│   └── prompts/
│
├── integrations/
│   ├── whatsapp/
│   ├── elevenlabs/
│   ├── storage/
│   ├── billing/
│   └── external-api/
│
└── control/
```

---

# 6. Identidad y autenticación

## Objetivo

Eliminar conceptualmente los logins específicos por producto.

Debe existir un solo sistema:

```text
/login
/logout
/auth/*
```

Después de iniciar sesión:

```text
/app
```

El sistema debe resolver:

- Quién es el usuario.
- A qué organizaciones pertenece.
- Qué productos tiene habilitados.
- Qué proyectos puede ver.
- Qué permisos posee.

Ejemplo:

```text
Usuario: Juan Pérez
Organization: Exxacon
Productos:
- Reception
- Postventa

Permisos:
- reception.view
- reception.inspect
- postsale.view
```

No debe existir una autenticación independiente para Reception, Postventa, Scan, etc.

---

# 7. Organization reemplaza el concepto disperso de Tenant

Usar `Organization` como entidad corporativa central.

Ejemplos:

```text
Exxacon
RVC
Property Partners
RE/MAX Oficina Providencia
Ainspecciona SpA
```

Modelo conceptual:

```text
Organization
------------
id
name
rut
type
status
logo
createdAt
updatedAt
```

Relación con usuarios:

```text
OrganizationMember
------------------
id
organizationId
userId
roleId
status
createdAt
updatedAt
```

Una empresa debe existir **una sola vez**, aunque tenga varios productos.

Ejemplo:

```text
EXXACON
│
├── Products
│   ├── Reception
│   └── Postventa
│
├── Projects
│   └── Edificio X
│
└── Members
    ├── Admin
    ├── Supervisor
    └── Inspectores
```

---

# 8. Productos habilitados por Organization

Crear una relación común:

```text
OrganizationProduct
-------------------
id
organizationId
product
status
plan
startedAt
expiresAt
settings
createdAt
updatedAt
```

Enum inicial:

```text
INSPECTION
RECEPTION
POSTSALE
INOUT
SCAN
```

Ejemplo:

```text
Organization: Exxacon

INSPECTION  disabled
RECEPTION   enabled
POSTSALE    enabled
INOUT       disabled
SCAN        disabled
```

Un producto nuevo debe incorporarse como una habilitación de plataforma, no creando un nuevo sistema de cliente.

---

# 9. Separar Organization, Project y Product

No mezclar estos conceptos.

## Organization

Quién contrata.

```text
Exxacon
RVC
Property Partners
```

## Project

Dónde se trabaja.

```text
Edificio Alto Parque
Proyecto Las Condes
Condominio X
Sucursal Providencia
```

## Product

Qué herramienta se utiliza.

```text
Inspection
Reception
Postventa
In & Out
Scan
```

Ejemplo correcto:

```text
Organization: Exxacon

Project:
Edificio Ñuñoa

Products activos:
- Reception
- Postventa
```

---

# 10. Core inmobiliario común

Crear una jerarquía inmobiliaria transversal:

```text
Organization
    ↓
Project
    ↓
Property / Unit
    ↓
Space
```

Ejemplo:

```text
Exxacon
└── Edificio Ñuñoa
    ├── Depto 101
    │   ├── Living
    │   ├── Cocina
    │   └── Dormitorio 1
    │
    ├── Depto 102
    └── Depto 103
```

Sobre la misma propiedad pueden existir distintas operaciones:

```text
ReceptionInspection
PostSaleTicket
Inspection
InOutSession
Scan
```

No duplicar el departamento o unidad por producto.

---

# 11. RBAC — Roles y permisos

Implementar control de acceso basado en roles y permisos.

Modelos conceptuales:

```text
User
Role
Permission
RolePermission
OrganizationMember
```

Permisos sugeridos:

```text
organization.view
organization.manage

users.view
users.manage

projects.view
projects.manage

properties.view
properties.manage

inspection.view
inspection.create
inspection.review
inspection.manage

reception.view
reception.inspect
reception.close
reception.manage

postsale.view
postsale.create
postsale.assign
postsale.close
postsale.manage

inout.view
inout.create
inout.manage

scan.view
scan.create
scan.manage

reports.view
reports.export
```

Roles iniciales:

```text
PLATFORM_ADMIN
ORGANIZATION_ADMIN
PROJECT_MANAGER
INSPECTOR
REVIEWER
BROKER
POSTSALE_AGENT
VIEWER
```

Importante:

Los roles no deben convertirse en lógica hardcoded del producto.

Los permisos deben ser la unidad real de autorización.

---

# 12. Nueva experiencia de navegación

## Login

```text
/login
```

## Aplicación cliente

```text
/app
```

Menú sugerido:

```text
Ainspecciona

Inicio

Inspection
Reception
Postventa
In & Out
Scan

Reportes
Proyectos
Equipo
Configuración
```

Solo mostrar productos habilitados para la organización y usuario.

URLs objetivo:

```text
/app
/app/inspection
/app/reception
/app/postsale
/app/inout
/app/scan

/app/projects
/app/team
/app/reports
/app/settings
```

Ejemplo de navegación profunda:

```text
/app/reception/projects/:projectId
/app/reception/projects/:projectId/units/:unitId
```

---

# 13. Nuevo Ainspecciona Control

`/admin` actual debe evolucionar hacia una consola global de operación.

Nueva URL recomendada:

```text
/control
```

No usar `/admin` como concepto principal porque se confunde con el administrador de cada cliente.

## Ainspecciona Control

Solo para operación interna Ainspecciona.

```text
CONTROL
│
├── Organizations
├── Users
├── Products
├── Projects
├── Properties
│
├── Inspection
├── Reception
├── Postventa
├── In & Out
├── Scan
│
├── Intelligence
│   ├── Vision
│   ├── RAG
│   ├── Prompts
│   └── Usage
│
├── Billing
├── Integrations
├── Support
├── Audit Logs
└── Platform Settings
```

---

# 14. Dos niveles distintos de administración

## Cliente

Ruta:

```text
/app/settings
```

Puede administrar:

- Datos de organización.
- Usuarios.
- Roles autorizados.
- Proyectos.
- Configuración propia.
- Integraciones propias.
- Productos contratados, si corresponde.

## Ainspecciona

Ruta:

```text
/control
```

Puede administrar:

- Todas las organizaciones.
- Todos los usuarios.
- Todos los productos.
- Todos los proyectos.
- Uso de IA.
- RAG.
- Billing.
- Integraciones.
- Logs.
- Soporte.
- Configuración global.

---

# 15. Intelligence como capa transversal

La IA no debe vivir dentro de Admin.

Nueva estructura:

```text
src/intelligence/
```

Debe ser consumida por distintos productos.

```text
Inspection ───────┐
Reception ────────┤
Postventa ────────┼──► Intelligence
In & Out ─────────┤
Scan ─────────────┘
```

Componentes:

```text
vision
rag
classification
scoring
prompts
```

Objetivo:

> Todos los productos Ainspecciona utilizan una capa común de inteligencia inmobiliaria.

---

# 16. WhatsApp y ElevenLabs son integraciones

Mover conceptualmente:

```text
src/whatsapp
```

a:

```text
src/integrations/whatsapp
```

ElevenLabs:

```text
src/integrations/elevenlabs
```

WhatsApp y ElevenLabs no son productos.

Son canales de interacción.

Ejemplo:

```text
Postventa
    ↓
Conversation / Workflow
    ↓
WhatsApp
Web
ElevenLabs
API
```

---

# 17. Estructura objetivo del backend

```text
src/
│
├── platform/
│   ├── auth/
│   ├── users/
│   ├── organizations/
│   ├── memberships/
│   ├── roles/
│   ├── permissions/
│   ├── projects/
│   ├── properties/
│   ├── spaces/
│   ├── files/
│   ├── notifications/
│   └── audit/
│
├── products/
│   ├── inspection/
│   ├── reception/
│   ├── postsale/
│   ├── inout/
│   └── scan/
│
├── intelligence/
│   ├── vision/
│   ├── rag/
│   ├── classification/
│   ├── scoring/
│   └── prompts/
│
├── integrations/
│   ├── whatsapp/
│   ├── elevenlabs/
│   ├── billing/
│   ├── storage/
│   └── external-api/
│
├── control/
│
├── shared/
│   ├── errors/
│   ├── validation/
│   ├── logging/
│   └── utils/
│
└── server.js
```

---

# 18. Reglas arquitectónicas

Cursor debe respetar estas reglas durante el refactor.

## Regla 1

Ningún producto nuevo puede implementar su propio login.

## Regla 2

Ningún producto puede crear su propio modelo de tenant.

Usar siempre:

```text
Organization
OrganizationMember
```

## Regla 3

Los productos no deben implementar sistemas propios de roles.

Usar RBAC común.

## Regla 4

Los proyectos y propiedades deben pertenecer al core.

No duplicarlos dentro de cada producto salvo que exista una justificación técnica explícita.

## Regla 5

La IA debe vivir en `intelligence/`.

Los productos la consumen.

## Regla 6

WhatsApp, ElevenLabs, storage, billing y APIs externas deben vivir en `integrations/`.

## Regla 7

Las funciones de operación global deben vivir en `control/`.

## Regla 8

Evitar microservicios por ahora.

Priorizar modular monolith.

## Regla 9

No hacer un "big bang rewrite".

Migrar progresivamente.

## Regla 10

Durante la transición, mantener compatibilidad con las rutas existentes mientras sea necesario.

---

# 19. Estrategia de migración

## Fase 0 — Auditoría

Antes de modificar código, Cursor debe identificar:

- Todos los modelos Prisma relacionados con usuarios.
- Todos los modelos de tenant/empresa/cliente.
- Todos los sistemas de login.
- Todos los middlewares de autenticación.
- Todos los roles actuales.
- Todos los permisos hardcoded.
- Todas las rutas por producto.
- Todas las referencias a `tenantId`.
- Todos los modelos de proyectos.
- Todos los modelos de propiedades/unidades.
- Todas las dependencias entre módulos.

Generar un documento:

```text
docs/current-architecture-audit.md
```

No modificar lógica todavía.

---

# 20. Fase 1 — Crear Platform Core

Crear módulos base:

```text
platform/auth
platform/users
platform/organizations
platform/memberships
platform/roles
platform/permissions
platform/projects
platform/properties
```

Sin eliminar todavía los modelos antiguos.

---

# 21. Fase 2 — Modelo Organization

Crear o normalizar:

```text
Organization
OrganizationMember
OrganizationProduct
```

Mapear tenants actuales a Organization.

Requisito:

No perder IDs ni relaciones existentes.

Si es necesario utilizar tablas de compatibilidad durante migración.

---

# 22. Fase 3 — Autenticación única

Crear un flujo común:

```text
/login
/auth/*
```

Resolver sesión con:

```text
userId
organizationId
membershipId
permissions[]
enabledProducts[]
```

Durante transición se pueden mantener redirects desde rutas antiguas.

---

# 23. Fase 4 — RBAC

Centralizar autorización.

Crear helpers o middleware similares a:

```javascript
requireAuth()
requireOrganization()
requirePermission('reception.inspect')
requireProduct('RECEPTION')
```

Evitar checks manuales repetidos en controladores.

Ejemplo incorrecto:

```javascript
if (user.role === 'admin' || user.type === 'inspector') {
   ...
}
```

Ejemplo objetivo:

```javascript
await requirePermission(request, 'reception.inspect')
```

---

# 24. Fase 5 — Proyectos y propiedades

Normalizar:

```text
Project
Property
Space
```

Los módulos deben apuntar progresivamente a estas entidades.

No duplicar unidades por producto.

---

# 25. Fase 6 — Migrar productos

Orden sugerido:

```text
1. Reception
2. Postventa
3. Inspection
4. In & Out
5. Scan
```

Cada migración debe:

1. Adoptar `Organization`.
2. Adoptar autenticación común.
3. Adoptar RBAC.
4. Adoptar Project/Property si corresponde.
5. Mantener funcionalidad previa.
6. Eliminar código duplicado solo después de validar producción.

---

# 26. Fase 7 — Intelligence

Mover progresivamente:

```text
src/ainintelligence
src/scoring
src/analysis
```

hacia:

```text
src/intelligence/
```

No modificar comportamiento de modelos/prompts durante esta fase salvo que sea imprescindible.

Primero ordenar estructura.

Después optimizar.

---

# 27. Fase 8 — Integraciones

Mover:

```text
src/whatsapp
```

hacia:

```text
src/integrations/whatsapp
```

Identificar también:

- ElevenLabs.
- Firebase / Storage.
- Billing.
- APIs externas.
- Webhooks.

Separar integración externa de lógica de negocio.

---

# 28. Fase 9 — Control

Crear:

```text
/control
```

y:

```text
src/control/
```

Debe permitir operación transversal.

El viejo `/admin` puede mantenerse temporalmente como alias/redirect o módulo legacy mientras se completa la migración.

---

# 29. Fase 10 — Nueva navegación `/app`

Crear shell principal:

```text
/app
```

Debe resolver dinámicamente:

```text
currentUser
currentOrganization
enabledProducts
permissions
```

El menú debe depender de esas variables.

No hardcodear acceso solo por URL.

---

# 30. Modelo de contexto recomendado

Cada request autenticado debería poder resolver un contexto similar a:

```typescript
type RequestContext = {
  userId: string;
  organizationId: string;
  membershipId: string;
  roleIds: string[];
  permissions: string[];
  enabledProducts: string[];
};
```

Opcionalmente:

```typescript
projectId?: string;
propertyId?: string;
```

cuando el request trabaja dentro de esas entidades.

---

# 31. Convenciones de naming

Usar nombres consistentes en código.

## Productos

Código:

```text
inspection
reception
postsale
inout
scan
```

UI en español:

```text
Inspección
Recepción Técnica
Postventa
In & Out
Scan
```

Evitar mezclar simultáneamente:

```text
Entrega
Recepción
Reception
Entrega Técnica
```

Elegir un nombre técnico interno único:

```text
reception
```

---

# 32. Reglas de seguridad multi-tenant

Este punto es crítico.

Todo query de datos pertenecientes a cliente debe estar limitado por Organization.

Ejemplo:

```javascript
where: {
  id: projectId,
  organizationId: request.context.organizationId
}
```

Nunca confiar exclusivamente en IDs enviados por frontend.

La autorización debe validarse en backend.

Cada operación sensible debe verificar:

```text
usuario
+
organization
+
producto
+
permiso
```

cuando corresponda.

---

# 33. Auditoría

Agregar progresivamente eventos de auditoría para operaciones sensibles.

Modelo conceptual:

```text
AuditLog
--------
id
organizationId
userId
action
entityType
entityId
metadata
ip
createdAt
```

Ejemplos:

```text
USER_CREATED
USER_ROLE_CHANGED
PROJECT_CREATED
INSPECTION_CLOSED
RECEPTION_OBSERVATION_CLOSED
POSTSALE_TICKET_ASSIGNED
PRODUCT_ENABLED
ORGANIZATION_UPDATED
```

---

# 34. Compatibilidad

No romper producción durante el refactor.

Prioridades:

1. Mantener endpoints actuales.
2. Crear nuevas capas debajo.
3. Migrar consumidores.
4. Deprecar rutas.
5. Eliminar legacy al final.

Cuando una ruta antigua sea reemplazada:

```text
old route
   ↓
compatibility adapter
   ↓
new service
```

No duplicar lógica de negocio.

---

# 35. Qué NO hacer

Cursor no debe:

- Reescribir todo desde cero.
- Crear microservicios innecesarios.
- Cambiar Cloud Run sin necesidad.
- Cambiar Prisma por otra tecnología.
- Rehacer el frontend completo en una sola fase.
- Duplicar modelos para acelerar una migración.
- Crear autenticación independiente para Scan.
- Crear autenticación independiente para Postventa.
- Crear un segundo modelo de Organization.
- Introducir permisos hardcoded nuevos.
- Migrar datos destructivamente sin backup y plan de rollback.

---

# 36. Resultado esperado

Al finalizar el proceso, Ainspecciona debe funcionar conceptualmente así:

```text
AINSPECCIONA
│
├── PLATFORM CORE
│   ├── Identity
│   ├── Organizations
│   ├── Users
│   ├── Permissions
│   ├── Projects
│   └── Properties
│
├── PRODUCTS
│   ├── Inspection
│   ├── Reception
│   ├── Postventa
│   ├── In & Out
│   └── Scan
│
├── INTELLIGENCE
│   ├── Vision
│   ├── RAG
│   ├── Classification
│   └── Scoring
│
├── INTEGRATIONS
│   ├── WhatsApp
│   ├── ElevenLabs
│   ├── Storage
│   ├── Billing
│   └── APIs
│
└── CONTROL
    └── Ainspecciona internal operations
```

---

# 37. Definición final

La nueva arquitectura debe respetar esta frase:

> **Un usuario → un login → una organización → uno o varios proyectos → uno o varios productos.**

Y esta segunda regla:

> **Los productos no son aplicaciones separadas: son módulos de una misma plataforma Ainspecciona.**

---

# 38. Primera tarea para Cursor

Antes de escribir código, ejecutar una auditoría completa del repositorio.

## Prompt operativo

```text
Analiza este repositorio completo y compáralo con el documento
"Ainspecciona Platform — Plan de Reordenamiento Arquitectónico".

NO hagas cambios todavía.

Necesito primero un diagnóstico técnico detallado.

Identifica:

1. estructura actual del backend;
2. todos los modelos Prisma;
3. modelos y relaciones asociadas a tenant;
4. modelos y relaciones asociadas a usuarios;
5. todos los sistemas de login y autenticación;
6. middlewares de auth;
7. roles y permisos actuales;
8. checks de roles hardcoded;
9. rutas de cada producto;
10. dependencias entre productos;
11. modelos de proyectos, edificios, propiedades y unidades;
12. uso de tenantId en todo el repositorio;
13. estructura actual de admin;
14. código relacionado con IA, scoring y análisis;
15. integraciones externas;
16. WhatsApp;
17. ElevenLabs;
18. storage;
19. posibles duplicaciones de lógica;
20. riesgos de migración.

Luego genera:

docs/current-architecture-audit.md

El informe debe incluir:

- arquitectura actual;
- problemas detectados;
- mapa de dependencias;
- diferencias respecto de la arquitectura objetivo;
- propuesta de migración;
- archivos que habría que modificar;
- modelos Prisma afectados;
- riesgos;
- orden recomendado de implementación.

IMPORTANTE:

No reescribas código.
No cambies rutas.
No hagas migraciones.
No modifiques Prisma.
No elimines nada.

Primero necesito revisar y aprobar el diagnóstico.
```

---

# 39. Criterio de éxito de la primera etapa

La primera etapa termina cuando podamos responder con precisión:

```text
¿Qué tenemos hoy?
¿Qué está duplicado?
¿Qué depende de qué?
¿Cuántos tenants existen conceptualmente?
¿Cuántos sistemas de auth existen?
¿Qué productos comparten datos?
¿Qué podemos reutilizar?
¿Qué debemos migrar primero?
¿Qué podemos dejar intacto?
```

Solo después de aprobar ese diagnóstico comienza el refactor.
