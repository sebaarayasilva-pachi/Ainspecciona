# Capa de severidad en captura

Resumen de cómo se asigna y usa la severidad durante la captura de fotos y en el reporte.

## Flujo al subir una foto

1. **Validación de calidad** (`src/photoQuality/validatePhoto.js`)
   - Si la foto no cumple: rechazada (usuario debe repetir).
   - Cada problema tiene `severity`: `low` | `medium` | `high`.
   - Códigos: `PHOTO_TOO_SMALL` (medium), `PHOTO_TOO_BLURRY` (high), `PHOTO_TOO_DARK` (medium), `PHOTO_TOO_BRIGHT` (medium), etc.
   - Si pasa: devuelve `code: 'OK'`, `severity: 'low'`.

2. **Análisis V1** (`server.js` → `analyzeImageBufferV1`)
   - Solo revisa tamaño mínimo (640×480) y luminancia (no demasiado oscuro).
   - Si pasa: `code: 'OK'`, `severity: 'low'`.
   - Si no: `PHOTO_TOO_SMALL` o `PHOTO_TOO_DARK`, `severity: 'medium'`.
   - **No** analiza contenido (humedad, grietas, etc.); eso lo hace OpenAI después.

3. **Validación de correspondencia al slot** (`validateSlotMatchWithOpenAI`)
   - Si la foto no coincide con el slot esperado: `code: 'SLOT_MISMATCH'`, `severity: 'medium'`.
   - La foto se rechaza y el usuario debe repetir con la foto correcta.

4. **Guardado en el slot**
   - Se guardan: `analysisCode`, `analysisSeverity`, `analysisMessage`, `analysisDebug`.
   - Origen: resultado de calidad + V1 + slot match (capa de **captura**).

5. **Análisis OpenAI en background** (`queueOpenAiSlotAnalysis`)
   - Se ejecuta después, sin bloquear al usuario.
   - Cuando termina, **sobrescribe** el slot con: `analysisCode`, `analysisSeverity`, `analysisMessage`, `analysisDebug` (incl. `openai.parsed` con `description`, `kpi_analysis`, `final_severity`, `score_penalty_applied`).
   - Esta es la **capa de severidad del informe** (por contenido técnico).

## Uso en el reporte (`getCaseSummary`)

- **effectiveSeverity**: si el slot tiene código de calidad u omitted → `null`; si no → `s.analysisSeverity` (puede venir de **captura** si OpenAI no ha corrido, o de **OpenAI** si ya actualizó el slot).
- **scorePenaltyApplied**:
  1. Primero `analysisDebug?.openai?.parsed?.score_penalty_applied` (OpenAI).
  2. Si no, `analysisDebug?.scorePenaltyApplied`.
  3. Si no, se **calcula** con `effectiveSeverity` + `scoreConfig.kpis[kpiKey]` (ahí se usa la severidad de **captura** cuando no hay análisis OpenAI).

Por tanto: si un slot no llegó a ser analizado por OpenAI, el impacto en score del reporte sale de la **severidad de captura** (V1/calidad/slot match) y del `scoreConfig.kpis` del KPI asignado a ese slot.

## Resumen

| Origen              | Severidad típica | Cuándo se usa en el reporte      |
|---------------------|------------------|-----------------------------------|
| Calidad (validatePhoto) | medium / high   | Solo si la foto fue rechazada    |
| V1 (analyzeImageBufferV1) | low (OK) / medium (tamaño/oscuro) | Si OpenAI no ha corrido |
| Slot match         | medium           | Si la foto fue rechazada por no coincidir |
| OpenAI (queueOpenAiSlotAnalysis) | low/medium/high/none | Cuando el análisis en background terminó y actualizó el slot |

La capa de severidad en **captura** no asigna severidad por contenido técnico (grietas, humedad, etc.); solo por calidad de imagen y correspondencia al slot. La severidad por **contenido** la asigna únicamente el análisis OpenAI.
