import { JUDGE_PROMPT_VERSION, buildJudgePrompt, judgeJsonSchema, normalizeAnalysis, normalizeJudgeVerdict } from '../schema.js';
import { parseJsonLoose, withRetry } from './retry.js';
import { geminiSafeSchema } from './gemini.js';

function geminiJudgeModel() {
  return process.env.GEMINI_MODEL || 'gemini-3.7-flash';
}

function judgeThinkingLevel() {
  const raw = String(process.env.CONSENSUS_JUDGE_THINKING || 'high').trim().toUpperCase();
  if (['LOW', 'MEDIUM', 'HIGH'].includes(raw)) return raw;
  return 'HIGH';
}

function stripProviderNames(analysis) {
  if (!analysis || typeof analysis !== 'object') return analysis;
  const { provider, model, ...rest } = analysis;
  return rest;
}

function extractGeminiJson(body) {
  const parts = body?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .filter((p) => p && !p.thought && p.text)
    .map((p) => p.text)
    .join('');
  return parseJsonLoose(text);
}

function remapChosenSide(verdict, swapped) {
  if (!swapped || !verdict) return verdict;
  if (verdict.chosenSide === 'A') verdict.chosenSide = 'B';
  else if (verdict.chosenSide === 'B') verdict.chosenSide = 'A';
  return verdict;
}

/**
 * Judge anónimo: analysis_a / analysis_b sin nombre de proveedor; orden A/B aleatorio.
 */
export async function judgeWithGemini({
  analysisA,
  analysisB,
  imageBase64,
  mimeType = 'image/jpeg',
  findingKpiMap,
  apiKey = process.env.GEMINI_API_KEY,
  model = geminiJudgeModel(),
  random = Math.random
} = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const swapped = random() < 0.5;
  const left = stripProviderNames(swapped ? analysisB : analysisA);
  const right = stripProviderNames(swapped ? analysisA : analysisB);
  const prompt = buildJudgePrompt({ analysisA: left, analysisB: right });
  const thinkingLevel = judgeThinkingLevel();
  const started = Date.now();
  const result = await withRetry(async () => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const payload = {
      systemInstruction: {
        parts: [{ text: 'Juez anónimo de inspección fotográfica. No menciones proveedores. JSON estricto con confidence numérico 0-1 en la raíz.' }]
      },
      contents: [{
        role: 'user',
        parts: [
          ...(imageBase64
            ? [{ inline_data: { mime_type: mimeType || 'image/jpeg', data: String(imageBase64) } }]
            : []),
          { text: prompt }
        ]
      }],
      generationConfig: {
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel },
        responseMimeType: 'application/json',
        responseSchema: geminiSafeSchema(judgeJsonSchema())
      }
    };
    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = String(body?.error?.message || '');
      const thinkingRejected = res.status === 400 && /thinking/i.test(msg);
      if (thinkingRejected) {
        delete payload.generationConfig.thinkingConfig;
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        body = await res.json().catch(() => ({}));
      }
    }
    if (!res.ok) {
      throw new Error(body?.error?.message || `gemini http ${res.status}`);
    }
    const parsed = extractGeminiJson(body);
    if (!parsed) throw new Error('gemini empty judge json');
    const verdict = remapChosenSide(normalizeJudgeVerdict(parsed), swapped);
    if (!Number.isFinite(Number(verdict.confidence))) {
      throw new Error('gemini judge missing confidence');
    }
    const tokens = Number(body?.usageMetadata?.totalTokenCount || 0) || null;
    return {
      judge: {
        ...verdict,
        analysis: normalizeAnalysis({
          evaluability: verdict.evaluability,
          observations: verdict.observations,
          observation: verdict.rationale
        }, { findingKpiMap })
      },
      tokens,
      raw: parsed,
      swapped,
      thinkingLevel
    };
  }, { label: 'gemini-judge' });

  return {
    ...result,
    latencyMs: Date.now() - started,
    promptVersion: JUDGE_PROMPT_VERSION,
    model
  };
}
