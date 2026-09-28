/**
 * Demo Plaenge: org plaenge-demo + obra Postventa «Plaenge II».
 * Idempotente. No modifica otros tenants.
 */
import { generateTicketShortId } from '../postventa/ids.js';

export const PLAENGE_ORG_SLUG = 'plaenge-demo';
export const PLAENGE_PROJECT_SLUG = 'plaenge-ii';
export const PLAENGE_PROJECT_NAME = 'Plaenge II';
export const PLAENGE_ADMIN_EMAIL = 'o.chamorro@plaenge.cl';

async function ensurePlaengePostventaData(prisma, { tenantId, userId }) {
  if (!prisma || !tenantId) return { ok: false, skipped: true };

  let project = await prisma.pvProject.findFirst({
    where: { tenantId, slug: PLAENGE_PROJECT_SLUG }
  });
  if (!project) {
    project = await prisma.pvProject.create({
      data: {
        tenantId,
        slug: PLAENGE_PROJECT_SLUG,
        name: PLAENGE_PROJECT_NAME,
        address: 'Av. Apoquindo 4500',
        comuna: 'Las Condes',
        defaultInspectorId: userId || null
      }
    });
  } else {
    const data = {};
    if (project.name !== PLAENGE_PROJECT_NAME) data.name = PLAENGE_PROJECT_NAME;
    if (userId && !project.defaultInspectorId) data.defaultInspectorId = userId;
    if (Object.keys(data).length) {
      project = await prisma.pvProject.update({ where: { id: project.id }, data });
    }
  }

  const unitSpecs = [
    { tower: 'A', unitNumber: '101', label: 'Depto 101' },
    { tower: 'A', unitNumber: '202', label: 'Depto 202' },
    { tower: 'B', unitNumber: '303', label: 'Depto 303' }
  ];
  const units = [];
  for (const u of unitSpecs) {
    let unit = await prisma.pvUnit.findFirst({
      where: { projectId: project.id, tower: u.tower, unitNumber: u.unitNumber }
    });
    if (!unit) {
      const reception = new Date();
      reception.setMonth(reception.getMonth() - 6);
      unit = await prisma.pvUnit.create({
        data: {
          projectId: project.id,
          tower: u.tower,
          unitNumber: u.unitNumber,
          label: u.label,
          domReceptionDate: reception,
          cbrInscriptionDate: reception
        }
      });
    }
    units.push(unit);
  }

  const existingTickets = await prisma.pvTicket.count({
    where: { tenantId, projectId: project.id }
  });
  if (existingTickets > 0) {
    return {
      ok: true,
      skipped: true,
      projectId: project.id,
      existingTickets
    };
  }

  if (!userId) {
    return { ok: true, projectId: project.id, created: 0, message: 'Sin inspector para tickets' };
  }

  const demos = [
    {
      unit: units[0],
      status: 'asignada',
      summary: 'Filtración en cielo baño principal',
      category: 'humedad_filtracion',
      roomHint: 'Baño principal',
      daysAgo: 2
    },
    {
      unit: units[1],
      status: 'programado',
      summary: 'Puerta de acceso no cierra correctamente',
      category: 'puertas_cerraduras',
      roomHint: 'Hall',
      daysAgo: 4,
      scheduleInDays: 3
    },
    {
      unit: units[2],
      status: 'en_ejecucion',
      summary: 'Desprendimiento de pintura en living',
      category: 'pintura_muros_cielos',
      roomHint: 'Living',
      daysAgo: 8
    }
  ];

  let created = 0;
  for (const d of demos) {
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - d.daysAgo);
    let shortId = generateTicketShortId();
    for (let i = 0; i < 5; i++) {
      const exists = await prisma.pvTicket.findUnique({ where: { shortId }, select: { id: true } });
      if (!exists) break;
      shortId = generateTicketShortId();
    }
    const scheduledAt =
      d.scheduleInDays != null
        ? new Date(Date.now() + d.scheduleInDays * 24 * 60 * 60 * 1000)
        : null;

    const ticket = await prisma.pvTicket.create({
      data: {
        tenantId,
        projectId: project.id,
        unitId: d.unit.id,
        shortId,
        status: d.status,
        source: 'plaenge_demo',
        summary: d.summary,
        preliminaryCategory: d.category,
        roomHint: d.roomHint,
        contactName: 'Residente Plaenge',
        contactPhone: '+56987654321',
        assignedToUserId: userId,
        assignedAt: createdAt,
        scheduledAt,
        warrantyStatus: 'en_garantia',
        warrantyTier: 'terminaciones',
        warrantyYears: 1,
        createdAt,
        updatedAt: createdAt
      }
    });
    await prisma.pvTicketEvent.create({
      data: {
        ticketId: ticket.id,
        eventType: 'ticket_created',
        payload: { source: 'plaenge_demo', status: d.status }
      }
    });
    created += 1;
  }

  return { ok: true, projectId: project.id, created };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function ensurePlaengeDemo(prisma) {
  if (!prisma) return { ok: false, skipped: true };

  let org = await prisma.organization.findUnique({ where: { slug: PLAENGE_ORG_SLUG } });
  if (!org) {
    return { ok: false, skipped: true, message: 'Org plaenge-demo no existe aún' };
  }

  org = await prisma.organization.update({
    where: { id: org.id },
    data: { requiresNda: true, status: 'ACTIVE' }
  });

  const pvTenant = await prisma.pvTenant.findUnique({ where: { slug: PLAENGE_ORG_SLUG } });
  let postsale = { ok: false, skipped: true };
  if (pvTenant) {
    const pvUser = await prisma.pvUser.findFirst({
      where: {
        tenantId: pvTenant.id,
        OR: [{ email: PLAENGE_ADMIN_EMAIL }, { email: { contains: 'plaenge' } }]
      },
      orderBy: { createdAt: 'asc' }
    });
    postsale = await ensurePlaengePostventaData(prisma, {
      tenantId: pvTenant.id,
      userId: pvUser?.id || null
    });
  }

  return {
    ok: true,
    organization: { id: org.id, slug: org.slug, requiresNda: org.requiresNda },
    postsale
  };
}
