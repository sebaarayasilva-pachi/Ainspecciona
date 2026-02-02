import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import cookie from '@fastify/cookie';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';

import { createStorage } from './src/storage/storage.js';
import { registerCaptureRoutes } from './src/routes/capture.js';
import { getCaseSummary } from './src/routes/caseSummary.js';
import { DEFAULT_SCORE_CONFIG, normalizeScoreConfig, classifyKpiFromSlot } from './src/scoring/scoringV2_2.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({ logger: true });
const prisma = new PrismaClient();
const storage = createStorage();

const PORT = Number(process.env.PORT || 3000);

const DATA_DIR = path.join(__dirname, 'data');
const SCORE_CONFIG_PATH = path.join(DATA_DIR, 'score-config.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadScoreConfig() {
  ensureDataDir();
  if (!fs.existsSync(SCORE_CONFIG_PATH)) return normalizeScoreConfig(DEFAULT_SCORE_CONFIG);
  try {
    const raw = fs.readFileSync(SCORE_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeScoreConfig(parsed);
  } catch {
    return normalizeScoreConfig(DEFAULT_SCORE_CONFIG);
  }
}

function saveScoreConfig(nextConfig) {
  ensureDataDir();
  const normalized = normalizeScoreConfig(nextConfig);
  fs.writeFileSync(SCORE_CONFIG_PATH, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

let scoreConfig = loadScoreConfig();

const TENANT_SESSION_COOKIE = 'tenant_session';
const EXEC_SESSION_COOKIE = 'exec_session';
const tenantSessions = new Map();
const execSessions = new Map();

function getTenantIdFromReq(req) {
  const header = req.headers['x-tenant-id'];
  const query = req.query?.tenantId;
  const value = header || query || '';
  const id = String(value || '').trim();
  return id.length ? id : null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1];
  const hash = parts[2];
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

function normalizeRut(value) {
  return String(value || '')
    .replace(/[^0-9kK]/g, '')
    .toUpperCase();
}

function createTenantSession(tenantId) {
  const token = crypto.randomUUID();
  tenantSessions.set(token, { tenantId, createdAt: Date.now() });
  return token;
}

function getTenantSession(req) {
  const token = req.cookies?.[TENANT_SESSION_COOKIE];
  if (!token) return null;
  return tenantSessions.get(token) || null;
}

function createExecSession(userId, tenantId) {
  const token = crypto.randomUUID();
  execSessions.set(token, { userId, tenantId, createdAt: Date.now() });
  return token;
}

function getExecSession(req) {
  const token = req.cookies?.[EXEC_SESSION_COOKIE];
  if (!token) return null;
  return execSessions.get(token) || null;
}

function computeProgressFromSlots(slots) {
  const total = slots.length;
  const uploaded = slots.filter((s) =>
    ['UPLOADED', 'ANALYZED', 'REJECTED'].includes(String(s.status || '').toUpperCase())
  ).length;
  const analyzed = slots.filter((s) => String(s.status || '').toUpperCase() === 'ANALYZED').length;
  const rejected = slots.filter((s) => String(s.status || '').toUpperCase() === 'REJECTED').length;
  const pct = total ? Math.round((uploaded / total) * 100) : 0;
  return { uploaded, analyzed, rejected, total, pct };
}

async function createActivationForUser({ prismaClient, userId }) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  await prismaClient.activationToken.create({
    data: {
      userId,
      token,
      expiresAt
    }
  });
  return { token, activationUrl: `/activate?token=${encodeURIComponent(token)}` };
}

function safeExtFromMime(mime) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
  };
  return map[String(mime || '').toLowerCase()] || null;
}

function slotGroupFromSlotCode(code = '') {
  const c = String(code || '').toUpperCase();
  if (c.startsWith('BATHROOM_')) return 'BATHROOM';
  return 'GENERAL';
}

async function analyzeImageBufferV1({ buffer }) {
  const meta = await sharp(buffer).metadata().catch(() => ({}));
  const width = meta.width || 0;
  const height = meta.height || 0;

  if (width < 800 || height < 600) {
    return {
      meta: { width, height },
      problem: {
        code: 'PHOTO_TOO_SMALL',
        severity: 'medium',
        confidence: 0.95,
        message: 'La imagen es demasiado pequeña. Se recomienda una resolución mínima de 800x600 píxeles.',
        debug: { width, height }
      }
    };
  }

  const stats = await sharp(buffer).stats().catch(() => null);
  const mean = stats?.channels?.[0]?.mean ?? 0;
  if (mean < 35) {
    return {
      meta: { width, height },
      problem: {
        code: 'PHOTO_TOO_DARK',
        severity: 'medium',
        confidence: 0.9,
        message: 'La imagen está muy oscura. Enciende luces o usa flash.',
        debug: { mean }
      }
    };
  }

  return {
    meta: { width, height },
    problem: {
      code: 'OK',
      severity: 'low',
      confidence: 0.9,
      message: 'Imagen válida.'
    }
  };
}

