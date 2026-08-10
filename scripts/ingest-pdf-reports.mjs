/**
 * Ingesta de informes de entrega (PDFs Paulo) a la KB unificada como fuente ENTREGA.
 *
 * Mirada: defectos de fabricación/terminaciones en obra nueva al momento de la entrega.
 * Este conocimiento se inyecta SOLO en el análisis Postventa (junto a POSTVENTA);
 * nunca en Ainspecciona/Property-chk (deterioro en el tiempo, otra mirada).
 *
 * Pipeline por PDF:
 *   1. pdf-parse → texto plano.
 *   2. Parser determinista de bloques `ÍTEM:` (PISO/RECINTO/LUGAR/ELEMENTO/FALLA/DETALLE/TIPO)
 *      + Observaciones Generales y Conclusión.
 *   3. Una llamada LLM por informe (gpt-4o-mini, JSON schema) para enriquecer cada ítem:
 *      severidad, KPI, detección de verificaciones OK (→ anti-ejemplo) y transferibilidad:
 *        - defecto_latente  → category postventa asignada → el análisis postventa SÍ lo recupera.
 *        - snapshot_entrega → category null → el filtro por categoría lo excluye de postventa.
 *   4. Carga idempotente vía createKnowledgeEntry (dedup por fingerprint, embedding automático).
 *
 * Uso:
 *   node scripts/ingest-pdf-reports.mjs [rutas pdf o carpetas] [--dry-run] [--status=approved|candidate]
 *   Sin rutas: procesa kb-import/new-property/.
 *   --dry-run: parsea y enriquece pero NO escribe en la base (imprime lo que cargaría).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { PDFParse } from 'pdf-parse';

dotenv.config();

const DEFAULT_DIR = path.resolve(process.cwd(), 'kb-import', 'new-property');
const SOURCE = 'ENTREGA';
const CREATED_BY = 'paulo:import-pdf';

const POSTVENTA_CATEGORIES = [
  'humedad_filtracion',
  'pintura_muros_cielos',
  'pisos',
  'puertas_cerraduras',
  'ventanas_sellos',
  'sanitarios',
  'electricidad_visible',
  'muebles_closets_cocina',
  'ductos_canalizaciones',
  'impermeabilizacion',
  'espacios_comunes',
  'otros'
];

const KPI_KEYS = [
  'MUROS_PINTURA',
  'HUMEDAD',
  'PISOS',
  'SANITARIOS',
  'ELECTRICIDAD',
  'VENTANAS_CERRAMIENTOS',
  'PUERTAS_HERRAJES',
  'MOBILIARIO_FIJO',
  'DOCUMENTOS_CUMPLIMIENTO'
];

// ── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const statusArg = (args.find((a) => a.startsWith('--status=')) || '').split('=')[1];
const entryStatus = statusArg === 'candidate' ? 'candidate' : 'approved';
const inputPaths = args.filter((a) => !a.startsWith('--'));

function collectPdfs(paths) {
  const targets = paths.length ? paths : [DEFAULT_DIR];
  const pdfs = [];
  for (const p of targets) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) {
      console.warn(`⚠ No existe: ${abs}`);
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const f of fs.readdirSync(abs)) {
        if (f.toLowerCase().endsWith('.pdf')) pdfs.push(path.join(abs, f));
      }
    } else if (abs.toLowerCase().endsWith('.pdf')) {
      pdfs.push(abs);
    }
  }
  return pdfs;
}

// ── Extracción y parser determinista ──────────────────────────────────────
async function extractText(pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const res = await parser.getText();
    return res.text || '';
  } finally {
    await parser.destroy?.();
  }
}

const ITEM_FIELDS = ['PISO', 'RECINTO', 'LUGAR', 'ELEMENTO', 'FALLA', 'DETALLE', 'TIPO'];

function parseReport(text, fileName) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  const meta = { fileName, reportNumber: null, date: null, address: null, comuna: null };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const numMatch = l.match(/INFORME T[EÉ]CNICO\s+N\.?[º°o]?\s*(\d+)/i);
    if (numMatch) {
      meta.reportNumber = numMatch[1];
      if (lines[i + 1] && /\d{1,2}\/\w+\/\d{4}/.test(lines[i + 1])) meta.date = lines[i + 1];
    }
    if (/^DIRECCI[OÓ]N$/i.test(l) && lines[i + 1]) meta.address = lines[i + 1];
    if (/^COMUNA$/i.test(l) && lines[i + 1]) meta.comuna = lines[i + 1];
  }

  // Bloques ÍTEM: campo en una línea, valor en la(s) siguiente(s) o misma línea tras ':'.
  const items = [];
  let current = null;
  let currentField = null;
  for (const raw of lines) {
    const itemStart = raw.match(/^[IÍ]TEM:\s*(\d+)/i);
    if (itemStart) {
      if (current) items.push(current);
      current = { item: Number(itemStart[1]) };
      currentField = null;
      continue;
    }
    if (!current) continue;
    if (/^FOTOS:?\s*$/i.test(raw) || /^--\s*\d+\s+of\s+\d+\s*--$/i.test(raw)) {
      currentField = null;
      continue;
    }
    const fieldMatch = raw.match(/^([A-ZÁÉÍÓÚÑ]+):\s*(.*)$/);
    if (fieldMatch && ITEM_FIELDS.includes(fieldMatch[1])) {
      currentField = fieldMatch[1];
      current[currentField] = fieldMatch[2].trim();
      continue;
    }
    // Continuación multilínea del campo anterior (típicamente DETALLE).
    if (currentField && raw) {
      current[currentField] = `${current[currentField]} ${raw}`.trim();
    }
  }
  if (current) items.push(current);

  // Observaciones generales + conclusión (texto entre los encabezados conocidos).
  const fullText = lines.join('\n');
  const general = sliceBetween(fullText, /OBSERVACIONES GENERALES/i, /Conclusi[oó]n General/i);
  const conclusion = sliceBetween(fullText, /Conclusi[oó]n General/i, /(--\s*\d+\s+of|DETALLE DE OBSERVACIONES)/i);

  return { meta, items, general: cleanBlock(general), conclusion: cleanBlock(conclusion) };
}

function sliceBetween(text, startRe, endRe) {
  const start = text.search(startRe);
  if (start < 0) return '';
  const afterStart = text.slice(start).replace(startRe, '');
  const end = afterStart.search(endRe);
  return end >= 0 ? afterStart.slice(0, end) : afterStart;
}

function cleanBlock(s) {
  return String(s || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^--\s*\d+\s+of/.test(l))
    .join(' ')
    .trim();
}

/** Tipo de origen Paulo → ¿es falla de fabricación? Tipo 3 (uso) y 5 (desgaste) no lo son. */
function tipoInfo(tipoRaw) {
  const m = String(tipoRaw || '').match(/Tipo\s*(\d)/i);
  const n = m ? Number(m[1]) : null;
  return {
    tipo: n,
    label: String(tipoRaw || '').replace(/^Tipo\s*\d:\s*/i, '').replace(/\.$/, '').trim() || null,
    esFabricacion: n === null ? true : ![3, 5].includes(n)
  };
}

