import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import cookie from '@fastify/cookie';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import OpenAI from 'openai';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';

import { createStorage } from './src/storage/storage.js';
import { registerCaptureRoutes } from './src/routes/capture.js';
import { getCaseSummary } from './src/routes/caseSummary.js';
import { generateReportPdf } from './src/pdf/reportPdf.js';
import { generateCertificateImage } from './src/pdf/certificateImage.js';
import { DEFAULT_SCORE_CONFIG, normalizeScoreConfig, classifyKpiFromSlot } from './src/scoring/scoringV2_2.js';
import {
  sendInspectionLinkEmail,
  sendBusinessMagicLinkEmail,
  sendPasswordResetEmail,
  sendReviewNotificationEmail,
  sendApprovedReportEmail,
  sendExecutiveInvitationEmail,
  sendExecutiveCaptureInviteEmail
} from './src/email.js';
import { generateBusinessReceiptPdf } from './src/pdf/receiptPdf.js';

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
  trustProxy: process.env.NODE_ENV === 'production' || !!process.env.TRUST_PROXY
});
const prisma = new PrismaClient();
const storage = createStorage();

const CORS_ALLOWED_ORIGINS = new Set([
  'http://localhost:8081',
  'http://localhost:19006',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:19006',
  'https://ainspecciona.com',
  'https://www.ainspecciona.com',
  'https://ainspecciona.web.app'
]);

