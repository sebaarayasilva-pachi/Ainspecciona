#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function normalizeText(v) {
  return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function includesAll(text, words = []) {
  const src = normalizeText(text);
  return words.every((w) => src.includes(normalizeText(w)));
}

function includesAny(text, words = []) {
  const src = normalizeText(text);
  return words.some((w) => src.includes(normalizeText(w)));
}

function asNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function readSpec(specPath) {
  const raw = await fs.readFile(specPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('El archivo de spec debe ser un arreglo JSON de casos.');
  }
  return parsed;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, init);
  const bodyText = await res.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = { ok: false, raw: bodyText };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} (${url}) -> ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

function evaluateSlotExpectation(slot, slotExpectation) {
  const errors = [];
  const parsed = slot?.analysisDebug?.openai?.parsed || {};
  const message = String(slot?.message || '');
  const kpiAnalysis = String(parsed?.kpi_analysis || '');
  const code = String(slot?.findingCode || '').toUpperCase();
  const severity = slot?.severity == null ? null : String(slot.severity).toLowerCase();
  const penalty = asNumber(slot?.scorePenaltyApplied, 0);

  if (slotExpectation.findingCode !== undefined) {
    const expectedCode = String(slotExpectation.findingCode || '').toUpperCase();
    if (code !== expectedCode) errors.push(`findingCode esperado=${expectedCode}, real=${code}`);
  }
  if (slotExpectation.severity !== undefined) {
    const expectedSeverity = slotExpectation.severity == null ? null : String(slotExpectation.severity).toLowerCase();
    if (severity !== expectedSeverity) errors.push(`severity esperado=${expectedSeverity}, real=${severity}`);
  }
  if (slotExpectation.scorePenaltyApplied !== undefined) {
    const expectedPenalty = asNumber(slotExpectation.scorePenaltyApplied, 0);
    if (penalty !== expectedPenalty) errors.push(`scorePenaltyApplied esperado=${expectedPenalty}, real=${penalty}`);
  }
  if (Array.isArray(slotExpectation.messageIncludes) && !includesAll(message, slotExpectation.messageIncludes)) {
    errors.push(`message no contiene todas las frases esperadas: ${slotExpectation.messageIncludes.join(', ')}`);
  }
  if (Array.isArray(slotExpectation.messageNotIncludes) && includesAny(message, slotExpectation.messageNotIncludes)) {
    errors.push(`message contiene frases prohibidas: ${slotExpectation.messageNotIncludes.join(', ')}`);
  }
  if (Array.isArray(slotExpectation.kpiAnalysisIncludes) && !includesAll(kpiAnalysis, slotExpectation.kpiAnalysisIncludes)) {
    errors.push(`kpi_analysis no contiene todas las frases esperadas: ${slotExpectation.kpiAnalysisIncludes.join(', ')}`);
  }
  if (Array.isArray(slotExpectation.kpiAnalysisNotIncludes) && includesAny(kpiAnalysis, slotExpectation.kpiAnalysisNotIncludes)) {
    errors.push(`kpi_analysis contiene frases prohibidas: ${slotExpectation.kpiAnalysisNotIncludes.join(', ')}`);
  }

  return errors;
}

function runCoherenceChecks(summary) {
  const errors = [];
  for (const slot of summary?.slots || []) {
    const code = String(slot?.findingCode || '').toUpperCase();
    const severity = slot?.severity == null ? null : String(slot.severity).toLowerCase();
    const penalty = asNumber(slot?.scorePenaltyApplied, 0);
    const text = normalizeText(`${slot?.message || ''} ${slot?.analysisDebug?.openai?.parsed?.kpi_analysis || ''}`);
    const favorable = /(no se observan hallazgos relevantes|sin hallazgos relevantes|estado favorable|sin observaciones)/.test(text);
    const intervention = /(intervencion no estandar|fijacion no estandar|cinta|huincha|filtracion activa|palmeta o ceramica quebrada)/.test(text);

    if (code === 'OK' && (severity !== null || penalty > 0)) {
      errors.push(`[${slot.slotCode}] OK no puede tener severity=${severity} ni penalty=${penalty}`);
    }
    if (favorable && severity !== null) {
      errors.push(`[${slot.slotCode}] texto favorable contradice severity=${severity}`);
    }
    if (severity === null && penalty > 0) {
      errors.push(`[${slot.slotCode}] severity=null pero penalty=${penalty}`);
    }
    if (favorable && intervention && severity !== null) {
      errors.push(`[${slot.slotCode}] texto favorable contradice intervención`);
    }
  }
  return errors;
}

