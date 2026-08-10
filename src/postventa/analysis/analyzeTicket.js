import OpenAI from 'openai';
import { categoryLabel, warrantyStatusLabel } from './categoryLabels.js';
import { getKbPromptBlock } from '../../aintelligence/kb/promptBlock.js';

const REPORT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    executive_summary: { type: 'string', minLength: 1 },
    finding_description: { type: 'string', minLength: 1 },
    visible_signals: { type: 'array', items: { type: 'string' } },
    severity: { type: 'string', enum: ['none', 'low', 'medium', 'high', 'critical'] },
    severity_rationale: { type: 'string', minLength: 1 },
    claim_assessment: {
      type: 'object',
      additionalProperties: false,
      properties: {
        verdict: {
          type: 'string',
          enum: ['falla_confirmada', 'sin_falla_aparente', 'evidencia_insuficiente']
        },
        explanation_for_inmobiliaria: { type: 'string', minLength: 1 },
        probable_cause: {
          type: 'string',
          enum: ['fabricacion', 'uso_desgaste', 'mantencion', 'tercero', 'indeterminado']
        }
      },
      required: ['verdict', 'explanation_for_inmobiliaria', 'probable_cause']
    },
    category_assessment: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reported_category: { type: 'string' },
        confirmed_category: { type: 'string' },
        confidence: { type: 'number' },
        notes: { type: 'string' }
      },
      required: ['reported_category', 'confirmed_category', 'confidence', 'notes']
    },
    evidence_review: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slot_code: { type: 'string' },
          slot_title: { type: 'string' },
          observation: { type: 'string' },
          matches_expectation: { type: 'boolean' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'none'] }
        },
        required: ['slot_code', 'slot_title', 'observation', 'matches_expectation', 'severity']
      }
    },
    warranty_assessment: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prevalidation_status: { type: 'string' },
        ai_notes: { type: 'string' },
        requires_human_review: { type: 'boolean' }
      },
      required: ['prevalidation_status', 'ai_notes', 'requires_human_review']
    },
    recommended_routing: { type: 'string', minLength: 1 },
    recommended_actions: { type: 'array', items: { type: 'string' } },
    evidence_gaps: { type: 'array', items: { type: 'string' } },
    urgency_flag: { type: 'boolean' },
    confidence: { type: 'number' }
  },
  required: [
    'executive_summary',
    'finding_description',
    'visible_signals',
    'severity',
    'severity_rationale',
    'claim_assessment',
    'category_assessment',
    'evidence_review',
    'warranty_assessment',
    'recommended_routing',
    'recommended_actions',
    'evidence_gaps',
    'urgency_flag',
    'confidence'
  ]
};

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} ticketId
 */
async function loadTicketForAnalysis(prisma, ticketId) {
  return prisma.pvTicket.findFirst({
    where: { OR: [{ id: ticketId }, { shortId: ticketId }] },
    include: {
      tenant: { select: { name: true, slug: true } },
      owner: { select: { fullName: true } },
      unit: {
        include: {
          project: { select: { name: true, address: true, comuna: true } }
        }
      },
      captureSessions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          slots: { orderBy: { sortOrder: 'asc' } }
        }
      }
    }
  });
}

/**
 * @param {object} storage
 * @param {Array<{ slotCode: string, title: string, instructions: string | null, photoPath: string | null, mimeType: string | null, status: string }>} slots
 */
async function buildImageInputs(storage, slots) {
  /** @type {Array<{ slot: object, image: { type: 'input_image', image_url: string } }>} */
  const items = [];
  for (const slot of slots) {
    if (!slot.photoPath || !['uploaded', 'analyzed'].includes(String(slot.status))) continue;
    try {
      const buf = await storage.readBuffer(slot.photoPath);
      const mime = slot.mimeType || 'image/jpeg';
      items.push({
        slot,
        image: {
          type: 'input_image',
          image_url: `data:${mime};base64,${buf.toString('base64')}`
        }
      });
    } catch {
      /* omit unreadable photo */
    }
  }
  return items;
}

