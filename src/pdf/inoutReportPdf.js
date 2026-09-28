/**
 * Informe diferencial In & Out (PDF).
 */
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '../../public/assets/Logo 2 ainspecciona.png');

const CLASS_LABELS = {
  sin_cambio: 'Sin cambio',
  cambio_detectado: 'Cambio detectado',
  posible_deterioro: 'Posible deterioro',
  elemento_faltante: 'Elemento faltante',
  no_comparable: 'No comparable'
};

function fmtDate(isoOrDate) {
  if (!isoOrDate) return '—';
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function line(doc, label, value) {
  const v = String(value == null || value === '' ? '—' : value);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748b').text(label);
  doc.font('Helvetica').fontSize(11).fillColor('#0f172a').text(v);
  doc.moveDown(0.35);
}

/**
 * @param {{
 *   address?: string,
 *   tenantName?: string,
 *   ownerName?: string,
 *   generatedAt?: string|Date,
 *   summary?: { counts?: object, conclusion?: string },
 *   disclaimer?: string,
 *   items?: Array<{ title?: string, slotCode?: string, classification?: string, severity?: string, description?: string, reviewStatus?: string }>
 * }} data
 * @returns {Promise<Buffer>}
 */
export function generateInOutReportPdf(data = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const counts = data.summary?.counts || {};

    try {
      if (fs.existsSync(LOGO_PATH)) {
        doc.image(LOGO_PATH, doc.page.margins.left, 36, { height: 28 });
      }
    } catch {
      /* ignore */
    }

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text('Informe In & Out', { align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#64748b').text('Apertura vs cierre · Ainspecciona', { align: 'right' });
    doc.moveDown(1.2);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + pageW, doc.y)
      .strokeColor('#e2e8f0')
      .lineWidth(1)
      .stroke();
    doc.moveDown(1);

    doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a').text(String(data.address || 'Propiedad'));
    doc.font('Helvetica').fontSize(10).fillColor('#64748b').text(`Generado: ${fmtDate(data.generatedAt || new Date())}`);
    doc.moveDown(0.8);

    line(doc, 'Arrendatario', data.tenantName);
    line(doc, 'Propietario', data.ownerName);
    doc.moveDown(0.4);

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text('Resumen');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10).fillColor('#334155').text(String(data.summary?.conclusion || ''), { width: pageW });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(10).fillColor('#0f172a').text(
      `Sin cambio: ${counts.sin_cambio || 0}   ·   Cambios: ${counts.cambio_detectado || 0}   ·   Deterioro: ${counts.posible_deterioro || 0}   ·   Faltantes: ${counts.elemento_faltante || 0}   ·   No comparable: ${counts.no_comparable || 0}`
    );
    doc.moveDown(0.8);

    const items = Array.isArray(data.items) ? data.items : [];
    items.forEach((item, i) => {
      if (doc.y > 720) doc.addPage();
      const klass = CLASS_LABELS[item.classification] || item.classification || '—';
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(`${i + 1}. ${item.title || item.slotCode || 'Elemento'}`);
      doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(`${klass} · revisión: ${item.reviewStatus || 'pending'}`);
      if (item.description) {
        doc.font('Helvetica').fontSize(10).fillColor('#334155').text(String(item.description), { width: pageW });
      }
      doc.moveDown(0.55);
    });

    if (data.disclaimer) {
      if (doc.y > 700) doc.addPage();
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748b').text('Aviso');
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(String(data.disclaimer), { width: pageW });
    }

    doc.end();
  });
}
