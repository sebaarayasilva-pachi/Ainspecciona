# Ainspecciona — Auditoría de arquitectura actual

**Fecha:** 2026-08-10  
**Alcance:** `ainspecta_web` (+ siblings del monorepo)  
**Referencia objetivo:** `docs/AINSPECCIONA_PLATFORM_REFACTOR_CURSOR.md`  
**Estado:** solo diagnóstico — sin cambios de código, rutas ni Prisma.

---

## 1. Resumen ejecutivo

Hoy Ainspecciona es un **modular monolith incompleto**:

- Fastify + Prisma + un Cloud Run (`ainspecciona-api`) + Firebase Hosting.
- Productos parcialmente extraídos a `src/{postventa,entrega,inout,scan,aintelligence,whatsapp}`.
- El núcleo Capture/STI, billing y mucha auth siguen en `server.js` (~8.4k líneas).

El problema central no es el hosting: son **6 universos de tenant** y **5+ logins**, sin `Organization` canónica ni RBAC de plataforma.

**Puente reutilizable:** el modelo `Session` ya es transversal (discriminado por `type`). Firebase solo reenvía `__session` → esa cookie ya une parcialmente Postventa/Entrega/InOut.

**Norte acordado (próxima implementación):** login único + `/control` + adapters legacy, sin unificar aún Property/Space.

---

## 2. Arquitectura actual

```text
Firebase Hosting (public/)
        │ rewrites /api/** + varias rutas producto
        ▼
Cloud Run: server.js (Fastify)
        │
        ├── Inline: Capture/tenant/exec/admin/billing/pages
        └── register*Routes:
              postventa | entrega | inout | scan
              whatsapp | aintelligence | capture | review*
        │
        ▼
MySQL (Prisma) — 6 raíces de tenant/org sin FK cruzadas
```

| Capa | Ubicación | Rol |
|------|-----------|-----|
| Entry | `server.js` | Bootstrap, páginas, core APIs, wiring |
| Productos | `src/postventa`, `entrega`, `inout`, `scan` | APIs + dominio |
| IA | `src/aintelligence`, `scoring`, `analysis` + lógica en `server.js` | Vision, KB, scoring |
| Canales | `src/whatsapp`, ElevenLabs en rutas/public | No son productos |
| UI | `public/{postventa,entrega,inout,scan,toctoc}` + HTML root | Multi-app estática |
| Mobile | `../mobile_capture_app` (Expo), `../ainspecta_scan_android` | Clientes nativos |
| Legacy monorepo | `../client`, `../server` | Stubs CRA/Express — no son el MVP |

---

## 3. Universos de tenant (6)

| # | Raíz Prisma | Usuario | Producto | Activo |
|---|-------------|---------|----------|--------|
| 1 | `Tenant` | `User` | Capture / STI / Business | Sí |
| 2 | `PvTenant` | `PvUser` | Postventa | Sí |
| 3 | `EntregaTenant` | `EntregaUser` | Entrega / Recepción | Sí |
| 4 | `IoTenant` | `IoUser` | In & Out | Sí |
| 5 | `TtTenant` | `TtUser` | TOC TOC schema | **No usado en código** |
| 6 | `ScanOrg` | `ScanUser` | Scan | Sí (demo) |

**No hay** `Organization`, `OrganizationMember`, `OrganizationProduct`, ni modelo `Role`/`Permission`.  
Roles = enums por producto (`UserRole`, `PvUserRole`, `EntregaUserRole`, `IoUserRole`). ScanUser sin rol.

Demo TOC TOC (`src/demo/ensureToctocTenants.js`) siembra **cuatro** universos en paralelo (Capture + Entrega + Postventa + InOut), no `Tt*`.

---

## 4. Modelos Prisma — mapa por dominio

### 4.1 Capture / STI (`Tenant`)

`Tenant` → `User`, `Owner`, `Property`, `Case`, `Slot`, `Photo`, `CaptureToken`, créditos (`TenantCredit`, `CreditTransaction`).

