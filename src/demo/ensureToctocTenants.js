/**
 * Tenants demo TOC TOC en cada producto (login normal, sin hub).
 * Idempotente. No modifica otros tenants.
 */
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { hashPassword } from '../postventa/auth/portalAuth.js';
import { generateTicketShortId } from '../postventa/ids.js';

export const TOCTOC_TENANT_SLUG = 'toctoc-pruebas';
export const TOCTOC_CAPTURE_EMAIL = 'capture@toctoc.ainspecciona.com';
export const TOCTOC_ENTREGA_EMAIL = 'recepcion@toctoc.ainspecciona.com';
export const TOCTOC_POSTVENTA_EMAIL = 'postventa@toctoc.ainspecciona.com';
export const TOCTOC_INOUT_EMAIL = 'inout@toctoc.ainspecciona.com';
export const TOCTOC_DEMO_PASSWORD = 'ToctocDemo2026!';
export const TOCTOC_BUSINESS_TENANT_EMAIL = 'corredora-toctoc-pruebas@ainspecciona.com';

async function upsertByEmail(prisma, model, email, createData, updateData) {
  const existing = await prisma[model].findUnique({ where: { email } });
  if (existing) {
    return prisma[model].update({ where: { email }, data: updateData });
  }
  return prisma[model].create({ data: createData });
}

/** Proyecto + tickets demo Postventa (si el tenant está vacío). */
export async function ensureToctocPostventaDemoData(prisma, { tenantId, userId }) {
  if (!prisma || !tenantId || !userId) return { ok: false, skipped: true };

  const existingTickets = await prisma.pvTicket.count({ where: { tenantId } });
  if (existingTickets > 0) {
    const orphan = await prisma.pvTicket.updateMany({
      where: {
        tenantId,
        assignedToUserId: null,
        status: { notIn: ['draft', 'pending_evidence', 'closed', 'terminado', 'rejected'] }
      },
      data: { assignedToUserId: userId, assignedAt: new Date() }
    });
    return { ok: true, skipped: true, existingTickets, reassigned: orphan.count };
  }

  let project = await prisma.pvProject.findFirst({
    where: { tenantId, slug: 'torre-demo-toctoc' }
  });
  if (!project) {
    project = await prisma.pvProject.create({
      data: {
        tenantId,
        slug: 'torre-demo-toctoc',
        name: 'Torre Demo TOC TOC',
        address: 'Av. Apoquindo 3000',
        comuna: 'Las Condes',
        defaultInspectorId: userId
      }
    });
  } else if (!project.defaultInspectorId) {
    project = await prisma.pvProject.update({
      where: { id: project.id },
      data: { defaultInspectorId: userId }
    });
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
      reception.setMonth(reception.getMonth() - 8);
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

  const demos = [
    {
      unit: units[0],
      status: 'asignada',
      summary: 'Filtración en cielo baño principal',
      category: 'humedad_filtracion',
      roomHint: 'Baño principal',
      urgent: false,
      daysAgo: 2
    },
    {
      unit: units[1],
      status: 'programado',
      summary: 'Puerta de acceso no cierra correctamente',
      category: 'puertas_cerraduras',
      roomHint: 'Hall',
      urgent: false,
      daysAgo: 5,
      scheduleInDays: 2
    },
    {
      unit: units[2],
      status: 'en_ejecucion',
      summary: 'Desprendimiento de pintura en living',
      category: 'pintura_muros_cielos',
      roomHint: 'Living',
      urgent: true,
      daysAgo: 10
    },
    {
      unit: units[0],
      status: 'asignada',
      summary: 'Fuga visible en lavamanos',
      category: 'sanitarios',
      roomHint: 'Baño visitas',
      urgent: true,
      daysAgo: 1
    },
    {
      unit: units[1],
      status: 'programado',
      summary: 'Sello perimetral de ventana con filtración',
      category: 'ventanas_sellos',
      roomHint: 'Dormitorio 1',
      urgent: false,
      daysAgo: 7,
      scheduleInDays: 5
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
        source: 'toctoc_demo',
        summary: d.summary,
        preliminaryCategory: d.category,
        roomHint: d.roomHint,
        contactName: 'Residente demo',
        contactPhone: '+56912345678',
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
        payload: { source: 'toctoc_demo', status: d.status, urgentHint: d.urgent }
      }
    });
    created += 1;
  }

  return { ok: true, created, projectId: project.id };
}

