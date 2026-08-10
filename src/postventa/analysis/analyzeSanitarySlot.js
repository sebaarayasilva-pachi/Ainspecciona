import OpenAI from 'openai';
import sharp from 'sharp';
import { SANITARY_FINDINGS } from '../capture/sanitaryCatalog.js';

const CONFIDENCE_EARLY_FINISH = 0.82;

/**
 * Análisis rápido tras subir una foto (solo categoría sanitarios).
 * Corre inline en el upload: debe ser veloz. Usa modelo liviano dedicado
 * (no OPENAI_VISION_MODEL, que en prod es gpt-4o) e imagen reducida a 768px.
 * @param {{ buffer: Buffer, mimeType: string, isVideo?: boolean, ticketSummary: string, findingCode: string, slotCode: string, slotTitle: string, slotInstructions: string, log?: object }} opts
 */
export async function analyzeSanitarySlotQuick(opts) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || opts.isVideo) {
    return null;
  }

  const finding = SANITARY_FINDINGS[opts.findingCode] || SANITARY_FINDINGS.filtracion;
  const model = process.env.OPENAI_SANITARY_QUICK_MODEL || 'gpt-4o-mini';

  let quickBuffer = opts.buffer;
  let mime = opts.mimeType || 'image/jpeg';
  try {
    quickBuffer = await sharp(opts.buffer)
      .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    mime = 'image/jpeg';
  } catch {
    /* si falla el resize se usa la imagen original */
  }
  const b64 = quickBuffer.toString('base64');

  const prompt = [
    'Eres perito de instalaciones sanitarias en vivienda (Chile).',
    `Hallazgo reportado: ${finding.label}.`,
    `Resumen del propietario: ${opts.ticketSummary}`,
    `Slot actual: ${opts.slotTitle} — ${opts.slotInstructions}`,
    '',
    'Evalúa SOLO lo visible en la imagen.',
    'Responde JSON con:',
    '- matches_report: si la imagen apoya el hallazgo reportado',
    '- confidence: 0-1',
    '- visible_signals: array corto',
    '- needs_another_angle: true si hace falta otra foto más clara',
    '- needs_video: true si el hallazgo requiere video (ej. WC suelto, retorno al descargar, flujo débil)',
    '- can_finish_early: true SOLO si con esta y fotos previas basta evidencia clara (no para WC suelto sin video)',
    '- message_for_owner: frase corta en español chileno',
    '',
    'Reglas:',
    '- WC suelto: can_finish_early=false hasta tener video de movimiento',
    '- Filtración: si mancha/goteo claro en primer plano, can_finish_early puede ser true',
    '- No emitir dictamen de garantía'
  ].join('\n');

  try {
    // Sin reintentos y con timeout duro: si la IA demora, el upload no espera
    // (la revisión rápida es opcional; el análisis completo corre al finalizar).
    const client = new OpenAI({ apiKey, timeout: 9000, maxRetries: 0 });
    const response = await client.responses.create({
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: `data:${mime};base64,${b64}` }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'sanitary_slot_check',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              matches_report: { type: 'boolean' },
              confidence: { type: 'number' },
              visible_signals: { type: 'array', items: { type: 'string' } },
              needs_another_angle: { type: 'boolean' },
              needs_video: { type: 'boolean' },
              can_finish_early: { type: 'boolean' },
              message_for_owner: { type: 'string' }
            },
            required: [
              'matches_report',
              'confidence',
              'visible_signals',
              'needs_another_angle',
              'needs_video',
              'can_finish_early',
              'message_for_owner'
            ]
          }
        }
      },
      temperature: 0.15
    });

    const parsed = JSON.parse(response.output_text || '{}');
    const needsVideo =
      parsed.needs_video ||
      opts.findingCode === 'wc_suelto' ||
      opts.findingCode === 'retorno_agua' ||
      opts.findingCode === 'baja_presion';

    let canFinishEarly = Boolean(parsed.can_finish_early);
    if (needsVideo && opts.findingCode === 'wc_suelto') canFinishEarly = false;
    if (parsed.confidence < CONFIDENCE_EARLY_FINISH) canFinishEarly = false;
    if (parsed.needs_another_angle) canFinishEarly = false;

    return {
      findingCode: opts.findingCode,
      findingLabel: finding.label,
      matchesReport: parsed.matches_report,
      confidence: parsed.confidence,
      visibleSignals: parsed.visible_signals || [],
      needsAnotherAngle: parsed.needs_another_angle,
      needsVideo,
      canFinishEarly,
      messageForOwner: parsed.message_for_owner,
      suggestAction: parsed.needs_another_angle
        ? 'repeat_angle'
        : needsVideo
          ? 'need_video'
          : canFinishEarly
            ? 'can_finish'
            : 'continue'
    };
  } catch (err) {
    opts.log?.warn?.({ err }, 'sanitary slot quick analysis failed');
    return null;
  }
}