Roles: `SUPER_ADMIN` | `TENANT_ADMIN` | `TENANT_USER`.

### 4.2 Postventa (`PvTenant`)

`PvTenant` → `PvUser`, `PvProject` → `PvUnit` → `PvTicket` → captura/AI (`PvCaptureSession`, `PvCaptureSlot`, `PvAIAnalysis`, `PvAnalysisReview`).

Jerarquía inmobiliaria **más cercana** al core objetivo (Project → Unit).

### 4.3 Entrega

Solo `EntregaTenant` + `EntregaUser` en Prisma.  
Findings / pisos / unidades: **store JSON/GCS** (`src/entrega/store.js`), no modelos Prisma.

### 4.4 In & Out (`IoTenant`)

`IoProperty` → `IoLease` → `IoVisit` → slots/fotos → `IoDiffResult` / `IoReport`.

### 4.5 Scan (`ScanOrg`)

`ScanProperty` → `ScanJob`. Naming `orgId` (no `tenantId`).

### 4.6 Sesión compartida

```text
Session { token, type, tenantId?, userId?, expiresAt }
types usados: tenant | exec | postventa | entrega | inout
```

Sin FK Prisma a User/Tenant. IDs opacos por producto.

### 4.7 IA en Prisma

`PvAIAnalysis`, `PvAnalysisReview`, `SlotReview`, `AiFeedback`, `AiReportCorrection`, `KnowledgeEntry`, campos de análisis en `Slot`, `IoDiffResult`.

### 4.8 Runtime schema helpers

| Archivo | Qué hace |
|---------|----------|
| `src/scan/ensureScanSchema.js` | CREATE TABLE scan_* si faltan |
| `src/postventa/ensureAssignmentSchema.js` | ALTER columnas assignment/inspector |

---

## 5. Sistemas de autenticación (hoy)

### 5.1 Logins API

| Endpoint | Producto |
|----------|----------|
| `POST /api/tenant/login` | Capture corredora |
| `POST /api/executive/login` | Ejecutivo Ainspecciona |
| `POST /api/postventa/portal/login` | Postventa |
| `POST /api/entrega/login` | Entrega |
| `POST /api/inout/auth/login` | In & Out |
| Headers `x-admin-user` / `x-admin-pass` | Admin (default `admin`/`admin123`) |
| Scan | Sin login web; demo org en boot |

`GET /login` hoy redirige a `/`.

### 5.2 Cookies / headers / storage

| Mecanismo | Uso |
|-----------|-----|
| `__session` | Forward Firebase → Cloud Run (Postventa/Entrega/InOut) |
| `*_session` cookies | Producto local |
| `x-*-session` / `x-session-token` / Bearer | API clients |
| `sessionStorage` / `localStorage` | Tokens en UI |

### 5.3 Middlewares

| Helper | Archivo |
|--------|---------|
| `requirePvPortalAuth` | `src/postventa/auth/portalAuth.js` |
| `requireEntregaAuth` / `requireEntregaAdmin` | `src/entrega/auth.js` |
| `requireIoAuth` | `src/inout/auth.js` |
| `getTenantSession` / `getExecSession` | `server.js` |
| `isAdminAuthed` | `server.js` |
| Page guards HTML | Entrega + InOut en `server.js`; Postventa solo client-side |

### 5.4 Roles hardcoded (muestra)

- Postventa: `ADMIN`/`EXECUTIVE` en `portalUsers.js`, `portalDashboard.js`, `inspectorClose.js`
- Entrega: `requireEntregaAdmin`, UI en `entrega-app.js`
- Capture: `TENANT_ADMIN` / `TENANT_USER` en HTML

**Conteo conceptual:** ≥5 sistemas de auth + admin por headers + demos Scan/InOut bootstrap.

---

## 6. Rutas y productos

