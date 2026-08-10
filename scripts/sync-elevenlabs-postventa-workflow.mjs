/**
 * Construye y aplica el Workflow determinístico del agente Postventa en ElevenLabs.
 *
 * Por qué: los Procedures son "blandos" (el LLM decide el orden por disparadores),
 * y el agente se saltaba pasos (ej. confirmar la dirección). Un Workflow impone el
 * orden con nodos subagente (override_agent) + edges con condiciones, restringiendo
 * además las tools por nodo para que no se ejecuten fuera de su paso.
 *
 * Requiere en .env: ELEVENLABS_API_KEY, ELEVENLABS_POSTVENTA_AGENT_ID
 *
 * Uso:
 *   node scripts/sync-elevenlabs-postventa-workflow.mjs            # backup + PATCH
 *   node scripts/sync-elevenlabs-postventa-workflow.mjs --dry-run  # imprime el JSON, no envía
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry-run');

function sanitizeAgentId(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/(agent_[a-zA-Z0-9]+)/);
  return m ? m[1] : s.split('&')[0].split('?')[0].trim();
}
function parseBranchId(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/[?&]branch_id=([^&]+)/);
  if (m) return m[1];
  return String(process.env.ELEVENLABS_POSTVENTA_BRANCH_ID || '').trim() || null;
}

const apiKey = String(process.env.ELEVENLABS_API_KEY || '').trim();
const agentId = sanitizeAgentId(process.env.ELEVENLABS_POSTVENTA_AGENT_ID);
const branchId = parseBranchId(process.env.ELEVENLABS_POSTVENTA_AGENT_ID);
if (!apiKey || !agentId) {
  console.error('Falta ELEVENLABS_API_KEY o ELEVENLABS_POSTVENTA_AGENT_ID en .env');
  process.exit(1);
}

function url() {
  const u = new URL(`https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agentId)}`);
  if (branchId) u.searchParams.set('branch_id', branchId);
  return u.toString();
}
async function api(method, body) {
  const res = await fetch(url(), {
    method,
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await res.text();
  let data; try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw }; }
  return { ok: res.ok, status: res.status, data, raw };
}

// IDs reales de las tools del agente (ver scripts/tmp-tools-dump si cambian).
const T = {
  lookup: 'tool_3901kt7rednnf03tgrhw56ev9g77',     // lookup_owner_unit
  warranty: 'tool_8801ktc8edwferraqthxbpvtm2z1',   // validate_warranty
  ticket: 'tool_6801ktacg4asf9v91zchmtd0bkqy',     // create_postventa_ticket
  capture: 'tool_0601ktadm3ckfd6914yvz9mzj415',    // create_capture_session
  open: 'tool_4601ktc63cfbepfsqpshgy295v80',       // open_capture
  status: 'tool_8101ktadqgcce45rv26mjtq2zbvy'      // get_ticket_status
};

/** Nodo subagente: instrucciones del paso + tools restringidas a ese paso. */
function subagent(label, prompt, toolIds, pos, edgeOrder, entry = 'generate_immediately') {
  return {
    type: 'override_agent',
    label,
    additional_prompt: prompt,
    conversation_config: { agent: { prompt: { tool_ids: toolIds } } },
    entry_behavior: entry,
    position: pos,
    edge_order: edgeOrder
  };
}
function llm(condition) {
  return { type: 'llm', condition };
}
function edge(source, target, forward_condition) {
  return { source, target, forward_condition, backward_condition: null };
}

