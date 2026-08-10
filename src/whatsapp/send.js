/**
 * Envío de mensajes vía WhatsApp Cloud API (compatible con 360dialog).
 * Config: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_API_BASE (opcional).
 */

function digits(to) {
  return String(to || '').replace(/\D/g, '');
}

function graphBase() {
  return (process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com/v21.0').replace(/\/$/, '');
}

async function postGraph(body, log) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    log?.warn('whatsapp-send-skipped-missing-env');
    return { ok: false, error: 'MISSING_WHATSAPP_CREDENTIALS' };
  }
  const url = `${graphBase()}/${phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      log?.warn({ status: res.status, data }, 'whatsapp-send-error');
      return { ok: false, error: data?.error?.message || `HTTP_${res.status}`, data };
    }
    const msgId = data?.messages?.[0]?.id || null;
    return { ok: true, messageId: msgId, raw: data };
  } catch (err) {
    log?.error(err, 'whatsapp-send-fetch');
    return { ok: false, error: err.message };
  }
}

/**
 * Plantilla HSM (solo fuera de ventana de 24h o como política explícita).
 * WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANG (default es).
 */
export async function sendWhatsAppTemplate({ to, templateName, languageCode, log }) {
  const name = templateName || process.env.WHATSAPP_TEMPLATE_NAME;
  if (!name) {
    log?.warn('whatsapp-template-missing-name');
    return { ok: false, error: 'MISSING_TEMPLATE_NAME' };
  }
  const lang = languageCode || process.env.WHATSAPP_TEMPLATE_LANG || 'es';
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: digits(to),
    type: 'template',
    template: {
      name,
      language: { code: lang }
    }
  };
  return postGraph(body, log);
}

/**
 * Intenta texto de sesión; si Meta indica fuera de ventana (131047), envía plantilla de reenganche.
 */
export async function trySendTextWithTemplateFallback({ to, text, log }) {
  const textRes = await sendWhatsAppText({ to, text, log });
  if (textRes.ok) return textRes;

  const code = textRes.data?.error?.code;
  const sub = textRes.data?.error?.error_subcode;
  const isWindow =
    code === 131047 ||
    code === 470 ||
    String(textRes.error || '').includes('131047') ||
    String(textRes.data?.error?.message || '').toLowerCase().includes('24 hour');

  if (!isWindow) return textRes;

  log?.info({ code, sub }, 'whatsapp-fallback-template');
  return sendWhatsAppTemplate({
    to,
    templateName: process.env.WHATSAPP_TEMPLATE_REENGAGEMENT_NAME || process.env.WHATSAPP_TEMPLATE_NAME,
    languageCode: process.env.WHATSAPP_TEMPLATE_LANG || 'es',
    log
  });
}

export async function sendWhatsAppText({ to, text, log }) {
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: digits(to),
    type: 'text',
    text: { preview_url: false, body: String(text).slice(0, 4096) }
  };
  return postGraph(body, log);
}
