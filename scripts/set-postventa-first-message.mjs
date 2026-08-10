/**
 * Ajusta el first_message del agente postventa en ElevenLabs.
 * Lo dejamos vacío para que la grabación de saludo (pre-roll) no se pise con
 * la voz entrecortada del arranque del widget.
 *
 * Uso:
 *   node scripts/set-postventa-first-message.mjs            # lo deja vacío
 *   node scripts/set-postventa-first-message.mjs "Hola..."  # lo fija a ese texto
 *   node scripts/set-postventa-first-message.mjs --show     # solo muestra el actual
 */
import 'dotenv/config';

const AGENTS_API = 'https://api.elevenlabs.io/v1/convai/agents';

function fail(msg) {
  console.error(`[first-message] ${msg}`);
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

  const showOnly = process.argv.includes('--show');
  const newValue = showOnly ? null : (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '');

  const current = await api('GET', agentUrl(agentId, branch));
  const currentFirst = current?.conversation_config?.agent?.first_message;
  console.log(`[first-message] Actual: ${JSON.stringify(currentFirst)}`);

  if (showOnly) return;

  await api('PATCH', agentUrl(agentId, branch), {
    conversation_config: { agent: { first_message: newValue } }
  });

  const after = await api('GET', agentUrl(agentId, branch));
  console.log(`[first-message] Nuevo:  ${JSON.stringify(after?.conversation_config?.agent?.first_message)}`);
  console.log('[first-message] OK.');
}

main().catch((e) => fail(e?.message || String(e)));