await fastify.register(cors, {
  origin(origin, cb) {
    if (!origin || CORS_ALLOWED_ORIGINS.has(origin)) {
      cb(null, true);
      return;
    }
    cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-token', 'x-admin-user', 'x-admin-pass']
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
const REVIEWER_EMAIL = process.env.REVIEWER_EMAIL || 'paulo.yanez@ainspecciona.com';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 días
const TRIAL_DURATION_DAYS = Number(process.env.TRIAL_DURATION_DAYS || 14);
const TRIAL_INITIAL_REAL_INSPECTIONS = Number(process.env.TRIAL_INITIAL_REAL_INSPECTIONS || 1);
const PARTNER_TRIAL_DURATION_DAYS = Number(process.env.PARTNER_TRIAL_DURATION_DAYS || 30);
const PARTNER_TRIAL_BONUS_CREDITS = Number(process.env.PARTNER_TRIAL_BONUS_CREDITS || 1);
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
  const starterTenant = await prisma.tenant.findFirst({
    where: { name: STARTER_TENANT_NAME },
    select: { id: true }
  });
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

function normalizePartnerCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
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
        starter: 15000,
        business: BUSINESS_PRICE_CLP,
        corporate: 1300000,
        'credits-5': 64950,
        'credits-10': 119900,
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

  // ——— Recorrido físico: documento primero, luego entrada → tablero → cocina → loggia → living → dormitorios+baños ———

  if (input.hasGreenCertificate) {
    plan.push({ slotCode: 'CERTIFICADO_VERDE', title: 'Certificado verde', instructions: buildInstruction({
      indicaciones: '', donde: 'Documento de certificado verde o certificación energética.', que: 'Fotografía legible del certificado vigente.'
    }), required: false });
  }

  plan.push({ slotCode: 'PUERTA_ENTRADA', title: 'Puerta de entrada', instructions: buildInstruction({
    indicaciones: '', donde: 'Puerta de entrada principal, interior y marco.', que: 'Estado de puerta, bisagras, herrajes y marco.'
  }), required: true });

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
      MOBILIARIO_FIJO: 'mobiliario fijo'
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
    let resolvedPrompt = String(promptTemplate)
      .replace(/\{\{SLOT_CODE\}\}/g, areaDesc)
      .replace(/\{\{AREA_DESCRIPTION\}\}/g, areaDesc)
      .replace(/\{\{CRITERIA_DESCRIPTION\}\}/g, criteriaDesc);
    const prompt = resolvedPrompt;
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
      '}'
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
    const details = Array.isArray(parsed.details) ? parsed.details : [];
    const proposedSeverityRaw = String(parsed.proposed_severity || '').trim().toLowerCase();
    const proposedSeverity = ['low', 'medium', 'high'].includes(proposedSeverityRaw) ? proposedSeverityRaw : null;
    const severityReason = String(parsed.severity_reason || '').trim() || 'Sin fundamento de severidad.';
    const matchesSlot = typeof parsed.matches_slot === 'boolean' ? parsed.matches_slot : true;
    const matchConfidence = Math.max(0, Math.min(1, Number(parsed.match_confidence ?? 0.7)));
    const matchReason = String(parsed.match_reason || '').trim() || 'No se entregó justificación de correspondencia.';
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.7)));
    const extentText = details.map((d) => String(d?.extent || '').toLowerCase());
    const hasWide = extentText.some((t) => t.includes('extend') || t.includes('general') || t.includes('ampl'));
    let analysisLower = `${description} ${kpiAnalysis}`.toLowerCase();
    let analysisSaysNoIssue = [
      "sin observaciones",
      "sin hallazgos relevantes",
      "no se observan",
      "no se identifican",
      "no se detectan",
      "sin señales",
      "sin señales evidentes",
      "condiciones adecuadas",
      "condición adecuada",
      "sin daños",
      "sin deterioros",
      "sin anomalías",
      "sin signos",
      "no presenta señales"
    ].some((t) => analysisLower.includes(t));
    if (analysisSaysNoIssue && signals.length) {
      signals.length = 0;
    }
    const issueKeywords = [
      "corros", "óxido", "oxido", "mancha", "grieta", "fisura", "filtr", "humedad",
      "moho", "salitre", "descascar", "desprend", "deform", "desaline", "daño", "dano",
      "golpe", "quiebre", "trizad", "rot", "rayon", "rayón", "desgaste"
    ];
    let hasRealDefect = issueKeywords.some((k) => analysisLower.includes(k) || signals.some((sig) => sig.toLowerCase().includes(k)));

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
      const extra = signals.length
        ? 'Se aprecian detalles puntuales visibles en el encuadre que ameritan registro en el informe técnico.'
        : 'Las superficies se ven uniformes y sin evidencias claras de deterioro.';
      kpiAnalysis = `${kpiAnalysis} ${extra}`.trim();
    }
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
    const severitySource = analysisSaysNoIssue && finalSeverity === null
      ? 'forced_ok'
      : (finalSeverity && proposedSeverity && finalSeverity === proposedSeverity ? 'ai_proposed' : (finalSeverity ? 'rule_guardrail' : 'none'));
    const hasSignals = !!finalSeverity;
    const analysisCode = hasSignals ? 'COSMETIC_WEAR' : 'OK';
    let message = hasSignals
      ? (kpiAnalysis || `Se detecta: ${signals.join(', ')}.`)
      : 'Conclusión: no se observan hallazgos relevantes en esta evidencia.';
    const scorePenaltyApplied = hasSignals && kpiKey && activeScoreConfig?.kpis?.[kpiKey]
      ? Number(activeScoreConfig.kpis[kpiKey][String(finalSeverity).toLowerCase()] ?? 0)
      : 0;

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
    if (c === 'ELEVATOR') return 'ELEVATOR';
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
fastify.register(staticPlugin, {
  root: path.join(__dirname, 'public'),
  prefix: '/',
  index: 'corredores.html'
});
fastify.register(staticPlugin, {
  root: path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads'),
  prefix: '/uploads/',
  decorateReply: false
});

fastify.get('/favicon.ico', (req, reply) => reply.redirect(302, '/icons/icon.svg'));
fastify.get('/index.html', (req, reply) => reply.redirect(302, '/'));

