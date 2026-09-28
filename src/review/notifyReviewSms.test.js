import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sendLabsMobileSms } from '../sms/sendLabsMobile.js';
import {
  buildReviewSmsText,
  parseReviewPhones,
  reviewSmsRecipients,
  notifyReviewAvailableSms
} from './notifyReviewSms.js';

describe('aviso SMS review', () => {
  it('arma texto compacto con caso, direccion y link', () => {
    const text = buildReviewSmsText({
      shortId: '3TMGV6XY',
      address: 'Depto Jorge VI',
      reviewUrl: 'https://ainspecciona.com/review?case=3TMGV6XY'
    });
    assert.match(text, /3TMGV6XY/);
    assert.match(text, /Depto Jorge VI/);
    assert.match(text, /https:\/\/ainspecciona.com\/review\?case=3TMGV6XY/);
    assert.doesNotMatch(text, /[áéíóúñ]/i);
  });

  it('normaliza celulares Chile y evita duplicados', () => {
    assert.deepEqual(parseReviewPhones('+56 9 7667 5851; 976675851, 56911111111'), [
      '56976675851',
      '56911111111'
    ]);
  });

  it('REVIEW_SMS_PHONES pisa REVIEW_WHATSAPP_PHONES', () => {
    const prevSms = process.env.REVIEW_SMS_PHONES;
    const prevWa = process.env.REVIEW_WHATSAPP_PHONES;
    process.env.REVIEW_SMS_PHONES = '56911111111';
    process.env.REVIEW_WHATSAPP_PHONES = '56922222222';
    try {
      assert.deepEqual(reviewSmsRecipients(), ['56911111111']);
    } finally {
      if (prevSms == null) delete process.env.REVIEW_SMS_PHONES;
      else process.env.REVIEW_SMS_PHONES = prevSms;
      if (prevWa == null) delete process.env.REVIEW_WHATSAPP_PHONES;
      else process.env.REVIEW_WHATSAPP_PHONES = prevWa;
    }
  });

  it('cae a REVIEW_WHATSAPP_PHONES si no hay lista SMS', () => {
    const prevSms = process.env.REVIEW_SMS_PHONES;
    const prevWa = process.env.REVIEW_WHATSAPP_PHONES;
    delete process.env.REVIEW_SMS_PHONES;
    process.env.REVIEW_WHATSAPP_PHONES = '56993303296';
    try {
      assert.deepEqual(reviewSmsRecipients(), ['56993303296']);
    } finally {
      if (prevSms == null) delete process.env.REVIEW_SMS_PHONES;
      else process.env.REVIEW_SMS_PHONES = prevSms;
      if (prevWa == null) delete process.env.REVIEW_WHATSAPP_PHONES;
      else process.env.REVIEW_WHATSAPP_PHONES = prevWa;
    }
  });

  it('no envia si faltan credenciales LabsMobile', async () => {
    const prevUser = process.env.LABSMOBILE_USERNAME;
    const prevToken = process.env.LABSMOBILE_TOKEN;
    const prevSms = process.env.REVIEW_SMS_PHONES;
    delete process.env.LABSMOBILE_USERNAME;
    delete process.env.LABSMOBILE_TOKEN;
    process.env.REVIEW_SMS_PHONES = '56911111111';
    try {
      const r = await notifyReviewAvailableSms({
        shortId: 'ABC',
        reviewUrl: 'https://ainspecciona.com/review?case=ABC'
      });
      assert.equal(r.skipped, true);
      assert.equal(r.reason, 'NO_CREDENTIALS');
    } finally {
      if (prevUser == null) delete process.env.LABSMOBILE_USERNAME;
      else process.env.LABSMOBILE_USERNAME = prevUser;
      if (prevToken == null) delete process.env.LABSMOBILE_TOKEN;
      else process.env.LABSMOBILE_TOKEN = prevToken;
      if (prevSms == null) delete process.env.REVIEW_SMS_PHONES;
      else process.env.REVIEW_SMS_PHONES = prevSms;
    }
  });

  it('arma POST LabsMobile con Basic auth y long SMS', async () => {
    const prevUser = process.env.LABSMOBILE_USERNAME;
    const prevToken = process.env.LABSMOBILE_TOKEN;
    const prevSender = process.env.LABSMOBILE_SENDER;
    const prevTest = process.env.LABSMOBILE_TEST;
    process.env.LABSMOBILE_USERNAME = 'demo@ainspecciona.com';
    process.env.LABSMOBILE_TOKEN = 'tok-demo';
    process.env.LABSMOBILE_SENDER = 'Ainspecta';
    delete process.env.LABSMOBILE_TEST;
    let captured;
    const fetchImpl = async (url, opts) => {
      captured = { url, opts };
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: '0', message: 'Message has been successfully sent.', subid: 'abc' })
      };
    };
    try {
      const r = await sendLabsMobileSms({
        to: '+56 9 1111 1111',
        message: 'Hola ITO',
        fetchImpl
      });
      assert.equal(r.ok, true);
      assert.equal(captured.url, 'https://api.labsmobile.com/json/send');
      assert.match(captured.opts.headers.Authorization, /^Basic /);
      const body = JSON.parse(captured.opts.body);
      assert.equal(body.recipient[0].msisdn, '56911111111');
      assert.equal(body.tpoa, 'Ainspecta');
      assert.equal(body.long, '1');
      assert.equal(body.test, undefined);
    } finally {
      if (prevUser == null) delete process.env.LABSMOBILE_USERNAME;
      else process.env.LABSMOBILE_USERNAME = prevUser;
      if (prevToken == null) delete process.env.LABSMOBILE_TOKEN;
      else process.env.LABSMOBILE_TOKEN = prevToken;
      if (prevSender == null) delete process.env.LABSMOBILE_SENDER;
      else process.env.LABSMOBILE_SENDER = prevSender;
      if (prevTest == null) delete process.env.LABSMOBILE_TEST;
      else process.env.LABSMOBILE_TEST = prevTest;
    }
  });
});
