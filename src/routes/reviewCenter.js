/**
 * Centro de revisión ITO: cola unificada (Ainspecciona, Property-chk, Postventa)
 * y revisión foto a foto con veredicto OK/corrección que nutre la KB (RAG).
 * Rutas bajo /api/admin/review/* → protegidas por el hook admin existente.
 */
import { createKnowledgeEntry } from '../aintelligence/kb/createEntry.js';
import { embedText } from '../aintelligence/kb/embeddings.js';
import { invalidateKbCache } from '../aintelligence/kb/retrieve.js';
import {
  autoApproveConfig,
  getKpiAccuracyStats,
  invalidateKpiAccuracyCache,
  slotQualifiesForAutoApprove
} from '../aintelligence/kb/kpiAccuracy.js';
import { recordReportCorrection } from '../aintelligence/metrics/analysisAccuracy.js';
import {
  approveAintelligenceFeedback,
  getAintelligenceFeedbackDetail,
  rejectAintelligenceFeedback
} from '../aintelligence/admin/feedbackAdmin.js';
import { getPostventaTicketReport } from '../postventa/services/ticketReport.js';
import { updatePostventaTicketStatus } from '../postventa/services/adminTickets.js';
import { applySlotReviewCorrection } from '../analysis/applySlotReviewCorrection.js';

const VERDICTS = new Set(['ok', 'corrected']);
// Postventa admite además 'sin_falla': no hay falla de fabricación, pero el ticket
// se envía igual a la inmobiliaria con la observación del ITO (nunca auto-rechazo).
const TICKET_VERDICTS = new Set(['ok', 'corrected', 'sin_falla']);

/** Severidad de slot → severidad KB. */
function kbSeverity(s) {
  const v = String(s || '').toLowerCase();
  return ['low', 'medium', 'high', 'critical', 'none'].includes(v) ? v : null;
}

function slotHasFinding(slot) {
  const code = String(slot.analysisCode || '').toUpperCase();
  return !!code && code !== 'OK' && code !== 'NOT_CAPTURABLE';
}

/**
 * Texto canónico de la entrada KB según veredicto.
 * @returns {{ entryType: string, text: string, severity: string | null } | null}
 */
