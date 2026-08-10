# Referidos peer (tenant → tenant) — Etapa 1 — Spec

**Objetivo:** Un corredor (tenant) recibe un código para invitar a otros corredores. Si el invitado activa el **free trial Business** con ese código, el **invitado** recibe **+1 crédito** adicional (sobre la base del trial) y el **invitador** recibe **+1 crédito** en la bolsa de su tenant. Sin reparto por ejecutivo: todo crédito es saldo del tenant.

**Alcance explícito:** No incluye niveles Classic / Gold / Platinum ni payout en dinero. No sustituye el programa **partner** (`ReferralPartner` / comisiones).

---

## 1. Un solo código (canal único, sin importar el origen)

**Regla cerrada:** El usuario ingresa **un único** **código ref.** en el **campo ya existente del free trial** (§1d), o llega precargado vía URL (`?ref=`). **No importa el canal** desde la UX: no hay segunda caja ni partner vs amigo separados.

**Resolución en backend (orden fijo):**

1. Normalizar el string (mismo criterio que hoy para partner).
2. Si coincide con un `ReferralPartner` activo → flujo **partner** (trial extendido, crédito extra partner, `referralPartnerId`, comisiones como hoy). **No** se aplica la lógica de bonos peer (+1 al referente tenant).
3. Si no, si coincide con `Tenant.peerReferralCode` de un tenant elegible → flujo **peer** (bonos §3).
4. Si no → código inválido.

**Colisión de strings:** Al generar `peerReferralCode`, **no** emitir códigos que ya existan como `ReferralPartner.code` activo (así el orden anterior es estable). Si en el futuro hubiera colisión legacy, gana la fila **partner** (paso 2).

**Queda fuera:** combinar beneficios de partner y peer en un mismo alta; un código ⇒ un solo tipo de beneficio.

---

## 1b. Inscripción y una sola vez

- El código se captura en el **free trial** con el **campo que ya existe** (ver §1d), no con un input nuevo. Puede precargarse vía `?ref=` / `sessionStorage` antes de llegar a esa pantalla. No es un ajuste posterior en panel ni un segundo paso opcional meses después.
- **Por cuenta referida, una sola vez:** cada nuevo `Tenant` puede quedar vinculado a **como máximo un** código resuelto (partner **o** peer). Tras asignarse de forma válida, **no** se puede cambiar el código ni “canjear” otro. Misma filosofía que hoy con `referralPartnerId` / `REFERRAL_ALREADY_ASSIGNED`: la atribución es inmutable.
- Los bonos peer (§3) se disparan al **activar** el trial (pago/tarjeta OK), pero la **elección** del código queda fijada en inscripción.

---

## 1c. Cómo lo envía el invitador (partner o peer)

Ainspecciona **no** sustituye el canal humano (email, WhatsApp, Instagram, charla presencial): el **partner** o el **peer** comparten el beneficio; el producto entrega **qué** compartir y asegura que el **mismo mecanismo** sirva para ambos.

### Qué se comparte (etapa 1)


| Entrega                           | Uso                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Enlace canónico** (recomendado) | URL pública con un solo query param, ej. `?ref=CODIGO`, típicamente `…/business/trial/pago?ref=CODIGO`. También **`/business/activar?ref=CODIGO`**: al cargar la página se guarda el código en `sessionStorage` (`trial_checkout_context.partnerCode`) y se limpia la barra de dirección; llega al paso de pago del trial aunque el usuario pase antes por activación (corredores u otro flujo). |
| **Código en texto**               | Mismo string `CODIGO` para pegar en `**#partnerCodeInput`** (`business-trial-pago.html`, §1d) si el referido no entró por link (flyer, oral, captura de pantalla).                                                                                     |


El valor de `CODIGO` es el mismo que resuelve §1 (partner o peer): **no** hay URLs distintas por tipo de invitador.

### Persistencia del `ref` en el funnel

