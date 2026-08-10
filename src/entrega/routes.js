import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { addFinding, listFindings, clearUnit, attachPhoto, attachClosePhoto, finalizeFindingClose } from './store.js';
import { getPublicKpiCatalog } from './kpiCatalog.js';
import { loadEntregaKpiCatalog } from './taxonomyKpi.js';
import { locateTapeFromBuffer } from './locateTape.js';
import { createStorage } from '../storage/storage.js';
import {
  createEntregaSession,
  destroyEntregaSession,
  getEntregaSession,
  hashPassword,
  normalizeEntregaRole,
  requireEntregaAdmin,
  requireEntregaAuth,
  sessionCookieOpts,
  verifyPassword,
  ENTREGA_ROLES,
  ENTREGA_SESSION_COOKIE
} from './auth.js';

let storage;
function getStorage() {
  if (!storage) storage = createStorage();
  return storage;
}

function safeSeg(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'sin';
}

function publicFotoUrl(ref, findingId) {
  return `/api/entrega/units/${encodeURIComponent(ref)}/findings/${encodeURIComponent(findingId)}/image`;
}

function publicCloseImageUrl(ref, findingId) {
  return `/api/entrega/units/${encodeURIComponent(ref)}/findings/${encodeURIComponent(findingId)}/close-image`;
}

/** Localiza cinta en background; no pisa mira ya fijada a mano. */
function locateTapeInBackground(ref, id, buf, kind, log) {
  void (async () => {
    let target = null;
    try {
      target = await locateTapeFromBuffer(buf, { log });
    } catch (err) {
      log?.warn?.({ err, id, kind }, 'entrega locateTape background failed');
      return;
    }
    if (!target) return;
    try {
      const findings = await listFindings(ref);
      const existing = findings.find((f) => f.id === id);
      if (!existing) return;
      if (kind === 'close') {
        if (existing.targetResuelto) return;
        await attachClosePhoto(ref, id, { target });
      } else {
        if (existing.target) return;
        await attachPhoto(ref, id, { target });
      }
    } catch (err) {
      log?.warn?.({ err, id, kind }, 'entrega locateTape attach failed');
    }
  })();
}

function withPublicFotoUrls(ref, findings) {
  return (findings || []).map((f) => ({
    ...f,
    fotoUrl: f.fotoUrl ? publicFotoUrl(ref, f.id) : null,
    fotoResueltaUrl: f.fotoResueltaUrl ? publicCloseImageUrl(ref, f.id) : null,
    fotoCierreUrl: f.fotoResueltaUrl ? publicCloseImageUrl(ref, f.id) : null
  }));
}

async function streamStoredImage(storagePath, reply, log, ctx) {
  try {
    const store = getStorage();
    const buf = await store.readBuffer(storagePath);
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.type('image/jpeg').send(buf);
  } catch (err) {
    log.error({ err, ...ctx }, 'entrega image read');
    return reply.code(404).send({ ok: false, error: 'IMAGE_READ_FAILED' });
  }
}

async function streamFindingImage(ref, id, reply, log) {
  const findings = await listFindings(ref);
  const finding = findings.find((f) => f.id === id);
  if (!finding?.fotoUrl) {
    return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
  }
  return streamStoredImage(finding.fotoUrl, reply, log, { ref, id, kind: 'r0' });
}

async function streamCloseImage(ref, id, reply, log) {
  const findings = await listFindings(ref);
  const finding = findings.find((f) => f.id === id);
  if (!finding?.fotoResueltaUrl) {
    return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
  }
  return streamStoredImage(finding.fotoResueltaUrl, reply, log, { ref, id, kind: 'cierre' });
}

/**
 * Rutas del prototipo "Ainspecciona Entrega".
 * - Config pública del agente ElevenLabs.
 * - Lectura de hallazgos por unidad (para los dashboards).
 * - Tools del agente para agregar/listar hallazgos por departamento.
 */

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Secreto opcional: si ENTREGA_AGENT_SECRET está configurado, se exige. */
function agentSecretPreHandler(req, reply, done) {
  const expected = String(process.env.ENTREGA_AGENT_SECRET || '').trim();
  if (!expected) return done(); // prototipo: sin secreto configurado, se permite
  const provided = String(
    req.headers['x-entrega-agent-secret'] || req.headers['entrega-agent-secret'] || ''
  ).trim();
  if (!provided || !timingSafeEqualStr(expected, provided)) {
    reply.code(401).send({ ok: false, error: 'UNAUTHORIZED', message: 'Falta o es inválido x-entrega-agent-secret.' });
    return;
  }
  done();
}