function buildAnalysisPrompt(ticket, session, imageItems, kbBlock = '') {
  const project = ticket.unit?.project;
  const unitLabel = ticket.unit
    ? [
        project?.name,
        project?.address,
        project?.comuna,
        ticket.unit.tower ? `Torre ${ticket.unit.tower}` : null,
        `Depto ${ticket.unit.unitNumber}`
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Unidad no especificada';

  const slotManifest = (session?.slots || []).map((s, i) => {
    const hasPhoto = imageItems.some((it) => it.slot.id === s.id);
    return `${i + 1}. [${s.slotCode}] ${s.title}: ${s.instructions || '—'} (${hasPhoto ? 'con foto' : s.status === 'skipped' ? 'omitida' : 'sin foto'})`;
  });

  return [
    'Eres un perito técnico de postventa inmobiliaria en Chile.',
    'Analiza el reclamo del propietario y las fotos de evidencia para armar un INFORME PRELIMINAR.',
    'Usa vocabulario chileno: muro, cielo, lavaplatos, guardapolvo, WC, loggia, etc.',
    'NO emitas dictamen legal de garantía; solo prevalidación operativa alineada a los datos registrados.',
    'Si la evidencia es insuficiente, indícalo en evidence_gaps y recommended_actions.',
    'IMPORTANTE — evaluación del reclamo (claim_assessment):',
    '- Si las fotos NO muestran una falla de fabricación (apariencia normal, desgaste por uso, falta de mantención o daño por terceros), usa verdict="sin_falla_aparente", severity="none" y explica con claridad qué se observa y por qué no constituye falla.',
    '- Un reclamo "sin falla aparente" NO se rechaza: el ticket se envía igual a la inmobiliaria con tu observación para que ellos decidan.',
    '- Si sí hay falla visible compatible con fabricación, usa verdict="falla_confirmada" y severity acorde.',
    '- Si no puedes concluir con las fotos disponibles, usa verdict="evidencia_insuficiente" y pide en evidence_gaps lo que falta.',
    '- explanation_for_inmobiliaria debe ser un texto profesional y autocontenido, listo para que lo lea la inmobiliaria.',
    '',
    '=== DATOS DEL CASO ===',
    `N° solicitud: ${ticket.shortId}`,
    `Inmobiliaria: ${ticket.tenant?.name || '—'}`,
    `Unidad: ${unitLabel}`,
    `Propietario: ${ticket.owner?.fullName || '—'}`,
    `Recinto reportado: ${ticket.roomHint || '—'}`,
    `Categoría reportada: ${categoryLabel(ticket.preliminaryCategory)} (${ticket.preliminaryCategory})`,
    `Resumen del reclamo (conversación): ${ticket.summary}`,
    `Prevalidación garantía registrada: ${warrantyStatusLabel(ticket.warrantyStatus)}`,
    ticket.warrantyTier ? `Tier garantía: ${ticket.warrantyTier}` : null,
    ticket.warrantyExpiresAt
      ? `Vencimiento prevalidado: ${new Date(ticket.warrantyExpiresAt).toISOString().slice(0, 10)}`
      : null,
    '',
    '=== SLOTS DE CAPTURA ===',
    ...slotManifest,
    '',
    `Recibirás ${imageItems.length} imagen(es) etiquetadas en el orden de los slots con foto.`,
    'Para cada imagen, evalúa si corresponde al slot esperado y qué observas.',
    kbBlock || null,
    '',
    'Deriva recommended_routing según categoría y severidad (ej. supervisor postventa, gasfitería, carpintería, impermeabilización).',
    'Marca urgency_flag=true si hay riesgo de seguridad, goteo activo grave o daño estructural aparente.',
    '',
    'Responde en JSON según el schema indicado.'
  ]
    .filter(Boolean)
    .join('\n');
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient, storage: object, log?: { info?: Function, warn?: Function, error?: Function }, ticketId: string }} opts
 */
