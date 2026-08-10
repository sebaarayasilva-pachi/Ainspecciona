# Programa de códigos partner (Free Trial + comisiones)

## Resumen

- Los tenants pueden ingresar un **código ref.** al activar el Free Trial Business (modal en corredores, página `/business/trial/pago`, o `?ref=CODIGO` en la URL de pago del trial).
- Con código **válido y activo** en `ReferralPartner`: trial de **30 días** (vs 14 por defecto) y **1 crédito extra** de inspección real (además de `TRIAL_INITIAL_REAL_INSPECTIONS`).
- MercadoPago recibe el `free_trial` en días alineado con la BD (`trialEndsAt`).
- Tras el trial, cada pago aprobado vía webhook (suscripción mensual Business y compras de créditos `business`, `corporate`, `credits-*`) genera un registro en `PartnerCommissionAccrual` con **15%** del monto bruto CLP (configurable por partner).

**Peer (corredor → corredor):** el mismo campo «código ref.» en el trial. Si el texto coincide primero con un partner activo, aplican las reglas de arriba. Si no, y coincide con `Tenant.peerReferralCode` de otra corredora en estado **ACTIVE**, el trial sigue siendo **14 días** con **+1 crédito** extra al referido y **+1** al referente (`PeerReferralAttribution`). El código peer se genera al crear el tenant (dashboard + email opcional). Detalle: `docs/REFERRALS_PEER_ETAPA1.md`.

## Variables de entorno (opcional)

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PARTNER_TRIAL_DURATION_DAYS` | 30 | Días de trial con código partner |
| `PARTNER_TRIAL_BONUS_CREDITS` | 1 | Créditos extra con código |
| `TRIAL_DURATION_DAYS` | 14 | Trial sin código |
| `TRIAL_INITIAL_REAL_INSPECTIONS` | 1 | Inspecciones base del trial |
| `PEER_TRIAL_BONUS_CREDITS` | 1 | Crédito extra referido + crédito al referente (peer) |

## Migración

Aplicar migraciones Prisma / SQL (partners + peer):

`prisma/migrations/20260319120000_referral_partners_commission/migration.sql`  
`prisma/migrations/20260403120000_peer_referral/migration.sql`

## Partner de prueba (SQL)

Tras migrar, puedes ejecutar el archivo de ejemplo:

`prisma/seed-referral-partner-example.sql`

```bash
npx prisma db execute --file prisma/seed-referral-partner-example.sql
```

Código de ejemplo: **DEMO2026** (cámbialo o desactiva el partner en producción).

## API Admin (misma protección que el resto de `/api/admin/*`)

- `GET /api/admin/referral-partners` — listar partners
- `POST /api/admin/referral-partners` — crear `{ code, name, type?, contactEmail?, payoutJson?, commissionRate?, active? }`
- `PUT /api/admin/referral-partners/:partnerId` — actualizar campos parciales
- `GET /api/admin/referral-partners/commissions?partnerId=` — últimas 500 liquidaciones (estado `ACCRUED` hasta marcar pago manual)

## API pública (trial)

- `POST /api/business/trial/partner-code` — `{ code }` → validación y metadatos (sin datos sensibles)
- `POST /api/business/trial/create-preapproval` — `{ tenantId, partnerCode? }`

## Comisiones

- Origen: webhook MercadoPago y verificación manual `verify-payment` para compras de créditos.
- Monto bruto: `payment.transaction_amount` de la API de pagos; si falta, se usa tabla de precios alineada con preferencias (`BUSINESS_PRICE_CLP`, planes fijos).
- Idempotencia: `mercadopagoPaymentId` único en `PartnerCommissionAccrual`.
- Liquidación a partners: manual (exportar accruals); marcar `PAID` puede añadirse después.

## Enlaces con código

Ejemplo: `https://tu-dominio/business/trial/pago?ref=DEMO2026` (requiere sesión `trial_checkout_tenant_id` en `sessionStorage`).
