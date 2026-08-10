/**
 * Crea (si falta) la client tool open_capture en ElevenLabs
 * y la vincula al agente postventa via tool_ids.
 *
 * Uso:
 *   node scripts/sync-elevenlabs-open-capture-tool.mjs
 *   node scripts/sync-elevenlabs-open-capture-tool.mjs --status
 */
import 'dotenv/config';

const TOOLS_API = 'https://api.elevenlabs.io/v1/convai/tools';
const AGENTS_API = 'https://api.elevenlabs.io/v1/convai/agents';
const TOOL_NAME = 'open_capture';

const statusOnly = process.argv.includes('--status');

function fail(msg) {
  console.error(`[open-capture-tool] ${msg}`);
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

function apiKey() {
  const key = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!key) fail('Falta ELEVENLABS_API_KEY en ainspecta_web/.env');
  return key;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      'xi-api-key': apiKey(),
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

function openCaptureToolConfig() {
  return {
    type: 'client',
    name: TOOL_NAME,
    description:
      'Abre captura EMBEBIDA (cámara abajo). SOLO después de explicar en voz que abrirás la cámara para captar evidencia y de decir "Voy a abrir la cámara.". NUNCA durante el mensaje de prevalidación de garantía. Pasar captureUrl en url. NO cuelgues: espera [CAPTURA INICIO] y guía hasta [CAPTURA FIN]. NUNCA dictar la URL.',
    expects_response: true,
    response_timeout_secs: 30,
    parameters: {
      type: 'object',
      required: ['url'],
      properties: {
        url: {
          type: 'string',
          description:
            'URL completa devuelta por create_capture_session (campo captureUrl). Ejemplo: https://ainspecciona.com/postventa/capture/cs_...'
        }
      }
    }
  };
}

async function listTools() {
  const data = await api('GET', `${TOOLS_API}?page_size=100`);
  return Array.isArray(data.tools) ? data.tools : [];
}

async function findOpenCaptureTool(tools) {
  return tools.find((t) => {
    const cfg = t.tool_config || {};
    return cfg.type === 'client' && cfg.name === TOOL_NAME;
  });
}

async function ensureTool(tools) {
  const existing = await findOpenCaptureTool(tools);
  const config = openCaptureToolConfig();
  if (existing?.id) {
    await api('PATCH', `${TOOLS_API}/${existing.id}`, { tool_config: config });
    console.log(`[open-capture-tool] Tool actualizada: ${existing.id}`);
    return existing.id;
  }

  const created = await api('POST', TOOLS_API, { tool_config: openCaptureToolConfig() });
  const id = created.id;
  if (!id) fail('API no devolvió id de tool');
  console.log(`[open-capture-tool] Tool creada: ${id}`);
  return id;
}

function agentUrl(agentId, branchId) {
  const url = new URL(`${AGENTS_API}/${encodeURIComponent(agentId)}`);
  if (branchId) url.searchParams.set('branch_id', branchId);
  return url.toString();
}

async function attachToAgent(agentId, branchId, toolId) {
  const agent = await api('GET', agentUrl(agentId, branchId));
  const prompt = agent?.conversation_config?.agent?.prompt || {};
  const toolIds = Array.isArray(prompt.tool_ids) ? [...prompt.tool_ids] : [];

  if (toolIds.includes(toolId)) {
    console.log('[open-capture-tool] Ya vinculada al agente');
    return toolIds;
  }

  toolIds.push(toolId);
  await api('PATCH', agentUrl(agentId, branchId), {
    conversation_config: {
      agent: {
        prompt: { tool_ids: toolIds }
      }
    }
  });
  console.log('[open-capture-tool] Vinculada al agente');
  return toolIds;
}

async function main() {
  const agentId = sanitizeAgentId(process.env.ELEVENLABS_POSTVENTA_AGENT_ID);
  if (!agentId) fail('Falta ELEVENLABS_POSTVENTA_AGENT_ID');
  const branchId = parseBranchId(process.env.ELEVENLABS_POSTVENTA_AGENT_ID);

  const tools = await listTools();
  const openCapture = await findOpenCaptureTool(tools);

  if (statusOnly) {
    console.log('[open-capture-tool] Estado');
    console.log(`  agent:     ${agentId}`);
    if (branchId) console.log(`  branch_id: ${branchId}`);
    console.log(`  tool:      ${openCapture?.id || '(no existe)'}`);
    if (openCapture) {
      const agent = await api('GET', agentUrl(agentId, branchId));
      const ids = agent?.conversation_config?.agent?.prompt?.tool_ids || [];
      console.log(`  attached:  ${ids.includes(openCapture.id) ? 'sí' : 'no'}`);
      console.log(`  tool_ids:  ${JSON.stringify(ids)}`);
    }
    return;
  }

  const toolId = await ensureTool(tools);
  const toolIds = await attachToAgent(agentId, branchId, toolId);
  console.log('\n[open-capture-tool] OK');
  console.log(`  tool_id:   ${toolId}`);
  console.log(`  tool_ids:  ${JSON.stringify(toolIds)}`);
}

main().catch((err) => {
  console.error('[open-capture-tool]', err?.message || err);
  process.exit(1);
});