Desde la **primera** carga con `?ref=` hasta **create-preapproval** / alta, el cliente debe conservar el código (p. ej. `sessionStorage` + prellenado del campo) para cumplir §1b sin obligar a reescribirlo en cada paso. Si el usuario borra datos del navegador antes de terminar, puede volver a ingresar el código manualmente una sola vez.

### Dónde lo obtiene cada invitador

- **Peer (tenant):** En la app / dashboard, bloque “Invita a otra corredora”: **Copiar enlace**, **Copiar código** (y opcional texto sugerido para WhatsApp/email con ambos).
- **Partner:** Mismo formato de enlace y código; el código sale de `ReferralPartner` (admin o material que les entreguen). No hace falta login en Ainspecciona para **compartir**; sí para medir comisiones del lado partner (ya existente).

### Fuera de etapa 1

- Envío automático de correo desde Ainspecciona al referido en nombre del partner/peer.
- Shortlinks propios (`ainspecciona.com/r/xxxxx`) salvo que se reutilice un acortador externo pegado al enlace canónico.
- QR generado in-app (opcional rápido: el QR apunta al mismo enlace canónico).

---

## 1d. Campo único en UI (ya implementado en free trial)

**Pantalla principal:** `public/business-trial-pago.html`

- **Label (UI):** «Código ref. (opcional)».
- **Input:** `#partnerCodeInput` (mismo campo para **partner o peer**; la distinción es solo en servidor §1).
- **Validación en cliente:** hoy `POST /api/business/trial/partner-code` — en implementación debe **evolucionar** a la resolución unificada (misma ruta o alias) devolviendo `channel: 'partner' | 'peer'` y metadatos para actualizar badge/bullets.
- **Activación:** el valor se envía en `POST /api/business/trial/create-preapproval` en el cuerpo JSON; **mantener** la clave `partnerCode` por compatibilidad aunque el significado sea **código ref.** genérico.

**Otro punto de captura (mismo contrato):** `public/corredores.html` — modal trial, `#trialPartnerCode`, mismo flujo hacia activación trial.

**No hacer en etapa 1:** agregar un segundo campo en estas pantallas; ampliar solo copy/placeholder si se quiere (ej. mencionar colega corredor además de alianza).

---

## 2. Modelo de datos (propuesta)


| Elemento                                               | Descripción                                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `Tenant.peerReferralCode`                              | String único, normalizado (ej. mayúsculas, charset seguro), índice único. Nullable hasta generación.  |
| Tabla `PeerReferralAttribution` (o nombre equivalente) | Registro idempotente referente → referido; a lo sumo **una** fila por `referredTenantId` (uso único). |


**Campos mínimos sugeridos en `PeerReferralAttribution`:**

- `id` (UUID)
- `referrerTenantId` (FK Tenant)
- `referredTenantId` (FK Tenant, **unique** — un solo referente “ganador” por cuenta referida)
- `peerCodeUsed` (copia normalizada del código, auditoría)
- `trialActivatedAt` (DateTime, cuando se consideró cumplido el evento)
- `creditsGrantedAt` (DateTime nullable, si se separa confirmación de MP)
- `createdAt`

**Generación del código:** Al cumplir condición de negocio (ver §4), si `peerReferralCode` es null, generar código único y persistir. No rotar salvo fraude (proceso admin manual).

---

## 3. Evento que dispara los bonos

**Evento:** Trial Business **activo** en el sentido actual del producto: mismo punto en que hoy se acreditan los créditos del trial en `create-preapproval` (post–preaprobación MP exitosa y transacción que hoy incrementa `TenantCredit`).

**Bonos (etapa 1):**

- **Referido (solo flujo peer):** +1 crédito **adicional** al total base del trial **sin** código partner (p. ej. 14 días / 1 inspección base → se acredita como si fuera 2 inspecciones en ese abono, según implementación). No se suma este +1 peer encima del paquete partner (30 días + bonus partner); ese caso es solo paso 2 de §1.
- **Referente (solo flujo peer):** +1 crédito en `TenantCredit` del `referrerTenantId`.

