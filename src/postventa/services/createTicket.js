import { generateTicketShortId } from '../ids.js';
import { VALID_CATEGORIES } from '../capture/slotTemplates.js';
import { validateWarranty as runWarrantyEngine } from '../warranty/warrantyEngine.js';
import { normalizePhone } from '../normalize.js';

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function createPostventaTicket(prisma, body) {
  const tenantSlug = String(body.tenantSlug || body.tenant || 'demo-inmobiliaria').trim();
  const summary = String(body.summary || '').trim();
  const preliminaryCategory = String(body.preliminaryCategory || body.category || '').trim();
  const contactName = String(body.contactName || body.occupantName || '').trim().slice(0, 191);
  const contactPhoneRaw = String(body.contactPhone || body.occupantPhone || body.phone || '').trim();
  const contactPhone = contactPhoneRaw ? normalizePhone(contactPhoneRaw).slice(0, 32) : '';

  if (!tenantSlug || !summary || !preliminaryCategory) {
    return {
      ok: false,
      status: 400,
      error: 'MISSING_FIELDS',
      message: 'tenantSlug, summary y preliminaryCategory son obligatorios.'
    };
  }

  if (!VALID_CATEGORIES.has(preliminaryCategory)) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_CATEGORY',
      message: `Categoría no válida: ${preliminaryCategory}`
    };
  }

  const tenant = await prisma.pvTenant.findFirst({
    where: { slug: tenantSlug, status: 'ACTIVE' }
  });
  if (!tenant) {
    return { ok: false, status: 404, error: 'TENANT_NOT_FOUND', message: 'Inmobiliaria no encontrada.' };
  }

  const unitId = body.unitId ? String(body.unitId).trim() : null;
  const ownerId = body.ownerId ? String(body.ownerId).trim() : null;
  const projectId = body.projectId ? String(body.projectId).trim() : null;
  const source = body.source ? String(body.source).trim() : null;
  const conversationSessionId = body.conversationSessionId
    ? String(body.conversationSessionId).trim()
    : null;
  const roomHint = body.roomHint ? String(body.roomHint).trim() : null;

  if (unitId) {
    const unit = await prisma.pvUnit.findFirst({
      where: { id: unitId, project: { tenantId: tenant.id } }
    });
    if (!unit) {
      return { ok: false, status: 400, error: 'UNIT_NOT_FOUND', message: 'unitId no válido para esta inmobiliaria.' };
    }
  }

  let warrantyFields = {};
  if (unitId) {
    const unitForWarranty = await prisma.pvUnit.findUnique({
      where: { id: unitId },
      select: { domReceptionDate: true, cbrInscriptionDate: true }
    });
    if (unitForWarranty) {
      const w = runWarrantyEngine({
        domReceptionDate: unitForWarranty.domReceptionDate,
        cbrInscriptionDate: unitForWarranty.cbrInscriptionDate,
        preliminaryCategory
      });
      warrantyFields = {
        warrantyStatus: w.status,
        warrantyTier: w.tier !== 'desconocido' ? w.tier : null,
        warrantyYears: w.warrantyYears,
        warrantyExpiresAt: w.warrantyExpiresAt ? new Date(w.warrantyExpiresAt) : null
      };
    }
  }

  let shortId = generateTicketShortId();
  for (let attempt = 0; attempt < 5; attempt++) {
    const exists = await prisma.pvTicket.findUnique({ where: { shortId }, select: { id: true } });
    if (!exists) break;
    shortId = generateTicketShortId();
  }

  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.pvTicket.create({
      data: {
        tenantId: tenant.id,
        unitId,
        ownerId,
        projectId,
        shortId,
        status: 'draft',
        source,
        conversationSessionId,
        summary,
        preliminaryCategory,
        roomHint,
        contactName: contactName || null,
        contactPhone: contactPhone || null,
        ...warrantyFields
      }
    });

    await tx.pvTicketEvent.create({
      data: {
        ticketId: created.id,
        eventType: 'ticket_created',
        payload: {
          source,
          preliminaryCategory,
          roomHint,
          contactName: contactName || null,
          contactPhone: contactPhone || null,
          warranty: warrantyFields
        }
      }
    });

    return created;
  });

  return {
    ok: true,
    ticketId: ticket.id,
    ticketShortId: ticket.shortId,
    status: ticket.status,
    warrantyStatus: ticket.warrantyStatus,
    warrantyTier: ticket.warrantyTier,
    warrantyExpiresAt: ticket.warrantyExpiresAt?.toISOString?.()?.slice(0, 10) || null,
    contactName: ticket.contactName || null,
    contactPhone: ticket.contactPhone || null,
    message: 'Ticket creado. Genera captura con create_capture_session.'
  };
}
