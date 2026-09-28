/**
 * Avisos ITO (WhatsApp + SMS) cuando un caso entra a review.
 * Cada canal se salta solo si le faltan destinos o credenciales.
 */
import { notifyReviewAvailableWhatsApp } from './notifyReviewWhatsApp.js';
import { notifyReviewAvailableSms } from './notifyReviewSms.js';

export function notifyReviewAvailable({ shortId, address, reviewUrl, log } = {}) {
  const payload = { shortId, address, reviewUrl, log };
  notifyReviewAvailableWhatsApp(payload).catch((err) => {
    log?.warn?.({ err: err?.message, shortId }, 'review-whatsapp-unhandled');
  });
  notifyReviewAvailableSms(payload).catch((err) => {
    log?.warn?.({ err: err?.message, shortId }, 'review-sms-unhandled');
  });
}