function slotGroupTitleFromCode(slotCode = '') {
  const code = String(slotCode || '').toUpperCase();
  if (code.startsWith('BATHROOM_1_')) return { groupKey: 'BATH_MAIN', groupTitle: 'Baño principal' };
  if (code.startsWith('BATHROOM_2_')) return { groupKey: 'BATH_SECONDARY', groupTitle: 'Baño secundario' };
  if (code.startsWith('KITCHEN_')) return { groupKey: 'KITCHEN', groupTitle: 'Cocina' };
  if (code.startsWith('LAUNDRY_')) return { groupKey: 'LAUNDRY', groupTitle: 'Loggia' };
  if (code.startsWith('LIVING_')) return { groupKey: 'LIVING', groupTitle: 'Living' };
  if (code.startsWith('BEDROOM_1_')) return { groupKey: 'BEDROOM_1', groupTitle: 'Dormitorio 1' };
  if (code.startsWith('BEDROOM_2_')) return { groupKey: 'BEDROOM_2', groupTitle: 'Dormitorio 2' };
  if (code.startsWith('BEDROOM_3_')) return { groupKey: 'BEDROOM_3', groupTitle: 'Dormitorio 3' };
  if (code.startsWith('ELECTRICAL_')) return { groupKey: 'ELECTRICAL', groupTitle: 'Electricidad' };
  return { groupKey: 'OTHER', groupTitle: 'Otros' };
}

function buildInstruction({ indicaciones, donde, que }) {
  return [
    `Indicaciones:`,
    `Dónde sacar la foto: ${donde}`,
    `Qué buscar: ${que}`
  ].join('\n');
}

