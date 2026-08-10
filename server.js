import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import cookie from '@fastify/cookie';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import path from 'node:path';
import fs from 'node:fs';
import OpenAI from 'openai';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';

import { createStorage } from './src/storage/storage.js';
import { deleteAinspeccionaCase } from './src/admin/deleteWithKbCleanup.js';
import { registerCaptureRoutes } from './src/routes/capture.js';
import { registerWhatsAppRoutes } from './src/routes/whatsapp.js';
import { registerPostventaAgentRoutes } from './src/postventa/routes/agent.js';
import { registerPostventaPublicRoutes } from './src/postventa/routes/public.js';
import { registerPostventaCaptureRoutes } from './src/postventa/routes/capture.js';
import { registerPostventaTicketRoutes } from './src/postventa/routes/tickets.js';
import { registerPostventaAdminRoutes } from './src/postventa/routes/admin.js';
import { registerPostventaPortalRoutes } from './src/postventa/routes/portal.js';
import { getPvPortalSession as getPvPortalSessionAuth } from './src/postventa/auth/portalAuth.js';
import { registerAintelligenceAdminRoutes } from './src/aintelligence/routes/admin.js';
import { registerTaxonomyAdminRoutes } from './src/aintelligence/routes/taxonomyAdmin.js';
import { registerEntregaRoutes } from './src/entrega/routes.js';
import { getEntregaSession as getEntregaSessionAuth } from './src/entrega/auth.js';
import { registerInOutRoutes, getIoSession as getIoSessionAuth } from './src/inout/routes.js';
import { ensureToctocTenants } from './src/demo/ensureToctocTenants.js';
import { registerScanRoutes } from './src/scan/routes.js';
import { registerPlatformRoutes } from './src/platform/routes.js';
import { ensurePlatformSchema } from './src/platform/ensurePlatformSchema.js';
import { ensurePlatformDemo } from './src/platform/seed/ensurePlatformDemo.js';
import { registerReviewCenterRoutes } from './src/routes/reviewCenter.js';
import { registerReviewAssistantRoutes } from './src/routes/reviewAssistant.js';
import { createPostventaAnalysisQueue } from './src/postventa/analysis/analyzeTicket.js';
import {
  clampDays,
  queryFunnelBusiness,
  queryInspectionsDaily,
  queryInspectionsHeatmap,
  queryInspectionAddresses,
  aggregateGeo
} from './src/admin/dashboardAnalytics.js';
import { queryAnalysisAccuracyDaily, recordReportCorrection, recordReportAccuracyOnComplete, recordPropertyCheckAccuracyOnAnalyze } from './src/aintelligence/metrics/analysisAccuracy.js';
import { getCaseSummary } from './src/routes/caseSummary.js';
import { ensureExecutiveSummary, isExecutiveSummaryStale } from './src/routes/executiveSummary.js';
import { generateReportPdf } from './src/pdf/reportPdf.js';
import { generateCertificateImage } from './src/pdf/certificateImage.js';
import { DEFAULT_SCORE_CONFIG, normalizeScoreConfig, classifyKpiFromSlot, formatAiFindingExamplesBlock } from './src/scoring/scoringV2_2.js';
import { getKbPromptBlock } from './src/aintelligence/kb/promptBlock.js';
import {
  sendInspectionLinkEmail,
  sendBusinessMagicLinkEmail,
  sendPasswordResetEmail,
  sendReviewNotificationEmail,
  sendBusinessReportReviewerNotificationEmail,
  sendExecutiveReportReadyEmail,
  sendApprovedReportEmail,
  sendExecutiveInvitationEmail,
  sendExecutiveCaptureInviteEmail,
  sendPeerReferralWelcomeEmail,
  sendSimplefacturaDtePdfEmail,
  sendContactFormEmail
} from './src/email.js';
import { generateBusinessReceiptPdf } from './src/pdf/receiptPdf.js';
import { emitBoletaElectronica, fetchDtePdfBuffer, isSimpleFacturaConfigured } from './src/simplefactura.js';
import { runPropertyCheckPhotoBatchAnalysisV0 } from './src/propertyCheck/propertyCheckAnalyzeV0.js';
import { generatePropertyCheckExecutiveSummaryV0 } from './src/propertyCheck/propertyCheckExecutiveSummaryV0.js';
import {
  verifyPropertyCheckIngressSecret,
  handlePropertyCheckFeedbackV0,
  handlePropertyCheckFeedbackBatchV0
} from './src/propertyCheck/propertyCheckFeedbackV0.js';
import {
  combinedTextHasAffirmativeDefectMention,
  windowAnalysisSuggestsSealIssue,
  pisosAnalysisSuggestsJointMoistureDamage
} from './src/analysis/defectMentionFromText.js';
import {
  electricAnalysisPromptPreamble,
  correctWallElectricMatchesSlotFalsePositive,
  electricPanelInferiorWearLikelyDirtOnly,
  wallSwitchAvCoaxialFalsePositive,
  scrubWallSwitchAvFalsePositiveNarrative,
  scrubElectricPanelInferiorDirtNarrative
} from './src/analysis/electricSlotAnalysis.js';
import {
  isDocumentComplianceSlot,
  documentAnalysisPromptPreamble,
  applyDocumentComplianceAnalysisRules
} from './src/analysis/documentSlotAnalysis.js';

const DEFAULT_EXECUTIVE_APP_STORE_URL =
  'https://apps.apple.com/cl/app/ainspecciona-capture/id6763187024';

// Cloud Run + Cloud SQL: normalizar DATABASE_URL para usar socket Unix (no TCP).
// Formato correcto: mysql://USER:PASS@localhost/DB?socket=/cloudsql/PROJECT:REGION:INSTANCE
if (process.env.K_SERVICE && process.env.DATABASE_URL) {
  let url = process.env.DATABASE_URL;
  if (url.includes('socket=') && url.includes('/cloudsql/')) {
    url = url.replace(/@([^/]+):3306\//, '@localhost/');
    url = url.replace(/@127\.0\.0\.1\//, '@localhost/');
    if (!url.includes('connect_timeout')) {
      url += (url.includes('?') ? '&' : '?') + 'connect_timeout=30';
    }
    process.env.DATABASE_URL = url;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
  logger: true,
  // Fotos de cierre (base64) y adjuntos; default Fastify es 1MB → "Request body is too large"
  bodyLimit: 5 * 1024 * 1024,
  trustProxy: process.env.NODE_ENV === 'production' || !!process.env.TRUST_PROXY
});
const prisma = new PrismaClient();
const storage = createStorage();

const CORS_ALLOWED_ORIGINS = new Set([
  'http://localhost:8081',
  'http://localhost:19006',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:19006',
  // PropScan (Vite preview)
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://ainspecciona.com',
  'https://www.ainspecciona.com',
  'https://ainspecciona.web.app',
  // PropScan / Property-check (Firebase Hosting)
  'https://property-chk.web.app',
  'https://property-chk.firebaseapp.com'
]);

/** Vite elige 5173, 5174, … si el anterior está ocupado: en local aceptamos cualquier puerto. */
function isLocalDevBrowserOrigin(origin) {
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const u = new URL(origin);
    const host = u.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') return false;
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

await fastify.register(cors, {
  origin(origin, cb) {
    if (!origin || CORS_ALLOWED_ORIGINS.has(origin)) {
      cb(null, true);
      return;
    }
    if (isLocalDevBrowserOrigin(origin)) {
      cb(null, true);
      return;
    }
    cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-session-token',
    'x-platform-session',
    'x-postventa-session',
    'x-entrega-session',
    'x-admin-user',
    'x-admin-pass',
    'x-propertycheck-secret',
    'x-postventa-agent-secret',
    'x-inout-session',
    'X-WhatsApp-Test-Secret'
  ]
});

// Raw body para verificación X-Hub-Signature-256 del webhook WhatsApp (Cloud API / 360dialog)
fastify.addHook('preParsing', async (request, reply, payload) => {
  const url = request.url.split('?')[0];
  if (url !== '/api/whatsapp/webhook' || request.method !== 'POST') {
    return payload;
  }
  const chunks = [];
  for await (const chunk of payload) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  request.rawBody = raw;
  return Readable.from(raw);
});

const PORT = Number(process.env.PORT || 3000);

const DATA_DIR = path.join(__dirname, 'data');
const SCORE_CONFIG_PATH = path.join(DATA_DIR, 'score-config.json');
const APP_SETTING_SCORE_KEY = 'score_config';

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
const scoreConfigRuntimeCache = {
  config: scoreConfig,
  updatedAt: null,
  fetchedAt: 0
};

const PRESENCIAL_ORDER_STATUSES = ['PENDING_OC', 'SENT_TO_SUPPLIER', 'CONFIRMED', 'CANCELLED'];

/** Proveedor por defecto para emitir OC (Paulo Inspecciona u otro marcado en Admin). */
async function getDefaultPresencialSupplier() {
  const envEmail = String(process.env.PRESENCIAL_SUPPLIER_EMAIL || '').trim() || null;
  let s = await prisma.supplier.findFirst({
    where: {
      OR: [{ isDefaultPresencial: true }, { code: 'paulo-inspecciona' }]
    },
    orderBy: [{ isDefaultPresencial: 'desc' }, { createdAt: 'asc' }]
  });
  if (!s) {
    s = await prisma.supplier.create({
      data: {
        code: 'paulo-inspecciona',
        name: 'Paulo Inspecciona',
        legalName: 'Paulo Inspecciona',
        contactName: 'Paulo Yañez',
        email: envEmail,
        notes: 'Creado automáticamente al primer pago presencial.',
        active: true,
        isDefaultPresencial: true
      }
    });
    return s;
  }
  return s;
}

/** Registra orden de inspección presencial tras pago aprobado (idempotente por MP payment id). */
async function createPresencialOrderFromPayment({ tenantId, extRef, paymentIdStr, payment, log }) {
  const existing = await prisma.presencialOrder.findUnique({ where: { mercadopagoPaymentId: paymentIdStr } });
  if (existing) return { ok: true, skipped: true, order: existing };
  const caseIdMatch = extRef.match(/caseId:([a-f0-9-]+)/i);
  const caseId = caseIdMatch?.[1] || null;
  let addressSnapshot = null;
  let surfaceM2 = null;
  let validCaseId = null;
  if (caseId) {
    const c = await prisma.case.findUnique({
      where: { id: caseId },
      include: { property: true }
    });
    if (c && c.tenantId === tenantId) {
      validCaseId = caseId;
      addressSnapshot = c.property?.address || null;
      const surf = c.property?.surface;
      if (surf) {
        const n = parseInt(String(surf).replace(/\D/g, ''), 10);
        if (!Number.isNaN(n) && n > 0) surfaceM2 = n;
      }
    }
  }
  const amt =
    payment?.transaction_details?.total_paid_amount ??
    payment?.transaction_amount ??
    null;
  const supplier = await getDefaultPresencialSupplier();
  const order = await prisma.presencialOrder.create({
    data: {
      tenantId,
      caseId: validCaseId,
      supplierId: supplier.id,
      mercadopagoPaymentId: paymentIdStr,
      amountClp: typeof amt === 'number' && amt > 0 ? Math.round(amt) : null,
      surfaceM2,
      addressSnapshot,
      status: 'PENDING_OC'
    }
  });
  log?.info?.({ tenantId, paymentId: paymentIdStr, orderId: order.id }, 'presencial-order-created');
  return { ok: true, order };
}

async function ensureAppSettingsTable() {
  const sql = `CREATE TABLE IF NOT EXISTS \`AppSetting\` (
    \`keyName\` VARCHAR(120) NOT NULL,
    \`jsonValue\` LONGTEXT NULL,
    \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (\`keyName\`)
  )`;
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    fastify.log.warn(err, 'ensure-appsetting-table');
  }
}

async function loadScoreConfigFromDb() {
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT jsonValue, updatedAt FROM AppSetting WHERE keyName = ? LIMIT 1',
      APP_SETTING_SCORE_KEY
    );
    const row = rows?.[0];
    const raw = row?.jsonValue;
    if (!raw) return null;
    const parsed = JSON.parse(String(raw));
    return {
      config: normalizeScoreConfig(parsed),
      updatedAt: row?.updatedAt ? new Date(row.updatedAt) : null
    };
  } catch (err) {
    fastify.log.warn(err, 'load-score-config-db');
    return null;
  }
}

async function saveScoreConfigToDb(nextConfig) {
  const normalized = normalizeScoreConfig(nextConfig);
  const raw = JSON.stringify(normalized);
  try {
    await prisma.$executeRawUnsafe(
      'INSERT INTO AppSetting (keyName, jsonValue) VALUES (?, ?) ON DUPLICATE KEY UPDATE jsonValue = VALUES(jsonValue), updatedAt = CURRENT_TIMESTAMP(3)',
      APP_SETTING_SCORE_KEY,
      raw
    );
  } catch (err) {
    fastify.log.warn(err, 'save-score-config-db');
  }
  return normalized;
}

async function applyScoreConfigUpdate(nextConfig) {
  scoreConfig = await saveScoreConfigToDb(nextConfig);
  scoreConfigRuntimeCache.config = scoreConfig;
  scoreConfigRuntimeCache.updatedAt = new Date();
  scoreConfigRuntimeCache.fetchedAt = Date.now();
  reportHtmlTemplateCache = null;
  try {
    saveScoreConfig(scoreConfig);
  } catch (_) {}
  return scoreConfig;
}

async function getRuntimeScoreConfig({ force = false } = {}) {
  const CACHE_TTL_MS = 5000;
  const nowTs = Date.now();
  if (!force && scoreConfigRuntimeCache.config && (nowTs - scoreConfigRuntimeCache.fetchedAt) < CACHE_TTL_MS) {
    return { config: scoreConfigRuntimeCache.config, updatedAt: scoreConfigRuntimeCache.updatedAt };
  }
  const fromDb = await loadScoreConfigFromDb();
  if (fromDb?.config) {
    scoreConfig = fromDb.config;
    scoreConfigRuntimeCache.config = fromDb.config;
    scoreConfigRuntimeCache.updatedAt = fromDb.updatedAt || null;
    scoreConfigRuntimeCache.fetchedAt = nowTs;
    return { config: fromDb.config, updatedAt: fromDb.updatedAt || null };
  }
  scoreConfigRuntimeCache.config = scoreConfig;
  scoreConfigRuntimeCache.fetchedAt = nowTs;
  return { config: scoreConfig, updatedAt: scoreConfigRuntimeCache.updatedAt || null };
}

const TENANT_SESSION_COOKIE = 'tenant_session';
const EXEC_SESSION_COOKIE = 'exec_session';
const STARTER_TENANT_NAME = 'Ainspecta Starter';
/** Precio publicado del plan Starter (checkout MP / DTE). */
const STARTER_PRICE_CLP = Number(process.env.STARTER_PRICE_CLP || 14990);

/** Tenant interno Starter (1 pago = 1 caso). Creado por seed; si falta en BD, se crea aquí (p. ej. prod sin seed). */
async function ensureStarterTenant() {
  let t = await prisma.tenant.findFirst({ where: { name: STARTER_TENANT_NAME } });
  if (t) return t;
  try {
    return await prisma.tenant.create({
      data: {
        name: STARTER_TENANT_NAME,
        legalName: 'Ainspecta Starter',
        status: 'ACTIVE',
      },
    });
  } catch (err) {
    t = await prisma.tenant.findFirst({ where: { name: STARTER_TENANT_NAME } });
    if (t) return t;
    throw err;
  }
}
const REVIEWER_EMAIL = process.env.REVIEWER_EMAIL || 'paulo.yanez@ainspecciona.com';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 días
const TRIAL_DURATION_DAYS = Number(process.env.TRIAL_DURATION_DAYS || 14);
const TRIAL_INITIAL_REAL_INSPECTIONS = Number(process.env.TRIAL_INITIAL_REAL_INSPECTIONS || 1);
const PARTNER_TRIAL_DURATION_DAYS = Number(process.env.PARTNER_TRIAL_DURATION_DAYS || 30);
const PARTNER_TRIAL_BONUS_CREDITS = Number(process.env.PARTNER_TRIAL_BONUS_CREDITS || 1);
const PEER_TRIAL_BONUS_CREDITS = Number(process.env.PEER_TRIAL_BONUS_CREDITS || 1);
const PEER_REF_CODE_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
/** Mínimo de caracteres para clave de corredora vía admin (ej. 2 en .env para testers que usan "12") */
const ADMIN_TENANT_PASSWORD_MIN_LEN = Math.max(1, Math.min(128, Number(process.env.ADMIN_TENANT_PASSWORD_MIN_LEN || 6)));
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'outlook.es', 'icloud.com', 'yahoo.com', 'yahoo.es', 'proton.me', 'protonmail.com', 'live.com'
]);

/** Cookie options para sesión — secure: true en HTTPS (Cloud Run), false en localhost */
function sessionCookieOpts(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.headers['x-forwarded-ssl'] || '').toString().split(',')[0].trim().toLowerCase();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim().toLowerCase();
  const isLocalhost = !host || host === 'localhost' || host.startsWith('127.0.0.1') || host.includes(':3000');
  const isSecure = !isLocalhost && (proto === 'https' || process.env.NODE_ENV === 'production');
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    maxAge: 60 * 60 * 24 * 7 // 7 días
  };
}

function extractEmailDomain(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at < 0) return '';
  return normalized.slice(at + 1);
}

function isCorporateEmail(email) {
  const domain = extractEmailDomain(email);
  if (!domain) return false;
  if (FREE_EMAIL_DOMAINS.has(domain)) return false;
  return domain.includes('.');
}

function splitFullName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ')
  };
}

/** URL pública del sitio (emails, enlaces). Prioriza PUBLIC_URL / BASE_URL sobre el Host del request. */
function getPublicWebBase(req) {
  const fromEnv = String(process.env.PUBLIC_URL || process.env.BASE_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const rawProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = rawProto || (req.protocol === 'http' ? 'http' : 'https');
  if (host) return `${proto}://${host}`;
  return 'https://ainspecciona.com';
}

/** Base del API para webhooks de MP (Cloud Run). PUBLIC_URL suele ser el front (Firebase); las notificaciones deben ir al backend. */
function getMercadoPagoWebhookBase(req) {
  const explicit = String(process.env.MERCADOPAGO_WEBHOOK_BASE_URL || process.env.API_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  return getPublicWebBase(req);
}

function getMercadoPagoWebhookUrl(req) {
  return `${getMercadoPagoWebhookBase(req)}/api/mercadopago/webhook`;
}

/**
 * Base URL para enlaces en correos (activación ejecutivo, etc.).
 * Si el API se llama vía *.run.app o localhost, no usar ese host: muchos clientes de correo bloquean o vacían esos href.
 */
function getEmailWebBase(req) {
  const fromEnv = String(process.env.PUBLIC_URL || process.env.BASE_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  if (host.includes('.run.app') || host.startsWith('localhost') || host.startsWith('127.')) {
    return String(process.env.WEB_APP_ORIGIN || 'https://ainspecciona.web.app').trim().replace(/\/$/, '') || 'https://ainspecciona.web.app';
  }
  return getPublicWebBase(req);
}

async function sendExecutiveInviteEmailForUser(req, user, activationUrlPath, log) {
  const base = getEmailWebBase(req);
  const path = String(activationUrlPath || '').startsWith('/') ? activationUrlPath : `/${activationUrlPath || ''}`;
  const absoluteUrl = `${base}${path}`;
  let tenantName = 'tu corredora';
  if (user.tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { name: true, legalName: true }
    });
    tenantName = String(tenant?.legalName || tenant?.name || tenantName).trim() || tenantName;
  }
  const result = await sendExecutiveInvitationEmail(user.email, user.fullName || '', tenantName, absoluteUrl);
  if (!result.ok && !result.skipped) {
    log.warn({ email: user.email, err: result.error }, 'executive-invite-email-failed');
  } else if (result.skipped) {
    log.warn({ email: user.email }, 'executive-invite-email-skipped-smtp');
  } else {
    log.info({ email: user.email }, 'executive-invite-email-sent');
  }
  return result;
}

async function safeReadJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function getHubspotToken() {
  return String(process.env.HUBSPOT_ACCESS_TOKEN || '').trim();
}

function hubspotHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

async function findHubspotContactIdByEmail(email, token) {
  const emailVal = String(email || '').trim().toLowerCase();
  if (!emailVal) return null;
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
    method: 'POST',
    headers: hubspotHeaders(token),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: emailVal }] }],
      properties: ['email'],
      limit: 1
    })
  });
  if (!res.ok) return null;
  const data = await safeReadJson(res);
  return data?.results?.[0]?.id || null;
}

async function findHubspotCompanyIdByName(name, token) {
  const nameVal = String(name || '').trim();
  if (!nameVal) return null;
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
    method: 'POST',
    headers: hubspotHeaders(token),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'name', operator: 'EQ', value: nameVal }] }],
      properties: ['name'],
      limit: 1
    })
  });
  if (!res.ok) return null;
  const data = await safeReadJson(res);
  const exactId = data?.results?.[0]?.id || null;
  if (exactId) return exactId;

  // Fallback: matches minor formatting differences in company names.
  const containsRes = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
    method: 'POST',
    headers: hubspotHeaders(token),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: nameVal }] }],
      properties: ['name'],
      limit: 1
    })
  });
  if (!containsRes.ok) return null;
  const containsData = await safeReadJson(containsRes);
  return containsData?.results?.[0]?.id || null;
}

async function findHubspotCompanyIdByRut(rut, token, rutProperty) {
  const rutVal = normalizeRut(rut);
  if (!rutVal || !rutProperty) return null;
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
    method: 'POST',
    headers: hubspotHeaders(token),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: rutProperty, operator: 'EQ', value: rutVal }] }],
      properties: ['name', rutProperty],
      limit: 1
    })
  });
  if (!res.ok) return null;
  const data = await safeReadJson(res);
  return data?.results?.[0]?.id || null;
}

async function upsertHubspotLead({ leadType, email, firstName, lastName, phone, company }) {
  const token = getHubspotToken();
  const emailVal = String(email || '').trim().toLowerCase();
  if (!token || !emailVal) return { ok: false, skipped: true, contactId: null };

  const props = Object.fromEntries(
    Object.entries({
      email: emailVal,
      firstname: String(firstName || '').trim() || undefined,
      lastname: String(lastName || '').trim() || undefined,
      phone: String(phone || '').trim() || undefined,
      company: String(company || '').trim() || undefined,
      lifecyclestage: 'lead',
      jobtitle: leadType === 'starter' ? 'Lead Starter' : 'Lead Corporativo'
    }).filter(([, v]) => !!v)
  );

  const updateUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(emailVal)}?idProperty=email`;
  const updateRes = await fetch(updateUrl, {
    method: 'PATCH',
    headers: hubspotHeaders(token),
    body: JSON.stringify({ properties: props })
  });
  if (updateRes.ok) {
    const updated = await safeReadJson(updateRes);
    const contactId = updated?.id || await findHubspotContactIdByEmail(emailVal, token);
    return { ok: true, mode: 'updated', contactId };
  }

  if (updateRes.status !== 404) {
    return { ok: false, status: updateRes.status, detail: await safeReadJson(updateRes), contactId: null };
  }

  const createRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
    method: 'POST',
    headers: hubspotHeaders(token),
    body: JSON.stringify({ properties: props })
  });
  if (createRes.ok) {
    const created = await safeReadJson(createRes);
    return { ok: true, mode: 'created', contactId: created?.id || null };
  }
  return { ok: false, status: createRes.status, detail: await safeReadJson(createRes), contactId: null };
}

async function upsertHubspotCompany({ companyName, companyRut, phone, description }) {
  const token = getHubspotToken();
  const nameVal = String(companyName || '').trim();
  if (!token || !nameVal) return { ok: false, skipped: true, companyId: null };
  const normalizedRut = normalizeRut(companyRut);
  const rutProperty = String(process.env.HUBSPOT_COMPANY_RUT_PROPERTY || 'rut_empresa').trim();

  const baseProps = Object.fromEntries(
    Object.entries({
      name: nameVal,
      phone: String(phone || '').trim() || undefined,
      description: String(description || '').trim() || undefined
    }).filter(([, v]) => !!v)
  );
  const propsWithRut = Object.fromEntries(
    Object.entries({
      ...baseProps,
      [rutProperty]: normalizedRut || undefined
    }).filter(([, v]) => !!v)
  );

  const existingByRutId = await findHubspotCompanyIdByRut(normalizedRut, token, rutProperty);
  const existingId = existingByRutId || await findHubspotCompanyIdByName(nameVal, token);
  if (existingId) {
    const updateWithRutRes = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${existingId}`, {
      method: 'PATCH',
      headers: hubspotHeaders(token),
      body: JSON.stringify({ properties: propsWithRut })
    });
    if (updateWithRutRes.ok) return { ok: true, mode: 'updated', companyId: existingId };
    const updateWithRutDetail = await safeReadJson(updateWithRutRes);
    if (rutProperty && normalizedRut && updateWithRutRes.status === 400) {
      const updateBaseRes = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${existingId}`, {
        method: 'PATCH',
        headers: hubspotHeaders(token),
        body: JSON.stringify({ properties: baseProps })
      });
      if (updateBaseRes.ok) {
        return { ok: true, mode: 'updated', companyId: existingId, note: 'rut_property_missing_fallback' };
      }
      return { ok: false, status: updateBaseRes.status, detail: await safeReadJson(updateBaseRes), companyId: existingId };
    }
    return { ok: false, status: updateWithRutRes.status, detail: updateWithRutDetail, companyId: existingId };
  }

  const createWithRutRes = await fetch('https://api.hubapi.com/crm/v3/objects/companies', {
    method: 'POST',
    headers: hubspotHeaders(token),
    body: JSON.stringify({ properties: propsWithRut })
  });
  if (createWithRutRes.ok) {
    const created = await safeReadJson(createWithRutRes);
    return { ok: true, mode: 'created', companyId: created?.id || null };
  }
  const createWithRutDetail = await safeReadJson(createWithRutRes);
  if (rutProperty && normalizedRut && createWithRutRes.status === 400) {
    const createBaseRes = await fetch('https://api.hubapi.com/crm/v3/objects/companies', {
      method: 'POST',
      headers: hubspotHeaders(token),
      body: JSON.stringify({ properties: baseProps })
    });
    if (createBaseRes.ok) {
      const created = await safeReadJson(createBaseRes);
      return { ok: true, mode: 'created', companyId: created?.id || null, note: 'rut_property_missing_fallback' };
    }
    return { ok: false, status: createBaseRes.status, detail: await safeReadJson(createBaseRes), companyId: null };
  }
  return { ok: false, status: createWithRutRes.status, detail: createWithRutDetail, companyId: null };
}

async function associateHubspotCompanyContact(companyId, contactId) {
  const token = getHubspotToken();
  if (!token || !companyId || !contactId) return { ok: false, skipped: true };
  const res = await fetch('https://api.hubapi.com/crm/v3/associations/companies/contacts/batch/create', {
    method: 'POST',
    headers: hubspotHeaders(token),
    body: JSON.stringify({
      inputs: [{ from: { id: String(companyId) }, to: { id: String(contactId) }, type: 'company_to_contact' }]
    })
  });
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, detail: await safeReadJson(res) };
}

async function syncCorporateContactInHubspot({ email, firstName, lastName, phone, companyName, companyRut }) {
  const company = await upsertHubspotCompany({
    companyName,
    companyRut,
    phone,
    description: 'Cliente corporativo dashboard'
  });
  const lead = await upsertHubspotLead({
    leadType: 'corporativo',
    email,
    firstName,
    lastName,
    phone,
    company: companyName
  });
  let association = { ok: false, skipped: true };
  if (company.ok && lead.ok && company.companyId && lead.contactId) {
    association = await associateHubspotCompanyContact(company.companyId, lead.contactId);
  }
  return { company, lead, association };
}

async function updateHubspotTrialProperties({ email, trialStatus, trialEndsAt, trialBlockedReason }) {
  const token = getHubspotToken();
  const emailVal = String(email || '').trim().toLowerCase();
  if (!token || !emailVal) return { ok: false, skipped: true };
  const props = Object.fromEntries(
    Object.entries({
      trial_status: trialStatus || undefined,
      trial_ends_at: trialEndsAt ? new Date(trialEndsAt).toISOString() : undefined,
      trial_blocked_reason: trialBlockedReason || undefined
    }).filter(([, v]) => !!v)
  );
  if (!Object.keys(props).length) return { ok: false, skipped: true };
  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(emailVal)}?idProperty=email`, {
    method: 'PATCH',
    headers: hubspotHeaders(token),
    body: JSON.stringify({ properties: props })
  });
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, detail: await safeReadJson(res) };
}

async function hasStarterHistoryForIdentity({ rutNorm, emailDomain }) {
  const starterTenant = await ensureStarterTenant();
  if (!starterTenant?.id) return false;
  const whereOr = [];
  if (rutNorm) {
    whereOr.push({ contactRut: rutNorm });
    whereOr.push({ contactRut: { contains: rutNorm.slice(0, -1) } });
  }
  if (emailDomain) {
    whereOr.push({ contactEmail: { endsWith: `@${emailDomain}` } });
  }
  if (!whereOr.length) return false;
  const paidStarterCase = await prisma.case.findFirst({
    where: {
      tenantId: starterTenant.id,
      mercadopagoPaymentId: { not: null },
      OR: whereOr
    },
    select: { id: true }
  });
  return !!paidStarterCase;
}

async function evaluateTrialEligibility({ rut, email }) {
  const emailVal = String(email || '').trim().toLowerCase();
  const rutNorm = normalizeRut(rut);
  const domain = extractEmailDomain(emailVal);
  if (!rutNorm) return { eligible: false, reason: 'RUT_REQUIRED', rutNorm, domain };
  if (!emailVal || !domain) return { eligible: false, reason: 'EMAIL_REQUIRED', rutNorm, domain };
  if (!isCorporateEmail(emailVal)) return { eligible: false, reason: 'CORPORATE_EMAIL_REQUIRED', rutNorm, domain };
  const eligibilityKey = `${rutNorm}|${domain}`;
  const priorTrialByKey = await prisma.tenant.findFirst({
    where: {
      trialEligibilityKey: eligibilityKey,
      trialStatus: { in: ['active', 'converted', 'expired', 'cancelled'] }
    },
    select: { id: true }
  });
  if (priorTrialByKey) return { eligible: false, reason: 'TRIAL_KEY_ALREADY_USED', rutNorm, domain };
  const starterHistory = await hasStarterHistoryForIdentity({ rutNorm, emailDomain: domain });
  if (starterHistory) return { eligible: false, reason: 'STARTER_HISTORY_BLOCK', rutNorm, domain };
  return { eligible: true, reason: null, rutNorm, domain };
}

async function refreshTrialStatusIfNeeded(tenant) {
  if (!tenant?.id) return tenant;
  if (tenant.trialStatus !== 'active' || !tenant.trialEndsAt) return tenant;
  const msToEnd = new Date(tenant.trialEndsAt).getTime() - Date.now();
  const daysToEnd = Math.ceil(msToEnd / (24 * 60 * 60 * 1000));
  if (daysToEnd <= 3 && daysToEnd > 0) {
    await updateHubspotTrialProperties({
      email: tenant.email,
      trialStatus: 'ending',
      trialEndsAt: tenant.trialEndsAt
    }).catch(() => {});
  }
  if (new Date(tenant.trialEndsAt).getTime() > Date.now()) return tenant;
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { trialStatus: 'expired' }
  }).catch(() => {});
  await updateHubspotTrialProperties({
    email: tenant.email,
    trialStatus: 'expired',
    trialEndsAt: tenant.trialEndsAt
  }).catch(() => {});
  return { ...tenant, trialStatus: 'expired' };
}

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

/** Genera un ID de caso de 8 caracteres (0-9, A-Z) para URLs. */
function generateCaseShortId() {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[bytes[i] % 36];
  return s;
}

/** Asigna shortId a casos que aún no lo tienen (backfill). Solo corre si la columna existe. */
async function backfillCaseShortIds() {
  try {
    const without = await prisma.case.findMany({
      where: { shortId: null },
      select: { id: true }
    });
    for (const row of without) {
      let attempts = 0;
      while (attempts < 10) {
        const shortId = generateCaseShortId();
        try {
          await prisma.case.update({
            where: { id: row.id },
            data: { shortId }
          });
          break;
        } catch (err) {
          if (err?.code === 'P2002') attempts++;
          else throw err;
        }
      }
    }
  } catch (err) {
    if (err?.name === 'PrismaClientValidationError') return;
    throw err;
  }
}

async function ensureReviewColumns() {
  const cols = [
    { name: 'reviewStatus', sql: 'ALTER TABLE `Case` ADD COLUMN `reviewStatus` VARCHAR(32) NULL' },
    { name: 'reviewedAt', sql: 'ALTER TABLE `Case` ADD COLUMN `reviewedAt` DATETIME(3) NULL' },
    { name: 'reviewerEmail', sql: 'ALTER TABLE `Case` ADD COLUMN `reviewerEmail` VARCHAR(255) NULL' }
  ];
  for (const col of cols) {
    try {
      await prisma.$executeRawUnsafe(col.sql);
      fastify.log.info(`Added column Case.${col.name}`);
    } catch (err) {
      if (String(err?.message || '').includes('Duplicate column')) continue;
      fastify.log.warn(err, `ensure-column-${col.name}`);
    }
  }
}

/** Columnas de Case añadidas en migraciones recientes; en entornos sin `migrate deploy` pueden faltar. */
async function ensureCaseExtraColumns() {
  const cols = [
    {
      name: 'executiveReportNotifiedAt',
      sql: 'ALTER TABLE `Case` ADD COLUMN `executiveReportNotifiedAt` DATETIME(3) NULL'
    },
    {
      name: 'hasEntranceGrille',
      sql: 'ALTER TABLE `Case` ADD COLUMN `hasEntranceGrille` BOOLEAN NOT NULL DEFAULT false'
    }
  ];
  for (const col of cols) {
    try {
      await prisma.$executeRawUnsafe(col.sql);
      fastify.log.info(`Added column Case.${col.name}`);
    } catch (err) {
      if (String(err?.message || '').includes('Duplicate column')) continue;
      fastify.log.warn(err, `ensure-column-case-${col.name}`);
    }
  }
}

async function ensurePageViewTable() {
  const sql = `CREATE TABLE IF NOT EXISTS \`PageView\` (
    \`id\` VARCHAR(191) NOT NULL,
    \`path\` VARCHAR(512) NOT NULL,
    \`referrer\` VARCHAR(1024) NULL,
    \`ua\` VARCHAR(512) NULL,
    \`ip\` VARCHAR(64) NULL,
    \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (\`id\`),
    INDEX \`PageView_createdAt_idx\`(\`createdAt\`),
    INDEX \`PageView_path_idx\`(\`path\`)
  )`;
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    fastify.log.warn(err, 'ensure-pageview-table');
  }
}

async function ensureSubscriptionColumns() {
  const cols = [
    { name: 'mpSubscriptionId', sql: 'ALTER TABLE `Tenant` ADD COLUMN `mpSubscriptionId` VARCHAR(64) NULL UNIQUE' },
    { name: 'subscriptionStatus', sql: 'ALTER TABLE `Tenant` ADD COLUMN `subscriptionStatus` VARCHAR(32) NULL' },
    { name: 'subscriptionExpiresAt', sql: 'ALTER TABLE `Tenant` ADD COLUMN `subscriptionExpiresAt` DATETIME(3) NULL' }
  ];
  for (const col of cols) {
    try {
      await prisma.$executeRawUnsafe(col.sql);
      fastify.log.info(`Added column Tenant.${col.name}`);
    } catch (err) {
      if (String(err?.message || '').includes('Duplicate column')) continue;
      fastify.log.warn(err, `ensure-column-${col.name}`);
    }
  }
}

async function ensureTrialColumns() {
  const cols = [
    { name: 'trialSubscriptionId', sql: 'ALTER TABLE `Tenant` ADD COLUMN `trialSubscriptionId` VARCHAR(64) NULL UNIQUE' },
    { name: 'trialStatus', sql: 'ALTER TABLE `Tenant` ADD COLUMN `trialStatus` VARCHAR(32) NULL' },
    { name: 'trialStartedAt', sql: 'ALTER TABLE `Tenant` ADD COLUMN `trialStartedAt` DATETIME(3) NULL' },
    { name: 'trialEndsAt', sql: 'ALTER TABLE `Tenant` ADD COLUMN `trialEndsAt` DATETIME(3) NULL' },
    { name: 'trialConvertedAt', sql: 'ALTER TABLE `Tenant` ADD COLUMN `trialConvertedAt` DATETIME(3) NULL' },
    { name: 'trialCancelledAt', sql: 'ALTER TABLE `Tenant` ADD COLUMN `trialCancelledAt` DATETIME(3) NULL' },
    { name: 'trialRealInspectionUsedAt', sql: 'ALTER TABLE `Tenant` ADD COLUMN `trialRealInspectionUsedAt` DATETIME(3) NULL' },
    { name: 'trialBlockedReason', sql: 'ALTER TABLE `Tenant` ADD COLUMN `trialBlockedReason` VARCHAR(255) NULL' },
    { name: 'trialEligibilityKey', sql: 'ALTER TABLE `Tenant` ADD COLUMN `trialEligibilityKey` VARCHAR(191) NULL' },
    { name: 'trialAutoCharge', sql: 'ALTER TABLE `Tenant` ADD COLUMN `trialAutoCharge` BOOLEAN NOT NULL DEFAULT false' },
    { name: 'trialSource', sql: 'ALTER TABLE `Tenant` ADD COLUMN `trialSource` VARCHAR(64) NULL' },
    { name: 'referralPartnerId', sql: 'ALTER TABLE `Tenant` ADD COLUMN `referralPartnerId` VARCHAR(191) NULL' },
    { name: 'referralCodeSnapshot', sql: 'ALTER TABLE `Tenant` ADD COLUMN `referralCodeSnapshot` VARCHAR(64) NULL' },
    { name: 'trialPartnerBenefitsAt', sql: 'ALTER TABLE `Tenant` ADD COLUMN `trialPartnerBenefitsAt` DATETIME(3) NULL' }
  ];
  for (const col of cols) {
    try {
      await prisma.$executeRawUnsafe(col.sql);
      fastify.log.info(`Added column Tenant.${col.name}`);
    } catch (err) {
      if (String(err?.message || '').includes('Duplicate column')) continue;
      fastify.log.warn(err, `ensure-column-${col.name}`);
    }
  }
}

async function ensurePromoTables() {
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`PromoCode\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`code\` VARCHAR(64) NOT NULL,
      \`active\` BOOLEAN NOT NULL DEFAULT true,
      \`credits\` INTEGER NOT NULL DEFAULT 1,
      \`label\` VARCHAR(191) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE INDEX \`PromoCode_code_key\`(\`code\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (err) {
    fastify.log.warn(err, 'ensure-promo-code-table');
  }
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`PromoRedemption\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`promoCodeId\` VARCHAR(191) NOT NULL,
      \`tenantId\` VARCHAR(191) NOT NULL,
      \`rutNorm\` VARCHAR(32) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE INDEX \`PromoRedemption_tenantId_key\`(\`tenantId\`),
      UNIQUE INDEX \`PromoRedemption_rutNorm_key\`(\`rutNorm\`),
      INDEX \`PromoRedemption_promoCodeId_idx\`(\`promoCodeId\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (err) {
    fastify.log.warn(err, 'ensure-promo-redemption-table');
  }
}

async function ensureMagicLinkTokenTable() {
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS \`MagicLinkToken\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`tenantId\` VARCHAR(191) NOT NULL,
      \`token\` VARCHAR(191) NOT NULL,
      \`expiresAt\` DATETIME(3) NOT NULL,
      \`usedAt\` DATETIME(3) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE INDEX \`MagicLinkToken_token_key\`(\`token\`),
      INDEX \`MagicLinkToken_tenantId_idx\`(\`tenantId\`),
      INDEX \`MagicLinkToken_expiresAt_idx\`(\`expiresAt\`),
      INDEX \`MagicLinkToken_token_idx\`(\`token\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (err) {
    fastify.log.warn(err, 'ensure-magic-link-token-table');
  }
}

async function ensurePeerReferralUniqueIndex() {
  try {
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX `Tenant_peerReferralCode_key` ON `Tenant`(`peerReferralCode`)'
    );
    fastify.log.info('Added unique index Tenant.peerReferralCode');
  } catch (err) {
    if (String(err?.message || '').includes('Duplicate key name') || String(err?.message || '').includes('exists')) return;
    fastify.log.warn(err, 'ensure-peer-referral-code-index');
  }
}

async function ensurePeerReferralAttributionTable() {
  const sql = `CREATE TABLE IF NOT EXISTS \`PeerReferralAttribution\` (
    \`id\` VARCHAR(191) NOT NULL,
    \`referrerTenantId\` VARCHAR(191) NOT NULL,
    \`referredTenantId\` VARCHAR(191) NOT NULL,
    \`peerCodeUsed\` VARCHAR(32) NOT NULL,
    \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX \`PeerReferralAttribution_referredTenantId_key\`(\`referredTenantId\`),
    INDEX \`PeerReferralAttribution_referrerTenantId_idx\`(\`referrerTenantId\`),
    PRIMARY KEY (\`id\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (err) {
    fastify.log.warn(err, 'ensure-peer-referral-attribution-table');
  }
  const fks = [
    `ALTER TABLE \`PeerReferralAttribution\` ADD CONSTRAINT \`PeerReferralAttribution_referrerTenantId_fkey\` FOREIGN KEY (\`referrerTenantId\`) REFERENCES \`Tenant\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`,
    `ALTER TABLE \`PeerReferralAttribution\` ADD CONSTRAINT \`PeerReferralAttribution_referredTenantId_fkey\` FOREIGN KEY (\`referredTenantId\`) REFERENCES \`Tenant\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`
  ];
  for (const fk of fks) {
    try {
      await prisma.$executeRawUnsafe(fk);
    } catch (err) {
      if (String(err?.message || '').includes('Duplicate') || String(err?.message || '').includes('already exists')) continue;
      fastify.log.warn(err, 'ensure-peer-referral-fk');
    }
  }
}

async function ensurePeerReferralProgramSchema() {
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE `Tenant` ADD COLUMN `peerReferralCode` VARCHAR(32) NULL');
    fastify.log.info('Added column Tenant.peerReferralCode');
  } catch (err) {
    if (!String(err?.message || '').includes('Duplicate column')) {
      fastify.log.warn(err, 'ensure-peer-referral-column');
    }
  }
  await ensurePeerReferralAttributionTable();
  await ensurePeerReferralUniqueIndex();
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

/**
 * Payer en Checkout Pro: solo email.
 * MP recomienda pruebas en incógnito y usuario comprador de prueba; prellenar nombre/RUT en la preferencia
 * a veces deja el método como «UNDEFINED SOURCE» y el botón Pagar deshabilitado en Sandbox.
 */
function buildMercadoPagoPayerPreference({ email }) {
  return {
    email: String(email || '').trim().toLowerCase()
  };
}

/** Servicio digital Chile: sin envío + locale. Sin `binary_mode`: si está en true, Checkout Pro suele mostrar solo tarjeta y oculta pagar con cuenta Mercado Pago. */
function mercadoPagoCheckoutProDigitalPreferenceExtras() {
  return {
    shipments: { mode: 'not_specified' },
    locale: 'es-CL',
    // Evita que MP devuelva excluded_* con { id: "" }, que en checkout puede dejar medios rotos
    payment_methods: {
      excluded_payment_methods: [],
      excluded_payment_types: []
    }
  };
}

function normalizePartnerCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

async function peerReferralCodeIsTakenTx(tx, code) {
  const [partner, t] = await Promise.all([
    tx.referralPartner.findFirst({ where: { code, active: true }, select: { id: true } }),
    tx.tenant.findFirst({ where: { peerReferralCode: code }, select: { id: true } })
  ]);
  return !!(partner || t);
}

async function generateUniquePeerReferralCodeTx(tx) {
  for (let attempt = 0; attempt < 40; attempt++) {
    let c = '';
    const bytes = crypto.randomBytes(10);
    for (let i = 0; i < 8; i++) c += PEER_REF_CODE_ALPHABET[bytes[i] % PEER_REF_CODE_ALPHABET.length];
    if (!(await peerReferralCodeIsTakenTx(tx, c))) return c;
  }
  throw new Error('PEER_REF_CODE_GENERATION_FAILED');
}

/**
 * Asigna peerReferralCode al crear el tenant (o en el primer request que lo necesite):
 * tenant ACTIVE sin código. Idempotente; sin colisión con códigos partner.
 * @returns {{ code: string | null, assigned: boolean }}
 */
async function ensureTenantPeerReferralCodeInTx(tx, tenantId) {
  const row = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { peerReferralCode: true, status: true }
  });
  if (!row || row.peerReferralCode) {
    return { code: row?.peerReferralCode || null, assigned: false };
  }
  if (row.status !== 'ACTIVE') {
    return { code: null, assigned: false };
  }
  const code = await generateUniquePeerReferralCodeTx(tx);
  await tx.tenant.update({ where: { id: tenantId }, data: { peerReferralCode: code } });
  return { code, assigned: true };
}

async function ensureTenantPeerReferralCode(tenantId) {
  return prisma.$transaction((tx) => ensureTenantPeerReferralCodeInTx(tx, tenantId));
}

async function notifyPeerReferralWelcomeIfNew(req, { assigned, code, email, tenantName }) {
  if (!assigned || !code || !email) return;
  if (String(process.env.PEER_REFERRAL_WELCOME_EMAIL || '1').trim() === '0') return;
  const dashboardUrl = `${getEmailWebBase(req)}/tenant.html`;
  const webBase = getPublicWebBase(req);
  const inviteUrl = `${webBase}/?ref=${encodeURIComponent(code)}`;
  const result = await sendPeerReferralWelcomeEmail(
    email.trim().toLowerCase(),
    tenantName || '',
    dashboardUrl,
    inviteUrl,
    code
  );
  if (!result.ok && !result.skipped) {
    req.log?.warn?.({ result, tenantEmail: email }, 'peer-referral-welcome-email-failed');
  }
}

/** Comisión partner (15% por defecto) sobre monto facturado en CLP; idempotente por mercadopagoPaymentId */
async function maybeRecordPartnerCommission(log, { tenantId, mercadopagoPaymentId, payment, source, plan }) {
  const paymentIdStr = String(mercadopagoPaymentId || '').trim();
  if (!tenantId || !paymentIdStr) return;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        referralPartnerId: true,
        referralPartner: { select: { id: true, commissionRate: true, active: true } }
      }
    });
    const partner = tenant?.referralPartner;
    if (!tenant?.referralPartnerId || !partner || !partner.active) return;

    const existing = await prisma.partnerCommissionAccrual.findUnique({
      where: { mercadopagoPaymentId: paymentIdStr }
    });
    if (existing) return;

    let gross = 0;
    if (payment && payment.transaction_amount != null) {
      gross = Math.round(Number(payment.transaction_amount));
    }
    if (gross <= 0 && plan) {
      const BUSINESS_PRICE_CLP = Number(process.env.BUSINESS_PRICE_CLP || 39990);
      const PLAN_GROSS_CLP = {
        starter: STARTER_PRICE_CLP,
        business: BUSINESS_PRICE_CLP,
        corporate: 1199000,
        'credits-10': 139990,
        'credits-50': 649500,
        'credits-100': 1199000,
        'credits-5': 64950,
        'credits-20': 219800
      };
      gross = PLAN_GROSS_CLP[plan] || 0;
    }
    if (gross <= 0 && source === 'SUBSCRIPTION') {
      gross = Number(process.env.BUSINESS_PRICE_CLP || 39990);
    }
    if (gross <= 0) return;

    const rate = Number(partner.commissionRate);
    const commissionAmount = Math.round(gross * rate);

    await prisma.partnerCommissionAccrual.create({
      data: {
        referralPartnerId: partner.id,
        tenantId,
        source,
        mercadopagoPaymentId: paymentIdStr,
        grossAmountClp: gross,
        commissionRate: partner.commissionRate,
        commissionAmountClp: commissionAmount,
        status: 'ACCRUED'
      }
    });
  } catch (err) {
    if (String(err?.message || '').includes('Unique constraint')) return;
    log?.warn?.({ err, tenantId, mercadopagoPaymentId }, 'partner-commission-accrual-failed');
  }
}

const AMBASSADOR_COMMISSION_RATE = Math.min(
  1,
  Math.max(0, Number(process.env.AMBASSADOR_COMMISSION_RATE || 0.3))
);

function mpPaymentNetReceivedClp(payment) {
  const n = payment?.transaction_details?.net_received_amount;
  if (n != null && Number.isFinite(Number(n))) return Math.round(Number(n));
  const t = payment?.transaction_details?.total_paid_amount;
  if (t != null && Number.isFinite(Number(t))) return Math.round(Number(t));
  const ta = payment?.transaction_amount;
  if (ta != null && Number.isFinite(Number(ta))) return Math.round(Number(ta));
  return 0;
}

function accreditedAtFromMpPayment(payment) {
  const raw = payment?.date_approved || payment?.money_release_date || payment?.date_last_updated || payment?.date_created;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function yearMonthUtcFromDate(d) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Pagos desde checkout con tenant (dashboard / panel), no Starter público sin tenant. */
function isDashboardMercadoPagoContext({ tenantId, plan, extRef, source }) {
  if (!tenantId) return false;
  const p = String(plan || '').toLowerCase();
  if (p === 'starter') return String(extRef || '').includes('tenant:');
  if (source === 'SUBSCRIPTION') return true;
  return true;
}

/**
 * Comisión embajador: 30% del neto MP acreditado; solo checkout dashboard; ventana 3 meses calendario desde primer acreditado.
 */
async function maybeRecordAmbassadorCommission(log, { tenantId, mercadopagoPaymentId, payment, plan, source, extRef }) {
  const paymentIdStr = String(mercadopagoPaymentId || '').trim();
  if (!tenantId || !paymentIdStr || !payment) return;
  if (!isDashboardMercadoPagoContext({ tenantId, plan, extRef: extRef ?? payment.external_reference, source })) {
    return;
  }

  try {
    const net = mpPaymentNetReceivedClp(payment);
    if (net <= 0) return;

    const accreditedAt = accreditedAtFromMpPayment(payment);
    const yearMonth = yearMonthUtcFromDate(accreditedAt);

    await prisma.$transaction(async (tx) => {
      const attr = await tx.ambassadorReferralAttribution.findUnique({
        where: { referredTenantId: tenantId }
      });
      if (!attr) return;

      const existing = await tx.ambassadorCommissionLine.findUnique({
        where: { mercadopagoPaymentId: paymentIdStr }
      });
      if (existing) return;

      const now = new Date();
      if (attr.commissionUntil && now > attr.commissionUntil) return;

      let firstAcc = attr.firstAccreditedAt;
      let until = attr.commissionUntil;
      if (!firstAcc) {
        firstAcc = accreditedAt;
        const y = firstAcc.getUTCFullYear();
        const m = firstAcc.getUTCMonth();
        until = new Date(Date.UTC(y, m + 3, 0, 23, 59, 59, 999));
      }

      const commission = Math.round(net * AMBASSADOR_COMMISSION_RATE);

      await tx.ambassadorCommissionLine.create({
        data: {
          attributionId: attr.id,
          mercadopagoPaymentId: paymentIdStr,
          kind: 'PAYMENT',
          netAmountClp: net,
          accreditedAt,
          yearMonth,
          plan: plan ? String(plan).slice(0, 64) : null,
          commissionClp: commission
        }
      });

      if (!attr.firstAccreditedAt) {
        await tx.ambassadorReferralAttribution.update({
          where: { id: attr.id },
          data: {
            firstAccreditedAt: firstAcc,
            commissionUntil: until
          }
        });
      }
    });

    log?.info?.({ tenantId, paymentIdStr, yearMonth }, 'ambassador-commission-accrued');
  } catch (err) {
    if (String(err?.code || '') === 'P2002') return;
    log?.warn?.({ err, tenantId, mercadopagoPaymentId }, 'ambassador-commission-failed');
  }
}

/** Devolución: resta del mes calendario (mismo id MP o línea refund:* idempotente). */
async function maybeRecordAmbassadorRefund(log, payment) {
  const paymentIdStr = String(payment?.id || '').trim();
  if (!paymentIdStr || payment?.status !== 'refunded') return;

  try {
    const origLine = await prisma.ambassadorCommissionLine.findUnique({
      where: { mercadopagoPaymentId: paymentIdStr },
      include: { attribution: true }
    });
    if (!origLine || origLine.kind !== 'PAYMENT') return;

    const refundKey = `refund:${paymentIdStr}`;
    const existing = await prisma.ambassadorCommissionLine.findUnique({
      where: { mercadopagoPaymentId: refundKey }
    });
    if (existing) return;

    const refundAccredited = accreditedAtFromMpPayment(payment);
    const yearMonth = yearMonthUtcFromDate(refundAccredited);
    const negNet = -origLine.netAmountClp;
    const negComm = -origLine.commissionClp;

    await prisma.$transaction(async (tx) => {
      await tx.ambassadorCommissionLine.create({
        data: {
          attributionId: origLine.attributionId,
          mercadopagoPaymentId: refundKey,
          kind: 'REFUND',
          netAmountClp: negNet,
          accreditedAt: refundAccredited,
          yearMonth,
          plan: origLine.plan,
          commissionClp: negComm
        }
      });
    });
    log?.info?.({ paymentIdStr, yearMonth }, 'ambassador-commission-refund');
  } catch (err) {
    log?.warn?.({ err, paymentId: payment?.id }, 'ambassador-refund-failed');
  }
}

const SF_LINE_BUSINESS = 'Plan Business Ainspecciona (suscripción / créditos)';
const SF_LINE_STARTER = 'Inspección Starter Ainspecciona (1 crédito)';

/** Datos tributarios para Case/Tenant (SimpleFactura). Opcional `tipoDte` 33 o 39. */
function buildFacturacionJsonFromForm(body, contactEmailFallback) {
  if (!body?.necesitaFactura) return null;
  const razon = String(body.facturaRazonSocial || '').trim();
  if (!razon) return null;
  const out = {
    razonSocial: razon,
    rut: body.facturaRut ? String(body.facturaRut).trim() : null,
    direccion: body.facturaDireccion ? String(body.facturaDireccion).trim() : null,
    comuna: body.facturaComuna ? String(body.facturaComuna).trim() : null,
    ciudad: body.facturaCiudad ? String(body.facturaCiudad).trim() : null,
    giro: body.facturaGiro ? String(body.facturaGiro).trim() : null,
    email: String(body.facturaEmail || contactEmailFallback || '')
      .trim()
      .toLowerCase()
  };
  const td = body.facturaTipoDte ?? body.tipoDte;
  if (td !== undefined && td !== null && String(td).trim() !== '') {
    const n = Number(td);
    if (!Number.isNaN(n)) out.tipoDte = n;
  }
  return out;
}

/**
 * Boleta/factura DTE (SimpleFactura) tras pago MP; idempotente por mercadopagoPaymentId.
 * `billingTenantId` = tenant emisor en BD (Business o tenant Starter compartido).
 * Boleta 39 / factura 33: `facturacionJson.tipoDte` o env `SIMPLEFACTURA_TIPO_DTE` / `SIMPLEFACTURA_STARTER_TIPO_DTE`.
 * @returns {{ dtePdfBuffer: Buffer | null, folio: number | null }}
 */
async function maybeEmitSimpleFacturaForPayment(log, {
  billingTenantId,
  mercadopagoPaymentId,
  payment,
  facturacionJson,
  lineDescription,
  fallbackMontoClp,
  tipoDteDefault
}) {
  if (!isSimpleFacturaConfigured()) return { dtePdfBuffer: null, folio: null };
  if (!facturacionJson || typeof facturacionJson !== 'object') return { dtePdfBuffer: null, folio: null };
  const paymentIdStr = String(mercadopagoPaymentId);
  const tipoDteForRow = Number(
    facturacionJson?.tipoDte ?? facturacionJson?.tipoDTE ?? tipoDteDefault
  );
  try {
    await prisma.simpleFacturaEmission.create({
      data: {
        tenantId: billingTenantId,
        mercadopagoPaymentId: paymentIdStr,
        tipoDte: tipoDteForRow,
        status: 'PROCESSING'
      }
    });
  } catch (e) {
    if (String(e?.code) === 'P2002') return { dtePdfBuffer: null, folio: null };
    throw e;
  }
  const monto = Number(
    payment?.transaction_amount ?? payment?.transaction_details?.total_paid_amount ?? fallbackMontoClp
  );
  const montoR = Math.round(monto);
  try {
    const result = await emitBoletaElectronica({
      log,
      facturacion: facturacionJson,
      montoTotalClp: montoR,
      lineDescription,
      tipoDteDefault
    });
    await prisma.simpleFacturaEmission.updateMany({
      where: { mercadopagoPaymentId: paymentIdStr },
      data: {
        status: 'SUCCESS',
        tipoDte: result.tipoDte ?? tipoDteForRow,
        folio: result.folio ?? undefined,
        responseJson: result.raw ?? undefined
      }
    });
    let dtePdfBuffer = null;
    if (result.folio != null) {
      try {
        dtePdfBuffer = await fetchDtePdfBuffer({
          log,
          facturacion: facturacionJson,
          montoTotalClp: montoR,
          folio: result.folio,
          tipoDte: result.tipoDte ?? tipoDteForRow,
          lineDescription
        });
      } catch (pdfErr) {
        log?.warn?.({ err: pdfErr, tenantId: billingTenantId, paymentId: paymentIdStr }, 'simplefactura-pdf-fetch-failed');
      }
    }
    return { dtePdfBuffer, folio: result.folio ?? null };
  } catch (err) {
    log?.warn?.({ err, tenantId: billingTenantId, paymentId: paymentIdStr }, 'simplefactura-emission-failed');
    await prisma.simpleFacturaEmission.updateMany({
      where: { mercadopagoPaymentId: paymentIdStr },
      data: {
        status: 'FAILED',
        errorMessage: String(err?.message || err).slice(0, 2000)
      }
    });
    return { dtePdfBuffer: null, folio: null };
  }
}

async function createTenantSession(tenantId) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { token, type: 'tenant', tenantId, expiresAt }
  });
  return token;
}

function getTenantSessionToken(req) {
  const fromCookie = req.cookies?.[TENANT_SESSION_COOKIE];
  if (fromCookie) return fromCookie;
  const auth = req.headers['authorization'] || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (bearer) return bearer;
  return req.headers['x-session-token'] || null;
}

async function getTenantSession(req) {
  const token = getTenantSessionToken(req);
  if (!token) return null;
  const row = await prisma.session.findFirst({
    where: { token, type: 'tenant' }
  });
  if (!row || new Date(row.expiresAt).getTime() <= Date.now()) {
    if (row) await prisma.session.delete({ where: { id: row.id } }).catch(() => {});
    return null;
  }
  return { tenantId: row.tenantId, createdAt: row.createdAt };
}

async function createExecSession(userId, tenantId) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { token, type: 'exec', userId, tenantId, expiresAt }
  });
  return token;
}

function getExecSessionToken(req) {
  const fromCookie = req.cookies?.[EXEC_SESSION_COOKIE];
  if (fromCookie) return fromCookie;
  const auth = req.headers['authorization'] || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (bearer) return bearer;
  return req.headers['x-session-token'] || null;
}

async function getExecSession(req) {
  const token = getExecSessionToken(req);
  if (!token) return null;
  const row = await prisma.session.findFirst({
    where: { token, type: 'exec' }
  });
  if (!row || new Date(row.expiresAt).getTime() <= Date.now()) {
    if (row) await prisma.session.delete({ where: { id: row.id } }).catch(() => {});
    return null;
  }
  return { userId: row.userId, tenantId: row.tenantId, createdAt: row.createdAt };
}

function computeProgressFromSlots(slots) {
  const total = slots.length;
  const uploaded = slots.filter((s) =>
    ['UPLOADED', 'ANALYZED', 'REJECTED', 'NOT_CAPTURABLE'].includes(String(s.status || '').toUpperCase())
  ).length;
  const analyzed = slots.filter((s) => String(s.status || '').toUpperCase() === 'ANALYZED').length;
  const omitted = slots.filter((s) => String(s.status || '').toUpperCase() === 'NOT_CAPTURABLE').length;
  const rejected = slots.filter((s) => String(s.status || '').toUpperCase() === 'REJECTED').length;
  const pct = total ? Math.round((uploaded / total) * 100) : 0;
  return { uploaded, analyzed, omitted, rejected, total, pct };
}

function isCaseReportFullyEmittedFromSlots(slots) {
  if (!Array.isArray(slots) || !slots.length) return false;
  return slots.every((s) => {
    const st = String(s.status || '').toUpperCase();
    return st === 'ANALYZED' || st === 'NOT_CAPTURABLE';
  });
}

/** Caso DONE, tenant Business, slots listos. Flujo: (1) si aún no aprobado → pending_review + mail a revisor; (2) si approved → mail al ejecutivo (idempotente). */
async function maybeNotifyExecutiveReportReady(caseId) {
  if (!caseId) return;
  try {
    const c = await prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        status: true,
        shortId: true,
        executiveReportNotifiedAt: true,
        reviewStatus: true,
        assignedUserId: true,
        tenant: { select: { name: true } },
        assignedUser: { select: { email: true, fullName: true } },
        slots: { select: { status: true } },
        property: { select: { address: true } }
      }
    });
    if (!c || c.status !== 'DONE') return;
    if (!c.tenant || c.tenant.name === STARTER_TENANT_NAME) return;
    if (c.executiveReportNotifiedAt) return;
    if (!c.assignedUserId || !c.assignedUser?.email) return;
    if (!isCaseReportFullyEmittedFromSlots(c.slots)) return;

    const shortId = c.shortId || c.id;
    const base =
      String(process.env.PUBLIC_URL || process.env.BASE_URL || process.env.WEB_APP_ORIGIN || 'https://ainspecciona.com')
        .trim()
        .replace(/\/$/, '') || 'https://ainspecciona.com';
    const reportUrl = `${base}/cases/${encodeURIComponent(shortId)}/report`;

    const review = String(c.reviewStatus || '').toLowerCase();

    if (review === 'approved') {
      const mail = await sendExecutiveReportReadyEmail(c.assignedUser.email, {
        fullName: c.assignedUser.fullName || '',
        shortId,
        address: c.property?.address || '',
        reportUrl
      });
      if (!mail.ok || mail.skipped) {
        if (!mail.skipped) fastify.log.warn({ caseId, err: mail.error }, 'executive-report-ready-email-failed');
        return;
      }
      const updated = await prisma.case.updateMany({
        where: { id: c.id, executiveReportNotifiedAt: null },
        data: { executiveReportNotifiedAt: new Date() }
      });
      if (updated.count) {
        fastify.log.info({ caseId: c.id, email: c.assignedUser.email }, 'executive-report-ready-email-sent');
      }
      return;
    }

    if (review === 'pending_review') return;

    const updatedPending = await prisma.case.updateMany({
      where: { id: c.id, reviewStatus: null },
      data: { reviewStatus: 'pending_review' }
    });
    if (!updatedPending.count) return;

    const mailRv = await sendBusinessReportReviewerNotificationEmail(REVIEWER_EMAIL, reportUrl, shortId, {
      address: c.property?.address || '',
      executiveName: c.assignedUser.fullName || c.assignedUser.email || ''
    });
    if (!mailRv.ok || mailRv.skipped) {
      if (!mailRv.skipped) {
        await prisma.case.updateMany({
          where: { id: c.id, reviewStatus: 'pending_review' },
          data: { reviewStatus: null }
        });
        fastify.log.warn({ caseId, err: mailRv.error }, 'business-review-request-email-failed');
      }
    } else {
      fastify.log.info({ caseId: c.id, to: REVIEWER_EMAIL }, 'business-review-request-email-sent');
    }
  } catch (err) {
    fastify.log.warn({ err: err?.message, caseId }, 'maybeNotifyExecutiveReportReady');
  }
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
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif'
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

  if (width < 640 || height < 480) {
    return {
      meta: { width, height },
      problem: {
        code: 'PHOTO_TOO_SMALL',
        severity: 'medium',
        confidence: 0.95,
        message: 'La imagen es demasiado pequeña. Se recomienda una resolución mínima de 640x480 píxeles.',
        debug: { width, height, min: { width: 640, height: 480 } }
      }
    };
  }

  const stats = await sharp(buffer).stats().catch(() => null);
  const ch = stats?.channels || [];
  const mean = ch.length >= 3
    ? (0.299 * (ch[0]?.mean ?? 0)) + (0.587 * (ch[1]?.mean ?? 0)) + (0.114 * (ch[2]?.mean ?? 0))
    : (ch[0]?.mean ?? 0);
  if (mean < 18) {
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
  const bathMatch = code.match(/^BATHROOM_(\d+)_/);
  if (bathMatch) return { groupKey: `BATH_${bathMatch[1]}`, groupTitle: `Baño ${bathMatch[1]}` };
  const bedMatch = code.match(/^BEDROOM_(\d+)_/);
  if (bedMatch) return { groupKey: `BEDROOM_${bedMatch[1]}`, groupTitle: `Dormitorio ${bedMatch[1]}` };
  if (code.startsWith('KITCHEN_')) return { groupKey: 'KITCHEN', groupTitle: 'Cocina' };
  if (code.startsWith('LAUNDRY_')) return { groupKey: 'LAUNDRY', groupTitle: 'Loggia' };
  if (code.startsWith('LIVING_')) return { groupKey: 'LIVING', groupTitle: 'Living' };
  if (code.startsWith('ELECTRICAL_')) return { groupKey: 'ELECTRICAL', groupTitle: 'Electricidad' };
  if (code.startsWith('PUERTA_') || code.startsWith('DOOR_')) return { groupKey: 'DOORS', groupTitle: 'Puertas' };
  if (code.startsWith('REJA_')) return { groupKey: 'ENTRADA', groupTitle: 'Entrada' };
  if (code.startsWith('ELEVATOR') || code.startsWith('ASCENSOR')) return { groupKey: 'ELEVATOR', groupTitle: 'Ascensor' };
  if (code.startsWith('CERTIFICADO')) return { groupKey: 'CERTIFICADO', groupTitle: 'Certificado verde' };
  if (code.startsWith('ESTACIONAMIENTO') || code.startsWith('PARKING')) return { groupKey: 'PARKING', groupTitle: 'Estacionamiento' };
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
  const propType = String(input.propertyType || 'DEPARTMENT').toUpperCase();
  const isDept = propType === 'DEPARTMENT';
  const isHouse = propType === 'HOUSE';

  // ——— Recorrido: certificados (1° verde, 2° ascensor), entrada, tablero, cocina… ———

  if (input.hasGreenCertificate && isDept) {
    plan.push({ slotCode: 'CERTIFICADO_VERDE', title: 'Certificado verde', instructions: buildInstruction({
      indicaciones: 'Foto frontal del documento, sin reflejos fuertes.',
      donde: 'Certificado verde o certificación energética del departamento.',
      que: 'Que el documento sea legible y que las fechas visibles indiquen vigencia.'
    }), required: false });
  }

  if (isDept && input.hasElevator) {
    plan.push({
      slotCode: 'ASCENSOR_CERTIFICADO_INSPECCION',
      title: 'Ascensor – Certificado de inspección',
      instructions: buildInstruction({
        indicaciones: 'Segunda foto del recorrido. Enfoca el certificado o placa; evita reflejos y desenfoque.',
        donde: 'Certificado o placa de inspección del ascensor (hall, marco de cabina o cartelera del edificio).',
        que: 'Verificar que el certificado sea legible y que esté vigente (fechas de inspección y/o vencimiento visibles).'
      }),
      required: true
    });
  }

  plan.push({ slotCode: 'PUERTA_ENTRADA', title: 'Puerta de entrada', instructions: buildInstruction({
    indicaciones: '', donde: 'Puerta de entrada principal, interior y marco.', que: 'Estado de puerta, bisagras, herrajes y marco.'
  }), required: true });

  if (isHouse && input.hasEntranceGrille) {
    plan.push({ slotCode: 'REJA_ENTRADA', title: 'Reja de entrada', instructions: buildInstruction({
      indicaciones: '', donde: 'Reja o cerramiento metálico del acceso (peatonal o vehicular) en la entrada.',
      que: 'Fijación, óxido, deformaciones o estado general de seguridad aparente.'
    }), required: false });
  }

  plan.push({ slotCode: 'ELECTRICAL_PANEL', title: 'Tablero eléctrico', instructions: buildInstruction({
    indicaciones: '', donde: 'Tablero frontal, sin manipular.', que: 'Estado visual del tablero.'
  }), required: true });

  plan.push(
    { slotCode: 'KITCHEN_UNDER_SINK', title: 'Cocina – Bajo lavaplatos', instructions: buildInstruction({
      indicaciones: '', donde: 'Bajo lavaplatos mostrando conexiones y sifón.', que: 'Fugas, humedad y estado de conexiones.'
    }), required: true },
    { slotCode: 'KITCHEN_SINK_WALL', title: 'Cocina – Muro lavaplatos', instructions: buildInstruction({
      indicaciones: '', donde: 'Muro/encuentro lavaplatos.', que: 'Manchas, sellos o humedad en muro.'
    }), required: true },
    { slotCode: 'KITCHEN_COUNTERTOP', title: 'Cocina – Cubiertas', instructions: buildInstruction({
      indicaciones: '', donde: 'Cubierta de cocina y encuentros con muro.', que: 'Golpes, sellos, fisuras o desprendimientos.'
    }), required: true },
    { slotCode: 'KITCHEN_CABINETS', title: 'Cocina – Muebles', instructions: buildInstruction({
      indicaciones: '', donde: 'Muebles de cocina (puertas y bisagras).', que: 'Hinchazón, desprendimientos o herrajes sueltos.'
    }), required: true },
    { slotCode: 'KITCHEN_OUTLETS', title: 'Cocina – Enchufes', instructions: buildInstruction({
      indicaciones: '', donde: 'Enchufes y entorno.', que: 'Estado de enchufes/placas.'
    }), required: true },
    { slotCode: 'KITCHEN_WINDOW', title: 'Cocina – Ventana', instructions: buildInstruction({
      indicaciones: '', donde: 'Ventana completa, marcos y sello.', que: 'Sellos, marcos y humedad en ventana.'
    }), required: true }
  );

  if (input.hasLaundry) {
    plan.push(
      { slotCode: 'LAUNDRY_WALLS_FLOOR', title: 'Loggia – Muros y piso', instructions: buildInstruction({
        indicaciones: '', donde: 'Muros y piso de la loggia.', que: 'Humedad, fisuras o daños.'
      }), required: true }
    );
  }

  plan.push(
    { slotCode: 'LIVING_WALLS', title: 'Living – Muros', instructions: buildInstruction({
      indicaciones: '', donde: 'Muros del living con pintura visible.', que: 'Pintura, fisuras o manchas.'
    }), required: true },
    { slotCode: 'LIVING_CEILING', title: 'Living – Cielo', instructions: buildInstruction({
      indicaciones: '', donde: 'Cielo del living y terminaciones.', que: 'Terminaciones y humedad en cielo.'
    }), required: true },
    { slotCode: 'LIVING_FLOOR', title: 'Living – Piso', instructions: buildInstruction({
      indicaciones: '', donde: 'Piso del living, terminaciones visibles.', que: 'Estado de piso/terminación.'
    }), required: true },
    { slotCode: 'LIVING_WINDOWS', title: 'Living – Ventanas', instructions: buildInstruction({
      indicaciones: '', donde: 'Ventanas completas, marcos y sello.', que: 'Sellos, marcos o filtraciones.'
    }), required: true },
    { slotCode: 'LIVING_SWITCHES', title: 'Living – Interruptores', instructions: buildInstruction({
      indicaciones: '', donde: 'Interruptores y placas.', que: 'Estado de interruptores/placas.'
    }), required: true }
  );

  // ——— 2. Dormitorio principal + Baño principal, luego D2+B2, D3+B3… (KPIs de cada zona en su orden) ———
  const pairs = Math.max(bedCount, bathCount);
  for (let i = 1; i <= pairs; i++) {
    if (i <= bedCount) {
      plan.push(
        { slotCode: `BEDROOM_${i}_WALLS`, title: `Dormitorio ${i} – Muros`, instructions: buildInstruction({
          indicaciones: '', donde: 'Muros del dormitorio con pintura visible.', que: 'Pintura, fisuras o manchas.'
        }), required: true },
        { slotCode: `BEDROOM_${i}_FLOOR`, title: `Dormitorio ${i} – Piso`, instructions: buildInstruction({
          indicaciones: '', donde: 'Piso del dormitorio, terminaciones visibles.', que: 'Estado de piso/terminación.'
        }), required: true },
        { slotCode: `BEDROOM_${i}_CLOSET`, title: `Dormitorio ${i} – Clóset`, instructions: buildInstruction({
          indicaciones: '', donde: 'Puertas, repisas y herrajes del clóset.', que: 'Hinchazón, desprendimientos o herrajes sueltos.'
        }), required: true },
        { slotCode: `BEDROOM_${i}_WINDOWS`, title: `Dormitorio ${i} – Ventanas`, instructions: buildInstruction({
          indicaciones: '', donde: 'Ventanas completas, marcos y sello.', que: 'Sellos, marcos o filtraciones.'
        }), required: true }
      );
    }
    if (i <= bathCount) {
      const label = i === 1 ? 'Baño principal' : (i === 2 ? 'Baño secundario' : `Baño ${i}`);
      plan.push(
        { slotCode: `BATHROOM_${i}_SHOWER`, title: `${label} – Interior tina / ducha`, instructions: buildInstruction({
          indicaciones: '', donde: 'Zona de ducha/tina y muro cercano.', que: 'Sellos, juntas, humedad o manchas alrededor de la tina/ducha.'
        }), required: true },
        { slotCode: `BATHROOM_${i}_SINK`, title: `${label} – Lavamanos`, instructions: buildInstruction({
          indicaciones: '', donde: 'Lavamanos y cubierta, vista frontal.', que: 'Grifería, sellos, manchas en cubierta.'
        }), required: true },
        { slotCode: `BATHROOM_${i}_SINK_PIPES`, title: `${label} – Cañerías lavamanos`, instructions: buildInstruction({
          indicaciones: '', donde: 'Bajo lavamanos mostrando sifón y conexiones.', que: 'Fugas, óxido, humedad en sifón y conexiones.'
        }), required: true },
        { slotCode: `BATHROOM_${i}_WC`, title: `${label} – WC`, instructions: buildInstruction({
          indicaciones: '', donde: 'WC y base, vista frontal.', que: 'Base, sellos y manchas alrededor del WC.'
        }), required: true },
        { slotCode: `BATHROOM_${i}_WC_PIPES`, title: `${label} – Cañerías WC`, instructions: buildInstruction({
          indicaciones: '', donde: 'Conexión de agua y base del WC.', que: 'Conexión de agua y posibles fugas.'
        }), required: true },
        { slotCode: `BATHROOM_${i}_CEILING`, title: `${label} – Cielo`, instructions: buildInstruction({
          indicaciones: '', donde: 'Cielo del baño con buena iluminación.', que: 'Humedad, moho o manchas en cielo.'
        }), required: true },
        { slotCode: `BATHROOM_${i}_OUTLETS`, title: `${label} – Enchufes`, instructions: buildInstruction({
          indicaciones: '', donde: 'Enchufes y entorno cercano.', que: 'Estado de enchufes/placas y fijación.'
        }), required: true }
      );
    }
  }

  return plan.map((slot) => ({
    ...slot,
    kpiKey: classifyKpiFromSlot(slot, scoreConfig?.slotKpiMap)
  }));
}

async function queueOpenAiSlotAnalysis({ slotId }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;
  const runtimeCfg = await getRuntimeScoreConfig();
  const activeScoreConfig = runtimeCfg.config || scoreConfig;

  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    include: { photo: true }
  }).catch(() => null);
  if (!slot?.photo?.filePath) return;

  const filePath = slot.photo.filePath;
  const mimeType = slot.photo.mimeType || 'image/jpeg';
  let imageInput;

  try {
    const buf = await storage.readBuffer(filePath);
    const b64 = buf.toString('base64');
    imageInput = { type: 'input_image', image_url: `data:${mimeType};base64,${b64}` };
  } catch (e) {
    fastify.log.warn(e, 'openai-read-photo');
    return;
  }

  const maxAttempts = 3;
  const retryDelayMs = 2000;
  let lastError;
  let kbBlockCache = null; // se calcula una vez aunque haya reintentos
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
    const kpiKey = classifyKpiFromSlot(slot, activeScoreConfig?.slotKpiMap);
    const photoUrl = imageInput?.image_url;
    const slotCodeUpper = String(slot.slotCode || '').toUpperCase();

    // Sin detectores auxiliares ni reglas por slot: criterio de análisis en Admin.

    const kpiCriteriaDesc = {
      MUROS_PINTURA: 'estado de muros, cielos y pintura',
      HUMEDAD: 'presencia de humedad o filtraciones',
      PISOS: 'estado de pisos y superficies',
      SANITARIOS: 'estado de artefactos sanitarios y cañerías',
      ELECTRICIDAD: 'instalación eléctrica visible',
      VENTANAS_CERRAMIENTOS: 'ventanas y cerramientos',
      PUERTAS_HERRAJES: 'puertas y herrajes',
      MOBILIARIO_FIJO: 'mobiliario fijo',
      DOCUMENTOS_CUMPLIMIENTO: 'vigencia y legibilidad de certificados o documentos regulatorios'
    };
    const criteriaDesc = kpiCriteriaDesc[String(kpiKey || '').toUpperCase()] || 'el criterio evaluado';
    const areaInfo = slotGroupTitleFromCode(slot.slotCode);
    const areaDesc = slot.title || `${areaInfo.groupTitle} – ${String(slot.slotCode || '').replace(/_/g, ' ')}`;

    const generalPrompt = activeScoreConfig?.aiPrompts?.GENERAL
      || DEFAULT_SCORE_CONFIG.aiPrompts?.GENERAL
      || '';
    const kpiPrompt = activeScoreConfig?.aiPrompts?.[kpiKey]
      || DEFAULT_SCORE_CONFIG.aiPrompts?.[kpiKey]
      || '';
    const promptTemplate = [generalPrompt, kpiPrompt].filter(Boolean).join('\n\n')
      || [
      'Eres un inspector técnico profesional que realiza evaluaciones de inmuebles.',
      'Evalúa la imagen del área: {{AREA_DESCRIPTION}}, en cuanto a {{CRITERIA_DESCRIPTION}}.',
      'Redacta como un profesional: lenguaje claro, objetivo y técnico.',
      'Entrega el resultado en formato estructurado.'
    ].join('\n');
    const findingExamplesBlock = formatAiFindingExamplesBlock(kpiKey, activeScoreConfig);
    let resolvedPrompt = String(promptTemplate)
      .replace(/\{\{SLOT_CODE\}\}/g, areaDesc)
      .replace(/\{\{AREA_DESCRIPTION\}\}/g, areaDesc)
      .replace(/\{\{CRITERIA_DESCRIPTION\}\}/g, criteriaDesc);
    if (findingExamplesBlock) resolvedPrompt += findingExamplesBlock;
    // KB unificada (RAG): criterios aprendidos de revisiones ITO
    if (kbBlockCache === null) {
      kbBlockCache = await getKbPromptBlock({
        prisma,
        text: `${areaDesc}. ${criteriaDesc}`,
        kpiKey,
        sources: ['AINSPECTA', 'PROPERTYCHECK'],
        log: fastify.log
      });
    }
    if (kbBlockCache) resolvedPrompt += `\n${kbBlockCache}`;
    const docPre = isDocumentComplianceSlot(slotCodeUpper)
      ? documentAnalysisPromptPreamble(slotCodeUpper)
      : '';
    const electricPre =
      String(kpiKey || '').toUpperCase() === 'ELECTRICIDAD' ? electricAnalysisPromptPreamble(slotCodeUpper) : '';
    const prompt = docPre + electricPre + resolvedPrompt;
    const outputFormat = [
      '',
      'Formato de salida (JSON válido):',
      '{',
      '  "description": "Descripción objetiva de lo visible",',
      '  "kpi_analysis": "Conclusión solo según el KPI",',
      '  "signals_detected": ["..."],',
      '  "details": [',
      '    { "signal": "...", "location": "...", "extent": "localizado|moderado|extendido" }',
      '  ],',
      '  "proposed_severity": "low|medium|high|none",',
      '  "severity_reason": "fundamento breve de severidad",',
      '  "matches_slot": true,',
      '  "match_confidence": 0.0,',
      '  "match_reason": "Justificación breve de correspondencia al slot",',
      '  "confidence": 0.0',
      '}',
      '',
      'Reglas obligatorias:',
      '- Si la imagen NO muestra el área o elemento solicitado en el slot (p.ej. cocina/muro lavaplatos y se ve living u otra habitación), pon matches_slot=false, proposed_severity="none", signals_detected=[] y details=[]. Explica en description y kpi_analysis por qué no corresponde. No inventes daños ni severidad del KPI sobre una zona que no está en el encuadre.',
      '- En slots de INTERRUPTORES o ENCHUFES de pared: NO marques matches_slot=false solo porque no se ve tablero eléctrico o interruptor diferencial; eso no aplica a ese ítem.'
    ].join('\n');

    const response = await client.responses.create({
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: `${prompt}\n${outputFormat}` },
            { type: 'input_image', image_url: photoUrl }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'image_analysis',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              description: { type: 'string', minLength: 1 },
              kpi_analysis: { type: 'string', minLength: 1 },
              signals_detected: { type: 'array', items: { type: 'string' } },
              details: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    signal: { type: 'string' },
                    location: { type: 'string' },
                    extent: { type: 'string', enum: ['localizado', 'moderado', 'extendido'] }
                  },
                  required: ['signal', 'location', 'extent']
                }
              },
              proposed_severity: { type: 'string', enum: ['low', 'medium', 'high', 'none'] },
              severity_reason: { type: 'string', minLength: 1 },
              matches_slot: { type: 'boolean' },
              match_confidence: { type: 'number' },
              match_reason: { type: 'string', minLength: 1 },
              confidence: { type: 'number' }
            },
            required: ['description', 'kpi_analysis', 'signals_detected', 'details', 'proposed_severity', 'severity_reason', 'matches_slot', 'match_confidence', 'match_reason', 'confidence']
          }
        }
      },
      temperature: 0.2
    });

    const rawText = String(response.output_text || '').trim();
    if (!rawText) return;

    const parseJson = (text) => {
      try {
        return JSON.parse(text);
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
          return JSON.parse(match[0]);
        } catch {
          return null;
        }
      }
    };

    const parsed = parseJson(rawText) || {};
    const kpiLabelMap = {
      MUROS_PINTURA: 'muros y pintura',
      HUMEDAD: 'humedad visible',
      PISOS: 'pisos',
      SANITARIOS: 'sanitarios',
      ELECTRICIDAD: 'electricidad visible',
      VENTANAS_CERRAMIENTOS: 'ventanas y cerramientos',
      PUERTAS_HERRAJES: 'puertas y herrajes',
      MOBILIARIO_FIJO: 'mobiliario fijo'
    };
    const sanitizeTechnicalCodes = (text) => {
      if (!text || typeof text !== 'string') return text;
      return text
        .replace(/\bLIVING_CEILING\b/gi, 'el techo del living')
        .replace(/\bLIVING_WALLS\b/gi, 'los muros del living')
        .replace(/\bLIVING_FLOOR\b/gi, 'el piso del living')
        .replace(/\bBATHROOM_\d+_\w+/g, (m) => m.replace(/_/g, ' ').toLowerCase())
        .replace(/\bKITCHEN_\w+/g, (m) => m.replace(/_/g, ' ').toLowerCase())
        .replace(/\bBEDROOM_\d+_\w+/g, (m) => m.replace(/_/g, ' ').toLowerCase());
    };
    let description = sanitizeTechnicalCodes(String(parsed.description || '').trim());
    let kpiAnalysis = sanitizeTechnicalCodes(String(parsed.kpi_analysis || '').trim());
    let signals = Array.isArray(parsed.signals_detected) ? parsed.signals_detected.map((s) => sanitizeTechnicalCodes(String(s))) : [];
    // Filtrar señales de calidad de imagen: las fotos ya pasaron validación en captura
    const qualityIssuePatterns = [
      /image_quality_issue/i, /calidad\s*(de\s*)?(imagen|foto)/i, /retomar\s*(la\s*)?foto/i,
      /falta\s*de\s*claridad/i, /imagen\s*borrosa/i, /blur/i, /poca\s*iluminación/i
    ];
    signals = signals.filter((sig) => {
      const s = String(sig || '').toLowerCase();
      return !qualityIssuePatterns.some((p) => p.test(s) || s.includes('image_quality'));
    });
    // Eliminar recomendaciones de retomar fotos en texto (las fotos ya pasaron validación)
    const removeRetakePhrases = (text) => {
      if (!text || typeof text !== 'string') return text;
      return text
        .replace(/\s*No\s+se\s+puede\s+evaluar\s+por\s+falta\s+de\s+claridad\.?\s*/gi, ' ')
        .replace(/\s*Se\s+recomienda\s+retomar\s+(la\s+)?fotograf[ií]a\.?\s*/gi, ' ')
        .replace(/\s*Se\s+sugiere\s+retomar\s+(la\s+)?foto\.?\s*/gi, ' ')
        .replace(/\s*Retomar\s+(la\s+)?fotograf[ií]a\s+recomendado\.?\s*/gi, ' ')
        .replace(/\s*,\s*lo\s+que\s+dificulta\s+(la\s+)?visibilidad\.?\s*/gi, '. ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    };
    kpiAnalysis = removeRetakePhrases(kpiAnalysis);
    description = removeRetakePhrases(description);
    let details = Array.isArray(parsed.details) ? [...parsed.details] : [];
    if (String(kpiKey || '').toUpperCase() === 'SANITARIOS') {
      const blobInterv = `${description} ${kpiAnalysis} ${signals.join(' ')}`.toLowerCase();
      const claimsNonStandard = /\bintervenc(i[oó]n|ion)\s+no\s+est(aá)ndar/i.test(blobInterv);
      const strongPlumbingIntervention =
        /\b(cinta\s+aislant|huincha|contrahuinch|tefl[oó]n\s+.{0,24}(excesiv|abundant|desorden)|empalme\s+.{0,32}(abiert|r[uú]stic|visible)|soldadur\w*.{0,20}(irregular|deficient|fr[ií]a)|abrazadera\w*.{0,20}(improv|pl[aá]stic|m[uú]ltiple)|rosca\w*.{0,20}destroz|pvc\w*.{0,40}(metal|flexible)|manguera\s+per\b|\bperico\b|uni[oó]n\s+mixta|relleno\s+con\s+masilla)/i.test(blobInterv);
      if (claimsNonStandard && !strongPlumbingIntervention) {
        signals = signals.filter((sig) => !/\bintervenc(i[oó]n|ion)\s+no\s+est(aá)ndar/i.test(String(sig || '')));
        details = details.filter((d) => !/\bintervenc(i[oó]n|ion)\s+no\s+est(aá)ndar/i.test(String(d?.signal || '')));
        const scrubInterventionClaim = (t) => {
          let s = String(t || '');
          s = s.replace(/\s*,\s*y\s+una\s+intervenc(i[oó]n|ion)\s+no\s+est(aá)ndar(\s+visible)?\b/gi, '');
          s = s.replace(/\s*y\s+una\s+intervenc(i[oó]n|ion)\s+no\s+est(aá)ndar(\s+visible)?\b/gi, '');
          s = s.replace(/\bintervenc(i[oó]n|ion)\s+no\s+est(aá)ndar(\s+visible)?\b/gi, '');
          return s.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').replace(/,\s*\./g, '.').trim();
        };
        description = scrubInterventionClaim(description);
        kpiAnalysis = scrubInterventionClaim(kpiAnalysis);
      }
    }
    const proposedSeverityRaw = String(parsed.proposed_severity || '').trim().toLowerCase();
    const proposedSeverity = ['low', 'medium', 'high'].includes(proposedSeverityRaw) ? proposedSeverityRaw : null;
    const severityReason = String(parsed.severity_reason || '').trim() || 'Sin fundamento de severidad.';
    let matchesSlot = typeof parsed.matches_slot === 'boolean' ? parsed.matches_slot : true;
    const matchConfidence = Math.max(0, Math.min(1, Number(parsed.match_confidence ?? 0.7)));
    const matchReason = String(parsed.match_reason || '').trim() || 'No se entregó justificación de correspondencia.';
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.7)));
    const extentText = details.map((d) => String(d?.extent || '').toLowerCase());
    const hasWide = extentText.some((t) => t.includes('extend') || t.includes('general') || t.includes('ampl'));
    let analysisLower = `${description} ${kpiAnalysis}`.toLowerCase();
    // Frases que indican ausencia de problemas. Evitar subcadenas sueltas como "no se observan"
    // (coincide con "No se observan piezas trizadas..." y anula severidad pese a rayones/desgaste).
    const favorableNoIssuePhrases = [
      'sin observaciones',
      'sin hallazgos relevantes',
      'no se observan hallazgos',
      'no se observan hallazgos relevantes',
      'no se observan problemas',
      'no se observan problemas relevantes',
      'no se observan anomalías',
      'no se observan anomalias',
      'no se observan señales relevantes',
      'no se observan daños relevantes',
      'no se identifican hallazgos',
      'no se identifican hallazgos relevantes',
      'no se identifican problemas',
      'no se detectan hallazgos',
      'no se detectan hallazgos relevantes',
      'no se detectan problemas',
      'sin señales',
      'sin señales evidentes',
      'condiciones adecuadas',
      'condición adecuada',
      'sin daños',
      'sin deterioros',
      'sin anomalías',
      'sin anomalias',
      'sin signos',
      'no presenta señales'
    ];
    let analysisSaysNoIssue = favorableNoIssuePhrases.some((p) => analysisLower.includes(p));
    // Si la narración niega hallazgos, no dejar que signals_detected contradictorios fuercen severidad (ej. "no hallazgos" + señal "desgaste").
    if (analysisSaysNoIssue && signals.length) {
      signals.length = 0;
    }
    const signalsLower = signals.map((sig) => String(sig || '').toLowerCase());
    let hasRealDefect = combinedTextHasAffirmativeDefectMention(
      String(description || '').toLowerCase(),
      String(kpiAnalysis || '').toLowerCase(),
      signalsLower
    );
    const kpiLowerOnly = String(kpiAnalysis || '').toLowerCase();
    const kpiConcludesNoRelevantFindings = favorableNoIssuePhrases.some((p) => kpiLowerOnly.includes(p));
    if (kpiConcludesNoRelevantFindings && signals.length === 0) {
      hasRealDefect = false;
    }
    if (hasRealDefect) {
      analysisSaysNoIssue = false;
    }
    // Si el KPI concluye explícitamente sin hallazgos relevantes, esa narrativa prima sobre la descripción
    // (menciones técnicas de sellos, condensación, etc. suelen disparar regex sin ser un defecto afirmado).
    const kpiConclusionContradictsItself = /\b(excepto|salvo|a excepci[oó]n de|pero\s+s[ií]\s+hay|sin embargo[,]?\s+(?:s[ií]|hay|se observa))\b/i.test(kpiLowerOnly);
    if (kpiConcludesNoRelevantFindings && !kpiConclusionContradictsItself) {
      analysisSaysNoIssue = true;
      signals.length = 0;
      hasRealDefect = false;
    }

    // Sin reglas específicas por KPI/slot: solo coherencia genérica.
    if (analysisSaysNoIssue) {
      signals = [];
      hasRealDefect = false;
    }
    analysisLower = `${description} ${kpiAnalysis}`.toLowerCase();
    if (!description) {
      description = 'Descripcion no disponible.';
    }
    if (!kpiAnalysis) {
      kpiAnalysis = signals.length
        ? 'Se observan señales visibles en el área evaluada.'
        : 'No se observan problemas en el área evaluada.';
    }
    if (kpiAnalysis.length < 120) {
      const defectPaddingContext =
        signals.length > 0 ||
        hasRealDefect ||
        !!proposedSeverity;
      const extra = defectPaddingContext
        ? 'Se aprecian detalles en el encuadre que conviene describir con precisión (ubicación y extensión) en coherencia con lo observado.'
        : 'Las superficies se ven uniformes y sin evidencias claras de deterioro.';
      kpiAnalysis = `${kpiAnalysis} ${extra}`.trim();
    }
    matchesSlot = correctWallElectricMatchesSlotFalsePositive({
      kpiKey,
      slotCode: slotCodeUpper,
      matchesSlot,
      description,
      kpiAnalysis,
      matchReason
    });
    const severityRank = { none: 0, low: 1, medium: 2, high: 3 };
    const normalizeSeverity = (value) => {
      const s = String(value || '').toLowerCase();
      return ['low', 'medium', 'high'].includes(s) ? s : null;
    };
    let severityFromEvidence = (() => {
      if (analysisSaysNoIssue && (activeScoreConfig?.severityRules?.enforceFavorableOk ?? true)) return null;
      if (hasWide) return 'high';
      const kpiRules = activeScoreConfig?.severityRules?.byKpi?.[String(kpiKey || '').toUpperCase()] || {};
      const criticalKeywords = Array.isArray(kpiRules.criticalKeywords) ? kpiRules.criticalKeywords : [];
      const hasCriticalByKpi = criticalKeywords.some((k) => {
        const kw = String(k || '').toLowerCase().trim();
        return !!kw && (analysisLower.includes(kw) || signals.some((sig) => String(sig || '').toLowerCase().includes(kw)));
      });
      if (hasCriticalByKpi) return 'high';
      if (signals.length >= 2 || details.some((d) => String(d?.extent || '').toLowerCase().includes('moderad'))) return 'medium';
      if (signals.length >= 1 || hasRealDefect) return 'low';
      return null;
    })();
    const chosenSeverity = (() => {
      if (analysisSaysNoIssue) return null;
      const proposed = normalizeSeverity(proposedSeverity);
      const minimum = normalizeSeverity(severityFromEvidence);
      if (!proposed && !minimum) return null;
      if (!proposed) return minimum;
      if (!minimum) return proposed;
      return severityRank[proposed] >= severityRank[minimum] ? proposed : minimum;
    })();
    let finalSeverity = chosenSeverity;
    let severitySource = analysisSaysNoIssue && finalSeverity === null
      ? 'forced_ok'
      : (finalSeverity && proposedSeverity && finalSeverity === proposedSeverity ? 'ai_proposed' : (finalSeverity ? 'rule_guardrail' : 'none'));
    let hasSignals = !!finalSeverity;
    let analysisCode = hasSignals ? 'COSMETIC_WEAR' : 'OK';
    if (hasSignals && String(kpiKey || '').toUpperCase() === 'VENTANAS_CERRAMIENTOS') {
      const fullLower = `${description} ${kpiAnalysis}`.toLowerCase();
      if (windowAnalysisSuggestsSealIssue(fullLower)) {
        analysisCode = 'SEAL_FAILURE';
      }
    }
    if (hasSignals && String(kpiKey || '').toUpperCase() === 'PISOS') {
      const fullLower = `${description} ${kpiAnalysis}`.toLowerCase();
      const detailsSig = (details || []).map((d) => String(d?.signal || '').toLowerCase()).join(' ');
      const sigJoined = [...signalsLower, detailsSig].filter(Boolean).join(' ');
      if (pisosAnalysisSuggestsJointMoistureDamage(fullLower, sigJoined)) {
        analysisCode = 'FLOOR_MOISTURE_JOINT_DAMAGE';
        if (finalSeverity === 'low') finalSeverity = 'medium';
        severitySource = 'rule_floor_joint_moisture';
      }
    }
    if (hasSignals && String(kpiKey || '').toUpperCase() === 'MOBILIARIO_FIJO') {
      const fullLower = `${description} ${kpiAnalysis}`.toLowerCase();
      const sigDetailLower = [
        ...signalsLower,
        ...(details || []).map((d) => String(d?.signal || '').toLowerCase())
      ].join(' ');
      const blob = `${fullLower} ${sigDetailLower}`;
      const hasStrongMisalignEvidence =
        /\b(hoja\s+(?:torcida|descuadrada)|folios?\s+sobresal|bisagra(?:s)?\s+.{0,40}despeg|desajuste\s+obvio|no\s+cierra\s+en\s+el\s+marco|hueco\s+evidente|puerta\s+ca[ií]da|fuera\s+de\s+cuadro)\b/i.test(blob) ||
        /\b(desalineaci[oó]n|desalineamiento)\s+(marcad[oa]|evidente|importante|clar[oa]|sever[oa])\b/i.test(blob) ||
        /\b(sever\w*|marcad\w*|evident\w*)\s+(?:desaline|descuadre)/i.test(blob);
      if ((finalSeverity === 'medium' || finalSeverity === 'high') && !hasStrongMisalignEvidence) {
        const weakMisalignOnly =
          /\b(liger[oa]|leve)\s+desaline/i.test(blob) ||
          /\bdesaline\w*\s+(liger[oa]|leve)\b/i.test(blob) ||
          /\bpuertas?\s+desalinead\w*\b/i.test(blob);
        if (weakMisalignOnly) {
          finalSeverity = 'low';
          severitySource = 'rule_mobiliario_weak_misalign_cap';
        }
      }
    }
    if (hasSignals && String(kpiKey || '').toUpperCase() === 'SANITARIOS') {
      const fullLower = `${description} ${kpiAnalysis}`.toLowerCase();
      const sigDetailLower = [
        ...signalsLower,
        ...(details || []).map((d) => String(d?.signal || '').toLowerCase())
      ].join(' ');
      const blob = `${fullLower} ${sigDetailLower}`;
      const weakHumidityLanguage =
        /\b(humedad|húmedo|húmeda|humedos|mojados?)\b/i.test(blob);
      const explicitActiveLeak =
        /\b(filtraci[oó]n\s+activa|fuga\s+activa|goteo\s+activo|goteando)\b/i.test(blob);
      const strongMoistureEvidence =
        /\b(gotas?|charco|efloresc|ampollas?\s+(?:en|de)|\binflad[ao]s?|moho\s+filament|brillo\s+[^\n]{0,16}mojad|pel[ií]cula\s+de\s+agua|capilaridad\s+clara|pintura\s+[^\n]{0,24}inflad|aureola\s+húmeda)\b/i.test(blob);
      if (weakHumidityLanguage && !strongMoistureEvidence && !explicitActiveLeak && (finalSeverity === 'medium' || finalSeverity === 'high')) {
        finalSeverity = 'low';
        severitySource = 'rule_sanitarios_humedad_evidence_cap';
      }
      const negatesOxide = /\b(sin\s+óxido|sin\s+oxido|sin\s+corrosi[oó]n|no\s+hay\s+óxido|no\s+hay\s+oxido|no\s+se\s+observa\s+óxido|no\s+se\s+observa\s+oxido|ausencia\s+de\s+óxido|ausencia\s+de\s+oxido)\b/i.test(blob);
      const blobOxideRule = String(blob)
        .replace(/\b(posible|podr[ií]a\s+ser|aparente|al\s+parecer|compatible\s+con)\s+[^.;]{0,140}?\b(óxido|oxido|corrosi[oó]n)\b/gi, ' ')
        .replace(/\bcorrosi[oó]n\s*\/\s*(óxido|oxido)\b/gi, ' ');
      const strongFerrousOxide =
        !negatesOxide &&
        (/\b(oxidaci[oó]n|oxidacion|oxidado|oxidada|oxidados|oxidadas|óxido\s+laminar|oxido\s+laminar|manchas?\s+rojiz|tonos?\s+cobriz|p[eé]rdida\s+.{0,36}(cromad|del\s+cromad)|desconchad[oa].{0,28}cromad|metal\s+.{0,20}(oxid|corroi))\b/i.test(blobOxideRule) ||
          /\b(óxido|oxido)\s+(visible|evidente|marcad[oa]|laminar)\b/i.test(blobOxideRule) ||
          /\bcorrosi[oó]n\s+visible\b/i.test(blobOxideRule) ||
          /\b(rust\s+stain|rust\s+on|oxidation\s+on)\b/i.test(blobOxideRule) ||
          (/\bcorrosi[oó]n\b/i.test(blobOxideRule) &&
            /\b(marcad[oa]|sever[oa]|importante|grave|conexiones?\s+corro[ií]d|corroi\w*\s+visible|visiblemente\s+corro)\b/i.test(blobOxideRule)));
      const grimeOrPaintOnlyNarrative =
        /\b(sarro|mineralizaci|cañer[ií]a[s]?\s+pintad|pintura\s+sobre|suciedad\s+acumulad|acumulaci[oó]n\s+de\s+(polvo|suciedad)|capa\s+mate|superficie\s+mate)\b/i.test(blob) &&
        !strongFerrousOxide;
      const wetSanitaryContext =
        /\b(tina|ducha|plato\s+de\s+ducha|mampara|bañera|wc|inodoro|lavamanos|lavabo|pileta|grifer[ií]a|desagüe|desague|drenaje|rejilla|sif[oó]n|cano\s+desag|conexiones?\s+visibles|baño|sanitario|porcelana|acr[ií]lico|ducha\s+tina)\b/i.test(blob);
      if (
        strongFerrousOxide &&
        wetSanitaryContext &&
        !grimeOrPaintOnlyNarrative &&
        (finalSeverity === 'medium' || finalSeverity === 'low')
      ) {
        finalSeverity = 'high';
        severitySource = 'rule_sanitarios_oxide_corrosion_min_high';
      }
    }
    if (String(kpiKey || '').toUpperCase() === 'DOCUMENTOS_CUMPLIMIENTO') {
      const docApplied = applyDocumentComplianceAnalysisRules({
        slotCode: slotCodeUpper,
        kpiKey,
        matchesSlot,
        description,
        kpiAnalysis,
        signals,
        details,
        proposedSeverity,
        finalSeverity,
        analysisSaysNoIssue,
        hasRealDefect
      });
      matchesSlot = docApplied.matchesSlot;
      description = docApplied.description;
      kpiAnalysis = docApplied.kpiAnalysis;
      signals = docApplied.signals;
      details = docApplied.details;
      finalSeverity = docApplied.finalSeverity;
      analysisSaysNoIssue = docApplied.analysisSaysNoIssue;
      hasRealDefect = docApplied.hasRealDefect;
      if (docApplied.analysisCode) {
        analysisCode = docApplied.analysisCode;
        hasSignals = docApplied.finalSeverity != null;
        severitySource = docApplied.severitySource || severitySource;
      }
    }

    if (hasSignals && electricPanelInferiorWearLikelyDirtOnly({
      slotCodeUpper,
      kpiKey,
      description,
      kpiAnalysis,
      signals,
      details
    })) {
      const scrubbed = scrubElectricPanelInferiorDirtNarrative(description, kpiAnalysis);
      description = scrubbed.description;
      kpiAnalysis = scrubbed.kpiAnalysis;
      signals = signals.filter((sig) => {
        const s = String(sig || '').toLowerCase();
        if (!/\b(desgaste|desgastad|deterioro)/i.test(s)) return true;
        if (/\b(inferior|fondo|base|bajo|parte\s+baja|riel)/i.test(s)) return false;
        return true;
      });
      details = details.filter((d) => {
        const s = String(d?.signal || '').toLowerCase();
        if (!/\b(desgaste|desgastad|deterioro)/i.test(s)) return true;
        if (/\b(inferior|fondo|base|bajo|parte\s+baja|riel)/i.test(s)) return false;
        return true;
      });
      finalSeverity = null;
      analysisCode = 'OK';
      hasSignals = false;
      severitySource = 'rule_electric_panel_inferior_dirt_not_wear';
    }
    if (hasSignals && wallSwitchAvCoaxialFalsePositive({
      slotCodeUpper,
      kpiKey,
      description,
      kpiAnalysis,
      signals,
      details
    })) {
      const scrubbed = scrubWallSwitchAvFalsePositiveNarrative(description, kpiAnalysis);
      description = scrubbed.description;
      kpiAnalysis = scrubbed.kpiAnalysis;
      signals = signals.filter((sig) => {
        const s = String(sig || '').toLowerCase();
        return !/\b(interruptor(?:es)?\s+sin\s+tapa|sin\s+tapa|mecanismos?\s+expuest|desgaste\s+visible)\b/i.test(s);
      });
      details = details.filter((d) => {
        const s = String(d?.signal || '').toLowerCase();
        return !/\b(interruptor(?:es)?\s+sin\s+tapa|sin\s+tapa|mecanismos?\s+expuest|desgaste\s+visible)\b/i.test(s);
      });
      finalSeverity = null;
      analysisCode = 'OK';
      hasSignals = false;
      severitySource = 'rule_wall_switch_av_not_missing_cover';
    }
    let message = hasSignals
      ? (kpiAnalysis || `Se detecta: ${signals.join(', ')}.`)
      : ((severitySource === 'rule_electric_panel_inferior_dirt_not_wear' || severitySource === 'rule_wall_switch_av_not_missing_cover') && String(kpiAnalysis || '').trim().length >= 50
        ? kpiAnalysis
        : 'Conclusión: no se observan hallazgos relevantes en esta evidencia.');
    let scorePenaltyApplied = hasSignals && kpiKey && activeScoreConfig?.kpis?.[kpiKey]
      ? Number(activeScoreConfig.kpis[kpiKey][String(finalSeverity).toLowerCase()] ?? 0)
      : 0;

    // Foto no corresponde al slot: el segundo análisis lo detecta; no debe afectar puntaje.
    if (!matchesSlot) {
      finalSeverity = null;
      analysisCode = 'OK';
      signals.length = 0;
      hasSignals = false;
      scorePenaltyApplied = 0;
      severitySource = 'slot_mismatch_no_penalty';
      const mergedNarrative = [kpiAnalysis, matchReason].map((x) => String(x || '').trim()).filter(Boolean).join(' ').trim();
      message =
        mergedNarrative.length >= 40
          ? `${mergedNarrative} No se aplica descuento al puntaje porque la evidencia no corresponde al elemento solicitado.`
          : `La imagen no corresponde al área solicitada para esta evidencia. No se aplica descuento al puntaje. ${matchReason || ''}`.trim();
    }

    const prevMessage = slot.analysisMessage || null;
    const nextDebug = {
      ...(slot.analysisDebug || {}),
      source: 'OPENAI',
      openai: {
        model,
        raw: rawText,
        parsed: {
          ...parsed,
          description,
          kpi_analysis: kpiAnalysis,
          signals_detected: signals,
          details,
          proposed_severity: proposedSeverityRaw || 'none',
          severity_reason: severityReason,
          final_severity: finalSeverity || null,
          severity_source: severitySource,
          matches_slot: matchesSlot,
          match_confidence: matchConfidence,
          match_reason: matchReason,
          score_penalty_applied: scorePenaltyApplied
        },
        kpiKey,
        at: new Date().toISOString()
      },
      severitySource,
      scorePenaltyApplied,
      v1Message: prevMessage
    };

    await prisma.slot.update({
      where: { id: slot.id },
      data: {
        analysisCode,
        analysisSeverity: finalSeverity,
        analysisConfidence: confidence,
        analysisMessage: message,
        analysisDebug: nextDebug,
        analyzedAt: new Date(),
        status: 'ANALYZED'
      }
    });

    await maybeNotifyExecutiveReportReady(slot.caseId);

    // La aprobación se dispara manualmente al terminar la inspección (botón "Terminar").
      return;
    } catch (err) {
      lastError = err;
      fastify.log.warn({ err: err?.message, slotId, attempt, maxAttempts }, 'openai-slot-analysis-failed');
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  fastify.log.error({ err: lastError?.message, slotId }, 'openai-slot-analysis-exhausted');
}

async function validateSlotMatchWithOpenAI({ buffer, mimeType = 'image/jpeg', slotTitle = '', slotCode = '', instructions = '' }) {
  const COMPONENT_TYPES = [
    'SHOWER',
    'SINK',
    'SINK_PIPES',
    'WC',
    'WC_PIPES',
    'CEILING',
    'OUTLETS',
    'UNDER_SINK',
    'SINK_WALL',
    'COUNTERTOP',
    'CABINETS',
    'WINDOW',
    'WALLS',
    'FLOOR',
    'SWITCHES',
    'CLOSET',
    'ELECTRICAL_PANEL',
    'ENTRY_DOOR',
    'ELEVATOR',
    'INSPECTION_CERTIFICATE',
    'PARKING',
    'CERTIFICATE',
    'OTHER'
  ];
  const inferExpectedComponent = (code = '') => {
    const c = String(code || '').toUpperCase();
    if (c.includes('_SHOWER')) return 'SHOWER';
    if (c.includes('_SINK_PIPES')) return 'SINK_PIPES';
    if (c.includes('_WC_PIPES')) return 'WC_PIPES';
    if (c.endsWith('_SINK')) return 'SINK';
    if (c.endsWith('_WC')) return 'WC';
    if (c.endsWith('_CEILING')) return 'CEILING';
    if (c.endsWith('_OUTLETS')) return 'OUTLETS';
    if (c.includes('UNDER_SINK')) return 'UNDER_SINK';
    if (c.includes('SINK_WALL')) return 'SINK_WALL';
    if (c.includes('COUNTERTOP')) return 'COUNTERTOP';
    if (c.includes('CABINETS')) return 'CABINETS';
    if (c.endsWith('_WINDOW') || c.endsWith('_WINDOWS')) return 'WINDOW';
    if (c.endsWith('_WALLS') || c.includes('WALLS_FLOOR')) return 'WALLS';
    if (c.endsWith('_FLOOR')) return 'FLOOR';
    if (c.endsWith('_SWITCHES')) return 'SWITCHES';
    if (c.endsWith('_CLOSET')) return 'CLOSET';
    if (c === 'ELECTRICAL_PANEL') return 'ELECTRICAL_PANEL';
    if (c === 'PUERTA_ENTRADA' || c === 'DOOR_ENTRY') return 'ENTRY_DOOR';
    if (c === 'ELEVATOR' || c.startsWith('ASCENSOR')) return 'INSPECTION_CERTIFICATE';
    if (c === 'ESTACIONAMIENTO' || c === 'PARKING') return 'PARKING';
    if (c === 'CERTIFICADO_VERDE' || c === 'GREEN_CERTIFICATE') return 'CERTIFICATE';
    return 'OTHER';
  };
  const COMPATIBLE_COMPONENTS = {
    CEILING: new Set(['WALLS']),
    WALLS: new Set(['CEILING']),
    OUTLETS: new Set(['SWITCHES']),
    SWITCHES: new Set(['OUTLETS']),
    UNDER_SINK: new Set(['SINK_PIPES', 'SINK']),
    SINK_PIPES: new Set(['UNDER_SINK', 'SINK']),
    SINK: new Set(['UNDER_SINK', 'SINK_PIPES']),
    WC: new Set(['WC_PIPES']),
    WC_PIPES: new Set(['WC'])
  };
  const isCompatibleComponent = (expected, detected) => {
    if (!expected || !detected) return false;
    if (expected === detected) return true;
    const allowed = COMPATIBLE_COMPONENTS[expected];
    return !!(allowed && allowed.has(detected));
  };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    fastify.log.warn('validateSlotMatchWithOpenAI: OPENAI_API_KEY no configurado. La foto se rechazará si SLOT_MATCH_FAIL_OPEN no es true.');
    return { checked: false, matchesSlot: true, confidence: 0, reason: 'OPENAI no configurado.' };
  }

  try {
    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_SLOT_MATCH_MODEL || process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
    // Reducir tamaño para enviar a OpenAI (respuesta más rápida y menos costo)
    let bufferForVision = buffer;
    let mimeForVision = mimeType;
    try {
      const resized = await sharp(buffer)
        .resize(1024, null, { withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      bufferForVision = resized;
      mimeForVision = 'image/jpeg';
    } catch {
      // usar buffer original si falla el resize
    }
    const b64 = bufferForVision.toString('base64');
    const imageUrl = `data:${mimeForVision};base64,${b64}`;
    const areaLabel = String(slotTitle || slotCode || 'área esperada').trim();
    const expectedComponent = inferExpectedComponent(slotCode);
    if (expectedComponent === 'OTHER') {
      return { checked: false, matchesSlot: true, confidence: 1, reason: 'Slot sin clasificación de componente.' };
    }
    const hintByComponent = {
      COUNTERTOP: ' COUNTERTOP = superficie horizontal de trabajo (mesada/cubierta), no el muro ni el revestimiento de azulejos. Si la imagen muestra principalmente un muro con azulejos o un backsplash vertical, usa detected_component="WALLS".',
      SINK_WALL: ' SINK_WALL = muro o encuentro detrás del lavaplatos. Si solo se ve la cubierta o el mueble sin el muro, no uses WALLS.',
      CABINETS: ' CABINETS = muebles de cocina (puertas, gabinetes). Si se ve una puerta de habitación o baño, no es CABINETS.'
    };
    const hint = hintByComponent[expectedComponent] ? `\nAclaración para este slot:${hintByComponent[expectedComponent]}` : '';
    fastify.log.info({ slotCode, expectedComponent, slotTitle: areaLabel }, 'Validando correspondencia de foto con OpenAI (slot match)');
    const prompt = [
      'Clasifica el componente principal visible en la foto para validar correspondencia de slot.',
      `Slot esperado: ${areaLabel}`,
      `Código de slot: ${String(slotCode || '').trim() || 'N/A'}`,
      `Componente esperado (estricto): ${expectedComponent}`,
      `Indicaciones del slot: ${String(instructions || '').trim() || 'N/A'}`,
      `Componentes permitidos: ${COMPONENT_TYPES.join(', ')}`,
      hint,
      '',
      'Regla estricta: si no se aprecia claramente el componente esperado, usa detected_component="OTHER".',
      'No respondas por el contexto general del inmueble; evalúa solo el componente principal visible.',
      'Responde SOLO con JSON válido según el schema.'
    ].filter(Boolean).join('\n');

    const response = await client.responses.create({
      model,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: imageUrl }
        ]
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'slot_match',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              detected_component: { type: 'string', enum: COMPONENT_TYPES },
              match_confidence: { type: 'number' },
              match_reason: { type: 'string', minLength: 1 }
            },
            required: ['detected_component', 'match_confidence', 'match_reason']
          }
        }
      },
      temperature: 0
    });

    const text = String(response.output_text || '').trim();
    const parseJson = (raw) => {
      try { return JSON.parse(raw); } catch {}
      const match = String(raw || '').match(/\{[\s\S]*\}/);
      if (!match) return null;
      try { return JSON.parse(match[0]); } catch { return null; }
    };
    const parsed = text ? parseJson(text) : null;
    const detectedComponent = String(parsed?.detected_component || 'OTHER').toUpperCase();
    const confidence = Math.max(0, Math.min(1, Number(parsed?.match_confidence ?? 0)));
    const reason = String(parsed?.match_reason || '').trim() || 'Sin justificación.';
    const matchesSlot = isCompatibleComponent(expectedComponent, detectedComponent);
    const exactMatch = detectedComponent === expectedComponent;
    // CIELO suele tener baja textura y mezcla visual con muros/encuentros.
    // Si no hay evidencia concluyente, no rechazamos por mismatch.
    if (expectedComponent === 'CEILING' && (detectedComponent === 'OTHER' || !exactMatch) && confidence < 0.8) {
      return { checked: false, matchesSlot: true, confidence, reason, model, expectedComponent, detectedComponent };
    }
    // Si la IA responde OTHER con baja confianza, no lo tratamos como mismatch concluyente.
    if (detectedComponent === 'OTHER' && confidence < 0.65) {
      return { checked: false, matchesSlot: true, confidence, reason, model, expectedComponent, detectedComponent };
    }
    // Si es componente compatible (pero no exacto) y con confianza moderada/baja, evitar falso rechazo.
    if (matchesSlot && !exactMatch && confidence < 0.7) {
      return { checked: false, matchesSlot: true, confidence, reason, model, expectedComponent, detectedComponent };
    }
    return { checked: true, matchesSlot, confidence, reason, model, expectedComponent, detectedComponent };
  } catch (err) {
    fastify.log.warn(err, 'slot-match-openai');
    return { checked: false, matchesSlot: true, confidence: 0, reason: 'No fue posible validar correspondencia con IA.' };
  }
}

/** Encola análisis OpenAI para slots del caso que tengan foto pero no tengan análisis por IA (para asegurar que todos se analicen). */
function queueMissingOpenAiAnalyses(caseId) {
  if (!prisma || typeof queueOpenAiSlotAnalysis !== 'function') return;
  setImmediate(async () => {
    try {
      const slots = await prisma.slot.findMany({
        where: { caseId },
        include: { photo: true }
      });
      const missing = slots.filter(
        (s) => s.photo?.filePath && !String(s.analysisDebug?.openai?.parsed?.description || '').trim()
      );
      for (const s of missing) {
        queueOpenAiSlotAnalysis({ slotId: s.id }).catch((err) =>
          fastify.log.warn({ err: err?.message, slotId: s.id, caseId }, 'catch-up-openai-slot')
        );
      }
      if (missing.length) fastify.log.info({ caseId, count: missing.length }, 'catch-up-openai-queued');
    } catch (err) {
      fastify.log.warn({ err: err?.message, caseId }, 'catch-up-openai-list');
    }
  });
}

async function checkAndNotifyReviewer(caseId) {
  try {
    const c = await prisma.case.findUnique({
      where: { id: caseId },
      include: { tenant: { select: { name: true } } }
    });
    if (!c || !c.tenant || c.tenant.name !== STARTER_TENANT_NAME) return { ok: false, reason: 'NOT_STARTER' };

    queueMissingOpenAiAnalyses(caseId);

    // Idempotencia/concurrencia: solo una request puede pasar de null -> pending_review.
    const updated = await prisma.case.updateMany({
      where: { id: caseId, reviewStatus: null },
      data: { reviewStatus: 'pending_review' }
    });
    if (!updated?.count) return { ok: false, reason: 'ALREADY_REVIEWED' };

    const baseUrl = process.env.BASE_URL || 'https://ainspecciona.com';
    const shortId = c.shortId || caseId;
    const reportUrl = `${baseUrl}/cases/${shortId}/report?reviewer=1`;

    const emailResult = await sendReviewNotificationEmail(REVIEWER_EMAIL, reportUrl, shortId, c.contactName || '');
    fastify.log.info({ caseId, shortId, emailResult }, 'review-notification-sent');
    return { ok: true, shortId, emailResult };
  } catch (err) {
    fastify.log.warn(err, 'check-and-notify-reviewer');
    return { ok: false, reason: 'ERROR' };
  }
}

fastify.register(multipart, {
  limits: { fileSize: 8 * 1024 * 1024 }
});
fastify.register(cookie);
// Antes de @fastify/static: si no, /whatsapp-test puede caer en el estático y devolver 404.
// Centro de revisión ITO (la auth la exige la API /api/admin/review/*)
fastify.get('/review', (req, reply) => {
  const filePath = path.join(__dirname, 'public', 'review.html');
  if (!fs.existsSync(filePath)) {
    return reply.code(404).type('text/plain').send('review.html not found');
  }
  return reply
    .header('Cache-Control', 'no-store, no-cache, must-revalidate')
    .type('text/html; charset=utf-8')
    .send(fs.readFileSync(filePath, 'utf8'));
});

fastify.get('/whatsapp-test', (req, reply) => {
  const filePath = path.join(__dirname, 'public', 'whatsapp-test.html');
  if (!fs.existsSync(filePath)) {
    return reply.code(404).type('text/plain').send('whatsapp-test.html not found');
  }
  return reply
    .header('Cache-Control', 'no-store, no-cache, must-revalidate')
    .type('text/html; charset=utf-8')
    .send(fs.readFileSync(filePath, 'utf8'));
});
fastify.register(staticPlugin, {
  root: path.join(__dirname, 'public'),
  prefix: '/',
  index: 'index.html'
});
fastify.register(staticPlugin, {
  root: path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads'),
  prefix: '/uploads/',
  decorateReply: false
});

fastify.get('/favicon.ico', (req, reply) => reply.redirect(302, '/icons/icon.svg'));
// Local: no hay public/index.html; en Firebase Hosting `/` → corredores.html
fastify.get('/', (req, reply) => reply.sendFile('corredores.html'));
fastify.get('/index.html', (req, reply) => reply.redirect(302, '/'));

// Health check ligero para Cloud Run (sin DB) - responde rápido al arranque
fastify.get('/health', (req, reply) => reply.send({ ok: true, status: 'up' }));

/** Stub API v0: calendario unificado (cupos vacíos hasta persistencia + reglas). */
fastify.get('/api/v0/tenants/:tenantId/calendar/unified', (req, reply) => {
  const { tenantId } = req.params;
  const q = req.query || {};
  return reply.send({
    ok: true,
    tenantId: String(tenantId),
    from: q.from != null ? String(q.from) : null,
    to: q.to != null ? String(q.to) : null,
    slots: []
  });
});

/**
 * PropertyCheck → Ainspecciona: análisis on-demand de evidencias (solo fotos por URL).
 * Auth: header `x-propertycheck-secret` = `PROPERTYCHECK_INGRESS_SECRET` en .env
 */
fastify.post('/api/v0/tenants/:tenantId/propertycheck/analyze', async (req, reply) => {
  const expected = String(process.env.PROPERTYCHECK_INGRESS_SECRET || '').trim();
  const provided = String(req.headers['x-propertycheck-secret'] || '').trim();
  if (!expected || provided !== expected) {
    req.log.warn({ url: req.url }, 'propertycheck-analyze-unauthorized');
    return reply.code(401).send({
      kind: 'error',
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'Falta o es inválido x-propertycheck-secret (PROPERTYCHECK_INGRESS_SECRET en servidor).'
    });
  }

  const { tenantId } = req.params;
  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) }, select: { id: true } });
  if (!tenant) {
    return reply.code(404).send({
      kind: 'error',
      ok: false,
      code: 'TENANT_NOT_FOUND',
      message: 'Tenant no encontrado.'
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return reply.code(400).send({
      kind: 'error',
      ok: false,
      code: 'OPENAI_NOT_CONFIGURED',
      message: 'OPENAI_API_KEY no configurada en el servidor.'
    });
  }

  const body = req.body || {};
  const out = await runPropertyCheckPhotoBatchAnalysisV0({
    body,
    getRuntimeScoreConfig,
    prisma,
    log: req.log
  });

  if (out.kind === 'error') {
    const status = out.code === 'VALIDATION' ? 400 : out.code === 'UNAUTHORIZED' ? 401 : 502;
    return reply.code(status).send(out);
  }

  if (prisma && out.analysis?.byCapture?.length) {
    recordPropertyCheckAccuracyOnAnalyze(prisma, {
      tenantId,
      externalInspectionId: out.externalInspectionId,
      slotsTotal: out.analysis.byCapture.length
    }).catch((err) => req.log.warn({ err: err?.message }, 'analysis-accuracy-metric-pc-analyze'));
  }

  return reply.send(out);
});

/**
 * PropertyCheck → resumen ejecutivo (OpenAI, mismo criterio que /api/cases/:caseId/executive-summary).
 */
fastify.post('/api/v0/tenants/:tenantId/propertycheck/executive-summary', async (req, reply) => {
  const expected = String(process.env.PROPERTYCHECK_INGRESS_SECRET || '').trim();
  const provided = String(req.headers['x-propertycheck-secret'] || '').trim();
  if (!expected || provided !== expected) {
    return reply.code(401).send({
      kind: 'error',
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'Falta o es inválido x-propertycheck-secret (PROPERTYCHECK_INGRESS_SECRET en servidor).',
    });
  }

  const { tenantId } = req.params;
  const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) }, select: { id: true } });
  if (!tenant) {
    return reply.code(404).send({
      kind: 'error',
      ok: false,
      code: 'TENANT_NOT_FOUND',
      message: 'Tenant no encontrado.',
    });
  }

  const out = await generatePropertyCheckExecutiveSummaryV0({
    body: req.body || {},
    log: req.log,
  });

  if (out.kind === 'error') {
    const status =
      out.code === 'VALIDATION'
        ? 400
        : out.code === 'UNAUTHORIZED'
          ? 401
          : out.code === 'OPENAI_NOT_CONFIGURED'
            ? 400
            : 502;
    return reply.code(status).send(out);
  }
  return reply.send(out);
});

/**
 * PropertyCheck → Aintelligence Ingest: feedback de correcciones de hallazgos.
 * Auth: header `x-propertycheck-secret` = `PROPERTYCHECK_INGRESS_SECRET` en .env
 * Contrato: docs/aintelligence/PROPERTYCHECK_FEEDBACK_CONTRACT.md
 */
fastify.post('/api/v0/tenants/:tenantId/propertycheck/feedback', async (req, reply) => {
  const auth = verifyPropertyCheckIngressSecret(req.headers);
  if (!auth.ok) {
    req.log.warn({ url: req.url }, 'propertycheck-feedback-unauthorized');
    return reply.code(401).send({ kind: 'error', ok: false, ...auth });
  }

  if (!prisma) {
    return reply.code(503).send({
      kind: 'error',
      ok: false,
      code: 'DATABASE_NOT_CONFIGURED',
      message: 'Base de datos no configurada.'
    });
  }

  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim() || undefined;
  const out = await handlePropertyCheckFeedbackV0({
    prisma,
    storage,
    tenantId: req.params.tenantId,
    body: req.body || {},
    idempotencyKey,
    log: req.log
  });

  return reply.code(out.httpStatus).send(out.body);
});

/**
 * PropertyCheck → Aintelligence Ingest: feedback en lote (máx. 20 items).
 */
fastify.post('/api/v0/tenants/:tenantId/propertycheck/feedback/batch', async (req, reply) => {
  const auth = verifyPropertyCheckIngressSecret(req.headers);
  if (!auth.ok) {
    req.log.warn({ url: req.url }, 'propertycheck-feedback-batch-unauthorized');
    return reply.code(401).send({ kind: 'error', ok: false, ...auth });
  }

  if (!prisma) {
    return reply.code(503).send({
      kind: 'error',
      ok: false,
      code: 'DATABASE_NOT_CONFIGURED',
      message: 'Base de datos no configurada.'
    });
  }

  const out = await handlePropertyCheckFeedbackBatchV0({
    prisma,
    storage,
    tenantId: req.params.tenantId,
    body: req.body || {},
    log: req.log
  });

  return reply.code(out.httpStatus).send(out.body);
});

fastify.get('/formulario', (req, reply) => reply.sendFile('formulario.html'));
const REPORT_HTML_PATH = path.join(__dirname, 'public', 'report.html');
let reportHtmlTemplateCache = null;

async function sendReportHtml(reply) {
  if (!reportHtmlTemplateCache) {
    reportHtmlTemplateCache = fs.readFileSync(REPORT_HTML_PATH, 'utf8');
  }
  const runtime = await getRuntimeScoreConfig();
  const cfg = runtime.config || {};
  const inject = `<script>window.__AINSPECTA_SCORE_CONFIG__=${JSON.stringify({
    kpis: cfg.kpis,
    badge: cfg.badge,
    kpiWeights: cfg.kpiWeights,
    messages: cfg.messages,
    recommendations: cfg.recommendations,
    slotKpiMap: cfg.slotKpiMap
  })};</script>`;
  const html = reportHtmlTemplateCache.replace('</head>', `${inject}\n</head>`);
  return reply
    .header('Cache-Control', 'no-store, no-cache, must-revalidate')
    .header('X-Report-Scoring', 'v3-admin-sync')
    .type('text/html; charset=utf-8')
    .send(html);
}

fastify.get('/cases/:caseId/report', async (req, reply) => {
  try {
    return await sendReportHtml(reply);
  } catch (err) {
    fastify.log.warn({ err: err?.message }, 'report-html-inject-fallback');
    return reply
      .header('Cache-Control', 'no-store, no-cache, must-revalidate')
      .sendFile('report.html');
  }
});
fastify.get('/cases/:caseId/certificate', (req, reply) =>
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('certificate.html'));
fastify.get('/admin', (req, reply) =>
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('admin.html'));
fastify.get('/activate', (req, reply) => reply.sendFile('activate.html'));
/** Enlaces post-activación ejecutivo (Play Store, App Store, panel web). Sin secretos. */
fastify.get('/api/public/executive-app', (req, reply) => {
  const playStoreUrl = String(process.env.EXECUTIVE_PLAY_STORE_URL || '').trim() || null;
  const appStoreEnv = String(process.env.EXECUTIVE_APP_STORE_URL || '').trim();
  const appStoreUrl = appStoreEnv || DEFAULT_EXECUTIVE_APP_STORE_URL;
  const base = getPublicWebBase(req);
  return reply.send({
    ok: true,
    playStoreUrl,
    appStoreUrl,
    executiveWebUrl: `${base}/executive`,
    iosPwaGuideUrl: `${base}/executive-instalar-ios`,
    googlePlayBadgeUrl: `${base}/icons/logo-google-play.png`,
    appStoreBadgeUrl: `${base}/icons/logo-app-store.png`,
    appleIosPwaBadgeUrl: `${base}/assets/apple-ios-pwa-badge.svg`
  });
});
/** Widget ElevenLabs (solo home): agent ID público vía env ELEVENLABS_AGENT_ID. */
fastify.get('/api/public/elevenlabs-agent', (req, reply) => {
  const agentId = String(process.env.ELEVENLABS_AGENT_ID || '').trim();
  if (!agentId) {
    return reply.send({ ok: true, enabled: false, agentId: null });
  }
  const variant = String(process.env.ELEVENLABS_WIDGET_VARIANT || 'expanded').trim() || 'expanded';
  return reply.send({
    ok: true,
    enabled: true,
    agentId,
    variant,
    dismissible: process.env.ELEVENLABS_WIDGET_DISMISSIBLE !== '0'
  });
});

/** KPIs de scoring (solo lectura, sin auth) para reporte público y certificados. */
fastify.get('/api/public/score-config', async (req, reply) => {
  const runtime = await getRuntimeScoreConfig();
  const cfg = runtime.config || {};
  return reply.send({
    ok: true,
    updatedAt: runtime.updatedAt ? runtime.updatedAt.toISOString() : null,
    config: {
      kpis: cfg.kpis,
      badge: cfg.badge,
      kpiWeights: cfg.kpiWeights,
      messages: cfg.messages,
      recommendations: cfg.recommendations
    }
  });
});
fastify.get('/install', (req, reply) => reply.redirect('/executive'));
// /login, /app, /control → registerPlatformRoutes
fastify.get('/tenant', (req, reply) => reply.sendFile('tenant.html'));
fastify.get('/tenant/comprar-creditos', (req, reply) => reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('tenant-comprar-creditos.html'));
fastify.get('/executive-instalar-ios', (req, reply) =>
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('executive-instalar-ios.html')
);
fastify.get('/executive', (req, reply) => reply.sendFile('executive.html'));
fastify.get('/precios', (req, reply) => reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('precios.html'));
// Landing pública / link para compartir (asistente + captura)
fastify.get('/postventa/captura', (req, reply) =>
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('postventa/captura.html')
);
fastify.get('/postventa_prueba', (req, reply) =>
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('postventa/prueba.html')
);
// --- Portal Postventa inmobiliaria ---
// Dashboard canónico: /postventa. Captura pública: /postventa/captura.
// /postventa/portal/* se mantiene como alias (redirect).
const pvPortalNoStore = (reply, file) =>
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile(file);
function pvRedirectLegacyPublicLanding(req, reply) {
  // Compat: links viejos /postventa?start=1|tenant=… → captura pública
  const q = req.query || {};
  if (q.start === '1' || q.iniciar === '1' || q.tenant) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) {
      if (v == null || v === '') continue;
      params.set(k, Array.isArray(v) ? String(v[0]) : String(v));
    }
    const qs = params.toString();
    return reply.redirect(302, qs ? `/postventa/captura?${qs}` : '/postventa/captura');
  }
  return null;
}
function pvPortalAliasRedirect(req, reply) {
  const path = String(req.url || '/postventa/portal').split('?')[0];
  const rest = path === '/postventa/portal' ? '' : path.slice('/postventa/portal'.length);
  const qs = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return reply.redirect(302, `/postventa${rest || ''}${qs}`);
}
// HTML del portal: sin guard de servidor.
// Firebase solo reenvía la cookie __session a Cloud Run; la sesión real viaja
// en sessionStorage + header x-postventa-session (ensureAuth en el cliente).
// Un guard aquí provocaba bucle login → /postventa → login ("bloqueado").
fastify.get('/postventa', (req, reply) => {
  if (pvRedirectLegacyPublicLanding(req, reply)) return;
  return pvPortalNoStore(reply, 'postventa/portal/overview.html');
});
fastify.get('/postventa/', (req, reply) => {
  if (pvRedirectLegacyPublicLanding(req, reply)) return;
  return pvPortalNoStore(reply, 'postventa/portal/overview.html');
});
fastify.get('/postventa/login', (req, reply) =>
  pvPortalNoStore(reply, 'postventa/portal/login.html')
);
fastify.get('/postventa/overview', (req, reply) =>
  pvPortalNoStore(reply, 'postventa/portal/overview.html')
);
fastify.get('/postventa/proyecto', (req, reply) =>
  pvPortalNoStore(reply, 'postventa/portal/proyecto.html')
);
fastify.get('/postventa/ticket', (req, reply) =>
  pvPortalNoStore(reply, 'postventa/portal/ticket.html')
);
fastify.get('/postventa/mis-tickets', (req, reply) =>
  pvPortalNoStore(reply, 'postventa/portal/mis-tickets.html')
);
fastify.get('/postventa/configuracion', (req, reply) =>
  pvPortalNoStore(reply, 'postventa/portal/configuracion.html')
);
// Alias legacy /postventa/portal/*
fastify.get('/postventa/portal', (req, reply) => pvPortalAliasRedirect(req, reply));
fastify.get('/postventa/portal/login', (req, reply) => pvPortalAliasRedirect(req, reply));
fastify.get('/postventa/portal/overview', (req, reply) => pvPortalAliasRedirect(req, reply));
fastify.get('/postventa/portal/proyecto', (req, reply) => pvPortalAliasRedirect(req, reply));
fastify.get('/postventa/portal/ticket', (req, reply) => pvPortalAliasRedirect(req, reply));
fastify.get('/postventa/portal/mis-tickets', (req, reply) => pvPortalAliasRedirect(req, reply));
fastify.get('/postventa/portal/configuracion', (req, reply) => pvPortalAliasRedirect(req, reply));
// --- Ainspecciona Entrega (recepción técnica constructora → inmobiliaria) ---
const entregaNoStore = (reply, file) =>
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile(file);
async function entregaPageGuard(req, reply) {
  const session = await getEntregaSessionAuth(prisma, req);
  if (!session) {
    const next = encodeURIComponent(req.url || '/entrega');
    return reply.redirect(302, `/entrega/login?next=${next}`);
  }
}
fastify.get('/entrega/login', (req, reply) => entregaNoStore(reply, 'entrega/login.html'));
fastify.get('/entrega', { preHandler: entregaPageGuard }, (req, reply) => entregaNoStore(reply, 'entrega/overview.html'));
fastify.get('/entrega/proyecto', { preHandler: entregaPageGuard }, (req, reply) => entregaNoStore(reply, 'entrega/proyecto.html'));
fastify.get('/entrega/piso', { preHandler: entregaPageGuard }, (req, reply) => entregaNoStore(reply, 'entrega/piso.html'));
fastify.get('/entrega/unidad', { preHandler: entregaPageGuard }, (req, reply) => entregaNoStore(reply, 'entrega/unidad.html'));
fastify.get('/entrega/captura', { preHandler: entregaPageGuard }, (req, reply) => entregaNoStore(reply, 'entrega/captura.html'));
fastify.get('/entrega/ot', { preHandler: entregaPageGuard }, (req, reply) => entregaNoStore(reply, 'entrega/ot.html'));
fastify.get('/entrega/reportes', { preHandler: entregaPageGuard }, (req, reply) => entregaNoStore(reply, 'entrega/reportes.html'));
fastify.get('/entrega/usuarios', { preHandler: entregaPageGuard }, (req, reply) => entregaNoStore(reply, 'entrega/usuarios.html'));
// --- Ainspecciona In & Out (arriendos IN/OUT) ---
const inoutNoStore = (reply, file) =>
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile(file);
async function inoutPageGuard(req, reply) {
  const session = await getIoSessionAuth(prisma, req);
  if (!session) {
    const next = encodeURIComponent(req.url || '/inout/portal');
    return reply.redirect(302, `/inout/portal/login?next=${next}`);
  }
}
fastify.get('/inout', (req, reply) => inoutNoStore(reply, 'inout/index.html'));
fastify.get('/inout/portal/login', (req, reply) => inoutNoStore(reply, 'inout/portal/login.html'));
fastify.get('/inout/portal', { preHandler: inoutPageGuard }, (req, reply) => inoutNoStore(reply, 'inout/portal/overview.html'));
fastify.get('/inout/portal/overview', { preHandler: inoutPageGuard }, (req, reply) => inoutNoStore(reply, 'inout/portal/overview.html'));
fastify.get('/inout/portal/lease', { preHandler: inoutPageGuard }, (req, reply) => inoutNoStore(reply, 'inout/portal/lease.html'));
fastify.get('/inout/portal/report', { preHandler: inoutPageGuard }, (req, reply) => inoutNoStore(reply, 'inout/portal/report.html'));
// Hub autenticado: listar aperturas / elegir OUT (runtime técnico sigue en /inout/capture/:token)
fastify.get('/inout/captura', { preHandler: inoutPageGuard }, (req, reply) =>
  inoutNoStore(reply, 'inout/captura.html')
);
fastify.get('/inout/captura/', { preHandler: inoutPageGuard }, (req, reply) =>
  inoutNoStore(reply, 'inout/captura.html')
);
fastify.get('/inout/capture/:token', (req, reply) => inoutNoStore(reply, 'inout/capture.html'));
// /toctoc → página estática con accesos demo (sin hub/SSO)
fastify.get('/toctoc', (req, reply) =>
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('toctoc/index.html')
);
fastify.get('/toctoc/', (req, reply) =>
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('toctoc/index.html')
);
// Ainspecciona Scan — viewer público
fastify.get('/scan/s/:publicId', (req, reply) =>
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('scan/viewer.html')
);
fastify.get('/scan', (req, reply) =>
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('scan/index.html')
);
fastify.get('/scan/', (req, reply) =>
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('scan/index.html')
);
fastify.get('/demo', (req, reply) => reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('demo.html'));
fastify.get('/pago', (req, reply) => {
  const plan = String(req.query?.plan || '').toLowerCase();
  if (plan === 'starter') return reply.redirect(302, '/inspeccionar');
  return reply.sendFile('pago.html');
});
fastify.get('/pago/ok', (req, reply) => reply.sendFile('pago-ok.html'));
fastify.get('/pago/error', (req, reply) => reply.sendFile('pago-error.html'));
fastify.get('/pago/pendiente', (req, reply) => reply.sendFile('pago-pendiente.html'));
fastify.get('/starter/crear-caso', (req, reply) => reply.sendFile('starter-crear-caso.html'));
fastify.get('/inspeccionar', (req, reply) => reply.sendFile('inspeccionar.html'));
fastify.get('/photoplan', (req, reply) => reply.sendFile('photoplan.html'));
fastify.get('/business/activar', (req, reply) => reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('business-activar.html'));
fastify.get('/business/trial/pago', (req, reply) => reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('business-trial-pago.html'));
fastify.get('/business/crear-clave', (req, reply) => reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('business-crear-clave.html'));
fastify.get('/terminos', (req, reply) => reply.sendFile('terminos.html'));
fastify.get('/privacidad', (req, reply) => reply.sendFile('privacidad.html'));
fastify.get('/eliminar-cuenta', (req, reply) => reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('eliminar-cuenta.html'));
fastify.get('/cookies', (req, reply) => reply.sendFile('cookies.html'));

// Magic link: validar token, crear sesión, redirigir a crear-clave o dashboard
fastify.get('/auth/verify', async (req, reply) => {
  const token = String(req.query?.token || '').trim();
  if (!token) return reply.redirect(302, '/?error=invalid_token');
  try {
    const row = await prisma.magicLinkToken.findUnique({
      where: { token },
      include: { tenant: { select: { id: true, name: true, passwordHash: true } } }
    });
    if (!row || row.usedAt || new Date() > row.expiresAt) {
      return reply.redirect(302, '/?error=token_expired');
    }
    await prisma.magicLinkToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() }
    });
    const sessionToken = await createTenantSession(row.tenant.id);
    reply.setCookie(TENANT_SESSION_COOKIE, sessionToken, sessionCookieOpts(req));
    if (row.tenant.passwordHash) {
      return reply.redirect(302, '/tenant');
    }
    return reply.redirect(302, '/business/crear-clave');
  } catch (err) {
    fastify.log.error({ err, token: token.substring(0, 8) }, 'auth-verify-error');
    return reply.redirect(302, '/?error=verify_failed');
  }
});

/**
 * Canje en un solo campo: código promo (ej. IRE2026) o código Rewards (peer).
 * - Promo: créditos del código (típicamente 1) al nuevo tenant.
 * - Peer: 2 créditos al nuevo (1 bienvenida + 1 bonus) y +1 al invitante.
 * Body: razonSocial, rut, email, telefono?, contactNombre, contactApellido, promoCode, password
 */
fastify.post('/api/promo/redeem', async (req, reply) => {
  try {
    const {
      razonSocial, rut, email, telefono, contactNombre, contactApellido, promoCode, password
    } = req.body || {};
    const razon = String(razonSocial || '').trim();
    const rutVal = rut ? String(rut).trim() : '';
    const emailVal = email ? String(email).trim().toLowerCase() : '';
    const codeNorm = normalizePartnerCode(promoCode);
    const contactFirst = String(contactNombre || '').trim();
    const contactLast = String(contactApellido || '').trim();
    const passwordRaw = String(password || '').trim();

    if (!razon || !rutVal || !emailVal || !contactFirst || !contactLast || !codeNorm || !passwordRaw) {
      return reply.code(400).send({
        ok: false,
        error: 'MISSING_FIELDS',
        message: 'Faltan datos: razón social, RUT, email, contacto, código y clave de acceso.'
      });
    }

    const pwdCheck = validatePasswordStrength(passwordRaw);
    if (!pwdCheck.ok) {
      return reply.code(400).send({ ok: false, error: 'WEAK_PASSWORD', message: pwdCheck.msg });
    }

    const rutNorm = normalizeRut(rutVal);
    if (!rutNorm || rutNorm.length < 7) {
      return reply.code(400).send({ ok: false, error: 'INVALID_RUT', message: 'RUT inválido.' });
    }

    const promo = await prisma.promoCode.findUnique({ where: { code: codeNorm } });
    const peerReferrer = (!promo || !promo.active)
      ? await prisma.tenant.findFirst({
          where: { peerReferralCode: codeNorm, status: 'ACTIVE' },
          select: { id: true, name: true, email: true, rut: true, peerReferralCode: true }
        })
      : null;

    const channel = promo && promo.active ? 'promo' : peerReferrer ? 'peer' : null;
    if (!channel) {
      return reply.code(400).send({
        ok: false,
        error: 'PROMO_CODE_INVALID',
        message: 'Código inválido o inactivo. Usa un código promo o de referido Rewards.'
      });
    }

    const welcomeCredits = channel === 'promo'
      ? Math.max(1, Number(promo.credits) || 1)
      : Math.max(1, TRIAL_INITIAL_REAL_INSPECTIONS);
    const referredBonus = channel === 'peer' ? Math.max(0, PEER_TRIAL_BONUS_CREDITS) : 0;
    const creditsToGrant = welcomeCredits + referredBonus;
    const referrerBonus = channel === 'peer' ? Math.max(1, PEER_TRIAL_BONUS_CREDITS || 1) : 0;
    const passwordHash = hashPassword(passwordRaw);

    const priorByRut = await prisma.promoRedemption.findUnique({ where: { rutNorm } });
    if (priorByRut) {
      return reply.code(409).send({
        ok: false,
        error: 'PROMO_ALREADY_REDEEMED',
        message: 'Este RUT ya canjeó una inspección promo o de referido.'
      });
    }

    let tenant = await prisma.tenant.findFirst({
      where: {
        OR: [{ rut: rutVal }, { rut: rutNorm }, { email: emailVal }]
      }
    });

    if (tenant) {
      const priorTenant = await prisma.promoRedemption.findUnique({ where: { tenantId: tenant.id } });
      const priorPeer = await prisma.peerReferralAttribution.findUnique({
        where: { referredTenantId: tenant.id }
      });
      if (priorTenant || priorPeer) {
        return reply.code(409).send({
          ok: false,
          error: 'PROMO_ALREADY_REDEEMED',
          message: 'Esta cuenta ya canjeó una inspección promo o de referido.'
        });
      }
      if (tenant.passwordHash) {
        return reply.code(409).send({
          ok: false,
          error: 'ACCOUNT_EXISTS',
          message: 'Ya existe una cuenta con este email o RUT. Inicia sesión en Ingreso corredores.'
        });
      }
    }

    if (channel === 'peer' && peerReferrer) {
      const sameEmail = peerReferrer.email && peerReferrer.email.toLowerCase() === emailVal;
      const sameRut = peerReferrer.rut && normalizeRut(peerReferrer.rut) === rutNorm;
      if (sameEmail || sameRut || (tenant && tenant.id === peerReferrer.id)) {
        return reply.code(400).send({
          ok: false,
          error: 'SELF_REFERRAL',
          message: 'No puedes usar tu propio código de referido.'
        });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      let t = tenant;
      if (!t) {
        t = await tx.tenant.create({
          data: {
            name: razon,
            legalName: razon,
            rut: rutNorm,
            email: emailVal,
            phone: telefono ? String(telefono).trim() || null : null,
            passwordHash,
            trialSource: channel === 'peer' ? 'peer_referral' : 'promo_code',
            trialAutoCharge: false,
            facturacionJson: {
              contactNombre: contactFirst,
              contactApellido: contactLast,
              promoCode: codeNorm,
              redeemChannel: channel
            }
          }
        });
      } else {
        t = await tx.tenant.update({
          where: { id: t.id },
          data: {
            rut: rutNorm || t.rut,
            email: emailVal || t.email,
            phone: telefono ? String(telefono).trim() || null : t.phone,
            passwordHash,
            trialSource: t.trialSource || (channel === 'peer' ? 'peer_referral' : 'promo_code'),
            trialAutoCharge: false
          }
        });
      }

      await tx.tenantCredit.upsert({
        where: { tenantId: t.id },
        create: { tenantId: t.id, balance: creditsToGrant },
        update: { balance: { increment: creditsToGrant } }
      });
      await tx.creditTransaction.create({
        data: {
          tenantId: t.id,
          amount: creditsToGrant,
          type: 'ADJUSTMENT',
          description: channel === 'peer'
            ? `Referido ${codeNorm}: +${welcomeCredits} bienvenida + ${referredBonus} bonus`
            : `Promo ${codeNorm}: +${creditsToGrant} inspección(es) gratis`
        }
      });

      if (channel === 'promo') {
        await tx.promoRedemption.create({
          data: {
            promoCodeId: promo.id,
            tenantId: t.id,
            rutNorm
          }
        });
      } else {
        await tx.peerReferralAttribution.create({
          data: {
            referrerTenantId: peerReferrer.id,
            referredTenantId: t.id,
            peerCodeUsed: codeNorm
          }
        });
        if (referrerBonus > 0) {
          await tx.tenantCredit.upsert({
            where: { tenantId: peerReferrer.id },
            create: { tenantId: peerReferrer.id, balance: referrerBonus },
            update: { balance: { increment: referrerBonus } }
          });
          await tx.creditTransaction.create({
            data: {
              tenantId: peerReferrer.id,
              amount: referrerBonus,
              type: 'ADJUSTMENT',
              description: 'Bono Ainspecciona Rewards — referido activó su cuenta'
            }
          });
        }
      }

      const peerEnsure = await ensureTenantPeerReferralCodeInTx(tx, t.id);
      return { tenant: t, creditsToGrant, channel, peerEnsure };
    });

    if (result.peerEnsure?.assigned && result.tenant.email) {
      await notifyPeerReferralWelcomeIfNew(req, {
        assigned: true,
        code: result.peerEnsure.code,
        email: result.tenant.email,
        tenantName: result.tenant.name
      });
    }

    try {
      await syncCorporateContactInHubspot({
        email: emailVal,
        firstName: contactFirst,
        lastName: contactLast,
        phone: telefono ? String(telefono).trim() : '',
        companyName: razon,
        companyRut: rutVal
      });
    } catch (hubspotErr) {
      req.log.warn({ err: hubspotErr }, 'promo-redeem-hubspot');
    }

    const sessionToken = await createTenantSession(result.tenant.id);
    reply.setCookie(TENANT_SESSION_COOKIE, sessionToken, sessionCookieOpts(req));

    req.log.info(
      {
        tenantId: result.tenant.id,
        code: codeNorm,
        channel: result.channel,
        credits: result.creditsToGrant,
        referrerBonus: channel === 'peer' ? referrerBonus : 0
      },
      'promo-redeem-ok'
    );

    const msg = result.channel === 'peer'
      ? `Listo: tienes ${result.creditsToGrant} créditos (bienvenida + referido). Ya estás en tu panel.`
      : `Listo: tienes ${result.creditsToGrant} inspección(es) gratis. Ya estás en tu panel. Para más, compra créditos ahí.`;

    return reply.send({
      ok: true,
      tenantId: result.tenant.id,
      creditsGranted: result.creditsToGrant,
      channel: result.channel,
      token: sessionToken,
      tenant: { id: result.tenant.id, name: result.tenant.name },
      redirectUrl: `/tenant?t=${encodeURIComponent(sessionToken)}`,
      message: msg
    });
  } catch (err) {
    if (String(err?.code) === 'P2002') {
      return reply.code(409).send({
        ok: false,
        error: 'PROMO_ALREADY_REDEEMED',
        message: 'Este RUT o cuenta ya canjeó una inspección promo o de referido.'
      });
    }
    req.log.error({ err }, 'promo-redeem-error');
    return reply.code(500).send({
      ok: false,
      error: 'PROMO_REDEEM_FAILED',
      message: err?.message || 'No se pudo canjear el código.'
    });
  }
});

// Evaluar elegibilidad de free trial corporativo
fastify.post('/api/business/trial/eligibility', async (req, reply) => {
  try {
    const rut = String(req.body?.rut || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const eligibility = await evaluateTrialEligibility({ rut, email });
    return reply.send({
      ok: true,
      eligible: eligibility.eligible,
      reason: eligibility.reason,
      rutNormalized: eligibility.rutNorm,
      domain: eligibility.domain
    });
  } catch (err) {
    req.log.warn({ err }, 'trial-eligibility-error');
    return reply.code(500).send({ ok: false, error: 'TRIAL_ELIGIBILITY_FAILED' });
  }
});

// Validar código ref. unificado: partner (tabla ReferralPartner) o peer (Tenant.peerReferralCode, ACTIVE)
fastify.post('/api/business/trial/partner-code', async (req, reply) => {
  try {
    const code = normalizePartnerCode(req.body?.code);
    const empty = {
      ok: true,
      valid: false,
      channel: null,
      durationDays: TRIAL_DURATION_DAYS,
      extraCredits: 0,
      totalTrialCredits: TRIAL_INITIAL_REAL_INSPECTIONS
    };
    if (!code) return reply.send(empty);

    const partner = await prisma.referralPartner.findFirst({
      where: { code, active: true },
      select: { id: true, name: true, type: true }
    });
    if (partner) {
      return reply.send({
        ok: true,
        valid: true,
        channel: 'partner',
        partnerName: partner.name,
        partnerType: partner.type,
        durationDays: PARTNER_TRIAL_DURATION_DAYS,
        extraCredits: PARTNER_TRIAL_BONUS_CREDITS,
        totalTrialCredits: TRIAL_INITIAL_REAL_INSPECTIONS + PARTNER_TRIAL_BONUS_CREDITS
      });
    }

    const peerTenant = await prisma.tenant.findFirst({
      where: { peerReferralCode: code, status: 'ACTIVE' },
      select: { id: true, name: true, legalName: true }
    });
    if (peerTenant) {
      const label = (peerTenant.legalName || peerTenant.name || '').trim() || 'Corredora';
      return reply.send({
        ok: true,
        valid: true,
        channel: 'peer',
        peerReferrerLabel: label,
        durationDays: TRIAL_DURATION_DAYS,
        extraCredits: PEER_TRIAL_BONUS_CREDITS,
        totalTrialCredits: TRIAL_INITIAL_REAL_INSPECTIONS + PEER_TRIAL_BONUS_CREDITS
      });
    }

    const ambassador = await prisma.ambassador.findFirst({
      where: { code: code.toLowerCase() },
      select: { id: true, fullName: true, code: true }
    });
    if (ambassador) {
      return reply.send({
        ok: true,
        valid: true,
        channel: 'ambassador',
        ambassadorName: ambassador.fullName,
        durationDays: TRIAL_DURATION_DAYS,
        extraCredits: 0,
        totalTrialCredits: TRIAL_INITIAL_REAL_INSPECTIONS
      });
    }

    return reply.send(empty);
  } catch (err) {
    req.log.warn({ err }, 'trial-partner-code-error');
    return reply.code(500).send({ ok: false, error: 'PARTNER_CODE_CHECK_FAILED' });
  }
});

// Formulario público de contacto → email a contacto@ainspecciona.com
const contactFormHits = new Map();
function contactFormRateLimitOk(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const recent = (contactFormHits.get(ip) || []).filter((t) => now - t < windowMs);
  if (recent.length >= 5) return false;
  recent.push(now);
  contactFormHits.set(ip, recent);
  if (contactFormHits.size > 5000) contactFormHits.clear();
  return true;
}

fastify.post('/api/contacto', async (req, reply) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (!contactFormRateLimitOk(ip)) {
      return reply.code(429).send({ ok: false, error: 'Demasiados envíos. Intenta de nuevo en unos minutos.' });
    }

    const { name, email, company, message, website } = req.body || {};
    // Honeypot: campo oculto que solo llenan bots
    if (String(website || '').trim()) {
      return reply.send({ ok: true });
    }

    const nameVal = String(name || '').trim().slice(0, 120);
    const emailVal = String(email || '').trim().toLowerCase().slice(0, 200);
    const companyVal = String(company || '').trim().slice(0, 160);
    const messageVal = String(message || '').trim().slice(0, 4000);

    if (!nameVal || !messageVal) {
      return reply.code(400).send({ ok: false, error: 'Nombre y mensaje son obligatorios.' });
    }
    if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      return reply.code(400).send({ ok: false, error: 'Ingresa un email válido.' });
    }

    const result = await sendContactFormEmail({
      name: nameVal,
      email: emailVal,
      company: companyVal,
      message: messageVal
    });

    if (!result.ok) {
      fastify.log.error({ result, email: emailVal }, 'contact-form-email-failed');
      return reply.code(502).send({ ok: false, error: 'No pudimos enviar tu mensaje. Escríbenos a contacto@ainspecciona.com.' });
    }

    fastify.log.info({ email: emailVal, name: nameVal }, 'contact-form-sent');
    return reply.send({ ok: true });
  } catch (err) {
    fastify.log.error({ err }, 'contact-form-error');
    return reply.code(500).send({ ok: false, error: 'Error inesperado. Escríbenos a contacto@ainspecciona.com.' });
  }
});

// Activar plan Business o iniciar free trial corporativo
fastify.post('/api/business/activate', async (req, reply) => {
  try {
    const {
      razonSocial, rut, email, telefono, contactNombre, contactApellido,
      necesitaFactura, facturaRazonSocial, facturaRut, facturaDireccion, facturaComuna, facturaCiudad, facturaGiro, facturaEmail,
      startTrial, mode
    } = req.body || {};
    const requestedTrial = startTrial === true || String(mode || '').toLowerCase() === 'trial';
    const razon = String(razonSocial || '').trim();
    const rutVal = rut ? String(rut).trim() : '';
    const emailVal = email ? String(email).trim().toLowerCase() : '';
    if (!razon || !rutVal || !emailVal || !contactNombre?.trim() || !contactApellido?.trim()) {
      return reply.code(400).send({ message: 'Faltan datos obligatorios: razón social, RUT, email y persona de contacto.' });
    }

    const trialEligibility = requestedTrial ? await evaluateTrialEligibility({ rut: rutVal, email: emailVal }) : null;
    const rutNorm = trialEligibility?.rutNorm || normalizeRut(rutVal);
    const emailDomain = trialEligibility?.domain || extractEmailDomain(emailVal);
    const trialEligibilityKey = `${rutNorm}|${emailDomain}`;

    let tenant = await prisma.tenant.findFirst({
      where: {
        OR: [
          { rut: rutVal },
          { rut: rutNorm },
          { email: emailVal }
        ]
      }
    });
    const facturacionJson = necesitaFactura && facturaRazonSocial ? {
      razonSocial: String(facturaRazonSocial || '').trim(),
      rut: facturaRut ? String(facturaRut).trim() : null,
      direccion: facturaDireccion ? String(facturaDireccion).trim() : null,
      comuna: facturaComuna ? String(facturaComuna).trim() : null,
      ciudad: facturaCiudad ? String(facturaCiudad).trim() : null,
      giro: facturaGiro ? String(facturaGiro).trim() : null,
      email: (facturaEmail || emailVal).trim().toLowerCase()
    } : null;

    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          name: razon,
          legalName: razon,
          rut: rutNorm || rutVal,
          email: emailVal,
          phone: telefono ? String(telefono).trim() || null : null,
          facturacionJson,
          passwordHash: null
        }
      });
      await prisma.tenantCredit.upsert({
        where: { tenantId: tenant.id },
        create: { tenantId: tenant.id, balance: 0 },
        update: {}
      });
      fastify.log.info({ tenantId: tenant.id, razonSocial: razon }, 'business-tenant-created');
    } else {
      const credit = await prisma.tenantCredit.findUnique({ where: { tenantId: tenant.id } });
      if (!credit) {
        await prisma.tenantCredit.create({ data: { tenantId: tenant.id, balance: 0 } });
      }
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          rut: rutNorm || tenant.rut,
          email: emailVal || tenant.email,
          phone: telefono ? String(telefono).trim() || null : tenant.phone,
          ...(facturacionJson ? { facturacionJson } : {})
        }
      });
      tenant = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      fastify.log.info({ tenantId: tenant.id }, 'business-tenant-found');
    }

    const peerEnsureActivate = await ensureTenantPeerReferralCode(tenant.id);
    if (peerEnsureActivate.assigned && tenant.email) {
      await notifyPeerReferralWelcomeIfNew(req, {
        assigned: true,
        code: peerEnsureActivate.code,
        email: tenant.email,
        tenantName: tenant.name
      });
    }

    try {
      const hubspotSync = await syncCorporateContactInHubspot({
        email: emailVal,
        firstName: String(contactNombre || '').trim(),
        lastName: String(contactApellido || '').trim(),
        phone: telefono ? String(telefono).trim() : '',
        companyName: razon,
        companyRut: rutVal
      });
      if ((!hubspotSync.lead.ok && !hubspotSync.lead.skipped) || (!hubspotSync.company.ok && !hubspotSync.company.skipped)) {
        fastify.log.warn({ hubspotSync, email: emailVal }, 'hubspot-corporate-sync-failed');
      }
    } catch (hubspotErr) {
      fastify.log.warn({ err: hubspotErr, email: emailVal }, 'hubspot-corporate-sync-error');
    }

    if (requestedTrial) {
      if (tenant?.trialStartedAt || tenant?.trialSubscriptionId || tenant?.trialStatus === 'converted') {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: {
            trialStatus: 'blocked',
            trialBlockedReason: 'TRIAL_ALREADY_USED',
            trialEligibilityKey
          }
        }).catch(() => {});
        await updateHubspotTrialProperties({ email: emailVal, trialStatus: 'blocked', trialBlockedReason: 'TRIAL_ALREADY_USED' }).catch(() => {});
        return reply.code(409).send({ ok: false, error: 'TRIAL_NOT_ELIGIBLE', reason: 'TRIAL_ALREADY_USED', message: 'La empresa ya utilizó un trial anteriormente.' });
      }
      if (!trialEligibility?.eligible) {
        const blockedReason = trialEligibility?.reason || 'TRIAL_NOT_ELIGIBLE';
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: {
            trialStatus: 'blocked',
            trialBlockedReason: blockedReason,
            trialEligibilityKey
          }
        }).catch(() => {});
        await updateHubspotTrialProperties({ email: emailVal, trialStatus: 'blocked', trialBlockedReason: blockedReason }).catch(() => {});
        const messages = {
          CORPORATE_EMAIL_REQUIRED: 'El free trial corporativo requiere correo corporativo (no personal).',
          STARTER_HISTORY_BLOCK: 'La empresa ya tiene historial Starter y no puede activar free trial.',
          TRIAL_KEY_ALREADY_USED: 'La llave de elegibilidad RUT + dominio ya utilizó un free trial.',
          RUT_REQUIRED: 'Debes ingresar un RUT válido para activar el trial.',
          EMAIL_REQUIRED: 'Debes ingresar un correo corporativo válido.'
        };
        return reply.code(409).send({ ok: false, error: 'TRIAL_NOT_ELIGIBLE', reason: blockedReason, message: messages[blockedReason] || 'La empresa no cumple requisitos del free trial.' });
      }
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) {
      if (requestedTrial) {
        return reply.code(503).send({ ok: false, error: 'TRIAL_REQUIRES_CARD', message: 'Para activar free trial con tarjeta, configura MercadoPago.' });
      }
      return reply.send({ tenantId: tenant.id });
    }

    if (requestedTrial) {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          trialStatus: 'pending_payment_method',
          trialBlockedReason: null,
          trialEligibilityKey,
          trialAutoCharge: true,
          trialSource: 'business_activate'
        }
      });
      return reply.send({
        ok: true,
        tenantId: tenant.id,
        trialSetup: true,
        trial: {
          status: 'pending_payment_method',
          durationDays: TRIAL_DURATION_DAYS,
          realInspectionsIncluded: TRIAL_INITIAL_REAL_INSPECTIONS
        }
      });
    }

    const isTest = accessToken.startsWith('TEST-');
    const baseUrl = getPublicWebBase(req);
    const BUSINESS_PRICE_CLP = Number(process.env.BUSINESS_PRICE_CLP || 39990);

    if (isTest) {
      fastify.log.info({ tenantId: tenant.id, mode: 'test-one-time' }, 'business-test-mode-one-time-payment');
      return reply.send({ tenantId: tenant.id });
    }

    const preapprovalBody = {
      reason: 'Plan Business Ainspecciona – Suscripción mensual',
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: BUSINESS_PRICE_CLP,
        currency_id: 'CLP'
      },
      back_url: `${baseUrl}/pago/ok?plan=business&tenant=${tenant.id}`,
      external_reference: `tenant:${tenant.id}|plan:business`,
      payer_email: emailVal,
      notification_url: getMercadoPagoWebhookUrl(req),
      status: 'pending'
    };

    try {
      const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(preapprovalBody)
      });
      const mpData = await mpRes.json();
      if (!mpRes.ok) {
        fastify.log.error({ mpData, status: mpRes.status, requestedTrial }, 'business-subscription-create-error');
        return reply.code(502).send({ message: 'Error al crear suscripción en MercadoPago', detail: mpData.message || '' });
      }

      const trialSubId = String(mpData.id);
      await prisma.$transaction(async (tx) => {
        await tx.tenant.update({
          where: { id: tenant.id },
          data: {
            mpSubscriptionId: trialSubId,
            subscriptionStatus: mpData.status || 'pending'
          }
        });
      });

      const redirectUrl = mpData.init_point || mpData.sandbox_init_point;
      fastify.log.info({ tenantId: tenant.id, subscriptionId: mpData.id, requestedTrial }, 'business-subscription-created');
      return reply.send({ tenantId: tenant.id, redirectUrl });
    } catch (mpErr) {
      fastify.log.error({ err: mpErr, requestedTrial }, 'business-subscription-fetch-error');
      return reply.send({ tenantId: tenant.id });
    }
  } catch (err) {
    fastify.log.error({ err, body: req.body }, 'business-activate-error');
    const msg = err?.message || String(err);
    return reply.code(500).send({ message: msg });
  }
});

// Free trial: crear preapproval recién en pantalla de pago trial
fastify.post('/api/business/trial/create-preapproval', async (req, reply) => {
  try {
    const tenantId = String(req.body?.tenantId || '').trim();
    const partnerCodeNorm = normalizePartnerCode(req.body?.partnerCode);
    if (!tenantId) return reply.code(400).send({ ok: false, error: 'MISSING_TENANT_ID' });
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) return reply.code(503).send({ ok: false, error: 'MP_NOT_CONFIGURED' });

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        legalName: true,
        email: true,
        rut: true,
        trialStatus: true,
        trialSubscriptionId: true,
        trialEligibilityKey: true,
        trialStartedAt: true,
        referralPartnerId: true
      }
    });
    if (!tenant) return reply.code(404).send({ ok: false, error: 'TENANT_NOT_FOUND' });
    if (!tenant.email || !tenant.rut) {
      return reply.code(400).send({ ok: false, error: 'MISSING_TENANT_DATA', message: 'Falta email o RUT para activar trial.' });
    }
    if (tenant.trialStatus === 'blocked') {
      return reply.code(409).send({ ok: false, error: 'TRIAL_BLOCKED', message: 'El trial está bloqueado para esta cuenta.' });
    }
    if (tenant.trialStatus === 'active' || tenant.trialStartedAt || tenant.trialSubscriptionId) {
      return reply.code(409).send({ ok: false, error: 'TRIAL_ALREADY_STARTED', message: 'El trial ya fue iniciado anteriormente.' });
    }
    const peerAttrExisting = await prisma.peerReferralAttribution.findUnique({
      where: { referredTenantId: tenant.id },
      select: { id: true }
    });
    const ambAttrExisting = await prisma.ambassadorReferralAttribution.findUnique({
      where: { referredTenantId: tenant.id },
      select: { id: true }
    });
    if (tenant.referralPartnerId || peerAttrExisting || ambAttrExisting) {
      return reply.code(409).send({
        ok: false,
        error: 'REFERRAL_ALREADY_ASSIGNED',
        message: 'Esta cuenta ya tiene un código ref. asignado.'
      });
    }

    let referralPartner = null;
    let peerReferrer = null;
    let ambassadorRef = null;
    if (partnerCodeNorm) {
      referralPartner = await prisma.referralPartner.findFirst({
        where: { code: partnerCodeNorm, active: true },
        select: { id: true, name: true, type: true }
      });
      if (!referralPartner) {
        peerReferrer = await prisma.tenant.findFirst({
          where: {
            peerReferralCode: partnerCodeNorm,
            status: 'ACTIVE',
            id: { not: tenant.id }
          },
          select: { id: true, name: true, legalName: true }
        });
        if (!peerReferrer) {
          ambassadorRef = await prisma.ambassador.findFirst({
            where: { code: partnerCodeNorm.toLowerCase() },
            select: { id: true, fullName: true, code: true }
          });
          if (!ambassadorRef) {
            return reply.code(400).send({
              ok: false,
              error: 'PARTNER_CODE_INVALID',
              message: 'Código ref. no válido o inactivo.'
            });
          }
        }
      }
    }

    const eligibility = await evaluateTrialEligibility({ rut: tenant.rut, email: tenant.email });
    if (!eligibility.eligible) {
      const blockedReason = eligibility.reason || 'TRIAL_NOT_ELIGIBLE';
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { trialStatus: 'blocked', trialBlockedReason: blockedReason, trialEligibilityKey: `${eligibility.rutNorm}|${eligibility.domain}` }
      }).catch(() => {});
      await updateHubspotTrialProperties({ email: tenant.email, trialStatus: 'blocked', trialBlockedReason: blockedReason }).catch(() => {});
      return reply.code(409).send({ ok: false, error: 'TRIAL_NOT_ELIGIBLE', reason: blockedReason });
    }

    const trialDays = referralPartner ? PARTNER_TRIAL_DURATION_DAYS : TRIAL_DURATION_DAYS;
    const trialCreditTotal = referralPartner
      ? TRIAL_INITIAL_REAL_INSPECTIONS + PARTNER_TRIAL_BONUS_CREDITS
      : peerReferrer
        ? TRIAL_INITIAL_REAL_INSPECTIONS + PEER_TRIAL_BONUS_CREDITS
        : TRIAL_INITIAL_REAL_INSPECTIONS;

    const baseUrl = getPublicWebBase(req);
    const BUSINESS_PRICE_CLP = Number(process.env.BUSINESS_PRICE_CLP || 39990);
    const trialReason = referralPartner
      ? `Ainspecciona Business – Free Trial ${trialDays} días (código partner, cobro automático al finalizar)`
      : peerReferrer
        ? `Ainspecciona Business – Free Trial ${trialDays} días (código ref. peer, cobro automático al finalizar)`
        : ambassadorRef
          ? `Ainspecciona Business – Free Trial ${trialDays} días (código embajador, cobro automático al finalizar)`
          : `Ainspecciona Business – Free Trial ${trialDays} días (cobro automático al finalizar)`;
    const preapprovalBody = {
      reason: trialReason,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: BUSINESS_PRICE_CLP,
        currency_id: 'CLP',
        free_trial: {
          frequency: trialDays,
          frequency_type: 'days'
        }
      },
      back_url: `${baseUrl}/pago/ok?plan=business&tenant=${tenant.id}&trial=1`,
      external_reference: `tenant:${tenant.id}|plan:business|trial:1`,
      payer_email: tenant.email,
      notification_url: getMercadoPagoWebhookUrl(req),
      status: 'pending'
    };

    const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(preapprovalBody)
    });
    const mpData = await mpRes.json();
    if (!mpRes.ok) {
      req.log.error({ mpData, status: mpRes.status, tenantId: tenant.id }, 'trial-preapproval-create-error');
      return reply.code(502).send({ ok: false, error: 'MP_CREATE_PREAPPROVAL_FAILED', message: mpData.message || 'No se pudo crear el preapproval del trial.' });
    }

    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    const trialSubId = String(mpData.id);
    const trialSourceVal = referralPartner
      ? 'trial_partner_code'
      : peerReferrer
        ? 'trial_peer_code'
        : ambassadorRef
          ? 'trial_ambassador_code'
          : 'trial_checkout_page';
    let peerEnsure = { code: null, assigned: false };
    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: tenant.id },
        data: {
          mpSubscriptionId: trialSubId,
          subscriptionStatus: mpData.status || 'pending',
          trialSubscriptionId: trialSubId,
          trialStatus: 'active',
          trialStartedAt: now,
          trialEndsAt,
          trialConvertedAt: null,
          trialCancelledAt: null,
          trialBlockedReason: null,
          trialEligibilityKey: `${eligibility.rutNorm}|${eligibility.domain}`,
          trialAutoCharge: true,
          trialSource: trialSourceVal,
          referralPartnerId: referralPartner ? referralPartner.id : null,
          referralCodeSnapshot: referralPartner || peerReferrer || ambassadorRef ? partnerCodeNorm : null,
          trialPartnerBenefitsAt: referralPartner ? now : null
        }
      });
      const alreadyCredited = await tx.creditTransaction.findFirst({
        where: {
          tenantId: tenant.id,
          description: { contains: 'Free trial corporativo' }
        },
        select: { id: true }
      });
      if (!alreadyCredited && trialCreditTotal > 0) {
        const desc = referralPartner
          ? `Free trial corporativo (${trialCreditTotal} inspecciones reales incluidas, código partner ${referralPartner.name})`
          : peerReferrer
            ? `Free trial corporativo (${trialCreditTotal} inspecciones reales incluidas, código ref. peer)`
            : ambassadorRef
              ? `Free trial corporativo (${trialCreditTotal} inspección real incluida, código embajador)`
              : `Free trial corporativo (${trialCreditTotal} inspección real incluida)`;
        await tx.tenantCredit.upsert({
          where: { tenantId: tenant.id },
          create: { tenantId: tenant.id, balance: trialCreditTotal },
          update: { balance: { increment: trialCreditTotal } }
        });
        await tx.creditTransaction.create({
          data: {
            tenantId: tenant.id,
            amount: trialCreditTotal,
            type: 'ADJUSTMENT',
            description: desc
          }
        });
      }
      if (peerReferrer) {
        await tx.peerReferralAttribution.create({
          data: {
            referrerTenantId: peerReferrer.id,
            referredTenantId: tenant.id,
            peerCodeUsed: partnerCodeNorm
          }
        });
        if (PEER_TRIAL_BONUS_CREDITS > 0) {
          await tx.tenantCredit.upsert({
            where: { tenantId: peerReferrer.id },
            create: { tenantId: peerReferrer.id, balance: PEER_TRIAL_BONUS_CREDITS },
            update: { balance: { increment: PEER_TRIAL_BONUS_CREDITS } }
          });
          await tx.creditTransaction.create({
            data: {
              tenantId: peerReferrer.id,
              amount: PEER_TRIAL_BONUS_CREDITS,
              type: 'ADJUSTMENT',
              description: 'Bono referente — programa código ref. peer'
            }
          });
        }
      }
      if (ambassadorRef) {
        await tx.ambassadorReferralAttribution.create({
          data: {
            ambassadorId: ambassadorRef.id,
            referredTenantId: tenant.id,
            codeSnapshot: ambassadorRef.code
          }
        });
      }
      peerEnsure = await ensureTenantPeerReferralCodeInTx(tx, tenant.id);
    });
    if (peerEnsure.assigned && tenant.email) {
      await notifyPeerReferralWelcomeIfNew(req, {
        assigned: true,
        code: peerEnsure.code,
        email: tenant.email,
        tenantName: tenant.name
      });
    }

    await updateHubspotTrialProperties({
      email: tenant.email,
      trialStatus: 'active',
      trialEndsAt
    }).catch(() => {});

    const redirectUrl = mpData.init_point || mpData.sandbox_init_point;
    return reply.send({
      ok: true,
      redirectUrl,
      trial: {
        status: 'active',
        endsAt: trialEndsAt,
        realInspectionsIncluded: trialCreditTotal,
        durationDays: trialDays,
        partnerApplied: Boolean(referralPartner),
        peerApplied: Boolean(peerReferrer),
        ambassadorApplied: Boolean(ambassadorRef),
        referralChannel: referralPartner ? 'partner' : peerReferrer ? 'peer' : ambassadorRef ? 'ambassador' : null
      }
    });
  } catch (err) {
    req.log.error({ err }, 'trial-create-preapproval-error');
    return reply.code(500).send({ ok: false, error: 'TRIAL_CREATE_PREAPPROVAL_FAILED' });
  }
});

// Modo demo Business: simular pago, añadir créditos y devolver magic link directo
fastify.post('/api/business/simulate-payment', async (req, reply) => {
  try {
    const { tenantId } = req.body || {};
    const tid = String(tenantId || '').trim();
    if (!tid) return reply.code(400).send({ error: 'Falta tenantId' });
    const tenant = await prisma.tenant.findUnique({
      where: { id: tid },
      select: { id: true, email: true, name: true, facturacionJson: true }
    });
    if (!tenant) return reply.code(404).send({ error: 'Tenant no encontrado' });
    await prisma.$transaction(async (tx) => {
      let account = await tx.tenantCredit.findUnique({ where: { tenantId: tid } });
      if (!account) account = await tx.tenantCredit.create({ data: { tenantId: tid, balance: 0 } });
      await tx.tenantCredit.update({
        where: { tenantId: tid },
        data: { balance: { increment: 2 } }
      });
      await tx.creditTransaction.create({
        data: {
          tenantId: tid,
          amount: 2,
          type: 'PURCHASE',
          description: 'Demo plan Business (2 créditos)'
        }
      });
    });
    const token = crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.magicLinkToken.create({ data: { tenantId: tid, token, expiresAt } });
    const proto = (req.headers['x-forwarded-proto'] || 'http').toString().split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').toString().split(',')[0].trim();
    const redirectUrl = `${proto}://${host}/auth/verify?token=${token}`;
    const magicUrl = `${proto}://${host}/auth/verify?token=${token}`;
    let emailSent = false;
    if (tenant.email) {
      const BUSINESS_PRICE_CLP = Number(process.env.BUSINESS_PRICE_CLP || 39990);
      let receiptPdf = null;
      if (tenant.facturacionJson && typeof tenant.facturacionJson === 'object') {
        try {
          receiptPdf = await generateBusinessReceiptPdf({ facturacion: tenant.facturacionJson, montoClp: BUSINESS_PRICE_CLP });
        } catch (pdfErr) {
          fastify.log.warn({ err: pdfErr }, 'business-demo-receipt-pdf-error');
        }
      }
      const sent = await sendBusinessMagicLinkEmail(tenant.email, magicUrl, tenant.name, {
        facturacion: tenant.facturacionJson,
        receiptPdfBuffer: receiptPdf,
        montoClp: BUSINESS_PRICE_CLP
      });
      emailSent = !!sent.ok;
      if (sent.ok) fastify.log.info({ tenantId: tid, email: tenant.email }, 'business-demo-email-sent');
      else fastify.log.warn({ tenantId: tid, err: sent.error }, 'business-demo-email-failed');
    }
    fastify.log.info({ tenantId: tid }, 'business-demo-simulated');
    return reply.send({ redirectUrl, emailSent });
  } catch (err) {
    fastify.log.error({ err }, 'business-simulate-payment-error');
    return reply.code(500).send({ error: err?.message || 'Error al simular' });
  }
});

// Crear contraseña tras magic link (primera vez)
fastify.post('/api/business/set-password', async (req, reply) => {
  const session = await getTenantSession(req);
  if (!session?.tenantId) return reply.code(401).send({ message: 'Debes acceder primero con el enlace del email.' });
  const password = String(req.body?.password || '').trim();
  const pwdCheck = validatePasswordStrength(password);
  if (!pwdCheck.ok) return reply.code(400).send({ message: pwdCheck.msg });
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { id: true, passwordHash: true }
    });
    if (!tenant) return reply.code(404).send({ message: 'Cuenta no encontrada.' });
    if (tenant.passwordHash) return reply.code(400).send({ message: 'Ya tienes contraseña configurada. Usa el login normal.' });
    await prisma.tenant.update({
      where: { id: session.tenantId },
      data: { passwordHash: hashPassword(password) }
    });
    fastify.log.info({ tenantId: session.tenantId }, 'business-password-set');
    return reply.send({ ok: true, redirectUrl: '/tenant' });
  } catch (err) {
    fastify.log.error({ err }, 'business-set-password-error');
    return reply.code(500).send({ message: err?.message || 'Error al guardar contraseña.' });
  }
});

// Config de pago: saber si MercadoPago está disponible (para mostrar modo demo)
fastify.get('/api/payment/config', async (req, reply) => {
  const agendarUrl = process.env.HUBSPOT_AGENDAR_URL || 'https://meetings.hubspot.com/saraya-silva';
  const tok = process.env.MERCADOPAGO_ACCESS_TOKEN || '';
  let mercadopagoMode = null;
  if (tok) {
    mercadopagoMode = tok.startsWith('TEST-') ? 'test' : 'live';
  }
  return reply.send({
    mercadopagoAvailable: !!tok,
    mercadopagoMode,
    publicUrl: (process.env.PUBLIC_URL || process.env.BASE_URL || '').trim() || null,
    agendarReunionUrl: agendarUrl
  });
});

// Modo demo: simular pago Starter sin MercadoPago
fastify.post('/api/starter/simulate-payment', async (req, reply) => {
  try {
    const forceDemo = req.body?.demo === true || req.body?.demo === '1';
    if (!forceDemo && process.env.MERCADOPAGO_ACCESS_TOKEN) {
      return reply.code(400).send({ error: 'Modo demo no disponible: MercadoPago ya está configurado. Usa ?demo=1 en la URL.' });
    }
    const { plan, email, nombre, apellido, rut, necesitaFactura, facturaRazonSocial, facturaRut, facturaDireccion, facturaComuna, facturaCiudad, facturaGiro, facturaEmail } = req.body || {};
    if (plan !== 'starter' || !email) {
      return reply.code(400).send({ error: 'Solo plan starter en modo demo. Faltan plan o email.' });
    }
    const nom = String(nombre || '').trim();
    const ape = String(apellido || '').trim();
    const rutVal = rut ? String(rut).trim() : '';
    if (!nom || !ape || !rutVal) {
      return reply.code(400).send({ error: 'Starter requiere nombre, apellido y RUT' });
    }
    const starterTenant = await ensureStarterTenant();
    const paymentId = 'demo_' + crypto.randomUUID().replace(/-/g, '');
    const contactEmail = String(email).trim().toLowerCase();
    const contactName = `${nom} ${ape}`.trim();
    const facturacionJson = necesitaFactura && facturaRazonSocial ? {
      razonSocial: String(facturaRazonSocial || '').trim(),
      rut: facturaRut ? String(facturaRut).trim() : null,
      direccion: facturaDireccion ? String(facturaDireccion).trim() : null,
      comuna: facturaComuna ? String(facturaComuna).trim() : null,
      ciudad: facturaCiudad ? String(facturaCiudad).trim() : null,
      giro: facturaGiro ? String(facturaGiro).trim() : null,
      email: (facturaEmail || contactEmail).trim().toLowerCase()
    } : null;
    await prisma.case.create({
      data: {
        shortId: generateCaseShortId(),
        tenantId: starterTenant.id,
        contactEmail,
        contactName,
        contactRut: rutVal || null,
        facturacionJson,
        mercadopagoPaymentId: paymentId,
        propertyType: 'DEPARTMENT',
        bedrooms: 1,
        bathrooms: 1,
        floorType: 'CONCRETE',
        status: 'DRAFT'
      }
    });
    const baseUrl = getPublicWebBase(req);
    const redirectUrl = `${baseUrl}/pago/ok?plan=starter&payment_id=${encodeURIComponent(paymentId)}`;
    fastify.log.info({ paymentId, contactEmail }, 'starter-demo-payment-simulated');

    /** Sin pago MP aprobado: emitir boleta de prueba SimpleFactura (certificación) si `ALLOW_SIMULATE_SIMPLEFACTURA=1` y hay datos de facturación. */
    let simplefactura = null;
    const allowSfSim =
      process.env.ALLOW_SIMULATE_SIMPLEFACTURA === '1' || String(process.env.ALLOW_SIMULATE_SIMPLEFACTURA || '').toLowerCase() === 'true';
    if (forceDemo && allowSfSim && facturacionJson && isSimpleFacturaConfigured()) {
      const fakePayment = {
        transaction_amount: STARTER_PRICE_CLP,
        payer: { email: contactEmail }
      };
      const starterTipoDte = Number(process.env.SIMPLEFACTURA_STARTER_TIPO_DTE || process.env.SIMPLEFACTURA_TIPO_DTE || 39);
      const sf = await maybeEmitSimpleFacturaForPayment(fastify.log, {
        billingTenantId: starterTenant.id,
        mercadopagoPaymentId: paymentId,
        payment: fakePayment,
        facturacionJson,
        lineDescription: SF_LINE_STARTER,
        fallbackMontoClp: STARTER_PRICE_CLP,
        tipoDteDefault: starterTipoDte
      });
      simplefactura = { folio: sf.folio ?? null, ok: !!sf.folio };
      if (sf.dtePdfBuffer && contactEmail) {
        try {
          await sendSimplefacturaDtePdfEmail(contactEmail, sf.dtePdfBuffer, { folio: sf.folio });
          simplefactura.pdfEmailed = true;
        } catch (mailErr) {
          fastify.log.warn({ err: mailErr }, 'simulate-simplefactura-email-failed');
          simplefactura.pdfEmailed = false;
        }
      }
    } else if (forceDemo && allowSfSim && !facturacionJson) {
      fastify.log.warn('simulate-simplefactura-skip: marca facturación y completa datos (necesitaFactura) para emitir DTE');
    }

    return reply.send({
      redirectUrl,
      payment_id: paymentId,
      ...(simplefactura != null ? { simplefactura } : {})
    });
  } catch (err) {
    fastify.log.error({ err, body: req.body }, 'starter-simulate-payment-error');
    const msg = err?.message || String(err);
    return reply.code(500).send({ error: 'SIMULATE_PAYMENT_ERROR', message: msg });
  }
});

// Starter: crear caso DRAFT + preferencia MercadoPago (flujo nuevo: form primero, pago después)
fastify.post('/api/starter/create-draft', async (req, reply) => {
  try {
    const body = req.body || {};
    const {
      contactName,
      contactEmail,
      contactRut,
      propertyAddress,
      propertyRol,
      propertyOperationType,
      propertySurface,
      propertyType,
      bathroomsCount,
      bedroomsCount,
      hasEntranceGrille,
      necesitaFactura,
      facturaRazonSocial,
      facturaRut,
      facturaDireccion,
      facturaComuna,
      facturaCiudad,
      facturaGiro,
      facturaEmail,
      facturaTipoDte
    } = body;

    if (!contactName || !contactEmail || !contactRut) {
      return reply.code(400).send({ ok: false, error: 'Faltan nombre, email o RUT' });
    }

    const contactEmailNorm = String(contactEmail).trim().toLowerCase();
    if (necesitaFactura) {
      const razon = String(facturaRazonSocial || '').trim();
      const frut = facturaRut ? String(facturaRut).trim() : '';
      const fdir = facturaDireccion ? String(facturaDireccion).trim() : '';
      const fcom = facturaComuna ? String(facturaComuna).trim() : '';
      const fciu = facturaCiudad ? String(facturaCiudad).trim() : '';
      const fgiro = facturaGiro ? String(facturaGiro).trim() : '';
      if (!razon || !frut || !fdir || !fcom || !fciu || !fgiro) {
        return reply.code(400).send({
          ok: false,
          error: 'FACTURACION_INCOMPLETA',
          message: 'Completa todos los campos de facturación o desmarca la casilla.'
        });
      }
    }

    const facturacionJson = buildFacturacionJsonFromForm(
      {
        necesitaFactura,
        facturaRazonSocial,
        facturaRut,
        facturaDireccion,
        facturaComuna,
        facturaCiudad,
        facturaGiro,
        facturaEmail,
        facturaTipoDte
      },
      contactEmailNorm
    );

    const starterTenant = await ensureStarterTenant();

    const shortId = generateCaseShortId();
    const bedrooms = Math.max(0, Number(bedroomsCount) || 1);
    const bathrooms = Math.max(1, Number(bathroomsCount) || 1);

    const c = await prisma.case.create({
      data: {
        shortId,
        tenantId: starterTenant.id,
        contactEmail: contactEmailNorm,
        contactName: String(contactName).trim(),
        contactRut: String(contactRut).trim() || null,
        propertyType: propertyType || 'DEPARTMENT',
        bedrooms,
        bathrooms,
        bathroomsCount: bathrooms,
        bedroomsCount: bedrooms,
        floorType: 'CONCRETE',
        hasPatio: false,
        hasAttic: false,
        hasLaundry: true,
        hasElevator: true,
        hasParking: false,
        hasGreenCertificate: true,
        hasEntranceGrille: !!hasEntranceGrille,
        status: 'DRAFT',
        ...(facturacionJson ? { facturacionJson } : {})
      }
    });

    try {
      const nameParts = splitFullName(contactName);
      const hubspotLead = await upsertHubspotLead({
        leadType: 'starter',
        email: String(contactEmail).trim().toLowerCase(),
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
        company: 'Cliente Starter'
      });
      if (!hubspotLead.ok && !hubspotLead.skipped) {
        fastify.log.warn({ hubspotLead, email: contactEmail }, 'hubspot-starter-lead-failed');
      }
    } catch (hubspotErr) {
      fastify.log.warn({ err: hubspotErr, email: contactEmail }, 'hubspot-starter-lead-error');
    }

    if (propertyAddress || propertyRol || propertyOperationType || propertySurface) {
      const prop = await prisma.property.create({
        data: {
          tenantId: starterTenant.id,
          address: propertyAddress || null,
          rol: propertyRol || null,
          operationType: propertyOperationType || null,
          surface: propertySurface || null
        }
      });
      await prisma.case.update({ where: { id: c.id }, data: { propertyId: prop.id } });
    }

    const planSlots = buildPhotoPlanV1({
      propertyType: c.propertyType,
      bathroomsCount: bathrooms,
      bedroomsCount: bedrooms,
      hasLaundry: true,
      hasElevator: true,
      hasGreenCertificate: true,
      hasEntranceGrille: !!hasEntranceGrille
    });

    await prisma.slot.createMany({
      data: planSlots.map((s, idx) => ({
        tenantId: starterTenant.id,
        caseId: c.id,
        slotCode: s.slotCode,
        title: s.title,
        instructions: s.instructions,
        required: s.required ?? true,
        orderIndex: idx + 1,
        status: 'PENDING'
      }))
    });

    const slots = planSlots.map((s, idx) => ({
      slotCode: s.slotCode,
      title: s.title,
      instructions: s.instructions,
      orderIndex: idx + 1
    }));

    fastify.log.info({ caseId: c.id, shortId, slotsCount: slots.length }, 'starter-draft-created-with-slots');
    return reply.send({ ok: true, caseId: shortId, slots });
  } catch (err) {
    fastify.log.error({ err, body: req.body }, 'starter-create-draft-error');
    return reply.code(500).send({ ok: false, error: err?.message || 'Error al crear inspección' });
  }
});

// Starter: checkout — genera preferencia MercadoPago para un caso DRAFT existente
fastify.post('/api/starter/checkout', async (req, reply) => {
  try {
    const { caseId } = req.body || {};
    if (!caseId) return reply.code(400).send({ ok: false, error: 'Falta caseId' });

    const c = await prisma.case.findFirst({ where: { shortId: String(caseId) } });
    if (!c) return reply.code(404).send({ ok: false, error: 'Caso no encontrado' });
    if (c.status !== 'DRAFT') return reply.code(400).send({ ok: false, error: 'El caso no está en estado DRAFT' });

    const baseUrl = getPublicWebBase(req);

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) {
      const demoPaymentId = 'demo_' + crypto.randomUUID().replace(/-/g, '');
      await prisma.case.update({ where: { id: c.id }, data: { mercadopagoPaymentId: demoPaymentId } });
      const redirectUrl = `${baseUrl}/pago/ok?plan=starter&payment_id=${encodeURIComponent(demoPaymentId)}`;
      fastify.log.info({ caseId: c.id, shortId: c.shortId, mode: 'demo' }, 'starter-checkout-demo');
      return reply.send({ ok: true, checkoutUrl: redirectUrl });
    }

    const emailOk = c.contactEmail && String(c.contactEmail).includes('@');
    if (!emailOk) {
      return reply.code(400).send({ ok: false, error: 'El caso no tiene un email de contacto válido' });
    }

    const extRef = `plan:starter|caseId:${c.id}|ts:${Date.now()}`;
    const successUrl = `${baseUrl}/pago/ok?plan=starter`;
    const prefPayload = {
      items: [{ title: '1 crédito Starter', quantity: 1, unit_price: STARTER_PRICE_CLP, currency_id: 'CLP' }],
      payer: buildMercadoPagoPayerPreference({ email: c.contactEmail }),
      ...mercadoPagoCheckoutProDigitalPreferenceExtras(),
      statement_descriptor: 'AINSPECCIONA',
      external_reference: extRef,
      back_urls: { success: successUrl, failure: `${baseUrl}/photoplan?case=${c.shortId}`, pending: successUrl },
      auto_return: 'approved',
      notification_url: getMercadoPagoWebhookUrl(req)
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify(prefPayload)
    });
    const mpData = await mpRes.json();
    const isTestToken = accessToken.startsWith('TEST-');
    const checkoutUrl = isTestToken
      ? (mpData.sandbox_init_point || mpData.init_point)
      : (mpData.init_point || mpData.sandbox_init_point);
    if (!mpRes.ok || !checkoutUrl) {
      fastify.log.error({ mpData }, 'starter-checkout-mp-error');
      return reply.code(500).send({ ok: false, error: 'Error al crear preferencia de pago' });
    }
    let checkoutHost = null;
    try {
      checkoutHost = new URL(checkoutUrl).hostname;
    } catch (_) {}
    fastify.log.info(
      {
        caseId: c.id,
        shortId: c.shortId,
        extRef,
        tokenMode: isTestToken ? 'test' : 'live',
        checkoutHost,
        hint:
          !isTestToken && checkoutHost && !String(checkoutHost).includes('sandbox')
            ? 'Credencial producción: checkout es prod; tarjetas de prueba suelen fallar. Usa TEST- o tarjeta real.'
            : undefined
      },
      'starter-checkout-created'
    );
    return reply.send({ ok: true, checkoutUrl });
  } catch (err) {
    fastify.log.error({ err, body: req.body }, 'starter-checkout-error');
    return reply.code(500).send({ ok: false, error: err?.message || 'Error al crear checkout' });
  }
});

// Starter: obtener slots de un caso DRAFT
fastify.get('/api/starter/slots/:shortId', async (req, reply) => {
  try {
    const { shortId } = req.params;
    const c = await prisma.case.findFirst({ where: { shortId: String(shortId) } });
    if (!c) return reply.code(404).send({ ok: false, error: 'Caso no encontrado' });

    const slots = await prisma.slot.findMany({
      where: { caseId: c.id },
      orderBy: { orderIndex: 'asc' },
      select: { slotCode: true, title: true, instructions: true, orderIndex: true, status: true }
    });

    return reply.send({ ok: true, caseId: c.shortId, status: c.status, slots });
  } catch (err) {
    fastify.log.error({ err }, 'starter-get-slots-error');
    return reply.code(500).send({ ok: false, error: err?.message || 'Error al obtener slots' });
  }
});

// Starter: activar caso DRAFT (capture token + enviar email)
fastify.post('/api/starter/activate-case', async (req, reply) => {
  try {
    const { caseId } = req.body || {};
    if (!caseId) return reply.code(400).send({ ok: false, error: 'MISSING_CASE_ID' });

    const c = await prisma.case.findFirst({
      where: { OR: [{ id: caseId }, { shortId: caseId }] }
    });
    if (!c) return reply.code(404).send({ ok: false, error: 'CASE_NOT_FOUND' });

    if (c.status !== 'DRAFT') {
      const existingToken = await prisma.captureToken.findFirst({
        where: { caseId: c.id, revokedAt: null },
        orderBy: { createdAt: 'desc' }
      });
      const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0].trim();
      const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim();
      const baseUrl = host ? `${proto}://${host}` : 'https://ainspecciona.com';
      return reply.send({
        ok: true, alreadyActive: true,
        captureUrl: existingToken ? `/capture/${existingToken.token}` : null,
        captureUrlFull: existingToken ? `${baseUrl}/capture/${existingToken.token}` : null
      });
    }

    const token = crypto.randomUUID();
    const captureExpires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

    await prisma.$transaction(async (tx) => {
      await tx.case.update({ where: { id: c.id }, data: { status: 'IN_PROGRESS' } });
      await tx.captureToken.create({
        data: { tenantId: c.tenantId, caseId: c.id, token, expiresAt: captureExpires }
      });
    });

    const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim();
    const baseUrl = host ? `${proto}://${host}` : 'https://ainspecciona.com';
    const captureUrlFull = `${baseUrl}/capture/${token}`;

    let emailSent = false;
    if (c.contactEmail) {
      try {
        const r = await sendInspectionLinkEmail(c.contactEmail, captureUrlFull, c.contactName);
        emailSent = r.ok;
      } catch (err) {
        fastify.log.warn({ err, to: c.contactEmail }, 'activate-email-error');
      }
    }

    fastify.log.info({ caseId: c.id, shortId: c.shortId, emailSent }, 'starter-case-activated');
    return reply.send({
      ok: true,
      caseId: c.shortId || c.id,
      captureUrl: `/capture/${token}`,
      captureUrlFull,
      emailSent
    });
  } catch (err) {
    fastify.log.error({ err }, 'starter-activate-case-error');
    return reply.code(500).send({ ok: false, error: err?.message || 'Error al activar caso' });
  }
});

// MercadoPago Checkout Pro: crear preferencia y redirigir
fastify.post('/api/mercadopago/preference', async (req, reply) => {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) {
    return reply.code(503).send({ error: 'MercadoPago no configurado. Define MERCADOPAGO_ACCESS_TOKEN en .env' });
  }
  const {
    plan, billing, email, nombre, apellido, rut,
    necesitaFactura, facturaRazonSocial, facturaRut, facturaDireccion, facturaComuna, facturaCiudad, facturaGiro, facturaEmail,
    tenantId: bodyTenantId,
    caseId: bodyCaseId,
    surface: bodySurface,
    address: bodyAddress
  } = req.body || {};
  if (!plan || !email) {
    return reply.code(400).send({ error: 'Faltan plan o email' });
  }
  if (plan === 'starter') {
    const nom = String(nombre || '').trim();
    const ape = String(apellido || '').trim();
    const rutVal = rut ? String(rut).trim() : '';
    if (!nom || !ape || !rutVal) {
      return reply.code(400).send({ error: 'Starter requiere nombre, apellido y RUT' });
    }
  }
  if (plan === 'business' || plan.startsWith('credits-')) {
    const nom = String(nombre || '').trim();
    const ape = String(apellido || '').trim();
    const rutVal = rut ? String(rut).trim() : '';
    if (!nom || !ape || !rutVal) {
      return reply.code(400).send({ error: 'Se requiere nombre, apellido y RUT del contacto' });
    }
  }
  const tenantSession = await getTenantSession(req);
  let tenantId = bodyTenantId || tenantSession?.tenantId || null;
  if (plan === 'starter') tenantId = null; // Starter siempre es one-shot sin tenant
  if (plan === 'business' && !tenantId) {
    return reply.code(400).send({ error: 'Para Business debes activar primero en /business/activar' });
  }
  if (plan.startsWith('credits-') && !tenantId) {
    return reply.code(400).send({ error: 'Debes iniciar sesión en el dashboard para comprar créditos' });
  }
  if (tenantId && (plan.startsWith('credits-') || plan === 'dashboard-corporate' || plan === 'dashboard-standard' || plan === 'corporate')) {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, legalName: true, email: true, phone: true, rut: true }
      });
      const corporateSync = await syncCorporateContactInHubspot({
        email: String(email || tenant?.email || '').trim().toLowerCase(),
        firstName: String(nombre || '').trim(),
        lastName: String(apellido || '').trim(),
        phone: String(tenant?.phone || '').trim(),
        companyName: String(tenant?.legalName || tenant?.name || '').trim(),
        companyRut: String(tenant?.rut || '').trim()
      });
      if ((!corporateSync.lead.ok && !corporateSync.lead.skipped) || (!corporateSync.company.ok && !corporateSync.company.skipped)) {
        fastify.log.warn({ corporateSync, tenantId, plan }, 'hubspot-corporate-dashboard-sync-failed');
      }
    } catch (hubspotErr) {
      fastify.log.warn({ err: hubspotErr, tenantId, plan }, 'hubspot-corporate-dashboard-sync-error');
    }
  }
  if (plan === 'inspeccion-presencial') {
    if (!tenantId) return reply.code(400).send({ error: 'Debes iniciar sesión en el dashboard para solicitar inspección presencial' });
    if (!bodyCaseId) return reply.code(400).send({ error: 'Falta el caso. Vuelve desde el panel de inspecciones.' });
    const nom = String(nombre || '').trim();
    const ape = String(apellido || '').trim();
    const rutVal = rut ? String(rut).trim() : '';
    if (!nom || !ape || !rutVal) {
      return reply.code(400).send({ error: 'Se requiere nombre, apellido y RUT del contacto' });
    }
  }
  const BUSINESS_PRICE_CLP = Number(process.env.BUSINESS_PRICE_CLP || 39990);
  const PRECIO_M2_PRESENCIAL = 1700;
  const PLANS = {
    starter: { title: '1 crédito Starter', unit_price: STARTER_PRICE_CLP, credits: 1 },
    business: { title: 'Plan Business mensual', unit_price: BUSINESS_PRICE_CLP, credits: 2 },
    corporate: { title: '100 créditos Corporate', unit_price: 1199000, credits: 100 },
    'credits-10': { title: '10 créditos', unit_price: 139990, credits: 10 },
    'credits-50': { title: '50 créditos', unit_price: 649500, credits: 50 },
    'credits-100': { title: '100 créditos', unit_price: 1199000, credits: 100 },
    'credits-5': { title: '5 créditos', unit_price: 64950, credits: 5 },
    'credits-20': { title: '20 créditos', unit_price: 219800, credits: 20 },
    'dashboard-standard': { title: 'Dashboard Standard', unit_price: billing === 'annual' ? 590000 : 59000, credits: 0 },
    'dashboard-corporate': { title: 'Dashboard Corporate', unit_price: billing === 'annual' ? 1490000 : 149000, credits: 0 },
    'inspeccion-presencial': { title: 'Inspección técnica presencial', unit_price: 0, credits: 0 }
  };
  let planData = PLANS[plan] || PLANS.starter;
  if (plan === 'inspeccion-presencial') {
    const surface = Math.max(45, parseInt(bodySurface, 10) || 45);
    planData = { ...planData, unit_price: surface * PRECIO_M2_PRESENCIAL };
  }
  const baseUrl = getPublicWebBase(req);
  const isStarter = plan === 'starter' && !tenantId;

  let extRef;
  if (isStarter) {
    const pending = await prisma.pendingStarterPayment.create({
      data: {
        contactNombre: String(nombre || '').trim(),
        contactApellido: String(apellido || '').trim(),
        contactRut: rut ? String(rut).trim() : '',
        contactEmail: String(email).trim().toLowerCase(),
        necesitaFactura: !!necesitaFactura,
        facturaRazonSocial: necesitaFactura ? String(facturaRazonSocial || '').trim() || null : null,
        facturaRut: necesitaFactura ? (facturaRut ? String(facturaRut).trim() : null) : null,
        facturaDireccion: necesitaFactura ? (facturaDireccion ? String(facturaDireccion).trim() : null) : null,
        facturaComuna: necesitaFactura ? (facturaComuna ? String(facturaComuna).trim() : null) : null,
        facturaCiudad: necesitaFactura ? (facturaCiudad ? String(facturaCiudad).trim() : null) : null,
        facturaGiro: necesitaFactura ? (facturaGiro ? String(facturaGiro).trim() : null) : null,
        facturaEmail: necesitaFactura ? (facturaEmail ? String(facturaEmail).trim().toLowerCase() : null) || String(email).trim().toLowerCase() : null
      }
    });
    extRef = `plan:starter|t:${pending.id}`;
  } else if (plan === 'inspeccion-presencial') {
    extRef = `tenant:${tenantId}|plan:inspeccion-presencial|caseId:${bodyCaseId || ''}|ts:${Date.now()}`;
  } else {
    extRef = tenantId ? `tenant:${tenantId}|plan:${plan}|ts:${Date.now()}` : `plan:${plan}|ts:${Date.now()}`;
  }

  const successUrl = isStarter ? `${baseUrl}/pago/ok?plan=starter` : plan === 'inspeccion-presencial' ? `${baseUrl}/pago/ok?plan=inspeccion-presencial` : `${baseUrl}/pago/ok?plan=${plan || 'business'}`;
  const payload = {
    items: [{ title: planData.title, quantity: 1, unit_price: planData.unit_price, currency_id: 'CLP' }],
    payer: buildMercadoPagoPayerPreference({ email }),
    ...mercadoPagoCheckoutProDigitalPreferenceExtras(),
    statement_descriptor: 'AINSPECCIONA',
    back_urls: {
      success: successUrl,
      failure: `${baseUrl}/pago/error`,
      pending: `${baseUrl}/pago/pendiente`
    },
    auto_return: 'approved',
    external_reference: extRef,
    notification_url: getMercadoPagoWebhookUrl(req)
  };
  try {
    const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const preference = await res.json();
    if (!res.ok) {
      fastify.log.warn({ status: res.status, data: preference }, 'mercadopago-preference-error');
      return reply.code(502).send({ error: preference.message || 'Error al crear preferencia MercadoPago' });
    }
    const isTestToken = accessToken.startsWith('TEST-');
    const initPoint = isTestToken
      ? (preference.sandbox_init_point || preference.init_point)
      : (preference.init_point || preference.sandbox_init_point);
    if (!initPoint) return reply.code(502).send({ error: 'MercadoPago no devolvió URL de pago' });
    let checkoutHost = null;
    try {
      checkoutHost = new URL(initPoint).hostname;
    } catch (_) {}
    fastify.log.info(
      {
        tokenMode: isTestToken ? 'test' : 'live',
        checkoutHost,
        hint:
          !isTestToken && checkoutHost && !String(checkoutHost).includes('sandbox')
            ? 'Credencial producción: checkout es prod; tarjetas de prueba suelen fallar. Usa TEST- o tarjeta real.'
            : undefined
      },
      'mercadopago-preference-redirect'
    );
    return reply.send({
      init_point: initPoint,
      sandbox_init_point: preference.sandbox_init_point || null
    });
  } catch (err) {
    fastify.log.error(err, 'mercadopago-preference');
    return reply.code(502).send({ error: 'Error de conexión con MercadoPago' });
  }
});

// MercadoPago Webhook: al pago aprobado, sumar créditos al tenant o crear Case Starter
fastify.post('/api/mercadopago/webhook', async (req, reply) => {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return reply.code(200).send(); // 200 para que MP no reintente
  const q = req.query || {};
  const payload = req.body || {};
  let topic = String(payload.type || payload.topic || q.topic || '').toLowerCase();
  if (!topic && payload.action) {
    const a = String(payload.action).toLowerCase();
    if (a.startsWith('payment.')) topic = 'payment';
  }
  if (topic === 'payment_v2') topic = 'payment';
  let id =
    payload.data?.id ??
    (payload['data.id'] != null ? payload['data.id'] : undefined) ??
    q.id ??
    q['data.id'];

  // Manejar notificaciones de suscripción (preapproval)
  if (topic === 'subscription_preapproval' && id) {
    try {
      const subRes = await fetch(`https://api.mercadopago.com/preapproval/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const sub = await subRes.json();
      if (!subRes.ok) { fastify.log.warn({ id, status: subRes.status }, 'subscription-webhook-fetch-failed'); return reply.code(200).send(); }

      const tenant = await prisma.tenant.findFirst({
        where: {
          OR: [
            { mpSubscriptionId: String(id) },
            { trialSubscriptionId: String(id) }
          ]
        },
        select: {
          id: true,
          email: true,
          mpSubscriptionId: true,
          trialSubscriptionId: true,
          trialStatus: true,
          trialEndsAt: true
        }
      });
      if (!tenant) { fastify.log.warn({ subscriptionId: id }, 'subscription-webhook-tenant-not-found'); return reply.code(200).send(); }

      const status = sub.status || 'unknown';
      const trialRelated = tenant.trialSubscriptionId && tenant.trialSubscriptionId === String(id);
      const shouldMarkConverted = trialRelated && ['authorized', 'active'].includes(String(status).toLowerCase());
      const shouldMarkCancelled = trialRelated && ['cancelled', 'paused'].includes(String(status).toLowerCase());
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          subscriptionStatus: status,
          ...(shouldMarkConverted ? {
            trialStatus: 'converted',
            trialConvertedAt: new Date(),
            trialBlockedReason: null
          } : {}),
          ...(shouldMarkCancelled ? {
            trialStatus: 'cancelled',
            trialCancelledAt: new Date()
          } : {})
        }
      });
      if (trialRelated && (shouldMarkConverted || shouldMarkCancelled)) {
        await updateHubspotTrialProperties({
          email: tenant.email,
          trialStatus: shouldMarkConverted ? 'converted' : 'cancelled',
          trialEndsAt: tenant.trialEndsAt
        }).catch(() => {});
      }
      fastify.log.info({ tenantId: tenant.id, subscriptionId: id, status }, 'subscription-status-updated');
    } catch (subErr) {
      fastify.log.error(subErr, 'subscription-webhook-error');
    }
    return reply.code(200).send();
  }

  // Checkout Pro suele notificar topic=merchant_order (IPN/query); hay que resolver el pago desde la orden
  if (topic === 'merchant_order' && id) {
    try {
      const moId = encodeURIComponent(String(id));
      const orderUrls = [
        `https://api.mercadopago.com/v1/merchant_orders/${moId}`,
        `https://api.mercadopago.com/merchant_orders/${moId}`
      ];
      const paymentIdsFromOrder = (o) => {
        const out = [];
        if (!o || typeof o !== 'object') return out;
        let raw = [];
        if (Array.isArray(o.payments)) raw = o.payments;
        else if (o.payments && typeof o.payments === 'object') raw = Object.values(o.payments);
        for (const p of raw) {
          if (typeof p === 'number' || (typeof p === 'string' && String(p).trim() !== '' && !Number.isNaN(Number(p)))) {
            out.push(String(p).trim());
            continue;
          }
          if (typeof p === 'object' && p !== null) {
            const pid =
              p.id ??
              p.payment_id ??
              p.payment?.id ??
              (typeof p.payment === 'number' ? p.payment : null);
            if (pid != null && pid !== '') out.push(String(pid));
          }
        }
        if (out.length > 0) return out;
        if (o.payment && typeof o.payment === 'object' && o.payment.id != null) return [String(o.payment.id)];
        return out;
      };

      const searchPaymentsByQuery = async (paramsObj) => {
        const q = new URLSearchParams({
          sort: 'date_created',
          criteria: 'desc',
          ...paramsObj
        });
        const searchRes = await fetch(`https://api.mercadopago.com/v1/payments/search?${q.toString()}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const search = await searchRes.json();
        return { searchRes, search };
      };

      const pickPaymentFromSearchResults = (search) => {
        if (!search || !Array.isArray(search.results) || search.results.length === 0) return null;
        const approved = search.results.find((p) => p && p.status === 'approved');
        return approved || search.results[0];
      };

      /** MP a menudo exige range + fechas para que /payments/search devuelva filas */
      const searchPaymentByExternalRefStrategies = (extRef) => {
        const ref = String(extRef);
        const end = new Date();
        const begin = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000);
        return [
          { external_reference: ref },
          {
            external_reference: ref,
            range: 'date_created',
            begin_date: begin.toISOString(),
            end_date: end.toISOString()
          },
          {
            external_reference: ref,
            range: 'date_last_updated',
            begin_date: begin.toISOString(),
            end_date: end.toISOString()
          }
        ];
      };

      let order = null;
      let lastMoStatus = 0;
      for (const url of orderUrls) {
        const moRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        const body = await moRes.json();
        lastMoStatus = moRes.status;
        if (moRes.ok && body && typeof body === 'object') {
          order = body;
          break;
        }
      }
      if (!order) {
        fastify.log.warn({ merchantOrderId: id, status: lastMoStatus }, 'mercadopago-merchant-order-fetch-failed');
        return reply.code(200).send();
      }

      fastify.log.info(
        {
          merchantOrderId: id,
          order_status: order.order_status,
          status: order.status,
          paid_amount: order.paid_amount,
          total_amount: order.total_amount,
          cancelled: order.cancelled
        },
        'mercadopago-merchant-order-snapshot'
      );

      let paymentIds = paymentIdsFromOrder(order);
      // La notificación a veces llega antes de que MP asocie pagos a la orden
      if (paymentIds.length === 0) {
        await new Promise((r) => setTimeout(r, 900));
        const retryRes = await fetch(orderUrls[0], { headers: { Authorization: `Bearer ${accessToken}` } });
        const retryBody = await retryRes.json();
        if (retryRes.ok && retryBody && typeof retryBody === 'object') {
          paymentIds = paymentIdsFromOrder(retryBody);
          order = retryBody;
        }
      }
      // Aún sin pago en la orden: MP suele notificar merchant_order al abrir el checkout (no hay filas en /payments/search)
      if (
        paymentIds.length === 0 &&
        Number(order.paid_amount || 0) === 0 &&
        !order.cancelled &&
        order.order_status === 'payment_required'
      ) {
        fastify.log.info(
          { merchantOrderId: id, order_status: order.order_status, status: order.status },
          'mercadopago-merchant-order-awaiting-payment'
        );
        return reply.code(200).send();
      }
      // Fallback: GET /v1/payments/search (external_reference; a veces hace falta range + fechas)
      const runPaymentSearchForExtRef = async (extRef, phase) => {
        if (!extRef) return false;
        const strategies = searchPaymentByExternalRefStrategies(extRef);
        for (let si = 0; si < strategies.length; si++) {
          const { searchRes, search } = await searchPaymentsByQuery(strategies[si]);
          const pick = pickPaymentFromSearchResults(search);
          if (searchRes.ok && pick?.id) {
            paymentIds.push(String(pick.id));
            fastify.log.info(
              {
                merchantOrderId: id,
                external_reference: extRef,
                paymentId: pick.id,
                phase,
                strategyIndex: si
              },
              'mercadopago-merchant-order-via-search'
            );
            return true;
          }
          if (!searchRes.ok) {
            fastify.log.warn(
              { merchantOrderId: id, status: searchRes.status, err: search?.message || search, phase, strategyIndex: si },
              'mercadopago-payment-search-failed'
            );
          } else {
            fastify.log.info(
              {
                merchantOrderId: id,
                phase,
                strategyIndex: si,
                pagingTotal: search?.paging?.total,
                resultsLen: Array.isArray(search?.results) ? search.results.length : 0
              },
              'mercadopago-payment-search-empty'
            );
          }
        }
        return false;
      };

      const trySearchPaymentIds = async (label) => {
        if (paymentIds.length > 0) return;
        if (order.external_reference) {
          const ok = await runPaymentSearchForExtRef(order.external_reference, label);
          if (ok) return;
        }
        if (paymentIds.length === 0 && order.preference_id) {
          try {
            const prefRes = await fetch(
              `https://api.mercadopago.com/checkout/preferences/${encodeURIComponent(String(order.preference_id))}`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            const pref = await prefRes.json();
            if (prefRes.ok && pref?.external_reference) {
              await runPaymentSearchForExtRef(pref.external_reference, `${label}-pref`);
            }
          } catch (prefErr) {
            fastify.log.warn({ err: prefErr, merchantOrderId: id }, 'mercadopago-preference-fetch-failed');
          }
        }
      };

      if (paymentIds.length === 0) {
        await trySearchPaymentIds('immediate');
      }
      if (paymentIds.length === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        await trySearchPaymentIds('delayed');
      }
      if (paymentIds.length === 0) {
        await new Promise((r) => setTimeout(r, 2500));
        await trySearchPaymentIds('delayed2');
      }

      if (paymentIds.length === 0) {
        const paySample = Array.isArray(order.payments) && order.payments[0] ? order.payments[0] : null;
        fastify.log.warn(
          {
            merchantOrderId: id,
            orderKeys: Object.keys(order),
            hasExternalRef: !!order.external_reference,
            preference_id: order.preference_id || null,
            paymentsLen: Array.isArray(order.payments) ? order.payments.length : typeof order.payments,
            paymentSampleKeys: paySample && typeof paySample === 'object' ? Object.keys(paySample) : null
          },
          'mercadopago-merchant-order-no-payments'
        );
        return reply.code(200).send();
      }
      const merchantOrderId = String(id);
      id = paymentIds[0];
      topic = 'payment';
      if (paymentIds.length > 1) {
        fastify.log.warn({ merchantOrderId, paymentIds }, 'mercadopago-merchant-order-multiple-using-first');
      }
      fastify.log.info({ merchantOrderId, paymentId: id }, 'mercadopago-merchant-order-resolved');
    } catch (moErr) {
      fastify.log.error(moErr, 'mercadopago-merchant-order-error');
      return reply.code(200).send();
    }
  }

  if (topic !== 'payment' || !id) return reply.code(200).send();
  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const payment = await res.json();
    if (!res.ok) return reply.code(200).send();
    if (payment.status === 'refunded') {
      await maybeRecordAmbassadorRefund(fastify.log, payment);
      return reply.code(200).send();
    }
    if (payment.status !== 'approved') return reply.code(200).send();
    const extRef = String(payment.external_reference || '');
    const tenantMatch = extRef.match(/tenant:([a-f0-9-]+)/i);
    const planMatch = extRef.match(/plan:([a-z0-9-]+)/i);
    const tenantId = tenantMatch?.[1] || null;
    const plan = planMatch?.[1] || 'starter';
    const payerEmail = (payment.payer?.email || '').trim().toLowerCase();
    const payerName = payment.payer?.first_name || payment.payer?.identification?.name || '';

    // Plan Starter: activar caso DRAFT existente o crear nuevo
    if (plan === 'starter' && !tenantId) {
      const paymentIdStr = String(id);
      const existingPaid = await prisma.case.findUnique({ where: { mercadopagoPaymentId: paymentIdStr } });
      if (existingPaid && existingPaid.status !== 'DRAFT') return reply.code(200).send();

      const caseIdMatch = extRef.match(/caseId:([a-f0-9-]+)/i);
      const draftCaseId = caseIdMatch?.[1] || null;

      if (draftCaseId) {
        const draftCase = await prisma.case.findUnique({ where: { id: draftCaseId } });
        if (draftCase && draftCase.status === 'DRAFT') {
          await prisma.case.update({
            where: { id: draftCase.id },
            data: { mercadopagoPaymentId: paymentIdStr, status: 'IN_PROGRESS' }
          });
          fastify.log.info({ caseId: draftCase.id, paymentId: paymentIdStr }, 'mercadopago-starter-draft-activated');
          const starterTipoDte = Number(process.env.SIMPLEFACTURA_STARTER_TIPO_DTE || process.env.SIMPLEFACTURA_TIPO_DTE || 39);
          const sfDraft = await maybeEmitSimpleFacturaForPayment(fastify.log, {
            billingTenantId: draftCase.tenantId,
            mercadopagoPaymentId: paymentIdStr,
            payment,
            facturacionJson: draftCase.facturacionJson,
            lineDescription: SF_LINE_STARTER,
            fallbackMontoClp: STARTER_PRICE_CLP,
            tipoDteDefault: starterTipoDte
          });
          if (sfDraft.dtePdfBuffer && draftCase.contactEmail) {
            try {
              await sendSimplefacturaDtePdfEmail(draftCase.contactEmail, sfDraft.dtePdfBuffer, { folio: sfDraft.folio });
            } catch (mailErr) {
              fastify.log.warn({ err: mailErr }, 'starter-dte-email-failed');
            }
          }
          return reply.code(200).send();
        }
      }

      const starterTenant = await ensureStarterTenant();
      const tokenMatch = extRef.match(/t:([a-f0-9-]+)/i);
      const pendingId = tokenMatch?.[1];
      const pending = pendingId ? await prisma.pendingStarterPayment.findUnique({ where: { id: pendingId } }) : null;
      const contactEmail = pending?.contactEmail || payerEmail || null;
      const contactName = pending ? `${pending.contactNombre} ${pending.contactApellido}`.trim() : payerName || null;
      const contactRut = pending?.contactRut || null;
      const facturacionJson = pending?.necesitaFactura && pending ? {
        razonSocial: pending.facturaRazonSocial,
        rut: pending.facturaRut,
        direccion: pending.facturaDireccion,
        comuna: pending.facturaComuna,
        ciudad: pending.facturaCiudad,
        giro: pending.facturaGiro,
        email: pending.facturaEmail
      } : null;
      await prisma.case.create({
        data: {
          shortId: generateCaseShortId(),
          tenantId: starterTenant.id,
          contactEmail,
          contactName,
          contactRut,
          facturacionJson,
          mercadopagoPaymentId: paymentIdStr,
          propertyType: 'DEPARTMENT',
          bedrooms: 1,
          bathrooms: 1,
          floorType: 'CONCRETE',
          status: 'DRAFT'
        }
      });
      if (pending) {
        await prisma.pendingStarterPayment.update({
          where: { id: pending.id },
          data: { usedAt: new Date() }
        });
      }
      fastify.log.info({ paymentId: paymentIdStr, contactEmail }, 'mercadopago-starter-case-created');
      const starterTipoDte = Number(process.env.SIMPLEFACTURA_STARTER_TIPO_DTE || process.env.SIMPLEFACTURA_TIPO_DTE || 39);
      const sfStarter = await maybeEmitSimpleFacturaForPayment(fastify.log, {
        billingTenantId: starterTenant.id,
        mercadopagoPaymentId: paymentIdStr,
        payment,
        facturacionJson,
        lineDescription: SF_LINE_STARTER,
        fallbackMontoClp: STARTER_PRICE_CLP,
        tipoDteDefault: starterTipoDte
      });
      if (sfStarter.dtePdfBuffer && contactEmail) {
        try {
          await sendSimplefacturaDtePdfEmail(contactEmail, sfStarter.dtePdfBuffer, { folio: sfStarter.folio });
        } catch (mailErr) {
          fastify.log.warn({ err: mailErr }, 'starter-dte-email-failed');
        }
      }
      return reply.code(200).send();
    }

    // Pago recurrente de suscripción Business (preapproval_id presente)
    const preapprovalId = payment.metadata?.preapproval_id || payment.point_of_interaction?.subscription_id || null;
    if (preapprovalId) {
      const subTenant = await prisma.tenant.findFirst({
        where: { mpSubscriptionId: String(preapprovalId) },
        select: {
          id: true,
          email: true,
          name: true,
          passwordHash: true,
          facturacionJson: true,
          trialStatus: true,
          trialEndsAt: true
        }
      });
      if (subTenant) {
        const subAlready = await prisma.creditTransaction.findFirst({
          where: { tenantId: subTenant.id, description: { contains: String(id) } }
        });
        if (!subAlready) {
          await prisma.$transaction(async (tx) => {
            let account = await tx.tenantCredit.findUnique({ where: { tenantId: subTenant.id } });
            if (!account) account = await tx.tenantCredit.create({ data: { tenantId: subTenant.id, balance: 0 } });
            await tx.tenantCredit.update({ where: { tenantId: subTenant.id }, data: { balance: { increment: 2 } } });
            await tx.creditTransaction.create({
              data: {
                tenantId: subTenant.id,
                amount: 2,
                type: 'PURCHASE',
                description: `Suscripción Business mensual (2 créditos) · MP#${id}`
              }
            });
          });

          await prisma.tenant.update({
            where: { id: subTenant.id },
            data: {
              subscriptionStatus: 'authorized',
              subscriptionExpiresAt: new Date(Date.now() + 32 * 24 * 60 * 60 * 1000),
              ...(subTenant.trialStatus === 'active'
                ? { trialStatus: 'converted', trialConvertedAt: new Date(), trialBlockedReason: null }
                : {})
            }
          });
          if (subTenant.trialStatus === 'active') {
            await updateHubspotTrialProperties({
              email: subTenant.email,
              trialStatus: 'converted',
              trialEndsAt: subTenant.trialEndsAt
            }).catch(() => {});
          }

          const sfSub = await maybeEmitSimpleFacturaForPayment(fastify.log, {
            billingTenantId: subTenant.id,
            mercadopagoPaymentId: id,
            payment,
            facturacionJson: subTenant.facturacionJson,
            lineDescription: SF_LINE_BUSINESS,
            fallbackMontoClp: Number(process.env.BUSINESS_PRICE_CLP || 39990),
            tipoDteDefault: Number(process.env.SIMPLEFACTURA_TIPO_DTE || 39)
          });

          // Primer pago: enviar magic link si el tenant no tiene contraseña
          if (!subTenant.passwordHash && subTenant.email) {
            try {
              const token = crypto.randomUUID().replace(/-/g, '');
              const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
              await prisma.magicLinkToken.create({ data: { tenantId: subTenant.id, token, expiresAt } });
              const proto = (req.headers['x-forwarded-proto'] || 'http').toString().split(',')[0].trim();
              const hostH = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').toString().split(',')[0].trim();
              const magicUrl = `${proto}://${hostH}/auth/verify?token=${token}`;
              const BUSINESS_PRICE_CLP_sub = Number(process.env.BUSINESS_PRICE_CLP || 39990);
              let receiptPdfSub = null;
              if (subTenant.facturacionJson && typeof subTenant.facturacionJson === 'object') {
                try {
                  receiptPdfSub = await generateBusinessReceiptPdf({
                    facturacion: subTenant.facturacionJson,
                    montoClp: BUSINESS_PRICE_CLP_sub
                  });
                } catch (pdfErr) {
                  fastify.log.warn({ err: pdfErr }, 'subscription-receipt-pdf-error');
                }
              }
              const sent = await sendBusinessMagicLinkEmail(subTenant.email, magicUrl, subTenant.name, {
                facturacion: subTenant.facturacionJson,
                receiptPdfBuffer: receiptPdfSub,
                dtePdfBuffer: sfSub.dtePdfBuffer,
                montoClp: BUSINESS_PRICE_CLP_sub
              });
              if (sent.ok) fastify.log.info({ tenantId: subTenant.id }, 'subscription-magic-link-sent');
            } catch (mlErr) {
              fastify.log.warn({ err: mlErr }, 'subscription-magic-link-error');
            }
          }

          fastify.log.info({ tenantId: subTenant.id, preapprovalId, paymentId: id }, 'subscription-payment-credits-added');
          await maybeRecordPartnerCommission(fastify.log, {
            tenantId: subTenant.id,
            mercadopagoPaymentId: id,
            payment,
            source: 'SUBSCRIPTION',
            plan: 'business'
          });
        }
        await maybeRecordAmbassadorCommission(fastify.log, {
          tenantId: subTenant.id,
          mercadopagoPaymentId: id,
          payment,
          plan: 'business',
          source: 'SUBSCRIPTION',
          extRef
        });
        if (subAlready) {
          await maybeEmitSimpleFacturaForPayment(fastify.log, {
            billingTenantId: subTenant.id,
            mercadopagoPaymentId: id,
            payment,
            facturacionJson: subTenant.facturacionJson,
            lineDescription: SF_LINE_BUSINESS,
            fallbackMontoClp: Number(process.env.BUSINESS_PRICE_CLP || 39990),
            tipoDteDefault: Number(process.env.SIMPLEFACTURA_TIPO_DTE || 39)
          });
        }
        return reply.code(200).send();
      }
    }

    // Inspección presencial: registrar OC / orden para proveedor (no suma créditos)
    if (plan === 'inspeccion-presencial' && tenantId) {
      const paymentIdStr = String(id);
      await createPresencialOrderFromPayment({
        tenantId,
        extRef,
        paymentIdStr,
        payment,
        log: fastify.log
      });
      await maybeRecordAmbassadorCommission(fastify.log, {
        tenantId,
        mercadopagoPaymentId: paymentIdStr,
        payment,
        plan: 'inspeccion-presencial',
        source: 'CHECKOUT',
        extRef
      });
      return reply.code(200).send();
    }

    // Planes con tenant: créditos (Business = 2 inspecciones incluidas; corporate/bolsas en dashboard)
    const PLANS = { starter: 1, business: 2, corporate: 100, 'credits-10': 10, 'credits-50': 50, 'credits-100': 100, 'credits-5': 5, 'credits-20': 20 };
    const credits = PLANS[plan] ?? 0;
    if (!tenantId) return reply.code(200).send();
    if (credits < 1) {
      if (plan === 'dashboard-standard' || plan === 'dashboard-corporate') {
        await maybeRecordAmbassadorCommission(fastify.log, {
          tenantId,
          mercadopagoPaymentId: String(id),
          payment,
          plan,
          source: 'CHECKOUT',
          extRef
        });
      }
      return reply.code(200).send();
    }

    const alreadyProcessed = await prisma.creditTransaction.findFirst({
      where: { tenantId, description: { contains: String(id) } }
    });
    if (alreadyProcessed) {
      fastify.log.info({ tenantId, paymentId: id }, 'mercadopago-webhook-already-processed');
      return reply.code(200).send();
    }

    await prisma.$transaction(async (tx) => {
      let account = await tx.tenantCredit.findUnique({ where: { tenantId } });
      if (!account) account = await tx.tenantCredit.create({ data: { tenantId, balance: 0 } });
      await tx.tenantCredit.update({
        where: { tenantId },
        data: { balance: { increment: credits } }
      });
      await tx.creditTransaction.create({
        data: {
          tenantId,
          amount: credits,
          type: 'PURCHASE',
          description: `Compra plan ${plan} (${credits} créditos) · MP#${id}`
        }
      });
    });
    fastify.log.info({ tenantId, plan, credits }, 'mercadopago-credits-added');
    await maybeRecordPartnerCommission(fastify.log, {
      tenantId,
      mercadopagoPaymentId: id,
      payment,
      source: 'CREDIT_PURCHASE',
      plan
    });
    await maybeRecordAmbassadorCommission(fastify.log, {
      tenantId,
      mercadopagoPaymentId: String(id),
      payment,
      plan,
      source: 'CHECKOUT',
      extRef
    });

    // Business: enviar magic link para acceso inicial (luego crea contraseña)
    if (plan === 'business') {
      try {
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, name: true, email: true, facturacionJson: true }
        });
        const sfBiz = await maybeEmitSimpleFacturaForPayment(fastify.log, {
          billingTenantId: tenantId,
          mercadopagoPaymentId: id,
          payment,
          facturacionJson: tenant?.facturacionJson,
          lineDescription: SF_LINE_BUSINESS,
          fallbackMontoClp: Number(process.env.BUSINESS_PRICE_CLP || 39990),
          tipoDteDefault: Number(process.env.SIMPLEFACTURA_TIPO_DTE || 39)
        });
        if (tenant?.email) {
          const token = crypto.randomUUID().replace(/-/g, '');
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
          await prisma.magicLinkToken.create({
            data: { tenantId, token, expiresAt }
          });
          const proto = (req.headers['x-forwarded-proto'] || 'http').toString().split(',')[0].trim();
          const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').toString().split(',')[0].trim();
          const baseUrl = `${proto}://${host}`;
          const magicUrl = `${baseUrl}/auth/verify?token=${token}`;
          const BUSINESS_PRICE_CLP = Number(process.env.BUSINESS_PRICE_CLP || 39990);
          let receiptPdf = null;
          if (tenant.facturacionJson && typeof tenant.facturacionJson === 'object') {
            try {
              receiptPdf = await generateBusinessReceiptPdf({ facturacion: tenant.facturacionJson, montoClp: BUSINESS_PRICE_CLP });
            } catch (pdfErr) {
              fastify.log.warn({ err: pdfErr }, 'business-receipt-pdf-error');
            }
          }
          const sent = await sendBusinessMagicLinkEmail(tenant.email, magicUrl, tenant.name, {
            facturacion: tenant.facturacionJson,
            receiptPdfBuffer: receiptPdf,
            dtePdfBuffer: sfBiz.dtePdfBuffer,
            montoClp: BUSINESS_PRICE_CLP
          });
          if (sent.ok) fastify.log.info({ tenantId, email: tenant.email }, 'business-magic-link-sent');
          else fastify.log.warn({ tenantId, err: sent.error }, 'business-magic-link-failed');
        } else {
          fastify.log.warn({ tenantId }, 'business-magic-link-skipped-no-email');
        }
      } catch (err) {
        fastify.log.error({ err, tenantId }, 'business-magic-link-error');
      }
    }
  } catch (err) {
    fastify.log.error(err, 'mercadopago-webhook');
  }
  return reply.code(200).send();
});

// Verificar pago de MercadoPago y procesar créditos (fallback cuando webhook no llega)
fastify.post('/api/mercadopago/verify-payment', async (req, reply) => {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return reply.code(503).send({ ok: false, error: 'MP_NOT_CONFIGURED' });

  const paymentId = req.body?.payment_id || req.body?.collection_id;
  if (!paymentId) return reply.code(400).send({ ok: false, error: 'MISSING_PAYMENT_ID' });

  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const payment = await res.json();
    if (!res.ok) return reply.code(502).send({ ok: false, error: 'MP_API_ERROR' });
    if (payment.status !== 'approved') {
      return reply.send({ ok: false, status: payment.status, error: 'PAYMENT_NOT_APPROVED' });
    }

    const extRef = String(payment.external_reference || '');
    const tenantMatch = extRef.match(/tenant:([a-f0-9-]+)/i);
    const planMatch = extRef.match(/plan:([a-z0-9-]+)/i);
    const tenantId = tenantMatch?.[1] || null;
    const plan = planMatch?.[1] || '';

    if (plan === 'inspeccion-presencial' && tenantId) {
      const r = await createPresencialOrderFromPayment({
        tenantId,
        extRef,
        paymentIdStr: String(paymentId),
        payment,
        log: fastify.log
      });
      await maybeRecordAmbassadorCommission(fastify.log, {
        tenantId,
        mercadopagoPaymentId: String(paymentId),
        payment,
        plan: 'inspeccion-presencial',
        source: 'CHECKOUT',
        extRef
      });
      return reply.send({
        ok: true,
        status: 'approved',
        presencialOrder: true,
        alreadyProcessed: !!r.skipped
      });
    }

    const PLANS = { business: 2, 'credits-10': 10, 'credits-50': 50, 'credits-100': 100, 'credits-5': 5, 'credits-20': 20 };
    const credits = PLANS[plan] ?? 0;

    if (!tenantId || credits < 1) {
      if (tenantId && (plan === 'dashboard-standard' || plan === 'dashboard-corporate')) {
        await maybeRecordAmbassadorCommission(fastify.log, {
          tenantId,
          mercadopagoPaymentId: String(paymentId),
          payment,
          plan,
          source: 'CHECKOUT',
          extRef
        });
      }
      return reply.send({ ok: true, status: 'approved', credits: 0, message: 'No credits to add for this plan' });
    }

    const existing = await prisma.creditTransaction.findFirst({
      where: { tenantId, description: { contains: String(paymentId) } }
    });
    if (existing) {
      return reply.send({ ok: true, status: 'approved', credits, alreadyProcessed: true });
    }

    await prisma.$transaction(async (tx) => {
      let account = await tx.tenantCredit.findUnique({ where: { tenantId } });
      if (!account) account = await tx.tenantCredit.create({ data: { tenantId, balance: 0 } });
      await tx.tenantCredit.update({
        where: { tenantId },
        data: { balance: { increment: credits } }
      });
      await tx.creditTransaction.create({
        data: {
          tenantId,
          amount: credits,
          type: 'PURCHASE',
          description: `Compra plan ${plan} (${credits} créditos) · MP#${paymentId}`
        }
      });
    });

    fastify.log.info({ tenantId, plan, credits, paymentId }, 'mercadopago-verify-credits-added');
    await maybeRecordPartnerCommission(fastify.log, {
      tenantId,
      mercadopagoPaymentId: paymentId,
      payment,
      source: 'CREDIT_PURCHASE',
      plan
    });
    await maybeRecordAmbassadorCommission(fastify.log, {
      tenantId,
      mercadopagoPaymentId: String(paymentId),
      payment,
      plan,
      source: 'CHECKOUT',
      extRef
    });
    if (plan === 'business') {
      const t = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { facturacionJson: true }
      });
      await maybeEmitSimpleFacturaForPayment(fastify.log, {
        billingTenantId: tenantId,
        mercadopagoPaymentId: paymentId,
        payment,
        facturacionJson: t?.facturacionJson,
        lineDescription: SF_LINE_BUSINESS,
        fallbackMontoClp: Number(process.env.BUSINESS_PRICE_CLP || 39990),
        tipoDteDefault: Number(process.env.SIMPLEFACTURA_TIPO_DTE || 39)
      });
    }
    return reply.send({ ok: true, status: 'approved', credits, added: true });
  } catch (err) {
    fastify.log.error(err, 'mercadopago-verify-payment');
    return reply.code(500).send({ ok: false, error: err?.message || 'Error verifying payment' });
  }
});

// Verificar estado de suscripción Business al volver de MercadoPago
fastify.post('/api/business/verify-subscription', async (req, reply) => {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const tenantId = req.body?.tenantId;
  if (!accessToken || !tenantId) return reply.code(400).send({ ok: false, error: 'Missing data' });

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        mpSubscriptionId: true,
        subscriptionStatus: true,
        passwordHash: true,
        facturacionJson: true,
        trialStatus: true,
        trialEndsAt: true
      }
    });
    if (!tenant || !tenant.mpSubscriptionId) return reply.code(404).send({ ok: false, error: 'No subscription found' });

    const subRes = await fetch(`https://api.mercadopago.com/preapproval/${tenant.mpSubscriptionId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const sub = await subRes.json();
    if (!subRes.ok) return reply.code(502).send({ ok: false, error: 'MP API error' });

    const status = sub.status || 'unknown';
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        subscriptionStatus: status,
        ...((status === 'authorized' || status === 'active') && tenant.trialStatus === 'active'
          ? { trialStatus: 'converted', trialConvertedAt: new Date(), trialBlockedReason: null }
          : {})
      }
    });
    if ((status === 'authorized' || status === 'active') && tenant.trialStatus === 'active') {
      await updateHubspotTrialProperties({
        email: tenant.email,
        trialStatus: 'converted',
        trialEndsAt: tenant.trialEndsAt
      }).catch(() => {});
    }

    if (status === 'authorized' || status === 'active') {
      const alreadyCredited = await prisma.creditTransaction.findFirst({
        where: { tenantId: tenant.id, description: { contains: tenant.mpSubscriptionId } }
      });

      if (!alreadyCredited) {
        await prisma.$transaction(async (tx) => {
          let account = await tx.tenantCredit.findUnique({ where: { tenantId: tenant.id } });
          if (!account) account = await tx.tenantCredit.create({ data: { tenantId: tenant.id, balance: 0 } });
          await tx.tenantCredit.update({ where: { tenantId: tenant.id }, data: { balance: { increment: 2 } } });
          await tx.creditTransaction.create({
            data: {
              tenantId: tenant.id,
              amount: 2,
              type: 'PURCHASE',
              description: `Suscripción Business activada (2 créditos) · SUB#${tenant.mpSubscriptionId}`
            }
          });
        });

        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { subscriptionExpiresAt: new Date(Date.now() + 32 * 24 * 60 * 60 * 1000) }
        });
      }

      // Enviar magic link si no tiene contraseña
      if (!tenant.passwordHash && tenant.email) {
        const existingLink = await prisma.magicLinkToken.findFirst({
          where: { tenantId: tenant.id, expiresAt: { gt: new Date() }, usedAt: null }
        });
        if (!existingLink) {
          const token = crypto.randomUUID().replace(/-/g, '');
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          await prisma.magicLinkToken.create({ data: { tenantId: tenant.id, token, expiresAt } });
          const proto = (req.headers['x-forwarded-proto'] || 'http').toString().split(',')[0].trim();
          const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').toString().split(',')[0].trim();
          const magicUrl = `${proto}://${host}/auth/verify?token=${token}`;
          const BUSINESS_PRICE_CLP_v = Number(process.env.BUSINESS_PRICE_CLP || 39990);
          await sendBusinessMagicLinkEmail(tenant.email, magicUrl, tenant.name, {
            facturacion: tenant.facturacionJson,
            montoClp: BUSINESS_PRICE_CLP_v
          });
        }
      }

      return reply.send({ ok: true, status, credits: 2, subscriptionActive: true });
    }

    return reply.send({ ok: true, status, subscriptionActive: false });
  } catch (err) {
    fastify.log.error(err, 'verify-subscription');
    return reply.code(500).send({ ok: false, error: err?.message || 'Error' });
  }
});

// Cancelar suscripción Business
fastify.post('/api/business/cancel-subscription', async (req, reply) => {
  const session = await getTenantSession(req);
  if (!session || !session.tenantId) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return reply.code(503).send({ ok: false, error: 'MP_NOT_CONFIGURED' });

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { id: true, email: true, mpSubscriptionId: true, trialStatus: true, trialEndsAt: true }
    });
    if (!tenant?.mpSubscriptionId) return reply.code(404).send({ ok: false, error: 'No subscription found' });

    const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${tenant.mpSubscriptionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ status: 'cancelled' })
    });
    const mpData = await mpRes.json();
    if (!mpRes.ok) {
      fastify.log.error({ mpData, status: mpRes.status }, 'cancel-subscription-mp-error');
      return reply.code(502).send({ ok: false, error: 'Error al cancelar en MercadoPago' });
    }

    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        subscriptionStatus: 'cancelled',
        ...(tenant.trialStatus === 'active' ? { trialStatus: 'cancelled', trialCancelledAt: new Date() } : {})
      }
    });
    if (tenant.trialStatus === 'active') {
      await updateHubspotTrialProperties({
        email: tenant.email,
        trialStatus: 'cancelled',
        trialEndsAt: tenant.trialEndsAt
      }).catch(() => {});
    }

    fastify.log.info({ tenantId: tenant.id, subscriptionId: tenant.mpSubscriptionId }, 'subscription-cancelled');
    return reply.send({ ok: true, status: 'cancelled' });
  } catch (err) {
    fastify.log.error(err, 'cancel-subscription');
    return reply.code(500).send({ ok: false, error: err?.message || 'Error' });
  }
});

// Starter: completar caso tras pago (formulario público)
fastify.get('/api/starter/cases/by-payment/:paymentId', async (req, reply) => {
  const paymentId = String(req.params.paymentId || '').trim();
  if (!paymentId) return reply.code(400).send({ ok: false, error: 'MISSING_PAYMENT_ID' });
  const c = await prisma.case.findUnique({
    where: { mercadopagoPaymentId: paymentId },
    select: { id: true, shortId: true, contactEmail: true, contactName: true, status: true, propertyId: true }
  });
  if (!c) return reply.code(404).send({ ok: false, error: 'CASE_NOT_FOUND' });
  return reply.send({ ok: true, case: c });
});

fastify.post('/api/starter/cases', async (req, reply) => {
  const payload = req.body || {};
  const paymentId = String(payload.paymentId || payload.payment_id || '').trim();
  if (!paymentId) return reply.code(400).send({ ok: false, error: 'MISSING_PAYMENT_ID' });

  const bathroomsCount = Number(payload.bathroomsCount || payload.bathrooms || 1);
  const bedroomsCount = Number(payload.bedroomsCount || payload.bedrooms || 1);
  const bedrooms = Number(payload.bedrooms || bedroomsCount || 0);
  const bathrooms = Number(payload.bathrooms || bathroomsCount || 1);

  const planSlots = buildPhotoPlanV1({
    ...payload,
    bathroomsCount,
    bedroomsCount,
    hasLaundry: true,
    hasElevator: true,
    hasGreenCertificate: true
  });
  const token = crypto.randomUUID();
  const captureExpires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

  let c = await prisma.case.findUnique({ where: { mercadopagoPaymentId: paymentId }, include: { property: true } });
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;

  if (!c) {
    if (!accessToken) return reply.code(503).send({ ok: false, error: 'PAYMENT_VERIFICATION_UNAVAILABLE' });
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const payment = await res.json();
    if (!res.ok || payment.status !== 'approved') {
      return reply.code(400).send({ ok: false, error: 'PAYMENT_NOT_APPROVED', message: 'El pago no está aprobado.' });
    }
    const extRef = String(payment.external_reference || '');
    const planMatch = extRef.match(/plan:([a-z0-9-]+)/i);
    const plan = planMatch?.[1] || 'starter';
    if (plan !== 'starter') return reply.code(400).send({ ok: false, error: 'NOT_STARTER_PAYMENT' });
    const starterTenant = await ensureStarterTenant();
    const payerEmail = (payment.payer?.email || '').trim().toLowerCase();
    const payerName = payment.payer?.first_name || payment.payer?.identification?.name || '';
    c = await prisma.case.create({
      data: {
        shortId: generateCaseShortId(),
        tenantId: starterTenant.id,
        contactEmail: payerEmail || null,
        contactName: payerName || null,
        mercadopagoPaymentId: paymentId,
        propertyType: payload.propertyType || 'DEPARTMENT',
        bedrooms: 1,
        bathrooms: 1,
        floorType: 'CONCRETE',
        status: 'DRAFT'
      }
    });
  }

  if (c.propertyId) return reply.code(400).send({ ok: false, error: 'CASE_ALREADY_COMPLETED', message: 'Esta inspección ya tiene datos de propiedad.' });

  const starterTenantId = c.tenantId;
  let ownerId = null;
  const ownerRutNorm = payload.ownerRut ? normalizeRut(payload.ownerRut) : null;
  if (ownerRutNorm || payload.ownerName) {
    if (ownerRutNorm) {
      const existing = await prisma.owner.findFirst({ where: { OR: [{ rut: ownerRutNorm }, { rut: String(payload.ownerRut || '').trim() }] } });
      if (existing) ownerId = existing.id;
    }
    if (!ownerId && payload.ownerName) {
      const created = await prisma.owner.create({ data: { fullName: payload.ownerName, rut: ownerRutNorm || payload.ownerRut || null, tenantId: starterTenantId } });
      ownerId = created.id;
    }
  }

  const property = await prisma.property.create({
    data: {
      tenantId: starterTenantId,
      ownerId,
      rol: payload.propertyRol || null,
      address: payload.propertyAddress || null,
      operationType: payload.propertyOperationType || null,
      surface: payload.propertySurface || null
    }
  });

  await prisma.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: c.id },
      data: {
        propertyId: property.id,
        propertyType: payload.propertyType || 'DEPARTMENT',
        bathroomsCount,
        bedroomsCount,
        bedrooms,
        bathrooms,
        yearBuilt: payload.yearBuilt ? Number(payload.yearBuilt) : null,
        floorType: (payload.floorType || 'CONCRETE').toUpperCase(),
        propertyAgeRange: payload.propertyAgeRange || null,
        hasPatio: false,
        hasAttic: false,
        hasLaundry: true,
        hasElevator: true,
        hasParking: false,
        hasGreenCertificate: true,
        hasEntranceGrille: !!payload.hasEntranceGrille
      }
    });
    await tx.slot.createMany({
      data: planSlots.map((s, idx) => ({
        tenantId: starterTenantId,
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
      data: { tenantId: starterTenantId, caseId: c.id, token, expiresAt: captureExpires }
    });
  });

  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim();
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0].trim();
  const baseUrl = host ? `${proto || 'https'}://${host}` : (process.env.PUBLIC_URL || 'https://ainspecciona.com');
  const captureUrlFull = `${baseUrl.replace(/\/$/, '')}/capture/${token}`;

  // Enviar email con enlace de inspección
  let emailSent = false;
  if (c.contactEmail) {
    try {
      const r = await sendInspectionLinkEmail(c.contactEmail, captureUrlFull, c.contactName);
      emailSent = r.ok;
      if (r.ok) fastify.log.info({ to: c.contactEmail }, 'email-inspection-link-sent');
      else if (!r.skipped) fastify.log.warn({ to: c.contactEmail, error: r.error }, 'email-inspection-link-failed');
    } catch (err) {
      fastify.log.warn({ err, to: c.contactEmail }, 'email-inspection-link-error');
    }
  }

  fastify.log.info({ caseId: c.id, paymentId, contactEmail: c.contactEmail, emailSent }, 'starter-case-completed');
  return reply.send({
    ok: true,
    caseId: c.id,
    shortId: c.shortId,
    captureUrl: `/capture/${token}`,
    captureUrlFull,
    emailSent
  });
});

fastify.get('/api/photo-proxy', async (req, reply) => {
  const url = req.query?.url;
  if (!url || typeof url !== 'string') return reply.code(400).send({ error: 'Missing url' });
  const allowedHosts = ['storage.googleapis.com'];
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !allowedHosts.includes(parsed.hostname)) {
      return reply.code(403).send({ error: 'URL not allowed' });
    }
    let buf;
    try {
      buf = await storage.readBuffer(url);
    } catch (e) {
      const res = await fetch(url, { headers: { 'User-Agent': 'Ainspecciona/1' } });
      if (!res.ok) return reply.code(res.status).send(res.statusText);
      buf = Buffer.from(await res.arrayBuffer());
    }
    const contentType = 'image/jpeg';
    return reply.header('Content-Type', contentType).header('Cache-Control', 'public, max-age=86400').send(buf);
  } catch (err) {
    fastify.log.warn(err, 'photo-proxy');
    return reply.code(502).send({ error: 'Fetch failed' });
  }
});

fastify.get('/api/photos/:photoId', async (req, reply) => {
  const { photoId } = req.params;
  if (!photoId) return reply.code(400).send({ error: 'Missing photoId' });
  try {
    const photo = await prisma.photo.findUnique({ where: { id: photoId } });
    if (!photo?.filePath) return reply.code(404).send({ error: 'Photo not found' });
    const buf = await storage.readBuffer(photo.filePath);
    const contentType = photo.mimeType || 'image/jpeg';
    return reply.header('Content-Type', contentType).header('Cache-Control', 'public, max-age=86400').send(buf);
  } catch (err) {
    fastify.log.warn(err, 'photo-serve');
    return reply.code(502).send({ error: 'Failed to load photo' });
  }
});

fastify.get('/api/qr', async (req, reply) => {
  const data = req.query?.data;
  if (!data) return reply.code(400).send({ error: 'Missing data' });
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=0&data=${encodeURIComponent(data)}`;
  try {
    const res = await fetch(qrUrl);
    if (!res.ok) return reply.code(502).send({ error: 'QR service error' });
    const buf = Buffer.from(await res.arrayBuffer());
    return reply.header('Content-Type', res.headers.get('content-type') || 'image/png').send(buf);
  } catch (err) {
    fastify.log.warn(err);
    return reply.code(502).send({ error: 'QR unavailable' });
  }
});

fastify.get('/api/health', async (req, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return reply.send({ ok: true, db: 'connected' });
  } catch (err) {
    fastify.log.error({ err: err?.message }, 'health-check');
    const hint = (err?.message?.includes('127.0.0.1:3306') || err?.message?.includes('3306'))
      ? 'En Cloud Run usa socket: mysql://USER:PASS@localhost/DB?socket=/cloudsql/PROJECT:REGION:INSTANCE (sin :3306)'
      : null;
    return reply.code(500).send({
      ok: false,
      db: 'error',
      message: err?.message,
      code: err?.code,
      ...(hint && { hint })
    });
  }
});

fastify.get('/api/debug-db', async (req, reply) => {
  const url = process.env.DATABASE_URL || '';
  const hasSocket = url.includes('socket=') && url.includes('/cloudsql/');
  const hasPort = url.includes(':3306');
  try {
    await prisma.$queryRaw`SELECT 1`;
    const tenantCount = await prisma.tenant.count();
    return reply.send({
      ok: true,
      db: 'connected',
      tenantCount,
      config: { hasSocket, hasPort: !!hasPort }
    });
  } catch (err) {
    return reply.send({
      ok: false,
      db: 'error',
      message: String(err?.message || '').substring(0, 200),
      code: err?.code,
      config: { hasSocket, hasPort: !!hasPort }
    });
  }
});

// Protección de rutas de administración
function isAdminAuthed(req) {
  const expectedUser = process.env.ADMIN_USER || 'admin';
  const expectedPass = process.env.ADMIN_PASS || 'admin123';
  return req.headers['x-admin-user'] === expectedUser && req.headers['x-admin-pass'] === expectedPass;
}

fastify.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/api/admin')) {
    if (!isAdminAuthed(req)) {
      req.log.warn({ url: req.url, ip: req.ip }, 'Intento de acceso admin no autorizado');
      return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED_ADMIN' });
    }
  }
});

fastify.get('/api/admin/score-config', async (req, reply) => {
  const runtime = await getRuntimeScoreConfig({ force: true });
  return reply.send({ ok: true, config: runtime.config, updatedAt: runtime.updatedAt ? runtime.updatedAt.toISOString() : null });
});

fastify.post('/api/admin/score-config', async (req, reply) => {
  const payload = req.body || {};
  const incoming = payload.config ?? payload;
  scoreConfig = await saveScoreConfigToDb(incoming);
  scoreConfigRuntimeCache.config = scoreConfig;
  scoreConfigRuntimeCache.updatedAt = new Date();
  scoreConfigRuntimeCache.fetchedAt = Date.now();
  try {
    saveScoreConfig(scoreConfig);
  } catch (_) {}
  return reply.send({ ok: true, config: scoreConfig });
});

fastify.get('/api/admin/stats', async (req, reply) => {
  try {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const last30min = new Date(Date.now() - 30 * 60 * 1000);

    const [
      tenantCount, tenantCountToday,
      caseCount, caseCountToday,
      casesDone, casesInProgress,
      activeSessions,
      creditsPurchased, creditsConsumed,
      casesPaid, casesDemo
    ] = await Promise.all([
      prisma.tenant.count({ where: { name: { not: STARTER_TENANT_NAME } } }),
      prisma.tenant.count({ where: { name: { not: STARTER_TENANT_NAME }, createdAt: { gte: todayStart } } }),
      prisma.case.count(),
      prisma.case.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.case.count({ where: { status: 'DONE' } }),
      prisma.case.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.$queryRawUnsafe('SELECT COUNT(DISTINCT ip) as c FROM PageView WHERE createdAt >= ?', new Date(Date.now() - 5 * 60 * 1000)).then(r => Number(r?.[0]?.c || 0)).catch(() => 0),
      prisma.creditTransaction.aggregate({ _sum: { amount: true }, where: { type: 'PURCHASE' } }),
      prisma.creditTransaction.aggregate({ _sum: { amount: true }, where: { type: 'CONSUMPTION' } }),
      prisma.case.count({ where: { mercadopagoPaymentId: { not: null }, NOT: { mercadopagoPaymentId: { startsWith: 'demo_' } } } }),
      prisma.case.count({ where: { OR: [{ mercadopagoPaymentId: null }, { mercadopagoPaymentId: { startsWith: 'demo_' } }] } })
    ]);

    const conversionRate = caseCount > 0 ? Math.round((casesDone / caseCount) * 100) : 0;

    return reply.send({
      ok: true,
      tenantCount, tenantCountToday,
      caseCount, caseCountToday,
      casesDone, casesInProgress,
      activeSessions,
      conversionRate,
      casesPaid, casesDemo,
      creditsPurchased: creditsPurchased._sum.amount || 0,
      creditsConsumed: Math.abs(creditsConsumed._sum.amount || 0)
    });
  } catch (err) {
    req.log.error(err, 'GET /api/admin/stats');
    return reply.code(500).send({ ok: false, error: 'DB_ERROR' });
  }
});

// --- Page view tracking ---
fastify.post('/api/track', async (req, reply) => {
  try {
    const { path: pagePath, referrer } = req.body || {};
    if (!pagePath || typeof pagePath !== 'string') return reply.code(400).send({ ok: false });
    const ua = req.headers['user-agent'] || null;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null;
    await prisma.pageView.create({
      data: { id: crypto.randomUUID(), path: pagePath.slice(0, 512), referrer: referrer?.slice(0, 1024) || null, ua: ua?.slice(0, 512) || null, ip: ip?.slice(0, 64) || null }
    });
    return reply.send({ ok: true });
  } catch (err) {
    req.log.warn(err, 'track-pageview');
    return reply.send({ ok: true });
  }
});

fastify.get('/api/admin/visits', async (req, reply) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const rows = await prisma.$queryRawUnsafe(
      `SELECT DATE(createdAt) as day, COUNT(*) as views, COUNT(DISTINCT ip) as visitors
       FROM PageView WHERE createdAt >= ? GROUP BY DATE(createdAt) ORDER BY day ASC`,
      since
    );

    const result = (rows || []).map(r => ({
      day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
      views: Number(r.views),
      visitors: Number(r.visitors)
    }));

    return reply.send({ ok: true, visits: result });
  } catch (err) {
    req.log.error(err, 'GET /api/admin/visits');
    return reply.code(500).send({ ok: false, error: 'DB_ERROR' });
  }
});

function analyticsSince(days) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);
  return since;
}

fastify.get('/api/admin/analytics/funnel-business', async (req, reply) => {
  try {
    const days = clampDays(req.query?.days);
    const data = await queryFunnelBusiness(prisma, analyticsSince(days), STARTER_TENANT_NAME);
    return reply.send({ ok: true, days, ...data });
  } catch (err) {
    req.log.error(err, 'GET /api/admin/analytics/funnel-business');
    return reply.code(500).send({ ok: false, error: 'DB_ERROR' });
  }
});

fastify.get('/api/admin/analytics/inspections-daily', async (req, reply) => {
  try {
    const days = clampDays(req.query?.days);
    const series = await queryInspectionsDaily(prisma, analyticsSince(days));
    return reply.send({ ok: true, days, series });
  } catch (err) {
    req.log.error(err, 'GET /api/admin/analytics/inspections-daily');
    return reply.code(500).send({ ok: false, error: 'DB_ERROR' });
  }
});

fastify.get('/api/admin/analytics/inspections-geo', async (req, reply) => {
  try {
    const days = clampDays(req.query?.days);
    const addresses = await queryInspectionAddresses(prisma, analyticsSince(days));
    const geo = aggregateGeo(addresses);
    return reply.send({
      ok: true,
      days,
      ...geo,
      disclaimer: 'Datos estimados por dirección libre (sin geocodificación).'
    });
  } catch (err) {
    req.log.error(err, 'GET /api/admin/analytics/inspections-geo');
    return reply.code(500).send({ ok: false, error: 'DB_ERROR' });
  }
});

fastify.get('/api/admin/analytics/inspections-heatmap', async (req, reply) => {
  try {
    const days = clampDays(req.query?.days);
    const heatmap = await queryInspectionsHeatmap(prisma, analyticsSince(days));
    return reply.send({ ok: true, days, heatmap });
  } catch (err) {
    req.log.error(err, 'GET /api/admin/analytics/inspections-heatmap');
    return reply.code(500).send({ ok: false, error: 'DB_ERROR' });
  }
});

fastify.get('/api/admin/analytics/analysis-accuracy', async (req, reply) => {
  try {
    const days = clampDays(req.query?.days);
    const data = await queryAnalysisAccuracyDaily(prisma, analyticsSince(days));
    return reply.send({ ok: true, days, ...data });
  } catch (err) {
    req.log.error(err, 'GET /api/admin/analytics/analysis-accuracy');
    return reply.code(500).send({ ok: false, error: 'DB_ERROR' });
  }
});

// select sin logoUrl: evita error si la columna no existe en prod (migración pendiente)
const tenantSelectBase = { id: true, name: true, legalName: true, rut: true, email: true, phone: true, status: true, createdAt: true, passwordHash: true };

// Lista de tenants para filtros del dashboard (id, name, planType)
fastify.get('/api/tenants', async (req, reply) => {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  });
  const rows = tenants.map((t) => ({
    id: t.id,
    name: t.name,
    planType: t.name === STARTER_TENANT_NAME ? 'Starter' : 'Business'
  }));
  return reply.send({ ok: true, tenants: rows });
});

fastify.get('/api/admin/tenants', async (req, reply) => {
  const tenants = await prisma.tenant.findMany({
    select: tenantSelectBase,
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

fastify.get('/api/admin/referral-partners/commissions', async (req, reply) => {
  try {
    const partnerId = req.query?.partnerId ? String(req.query.partnerId) : undefined;
    const where = partnerId ? { referralPartnerId: partnerId } : {};
    const accruals = await prisma.partnerCommissionAccrual.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        referralPartner: { select: { code: true, name: true } },
        tenant: { select: { name: true, email: true } }
      }
    });
    return reply.send({ ok: true, accruals });
  } catch (err) {
    req.log.error({ err }, 'admin-referral-commissions');
    return reply.code(500).send({ ok: false, error: 'LIST_FAILED' });
  }
});

fastify.get('/api/admin/referral-partners', async (req, reply) => {
  try {
    const partners = await prisma.referralPartner.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        contactEmail: true,
        commissionRate: true,
        active: true,
        createdAt: true,
        updatedAt: true
      }
    });
    return reply.send({ ok: true, partners });
  } catch (err) {
    req.log.error({ err }, 'admin-referral-partners-list');
    return reply.code(500).send({ ok: false, error: 'LIST_FAILED' });
  }
});

fastify.post('/api/admin/referral-partners', async (req, reply) => {
  try {
    const p = req.body || {};
    const code = normalizePartnerCode(p.code);
    const name = String(p.name || '').trim();
    const type = String(p.type || 'ALIANZA').trim();
    if (!code || !name) return reply.code(400).send({ ok: false, error: 'CODE_AND_NAME_REQUIRED' });
    const commissionRate = p.commissionRate != null ? String(p.commissionRate) : '0.15';
    const partner = await prisma.referralPartner.create({
      data: {
        code,
        name,
        type,
        contactEmail: p.contactEmail ? String(p.contactEmail).trim().toLowerCase() : null,
        payoutJson: p.payoutJson && typeof p.payoutJson === 'object' ? p.payoutJson : undefined,
        commissionRate,
        active: p.active !== false
      }
    });
    return reply.send({ ok: true, partner });
  } catch (err) {
    if (String(err?.message || '').includes('Unique') || String(err?.code || '') === 'P2002') {
      return reply.code(409).send({ ok: false, error: 'CODE_EXISTS' });
    }
    req.log.error({ err }, 'admin-referral-partners-create');
    return reply.code(500).send({ ok: false, error: 'CREATE_FAILED' });
  }
});

fastify.put('/api/admin/referral-partners/:partnerId', async (req, reply) => {
  try {
    const partnerId = String(req.params.partnerId || '');
    const p = req.body || {};
    const data = {};
    if (p.name !== undefined) data.name = String(p.name).trim();
    if (p.type !== undefined) data.type = String(p.type).trim();
    if (p.contactEmail !== undefined) {
      data.contactEmail = p.contactEmail ? String(p.contactEmail).trim().toLowerCase() : null;
    }
    if (p.payoutJson !== undefined) data.payoutJson = p.payoutJson;
    if (p.commissionRate !== undefined) data.commissionRate = String(p.commissionRate);
    if (p.active !== undefined) data.active = Boolean(p.active);
    const partner = await prisma.referralPartner.update({
      where: { id: partnerId },
      data
    });
    return reply.send({ ok: true, partner });
  } catch (err) {
    if (String(err?.code || '') === 'P2025') {
      return reply.code(404).send({ ok: false, error: 'PARTNER_NOT_FOUND' });
    }
    req.log.error({ err }, 'admin-referral-partners-update');
    return reply.code(500).send({ ok: false, error: 'UPDATE_FAILED' });
  }
});

fastify.get('/api/admin/suppliers', async (req, reply) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: [{ isDefaultPresencial: 'desc' }, { name: 'asc' }]
    });
    return reply.send({ ok: true, suppliers });
  } catch (err) {
    if (String(err?.message || '').includes('Supplier') || String(err?.code || '') === 'P2021') {
      return reply.code(503).send({
        ok: false,
        error: 'MIGRATION_REQUIRED',
        message: 'Ejecuta migraciones Prisma (tabla Supplier).'
      });
    }
    req.log.error({ err }, 'admin-suppliers-list');
    return reply.code(500).send({ ok: false, error: 'LIST_FAILED' });
  }
});

function normalizeSupplierCodeInput(rawCode, fallbackText) {
  let code = String(rawCode || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!code && fallbackText) {
    code = String(fallbackText)
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
  }
  return code;
}

fastify.post('/api/admin/suppliers', async (req, reply) => {
  try {
    const p = req.body || {};
    const legalName = String(p.legalName || p.name || '').trim();
    const code = normalizeSupplierCodeInput(p.code, legalName);
    const name = String(p.name || legalName).trim();
    const rutVal = String(p.rut || '').trim();
    if (!legalName || !code) {
      return reply.code(400).send({ ok: false, error: 'LEGAL_NAME_REQUIRED' });
    }
    if (!rutVal) {
      return reply.code(400).send({ ok: false, error: 'RUT_REQUIRED' });
    }
    const setDefault = p.isDefaultPresencial === true;
    if (setDefault) {
      await prisma.supplier.updateMany({ where: {}, data: { isDefaultPresencial: false } });
    }
    const supplier = await prisma.supplier.create({
      data: {
        code,
        name,
        legalName,
        rut: rutVal,
        address: p.address ? String(p.address).trim() : null,
        codigo: p.codigo ? String(p.codigo).trim() : null,
        email: p.email ? String(p.email).trim().toLowerCase() : null,
        phone: p.phone ? String(p.phone).trim() : null,
        contactName: p.contactName ? String(p.contactName).trim() : null,
        notes: p.notes ? String(p.notes) : null,
        active: p.active !== false,
        isDefaultPresencial: setDefault
      }
    });
    return reply.send({ ok: true, supplier });
  } catch (err) {
    if (String(err?.message || '').includes('Unique') || String(err?.code || '') === 'P2002') {
      return reply.code(409).send({ ok: false, error: 'CODE_EXISTS' });
    }
    req.log.error({ err }, 'admin-suppliers-create');
    const msg = String(err?.message || 'Error desconocido');
    const short = msg.length > 280 ? `${msg.slice(0, 280)}…` : msg;
    return reply.code(500).send({ ok: false, error: 'CREATE_FAILED', message: short });
  }
});

fastify.patch('/api/admin/suppliers/:supplierId', async (req, reply) => {
  try {
    const supplierId = String(req.params.supplierId || '');
    const p = req.body || {};
    const data = {};
    if (p.name !== undefined) data.name = String(p.name).trim();
    if (p.legalName !== undefined) data.legalName = p.legalName ? String(p.legalName).trim() : null;
    if (p.rut !== undefined) {
      const rv = String(p.rut).trim();
      if (!rv) {
        return reply.code(400).send({ ok: false, error: 'RUT_REQUIRED' });
      }
      data.rut = rv;
    }
    if (p.address !== undefined) data.address = p.address ? String(p.address).trim() : null;
    if (p.codigo !== undefined) data.codigo = p.codigo ? String(p.codigo).trim() : null;
    if (p.email !== undefined) data.email = p.email ? String(p.email).trim().toLowerCase() : null;
    if (p.phone !== undefined) data.phone = p.phone ? String(p.phone).trim() : null;
    if (p.contactName !== undefined) data.contactName = p.contactName ? String(p.contactName).trim() : null;
    if (p.notes !== undefined) data.notes = p.notes ? String(p.notes) : null;
    if (p.active !== undefined) data.active = Boolean(p.active);
    if (p.isDefaultPresencial === true) {
      await prisma.supplier.updateMany({ where: {}, data: { isDefaultPresencial: false } });
      data.isDefaultPresencial = true;
    } else if (p.isDefaultPresencial === false) {
      data.isDefaultPresencial = false;
    }
    const supplier = await prisma.supplier.update({ where: { id: supplierId }, data });
    return reply.send({ ok: true, supplier });
  } catch (err) {
    if (String(err?.code || '') === 'P2025') {
      return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
    }
    req.log.error({ err }, 'admin-suppliers-patch');
    return reply.code(500).send({ ok: false, error: 'UPDATE_FAILED' });
  }
});

fastify.get('/api/admin/presencial-orders', async (req, reply) => {
  try {
    const status = req.query?.status ? String(req.query.status).toUpperCase() : null;
    const where = status && PRESENCIAL_ORDER_STATUSES.includes(status) ? { status } : {};
    const orders = await prisma.presencialOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        tenant: { select: { id: true, name: true, email: true, phone: true } },
        supplier: {
          select: {
            id: true,
            code: true,
            name: true,
            legalName: true,
            rut: true,
            address: true,
            codigo: true,
            email: true,
            contactName: true
          }
        },
        case: { select: { id: true, shortId: true, status: true } }
      }
    });
    return reply.send({ ok: true, orders });
  } catch (err) {
    req.log.error({ err }, 'admin-presencial-orders-list');
    return reply.code(500).send({ ok: false, error: 'LIST_FAILED' });
  }
});

fastify.patch('/api/admin/presencial-orders/:orderId', async (req, reply) => {
  try {
    const orderId = String(req.params.orderId || '');
    const p = req.body || {};
    const data = {};
    if (p.status !== undefined) {
      const st = String(p.status).toUpperCase();
      if (!PRESENCIAL_ORDER_STATUSES.includes(st)) {
        return reply.code(400).send({ ok: false, error: 'INVALID_STATUS' });
      }
      data.status = st;
    }
    if (p.ocNumber !== undefined) data.ocNumber = p.ocNumber ? String(p.ocNumber).trim() : null;
    if (p.adminNotes !== undefined) data.adminNotes = p.adminNotes ? String(p.adminNotes) : null;
    if (p.supplierId !== undefined && p.supplierId) {
      const sup = await prisma.supplier.findUnique({ where: { id: String(p.supplierId) } });
      if (!sup) return reply.code(400).send({ ok: false, error: 'SUPPLIER_NOT_FOUND' });
      data.supplierId = sup.id;
    }
    const order = await prisma.presencialOrder.update({
      where: { id: orderId },
      data,
      include: {
        tenant: { select: { id: true, name: true, email: true } },
        supplier: { select: { id: true, name: true, email: true } },
        case: { select: { id: true, shortId: true } }
      }
    });
    return reply.send({ ok: true, order });
  } catch (err) {
    if (String(err?.code || '') === 'P2025') {
      return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
    }
    req.log.error({ err }, 'admin-presencial-orders-patch');
    return reply.code(500).send({ ok: false, error: 'UPDATE_FAILED' });
  }
});

fastify.post('/api/admin/tenants', async (req, reply) => {
  const payload = req.body || {};
  const name = String(payload.name || '').trim();
  if (!name) return reply.code(400).send({ ok: false, error: 'NAME_REQUIRED' });
  const rut = normalizeRut(payload.rut);
  const passwordRaw = String(payload.password || '').trim();
  if (passwordRaw && passwordRaw.length < ADMIN_TENANT_PASSWORD_MIN_LEN) {
    return reply.code(400).send({
      ok: false,
      error: 'PASSWORD_TOO_SHORT',
      message: `La clave debe tener al menos ${ADMIN_TENANT_PASSWORD_MIN_LEN} caracteres.`
    });
  }
  const tenant = await prisma.tenant.create({
    data: {
      name,
      legalName: payload.legalName ? String(payload.legalName).trim() : null,
      rut: rut || null,
      passwordHash: passwordRaw ? hashPassword(passwordRaw) : null,
      email: payload.email ? String(payload.email).trim().toLowerCase() : null,
      phone: payload.phone ? String(payload.phone).trim() : null,
      status: 'ACTIVE'
    },
    select: { id: true, name: true, legalName: true, rut: true, email: true, phone: true, status: true, createdAt: true }
  });
  return reply.send({ ok: true, tenant });
});

fastify.put('/api/admin/tenants/:tenantId', async (req, reply) => {
  const tenantId = String(req.params.tenantId || '');
  const payload = req.body || {};
  const rut = payload.rut !== undefined ? normalizeRut(payload.rut) : undefined;
  const passwordRaw = String(payload.password || '').trim();
  if (passwordRaw && passwordRaw.length < ADMIN_TENANT_PASSWORD_MIN_LEN) {
    return reply.code(400).send({
      ok: false,
      error: 'PASSWORD_TOO_SHORT',
      message: `La clave debe tener al menos ${ADMIN_TENANT_PASSWORD_MIN_LEN} caracteres.`
    });
  }
  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      name: payload.name ? String(payload.name).trim() : undefined,
      legalName: payload.legalName !== undefined ? (payload.legalName ? String(payload.legalName).trim() : null) : undefined,
      rut: rut !== undefined ? (rut || null) : undefined,
      passwordHash: passwordRaw ? hashPassword(passwordRaw) : undefined,
      email: payload.email !== undefined ? (payload.email ? String(payload.email).trim().toLowerCase() : null) : undefined,
      phone: payload.phone !== undefined ? (payload.phone ? String(payload.phone).trim() : null) : undefined,
      status: payload.status ? String(payload.status) : undefined
    },
    select: { id: true, name: true, legalName: true, rut: true, email: true, phone: true, status: true }
  });
  return reply.send({ ok: true, tenant });
});

// Marcar trial como activo para pruebas (corredoras de prueba sin pasar por MercadoPago)
fastify.post('/api/admin/tenants/:tenantId/set-trial-active', async (req, reply) => {
  const tenantId = String(req.params.tenantId || '');
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, trialStatus: true, trialRealInspectionUsedAt: true }
  });
  if (!tenant) return reply.code(404).send({ ok: false, error: 'TENANT_NOT_FOUND' });
  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        trialStatus: 'active',
        trialStartedAt: now,
        trialEndsAt,
        trialBlockedReason: null,
        trialSubscriptionId: null,
        mpSubscriptionId: null,
        subscriptionStatus: null
      }
    });
    const alreadyCredited = await tx.creditTransaction.findFirst({
      where: { tenantId, description: { contains: 'Free trial corporativo' } },
      select: { id: true }
    });
    if (!alreadyCredited && TRIAL_INITIAL_REAL_INSPECTIONS > 0) {
      await tx.tenantCredit.upsert({
        where: { tenantId },
        create: { tenantId, balance: TRIAL_INITIAL_REAL_INSPECTIONS },
        update: { balance: { increment: TRIAL_INITIAL_REAL_INSPECTIONS } }
      });
      await tx.creditTransaction.create({
        data: {
          tenantId,
          amount: TRIAL_INITIAL_REAL_INSPECTIONS,
          type: 'ADJUSTMENT',
          description: `Free trial corporativo (pruebas) (${TRIAL_INITIAL_REAL_INSPECTIONS} inspección real incluida)`
        }
      });
    }
  });
  return reply.send({ ok: true, trialStatus: 'active', trialEndsAt });
});

fastify.get('/api/admin/tenants/:tenantId/users', async (req, reply) => {
  const tenantId = String(req.params.tenantId || '');
  const users = await prisma.user.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' }
  });
  return reply.send({ ok: true, users });
});

fastify.post('/api/admin/tenants/:tenantId/credits', async (req, reply) => {
  const tenantId = String(req.params.tenantId || '');
  const amount = Number(req.body?.amount || 0);
  if (!amount || amount < 1) {
    return reply.code(400).send({ ok: false, error: 'AMOUNT_REQUIRED', message: 'amount debe ser >= 1' });
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      let account = await tx.tenantCredit.findUnique({ where: { tenantId } });
      if (!account) {
        account = await tx.tenantCredit.create({ data: { tenantId, balance: 0 } });
      }
      await tx.tenantCredit.update({
        where: { tenantId },
        data: { balance: { increment: amount } }
      });
      await tx.creditTransaction.create({
        data: {
          tenantId,
          amount,
          type: 'ADJUSTMENT',
          description: `Admin: +${amount} créditos`
        }
      });
      const updated = await tx.tenantCredit.findUnique({ where: { tenantId } });
      return { balance: updated?.balance ?? amount };
    });
    return reply.send({ ok: true, balance: result.balance });
  } catch (err) {
    req.log.error(err, 'admin-add-credits');
    return reply.code(500).send({ ok: false, error: 'DB_ERROR' });
  }
});

fastify.post('/api/admin/tenants/:tenantId/users', async (req, reply) => {
  const tenantId = String(req.params.tenantId || '');
  const payload = req.body || {};
  const email = String(payload.email || '').trim().toLowerCase();
  const fullName = String(payload.fullName || '').trim();
  const phone = payload.phone ? String(payload.phone).trim() : null;
  const role = payload.role ? String(payload.role).toUpperCase() : 'TENANT_USER';
  const action = payload.action ? String(payload.action).toLowerCase() : 'save';

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

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, legalName: true, phone: true, rut: true }
    });
    const userName = splitFullName(fullName);
    const execHubspot = await syncCorporateContactInHubspot({
      email,
      firstName: userName.firstName,
      lastName: userName.lastName,
      phone: phone || '',
      companyName: String(tenant?.legalName || tenant?.name || '').trim(),
      companyRut: String(tenant?.rut || '').trim()
    });
    if ((!execHubspot.lead.ok && !execHubspot.lead.skipped) || (!execHubspot.company.ok && !execHubspot.company.skipped)) {
      req.log.warn({ execHubspot, tenantId, email }, 'hubspot-executive-sync-failed-admin');
    }
  } catch (hubspotErr) {
    req.log.warn({ err: hubspotErr, tenantId, email }, 'hubspot-executive-sync-error-admin');
  }

  if (action === 'invite') {
    const { activationUrl } = await createActivationForUser({ prismaClient: prisma, userId: user.id });
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { invitedAt: new Date(), status: user.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING' }
    });
    const emailResult = await sendExecutiveInviteEmailForUser(req, updated, activationUrl, req.log);
    return reply.send({
      ok: true,
      user: updated,
      activationUrl,
      emailSent: !!emailResult.ok,
      emailSkipped: !!emailResult.skipped,
      ...(emailResult.ok || emailResult.skipped ? {} : { emailError: emailResult.error || 'EMAIL_FAILED' })
    });
  }

  return reply.send({ ok: true, user });
});

fastify.delete('/api/admin/tenants/:tenantId/users/:userId', async (req, reply) => {
  const tenantId = String(req.params.tenantId || '');
  const userId = String(req.params.userId || '');
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId }
  });
  if (!user) return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });
  try {
    await prisma.user.delete({ where: { id: user.id } });
    return reply.send({ ok: true });
  } catch (err) {
    req.log.error({ err, userId, tenantId }, 'admin-delete-user');
    return reply.code(500).send({ ok: false, error: 'DELETE_FAILED', message: err?.message || String(err) });
  }
});

fastify.post('/api/admin/users/:userId/invite', async (req, reply) => {
  const userId = String(req.params.userId || '');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });

  const { activationUrl } = await createActivationForUser({ prismaClient: prisma, userId: user.id });
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { invitedAt: new Date(), status: user.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING' }
  });

  const emailResult = await sendExecutiveInviteEmailForUser(req, updated, activationUrl, req.log);
  return reply.send({
    ok: true,
    user: updated,
    activationUrl,
    emailSent: !!emailResult.ok,
    emailSkipped: !!emailResult.skipped,
    ...(emailResult.ok || emailResult.skipped ? {} : { emailError: emailResult.error || 'EMAIL_FAILED' })
  });
});

async function doTenantLogin(identifier, password) {
  const isEmail = identifier.includes('@');
  const where = { status: 'ACTIVE' };
  if (isEmail) {
    where.email = identifier.toLowerCase();
  } else {
    const rut = normalizeRut(identifier);
    where.OR = [{ rut }, { rut: identifier }];
  }
  const tenant = await prisma.tenant.findFirst({ where, select: { id: true, name: true, passwordHash: true } });
  if (!tenant) return { ok: false, error: 'INVALID_CREDENTIALS' };
  if (!tenant.passwordHash) return { ok: false, error: 'PASSWORD_NOT_SET' };
  if (!verifyPassword(password, tenant.passwordHash)) return { ok: false, error: 'INVALID_CREDENTIALS' };
  return { ok: true, tenant };
}

function isDbError(err) {
  const msg = String(err?.message || '');
  const code = err?.code || err?.meta?.code || '';
  return err?.name === 'PrismaClientInitializationError' ||
    code === 'P1001' || code === 'P1017' ||
    msg.includes('database') || msg.includes('ECONNREFUSED') || msg.includes("Can't reach") ||
    msg.includes('127.0.0.1') || msg.includes('3306') || msg.includes('3307');
}

fastify.post('/api/tenant/forgot-password', async (req, reply) => {
  const payload = req.body || {};
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) return reply.code(400).send({ ok: false, error: 'EMAIL_REQUIRED' });

  try {
    let tenant = await prisma.tenant.findFirst({ where: { email } });
    if (!tenant) {
      const rows = await prisma.$queryRaw`SELECT id, name FROM Tenant WHERE LOWER(email) = ${email} LIMIT 1`;
      tenant = rows && rows[0] ? rows[0] : null;
    }
    if (!tenant) {
      return reply.send({ ok: true });
    }

    const newPassword = 'A' + crypto.randomUUID().split('-')[0] + '1';
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { passwordHash: hashPassword(newPassword) }
    });

    const sendResult = await sendPasswordResetEmail(email, newPassword, tenant.name);
    const emailSent = sendResult && sendResult.ok === true;
    const reason = sendResult?.error || (emailSent ? null : 'SMTP no configurado o fallo');
    if (!emailSent) {
      req.log.warn({ email, reason }, 'forgot-password-email-not-sent');
    }
    req.log.info({ emailSent, reason }, 'forgot-password-result');
    return reply.send({ ok: true, emailSent });
  } catch (err) {
    req.log.warn(err, 'tenant-forgot-password');
    return reply.code(500).send({ ok: false, error: 'SERVER_ERROR' });
  }
});

fastify.post('/api/tenant/login', async (req, reply) => {
  const payload = req.body || {};
  const identifier = String(payload.email || payload.rut || '').trim();
  const password = String(payload.password || '');
  if (!identifier || !password) return reply.code(400).send({ ok: false, error: 'EMAIL_AND_PASSWORD_REQUIRED' });

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await doTenantLogin(identifier, password);
      if (!result.ok) {
        const code = result.error === 'INVALID_CREDENTIALS' ? 401 : 401;
        return reply.code(code).send({ ok: false, error: result.error });
      }
      const token = await createTenantSession(result.tenant.id);
      reply.setCookie(TENANT_SESSION_COOKIE, token, sessionCookieOpts(req));
      return reply.send({ ok: true, tenant: { id: result.tenant.id, name: result.tenant.name }, token });
    } catch (err) {
      req.log.warn({ err: err?.message, code: err?.code, attempt }, 'tenant-login');
      if (attempt === 1 && isDbError(err)) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (isDbError(err)) {
        try {
          await prisma.$queryRaw`SELECT 1`;
          req.log.warn({ loginErr: err?.message }, 'DB connected but login failed - not a connection issue');
        } catch (_) {}
        const hint = (req.headers['x-debug'] === '1' || req.query?.debug === '1') ? String(err?.message || '').substring(0, 150) : undefined;
        return reply.code(503).send({ ok: false, error: 'DATABASE_UNAVAILABLE', message: 'Base de datos no disponible', ...(hint && { hint }) });
      }
      return reply.code(500).send({ ok: false, error: 'LOGIN_FAILED', message: 'Error al iniciar sesión' });
    }
  }
});

function validatePasswordStrength(pwd) {
  if (!pwd || pwd.length < 8) return { ok: false, msg: 'Mínimo 8 caracteres' };
  if (!/[A-Z]/.test(pwd)) return { ok: false, msg: 'Debe tener al menos 1 mayúscula' };
  if (!/[0-9]/.test(pwd)) return { ok: false, msg: 'Debe tener al menos 1 número' };
  return { ok: true };
}

fastify.post('/api/tenant/register', async (req, reply) => {
  const payload = req.body || {};
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) return reply.code(400).send({ ok: false, error: 'EMAIL_REQUIRED' });
  const passwordRaw = String(payload.password || '').trim();
  const pwdCheck = validatePasswordStrength(passwordRaw);
  if (!pwdCheck.ok) {
    return reply.code(400).send({ ok: false, error: 'PASSWORD_INVALID', message: pwdCheck.msg });
  }
  try {
    const existing = await prisma.tenant.findFirst({
      where: { email },
      select: { id: true }
    });
    if (existing) {
      return reply.code(409).send({ ok: false, error: 'EMAIL_ALREADY_EXISTS' });
    }
    const nameFromEmail = email.split('@')[0] || 'Corredor';
    const tenant = await prisma.tenant.create({
      data: {
        name: nameFromEmail,
        email,
        passwordHash: hashPassword(passwordRaw),
        rut: null,
        status: 'ACTIVE'
      }
    });
    const token = await createTenantSession(tenant.id);
    reply.setCookie(TENANT_SESSION_COOKIE, token, sessionCookieOpts(req));
    return reply.send({ ok: true, tenant: { id: tenant.id, name: tenant.name }, token });
  } catch (err) {
    req.log.warn(err, 'tenant-register');
    return reply.code(500).send({ ok: false, error: 'REGISTER_FAILED', message: err?.message || 'Error al crear cuenta' });
  }
});

fastify.post('/api/tenant/logout', async (req, reply) => {
  const token = req.cookies?.[TENANT_SESSION_COOKIE];
  if (token) await prisma.session.deleteMany({ where: { token, type: 'tenant' } }).catch(() => {});
  reply.clearCookie(TENANT_SESSION_COOKIE, { path: '/' });
  return reply.send({ ok: true });
});

async function getTenantLogoUrl(tenantId) {
  if (!tenantId) return null;
  try {
    const rows = await prisma.$queryRaw`
      SELECT logoUrl FROM Tenant WHERE id = ${tenantId} LIMIT 1
    `;
    const url = rows?.[0]?.logoUrl;
    return url ? String(url) : null;
  } catch (err) {
    // Columna ausente u otro error de esquema: no tumbar /me
    return null;
  }
}

fastify.get('/api/tenant/me', async (req, reply) => {
  const session = await getTenantSession(req);
  if (!session || !session.tenantId) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  try {
    const peerEnsure = await ensureTenantPeerReferralCode(session.tenantId);
    if (peerEnsure.assigned) {
      const tRow = await prisma.tenant.findUnique({
        where: { id: session.tenantId },
        select: { email: true, name: true }
      });
      if (tRow?.email) {
        await notifyPeerReferralWelcomeIfNew(req, {
          assigned: true,
          code: peerEnsure.code,
          email: tRow.email,
          tenantName: tRow.name
        });
      }
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: {
        id: true,
        name: true,
        legalName: true,
        rut: true,
        email: true,
        phone: true,
        status: true,
        peerReferralCode: true,
        creditAccount: { select: { balance: true } },
        mpSubscriptionId: true,
        subscriptionStatus: true,
        subscriptionExpiresAt: true,
        trialStatus: true,
        trialStartedAt: true,
        trialEndsAt: true,
        trialConvertedAt: true,
        trialRealInspectionUsedAt: true,
        trialBlockedReason: true
      }
    });
    if (!tenant) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
    const tenantResolved = await refreshTrialStatusIfNeeded(tenant);
    const credits = tenant.creditAccount?.balance ?? 0;
    const logoUrl = await getTenantLogoUrl(session.tenantId);
    const webBase = getPublicWebBase(req);
    const peerCode = tenant.peerReferralCode || peerEnsure.code || null;
    const peerReferralInviteUrl = peerCode ? `${webBase}/?ref=${encodeURIComponent(peerCode)}` : null;
    return reply.send({
      ok: true,
      tenant: {
        id: tenantResolved.id,
        name: tenantResolved.name,
        legalName: tenantResolved.legalName,
        logoUrl,
        rut: tenantResolved.rut,
        email: tenantResolved.email,
        phone: tenantResolved.phone,
        status: tenantResolved.status,
        credits,
        peerReferralCode: peerCode,
        peerReferralInviteUrl,
        mpSubscriptionId: tenantResolved.mpSubscriptionId || null,
        subscriptionStatus: tenantResolved.subscriptionStatus || null,
        subscriptionExpiresAt: tenantResolved.subscriptionExpiresAt || null,
        trialStatus: tenantResolved.trialStatus || null,
        trialStartedAt: tenantResolved.trialStartedAt || null,
        trialEndsAt: tenantResolved.trialEndsAt || null,
        trialConvertedAt: tenantResolved.trialConvertedAt || null,
        trialRealInspectionUsedAt: tenantResolved.trialRealInspectionUsedAt || null,
        trialBlockedReason: tenantResolved.trialBlockedReason || null
      }
    });
    } catch (err) {
      req.log.error(err, 'GET /api/tenant/me');
      try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: session.tenantId },
        select: { id: true, name: true, legalName: true, rut: true, email: true, phone: true, status: true, peerReferralCode: true }
      });
      if (!tenant) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
      const logoUrl = await getTenantLogoUrl(session.tenantId);
      const webBase = getPublicWebBase(req);
      const peerCode = tenant.peerReferralCode || null;
      return reply.send({
        ok: true,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          legalName: tenant.legalName,
          logoUrl,
          rut: tenant.rut,
          email: tenant.email,
          phone: tenant.phone,
          status: tenant.status,
          credits: 0,
          peerReferralCode: peerCode,
          peerReferralInviteUrl: peerCode ? `${webBase}/?ref=${encodeURIComponent(peerCode)}` : null
        }
      });
    } catch (err2) {
      req.log.error(err2, 'GET /api/tenant/me fallback');
      return reply.code(500).send({ ok: false, error: 'DB_ERROR' });
    }
  }
});

fastify.put('/api/tenant/me', async (req, reply) => {
  const session = await getTenantSession(req);
  if (!session || !session.tenantId) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const payload = req.body || {};
  const rut = payload.rut !== undefined ? normalizeRut(payload.rut) : undefined;
  try {
    // logoUrl omitido: columna puede no existir en prod. Usar POST /api/tenant/logo cuando exista.
    const data = {
      name: payload.name !== undefined ? String(payload.name).trim() : undefined,
      legalName: payload.legalName !== undefined ? (payload.legalName ? String(payload.legalName).trim() : null) : undefined,
      rut: rut !== undefined ? (rut || null) : undefined,
      email: payload.email !== undefined ? (payload.email ? String(payload.email).trim().toLowerCase() : null) : undefined,
      phone: payload.phone !== undefined ? (payload.phone ? String(payload.phone).trim() : null) : undefined
    };
    await prisma.tenant.update({ where: { id: session.tenantId }, data });
    return reply.send({ ok: true });
  } catch (err) {
    req.log.error(err, 'PUT /api/tenant/me');
    return reply.code(500).send({ ok: false, error: 'DB_ERROR' });
  }
});

fastify.post('/api/tenant/logo', async (req, reply) => {
  const session = await getTenantSession(req);
  if (!session || !session.tenantId) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const part = await req.file({ limits: { fileSize: 2 * 1024 * 1024 } });
  if (!part) return reply.code(400).send({ ok: false, error: 'NO_FILE' });
  const mimeType = part.mimetype || '';
  const ext = safeExtFromMime(mimeType);
  if (!ext || !['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    return reply.code(400).send({ ok: false, error: 'UNSUPPORTED_TYPE', message: 'Usa JPG, PNG o WebP' });
  }
  try {
    const buffer = await part.toBuffer();
    const saved = await storage.saveImageBuffer({
      buffer,
      contentType: mimeType,
      ext,
      tenantId: session.tenantId
    });
    const logoUrl = storage.publicUrl(saved.filePath);
    try {
      await prisma.$executeRaw`UPDATE Tenant SET logoUrl = ${logoUrl} WHERE id = ${session.tenantId}`;
    } catch (dbErr) {
      const msg = String(dbErr?.message || '');
      // Columna ausente: crearla y reintentar (prod a veces sin migración).
      if (msg.includes('logoUrl') || msg.includes('Unknown column') || msg.includes('does not exist')) {
        req.log.warn({ err: msg }, 'logoUrl column missing — creating');
        try {
          await prisma.$executeRawUnsafe(
            'ALTER TABLE `Tenant` ADD COLUMN `logoUrl` VARCHAR(512) NULL'
          );
        } catch (alterErr) {
          const alterMsg = String(alterErr?.message || '');
          if (!alterMsg.includes('Duplicate column')) {
            req.log.error({ err: alterMsg }, 'failed to add logoUrl column');
            return reply.code(500).send({
              ok: false,
              error: 'LOGO_COLUMN_MISSING',
              message: 'No se pudo guardar el logo en la base de datos. Contacta soporte.'
            });
          }
        }
        await prisma.$executeRaw`UPDATE Tenant SET logoUrl = ${logoUrl} WHERE id = ${session.tenantId}`;
      } else if (msg.includes('Data too long') || msg.includes('too long')) {
        // Ampliar columna y reintentar
        await prisma.$executeRawUnsafe(
          'ALTER TABLE `Tenant` MODIFY COLUMN `logoUrl` VARCHAR(512) NULL'
        );
        await prisma.$executeRaw`UPDATE Tenant SET logoUrl = ${logoUrl} WHERE id = ${session.tenantId}`;
      } else {
        throw dbErr;
      }
    }
    return reply.send({ ok: true, logoUrl });
  } catch (err) {
    req.log.error(err, 'POST /api/tenant/logo');
    return reply.code(500).send({ ok: false, error: 'UPLOAD_FAILED', message: err?.message || 'Error al subir logo' });
  }
});

fastify.get('/api/tenant/credits', async (req, reply) => {
  const session = await getTenantSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  try {
    const account = await prisma.tenantCredit.findUnique({
      where: { tenantId: session.tenantId }
    });
    const balance = account?.balance ?? 0;
    return reply.send({ ok: true, balance });
  } catch (err) {
    req.log.error(err, 'GET /api/tenant/credits');
    return reply.code(500).send({ ok: false, error: 'DB_ERROR' });
  }
});

fastify.get('/api/tenant/credits/transactions', async (req, reply) => {
  const session = await getTenantSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 50));
  try {
    const transactions = await prisma.creditTransaction.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
    return reply.send({ ok: true, transactions });
  } catch (err) {
    req.log.error(err, 'GET /api/tenant/credits/transactions');
    return reply.code(500).send({ ok: false, error: 'DB_ERROR' });
  }
});

fastify.get('/api/tenant/users', async (req, reply) => {
  const session = await getTenantSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const users = await prisma.user.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { createdAt: 'desc' }
  });
  return reply.send({ ok: true, users });
});

fastify.get('/api/tenant/inspections', async (req, reply) => {
  const session = await getTenantSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  let cases;
  try {
    cases = await prisma.case.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        property: true,
        assignedUser: true,
        slots: { select: { status: true } },
        captureTokens: true
      }
    });
  } catch (err) {
    req.log.error(err, 'GET /api/tenant/inspections');
    return reply.code(500).send({ ok: false, error: 'DB_ERROR' });
  }

  const runtimeCfg = await getRuntimeScoreConfig();
  const inspections = await Promise.all(cases.map(async (c) => {
    const progress = computeProgressFromSlots(c.slots || []);
    const tokens = (c.captureTokens || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const captureToken = tokens[0]?.token || null;
    const captureUrl = captureToken ? `/capture/${captureToken}` : null;
    let badge = null;
    let score = null;
    try {
      const summary = await getCaseSummary({
        prisma,
        storage,
        caseId: c.shortId ?? c.id,
        slotGroupTitleFromCode,
        scoreConfig: runtimeCfg.config,
        scoreConfigUpdatedAt: runtimeCfg.updatedAt,
        tenantId: session.tenantId
      });
      if (summary.ok && summary.badge) {
        badge = summary.badge;
        score = summary.score != null ? Math.round(summary.score) : null;
      }
    } catch (e) {
      req.log.warn({ caseId: c.shortId ?? c.id, err: e?.message }, 'inspection badge');
    }
    const surfaceStr = c.property?.surface ? String(c.property.surface).replace(/[^\d.,]/g, '').replace(',', '.') : null;
    const surface = surfaceStr ? Math.max(45, Math.round(parseFloat(surfaceStr) || 45)) : 45;

    return {
      id: c.shortId ?? c.id,
      createdAt: c.createdAt,
      status: c.status,
      propertyType: c.propertyType,
      bedrooms: c.bedrooms,
      bathrooms: c.bathrooms,
      address: c.property?.address || null,
      surface,
      assignedUserName: c.assignedUser?.fullName || null,
      progress,
      captureUrl,
      badge,
      score
    };
  }));

  return reply.send({ ok: true, inspections });
});

fastify.post('/api/tenant/users', async (req, reply) => {
  const session = await getTenantSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const payload = req.body || {};
  const email = String(payload.email || '').trim().toLowerCase();
  const fullName = String(payload.fullName || '').trim();
  const phone = payload.phone ? String(payload.phone).trim() : null;
  const role = payload.role ? String(payload.role).toUpperCase() : 'TENANT_USER';
  const action = payload.action ? String(payload.action).toLowerCase() : 'save';

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

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { name: true, legalName: true, phone: true, rut: true }
    });
    const userName = splitFullName(fullName);
    const execHubspot = await syncCorporateContactInHubspot({
      email,
      firstName: userName.firstName,
      lastName: userName.lastName,
      phone: phone || '',
      companyName: String(tenant?.legalName || tenant?.name || '').trim(),
      companyRut: String(tenant?.rut || '').trim()
    });
    if ((!execHubspot.lead.ok && !execHubspot.lead.skipped) || (!execHubspot.company.ok && !execHubspot.company.skipped)) {
      req.log.warn({ execHubspot, tenantId: session.tenantId, email }, 'hubspot-executive-sync-failed-tenant');
    }
  } catch (hubspotErr) {
    req.log.warn({ err: hubspotErr, tenantId: session.tenantId, email }, 'hubspot-executive-sync-error-tenant');
  }

  if (action === 'invite') {
    const { activationUrl } = await createActivationForUser({ prismaClient: prisma, userId: user.id });
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { invitedAt: new Date(), status: user.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING' }
    });
    const emailResult = await sendExecutiveInviteEmailForUser(req, updated, activationUrl, req.log);
    return reply.send({
      ok: true,
      user: updated,
      activationUrl,
      emailSent: !!emailResult.ok,
      emailSkipped: !!emailResult.skipped,
      ...(emailResult.ok || emailResult.skipped ? {} : { emailError: emailResult.error || 'EMAIL_FAILED' })
    });
  }

  return reply.send({ ok: true, user });
});

fastify.post('/api/tenant/users/:userId/invite', async (req, reply) => {
  const session = await getTenantSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const userId = String(req.params.userId || '');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.tenantId !== session.tenantId) {
    return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });
  }

  const { activationUrl } = await createActivationForUser({ prismaClient: prisma, userId: user.id });
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { invitedAt: new Date(), status: user.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING' }
  });

  const emailResult = await sendExecutiveInviteEmailForUser(req, updated, activationUrl, req.log);
  return reply.send({
    ok: true,
    user: updated,
    activationUrl,
    emailSent: !!emailResult.ok,
    emailSkipped: !!emailResult.skipped,
    ...(emailResult.ok || emailResult.skipped ? {} : { emailError: emailResult.error || 'EMAIL_FAILED' })
  });
});

fastify.put('/api/tenant/users/:userId', async (req, reply) => {
  const session = await getTenantSession(req);
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
  const session = await getTenantSession(req);
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
  const session = await getTenantSession(req);
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

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
    // Verificar y descontar 1 crédito
    let account = await tx.tenantCredit.findUnique({ where: { tenantId } });
    if (!account) {
      account = await tx.tenantCredit.create({ data: { tenantId, balance: 0 } });
    }
    if (account.balance < 1) {
      throw new Error('INSUFFICIENT_CREDITS');
    }
    await tx.tenantCredit.update({
      where: { tenantId },
      data: { balance: { decrement: 1 } }
    });
    const tenantTrial = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { trialStatus: true, trialRealInspectionUsedAt: true }
    });
    if (tenantTrial?.trialStatus === 'active' && !tenantTrial.trialRealInspectionUsedAt) {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { trialRealInspectionUsedAt: new Date() }
      });
    }
    let ownerId = null;
    const ownerRutNorm = payload.ownerRut ? normalizeRut(payload.ownerRut) : null;
    if (ownerRutNorm || payload.ownerName) {
      if (ownerRutNorm) {
        const rutConds = [{ rut: ownerRutNorm }, payload.ownerRut ? { rut: String(payload.ownerRut).trim() } : null].filter(Boolean);
        const existing = rutConds.length ? await tx.owner.findFirst({ where: { OR: rutConds } }) : null;
        if (existing) ownerId = existing.id;
      }
      if (!ownerId && payload.ownerName) {
        const rutToStore = ownerRutNorm || payload.ownerRut || null;
        const created = await tx.owner.create({ data: { fullName: payload.ownerName, rut: rutToStore, tenantId } });
        ownerId = created.id;
      }
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
        shortId: generateCaseShortId(),
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
        hasElevator: !!payload.hasElevator,
        hasParking: !!payload.hasParking,
        hasGreenCertificate: !!payload.hasGreenCertificate,
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

    await tx.creditTransaction.create({
      data: {
        tenantId,
        amount: -1,
        type: 'CONSUMPTION',
        caseId: c.id,
        description: `Inspección ${c.shortId || c.id}`
      }
    });

    return { caseId: c.id, shortId: c.shortId, slotsCreated: slots.count };
    });
  } catch (err) {
    if (err?.message === 'INSUFFICIENT_CREDITS') {
      return reply.code(402).send({ ok: false, error: 'INSUFFICIENT_CREDITS', message: 'No tienes créditos suficientes. Compra más en el dashboard.' });
    }
    throw err;
  }

  const captureUrl = `/capture/${token}`;
  const caseIdForUrl = result.shortId || result.caseId;
  const reportUrl = `/cases/${encodeURIComponent(caseIdForUrl)}/report`;

  return reply.send({
    ok: true,
    caseId: result.caseId,
    shortId: result.shortId,
    tenantId,
    captureUrl,
    reportUrl,
    slots: planSlots
  });
});

async function getTenantCreditsBalance(tenantId) {
  if (!tenantId) return null;
  const account = await prisma.tenantCredit.findUnique({
    where: { tenantId },
    select: { balance: true }
  });
  return account ? account.balance : 0;
}

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

  const token = await createExecSession(user.id, user.tenantId || null);
  reply.setCookie(EXEC_SESSION_COOKIE, token, sessionCookieOpts(req));
  const creditsBalance = await getTenantCreditsBalance(user.tenantId);
  return reply.send({
    ok: true,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      mustChangePassword: !!user.mustChangePassword
    },
    token,
    creditsBalance
  });
});

fastify.post('/api/executive/logout', async (req, reply) => {
  const token = req.cookies?.[EXEC_SESSION_COOKIE];
  if (token) await prisma.session.deleteMany({ where: { token, type: 'exec' } }).catch(() => {});
  reply.clearCookie(EXEC_SESSION_COOKIE, { path: '/' });
  return reply.send({ ok: true });
});

fastify.get('/api/executive/me', async (req, reply) => {
  const session = await getExecSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const creditsBalance = await getTenantCreditsBalance(user.tenantId);
  return reply.send({
    ok: true,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      mustChangePassword: !!user.mustChangePassword
    },
    creditsBalance
  });
});

/** Recuperación ejecutivo: envía clave temporal y exige cambio al entrar. */
fastify.post('/api/executive/forgot-password', async (req, reply) => {
  const payload = req.body || {};
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) return reply.code(400).send({ ok: false, error: 'EMAIL_REQUIRED' });

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, fullName: true, status: true, tenantId: true }
    });
    // Respuesta genérica para no filtrar si el correo existe.
    if (!user || user.status !== 'ACTIVE') {
      return reply.send({ ok: true, emailSent: false });
    }

    const newPassword = 'A' + crypto.randomUUID().split('-')[0] + '1';
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(newPassword),
        mustChangePassword: true
      }
    });

    let tenantName = 'tu corredora';
    if (user.tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: { name: true, legalName: true }
      });
      tenantName = String(tenant?.legalName || tenant?.name || tenantName).trim() || tenantName;
    }

    const sendResult = await sendPasswordResetEmail(email, newPassword, tenantName);
    const emailSent = !!(sendResult && sendResult.ok);
    if (!emailSent) {
      req.log.warn({ email, err: sendResult?.error }, 'executive-forgot-password-email-not-sent');
    }
    return reply.send({ ok: true, emailSent, ...(emailSent ? {} : { reason: sendResult?.error || 'SMTP' }) });
  } catch (err) {
    req.log.warn({ err: err?.message }, 'executive-forgot-password');
    return reply.code(500).send({ ok: false, error: 'SERVER_ERROR' });
  }
});

/** Tras clave temporal: define clave definitiva (sesión ejecutivo requerida). */
fastify.post('/api/executive/password-after-recovery', async (req, reply) => {
  const session = await getExecSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const newPassword = String(req.body?.newPassword || req.body?.password || '').trim();
  const pwdCheck = validatePasswordStrength(newPassword);
  if (!pwdCheck.ok) {
    return reply.code(400).send({ ok: false, error: 'PASSWORD_INVALID', message: pwdCheck.msg });
  }

  await prisma.user.update({
    where: { id: session.userId },
    data: {
      passwordHash: hashPassword(newPassword),
      mustChangePassword: false,
      status: 'ACTIVE',
      activatedAt: new Date()
    }
  });

  return reply.send({ ok: true });
});

/** Alternativa app: cambiar clave con email + nueva clave (usuario debe estar ACTIVE). */
fastify.post('/api/executive/forgot-password/set-new', async (req, reply) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const newPassword = String(req.body?.newPassword || req.body?.password || '').trim();
  if (!email) return reply.code(400).send({ ok: false, error: 'EMAIL_REQUIRED' });
  const pwdCheck = validatePasswordStrength(newPassword);
  if (!pwdCheck.ok) {
    return reply.code(400).send({ ok: false, error: 'PASSWORD_INVALID', message: pwdCheck.msg });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE') {
    return reply.code(404).send({ ok: false, error: 'USER_NOT_FOUND' });
  }
  if (!user.mustChangePassword) {
    return reply.code(400).send({
      ok: false,
      error: 'NOT_IN_RECOVERY',
      message: 'Esta cuenta no tiene un cambio de clave pendiente. Usa recuperación de contraseña primero.'
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(newPassword),
      mustChangePassword: false
    }
  });

  return reply.send({ ok: true, message: 'Clave actualizada' });
});

fastify.get('/api/executive/cases', async (req, reply) => {
  const session = await getExecSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  const cases = await prisma.case.findMany({
    where: { assignedUserId: session.userId },
    orderBy: { createdAt: 'desc' },
    include: {
      property: { include: { owner: true } },
      slots: { include: { photo: true } },
      captureTokens: true
    }
  });

  const rows = await Promise.all(cases.map(async (c) => {
    const slots = c.slots || [];
    const progress = computeProgressFromSlots(slots);
    const nowTs = Date.now();
    const validTokens = (c.captureTokens || [])
      .filter((tokenRow) => !tokenRow.revokedAt && new Date(tokenRow.expiresAt).getTime() > nowTs)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    let captureToken = validTokens[0]?.token || null;
    if (!captureToken && Number(progress?.pct || 0) < 100) {
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
      const created = await prisma.captureToken.create({
        data: {
          tenantId: c.tenantId || null,
          caseId: c.id,
          token: crypto.randomUUID(),
          expiresAt
        },
        select: { token: true }
      });
      captureToken = created.token;
    }

    const captureUrl = captureToken ? `/capture/${captureToken}` : null;
    return {
      id: c.shortId ?? c.id,
      createdAt: c.createdAt,
      caseStatus: c.status,
      propertyType: c.propertyType,
      bedrooms: c.bedrooms,
      bathrooms: c.bathrooms,
      address: c.property?.address || null,
      ownerName: c.property?.owner?.fullName || null,
      progress,
      captureUrl
    };
  }));

  return reply.send({ ok: true, cases: rows });
});

/**
 * Crear inspección desde app ejecutivo (Ainspecciona Capture).
 * Descuenta 1 crédito del tenant y asigna el caso al ejecutivo autenticado.
 */
fastify.post('/api/executive/inspections', async (req, reply) => {
  const session = await getExecSession(req);
  if (!session) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, tenantId: true, status: true }
  });
  if (!user || user.status !== 'ACTIVE') {
    return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  }
  if (!user.tenantId) {
    return reply.code(400).send({ ok: false, error: 'NO_TENANT', message: 'Tu cuenta no está asociada a una corredora.' });
  }

  const payload = req.body || {};
  const tenantId = user.tenantId;
  const assignedUserId = user.id;
  const bathroomsCount = Number(payload.bathroomsCount || payload.bathrooms || 1);
  const bedroomsCount = Number(payload.bedroomsCount || payload.bedrooms || 1);
  const bedrooms = Number(payload.bedrooms || bedroomsCount || 0);
  const bathrooms = Number(payload.bathrooms || bathroomsCount || 1);

  const planSlots = buildPhotoPlanV1({
    ...payload,
    bathroomsCount,
    bedroomsCount
  });

  const token = crypto.randomUUID();
  const captureExpires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      let account = await tx.tenantCredit.findUnique({ where: { tenantId } });
      if (!account) {
        account = await tx.tenantCredit.create({ data: { tenantId, balance: 0 } });
      }
      if (account.balance < 1) {
        throw new Error('INSUFFICIENT_CREDITS');
      }
      await tx.tenantCredit.update({
        where: { tenantId },
        data: { balance: { decrement: 1 } }
      });

      const tenantTrial = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { trialStatus: true, trialRealInspectionUsedAt: true }
      });
      if (tenantTrial?.trialStatus === 'active' && !tenantTrial.trialRealInspectionUsedAt) {
        await tx.tenant.update({
          where: { id: tenantId },
          data: { trialRealInspectionUsedAt: new Date() }
        });
      }

      let ownerId = null;
      const ownerRutNorm = payload.ownerRut ? normalizeRut(payload.ownerRut) : null;
      if (ownerRutNorm || payload.ownerName) {
        if (ownerRutNorm) {
          const rutConds = [{ rut: ownerRutNorm }, payload.ownerRut ? { rut: String(payload.ownerRut).trim() } : null].filter(Boolean);
          const existing = rutConds.length ? await tx.owner.findFirst({ where: { OR: rutConds } }) : null;
          if (existing) ownerId = existing.id;
        }
        if (!ownerId && payload.ownerName) {
          const rutToStore = ownerRutNorm || payload.ownerRut || null;
          const created = await tx.owner.create({
            data: { fullName: payload.ownerName, rut: rutToStore, tenantId }
          });
          ownerId = created.id;
        }
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
          shortId: generateCaseShortId(),
          tenant: { connect: { id: tenantId } },
          assignedUser: { connect: { id: assignedUserId } },
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
          hasElevator: !!payload.hasElevator,
          hasParking: !!payload.hasParking,
          hasGreenCertificate: !!payload.hasGreenCertificate,
          hasEntranceGrille: !!payload.hasEntranceGrille,
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

      await tx.creditTransaction.create({
        data: {
          tenantId,
          amount: -1,
          type: 'CONSUMPTION',
          caseId: c.id,
          description: `Inspección ${c.shortId || c.id} (app ejecutivo)`
        }
      });

      return { caseId: c.id, shortId: c.shortId, slotsCreated: slots.count };
    });
  } catch (err) {
    if (err?.message === 'INSUFFICIENT_CREDITS') {
      return reply.code(402).send({
        ok: false,
        error: 'INSUFFICIENT_CREDITS',
        message: 'No tienes créditos suficientes. Solicita recarga al administrador de la corredora.'
      });
    }
    req.log.error({ err: err?.message, stack: err?.stack }, 'POST /api/executive/inspections');
    throw err;
  }

  const captureUrl = `/capture/${token}`;
  const caseIdForUrl = result.shortId || result.caseId;
  const reportUrl = `/cases/${encodeURIComponent(caseIdForUrl)}/report`;

  return reply.send({
    ok: true,
    caseId: result.caseId,
    shortId: result.shortId,
    tenantId,
    captureUrl,
    reportUrl,
    slots: planSlots
  });
});

/** Info previa a activar: muestra el correo del ejecutivo sin revelar datos si el token es inválido. */
fastify.get('/api/onboarding/activate-info', async (req, reply) => {
  const token = String(req.query?.token || '').trim();
  if (!token) return reply.code(400).send({ ok: false, error: 'TOKEN_REQUIRED' });

  const row = await prisma.activationToken.findUnique({
    where: { token },
    select: { id: true, userId: true, expiresAt: true, usedAt: true }
  });
  if (!row || row.usedAt) return reply.code(400).send({ ok: false, error: 'INVALID_TOKEN' });
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    return reply.code(400).send({ ok: false, error: 'TOKEN_EXPIRED' });
  }

  const user = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { email: true, fullName: true, status: true }
  });
  if (!user?.email) return reply.code(400).send({ ok: false, error: 'INVALID_TOKEN' });

  return reply.send({
    ok: true,
    email: user.email,
    fullName: user.fullName || null,
    status: user.status
  });
});

fastify.post('/api/onboarding/activate', async (req, reply) => {
  const payload = req.body || {};
  const token = String(payload.token || '').trim();
  const password = String(payload.password || '').trim();
  if (!token) return reply.code(400).send({ ok: false, error: 'TOKEN_REQUIRED' });
  if (!password) return reply.code(400).send({ ok: false, error: 'PASSWORD_REQUIRED' });

  const pwdCheck = validatePasswordStrength(password);
  if (!pwdCheck.ok) {
    return reply.code(400).send({ ok: false, error: 'PASSWORD_INVALID', message: pwdCheck.msg });
  }

  const row = await prisma.activationToken.findUnique({ where: { token } });
  if (!row || row.usedAt) return reply.code(400).send({ ok: false, error: 'INVALID_TOKEN' });
  if (new Date(row.expiresAt).getTime() <= Date.now()) return reply.code(400).send({ ok: false, error: 'TOKEN_EXPIRED' });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: {
        status: 'ACTIVE',
        activatedAt: new Date(),
        passwordHash: hashPassword(password),
        mustChangePassword: false
      }
    }),
    prisma.activationToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() }
    })
  ]);

  const playInternal = String(process.env.GOOGLE_PLAY_INTERNAL_TEST_URL || '').trim();
  const playStore = String(process.env.EXECUTIVE_PLAY_STORE_URL || '').trim();
  const captureEmailAttempted = !!(playInternal || playStore);
  let captureEmailSent = false;
  let captureEmailSkipped = false;
  let captureEmailError = null;
  if (captureEmailAttempted) {
    const activatedUser = await prisma.user.findUnique({
      where: { id: row.userId },
      select: { email: true, fullName: true }
    });
    if (activatedUser?.email) {
      const mailResult = await sendExecutiveCaptureInviteEmail(
        activatedUser.email,
        activatedUser.fullName || '',
        playInternal,
        playStore
      );
      captureEmailSent = !!mailResult.ok;
      captureEmailSkipped = !!mailResult.skipped;
      if (!mailResult.ok && !mailResult.skipped) captureEmailError = mailResult.error || 'EMAIL_FAILED';
      if (mailResult.ok) {
        req.log.info({ email: activatedUser.email }, 'executive-capture-invite-email-sent');
      } else if (mailResult.skipped) {
        req.log.warn({ email: activatedUser.email }, 'executive-capture-invite-email-skipped-smtp');
      } else {
        req.log.warn({ email: activatedUser.email, err: mailResult.error }, 'executive-capture-invite-email-failed');
      }
    }
  }

  return reply.send({
    ok: true,
    captureEmailAttempted,
    captureEmailSent,
    captureEmailSkipped,
    ...(captureEmailError ? { captureEmailError } : {})
  });
});

await registerCaptureRoutes(fastify, {
  prisma,
  storage,
  safeExtFromMime,
  analyzeImageBufferV1,
  validateSlotMatchWithOpenAI,
  slotGroupFromSlotCode,
  queueOpenAiSlotAnalysis,
  sendCaseToReview: checkAndNotifyReviewer
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
    const tenantExists = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
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
    const ownerRutNorm = payload.ownerRut ? normalizeRut(payload.ownerRut) : null;
    if (ownerRutNorm || payload.ownerName) {
      if (ownerRutNorm) {
        const rutConds = [{ rut: ownerRutNorm }, payload.ownerRut ? { rut: String(payload.ownerRut).trim() } : null].filter(Boolean);
        const existing = rutConds.length ? await tx.owner.findFirst({ where: { OR: rutConds } }) : null;
        if (existing) ownerId = existing.id;
      }
      if (!ownerId && payload.ownerName) {
        const rutToStore = ownerRutNorm || payload.ownerRut || null;
        const created = await tx.owner.create({ data: { fullName: payload.ownerName, rut: rutToStore, tenantId } });
        ownerId = created.id;
      }
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
        shortId: generateCaseShortId(),
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

    return { caseId: c.id, shortId: c.shortId, slotsCreated: slots.count };
  });

  const captureUrl = `/capture/${token}`;
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim();
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0].trim();
  const baseUrl = host ? `${proto || 'https'}://${host}` : (process.env.PUBLIC_URL || 'https://ainspecciona.com');
  const captureUrlFull = `${baseUrl.replace(/\/$/, '')}/capture/${token}`;
  const caseIdForUrl = result.shortId || result.caseId;
  const reportUrl = `/cases/${encodeURIComponent(caseIdForUrl)}/report`;

  return reply.send({
    ok: true,
    caseId: result.caseId,
    shortId: result.shortId,
    tenantId: tenantId || null,
    captureUrl,
    captureUrlFull,
    reportUrl,
    slots: planSlots
  });
});

fastify.get('/api/cases', async (req, reply) => {
  const filterTenantId = (req.query?.tenantId && String(req.query.tenantId).trim()) || getTenantIdFromReq(req) || null;
  const filterStatus = (req.query?.status && String(req.query.status).trim().toUpperCase()) || null;
  const where = {};
  if (filterTenantId) where.tenantId = filterTenantId;
  if (filterStatus && ['DRAFT', 'IN_PROGRESS', 'DONE'].includes(filterStatus)) where.status = filterStatus;

  try {
    const cases = await prisma.case.findMany({
      where: Object.keys(where).length ? where : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        property: true,
        tenant: { select: { id: true, name: true } },
        slots: { include: { photo: true } },
        captureTokens: true
      }
    });

    const rows = cases.map((c) => {
    const slots = c.slots || [];
    const uploaded = slots.filter(s => ['UPLOADED', 'ANALYZED', 'REJECTED', 'NOT_CAPTURABLE'].includes(String(s.status || '').toUpperCase())).length;
    const analyzed = slots.filter(s => String(s.status || '').toUpperCase() === 'ANALYZED').length;
    const omitted = slots.filter(s => String(s.status || '').toUpperCase() === 'NOT_CAPTURABLE').length;
    const rejected = slots.filter(s => String(s.status || '').toUpperCase() === 'REJECTED').length;
    const total = slots.length;
    const pct = total ? Math.round((uploaded / total) * 100) : 0;
    const tokens = (c.captureTokens || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const captureToken = tokens[0]?.token || null;
    const captureUrl = captureToken ? `/capture/${captureToken}` : null;
    const firstSlotWithPhoto = slots.find(s => s.photo?.filePath);
    const firstPhotoFile = firstSlotWithPhoto?.photo?.filePath || null;
    const firstPhotoId = firstSlotWithPhoto?.photo?.id || null;
    const tenantName = c.tenant?.name || null;
    const planType = tenantName === STARTER_TENANT_NAME ? 'Starter' : (tenantName ? 'Business' : '—');

    return {
      id: c.shortId ?? c.id,
      createdAt: c.createdAt,
      propertyType: c.propertyType,
      bedrooms: c.bedrooms,
      bathrooms: c.bathrooms,
      status: c.status,
      tenantId: c.tenantId,
      tenantName,
      planType,
      progress: { uploaded, analyzed, omitted, rejected, total, pct },
      captureUrl,
      firstPhotoId,
      firstPhotoUrl: firstPhotoId ? `/api/photos/${firstPhotoId}` : (firstPhotoFile ? storage.publicUrl(firstPhotoFile) : null),
      reviewStatus: c.reviewStatus || null,
      contactEmail: c.contactEmail || null,
      contactName: c.contactName || null
    };
  });

    return reply.send({ ok: true, cases: rows });
  } catch (err) {
    fastify.log.error({ err: err?.message, stack: err?.stack }, 'GET /api/cases');
    return reply.code(500).send({ ok: false, error: 'DB_ERROR', message: err?.message || 'Error al cargar casos' });
  }
});

fastify.get('/api/cases/:caseId/summary', async (req, reply) => {
  const caseId = String(req.params.caseId || '');
  const tenantId = getTenantIdFromReq(req);
  try {
    const runtimeCfg = await getRuntimeScoreConfig();
    let summary = await getCaseSummary({
      prisma,
      storage,
      caseId,
      slotGroupTitleFromCode,
      scoreConfig: runtimeCfg.config,
      scoreConfigUpdatedAt: runtimeCfg.updatedAt,
      tenantId
    });
    if (!summary.ok) return reply.code(404).send(summary);
    if (summary.case && !summary.case.shortId && caseId.length > 8) {
      try {
        let shortId = generateCaseShortId();
        for (let attempts = 0; attempts < 10; attempts++) {
          try {
            await prisma.case.update({ where: { id: summary.case.id }, data: { shortId } });
            summary = { ...summary, case: { ...summary.case, shortId } };
            break;
          } catch (err) {
            if (err?.code === 'P2002') shortId = generateCaseShortId();
            else throw err;
          }
        }
      } catch (err) {
        if (err?.name !== 'PrismaClientValidationError') fastify.log.warn(err, 'Lazy backfill shortId');
      }
    }
    let payload;
    try {
      payload = JSON.stringify(summary);
    } catch (serializeErr) {
      fastify.log.error({ err: serializeErr?.message, type: 'serialize' }, 'case-summary');
      throw serializeErr;
    }
    return reply.type('application/json').send(payload);
  } catch (err) {
    fastify.log.error({
      err: err?.message,
      stack: err?.stack,
      caseId,
      name: err?.name
    }, 'case-summary');
    return reply.code(500).send({ ok: false, error: 'SUMMARY_ERROR', message: err?.message || 'Error al cargar el informe' });
  }
});

fastify.patch('/api/cases/:caseId/property', async (req, reply) => {
  const caseId = String(req.params.caseId || '');
  const payload = req.body || {};
  const tenantId = getTenantIdFromReq(req);
  try {
    const byShortIdOrId = caseId.length === 8 ? { OR: [{ shortId: caseId }, { id: caseId }] } : { id: caseId };
    const c = await prisma.case.findFirst({
      where: { ...byShortIdOrId, ...(tenantId ? { tenantId } : {}) },
      include: { property: { include: { owner: true } } }
    });
    if (!c || !c.propertyId) return reply.code(404).send({ ok: false, error: 'CASE_NOT_FOUND' });

    const updates = {};
    if (payload.ownerRut !== undefined || payload.ownerName !== undefined) {
      const ownerRutNorm = payload.ownerRut ? normalizeRut(payload.ownerRut) : null;
      const rutToStore = payload.ownerRut !== undefined ? (ownerRutNorm || payload.ownerRut || null) : undefined;
      if (c.property.owner) {
        const ownerData = {};
        if (payload.ownerName !== undefined) ownerData.fullName = payload.ownerName;
        if (rutToStore !== undefined) ownerData.rut = rutToStore;
        if (Object.keys(ownerData).length) {
          await prisma.owner.update({ where: { id: c.property.owner.id }, data: ownerData });
        }
      } else if (payload.ownerName) {
        const created = await prisma.owner.create({
          data: {
            fullName: payload.ownerName,
            rut: rutToStore ?? null,
            tenantId: tenantId || null
          }
        });
        updates.ownerId = created.id;
      }
    }
    if (payload.propertyRol !== undefined) updates.rol = payload.propertyRol;
    if (payload.propertyAddress !== undefined) updates.address = payload.propertyAddress;
    if (Object.keys(updates).length) {
      await prisma.property.update({ where: { id: c.propertyId }, data: updates });
    }
    return reply.send({ ok: true });
  } catch (err) {
    fastify.log.error({ err: err?.message, caseId }, 'patch-property');
    return reply.code(500).send({ ok: false, error: 'UPDATE_ERROR', message: err?.message });
  }
});

fastify.post('/api/cases/:caseId/executive-summary', async (req, reply) => {
  const caseId = String(req.params.caseId || '');
  const tenantId = getTenantIdFromReq(req);
  if (!process.env.OPENAI_API_KEY) {
    return reply.code(400).send({ ok: false, error: 'OPENAI_NOT_CONFIGURED' });
  }

  const runtimeCfg = await getRuntimeScoreConfig();
  const summary = await getCaseSummary({
    prisma,
    storage,
    caseId,
    slotGroupTitleFromCode,
    scoreConfig: runtimeCfg.config,
    scoreConfigUpdatedAt: runtimeCfg.updatedAt,
    tenantId
  });
  if (!summary.ok) return reply.code(404).send(summary);

  const c = summary.case || {};
  const scoreConfig = runtimeCfg.config || DEFAULT_SCORE_CONFIG;
  const slots = summary.slots || [];
  const score = Math.round(Math.max(0, Math.min(100, summary.score ?? 0)));
  const badge = summary.badge || 'GRAY';

  const badgeLabelMap = { GREEN: 'Favorable', YELLOW: 'Intermedio', RED: 'Revisión sugerida', GRAY: 'Sin datos' };
  const badgeText = badgeLabelMap[badge] || badge;

  const kpiLabelMap = {
    MUROS_PINTURA: 'Muros y pintura',
    HUMEDAD: 'Humedad visible',
    PISOS: 'Pisos',
    SANITARIOS: 'Sanitarios',
    ELECTRICIDAD: 'Electricidad visible',
    VENTANAS_CERRAMIENTOS: 'Ventanas y cerramientos',
    PUERTAS_HERRAJES: 'Puertas y herrajes',
    MOBILIARIO_FIJO: 'Mobiliario fijo'
  };
  const slotsWithFindings = slots.filter((s) => s.findingCode && s.severity);
  const byKpi = {};
  slotsWithFindings.forEach((s) => {
    const kpi = classifyKpiFromSlot(s, scoreConfig?.slotKpiMap) || 'OTHER';
    if (!byKpi[kpi]) byKpi[kpi] = { label: kpiLabelMap[kpi] || kpi, areas: [], severities: [] };
    const title = (s.title || s.slotCode || '').replace(/_/g, ' ').trim();
    if (title && !byKpi[kpi].areas.includes(title)) byKpi[kpi].areas.push(title);
    if (s.severity) byKpi[kpi].severities.push(s.severity);
  });
  const summaryByType = Object.entries(byKpi).map(([kpi, data]) => {
    const high = data.severities.filter((v) => String(v).toLowerCase() === 'high').length;
    const medium = data.severities.filter((v) => String(v).toLowerCase() === 'medium').length;
    const low = data.severities.filter((v) => String(v).toLowerCase() === 'low').length;
    const severityNote = [high && `${high} alta`, medium && `${medium} media`, low && `${low} baja`].filter(Boolean).join(', ') || 'diversa';
    return `${data.label}: ${data.severities.length} hallazgo(s), severidad ${severityNote}.`;
  });

  const prompt = [
    'Eres un experto en informes técnicos inmobiliarios. Genera un resumen ejecutivo para el informe de inspección.',
    '',
    'PROHIBIDO: NUNCA incluyas dirección, nombre de calle, comuna, barrio, ROL, propietario ni datos que identifiquen el inmueble. PROHIBIDO nombrar ambientes concretos (cocina, living, baño, dormitorio, etc.) o listar hallazgos uno a uno por ubicación.',
    '',
    'Datos de entrada (solo para contexto):',
    `- Score técnico del inmueble (STI): ${score}/100 - ${badgeText}`,
    `- Tipos de problema con hallazgos: ${summaryByType.length ? summaryByType.join(' ') : 'Sin hallazgos relevantes.'}`,
    '',
    'Formato y estilo OBLIGATORIOS:',
    '- Redacta en 2 o 3 párrafos narrativos continuos. NO uses viñetas ni listas de hallazgos.',
    '- Párrafo 1: Estado general del inmueble según el STI (qué indica el score en términos de condiciones de conservación y cumplimiento de estándares).',
    '- Párrafo 2: Sintetiza los hallazgos por NATURALEZA del problema (ej. "terminaciones y superficies", "fisuras en juntas de revestimientos", "grietas en cielos", "manchas en pintura"), como aspectos propios del uso normal y de mantención. No menciones ambientes ni detalles por zona.',
    '- Párrafo 3: Conclusión sobre el funcionamiento general del inmueble y que los hallazgos corresponden a detalles de conservación abordables con mantenciones menores, orientadas a preservar condición estética y buen estado.',
    '- Lenguaje profesional, claro y neutro. Sin costos ni presupuestos. Sin encabezados ni markdown.'
  ].join('\n');

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 1200
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return reply.code(500).send({ ok: false, error: 'EMPTY_RESPONSE' });
    }

    if (c.id) {
      await prisma.case.update({
        where: { id: c.id },
        data: { executiveSummary: text }
      });
    }

    return reply.send({ ok: true, executiveSummary: text });
  } catch (err) {
    fastify.log.warn(err, 'executive-summary');
    return reply.code(500).send({ ok: false, error: 'GENERATION_FAILED', message: err?.message || 'Error al generar el resumen' });
  }
});

fastify.get('/api/cases/:caseId/report.pdf', async (req, reply) => {
  const caseId = String(req.params.caseId || '');
  const tenantId = getTenantIdFromReq(req);
  const runtimeCfg = await getRuntimeScoreConfig();
  const summary = await getCaseSummary({
    prisma,
    storage,
    caseId,
    slotGroupTitleFromCode,
    scoreConfig: runtimeCfg.config,
    scoreConfigUpdatedAt: runtimeCfg.updatedAt,
    tenantId
  });
  if (!summary.ok) return reply.code(404).send(summary);
  try {
    const pdf = await generateReportPdf({ summary, storage, prisma, scoreConfig: runtimeCfg.config });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="Informe-${summary.case?.shortId || caseId}.pdf"`)
      .send(pdf);
  } catch (err) {
    fastify.log.warn(err, 'report-pdf');
    return reply.code(500).send({ error: 'Failed to generate PDF' });
  }
});

const reanalyzeProgress = new Map();
const REANALYZE_CONCURRENCY = Math.max(1, Number(process.env.REANALYZE_CONCURRENCY || 6));

fastify.post('/api/cases/:caseId/reanalyze', async (req, reply) => {
  const rawId = String(req.params.caseId || '');
  if (!process.env.OPENAI_API_KEY) {
    return reply.code(400).send({ ok: false, error: 'OPENAI_NOT_CONFIGURED' });
  }

  const c = await prisma.case.findFirst({
    where: { OR: [{ id: rawId }, { shortId: rawId }] },
    select: { id: true, shortId: true }
  });
  if (!c) return reply.code(404).send({ ok: false, error: 'CASE_NOT_FOUND' });
  const caseId = c.id;
  const trackingKey = c.shortId || caseId;

  const force = String(req.query?.force || '').toLowerCase() === 'true' || String(req.query?.force || '') === '1';
  const slots = await prisma.slot.findMany({
    where: { caseId, photoId: { not: null } },
    select: { id: true, analysisDebug: true }
  });

  const targets = force
    ? slots
    : slots.filter((s) => String(s.analysisDebug?.source || '').toUpperCase() !== 'OPENAI');
  const queued = targets.length;

  reanalyzeProgress.set(trackingKey, { total: queued, completed: 0, errors: 0, done: false });

  setTimeout(async () => {
    const progress = reanalyzeProgress.get(trackingKey);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(REANALYZE_CONCURRENCY, Math.max(1, targets.length)) }, async () => {
      while (cursor < targets.length) {
        const idx = cursor++;
        const s = targets[idx];
        try {
          await queueOpenAiSlotAnalysis({ slotId: s.id });
        } catch (err) {
          fastify.log.error(err, `Error reanalyzing slot ${s.id}`);
          if (progress) progress.errors++;
        }
        if (progress) progress.completed++;
      }
    });
    await Promise.all(workers);
    if (progress) progress.done = true;
    setTimeout(() => reanalyzeProgress.delete(trackingKey), 5 * 60 * 1000);
  }, 0);

  return reply.send({ ok: true, queued, forced: force });
});

fastify.get('/api/cases/:caseId/reanalyze-status', async (req, reply) => {
  const rawId = String(req.params.caseId || '');
  const c = await prisma.case.findFirst({
    where: { OR: [{ id: rawId }, { shortId: rawId }] },
    select: { shortId: true, id: true }
  });
  const key = c?.shortId || c?.id || rawId;
  const progress = reanalyzeProgress.get(key);
  if (!progress) return reply.send({ active: false });
  return reply.send({ active: true, total: progress.total, completed: progress.completed, errors: progress.errors, done: progress.done });
});

fastify.get('/api/cases/:caseId/review-status', async (req, reply) => {
  const rawId = String(req.params.caseId || '');
  const c = await prisma.case.findFirst({
    where: { OR: [{ id: rawId }, { shortId: rawId }] },
    select: { reviewStatus: true, reviewedAt: true, reviewerEmail: true }
  });
  if (!c) return reply.code(404).send({ ok: false });
  return reply.send({ ok: true, reviewStatus: c.reviewStatus || null, reviewedAt: c.reviewedAt, reviewerEmail: c.reviewerEmail });
});

/**
 * Envía el informe por email al corredor/ejecutor (assignedUser → tenant.email)
 * y, en Starter, también al contacto (cliente).
 * @param {string} caseId
 * @param {{ force?: boolean, req?: any }} [opts]
 */
async function sendCaseReportEmails(caseId, opts = {}) {
  const force = opts.force === true;
  const req = opts.req;
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      shortId: true,
      contactEmail: true,
      contactName: true,
      tenantId: true,
      executiveReportNotifiedAt: true,
      reviewStatus: true,
      assignedUser: { select: { email: true, fullName: true } },
      tenant: { select: { name: true, email: true } },
      property: { select: { address: true } }
    }
  });
  if (!c) return { ok: false, error: 'CASE_NOT_FOUND' };

  const shortId = c.shortId || c.id;
  const isStarter = c.tenant?.name === STARTER_TENANT_NAME;
  const proto = (req?.headers?.['x-forwarded-proto'] || 'https').toString().split(',')[0].trim();
  const host = (req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'ainspecciona.com').toString().split(',')[0].trim();
  const publicBase =
    String(process.env.PUBLIC_URL || process.env.BASE_URL || process.env.WEB_APP_ORIGIN || '').trim().replace(/\/$/, '') ||
    `${proto}://${host}`;
  const reportUrl = `${publicBase}/cases/${encodeURIComponent(shortId)}/report`;

  let pdfBuffer = null;
  let certBuffer = null;
  try {
    const runtimeCfg = await getRuntimeScoreConfig();
    const summary = await getCaseSummary({
      prisma,
      storage,
      caseId: c.id,
      slotGroupTitleFromCode,
      scoreConfig: runtimeCfg.config,
      scoreConfigUpdatedAt: runtimeCfg.updatedAt,
      tenantId: c.tenantId || undefined
    });
    pdfBuffer = await generateReportPdf({ summary, storage, prisma, scoreConfig: runtimeCfg.config });
    let qrDataUri = null;
    try {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=0&data=${encodeURIComponent(reportUrl)}`;
      const qrRes = await fetch(qrUrl);
      if (qrRes.ok) {
        const qrBuf = Buffer.from(await qrRes.arrayBuffer());
        qrDataUri = `data:image/png;base64,${qrBuf.toString('base64')}`;
      }
    } catch (_) {}
    const score = Math.round(Math.max(0, Math.min(100, summary.score ?? 0)));
    const badge = summary.badge || 'GREEN';
    certBuffer = await generateCertificateImage({ score, badge, shortId, reportUrl, qrDataUri });
  } catch (err) {
    fastify.log.warn({ err: err?.message, caseId: c.id }, 'send-report-email-pdf-build');
  }

  const sent = [];
  const errors = [];

  // Starter: PDF al contacto (cliente)
  if (isStarter && c.contactEmail) {
    try {
      const r = await sendApprovedReportEmail(c.contactEmail, c.contactName || '', shortId, pdfBuffer, certBuffer);
      if (r.ok) sent.push({ role: 'contact', email: c.contactEmail });
      else errors.push({ role: 'contact', email: c.contactEmail, error: r.error || (r.skipped ? 'SMTP_SKIPPED' : 'SEND_FAILED') });
    } catch (err) {
      errors.push({ role: 'contact', email: c.contactEmail, error: err?.message || String(err) });
    }
  }

  // Corredor/ejecutor: assignedUser, si no tenant.email
  const executorEmail = String(c.assignedUser?.email || (!isStarter ? c.tenant?.email : '') || '')
    .trim()
    .toLowerCase();
  const executorName = c.assignedUser?.fullName || c.tenant?.name || '';
  const alreadyNotified = !!c.executiveReportNotifiedAt;
  if (executorEmail && (force || !alreadyNotified)) {
    const contactNorm = String(c.contactEmail || '').trim().toLowerCase();
    const sameAsContact = isStarter && contactNorm && contactNorm === executorEmail;
    try {
      let r;
      if (pdfBuffer && !sameAsContact) {
        r = await sendApprovedReportEmail(executorEmail, executorName, shortId, pdfBuffer, certBuffer);
      } else if (!sameAsContact) {
        r = await sendExecutiveReportReadyEmail(executorEmail, {
          fullName: executorName,
          shortId,
          address: c.property?.address || '',
          reportUrl
        });
      } else {
        r = { ok: true, skippedDuplicate: true };
      }
      if (r.ok || r.skippedDuplicate) {
        if (!r.skippedDuplicate) sent.push({ role: 'executor', email: executorEmail });
        await prisma.case.updateMany({
          where: { id: c.id },
          data: { executiveReportNotifiedAt: new Date() }
        });
      } else {
        errors.push({
          role: 'executor',
          email: executorEmail,
          error: r.error || (r.skipped ? 'SMTP_SKIPPED' : 'SEND_FAILED')
        });
      }
    } catch (err) {
      errors.push({ role: 'executor', email: executorEmail, error: err?.message || String(err) });
    }
  } else if (!executorEmail) {
    errors.push({ role: 'executor', error: 'NO_EXECUTOR_EMAIL' });
  }

  return {
    ok: sent.length > 0 || (errors.length === 0 && alreadyNotified && !force),
    emailSent: sent.length > 0,
    alreadyNotified: alreadyNotified && !force && sent.length === 0,
    shortId,
    sent,
    errors,
    reportUrl
  };
}

fastify.post('/api/cases/:caseId/approve', async (req, reply) => {
  const rawId = String(req.params.caseId || '');
  const c = await prisma.case.findFirst({
    where: { OR: [{ id: rawId }, { shortId: rawId }] },
    select: { id: true, shortId: true }
  });
  if (!c) return reply.code(404).send({ ok: false, error: 'CASE_NOT_FOUND' });

  await prisma.case.update({
    where: { id: c.id },
    data: { reviewStatus: 'approved', reviewedAt: new Date(), reviewerEmail: REVIEWER_EMAIL }
  });

  const mail = await sendCaseReportEmails(c.id, { force: false, req });
  fastify.log.info(
    { caseId: c.id, shortId: mail.shortId, emailSent: mail.emailSent, sent: mail.sent, errors: mail.errors },
    'approved-report-emails'
  );

  return reply.send({
    ok: true,
    approved: true,
    emailSent: !!mail.emailSent,
    executiveReportNotified: !!(mail.sent || []).some((s) => s.role === 'executor'),
    sent: mail.sent || [],
    errors: mail.errors || [],
    shortId: mail.shortId || c.shortId || c.id
  });
});

/** Reenvío manual del informe por email (admin o tenant dueño del caso). */
fastify.post('/api/cases/:caseId/send-report-email', async (req, reply) => {
  const rawId = String(req.params.caseId || '');
  const c = await prisma.case.findFirst({
    where: { OR: [{ id: rawId }, { shortId: rawId }] },
    select: { id: true, tenantId: true, reviewStatus: true }
  });
  if (!c) return reply.code(404).send({ ok: false, error: 'CASE_NOT_FOUND' });

  const adminOk = typeof isAdminAuthed === 'function' && isAdminAuthed(req);
  const tenantSession = await getTenantSession(req);
  const tenantOk = !!(tenantSession?.tenantId && c.tenantId && tenantSession.tenantId === c.tenantId);
  if (!adminOk && !tenantOk) {
    return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED', message: 'Debes iniciar sesión (admin o tenant).' });
  }

  const mail = await sendCaseReportEmails(c.id, { force: true, req });
  if (!mail.ok && mail.error === 'CASE_NOT_FOUND') {
    return reply.code(404).send({ ok: false, error: 'CASE_NOT_FOUND' });
  }
  return reply.send({
    ok: !!mail.emailSent,
    emailSent: !!mail.emailSent,
    sent: mail.sent || [],
    errors: mail.errors || [],
    shortId: mail.shortId,
    message: mail.emailSent
      ? `Email enviado a ${(mail.sent || []).map((s) => s.email).join(', ')}`
      : (mail.errors || []).map((e) => e.error).join('; ') || 'No se pudo enviar el email'
  });
});


const queuePostventaTicketAnalysis = createPostventaAnalysisQueue({
  prisma,
  storage,
  log: fastify.log
});

await registerWhatsAppRoutes(fastify, { prisma });
await registerPostventaAgentRoutes(fastify, { prisma });
await registerPostventaPublicRoutes(fastify, { prisma });
await registerPostventaCaptureRoutes(fastify, {
  prisma,
  storage,
  safeExtFromMime,
  queuePostventaTicketAnalysis
});
await registerPostventaTicketRoutes(fastify, {
  prisma,
  storage,
  queuePostventaTicketAnalysis
});
await registerPostventaAdminRoutes(fastify, {
  prisma,
  queuePostventaTicketAnalysis,
  storage
});
await registerPostventaPortalRoutes(fastify, {
  prisma,
  storage,
  queuePostventaTicketAnalysis
});
await registerEntregaRoutes(fastify, { prisma });
await registerInOutRoutes(fastify, { prisma });
await registerScanRoutes(fastify, { prisma });
await registerPlatformRoutes(fastify, { prisma });
await registerAintelligenceAdminRoutes(fastify, {
  prisma,
  storage,
  getRuntimeScoreConfig,
  applyScoreConfigUpdate
});
await registerTaxonomyAdminRoutes(fastify);
await registerReviewCenterRoutes(fastify, {
  prisma,
  storage,
  classifyKpiFromSlot,
  getRuntimeScoreConfig,
  applyScoreConfigUpdate,
  queuePostventaTicketAnalysis,
  reviewerEmailDefault: REVIEWER_EMAIL
});
await registerReviewAssistantRoutes(fastify, {
  prisma,
  classifyKpiFromSlot,
  getRuntimeScoreConfig
});

fastify.delete('/api/admin/cases/:caseId', async (req, reply) => {
  try {
    const result = await deleteAinspeccionaCase(prisma, storage, String(req.params.caseId || ''), { log: req.log });
    if (!result.ok) return reply.code(result.status || 400).send(result);
    return reply.send(result);
  } catch (err) {
    req.log.error({ err }, 'admin delete case');
    return reply.code(500).send({ ok: false, error: 'DELETE_FAILED', message: err?.message || 'Error al borrar' });
  }
});

fastify.listen({ port: PORT, host: '0.0.0.0' })
  .then(async () => {
    fastify.log.info({ port: PORT }, 'Server listening');
    prisma.$connect().then(() => fastify.log.info('DB connected')).catch((err) => fastify.log.warn(err, 'DB connect'));
    backfillCaseShortIds().catch((err) => fastify.log.warn(err, 'Backfill shortId'));
    ensureReviewColumns().catch((err) => fastify.log.warn(err, 'ensure-review-columns'));
    ensureSubscriptionColumns().catch((err) => fastify.log.warn(err, 'ensure-subscription-columns'));
    ensureTrialColumns().catch((err) => fastify.log.warn(err, 'ensure-trial-columns'));
    ensurePromoTables().catch((err) => fastify.log.warn(err, 'ensure-promo-tables'));
    ensureMagicLinkTokenTable().catch((err) => fastify.log.warn(err, 'ensure-magic-link-token-table'));
    ensurePageViewTable().catch((err) => fastify.log.warn(err, 'ensure-pageview-table'));
    if (prisma) {
      ensurePlatformSchema(prisma)
        .then(() => ensureToctocTenants(prisma))
        .then((r) => {
          fastify.log.info({ postventa: r?.postventa?.email }, 'toctoc-tenants-ready');
          return ensurePlatformDemo(prisma, r);
        })
        .then((p) =>
          fastify.log.info(
            { hub: p?.hub?.email, control: p?.control?.email },
            'platform-demo-ready'
          )
        )
        .catch((err) => fastify.log.warn(err, 'ensure-platform-demo'));
    }
    ensureAppSettingsTable()
      .then(async () => {
        const runtime = await getRuntimeScoreConfig({ force: true });
        if (runtime?.config) {
          scoreConfig = runtime.config;
          return;
        }
        await saveScoreConfigToDb(scoreConfig);
      })
      .catch((err) => fastify.log.warn(err, 'ensure-appsetting-table'));
  })
  .catch((err) => {
    fastify.log.error({ err: err?.message, port: PORT }, 'Failed to start server');
    process.exit(1);
  });