function buildKbFromVerdict(slot, review) {
  const aiCode = String(slot.analysisCode || '').toUpperCase();
  const aiSev = String(slot.analysisSeverity || '').toLowerCase();
  const aiMsg = String(slot.analysisMessage || '').trim();
  const title = String(slot.title || slot.slotCode || '').trim();

  if (review.verdict === 'ok') {
    if (!slotHasFinding(slot)) return null;
    return {
      entryType: 'finding_example',
      severity: kbSeverity(aiSev),
      text: `[${title}] Hallazgo confirmado por revisor: «${aiMsg}» (código ${aiCode}${aiSev ? `, severidad ${aiSev}` : ''}). Este criterio de clasificación es correcto.`
    };
  }

  const humanCode = String(review.humanCode || '').toUpperCase();
  const humanSev = String(review.humanSeverity || '').toLowerCase();
  const humanMsg = String(review.humanMessage || '').trim();
  const note = String(review.note || '').trim();

  if (humanCode === 'OK' || !humanCode) {
    // Falso positivo: la IA marcó hallazgo y el revisor lo descartó.
    return {
      entryType: 'anti_example',
      severity: 'none',
      text: `[${title}] NO clasificar como ${aiCode || 'hallazgo'} cuando solo se observa: «${aiMsg || '—'}». El revisor determinó que no hay hallazgo.${note ? ` Nota: ${note}` : ''}`
    };
  }

  return {
    entryType: 'correction',
    severity: kbSeverity(humanSev),
    text: `[${title}] La IA clasificó ${aiCode || '—'}${aiSev ? `/${aiSev}` : ''}: «${aiMsg || '—'}». Criterio correcto: ${humanCode}${humanSev ? `/${humanSev}` : ''}${humanMsg ? `: «${humanMsg}»` : ''}.${note ? ` Nota: ${note}` : ''}`
  };
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {object} deps
 * @param {import('@prisma/client').PrismaClient | null} deps.prisma
 * @param {object} deps.storage
 * @param {Function} [deps.classifyKpiFromSlot]
 * @param {Function} [deps.getRuntimeScoreConfig]
 * @param {Function} [deps.applyScoreConfigUpdate]
 * @param {Function} [deps.queuePostventaTicketAnalysis]
 * @param {string} [deps.reviewerEmailDefault]
 */
export async function registerReviewCenterRoutes(app, deps) {
  const {
    prisma,
    storage,
    classifyKpiFromSlot,
    getRuntimeScoreConfig,
    applyScoreConfigUpdate,
    queuePostventaTicketAnalysis,
    reviewerEmailDefault
  } = deps;
  if (!prisma) {
    app.log.warn('review center: prisma no disponible');
    return;
  }

  // ── Cola unificada de pendientes (3 fuentes) ──────────────────────────────
  app.get('/api/admin/review/queue', async (req, reply) => {
    try {
      const [cases, feedback, tickets] = await Promise.all([
        prisma.case.findMany({
          where: { reviewStatus: 'pending_review' },
          orderBy: { createdAt: 'asc' },
          take: 100,
          select: {
            id: true,
            shortId: true,
            createdAt: true,
            tenant: { select: { name: true } },
            property: { select: { address: true } },
            slots: { select: { id: true, analysisCode: true, photoId: true } }
          }
        }),
        prisma.aiFeedback.findMany({
          where: { status: 'draft' },
          orderBy: { createdAt: 'asc' },
          take: 100,
          select: {
            id: true,
            createdAt: true,
            kpiKey: true,
            planItemId: true,
            externalInspectionId: true,
            source: true
          }
        }),
        prisma.pvTicket.findMany({
          where: { status: 'classified' },
          orderBy: { createdAt: 'asc' },
          take: 100,
          select: {
            id: true,
            shortId: true,
            createdAt: true,
            summary: true,
            preliminaryCategory: true,
            tenant: { select: { name: true } },
            aiAnalyses: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { severity: true, status: true, report: true }
            }
          }
        })
      ]);

      const now = Date.now();
      const ageHoursOf = (d) => Math.floor((now - new Date(d).getTime()) / 3600000);
      // Prioridad determinista: urgencia IA > volumen de hallazgos > antigüedad.
      const priorityOf = (it) => {
        let p = 0;
        if (it.urgencyFlag) p += 50;
        if (['high', 'critical'].includes(String(it.severity || ''))) p += 30;
        else if (it.severity === 'medium') p += 10;
        if (Number(it.findingsCount) >= 8) p += 20;
        else if (Number(it.findingsCount) >= 4) p += 10;
        if (it.ageHours >= 72) p += 15;
        else if (it.ageHours >= 48) p += 10;
        else if (it.ageHours >= 24) p += 5;
        return p;
      };

      const items = [
        ...cases.map((c) => ({
          source: 'AINSPECTA',
          kind: 'case_review',
          refId: c.shortId || c.id,
          title: c.property?.address || `Caso ${c.shortId || c.id}`,
          subtitle: c.tenant?.name || null,
          tenantName: c.tenant?.name || null,
          groupKey: null,
          findingsCount: c.slots.filter((s) => {
            const code = String(s.analysisCode || '').toUpperCase();
            return code && code !== 'OK' && code !== 'NOT_CAPTURABLE';
          }).length,
          slotsWithPhoto: c.slots.filter((s) => s.photoId).length,
          createdAt: c.createdAt,
          ageHours: ageHoursOf(c.createdAt)
        })),
        ...feedback.map((f) => ({
          source: 'PROPERTYCHECK',
          kind: 'feedback_curation',
          refId: f.id,
          title: `Feedback ${f.planItemId || f.id.slice(0, 8)}`,
          subtitle: f.kpiKey || f.externalInspectionId || null,
          tenantName: null,
          groupKey: f.kpiKey || null,
          createdAt: f.createdAt,
          ageHours: ageHoursOf(f.createdAt)
        })),
        ...tickets.map((t) => {
          const analysis = t.aiAnalyses[0] || null;
          return {
            source: 'POSTVENTA',
            kind: 'ticket_validation',
            refId: t.shortId || t.id,
            title: String(t.summary || '').slice(0, 120) || `Ticket ${t.shortId}`,
            subtitle: [t.tenant?.name, t.preliminaryCategory].filter(Boolean).join(' · ') || null,
            tenantName: t.tenant?.name || null,
            groupKey: t.preliminaryCategory || null,
            severity: analysis?.severity || null,
            urgencyFlag: analysis?.report?.urgency_flag === true,
            createdAt: t.createdAt,
            ageHours: ageHoursOf(t.createdAt)
          };
        })
      ];
      for (const it of items) it.priority = priorityOf(it);
      items.sort((a, b) => b.priority - a.priority || new Date(a.createdAt) - new Date(b.createdAt));

      return reply.send({
        ok: true,
        counts: {
          AINSPECTA: cases.length,
          PROPERTYCHECK: feedback.length,
          POSTVENTA: tickets.length,
          total: items.length
        },
        items
      });
    } catch (err) {
      req.log.error({ err }, 'review-queue');
      return reply.code(500).send({ ok: false, error: 'QUEUE_FAILED' });
    }
  });

  // ── Ainspecciona: slots del caso para revisión foto a foto ────────────────
  app.get('/api/admin/review/cases/:caseId/slots', async (req, reply) => {
    try {
      const rawId = String(req.params.caseId || '');
      const c = await prisma.case.findFirst({
        where: { OR: [{ id: rawId }, { shortId: rawId }] },
        select: {
          id: true,
          shortId: true,
          reviewStatus: true,
          tenantId: true,
          tenant: { select: { name: true } },
          property: { select: { address: true } }
        }
      });
      if (!c) return reply.code(404).send({ ok: false, error: 'CASE_NOT_FOUND' });

      const slots = await prisma.slot.findMany({
        where: { caseId: c.id, photoId: { not: null } },
        orderBy: { orderIndex: 'asc' },
        include: { photo: { select: { filePath: true } } }
      });
      const reviews = await prisma.slotReview.findMany({
        where: { caseId: c.id }
      });
      const reviewBySlot = new Map(reviews.map((r) => [r.slotId, r]));

      // Umbral de confianza: slots benignos en KPIs con historial confiable se pueden auto-validar.
      const autoCfg = autoApproveConfig();
      let kpiStats = {};
      let slotKpiMap;
      try {
        const cfg = typeof getRuntimeScoreConfig === 'function' ? (await getRuntimeScoreConfig()).config : undefined;
        slotKpiMap = cfg?.slotKpiMap;
        kpiStats = await getKpiAccuracyStats(prisma, classifyKpiFromSlot, slotKpiMap);
      } catch (err) {
        req.log.warn({ err: err?.message }, 'review-kpi-stats-failed');
      }

      return reply.send({
        ok: true,
        case: {
          id: c.id,
          shortId: c.shortId,
          reviewStatus: c.reviewStatus,
          tenantName: c.tenant?.name || null,
          address: c.property?.address || null
        },
        autoApproveConfig: autoCfg,
        slots: slots.map((s) => {
          const r = reviewBySlot.get(s.id) || null;
          const kpiKey = typeof classifyKpiFromSlot === 'function'
            ? String(classifyKpiFromSlot(s, slotKpiMap) || '').toUpperCase() || null
            : null;
          const kpiStat = kpiKey ? kpiStats[kpiKey] : undefined;
          return {
            id: s.id,
            slotCode: s.slotCode,
            title: s.title,
            kpiKey,
            photoUrl: s.photo?.filePath ? storage.publicUrl(s.photo.filePath) : null,
            analysis: {
              code: s.analysisCode,
              severity: s.analysisSeverity,
              message: s.analysisMessage,
              confidence: s.analysisConfidence
            },
            autoApprove: !r && slotQualifiesForAutoApprove(s, kpiStat, autoCfg),
            kpiAccuracy: kpiStat ? { accuracyPct: kpiStat.accuracyPct, reviews: kpiStat.total } : null,
            review: r
              ? {
                  verdict: r.verdict,
                  humanCode: r.humanCode,
                  humanSeverity: r.humanSeverity,
                  humanMessage: r.humanMessage,
                  note: r.note,
                  reviewedAt: r.reviewedAt
                }
              : null
          };
        })
      });
    } catch (err) {
      req.log.error({ err }, 'review-case-slots');
      return reply.code(500).send({ ok: false, error: 'SLOTS_FAILED' });
    }
  });

  // ── Ainspecciona: veredicto por slot (OK / corrección) → KB ───────────────
  app.post('/api/admin/review/cases/:caseId/slots/:slotId', async (req, reply) => {
    try {
      const rawId = String(req.params.caseId || '');
      const slotId = String(req.params.slotId || '');
      const body = req.body || {};
      const verdict = String(body.verdict || '').toLowerCase();

      if (!VERDICTS.has(verdict)) {
        return reply.code(400).send({ ok: false, error: 'INVALID_VERDICT', hint: "verdict: 'ok' | 'corrected'" });
      }

      const c = await prisma.case.findFirst({
        where: { OR: [{ id: rawId }, { shortId: rawId }] },
        select: { id: true, tenantId: true }
      });
      if (!c) return reply.code(404).send({ ok: false, error: 'CASE_NOT_FOUND' });

      const slot = await prisma.slot.findFirst({
        where: { id: slotId, caseId: c.id }
      });
      if (!slot) return reply.code(404).send({ ok: false, error: 'SLOT_NOT_FOUND' });

      const reviewerEmail =
        String(req.headers['x-reviewer-email'] || '').trim() || reviewerEmailDefault || null;

      const reviewData = {
        verdict,
        humanCode: verdict === 'corrected' ? String(body.humanCode || '').toUpperCase().slice(0, 64) || null : null,
        humanSeverity: verdict === 'corrected' ? String(body.humanSeverity || '').toLowerCase().slice(0, 16) || null : null,
        humanMessage: verdict === 'corrected' ? String(body.humanMessage || '').slice(0, 4000) || null : null,
        humanKpiKey: verdict === 'corrected' ? String(body.humanKpiKey || '').toUpperCase().slice(0, 64) || null : null,
        note: String(body.note || '').slice(0, 2000) || null,
        reviewerEmail,
        reviewedAt: new Date()
      };

      const review = await prisma.slotReview.upsert({
        where: { slotId: slot.id },
        create: { slotId: slot.id, caseId: c.id, ...reviewData },
        update: reviewData
      });
      invalidateKpiAccuracyCache();

      // Nutrir KB: OK confirma criterio IA; corrección enseña criterio humano.
      // Usar el slot ANTES de aplicar la corrección al informe.
      let kb = null;
      const kbDef = buildKbFromVerdict(slot, reviewData);
      if (kbDef) {
        let kpiKey = reviewData.humanKpiKey;
        if (!kpiKey && typeof classifyKpiFromSlot === 'function') {
          try {
            const cfg = typeof getRuntimeScoreConfig === 'function' ? (await getRuntimeScoreConfig()).config : undefined;
            kpiKey = classifyKpiFromSlot(
              {
                findingCode: verdict === 'corrected' ? reviewData.humanCode : slot.analysisCode,
                slotCode: slot.slotCode,
                title: slot.title,
                message: reviewData.humanMessage || slot.analysisMessage || ''
              },
              cfg?.slotKpiMap
            );
          } catch {
            kpiKey = null;
          }
        }

        kb = await createKnowledgeEntry(
          prisma,
          {
            source: 'AINSPECTA',
            entryType: kbDef.entryType,
            text: kbDef.text,
            kpiKey: kpiKey || null,
            severity: kbDef.severity,
            payload: {
              ai: {
                code: slot.analysisCode,
                severity: slot.analysisSeverity,
                message: slot.analysisMessage
              },
              human: verdict === 'corrected'
                ? {
                    code: reviewData.humanCode,
                    severity: reviewData.humanSeverity,
                    message: reviewData.humanMessage
                  }
                : { confirmed: true },
              slotCode: slot.slotCode,
              note: reviewData.note
            },
            sourceRef: `case:${c.id}|slot:${slot.id}`,
            createdBy: reviewerEmail,
            status: 'approved'
          },
          req.log
        );
      }

      // Informe: la corrección ITO debe reflejarse en el Slot (score, PDF, report.html).
      let appliedToReport = false;
      if (verdict === 'corrected') {
        const patch = await applySlotReviewCorrection(prisma, slot, reviewData);
        appliedToReport = !!patch;
      }

      return reply.send({
        ok: true,
        reviewId: review.id,
        verdict,
        appliedToReport,
        kb: kb
          ? { entryId: kb.ok ? kb.entryId : null, duplicate: kb.ok ? kb.duplicate : false, error: kb.ok ? null : kb.error }
          : { skipped: true, reason: 'SIN_HALLAZGO' }
      });
    } catch (err) {
      req.log.error({ err }, 'review-slot-verdict');
      return reply.code(500).send({ ok: false, error: 'VERDICT_FAILED' });
    }
  });

  // ── Ainspecciona: finalizar revisión → métrica real de exactitud ──────────
  app.post('/api/admin/review/cases/:caseId/finish', async (req, reply) => {
    try {
      const rawId = String(req.params.caseId || '');
      const c = await prisma.case.findFirst({
        where: { OR: [{ id: rawId }, { shortId: rawId }] },
        select: { id: true, shortId: true, tenantId: true }
      });
      if (!c) return reply.code(404).send({ ok: false, error: 'CASE_NOT_FOUND' });

      const caseSlots = await prisma.slot.findMany({
        where: { caseId: c.id, photoId: { not: null } },
        select: { id: true, slotCode: true, title: true, analysisCode: true, analysisSeverity: true }
      });
      const slotsTotal = caseSlots.length;
      let reviews = await prisma.slotReview.findMany({
        where: { caseId: c.id },
        select: { slotId: true, verdict: true }
      });
      const reviewedIds = new Set(reviews.map((r) => r.slotId));

      // Umbral de confianza: auto-validar pendientes benignos en KPIs confiables (recalculado server-side).
      const autoCfg = autoApproveConfig();
      let autoApproved = 0;
      const pending = caseSlots.filter((s) => !reviewedIds.has(s.id));
      if (pending.length) {
        let kpiStats = {};
        let slotKpiMap;
        try {
          const cfg = typeof getRuntimeScoreConfig === 'function' ? (await getRuntimeScoreConfig()).config : undefined;
          slotKpiMap = cfg?.slotKpiMap;
          kpiStats = await getKpiAccuracyStats(prisma, classifyKpiFromSlot, slotKpiMap);
        } catch {}

        const notQualifying = [];
        for (const s of pending) {
          const kpiKey = typeof classifyKpiFromSlot === 'function'
            ? String(classifyKpiFromSlot(s, slotKpiMap) || '').toUpperCase()
            : '';
          if (slotQualifiesForAutoApprove(s, kpiStats[kpiKey], autoCfg)) {
            await prisma.slotReview.upsert({
              where: { slotId: s.id },
              create: {
                slotId: s.id,
                caseId: c.id,
                verdict: 'ok',
                note: `Auto-validado por umbral de confianza (KPI ${kpiKey || '—'}: ${kpiStats[kpiKey]?.accuracyPct ?? '—'}% en ${kpiStats[kpiKey]?.total ?? 0} revisiones)`,
                reviewerEmail: 'auto:kpi-confianza'
              },
              update: {}
            });
            autoApproved += 1;
          } else {
            notQualifying.push(s);
          }
        }

        if (notQualifying.length) {
          return reply.code(400).send({
            ok: false,
            error: 'REVIEW_INCOMPLETE',
            reviewed: reviewedIds.size,
            slotsTotal,
            pendingSlots: notQualifying.map((s) => ({ id: s.id, slotCode: s.slotCode, title: s.title })),
            hint: `Faltan ${notQualifying.length} slot(s) que requieren veredicto del ITO (no califican para auto-validación).`
          });
        }

        reviews = await prisma.slotReview.findMany({
          where: { caseId: c.id },
          select: { slotId: true, verdict: true }
        });
      }

      const corrected = reviews.filter((r) => r.verdict === 'corrected');

      const correctedReviews = await prisma.slotReview.findMany({
        where: { caseId: c.id, verdict: 'corrected' }
      });
      const correctedSlots = await prisma.slot.findMany({
        where: { id: { in: correctedReviews.map((r) => r.slotId) } }
      });
      const slotById = new Map(correctedSlots.map((s) => [s.id, s]));
      let appliedToReport = 0;
      for (const rev of correctedReviews) {
        const s = slotById.get(rev.slotId);
        if (!s) continue;
        const patch = await applySlotReviewCorrection(prisma, s, rev);
        if (patch) appliedToReport += 1;
      }

      await recordReportCorrection(prisma, {
        source: 'AINSPECTA',
        caseId: c.id,
        caseShortId: c.shortId,
        tenantId: c.tenantId,
        slotsCorrected: corrected.length,
        slotsTotal: Math.max(1, slotsTotal),
        slotCodes: correctedSlots.map((s) => s.slotCode)
      });

      return reply.send({
        ok: true,
        finished: true,
        slotsTotal,
        slotsCorrected: corrected.length,
        appliedToReport,
        autoApproved,
        accuracyPct: slotsTotal > 0 ? Math.round((1000 * (slotsTotal - corrected.length)) / slotsTotal) / 10 : null,
        nextStep: 'Llama a POST /api/cases/:caseId/approve para aprobar y notificar (flujo existente).'
      });
    } catch (err) {
      req.log.error({ err }, 'review-case-finish');
      return reply.code(500).send({ ok: false, error: 'FINISH_FAILED' });
    }
  });

  // ══════════════════ Property-chk (AiFeedback) ══════════════════

  app.get('/api/admin/review/feedback/:id', async (req, reply) => {
    try {
      const result = await getAintelligenceFeedbackDetail(prisma, storage, req.params.id);
      if (!result.ok) return reply.code(result.status || 404).send(result);
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, 'review-feedback-detail');
      return reply.code(500).send({ ok: false, error: 'DETAIL_FAILED' });
    }
  });

  /**
   * Veredicto Property-chk:
   * - ok: aprueba el feedback tal cual (label humano del inspector ya es el criterio) → KB finding_example
   * - corrected: aprueba con overrides del ITO (signal/severity/nota) → KB correction
   * - rejected: rechaza (sin aporte a KB)
   * Mantiene el flujo legado (aiFindingExamples en score config) y suma la KB unificada.
   */
  app.post('/api/admin/review/feedback/:id', async (req, reply) => {
    try {
      const body = req.body || {};
      const verdict = String(body.verdict || '').toLowerCase();
      if (!['ok', 'corrected', 'rejected'].includes(verdict)) {
        return reply.code(400).send({ ok: false, error: 'INVALID_VERDICT', hint: "verdict: 'ok' | 'corrected' | 'rejected'" });
      }

      const reviewerEmail =
        String(req.headers['x-reviewer-email'] || '').trim() || reviewerEmailDefault || null;

      if (verdict === 'rejected') {
        const result = await rejectAintelligenceFeedback({
          prisma,
          storage,
          id: req.params.id,
          body: { notes: body.note }
        });
        if (!result.ok) return reply.code(result.status || 400).send(result);
        return reply.send({ ok: true, verdict, item: result.item, kb: { skipped: true, reason: 'RECHAZADO' } });
      }

      const approveBody =
        verdict === 'corrected'
          ? { signal: body.signal, severity: body.severity, notes: body.note }
          : { notes: body.note };

      const result = await approveAintelligenceFeedback({
        prisma,
        storage,
        id: req.params.id,
        body: approveBody,
        getRuntimeScoreConfig,
        applyScoreConfigUpdate
      });
      if (!result.ok) return reply.code(result.status || 400).send(result);

      const item = result.item;
      const example = result.kbExample || {};
      const signal = example.signal || item.humanSignal || '';
      const severity = kbSeverity(example.severity || item.humanSeverity);
      const note = String(body.note || '').trim();

      const kb = await createKnowledgeEntry(
        prisma,
        {
          source: 'PROPERTYCHECK',
          entryType: verdict === 'corrected' ? 'correction' : 'finding_example',
          text:
            verdict === 'corrected'
              ? `[${item.kpiKey || 'GENERAL'}] La señal reportada era «${item.humanSignal || item.aiDescription || '—'}»; el ITO corrigió el criterio a: «${signal}»${severity ? ` (severidad ${severity})` : ''}.${note ? ` Nota: ${note}` : ''}`
              : `[${item.kpiKey || 'GENERAL'}] Señal validada por ITO: «${signal}»${severity ? ` (severidad ${severity})` : ''}.${note ? ` Nota: ${note}` : ''}`,
          kpiKey: item.kpiKey || null,
          severity,
          payload: {
            ai: { description: item.aiDescription, signals: item.aiSignals },
            human: { signal, severity, note: note || null },
            externalInspectionId: item.externalInspectionId
          },
          sourceRef: `feedback:${item.id}`,
          createdBy: reviewerEmail,
          status: 'approved'
        },
        req.log
      );

      return reply.send({
        ok: true,
        verdict,
        item,
        kbLegacy: { example: result.kbExample, duplicate: result.kbDuplicate },
        kb: kb.ok
          ? { entryId: kb.entryId, duplicate: kb.duplicate }
          : { entryId: null, error: kb.error }
      });
    } catch (err) {
      req.log.error({ err }, 'review-feedback-verdict');
      return reply.code(500).send({ ok: false, error: 'VERDICT_FAILED' });
    }
  });

  // ══════════════════ Postventa (PvTicket) ══════════════════

  app.get('/api/admin/review/tickets/:ticketRef', async (req, reply) => {
    try {
      const report = await getPostventaTicketReport(prisma, req.params.ticketRef);
      if (!report.ok) return reply.code(report.status || 404).send(report);

      // Fotos de la última sesión de captura (el reporte base no incluye URLs).
      const session = await prisma.pvCaptureSession.findFirst({
        where: { ticketId: report.ticket.id },
        orderBy: { createdAt: 'desc' },
        include: { slots: { orderBy: { sortOrder: 'asc' } } }
      });
      const photos = (session?.slots || [])
        .filter((s) => s.photoPath)
        .map((s) => ({
          slotCode: s.slotCode,
          title: s.title,
          status: s.status,
          mimeType: s.mimeType,
          photoUrl: storage.publicUrl(s.photoPath)
        }));

      const reviews = await prisma.pvAnalysisReview.findMany({
        where: { ticketId: report.ticket.id },
        orderBy: { reviewedAt: 'desc' }
      });

      return reply.send({
        ok: true,
        ticket: report.ticket,
        analysis: report.analysis,
        photos,
        reviews: reviews.map((r) => ({
          id: r.id,
          slotCode: r.slotCode,
          verdict: r.verdict,
          humanCategory: r.humanCategory,
          humanSeverity: r.humanSeverity,
          humanMessage: r.humanMessage,
          note: r.note,
          reviewedAt: r.reviewedAt
        }))
      });
    } catch (err) {
      req.log.error({ err }, 'review-ticket-detail');
      return reply.code(500).send({ ok: false, error: 'DETAIL_FAILED' });
    }
  });

  /**
   * Veredicto Postventa por hallazgo: slotCode null = veredicto global del diagnóstico.
   * ok → KB ticket_learning (diagnóstico confirmado); corrected → KB correction.
   */
  app.post('/api/admin/review/tickets/:ticketRef/verdict', async (req, reply) => {
    try {
      const body = req.body || {};
      const verdict = String(body.verdict || '').toLowerCase();
      if (!TICKET_VERDICTS.has(verdict)) {
        return reply.code(400).send({ ok: false, error: 'INVALID_VERDICT', hint: "verdict: 'ok' | 'corrected' | 'sin_falla'" });
      }

      const ref = String(req.params.ticketRef || '').trim();
      const ticket = await prisma.pvTicket.findFirst({
        where: { OR: [{ id: ref }, { shortId: ref }] },
        select: {
          id: true,
          shortId: true,
          summary: true,
          preliminaryCategory: true,
          aiAnalyses: { orderBy: { createdAt: 'desc' }, take: 1 }
        }
      });
      if (!ticket) return reply.code(404).send({ ok: false, error: 'TICKET_NOT_FOUND' });

      const analysis = ticket.aiAnalyses[0] || null;
      const slotCode = String(body.slotCode || '').slice(0, 64) || null;
      const reviewerEmail =
        String(req.headers['x-reviewer-email'] || '').trim() || reviewerEmailDefault || null;

      const reviewData = {
        verdict,
        humanCategory: verdict === 'corrected' ? String(body.humanCategory || '').slice(0, 64) || null : null,
        humanSeverity:
          verdict === 'corrected'
            ? String(body.humanSeverity || '').toLowerCase().slice(0, 16) || null
            : verdict === 'sin_falla'
              ? 'none'
              : null,
        humanMessage: ['corrected', 'sin_falla'].includes(verdict) ? String(body.humanMessage || '').slice(0, 4000) || null : null,
        note: String(body.note || '').slice(0, 2000) || null,
        reviewerEmail,
        reviewedAt: new Date()
      };

      // No upsert: la clave única compuesta tiene columnas nullable (analysisId/slotCode).
      const existing = await prisma.pvAnalysisReview.findFirst({
        where: { ticketId: ticket.id, analysisId: analysis?.id || null, slotCode }
      });
      const review = existing
        ? await prisma.pvAnalysisReview.update({ where: { id: existing.id }, data: reviewData })
        : await prisma.pvAnalysisReview.create({
            data: { ticketId: ticket.id, analysisId: analysis?.id || null, slotCode, ...reviewData }
          });

      // Texto KB según alcance (global vs por evidencia).
      const report = analysis?.report || {};
      const aiCategory = report?.category_assessment?.confirmed_category || ticket.preliminaryCategory;
      const aiSeverity = analysis?.severity || report?.severity || null;
      const scopeLabel = slotCode ? `evidencia ${slotCode}` : 'diagnóstico del ticket';
      const aiFinding = slotCode
        ? (Array.isArray(report?.evidence_review)
            ? report.evidence_review.find((e) => e.slot_code === slotCode)?.observation
            : null) || ''
        : report?.finding_description || analysis?.summaryText || ticket.summary;

      let kbDef;
      if (verdict === 'ok') {
        kbDef = {
          entryType: 'ticket_learning',
          severity: kbSeverity(aiSeverity),
          text: `[Postventa · ${aiCategory}] ${scopeLabel} confirmado por revisor: «${String(aiFinding || '').slice(0, 600)}»${aiSeverity ? ` (severidad ${aiSeverity})` : ''}.${reviewData.note ? ` Nota: ${reviewData.note}` : ''}`
        };
      } else if (verdict === 'sin_falla') {
        const obs = reviewData.humanMessage || String(aiFinding || '').slice(0, 400);
        kbDef = {
          entryType: 'anti_example',
          severity: 'none',
          text: `[Postventa · ${aiCategory}] Reclamo SIN falla de fabricación según revisor (${scopeLabel}). Observación: «${obs}». No clasificar este patrón como falla; corresponde típicamente a uso, desgaste o falta de mantención. El ticket se informa igual a la inmobiliaria con esta observación.${reviewData.note ? ` Nota: ${reviewData.note}` : ''}`
        };
      } else {
        const humanCat = reviewData.humanCategory || aiCategory;
        kbDef = {
          entryType: 'correction',
          severity: kbSeverity(reviewData.humanSeverity),
          text: `[Postventa · ${humanCat}] La IA evaluó el ${scopeLabel} como ${aiCategory}${aiSeverity ? `/${aiSeverity}` : ''}: «${String(aiFinding || '').slice(0, 400)}». Criterio correcto: ${humanCat}${reviewData.humanSeverity ? `/${reviewData.humanSeverity}` : ''}${reviewData.humanMessage ? `: «${reviewData.humanMessage}»` : ''}.${reviewData.note ? ` Nota: ${reviewData.note}` : ''}`
        };
      }

      const kb = await createKnowledgeEntry(
        prisma,
        {
          source: 'POSTVENTA',
          entryType: kbDef.entryType,
          text: kbDef.text,
          category: (verdict === 'corrected' && reviewData.humanCategory) || aiCategory || null,
          severity: kbDef.severity,
          payload: {
            ai: { category: aiCategory, severity: aiSeverity, finding: aiFinding },
            human:
              verdict === 'corrected'
                ? { category: reviewData.humanCategory, severity: reviewData.humanSeverity, message: reviewData.humanMessage }
                : verdict === 'sin_falla'
                  ? { sinFalla: true, message: reviewData.humanMessage }
                  : { confirmed: true },
            slotCode,
            note: reviewData.note
          },
          sourceRef: `ticket:${ticket.id}${analysis ? `|analysis:${analysis.id}` : ''}${slotCode ? `|slot:${slotCode}` : ''}`,
          createdBy: reviewerEmail,
          status: 'approved'
        },
        req.log
      );

      return reply.send({
        ok: true,
        reviewId: review.id,
        verdict,
        slotCode,
        kb: kb.ok
          ? { entryId: kb.entryId, duplicate: kb.duplicate }
          : { entryId: null, error: kb.error }
      });
    } catch (err) {
      req.log.error({ err }, 'review-ticket-verdict');
      return reply.code(500).send({ ok: false, error: 'VERDICT_FAILED' });
    }
  });

  // Finalizar revisión postventa: saca el ticket de la cola (status in_review) y registra el evento.
  app.post('/api/admin/review/tickets/:ticketRef/finish', async (req, reply) => {
    try {
      const result = await updatePostventaTicketStatus(prisma, req.params.ticketRef, {
        status: 'in_review',
        note: 'Revisión ITO completada en el centro de revisión'
      });
      if (result.status && result.status >= 400) return reply.code(result.status).send(result);
      return reply.send({ ok: true, finished: true, ticketId: result.ticketId, status: result.status });
    } catch (err) {
      req.log.error({ err }, 'review-ticket-finish');
      return reply.code(500).send({ ok: false, error: 'FINISH_FAILED' });
    }
  });

  // Re-análisis IA del ticket (mismo flujo que admin): vuelve a la cola al terminar.
  app.post('/api/admin/review/tickets/:ticketRef/reanalyze', async (req, reply) => {
    try {
      const ref = String(req.params.ticketRef || '').trim();
      const ticket = await prisma.pvTicket.findFirst({
        where: { OR: [{ id: ref }, { shortId: ref }] },
        select: { id: true, shortId: true }
      });
      if (!ticket) return reply.code(404).send({ ok: false, error: 'TICKET_NOT_FOUND' });

      await prisma.pvTicket.update({
        where: { id: ticket.id },
        data: { status: 'pending_ai_analysis' }
      });
      if (typeof queuePostventaTicketAnalysis === 'function') {
        queuePostventaTicketAnalysis({ ticketId: ticket.id });
      }
      await prisma.pvTicketEvent.create({
        data: {
          ticketId: ticket.id,
          eventType: 'review_reanalyze_requested',
          payload: {}
        }
      });

      return reply.send({ ok: true, queued: true, ticketId: ticket.id, shortId: ticket.shortId });
    } catch (err) {
      req.log.error({ err }, 'review-ticket-reanalyze');
      return reply.code(500).send({ ok: false, error: 'REANALYZE_FAILED' });
    }
  });

  // ══════════════════ Biblioteca KB (curación) ══════════════════

  app.get('/api/admin/review/kb', async (req, reply) => {
    try {
      const q = req.query || {};
      const where = {};
      if (q.status) where.status = String(q.status);
      if (q.source) where.source = String(q.source).toUpperCase();
      if (q.entryType) where.entryType = String(q.entryType);
      if (q.q) where.text = { contains: String(q.q).slice(0, 200) };
      const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
      const offset = Math.max(0, Number(q.offset) || 0);

      const [rows, total, counts] = await Promise.all([
        prisma.knowledgeEntry.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
          select: {
            id: true,
            source: true,
            entryType: true,
            status: true,
            kpiKey: true,
            category: true,
            severity: true,
            text: true,
            sourceRef: true,
            embeddingModel: true,
            createdBy: true,
            createdAt: true,
            updatedAt: true
          }
        }),
        prisma.knowledgeEntry.count({ where }),
        prisma.knowledgeEntry.groupBy({ by: ['status'], _count: { _all: true } })
      ]);

      return reply.send({
        ok: true,
        total,
        limit,
        offset,
        counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
        items: rows
      });
    } catch (err) {
      req.log.error({ err }, 'review-kb-list');
      return reply.code(500).send({ ok: false, error: 'KB_LIST_FAILED' });
    }
  });

  app.patch('/api/admin/review/kb/:id', async (req, reply) => {
    try {
      const body = req.body || {};
      const entry = await prisma.knowledgeEntry.findUnique({ where: { id: String(req.params.id) } });
      if (!entry) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

      const data = {};
      if (body.status !== undefined) {
        const status = String(body.status);
        if (!['candidate', 'approved', 'rejected', 'disabled'].includes(status)) {
          return reply.code(400).send({ ok: false, error: 'INVALID_STATUS' });
        }
        data.status = status;
      }
      if (body.severity !== undefined) {
        const sev = String(body.severity || '').toLowerCase();
        data.severity = ['low', 'medium', 'high', 'critical', 'none'].includes(sev) ? sev : null;
      }
      if (body.text !== undefined) {
        const text = String(body.text || '').trim().slice(0, 4000);
        if (!text) return reply.code(400).send({ ok: false, error: 'EMPTY_TEXT' });
        data.text = text;
        // Texto editado → re-embeber para que la búsqueda semántica siga siendo coherente.
        const emb = await embedText(text);
        if (emb.ok) {
          data.embedding = emb.vector;
          data.embeddingModel = emb.model;
        }
      }
      if (!Object.keys(data).length) {
        return reply.code(400).send({ ok: false, error: 'NO_CHANGES' });
      }

      const updated = await prisma.knowledgeEntry.update({
        where: { id: entry.id },
        data,
        select: { id: true, status: true, severity: true, text: true, updatedAt: true }
      });
      invalidateKbCache();
      return reply.send({ ok: true, entry: updated });
    } catch (err) {
      req.log.error({ err }, 'review-kb-patch');
      return reply.code(500).send({ ok: false, error: 'KB_PATCH_FAILED' });
    }
  });
}
