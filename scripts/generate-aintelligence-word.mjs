/**
 * Genera docs/aintelligence/AINTELLIGENCE_RAG_PROYECTO.docx
 * Uso (desde ainspecta_web): node scripts/generate-aintelligence-word.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle
} from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outPath = path.join(repoRoot, 'docs', 'aintelligence', 'AINTELLIGENCE_RAG_PROYECTO.docx');

function h1(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 } });
}
function h2(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 160 } });
}
function h3(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 120 } });
}
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, ...opts })]
  });
}
function bullet(text) {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 80 } });
}
function boldLine(label, value) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: label, bold: true }), new TextRun({ text: value })]
  });
}

function simpleTable(headers, rows) {
  const headerRow = new TableRow({
    children: headers.map(
      (h) =>
        new TableCell({
          width: { size: 100 / headers.length, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })]
        })
    )
  });
  const bodyRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              width: { size: 100 / headers.length, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ text: String(cell) })]
            })
        )
      })
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
      insideVertical: { style: BorderStyle.SINGLE, size: 1 }
    },
    rows: [headerRow, ...bodyRows]
  });
}

const doc = new Document({
  creator: 'Ainspecta',
  title: 'Aintelligence y RAG de Hallazgos',
  description: 'Proyecto Aintelligence — capa de análisis y aprendizaje de hallazgos visuales',
  sections: [
    {
      properties: {},
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [
            new TextRun({ text: 'Ainspecta', bold: true, size: 36, color: '1E3A5F' }),
            new TextRun({ text: '\n', break: 1 }),
            new TextRun({ text: 'Aintelligence + RAG de Hallazgos', bold: true, size: 28 }),
            new TextRun({ text: '\n', break: 1 }),
            new TextRun({ text: 'Documento de proyecto', size: 22, color: '666666' })
          ]
        }),
        p('Versión: 1.0 — Mayo 2026'),
        p('Repositorio: ainspecta_web (Ainspecta)'),
        p('Productos integrados: Ainspecta Inspecciones · PropertyCheck · Postventa'),

        h1('1. Resumen ejecutivo'),
        p(
          'Aintelligence es la capa transversal de inteligencia visual de Ainspecta. Unifica el análisis de hallazgos en fotos de inspección bajo un mismo criterio técnico (KPI, severidad, señales), aprende de correcciones humanas verificadas y mejora con el tiempo mediante una Knowledge Base (KB) reforzada con RAG vectorial.'
        ),
        p(
          'No es un producto aparte ni el agente conversacional Patricio (ElevenLabs). Es el motor que alimenta el análisis en los tres canales operativos y acumula conocimiento pericial curado por el equipo.'
        ),
        boldLine('Meta operativa: ', 'Minimizar la capa humana — no eliminarla — automatizando el camino feliz y reservando revisión solo para excepciones de baja confianza o alto riesgo.'),

        h1('2. Problema que resuelve'),
        bullet('Fragmentación: inspecciones, PropertyCheck y postventa usaban pipelines distintos sin aprendizaje compartido.'),
        bullet('Errores repetidos: la IA confundía condensación con filtración, sombras con humedad, suciedad con corrosión.'),
        bullet('Conocimiento atrapado en correcciones manuales sin flujo sistemático hacia el prompt.'),
        bullet('Sin métrica de mejora: no había visibilidad de exactitud del análisis en el tiempo.'),

        h1('3. Qué es y qué NO es'),
        h2('3.1 Aintelligence SÍ es'),
        bullet('Motor de visión unificado (OpenAI + reglas + few-shot + RAG).'),
        bullet('Knowledge Base de hallazgos aprobados por admin.'),
        bullet('Ingesta de feedback desde tres fuentes operativas.'),
        bullet('Métricas de exactitud por informe en dashboard admin.'),
        h2('3.2 Aintelligence NO es'),
        bullet('RAG conversacional de ElevenLabs (KB de propiedades/diálogo Patricio — desactivado).'),
        bullet('Fine-tuning del modelo base GPT.'),
        bullet('Catálogo de propiedades ni CRM.'),
        bullet('Aprendizaje automático sin revisión humana en producción.'),

        h1('4. Arquitectura'),
        h2('4.1 Componentes'),
        simpleTable(
          ['Componente', 'Rol'],
          [
            ['Aintelligence Engine', 'Prompts, schema JSON, KPI, severidad, visión OpenAI'],
            ['Aintelligence KB', 'Ejemplos aprobados, anti-ejemplos, embeddings (fase RAG)'],
            ['Aintelligence Ingest', 'Recibe feedback: Ainspecta, PropertyCheck, Postventa'],
            ['Aintelligence Admin', 'Cola de borradores, aprobación, biblioteca de hallazgos']
          ]
        ),
        p(' '),
        h2('4.2 Flujo de datos'),
        p('Fuentes operativas → Ingesta (borrador) → Revisión admin → KB aprobada → Engine (próximo análisis).'),
        p('Regla de oro: la IA no aprende en caliente. Solo entra a la KB lo aprobado por un humano con rol admin.'),

        h1('5. Las tres fuentes de alimentación'),
        simpleTable(
          ['Fuente', 'Datos', 'Trigger de aprendizaje', 'Estado consumo KB'],
          [
            ['Ainspecta Inspecciones', 'Case, Slot, Photo, analysisDebug', 'Reanálisis informe (?corr=1)', 'Few-shot activo'],
            ['PropertyCheck', 'Batch fotos, planItemId, parsed', 'Webhook feedback operador', 'Few-shot activo'],
            ['Postventa', 'PvTicket, slots captura, informe IA', 'Revisión admin + cierre', 'Pendiente']
          ]
        ),
        p(' '),
        h2('5.1 Ainspecta'),
        p('Análisis en Slot.analysisDebug. Corrección vía reanálisis en report.html (modo admin). Biblioteca manual en Admin → Aintelligence.'),
        h2('5.2 PropertyCheck'),
        p('API stateless POST /propertycheck/analyze. Feedback POST /propertycheck/feedback con aiSnapshot + humanLabel. Imagen persistida en storage Ainspecta.'),
        h2('5.3 Postventa'),
        p('Pipeline separado: analyzeTicket.js, analyzeSanitarySlotQuick.js. Mapeo categoría postventa → KPI hub. RAG ElevenLabs (Patricio) permanece fuera de Aintelligence.'),

        h1('6. RAG de hallazgos visuales'),
        h2('6.1 Definición'),
        p(
          'Recuperación de ejemplos similares (imagen + texto + KPI) para inyectar en el prompt de visión. Mejora exactitud en patrones visualmente parecidos. No entrena pesos del modelo.'
        ),
        h2('6.2 Estado actual'),
        bullet('Few-shot textual: aiFindingExamples en score-config (AppSetting).'),
        bullet('formatAiFindingExamplesBlock() — hasta ~20 criterios por KPI en prompt.'),
        bullet('Tabla ai_feedback + cola admin + aprobación → biblioteca.'),
        h2('6.3 Fases RAG'),
        bullet('Fase 3: Embeddings por imagen + señal + KPI.'),
        bullet('Fase 4: Retrieval top-K antes de cada análisis.'),
        bullet('Fase 5: Bucle cerrado con métricas de corrección por KPI.'),

        h1('7. Entidades de datos (implementadas)'),
        h2('7.1 ai_feedback'),
        p('Borradores de aprendizaje. Fuente: PROPERTYCHECK | AINSPECTA | POSTVENTA. Estados: draft, pending_review, approved, rejected.'),
        h2('7.2 ai_report_correction'),
        p('Métricas de exactitud. Fórmula: (slotsTotal − slotsCorrected) / slotsTotal × 100. Informe sin corrección = 100%.'),

        h1('8. Contrato PropertyCheck Ingest'),
        boldLine('Endpoint: ', 'POST /api/v0/tenants/:tenantId/propertycheck/feedback'),
        boldLine('Auth: ', 'x-propertycheck-secret'),
        p('Idempotencia: feedbackId. Tipos: correction, confirmation, anti_example, slot_mismatch, insufficient_evidence.'),
        p('Batch: POST .../feedback/batch (máx. 20). Ver PROPERTYCHECK_FEEDBACK_CONTRACT.md.'),

        h1('9. Admin y Dashboard'),
        bullet('Admin → Aintelligence: cola feedback, aprobar/rechazar, biblioteca hallazgos, prompts KPI.'),
        bullet('Dashboard → Exactitud Aintelligence: gráfico línea + resumen periodo.'),
        boldLine('API métricas: ', 'GET /api/admin/analytics/analysis-accuracy?days=30'),

        h1('10. Automatización y exactitud'),
        p('Objetivo: humano solo en excepciones (L1–L2), no eliminación total (L3 no recomendable en garantías/postventa).'),
        p('Política propuesta: auto-aprobación si confidence ≥ 0.90, matches_slot, KPI bajo riesgo. Revisión obligatoria en humedad, electricidad, postventa+garantía.'),
        p('La línea de exactitud en dashboard mide progreso hacia menos correcciones por informe.'),

        h1('11. Roadmap'),
        simpleTable(
          ['Fase', 'Entregable', 'Estado'],
          [
            ['F0', 'Few-shot + PropertyCheck analyze', 'Hecho'],
            ['F1', 'Webhook feedback + admin cola', 'Hecho'],
            ['F2', 'Métricas exactitud + 100% sin corrección', 'Hecho'],
            ['F3', 'Ingesta auto post-reanálisis Ainspecta', 'Pendiente'],
            ['F4', 'Postventa → Engine + ingest', 'Pendiente'],
            ['F5', 'Embeddings + RAG retrieval', 'Pendiente'],
            ['F6', 'Auto-aprobación por confianza', 'Pendiente']
          ]
        ),
        p(' '),

        h1('12. Estructura código'),
        p('src/aintelligence/ingest/, admin/, metrics/, routes/admin.js'),
        p('src/propertyCheck/propertyCheckFeedbackV0.js'),
        p('src/scoring/scoringV2_2.js → formatAiFindingExamplesBlock()'),

        h1('13. Glosario'),
        bullet('KPI: HUMEDAD, SANITARIOS, PISOS, ELECTRICIDAD, etc.'),
        bullet('Anti-ejemplo: falso positivo documentado para no repetir error.'),
        bullet('Few-shot: reglas en prompt sin búsqueda vectorial.'),
        bullet('RAG: retrieval por similitud antes del análisis.'),

        h1('14. Referencias'),
        bullet('docs/aintelligence/PROPERTYCHECK_FEEDBACK_CONTRACT.md'),
        bullet('docs/postventa/PROMPT_AGENTE_POSTVENTA.md'),

        new Paragraph({
          spacing: { before: 400 },
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '— Fin del documento —', italics: true, color: '888888' })]
        })
      ]
    }
  ]
});

const buffer = await Packer.toBuffer(doc);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buffer);
console.log('Generado:', outPath);
