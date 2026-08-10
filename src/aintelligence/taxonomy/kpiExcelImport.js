/**
 * Importa hallazgos desde KPI.xlsx al catálogo de taxonomía (status: draft).
 */

import { KPI_XLSX_PUBLIC } from './kpiPaths.js';

const KPI_GROUP_MAP = {
  'CIELOS Y MUROS': {
    kpi: 'TERMINACIONES',
    aliasEntregaKpi: 'Terminaciones',
    aliasPostventa: 'pintura_muros_cielos',
    aliasAinspecciona: 'MUROS_PINTURA'
  },
  'PUERTAS Y VENTANAS': {
    kpi: null,
    aliasEntregaKpi: 'Terminaciones',
    aliasPostventa: null,
    aliasAinspecciona: null
  },
  PISOS: {
    kpi: 'PISOS',
    aliasEntregaKpi: 'Terminaciones',
    aliasPostventa: 'pisos',
    aliasAinspecciona: 'PISOS'
  },
  'INSTALACIONES ELECTRICAS': {
    kpi: 'ELECTRICIDAD',
    aliasEntregaKpi: 'Instalaciones Eléctricas',
    aliasPostventa: 'electricidad_visible',
    aliasAinspecciona: 'ELECTRICIDAD'
  },
  'INSTALACIONES SANITARIAS': {
    kpi: 'SANITARIOS',
    aliasEntregaKpi: 'Instalaciones Sanitarias',
    aliasPostventa: 'sanitarios',
    aliasAinspecciona: 'SANITARIOS'
  },
  'ELEMENTOS ESTRUCTURALES': {
    kpi: 'ESTRUCTURA',
    aliasEntregaKpi: 'Estructura Visible',
    aliasPostventa: 'otros',
    aliasAinspecciona: ''
  }
};

const ITEM_KPI_OVERRIDE = {
  PUERTA: 'PUERTAS_HERRAJES',
  VENTANAS: 'VENTANAS_CERRAMIENTOS'
};

const ITEM_POSTVENTA = {
  PUERTA: 'puertas_cerraduras',
  VENTANAS: 'ventanas_sellos'
};

const ITEM_AINSPECTA = {
  PUERTA: 'PUERTAS_HERRAJES',
  VENTANAS: 'VENTANAS_CERRAMIENTOS'
};

export function slugify(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72);
}

function cellStr(v) {
  if (v == null || (typeof v === 'number' && Number.isNaN(v))) return '';
  return String(v).trim();
}

function flag(v) {
  return cellStr(v).toLowerCase() === 'x';
}