async function triggerReanalyze(baseUrl, caseId, headers) {
  await fetchJson(`${baseUrl}/api/cases/${encodeURIComponent(caseId)}/reanalyze`, {
    method: 'POST',
    headers
  });
}

async function waitReanalyzeComplete(baseUrl, caseId, headers, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await fetchJson(`${baseUrl}/api/cases/${encodeURIComponent(caseId)}/reanalyze-status`, { headers });
    const done = Number(status?.done || 0);
    const total = Number(status?.total || 0);
    const failed = Number(status?.failed || 0);
    if (total > 0 && done + failed >= total) return status;
    await wait(1500);
  }
  throw new Error(`Timeout esperando reanálisis de ${caseId} (${timeoutMs}ms)`);
}

async function getSummary(baseUrl, caseId, headers) {
  return fetchJson(`${baseUrl}/api/cases/${encodeURIComponent(caseId)}/summary`, { headers });
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = String(args['base-url'] || process.env.QA_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const specPath = path.resolve(process.cwd(), String(args.file || 'qa/case-baseline.json'));
  const doReanalyze = Boolean(args.reanalyze);
  const timeoutMs = asNumber(args['timeout-ms'], 240000);
  const token = String(args.token || process.env.QA_BEARER_TOKEN || '').trim();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const spec = await readSpec(specPath);
  if (!spec.length) {
    console.log('No hay casos en el spec. Nada que validar.');
    return;
  }

  let failures = 0;
  console.log(`QA cases -> baseUrl=${baseUrl} file=${specPath} reanalyze=${doReanalyze}`);

  for (const tc of spec) {
    const caseId = String(tc.caseId || '').trim();
    if (!caseId) {
      console.log('✗ Caso inválido: falta caseId');
      failures += 1;
      continue;
    }
    console.log(`\nCase ${caseId}`);
    try {
      if (doReanalyze) {
        process.stdout.write('  - reanalyze... ');
        await triggerReanalyze(baseUrl, caseId, headers);
        const status = await waitReanalyzeComplete(baseUrl, caseId, headers, timeoutMs);
        console.log(`done (${status.done}/${status.total}, failed=${status.failed || 0})`);
      }

      const summary = await getSummary(baseUrl, caseId, headers);
      const caseErrors = [];

      if (tc.expectedScore !== undefined) {
        const expectedScore = asNumber(tc.expectedScore, 0);
        const score = asNumber(summary?.score, 0);
        if (score !== expectedScore) caseErrors.push(`score esperado=${expectedScore}, real=${score}`);
      }
      if (tc.expectedBadge !== undefined) {
        const expectedBadge = String(tc.expectedBadge || '').toUpperCase();
        const badge = String(summary?.badge || '').toUpperCase();
        if (badge !== expectedBadge) caseErrors.push(`badge esperado=${expectedBadge}, real=${badge}`);
      }

      const coherenceErrors = runCoherenceChecks(summary);
      caseErrors.push(...coherenceErrors);

      const expectedSlots = Array.isArray(tc.slots) ? tc.slots : [];
      for (const slotExpectation of expectedSlots) {
        const slotCode = String(slotExpectation.slotCode || '').trim().toUpperCase();
        const slot = (summary?.slots || []).find((s) => String(s.slotCode || '').toUpperCase() === slotCode);
        if (!slot) {
          caseErrors.push(`[${slotCode}] slot no existe en summary`);
          continue;
        }
        const errs = evaluateSlotExpectation(slot, slotExpectation);
        caseErrors.push(...errs.map((e) => `[${slotCode}] ${e}`));
      }

      if (caseErrors.length) {
        console.log(`  ✗ ${caseErrors.length} problemas`);
        for (const e of caseErrors) console.log(`    - ${e}`);
        failures += caseErrors.length;
      } else {
        console.log('  ✓ OK');
      }
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
      failures += 1;
    }
  }

  console.log(`\nResultado QA: ${failures ? 'FAIL' : 'PASS'} (${failures} issues)`);
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
