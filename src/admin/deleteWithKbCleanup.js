import { invalidateKbCache } from '../aintelligence/kb/retrieve.js';

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string[]} sourceRefPrefixes
 */
async function deleteKbBySourceRefPrefixes(prisma, sourceRefPrefixes) {
  const prefixes = [...new Set(sourceRefPrefixes.filter(Boolean))];
  if (!prefixes.length) return 0;

  const or = prefixes.flatMap((p) => [
    { sourceRef: { startsWith: p } },
    { sourceRef: { contains: `|${p}` } },
    { sourceRef: { contains: `${p}|` } }
  ]);

  const result = await prisma.knowledgeEntry.deleteMany({ where: { OR: or } });
  return result.count;
}

/**
 * @param {ReturnType<import('../storage/storage.js').createStorage>} storage
 * @param {string | null | undefined} filePath
 */
async function deleteStorageFileBestEffort(storage, filePath, log) {
  if (!filePath || typeof storage.deleteFile !== 'function') return;
  try {
    await storage.deleteFile(filePath);
  } catch (err) {
    log?.warn?.({ err: err?.message, filePath }, 'admin-delete-storage-skip');
  }
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {ReturnType<import('../storage/storage.js').createStorage>} storage
 * @param {string} caseId
 * @param {{ log?: import('pino').Logger }} [opts]
 */
export async function deleteAinspeccionaCase(prisma, storage, caseId, opts = {}) {
  const log = opts.log;
  const ref = String(caseId || '').trim();
  if (!ref) {
    return { ok: false, status: 400, error: 'MISSING_CASE_ID', message: 'caseId es obligatorio.' };
  }

  const caseRow = await prisma.case.findFirst({
    where: { OR: [{ id: ref }, { shortId: ref }] },
    select: {
      id: true,
      shortId: true,
      slots: { select: { id: true, photo: { select: { filePath: true } } } },
      photos: { select: { filePath: true } }
    }
  });

  if (!caseRow) {
    return { ok: false, status: 404, error: 'CASE_NOT_FOUND', message: 'Inspección no encontrada.' };
  }

  const slotIds = caseRow.slots.map((s) => s.id);
  const filePaths = new Set();
  for (const s of caseRow.slots) {
    if (s.photo?.filePath) filePaths.add(s.photo.filePath);
  }
  for (const p of caseRow.photos) {
    if (p.filePath) filePaths.add(p.filePath);
  }

  const kbPrefixes = [`case:${caseRow.id}`, ...slotIds.map((id) => `slot:${id}`)];

  await prisma.$transaction(async (tx) => {
    if (slotIds.length) {
      await tx.slotReview.deleteMany({
        where: { OR: [{ caseId: caseRow.id }, { slotId: { in: slotIds } }] }
      });
    } else {
      await tx.slotReview.deleteMany({ where: { caseId: caseRow.id } });
    }
    await deleteKbBySourceRefPrefixes(tx, kbPrefixes);
    await tx.case.delete({ where: { id: caseRow.id } });
  });

  for (const fp of filePaths) {
    await deleteStorageFileBestEffort(storage, fp, log);
  }

  invalidateKbCache();

  return {
    ok: true,
    deletedCaseId: caseRow.id,
    shortId: caseRow.shortId,
    kbPrefixesRemoved: kbPrefixes.length,
    photosAttempted: filePaths.size
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {ReturnType<import('../storage/storage.js').createStorage>} storage
 * @param {string} ticketRef
 * @param {{ log?: import('pino').Logger }} [opts]
 */
export async function deletePostventaTicket(prisma, storage, ticketRef, opts = {}) {
  const log = opts.log;
  const ref = String(ticketRef || '').trim();
  if (!ref) {
    return { ok: false, status: 400, error: 'MISSING_TICKET_REF', message: 'ticketRef es obligatorio.' };
  }

  const ticket = await prisma.pvTicket.findFirst({
    where: { OR: [{ id: ref }, { shortId: ref }] },
    select: {
      id: true,
      shortId: true,
      captureSessions: {
        select: {
          slots: { select: { photoPath: true } }
        }
      }
    }
  });

  if (!ticket) {
    return { ok: false, status: 404, error: 'TICKET_NOT_FOUND', message: 'Solicitud postventa no encontrada.' };
  }

  const filePaths = new Set();
  for (const session of ticket.captureSessions) {
    for (const slot of session.slots) {
      if (slot.photoPath) filePaths.add(slot.photoPath);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.pvAnalysisReview.deleteMany({ where: { ticketId: ticket.id } });
    await deleteKbBySourceRefPrefixes(tx, [`ticket:${ticket.id}`]);
    await tx.pvTicket.delete({ where: { id: ticket.id } });
  });

  for (const fp of filePaths) {
    await deleteStorageFileBestEffort(storage, fp, log);
  }

  invalidateKbCache();

  return {
    ok: true,
    deletedTicketId: ticket.id,
    shortId: ticket.shortId,
    photosAttempted: filePaths.size
  };
}
