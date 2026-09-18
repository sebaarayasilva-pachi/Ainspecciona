import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { maybeFinalizeScan, runScanProcessing } from './processScan.js';
import { setReconstructionProvider, MockReconstructionProvider } from '../reconstruction/provider.js';

function fakePrisma(scan) {
  return {
    scanJob: {
      findUnique: async () => ({ ...scan, property: scan.property || { name: 'Depto' } }),
      update: async ({ data }) => {
        Object.assign(scan, data);
        return { ...scan, property: scan.property || { name: 'Depto' } };
      },
      updateMany: async ({ data }) => {
        Object.assign(scan, data);
        return { count: 1 };
      }
    }
  };
}

describe('runScanProcessing', () => {
  beforeEach(() => setReconstructionProvider(new MockReconstructionProvider()));

  it('encola el Job y deja PROCESSING', async () => {
    setReconstructionProvider({
      submit: async () => 'exec-1',
      getStatus: async () => ({ status: 'PROCESSING', progress: 20 })
    });
    const scan = {
      id: 's1',
      orgId: 'o1',
      packagePath: 'scans/o1/s1/package.zip',
      status: 'UPLOADED',
      processingProgress: 0,
      property: { name: 'Loft' }
    };
    const result = await runScanProcessing(fakePrisma(scan), 's1');
    assert.equal(result.ok, true);
    assert.equal(result.pending, true);
    assert.equal(scan.status, 'PROCESSING');
    assert.equal(scan.processingProgress, 15);
  });

  it('sin worker ni zip deja mock READY', async () => {
    const scan = {
      id: 's2',
      orgId: 'o1',
      packagePath: null,
      status: 'UPLOADED',
      processingProgress: 0,
      property: { name: 'Casa' }
    };
    const result = await runScanProcessing(fakePrisma(scan), 's2');
    assert.equal(result.ok, true);
    assert.equal(scan.status, 'READY');
    assert.equal(scan.modelType, 'MOCK_SCENE');
  });
});

describe('maybeFinalizeScan', () => {
  it('pasa a READY con GLB cuando el Job termina', async () => {
    setReconstructionProvider({
      getStatus: async () => ({ status: 'READY', progress: 100 }),
      getResult: async () => ({
        status: 'READY',
        modelKey: 'scans/o1/s1/model.glb',
        kind: 'colmap_cloud',
        pointCount: 40,
        frames: [{ index: 1, storageKey: 'scans/o1/s1/frames/000001.jpg', pose: { tx: 0, ty: 0, tz: 0 }, upright: true }]
      })
    });
    const scan = {
      id: 's1',
      orgId: 'o1',
      status: 'PROCESSING',
      processingProgress: 20,
      property: { name: 'Loft' },
      planJson: { tour: { frames: [] } }
    };
    const out = await maybeFinalizeScan(fakePrisma(scan), scan);
    assert.equal(out.status, 'READY');
    assert.equal(out.modelType, 'GLB');
    assert.equal(out.modelUrl, 'scans/o1/s1/model.glb');
    assert.equal(out.planJson.tour.frames.length, 1);
  });

  it('si el Job falla pero hay fotos, queda READY con recorrido', async () => {
    setReconstructionProvider({
      getStatus: async () => ({ status: 'FAILED', error: 'NO_PLY' }),
      getResult: async () => ({
        status: 'FAILED',
        error: 'NO_PLY',
        frames: [{ index: 1, storageKey: 'f.jpg', pose: { tx: 0, ty: 0, tz: 0 } }]
      })
    });
    const scan = {
      id: 's3',
      status: 'PROCESSING',
      processingProgress: 40,
      property: { name: 'X' }
    };
    const out = await maybeFinalizeScan(fakePrisma(scan), scan);
    assert.equal(out.status, 'READY');
    assert.equal(out.modelType, 'MOCK_SCENE');
    assert.equal(out.planJson.tour.frames.length, 1);
  });
});