| Producto | UI | API | Módulo |
|----------|----|-----|--------|
| Capture/STI | `/`, `/tenant`, `/executive`, `/review`… | mayormente `server.js` + `src/routes/capture.js` | monolito |
| Postventa | `/postventa/*` | `/api/postventa/*` | `src/postventa` (~6k LOC) |
| Entrega | `/entrega/*` | `/api/entrega/*` | `src/entrega` |
| In & Out | `/inout/*` | `/api/inout/*` | `src/inout` |
| Scan | `/scan`, `/scan/s/:id` | `/api/scan/*` | `src/scan` |
| Admin | `/admin` | `/api/admin*` | helpers `src/admin` + server |
| Aintelligence | dentro de admin | `/api/admin/aintelligence/*` | `src/aintelligence` |
| WhatsApp | — | `/api/whatsapp` | `src/whatsapp` |
| Demo hub | `/toctoc` | — | `src/demo` |

---

## 7. Dependencias entre módulos

```text
reviewCenter ──► postventa + aintelligence + analysis
postventa analysis ──► aintelligence KB
entrega taxonomyKpi ──► aintelligence taxonomy
scan / demo ──► postventa hashPassword
propertyCheck ──► scoring + aintelligence + analysis
inout ──► photoQuality + storage
```

Productos de negocio **no** comparten Organization; sí comparten storage, scoring helpers y (parcialmente) sesión tipada.

---

## 8. Integraciones externas

| Integración | Dónde | Clasificación objetivo |
|-------------|-------|------------------------|
| OpenAI | `server.js`, WhatsApp, postventa, propertyCheck | intelligence |
| WhatsApp Meta/360 | `src/whatsapp` | integrations |
| ElevenLabs | server public + postventa + entrega | integrations |
| GCS / local storage | `src/storage` | integrations |
| Mercado Pago | `server.js` | integrations/billing |
| SimpleFactura | `src/simplefactura.js` | integrations |
| HubSpot | `server.js` | integrations |
| SMTP | `src/email.js` | integrations |
| Firebase Hosting | `firebase.json` | infra (no SDK app) |

Gemini/Anthropic: no presentes.

---

## 9. Duplicaciones y deuda

1. **6 raíces de cliente** + users/passwords por producto.  
2. **Logins y cookies** por producto + puente `__session`.  
3. **Property** triplicado: `Property`, `IoProperty`, `ScanProperty` (+ unidades Entrega en JSON).  
4. **Roles** enums distintos, sin permisos.  
5. **`TtTenant`/`TtUser`** en schema, muertos.  
6. **`scoringV1.js`** sin imports.  
7. **`/admin`** mezcla ops Ainspecciona + AI + postventa admin.  
8. **`server.js`** concentra Capture + billing + pages.  
9. Monorepo `client/` + `server/` confunden el entrypoint real (`ainspecta_web`).  
10. CORS: `allowedHeaders` incluye `x-inout-session` pero no siempre `x-postventa-session` / `x-entrega-session`.

---

## 10. Diferencias vs arquitectura objetivo

| Objetivo | Hoy | Gap |
|----------|-----|-----|
| Login único `/login` | 5+ logins; `/login` → `/` | Alto |
| `Organization` canónica | 6 raíces | Alto |
| `OrganizationProduct` | No | Alto |
| RBAC permisos | Enums + if role | Alto |
| Project/Property core | Solo Postventa cercano; resto fragmentado | Alto |
| `/app` shell | Multi-carpeta public | Medio |
| `/control` vs admin cliente | Todo bajo `/admin` + headers | Medio |
| `intelligence/` | `aintelligence` + scoring + analysis + server | Medio |
| `integrations/` | whatsapp suelto; MP/ElevenLabs en server | Bajo-Medio |
| Modular monolith | Parcial | Medio |
| Compatibilidad rutas | — | Mantener durante migración |

---