function buildPhotoPlanV1(input) {
  const plan = [];
  const bathCount = Math.max(1, Number(input.bathroomsCount || 1));
  const bedCount = Math.max(0, Number(input.bedroomsCount || 0));

  for (let i = 1; i <= Math.min(bathCount, 2); i++) {
    const label = i === 1 ? 'Baño principal' : 'Baño secundario';
    plan.push(
      { slotCode: `BATHROOM_${i}_SHOWER`, title: `${label} – Interior tina / ducha`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Zona de ducha/tina y muro cercano.',
        que: 'Sellos, juntas, humedad o manchas alrededor de la tina/ducha.'
      }), required: true },
      { slotCode: `BATHROOM_${i}_SINK`, title: `${label} – Lavamanos`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Lavamanos y cubierta, vista frontal.',
        que: 'Grifería, sellos, manchas en cubierta.'
      }), required: true },
      { slotCode: `BATHROOM_${i}_SINK_PIPES`, title: `${label} – Cañerías lavamanos`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Bajo lavamanos mostrando sifón y conexiones.',
        que: 'Fugas, óxido, humedad en sifón y conexiones.'
      }), required: true },
      { slotCode: `BATHROOM_${i}_WC`, title: `${label} – WC`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'WC y base, vista frontal.',
        que: 'Base, sellos y manchas alrededor del WC.'
      }), required: true },
      { slotCode: `BATHROOM_${i}_WC_PIPES`, title: `${label} – Cañerías WC`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Conexión de agua y base del WC.',
        que: 'Conexión de agua y posibles fugas.'
      }), required: true },
      { slotCode: `BATHROOM_${i}_CEILING`, title: `${label} – Cielo`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Cielo del baño con buena iluminación.',
        que: 'Humedad, moho o manchas en cielo.'
      }), required: true },
      { slotCode: `BATHROOM_${i}_OUTLETS`, title: `${label} – Enchufes`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Enchufes y entorno cercano.',
        que: 'Estado de enchufes/placas y fijación.'
      }), required: true }
    );
  }

  plan.push(
    { slotCode: 'KITCHEN_UNDER_SINK', title: 'Cocina – Bajo lavaplatos', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Bajo lavaplatos mostrando conexiones y sifón.',
      que: 'Fugas, humedad y estado de conexiones.'
    }), required: true },
    { slotCode: 'KITCHEN_SINK_WALL', title: 'Cocina – Muro lavaplatos', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Muro/encuentro lavaplatos.',
      que: 'Manchas, sellos o humedad en muro.'
    }), required: true },
    { slotCode: 'KITCHEN_OUTLETS', title: 'Cocina – Enchufes', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Enchufes y entorno.',
      que: 'Estado de enchufes/placas.'
    }), required: true },
    { slotCode: 'KITCHEN_WINDOW', title: 'Cocina – Ventana', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Ventana completa, marcos y sello.',
      que: 'Sellos, marcos y humedad en ventana.'
    }), required: true }
  );

  plan.push(
    { slotCode: 'LIVING_WALLS', title: 'Living – Muros', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Muros del living con pintura visible.',
      que: 'Pintura, fisuras o manchas.'
    }), required: true },
    { slotCode: 'LIVING_CEILING', title: 'Living – Cielo', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Cielo del living y terminaciones.',
      que: 'Terminaciones y humedad en cielo.'
    }), required: true },
    { slotCode: 'LIVING_FLOOR', title: 'Living – Piso', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Piso del living, terminaciones visibles.',
      que: 'Estado de piso/terminación.'
    }), required: true },
    { slotCode: 'LIVING_WINDOWS', title: 'Living – Ventanas', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Ventanas completas, marcos y sello.',
      que: 'Sellos, marcos o filtraciones.'
    }), required: true },
    { slotCode: 'LIVING_SWITCHES', title: 'Living – Interruptores', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Interruptores y placas.',
      que: 'Estado de interruptores/placas.'
    }), required: true }
  );

  for (let i = 1; i <= Math.min(bedCount, 3); i++) {
    plan.push(
      { slotCode: `BEDROOM_${i}_WALLS`, title: `Dormitorio ${i} – Muros`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Muros del dormitorio con pintura visible.',
        que: 'Pintura, fisuras o manchas.'
      }), required: true },
      { slotCode: `BEDROOM_${i}_FLOOR`, title: `Dormitorio ${i} – Piso`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Piso del dormitorio, terminaciones visibles.',
        que: 'Estado de piso/terminación.'
      }), required: true },
      { slotCode: `BEDROOM_${i}_WINDOWS`, title: `Dormitorio ${i} – Ventanas`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Ventanas completas, marcos y sello.',
        que: 'Sellos, marcos o filtraciones.'
      }), required: true }
    );
  }

  if (input.hasLaundry) {
    plan.push(
      { slotCode: 'LAUNDRY_WALLS_FLOOR', title: 'Loggia – Muros y piso', instructions: buildInstruction({
        indicaciones: '',
        donde: 'Muros y piso de la loggia.',
        que: 'Humedad, fisuras o daños.'
      }), required: true }
    );
  }

  plan.push({ slotCode: 'ELECTRICAL_PANEL', title: 'Tablero eléctrico', instructions: buildInstruction({
    indicaciones: '',
    donde: 'Tablero frontal, sin manipular.',
    que: 'Estado visual del tablero.'
  }), required: true });

  return plan.map((slot) => ({
    ...slot,
    kpiKey: classifyKpiFromSlot(slot)
  }));
}

async function queueOpenAiSlotAnalysis() {
  // Placeholder - async OpenAI not enabled in local.
}

fastify.register(multipart, {
  limits: { fileSize: 8 * 1024 * 1024 }
});
fastify.register(cookie);
fastify.register(staticPlugin, {
  root: path.join(__dirname, 'public'),
  prefix: '/'
});

fastify.get('/', (req, reply) => reply.sendFile('index.html'));
fastify.get('/formulario', (req, reply) => reply.sendFile('formulario.html'));
fastify.get('/dashboard', (req, reply) => reply.sendFile('dashboard.html'));
fastify.get('/cases/:caseId/report', (req, reply) => reply.sendFile('report.html'));
fastify.get('/admin', (req, reply) => reply.sendFile('admin.html'));
fastify.get('/activate', (req, reply) => reply.sendFile('activate.html'));
fastify.get('/install', (req, reply) => reply.redirect('/executive'));
fastify.get('/tenant', (req, reply) => reply.sendFile('tenant.html'));
fastify.get('/executive', (req, reply) => reply.sendFile('executive.html'));

fastify.get('/api/admin/score-config', (req, reply) => {
  return reply.send({ ok: true, config: scoreConfig });
});

