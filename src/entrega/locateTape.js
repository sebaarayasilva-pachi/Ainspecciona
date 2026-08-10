import fs from 'node:fs';
import OpenAI from 'openai';

/**
 * Localiza la cinta/marca que el inspector pegó sobre un defecto en la foto.
 * Devuelve el centro en coordenadas normalizadas (0..1) o null si no la encuentra
 * (o si falla la llamada / no hay API key). La UI cae al modo "tocar para fijar".
 */

function extractResponsesApiText(response) {
  const direct = String(response?.output_text || '').trim();
  if (direct) return direct;
  const parts = [];
  for (const item of response?.output || []) {
    if (item?.type === 'message' && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (block?.type === 'output_text' && block.text) parts.push(String(block.text));
        else if (block?.type === 'text' && block.text) parts.push(String(block.text));
      }
    }
    if (item?.type === 'output_text' && item.text) parts.push(String(item.text));
  }
  return parts.join('\n').trim();
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

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.min(1, Math.max(0, v));
}

/**
 * @param {Buffer} buffer Imagen JPEG/PNG en memoria.
 * @param {{ log?:any }} [opts]
 * @returns {Promise<{x:number,y:number}|null>}
 */
export async function locateTapeFromBuffer(buffer, opts = {}) {
  const log = opts.log;
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey || !buffer?.length) return null;

  const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;

  const prompt = [
    'Eres un detector de marcas en fotos de inspección técnica de departamentos.',
    'El inspector pega una CINTA o marca adhesiva (típicamente de color, ej. amarilla, roja, azul, o de enmascarar) justo sobre el defecto que quiere registrar.',
    'Tu tarea: ubicar el CENTRO de esa cinta/marca en la imagen.',
    'Responde SOLO con JSON: {"found": boolean, "x": number, "y": number}.',
    'x e y son coordenadas NORMALIZADAS entre 0 y 1, con origen (0,0) en la esquina superior izquierda y (1,1) en la inferior derecha.',
    'Si no hay ninguna cinta/marca claramente identificable, responde {"found": false, "x": 0, "y": 0}.',
    'No incluyas texto adicional fuera del JSON.'
  ].join('\n');

  const requestPayload = {
    model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: dataUrl }
        ]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'tape_location',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean' },
            x: { type: 'number' },
            y: { type: 'number' }
          },
          required: ['found', 'x', 'y']
        }
      }
    },
    temperature: 0
  };

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.responses.create(requestPayload);
    const rawText = extractResponsesApiText(response);
    const parsed = parseJson(rawText);
    if (!parsed || !parsed.found) return null;
    const x = clamp01(parsed.x);
    const y = clamp01(parsed.y);
    if (x === null || y === null) return null;
    return { x, y };
  } catch (err) {
    log?.warn?.({ err: err?.message || err }, 'entrega-locate-tape-failed');
    return null;
  }
}

/** @param {string} filePath */
export async function locateTape(filePath, opts = {}) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return await locateTapeFromBuffer(fs.readFileSync(filePath), opts);
  } catch {
    return null;
  }
}
