/**
 * Aviso WhatsApp a ITO / dueños cuando un caso entra a review.
 * Números: REVIEW_WHATSAPP_PHONES (coma/espacio). Texto de sesión; si Meta
 * cierra la ventana 24h, intenta WHATSAPP_TEMPLATE_REVIEW_NAME (con link).
 */
import { sendWhatsAppTemplate, sendWhatsAppText } from '../whatsapp/send.js';

export function reviewWhatsAppRecipients() {
  const raw = String(process.env.REVIEW_WHATSAPP_PHONES || '').trim();
  const seen = new Set();
  const out = [];
  for (const part of raw.split(/[,;]+/)) {
    const digits = String(part || '').replace(/\D/g, '');
    if (digits.length < 8 || seen.has(digits)) continue;
    seen.add(digits);
    out.push(digits);
  }
  return out;
}

export function buildReviewWhatsAppText({ shortId, address, reviewUrl } = {}) {
  const id = String(shortId || '').trim() || 'caso';
  const addr = String(address || '').trim();
  const url = String(reviewUrl || '').trim();
  return [
    'Ainspecciona: hay revisión disponible.',
    `Caso ${id}`,
    addr || null,
    url || null
  ].filter(Boolean).join('\n');
}

export async function notifyReviewAvailableWhatsApp({
  shortId,
  address,
  reviewUrl,
  log
} = {}) {
  const phones = reviewWhatsAppRecipients();
  if (!phones.length) {
    log?.warn?.('review-whatsapp-skipped-no-phones');
    return { ok: false, skipped: true, reason: 'NO_PHONES', sent: 0 };
  }

  const text = buildReviewWhatsAppText({ shortId, address, reviewUrl });
  const reviewTemplate = String(process.env.WHATSAPP_TEMPLATE_REVIEW_NAME || '').trim();
  const results = [];

  for (const to of phones) {
    try {
      let r = await sendWhatsAppText({ to, text, previewUrl: true, log });
      const windowBlocked =
        !r?.ok &&
        (r?.data?.error?.code === 131047 ||
          r?.data?.error?.code === 470 ||
          String(r?.error || '').includes('131047') ||
          String(r?.data?.error?.message || '').toLowerCase().includes('24 hour'));

      if (windowBlocked && reviewTemplate) {
        r = await sendWhatsAppTemplate({
          to,
          templateName: reviewTemplate,
          languageCode: process.env.WHATSAPP_TEMPLATE_LANG || 'es',
          bodyParams: [String(shortId || ''), String(address || '—')],
          buttonUrlParams: [String(shortId || '')],
          log
        });
      }

      if (!r?.ok) {
        log?.warn?.({ toSuffix: to.slice(-4), err: r?.error }, 'review-whatsapp-failed');
      } else {
        log?.info?.({ toSuffix: to.slice(-4), shortId }, 'review-whatsapp-sent');
      }
      results.push({ ok: !!r?.ok, error: r?.ok ? null : r?.error });
    } catch (err) {
      log?.warn?.({ err: err?.message, toSuffix: to.slice(-4) }, 'review-whatsapp-error');
      results.push({ ok: false, error: err?.message });
    }
  }

  const sent = results.filter((x) => x.ok).length;
  return { ok: sent > 0, skipped: false, sent, total: phones.length, results };
}