function parseEspecialidades(raw) {
  return cellStr(raw)
    .split(/[,;/|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function garantiaAnios(g3, g5, g10) {
  const years = [];
  if (g3) years.push(3);
  if (g5) years.push(5);
  if (g10) years.push(10);
  return years;
}

function miradasFromProducto({ entrega, postventa, propertychk, ainspecciona }) {
  const miradas = [];
  if (entrega || postventa) miradas.push('EJECUCION_OBRA');
  if (propertychk || ainspecciona) miradas.push('DETERIORO_USO');
  return miradas.length ? miradas : ['EJECUCION_OBRA'];
}

function resolveKpi(kpiGroup, item) {
  const group = KPI_GROUP_MAP[kpiGroup] || KPI_GROUP_MAP['CIELOS Y MUROS'];
  const itemKey = cellStr(item).toUpperCase();
  if (group.kpi === null) {
    return ITEM_KPI_OVERRIDE[itemKey] || 'TERMINACIONES';
  }
  return group.kpi;
}

function resolveAliases(kpiGroup, item, especialidades) {
  const group = KPI_GROUP_MAP[kpiGroup] || {};
  const itemKey = cellStr(item).toUpperCase();
  let aliasPostventa = group.aliasPostventa || '';
  let aliasAinspecciona = group.aliasAinspecciona || '';
  if (kpiGroup === 'PUERTAS Y VENTANAS') {
    aliasPostventa = ITEM_POSTVENTA[itemKey] || 'puertas_cerraduras';
    aliasAinspecciona = ITEM_AINSPECTA[itemKey] || 'PUERTAS_HERRAJES';
  }
  return {
    aliasEntregaKpi: group.aliasEntregaKpi || '',
    aliasPostventa,
    aliasAinspecciona,
    aliasEntregaEspecialidades: especialidades.join(', ')
  };
}

/**
 * @param {unknown[][]} rows hoja Hallazgos sin header procesado
 */
export function parseKpiExcelRows(rows) {
  const hallazgos = [];
  let currentKpiGroup = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const colKpi = cellStr(r[1]);
    const colItem = cellStr(r[2]);
    const hallazgo = cellStr(r[3]);

    if (colKpi && colKpi !== 'KPI') {
      currentKpiGroup = colKpi;
    }
    if (!hallazgo || !currentKpiGroup) continue;
    if (colItem.toUpperCase() === 'ZONA') continue;

    const especialidades = parseEspecialidades(r[5]);
    const miradasProducto = {
      entrega: flag(r[11]),
      postventa: flag(r[12]),
      propertychk: flag(r[13]),
      ainspecciona: flag(r[14])
    };

    hallazgos.push({
      kpiGroup: currentKpiGroup,
      item: colItem,
      hallazgo,
      requerimiento: cellStr(r[4]),
      especialidades,
      causa: cellStr(r[6]),
      criticidad: cellStr(r[7]) || 'Media',
      garantiaAnios: garantiaAnios(flag(r[8]), flag(r[9]), flag(r[10])),
      miradasProducto
    });
  }

  return hallazgos;
}

/**
 * @param {ReturnType<import('./defaults.js').emptyCatalog>} catalog
 * @param {ReturnType<parseKpiExcelRows>} hallazgos
 * @param {{ replaceExisting?: boolean }} [opts]
 */
export function mergeHallazgosIntoCatalog(catalog, hallazgos, opts = {}) {
  const replaceExisting = opts.replaceExisting === true;
  const entries = [...(catalog.entries || [])];
  const existingById = new Map(entries.map((e) => [e.id, e]));

  if (replaceExisting) {
    const keep = entries.filter((e) => e.source !== 'KPI.xlsx');
    entries.length = 0;
    entries.push(...keep);
    for (const e of entries) existingById.set(e.id, e);
    for (const id of [...existingById.keys()]) {
      if (!entries.find((x) => x.id === id)) existingById.delete(id);
    }
  }

  const stats = { created: 0, updated: 0, skipped: 0 };

  for (const h of hallazgos) {
    const kpi = resolveKpi(h.kpiGroup, h.item);
    const subfamilia = slugify(`${h.item}_${h.hallazgo}`) || slugify(h.hallazgo);
    const id = `kpi_excel.${slugify(h.kpiGroup)}.${subfamilia}`;
    const aliases = resolveAliases(h.kpiGroup, h.item, h.especialidades);

    const entry = {
      id,
      kpi,
      subfamilia,
      label: h.hallazgo,
      miradas: miradasFromProducto(h.miradasProducto),
      ...aliases,
      notasEjecucion: [h.causa, h.requerimiento].filter(Boolean).join(' · '),
      notasDeterioro: '',
      status: 'draft',
      source: 'KPI.xlsx',
      kpiGroup: h.kpiGroup,
      item: h.item,
      hallazgo: h.hallazgo,
      requerimiento: h.requerimiento,
      especialidades: h.especialidades,
      causa: h.causa,
      criticidad: h.criticidad,
      garantiaAnios: h.garantiaAnios,
      miradasProducto: h.miradasProducto
    };

    if (existingById.has(id)) {
      const prev = existingById.get(id);
      if (prev.status === 'approved' && !replaceExisting) {
        stats.skipped++;
        continue;
      }
      const idx = entries.findIndex((e) => e.id === id);
      entries[idx] = { ...prev, ...entry, status: prev.status === 'approved' ? 'approved' : 'draft' };
      stats.updated++;
    } else {
      entries.push(entry);
      existingById.set(id, entry);
      stats.created++;
    }
  }

  const kpiGroups = [...new Set(hallazgos.map((h) => h.kpiGroup))].sort();

  return {
    catalog: {
      ...catalog,
      version: Math.max(Number(catalog.version) || 1, 2),
      sourceKpiFile: KPI_XLSX_PUBLIC,
      kpiGroups: kpiGroups.map((label) => ({
        label,
        kpiCanonical: resolveKpi(label, ''),
        ...(KPI_GROUP_MAP[label] || {})
      })),
      entries
    },
    stats
  };
}