## 11. Riesgos de migración

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Unificar Property/Unit prematuro | Alta | Diferir; adapters por producto |
| Romper Firebase `__session` | Alta | Login único debe setear `__session` + compat headers |
| Capture (corredora) ≠ Exxacon (edificio) | Alta | `Organization.type` (BROKER / DEVELOPER / …) |
| Entrega findings fuera de Prisma | Alta | No migrar Reception primero a Property core |
| Pérdida de IDs al mapear tenants | Alta | Tablas puente `LegacyTenantMap` |
| Big bang frontend `/app` | Media | Shell + redirects a UIs existentes |
| Admin password por default | Media | Rotar al crear Control |
| Tt* y demos paralelos | Baja | Archivar Tt*; demos vía OrganizationProduct |

---

## 12. Respuestas a la “primera etapa” (§39 del plan)

| Pregunta | Respuesta |
|----------|-----------|
| ¿Qué tenemos hoy? | Monolito Fastify modular a medias; 5 productos + admin/IA/WhatsApp |
| ¿Qué está duplicado? | Tenants, users, logins, properties, roles |
| ¿Qué depende de qué? | Review/AI cruzan productos; dominio de negocio aislado por tenant |
| ¿Cuántos tenants conceptuales? | **6** raíces (1 muerta) |
| ¿Cuántos sistemas de auth? | **≥5** + admin headers + demos |
| ¿Qué productos comparten datos? | Casi ninguno a nivel org; sí Session tipada, storage, KB parcial |
| ¿Qué reutilizar? | `Session`, patrón `__session`, `hashPassword`, módulos ya en `src/*` |
| ¿Qué migrar primero? | Identidad + Control (no Property) |
| ¿Qué dejar intacto? | Dominio Capture/Postventa/InOut/Scan hasta adapters estables; Entrega store JSON |

---

## 13. Propuesta de migración (acordada)

### Principio

> Login único + Control primero.  
> Organization canónica con **adapters** a tenants legacy.  
> Project/Property unificado **después**.  
> Sin big bang de UI.

### Fase 0 — Hecha (este documento)

Auditoría. Sin código.

### Fase 1 — Platform Identity (MVP)

Crear (nuevos, sin borrar legacy):

```text
src/platform/auth/
src/platform/users/
src/platform/organizations/
src/platform/memberships/
```

Prisma mínimo:

- `PlatformUser` (o evolucionar un User canónico)
- `Organization`
- `OrganizationMember`
- `OrganizationProduct`
- `LegacyIdentityLink` (platformUserId + product + legacyUserId + legacyTenantId)

Sesión:

```text
Session.type = 'platform'
context: { userId, organizationId, membershipId, enabledProducts[], permissions[] }
```

