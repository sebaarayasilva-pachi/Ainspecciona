/**
 * Aplica voz + corrección de audio al agente postventa en ElevenLabs.
 * Preserva el resto de la config TTS; solo cambia voice_id, model_id y latencia.
 *
 * Uso:
 *   node scripts/apply-elevenlabs-voice-fix.mjs                 # aplica valores por defecto
 *   node scripts/apply-elevenlabs-voice-fix.mjs --dry-run       # muestra el payload sin enviar
 */
import 'dotenv/config';

const AGENTS_API = 'https://api.elevenlabs.io/v1/convai/agents';

// --- Valores objetivo ---
// Restaurado al valor original tras descartar el pre-roll: stability 0.44.
// Todo lo demás (voice_id, model_id, latencia, formato de audio) se conserva tal cual
// está en el agente porque mergedTts = { ...currentTts, ...TARGET }.
const TARGET = {
  stability: 0.44
};

const dryRun = process.argv.includes('--dry-run');

function fail(msg) {
  console.error(`[voice-fix] ${msg}`);
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

function agentUrl(id, branch) {
  const url = new URL(`${AGENTS_API}/${encodeURIComponent(id)}`);
  if (branch) url.searchParams.set('branch_id', branch);
  return url.toString();
}

async function api(method, url, body) {
  const key = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!key) fail('Falta ELEVENLABS_API_KEY en .env');
  const res = await fetch(url, {
    method,
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await res.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw }; }
  if (!res.ok) fail(`${method} ${res.status}: ${raw}`);
  return data;
}

async function main() {
  const raw = process.env.ELEVENLABS_POSTVENTA_AGENT_ID;
  const agentId = sanitizeAgentId(raw);
  if (!agentId) fail('Falta ELEVENLABS_POSTVENTA_AGENT_ID');
  const branch = branchId(raw);

  const current = await api('GET', agentUrl(agentId, branch));
  const currentTts = current?.conversation_config?.tts || {};

  console.log('[voice-fix] Antes:');
  console.log(`  voice_id:                   ${currentTts.voice_id}`);
  console.log(`  model_id:                   ${currentTts.model_id}`);
  console.log(`  optimize_streaming_latency: ${currentTts.optimize_streaming_latency}`);
  console.log(`  stability:                  ${currentTts.stability}`);
  console.log(`  similarity_boost:           ${currentTts.similarity_boost}`);

  const mergedTts = { ...currentTts, ...TARGET };

  if (dryRun) {
    console.log('\n[voice-fix] --dry-run, payload TTS:');
    console.log(JSON.stringify(mergedTts, null, 2));
    return;
  }

  await api('PATCH', agentUrl(agentId, branch), {
    conversation_config: { tts: mergedTts }
  });

  const after = await api('GET', agentUrl(agentId, branch));
  const afterTts = after?.conversation_config?.tts || {};
  console.log('\n[voice-fix] Después:');
  console.log(`  voice_id:                   ${afterTts.voice_id}`);
  console.log(`  model_id:                   ${afterTts.model_id}`);
  console.log(`  optimize_streaming_latency: ${afterTts.optimize_streaming_latency}`);
  console.log(`  stability:                  ${afterTts.stability}`);
  console.log(`  similarity_boost:           ${afterTts.similarity_boost}`);
  console.log('\n[voice-fix] OK — voz y audio actualizados.');
}

main().catch((e) => fail(e?.message || String(e)));
