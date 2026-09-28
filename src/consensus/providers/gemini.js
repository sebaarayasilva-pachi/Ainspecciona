import { ANALYST_PROMPT_VERSION, analystJsonSchema, buildAnalystPrompt, normalizeAnalysis } from '../schema.js';
import { parseJsonLoose, withRetry } from './retry.js';

export function geminiSafeSchema(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(geminiSafeSchema);
  const { additionalProperties, ...rest } = node;
  const out = { ...rest };
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([k, v]) => [k, geminiSafeSchema(v)])
    );
  }
  if (out.items) out.items = geminiSafeSchema(out.items);
  return out;
}

function geminiModel() {
  return process.env.GEMINI_ANALYST_MODEL || process.env.GEMINI_MODEL || 'gemini-3.6-flash';
}

export async function analyzeWithGemini({
  imageBase64,
  mimeType = 'image/jpeg',
  slotTitle,
  slotCode,
  kpiKey,
  findingKpiMap,
  apiKey = process.env.GEMINI_API_KEY,
  model = geminiModel()
} = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const prompt = buildAnalystPrompt({ slotTitle, slotCode, kpiKey });
  const started = Date.now();
  const result = await withRetry(async () => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: `${prompt}\nResponde SOLO JSON válido del schema.` },
            { inline_data: { mime_type: mimeType, data: imageBase64 } }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: geminiSafeSchema(analystJsonSchema())
        }
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.error?.message || `gemini http ${res.status}`);
    }
    const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') || '';
    const parsed = parseJsonLoose(text);
    if (!parsed) throw new Error('gemini empty consensus json');
    const tokens = Number(body?.usageMetadata?.totalTokenCount || 0) || null;
    return {
      analysis: normalizeAnalysis(parsed, { findingKpiMap }),
      tokens,
      raw: parsed
    };
  }, { label: 'gemini-shadow' });

  return {
    ...result,
    latencyMs: Date.now() - started,
    promptVersion: ANALYST_PROMPT_VERSION,
    model
  };
}
