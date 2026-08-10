#!/usr/bin/env node
/**
 * Renombra recinto en hallazgos capturados (local o GCS según STORAGE_DRIVER).
 *
 * Uso:
 *   node scripts/rename-entrega-recinto.mjs cuvee-2:301 INE Pasillo
 *
 * Producción:
 *   $env:STORAGE_DRIVER="gcs"; $env:GCS_BUCKET="ainspecciona-photos-852721861524"
 *   node scripts/rename-entrega-recinto.mjs cuvee-2:301 INE Pasillo
 */

import 'dotenv/config';
import { renameFindingsRecinto } from '../src/entrega/store.js';

const unitRef = process.argv[2] || 'cuvee-2:301';
const fromRec = process.argv[3] || 'INE';
const toRec = process.argv[4] || 'Pasillo';

const result = await renameFindingsRecinto(unitRef, fromRec, toRec);
console.log(JSON.stringify({ ok: true, unitRef, fromRec, toRec, ...result }, null, 2));
