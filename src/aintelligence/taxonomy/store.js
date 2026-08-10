import fs from 'node:fs';
import path from 'node:path';
import { Storage } from '@google-cloud/storage';
import XLSX from 'xlsx';
import { emptyCatalog } from './defaults.js';
import { mergeHallazgosIntoCatalog, parseKpiExcelRows } from './kpiExcelImport.js';
import { KPI_XLSX_PUBLIC, resolveKpiXlsxPath } from './kpiPaths.js';
const DATA_DIR = path.join(process.cwd(), 'data');
const LOCAL_FILE = path.join(DATA_DIR, 'taxonomy-catalog.json');
const GCS_KEY = 'aintelligence/taxonomy-catalog.json';

let gcsBucket = null;

function useGcs() {
  return String(process.env.STORAGE_DRIVER || '').toLowerCase() === 'gcs' && !!process.env.GCS_BUCKET;
}

function getGcsBucket() {
  if (!gcsBucket) gcsBucket = new Storage().bucket(String(process.env.GCS_BUCKET));
  return gcsBucket;
}

function ensureLocalFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOCAL_FILE)) {
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(emptyCatalog(), null, 2), 'utf8');
  }
}

async function readCatalog() {
  if (useGcs()) {
    try {
      const [buf] = await getGcsBucket().file(GCS_KEY).download();
      const raw = JSON.parse(buf.toString('utf8'));
      if (raw && Array.isArray(raw.entries)) {
        if (raw.entries.length === 0) {
          const seeded = emptyCatalog();
          await writeCatalog(seeded);
          return seeded;
        }
        return raw;
      }
    } catch {
      /* fallback local / seed */
    }
  }
  ensureLocalFile();
  try {
    const raw = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
    if (raw && Array.isArray(raw.entries)) {
      if (raw.entries.length === 0) {
        const seeded = emptyCatalog();
        await writeCatalog(seeded);
        return seeded;
      }
      return raw;
    }
  } catch {
    /* seed */
  }
  const seeded = emptyCatalog();
  await writeCatalog(seeded);
  return seeded;
}

async function writeCatalog(data) {
  data.updatedAt = new Date().toISOString();
  const json = JSON.stringify(data, null, 2);
  if (useGcs()) {
    await getGcsBucket().file(GCS_KEY).save(json, {
      contentType: 'application/json',
      resumable: false
    });
  }
  ensureLocalFile();
  fs.writeFileSync(LOCAL_FILE, json, 'utf8');
}

