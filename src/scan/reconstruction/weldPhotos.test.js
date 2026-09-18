import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { weldPhotos } from './weldPhotos.js';
import { unproject } from './geometry.js';

async function solidJpeg(r, g, b, w = 80, h = 60) {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r, g, b } }
  })
    .jpeg()
    .toBuffer();
}

describe('weldPhotos', () => {
  it('rechaza menos de 3 frames', async () => {
    const w = await weldPhotos([]);
    assert.equal(w.ok, false);
    assert.equal(w.reason, 'TOO_FEW_FRAMES');
  });

  it('no explota con fotos planas (sin textura)', async () => {
    const jpeg = await solidJpeg(30, 30, 30);
    const intr = { fx: 60, fy: 60, cx: 40, cy: 30, width: 80, height: 60 };
    const frames = [0, 1, 2, 3].map((i) => ({
      buffer: jpeg,
      pose: { tx: i * 0.3, ty: 0, tz: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
      intrinsics: intr
    }));
    const w = await weldPhotos(frames);
    assert.equal(typeof w.ok, 'boolean');
    assert.ok(Array.isArray(w.points));
  });

  it('unproject queda delante de la cámara', () => {
    const pose = { tx: 0, ty: 0, tz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
    const intr = { fx: 100, fy: 100, cx: 50, cy: 40, width: 100, height: 80 };
    const p = unproject(pose, intr, 50, 40, 2);
    assert.ok(p[2] < 0);
  });
});