export async function analyzePostventaTicket({ prisma, storage, log, ticketId }) {
  const ticket = await loadTicketForAnalysis(prisma, ticketId);
  if (!ticket) {
    return { ok: false, error: 'TICKET_NOT_FOUND' };
  }

  const session = ticket.captureSessions[0];
  if (!session) {
    return { ok: false, error: 'NO_CAPTURE_SESSION' };
  }

  const imageItems = await buildImageInputs(storage, session.slots);
  const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_POSTVENTA_MODEL || 'gpt-4o';

  const analysisRow = await prisma.pvAIAnalysis.create({
    data: {
      ticketId: ticket.id,
      status: 'running',
      model
    }
  });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await prisma.pvAIAnalysis.update({
      where: { id: analysisRow.id },
      data: {
        status: 'failed',
        errorMessage: 'OPENAI_API_KEY no configurada',
        completedAt: new Date()
      }
    });
    return { ok: false, error: 'OPENAI_NOT_CONFIGURED', analysisId: analysisRow.id };
  }

  if (!imageItems.length) {
    await prisma.pvAIAnalysis.update({
      where: { id: analysisRow.id },
      data: {
        status: 'failed',
        errorMessage: 'No hay fotos subidas para analizar',
        completedAt: new Date()
      }
    });
    return { ok: false, error: 'NO_PHOTOS', analysisId: analysisRow.id };
  }

  try {
    const client = new OpenAI({ apiKey });
    // KB unificada (RAG): criterios aprendidos de revisiones ITO para esta categoría
    const kbBlock = await getKbPromptBlock({
      prisma,
      text: `${categoryLabel(ticket.preliminaryCategory)}. ${ticket.summary}`,
      category: ticket.preliminaryCategory,
      sources: ['POSTVENTA', 'ENTREGA'],
      log
    });
    const prompt = buildAnalysisPrompt(ticket, session, imageItems, kbBlock);

    /** @type {Array<object>} */
    const content = [{ type: 'input_text', text: prompt }];
    for (const item of imageItems) {
      content.push({
        type: 'input_text',
        text: `--- Foto slot [${item.slot.slotCode}] ${item.slot.title} ---`
      });
      content.push(item.image);
    }

    const response = await client.responses.create({
      model,
      input: [{ role: 'user', content }],
      text: {
        format: {
          type: 'json_schema',
          name: 'postventa_report',
          strict: true,
          schema: REPORT_JSON_SCHEMA
        }
      },
      temperature: 0.2
    });

    const parsed = parseJson(response.output_text || '');
    if (!parsed) {
      throw new Error('Respuesta IA no parseable');
    }

    const report = {
      ...parsed,
      meta: {
        ticketShortId: ticket.shortId,
        category: ticket.preliminaryCategory,
        categoryLabel: categoryLabel(ticket.preliminaryCategory),
        photosAnalyzed: imageItems.length,
        slotsTotal: session.slots.length,
        analyzedAt: new Date().toISOString(),
        model,
        disclaimer:
          'Informe preliminar generado por IA. Requiere revisión humana antes de comunicar al propietario o derivar.'
      },
      photos: imageItems.map(({ slot }) => ({
        slotId: slot.id,
        slotCode: slot.slotCode,
        title: slot.title,
        photoUrl: slot.photoPath ? storage.publicUrl(slot.photoPath) : null
      }))
    };

    const severity = String(parsed.severity || 'medium');
    const summaryText = String(parsed.executive_summary || '').trim();

    await prisma.$transaction(async (tx) => {
      await tx.pvAIAnalysis.update({
        where: { id: analysisRow.id },
        data: {
          status: 'completed',
          severity,
          summaryText,
          report,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
          completedAt: new Date()
        }
      });

      await tx.pvTicket.update({
        where: { id: ticket.id },
        data: { status: 'classified' }
      });

      const uploadedSlotIds = session.slots
        .filter((s) => s.photoPath && String(s.status) === 'uploaded')
        .map((s) => s.id);
      if (uploadedSlotIds.length) {
        await tx.pvCaptureSlot.updateMany({
          where: { id: { in: uploadedSlotIds } },
          data: { status: 'analyzed' }
        });
      }

      await tx.pvTicketEvent.create({
        data: {
          ticketId: ticket.id,
          eventType: 'ai_analysis_completed',
          payload: {
            analysisId: analysisRow.id,
            severity,
            confidence: parsed.confidence,
            recommended_routing: parsed.recommended_routing
          }
        }
      });
    });

    // Tras clasificar: auto-asignar al inspector de la obra (o dejar en recibida)
    try {
      const { autoAssignTicketAfterClassified } = await import('../services/assignTicket.js');
      await autoAssignTicketAfterClassified(prisma, ticket.id, { log });
    } catch (assignErr) {
      log?.warn?.({ err: assignErr, ticketId: ticket.id }, 'postventa-auto-assign-after-analysis');
    }

    log?.info?.({ ticketId: ticket.id, analysisId: analysisRow.id, severity }, 'postventa ai analysis done');
    return {
      ok: true,
      analysisId: analysisRow.id,
      ticketShortId: ticket.shortId,
      severity,
      summaryText
    };
  } catch (err) {
    const message = err?.message || String(err);
    log?.error?.({ err, ticketId: ticket.id }, 'postventa ai analysis failed');
    await prisma.pvAIAnalysis.update({
      where: { id: analysisRow.id },
      data: {
        status: 'failed',
        errorMessage: message.slice(0, 2000),
        completedAt: new Date()
      }
    });
    await prisma.pvTicketEvent.create({
      data: {
        ticketId: ticket.id,
        eventType: 'ai_analysis_failed',
        payload: { analysisId: analysisRow.id, error: message.slice(0, 500) }
      }
    });
    return { ok: false, error: 'ANALYSIS_FAILED', message, analysisId: analysisRow.id };
  }
}

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient, storage: object, log?: object }} deps
 */
export function createPostventaAnalysisQueue(deps) {
  const running = new Set();

  return function queuePostventaTicketAnalysis({ ticketId }) {
    const key = String(ticketId || '');
    if (!key || running.has(key)) return;

    running.add(key);
    setImmediate(async () => {
      try {
        await analyzePostventaTicket({ ...deps, ticketId: key });
      } catch (err) {
        deps.log?.error?.({ err, ticketId: key }, 'postventa analysis queue');
      } finally {
        running.delete(key);
      }
    });
  };
}
