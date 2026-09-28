/**
 * Envío SMS vía LabsMobile HTTP/POST JSON.
 * https://api.labsmobile.com/json/send
 * Auth: Basic (LABSMOBILE_USERNAME + LABSMOBILE_TOKEN).
 */

const SEND_URL = 'https://api.labsmobile.com/json/send';

export function labsMobileConfigured() {
  const user = String(process.env.LABSMOBILE_USERNAME || '').trim();
  const token = String(process.env.LABSMOBILE_TOKEN || '').trim();
  return Boolean(user && token);
}

function hasNonGsm(text) {
  return /[^\x20-\x7E\n\r]/.test(String(text || ''));
}

export async function sendLabsMobileSms({
  to,
  message,
  log,
  fetchImpl
} = {}) {
  const username = String(process.env.LABSMOBILE_USERNAME || '').trim();
  const token = String(process.env.LABSMOBILE_TOKEN || '').trim();
  if (!username || !token) {
    log?.warn?.('sms-send-skipped-missing-env');
    return { ok: false, error: 'MISSING_LABSMOBILE_CREDENTIALS' };
  }

  const msisdn = String(to || '').replace(/\D/g, '');
  const text = String(message || '').trim();
  if (msisdn.length < 8 || !text) {
    return { ok: false, error: 'INVALID_SMS_PAYLOAD' };
  }

  const sender = String(process.env.LABSMOBILE_SENDER || 'Ainspecta')
    .trim()
    .slice(0, 11);
  const testMode = /^(1|true|yes)$/i.test(String(process.env.LABSMOBILE_TEST || '').trim());
  const body = {
    message: text,
    recipient: [{ msisdn }],
    long: '1'
  };
  if (sender) body.tpoa = sender;
  if (testMode) body.test = '1';
  if (hasNonGsm(text)) body.ucs2 = '1';

  const auth = Buffer.from(`${username}:${token}`, 'utf8').toString('base64');
  const doFetch = fetchImpl || fetch;

  try {
    const res = await doFetch(SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    const code = String(data?.code ?? '');
    const ok = res.ok && (code === '0' || code === '00');
    if (!ok) {
      log?.warn?.(
        { status: res.status, code: data?.code, msg: data?.message },
        'sms-send-error'
      );
      return {
        ok: false,
        error: data?.message || `HTTP_${res.status}`,
        data
      };
    }
    return { ok: true, subid: data?.subid || null, raw: data, test: testMode };
  } catch (err) {
    log?.error?.(err, 'sms-send-fetch');
    return { ok: false, error: err.message };
  }
}