fastify.post('/api/admin/score-config', async (req, reply) => {
  const payload = req.body || {};
  const incoming = payload.config ?? payload;
  scoreConfig = saveScoreConfig(incoming);
  return reply.send({ ok: true, config: scoreConfig });
});

fastify.get('/api/admin/tenants', async (req, reply) => {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' }
  });
  const rows = tenants.map((t) => ({
    id: t.id,
    name: t.name,
    legalName: t.legalName,
    rut: t.rut,
    email: t.email,
    phone: t.phone,
    status: t.status,
    createdAt: t.createdAt,
    passwordSet: !!t.passwordHash
  }));
  return reply.send({ ok: true, tenants: rows });
});

fastify.post('/api/admin/tenants', async (req, reply) => {
  const payload = req.body || {};
  const name = String(payload.name || '').trim();
  if (!name) return reply.code(400).send({ ok: false, error: 'NAME_REQUIRED' });
  const rut = normalizeRut(payload.rut);
  const passwordRaw = String(payload.password || '').trim();
  if (passwordRaw && passwordRaw.length < 6) {
    return reply.code(400).send({ ok: false, error: 'PASSWORD_TOO_SHORT' });
  }
  const tenant = await prisma.tenant.create({
    data: {
      name,
      legalName: payload.legalName ? String(payload.legalName).trim() : null,
      rut: rut || null,
      passwordHash: passwordRaw ? hashPassword(passwordRaw) : null,
      email: payload.email ? String(payload.email).trim() : null,
      phone: payload.phone ? String(payload.phone).trim() : null,
      status: 'ACTIVE'
    }
  });
  return reply.send({ ok: true, tenant });
});

fastify.put('/api/admin/tenants/:tenantId', async (req, reply) => {
  const tenantId = String(req.params.tenantId || '');
  const payload = req.body || {};
  const rut = payload.rut !== undefined ? normalizeRut(payload.rut) : undefined;
  const passwordRaw = String(payload.password || '').trim();
  if (passwordRaw && passwordRaw.length < 6) {
    return reply.code(400).send({ ok: false, error: 'PASSWORD_TOO_SHORT' });
  }
  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      name: payload.name ? String(payload.name).trim() : undefined,
      legalName: payload.legalName !== undefined ? (payload.legalName ? String(payload.legalName).trim() : null) : undefined,
      rut: rut !== undefined ? (rut || null) : undefined,
      passwordHash: passwordRaw ? hashPassword(passwordRaw) : undefined,
      email: payload.email !== undefined ? (payload.email ? String(payload.email).trim() : null) : undefined,
      phone: payload.phone !== undefined ? (payload.phone ? String(payload.phone).trim() : null) : undefined,
      status: payload.status ? String(payload.status) : undefined
    }
  });
  return reply.send({ ok: true, tenant });
});

fastify.get('/api/admin/tenants/:tenantId/users', async (req, reply) => {
  const tenantId = String(req.params.tenantId || '');
  const users = await prisma.user.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' }
  });
  return reply.send({ ok: true, users });
});

fastify.post('/api/admin/tenants/:tenantId/users', async (req, reply) => {
  const tenantId = String(req.params.tenantId || '');
  const payload = req.body || {};
  const email = String(payload.email || '').trim().toLowerCase();
  const fullName = String(payload.fullName || '').trim();
  const phone = payload.phone ? String(payload.phone).trim() : null;
  const role = payload.role ? String(payload.role).toUpperCase() : 'TENANT_USER';
  const action = payload.action ? String(payload.action).toLowerCase() : 'invite';

  if (!email || !fullName) {
    return reply.code(400).send({ ok: false, error: 'EMAIL_AND_NAME_REQUIRED' });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.tenantId && existing.tenantId !== tenantId) {
    return reply.code(409).send({ ok: false, error: 'EMAIL_ALREADY_IN_USE' });
  }

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          fullName,
          phone,
          role
        }
      })
    : await prisma.user.create({
        data: {
          tenantId,
          email,
          fullName,
          phone,
          role,
          status: 'PENDING',
          invitedAt: action === 'invite' ? new Date() : null
        }
      });

  if (action === 'invite') {
    const { activationUrl } = await createActivationForUser({ prismaClient: prisma, userId: user.id });
    await prisma.user.update({
      where: { id: user.id },
      data: { invitedAt: new Date(), status: 'PENDING' }
    });
    return reply.send({ ok: true, user, activationUrl });
  }

  return reply.send({ ok: true, user });
});

