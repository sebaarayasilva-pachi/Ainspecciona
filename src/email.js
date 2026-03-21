/**
 * Envío de emails vía SMTP (Nodemailer).
 * Configuración: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 * Si no está configurado, no envía (solo log).
 */
import nodemailer from 'nodemailer';

let _transporter = null;

function getTransporter() {
  if (_transporter !== null) return _transporter;
  const host = process.env.SMTP_HOST;
  const port = Number(String(process.env.SMTP_PORT || '587').replace(/\D/g, '') || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn('[email] SMTP incompleto. Necesitas: SMTP_HOST, SMTP_USER, SMTP_PASS.', { hasHost: !!host, hasUser: !!user, hasPass: !!pass });
    _transporter = false;
    return _transporter;
  }
  const secure = port === 465;
  _transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' },
    ...(port === 587 && !secure && { requireTLS: true }),
    debug: process.env.NODE_ENV !== 'production',
  });
  return _transporter;
}

function getFromEmail() {
  return process.env.EMAIL_FROM || 'Ainspecciona <contacto@ainspecciona.com>';
}

/**
 * Envía el enlace de inspección al email del contacto.
 */
export async function sendInspectionLinkEmail(to, captureUrl, contactName = '') {
  if (!to || !captureUrl) return { ok: false, error: 'Missing to or captureUrl' };
  const name = contactName || to.split('@')[0] || 'Cliente';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px;line-height:1.6}a{color:#7c3aed;font-weight:600;text-decoration:none}.btn{display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff!important;border-radius:12px;margin:16px 0}.card{max-width:480px;margin:0 auto;background:#1e293b;border-radius:16px;padding:32px;border:1px solid #334155}</style></head>
<body>
<div class="card">
  <h1 style="margin:0 0 16px;font-size:22px">Hola ${escapeHtml(name)},</h1>
  <p style="margin:0 0 16px">Tu inspección está lista. Haz clic en el enlace para completarla desde tu celular:</p>
  <p style="margin:16px 0"><a href="${escapeHtml(captureUrl)}" class="btn">Abrir inspección</a></p>
  <p style="margin:16px 0;font-size:14px;color:#94a3b8">O copia este enlace: ${escapeHtml(captureUrl)}</p>
  <p style="margin:24px 0 0;font-size:13px;color:#64748b">El enlace expira en 7 días. Si tienes dudas, responde a este correo.</p>
  <p style="margin:16px 0 0;font-size:13px;color:#64748b">— Ainspecciona</p>
</div>
</body>
</html>`;

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado (SMTP_HOST, SMTP_USER, SMTP_PASS). Email no enviado a', to);
    return { ok: false, skipped: true };
  }

  try {
    const info = await transporter.sendMail({
      from: getFromEmail(),
      to: to.trim().toLowerCase(),
      subject: 'Tu enlace de inspección · Ainspecciona',
      html,
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[email] Error enviando:', err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Envía magic link para acceso inicial al dashboard Business.
 * Tras hacer clic, el usuario crea su contraseña para futuros accesos.
 * Si facturacion existe, se adjunta comprobante PDF.
 */
/**
 * Invitación ejecutivo — etapa 1: solo activar cuenta y crear clave (/activate).
 */
export async function sendExecutiveInvitationEmail(to, fullName, tenantName, activationUrlAbsolute) {
  if (!to || !activationUrlAbsolute) return { ok: false, error: 'Missing to or activationUrl' };
  const name = String(fullName || '').trim() || to.split('@')[0] || 'Hola';
  const company = String(tenantName || '').trim() || 'tu corredora';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px;line-height:1.6}a{color:#7c3aed;font-weight:600;text-decoration:none}.btn{display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff!important;border-radius:12px;margin:16px 0}.card{max-width:480px;margin:0 auto;background:#1e293b;border-radius:16px;padding:32px;border:1px solid #334155}</style></head>
<body>
<div class="card">
  <h1 style="margin:0 0 16px;font-size:22px">Hola ${escapeHtml(name)},</h1>
  <p style="margin:0 0 16px">${escapeHtml(company)} te ha dado de alta en <strong>Ainspecciona</strong> como ejecutivo.</p>
  <p style="margin:0 0 16px">Para <strong>activar tu cuenta y crear tu clave</strong>, abre este enlace (no lo compartas):</p>
  <p style="margin:16px 0"><a href="${escapeHtml(activationUrlAbsolute)}" class="btn">Activar cuenta y crear clave</a></p>
  <p style="margin:16px 0;font-size:14px;color:#94a3b8">Enlace directo (copiar y pegar):<br/><a href="${escapeHtml(activationUrlAbsolute)}" style="color:#a78bfa;word-break:break-all">${escapeHtml(activationUrlAbsolute)}</a></p>
  <p style="margin:24px 0 0;font-size:13px;color:#64748b">El enlace expira en 30 días. Cuando termines, te enviaremos otro correo con los pasos para instalar <strong>Ainspecciona Capture</strong> en tu celular.</p>
  <p style="margin:16px 0 0;font-size:13px;color:#64748b">— Ainspecciona</p>
</div>
</body>
</html>`;

  const textPlain =
    `${company} te dio de alta en Ainspecciona como ejecutivo.\n\n` +
    `Activa tu cuenta y crea tu clave (enlace, válido 30 días):\n${activationUrlAbsolute}\n\n` +
    'Al terminar recibirás otro correo con el enlace para instalar Ainspecciona Capture.\n\n' +
    '— Ainspecciona';

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado. Invitación ejecutivo no enviada a', to);
    return { ok: false, skipped: true };
  }

  try {
    const info = await transporter.sendMail({
      from: getFromEmail(),
      to: to.trim().toLowerCase(),
      subject: 'Activa tu cuenta de ejecutivo · Ainspecciona',
      text: textPlain,
      html,
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[email] Error enviando invitación ejecutivo:', err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Etapa 2 (tras crear clave en /activate): enlace a Ainspecciona Capture en Play.
 * Si hay ficha pública (playStoreUrl), se usa en el mail. Si no, cae a prueba interna (playInternalTestUrl).
 */
export async function sendExecutiveCaptureInviteEmail(to, fullName, playInternalTestUrl, playStoreUrl = '') {
  const internal = String(playInternalTestUrl || '').trim();
  const store = String(playStoreUrl || '').trim();
  const linkUrl = store || internal;
  if (!to || !linkUrl) return { ok: false, error: 'Missing to or play link' };

  const name = String(fullName || '').trim() || to.split('@')[0] || 'Hola';

  let bodyHtml;
  let textPlain;

  if (store) {
    bodyHtml = `
  <p style="margin:0 0 16px;font-size:16px;color:#e2e8f0;line-height:1.5"><strong>¡Listo! Tu cuenta ya está activa.</strong></p>
  <p style="margin:0 0 16px;font-size:15px;color:#e2e8f0;line-height:1.5"><strong>Instala Ainspecciona Capture desde Google Play.</strong></p>
  <ol style="margin:0 0 20px;padding-left:22px;color:#cbd5e1;font-size:14px;line-height:1.75">
    <li style="margin-bottom:6px">Abre el enlace a la ficha de la app en Play Store.</li>
    <li style="margin-bottom:6px">Pulsa <strong>Instalar</strong> (o <strong>Abrir</strong> si ya la tienes).</li>
    <li>Inicia sesión con el <strong>mismo correo</strong> y la <strong>clave que acabas de crear</strong>.</li>
  </ol>
  <p style="margin:0 0 10px;font-size:14px;color:#94a3b8"><strong>Enlace a Google Play:</strong></p>
  <p style="margin:0 0"><a href="${escapeHtml(store)}" class="btn" style="background:linear-gradient(135deg,#0ea5e9,#0284c7)">Abrir en Google Play</a></p>
  <p style="margin:12px 0 0;font-size:14px;color:#94a3b8">Si no ves el botón, copia y pega:<br/><span style="word-break:break-all;color:#cbd5e1">${escapeHtml(store)}</span></p>`;
    textPlain =
      '¡Listo! Tu cuenta ya está activa.\n\n' +
      'Instala Ainspecciona Capture desde Google Play.\n\n' +
      '1. Abre el enlace a la ficha en Play Store.\n' +
      '2. Pulsa Instalar (o Abrir si ya la tienes).\n' +
      '3. Inicia sesión con el mismo correo y la clave que acabas de crear.\n\n' +
      `Link:\n${store}\n\n` +
      '— Ainspecciona';
  } else {
    bodyHtml = `
  <p style="margin:0 0 16px;font-size:16px;color:#e2e8f0;line-height:1.5"><strong>¡Listo! Tu cuenta ya está activa.</strong></p>
  <p style="margin:0 0 16px;font-size:15px;color:#e2e8f0;line-height:1.5"><strong>Te invitamos a probar Ainspecciona Capture.</strong></p>
  <ol style="margin:0 0 20px;padding-left:22px;color:#cbd5e1;font-size:14px;line-height:1.75">
    <li style="margin-bottom:6px">Abre este enlace (con la cuenta de Google con la que te sumamos como tester).</li>
    <li style="margin-bottom:6px">Acepta ser tester.</li>
    <li>Descarga la app desde Google Play.</li>
  </ol>
  <p style="margin:0 0 10px;font-size:14px;color:#94a3b8"><strong>Enlace:</strong></p>
  <p style="margin:0 0"><a href="${escapeHtml(internal)}" class="btn" style="background:linear-gradient(135deg,#0ea5e9,#0284c7)">Abrir enlace de invitación</a></p>
  <p style="margin:12px 0 0;font-size:14px;color:#94a3b8">Si no ves el botón, copia y pega:<br/><span style="word-break:break-all;color:#cbd5e1">${escapeHtml(internal)}</span></p>
  <p style="margin:20px 0 0;font-size:13px;color:#64748b">Ingresa a la app con el mismo correo y la clave que acabas de crear.</p>`;
    textPlain =
      '¡Listo! Tu cuenta ya está activa.\n\n' +
      'Te invitamos a probar Ainspecciona Capture.\n\n' +
      '1. Abre este link (con la cuenta de Google con la que te sumamos como tester).\n' +
      '2. Acepta ser tester.\n' +
      '3. Descarga la app desde Google Play.\n\n' +
      `Link:\n${internal}\n\n` +
      'Ingresa a la app con el mismo correo y la clave que acabas de crear.\n\n' +
      '— Ainspecciona';
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px;line-height:1.6}a{color:#7c3aed;font-weight:600;text-decoration:none}.btn{display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff!important;border-radius:12px;margin:16px 0}.card{max-width:480px;margin:0 auto;background:#1e293b;border-radius:16px;padding:32px;border:1px solid #334155}</style></head>
<body>
<div class="card">
  <h1 style="margin:0 0 16px;font-size:22px">Hola ${escapeHtml(name)},</h1>
  ${bodyHtml}
  <p style="margin:24px 0 0;font-size:13px;color:#64748b">— Ainspecciona</p>
</div>
</body>
</html>`;

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado. Mail Capture no enviado a', to);
    return { ok: false, skipped: true };
  }

  try {
    const info = await transporter.sendMail({
      from: getFromEmail(),
      to: to.trim().toLowerCase(),
      subject: 'Ainspecciona Capture — instala la app · Ainspecciona',
      text: textPlain,
      html
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[email] Error enviando mail Capture:', err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function sendBusinessMagicLinkEmail(to, magicLinkUrl, tenantName = '', options = {}) {
  if (!to || !magicLinkUrl) return { ok: false, error: 'Missing to or magicLinkUrl' };
  const name = tenantName || to.split('@')[0] || 'Cliente';
  const { facturacion, receiptPdfBuffer, montoClp = 39990 } = options;

  let facturaNote = '';
  if (facturacion) {
    facturaNote = '<p style="margin:16px 0 0;font-size:14px;color:#94a3b8">Adjuntamos tu comprobante de pago para facturación.</p>';
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px;line-height:1.6}a{color:#7c3aed;font-weight:600;text-decoration:none}.btn{display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff!important;border-radius:12px;margin:16px 0}.card{max-width:480px;margin:0 auto;background:#1e293b;border-radius:16px;padding:32px;border:1px solid #334155}</style></head>
<body>
<div class="card">
  <h1 style="margin:0 0 16px;font-size:22px">Hola ${escapeHtml(name)},</h1>
  <p style="margin:0 0 16px">Tu Plan Business está activo. Haz clic en el enlace para acceder a tu dashboard y crear tu contraseña:</p>
  <p style="margin:16px 0"><a href="${escapeHtml(magicLinkUrl)}" class="btn">Acceder al dashboard</a></p>
  <p style="margin:16px 0;font-size:14px;color:#94a3b8">O copia este enlace: ${escapeHtml(magicLinkUrl)}</p>
  <p style="margin:24px 0 0;font-size:13px;color:#64748b">El enlace expira en 24 horas. La primera vez crearás tu contraseña para futuros accesos.</p>
  ${facturaNote}
  <p style="margin:16px 0 0;font-size:13px;color:#64748b">— Ainspecciona</p>
</div>
</body>
</html>`;

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado. Magic link no enviado a', to);
    return { ok: false, skipped: true };
  }

  try {
    const mailOpts = {
      from: getFromEmail(),
      to: to.trim().toLowerCase(),
      subject: 'Accede a tu dashboard · Ainspecciona',
      html,
    };
    if (receiptPdfBuffer && receiptPdfBuffer.length > 0) {
      mailOpts.attachments = [{ filename: 'Comprobante-Business.pdf', content: receiptPdfBuffer }];
    }
    const info = await transporter.sendMail(mailOpts);
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[email] Error enviando magic link:', err);
    return { ok: false, error: err?.message || String(err) };
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Notifica al revisor (Paulo) que una inspección Starter está lista para revisión.
 */
export async function sendReviewNotificationEmail(to, reportUrl, caseShortId, contactName = '') {
  if (!to || !reportUrl) return { ok: false, error: 'Missing to or reportUrl' };

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px;line-height:1.6}a{color:#7c3aed;font-weight:600;text-decoration:none}.btn{display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff!important;border-radius:12px;margin:16px 0}.card{max-width:480px;margin:0 auto;background:#1e293b;border-radius:16px;padding:32px;border:1px solid #334155}</style></head>
<body>
<div class="card">
  <h1 style="margin:0 0 16px;font-size:22px">Nueva inspección para revisión</h1>
  <p style="margin:0 0 8px">Caso: <strong>${escapeHtml(caseShortId)}</strong></p>
  ${contactName ? `<p style="margin:0 0 8px">Cliente: <strong>${escapeHtml(contactName)}</strong></p>` : ''}
  <p style="margin:16px 0">La IA ha completado el análisis. Revisa el informe y apruébalo para enviarlo al cliente.</p>
  <p style="margin:16px 0"><a href="${escapeHtml(reportUrl)}" class="btn">Revisar informe</a></p>
  <p style="margin:16px 0;font-size:14px;color:#94a3b8">O copia este enlace: ${escapeHtml(reportUrl)}</p>
  <p style="margin:16px 0 0;font-size:13px;color:#64748b">— Ainspecciona</p>
</div>
</body>
</html>`;

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado. Review notification no enviado a', to);
    return { ok: false, skipped: true };
  }

  try {
    const info = await transporter.sendMail({
      from: getFromEmail(),
      to: to.trim().toLowerCase(),
      subject: `Inspección ${caseShortId} lista para revisión · Ainspecciona`,
      html,
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[email] Error enviando review notification:', err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Envía el informe aprobado (PDF + certificado JPG) al email del cliente Starter.
 */
export async function sendApprovedReportEmail(to, contactName = '', caseShortId = '', pdfBuffer = null, certBuffer = null) {
  if (!to) return { ok: false, error: 'Missing to' };
  const name = contactName || to.split('@')[0] || 'Cliente';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px;line-height:1.6}a{color:#7c3aed;font-weight:600;text-decoration:none}.btn{display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff!important;border-radius:12px;margin:16px 0}.card{max-width:520px;margin:0 auto;background:#1e293b;border-radius:16px;padding:32px;border:1px solid #334155}.step{display:flex;gap:12px;align-items:flex-start;margin:8px 0}.step-num{background:#7c3aed;color:#fff;width:24px;height:24px;border-radius:50%;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px}.step-text{font-size:14px;color:#cbd5e1}</style></head>
<body>
<div class="card">
  <h1 style="margin:0 0 16px;font-size:22px">Hola ${escapeHtml(name)},</h1>
  <p style="margin:0 0 16px">Tu informe de inspección <strong>${escapeHtml(caseShortId)}</strong> está listo.</p>
  <p style="margin:0 0 8px">Encontrarás adjuntos:</p>
  <ul style="margin:0 0 20px;padding-left:20px;font-size:14px;color:#94a3b8;">
    <li style="margin:4px 0"><strong style="color:#e2e8f0">Informe-${escapeHtml(caseShortId)}.pdf</strong> — Informe técnico completo</li>
    <li style="margin:4px 0"><strong style="color:#e2e8f0">Certificado-${escapeHtml(caseShortId)}.jpg</strong> — Certificado de inspección</li>
  </ul>
  <div style="background:#1a2332;border:1px solid #2d3f56;border-radius:12px;padding:20px;margin:0 0 20px;">
    <p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#7c3aed;">¿Cómo usar el certificado?</p>
    <div class="step">
      <span class="step-num">1</span>
      <span class="step-text">Descarga la imagen <strong>Certificado-${escapeHtml(caseShortId)}.jpg</strong> adjunta a este email.</span>
    </div>
    <div class="step">
      <span class="step-num">2</span>
      <span class="step-text">Súbela como la <strong>última foto</strong> en tu publicación de la propiedad (Portalinmobiliario, Yapo, etc.).</span>
    </div>
    <div class="step">
      <span class="step-num">3</span>
      <span class="step-text">Los interesados podrán ver que la propiedad fue inspeccionada profesionalmente con IA.</span>
    </div>
  </div>
  <p style="margin:0 0 0;font-size:13px;color:#64748b">Si tienes dudas sobre los resultados, responde a este correo.</p>
  <p style="margin:12px 0 0;font-size:13px;color:#64748b">— Ainspecciona</p>
</div>
</body>
</html>`;

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado. Report email no enviado a', to);
    return { ok: false, skipped: true };
  }

  try {
    const attachments = [];
    if (pdfBuffer && pdfBuffer.length > 0) {
      attachments.push({ filename: `Informe-${caseShortId}.pdf`, content: pdfBuffer });
    }
    if (certBuffer && certBuffer.length > 0) {
      attachments.push({ filename: `Certificado-${caseShortId}.jpg`, content: certBuffer, contentType: 'image/jpeg' });
    }
    const mailOpts = {
      from: getFromEmail(),
      to: to.trim().toLowerCase(),
      subject: `Tu informe de inspección ${caseShortId} · Ainspecciona`,
      html,
      attachments,
    };
    const info = await transporter.sendMail(mailOpts);
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[email] Error enviando approved report:', err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Envía email de recuperación de contraseña con una nueva contraseña temporal.
 */
export async function sendPasswordResetEmail(to, newPassword, tenantName = '') {
  if (!to || !newPassword) return { ok: false, error: 'Missing to or newPassword' };
  const localPart = (to.split('@')[0] || '').trim();
  const firstName = localPart.split(/[._]/)[0] || localPart;
  const greeting = firstName ? (firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()) : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px;line-height:1.6}a{color:#7c3aed;font-weight:600;text-decoration:none}.btn{display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff!important;border-radius:12px;margin:16px 0}.card{max-width:480px;margin:0 auto;background:#1e293b;border-radius:16px;padding:32px;border:1px solid #334155}.mono{font-family:monospace;background:#0f172a;padding:8px 12px;border-radius:8px;font-size:16px;letter-spacing:1px;}</style></head>
<body>
<div class="card">
  <h1 style="margin:0 0 16px;font-size:22px">Hola${greeting ? ` ${escapeHtml(greeting)}` : ''},</h1>
  <p style="margin:0 0 16px">Se ha solicitado el restablecimiento de tu contraseña en Ainspecciona.</p>
  <p style="margin:16px 0">Tu nueva contraseña temporal es:</p>
  <p style="text-align:center;margin:24px 0"><span class="mono" style="font-family:monospace;font-size:18px;background:#0b1220;padding:12px 16px;border-radius:8px;color:#35D07F;">${escapeHtml(newPassword)}</span></p>
  <p style="margin:24px 0 0;font-size:14px">Usa esta clave para <a href="https://ainspecciona.com/" style="color:#35D07F;">iniciar sesión</a> y te recomendamos cambiarla en tu panel de administración lo antes posible.</p>
  <p style="margin:24px 0 0;font-size:13px;color:#64748b">Si no solicitaste este cambio, por favor ignora este correo o contáctanos a soporte.</p>
  <p style="margin:16px 0 0;font-size:13px;color:#64748b">— Equipo Ainspecciona</p>
</div>
</body>
</html>`;

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado. Email reset password no enviado a', to);
    return { ok: false, skipped: true, error: 'SMTP no configurado (SMTP_HOST, SMTP_USER, SMTP_PASS)' };
  }

  try {
    const toAddr = to.trim().toLowerCase();
    const info = await transporter.sendMail({
      from: getFromEmail(),
      to: toAddr,
      subject: 'Recuperación de contraseña · Ainspecciona',
      html,
    });
    console.info('[email] Reset password enviado a', toAddr, 'messageId:', info.messageId);
    return { ok: true, id: info.messageId };
  } catch (err) {
    const msg = err?.message || String(err);
    const code = err?.code || err?.responseCode;
    console.error('[email] Error enviando reset password:', { to, code, message: msg });
    return { ok: false, error: code ? `[${code}] ${msg}` : msg };
  }
}
