import crypto from 'node:crypto';

export function generateTicketShortId() {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[bytes[i] % 36];
  return `PV-${s}`;
}

export function generateCaptureToken() {
  return `cs_${crypto.randomBytes(16).toString('hex')}`;
}