fastify.post('/api/admin/users/:userId/invite', async (req, reply) => {
  const userId = String(req.params.userId || '');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  await prisma.activationToken.create({
    data: {
      userId: user.id,
      token,
      expiresAt
    }
  });

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { invitedAt: new Date(), status: 'PENDING' }
  });

  const activationUrl = `/activate?token=${encodeURIComponent(token)}`;
  return reply.send({ ok: true, user: updated, activationUrl });
});

fastify.post('/api/tenant/login', async (req, reply) => {
  const payload = req.body || {};
  const rutRaw = String(payload.rut || '').trim();
  const rut = normalizeRut(rutRaw);
  const password = String(payload.password || '');
  if (!rut || !password) return reply.code(400).send({ ok: false, error: 'RUT_AND_PASSWORD_REQUIRED' });

  const tenant = await prisma.tenant.findFirst({
    where: {
      status: 'ACTIVE',
      OR: [
        { rut },
        { rut: rutRaw }
      ]
    }
  });
  if (!tenant) {
    return reply.code(401).send({ ok: false, error: 'INVALID_CREDENTIALS' });
  }
  if (!tenant.passwordHash) {
    return reply.code(401).send({ ok: false, error: 'PASSWORD_NOT_SET' });
  }
  if (!verifyPassword(password, tenant.passwordHash)) {
    return reply.code(401).send({ ok: false, error: 'INVALID_CREDENTIALS' });
  }

  const token = createTenantSession(tenant.id);
  reply.setCookie(TENANT_SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax'
  });
  return reply.send({ ok: true, tenant: { id: tenant.id, name: tenant.name } });
});

fastify.post('/api/tenant/logout', async (req, reply) => {
  const token = req.cookies?.[TENANT_SESSION_COOKIE];
  if (token) tenantSessions.delete(token);
  reply.clearCookie(TENANT_SESSION_COOKIE, { path: '/' });
  return reply.send({ ok: true });
});

fastify.get('/api/tenant/me', async (req, reply) => {
  const session = getTenantSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
  if (!tenant) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  return reply.send({
    ok: true,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      legalName: tenant.legalName,
      rut: tenant.rut,
      email: tenant.email,
      phone: tenant.phone
    }
  });
});

fastify.get('/api/tenant/users', async (req, reply) => {
  const session = getTenantSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const users = await prisma.user.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { createdAt: 'desc' }
  });
  return reply.send({ ok: true, users });
});

fastify.post('/api/tenant/users', async (req, reply) => {
  const session = getTenantSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const payload = req.body || {};
  const email = String(payload.email || '').trim().toLowerCase();
  const fullName = String(payload.fullName || '').trim();
  const phone = payload.phone ? String(payload.phone).trim() : null;
  const role = payload.role ? String(payload.role).toUpperCase() : 'TENANT_USER';
  const action = payload.action ? String(payload.action).toLowerCase() : 'invite';

  if (!email || !fullName) {
    return reply.code(400).send({ ok: false, error: 'EMAIL_AND_NAME_REQUIRED' });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.tenantId && existing.tenantId !== session.tenantId) {
    return reply.code(409).send({ ok: false, error: 'EMAIL_ALREADY_IN_USE' });
  }

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          fullName,
          phone,
          role
        }
      })
    : await prisma.user.create({
        data: {
          tenantId: session.tenantId,
          email,
          fullName,
          phone,
          role,
          status: 'PENDING',
          invitedAt: action === 'invite' ? new Date() : null
        }
      });

  if (action === 'invite') {
    const { activationUrl } = await createActivationForUser({ prismaClient: prisma, userId: user.id });
    await prisma.user.update({
      where: { id: user.id },
      data: { invitedAt: new Date(), status: 'PENDING' }
    });
    return reply.send({ ok: true, user, activationUrl });
  }

  return reply.send({ ok: true, user });
});

fastify.post('/api/tenant/users/:userId/invite', async (req, reply) => {
  const session = getTenantSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const userId = String(req.params.userId || '');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.tenantId !== session.tenantId) {
    return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  await prisma.activationToken.create({
    data: {
      userId: user.id,
      token,
      expiresAt
    }
  });

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { invitedAt: new Date(), status: 'PENDING' }
  });

  const activationUrl = `/activate?token=${encodeURIComponent(token)}`;
  return reply.send({ ok: true, user: updated, activationUrl });
});

