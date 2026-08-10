#!/usr/bin/env node
/**
 * Importa KPI.xlsx → data/taxonomy-catalog.json (entradas en borrador).
 *
 *   node scripts/import-kpi-to-taxonomy.mjs
 *   node scripts/import-kpi-to-taxonomy.mjs --replace   # reemplaza entradas previas de KPI.xlsx
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { emptyCatalog } from '../src/aintelligence/taxonomy/defaults.js';
import { mergeHallazgosIntoCatalog, parseKpiExcelRows } from '../src/aintelligence/taxonomy/kpiExcelImport.js';
import { KPI_XLSX_PUBLIC, resolveKpiXlsxPath } from '../src/aintelligence/taxonomy/kpiPaths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const XLSX_PATH = resolveKpiXlsxPath(ROOT);
const CATALOG_PATH = path.join(ROOT, 'data', 'taxonomy-catalog.json');
const replaceExisting = process.argv.includes('--replace');

function loadCatalog() {
  if (fs.existsSync(CATALOG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    } catch {
      /* seed */
    }
  }
  return emptyCatalog();
}

if (!fs.existsSync(XLSX_PATH)) {
  console.error(`No se encontró ${KPI_XLSX_PUBLIC}`);
  process.exit(1);
}

const wb = XLSX.readFile(XLSX_PATH);
const sheet = wb.Sheets['Hallazgos'] || wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
const hallazgos = parseKpiExcelRows(rows);
const { catalog, stats } = mergeHallazgosIntoCatalog(loadCatalog(), hallazgos, { replaceExisting });

catalog.updatedAt = new Date().toISOString();
fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');

console.log('Import KPI → taxonomía');
console.log('  Hallazgos parseados:', hallazgos.length);
console.log('  Creadas:', stats.created);
console.log('  Actualizadas:', stats.updated);
console.log('  Omitidas (aprobadas):', stats.skipped);
console.log('  Total entradas:', catalog.entries.length);
console.log('  Archivo:', CATALOG_PATH);
