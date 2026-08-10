/**
 * Envío de emails vía SMTP (Nodemailer).
 * Configuración: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 * Si no está configurado, no envía (solo log).
 */
import nodemailer from 'nodemailer';

/** Ficha pública Ainspecciona Capture (iOS) si no hay EXECUTIVE_APP_STORE_URL. */
const DEFAULT_EXECUTIVE_APP_STORE_URL =
  'https://apps.apple.com/cl/app/ainspecciona-capture/id6763187024';

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
 * Copia de solicitud postventa al propietario.
 */
export async function sendPostventaTicketCopyEmail(to, { ticketShortId, summary, ownerName = '' }) {
  if (!to || !ticketShortId) return { ok: false, error: 'Missing to or ticketShortId' };
  const name = String(ownerName || to.split('@')[0] || 'Propietario').trim();
  const safeSummary = escapeHtml(String(summary || '').trim() || 'Solicitud de postventa registrada.');

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;font-family:system-ui,sans-serif;background:#f1f5f9;color:#0f172a;line-height:1.6">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e2e8f0">
    <p style="margin:0 0 8px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.04em">Postventa · Ainspecciona</p>
    <h1 style="margin:0 0 16px;font-size:22px">Hola ${escapeHtml(name)},</h1>
    <p style="margin:0 0 12px">Recibimos tu solicitud de postventa con el número:</p>
    <p style="margin:0 0 20px;font-size:20px;font-weight:700;color:#2563eb">${escapeHtml(ticketShortId)}</p>
    <p style="margin:0 0 12px"><strong>Resumen:</strong></p>
    <p style="margin:0 0 20px;color:#334155">${safeSummary}</p>
    <p style="margin:0;font-size:14px;color:#64748b">El equipo de postventa revisará las fotos y te contactará si necesita más antecedentes.</p>
    <p style="margin:20px 0 0;font-size:13px;color:#94a3b8">— Ainspecciona Postventa</p>
  </div>
</body></html>`;

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado. Copia postventa no enviada a', to);
    return { ok: false, skipped: true };
  }

  try {
    const info = await transporter.sendMail({
      from: getFromEmail(),
      to: to.trim().toLowerCase(),
      subject: `Copia de tu solicitud ${ticketShortId} · Postventa Ainspecciona`,
      html
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[email] Error copia postventa:', err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Mensaje del formulario público de contacto → buzón interno.
 * Destino: CONTACT_FORM_TO o contacto@ainspecciona.com.
 */
export async function sendContactFormEmail({ name, email, company, message }) {
  const to = String(process.env.CONTACT_FORM_TO || 'contacto@ainspecciona.com').trim();
  const safeName = escapeHtml(String(name || '').trim());
  const safeEmail = escapeHtml(String(email || '').trim());
  const safeCompany = escapeHtml(String(company || '').trim());
  const safeMessage = escapeHtml(String(message || '').trim()).replace(/\n/g, '<br>');

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;font-family:system-ui,sans-serif;background:#f1f5f9;color:#0f172a;line-height:1.6">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e2e8f0">
    <p style="margin:0 0 8px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.04em">Formulario de contacto · ainspecciona.com</p>
    <h1 style="margin:0 0 16px;font-size:20px">Nuevo mensaje de ${safeName}</h1>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap">Nombre</td><td style="padding:6px 0">${safeName}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap">Email</td><td style="padding:6px 0"><a href="mailto:${safeEmail}">${safeEmail}</a></td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap">Empresa</td><td style="padding:6px 0">${safeCompany || '—'}</td></tr>
    </table>
    <p style="margin:18px 0 6px;font-weight:600">Mensaje:</p>
    <p style="margin:0;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px">${safeMessage}</p>
    <p style="margin:20px 0 0;font-size:13px;color:#94a3b8">Puedes responder directamente a este correo (Reply-To: ${safeEmail}).</p>
  </div>
</body></html>`;

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado. Mensaje de contacto no enviado a', to);
    return { ok: false, skipped: true };
  }

  try {
    const info = await transporter.sendMail({
      from: getFromEmail(),
      to,
      replyTo: String(email || '').trim().toLowerCase() || undefined,
      subject: `Contacto web: ${String(name || '').trim()}${company ? ` (${String(company).trim()})` : ''}`,
      html
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[email] Error formulario contacto:', err);
    return { ok: false, error: err?.message || String(err) };
  }
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
 * Nombre para saludo en mail (capitaliza palabras; evita "sebastian" en móvil).
 */
function formatExecutiveGreetingName(fullName, email) {
  const raw = String(fullName || '').trim();
  const fromEmail = String(email || '')
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .trim();
  const base = raw || fromEmail;
  if (!base) return 'ejecutivo';
  return base
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Invitación ejecutivo — etapa 1: solo activar cuenta y crear clave (/activate).
 * Plantilla clara (fondo claro + texto oscuro inline) para Gmail/app y modo oscuro.
 */
export async function sendExecutiveInvitationEmail(to, fullName, tenantName, activationUrlAbsolute) {
  if (!to || !activationUrlAbsolute) return { ok: false, error: 'Missing to or activationUrl' };
  const greetingName = formatExecutiveGreetingName(fullName, to);
  const company = String(tenantName || '').trim() || 'Tu corredora';
  const safeUrl = escapeHtml(activationUrlAbsolute);

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#e2e8f0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#e2e8f0;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background-color:#ffffff;border-radius:16px;border:1px solid #cbd5e1;">
        <tr>
          <td style="padding:28px 28px 12px;">
            <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;color:#64748b;">Ainspecciona · Ejecutivo</p>
            <h1 style="margin:14px 0 0;font-size:24px;font-weight:700;line-height:1.25;color:#0f172a;">Hola ${escapeHtml(greetingName)},</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:4px 28px 28px;">
            <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">
              <strong style="color:#0f172a;">${escapeHtml(company)}</strong> te invita a trabajar en <strong style="color:#0f172a;">Ainspecciona</strong> como ejecutivo: verás las inspecciones que te asignen y podrás usar la app en el móvil una vez actives tu acceso.
            </p>
            <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#334155;">
              Usa el botón para <strong style="color:#0f172a;">elegir tu contraseña</strong> y activar tu cuenta. <strong style="color:#0f172a;">No reenvíes este correo</strong>: el enlace es solo para ti.
            </p>
            <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 20px;">
              <tr>
                <td style="border-radius:12px;background-color:#4f46e5;">
                  <a href="${safeUrl}" style="display:inline-block;padding:16px 28px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">Activar mi cuenta</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#64748b;">Si el botón no abre, copia y pega esta dirección en el navegador:</p>
            <p style="margin:0;font-size:13px;line-height:1.5;word-break:break-all;">
              <a href="${safeUrl}" style="color:#4338ca;font-weight:600;text-decoration:underline;">${safeUrl}</a>
            </p>
            <p style="margin:24px 0 0;font-size:13px;line-height:1.55;color:#64748b;">
              El enlace caduca a los <strong style="color:#475569;">30 días</strong>. Al terminar la activación recibirás otro correo con los enlaces para instalar <strong style="color:#475569;">Ainspecciona Capture</strong> en <strong style="color:#475569;">Google Play</strong> (Android) y en el <strong style="color:#475569;">App Store</strong> (iPhone o iPad).
            </p>
            <p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#94a3b8;">— Equipo Ainspecciona</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const textPlain =
    `Hola ${greetingName},\n\n` +
    `${company} te invita a usar Ainspecciona como ejecutivo.\n\n` +
    'Activa tu cuenta y crea tu contraseña con este enlace (válido 30 días, no lo compartas):\n' +
    `${activationUrlAbsolute}\n\n` +
    'Después de activarte recibirás otro correo con enlaces a Google Play (Android) y App Store (iPhone/iPad) para Ainspecciona Capture.\n\n' +
    '— Equipo Ainspecciona';

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
 * Etapa 2 (tras crear clave en /activate): enlace a Ainspecciona Capture en Play (Android) + App Store (iOS).
 * Si hay ficha pública (playStoreUrl), se usa en el mail. Si no, cae a prueba interna (playInternalTestUrl).
 * Misma línea visual que la invitación: fondo claro y texto oscuro inline (legible en móvil).
 * @param {string} [googlePlayBadgeUrl] URL absoluta al PNG de badge Google Play en /assets.
 * @param {string} [appStoreUrl] URL a la ficha en App Store; si falta, se usa la ficha pública por defecto.
 * @param {string} [appStoreBadgeUrl] URL absoluta al PNG badge App Store en /assets.
 */
export async function sendExecutiveCaptureInviteEmail(
  to,
  fullName,
  playInternalTestUrl,
  playStoreUrl = '',
  googlePlayBadgeUrl = '',
  appStoreUrl = '',
  appStoreBadgeUrl = ''
) {
  const internal = String(playInternalTestUrl || '').trim();
  const store = String(playStoreUrl || '').trim();
  const linkUrl = store || internal;
  if (!to || !linkUrl) return { ok: false, error: 'Missing to or play link' };

  const greetingName = formatExecutiveGreetingName(fullName, to);
  const storeIosRaw = String(appStoreUrl || '').trim();
  const storeIos = storeIosRaw || DEFAULT_EXECUTIVE_APP_STORE_URL;
  const playLink = store ? store : internal;

  const storesHtml = executiveCaptureStoresRow(playLink, storeIos, googlePlayBadgeUrl, appStoreBadgeUrl);

  const bodyInner = `
            <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#334155;"><strong style="color:#0f172a;">¡Listo! Tu cuenta ya está activa.</strong></p>
            ${storesHtml}`;
  const textPlain =
    `Hola ${greetingName},\n\n` +
    '¡Listo! Tu cuenta ya está activa.\n\n' +
    'Descarga Ainspecciona Capture en tu tienda e inicia sesión con el mismo correo y la clave que creaste al activar.\n\n' +
    `Google Play:\n${playLink}\n` +
    `App Store:\n${storeIos}\n` +
    '\n— Equipo Ainspecciona';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#e2e8f0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#e2e8f0;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background-color:#ffffff;border-radius:16px;border:1px solid #cbd5e1;">
        <tr>
          <td style="padding:28px 28px 12px;">
            <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;color:#64748b;">Ainspecciona · App móvil</p>
            <h1 style="margin:14px 0 0;font-size:24px;font-weight:700;line-height:1.25;color:#0f172a;">Hola ${escapeHtml(greetingName)},</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:4px 28px 28px;">
            ${bodyInner}
            <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#94a3b8;">— Equipo Ainspecciona</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
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

/**
 * Envío puntual del PDF DTE (boleta/factura SII) tras compra Starter u otros flujos sin magic link Business.
 */
export async function sendSimplefacturaDtePdfEmail(to, pdfBuffer, options = {}) {
  if (!to || !pdfBuffer || !pdfBuffer.length) return { ok: false, error: 'Missing to or PDF' };
  const folio = options.folio != null ? String(options.folio) : '';
  const subject = folio
    ? `Tu documento electrónico SII · folio ${folio} · Ainspecciona`
    : 'Tu documento electrónico (SII) · Ainspecciona';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.5;color:#334155">
  <p>Adjuntamos el PDF de tu boleta o factura electrónica emitida por el SII.</p>
  <p style="font-size:13px;color:#64748b">— Ainspecciona</p>
</body></html>`;
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado. PDF DTE no enviado a', to);
    return { ok: false, skipped: true };
  }
  try {
    const info = await transporter.sendMail({
      from: getFromEmail(),
      to: to.trim().toLowerCase(),
      subject,
      html,
      attachments: [{ filename: 'Boleta-electronica-SII.pdf', content: pdfBuffer }]
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[email] Error enviando PDF DTE:', err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function sendBusinessMagicLinkEmail(to, magicLinkUrl, tenantName = '', options = {}) {
  if (!to || !magicLinkUrl) return { ok: false, error: 'Missing to or magicLinkUrl' };
  const name = tenantName || to.split('@')[0] || 'Cliente';
  const { facturacion, receiptPdfBuffer, dtePdfBuffer, montoClp = 39990 } = options;

  let facturaNote = '';
  if (facturacion || receiptPdfBuffer || dtePdfBuffer) {
    facturaNote =
      '<p style="margin:16px 0 0;font-size:14px;color:#94a3b8">Adjuntamos documentación de tu compra (comprobante interno y/o boleta electrónica SII, según corresponda).</p>';
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
    const attachments = [];
    if (receiptPdfBuffer && receiptPdfBuffer.length > 0) {
      attachments.push({ filename: 'Comprobante-Business.pdf', content: receiptPdfBuffer });
    }
    if (dtePdfBuffer && dtePdfBuffer.length > 0) {
      attachments.push({ filename: 'Boleta-electronica-SII.pdf', content: dtePdfBuffer });
    }
    if (attachments.length > 0) mailOpts.attachments = attachments;
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
 * Una instrucción + badges Google Play y App Store en paralelo (tabla 2 columnas).
 */
function executiveCaptureStoresRow(playStoreHref, appStoreHref, googleBadgeUrl, appStoreBadgeUrl) {
  const hrefPlay = escapeHtml(String(playStoreHref || '').trim());
  const hrefIos = escapeHtml(String(appStoreHref || '').trim());
  const srcGoogle = escapeHtml(String(googleBadgeUrl || '').trim());
  const srcApple = escapeHtml(String(appStoreBadgeUrl || '').trim());

  const instruction = `<p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#475569;">Descarga <strong style="color:#0f172a;">Ainspecciona Capture</strong> en tu tienda e inicia sesión con el <strong>mismo correo</strong> y la <strong>clave que creaste</strong> al activar.</p>`;

  /** Misma altura de fila + centrado vertical (los PNG pueden traer distinto encuadre). */
  const wrapBadgeSlot = (inner) => `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0;">
              <tr>
                <td align="center" valign="middle" height="118" style="height:118px;vertical-align:middle;text-align:center;padding:0;line-height:normal;">
                  ${inner}
                </td>
              </tr>
            </table>`;

  const playInner = srcGoogle
    ? wrapBadgeSlot(
        `<a href="${hrefPlay}" target="_blank" rel="noopener noreferrer" style="display:inline-block;line-height:0;font-size:0;mso-line-height-rule:exactly;text-decoration:none;border:0;"><img src="${srcGoogle}" alt="Google Play" width="220" style="display:block;border:0;outline:none;margin:0 auto;padding:0;height:auto;max-width:100%;width:220px;" /></a>`
      )
    : `<table role="presentation" cellspacing="0" cellpadding="0" align="center"><tr><td style="border-radius:10px;background-color:#0284c7;"><a href="${hrefPlay}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Google Play</a></td></tr></table>`;

  const iosInner = srcApple
    ? wrapBadgeSlot(
        `<a href="${hrefIos}" target="_blank" rel="noopener noreferrer" style="display:inline-block;line-height:0;font-size:0;mso-line-height-rule:exactly;text-decoration:none;border:0;"><img src="${srcApple}" alt="App Store" width="220" style="display:block;border:0;outline:none;margin:0 auto;padding:0;height:auto;max-width:100%;width:220px;" /></a>`
      )
    : `<table role="presentation" cellspacing="0" cellpadding="0" align="center"><tr><td style="border-radius:10px;background-color:#0f172a;"><a href="${hrefIos}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">App Store</a></td></tr></table>`;

  const row = `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0;border-collapse:collapse;">
              <tr>
                <td align="center" valign="middle" width="50%" style="width:50%;padding:4px 6px 4px 0;vertical-align:middle;">
                  ${playInner}
                </td>
                <td align="center" valign="middle" width="50%" style="width:50%;padding:4px 0 4px 6px;vertical-align:middle;">
                  ${iosInner}
                </td>
              </tr>
            </table>`;

  return `${instruction}${row}`;
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
  <p style="margin:16px 0">La IA ha completado el análisis. Revisa el informe en el enlace. Para <strong>aprobar y enviarlo al cliente</strong>, entra al panel de administración (Inspecciones) y pulsa «Aprobar».</p>
  <p style="margin:16px 0"><a href="${escapeHtml(reportUrl)}" class="btn">Abrir informe</a></p>
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
 * Inspección Business: informe listo para que el revisor apruebe antes de avisar al ejecutivo asignado.
 */
export async function sendBusinessReportReviewerNotificationEmail(
  to,
  reportUrl,
  caseShortId,
  { address = '', executiveName = '' } = {}
) {
  if (!to || !reportUrl) return { ok: false, error: 'Missing to or reportUrl' };
  const addr = address ? `<p style="margin:0 0 8px;font-size:14px;color:#94a3b8">${escapeHtml(address)}</p>` : '';
  const exec = executiveName ? `<p style="margin:0 0 8px">Ejecutivo asignado: <strong>${escapeHtml(executiveName)}</strong></p>` : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px;line-height:1.6}a{color:#7c3aed;font-weight:600;text-decoration:none}.btn{display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff!important;border-radius:12px;margin:16px 0}.card{max-width:480px;margin:0 auto;background:#1e293b;border-radius:16px;padding:32px;border:1px solid #334155}</style></head>
<body>
<div class="card">
  <h1 style="margin:0 0 16px;font-size:22px">Informe Business listo para tu revisión</h1>
  <p style="margin:0 0 8px">Caso: <strong>${escapeHtml(caseShortId)}</strong></p>
  ${exec}
  ${addr}
  <p style="margin:16px 0">La IA terminó de emitir el informe. Revísalo en el enlace. Para <strong>aprobar</strong> y que se envíe el aviso al ejecutivo asignado, entra al panel de administración (Inspecciones) y pulsa «Aprobar».</p>
  <p style="margin:16px 0"><a href="${escapeHtml(reportUrl)}" class="btn">Abrir informe</a></p>
  <p style="margin:16px 0;font-size:14px;color:#94a3b8">O copia este enlace: ${escapeHtml(reportUrl)}</p>
  <p style="margin:16px 0 0;font-size:13px;color:#64748b">— Ainspecciona</p>
</div>
</body>
</html>`;

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado. Business review request no enviado a', to);
    return { ok: false, skipped: true };
  }

  try {
    const info = await transporter.sendMail({
      from: getFromEmail(),
      to: to.trim().toLowerCase(),
      subject: `Informe Business ${caseShortId} · pendiente de tu aprobación · Ainspecciona`,
      html
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[email] Error enviando business review request:', err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Avisa al ejecutivo asignado que el informe está emitido (caso DONE + slots listos).
 */
export async function sendExecutiveReportReadyEmail(
  to,
  { fullName = '', shortId = '', address = '', reportUrl = '' } = {}
) {
  if (!to || !reportUrl) return { ok: false, error: 'Missing to or reportUrl' };
  const name = fullName || to.split('@')[0] || 'Ejecutivo';
  const addrLine = address ? `<p style="margin:0 0 8px;font-size:14px;color:#94a3b8">${escapeHtml(address)}</p>` : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px;line-height:1.6}a{color:#7c3aed;font-weight:600;text-decoration:none}.btn{display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff!important;border-radius:12px;margin:16px 0}.card{max-width:480px;margin:0 auto;background:#1e293b;border-radius:16px;padding:32px;border:1px solid #334155}</style></head>
<body>
<div class="card">
  <h1 style="margin:0 0 16px;font-size:22px">Hola ${escapeHtml(name)},</h1>
  <p style="margin:0 0 8px">El informe de la inspección <strong>${escapeHtml(shortId)}</strong> está listo para revisar.</p>
  ${addrLine}
  <p style="margin:16px 0"><a href="${escapeHtml(reportUrl)}" class="btn">Abrir informe</a></p>
  <p style="margin:16px 0;font-size:14px;color:#94a3b8">O copia este enlace: ${escapeHtml(reportUrl)}</p>
  <p style="margin:16px 0 0;font-size:13px;color:#64748b">— Ainspecciona</p>
</div>
</body>
</html>`;

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado. Executive report ready no enviado a', to);
    return { ok: false, skipped: true };
  }

  try {
    const info = await transporter.sendMail({
      from: getFromEmail(),
      to: to.trim().toLowerCase(),
      subject: `Informe ${shortId} listo · Ainspecciona`,
      html
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[email] Error enviando executive report ready:', err);
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

/**
 * Invitación a explorar beneficios del programa de referidos (código + enlace al trial).
 * Se envía una vez al generar el código peer en el tenant.
 */
export async function sendPeerReferralWelcomeEmail(to, _tenantName, dashboardUrl, peerInviteUrl, peerCode) {
  if (!to || !peerInviteUrl || !peerCode) return { ok: false, error: 'Missing to, peerInviteUrl or peerCode' };
  const dash = String(dashboardUrl || '').trim();
  const localPart = String(to || '').split('@')[0] || '';
  const name = localPart ? localPart.charAt(0).toUpperCase() + localPart.slice(1) : 'Hola';
  const trialDaysPeer = Number(process.env.TRIAL_DURATION_DAYS || 14);
  const trialCreditsWithPeer =
    Number(process.env.TRIAL_INITIAL_REAL_INSPECTIONS || 1) + Number(process.env.PEER_TRIAL_BONUS_CREDITS || 1);

  const hr =
    '<hr style="border:none;border-top:1px solid #334155;margin:22px 0;" />';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px;line-height:1.6}a{color:#7c3aed;font-weight:600;text-decoration:none}.btn{display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#35D07F,#1AAE69);color:#0f172a!important;border-radius:12px;margin:16px 0;font-weight:700;text-decoration:none!important}.card{max-width:520px;margin:0 auto;background:#1e293b;border-radius:16px;padding:32px;border:1px solid #334155}.mono{font-family:ui-monospace,monospace;background:#0f172a;padding:10px 14px;border-radius:8px;font-size:16px;letter-spacing:0.06em;color:#35D07F;display:inline-block;margin:8px 0 0}.email-ul{margin:8px 0 20px;padding-left:22px;color:#cbd5e1;font-size:15px;line-height:1.55}.email-ul li{margin:6px 0}.email-h3{margin:0 0 10px;font-size:16px;font-weight:700;color:#EAF0FF}</style></head>
<body>
<div class="card">
  <h1 style="margin:0 0 18px;font-size:22px;font-weight:700">Hola ${escapeHtml(name)},</h1>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.55">Tu cuenta ya tiene activo tu código de <strong>Ainspecciona Rewards</strong>.</p>
  <p style="margin:0;font-size:15px;line-height:1.55">Desde ahora puedes invitar a otras corredoras o profesionales del rubro a probar Ainspecciona y obtener beneficios cuando activen su <strong>dashboard</strong> con tu código.</p>
  ${hr}
  <p class="email-h3">Tu código de referido</p>
  <span class="mono">${escapeHtml(peerCode)}</span>
  ${hr}
  <p class="email-h3" style="margin-top:4px">¿Qué recibe tu referido?</p>
  <ul class="email-ul">
    <li>${trialDaysPeer} días de Free Trial Business</li>
    <li>${trialCreditsWithPeer} créditos de inspección incluidos</li>
    <li>acceso al panel Business al activar el trial (requiere tarjeta de crédito)</li>
  </ul>
  <p class="email-h3">¿Qué obtienes tú?</p>
  <ul class="email-ul">
    <li>1 crédito por cada referido que active el trial con tu código</li>
  </ul>
  <p class="email-h3">¿Qué es un referido válido?</p>
  <p style="margin:0 0 8px;font-size:15px;color:#cbd5e1;line-height:1.55">Una nueva corredora que:</p>
  <ul class="email-ul" style="margin-top:0">
    <li>activa el Free Trial Business con tu código</li>
    <li>completa la activación del trial</li>
  </ul>
  ${hr}
  <p style="margin:0 0 8px;font-size:14px;color:#94a3b8"><strong>Comparte tu enlace directo:</strong></p>
  <p style="margin:0 0 16px;font-size:14px;word-break:break-all"><a href="${escapeHtml(peerInviteUrl)}" style="color:#a78bfa">${escapeHtml(peerInviteUrl)}</a></p>
  <p style="margin:16px 0"><a href="${escapeHtml(peerInviteUrl)}" class="btn">Ver beneficios y compartir mi enlace</a></p>
  ${dash ? `<p style="margin:20px 0 0;font-size:14px;color:#94a3b8;line-height:1.5">También puedes copiar tu código y tu enlace desde tu <a href="${escapeHtml(dash)}" style="color:#22d3ee">panel</a> en cualquier momento.</p>` : '<p style="margin:20px 0 0;font-size:14px;color:#94a3b8;line-height:1.5">También puedes copiar tu código y tu enlace desde tu panel en cualquier momento.</p>'}
  <p style="margin:24px 0 0;font-size:13px;color:#64748b">— Ainspecciona</p>
</div>
</body>
</html>`;

  const textPlain =
    `Hola ${name},\n\n` +
    'Tu cuenta ya tiene activo tu código de Ainspecciona Rewards.\n\n' +
    'Desde ahora puedes invitar a otras corredoras o profesionales del rubro a probar Ainspecciona y obtener beneficios cuando activen su dashboard con tu código.\n\n' +
    '---\n\n' +
    'Tu código de referido\n' +
    `${peerCode}\n\n` +
    '---\n\n' +
    '¿Qué recibe tu referido?\n' +
    `- ${trialDaysPeer} días de Free Trial Business\n` +
    `- ${trialCreditsWithPeer} créditos de inspección incluidos\n` +
    '- acceso al panel Business al activar el trial (requiere tarjeta de crédito)\n\n' +
    '¿Qué obtienes tú?\n' +
    '- 1 crédito por cada referido que active el trial con tu código\n\n' +
    '¿Qué es un referido válido?\n' +
    'Una nueva corredora que:\n' +
    '- activa el Free Trial Business con tu código\n' +
    '- completa la activación del trial\n\n' +
    '---\n\n' +
    'Comparte tu enlace directo:\n' +
    `${peerInviteUrl}\n\n` +
    'Ver beneficios y compartir mi enlace: ' +
    `${peerInviteUrl}\n\n` +
    (dash
      ? `También puedes copiar tu código y tu enlace desde tu panel: ${dash}\n\n`
      : 'También puedes copiar tu código y tu enlace desde tu panel en cualquier momento.\n\n') +
    '— Ainspecciona';

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado. Peer referral welcome no enviado a', to);
    return { ok: false, skipped: true };
  }

  try {
    const info = await transporter.sendMail({
      from: getFromEmail(),
      to: to.trim().toLowerCase(),
      subject: 'Tu código Ainspecciona Rewards ya está activo',
      text: textPlain,
      html
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[email] Error enviando peer referral welcome:', err);
    return { ok: false, error: err?.message || String(err) };
  }
}
