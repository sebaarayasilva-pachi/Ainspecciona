/**
 * Motor de reconstrucción intercambiable.
 */

export class MockReconstructionProvider {
  async submit(scanId) {
    return `mock-job-${scanId}`;
  }

  async getStatus(jobId) {
    return { jobId, status: 'READY', progress: 100 };
  }

  /**
   * Genera salidas mock: escena procedural + planimetría JSON.
   * No es fotogrametría real (Fase D experimental).
   */
  async getResult(jobId, { property } = {}) {
    const name = property?.name || 'Propiedad';
    return {
      modelType: 'MOCK_SCENE',
      modelUrl: null,
      planUrl: null,
      planJson: {
        version: 1,
        kind: 'marketing_floorplan',
        title: name,
        units: 'approx_meters',
        rooms: [
          { id: 'living', label: 'Living', x: 0, y: 0, w: 5.2, h: 4.0 },
          { id: 'kitchen', label: 'Cocina', x: 5.2, y: 0, w: 3.0, h: 2.8 },
          { id: 'hall', label: 'Pasillo', x: 0, y: 4.0, w: 1.4, h: 3.5 },
          { id: 'bed1', label: 'Dormitorio 1', x: 1.4, y: 4.0, w: 3.6, h: 3.5 },
          { id: 'bath', label: 'Baño', x: 5.0, y: 2.8, w: 2.2, h: 2.2 }
        ],
        note: 'Planimetría aproximada de marketing (mock). No es plano certificado.'
      },
      alignment: { up: { x: 0, y: 1, z: 0 } },
      scene: {
        kind: 'box_apartment',
        floors: 1,
        ceilingHeight: 2.55
      }
    };
  }
}

/** @type {import('./provider.js').MockReconstructionProvider} */
let activeProvider = new MockReconstructionProvider();

export function getReconstructionProvider() {
  return activeProvider;
}

export function setReconstructionProvider(provider) {
  activeProvider = provider;
}
