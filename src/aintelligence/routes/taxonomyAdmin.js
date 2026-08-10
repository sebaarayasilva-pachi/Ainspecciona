import {
  createTaxonomyEntry,
  deleteTaxonomyEntry,
  getTaxonomyEntry,
  importKpiExcelToTaxonomy,
  listTaxonomyEntries,
  replaceCatalog,
  approveTaxonomyEntriesBatch,
  updateTaxonomyEntry
} from '../taxonomy/store.js';
import { emptyCatalog, DEFAULT_TAXONOMY_ENTRIES } from '../taxonomy/defaults.js';
import { invalidateEntregaKpiCache } from '../../entrega/taxonomyKpi.js';

function afterTaxonomyMutation(reply, payload) {
  invalidateEntregaKpiCache();
  return reply.send(payload);
}

export async function registerTaxonomyAdminRoutes(app) {
  app.get('/api/admin/taxonomy', async (req, reply) => {
    try {
      const q = req.query || {};
      const { catalog, entries } = await listTaxonomyEntries({
        kpi: q.kpi,
        mirada: q.mirada,
        status: q.status
      });
      return reply.send({
        ok: true,
        catalog: { ...catalog, entries },
        entries,
        templates: DEFAULT_TAXONOMY_ENTRIES,
        count: entries.length
      });
    } catch (err) {
      req.log.error({ err }, 'admin taxonomy list');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR', message: err?.message });
    }
  });

  app.post('/api/admin/taxonomy/reset-seed', async (req, reply) => {
    try {
      const catalog = await replaceCatalog(emptyCatalog());
      return reply.send({ ok: true, count: catalog.entries.length });
    } catch (err) {
      req.log.error({ err }, 'admin taxonomy reset');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.post('/api/admin/taxonomy/import-kpi', async (req, reply) => {
    try {
      const body = req.body || {};
      const result = await importKpiExcelToTaxonomy({
        replaceExisting: body.replaceExisting === true || body.replace === true
      });
      return afterTaxonomyMutation(reply, {
        ok: true,
        stats: result.stats,
        hallazgosParsed: result.hallazgosParsed,
        totalEntries: result.catalog.entries.length
      });
    } catch (err) {
      req.log.error({ err }, 'admin taxonomy import-kpi');
      return reply.code(400).send({ ok: false, error: 'IMPORT_FAILED', message: err?.message || 'Error al importar' });
    }
  });

  app.post('/api/admin/taxonomy/approve-batch', async (req, reply) => {
    try {
      const body = req.body || {};
      const source = body.source != null ? String(body.source).trim() : 'KPI.xlsx';
      const entregaOnly = body.entregaOnly !== false;
      const result = await approveTaxonomyEntriesBatch({
        source: source || undefined,
        entregaOnly,
        ids: Array.isArray(body.ids) ? body.ids : undefined
      });
      return afterTaxonomyMutation(reply, { ok: true, ...result });
    } catch (err) {
      req.log.error({ err }, 'admin taxonomy approve-batch');
      return reply.code(400).send({ ok: false, error: 'APPROVE_FAILED', message: err?.message || 'Error al aprobar' });
    }
  });
  app.get('/api/admin/taxonomy/:id', async (req, reply) => {
    try {
      const result = await getTaxonomyEntry(String(req.params.id || '').trim());
      if (!result) return reply.code(404).send({ ok: false, error: 'NOT_FOUND' });
      return reply.send({ ok: true, entry: result.entry });
    } catch (err) {
      req.log.error({ err }, 'admin taxonomy get');
      return reply.code(500).send({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  app.post('/api/admin/taxonomy', async (req, reply) => {
    try {
      const entry = await createTaxonomyEntry(req.body || {});
      return reply.code(201).send({ ok: true, entry });
    } catch (err) {
      const msg = err?.message || 'Error al crear';
      return reply.code(400).send({ ok: false, error: 'VALIDATION_ERROR', message: msg });
    }
  });

  app.put('/api/admin/taxonomy/:id', async (req, reply) => {
    try {
      const entry = await updateTaxonomyEntry(String(req.params.id || '').trim(), req.body || {});
      return afterTaxonomyMutation(reply, { ok: true, entry });
    } catch (err) {
      const msg = err?.message || 'Error al actualizar';
      const code = msg.includes('no encontrada') ? 404 : 400;
      return reply.code(code).send({ ok: false, error: 'UPDATE_FAILED', message: msg });
    }
  });

  app.delete('/api/admin/taxonomy/:id', async (req, reply) => {
    try {
      await deleteTaxonomyEntry(String(req.params.id || '').trim());
      return reply.send({ ok: true, deleted: true });
    } catch (err) {
      const msg = err?.message || 'Error al eliminar';
      return reply.code(msg.includes('no encontrada') ? 404 : 400).send({ ok: false, error: 'DELETE_FAILED', message: msg });
    }
  });
}
