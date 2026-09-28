import crypto from 'node:crypto';
import { sendInspectionApprovalRequestEmail, sendInspectionApprovalDecisionEmail } from '../email.js';
import { trySendTextWithTemplateFallback } from '../whatsapp/send.js';

/**
 * Debita 1 crédito + CONSUMPTION + marca trial si aplica.
 * Usar dentro de una transacción Prisma (`tx`). Lanza INSUFFICIENT_CREDITS si no hay saldo.
 */
export async function consumeOneCreditInTx(tx, { tenantId, caseId, shortId, description }) {
  let account = await tx.tenantCredit.findUnique({ where: { tenantId } });
  if (!account) {
    account = await tx.tenantCredit.create({ data: { tenantId, balance: 0 } });
  }
  if (account.balance < 1) {
    throw new Error('INSUFFICIENT_CREDITS');
  }

  await tx.tenantCredit.update({
    where: { tenantId },
    data: { balance: { decrement: 1 } }
  });

  const tenantTrial = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { trialStatus: true, trialRealInspectionUsedAt: true }
  });
  if (tenantTrial?.trialStatus === 'active' && !tenantTrial.trialRealInspectionUsedAt) {
    await tx.tenant.update({
      where: { id: tenantId },
      data: { trialRealInspectionUsedAt: new Date() }
    });
  }

  await tx.creditTransaction.create({
    data: {
      tenantId,
      amount: -1,
      type: 'CONSUMPTION',
      caseId,
      description: description || `Consumo inspección ${shortId || caseId}`
    }
  });

  return { balance: account.balance - 1 };
}

/** Consume 1 crédito, pasa a IN_PROGRESS y asegura CaptureToken fresco. Limpia approvalToken. */
export async function approvePendingInspectionCase(prisma, { caseId, tenantId, shortId }) {
  const captureExpires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.case.updateMany({
      where: { id: caseId, status: 'PENDING_APPROVAL' },
      data: {
        status: 'IN_PROGRESS',
        approvalToken: null,
        approvalTokenExpiresAt: null
      }
    });
    if (!updated.count) {
      throw new Error('NOT_PENDING_APPROVAL');
    }

    const { balance } = await consumeOneCreditInTx(tx, {
      tenantId,
      caseId,
      shortId,
      description: `Aprobación inspección ${shortId || caseId}`
    });

    // Asegura token de captura activo (no revocar: la app puede seguir con el mismo enlace).
    const nowTs = Date.now();
    const existing = await tx.captureToken.findFirst({
      where: {
        caseId,
        revokedAt: null,
        expiresAt: { gt: new Date(nowTs) }
      },
      orderBy: { createdAt: 'desc' },
      select: { token: true, id: true }
    });

    let captureToken = existing?.token || null;
    if (existing) {
      await tx.captureToken.update({
        where: { id: existing.id },
        data: { expiresAt: captureExpires }
      });
    } else {
      // Reactiva el más reciente si estaba vencido/revocado, o crea uno nuevo.
      const latest = await tx.captureToken.findFirst({
        where: { caseId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, token: true }
      });
      if (latest) {
        await tx.captureToken.update({
          where: { id: latest.id },
          data: { revokedAt: null, expiresAt: captureExpires }
        });
        captureToken = latest.token;
      } else {
        captureToken = crypto.randomUUID();
        await tx.captureToken.create({
          data: {
            tenantId,
            caseId,
            token: captureToken,
            expiresAt: captureExpires
          }
        });
      }
    }

    return { balance, captureToken };
  });

  return result;
}