**Idempotencia:** Una sola fila `PeerReferralAttribution` por `referredTenantId`. Si el webhook o el flujo se re-ejecuta, no duplicar créditos ni atribución.

**Transacciones:** Usar `CreditTransaction` con `type` acorde al enum existente o ampliación mínima (ej. ajuste con descripción fija), y descripciones legibles (“Bono referido peer”, “Bono referente peer”).

---

## 4. Cuándo mostrar / generar el código del invitador

**Decisión actual:** Generar `peerReferralCode` en la **creación del tenant** (o en el primer `GET /api/tenant/me` si faltaba), siempre que `Tenant.status === ACTIVE` y aún no exista código. Así el código y el enlace aparecen en el **dashboard** desde el inicio y se puede viralizar durante el trial; el correo de bienvenida invita a explorar beneficios (SMTP opcional).

Los bonos por referido (§3) siguen disparándose solo cuando el referido completa `create-preapproval` con código peer válido.

**Elegibilidad del código como referente:** Sigue valiendo §5: referente `ACTIVE`; si pasa a `INACTIVE`, el código deja de resolver en UX.

---

## 5. Elegibilidad y antiabuso (mínimo)

- **No auto-referencia:** `referrerTenantId !== referredTenantId`.
- **Código válido (decisión cerrada):** Existe tenant referente con `peerReferralCode` igual al ingresado y `**Tenant.status === ACTIVE`** (enum Prisma `TenantStatus`). Si la corredora está `INACTIVE`, el código **no** es válido (no bonos, mismo tratamiento que código inexistente en UX).
- **Referido único:** `referredTenantId` sin fila previa en `PeerReferralAttribution`.
- **Alineado con trial:** El referido debe pasar `evaluateTrialEligibility` (RUT, correo corporativo, no `TRIAL_KEY_ALREADY_USED`, etc.) como hoy; el código peer no salta esas reglas.
- **Sin tope al referente (decisión cerrada):** Cada referido que active trial con su código ref. peer genera **+1** crédito al referente, **sin límite** por mes ni por año en etapa 1. Objetivo: maximizar viralidad; el costo crece solo con trials efectivamente activados (aceptar riesgo operativo y monitoreo manual si hiciera falta).

---

## 6. API y UX (checklist)

- `GET` o inclusión en payload de sesión tenant: exponer `peerReferralCode`, **enlace canónico** completo y texto para copiar (ver §1c).
- **Validación unificada:** evolucionar `POST /api/business/trial/partner-code` (o renombrar con redirect 307 si se prefiere otro path) para resolver §1 y devolver `{ valid, channel: 'partner' | 'peer', durationDays?, totalTrialCredits?, partnerName?, peerReferrerLabel?, … }` sin datos sensibles. Actualizar `business-trial-pago.html` (y modal corredores) para pintar hints según `channel`.
- **UX:** no nuevos inputs; reutilizar estrictamente §1d. Tras `create-preapproval` exitoso, atribución inmutable §1b.
- Copy: “Los créditos no caducan” solo si sigue siendo cierto; hoy el saldo global no tiene vencimiento en BD.

---

## 7. Admin (opcional etapa 1)

- Listar últimas atribuciones peer y buscar por código o tenant.
- Desactivar código (flag en tenant o anular código y dejar histórico en atribuciones).

---

## 8. Criterios de aceptación (resumen)

1. Tenant elegible obtiene código único según §4.
2. Referido con un código válido (resuelto a partner o peer según §1) activa trial con el beneficio que corresponda a ese canal; en peer, bonos §3.
3. Referente recibe +1 crédito una sola vez por referido.
4. Reintentos / doble llamada no duplican bonos.
5. Código capturado solo vía campo existente del free trial (§1d); imposible reasignar otro código al mismo tenant referido.
6. Documento `PARTNERS.md` sigue describiendo solo partners; este archivo describe solo peer.

---

**Última revisión:** abril 2026 (borrador de implementación).