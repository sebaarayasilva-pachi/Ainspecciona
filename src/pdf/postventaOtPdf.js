/**
 * Orden de Trabajo (OT) postventa — PDF para equipo de reparación.
 */
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '../../public/assets/Logo 2 ainspecciona.png');

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
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748b').text(label, { continued: false });
  doc.font('Helvetica').fontSize(11).fillColor('#0f172a').text(v, { continued: false });
  doc.moveDown(0.45);
}

/**
 * @param {{
 *   shortId: string,
 *   tenantName?: string,
 *   projectName?: string,
 *   unitLabel?: string,
 *   address?: string,
 *   ownerName?: string,
 *   ownerEmail?: string,
 *   contactName?: string,
 *   contactPhone?: string,
 *   summary?: string,
 *   categoryLabel?: string,
 *   analysisSummary?: string,
 *   recommendedRouting?: string,
 *   repairTeamName?: string,
 *   repairTeamContact?: string,
 *   inspectorName?: string,
 *   inspectorEmail?: string,
 *   scheduledAt?: string|Date|null,
 *   createdAt?: string|Date|null,
 *   photos?: Array<{ title?: string, buffer: Buffer }>
 * }} data
 * @returns {Promise<Buffer>}
 */
export function generatePostventaOtPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    try {
      if (fs.existsSync(LOGO_PATH)) {
        doc.image(LOGO_PATH, doc.page.margins.left, 36, { height: 28 });
      }
    } catch (_) {
      /* ignore */
    }

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text('Orden de Trabajo', {
      align: 'right'
    });
    doc.font('Helvetica').fontSize(10).fillColor('#64748b').text('Postventa · Ainspecciona', {
      align: 'right'
    });
    doc.moveDown(1.2);

    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + pageW, doc.y)
      .strokeColor('#e2e8f0')
      .lineWidth(1)
      .stroke();
    doc.moveDown(1);

    doc.font('Helvetica-Bold').fontSize(22).fillColor('#0f172a').text(String(data.shortId || '—'));
    doc.font('Helvetica').fontSize(10).fillColor('#64748b').text(`Generada: ${fmtDate(new Date())}`);
    doc.moveDown(1);

    // Inspector + fecha acordada (destacados)
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text('Inspector asignado');
    doc.moveDown(0.35);
    line(doc, 'Nombre', data.inspectorName);
    line(doc, 'Contacto', data.inspectorEmail);

    doc.moveDown(0.35);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text('Visita / reparación acordada');
    doc.moveDown(0.35);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748b').text('Fecha y hora con el cliente');
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor('#0f172a')
      .text(fmtDate(data.scheduledAt));
    doc.moveDown(0.7);

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text('Equipo de trabajo');
    doc.moveDown(0.35);
    line(doc, 'Equipo', data.repairTeamName);
    line(doc, 'Contacto', data.repairTeamContact);

    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text('Ubicación');
    doc.moveDown(0.35);
    line(doc, 'Inmobiliaria', data.tenantName);
    line(doc, 'Proyecto', data.projectName);
    line(doc, 'Unidad', data.unitLabel);
    line(doc, 'Dirección', data.address);

    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text('Reclamo');
    doc.moveDown(0.35);
    line(doc, 'Contacto visita', [data.contactName, data.contactPhone].filter(Boolean).join(' · '));
    line(doc, 'Propietario', [data.ownerName, data.ownerEmail].filter(Boolean).join(' · '));
    line(doc, 'Categoría', data.categoryLabel);
    line(doc, 'Creado', fmtDate(data.createdAt));

    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748b').text('Resumen');
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#0f172a')
      .text(String(data.summary || '—').trim() || '—', { width: pageW, align: 'left' });

    if (data.analysisSummary) {
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748b').text('Informe / orientación');
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#334155')
        .text(String(data.analysisSummary).trim(), { width: pageW });
    }
    if (data.recommendedRouting) {
      doc.moveDown(0.4);
      line(doc, 'Routing sugerido', data.recommendedRouting);
    }

    const photos = Array.isArray(data.photos) ? data.photos.filter((p) => p?.buffer?.length) : [];
    if (photos.length) {
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text('Evidencia fotográfica');
      doc.moveDown(0.4);

      const gap = 12;
      const colW = (pageW - gap) / 2;
      const imgH = 120;
      let col = 0;
      let rowY = doc.y;

      for (const photo of photos.slice(0, 4)) {
        if (rowY + imgH + 28 > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          rowY = doc.page.margins.top;
          col = 0;
        }
        const x = doc.page.margins.left + col * (colW + gap);
        try {
          doc.image(photo.buffer, x, rowY, {
            fit: [colW, imgH],
            align: 'center',
            valign: 'center'
          });
        } catch (_) {
          doc.rect(x, rowY, colW, imgH).strokeColor('#e2e8f0').stroke();
          doc.font('Helvetica').fontSize(9).fillColor('#94a3b8').text('Foto no disponible', x + 8, rowY + imgH / 2);
        }
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#64748b')
          .text(String(photo.title || 'Foto').slice(0, 40), x, rowY + imgH + 4, { width: colW });
        col += 1;
        if (col >= 2) {
          col = 0;
          rowY += imgH + 28;
        }
      }
      if (col !== 0) rowY += imgH + 28;
      doc.y = rowY;
    }

    doc.moveDown(1.2);
    const sigY = Math.min(doc.y + 20, doc.page.height - 100);
    doc.y = sigY;
    doc.font('Helvetica').fontSize(9).fillColor('#64748b').text('Firma / recepción equipo', {
      continued: false
    });
    doc.moveDown(1.5);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + 220, doc.y)
      .strokeColor('#94a3b8')
      .stroke();
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text('Nombre y fecha');

    doc.end();
  });
}
