import { listTaxonomyEntries } from '../aintelligence/taxonomy/store.js';
import {
  DEFAULT_KPI,
  ENTREGA_KPIS,
  getPublicKpiCatalog as getStaticKpiCatalog,
  normalizeKpiName as normalizeStaticKpiName
} from './kpiCatalog.js';

let cached = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

function parseEspList(raw) {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  return String(raw || '')
    .split(/[,;/|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isEntregaEntry(entry) {
  if (!entry) return false;
  if (entry.miradasProducto?.entrega === true) return true;
  return (entry.miradas || []).includes('EJECUCION_OBRA') && !!String(entry.aliasEntregaKpi || '').trim();
}

function buildFromEntries(sourceEntries) {
  const catalogoSets = {};
  const especialidadToKpi = {};
  const kpiLookup = {};
  const kpisSet = new Set();

  for (const entry of sourceEntries) {
    const kpi = String(entry.aliasEntregaKpi || '').trim();
    if (!kpi) continue;
    kpisSet.add(kpi);
    kpiLookup[kpi.toLowerCase()] = kpi;
    if (!catalogoSets[kpi]) catalogoSets[kpi] = new Set();
    for (const esp of [...parseEspList(entry.especialidades), ...parseEspList(entry.aliasEntregaEspecialidades)]) {
      catalogoSets[kpi].add(esp);
      especialidadToKpi[esp] = kpi;
      especialidadToKpi[esp.toLowerCase()] = kpi;
    }
  }

  const kpis = [
    ...ENTREGA_KPIS.filter((k) => kpisSet.has(k)),
    ...[...kpisSet].filter((k) => !ENTREGA_KPIS.includes(k)).sort((a, b) => a.localeCompare(b, 'es'))
  ];

  const catalogoEspecialidades = {};
  kpis.forEach((k) => {
    catalogoEspecialidades[k] = [...(catalogoSets[k] || [])].sort((a, b) => a.localeCompare(b, 'es'));
  });

  const hallazgos = sourceEntries
    .filter((e) => e.hallazgo || e.label)
    .map((e) => ({
      id: e.id,
      label: e.label || e.hallazgo,
      hallazgo: e.hallazgo || e.label,
      kpi: e.aliasEntregaKpi,
      kpiGroup: e.kpiGroup || null,
      item: e.item || null,
      especialidades: parseEspList(e.especialidades).length
        ? parseEspList(e.especialidades)
        : parseEspList(e.aliasEntregaEspecialidades),
      status: e.status
    }));

  return {
    kpis,
    catalogoEspecialidades,
    especialidadToKpi,
    kpiLookup,
    hallazgos
  };
}

export async function loadEntregaKpiCatalog({ force = false } = {}) {
  const now = Date.now();
  if (!force && cached && now - cachedAt < CACHE_MS) return cached;

  const { entries } = await listTaxonomyEntries({});
  const entregaEntries = entries.filter(isEntregaEntry);
  const approved = entregaEntries.filter((e) => e.status === 'approved');

  if (!approved.length) {
    const staticCatalog = getStaticKpiCatalog();
    cached = {
      ok: true,
      ...staticCatalog,
      especialidadToKpi: Object.entries(staticCatalog.catalogoEspecialidades).reduce((acc, [kpi, list]) => {
        list.forEach((esp) => {
          acc[esp] = kpi;
          acc[esp.toLowerCase()] = kpi;
        });
        return acc;
      }, {}),
      kpiLookup: ENTREGA_KPIS.reduce((acc, k) => {
        acc[k.toLowerCase()] = k;
        return acc;
      }, {}),
      hallazgos: [],
      source: 'static',
      taxonomyTotal: entregaEntries.length,
      approvedCount: 0,
      message: entregaEntries.length
        ? 'Sin hallazgos aprobados en taxonomía; usando catálogo estático hasta que apruebes entradas en Admin.'
        : null
    };
    cachedAt = now;
    return cached;
  }

  const built = buildFromEntries(approved);
  cached = {
    ok: true,
    ...built,
    source: 'taxonomy',
    taxonomyTotal: entregaEntries.length,
    approvedCount: approved.length,
    message: null
  };
  cachedAt = now;
  return cached;
}

export function resolveKpiWithCatalog(catalog, { kpi, especialidad, descripcion } = {}) {
  const kpis = catalog?.kpis || ENTREGA_KPIS;
  const lookup = catalog?.kpiLookup || {};
  const espMap = catalog?.especialidadToKpi || {};

  const rawKpi = String(kpi || '').trim();
  if (rawKpi) {
    const normalized = lookup[rawKpi.toLowerCase()] || normalizeStaticKpiName(rawKpi);
    if (normalized && kpis.includes(normalized)) return normalized;
  }

  const esp = String(especialidad || '').trim();
  if (esp && espMap[esp]) return espMap[esp];
  if (esp && espMap[esp.toLowerCase()]) return espMap[esp.toLowerCase()];

  const desc = String(descripcion || '').trim().toLowerCase();
  if (desc && Array.isArray(catalog?.hallazgos)) {
    const hit = catalog.hallazgos.find((h) => {
      const text = String(h.hallazgo || h.label || '').toLowerCase();
      return text && (desc.includes(text) || text.includes(desc));
    });
    if (hit?.kpi && kpis.includes(hit.kpi)) return hit.kpi;
  }

  return DEFAULT_KPI;
}

export function invalidateEntregaKpiCache() {
  cached = null;
  cachedAt = 0;
}