// ── Enriquecimiento LLM (una llamada por informe) ──────────────────────────
const ENRICH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          item: { type: 'integer' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          kpi: { type: 'string', enum: KPI_KEYS },
          is_ok_verification: { type: 'boolean' },
          transferability: { type: 'string', enum: ['defecto_latente', 'snapshot_entrega'] },
          postventa_category: { type: 'string', enum: [...POSTVENTA_CATEGORIES, ''] }
        },
        required: ['item', 'severity', 'kpi', 'is_ok_verification', 'transferability', 'postventa_category']
      }
    }
  },
  required: ['items']
};

async function enrichItems(client, items, meta) {
  const list = items
    .map((it) => `ÍTEM ${it.item}: recinto=${it.RECINTO || '—'} | lugar=${it.LUGAR || '—'} | elemento=${it.ELEMENTO || '—'} | falla=${it.FALLA || '—'} | detalle=${it.DETALLE || '—'}`)
    .join('\n');

  const prompt = [
    'Eres un perito técnico de construcción chileno. Clasifica los hallazgos de un informe de ENTREGA de departamento nuevo.',
    `Informe: ${meta.fileName} (${meta.address || 's/dirección'}).`,
    '',
    'Para cada ítem entrega:',
    `- severity: low | medium | high (gravedad técnica del defecto).`,
    `- kpi: uno de ${KPI_KEYS.join(', ')}.`,
    '- is_ok_verification: true si el detalle describe una VERIFICACIÓN SIN HALLAZGO (ej. "se verifica correcta instalación", "no encontrando observaciones", "en buen estado").',
    '- transferability:',
    '  · defecto_latente: defecto que puede manifestarse meses después de la entrega (adherencia de pisos/revestimientos, fisuras, filtraciones, sellos faltantes, instalaciones mal ejecutadas, desagües obstruidos).',
    '  · snapshot_entrega: solo relevante al momento de la entrega (suciedad, manchas, rayados, elementos sueltos o desajustados, terminaciones estéticas).',
    '- postventa_category: si transferability=defecto_latente, la categoría postventa que corresponda; si snapshot_entrega, cadena vacía.',
    `  Categorías: ${POSTVENTA_CATEGORIES.join(', ')}.`,
    '',
    'ÍTEMS:',
    list,
    '',
    'Responde en JSON según el schema.'
  ].join('\n');

  const response = await client.responses.create({
    model: process.env.OPENAI_KB_ENRICH_MODEL || 'gpt-4o-mini',
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
    text: {
      format: { type: 'json_schema', name: 'entrega_enrichment', strict: true, schema: ENRICH_SCHEMA }
    },
    temperature: 0
  });

  const parsed = JSON.parse(response.output_text || '{}');
  const byItem = new Map();
  for (const e of parsed.items || []) byItem.set(Number(e.item), e);
  return byItem;
}

