/**
 * Avisos In & Out (mail). No bloquea el flujo si SMTP falla.
 */
import { sendInOutCaptureLinkEmail, sendInOutReportReadyEmail } from '../../email.js';
import { generateInOutReportPdf } from '../../pdf/inoutReportPdf.js';

export function inoutPublicBase() {
  return String(process.env.PUBLIC_URL || process.env.BASE_URL || 'https://ainspecciona.com')
    .trim()
    .replace(/\/$/, '') || 'https://ainspecciona.com';
}

function uniqueEmails(...vals) {
  const seen = new Set();
  const out = [];
  for (const raw of vals) {
    const email = String(raw || '').trim().toLowerCase();
    if (!email || !email.includes('@') || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export async function notifyInOutCaptureLink({ lease, phase, captureToken, log } = {}) {
  const token = String(captureToken || '').trim();
  if (!token) return { ok: false, skipped: true, reason: 'NO_TOKEN' };
  const emails = uniqueEmails(lease?.tenantEmail);
  if (!emails.length) return { ok: false, skipped: true, reason: 'NO_EMAIL' };
  const captureUrl = `${inoutPublicBase()}/inout/capture/${encodeURIComponent(token)}`;
  const address = lease?.property?.address || lease?.address || '';
  const name = lease?.tenantName || '';
  const results = [];
  for (const to of emails) {
    const r = await sendInOutCaptureLinkEmail(to, { name, address, phase, captureUrl });
    if (!r.ok && !r.skipped) log?.warn?.({ toSuffix: to.slice(-4), err: r.error }, 'inout-capture-email-failed');
    else if (r.ok) log?.info?.({ toSuffix: to.slice(-4), phase }, 'inout-capture-email-sent');
    results.push(r);
  }
  return { ok: results.some((x) => x.ok), results };
}

export async function notifyInOutReportReady({ lease, summary, items, disclaimer, log } = {}) {
  const emails = uniqueEmails(lease?.tenantEmail, lease?.ownerEmail);
  if (!emails.length) return { ok: false, skipped: true, reason: 'NO_EMAIL' };
  const address = lease?.property?.address || '';
  const reportUrl = `${inoutPublicBase()}/inout/portal/report?id=${encodeURIComponent(lease.id)}`;
  let pdfBuffer = null;
  try {
    pdfBuffer = await generateInOutReportPdf({
      address,
      tenantName: lease.tenantName,
      ownerName: lease.ownerName,
      generatedAt: new Date(),
      summary,
      disclaimer,
      items
    });
  } catch (err) {
    log?.warn?.({ err: err?.message }, 'inout-report-pdf-failed');
  }
  const results = [];
  for (const to of emails) {
    const name = to === String(lease.ownerEmail || '').trim().toLowerCase() ? lease.ownerName : lease.tenantName;
    const r = await sendInOutReportReadyEmail(to, {
      name,
      address,
      reportUrl,
      conclusion: summary?.conclusion || '',
      pdfBuffer
    });
    if (!r.ok && !r.skipped) log?.warn?.({ toSuffix: to.slice(-4), err: r.error }, 'inout-report-email-failed');
    else if (r.ok) log?.info?.({ toSuffix: to.slice(-4) }, 'inout-report-email-sent');
    results.push(r);
  }
  return { ok: results.some((x) => x.ok), results };
}
