import { DEFAULT_SAFETY_CODES, TAXONOMY_VERSION } from './taxonomy.js';
import {
  ANALYST_PROMPT_VERSION,
  CONSENSUS_ENGINE_VERSION,
  JUDGE_PROMPT_VERSION
} from './schema.js';

export const DEFAULT_CONSENSUS_CONFIG = {
  shadowEnabled: false,
  judgeAccept: 0.85,
  judgeReview: 0.65,
  judgeHighSafety: 0.95,
  safetyCodes: DEFAULT_SAFETY_CODES.slice(),
  taxonomyVersion: TAXONOMY_VERSION,
  openaiPromptVersion: ANALYST_PROMPT_VERSION,
  geminiPromptVersion: ANALYST_PROMPT_VERSION,
  judgePromptVersion: JUDGE_PROMPT_VERSION,
  consensusEngineVersion: CONSENSUS_ENGINE_VERSION
};

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeConsensusConfig(input) {
  const src = input && typeof input === 'object' ? (input.consensus || input) : {};
  const safety = Array.isArray(src.safetyCodes) && src.safetyCodes.length
    ? src.safetyCodes.map((c) => String(c || '').trim()).filter(Boolean)
    : DEFAULT_CONSENSUS_CONFIG.safetyCodes.slice();
  return {
    shadowEnabled: src.shadowEnabled === true || src.shadowEnabled === 1 || src.shadowEnabled === '1',
    judgeAccept: num(src.judgeAccept, DEFAULT_CONSENSUS_CONFIG.judgeAccept),
    judgeReview: num(src.judgeReview, DEFAULT_CONSENSUS_CONFIG.judgeReview),
    judgeHighSafety: num(src.judgeHighSafety, DEFAULT_CONSENSUS_CONFIG.judgeHighSafety),
    safetyCodes: safety,
    taxonomyVersion: String(src.taxonomyVersion || DEFAULT_CONSENSUS_CONFIG.taxonomyVersion),
    openaiPromptVersion: String(src.openaiPromptVersion || DEFAULT_CONSENSUS_CONFIG.openaiPromptVersion),
    geminiPromptVersion: String(src.geminiPromptVersion || DEFAULT_CONSENSUS_CONFIG.geminiPromptVersion),
    judgePromptVersion: String(src.judgePromptVersion || DEFAULT_CONSENSUS_CONFIG.judgePromptVersion),
    consensusEngineVersion: String(src.consensusEngineVersion || DEFAULT_CONSENSUS_CONFIG.consensusEngineVersion)
  };
}

export function isShadowEnabled(scoreConfig) {
  if (String(process.env.CONSENSUS_SHADOW || '').trim() === '1') return true;
  return normalizeConsensusConfig(scoreConfig).shadowEnabled;
}

export function shadowRoles() {
  return {
    a: {
      name: 'OpenAI',
      model: process.env.CONSENSUS_OPENAI_MODEL || process.env.OPENAI_VISION_MODEL || 'gpt-4o'
    },
    b: {
      name: 'Gemini',
      model: process.env.GEMINI_MODEL || 'gemini-3.6-flash'
    },
    judge: {
      name: 'Claude',
      model: process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'
    }
  };
}
