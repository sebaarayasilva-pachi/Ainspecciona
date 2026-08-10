# Plan de trabajo – Ainspecciona

**Última revisión:** marzo 2026.

---

## Resumen (pendiente vs hecho)

| Estado | Tema | Notas |
|--------|------|--------|
| ✅ Hecho | Página Cómo funciona | `public/como-funciona.html` |
| ✅ Hecho | Headers consistentes | `public/assets/header.css` + snippet en páginas públicas |
| ✅ Hecho | Créditos y cuenta corriente tenant | Prisma `TenantCredit` / `CreditTransaction`, API, MP webhook, UI en `tenant.html` |
| 🔄 En curso | **Apps móviles en producción** | Android en Play (periodo de espera típico ~14 días); iOS: cuenta Apple Developer + build EAS + TestFlight/App Store |
| ⏸️ Postergado | Facturación electrónica SII | Solo después de Android **e** iOS en producción (proveedor tipo SimpleFactura) |
| ⏸️ En pausa | Referencias CDT / manuales en análisis | Ver `docs/ANALISIS_REFERENCIAS_CDT_MANUAL_MANTENCION.md` |

---

## Prioridades actuales

1. **Cerrar iOS:** Apple Developer Program → App ID `com.ainspecta.capture` → App Store Connect → `eas build --platform ios` → `eas submit` → TestFlight y prueba end-to-end contra API producción. Guía: `mobile_capture_app/docs/ios-prerequisites.md`.
2. **Android:** Completar periodo de revisión de Play Console; revisar correo de Google por requisitos adicionales.
3. **Tras ambas tiendas en producción:** contratar e integrar facturación electrónica; comprobante PDF sigue vigente hasta entonces.

---

## 1. Página Cómo funciona ✅ COMPLETADO

**Archivo:** `public/como-funciona.html`

- [x] Hero, CTAs, verde #35D07F, footer CTA, responsive móvil

---

## 2. Créditos y cuenta corriente en tenants ✅ COMPLETADO

**Implementado en código (referencia):**

- **Schema:** `TenantCredit`, `CreditTransaction`, enum `CreditTransactionType` en `prisma/schema.prisma`.
- **API:** `GET /api/tenant/credits`, `GET /api/tenant/credits/transactions`; consumo al crear inspección; acreditación vía webhook MercadoPago (planes y packs `credits-*`).
- **UI:** badge y sección «Cuenta corriente» en `public/tenant.html`, flujo compra `tenant-comprar-creditos.html`, aviso si no hay créditos.

*(El resumen antiguo que decía «no hay modelos en Prisma» estaba desactualizado.)*

---

## 3. Headers consistentes ✅ COMPLETADO

`public/assets/header.css` y variantes; aplicado en páginas públicas principales.

---

## 4. Apps móviles → producción 🔄 EN CURSO

**Repo:** `mobile_capture_app/` · **Bundle / package:** `com.ainspecta.capture` · **API prod:** `app.json` → `extra.apiBaseUrl` (`https://ainspecciona.com`).

| Plataforma | Estado sugerido | Siguiente paso |
|------------|-----------------|----------------|
| Android | En Google Play, esperando ventana de publicación / revisión | Monitorear Play Console; piloto según `docs/pilot-release-android.md` |
| iOS | Pendiente publicación | Pago Apple Developer → identificador + app en App Store Connect → EAS build/submit → incrementar `ios.buildNumber` si hace falta |

**Opcional (calidad):** conectar errores de app a Sentry/Crashlytics (`EXPO_PUBLIC_SENTRY_DSN`).

---

## Facturación electrónica ⏸️ POSTERGADO

**Plan:** Integrar con **SimpleFactura** u otro proveedor para emitir factura electrónica SII.

**Criterio para pagar e implementar:** cuando **Android e iOS estén en producción** (tiendas públicas). Hasta entonces: costo fijo y complejidad fuera de foco.

**Hoy:** comprobante PDF (`src/pdf/receiptPdf.js`); facturación manual portal SII si aplica.

**Datos empresa (operativo):** RUT definitivo **78.362.551-2** (Ainspecciona SpA) alineado con términos/privacidad; cuenta corriente **BCI** — no versionar números de cuenta en el repo; usar `.env` o proceso interno cuando se expongan datos de transferencia.

---

## Notas técnicas

- Deploy: `DEPLOY_GCP.md`
- MercadoPago: `MERCADOPAGO_ACCESS_TOKEN` en `.env`
- Prisma: `npx prisma migrate dev` (local) / `migrate deploy` (prod)
- Partners / comisiones: `docs/PARTNERS.md`

---

## Stack raíz `client/` + `server/` (React + Express)

No es el producto en producción: el MVP vive en **`ainspecta_web`**. El monorepo antiguo queda como referencia o futura separación front/back; no figura en prioridades actuales.