Endpoints:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /login` → UI única

Compat: al login, crear/actualizar sesiones legacy opcionales **o** resolver membership vía `LegacyIdentityLink` en cada `require*Auth` (preferible: wrapper que acepte sesión platform).

Cookie: siempre `__session` (+ product cookies durante transición).

### Fase 2 — Control MVP (`/control`)

Reemplazo conceptual de ops en `/admin`:

- Listar Organizations  
- Members  
- Enable/disable products  
- Soporte básico (buscar usuario / org)  
- Redirect temporal `/admin` → `/control` para ops internas  

Auth Control: `PLATFORM_ADMIN` (migrar desde SUPER_ADMIN / admin headers).

### Fase 3 — Shell `/app`

Menú dinámico por `enabledProducts` → links a:

`/entrega`, `/postventa`, `/inout`, `/scan`, Capture tenant UI  

Sin reescribir frontends de producto.

### Fase 4 — Piloto de adopción

Orden recomendado (revisado vs plan original):

1. **Postventa** — módulo limpio + Session ya tipada  
2. **Scan** — superficie chica  
3. **In & Out**  
4. **Entrega** — tras decidir store→Prisma  
5. **Capture/Inspection** — billing/créditos acoplados; `Organization.type=BROKER`

### Fase 5+ — Diferido

- RBAC fino (`requirePermission`)  
- Project/Property/Space core  
- `src/intelligence/` + `src/integrations/` moves  
- Deprecar logins y cookies de producto  

---

## 14. Archivos que tocaría la Fase 1–2 (estimado)

| Área | Archivos |
|------|----------|
| Schema | `prisma/schema.prisma` + migración |
| Auth nuevo | `src/platform/**` (nuevo) |
| Wiring | `server.js` (register + `/login`) |
| Control UI | `public/control/**` (nuevo) |
| Adapters | wrappers en `portalAuth.js`, `entrega/auth.js`, `inout/auth.js`, tenant/exec session |
| Demo | `src/demo/ensureToctocTenants.js` → también crear Organization + links |
| Docs | este audit + actualizar plan si hace falta |

**No tocar en Fase 1–2:** findings Entrega, modelos Property de producto, prompts IA, Android/Expo.

---

## 15. Modelos Prisma afectados (Fase 1–2)

**Nuevos (propuesta):**

- `Organization`
- `OrganizationMember`
- `OrganizationProduct`
- `PlatformUser` (si no se reutiliza `User` — ver decisión abajo)
- `LegacyIdentityLink`
- Extender `Session.type` con `platform` / `control`

**Decisión pendiente (aprobar antes de código):**

| Opción | Pros | Contras |
|--------|------|---------|
| A. Nuevo `PlatformUser` | No ensucia `User` Capture | Dos “users” hasta consolidar |
| B. Elevar `User` a plataforma y dejar `tenantId` opcional | Un solo modelo identidad | Riesgo alto en Capture/billing |

**Recomendación auditoría:** **Opción A** para Fase 1 (menos riesgo); consolidar en Fase 4 Capture.

**Intacto al inicio:** `Pv*`, `Io*`, `Entrega*`, `Scan*`, `Case`/`Slot`, `Tt*` (marcar deprecated).

---

## 16. Orden recomendado de implementación (siguiente sprint)

1. Aprobar este audit + decisión PlatformUser (A vs B).  
2. Migración Prisma Organization + PlatformUser + links.  
3. `POST /api/auth/login` + UI `/login`.  
4. Seed: TOC TOC / demos como Organization multi-producto.  
5. `/control` MVP (orgs + products + users).  
6. Adapter: Postventa acepta sesión `platform`.  
7. Shell `/app` mínimo (links).  
8. Solo entonces: siguiente producto o RBAC.

---

## 17. Criterio de éxito del siguiente hito

Podemos decir “identidad de plataforma viva” cuando:

- Un usuario demo (ej. Exxacon/TOC TOC) entra por **`/login` una vez**.  
- Ve productos habilitados en **`/app`**.  
- Ops Ainspecciona gestiona orgs en **`/control`**.  
- Postventa sigue funcionando sin su login propio (redirect desde login único).  
- Logins legacy siguen vivos como fallback.

---

## 18. Apéndice — índices de archivos clave

| Tema | Path |
|------|------|
| Schema | `prisma/schema.prisma` |
| Server | `server.js` |
| Postventa auth | `src/postventa/auth/portalAuth.js` |
| Entrega auth | `src/entrega/auth.js` |
| InOut auth | `src/inout/auth.js` |
| Scan | `src/scan/routes.js` |
| Demo TOC TOC | `src/demo/ensureToctocTenants.js` |
| Hosting | `firebase.json` |
| Plan objetivo | `docs/AINSPECCIONA_PLATFORM_REFACTOR_CURSOR.md` |

---

## 19. Estado de implementación (Fase 1)

**Iniciado 2026-08-10 (Opción A — PlatformUser).**

| Entrega | Path / nota |
|---------|-------------|
| Schema + ensure | `prisma/schema.prisma`, `src/platform/ensurePlatformSchema.js` |
| Auth / login | `POST /api/auth/login`, `GET /login`, sesión `type=platform` |
| App shell | `GET /app` → `public/app/index.html` |
| Control MVP | `GET /control` → orgs/products/users |
| Bridges | Postventa / Entrega / InOut aceptan sesión platform |
| Seed demo | `plataforma@toctoc.ainspecciona.com`, `control@ainspecciona.com` |

Logins legacy de producto se mantienen.

---

*Diagnóstico + Fase 1 identity/control en curso.*
