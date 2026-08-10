import crypto from 'node:crypto';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function sessionCookieOpts(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.headers['x-forwarded-ssl'] || '')
    .toString()
    .split(',')[0]
    .trim()
    .toLowerCase();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim().toLowerCase();
  const isLocalhost = !host || host === 'localhost' || host.startsWith('127.0.0.1') || host.includes(':3000');
  const isSecure = !isLocalhost && (proto === 'https' || process.env.NODE_ENV === 'production');
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    maxAge: 60 * 60 * 24 * 7
  };
}
