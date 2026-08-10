/**
 * Asistente del centro de revisión ITO (/review).
 *
 * Capacidades: briefing del día, resumen pre-caso con hallazgos agrupados,
 * chat contextual con acceso a la KB y redacción asistida de correcciones.
 *
 * Regla dura (guardrail): el asistente NUNCA sugiere veredictos de ítems no
 * revisados. El juicio independiente del ITO sostiene la métrica de accuracy,
 * el auto-approve y la calidad de la KB.
 *
 * Arquitectura de contexto (4 capas):
 *  1. Contexto vivo: el frontend solo manda { view, ref }; el server carga de BD.
 *  2. Memoria aprendida: retrieveSimilar (KB embeddings) + stats kpiAccuracy.
 *  3. Identidad: system prompt fijo (3 miradas, LGUC, taxonomías, guardrail).
 *  4. Conversación: historial de la sesión viaja en cada request (stateless).
 */
import OpenAI from 'openai';
import { retrieveSimilar } from '../aintelligence/kb/retrieve.js';
import { getKpiAccuracyStats, autoApproveConfig } from '../aintelligence/kb/kpiAccuracy.js';

const MODEL = () => process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4o-mini';
const BRIEFING_TTL_MS = 5 * 60 * 1000;

const SYSTEM_PROMPT = [
  'Eres el asistente del centro de revisión de Ainspecciona, donde un ITO (Inspector Técnico de Obra) chileno valida análisis de IA sobre inspecciones de propiedades.',
  '',
  'Contexto del negocio — tres miradas que no se mezclan:',
  '- ENTREGA: defectos de fabricación/terminaciones en obra nueva al momento de la entrega.',
  '- AINSPECTA / PROPERTYCHECK: deterioro que aparece con el uso y el tiempo.',
  '- POSTVENTA: fallas de fabricación que se manifiestan post-entrega (garantía Ley 19.472/LGUC: 10 años estructura, 5 instalaciones, 3 terminaciones; uso inadecuado y desgaste natural NO son garantía).',
  '',
  'Cada veredicto del ITO alimenta la base de conocimiento (KB) y la métrica de exactitud por KPI que gobierna la auto-validación de hallazgos benignos.',
  '',
  'REGLA INQUEBRANTABLE: nunca recomiendes, sugieras ni insinúes el veredicto (OK / corregir / sin falla) de un ítem que el ITO aún no revisa. Si te lo piden, explica que la decisión independiente es del ITO y ofrece contexto: criterios de la KB, casos similares, datos del análisis. Sí puedes explicar por qué la IA clasificó algo de cierta forma y qué dice la KB al respecto.',
  '',
  'Usa vocabulario técnico chileno (muro, cielo, guardapolvo, lavaplatos, loggia, WC). Responde conciso y directo, en español.'
].join('\n');

/** @type {{ text: string, counts: object, loadedAt: number } | null} */
let _briefingCache = null;

export function invalidateBriefingCache() {
  _briefingCache = null;
}

// ── Carga de contexto (capa 1: lo que el ITO mira) ──────────────────────────