function slugify(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeEntry(input, existingId) {
  const kpi = String(input.kpi || '').trim().toUpperCase();
  const subfamilia = slugify(input.subfamilia);
  if (!kpi || !subfamilia) throw new Error('KPI y subfamilia son obligatorios');

  const id = String(input.id || existingId || `${kpi.toLowerCase()}.${subfamilia}`).trim();
  const miradas = Array.isArray(input.miradas)
    ? input.miradas.map((m) => String(m).trim()).filter(Boolean)
    : String(input.miradas || '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);

  const base = {
    id,
    kpi,
    subfamilia,
    label: String(input.label || subfamilia.replace(/_/g, ' ')).trim(),
    miradas: miradas.length ? miradas : ['EJECUCION_OBRA'],
    aliasAinspecciona: String(input.aliasAinspecciona || '').trim(),
    aliasPostventa: String(input.aliasPostventa || '').trim(),
    aliasEntregaKpi: String(input.aliasEntregaKpi || '').trim(),
    aliasEntregaEspecialidades: String(input.aliasEntregaEspecialidades || '').trim(),
    notasEjecucion: String(input.notasEjecucion || '').trim(),
    notasDeterioro: String(input.notasDeterioro || '').trim(),
    status: ['draft', 'approved'].includes(String(input.status || '').trim()) ? String(input.status).trim() : 'draft'
  };

  for (const key of [
    'source',
    'kpiGroup',
    'item',
    'hallazgo',
    'requerimiento',
    'causa',
    'criticidad',
    'especialidades',
    'garantiaAnios',
    'miradasProducto'
  ]) {
    if (input[key] !== undefined && input[key] !== null) {
      base[key] = input[key];
    }
  }

  return base;
}

export async function getTaxonomyCatalog() {
  return readCatalog();
}

export async function listTaxonomyEntries(filters = {}) {
  const catalog = await readCatalog();
  let entries = catalog.entries || [];
  const kpi = filters.kpi ? String(filters.kpi).toUpperCase() : '';
  const mirada = filters.mirada ? String(filters.mirada).trim() : '';
  const status = filters.status ? String(filters.status).trim() : '';
  if (kpi) entries = entries.filter((e) => e.kpi === kpi);
  if (mirada) entries = entries.filter((e) => (e.miradas || []).includes(mirada));
  if (status) entries = entries.filter((e) => e.status === status);
  return { catalog, entries };
}

export async function getTaxonomyEntry(id) {
  const catalog = await readCatalog();
  const entry = (catalog.entries || []).find((e) => e.id === id);
  return entry ? { catalog, entry } : null;
}

export async function createTaxonomyEntry(input) {
  const catalog = await readCatalog();
  const entry = normalizeEntry(input);
  if ((catalog.entries || []).some((e) => e.id === entry.id)) {
    throw new Error('Ya existe una entrada con ese id');
  }
  catalog.entries = catalog.entries || [];
  catalog.entries.push(entry);
  await writeCatalog(catalog);
  return entry;
}

export async function updateTaxonomyEntry(id, input) {
  const catalog = await readCatalog();
  const idx = (catalog.entries || []).findIndex((e) => e.id === id);
  if (idx < 0) throw new Error('Entrada no encontrada');
  const next = normalizeEntry({ ...catalog.entries[idx], ...input, id: input.id || id }, id);
  if (next.id !== id && (catalog.entries || []).some((e) => e.id === next.id)) {
    throw new Error('Ya existe otra entrada con ese id');
  }
  catalog.entries[idx] = next;
  await writeCatalog(catalog);
  return next;
}

export async function deleteTaxonomyEntry(id) {
  const catalog = await readCatalog();
  const before = catalog.entries?.length || 0;
  catalog.entries = (catalog.entries || []).filter((e) => e.id !== id);
  if (catalog.entries.length === before) throw new Error('Entrada no encontrada');
  await writeCatalog(catalog);
  return true;
}

export async function replaceCatalog(catalog) {
  const next = {
    ...emptyCatalog(),
    ...catalog,
    entries: Array.isArray(catalog?.entries) ? catalog.entries : []
  };
  await writeCatalog(next);
  return next;
}

function isEntregaTaxonomyEntry(entry) {
  if (!entry) return false;
  if (entry.miradasProducto?.entrega === true) return true;
  return (entry.miradas || []).includes('EJECUCION_OBRA') && !!String(entry.aliasEntregaKpi || '').trim();
}

/**
 * Aprueba en lote entradas de taxonomía (solo borradores).
 * @param {{ source?: string, entregaOnly?: boolean, ids?: string[] }} filters
 */
export async function approveTaxonomyEntriesBatch(filters = {}) {
  const catalog = await readCatalog();
  const entries = catalog.entries || [];
  const source = filters.source ? String(filters.source).trim() : '';
  const entregaOnly = filters.entregaOnly === true;
  const idSet = Array.isArray(filters.ids) && filters.ids.length ? new Set(filters.ids.map(String)) : null;

  let matched = 0;
  let approved = 0;
  let alreadyApproved = 0;

  for (const entry of entries) {
    if (entry.status === 'approved') {
      if (source && entry.source === source) alreadyApproved++;
      continue;
    }
    if (source && entry.source !== source) continue;
    if (entregaOnly && !isEntregaTaxonomyEntry(entry)) continue;
    if (idSet && !idSet.has(entry.id)) continue;
    matched++;
    entry.status = 'approved';
    approved++;
  }

  if (approved > 0) await writeCatalog(catalog);

  return {
    matched,
    approved,
    alreadyApproved,
    total: entries.length,
    entregaOnly,
    source: source || null
  };
}

const KPI_XLSX_PATH = resolveKpiXlsxPath();

export async function importKpiExcelToTaxonomy(options = {}) {
  if (!fs.existsSync(KPI_XLSX_PATH)) {
    throw new Error(`No se encontró ${KPI_XLSX_PUBLIC} (ni data/KPI.xlsx) en el servidor.`);
  }
  const wb = XLSX.readFile(KPI_XLSX_PATH);
  const sheet = wb.Sheets.Hallazgos || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const hallazgos = parseKpiExcelRows(rows);
  const catalog = await readCatalog();
  const { catalog: merged, stats } = mergeHallazgosIntoCatalog(catalog, hallazgos, {
    replaceExisting: options.replaceExisting === true
  });
  await writeCatalog(merged);
  return { catalog: merged, stats, hallazgosParsed: hallazgos.length };
}
