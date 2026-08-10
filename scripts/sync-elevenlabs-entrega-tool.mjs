/**
 * Crea o actualiza la client tool guardar_hallazgo en ElevenLabs
 * y la vincula al agente Entrega (Recepción Técnica).
 *
 * Requiere en .env:
 *   ELEVENLABS_API_KEY
 *   ELEVENLABS_ENTREGA_AGENT_ID
 *
 * Uso:
 *   node scripts/sync-elevenlabs-entrega-tool.mjs
 *   node scripts/sync-elevenlabs-entrega-tool.mjs --status
 */
import 'dotenv/config';

const TOOLS_API = 'https://api.elevenlabs.io/v1/convai/tools';
const AGENTS_API = 'https://api.elevenlabs.io/v1/convai/agents';
const TOOL_NAME = 'guardar_hallazgo';

const statusOnly = process.argv.includes('--status');

function fail(msg) {
  console.error(`[entrega-tool] ${msg}`);
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
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
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

function guardarHallazgoToolConfig() {
  return {
    type: 'client',
    name: TOOL_NAME,
    description:
      'Solo con zona Y hallazgo, y la zona debe coincidir con un recinto del departamento. Si no coincide, responde error para que el agente pregunte de nuevo (sin abrir cámara). Si coincide, espera la foto. Secuencia: zona → hallazgo → tool → foto → siguiente.',
    expects_response: true,
    response_timeout_secs: 120,
    force_pre_tool_speech: false,
    pre_tool_speech: 'auto',
    parameters: {
      type: 'object',
      required: ['zona', 'descripcion', 'kpi', 'especialidad', 'severidad'],
      properties: {
        zona: {
          type: 'string',
          description:
            'Debe mapear a un recinto válido del departamento (lista recintos_validos). Si el inspector dice algo que no encaja, NO inventes: igual llama la tool y el cliente rechazará para que preguntes de nuevo.',
        },
        descripcion: {
          type: 'string',
          description: 'Qué se observó, en lenguaje claro (ej. pintura manchada, enchufe suelto). Si falta, pregunta ¿Qué hallazgo? sin llamar la tool.',
        },
        kpi: {
          type: 'string',
          description:
            'Categoría inferida en silencio. Una de: Terminaciones, Instalaciones Sanitarias, Instalaciones Eléctricas, Instalaciones de Gas, Fachadas y Terminaciones Exteriores, Estructura Visible, Climatización, Ventanas y Cerramientos, Áreas Verdes y Exteriores.',
        },
        especialidad: {
          type: 'string',
          description:
            'Oficio inferido en silencio del catálogo (ej. Pintor, Electricista, Gasfiter, Sellador de juntas y silicona, Instalador de cerámica).',
        },
        severidad: {
          type: 'string',
          description: 'critica, intermedia o menor. Inferir del lenguaje del inspector.',
        },
      },
    },
  };
}

async function listTools() {
  const data = await api('GET', `${TOOLS_API}?page_size=100`);
  return Array.isArray(data.tools) ? data.tools : [];
}

function findGuardarHallazgoTool(tools) {
  return tools.find((t) => {
    const cfg = t.tool_config || {};
    return cfg.type === 'client' && cfg.name === TOOL_NAME;
  });
}

async function ensureTool(tools) {
  const existing = findGuardarHallazgoTool(tools);
  const config = guardarHallazgoToolConfig();
  if (existing?.id) {
    await api('PATCH', `${TOOLS_API}/${existing.id}`, { tool_config: config });
    console.log(`[entrega-tool] Tool actualizada: ${existing.id}`);
    return existing.id;
  }

  const created = await api('POST', TOOLS_API, { tool_config: config });
  const id = created.id;
  if (!id) fail('API no devolvió id de tool');
  console.log(`[entrega-tool] Tool creada: ${id}`);
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
    console.log('[entrega-tool] Ya vinculada al agente');
    return toolIds;
  }

  toolIds.push(toolId);
  await api('PATCH', agentUrl(agentId, branchId), {
    conversation_config: {
      agent: {
        prompt: { tool_ids: toolIds },
      },
    },
  });
  console.log('[entrega-tool] Vinculada al agente');
  return toolIds;
}

async function main() {
  const agentId = sanitizeAgentId(process.env.ELEVENLABS_ENTREGA_AGENT_ID);
  if (!agentId) fail('Falta ELEVENLABS_ENTREGA_AGENT_ID en ainspecta_web/.env');
  const branchId = parseBranchId(process.env.ELEVENLABS_ENTREGA_AGENT_ID);

  const tools = await listTools();
  const existing = findGuardarHallazgoTool(tools);

  if (statusOnly) {
    console.log('[entrega-tool] Estado');
    console.log(`  agent:     ${agentId}`);
    if (branchId) console.log(`  branch_id: ${branchId}`);
    console.log(`  tool:      ${existing?.id || '(no existe)'}`);
    if (existing) {
      const cfg = existing.tool_config || {};
      console.log(`  expects_response: ${cfg.expects_response}`);
      console.log(`  timeout_secs:     ${cfg.response_timeout_secs}`);
      const agent = await api('GET', agentUrl(agentId, branchId));
      const ids = agent?.conversation_config?.agent?.prompt?.tool_ids || [];
      console.log(`  attached:  ${ids.includes(existing.id) ? 'sí' : 'no'}`);
      console.log(`  tool_ids:  ${JSON.stringify(ids)}`);
    }
    return;
  }

  const toolId = await ensureTool(tools);
  const toolIds = await attachToAgent(agentId, branchId, toolId);
  console.log('\n[entrega-tool] OK');
  console.log(`  tool_id:   ${toolId}`);
  console.log(`  tool_ids:  ${JSON.stringify(toolIds)}`);
}

main().catch((err) => {
  console.error('[entrega-tool]', err?.message || err);
  process.exit(1);
});
