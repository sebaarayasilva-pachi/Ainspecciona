/**

 * Sincroniza webhooks postventa en ElevenLabs:

 * - validate_warranty (crear si falta)

 * - Corrige header auth en create_capture_session (typo x-postventa-agent-secre)

 * - Unifica headers y vincula tools al agente

 *

 * Uso:

 *   node scripts/sync-elevenlabs-postventa-webhooks.mjs

 *   node scripts/sync-elevenlabs-postventa-webhooks.mjs --status

 */

import 'dotenv/config';



const TOOLS_API = 'https://api.elevenlabs.io/v1/convai/tools';

const AGENTS_API = 'https://api.elevenlabs.io/v1/convai/agents';



/**
 * Nombre canónico de cada tool en ElevenLabs. El script resuelve los IDs
 * por nombre (robusto ante recreación de tools / cambio de cuenta) y solo
 * cae a FALLBACK_IDS si la API no devuelve la tool por nombre.
 */
const TOOL_NAMES = {
  lookup: 'lookup_owner_unit',
  validate: 'validate_warranty',
  ticket: 'create_postventa_ticket',
  capture: 'create_capture_session',
  status: 'get_ticket_status',
  openCapture: 'open_capture'
};

const FALLBACK_IDS = {
  lookup: 'tool_3901kt7rednnf03tgrhw56ev9g77',
  ticket: 'tool_6801ktacg4asf9v91zchmtd0bkqy',
  capture: 'tool_0601ktadm3ckfd6914yvz9mzj415',
  status: 'tool_8101ktadqgcce45rv26mjtq2zbvy',
  openCapture: 'tool_4601ktc63cfbepfsqpshgy295v80'
};

/** Resuelto en runtime desde la API por nombre (con fallback). */
const KNOWN = {
  lookup: null,
  validate: null,
  ticket: null,
  capture: null,
  status: null,
  openCapture: null
};



const SECRET_HEADER = {

  'x-postventa-agent-secret': { secret_id: 'Y97IG5agLDQB8e0MmU86' },

  'postventa-agent-secret': { secret_id: 'Y97IG5agLDQB8e0MmU86' }

};



const statusOnly = process.argv.includes('--status');



function fail(msg) {

  console.error(`[pv-webhooks] ${msg}`);

  process.exit(1);

}



function apiKey() {

  const key = String(process.env.ELEVENLABS_API_KEY || '').trim();

  if (!key) fail('Falta ELEVENLABS_API_KEY');

  return key;

}



function agentId() {

  const raw = process.env.ELEVENLABS_POSTVENTA_AGENT_ID || '';

  const match = raw.match(/(agent_[a-zA-Z0-9]+)/);

  if (!match) fail('Falta ELEVENLABS_POSTVENTA_AGENT_ID');

  return match[1];

}



function branchId() {

  const raw = process.env.ELEVENLABS_POSTVENTA_AGENT_ID || '';

  const m = raw.match(/branch_id=([^&]+)/);

  return m?.[1] || process.env.ELEVENLABS_POSTVENTA_BRANCH_ID || null;

}



function agentUrl(id, branch) {

  const url = new URL(`${AGENTS_API}/${encodeURIComponent(id)}`);

  if (branch) url.searchParams.set('branch_id', branch);

  return url.toString();

}