const P = {
  descubrir:
    "Paso 'Descubrir problema'. Objetivo: entender la falla con mínima fricción y asignar UNA categoría técnica. No llames ninguna tool aquí. " +
    "Si el relato ya permite inferir recinto + síntoma + categoría, clasifica y resume en una frase. Si es ambiguo, haz UNA sola pregunta de desambiguación y luego clasifica. Nunca encadenes 2 preguntas. " +
    "Traduce coloquialismos al término chileno (ej. 'palito'→guardapolvo/moldura/marco; 'fregadero'→lavaplatos). " +
    "Categorías válidas (minúscula, guion bajo): humedad_filtracion, pintura_muros_cielos, pisos, puertas_cerraduras, ventanas_sellos, sanitarios, electricidad_visible, muebles_closets_cocina, ductos_canalizaciones, impermeabilizacion, espacios_comunes, otros. " +
    "Ante duda, elige la más conservadora para evidencia. Si hay gas, olor a quemado, chispas, inundación o personas atrapadas: trátalo como URGENCIA con medidas de seguridad inmediatas. " +
    "Cierra resumiendo la falla en UNA frase y pasa a identificar la unidad.",
  identificar:
    "Paso 'Identificar unidad'. Tienes SOLO la tool lookup_owner_unit. Haz UNA sola pregunta: '¿me das comuna, calle y número, y número de departamento?'. Nunca pidas torre ni RUT. " +
    "Extrae comuna, address (calle y número juntos), unitNumber (y tower solo si lo dijo) y llama lookup_owner_unit (antes di una frase breve, ej. 'Un momento, consulto tu unidad.'). No envíes ownerRut. " +
    "CUANDO la tool responda, DEBES confirmar la dirección en voz en este orden: calle → número → departamento → comuna → ciudad, incluyendo proyecto, inmobiliaria y nombre del propietario. " +
    "Ejemplo: 'Encontré tu unidad: {calle}, {número}, departamento {depto}, comuna {comuna}, ciudad {ciudad}. Proyecto {projectName} de {tenantName}, a nombre de {ownerName}. ¿Es correcto?'. " +
    "Ciudad: si la comuna es de la Región Metropolitana di 'Santiago'. NO avances hasta que el propietario confirme EXPLÍCITAMENTE que es correcto. " +
    "Si algo está mal o falta un dato, pregunta SOLO ese dato y reintenta (máx 2 intentos). No vuelvas a pedir datos ya entregados.",
  garantia:
    "Paso 'Validar garantía'. Tienes SOLO la tool validate_warranty. Di una frase breve (ej. 'Reviso la garantía de tu unidad.') y llama validate_warranty con unitId (de lookup_owner_unit) y preliminaryCategory (la categoría asignada). " +
    "Comunica messageForOwner, status y warrantyExpiresAt en lenguaje simple, SIEMPRE con disclaimer: 'Es una prevalidación según las fechas registradas, no un dictamen legal; el equipo confirmará con las fotos.' " +
    "Si garantia_vencida o requiere_revision_manual: igual se registrará, NUNCA rechaces el reclamo. Nunca inventes fechas ni plazos.",
  registrar:
    "Paso 'Registrar solicitud'. Tienes SOLO la tool create_postventa_ticket. Di una frase breve (ej. 'Registro tu solicitud ahora.') y llama create_postventa_ticket con: " +
    "tenantSlug (el devuelto por lookup_owner_unit), summary (2-4 oraciones con dirección, comuna, depto, recinto, síntoma y urgencia si aplica; traduce coloquialismos), preliminaryCategory (el código exacto), roomHint (recinto en texto libre), " +
    "contactName ({{contact_name}}) y contactPhone ({{contact_phone}}) — contacto de visita ya capturado en la web, no lo pidas de nuevo. " +
    "Tras crear el ticket, anuncia el número de solicitud (ticketShortId). NUNCA digas que registraste sin haber ejecutado realmente la tool.",
  captura:
    "Paso 'Captura de fotos'. Tienes create_capture_session y open_capture. ORDEN ESTRICTO: " +
    "0) PROHIBIDO llamar estas tools en el mismo turno que el mensaje de prevalidación de garantía. " +
    "1) PRIMERO (solo voz) di la intro completa y termínala: 'Perfecto. Ahora vamos a necesitar que saques una foto del problema para dejar evidencia; te iré ayudando paso a paso.' " +
    "2) Luego llama create_capture_session (en silencio) con category (el mismo preliminaryCategory) y ticketId (el de create_postventa_ticket). " +
    "3) Di exactamente 'Voy a abrir la cámara.' y SOLO entonces llama open_capture con url = el captureUrl EXACTO. Nunca abras la cámara a mitad de la explicación ni mientras hablas de garantía. Nunca dictes la URL en voz. " +
    "Guía foto a foto: recibirás mensajes internos [CAPTURA INICIO], [CAPTURA PASO N], [CAPTURA SUBIDA] y [CAPTURA FIN] (no leas las etiquetas ni los corchetes). " +
    "Al recibir un paso, di QUÉ foto y DÓNDE y pide 'tómala y envíala'; luego ESPERA EN SILENCIO. SOLO cuando llegue [CAPTURA SUBIDA] confirma 'Listo, la recibimos' y recién entonces pide la SIGUIENTE foto. Un paso por turno. " +
    "Al recibir [CAPTURA FIN], felicita brevemente e indica que en pantalla pedirá el correo para enviar la copia.",
  estado:
    "Paso 'Consultar estado'. Tienes SOLO la tool get_ticket_status. Si no tienes el número de solicitud, pídelo ('¿Tienes el número de solicitud?'). " +
    "Di una frase breve ('Reviso el estado de tu solicitud.') y llama get_ticket_status con el ticketId / ticketShortId. " +
    "Comunica statusLabel y nextStepForOwner en lenguaje simple. Si faltan fotos, recuérdale que puede usar el link de captura para completarlas."
};

