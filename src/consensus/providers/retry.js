export async function withRetry(fn, { attempts = 2, delayMs = 800, label = 'provider' } = {}) {
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      lastError = err;
      if (i < attempts) {
        await new Promise((r) => setTimeout(r, delayMs * i));
      }
    }
  }
  const error = lastError || new Error(`${label} failed`);
  error.providerLabel = label;
  throw error;
}

export function parseJsonLoose(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
