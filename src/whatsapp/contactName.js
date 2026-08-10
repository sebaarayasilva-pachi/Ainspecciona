/**
 * Extrae nombre del contacto desde el mensaje del usuario cuando aplica.
 * @param {string} text
 * @param {{ role: string; content: string }[]} priorTurns
 * @returns {string | null}
 */
export function extractContactNameFromMessage(text, priorTurns) {
  const t = String(text || '').trim();
  if (t.length < 2 || t.length > 80) return null;

  const m1 = t.match(
    /(?:^|[\s,.])(?:me llamo|mi nombre es|soy)\s+([A-Za-záéíóúÁÉÍÓÚÑñ]+(?:\s+[A-Za-záéíóúÁÉÍÓÚÑñ]+){0,3})/i
  );
  if (m1) return normalizeName(m1[1]);

  const assistants = priorTurns.filter((x) => x.role === 'assistant').slice(-4);
  const askedName = assistants.some((a) =>
    /cómo te llamo|me dices tu nombre|cómo te llamamos|tu nombre\s*\?/i.test(String(a.content || ''))
  );
  if (!askedName) return null;

  const stripped = t.replace(/^[!¡¿?\s]+|[!?.…,\s]+$/g, '').trim();
  const lower = stripped.toLowerCase();
  const notNames = new Set([
    'ya',
    'ok',
    'no',
    'si',
    'sí',
    'bueno',
    'vale',
    'dale',
    'claro',
    'listo',
    'perfecto',
    'gracias',
    'hola'
  ]);
  if (!stripped || notNames.has(lower)) return null;
  if (stripped.length === 2 && lower.length === 2) return null;

  if (
    /^[a-záéíóúñA-ZÁÉÍÓÚÑ]{2,24}(\s+[a-záéíóúñA-ZÁÉÍÓÚÑ]{2,24}){0,2}$/.test(stripped) &&
    stripped.length <= 42
  ) {
    return normalizeName(stripped);
  }
  return null;
}

function normalizeName(s) {
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Si el modelo ofreció asesoría / agendar, marcar para no repetir en siguientes turnos.
 */
export function messageSuggestsAdvisoryOffer(text) {
  const s = String(text || '');
  if (/\b(asesor[ií]a\s+gratuita|30\s*min(?:utos)?)/i.test(s)) return true;
  if (/\bagendar(?:\s+una)?\s+(?:reuni[oó]n|asesor[ií]a|llamada)/i.test(s)) return true;
  if (/enlace/i.test(s) && /\b(asesor|agendar|30)/i.test(s)) return true;
  if (/¿[^\n]{0,80}(?:env[ií](?:e|a)r|mandar)[^\n]{0,80}(?:asesor|agendar|30)/i.test(s)) return true;
  return false;
}

/** Patrón razonable para correo en texto libre (un match por mensaje). */
const EMAIL_IN_TEXT =
  /[a-zA-Z0-9](?:[a-zA-Z0-9._%+-]*[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}/;

/**
 * Extrae un correo del mensaje (lead / seguimiento). Devuelve null si no hay uno claro.
 * @param {string} text
 * @returns {string | null}
 */
export function extractContactEmailFromMessage(text) {
  const t = String(text || '').trim();
  if (t.length < 6 || t.length > 500) return null;
  const m = t.match(EMAIL_IN_TEXT);
  if (!m) return null;
  let e = m[0].replace(/[.,;:)]+$/, '');
  if (e.length < 6 || e.length > 254) return null;
  return e;
}
