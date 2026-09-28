import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewWhatsAppText, reviewWhatsAppRecipients } from './notifyReviewWhatsApp.js';

describe('aviso WhatsApp review', () => {
  it('arma texto con caso, dirección y link', () => {
    const text = buildReviewWhatsAppText({
      shortId: '3TMGV6XY',
      address: 'Depto Jorge VI',
      reviewUrl: 'https://ainspecciona.com/review?case=3TMGV6XY'
    });
    assert.match(text, /3TMGV6XY/);
    assert.match(text, /Depto Jorge VI/);
    assert.match(text, /https:\/\/ainspecciona.com\/review\?case=3TMGV6XY/);
  });

  it('parsea REVIEW_WHATSAPP_PHONES', () => {
    const prev = process.env.REVIEW_WHATSAPP_PHONES;
    process.env.REVIEW_WHATSAPP_PHONES = '+56 9 7667 5851, 56911111111';
    try {
      assert.deepEqual(reviewWhatsAppRecipients(), ['56976675851', '56911111111']);
    } finally {
      if (prev == null) delete process.env.REVIEW_WHATSAPP_PHONES;
      else process.env.REVIEW_WHATSAPP_PHONES = prev;
    }
  });
});
