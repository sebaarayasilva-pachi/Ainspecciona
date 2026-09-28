import OpenAI from 'openai';
import { ANALYST_PROMPT_VERSION, analystJsonSchema, buildAnalystPrompt, normalizeAnalysis } from '../schema.js';
import { parseJsonLoose, withRetry } from './retry.js';

export async function analyzeWithOpenAI({
  imageBase64,
  mimeType = 'image/jpeg',
  slotTitle,
  slotCode,
  kpiKey,
  findingKpiMap,
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.CONSENSUS_OPENAI_MODEL || process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini'
} = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  const prompt = buildAnalystPrompt({ slotTitle, slotCode, kpiKey });
  const started = Date.now();
  const result = await withRetry(async () => {
    const client = new OpenAI({ apiKey });
    const request = {
      model,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: `data:${mimeType};base64,${imageBase64}` }
        ]
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'consensus_analyst',
          strict: true,
          schema: analystJsonSchema()
        }
      }
    };
    if (String(model).includes('gpt-5.6')) {
      request.reasoning = { effort: process.env.CONSENSUS_OPENAI_EFFORT || 'medium' };
    } else {
      request.temperature = 0.1;
    }
    const response = await client.responses.create(request);
    const parsed = parseJsonLoose(response.output_text);
    if (!parsed) throw new Error('openai empty consensus json');
    return {
      analysis: normalizeAnalysis(parsed, { findingKpiMap }),
      tokens: Number(response.usage?.total_tokens || 0) || null,
      raw: parsed
    };
  }, { label: 'openai-shadow' });

  return {
    ...result,
    latencyMs: Date.now() - started,
    promptVersion: ANALYST_PROMPT_VERSION,
    model
  };
}
