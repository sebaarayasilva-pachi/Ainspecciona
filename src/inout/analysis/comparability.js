/**
 * Gate de comparabilidad IN vs OUT (visión). Spike / MVP sin homografía.
 */
import OpenAI from 'openai';

const VALID_HINTS = [
  'retroceda',
  'avance',
  'gire_izquierda',
  'gire_derecha',
  'suba',
  'baje',
  'mejore_luz',
  'quitate_oclusion',
  'ok'
];

function extractText(response) {
  const direct = String(response?.output_text || '').trim();
  if (direct) return direct;
  const parts = [];
  for (const item of response?.output || []) {
    if (item?.type === 'message' && Array.isArray(item.content)) {
      for (const block of item.content) {
        if ((block?.type === 'output_text' || block?.type === 'text') && block.text) {
          parts.push(String(block.text));
        }
      }
    }
  }
  return parts.join('\n').trim();
}

/**
 * @param {{ inImageDataUrl: string, outImageDataUrl: string, slotTitle?: string, log?: any }} opts
 * @returns {Promise<{ comparable: boolean, score: number, hint: string, message: string, raw?: any }>}
 */
export async function checkComparability(opts) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Fail-open en demos locales sin clave: asumir comparable
    return {
      comparable: true,
      score: 0.5,
      hint: 'ok',
      message: 'OPENAI_API_KEY no configurada; comparabilidad omitida (demo).'
    };
  }

  const client = new OpenAI({ apiKey });
  const slotTitle = String(opts.slotTitle || 'elemento').trim();

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      comparable: { type: 'boolean' },
      score: { type: 'number' },
      hint: { type: 'string' },
      message: { type: 'string' }
    },
    required: ['comparable', 'score', 'hint', 'message']
  };

  try {
    const response = await client.responses.create({
      model: process.env.INOUT_VISION_MODEL || 'gpt-4.1-mini',
      temperature: 0.1,
      text: {
        format: {
          type: 'json_schema',
          name: 'inout_comparability',
          schema,
          strict: true
        }
      },
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                `Evalúa si la FOTO 2 (salida) es suficientemente comparable a la FOTO 1 (entrada) del mismo elemento: "${slotTitle}".`,
                'Considera perspectiva, distancia, encuadre, rotación y cobertura del objeto.',
                'Ignora diferencias leves de iluminación si el encuadre es el mismo.',
                'Si hay oclusión fuerte o ángulo muy distinto, comparable=false.',
                'hint debe ser uno de: retroceda, avance, gire_izquierda, gire_derecha, suba, baje, mejore_luz, quitate_oclusion, ok.',
                'message: instrucción breve en español para el inspector (máx 120 caracteres).',
                'score: 0 a 1 (confianza de que son el mismo encuadre).'
              ].join('\n')
            },
            { type: 'input_text', text: 'FOTO 1 (entrada / IN):' },
            { type: 'input_image', image_url: opts.inImageDataUrl },
            { type: 'input_text', text: 'FOTO 2 (salida / OUT):' },
            { type: 'input_image', image_url: opts.outImageDataUrl }
          ]
        }
      ]
    });

    const text = extractText(response);
    const parsed = JSON.parse(text);
    const hint = VALID_HINTS.includes(String(parsed.hint || '')) ? String(parsed.hint) : 'ok';
    return {
      comparable: Boolean(parsed.comparable),
      score: Math.max(0, Math.min(1, Number(parsed.score) || 0)),
      hint,
      message: String(parsed.message || '').slice(0, 200),
      raw: parsed
    };
  } catch (err) {
    opts.log?.warn?.({ err }, 'inout comparability failed');
    return {
      comparable: false,
      score: 0,
      hint: 'ok',
      message: 'No se pudo validar comparabilidad. Intenta otra foto.'
    };
  }
}

export function hintToSpanish(hint) {
  const map = {
    retroceda: 'Retroceda aproximadamente 30 cm.',
    avance: 'Acérquese un poco al elemento.',
    gire_izquierda: 'Oriente la cámara hacia la izquierda.',
    gire_derecha: 'Oriente la cámara hacia la derecha.',
    suba: 'Suba un poco el ángulo de la cámara.',
    baje: 'Baje un poco el ángulo de la cámara.',
    mejore_luz: 'Mejore la iluminación del recinto.',
    quitate_oclusion: 'Retire objetos que bloqueen la vista.',
    ok: 'Encuadre aceptable.'
  };
  return map[hint] || map.ok;
}