// Health check ligero para Cloud Run (sin DB) - responde rápido al arranque
fastify.get('/health', (req, reply) => reply.send({ ok: true, status: 'up' }));
fastify.get('/formulario', (req, reply) => reply.sendFile('formulario.html'));
fastify.get('/cases/:caseId/report', (req, reply) => reply.sendFile('report.html'));
fastify.get('/cases/:caseId/certificate', (req, reply) => reply.sendFile('certificate.html'));
fastify.get('/admin', (req, reply) => reply.sendFile('admin.html'));
fastify.get('/activate', (req, reply) => reply.sendFile('activate.html'));
/** Enlaces para pantalla post-activación ejecutivo (Play Store, panel web). Sin secretos. */
fastify.get('/api/public/executive-app', (req, reply) => {
  const playStoreUrl = String(process.env.EXECUTIVE_PLAY_STORE_URL || '').trim() || null;
  return reply.send({
    ok: true,
    playStoreUrl,
    executiveWebUrl: `${getPublicWebBase(req)}/executive`
  });
});
fastify.get('/install', (req, reply) => reply.redirect('/executive'));
fastify.get('/login', (req, reply) => reply.redirect(302, '/'));
fastify.get('/tenant', (req, reply) => reply.sendFile('tenant.html'));
fastify.get('/tenant/comprar-creditos', (req, reply) => reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('tenant-comprar-creditos.html'));
fastify.get('/executive', (req, reply) => reply.sendFile('executive.html'));
fastify.get('/precios', (req, reply) => reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('precios.html'));
fastify.get('/demo', (req, reply) => reply.header('Cache-Control', 'no-store, no-cache, must-revalidate').sendFile('demo.html'));
fastify.get('/pago', (req, reply) => reply.sendFile('pago.html'));
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