// ── Construcción de entradas KB ────────────────────────────────────────────
function buildItemEntry(it, enrich, meta) {
  const tipo = tipoInfo(it.TIPO);
  const recinto = it.RECINTO || '—';
  const lugar = it.LUGAR || '—';
  const elemento = it.ELEMENTO || '—';
  const where = `[Entrega · ${recinto} · ${lugar} · ${elemento}]`;
  const okVerification = enrich?.is_ok_verification === true;
  const latente = enrich?.transferability === 'defecto_latente';

  let entryType;
  let text;
  let severity;

  if (okVerification) {
    entryType = 'anti_example';
    severity = 'none';
    text = `${where} Verificación SIN hallazgo en entrega de obra nueva: ${it.DETALLE || it.FALLA || ''}. No clasificar este patrón como falla.`;
  } else if (!tipo.esFabricacion) {
    // Tipo 3 (uso inadecuado) / Tipo 5 (desgaste natural): no es falla de fabricación → anti-ejemplo para postventa.
    entryType = 'anti_example';
    severity = 'none';
    text = `${where} Observación clasificada como ${tipo.label || 'uso/desgaste'} (NO es falla de fabricación, no cubierta por garantía): ${it.FALLA || ''} — ${it.DETALLE || ''}. Detectado en entrega de obra nueva.`;
  } else {
    entryType = 'finding_example';
    severity = enrich?.severity || 'medium';
    text = `${where} Falla: ${it.FALLA || '—'} — ${it.DETALLE || '—'} (detectado en entrega de obra nueva; origen: ${tipo.label || 'fabricación'}).`;
  }

  return {
    source: SOURCE,
    entryType,
    text,
    kpiKey: enrich?.kpi || null,
    // Salvaguarda: solo defectos latentes llevan categoría postventa (los snapshot quedan
    // fuera del retrieval de postventa al filtrar por categoría).
    category: !okVerification && tipo.esFabricacion && latente ? enrich?.postventa_category || null : null,
    severity,
    payload: {
      report: meta,
      item: it.item,
      piso: it.PISO || null,
      recinto,
      lugar,
      elemento,
      falla: it.FALLA || null,
      detalle: it.DETALLE || null,
      tipo: it.TIPO || null,
      transferability: okVerification ? null : enrich?.transferability || null
    },
    sourceRef: `pdf:${meta.fileName}#item:${it.item}`,
    createdBy: CREATED_BY,
    status: entryStatus
  };
}