async function api(method, url, body) {

  const res = await fetch(url, {

    method,

    headers: { 'xi-api-key': apiKey(), 'Content-Type': 'application/json' },

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



function webhookTool(name, description, url, bodySchema, headers = SECRET_HEADER) {

  return {

    type: 'webhook',

    name,

    description,

    response_timeout_secs: 25,

    pre_tool_speech: 'off',

    execution_mode: 'immediate',

    api_schema: {

      url,

      method: 'POST',

      content_type: 'application/json',

      request_headers: headers,

      request_body_schema: bodySchema

    }

  };

}



function validateWarrantyConfig() {

  return webhookTool(

    'validate_warranty',

    'Prevalida plazo de garantía Art. 18 LGUC. Usar DESPUÉS de lookup_owner_unit y categoría confirmada. Lee messageForOwner al propietario.',

    'https://ainspecciona.com/api/postventa/agent/validate-warranty',

    {

      type: 'object',

      required: ['unitId', 'preliminaryCategory'],

      properties: {

        unitId: { type: 'string', description: 'unitId devuelto por lookup_owner_unit' },

        preliminaryCategory: {

          type: 'string',

          description: 'Código categoría: humedad_filtracion, puertas_cerraduras, etc.'

        }

      }

    }

  );

}



function captureSessionConfig() {

  return webhookTool(

    'create_capture_session',

    'Genera sesión de captura guiada de fotos. Usar INMEDIATAMENTE después de create_postventa_ticket. Devuelve captureUrl para open_capture.',

    'https://ainspecciona.com/api/postventa/agent/create-capture-session',

    {

      type: 'object',

      required: ['ticketId', 'category'],

      properties: {

        ticketId: { type: 'string', description: 'ticketId devuelto por create_postventa_ticket' },

        category: {

          type: 'string',

          description: 'Mismo preliminaryCategory del ticket, ej. humedad_filtracion'

        },

        expiresInHours: { type: 'integer', description: 'Horas validez link. Default 72.' }

      }

    }

  );

}



async function listTools() {

  const data = await api('GET', `${TOOLS_API}?page_size=100`);

  return data.tools || [];

}



async function findToolByName(tools, name) {

  return tools.find((t) => t?.tool_config?.name === name) || null;

}



/** Llena KNOWN con los IDs resueltos por nombre; usa FALLBACK_IDS si falta. */
function resolveKnownTools(tools) {

  for (const key of Object.keys(TOOL_NAMES)) {

    const byName = tools.find((t) => t?.tool_config?.name === TOOL_NAMES[key]);

    if (byName?.id) {

      KNOWN[key] = byName.id;

    } else if (FALLBACK_IDS[key]) {

      KNOWN[key] = FALLBACK_IDS[key];

      console.warn(`[pv-webhooks] "${TOOL_NAMES[key]}" no encontrada por nombre; usando ID fallback ${FALLBACK_IDS[key]}`);

    } else {

      KNOWN[key] = null;

      console.warn(`[pv-webhooks] "${TOOL_NAMES[key]}" no encontrada y sin fallback.`);

    }

  }

}



async function ensureValidateTool(tools) {

  const existing = await findToolByName(tools, 'validate_warranty');

  if (existing?.id) {

    await api('PATCH', `${TOOLS_API}/${existing.id}`, { tool_config: validateWarrantyConfig() });

    console.log(`[pv-webhooks] validate_warranty actualizada: ${existing.id}`);

    return existing.id;

  }

  const created = await api('POST', TOOLS_API, { tool_config: validateWarrantyConfig() });

  console.log(`[pv-webhooks] validate_warranty creada: ${created.id}`);

  return created.id;

}



async function fixCaptureTool() {

  await api('PATCH', `${TOOLS_API}/${KNOWN.capture}`, { tool_config: captureSessionConfig() });

  console.log(`[pv-webhooks] create_capture_session header corregido: ${KNOWN.capture}`);

}



async function disablePreToolSpeech(toolId, label) {

  const data = await api('GET', `${TOOLS_API}/${toolId}`);

  const cfg = data?.tool_config;

  if (!cfg) {

    console.warn(`[pv-webhooks] Sin tool_config para ${label} (${toolId})`);

    return;

  }

  if (cfg.pre_tool_speech === 'off') {

    console.log(`[pv-webhooks] ${label}: pre_tool_speech ya off`);

    return;

  }

  await api('PATCH', `${TOOLS_API}/${toolId}`, {

    tool_config: { ...cfg, pre_tool_speech: 'off' }

  });

  console.log(`[pv-webhooks] ${label}: pre_tool_speech → off`);

}



async function disablePreToolSpeechAll() {

  const ids = [

    ['lookup_owner_unit', KNOWN.lookup],

    ['validate_warranty', KNOWN.validate],

    ['create_postventa_ticket', KNOWN.ticket],

    ['create_capture_session', KNOWN.capture],

    ['get_ticket_status', KNOWN.status]

  ];

  for (const [label, id] of ids) {

    if (!id) continue;

    await disablePreToolSpeech(id, label);

  }

}



async function attachAgentTools(toolIds) {

  const id = agentId();

  const branch = branchId();

  const expected = [

    KNOWN.lookup,

    toolIds.validate,

    KNOWN.ticket,

    KNOWN.capture,

    KNOWN.status,

    KNOWN.openCapture

  ].filter(Boolean);

  await api('PATCH', agentUrl(id, branch), {

    conversation_config: {

      agent: {

        prompt: { tool_ids: expected }

      }

    }

  });

  console.log('[pv-webhooks] tool_ids agente:', JSON.stringify(expected));

}



async function main() {

  const tools = await listTools();

  resolveKnownTools(tools);

  const validateExisting = await findToolByName(tools, 'validate_warranty');

  KNOWN.validate = validateExisting?.id || null;



  if (statusOnly) {

    const capture = tools.find((t) => t.id === KNOWN.capture);

    const headers = Object.keys(capture?.tool_config?.api_schema?.request_headers || {});

    console.log('[pv-webhooks] Estado');

    console.log(`  validate_warranty: ${KNOWN.validate || '(no existe)'}`);

    console.log(`  capture headers: ${JSON.stringify(headers)}`);

    const agent = await api('GET', agentUrl(agentId(), branchId()));

    console.log(`  agent tools: ${JSON.stringify(agent?.conversation_config?.agent?.prompt?.tool_ids || [])}`);

    return;

  }



  const validateId = await ensureValidateTool(tools);

  KNOWN.validate = validateId;

  await fixCaptureTool();

  await disablePreToolSpeechAll();

  await attachAgentTools({ validate: validateId });

  console.log('\n[pv-webhooks] OK');

}



main().catch((err) => {

  console.error('[pv-webhooks]', err?.message || err);

  process.exit(1);

});

