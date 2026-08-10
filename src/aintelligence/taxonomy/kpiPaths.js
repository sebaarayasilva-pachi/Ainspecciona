import fs from 'node:fs';
import path from 'node:path';

/** Fuente canónica del Excel KPI (Paulo) — public/KPI.xlsx */
export function resolveKpiXlsxPath(cwd = process.cwd()) {
  const candidates = [
    path.join(cwd, 'public', 'KPI.xlsx'),
    path.join(cwd, 'data', 'KPI.xlsx')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

export const KPI_XLSX_PUBLIC = 'public/KPI.xlsx';
