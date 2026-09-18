import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { arcoreToColmap, gcsObjectKey, reconObjectKeys } from './colmapPoses.js';

describe('arcoreToColmap', () => {
  it('identidad OpenGL → 180° en X (Y/Z flip)', () => {
    const p = arcoreToColmap({ tx: 0, ty: 0, tz: 0, qx: 0, qy: 0, qz: 0, qw: 1 });
    assert.ok(Math.abs(p.qw) < 1e-6);
    assert.ok(Math.abs(p.qx) > 0.99);
    assert.ok(Math.abs(p.qy) < 1e-6);
    assert.ok(Math.abs(p.qz) < 1e-6);
    assert.ok(Math.abs(p.tx) < 1e-9);
    assert.ok(Math.abs(p.ty) < 1e-9);
    assert.ok(Math.abs(p.tz) < 1e-9);
  });

  it('traslación se expresa en world-to-cam COLMAP', () => {
    const p = arcoreToColmap({ tx: 1, ty: 2, tz: 3, qx: 0, qy: 0, qz: 0, qw: 1 });
    assert.ok(Math.abs(p.tx - (-1)) < 1e-6);
    assert.ok(Math.abs(p.ty - 2) < 1e-6);
    assert.ok(Math.abs(p.tz - 3) < 1e-6);
  });
});

describe('gcs helpers', () => {
  it('saca la clave de gs:// y URL pública', () => {
    assert.equal(
      gcsObjectKey('gs://bucket/scans/a/b/package.zip', 'bucket'),
      'scans/a/b/package.zip'
    );
    assert.equal(
      gcsObjectKey('https://storage.googleapis.com/bucket/scans/a/b/package.zip', 'bucket'),
      'scans/a/b/package.zip'
    );
    assert.equal(gcsObjectKey('scans/a/b/package.zip', 'bucket'), 'scans/a/b/package.zip');
  });

  it('arma claves de recon', () => {
    const k = reconObjectKeys('org1', 'scan1');
    assert.equal(k.model, 'scans/org1/scan1/model.glb');
    assert.equal(k.status, 'scans/org1/scan1/recon/status.json');
  });
});
