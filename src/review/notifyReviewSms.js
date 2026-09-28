/**
 * Aviso SMS a ITO / dueños cuando un caso entra a review.
 * Destinos: REVIEW_SMS_PHONES, o REVIEW_WHATSAPP_PHONES si no hay lista SMS.
 * Proveedor: LabsMobile (LABSMOBILE_USERNAME + LABSMOBILE_TOKEN).
 */
import { labsMobileConfigured, sendLabsMobileSms } from '../sms/sendLabsMobile.js';

export function parseReviewPhones(raw) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw || '').split(/[,;]+/)) {
    let digits = String(part || '').replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.length === 9 && digits.startsWith('9')) digits = `56${digits}`;
    if (digits.length < 8 || seen.has(digits)) continue;
    seen.add(digits);
    out.push(digits);
  }
  return out;
}

export function reviewSmsRecipients() {
  const sms = String(process.env.REVIEW_SMS_PHONES || '').trim();
  const wa = String(process.env.REVIEW_WHATSAPP_PHONES || '').trim();
  return parseReviewPhones(sms || wa);
}

export function buildReviewSmsText({ shortId, address, reviewUrl } = {}) {
  const id = String(shortId || '').trim() || 'caso';
  const addr = String(address || '').trim();
  const url = String(reviewUrl || '').trim();
  return [
    'Ainspecciona: hay revision ITO.',
    `Caso ${id}`,
    addr || null,
    url || null
  ]
    .filter(Boolean)
    .join('\n');
}

export async function notifyReviewAvailableSms({
  shortId,
  address,
  reviewUrl,
  log
} = {}) {
  const phones = reviewSmsRecipients();
  if (!phones.length) {
    log?.warn?.('review-sms-skipped-no-phones');
    return { ok: false, skipped: true, reason: 'NO_PHONES', sent: 0 };
  }
  if (!labsMobileConfigured()) {
    log?.warn?.('review-sms-skipped-no-credentials');
    return { ok: false, skipped: true, reason: 'NO_CREDENTIALS', sent: 0 };
  }

  const text = buildReviewSmsText({ shortId, address, reviewUrl });
  const results = [];

  for (const to of phones) {
    try {
      const r = await sendLabsMobileSms({ to, message: text, log });
      if (!r?.ok) {
        log?.warn?.({ toSuffix: to.slice(-4), err: r?.error }, 'review-sms-failed');
      } else {
        log?.info?.({ toSuffix: to.slice(-4), shortId, test: !!r.test }, 'review-sms-sent');
      }
      results.push({ ok: !!r?.ok, error: r?.ok ? null : r?.error });
    } catch (err) {
      log?.warn?.({ err: err?.message, toSuffix: to.slice(-4) }, 'review-sms-error');
      results.push({ ok: false, error: err.message });
    }
  }

  const sent = results.filter((x) => x.ok).length;
  return { ok: sent > 0, skipped: false, sent, total: phones.length, results };
}
