/**
 * Genera un PDF de comprobante de pago para Plan Business.
 * TODO: Integrar con SimpleFactura para emitir factura electrónica SII.
 * Una vez tengamos el RUT de la empresa (facturacion.rut), conectar con SimpleFactura
 * y enviar la factura electrónica por email en lugar de este comprobante.
 */
import PDFDocument from 'pdfkit';

export function generateBusinessReceiptPdf({ facturacion, montoClp = 39990 }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).font('Helvetica-Bold').text('Comprobante de pago', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').text('Ainspecciona · Plan Business', { align: 'center' });
    doc.moveDown(2);

    doc.fontSize(12).font('Helvetica-Bold').text('Detalle del servicio');
    doc.font('Helvetica').fontSize(10);
    doc.text(`Plan: Business (Gestión profesional)`);
    doc.text(`Monto: $${Number(montoClp).toLocaleString('es-CL')} mensual`);
    doc.text(`Fecha: ${new Date().toLocaleDateString('es-CL', { dateStyle: 'long' })}`);
    doc.moveDown(2);

    if (facturacion) {
      doc.fontSize(12).font('Helvetica-Bold').text('Datos para facturación');
      doc.font('Helvetica').fontSize(10);
      if (facturacion.razonSocial) doc.text(`Razón social: ${facturacion.razonSocial}`);
      if (facturacion.rut) doc.text(`RUT: ${facturacion.rut}`);
      if (facturacion.direccion) doc.text(`Dirección: ${facturacion.direccion}`);
      if (facturacion.comuna || facturacion.ciudad) {
        doc.text(`Comuna/Ciudad: ${[facturacion.comuna, facturacion.ciudad].filter(Boolean).join(', ')}`);
      }
      if (facturacion.giro) doc.text(`Giro: ${facturacion.giro}`);
      if (facturacion.email) doc.text(`Email: ${facturacion.email}`);
      doc.moveDown(2);
    }

    doc.fontSize(9).fillColor('#64748b').text(
      'Comprobante temporal. La factura electrónica será enviada por correo (integración SimpleFactura pendiente).',
      { align: 'center' }
    );

    doc.end();
  });
}
