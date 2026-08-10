/**
 * Corrige el schema de lookup_owner_unit en ElevenLabs (webhook).
 * Problema histórico: required ownerPhone, sin address/comuna, campos mal nombrados.
 *
 * Uso:
 *   node scripts/sync-elevenlabs-lookup-tool.mjs
 *   node scripts/sync-elevenlabs-lookup-tool.mjs --status
 */
import 'dotenv/config';

const TOOLS_API = 'https://api.elevenlabs.io/v1/convai/tools';
const LOOKUP_TOOL_ID = 'tool_3901kt7rednnf03tgrhw56ev9g77';

const statusOnly = process.argv.includes('--status');

function fail(msg) {
  console.error(`[lookup-tool] ${msg}`);
  process.exit(1);
}

function apiKey() {
  const key = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!key) fail('Falta ELEVENLABS_API_KEY');
  return key;
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

function lookupToolConfig(existingApiSchema) {
  const headers = existingApiSchema?.request_headers || {
    'x-postventa-agent-secret': { secret_id: 'Y97IG5agLDQB8e0MmU86' }
  };

  return {
    type: 'webhook',
    name: 'lookup_owner_unit',
    description:
      'Valida unidad por dirección, comuna y depto. NO pedir torre ni RUT al propietario. NO usar teléfono. Inmobiliaria deducida del proyecto.',
    response_timeout_secs: 25,
    pre_tool_speech: 'off',
    execution_mode: 'immediate',
    api_schema: {
      url: 'https://ainspecciona.com/api/postventa/agent/lookup-unit',
      method: 'POST',
      content_type: 'application/json',
      request_headers: headers,
      request_body_schema: {
        type: 'object',
        description: 'Dirección, comuna y número de departamento (sin pedir torre ni RUT)',
        required: ['address', 'comuna', 'unitNumber'],
        properties: {
          address: {
            type: 'string',
            description: 'Dirección del edificio: calle y número. Ej: Padre Mariano 87'
          },
          comuna: {
            type: 'string',
            description: 'Comuna chilena. Ej: Providencia, Las Condes'
          },
          unitNumber: {
            type: 'string',
            description: 'Número de departamento sin la palabra depto. Ej: 205'
          },
          ownerRut: {
            type: 'string',
            description: 'Opcional. NO pedir al propietario. Omitir salvo que lo diga sin que lo preguntes.'
          },
          tower: {
            type: 'string',
            description: 'Opcional. NO preguntar. Solo si el propietario mencionó torre al dar la dirección.'
          },
          tenantSlug: {
            type: 'string',
            description: 'Opcional. Hint del widget, ej. demo-inmobiliaria'
          }
        }
      }
    }
  };
}

async function main() {
  const current = await api('GET', `${TOOLS_API}/${LOOKUP_TOOL_ID}`);
  const cfg = lookupToolConfig(current?.tool_config?.api_schema);

  if (statusOnly) {
    const schema = current?.tool_config?.api_schema?.request_body_schema;
    console.log('[lookup-tool] Estado remoto');
    console.log(`  id:       ${LOOKUP_TOOL_ID}`);
    console.log(`  required: ${JSON.stringify(schema?.required || [])}`);
    console.log(`  props:    ${JSON.stringify(Object.keys(schema?.properties || {}))}`);
    return;
  }

  const updated = await api('PATCH', `${TOOLS_API}/${LOOKUP_TOOL_ID}`, {
    tool_config: cfg
  });

  const schema = updated?.tool_config?.api_schema?.request_body_schema;
  console.log('[lookup-tool] OK — schema actualizado');
  console.log(`  required: ${JSON.stringify(schema?.required || [])}`);
  console.log(`  props:    ${JSON.stringify(Object.keys(schema?.properties || {}))}`);
}

main().catch((err) => {
  console.error('[lookup-tool]', err?.message || err);
  process.exit(1);
});