async function loadQueueSnapshot(prisma) {
  const [cases, feedback, tickets] = await Promise.all([
    prisma.case.findMany({
      where: { reviewStatus: 'pending_review' },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        shortId: true,
        createdAt: true,
        tenant: { select: { name: true } },
        property: { select: { address: true } },
        slots: { select: { analysisCode: true } }
      }
    }),
    prisma.aiFeedback.findMany({
      where: { status: 'draft' },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true, createdAt: true, kpiKey: true }
    }),
    prisma.pvTicket.findMany({
      where: { status: 'classified' },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        shortId: true,
        createdAt: true,
        summary: true,
        preliminaryCategory: true,
        tenant: { select: { name: true } },
        aiAnalyses: { orderBy: { createdAt: 'desc' }, take: 1, select: { severity: true, report: true } }
      }
    })
  ]);

  const ageH = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 3600000);
  const lines = [];
  for (const c of cases) {
    const findings = c.slots.filter((s) => {
      const code = String(s.analysisCode || '').toUpperCase();
      return code && code !== 'OK' && code !== 'NOT_CAPTURABLE';
    }).length;
    lines.push(`- [Ainspecciona] Caso ${c.shortId}: ${c.property?.address || 's/dirección'} (${c.tenant?.name || '—'}), ${findings} hallazgos, hace ${ageH(c.createdAt)}h`);
  }
  for (const f of feedback) {
    lines.push(`- [Property-chk] Feedback ${f.id.slice(0, 8)} (KPI ${f.kpiKey || '—'}), hace ${ageH(f.createdAt)}h`);
  }
  for (const t of tickets) {
    const a = t.aiAnalyses[0];
    const urgent = a?.report?.urgency_flag === true ? ' URGENTE' : '';
    lines.push(`- [Postventa] Ticket ${t.shortId}: ${String(t.summary || '').slice(0, 90)} (${t.preliminaryCategory || '—'}, severidad ${a?.severity || '—'}${urgent}), ${t.tenant?.name || '—'}, hace ${ageH(t.createdAt)}h`);
  }

  return {
    counts: { AINSPECTA: cases.length, PROPERTYCHECK: feedback.length, POSTVENTA: tickets.length, total: lines.length },
    text: lines.length ? lines.join('\n') : '(cola vacía)'
  };
}

async function loadCaseContext(prisma, classifyKpiFromSlot, ref) {
  const c = await prisma.case.findFirst({
    where: { OR: [{ id: ref }, { shortId: ref }] },
    select: {
      id: true,
      shortId: true,
      reviewStatus: true,
      tenant: { select: { name: true } },
      property: { select: { address: true } }
    }
  });
  if (!c) return null;
  const slots = await prisma.slot.findMany({
    where: { caseId: c.id, photoId: { not: null } },
    orderBy: { orderIndex: 'asc' }
  });
  const reviews = await prisma.slotReview.findMany({ where: { caseId: c.id } });
  const reviewBySlot = new Map(reviews.map((r) => [r.slotId, r]));

  const slotRows = slots.map((s) => {
    const r = reviewBySlot.get(s.id) || null;
    const kpi = typeof classifyKpiFromSlot === 'function' ? String(classifyKpiFromSlot(s) || '').toUpperCase() : '';
    return {
      slot: s,
      kpi: kpi || null,
      review: r,
      line: `- [${s.slotCode}] ${s.title || '—'} (KPI ${kpi || '—'}): IA → ${s.analysisCode || 'OK'}${s.analysisSeverity ? `/${s.analysisSeverity}` : ''} «${String(s.analysisMessage || '').slice(0, 180)}»${
        r ? ` | Veredicto ITO: ${r.verdict}${r.humanMessage ? ` «${String(r.humanMessage).slice(0, 120)}»` : ''}` : ' | pendiente'
      }`
    };
  });

  return {
    kind: 'case',
    case: c,
    slotRows,
    text: [
      `Caso Ainspecciona ${c.shortId} · ${c.property?.address || 's/dirección'} · ${c.tenant?.name || '—'} · estado ${c.reviewStatus}`,
      `Slots con foto (${slotRows.length}):`,
      ...slotRows.map((x) => x.line)
    ].join('\n')
  };
}