// Validar código de partner (influencer / embajador / alianza) para trial extendido
fastify.post('/api/business/trial/partner-code', async (req, reply) => {
  try {
    const code = normalizePartnerCode(req.body?.code);
    if (!code) {
      return reply.send({
        ok: true,
        valid: false,
        durationDays: TRIAL_DURATION_DAYS,
        extraCredits: 0,
        totalTrialCredits: TRIAL_INITIAL_REAL_INSPECTIONS
      });
    }
    const partner = await prisma.referralPartner.findFirst({
      where: { code, active: true },
      select: { id: true, name: true, type: true }
    });
    if (!partner) {
      return reply.send({
        ok: true,
        valid: false,
        durationDays: TRIAL_DURATION_DAYS,
        extraCredits: 0,
        totalTrialCredits: TRIAL_INITIAL_REAL_INSPECTIONS
      });
    }
    return reply.send({
      ok: true,
      valid: true,
      partnerName: partner.name,
      partnerType: partner.type,
      durationDays: PARTNER_TRIAL_DURATION_DAYS,
      extraCredits: PARTNER_TRIAL_BONUS_CREDITS,
      totalTrialCredits: TRIAL_INITIAL_REAL_INSPECTIONS + PARTNER_TRIAL_BONUS_CREDITS
    });
  } catch (err) {
    req.log.warn({ err }, 'trial-partner-code-error');
    return reply.code(500).send({ ok: false, error: 'PARTNER_CODE_CHECK_FAILED' });
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
    const proto = (req.headers['x-forwarded-proto'] || 'http').toString().split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').toString().split(',')[0].trim();
    const baseUrl = `${proto}://${host}`;
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
      notification_url: `${baseUrl}/api/mercadopago/webhook`,
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
    if (tenant.referralPartnerId) {
      return reply.code(409).send({
        ok: false,
        error: 'REFERRAL_ALREADY_ASSIGNED',
        message: 'Esta cuenta ya tiene un código de referido asignado.'
      });
    }

    let referralPartner = null;
    if (partnerCodeNorm) {
      referralPartner = await prisma.referralPartner.findFirst({
        where: { code: partnerCodeNorm, active: true },
        select: { id: true, name: true, type: true }
      });
      if (!referralPartner) {
        return reply.code(400).send({
          ok: false,
          error: 'PARTNER_CODE_INVALID',
          message: 'Código de referido no válido o inactivo.'
        });
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
    const trialCreditTotal =
      TRIAL_INITIAL_REAL_INSPECTIONS + (referralPartner ? PARTNER_TRIAL_BONUS_CREDITS : 0);

    const proto = (req.headers['x-forwarded-proto'] || 'http').toString().split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').toString().split(',')[0].trim();
    const baseUrl = `${proto}://${host}`;
    const BUSINESS_PRICE_CLP = Number(process.env.BUSINESS_PRICE_CLP || 39990);
    const trialReason = referralPartner
      ? `Ainspecciona Business – Free Trial ${trialDays} días (código partner, cobro automático al finalizar)`
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
      notification_url: `${baseUrl}/api/mercadopago/webhook`,
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
    const trialSourceVal = referralPartner ? 'trial_partner_code' : 'trial_checkout_page';
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
          referralCodeSnapshot: referralPartner ? partnerCodeNorm : null,
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
    });

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
        partnerApplied: Boolean(referralPartner)
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
  return reply.send({
    mercadopagoAvailable: !!process.env.MERCADOPAGO_ACCESS_TOKEN,
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
    const starterTenant = await prisma.tenant.findFirst({ where: { name: STARTER_TENANT_NAME } });
    if (!starterTenant) {
      return reply.code(503).send({ error: 'STARTER_TENANT_NOT_CONFIGURED', message: 'Ejecuta prisma:seed para crear el tenant Starter.' });
    }
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
    const proto = (req.headers['x-forwarded-proto'] || 'http').toString().split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').toString().split(',')[0].trim();
    const baseUrl = `${proto}://${host}`;
    const redirectUrl = `${baseUrl}/pago/ok?plan=starter&payment_id=${encodeURIComponent(paymentId)}`;
    fastify.log.info({ paymentId, contactEmail }, 'starter-demo-payment-simulated');
    return reply.send({ redirectUrl, payment_id: paymentId });
  } catch (err) {
    fastify.log.error({ err, body: req.body }, 'starter-simulate-payment-error');
    const msg = err?.message || String(err);
    return reply.code(500).send({ error: 'SIMULATE_PAYMENT_ERROR', message: msg });
  }
});

// Starter: crear caso DRAFT + preferencia MercadoPago (flujo nuevo: form primero, pago después)
fastify.post('/api/starter/create-draft', async (req, reply) => {
  try {
    const { contactName, contactEmail, contactRut, propertyAddress, propertyRol, propertyOperationType,
      propertySurface, propertyType, bathroomsCount, bedroomsCount,
      hasPatio, hasAttic, hasLaundry, hasElevator, hasParking, hasGreenCertificate } = req.body || {};

    if (!contactName || !contactEmail || !contactRut) {
      return reply.code(400).send({ ok: false, error: 'Faltan nombre, email o RUT' });
    }

    const starterTenant = await prisma.tenant.findFirst({ where: { name: STARTER_TENANT_NAME } });
    if (!starterTenant) {
      return reply.code(503).send({ ok: false, error: 'STARTER_TENANT_NOT_CONFIGURED' });
    }

    const shortId = generateCaseShortId();
    const bedrooms = Math.max(0, Number(bedroomsCount) || 1);
    const bathrooms = Math.max(1, Number(bathroomsCount) || 1);

    const c = await prisma.case.create({
      data: {
        shortId,
        tenantId: starterTenant.id,
        contactEmail: String(contactEmail).trim().toLowerCase(),
        contactName: String(contactName).trim(),
        contactRut: String(contactRut).trim() || null,
        propertyType: propertyType || 'DEPARTMENT',
        bedrooms,
        bathrooms,
        bathroomsCount: bathrooms,
        bedroomsCount: bedrooms,
        floorType: 'CONCRETE',
        hasPatio: !!hasPatio,
        hasAttic: !!hasAttic,
        hasLaundry: !!hasLaundry,
        hasElevator: !!hasElevator,
        hasParking: !!hasParking,
        hasGreenCertificate: !!hasGreenCertificate,
        status: 'DRAFT'
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
      hasPatio: !!hasPatio,
      hasAttic: !!hasAttic,
      hasLaundry: !!hasLaundry,
      hasElevator: !!hasElevator,
      hasParking: !!hasParking,
      hasGreenCertificate: !!hasGreenCertificate
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

    const proto = (req.headers['x-forwarded-proto'] || 'http').toString().split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').toString().split(',')[0].trim();
    const baseUrl = `${proto}://${host}`;

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) {
      const demoPaymentId = 'demo_' + crypto.randomUUID().replace(/-/g, '');
      await prisma.case.update({ where: { id: c.id }, data: { mercadopagoPaymentId: demoPaymentId } });
      const redirectUrl = `${baseUrl}/pago/ok?plan=starter&payment_id=${encodeURIComponent(demoPaymentId)}`;
      fastify.log.info({ caseId: c.id, shortId: c.shortId, mode: 'demo' }, 'starter-checkout-demo');
      return reply.send({ ok: true, checkoutUrl: redirectUrl });
    }

    const extRef = `plan:starter|caseId:${c.id}|ts:${Date.now()}`;
    const successUrl = `${baseUrl}/pago/ok?plan=starter`;
    const nameParts = (c.contactName || '').trim().split(/\s+/);
    const prefPayload = {
      items: [{ title: '1 crédito Starter', quantity: 1, unit_price: 15000, currency_id: 'CLP' }],
      payer: {
        email: c.contactEmail,
        first_name: nameParts[0] || undefined,
        last_name: nameParts.slice(1).join(' ') || undefined
      },
      statement_descriptor: 'AINSPECCIONA',
      external_reference: extRef,
      back_urls: { success: successUrl, failure: `${baseUrl}/photoplan?case=${c.shortId}`, pending: successUrl },
      auto_return: 'approved',
      notification_url: `${baseUrl}/api/mercadopago/webhook`
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

    fastify.log.info({ caseId: c.id, shortId: c.shortId, extRef }, 'starter-checkout-created');
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
    starter: { title: '1 crédito Starter', unit_price: 15000, credits: 1 },
    business: { title: 'Plan Business mensual', unit_price: BUSINESS_PRICE_CLP, credits: 2 },
    corporate: { title: '100 créditos Corporate', unit_price: 1300000, credits: 100 },
    'credits-5': { title: '5 créditos', unit_price: 64950, credits: 5 },
    'credits-10': { title: '10 créditos', unit_price: 119900, credits: 10 },
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
  const proto = (req.headers['x-forwarded-proto'] || 'http').toString().split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').toString().split(',')[0].trim();
  const baseUrl = `${proto}://${host}`;
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
  const preference = {
    items: [{ title: planData.title, quantity: 1, unit_price: planData.unit_price, currency_id: 'CLP' }],
    payer: {
      email,
      first_name: nombre ? String(nombre).trim() : undefined,
      last_name: apellido ? String(apellido).trim() : undefined
    },
    statement_descriptor: 'AINSPECCIONA',
    back_urls: {
      success: successUrl,
      failure: `${baseUrl}/pago/error`,
      pending: `${baseUrl}/pago/pendiente`
    },
    auto_return: 'approved',
    external_reference: extRef,
    notification_url: `${baseUrl}/api/mercadopago/webhook`
  };
  try {
    const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(preference)
    });
    const data = await res.json();
    if (!res.ok) {
      fastify.log.warn({ status: res.status, data }, 'mercadopago-preference-error');
      return reply.code(502).send({ error: data.message || 'Error al crear preferencia MercadoPago' });
    }
    const isTestToken = accessToken.startsWith('TEST-');
    const initPoint = isTestToken
      ? (data.sandbox_init_point || data.init_point)
      : (data.init_point || data.sandbox_init_point);
    if (!initPoint) return reply.code(502).send({ error: 'MercadoPago no devolvió URL de pago' });
    return reply.send({ init_point: initPoint });
  } catch (err) {
    fastify.log.error(err, 'mercadopago-preference');
    return reply.code(502).send({ error: 'Error de conexión con MercadoPago' });
  }
});

// MercadoPago Webhook: al pago aprobado, sumar créditos al tenant o crear Case Starter
fastify.post('/api/mercadopago/webhook', async (req, reply) => {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return reply.code(200).send(); // 200 para que MP no reintente
  const payload = req.body || {};
  const topic = String(payload.type || payload.topic || '').toLowerCase();
  const id = payload.data?.id || payload['data.id'];

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

  if (topic !== 'payment' || !id) return reply.code(200).send();
  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const payment = await res.json();
    if (!res.ok || payment.status !== 'approved') return reply.code(200).send();
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
          return reply.code(200).send();
        }
      }

      const starterTenant = await prisma.tenant.findFirst({ where: { name: STARTER_TENANT_NAME } });
      if (!starterTenant) {
        fastify.log.warn('starter-tenant-not-found');
        return reply.code(200).send();
      }
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
              const sent = await sendBusinessMagicLinkEmail(subTenant.email, magicUrl, subTenant.name, {
                facturacion: subTenant.facturacionJson,
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
      return reply.code(200).send();
    }

    // Planes con tenant: créditos (Business = 2 inspecciones incluidas; corporate/bolsas en dashboard)
    const PLANS = { starter: 1, business: 2, corporate: 100, 'credits-5': 5, 'credits-10': 10, 'credits-20': 20 };
    const credits = PLANS[plan] ?? 0;
    if (!tenantId || credits < 1) return reply.code(200).send();

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

    // Business: enviar magic link para acceso inicial (luego crea contraseña)
    if (plan === 'business') {
      try {
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, name: true, email: true, facturacionJson: true }
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
      return reply.send({
        ok: true,
        status: 'approved',
        presencialOrder: true,
        alreadyProcessed: !!r.skipped
      });
    }

    const PLANS = { business: 2, 'credits-5': 5, 'credits-10': 10, 'credits-20': 20 };
    const credits = PLANS[plan] ?? 0;

    if (!tenantId || credits < 1) {
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

  const planSlots = buildPhotoPlanV1({ ...payload, bathroomsCount, bedroomsCount });
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
    const starterTenant = await prisma.tenant.findFirst({ where: { name: STARTER_TENANT_NAME } });
    if (!starterTenant) return reply.code(503).send({ ok: false, error: 'STARTER_TENANT_NOT_CONFIGURED' });
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
        hasPatio: !!payload.hasPatio,
        hasAttic: !!payload.hasAttic,
        hasLaundry: !!payload.hasLaundry,
        hasElevator: !!payload.hasElevator,
        hasParking: !!payload.hasParking,
        hasGreenCertificate: !!payload.hasGreenCertificate
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
fastify.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/api/admin')) {
    const expectedUser = process.env.ADMIN_USER || 'admin';
    const expectedPass = process.env.ADMIN_PASS || 'admin123';
    const providedUser = req.headers['x-admin-user'];
    const providedPass = req.headers['x-admin-pass'];
    
    if (providedUser !== expectedUser || providedPass !== expectedPass) {
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

fastify.get('/api/tenant/me', async (req, reply) => {
  const session = await getTenantSession(req);
  if (!session || !session.tenantId) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
  try {
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
    return reply.send({
      ok: true,
      tenant: {
        id: tenantResolved.id,
        name: tenantResolved.name,
        legalName: tenantResolved.legalName,
        logoUrl: null,
        rut: tenantResolved.rut,
        email: tenantResolved.email,
        phone: tenantResolved.phone,
        status: tenantResolved.status,
        credits,
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
        select: { id: true, name: true, legalName: true, rut: true, email: true, phone: true, status: true }
      });
      if (!tenant) return reply.code(401).send({ ok: false, error: 'UNAUTHORIZED' });
      return reply.send({
        ok: true,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          legalName: tenant.legalName,
          logoUrl: null,
          rut: tenant.rut,
          email: tenant.email,
          phone: tenant.phone,
          status: tenant.status,
          credits: 0
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
      if (String(dbErr?.message || '').includes('logoUrl') || String(dbErr?.message || '').includes('does not exist')) {
        req.log.warn({ err: dbErr?.message }, 'logoUrl column missing, logo saved to storage only');
      } else {
        throw dbErr;
      }
    }
    return reply.send({ ok: true, logoUrl });
  } catch (err) {
    req.log.error(err, 'POST /api/tenant/logo');
    return reply.code(500).send({ ok: false, error: 'UPLOAD_FAILED' });
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
  return reply.send({ ok: true, user: { id: user.id, fullName: user.fullName, role: user.role }, token });
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

fastify.post('/api/cases/:caseId/approve', async (req, reply) => {
  const rawId = String(req.params.caseId || '');
  const c = await prisma.case.findFirst({
    where: { OR: [{ id: rawId }, { shortId: rawId }] },
    select: { id: true, shortId: true, contactEmail: true, contactName: true, reviewStatus: true, tenantId: true, tenant: { select: { name: true } } }
  });
  if (!c) return reply.code(404).send({ ok: false, error: 'CASE_NOT_FOUND' });

  await prisma.case.update({
    where: { id: c.id },
    data: { reviewStatus: 'approved', reviewedAt: new Date(), reviewerEmail: REVIEWER_EMAIL }
  });

  const shortId = c.shortId || c.id;
  const isStarter = c.tenant?.name === STARTER_TENANT_NAME;

  let emailSent = false;
  if (isStarter && c.contactEmail) {
    try {
      const tenantId = c.tenantId || undefined;
      const runtimeCfg = await getRuntimeScoreConfig();
      const summary = await getCaseSummary({
        prisma,
        storage,
        caseId: c.id,
        slotGroupTitleFromCode,
        scoreConfig: runtimeCfg.config,
        scoreConfigUpdatedAt: runtimeCfg.updatedAt,
        tenantId
      });
      const pdfBuffer = await generateReportPdf({ summary, storage, prisma, scoreConfig: runtimeCfg.config });

      const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0].trim();
      const host = (req.headers['x-forwarded-host'] || req.headers.host || 'ainspecciona.web.app').toString().split(',')[0].trim();
      const reportUrl = `${proto}://${host}/cases/${shortId}/report`;
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
      const certBuffer = await generateCertificateImage({ score, badge, shortId, reportUrl, qrDataUri });

      const result = await sendApprovedReportEmail(c.contactEmail, c.contactName || '', shortId, pdfBuffer, certBuffer);
      emailSent = !!result.ok;
      fastify.log.info({ caseId: c.id, shortId, contactEmail: c.contactEmail, emailSent }, 'approved-report-sent');
    } catch (err) {
      fastify.log.warn(err, 'approve-send-report');
    }
  }

  return reply.send({ ok: true, approved: true, emailSent, shortId });
});

fastify.listen({ port: PORT, host: '0.0.0.0' })
  .then(async () => {
    fastify.log.info({ port: PORT }, 'Server listening');
    prisma.$connect().then(() => fastify.log.info('DB connected')).catch((err) => fastify.log.warn(err, 'DB connect'));
    backfillCaseShortIds().catch((err) => fastify.log.warn(err, 'Backfill shortId'));
    ensureReviewColumns().catch((err) => fastify.log.warn(err, 'ensure-review-columns'));
    ensureSubscriptionColumns().catch((err) => fastify.log.warn(err, 'ensure-subscription-columns'));
    ensureTrialColumns().catch((err) => fastify.log.warn(err, 'ensure-trial-columns'));
    ensurePageViewTable().catch((err) => fastify.log.warn(err, 'ensure-pageview-table'));
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
