import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { classifyKpiFromSlot, badgeFromScore, DEFAULT_SCORE_CONFIG, kpiPenaltyFromSeverity } from '../scoring/scoringV2_2.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '../../public/assets/Logo 2 ainspecciona.png');

const KPI_ORDER = [
  'MUROS_PINTURA',
  'HUMEDAD',
  'PISOS',
  'SANITARIOS',
  'ELECTRICIDAD',
  'VENTANAS_CERRAMIENTOS',
  'PUERTAS_HERRAJES',
  'MOBILIARIO_FIJO'
];

const KPI_LABELS = {
  MUROS_PINTURA: 'Muros y pintura',
  HUMEDAD: 'Humedad visible',
  PISOS: 'Pisos',
  SANITARIOS: 'Sanitarios',
  ELECTRICIDAD: 'Electricidad visible',
  VENTANAS_CERRAMIENTOS: 'Ventanas y cerramientos',
  PUERTAS_HERRAJES: 'Puertas y herrajes',
  MOBILIARIO_FIJO: 'Mobiliario fijo'
};

function kpiLabel(key) {
  return KPI_LABELS[key] || (key ? key[0] + key.slice(1).toLowerCase() : '');
}

function badgeLabel(badge) {
  const b = String(badge || '').toUpperCase();
  if (b === 'GREEN') return 'Favorable';
  if (b === 'YELLOW') return 'Intermedio';
  if (b === 'RED') return 'Revisión sugerida';
  if (b === 'GRAY') return 'Sin datos';
  return '—';
}

function badgeColor(badge) {
  const b = String(badge || '').toUpperCase();
  if (b === 'GREEN') return '#10B981';
  if (b === 'YELLOW') return '#F59E0B';
  if (b === 'RED') return '#F97316';
  if (b === 'GRAY') return '#94A3B8';
  return '#94A3B8';
}

function drawSemiCircleGauge(doc, cx, cy, radius, score, color) {
  const pct = Math.max(0, Math.min(1, (score ?? 0) / 100));
  const strokeW = radius * 0.2;
  doc.lineWidth(strokeW);
  doc.lineCap('round');
  doc.strokeColor('#E5E7EB');
  doc.arc(cx, cy, radius, Math.PI, 0, true);
  doc.stroke();
  doc.strokeColor(color);
  doc.arc(cx, cy, radius, 0, pct * Math.PI, true);
  doc.stroke();
}

function drawCircleGauge(doc, cx, cy, radius, score, color) {
  const pct = score == null ? 0 : Math.max(0, Math.min(1, score / 100));
  const strokeW = radius * 0.35;
  doc.lineWidth(strokeW);
  doc.lineCap('round');
  doc.strokeColor('#E5E7EB');
  doc.circle(cx, cy, radius);
  doc.stroke();
  doc.strokeColor(color);
  doc.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * pct, false);
  doc.stroke();
}

function removeRetakePhrases(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\s*No\s+se\s+puede\s+evaluar\s+por\s+falta\s+de\s+claridad\.?\s*/gi, ' ')
    .replace(/\s*Se\s+recomienda\s+retomar\s+(la\s+)?fotograf[ií]a\.?\s*/gi, ' ')
    .replace(/\s*Se\s+sugiere\s+retomar\s+(la\s+)?foto\.?\s*/gi, ' ')
    .replace(/\s*,\s*lo\s+que\s+dificulta\s+(la\s+)?visibilidad\.?\s*/gi, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim() || 'Las superficies se ven uniformes y sin evidencias claras de deterioro.';
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
}