async function loadTicketContext(prisma, ref) {
  const t = await prisma.pvTicket.findFirst({
    where: { OR: [{ id: ref }, { shortId: ref }] },
    select: {
      id: true,
      shortId: true,
      summary: true,
      status: true,
      preliminaryCategory: true,
      warrantyStatus: true,
      tenant: { select: { name: true } },
      unit: { include: { project: { select: { name: true, comuna: true } } } },
      aiAnalyses: { orderBy: { createdAt: 'desc' }, take: 1 }
    }
  });
  if (!t) return null;
  const analysisReviews = await prisma.pvAnalysisReview.findMany({ where: { ticketId: t.id } });
  const a = t.aiAnalyses[0] || null;
  const rep = a?.report || {};
  const claim = rep.claim_assessment || null;
  const evidence = Array.isArray(rep.evidence_review) ? rep.evidence_review : [];

  return {
    kind: 'ticket',
    ticket: t,
    text: [
      `Ticket Postventa ${t.shortId} · ${t.tenant?.name || '—'} · ${t.unit?.project?.name || ''} ${t.unit?.project?.comuna || ''}`.trim(),
      `Categoría: ${t.preliminaryCategory || '—'} · Garantía: ${t.warrantyStatus || '—'} · Estado: ${t.status}`,
      `Reclamo: ${String(t.summary || '').slice(0, 400)}`,
      a
        ? `Análisis IA (${a.severity || '—'}): ${String(rep.finding_description || a.summaryText || '').slice(0, 400)}`
        : 'Sin análisis IA.',
      claim
        ? `Evaluación del reclamo IA: ${claim.verdict} (causa probable: ${claim.probable_cause}). ${String(claim.explanation_for_inmobiliaria || '').slice(0, 300)}`
        : null,
      evidence.length
        ? `Evidencias:\n${evidence.map((e) => `- [${e.slot_code}] ${e.slot_title}: ${String(e.observation || '').slice(0, 150)} (sev ${e.severity})`).join('\n')}`
        : null,
      analysisReviews.length
        ? `Veredictos ITO ya dados:\n${analysisReviews.map((r) => `- ${r.slotCode || 'global'}: ${r.verdict}${r.humanMessage ? ` «${String(r.humanMessage).slice(0, 120)}»` : ''}`).join('\n')}`
        : 'Sin veredictos ITO aún.'
    ]
      .filter(Boolean)
      .join('\n')
  };
}

async function loadFeedbackContext(prisma, ref) {
  const f = await prisma.aiFeedback.findFirst({ where: { id: ref } });
  if (!f) return null;
  const compact = (v) => {
    try {
      return JSON.stringify(v).slice(0, 500);
    } catch {
      return '';
    }
  };
  return {
    kind: 'feedback',
    text: [
      `Feedback Property-chk ${f.id.slice(0, 8)} · KPI ${f.kpiKey || '—'} · estado ${f.status} · inspección ${f.externalInspectionId || '—'}`,
      f.aiSnapshot ? `Análisis IA (snapshot): ${compact(f.aiSnapshot)}` : null,
      f.humanLabel ? `Etiqueta humana del inspector: ${compact(f.humanLabel)}` : null
    ]
      .filter(Boolean)
      .join('\n')
  };
}

/** Matriz de miradas para el retrieval de la KB según la vista activa. */
function kbSourcesForView(view) {
  if (view === 'ticket') return ['POSTVENTA', 'ENTREGA'];
  if (view === 'case' || view === 'feedback') return ['AINSPECTA', 'PROPERTYCHECK'];
  return undefined; // cola / general: todas las fuentes
}

// ── LLM helper ───────────────────────────────────────────────────────────────

async function llmText(messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_NOT_CONFIGURED');
  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: MODEL(),
    input: messages,
    temperature: 0.3
  });
  return String(response.output_text || '').trim();
}

// ── Rutas ────────────────────────────────────────────────────────────────────

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ prisma: import('@prisma/client').PrismaClient, classifyKpiFromSlot?: Function, getRuntimeScoreConfig?: Function }} deps
 */
