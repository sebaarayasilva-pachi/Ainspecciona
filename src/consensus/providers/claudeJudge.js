import { JUDGE_PROMPT_VERSION, buildJudgePrompt, judgeJsonSchema, normalizeAnalysis, normalizeJudgeVerdict } from '../schema.js';
import { parseJsonLoose, withRetry } from './retry.js';

function claudeModel() {
  return process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
}

function isSonnet5(model) {
  return String(model || '').includes('claude-sonnet-5');
}

function stripProviderNames(analysis) {
  if (!analysis || typeof analysis !== 'object') return analysis;
  const { provider, model, ...rest } = analysis;
  return rest;
}

function extractClaudePayload(body) {
  const blocks = Array.isArray(body?.content) ? body.content : [];
  for (const block of blocks) {
    if (block?.type === 'tool_use' && block.input && typeof block.input === 'object') {
      return block.input;
    }
    if (block?.type === 'json' && block.json && typeof block.json === 'object') {
      return block.json;
    }
    if (block?.parsed && typeof block.parsed === 'object') return block.parsed;
  }
  const text = blocks.map((c) => c.text).filter(Boolean).join('');
  return parseJsonLoose(text);
}

function remapChosenSide(verdict, swapped) {
  if (!swapped || !verdict) return verdict;
  if (verdict.chosenSide === 'A') verdict.chosenSide = 'B';
  else if (verdict.chosenSide === 'B') verdict.chosenSide = 'A';
  return verdict;
}

function claudeImageMediaType(mimeType) {
  const mime = String(mimeType || 'image/jpeg').toLowerCase().split(';')[0].trim();
  if (mime === 'image/png' || mime === 'image/gif' || mime === 'image/webp') return mime;
  return 'image/jpeg';
}

function judgeUserContent({ prompt, imageBase64, mimeType }) {
  const parts = [];
  if (imageBase64) {
    parts.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: claudeImageMediaType(mimeType),
        data: String(imageBase64)
      }
    });
  }
  parts.push({ type: 'text', text: prompt });
  return parts;
}

/**
 * Judge anónimo: analysis_a / analysis_b sin nombre de proveedor; orden A/B aleatorio.
 */
export async function judgeWithClaude({
  analysisA,
  analysisB,
  imageBase64,
  mimeType = 'image/jpeg',
  findingKpiMap,
  apiKey = process.env.ANTHROPIC_API_KEY,
  workspaceId = process.env.ANTHROPIC_WORKSPACE_ID,
  model = claudeModel(),
  random = Math.random
} = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');
  const swapped = random() < 0.5;
  const left = stripProviderNames(swapped ? analysisB : analysisA);
  const right = stripProviderNames(swapped ? analysisA : analysisB);
  const prompt = buildJudgePrompt({ analysisA: left, analysisB: right });
  const started = Date.now();
  const result = await withRetry(async () => {
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    };
    const ws = String(workspaceId || '').trim();
    if (ws) headers['anthropic-workspace-id'] = ws;

    const payload = {
      model,
      max_tokens: 1024,
      system: 'Juez anónimo de inspección fotográfica. No menciones proveedores. JSON estricto con confidence numérico 0-1 en la raíz.',
      messages: [{
        role: 'user',
        content: judgeUserContent({ prompt, imageBase64, mimeType })
      }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: judgeJsonSchema()
        }
      }
    };
    // Sonnet 5: temperature no default → 400; thinking adaptativo por defecto gasta tokens del juez.
    if (isSonnet5(model)) {
      payload.thinking = { type: 'disabled' };
    } else {
      payload.temperature = 0;
    }

    let res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    let body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = String(body?.error?.message || '');
      const schemaRejected = res.status === 400 && /output_config|output_format|json_schema|structured/i.test(msg);
      if (schemaRejected) {
        const { output_config: _ignored, ...fallback } = payload;
        res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers,
          body: JSON.stringify(fallback)
        });
        body = await res.json().catch(() => ({}));
      }
    }
    if (!res.ok) {
      throw new Error(body?.error?.message || `anthropic http ${res.status}`);
    }
    const parsed = extractClaudePayload(body);
    if (!parsed) throw new Error('claude empty judge json');
    const verdict = remapChosenSide(normalizeJudgeVerdict(parsed), swapped);
    if (!Number.isFinite(Number(verdict.confidence))) {
      throw new Error('claude judge missing confidence');
    }
    const tokens = Number(body?.usage?.input_tokens || 0) + Number(body?.usage?.output_tokens || 0);
    return {
      judge: {
        ...verdict,
        analysis: normalizeAnalysis({
          evaluability: verdict.evaluability,
          observations: verdict.observations,
          observation: verdict.rationale
        }, { findingKpiMap })
      },
      tokens: tokens || null,
      raw: parsed,
      swapped
    };
  }, { label: 'claude-judge' });

  return {
    ...result,
    latencyMs: Date.now() - started,
    promptVersion: JUDGE_PROMPT_VERSION,
    model
  };
}

export function anonymizePair(analysisA, analysisB, random = Math.random) {
  const swapped = random() < 0.5;
  return {
    analysis_a: stripProviderNames(swapped ? analysisB : analysisA),
    analysis_b: stripProviderNames(swapped ? analysisA : analysisB),
    swapped
  };
}
