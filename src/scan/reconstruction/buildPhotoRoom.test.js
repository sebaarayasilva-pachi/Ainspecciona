import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPhotoRoom, convexHullXZ } from './buildPhotoRoom.js';

describe('buildPhotoRoom', () => {
  it('arma un hull convexo', () => {
    const h = convexHullXZ([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 1, y: 1 }
    ]);
    assert.equal(h.length, 4);
  });

  it('genera grupos texturizados con 4 cámaras', () => {
    const intr = { fx: 400, fy: 400, cx: 160, cy: 120, width: 320, height: 240 };
    const frames = [
      { index: 1, pose: { tx: 0, ty: 0, tz: 0, qx: 0, qy: 0, qz: 0, qw: 1 }, intrinsics: intr },
      { index: 2, pose: { tx: 0.4, ty: 0, tz: 0, qx: 0, qy: 0, qz: 0, qw: 1 }, intrinsics: intr },
      { index: 3, pose: { tx: 0.8, ty: 0, tz: 0.2, qx: 0, qy: 0, qz: 0, qw: 1 }, intrinsics: intr },
      { index: 4, pose: { tx: 1.1, ty: 0, tz: 0.1, qx: 0, qy: 0, qz: 0, qw: 1 }, intrinsics: intr }
    ];
    const room = buildPhotoRoom(frames, { displayDeg: 0 });
    assert.equal(room.ok, true);
    assert.ok(room.groups.length >= 1);
    assert.ok(room.groups.some((g) => g.positions.length >= 9));
    assert.ok(Number.isFinite(room.floorY));
    assert.ok(room.ceilY > room.floorY);
  });
});
