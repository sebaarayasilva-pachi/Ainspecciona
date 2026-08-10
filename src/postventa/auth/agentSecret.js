import crypto from 'node:crypto';

export function getPostventaAgentSecret() {
  return String(process.env.POSTVENTA_AGENT_SECRET || '').trim();
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * @param {import('fastify').FastifyRequest} req
 * @returns {{ ok: true } | { ok: false, status: 401, error: string, message: string }}
 */
export function checkPostventaAgentSecret(req) {
  const expected = getPostventaAgentSecret();
  if (!expected) {
    return {
      ok: false,
      status: 401,
      error: 'AGENT_SECRET_NOT_CONFIGURED',
      message: 'POSTVENTA_AGENT_SECRET no está configurado en el servidor.'
    };
  }

  const provided =
    String(req.headers['x-postventa-agent-secret'] || req.headers['postventa-agent-secret'] || '').trim();
  if (!provided || !timingSafeEqualStr(expected, provided)) {
    return {
      ok: false,
      status: 401,
      error: 'UNAUTHORIZED',
      message: 'Falta o es inválido x-postventa-agent-secret.'
    };
  }

  return { ok: true };
}
