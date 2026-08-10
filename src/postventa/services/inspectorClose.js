/**
 * Cierre de ticket en terreno: foto "después" + nota → terminado.
 */
import { statusLabel } from '../statusLabels.js';

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {object} storage
 * @param {string} tenantId
 * @param {string} shortId
 * @param {{
 *   userId: string,
 *   userRole?: string,
 *   note?: string,
 *   buffer: Buffer,
 *   mimeType?: string
 * }} opts
 */
export async function closePortalTicketWithEvidence(prisma, storage, tenantId, shortId, opts) {
  if (!prisma || !storage?.saveImageBuffer) {
    return { ok: false, status: 503, error: 'STORAGE_UNAVAILABLE', message: 'Almacenamiento no disponible.' };
  }

  const ref = String(shortId || '').trim();
  const note = String(opts?.note || '').trim().slice(0, 1000);
  const userId = String(opts?.userId || '').trim();
  const buffer = opts?.buffer;
  const mimeType = String(opts?.mimeType || 'image/jpeg').split(';')[0].trim() || 'image/jpeg';

  if (!userId) {
    return { ok: false, status: 401, error: 'UNAUTHORIZED' };
  }
  if (!note) {
    return {
      ok: false,
      status: 400,
      error: 'NOTE_REQUIRED',
      message: 'Indica una nota breve del cierre.'
    };
  }
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 100) {
    return {
      ok: false,
      status: 400,
      error: 'PHOTO_REQUIRED',
      message: 'La foto de cierre es obligatoria.'
    };
  }
  if (!mimeType.startsWith('image/')) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MEDIA',
      message: 'Solo se aceptan imágenes.'
    };
  }

  const ticket = await prisma.pvTicket.findFirst({
    where: {
      tenantId,
      OR: [{ shortId: ref }, { id: ref }]
    },
    select: {
      id: true,
      shortId: true,
      status: true,
      tenantId: true,
      assignedToUserId: true
    }
  });
  if (!ticket) {
    return { ok: false, status: 404, error: 'TICKET_NOT_FOUND' };
  }

  const role = String(opts?.userRole || '').toUpperCase();
  const isAdmin = role === 'ADMIN' || role === 'EXECUTIVE';
  if (!isAdmin && ticket.assignedToUserId !== userId) {
    return {
      ok: false,
      status: 403,
      error: 'NOT_ASSIGNEE',
      message: 'Solo el inspector asignado puede cerrar este reclamo.'
    };
  }

  if (['terminado', 'closed', 'rejected'].includes(String(ticket.status))) {
    return {
      ok: false,
      status: 409,
      error: 'ALREADY_CLOSED',
      message: 'El reclamo ya está cerrado.'
    };
  }

  if (!['en_ejecucion', 'programado', 'asignada'].includes(String(ticket.status))) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_STATUS',
      message: 'Inicia la ejecución antes de cerrar el reclamo.'
    };
  }

  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const storageKey =
    storage.driver === 'gcs'
      ? `postventa/${ticket.tenantId}/${ticket.id}/close.${ext}`
      : `postventa-${ticket.id}-close.${ext}`;

  let saved;
  try {
    saved = await storage.saveImageBuffer({
      buffer,
      contentType: mimeType,
      ext,
      tenantId: ticket.tenantId,
      storageKey
    });
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: 'WRITE_ERROR',
      message: err?.message || 'No se pudo guardar la foto de cierre.'
    };
  }

  const closedAt = new Date();
  await prisma.$transaction([
    prisma.pvTicket.update({
      where: { id: ticket.id },
      data: {
        status: 'terminado',
        closedAt,
        closeNote: note,
        closePhotoPath: saved.filePath
      }
    }),
    prisma.pvTicketEvent.create({
      data: {
        ticketId: ticket.id,
        eventType: 'inspector_close',
        payload: {
          closedByUserId: userId,
          closeNote: note,
          closePhotoPath: saved.filePath,
          from: ticket.status,
          to: 'terminado'
        }
      }
    })
  ]);

  return {
    ok: true,
    shortId: ticket.shortId,
    status: 'terminado',
    statusLabel: statusLabel('terminado'),
    closedAt: closedAt.toISOString(),
    closeNote: note,
    closePhotoUrl: `/api/postventa/portal/tickets/${encodeURIComponent(ticket.shortId)}/close-photo`
  };
}
