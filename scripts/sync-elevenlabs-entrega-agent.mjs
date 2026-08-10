/**
 * Sincroniza prompt y first message del agente de captura "Entrega" (ElevenLabs)
 * desde docs/entrega/PROMPT_AGENTE_ENTREGA.md
 *
 * Requiere en .env:
 *   ELEVENLABS_API_KEY
 *   ELEVENLABS_ENTREGA_AGENT_ID
 *
 * Uso:
 *   node scripts/sync-elevenlabs-entrega-agent.mjs           # push a ElevenLabs
 *   node scripts/sync-elevenlabs-entrega-agent.mjs --dry-run
 *   node scripts/sync-elevenlabs-entrega-agent.mjs --status  # lee agente remoto
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PROMPT_FILE = path.join(ROOT, 'docs/entrega/PROMPT_AGENTE_ENTREGA.md');
const API_BASE = 'https://api.elevenlabs.io/v1/convai/agents';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const statusOnly = args.has('--status');

function fail(msg) {
  console.error(`[elevenlabs-sync] ${msg}`);
  process.exit(1);
}

function sanitizeAgentId(raw) {
  const s = String(raw || '').trim();
  const match = s.match(/(agent_[a-zA-Z0-9]+)/);
  if (match) return match[1];
  return s.split('&')[0].split('?')[0].trim();
}

function parseBranchId(raw) {
  const s = String(raw || '').trim();
  const fromQuery = s.match(/[?&]branch_id=([^&]+)/);
  if (fromQuery) return fromQuery[1];
  return String(process.env.ELEVENLABS_ENTREGA_BRANCH_ID || '').trim() || null;
}

function readPromptDoc(filePath) {
  if (!fs.existsSync(filePath)) fail(`No existe ${filePath}`);
  const normalized = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const startMarker = '--- INICIO PROMPT ---';
  const endMarker = '--- FIN PROMPT ---';
  const start = normalized.indexOf(`\n${startMarker}\n`);
  const end = normalized.indexOf(`\n${endMarker}\n`);
  if (start === -1 || end === -1 || end <= start) {
    fail(`Marcadores ${startMarker} / ${endMarker} no encontrados (línea propia).`);
  }
  const systemPrompt = normalized.slice(start + startMarker.length + 2, end).trim();
  const firstMsgMatch = normalized.match(/\*\*First message[^*]*\*\*[\s\S]*?```\s*\n([\s\S]*?)```/i);
  const firstMessage = (firstMsgMatch?.[1] || '').trim();
  if (!firstMessage) fail('First message no encontrado (bloque ``` bajo **First message**).');
  return { systemPrompt, firstMessage };
}

function agentUrl(agentId, branchId) {
  const url = new URL(`${API_BASE}/${encodeURIComponent(agentId)}`);
  if (branchId) url.searchParams.set('branch_id', branchId);
  return url.toString();
}

async function apiRequest(method, agentId, branchId, body) {
  const apiKey = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!apiKey) fail('Falta ELEVENLABS_API_KEY en ainspecta_web/.env');
  const res = await fetch(agentUrl(agentId, branchId), {
    method,
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await res.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw }; }
  if (!res.ok) {
    const detail = data?.detail?.message || data?.detail || data?.message || raw;
    fail(`${method} ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return data;
}

function preview(text, max = 120) {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}

async function main() {
  const agentId = sanitizeAgentId(process.env.ELEVENLABS_ENTREGA_AGENT_ID);
  if (!agentId) fail('Falta ELEVENLABS_ENTREGA_AGENT_ID en ainspecta_web/.env');
  const branchId = parseBranchId(process.env.ELEVENLABS_ENTREGA_AGENT_ID);
  const local = readPromptDoc(PROMPT_FILE);

  if (statusOnly) {
    const remote = await apiRequest('GET', agentId, branchId);
    const agentCfg = remote?.conversation_config?.agent || {};
    console.log('[elevenlabs-sync] Agente remoto (Entrega)');
    console.log(`  id:           ${agentId}`);
    console.log(`  name:         ${remote?.name || '(sin nombre)'}`);
    console.log(`  first_message: ${preview(agentCfg.first_message)}`);
    console.log(`  system_prompt: ${preview(agentCfg?.prompt?.prompt)}`);
    return;
  }

  console.log('[elevenlabs-sync] Push → ElevenLabs (Entrega)');
  console.log(`  agent:        ${agentId}`);
  if (branchId) console.log(`  branch_id:    ${branchId}`);
  console.log(`  prompt:       ${local.systemPrompt.length} caracteres`);
  console.log(`  first_message: ${local.firstMessage.length} caracteres`);

  let existingTts = {};
  let existingTurn = {};
  try {
    const remoteAgent = await apiRequest('GET', agentId, branchId);
    existingTts = remoteAgent?.conversation_config?.tts || {};
    existingTurn = remoteAgent?.conversation_config?.turn || {};
  } catch { /* defaults */ }

  const softTimeout = {
    ...(existingTurn.soft_timeout_config || {}),
    message: 'Un momento…',
    additional_soft_timeout_messages: ['Dame un segundo…', 'Ya casi…'],
    use_llm_generated_message: false,
    randomize_fillers: true,
  };

  const payload = {
    conversation_config: {
      agent: {
        language: 'es',
        first_message: local.firstMessage,
        prompt: { prompt: local.systemPrompt }
      },
      turn: {
        ...existingTurn,
        soft_timeout_config: softTimeout,
      },
      tts: {
        ...existingTts,
        // Agentes no-inglés requieren turbo/flash v2_5; forzamos flash salvo que ya use uno válido.
        model_id: ['eleven_flash_v2_5', 'eleven_turbo_v2_5'].includes(existingTts.model_id)
          ? existingTts.model_id
          : 'eleven_flash_v2_5',
        optimize_streaming_latency: 3
      }
    }
  };

  if (dryRun) {
    console.log('\n[elevenlabs-sync] --dry-run: no se envió PATCH.');
    return;
  }

  const updated = await apiRequest('PATCH', agentId, branchId, payload);
  console.log('\n[elevenlabs-sync] OK — agente actualizado');
  console.log(`  name: ${updated?.name || '(sin nombre)'}`);
}

main().catch((err) => {
  console.error('[elevenlabs-sync]', err?.message || err);
  process.exit(1);
});
