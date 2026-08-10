export function normalizeRut(value) {
  return String(value || '')
    .replace(/[^0-9kK]/g, '')
    .toUpperCase();
}

export function normalizeTower(value) {
  return String(value || '')
    .trim()
    .replace(/^torre\s+/i, '')
    .replace(/^edificio\s+/i, '')
    .toUpperCase();
}

export function normalizeUnitNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  // "depto 402", "departamento 402", "n° 402"
  const stripped = raw
    .replace(/^(depto|departamento|unidad|n[°º]?|#)\s*/i, '')
    .trim();

  const digitMatch = stripped.match(/\d+/);
  if (digitMatch) return digitMatch[0];

  return stripped.replace(/\s+/g, '');
}

export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('56') && digits.length >= 11) return digits;
  if (digits.length === 9 && digits.startsWith('9')) return `56${digits}`;
  return digits;
}

export function publicBaseUrl() {
  return String(process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/** URL del front (Firebase) para links de postventa / captura en el navegador del propietario. */
export function publicWebAppUrl() {
  return String(
    process.env.WEB_APP_ORIGIN || process.env.PUBLIC_URL || 'https://ainspecciona.com'
  ).replace(/\/$/, '');
}

export function formatUnitLabel(tower, unitNumber) {
  const t = normalizeTower(tower);
  const parts = [];
  if (t) parts.push(`Torre ${t}`);
  if (unitNumber) parts.push(`Depto ${unitNumber}`);
  return parts.join(' · ') || `Unidad ${unitNumber || '?'}`;
}

export function normalizeComuna(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');
}

export function normalizeAddress(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s*(av\.?|avda\.?|avenida)\s*/gi, ' avenida ')
    .replace(/\s*(calle|cl\.?)\s*/gi, ' calle ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string | null | undefined} stored
 * @param {string | null | undefined} provided
 */
export function addressMatches(stored, provided) {
  const a = normalizeAddress(stored);
  const b = normalizeAddress(provided);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const tokens = b.split(' ').filter((t) => t.length > 1);
  if (!tokens.length) return false;
  const hits = tokens.filter((t) => a.includes(t));
  return hits.length >= Math.min(2, tokens.length);
}

/**
 * @param {string | null | undefined} stored
 * @param {string | null | undefined} provided
 */
export function comunaMatches(stored, provided) {
  const a = normalizeComuna(stored);
  const b = normalizeComuna(provided);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}