fastify.put('/api/tenant/users/:userId', async (req, reply) => {
  const session = getTenantSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const userId = String(req.params.userId || '');
  const payload = req.body || {};
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.tenantId !== session.tenantId) {
    return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });
  }

  const data = {
    fullName: payload.fullName ? String(payload.fullName).trim() : undefined,
    phone: payload.phone !== undefined ? (payload.phone ? String(payload.phone).trim() : null) : undefined,
    role: payload.role ? String(payload.role).toUpperCase() : undefined,
    status: payload.status ? String(payload.status).toUpperCase() : undefined
  };

  const updated = await prisma.user.update({ where: { id: user.id }, data });
  return reply.send({ ok: true, user: updated });
});

fastify.delete('/api/tenant/users/:userId', async (req, reply) => {
  const session = getTenantSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const userId = String(req.params.userId || '');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.tenantId !== session.tenantId) {
    return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });
  }
  await prisma.user.delete({ where: { id: user.id } });
  return reply.send({ ok: true });
});

fastify.post('/api/tenant/inspections', async (req, reply) => {
  const session = getTenantSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const payload = req.body || {};
  const tenantId = session.tenantId;
  const bathroomsCount = Number(payload.bathroomsCount || payload.bathrooms || 1);
  const bedroomsCount = Number(payload.bedroomsCount || payload.bedrooms || 1);
  const bedrooms = Number(payload.bedrooms || bedroomsCount || 0);
  const bathrooms = Number(payload.bathrooms || bathroomsCount || 1);
  const assignedUserId = payload.assignedUserId ? String(payload.assignedUserId) : null;

  if (assignedUserId) {
    const user = await prisma.user.findUnique({ where: { id: assignedUserId } });
    if (!user || user.tenantId !== tenantId) {
      return reply.code(400).send({ ok: false, error: 'ASSIGNED_USER_INVALID' });
    }
  }

  const planSlots = buildPhotoPlanV1({
    ...payload,
    bathroomsCount,
    bedroomsCount
  });

  const token = crypto.randomUUID();
  const captureExpires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

  const result = await prisma.$transaction(async (tx) => {
    let ownerId = null;
    if (payload.ownerRut) {
      const existing = await tx.owner.findUnique({ where: { rut: payload.ownerRut } });
      if (existing) ownerId = existing.id;
      if (!ownerId && payload.ownerName) {
        const created = await tx.owner.create({ data: { fullName: payload.ownerName, rut: payload.ownerRut, tenantId } });
        ownerId = created.id;
      }
    } else if (payload.ownerName) {
      const created = await tx.owner.create({ data: { fullName: payload.ownerName, tenantId } });
      ownerId = created.id;
    }

    const property = await tx.property.create({
      data: {
        tenantId,
        ownerId,
        rol: payload.propertyRol || null,
        address: payload.propertyAddress || null,
        operationType: payload.propertyOperationType || null,
        surface: payload.propertySurface || null
      }
    });

    const c = await tx.case.create({
      data: {
        tenant: tenantId ? { connect: { id: tenantId } } : undefined,
        assignedUser: assignedUserId ? { connect: { id: assignedUserId } } : undefined,
        property: { connect: { id: property.id } },
        propertyType: payload.propertyType || 'DEPARTMENT',
        bathroomsCount,
        bedroomsCount,
        propertyAgeRange: payload.propertyAgeRange || null,
        bedrooms,
        bathrooms,
        yearBuilt: payload.yearBuilt || null,
        floorType: payload.floorType || 'CONCRETE',
        hasPatio: !!payload.hasPatio,
        hasAttic: !!payload.hasAttic,
        hasLaundry: !!payload.hasLaundry,
        planVersion: 'v1',
        status: 'DRAFT'
      }
    });

    const slots = await tx.slot.createMany({
      data: planSlots.map((s, idx) => ({
        tenantId,
        caseId: c.id,
        slotCode: s.slotCode,
        title: s.title,
        instructions: s.instructions,
        required: s.required ?? true,
        orderIndex: idx + 1,
        status: 'PENDING'
      }))
    });

    await tx.captureToken.create({
      data: {
        tenantId,
        caseId: c.id,
        token,
        expiresAt: captureExpires
      }
    });

    return { caseId: c.id, slotsCreated: slots.count };
  });

  const captureUrl = `/capture/${token}`;
  const reportUrl = `/cases/${encodeURIComponent(result.caseId)}/report`;

  return reply.send({
    ok: true,
    caseId: result.caseId,
    tenantId,
    captureUrl,
    reportUrl,
    slots: planSlots
  });
});

