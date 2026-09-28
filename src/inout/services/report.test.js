import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assembleLeaseReport, buildDiffSummary } from './report.js';
import { generateInOutReportPdf } from '../../pdf/inoutReportPdf.js';

describe('informe InOut', () => {
  it('arma resumen y payload del lease', () => {
    const lease = {
      id: 'L1',
      cycleStatus: 'under_review',
      tenantName: 'Ana',
      ownerName: 'Luis',
      tenantEmail: 'ana@test.cl',
      ownerEmail: 'luis@test.cl',
      property: { address: 'Colon 1' },
      reports: [{ id: 'R1', kind: 'DIFF' }],
      visits: [
        {
          phase: 'IN',
          slots: [{ slotCode: 'KITCHEN', title: 'Cocina', photos: [{ id: 'p1' }] }]
        },
        {
          phase: 'OUT',
          slots: [{ slotCode: 'KITCHEN', title: 'Cocina', photos: [{ id: 'p2' }] }],
          diffResults: [
            {
              id: 'd1',
              slotCode: 'KITCHEN',
              classification: 'sin_cambio',
              severity: 'none',
              confidence: 0.9,
              description: 'Igual',
              reviewStatus: 'pending'
            }
          ]
        }
      ]
    };
    const view = assembleLeaseReport(lease);
    assert.equal(view.summary.counts.sin_cambio, 1);
    assert.equal(view.items[0].diffId, 'd1');
    assert.equal(view.items[0].inPhotoUrl, '/api/inout/photos/p1/image');
    assert.match(view.disclaimer, /evidencia visual/);
  });

  it('genera PDF con bytes', async () => {
    const summary = buildDiffSummary([{ classification: 'cambio_detectado' }]);
    const buf = await generateInOutReportPdf({
      address: 'Colon 1',
      tenantName: 'Ana',
      ownerName: 'Luis',
      summary,
      disclaimer: 'Aviso',
      items: [{ title: 'Cocina', classification: 'cambio_detectado', description: 'Rayon', reviewStatus: 'pending' }]
    });
    assert.ok(buf.length > 200);
    assert.equal(buf.slice(0, 4).toString(), '%PDF');
  });
});
