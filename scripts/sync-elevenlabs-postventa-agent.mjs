/**
 * Sincroniza prompt y first message del agente postventa ElevenLabs
 * desde docs/postventa/PROMPT_AGENTE_POSTVENTA.md
 *
 * Requiere en .env:
 *   ELEVENLABS_API_KEY
 *   ELEVENLABS_POSTVENTA_AGENT_ID
 *
 * Uso:
 *   node scripts/sync-elevenlabs-postventa-agent.mjs           # push a ElevenLabs
 *   node scripts/sync-elevenlabs-postventa-agent.mjs --dry-run
 *   node scripts/sync-elevenlabs-postventa-agent.mjs --status  # lee agente remoto
 *   node scripts/sync-elevenlabs-postventa-agent.mjs --pull    # muestra diff vs repo
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PROMPT_FILE = path.join(ROOT, 'docs/postventa/PROMPT_AGENTE_POSTVENTA.md');
const API_BASE = 'https://api.elevenlabs.io/v1/convai/agents';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const statusOnly = args.has('--status');
const pullOnly = args.has('--pull');

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
  return String(process.env.ELEVENLABS_POSTVENTA_BRANCH_ID || '').trim() || null;
}

function readPromptDoc(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`No existe ${filePath}`);
  }
  const text = fs.readFileSync(filePath, 'utf8');

  const normalized = text.replace(/\r\n/g, '\n');
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
  if (!firstMessage) {
    fail('First message no encontrado (bloque ``` bajo **First message**).');
  }

  return { systemPrompt, firstMessage };
}

function agentUrl(agentId, branchId) {
  const url = new URL(`${API_BASE}/${encodeURIComponent(agentId)}`);
  if (branchId) url.searchParams.set('branch_id', branchId);
  return url.toString();
}

async function apiRequest(method, agentId, branchId, body) {
  const apiKey = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!apiKey) {
    fail('Falta ELEVENLABS_API_KEY en ainspecta_web/.env (ElevenLabs → Profile → API Keys).');
  }

  const res = await fetch(agentUrl(agentId, branchId), {
    method,
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { raw };
  }

  if (!res.ok) {
    const detail = data?.detail?.message || data?.detail || data?.message || raw;
    fail(`${method} ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }

  return data;
}

function extractRemoteConfig(agent) {
  const agentCfg = agent?.conversation_config?.agent || {};
  const promptCfg = agentCfg.prompt || {};
  const kb = promptCfg.knowledge_base || agentCfg.knowledge_base || [];
  const kbDocs = Array.isArray(kb) ? kb : kb?.document_ids || kb?.documents || [];
  const kbCount = Array.isArray(kbDocs) ? kbDocs.length : 0;
  return {
    name: agent?.name || '(sin nombre)',
    firstMessage: String(agentCfg.first_message || '').trim(),
    systemPrompt: String(promptCfg.prompt || '').trim(),
    language: agentCfg.language || null,
    knowledgeBaseCount: kbCount,
    toolIds: promptCfg.tool_ids || []
  };
}

function preview(text, max = 120) {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}

async function main() {
  const agentId = sanitizeAgentId(process.env.ELEVENLABS_POSTVENTA_AGENT_ID);
  if (!agentId) {
    fail('Falta ELEVENLABS_POSTVENTA_AGENT_ID en ainspecta_web/.env');
  }
  const branchId = parseBranchId(process.env.ELEVENLABS_POSTVENTA_AGENT_ID);

  const local = readPromptDoc(PROMPT_FILE);

  if (statusOnly || pullOnly) {
    const remoteAgent = await apiRequest('GET', agentId, branchId);
    const remote = extractRemoteConfig(remoteAgent);

    console.log('[elevenlabs-sync] Agente remoto');
    console.log(`  id:           ${agentId}`);
    if (branchId) console.log(`  branch_id:    ${branchId}`);
    console.log(`  name:         ${remote.name}`);
    console.log(`  language:     ${remote.language || '(default)'}`);
    console.log(`  first_message (${remote.firstMessage.length} chars): ${preview(remote.firstMessage)}`);
    console.log(`  system_prompt (${remote.systemPrompt.length} chars): ${preview(remote.systemPrompt)}`);
    console.log(`  knowledge_base docs: ${remote.knowledgeBaseCount ?? '?'}`);
    console.log(`  tool_ids: ${JSON.stringify(remote.toolIds || [])}`);
    if ((remote.knowledgeBaseCount || 0) > 0) {
      console.warn('\n  ⚠ RAG/Knowledge Base activo — puede mezclar casos anteriores. Desactívalo en ElevenLabs.');
    }

    if (pullOnly) {
      const samePrompt = remote.systemPrompt === local.systemPrompt;
      const sameFirst = remote.firstMessage === local.firstMessage;
      console.log('\n[elevenlabs-sync] Comparación con repo');
      console.log(`  system_prompt: ${samePrompt ? 'IGUAL' : 'DIFERENTE'}`);
      console.log(`  first_message: ${sameFirst ? 'IGUAL' : 'DIFERENTE'}`);
      if (!samePrompt || !sameFirst) {
        console.log('\n  Edita docs/postventa/PROMPT_AGENTE_POSTVENTA.md y ejecuta npm run sync:elevenlabs-postventa');
      }
    }
    return;
  }

  console.log('[elevenlabs-sync] Push → ElevenLabs');
  console.log(`  agent:        ${agentId}`);
  if (branchId) console.log(`  branch_id:    ${branchId}`);
  console.log(`  source:       ${path.relative(ROOT, PROMPT_FILE)}`);
  console.log(`  prompt:       ${local.systemPrompt.length} caracteres`);
  console.log(`  first_message: ${local.firstMessage.length} caracteres`);

  let existingTts = {};
  try {
    const remoteAgent = await apiRequest('GET', agentId, branchId);
    existingTts = remoteAgent?.conversation_config?.tts || {};
  } catch {
    /* conservar defaults si falla GET */
  }

  const payload = {
    conversation_config: {
      agent: {
        language: 'es',
        first_message: local.firstMessage,
        prompt: {
          prompt: local.systemPrompt
        }
      },
      tts: {
        ...existingTts,
        model_id: existingTts.model_id || 'eleven_flash_v2_5',
        // 3 = arranque de audio más fluido (evita el entrecortado del inicio).
        // Igualado al agente "Postventa prueba" que suena suave.
        optimize_streaming_latency: 3
      }
    }
  };

  if (dryRun) {
    console.log('\n[elevenlabs-sync] --dry-run: no se envió PATCH.');
    return;
  }

  const updated = await apiRequest('PATCH', agentId, branchId, payload);
  const remote = extractRemoteConfig(updated);

  console.log('\n[elevenlabs-sync] OK — agente actualizado');
  console.log(`  name: ${remote.name}`);
  console.log(`  first_message: ${preview(remote.firstMessage)}`);
  console.log(`  system_prompt: ${preview(remote.systemPrompt)}`);
}

main().catch((err) => {
  console.error('[elevenlabs-sync]', err?.message || err);
  process.exit(1);
});
