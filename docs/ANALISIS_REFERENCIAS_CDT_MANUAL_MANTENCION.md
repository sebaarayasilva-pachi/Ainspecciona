# Análisis: referencias a Manual de Tolerancias (CDT) y Manual de Uso y Mantención (CChC/CDT)

**Estado:** *En pausa (marzo 2026).* No se prioriza ni se implementa esta línea por ahora. El archivo queda como registro por si se retoma más adelante.

**Contexto:** Evaluar incorporar en Ainspecciona, por slot o por informe, vínculos o texto de apoyo al *Manual de Tolerancias para Edificaciones* (CDT Nº 42, 3ª ed. 2018) y al *Manual de Uso y Mantención de la Vivienda* (versión 2022), sin convertir el producto en certificador normativo.

**Fecha del documento:** marzo 2026.

---

## 0. Crítica de producto: ¿solo bibliografía?

Tiene poco sentido para el usuario final una funcionalidad cuyo resultado sea **“te dejamos el link al CDT / al manual de uso”**. Eso es **bibliográfico**: no mejora la decisión de compra, no ordena prioridades de reparación y no sustituye lo que ya hace una búsqueda o un PDF guardado en el escritorio.

**Conclusión honesta:** si no se acompaña de algo **accionable** (ver §8), el costo de UI, mantenimiento de mapeos y expectativas mal entendidas **no se compensa** con el beneficio. En ese escenario, **no implementar** es razonable.

---

## 1. Objetivo del análisis

Definir si conviene implementar una capa de **referencias técnicas** alineada a esos documentos, qué trade-offs implica y **qué resultado** debería ver el usuario en el análisis o en el informe.

---

## 2. Documentos de referencia (rol de cada uno)

| Documento | Enfoque principal | Uso típico en inspección |
|-----------|-------------------|-------------------------|
| Manual de Tolerancias (CDT 2018) | Desviaciones admisibles en ejecución (mm, condiciones, partidas) | Recepción de obra, conformidad constructiva, negociación oferente–comprador |
| Manual de Uso y Mantención (2022) | Uso correcto, periodicidad de mantención, vida útil | Post-entrega, educación del habitante, espacios comunes |

No son intercambiables: mezclarlos en un mismo “veredicto” sin criterio confunde **defecto de ejecución** con **desgaste o falta de mantención**.

---

## 3. Pros

1. **Alineación sectorial:** CDT y CChC son referencias habituales en construcción y postventa en Chile; el informe gana lenguaje reconocible por corredores, constructores y compradores.
2. **Valor percibido:** El usuario entiende que el análisis no es “opinión aislada” sino **orientado a fuentes públicas y consolidadas**.
3. **Bajo impacto en rendimiento** si la implementación es **post-IA** (mapeo `slotCode` → referencias) sin segundo llamado al modelo y sin prompts largos.
4. **Bajo costo marginal:** JSON o tabla de mapeo, sin licenciar contenido completo del PDF.
5. **Diferenciación:** Pocos productos de captura ligera explicitan **dónde profundizar** según tipo de partida.
6. **Escalabilidad:** Se puede empezar con **10–20 slots** y ampliar por KPI o por `slotCode`.

---

## 4. Contras y riesgos

1. **Expectativas indebidas:** Si el UI o el copy dice “cumple CDT” o “no cumple tolerancias” **solo con foto**, se genera **riesgo reputacional y de reclamos** (la foto no mide en general mm ni condiciones de ensayo del manual).
2. **Propiedad intelectual:** Los manuales son obras de CChC/CDT. **No** reproducir tablas extensas ni fichas completas sin criterio legal; preferir **citas breves**, **enlaces oficiales** y **texto redactado por Ainspecciona**.
3. **Confusión técnica:** Usuarios finales pueden interpretar la referencia como **obligación legal única**, ignorando planos, especificaciones técnicas de venta y normativa obligatoria vigente (NCh, OGUC, etc.).
4. **Sobrecarga de UI:** Demasiadas referencias por slot pueden **ensuciar** el informe; hace falta diseño (acordeón, “Ver referencias”, una línea por defecto).
5. **Mantenimiento:** Cambios de edición del CDT o del manual de uso exigen **revisar mapeos y textos**; conviene versionar la tabla (`referenceGuideVersion`).

---

## 5. Impacto en rendimiento y costo (resumen)