function publicEntregaUser(u) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt
  };
}

export async function registerEntregaRoutes(app, deps = {}) {
  const prisma = deps.prisma || null;
  const auth = requireEntregaAuth(prisma);
  const adminAuth = requireEntregaAdmin(prisma);

  app.post('/api/entrega/login', async (req, reply) => {
    if (!prisma) return reply.code(503).send({ ok: false, error: 'DB_UNAVAILABLE' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return reply.code(400).send({ ok: false, error: 'MISSING_FIELDS', message: 'Email y clave son obligatorios.' });
    }
    const user = await prisma.entregaUser.findFirst({
      where: { email },
      include: { tenant: true }
    });
    if (!user || user.status !== 'ACTIVE' || !user.tenant || user.tenant.status !== 'ACTIVE') {
      return reply.code(401).send({ ok: false, error: 'INVALID_CREDENTIALS', message: 'Email o clave incorrectos.' });
    }
    if (!verifyPassword(password, user.passwordHash)) {
      return reply.code(401).send({ ok: false, error: 'INVALID_CREDENTIALS', message: 'Email o clave incorrectos.' });
    }
    const token = await createEntregaSession(prisma, { tenantId: user.tenantId, userId: user.id });
    // Cookie propia (Cloud Run directo) + __session (Firebase Hosting solo reenvía esa cookie a Cloud Run).
    reply.setCookie(ENTREGA_SESSION_COOKIE, token, sessionCookieOpts(req));
    reply.setCookie('__session', token, sessionCookieOpts(req));
    return reply.send({
      ok: true,
      token,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
      tenant: { id: user.tenant.id, slug: user.tenant.slug, name: user.tenant.name }
    });
  });

  app.post('/api/entrega/logout', async (req, reply) => {
    const productToken =
      String(req.headers['x-entrega-session'] || '').trim() ||
      req.cookies?.[ENTREGA_SESSION_COOKIE] ||
      '';
    if (prisma) await destroyEntregaSession(prisma, req);
    reply.clearCookie(ENTREGA_SESSION_COOKIE, { path: '/' });
    if (productToken && req.cookies?.__session === productToken) {
      reply.clearCookie('__session', { path: '/' });
    }
    return reply.send({ ok: true });
  });

  app.get('/api/entrega/me', async (req, reply) => {
    if (!prisma) return reply.code(503).send({ ok: false, error: 'DB_UNAVAILABLE' });
    const session = await getEntregaSession(prisma, req);
    if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
    return reply.send({
      ok: true,
      user: {
        id: session.user.id,
        email: session.user.email,
        fullName: session.user.fullName,
        role: session.user.role
      },
      tenant: {
        id: session.tenant.id,
        slug: session.tenant.slug,
        name: session.tenant.name
      }
    });
  });

  /** Listado de usuarios del tenant (solo administrador). */
  app.get('/api/entrega/users', { preHandler: adminAuth }, async (req, reply) => {
    const tenantId = req.entregaSession.tenantId;
    const users = await prisma.entregaUser.findMany({
      where: { tenantId },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }]
    });
    return reply.send({
      ok: true,
      roles: ENTREGA_ROLES,
      users: users.map(publicEntregaUser)
    });
  });

  /** Crear usuario del tenant. */
  app.post('/api/entrega/users', { preHandler: adminAuth }, async (req, reply) => {
    const tenantId = req.entregaSession.tenantId;
    const email = String(req.body?.email || '').trim().toLowerCase();
    const fullName = String(req.body?.fullName || '').trim();
    const password = String(req.body?.password || '');
    const role = normalizeEntregaRole(req.body?.role);
    if (!email || !fullName || !password) {
      return reply.code(400).send({
        ok: false,
        error: 'MISSING_FIELDS',
        message: 'Nombre, email y clave son obligatorios.'
      });
    }
    if (!role || !ENTREGA_ROLES.includes(role)) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_ROLE',
        message: 'Rol inválido. Usa Administrador, Ejecutivo o Inspector.'
      });
    }
    if (password.length < 8) {
      return reply.code(400).send({
        ok: false,
        error: 'WEAK_PASSWORD',
        message: 'La clave debe tener al menos 8 caracteres.'
      });
    }
    const exists = await prisma.entregaUser.findUnique({ where: { email } });
    if (exists) {
      return reply.code(409).send({
        ok: false,
        error: 'EMAIL_EXISTS',
        message: 'Ya existe un usuario con ese email.'
      });
    }
    const user = await prisma.entregaUser.create({
      data: {
        tenantId,
        email,
        fullName,
        role,
        status: 'ACTIVE',
        passwordHash: hashPassword(password)
      }
    });
    return reply.code(201).send({ ok: true, user: publicEntregaUser(user) });
  });

  /** Actualizar rol / estado / nombre / clave. */
  app.patch('/api/entrega/users/:userId', { preHandler: adminAuth }, async (req, reply) => {
    const tenantId = req.entregaSession.tenantId;
    const userId = String(req.params.userId || '').trim();
    const target = await prisma.entregaUser.findFirst({ where: { id: userId, tenantId } });
    if (!target) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });

    const data = {};
    if (req.body?.fullName != null) {
      const fullName = String(req.body.fullName || '').trim();
      if (!fullName) {
        return reply.code(400).send({ ok: false, error: 'INVALID_NAME', message: 'El nombre no puede quedar vacío.' });
      }
      data.fullName = fullName;
    }
    if (req.body?.role != null) {
      const role = normalizeEntregaRole(req.body.role);
      if (!role) {
        return reply.code(400).send({ ok: false, error: 'INVALID_ROLE' });
      }
      data.role = role;
    }
    if (req.body?.status != null) {
      const status = String(req.body.status || '').toUpperCase();
      if (status !== 'ACTIVE' && status !== 'DISABLED') {
        return reply.code(400).send({ ok: false, error: 'INVALID_STATUS' });
      }
      if (status === 'DISABLED' && target.id === req.entregaSession.userId) {
        return reply.code(400).send({
          ok: false,
          error: 'CANNOT_DISABLE_SELF',
          message: 'No puedes desactivar tu propio usuario.'
        });
      }
      data.status = status;
    }
    if (req.body?.password != null && String(req.body.password).length) {
      const password = String(req.body.password);
      if (password.length < 8) {
        return reply.code(400).send({
          ok: false,
          error: 'WEAK_PASSWORD',
          message: 'La clave debe tener al menos 8 caracteres.'
        });
      }
      data.passwordHash = hashPassword(password);
    }

    // No dejar al tenant sin ningún administrador activo.
    const nextRole = data.role || target.role;
    const nextStatus = data.status || target.status;
    if (target.role === 'ADMIN' && (nextRole !== 'ADMIN' || nextStatus !== 'ACTIVE')) {
      const otherAdmins = await prisma.entregaUser.count({
        where: {
          tenantId,
          role: 'ADMIN',
          status: 'ACTIVE',
          id: { not: target.id }
        }
      });
      if (otherAdmins === 0) {
        return reply.code(400).send({
          ok: false,
          error: 'LAST_ADMIN',
          message: 'Debe quedar al menos un administrador activo en el tenant.'
        });
      }
    }

    if (!Object.keys(data).length) {
      return reply.code(400).send({ ok: false, error: 'NO_CHANGES' });
    }

    const user = await prisma.entregaUser.update({ where: { id: target.id }, data });
    return reply.send({ ok: true, user: publicEntregaUser(user) });
  });

  app.get('/api/entrega/public/kpi-catalog', { preHandler: auth }, async (req, reply) => {
    try {
      const catalog = await loadEntregaKpiCatalog({ force: req.query.refresh === '1' });
      return reply.send(catalog);
    } catch (err) {
      req.log.error({ err }, 'entrega kpi-catalog');
      return reply.send({ ok: true, ...getPublicKpiCatalog(), source: 'static', approvedCount: 0 });
    }
  });

  app.get('/api/entrega/public/elevenlabs-agent', { preHandler: auth }, (req, reply) => {
    const agentId = String(process.env.ELEVENLABS_ENTREGA_AGENT_ID || '').trim();
    if (!agentId) return reply.send({ ok: true, enabled: false, agentId: null });
    const variant = String(process.env.ELEVENLABS_ENTREGA_WIDGET_VARIANT || 'expanded').trim() || 'expanded';
    return reply.send({ ok: true, enabled: true, agentId, variant });
  });

  /** Token WebRTC para el SDK de voz (evita depender del widget embebido). */
  app.get('/api/entrega/public/conversation-token', { preHandler: auth }, async (req, reply) => {
    const raw = String(process.env.ELEVENLABS_ENTREGA_AGENT_ID || '').trim();
    const match = raw.match(/(agent_[a-zA-Z0-9]+)/);
    const agentId = match ? match[1] : raw.split('&')[0].split('?')[0].trim();
    const apiKey = String(process.env.ELEVENLABS_API_KEY || '').trim();
    if (!agentId || !apiKey) {
      return reply.code(503).send({ ok: false, error: 'NOT_CONFIGURED' });
    }
    try {
      const url = new URL('https://api.elevenlabs.io/v1/convai/conversation/token');
      url.searchParams.set('agent_id', agentId);
      const res = await fetch(url.toString(), { headers: { 'xi-api-key': apiKey } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) {
        req.log.error({ status: res.status, data }, 'entrega conversation-token');
        return reply.code(502).send({ ok: false, error: 'TOKEN_FAILED' });
      }
      return reply.send({ ok: true, token: data.token, agentId });
    } catch (err) {
      req.log.error({ err }, 'entrega conversation-token');
      return reply.code(502).send({ ok: false, error: 'TOKEN_FAILED' });
    }
  });

  // Lectura para los dashboards (requiere sesión Entrega)
  app.get('/api/entrega/units/:ref/findings', { preHandler: auth }, async (req, reply) => {
    const ref = String(req.params.ref || '').trim();
    if (!ref) return reply.code(400).send({ ok: false, error: 'REF_REQUIRED' });
    const findings = withPublicFotoUrls(ref, await listFindings(ref));
    return reply.send({ ok: true, unitRef: ref, findings });
  });

  app.get('/api/entrega/units/:ref/findings/:id/image', { preHandler: auth }, async (req, reply) => {
    const ref = String(req.params.ref || '').trim();
    const id = String(req.params.id || '').trim();
    if (!ref || !id) return reply.code(400).send({ ok: false, error: 'PARAMS_REQUIRED' });
    return streamFindingImage(ref, id, reply, req.log);
  });

  app.get('/api/entrega/units/:ref/findings/:id/close-image', { preHandler: auth }, async (req, reply) => {
    const ref = String(req.params.ref || '').trim();
    const id = String(req.params.id || '').trim();
    if (!ref || !id) return reply.code(400).send({ ok: false, error: 'PARAMS_REQUIRED' });
    return streamCloseImage(ref, id, reply, req.log);
  });

  // Subida de foto de un hallazgo (la llama el navegador, no el agente).
  // Guarda el archivo, intenta localizar la cinta con visión y asocia foto + mira.
  app.post('/api/entrega/units/:ref/findings/:id/photo', { preHandler: auth }, async (req, reply) => {
    const ref = String(req.params.ref || '').trim();
    const id = String(req.params.id || '').trim();
    if (!ref || !id) return reply.code(400).send({ ok: false, error: 'PARAMS_REQUIRED' });

    let data;
    try {
      data = await req.file();
    } catch (err) {
      req.log.error({ err }, 'entrega photo multipart');
      data = null;
    }
    if (!data) return reply.code(400).send({ ok: false, error: 'FILE_REQUIRED', message: 'Falta el archivo de foto.' });

    let buf;
    try {
      buf = await data.toBuffer();
    } catch (err) {
      return reply.code(400).send({ ok: false, error: 'FILE_READ_ERROR' });
    }

    const [slugRaw, unitRaw] = ref.split(':');
    const slug = safeSeg(slugRaw);
    const unit = safeSeg(unitRaw);
    const storageKey = `entrega/${slug}/${unit}/${safeSeg(id)}.jpg`;

    let fotoUrl;
    try {
      const store = getStorage();
      if (store.driver === 'gcs') {
        const saved = await store.saveImageBuffer({
          buffer: buf,
          contentType: 'image/jpeg',
          ext: 'jpg',
          storageKey,
        });
        fotoUrl = saved.publicUrl;
      } else {
        const baseDir = path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads', 'entrega', slug, unit);
        fs.mkdirSync(baseDir, { recursive: true });
        const fileName = `${safeSeg(id)}.jpg`;
        fs.writeFileSync(path.join(baseDir, fileName), buf);
        fotoUrl = `/uploads/entrega/${slug}/${unit}/${fileName}`;
      }
    } catch (err) {
      req.log.error({ err }, 'entrega photo write');
      return reply.code(500).send({ ok: false, error: 'WRITE_ERROR', message: 'No se pudo guardar la foto.' });
    }

    // Responder altiro; visión de cinta en background para no bloquear la UI / el agente.
    const finding = await attachPhoto(ref, id, { fotoUrl, target: null });
    if (!finding) return reply.code(404).send({ ok: false, error: 'FINDING_NOT_FOUND', message: 'No existe el hallazgo.' });

    locateTapeInBackground(ref, id, buf, 'r0', req.log);

    const publicUrl = publicFotoUrl(ref, finding.id);
    return reply.send({
      ok: true,
      fotoUrl: publicUrl,
      target: null,
      finding: { ...finding, fotoUrl: publicUrl }
    });
  });

  // Ajuste manual de la mira (el inspector toca la foto para reubicarla).
  app.post('/api/entrega/units/:ref/findings/:id/target', { preHandler: auth }, async (req, reply) => {
    const ref = String(req.params.ref || '').trim();
    const id = String(req.params.id || '').trim();
    const body = req.body || {};
    const x = Number(body.x);
    const y = Number(body.y);
    if (!ref || !id) return reply.code(400).send({ ok: false, error: 'PARAMS_REQUIRED' });
    if (!Number.isFinite(x) || !Number.isFinite(y)) return reply.code(400).send({ ok: false, error: 'XY_REQUIRED' });
    const finding = await attachPhoto(ref, id, { target: { x, y } });
    if (!finding) return reply.code(404).send({ ok: false, error: 'FINDING_NOT_FOUND' });
    return reply.send({ ok: true, target: finding.target });
  });

  // Foto de cierre (verificación ITO): guarda imagen "después" y propone mira.
  app.post('/api/entrega/units/:ref/findings/:id/close-photo', { preHandler: auth }, async (req, reply) => {
    const ref = String(req.params.ref || '').trim();
    const id = String(req.params.id || '').trim();
    if (!ref || !id) return reply.code(400).send({ ok: false, error: 'PARAMS_REQUIRED' });

    const findings = await listFindings(ref);
    const existing = findings.find((f) => f.id === id);
    if (!existing) return reply.code(404).send({ ok: false, error: 'FINDING_NOT_FOUND' });
    if (existing.estado === 'cerrado') {
      return reply.code(409).send({ ok: false, error: 'ALREADY_CLOSED', message: 'El hallazgo ya está cerrado.' });
    }

    let data;
    try {
      data = await req.file();
    } catch (err) {
      req.log.error({ err }, 'entrega close-photo multipart');
      data = null;
    }
    if (!data) return reply.code(400).send({ ok: false, error: 'FILE_REQUIRED', message: 'Falta la foto de cierre.' });

    let buf;
    try {
      buf = await data.toBuffer();
    } catch (err) {
      return reply.code(400).send({ ok: false, error: 'FILE_READ_ERROR' });
    }

    const [slugRaw, unitRaw] = ref.split(':');
    const slug = safeSeg(slugRaw);
    const unit = safeSeg(unitRaw);
    const storageKey = `entrega/${slug}/${unit}/${safeSeg(id)}-cierre.jpg`;

    let fotoResueltaUrl;
    try {
      const store = getStorage();
      if (store.driver === 'gcs') {
        const saved = await store.saveImageBuffer({
          buffer: buf,
          contentType: 'image/jpeg',
          ext: 'jpg',
          storageKey
        });
        fotoResueltaUrl = saved.publicUrl;
      } else {
        const baseDir = path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads', 'entrega', slug, unit);
        fs.mkdirSync(baseDir, { recursive: true });
        const fileName = `${safeSeg(id)}-cierre.jpg`;
        fs.writeFileSync(path.join(baseDir, fileName), buf);
        fotoResueltaUrl = `/uploads/entrega/${slug}/${unit}/${fileName}`;
      }
    } catch (err) {
      req.log.error({ err }, 'entrega close-photo write');
      return reply.code(500).send({ ok: false, error: 'WRITE_ERROR', message: 'No se pudo guardar la foto de cierre.' });
    }

    const finding = await attachClosePhoto(ref, id, { fotoResueltaUrl, target: null });
    if (!finding) return reply.code(404).send({ ok: false, error: 'FINDING_NOT_FOUND' });

    locateTapeInBackground(ref, id, buf, 'close', req.log);

    const publicUrl = publicCloseImageUrl(ref, finding.id);
    return reply.send({
      ok: true,
      fotoResueltaUrl: publicUrl,
      target: null,
      finding: { ...withPublicFotoUrls(ref, [finding])[0] }
    });
  });

  // Confirma mira de cierre y marca el hallazgo como cerrado.
  app.post('/api/entrega/units/:ref/findings/:id/close-target', { preHandler: auth }, async (req, reply) => {
    const ref = String(req.params.ref || '').trim();
    const id = String(req.params.id || '').trim();
    const body = req.body || {};
    const x = Number(body.x);
    const y = Number(body.y);
    if (!ref || !id) return reply.code(400).send({ ok: false, error: 'PARAMS_REQUIRED' });
    if (!Number.isFinite(x) || !Number.isFinite(y)) return reply.code(400).send({ ok: false, error: 'XY_REQUIRED' });

    const finding = await finalizeFindingClose(ref, id, {
      target: { x, y },
      cerradoPor: body.cerradoPor
    });
    if (!finding) {
      const list = await listFindings(ref);
      const f = list.find((item) => item.id === id);
      if (!f) return reply.code(404).send({ ok: false, error: 'FINDING_NOT_FOUND' });
      if (f.estado === 'cerrado') return reply.code(409).send({ ok: false, error: 'ALREADY_CLOSED' });
      return reply.code(400).send({ ok: false, error: 'CLOSE_PHOTO_REQUIRED', message: 'Sube la foto de cierre antes de confirmar.' });
    }

    return reply.send({
      ok: true,
      target: finding.targetResuelto,
      finding: { ...withPublicFotoUrls(ref, [finding])[0] }
    });
  });

  // Tool del agente: agregar un hallazgo
  app.post('/api/entrega/agent/add-finding', { preHandler: agentSecretPreHandler }, async (req, reply) => {
    try {
      const body = req.body || {};
      const unitRef = String(body.unitRef || '').trim();
      if (!unitRef) return reply.code(400).send({ ok: false, error: 'UNIT_REF_REQUIRED', message: 'Falta unitRef (ej. cuvee-2:301).' });
      if (!body.descripcion) return reply.code(400).send({ ok: false, error: 'DESCRIPCION_REQUIRED', message: 'Falta la descripción del hallazgo.' });
      const finding = await addFinding(unitRef, body);
      return reply.code(201).send({ ok: true, finding, message: `Hallazgo registrado en ${unitRef}: ${finding.descripcion}.` });
    } catch (err) {
      req.log.error({ err }, 'entrega add-finding');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR', message: 'No se pudo registrar el hallazgo.' });
    }
  });

  // Tool del agente: listar hallazgos de una unidad
  app.post('/api/entrega/agent/list-findings', { preHandler: agentSecretPreHandler }, async (req, reply) => {
    const unitRef = String((req.body || {}).unitRef || '').trim();
    if (!unitRef) return reply.code(400).send({ ok: false, error: 'UNIT_REF_REQUIRED' });
    const findings = withPublicFotoUrls(unitRef, await listFindings(unitRef));
    return reply.send({ ok: true, unitRef, count: findings.length, findings });
  });

  // Utilidad para la demo: limpiar los hallazgos capturados de una unidad
  app.post('/api/entrega/agent/reset-unit', { preHandler: agentSecretPreHandler }, async (req, reply) => {
    const unitRef = String((req.body || {}).unitRef || '').trim();
    if (!unitRef) return reply.code(400).send({ ok: false, error: 'UNIT_REF_REQUIRED' });
    await clearUnit(unitRef);
    return reply.send({ ok: true, unitRef, cleared: true });
  });
}