/**
 * Asegura tenants TOC TOC en Capture, Entrega, Postventa e In & Out.
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function ensureToctocTenants(prisma) {
  const captureEmail = String(process.env.TOCTOC_CAPTURE_EMAIL || TOCTOC_CAPTURE_EMAIL).toLowerCase();
  const entregaEmail = String(process.env.TOCTOC_ENTREGA_EMAIL || TOCTOC_ENTREGA_EMAIL).toLowerCase();
  const postventaEmail = String(process.env.TOCTOC_POSTVENTA_EMAIL || TOCTOC_POSTVENTA_EMAIL).toLowerCase();
  const inoutEmail = String(process.env.TOCTOC_INOUT_EMAIL || TOCTOC_INOUT_EMAIL).toLowerCase();
  const password = String(process.env.TOCTOC_DEMO_PASSWORD || TOCTOC_DEMO_PASSWORD);
  const passwordHash = hashPassword(password);
  const now = new Date();
  const slug = TOCTOC_TENANT_SLUG;

  // ——— Capture (Business Tenant + User) ———
  let bizTenant = await prisma.tenant.findFirst({
    where: { email: TOCTOC_BUSINESS_TENANT_EMAIL }
  });
  if (!bizTenant) {
    bizTenant = await prisma.tenant.create({
      data: {
        name: 'TOC TOC Pruebas',
        email: TOCTOC_BUSINESS_TENANT_EMAIL,
        status: 'ACTIVE',
        trialSource: 'toctoc_partner_demo',
        passwordHash,
        mustChangePassword: false
      }
    });
  } else {
    bizTenant = await prisma.tenant.update({
      where: { id: bizTenant.id },
      data: {
        name: 'TOC TOC Pruebas',
        status: 'ACTIVE',
        passwordHash,
        mustChangePassword: false
      }
    });
  }

  const credit = await prisma.tenantCredit.findUnique({ where: { tenantId: bizTenant.id } });
  if (!credit) {
    await prisma.tenantCredit.create({
      data: { tenantId: bizTenant.id, balance: 50 }
    });
  }

  const userTable = Prisma.raw('`User`');
  const existingExec = await prisma.$queryRaw`
    SELECT id FROM ${userTable}
    WHERE LOWER(TRIM(email)) = LOWER(${captureEmail})
    LIMIT 1
  `;
  let captureUserId;
  if (Array.isArray(existingExec) && existingExec[0]?.id) {
    captureUserId = existingExec[0].id;
    await prisma.$executeRaw`
      UPDATE ${userTable}
      SET
        passwordHash = ${passwordHash},
        fullName = ${'Capture TOC TOC Pruebas'},
        tenantId = ${bizTenant.id},
        role = 'TENANT_USER',
        status = 'ACTIVE',
        mustChangePassword = false,
        activatedAt = COALESCE(activatedAt, ${now})
      WHERE id = ${captureUserId}
    `;
  } else {
    captureUserId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO ${userTable}
        (id, tenantId, email, fullName, passwordHash, role, status, invitedAt, activatedAt, mustChangePassword, createdAt)
      VALUES (
        ${captureUserId},
        ${bizTenant.id},
        ${captureEmail},
        ${'Capture TOC TOC Pruebas'},
        ${passwordHash},
        'TENANT_USER',
        'ACTIVE',
        ${now},
        ${now},
        false,
        ${now}
      )
    `;
  }

  // ——— Recepción / Entrega ———
  let entregaTenant = await prisma.entregaTenant.findUnique({ where: { slug } });
  if (!entregaTenant) {
    entregaTenant = await prisma.entregaTenant.create({
      data: { slug, name: 'TOC TOC Recepción Pruebas', status: 'ACTIVE' }
    });
  }
  const entregaUser = await upsertByEmail(
    prisma,
    'entregaUser',
    entregaEmail,
    {
      tenantId: entregaTenant.id,
      email: entregaEmail,
      fullName: 'Recepción TOC TOC Pruebas',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash
    },
    {
      tenantId: entregaTenant.id,
      fullName: 'Recepción TOC TOC Pruebas',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash
    }
  );

  // ——— Postventa ———
  let pvTenant = await prisma.pvTenant.findUnique({ where: { slug } });
  if (!pvTenant) {
    pvTenant = await prisma.pvTenant.create({
      data: { slug, name: 'TOC TOC Postventa Pruebas', status: 'ACTIVE' }
    });
  }
  const pvUser = await upsertByEmail(
    prisma,
    'pvUser',
    postventaEmail,
    {
      tenantId: pvTenant.id,
      email: postventaEmail,
      fullName: 'Postventa TOC TOC Pruebas',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash
    },
    {
      tenantId: pvTenant.id,
      fullName: 'Postventa TOC TOC Pruebas',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash
    }
  );

  await ensureToctocPostventaDemoData(prisma, { tenantId: pvTenant.id, userId: pvUser.id });

  // ——— In & Out ———
  let ioTenant = await prisma.ioTenant.findUnique({ where: { slug } });
  if (!ioTenant) {
    ioTenant = await prisma.ioTenant.create({
      data: { slug, name: 'TOC TOC InOut Pruebas', status: 'ACTIVE' }
    });
  }
  const ioUser = await upsertByEmail(
    prisma,
    'ioUser',
    inoutEmail,
    {
      tenantId: ioTenant.id,
      email: inoutEmail,
      fullName: 'InOut TOC TOC Pruebas',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash
    },
    {
      tenantId: ioTenant.id,
      fullName: 'InOut TOC TOC Pruebas',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash
    }
  );

  return {
    password,
    capture: { email: captureEmail, password, userId: captureUserId, tenantId: bizTenant.id },
    recepcion: { email: entregaEmail, password, userId: entregaUser.id, tenantId: entregaTenant.id },
    postventa: { email: postventaEmail, password, userId: pvUser.id, tenantId: pvTenant.id },
    inout: { email: inoutEmail, password, userId: ioUser.id, tenantId: ioTenant.id },
    businessTenantId: bizTenant.id
  };
}