| Enfoque | Impacto en latencia | Impacto en costo API |
|---------|---------------------|----------------------|
| Referencias solo en backend después del análisis (sin tocar prompt) | Despreciable | Nulo |
| Párrafo corto fijo en el prompt por slot | Bajo | Bajo (más tokens entrada) |
| Segunda llamada a la IA “validar CDT” | Alto (≈ ×2 en ese paso) | Alto |
| RAG con muchos chunks por foto | Variable; puede ser alto | Alto |

**Conclusión operativa:** el modelo recomendado para no relentizar es **capa de referencias sin inflar el prompt** (o con un bloque mínimo y estable).

---

## 6. Resultado esperado en el análisis (qué debería ver el usuario)

> Si el alcance se limita a lo siguiente **sin** acciones concretas (§8), el resultado percibido sigue siendo **bibliográfico**; ver §0.

### 6.1 Lo que **sí** se promete (modelo “referencias” — débil en valor solo)

- Por cada slot (o por KPI agregado en informe), un bloque **“Referencias técnicas (orientativas)”** que indique, por ejemplo:
  - *Manual de Tolerancias para Edificaciones (CDT Nº 42)* — temas relacionados: *revestimientos cerámicos / ventanas / tabiques* (según mapeo).
  - *Manual de Uso y Mantención de la Vivienda (CChC/CDT, 2022)* — secciones relacionadas: *instalaciones / cubiertas / mantención periódica* (según mapeo).
- Enlace o indicación de **descarga oficial** (CDT / CChC) cuando corresponda.
- **Disclaimer** claro: *Las referencias no reemplazan el proyecto, el contrato ni la normativa obligatoria; no constituyen certificación de conformidad numérica.*

### 6.2 Lo que **no** se promete (sin mediciones ni documento contractual)

- “**Cumple** el Manual de Tolerancias” o “**Incumple** tolerancia X mm” basado **solo** en imagen.
- Sustituir el dictamen de un **perito** o inspector con instrumentos.

### 6.3 Comportamiento opcional avanzado (futuro)

- Si existiera **entrada de medición** (valor numérico + tipo de partida), reglas explícitas podrían marcar **“posible no conformidad respecto a referencia CDT”** con trazabilidad del umbral usado (siempre con leyenda de fuente y versión).

---

## 7. Recomendación final

| Decisión | Implementar |
|----------|-------------|
| Capa **solo bibliográfica** (links + “ver manual” por slot, sin más) | **No** por defecto: poco valor vs esfuerzo y ruido en el informe |
| Bloque **bibliográfico mínimo** en **anexo fijo** del informe (una página “Fuentes sectoriales”) | **Opcional** si un canal B2B (corredora, constructora) lo pide explícitamente para **marca / seriedad**, no como feature central |
| “Certificación” automática contra tolerancias **solo con foto** | **No** |
| Copiar fichas completas del PDF en la app | **No** (salvo asesoría legal / licencia) |

**Veredicto:** **No** priorizar una integración “inteligente” que en la práctica sea **solo bibliografía**. Si se avanza, que sea **junto a** entregables que el usuario use el mismo día (§8) o quedarse en un **anexo único** al final del PDF, no por cada slot.

---

## 8. Qué dejaría de ser “solo bibliográfico” (direcciones con sentido)

Ejemplos de valor real (cada uno exige alcance y, a veces, legal/contenido propio):

1. **Checklist de campo** por tipo de partida (“qué mirar / qué fotografiar”) alineado a criterios habituales de recepción, **sin** afirmar cumplimiento CDT.
2. **Entrada de medición** (regla, escuadra, nivel) + reglas versionadas → comparación explícita con **umbrales** citados (producto distinto; más trabajo y riesgo).
3. **Texto accionable** en el informe: *“En negociación típica se suele pedir rectificación cuando…”* redactado por Ainspecciona, **sin** copiar tablas del CDT.
4. **Plantilla de comunicación** al vendedor (bullet points desde hallazgos), sin depender del manual como “decoración”.

Hasta que exista al menos una de esas capas, **los manuales como referencia inline por slot** siguen siendo en esencia **bibliografía**.

---

## 9. Próximos pasos sugeridos (producto / ingeniería)

1. **Decidir:** ¿descartar mapeo slot → manuales o dejar **solo** un anexo genérico “Fuentes recomendadas” en el informe?
2. Si se quiere valor: elegir **un** entregable accionable (p. ej. checklist o plantilla de carta) y medir uso antes de ampliar.
3. Si no hay presupuesto para lo anterior: **no** abrir JSON de mapeo ni líneas extra en la API solo por enlaces.

---

*Documento interno de producto. No constituye asesoría legal; revisar textos públicos con abogado antes de publicación masiva.*