fastify.post('/api/executive/login', async (req, reply) => {
  const payload = req.body || {};
  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (!email || !password) return reply.code(400).send({ ok: false, error: 'EMAIL_AND_PASSWORD_REQUIRED' });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE') {
    return reply.code(401).send({ ok: false, error: 'INVALID_CREDENTIALS' });
  }
  if (!verifyPassword(password, user.passwordHash)) {
    return reply.code(401).send({ ok: false, error: 'INVALID_CREDENTIALS' });
  }

  const token = createExecSession(user.id, user.tenantId || null);
  reply.setCookie(EXEC_SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax'
  });
  return reply.send({ ok: true, user: { id: user.id, fullName: user.fullName, role: user.role } });
});

fastify.post('/api/executive/logout', async (req, reply) => {
  const token = req.cookies?.[EXEC_SESSION_COOKIE];
  if (token) execSessions.delete(token);
  reply.clearCookie(EXEC_SESSION_COOKIE, { path: '/' });
  return reply.send({ ok: true });
});

fastify.get('/api/executive/me', async (req, reply) => {
  const session = getExecSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  return reply.send({
    ok: true,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId
    }
  });
});

fastify.get('/api/executive/cases', async (req, reply) => {
  const session = getExecSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const cases = await prisma.case.findMany({
    where: { assignedUserId: session.userId },
    orderBy: { createdAt: 'desc' },
    include: {
      property: true,
      slots: { include: { photo: true } },
      captureTokens: { orderBy: { createdAt: 'desc' } }
    }
  });

  const rows = cases.map((c) => {
    const slots = c.slots || [];
    const progress = computeProgressFromSlots(slots);
    const captureToken = c.captureTokens?.[0]?.token || null;
    const captureUrl = captureToken ? `/capture/${captureToken}` : null;
    return {
      id: c.id,
      createdAt: c.createdAt,
      propertyType: c.propertyType,
      bedrooms: c.bedrooms,
      bathrooms: c.bathrooms,
      address: c.property?.address || null,
      progress,
      captureUrl
    };
  });

  return reply.send({ ok: true, cases: rows });
});

fastify.post('/api/onboarding/activate', async (req, reply) => {
  const payload = req.body || {};
  const token = String(payload.token || '').trim();
  const password = String(payload.password || '').trim();
  if (!token) return reply.code(400).send({ ok: false, error: 'TOKEN_REQUIRED' });
  if (!password) return reply.code(400).send({ ok: false, error: 'PASSWORD_REQUIRED' });

  const row = await prisma.activationToken.findUnique({ where: { token } });
  if (!row || row.usedAt) return reply.code(400).send({ ok: false, error: 'INVALID_TOKEN' });
  if (new Date(row.expiresAt).getTime() <= Date.now()) return reply.code(400).send({ ok: false, error: 'TOKEN_EXPIRED' });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { status: 'ACTIVE', activatedAt: new Date(), passwordHash: hashPassword(password) }
    }),
    prisma.activationToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() }
    })
  ]);

  return reply.send({ ok: true });
});

await registerCaptureRoutes(fastify, {
  prisma,
  storage,
  safeExtFromMime,
  analyzeImageBufferV1,
  slotGroupFromSlotCode,
  queueOpenAiSlotAnalysis
});

