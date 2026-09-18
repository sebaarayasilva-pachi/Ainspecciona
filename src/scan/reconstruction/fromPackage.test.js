import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planFromTour } from './fromPackage.js';

describe('planFromTour', () => {
  it('proyecta poses XZ a un path relativo', () => {
    const plan = planFromTour({
      frames: [
        { pose: { tx: 2, ty: 1, tz: 4 } },
        { pose: { tx: 5, ty: 1, tz: 6 } }
      ]
    }, 'Depto');
    assert.equal(plan.kind, 'path_floorplan');
    assert.equal(plan.path.length, 2);
    assert.equal(plan.path[0].x, 0);
    assert.equal(plan.path[0].y, 0);
    assert.equal(plan.path[1].x, 3);
    assert.equal(plan.path[1].y, 2);
  });
});
