/** Rate limit simple en memoria para POST /api/whatsapp/webhook (por IP). */

const WINDOW_MS = 60_000;
const MAX_REQ = 200;
const buckets = new Map();

export function webhookRateLimitOk(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > MAX_REQ) return false;
  return true;
}