fastify.post('/api/cases', async (req, reply) => {
  if (!prisma) return reply.code(500).send({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });

  const payload = req.body || {};
  const tenantId = payload.tenantId || getTenantIdFromReq(req);
  const bathroomsCount = Number(payload.bathroomsCount || payload.bathrooms || 1);
  const bedroomsCount = Number(payload.bedroomsCount || payload.bedrooms || 1);
  const bedrooms = Number(payload.bedrooms || bedroomsCount || 0);
  const bathrooms = Number(payload.bathrooms || bathroomsCount || 1);

  if (tenantId) {
    const tenantExists = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenantExists) {
      return reply.code(400).send({ ok: false, error: 'TENANT_NOT_FOUND' });
    }
  }
  const assignedUserId = payload.assignedUserId ? String(payload.assignedUserId) : null;
  if (assignedUserId && tenantId) {
    const user = await prisma.user.findUnique({ where: { id: assignedUserId } });
    if (!user || user.tenantId !== tenantId) {
      return reply.code(400).send({ ok: false, error: 'ASSIGNED_USER_INVALID' });
    }
  }

  const planSlots = buildPhotoPlanV1({
    ...payload,
    bathroomsCount,
    bedroomsCount
  });

  const token = crypto.randomUUID();
  const captureExpires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

  const result = await prisma.$transaction(async (tx) => {
    let ownerId = null;
    if (payload.ownerRut) {
      const existing = await tx.owner.findUnique({ where: { rut: payload.ownerRut } });
      if (existing) ownerId = existing.id;
      if (!ownerId && payload.ownerName) {
        const created = await tx.owner.create({ data: { fullName: payload.ownerName, rut: payload.ownerRut } });
        ownerId = created.id;
      }
    } else if (payload.ownerName) {
      const created = await tx.owner.create({ data: { fullName: payload.ownerName } });
      ownerId = created.id;
    }

      const property = await tx.property.create({
      data: {
          tenantId: tenantId || null,
        ownerId,
        rol: payload.propertyRol || null,
        address: payload.propertyAddress || null,
        operationType: payload.propertyOperationType || null,
        surface: payload.propertySurface || null
      }
    });

    const c = await tx.case.create({
      data: {
        tenant: tenantId ? { connect: { id: tenantId } } : undefined,
        assignedUser: assignedUserId ? { connect: { id: assignedUserId } } : undefined,
        property: { connect: { id: property.id } },
        propertyType: payload.propertyType || 'DEPARTMENT',
        bathroomsCount,
        bedroomsCount,
        propertyAgeRange: payload.propertyAgeRange || null,
        bedrooms,
        bathrooms,
        yearBuilt: payload.yearBuilt || null,
        floorType: payload.floorType || 'CONCRETE',
        hasPatio: !!payload.hasPatio,
        hasAttic: !!payload.hasAttic,
        hasLaundry: !!payload.hasLaundry,
        planVersion: 'v1',
        status: 'DRAFT'
      }
    });

      const slots = await tx.slot.createMany({
      data: planSlots.map((s, idx) => ({
          tenantId: tenantId || null,
        caseId: c.id,
        slotCode: s.slotCode,
        title: s.title,
        instructions: s.instructions,
        required: s.required ?? true,
        orderIndex: idx + 1,
        status: 'PENDING'
      }))
    });

      await tx.captureToken.create({
      data: {
          tenantId: tenantId || null,
        caseId: c.id,
        token,
        expiresAt: captureExpires
      }
    });

    return { caseId: c.id, slotsCreated: slots.count };
  });

  const captureUrl = `/capture/${token}`;
  const reportUrl = `/cases/${encodeURIComponent(result.caseId)}/report`;

  return reply.send({
    ok: true,
    caseId: result.caseId,
    tenantId: tenantId || null,
    captureUrl,
    reportUrl,
    slots: planSlots
  });
});

fastify.get('/api/cases', async (req, reply) => {
  const tenantId = getTenantIdFromReq(req);
  const cases = await prisma.case.findMany({
    where: tenantId ? { tenantId } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      property: true,
      slots: { include: { photo: true } },
      captureTokens: { orderBy: { createdAt: 'desc' } }
    }
  });

  const rows = cases.map((c) => {
    const slots = c.slots || [];
    const uploaded = slots.filter(s => ['UPLOADED', 'ANALYZED', 'REJECTED'].includes(String(s.status || '').toUpperCase())).length;
    const analyzed = slots.filter(s => String(s.status || '').toUpperCase() === 'ANALYZED').length;
    const rejected = slots.filter(s => String(s.status || '').toUpperCase() === 'REJECTED').length;
    const total = slots.length;
    const pct = total ? Math.round((uploaded / total) * 100) : 0;
    const captureToken = c.captureTokens?.[0]?.token || null;
    const captureUrl = captureToken ? `/capture/${captureToken}` : null;
    const firstPhoto = slots.find(s => s.photo?.filePath)?.photo?.filePath || null;

    return {
      id: c.id,
      createdAt: c.createdAt,
      propertyType: c.propertyType,
      bedrooms: c.bedrooms,
      bathrooms: c.bathrooms,
      progress: { uploaded, analyzed, rejected, total, pct },
      captureUrl,
      firstPhotoUrl: firstPhoto ? storage.publicUrl(firstPhoto) : null
    };
  });

  return reply.send({ ok: true, cases: rows });
});

fastify.get('/api/cases/:caseId/summary', async (req, reply) => {
  const caseId = String(req.params.caseId || '');
  const tenantId = getTenantIdFromReq(req);
  const summary = await getCaseSummary({ prisma, storage, caseId, slotGroupTitleFromCode, scoreConfig, tenantId });
  if (!summary.ok) return reply.code(404).send(summary);
  return reply.send(summary);
});

fastify.listen({ port: PORT, host: '0.0.0.0' });