export async function registerReviewAssistantRoutes(app, deps) {
  const { prisma, classifyKpiFromSlot, getRuntimeScoreConfig } = deps;
  if (!prisma) {
    app.log.warn('review assistant: prisma no disponible');
    return;
  }

  // Resumen del día (cache 5 min para no gastar tokens por refresh).
  app.get('/api/admin/review/assistant/briefing', async (req, reply) => {
    try {
      if (_briefingCache && Date.now() - _briefingCache.loadedAt < BRIEFING_TTL_MS) {
        return reply.send({ ok: true, cached: true, ...strip(_briefingCache) });
      }
      const snapshot = await loadQueueSnapshot(prisma);
      if (!snapshot.counts.total) {
        _briefingCache = { text: 'Cola vacía: no hay revisiones pendientes.', counts: snapshot.counts, loadedAt: Date.now() };
        return reply.send({ ok: true, cached: false, ...strip(_briefingCache) });
      }
      const text = await llmText([
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Cola de revisión pendiente:\n${snapshot.text}\n\nEscribe un briefing operativo de máximo 4 frases para el ITO que empieza su turno: qué es urgente atender primero y por qué, qué se puede agrupar para revisar más rápido, y qué lleva demasiado tiempo esperando. Sin saludos ni cierre.`
        }
      ]);
      _briefingCache = { text, counts: snapshot.counts, loadedAt: Date.now() };
      return reply.send({ ok: true, cached: false, ...strip(_briefingCache) });
    } catch (err) {
      req.log.error({ err }, 'assistant-briefing');
      return reply.code(500).send({ ok: false, error: 'BRIEFING_FAILED' });
    }
  });

  // Resumen pre-caso / pre-ticket con hallazgos agrupados por patrón.
  app.get('/api/admin/review/assistant/case-brief/:ref', async (req, reply) => {
    try {
      const ref = String(req.params.ref || '');
      const type = String(req.query?.type || 'case');
      const ctx = type === 'ticket' ? await loadTicketContext(prisma, ref) : await loadCaseContext(prisma, classifyKpiFromSlot, ref);
      if (!ctx) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

      // Agrupación determinista por patrón (solo casos Ainspecciona).
      let groupsText = '';
      if (ctx.kind === 'case') {
        const groups = new Map();
        for (const row of ctx.slotRows) {
          const code = String(row.slot.analysisCode || '').toUpperCase();
          if (!code || code === 'OK' || code === 'NOT_CAPTURABLE') continue;
          const key = `${row.kpi || 'OTROS'}|${code}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(row.slot.slotCode);
        }
        groupsText = [...groups.entries()]
          .filter(([, slots]) => slots.length >= 2)
          .map(([key, slots]) => `- Patrón repetido ${key.replace('|', ' · ')}: ${slots.length} slots (${slots.join(', ')})`)
          .join('\n');
      }

      const text = await llmText([
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `${ctx.text}\n${groupsText ? `\nPatrones detectados:\n${groupsText}\n` : ''}\nEscribe un resumen pre-revisión de máximo 4 frases para el ITO: volumen y naturaleza de los hallazgos, patrones repetidos que convenga revisar juntos, y cualquier dato de contexto relevante. NO sugieras veredictos. Sin saludos.`
        }
      ]);
      return reply.send({ ok: true, brief: text, groups: groupsText || null });
    } catch (err) {
      req.log.error({ err }, 'assistant-case-brief');
      return reply.code(500).send({ ok: false, error: 'BRIEF_FAILED' });
    }
  });

  // Chat contextual. Body: { messages: [{role, content}], view: 'queue'|'case'|'ticket'|'feedback', ref }
  app.post('/api/admin/review/assistant/chat', async (req, reply) => {
    try {
      const body = req.body || {};
      const view = String(body.view || 'queue');
      const ref = String(body.ref || '');
      const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
      const lastUser = [...history].reverse().find((m) => m.role === 'user');
      if (!lastUser || !String(lastUser.content || '').trim()) {
        return reply.code(400).send({ ok: false, error: 'EMPTY_MESSAGE' });
      }

      // Capa 1: contexto vivo según la vista activa.
      let ctxText = '';
      if (view === 'case' && ref) ctxText = (await loadCaseContext(prisma, classifyKpiFromSlot, ref))?.text || '';
      else if (view === 'ticket' && ref) ctxText = (await loadTicketContext(prisma, ref))?.text || '';
      else if (view === 'feedback' && ref) ctxText = (await loadFeedbackContext(prisma, ref))?.text || '';
      else ctxText = `Cola de revisión:\n${(await loadQueueSnapshot(prisma)).text}`;

      // Capa 2: memoria aprendida (KB por embeddings + stats de exactitud por KPI).
      let kbText = '';
      try {
        const res = await retrieveSimilar({
          prisma,
          text: String(lastUser.content).slice(0, 500),
          sources: kbSourcesForView(view),
          topK: 4
        });
        if (res.ok && res.entries.length) {
          kbText = `Criterios de la KB (veredictos ITO previos) relacionados con la pregunta:\n${res.entries
            .map((e, i) => `${i + 1}. [${e.source}${e.kpiKey ? ` · ${e.kpiKey}` : ''}${e.category ? ` · ${e.category}` : ''}] ${String(e.text).slice(0, 250)}`)
            .join('\n')}`;
        }
      } catch {
        /* la KB nunca rompe el chat */
      }

      let statsText = '';
      try {
        const cfg = typeof getRuntimeScoreConfig === 'function' ? (await getRuntimeScoreConfig()).config : undefined;
        const stats = await getKpiAccuracyStats(prisma, classifyKpiFromSlot, cfg?.slotKpiMap);
        const auto = autoApproveConfig();
        const rows = Object.entries(stats).map(([k, v]) => `${k}: ${v.accuracyPct}% en ${v.total} revisiones`);
        if (rows.length) {
          statsText = `Exactitud histórica IA por KPI (umbral auto-validación: ≥${auto.minAccuracyPct}% con ≥${auto.minReviews} revisiones, ${auto.enabled ? 'activo' : 'inactivo'}):\n${rows.join(' · ')}`;
        }
      } catch {
        /* opcional */
      }

      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'system',
          content: [`=== CONTEXTO ACTUAL (${view}) ===`, ctxText, kbText, statsText].filter(Boolean).join('\n\n')
        },
        ...history.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) }))
      ];

      const answer = await llmText(messages);
      return reply.send({ ok: true, answer });
    } catch (err) {
      req.log.error({ err }, 'assistant-chat');
      return reply.code(500).send({ ok: false, error: 'CHAT_FAILED' });
    }
  });

  // Redacción asistida de correcciones (solo después de que el ITO decidió corregir).
  // Body: { view: 'case'|'ticket'|'feedback', ref, slotCode?, notes }
  app.post('/api/admin/review/assistant/draft-correction', async (req, reply) => {
    try {
      const body = req.body || {};
      const view = String(body.view || '');
      const ref = String(body.ref || '');
      const slotCode = String(body.slotCode || '').trim() || null;
      const notes = String(body.notes || '').trim();
      if (!notes) return reply.code(400).send({ ok: false, error: 'EMPTY_NOTES', hint: 'El ITO debe dar un apunte breve de qué corregir.' });

      let ctxText = '';
      if (view === 'case' && ref) ctxText = (await loadCaseContext(prisma, classifyKpiFromSlot, ref))?.text || '';
      else if (view === 'ticket' && ref) ctxText = (await loadTicketContext(prisma, ref))?.text || '';
      else if (view === 'feedback' && ref) ctxText = (await loadFeedbackContext(prisma, ref))?.text || '';

      const text = await llmText([
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            ctxText ? `Contexto:\n${ctxText}\n` : null,
            slotCode ? `El ITO está corrigiendo el ítem/slot: ${slotCode}.` : 'El ITO está corrigiendo el diagnóstico global.',
            `Apunte del ITO (su decisión, ya tomada): ${notes}`,
            '',
            'Redacta la observación técnica corregida en 1-3 frases, profesional y autocontenida, con vocabulario técnico chileno. Es la versión formal del apunte del ITO: no cambies su criterio, no agregues hallazgos nuevos. Devuelve SOLO el texto de la observación, sin comillas ni preámbulo.'
          ]
            .filter((x) => x !== null)
            .join('\n')
        }
      ]);
      return reply.send({ ok: true, draft: text });
    } catch (err) {
      req.log.error({ err }, 'assistant-draft');
      return reply.code(500).send({ ok: false, error: 'DRAFT_FAILED' });
    }
  });
}

function strip(cache) {
  return { briefing: cache.text, counts: cache.counts, generatedAt: new Date(cache.loadedAt).toISOString() };
}
