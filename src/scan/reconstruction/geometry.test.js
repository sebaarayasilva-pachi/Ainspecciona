import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { project, unproject, scaleIntrinsics, rotateIntrinsics } from './geometry.js';

const identity = { tx: 0, ty: 0, tz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
const intr = { fx: 400, fy: 400, cx: 160, cy: 120, width: 320, height: 240 };

describe('camera geometry', () => {
  it('proyecta un punto al frente en el principal', () => {
    const p = unproject(identity, intr, 160, 120, 2);
    assert.ok(Math.abs(p[0]) < 1e-6);
    assert.ok(Math.abs(p[1]) < 1e-6);
    assert.ok(Math.abs(p[2] + 2) < 1e-6);
    const pix = project(identity, intr, p);
    assert.ok(pix);
    assert.ok(Math.abs(pix.u - 160) < 1e-4);
    assert.ok(Math.abs(pix.v - 120) < 1e-4);
    assert.ok(Math.abs(pix.z - 2) < 1e-4);
  });

  it('roundtrip de un pixel fuera del centro', () => {
    const p = unproject(identity, intr, 200, 80, 1.5);
    const pix = project(identity, intr, p);
    assert.ok(Math.abs(pix.u - 200) < 1e-4);
    assert.ok(Math.abs(pix.v - 80) < 1e-4);
  });

  it('escala intrínsecos', () => {
    const s = scaleIntrinsics(intr, 160, 120);
    assert.equal(s.fx, 200);
    assert.equal(s.cx, 80);
  });

  it('rota intrínsecos 90 CW', () => {
    const r = rotateIntrinsics({ fx: 10, fy: 20, cx: 3, cy: 4, width: 8, height: 6 }, 90);
    assert.equal(r.width, 6);
    assert.equal(r.height, 8);
    assert.equal(r.fx, 20);
    assert.equal(r.cx, 4);
    assert.equal(r.cy, 8 - 1 - 3);
  });
});
