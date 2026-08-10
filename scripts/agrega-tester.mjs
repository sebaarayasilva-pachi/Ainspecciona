#!/usr/bin/env node
/**
 * Sincroniza ejecutivos de una corredora: ACTIVE + misma clave (hash por usuario).
 * Lee DATABASE_URL desde Secret Manager (gcloud) y la adapta a Cloud SQL Proxy en 127.0.0.1:3307.
 *
 * Requisitos: gcloud autenticado, proyecto ainspecciona, proxy escuchando en puerto 3307:
 *   .\cloud-sql-proxy.exe "ainspecciona:southamerica-west1:ainspecciona-mysql" --port 3307
 *
 * Uso:
 *   npm run agrega-tester
 *   node scripts/agrega-tester.mjs
 *   node scripts/agrega-tester.mjs --tenant "Corredora Testers" --password "123456"
 *   node scripts/agrega-tester.mjs --project ainspecciona
 *
 * Si gcloud falla pero tienes DATABASE_URL en el entorno, usa esa URL (sin forzar gcloud).
 */
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const activateScript = path.join(__dirname, 'activate-all-tenant-users.mjs');

function parseArgs() {
  const argv = process.argv.slice(2);
  let tenant = 'Corredora Testers';
  let password = '123456';
  let project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'ainspecciona';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--tenant' && argv[i + 1]) {
      tenant = argv[++i];
      continue;
    }
    if (a === '--password' && argv[i + 1]) {
      password = argv[++i];
      continue;
    }
    if (a === '--project' && argv[i + 1]) {
      project = argv[++i];
      continue;
    }
  }
  return { tenant, password, project };
}

function ensureProxyDatabaseUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return s;
  if (s.includes('127.0.0.1:3307') || s.includes('localhost:3307')) return s;
  return s.replace('@localhost/', '@127.0.0.1:3307/').replace(/\?socket=.*$/, '');
}

function resolveDatabaseUrl(project) {
  try {
    const out = execSync(
      `gcloud secrets versions access latest --secret=DATABASE_URL --project=${project}`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return { url: ensureProxyDatabaseUrl(out.trim()), source: 'gcloud' };
  } catch {
    const fromEnv = process.env.DATABASE_URL?.trim();
    if (fromEnv) {
      return { url: ensureProxyDatabaseUrl(fromEnv), source: 'env' };
    }
    console.error(
      'No se pudo leer DATABASE_URL: ejecutá `gcloud auth login` o definí DATABASE_URL en el entorno.'
    );
    process.exit(1);
  }
}

const cfg = parseArgs();
if (cfg.help) {
  console.log(`Uso: node scripts/agrega-tester.mjs [--tenant "Nombre"] [--password clave] [--project id]

Por defecto: tenant "Corredora Testers", password 123456, proyecto ainspecciona.

Antes: Cloud SQL Proxy en 127.0.0.1:3307 (misma instancia que usa el servidor en Cloud Run).`);
  process.exit(0);
}

const { url, source } = resolveDatabaseUrl(cfg.project);
if (source === 'env') {
  console.log('(Usando DATABASE_URL del entorno; gcloud secret no disponible o falló.)\n');
}

const result = spawnSync(process.execPath, [activateScript, cfg.tenant, cfg.password], {
  cwd: root,
  env: { ...process.env, DATABASE_URL: url },
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
