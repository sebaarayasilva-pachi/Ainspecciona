/**
 * Análisis diferencial IN vs OUT por slot.
 */
import OpenAI from 'openai';

export const DIFF_CLASSES = [
  'sin_cambio',
  'cambio_detectado',
  'posible_deterioro',
  'elemento_faltante',
  'no_comparable'
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
 * @param {{ inImageDataUrl: string, outImageDataUrl: string, slotTitle?: string, slotCode?: string, log?: any }} opts
 */
export async function analyzeInOutPair(opts) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      classification: 'no_comparable',
      severity: 'none',
      confidence: 0,
      description: 'Análisis omitido: OPENAI_API_KEY no configurada.',
      raw: null
    };
  }

  const client = new OpenAI({ apiKey });
  const slotTitle = String(opts.slotTitle || opts.slotCode || 'elemento').trim();

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      classification: {
        type: 'string',
        enum: DIFF_CLASSES
      },
      severity: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
      confidence: { type: 'number' },
      description: { type: 'string' }
    },
    required: ['classification', 'severity', 'confidence', 'description']
  };

  try {
    const response = await client.responses.create({
      model: process.env.INOUT_VISION_MODEL || 'gpt-4.1-mini',
      temperature: 0.2,
      text: {
        format: {
          type: 'json_schema',
          name: 'inout_diff',
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
                `Compara FOTO 1 (entrada) y FOTO 2 (salida) del elemento: "${slotTitle}".`,
                'Identifica solo cambios visibles. No atribuyas culpa ni responsabilidad legal.',
                'No digas que el arrendatario provocó el daño.',
                'Usa redacción: "Se observa una alteración visible nueva respecto de la inspección de entrada" cuando corresponda.',
                'Ignora cambios leves de iluminación/sombras si no hay daño aparente.',
                'Si las imágenes no son comparables, classification=no_comparable.',
                'classification: sin_cambio | cambio_detectado | posible_deterioro | elemento_faltante | no_comparable.',
                'description: 1-2 oraciones en español, prudentes.'
              ].join('\n')
            },
            { type: 'input_text', text: 'FOTO 1 (IN):' },
            { type: 'input_image', image_url: opts.inImageDataUrl },
            { type: 'input_text', text: 'FOTO 2 (OUT):' },
            { type: 'input_image', image_url: opts.outImageDataUrl }
          ]
        }
      ]
    });

    const text = extractText(response);
    const parsed = JSON.parse(text);
    const classification = DIFF_CLASSES.includes(parsed.classification)
      ? parsed.classification
      : 'no_comparable';
    return {
      classification,
      severity: String(parsed.severity || 'none'),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      description: String(parsed.description || '').slice(0, 800),
      raw: parsed
    };
  } catch (err) {
    opts.log?.warn?.({ err }, 'inout analyzeInOutPair failed');
    return {
      classification: 'no_comparable',
      severity: 'none',
      confidence: 0,
      description: 'No se pudo completar el análisis diferencial.',
      raw: null
    };
  }
}