export async function rejectPendingInspectionCase(prisma, { caseId }) {
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.case.updateMany({
      where: { id: caseId, status: 'PENDING_APPROVAL' },
      data: {
        status: 'CANCELLED',
        approvalToken: null,
        approvalTokenExpiresAt: null
      }
    });
    if (!updated.count) {
      throw new Error('NOT_PENDING_APPROVAL');
    }
    await tx.captureToken.updateMany({
      where: { caseId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    return { ok: true };
  });
  return result;
}

export async function findCaseByApprovalToken(prisma, token) {
  const t = String(token || '').trim();
  if (!t || t.length < 16) return null;
  return prisma.case.findFirst({
    where: { approvalToken: t },
    select: {
      id: true,
      shortId: true,
      status: true,
      tenantId: true,
      approvalTokenExpiresAt: true,
      property: { select: { address: true } },
      assignedUser: { select: { fullName: true, email: true } },
      tenant: { select: { name: true, email: true } }
    }
  });
}

export function approvalTokenIsExpired(c) {
  if (!c?.approvalTokenExpiresAt) return false;
  return new Date(c.approvalTokenExpiresAt).getTime() <= Date.now();
}

export function mintApprovalToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function approvalTokenExpiryDate(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** Email + WhatsApp a admins del tenant (y contacto de la corredora). */
export async function notifyAdminsInspectionApprovalRequest(prisma, req, getEmailWebBase, {
  tenantId,
  approvalToken,
  shortId,
  address = '',
  executiveName = ''
}) {
  const base = getEmailWebBase(req);
  const approveUrl = `${base}/approve-inspection?token=${encodeURIComponent(approvalToken)}&action=approve`;
  const rejectUrl = `${base}/approve-inspection?token=${encodeURIComponent(approvalToken)}&action=reject`;
  const panelUrl = `${base}/tenant`;

  const [tenant, admins] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, email: true, phone: true }
    }),
    prisma.user.findMany({
      where: { tenantId, role: 'TENANT_ADMIN', status: 'ACTIVE' },
      select: { email: true, phone: true, fullName: true }
    })
  ]);

  const emails = new Set();
  const phones = new Set();
  if (tenant?.email) emails.add(String(tenant.email).trim().toLowerCase());
  if (tenant?.phone) phones.add(String(tenant.phone).trim());
  for (const a of admins) {
    if (a.email) emails.add(String(a.email).trim().toLowerCase());
    if (a.phone) phones.add(String(a.phone).trim());
  }

  const mailPayload = {
    approveUrl,
    rejectUrl,
    panelUrl,
    caseShortId: shortId,
    address,
    executiveName,
    tenantName: tenant?.name || ''
  };

  for (const to of emails) {
    try {
      const r = await sendInspectionApprovalRequestEmail(to, mailPayload);
      if (!r?.ok && !r?.skipped) {
        req.log?.warn?.({ to, err: r?.error }, 'inspection-approval-email-failed');
      }
    } catch (err) {
      req.log?.warn?.({ err, to }, 'inspection-approval-email-error');
    }
  }

  const waText =
    `Ainspecciona: ${executiveName || 'Un ejecutivo'} solicita aprobar la inspección ${shortId || ''}` +
    (address ? ` (${address})` : '') +
    `. Al aprobar se consume 1 crédito.\nAprobar: ${approveUrl}`;

  for (const phone of phones) {
    if (!phone) continue;
    try {
      const r = await trySendTextWithTemplateFallback({ to: phone, text: waText, log: req.log });
      if (!r?.ok) {
        req.log?.warn?.({ phone, err: r?.error }, 'inspection-approval-whatsapp-failed');
      }
    } catch (err) {
      req.log?.warn?.({ err, phone }, 'inspection-approval-whatsapp-error');
    }
  }

  return { emails: emails.size, phones: phones.size };
}

/** Email + WhatsApp al ejecutivo asignado cuando el admin aprueba o rechaza. */
export async function notifyExecutiveInspectionDecision(prisma, req, getEmailWebBase, {
  caseId,
  approved,
  shortId,
  captureToken = null
}) {
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      shortId: true,
      property: { select: { address: true } },
      assignedUser: { select: { email: true, phone: true, fullName: true } },
      tenant: { select: { name: true } }
    }
  });
  const exec = c?.assignedUser;
  if (!exec?.email && !exec?.phone) {
    req.log?.warn?.({ caseId, shortId }, 'inspection-decision-no-executive-contact');
    return { emailed: false, whatsapp: false };
  }

  const base = String(getEmailWebBase?.(req) || process.env.PUBLIC_URL || 'https://ainspecciona.com').replace(/\/$/, '');
  const captureUrl = approved && captureToken ? `${base}/capture/${encodeURIComponent(captureToken)}` : '';
  const address = c?.property?.address || '';
  const caseShortId = c?.shortId || shortId || '';

  let emailed = false;
  if (exec.email) {
    try {
      const r = await sendInspectionApprovalDecisionEmail(exec.email, {
        approved: !!approved,
        fullName: exec.fullName || '',
        caseShortId,
        address,
        tenantName: c?.tenant?.name || '',
        captureUrl
      });
      emailed = !!(r?.ok);
      if (!r?.ok && !r?.skipped) {
        req.log?.warn?.({ to: exec.email, err: r?.error }, 'inspection-decision-email-failed');
      }
    } catch (err) {
      req.log?.warn?.({ err, to: exec.email }, 'inspection-decision-email-error');
    }
  }

  let whatsapp = false;
  if (exec.phone) {
    const waText = approved
      ? `Ainspecciona: tu inspección ${caseShortId}${address ? ` (${address})` : ''} fue aprobada. Se consumió 1 crédito. Ya puedes capturar.` +
        (captureUrl ? `\n${captureUrl}` : '')
      : `Ainspecciona: tu inspección ${caseShortId}${address ? ` (${address})` : ''} fue rechazada. No se consumió crédito.`;
    try {
      const r = await trySendTextWithTemplateFallback({ to: exec.phone, text: waText, log: req.log });
      whatsapp = !!(r?.ok);
      if (!r?.ok) {
        req.log?.warn?.({ phone: exec.phone, err: r?.error }, 'inspection-decision-whatsapp-failed');
      }
    } catch (err) {
      req.log?.warn?.({ err, phone: exec.phone }, 'inspection-decision-whatsapp-error');
    }
  }

  return { emailed, whatsapp };
}
