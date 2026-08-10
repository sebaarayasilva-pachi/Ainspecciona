import crypto from 'node:crypto';

/**
 * Verifica X-Hub-Signature-256 (Meta / Cloud API). Mismo esquema que suele documentar 360dialog.
 */
export function verifyMetaSignature(rawBodyBuffer, signatureHeader, appSecret) {
  if (!appSecret || !signatureHeader) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBodyBuffer).digest('hex');
  const sig = String(signatureHeader).trim();
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Extrae mensajes de texto entrantes del payload Cloud API.
 */
export function extractInboundTextMessages(payload) {
  const out = [];
  const entries = payload?.entry || [];
  for (const ent of entries) {
    const changes = ent?.changes || [];
    for (const ch of changes) {
      const value = ch?.value;
      const messages = value?.messages || [];
      for (const m of messages) {
        if (m?.type !== 'text' || !m?.text?.body) continue;
        out.push({
          messageId: String(m.id || ''),
          from: String(m.from || ''),
          text: String(m.text.body || ''),
          timestamp: m.timestamp ? Number(m.timestamp) : null
        });
      }
    }
  }
  return out;
}
