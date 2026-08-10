import fs from 'node:fs';
import path from 'node:path';
import { Storage } from '@google-cloud/storage';
import { resolveKpi } from './kpiCatalog.js';
import { loadEntregaKpiCatalog, resolveKpiWithCatalog } from './taxonomyKpi.js';

/**
 * Store liviano para hallazgos capturados por el agente en Entrega.
 * Local: data/entrega-findings.json · Producción (GCS): entrega/entrega-findings.json
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const LOCAL_FILE = path.join(DATA_DIR, 'entrega-findings.json');
const GCS_KEY = 'entrega/entrega-findings.json';

const VALID_SEVERIDAD = new Set(['critica', 'intermedia', 'menor']);

let gcsBucket = null;

function useGcs() {
  return String(process.env.STORAGE_DRIVER || '').toLowerCase() === 'gcs' && !!process.env.GCS_BUCKET;
}

function getGcsBucket() {
  if (!gcsBucket) {
    gcsBucket = new Storage().bucket(String(process.env.GCS_BUCKET));
  }
  return gcsBucket;
}

function ensureLocalFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOCAL_FILE)) fs.writeFileSync(LOCAL_FILE, JSON.stringify({ units: {} }, null, 2), 'utf8');
}

function emptyStore() {
  return { units: {} };
}

async function readAll() {
  if (useGcs()) {
    try {
      const [buf] = await getGcsBucket().file(GCS_KEY).download();
      return JSON.parse(buf.toString('utf8'));
    } catch (err) {
      if (err && (err.code === 404 || err.code === 403)) return emptyStore();
      return emptyStore();
    }
  }
  ensureLocalFile();
  try {
    return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
  } catch {
    return emptyStore();
  }
}

async function writeAll(data) {
  const json = JSON.stringify(data, null, 2);
  if (useGcs()) {
    await getGcsBucket().file(GCS_KEY).save(json, {
      contentType: 'application/json',
      resumable: false
    });
    return;
  }
  ensureLocalFile();
  fs.writeFileSync(LOCAL_FILE, json, 'utf8');
}

function normalizeSeveridad(s) {
  const v = String(s || '').toLowerCase().trim();
  if (VALID_SEVERIDAD.has(v)) return v;
  if (v.startsWith('crit')) return 'critica';
  if (v.startsWith('inter')) return 'intermedia';
  return 'menor';
}

export async function listFindings(unitRef) {
  const all = await readAll();
  return (all.units && all.units[unitRef]) || [];
}

export async function addFinding(unitRef, input) {
  if (!unitRef) throw new Error('unitRef requerido');
  const all = await readAll();
  if (!all.units) all.units = {};
  if (!all.units[unitRef]) all.units[unitRef] = [];

  const especialidad = String(input.especialidad || 'Pintor').trim();
  const severidad = normalizeSeveridad(input.severidad);
  const catalog = await loadEntregaKpiCatalog();
  const kpi = resolveKpiWithCatalog(catalog, {
    kpi: input.kpi,
    especialidad,
    descripcion: input.descripcion
  }) || resolveKpi({ kpi: input.kpi, especialidad });

  const finding = {
    id: `H-${unitRef.split(':').pop()}-${Date.now().toString(36)}`,
    recinto: String(input.recinto || 'Sin recinto').trim(),
    descripcion: String(input.descripcion || '').trim(),
    kpi,
    especialidad,
    severidad,
    estado: 'abierto',
    apertura: new Date().toISOString().slice(0, 10),
    cierre: null,
    foto: false,
    fotoUrl: null,
    target: null,
    fotoResueltaUrl: null,
    targetResuelto: null,
    cerradoPor: null,
    cerradoAt: null,
    origen: 'agente'
  };

  all.units[unitRef].push(finding);
  await writeAll(all);
  return finding;
}

export async function attachPhoto(unitRef, findingId, data) {
  const all = await readAll();
  const list = (all.units && all.units[unitRef]) || [];
  const finding = list.find((f) => f.id === findingId);
  if (!finding) return null;
  finding.foto = true;
  if (data && data.fotoUrl) finding.fotoUrl = String(data.fotoUrl);
  if (data && data.target && Number.isFinite(Number(data.target.x)) && Number.isFinite(Number(data.target.y))) {
    finding.target = { x: Number(data.target.x), y: Number(data.target.y) };
  }
  await writeAll(all);
  return finding;
}

function getFindingList(all, unitRef) {
  return (all.units && all.units[unitRef]) || [];
}

export async function attachClosePhoto(unitRef, findingId, data) {
  const all = await readAll();
  const list = getFindingList(all, unitRef);
  const finding = list.find((f) => f.id === findingId);
  if (!finding || finding.estado === 'cerrado') return null;
  if (data && data.fotoResueltaUrl) finding.fotoResueltaUrl = String(data.fotoResueltaUrl);
  if (data && data.target && Number.isFinite(Number(data.target.x)) && Number.isFinite(Number(data.target.y))) {
    finding.targetResuelto = { x: Number(data.target.x), y: Number(data.target.y) };
  }
  await writeAll(all);
  return finding;
}

/** Cierra hallazgo tras foto de cierre y mira confirmada (solo si estaba abierto). */
export async function finalizeFindingClose(unitRef, findingId, data) {
  const all = await readAll();
  const list = getFindingList(all, unitRef);
  const finding = list.find((f) => f.id === findingId);
  if (!finding || finding.estado === 'cerrado') return null;
  if (!finding.fotoResueltaUrl) return null;
  if (data && data.target && Number.isFinite(Number(data.target.x)) && Number.isFinite(Number(data.target.y))) {
    finding.targetResuelto = { x: Number(data.target.x), y: Number(data.target.y) };
  }
  const now = new Date();
  finding.estado = 'cerrado';
  finding.cierre = now.toISOString().slice(0, 10);
  finding.cerradoAt = now.toISOString();
  finding.cerradoPor = String((data && data.cerradoPor) || 'Inspector ITO').trim();
  await writeAll(all);
  return finding;
}

export async function clearUnit(unitRef) {
  const all = await readAll();
  if (all.units && all.units[unitRef]) {
    delete all.units[unitRef];
    await writeAll(all);
  }
}

/** Renombra recinto en hallazgos de una unidad (p. ej. corrección post-captura). */
export async function renameFindingsRecinto(unitRef, fromRecinto, toRecinto) {
  const from = String(fromRecinto || '').trim();
  const to = String(toRecinto || '').trim();
  if (!unitRef || !from || !to) throw new Error('unitRef, fromRecinto y toRecinto requeridos');
  const all = await readAll();
  const list = getFindingList(all, unitRef);
  let updated = 0;
  list.forEach((f) => {
    if (String(f.recinto || '').trim() === from) {
      f.recinto = to;
      updated++;
    }
  });
  if (updated) await writeAll(all);
  return { updated, total: list.length };
}
