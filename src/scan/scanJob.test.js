import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCaptureMode, packageObjectKey } from './scanJob.js';

describe('scanJob', () => {
  it('normaliza modos de captura Android', () => {
    assert.equal(normalizeCaptureMode('arcore_depth'), 'ARCORE_DEPTH');
    assert.equal(normalizeCaptureMode('ARCORE_STANDARD'), 'ARCORE_STANDARD');
    assert.equal(normalizeCaptureMode('nope'), 'MOCK');
  });

  it('arma la clave GCS del zip', () => {
    assert.equal(packageObjectKey('org-1', 'scan-99'), 'scans/org-1/scan-99/package.zip');
  });
});
