/**
 * Ciclo de visitas IN/OUT y Photo Plan.
 */
import crypto from 'node:crypto';
import { buildInOutPhotoPlan } from '../capture/slotPlan.js';

export function newCaptureToken() {
  return `io_${crypto.randomBytes(16).toString('hex')}`;
}

async function createSlotsForVisit(prisma, visitId, plan) {
  if (!plan.length) return;
  await prisma.ioVisitSlot.createMany({
    data: plan.map((s) => ({
      visitId,
      slotCode: s.slotCode,
      title: s.title,
      instructions: s.instructions || null,
      sortOrder: s.sortOrder ?? 0,
      required: s.required !== false,
      status: 'PENDING'
    }))
  });
}

/**
 * Crea propiedad + lease + visita IN con Photo Plan.
 */
export async function createLeaseWithInVisit(prisma, { tenantId, property, lease, userId }) {
  const prop = await prisma.ioProperty.create({
    data: {
      tenantId,
      label: property.label || null,
      address: String(property.address || '').trim(),
      comuna: property.comuna || null,
      propertyType: property.propertyType === 'HOUSE' ? 'HOUSE' : 'DEPARTMENT',
      bedroomsCount: Math.max(0, Number(property.bedroomsCount ?? 1)),
      bathroomsCount: Math.max(1, Number(property.bathroomsCount ?? 1)),
      hasPatio: Boolean(property.hasPatio),
      hasLaundry: Boolean(property.hasLaundry),
      hasParking: Boolean(property.hasParking),
      hasElevator: Boolean(property.hasElevator),
      hasEntranceGrille: Boolean(property.hasEntranceGrille)
    }
  });

  const createdLease = await prisma.ioLease.create({
    data: {
      tenantId,
      propertyId: prop.id,
      cycleStatus: 'in_in_progress',
      tenantName: lease?.tenantName || null,
      tenantRut: lease?.tenantRut || null,
      tenantEmail: lease?.tenantEmail || null,
      tenantPhone: lease?.tenantPhone || null,
      ownerName: lease?.ownerName || null,
      ownerEmail: lease?.ownerEmail || null,
      startDate: lease?.startDate ? new Date(lease.startDate) : null,
      endDate: lease?.endDate ? new Date(lease.endDate) : null,
      notes: lease?.notes || null
    }
  });

  const plan = buildInOutPhotoPlan(prop);
  const visit = await prisma.ioVisit.create({
    data: {
      leaseId: createdLease.id,
      phase: 'IN',
      status: 'IN_PROGRESS',
      captureToken: newCaptureToken(),
      capturedById: userId || null,
      startedAt: new Date()
    }
  });
  await createSlotsForVisit(prisma, visit.id, plan);

  return { property: prop, lease: createdLease, visit, plan };
}

/**
 * Crea visita OUT clonando slots de la IN.
 */
export async function startOutVisit(prisma, { leaseId, tenantId, userId }) {
  const lease = await prisma.ioLease.findFirst({
    where: { id: leaseId, tenantId },
    include: {
      visits: {
        where: { phase: 'IN' },
        include: { slots: { orderBy: { sortOrder: 'asc' } } },
        take: 1
      }
    }
  });
  if (!lease) return { ok: false, error: 'LEASE_NOT_FOUND' };
  if (!['in_completed', 'out_ready'].includes(lease.cycleStatus)) {
    return { ok: false, error: 'IN_NOT_COMPLETED', message: 'La inspección de entrada debe estar completa.' };
  }

  const existingOut = await prisma.ioVisit.findFirst({
    where: { leaseId, phase: 'OUT', status: { not: 'CANCELLED' } }
  });
  if (existingOut) {
    return { ok: true, visit: existingOut, reused: true };
  }

  const inVisit = lease.visits[0];
  if (!inVisit?.slots?.length) {
    return { ok: false, error: 'IN_SLOTS_MISSING' };
  }

  const outVisit = await prisma.ioVisit.create({
    data: {
      leaseId,
      phase: 'OUT',
      status: 'IN_PROGRESS',
      pairedVisitId: inVisit.id,
      captureToken: newCaptureToken(),
      capturedById: userId || null,
      startedAt: new Date()
    }
  });

  await prisma.ioVisitSlot.createMany({
    data: inVisit.slots.map((s) => ({
      visitId: outVisit.id,
      slotCode: s.slotCode,
      title: s.title,
      instructions: s.instructions,
      sortOrder: s.sortOrder,
      required: s.required,
      status: 'PENDING'
    }))
  });

  await prisma.ioLease.update({
    where: { id: leaseId },
    data: { cycleStatus: 'out_in_progress' }
  });

  return { ok: true, visit: outVisit, reused: false };
}

export async function completeVisit(prisma, visitId) {
  const visit = await prisma.ioVisit.findUnique({
    where: { id: visitId },
    include: { slots: true, lease: true }
  });
  if (!visit) return { ok: false, error: 'NOT_FOUND' };

  const pendingRequired = visit.slots.filter(
    (s) => s.required && (s.status === 'PENDING' || s.status === 'NEEDS_RECAPTURE')
  );
  if (pendingRequired.length) {
    return {
      ok: false,
      error: 'SLOTS_PENDING',
      message: `Faltan ${pendingRequired.length} fotografías obligatorias.`
    };
  }

  await prisma.ioVisit.update({
    where: { id: visitId },
    data: { status: 'COMPLETED', completedAt: new Date() }
  });

  // OUT: analyzing → informe auto en background (handlers encolan runDiffAnalysis)
  const cycleStatus = visit.phase === 'IN' ? 'out_ready' : 'analyzing';
  await prisma.ioLease.update({
    where: { id: visit.leaseId },
    data: { cycleStatus }
  });

  return {
    ok: true,
    cycleStatus,
    leaseId: visit.leaseId,
    phase: visit.phase,
    reportQueued: visit.phase === 'OUT'
  };
}

export async function acceptInBaseline(prisma, { leaseId, tenantId, acceptedBy }) {
  const lease = await prisma.ioLease.findFirst({ where: { id: leaseId, tenantId } });
  if (!lease) return { ok: false, error: 'NOT_FOUND' };
  if (!['in_completed', 'out_ready'].includes(lease.cycleStatus)) {
    return { ok: false, error: 'INVALID_STATUS' };
  }
  await prisma.ioLease.update({
    where: { id: leaseId },
    data: {
      inAcceptedAt: new Date(),
      inAcceptedBy: String(acceptedBy || '').slice(0, 191) || null,
      cycleStatus: 'out_ready'
    }
  });
  return { ok: true };
}