function buildGeneralEntries(report) {
  const { meta, general, conclusion } = report;
  const entries = [];
  if (general) {
    entries.push({
      source: SOURCE,
      entryType: 'finding_example',
      text: `[Entrega · Observaciones generales] ${general} (resumen de inspección de entrega de obra nueva: ${meta.address || meta.fileName}).`.slice(0, 4000),
      kpiKey: null,
      category: null,
      severity: 'high',
      payload: { report: meta, section: 'observaciones_generales' },
      sourceRef: `pdf:${meta.fileName}#general`,
      createdBy: CREATED_BY,
      status: entryStatus
    });
  }
  if (conclusion) {
    entries.push({
      source: SOURCE,
      entryType: 'finding_example',
      text: `[Entrega · Conclusión] ${conclusion} (conclusión de inspección de entrega de obra nueva: ${meta.address || meta.fileName}).`.slice(0, 4000),
      kpiKey: null,
      category: null,
      severity: 'high',
      payload: { report: meta, section: 'conclusion' },
      sourceRef: `pdf:${meta.fileName}#conclusion`,
      createdBy: CREATED_BY,
      status: entryStatus
    });
  }
  return entries;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const pdfs = collectPdfs(inputPaths);
  if (!pdfs.length) {
    console.error('No hay PDFs para procesar. Deja los informes en kb-import/new-property/ o pasa rutas como argumento.');
    process.exit(1);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Falta OPENAI_API_KEY (necesaria para enriquecimiento y embeddings).');
    process.exit(1);
  }
  const client = new OpenAI({ apiKey });

  let prisma = null;
  let createKnowledgeEntry = null;
  if (!dryRun) {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
    ({ createKnowledgeEntry } = await import('../src/aintelligence/kb/createEntry.js'));
  }

  const totals = { pdfs: 0, entries: 0, created: 0, duplicates: 0, errors: 0 };

  for (const pdfPath of pdfs) {
    const fileName = path.basename(pdfPath);
    console.log(`\n━━ ${fileName} ━━`);
    totals.pdfs++;

    let report;
    try {
      const text = await extractText(pdfPath);
      report = parseReport(text, fileName);
    } catch (err) {
      console.error(`  ✗ Error extrayendo/parseando: ${err.message}`);
      totals.errors++;
      continue;
    }

    console.log(`  Informe N.º ${report.meta.reportNumber || '—'} · ${report.meta.address || '—'} (${report.meta.comuna || '—'})`);
    console.log(`  Ítems parseados: ${report.items.length} · Observaciones generales: ${report.general ? 'sí' : 'no'} · Conclusión: ${report.conclusion ? 'sí' : 'no'}`);

    let enriched = new Map();
    if (report.items.length) {
      try {
        enriched = await enrichItems(client, report.items, report.meta);
      } catch (err) {
        console.warn(`  ⚠ Enriquecimiento LLM falló (${err.message}); se usa severidad media y sin categoría postventa.`);
      }
    }

    const entries = [
      ...report.items.map((it) => buildItemEntry(it, enriched.get(it.item) || null, report.meta)),
      ...buildGeneralEntries(report)
    ];
    totals.entries += entries.length;

    for (const entry of entries) {
      const tag = `${entry.entryType}${entry.category ? ` → postventa:${entry.category}` : ' (solo contexto entrega)'}`;
      if (dryRun) {
        console.log(`  [dry-run] ${entry.sourceRef} · ${tag} · sev=${entry.severity || '—'} · kpi=${entry.kpiKey || '—'}`);
        console.log(`            ${entry.text.slice(0, 160)}${entry.text.length > 160 ? '…' : ''}`);
        continue;
      }
      try {
        const res = await createKnowledgeEntry(prisma, entry, console);
        if (!res.ok) {
          console.error(`  ✗ ${entry.sourceRef}: ${res.error}`);
          totals.errors++;
        } else if (res.duplicate) {
          totals.duplicates++;
        } else {
          totals.created++;
          console.log(`  ✓ ${entry.sourceRef} · ${tag} · sev=${entry.severity || '—'}${res.embedded ? '' : ' (sin embedding)'}`);
        }
      } catch (err) {
        console.error(`  ✗ ${entry.sourceRef}: ${err.message}`);
        totals.errors++;
      }
    }
  }

  console.log(`\n══ Resumen ══`);
  console.log(`PDFs: ${totals.pdfs} · Entradas generadas: ${totals.entries}`);
  if (dryRun) {
    console.log('(dry-run: no se escribió nada en la base)');
  } else {
    console.log(`Creadas: ${totals.created} · Duplicadas (ya existían): ${totals.duplicates} · Errores: ${totals.errors}`);
  }

  await prisma?.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
