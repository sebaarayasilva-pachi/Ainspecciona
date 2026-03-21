# Plan de trabajo – Ainspecciona

## Resumen

| # | Tarea | Prioridad | Complejidad |
|---|-------|-----------|-------------|
| 1 | Mejorar página Cómo funciona | 1 | Media |
| 2 | Integrar créditos y cuenta corriente en tenants | 2 | Alta |
| 3 | Headers consistentes | 3 | Baja |

---

## 1. Mejorar página Cómo funciona ✅ COMPLETADO

**Archivo:** `public/como-funciona.html`

**Estado actual:** Página con tema oscuro, secciones SVG, header unificado.

**Mejoras realizadas:**
- [x] Hero con título y CTAs (Crear inspección / Ver precios)
- [x] Alineado con verde #35D07F (footer CTA, botones)
- [x] CTA bloque final "¿Listo para empezar?"
- [x] Footer CTA "Crear inspección" en verde
- [x] UX móvil: responsive con overflow-x para SVGs

---

## 2. Integrar sistema de créditos y cuenta corriente en tenants

**Estado actual:**
- MercadoPago: planes starter (1 crédito), business (50), corporate (100)
- Precios: menciona "Cuenta corriente de créditos", "Cuenta corriente avanzada"
- Schema: no hay modelos de créditos en Prisma

**Tareas técnicas:**

### 2.1 Schema y base de datos
- [ ] Crear modelo `TenantCredit` o `CreditAccount`:
  - `tenantId`, `balance` (int), `createdAt`, `updatedAt`
- [ ] Crear modelo `CreditTransaction`:
  - `tenantId`, `amount` (+/-), `type` (PURCHASE, CONSUMPTION, ADJUSTMENT), `caseId?`, `description`, `createdAt`
- [ ] Migración Prisma

### 2.2 API
- [ ] `GET /api/tenant/credits` – devolver balance actual
- [ ] `GET /api/tenant/credits/transactions` – historial de movimientos
- [ ] Al crear inspección (`POST /api/tenant/inspections`): descontar 1 crédito si hay balance
- [ ] Webhook MercadoPago: al pago aprobado, sumar créditos al tenant

### 2.3 UI en tenant
- [ ] Mostrar saldo de créditos en header o sidebar
- [ ] Sección "Cuenta corriente" con historial de movimientos
- [ ] Bloqueo o aviso si no hay créditos al crear inspección
- [ ] Link a /precios o /pago para comprar créditos

### 2.4 Flujo de pago
- [ ] Vincular pago con `tenantId` (ej. email de tenant en MercadoPago)
- [ ] `external_reference` en preferencia con `tenantId` para identificar al comprador

---

## 3. Headers consistentes ✅ COMPLETADO

**Estado actual (inconsistencias):**
Resuelto: Se unificaron los headers en todas las páginas públicas (`como-funciona.html`, `precios.html`, `corredores.html`, `faq.html`, etc.) usando el mismo bloque HTML y `header.css`.

- [x] Crear `public/partials/header.html` o `public/assets/header.css` compartido
- [x] Definir variantes: `header--public`, `header--simple`, `header--tenant`
- [x] Aplicar en cada página

**Nota:** Sin componentes compartidos (JS/SSR), la opción práctica es un CSS común y un snippet HTML que se copie/actualice en cada página.

---

## Orden sugerido de ejecución

1. **Headers** (3) – más rápido, mejora percepción inmediata
2. **Cómo funciona** (1) – contenido y UX
3. **Créditos** (2) – más trabajo, requiere schema, API y UI

---

## Facturación electrónica (POSTERGADO ETAPA 2)

**Plan:** Integrar con **SimpleFactura** u otro proveedor para emitir factura electrónica SII.
**Estado:** Pospuesto para después de la fase Beta para evitar costos fijos mensuales. Actualmente el sistema envía un comprobante PDF temporal por correo y la facturación se puede hacer manual en el portal del SII si es necesario.

---

## Notas

- `DEPLOY_GCP.md` tiene instrucciones de deploy
- MercadoPago: `MERCADOPAGO_ACCESS_TOKEN` en .env
- Prisma: `npx prisma migrate dev` para migraciones locales