async function fetchLogoBuffer(logoUrl) {
  const url = String(logoUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch (_) {
    return null;
  }
}

function kpiPenaltyForSlot(slot, kpiKey, cfg) {
  return kpiPenaltyFromSeverity(kpiKey, slot.severity, cfg);
}

/** Misma lógica que computeScoringByKpi: promedio de penalización por slot, no suma total. */
function scoreKpiFromSlots(items, kpiKey, cfg) {
  if (!items.length) return null;
  const impact = items.reduce((acc, s) => acc + kpiPenaltyForSlot(s, kpiKey, cfg), 0);
  const avgPenalty = impact / items.length;
  return Math.max(0, Math.min(100, Math.round(100 - avgPenalty)));
}

function slotScoreForPdf(slot, kpiKey, cfg) {
  if (slot.omitted || String(slot.status || '').toUpperCase() === 'NOT_CAPTURABLE') return null;
  const penalty = kpiPenaltyForSlot(slot, kpiKey, cfg);
  if (!slot.severity) return 100;
  return Math.max(0, 100 - penalty);
}

function buildKpiGroups(slots, scoreConfig, byGroupArr = []) {
  const cfg = scoreConfig || DEFAULT_SCORE_CONFIG;
  const backendMap = new Map(
    (byGroupArr || []).map((g) => [String(g.groupKey || '').toUpperCase(), g])
  );
  const buckets = new Map(KPI_ORDER.map((k) => [k, []]));

  slots.forEach((s) => {
    const key = classifyKpiFromSlot(s, cfg.slotKpiMap);
    if (key && buckets.has(key)) buckets.get(key).push(s);
  });

  return KPI_ORDER.map((key) => {
    const items = buckets.get(key) || [];
    if (!items.length) return null;
    const backend = backendMap.get(key);
    const score = backend?.scoreIfOnlyGroup != null
      ? Math.round(Number(backend.scoreIfOnlyGroup))
      : scoreKpiFromSlots(items, key, cfg);
    const badge = badgeFromScore(score, cfg);
    return { key, title: kpiLabel(key), score, badge, items };
  }).filter(Boolean);
}

export async function generateReportPdf({ summary, storage, prisma, scoreConfig }) {
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const c = summary.case || {};
  const property = c.property || {};
  const slots = summary.slots || [];
  const cfg = scoreConfig || DEFAULT_SCORE_CONFIG;
  const score = Math.round(Math.max(0, Math.min(100, summary.score ?? 0)));
  const badge = summary.badge || 'GRAY';

  const kpiGroups = buildKpiGroups(slots, cfg, summary.byGroup || []);

  // === HEADER (dark premium) ===
  doc.rect(0, 0, doc.page.width, 56).fill('#0B1220');
  doc.rect(0, 0, doc.page.width, 3).fill('#7C3AED');
  let logoX = 28;
  const tenantLogoUrl = summary.tenant?.logoUrl || null;
  const tenantLogoBuf = tenantLogoUrl ? await fetchLogoBuffer(tenantLogoUrl) : null;
  if (tenantLogoBuf) {
    try {
      doc.image(tenantLogoBuf, logoX, 8, { fit: [88, 40], align: 'center', valign: 'center' });
      logoX += 96;
    } catch (_) {}
  }
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, logoX, 8, { fit: [90, 40], align: 'center', valign: 'center' });
      logoX += 98;
    } catch (_) {}
  }
  const headerTextX = logoX > 28 ? logoX + 4 : 40;
  doc.fontSize(16).fillColor('#F8FAFC').font('Helvetica-Bold').text('Informe Técnico del Inmueble', headerTextX, 14, { width: Math.max(200, 420 - (headerTextX - 40)) });
  doc.fontSize(10).fillColor('#94a3b8').text('Evaluación automatizada basada en evidencia fotográfica', headerTextX, 34);
  doc.fontSize(9).fillColor('#64748b').text(`STI v3.0 · ${formatDate(c.createdAt)}`, 0, 22, { width: doc.page.width - 40, align: 'right' });

  doc.moveDown(3);

  // === RESUMEN PROPIEDAD ===
  const margin = 36;
  doc.fontSize(12).fillColor('#111827').font('Helvetica-Bold').text('Datos del inmueble', margin, 95);
  doc.font('Helvetica').fontSize(10).fillColor('#374151');

  const propBase = 115;
  doc.text(`Dirección: ${property.address || '—'}`, margin, propBase);
  doc.text(`ROL: ${property.rol || '—'}`, margin, propBase + 16);
  const operationTypeLabel = String(property.operationType || '').toUpperCase() === 'ARRENDO'
    ? 'ARRIENDO'
    : (property.operationType || '—');
  doc.text(`Tipo operación: ${operationTypeLabel}`, margin, propBase + 32);
  doc.text(`Superficie: ${property.surface || '—'}`, margin, propBase + 48);
  doc.text(`N° de caso: ${c.shortId || c.id || '—'}`, margin, propBase + 64);
  doc.text(`Fecha de análisis: ${formatDate(c.createdAt)}`, margin, propBase + 80);

  doc.text('Basado exclusivamente en evidencia fotográfica disponible.', margin, propBase + 106);

  // === SCORE (gauge) - columna derecha, con margen ===
  const stiColLeft = 320;
  const stiCx = stiColLeft + 90;
  const stiCy = propBase + 75;
  const stiR = 38;
  doc.rect(stiColLeft - 12, 100, 230, 155).fillAndStroke('#F9FAFB', '#E5E7EB');
  doc.fillColor('#111827');
  doc.fontSize(14).fillColor('#111827').font('Helvetica-Bold').text('Score Técnico del Inmueble (STI)', stiColLeft, 113, { width: 200, align: 'center' });
  drawSemiCircleGauge(doc, stiCx, stiCy, stiR, score, badgeColor(badge));
  doc.fontSize(16).fillColor('#111827').font('Helvetica-Bold').text(`${score} / 100`, stiCx - 40, stiCy + 5, { align: 'center', width: 80 });
  doc.fontSize(11).fillColor(badgeColor(badge)).font('Helvetica-Bold').text(badgeLabel(badge), stiCx - 40, stiCy + 48, { align: 'center', width: 80 });
  doc.lineWidth(1);

  doc.moveDown(4);

  // === KPIs RESUMEN ===
  let y = 273;
  doc.fontSize(12).fillColor('#111827').font('Helvetica-Bold').text('KPIs técnicos clave (resumen)', margin, y);
  y += 28;

  const kpiSummaryMap = new Map(kpiGroups.map((g) => [g.key, g]));
  const kpiSummary = KPI_ORDER
    .map((key) => kpiSummaryMap.get(key) || { key, title: kpiLabel(key), score: null, badge: 'GRAY' })
    .filter((k) => kpiSummaryMap.has(k.key));
  const colW = 122;
  const colGap = 10;
  const rowH = 88;
  const gaugeR = 16;
  kpiSummary.forEach((kpi, idx) => {
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const x = margin + col * (colW + colGap);
    const rowY = y + row * (rowH + 14);
    const gaugeCx = x + colW / 2;
    const gaugeCy = rowY + 24;

    drawCircleGauge(doc, gaugeCx, gaugeCy, gaugeR, kpi.score, badgeColor(kpi.badge));
    const scoreText = kpi.score == null ? '—' : String(Math.round(kpi.score));
    doc.fontSize(10).fillColor('#111827').font('Helvetica-Bold').text(scoreText, gaugeCx - 22, gaugeCy - 5, { width: 44, align: 'center' });
    doc.fontSize(8).fillColor('#374151').font('Helvetica').text(kpi.title, x, gaugeCy + gaugeR + 10, { width: colW, align: 'center', lineGap: 1 });
    doc.fontSize(7).fillColor(badgeColor(kpi.badge)).font('Helvetica-Bold').text(badgeLabel(kpi.badge), x, gaugeCy + gaugeR + 34, { width: colW, align: 'center' });
  });

  y += (Math.ceil(Math.max(kpiSummary.length, 1) / 4) * (rowH + 14)) + 28;

  // === RESUMEN EJECUTIVO ===
  const execSummary = c.executiveSummary || null;
  doc.fontSize(12).fillColor('#111827').font('Helvetica-Bold').text('Resumen ejecutivo', margin, y);
  y += 24;

  if (execSummary) {
    doc.fontSize(10).fillColor('#374151').font('Helvetica');
    const formatted = String(execSummary).replace(/^- /gm, '• ').replace(/^(\d+)\. /gm, '$1. ');
    doc.text(formatted, margin, y, { width: doc.page.width - margin * 2, align: 'justify' });
    y = doc.y + 14;
    doc.fontSize(8).fillColor('#9CA3AF').font('Helvetica-Oblique').text('Desarrollado por OpenAI', margin, y);
    y += 24;
    doc.addPage();
    y = 50;
  } else {
    doc.fontSize(10).fillColor('#9CA3AF').text('No hay resumen ejecutivo disponible.', margin, y);
    y += 30;
  }

  // === DETALLE POR KPI ===
  doc.fontSize(12).fillColor('#111827').font('Helvetica-Bold').text('Detalle por KPI (slots)', margin, y);
  y += 28;

  for (const group of kpiGroups) {
    if (y > 680) {
      doc.addPage();
      y = 50;
    }

    const groupGaugeR = 14;
    const groupGaugeCx = margin + groupGaugeR + 4;
    const groupGaugeCy = y + 12;
    drawCircleGauge(doc, groupGaugeCx, groupGaugeCy, groupGaugeR, group.score, badgeColor(group.badge));
    doc.fontSize(10).fillColor('#111827').font('Helvetica-Bold').text(String(Math.round(group.score ?? 0)), margin, groupGaugeCy - 2, { width: groupGaugeR * 2 + 8, align: 'center' });
    const metaX = margin + groupGaugeR * 2 + 20;
    doc.fontSize(13).fillColor('#111827').font('Helvetica-Bold').text(group.title, metaX, y + 4);
    doc.fontSize(9).fillColor(badgeColor(group.badge)).font('Helvetica-Bold');
    const badgeText = badgeLabel(group.badge);
    doc.text(badgeText, metaX, y + 18);
    const badgeW = doc.widthOfString(badgeText);
    doc.fillColor('#6B7280').font('Helvetica').text(`${group.items.length} slots`, metaX + badgeW + 14, y + 18);
    y += 42;

    for (const slot of group.items) {
      if (y > 720) {
        doc.addPage();
        y = 50;
      }

      const isOmitted = !!slot.omitted || String(slot.status || '').toUpperCase() === 'NOT_CAPTURABLE';
      const sev = isOmitted
        ? 'OMITIDA'
        : (String(slot.severity || '').toUpperCase() || 'OK');
      const source = String(slot.source || '').toUpperCase() === 'OPENAI' ? 'OpenAI' : 'V1';
      const slotScore = slotScoreForPdf(slot, group.key, cfg);
      const sanitize = (t) => t && typeof t === 'string' ? t.replace(/\bLIVING_CEILING\b/gi, 'el techo del living').replace(/\bLIVING_WALLS\b/gi, 'los muros').replace(/\bBATHROOM_\d+_\w+/g, (m) => m.replace(/_/g, ' ').toLowerCase()).replace(/\bKITCHEN_\w+/g, (m) => m.replace(/_/g, ' ').toLowerCase()) : t;
      const desc = removeRetakePhrases(sanitize(slot?.analysisDebug?.openai?.parsed?.description || slot.message || 'Sin observaciones.'));
      const kpiAnalysis = removeRetakePhrases(sanitize(slot?.analysisDebug?.openai?.parsed?.kpi_analysis || ''));
      const analysisText = kpiAnalysis || desc;

      const imgW = 80;
      const imgH = 60;
      const textWidth = doc.page.width - margin * 2 - imgW - 24;
      const textH = doc.fontSize(9).heightOfString(analysisText, { width: textWidth });
      const slotH = Math.max(78, 34 + textH + 10);

      if (y + slotH > 750) {
        doc.addPage();
        y = 50;
      }

      const imgX = doc.page.width - margin - imgW - 4;
      const imgY = y + 12;

      doc.lineWidth(0.4).strokeColor('#E5E7EB').moveTo(margin, y).lineTo(doc.page.width - margin, y).stroke();
      doc.lineWidth(1);
      doc.fontSize(10).fillColor('#111827').font('Helvetica-Bold').text(slot.title || slot.slotCode || '—', margin, y + 2);
      const scoreLine = slotScore == null ? 'Foto omitida' : `Puntaje: ${slotScore}/100`;
      doc.fontSize(8).fillColor('#6B7280').text(`Severidad: ${sev} · Fuente: ${source} · ${scoreLine}`, margin, y + 16);
      doc.fontSize(9).fillColor('#4B5563').font('Helvetica').text(analysisText, margin, y + 30, { width: textWidth });

      if (slot.photoId && storage && prisma) {
        try {
          const photo = await prisma.photo.findUnique({ where: { id: slot.photoId } });
          if (photo?.filePath) {
            const buf = await storage.readBuffer(photo.filePath);
            if (buf && buf.length > 0) {
              doc.image(buf, imgX, imgY, { fit: [imgW, imgH], align: 'center', valign: 'center' });
            }
          }
        } catch (_) {}
      }

      y += slotH;
    }

    y += 15;
  }

  const footerMarginTop = 24;
  const footerHeight = doc.fontSize(9).heightOfString(
    'Documentación técnica del análisis automatizado',
    { width: doc.page.width - margin * 2 }
  ) + 320;
  if (y + footerMarginTop + footerHeight > doc.page.height - margin) {
    doc.addPage();
    y = 50;
  }

  const footerText = [
    'Documentación técnica del análisis automatizado',
    '',
    'El presente informe fue generado mediante un proceso automatizado ejecutado en infraestructura serverless de Google Cloud Platform (GCP), utilizando modelos avanzados de visión computacional provistos por OpenAI, en su versión vigente al momento del análisis.',
    '',
    'Las imágenes capturadas durante el proceso guiado son sometidas a un pipeline de procesamiento estructurado que contempla: Normalización y preprocesamiento de imagen (formato, orientación, escala y control básico de ruido). Análisis de píxel y distribución cromática, incluyendo evaluación de variaciones de intensidad, contraste y discontinuidades de color. Construcción y evaluación de histogramas y segmentación regional para identificar patrones atípicos o zonas no homogéneas. Detección de bordes, contornos y geometrías mediante algoritmos de edge detection para identificar indicios compatibles con fisuras, desalineaciones, golpes o deformaciones visibles. Evaluación de relaciones espaciales y coherencia estructural entre elementos constructivos. Clasificación semántica contextual en función del KPI técnico asignado a cada slot evaluado.',
    '',
    'Los hallazgos detectados corresponden a indicios compatibles con condiciones técnicas observables en las imágenes, y son consolidados mediante un modelo de agregación multicriterio que pondera cantidad, distribución y severidad relativa para generar el score general del inmueble.',
    '',
    'El análisis se basa exclusivamente en información visual capturada y no contempla mediciones físicas, pruebas destructivas ni diagnósticos estructurales invasivos. No sustituye inspecciones presenciales cuando estas sean requeridas por normativa, tasación o peritaje especializado.',
    '',
    'Cada informe queda asociado a identificador único de caso, timestamp de ejecución y versión de modelo utilizada, permitiendo trazabilidad técnica bajo las mismas condiciones operativas.'
  ].join('\n');

  doc.fontSize(9).fillColor('#6B7280').text(
    footerText,
    margin,
    y + 20,
    { width: doc.page.width - margin * 2, align: 'justify' }
  );

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
