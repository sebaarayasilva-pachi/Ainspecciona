# Condiciones comerciales — Programa de embajadores Ainspecciona

Documento de referencia para el programa de **embajadores** (capa de referidos con personas físicas o referentes que entregan un **código** a corredoras). Complementa otros esquemas (partners formales, referidos peer entre corredoras) sin sustituirlos.

---

## 1. Objeto

Los embajadores difunden Ainspecciona entre corredoras potenciales. Quien se inscribe como **corredora** (tenant) usando el **código del embajador** queda asociado a ese embajador para efectos del programa, de acuerdo con las reglas siguientes.

---

## 2. Código embajador

- Cada embajador registrado en el sistema recibe un **código único** en minúsculas, generado a partir del **primer nombre** y un correlativo (por ejemplo `maria1`, `maria2`).
- El código se ingresa en el flujo de **alta / trial Business** (misma experiencia que el código partner o peer, con prioridad de validación: **partner → peer → embajador**).
- Un mismo tenant solo puede quedar atribuido a **un** tipo de referido de estos programas (no se superponen atribuciones).

---

## 3. Base para comisión

### 3.1 Monto

- La comisión se calcula sobre el **valor neto liquidado por Mercado Pago** asociado al pago (**PAGADO** / acreditado a cuenta), no sobre el precio de lista antes de fees de pasarela.
- En la práctica se usa el neto que informa MP (`net_received_amount`, o equivalentes de respaldo cuando no exista).

### 3.2 Alcance de pagos

Cuentan **solo los pagos originados desde el panel de la corredora** (checkout del **dashboard**): por ejemplo planes de créditos, Business, Corporate, suscripciones asociadas al tenant, productos **dashboard** (Standard / Corporate) e **inspección presencial** pagada desde el panel.

No forman parte de esta base los flujos **sin tenant** (por ejemplo Starter público sin corredora), salvo lo que se defina explícitamente en otro documento.

### 3.3 Devoluciones

- Las **devoluciones** imputadas a un **mes calendario** se **restan** de la base de comisión de ese mismo mes (misma lógica de imputación por fecha de acreditación / movimiento).

---

## 4. Porcentaje y período

- **Porcentaje de comisión:** **30%** del neto elegible descrito en la sección 3 (por defecto en producto; configurable vía entorno `AMBASSADOR_COMMISSION_RATE`).
- **Duración:** la comisión aplica **hasta tres meses calendario** contados desde el **mes del primer pago acreditado** del referido bajo ese vínculo (meses sucesivos dentro de esa ventana; fuera de ella no se generan nuevas comisiones por ese referido).

---

## 5. Liquidación y pago al embajador

- La liquidación se entiende **por mes calendario** (corte mensual), sumando líneas de comisión del periodo.
- El **pago al embajador** es **después de impuestos** según el instrumento vigente:
  - **Boleta de honorarios** (retenciones y reglas aplicables), o  
  - **Factura** (IVA u otro según corresponda).

Es decir: el **30%** sobre el neto del mes es la **base comisión bruta**; el **valor a transferir** al embajador es el **neto** una vez aplicada la **retención o carga tributaria** que corresponda en cada caso. Ese detalle operativo y contable **no** se calcula automáticamente en el panel de liquidación; debe ser aplicado por **contabilidad / administración** al momento de pagar.

---

## 6. Convivencia con otros programas

- **Partners** (tabla de partners) y **referidos peer** (código de otra corredora) tienen **prioridad** de validación sobre el código embajador en el mismo campo de código.
- Las políticas comerciales (bonos de trial, duraciones, etc.) de partners o peer siguen sus propias reglas; el embajador no las sustituye.

---

## 7. Uso interno del sistema

- **Alta de embajadores** y **liquidación mensual agregada** por mes están disponibles en **Admin → Embajadores**.
- Las líneas de comisión se registran de forma **idempotente** por pago Mercado Pago para evitar duplicados.

---

## 8. Vigencia y cambios

- Las condiciones de mercado pueden actualizarse por comunicación formal a embajadores activos y por versión de este documento.
- Cualquier cambio de porcentaje, duración o alcance de pagos debe reflejarse en **configuración de producto** y, cuando aplique, en **bases legales** o anexos firmados.

---

*Última actualización alineada al desarrollo del programa embajadores en el repositorio (comisión 30%, neto MP, mes calendario, devoluciones del mes, ventana tres meses, liquidación mensual en admin).*
