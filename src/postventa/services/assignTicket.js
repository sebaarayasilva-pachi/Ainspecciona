/**
 * Asigna el ticket al inspector default de la obra.
 * - Con inspector → status `asignada` + assignedToUserId
 * - Sin inspector → status `recibido` (bandeja mesa)
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} ticketId
 * @param {{ log?: { info?: Function, warn?: Function } }} [opts]
 */
export async function autoAssignTicketAfterClassified(prisma, ticketId, opts = {}) {
  const log = opts.log || {};
  if (!prisma || !ticketId) return { ok: false, skipped: true };

  const ticket = await prisma.pvTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      tenantId: true,
      projectId: true,
      status: true,
      assignedToUserId: true,
      unit: { select: { projectId: true } }
    }
  });
  if (!ticket) return { ok: false, error: 'TICKET_NOT_FOUND' };

  // No pisar si ya está más adelante en el pipeline operativo
  const skipStatuses = new Set([
    'asignada',
    'programado',
    'en_ejecucion',
    'terminado',
    'closed',
    'rejected'
  ]);
  // Si ya está asignado al inspector correcto y en pipeline, no reescribir
  if (ticket.assignedToUserId && skipStatuses.has(String(ticket.status))) {
    // permitir reasignación solo vía setProjectDefaultInspector (update directo)
    return { ok: true, skipped: true, reason: 'already_past_assign' };
  }

  const projectId = ticket.projectId || ticket.unit?.projectId || null;
  let inspector = null;
  if (projectId) {
    const project = await prisma.pvProject.findFirst({
      where: { id: projectId, tenantId: ticket.tenantId },
      select: {
        id: true,
        defaultInspectorId: true,
        defaultInspector: {
          select: { id: true, fullName: true, email: true, status: true, tenantId: true }
        }
      }
    });
    const u = project?.defaultInspector;
    if (u && u.status === 'ACTIVE' && u.tenantId === ticket.tenantId) {
      inspector = u;
    } else if (project?.defaultInspectorId) {
      // FK rota o usuario disabled
      log.warn?.({ ticketId, projectId, inspectorId: project.defaultInspectorId }, 'postventa-auto-assign-inspector-invalid');
    }
  }

  if (inspector) {
    await prisma.$transaction([
      prisma.pvTicket.update({
        where: { id: ticket.id },
        data: {
          status: 'asignada',
          assignedToUserId: inspector.id,
          assignedAt: new Date()
        }
      }),
      prisma.pvTicketEvent.create({
        data: {
          ticketId: ticket.id,
          eventType: 'auto_assigned',
          payload: {
            assignedToUserId: inspector.id,
            assignedToName: inspector.fullName,
            projectId
          }
        }
      })
    ]);
    log.info?.({ ticketId: ticket.id, inspectorId: inspector.id }, 'postventa-auto-assigned');
    return {
      ok: true,
      status: 'asignada',
      assignedToUserId: inspector.id,
      assignedToName: inspector.fullName
    };
  }

  // Ya en recibida sin inspector: no spamear eventos en re-análisis
  if (ticket.status === 'recibido' && !ticket.assignedToUserId) {
    return { ok: true, status: 'recibido', assignedToUserId: null, skipped: true, reason: 'already_awaiting' };
  }

  await prisma.$transaction([
    prisma.pvTicket.update({
      where: { id: ticket.id },
      data: { status: 'recibido', assignedToUserId: null, assignedAt: null }
    }),
    prisma.pvTicketEvent.create({
      data: {
        ticketId: ticket.id,
        eventType: 'awaiting_inspector',
        payload: {
          projectId,
          reason: projectId ? 'NO_DEFAULT_INSPECTOR' : 'NO_PROJECT'
        }
      }
    })
  ]);
  log.info?.({ ticketId: ticket.id, projectId }, 'postventa-awaiting-inspector');
  return { ok: true, status: 'recibido', assignedToUserId: null };
}

/**
 * Define el inspector default de un proyecto (mantenedor).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} tenantId
 * @param {string} projectSlug
 * @param {string|null} inspectorUserId
 */
export async function setProjectDefaultInspector(prisma, tenantId, projectSlug, inspectorUserId) {
  const slug = String(projectSlug || '').trim();
  const project = await prisma.pvProject.findFirst({
    where: { tenantId, slug }
  });
  if (!project) {
    return { ok: false, status: 404, error: 'PROJECT_NOT_FOUND' };
  }

  let inspectorId = inspectorUserId ? String(inspectorUserId).trim() : null;
  if (inspectorId === '') inspectorId = null;

  if (inspectorId) {
    const user = await prisma.pvUser.findFirst({
      where: { id: inspectorId, tenantId, status: 'ACTIVE' }
    });
    if (!user) {
      return {
        ok: false,
        status: 400,
        error: 'INSPECTOR_INVALID',
        message: 'El inspector debe ser un usuario activo del mismo tenant.'
      };
    }
  }

  const updated = await prisma.pvProject.update({
    where: { id: project.id },
    data: { defaultInspectorId: inspectorId },
    select: {
      id: true,
      slug: true,
      name: true,
      defaultInspectorId: true,
      defaultInspector: {
        select: { id: true, fullName: true, email: true, role: true }
      }
    }
  });

  // Al configurar inspector: asignar/reasignar cola operativa de la obra
  let backfilled = 0;
  if (inspectorId) {
    const pending = await prisma.pvTicket.findMany({
      where: {
        tenantId,
        status: { in: ['recibido', 'classified', 'asignada', 'programado', 'en_ejecucion'] },
        OR: [{ projectId: project.id }, { unit: { projectId: project.id } }]
      },
      select: { id: true, status: true, assignedToUserId: true },
      take: 300
    });
    for (const t of pending) {
      if (t.assignedToUserId === inspectorId) continue;
      const data = {
        assignedToUserId: inspectorId,
        assignedAt: new Date()
      };
      // Llevar a asignada si aún no avanzó a programación/ejecución
      if (['recibido', 'classified', 'asignada'].includes(String(t.status))) {
        data.status = 'asignada';
      }
      await prisma.pvTicket.update({ where: { id: t.id }, data });
      await prisma.pvTicketEvent.create({
        data: {
          ticketId: t.id,
          eventType: 'inspector_reassigned',
          payload: {
            assignedToUserId: inspectorId,
            fromStatus: t.status,
            previousAssigneeId: t.assignedToUserId
          }
        }
      });
      backfilled += 1;
    }
  }

  return {
    ok: true,
    backfilled,
    project: {
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      defaultInspectorId: updated.defaultInspectorId,
      defaultInspector: updated.defaultInspector
        ? {
            id: updated.defaultInspector.id,
            fullName: updated.defaultInspector.fullName,
            email: updated.defaultInspector.email,
            role: updated.defaultInspector.role
          }
        : null
    }
  };
}

/**
 * Usuarios ACTIVE del tenant elegibles como inspector de obra.
 */
export async function listPortalAssignableUsers(prisma, tenantId) {
  const users = await prisma.pvUser.findMany({
    where: { tenantId, status: 'ACTIVE' },
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true, email: true, role: true }
  });
  return { ok: true, users };
}
