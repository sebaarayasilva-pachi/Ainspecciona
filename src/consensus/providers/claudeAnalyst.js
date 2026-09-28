import { ANALYST_PROMPT_VERSION, analystJsonSchema, buildAnalystPrompt, normalizeAnalysis } from '../schema.js';
import { parseJsonLoose, withRetry } from './retry.js';

function claudeAnalystModel() {
  return process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-fable-5';
}

function usesAdaptiveThinking(model) {
  const m = String(model || '');
  return m.includes('claude-sonnet-5') || m.includes('claude-fable-5');
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

export async function analyzeWithClaude({
  imageBase64,
  mimeType = 'image/jpeg',
  slotTitle,
  slotCode,
  kpiKey,
  findingKpiMap,
  apiKey = process.env.ANTHROPIC_API_KEY,
  workspaceId = process.env.ANTHROPIC_WORKSPACE_ID,
  model = claudeAnalystModel()
} = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');
  const prompt = buildAnalystPrompt({ slotTitle, slotCode, kpiKey });
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
      max_tokens: 2048,
      system: 'Inspector técnico. Analiza SOLO evidencia visual. JSON estricto del contrato.',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: imageBase64 }
          },
          { type: 'text', text: prompt }
        ]
      }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: analystJsonSchema()
        }
      }
    };
    if (String(model).includes('claude-fable-5')) {
      payload.max_tokens = 8192;
    } else if (usesAdaptiveThinking(model)) {
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
      const schemaRejected = res.status === 400 && /output_config|output_format|json_schema|structured|thinking/i.test(msg);
      if (schemaRejected) {
        const fallback = { ...payload };
        delete fallback.output_config;
        delete fallback.thinking;
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
    if (!parsed) throw new Error('claude empty analyst json');
    const tokens = Number(body?.usage?.input_tokens || 0) + Number(body?.usage?.output_tokens || 0);
    return {
      analysis: normalizeAnalysis(parsed, { findingKpiMap }),
      tokens: tokens || null,
      raw: parsed
    };
  }, { label: 'claude-shadow' });

  return {
    ...result,
    latencyMs: Date.now() - started,
    promptVersion: ANALYST_PROMPT_VERSION,
    model
  };
}
