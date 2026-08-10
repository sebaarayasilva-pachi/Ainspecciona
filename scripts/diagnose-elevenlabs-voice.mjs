/**
 * Diagnóstico de voz del agente postventa: muestra la config TTS real en ElevenLabs.
 * Uso: node scripts/diagnose-elevenlabs-voice.mjs
 */
import 'dotenv/config';

const AGENTS_API = 'https://api.elevenlabs.io/v1/convai/agents';
const VOICES_API = 'https://api.elevenlabs.io/v1/voices';

function fail(msg) {
  console.error(`[voice-diag] ${msg}`);
  process.exit(1);
}

function sanitizeAgentId(raw) {
  const s = String(raw || '').trim();
  const match = s.match(/(agent_[a-zA-Z0-9]+)/);
  return match ? match[1] : s.split('&')[0].split('?')[0].trim();
}

function branchId(raw) {
  const m = String(raw || '').match(/branch_id=([^&]+)/);
  return m?.[1] || String(process.env.ELEVENLABS_POSTVENTA_BRANCH_ID || '').trim() || null;
}

async function api(url) {
  const key = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!key) fail('Falta ELEVENLABS_API_KEY en .env');
  const res = await fetch(url, { headers: { 'xi-api-key': key } });
  const raw = await res.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw }; }
  if (!res.ok) fail(`${res.status}: ${typeof data?.detail === 'string' ? data.detail : raw}`);
  return data;
}

async function voiceName(voiceId) {
  if (!voiceId) return '(sin voice_id)';
  try {
    const v = await api(`${VOICES_API}/${encodeURIComponent(voiceId)}`);
    return `${v?.name || '(?)'} [${voiceId}]`;
  } catch {
    return `(no encontrada) [${voiceId}]`;
  }
}

async function main() {
  const raw = process.env.ELEVENLABS_POSTVENTA_AGENT_ID;
  const agentId = sanitizeAgentId(raw);
  if (!agentId) fail('Falta ELEVENLABS_POSTVENTA_AGENT_ID');
  const branch = branchId(raw);

  const url = new URL(`${AGENTS_API}/${encodeURIComponent(agentId)}`);
  if (branch) url.searchParams.set('branch_id', branch);

  const agent = await api(url.toString());
  const cc = agent?.conversation_config || {};
  const tts = cc.tts || {};
  const agentCfg = cc.agent || {};

  console.log('[voice-diag] Agente postventa');
  console.log(`  id:                        ${agentId}`);
  if (branch) console.log(`  branch_id:                 ${branch}`);
  console.log(`  name:                      ${agent?.name || '(sin nombre)'}`);
  console.log(`  language:                  ${agentCfg.language || '(default)'}`);
  console.log('  --- TTS ---');
  console.log(`  voice_id:                  ${await voiceName(tts.voice_id)}`);
  console.log(`  model_id:                  ${tts.model_id || '(default)'}`);
  console.log(`  optimize_streaming_latency: ${tts.optimize_streaming_latency ?? '(default)'}`);
  console.log(`  stability:                 ${tts.stability ?? '(default)'}`);
  console.log(`  similarity_boost:          ${tts.similarity_boost ?? '(default)'}`);
  console.log(`  speed:                     ${tts.speed ?? '(default)'}`);
  console.log('\n  TTS completo:');
  console.log(JSON.stringify(tts, null, 2));
}

main().catch((e) => fail(e?.message || String(e)));