const nodes = {
  start_node: { type: 'start', position: { x: 0, y: -360 }, edge_order: ['e_start_estado', 'e_start_descubrir'] },
  n_descubrir: subagent('Descubrir problema', P.descubrir, [], { x: 0, y: -240 }, ['e_desc_ident']),
  n_identificar: subagent('Identificar unidad', P.identificar, [T.lookup], { x: 0, y: -120 }, ['e_ident_gar']),
  n_garantia: subagent('Validar garantía', P.garantia, [T.warranty], { x: 0, y: 0 }, ['e_gar_reg']),
  n_registrar: subagent('Registrar solicitud', P.registrar, [T.ticket], { x: 0, y: 120 }, ['e_reg_cap']),
  n_captura: subagent('Captura de fotos', P.captura, [T.capture, T.open], { x: 0, y: 240 }, ['e_cap_end']),
  n_estado: subagent('Consultar estado', P.estado, [T.status], { x: 320, y: -120 }, ['e_estado_end']),
  end_node: { type: 'end', position: { x: 0, y: 360 }, edge_order: [] }
};

const edges = {
  e_start_estado: edge('start_node', 'n_estado', llm('El propietario pregunta por el estado o avance de una solicitud YA existente (menciona un número de solicitud o pregunta cómo va su caso), en vez de reportar un problema nuevo.')),
  e_start_descubrir: edge('start_node', 'n_descubrir', { type: 'unconditional' }),
  e_desc_ident: edge('n_descubrir', 'n_identificar', llm('Ya quedó asignada UNA categoría técnica clara para el problema reportado y se resumió la falla en una frase.')),
  e_ident_gar: edge('n_identificar', 'n_garantia', llm('El propietario confirmó verbalmente (dijo que sí / que es correcto) que la dirección y la unidad mostradas son correctas.')),
  e_gar_reg: edge('n_garantia', 'n_registrar', llm('Ya se le comunicó al propietario el resultado de la prevalidación de garantía, con su disclaimer.')),
  e_reg_cap: edge('n_registrar', 'n_captura', llm('El ticket fue creado correctamente y se le comunicó el número de solicitud (ticketShortId) al propietario.')),
  e_cap_end: edge('n_captura', 'end_node', llm('Se completó la captura de fotos (llegó la señal interna [CAPTURA FIN]) o el propietario indicó que ya no enviará más fotos.')),
  e_estado_end: edge('n_estado', 'end_node', llm('Ya se informó el estado de la solicitud y el propietario no tiene más preguntas.'))
};

const workflow = { nodes, edges, prevent_subagent_loops: false };

if (dryRun) {
  console.log(JSON.stringify({ workflow }, null, 2));
  process.exit(0);
}

// 1) Backup completo del agente.
const before = await api('GET');
if (!before.ok) { console.error('GET fallo', before.status, before.raw.slice(0, 300)); process.exit(1); }
const backupPath = path.join(__dirname, '..', 'agent-backup-before-workflow.json');
fs.writeFileSync(backupPath, JSON.stringify(before.data, null, 2));
console.log('Backup del agente ->', path.relative(path.join(__dirname, '..'), backupPath));

// 2) PATCH del workflow (top-level, como aceptó la API antes).
const patched = await api('PATCH', { workflow });
console.log('PATCH workflow ->', patched.status, patched.ok ? 'OK' : patched.raw.slice(0, 600));
if (!patched.ok) process.exit(1);

// 3) Verificar.
const after = await api('GET');
const wf = after.data?.workflow;
const nodeList = wf?.nodes ? Object.entries(wf.nodes) : [];
console.log('\nWorkflow aplicado: nodos =', nodeList.length, ', edges =', Object.keys(wf?.edges || {}).length);
for (const [id, n] of nodeList) {
  const tids = n?.conversation_config?.agent?.prompt?.tool_ids;
  console.log(`  ${id}  type=${n.type}  label=${n.label || ''}  tools=${tids ? JSON.stringify(tids) : '-'}`);
}
console.log('\nLISTO');
