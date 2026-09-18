import sharp from 'sharp';
import {
  cameraDistance,
  num,
  project,
  scaleIntrinsics,
  unproject
} from './geometry.js';
import { buildPhotoRoom } from './buildPhotoRoom.js';

const MAX_KEYFRAMES = 28;
const RESIZE_W = 240;
const DEPTHS = [0.5, 0.75, 1.0, 1.3, 1.65, 2.0, 2.4, 2.9, 3.4];
const PATH_RADIUS = 2.6;
const STEP = 3;
const MAX_COLOR = 70;
const MIN_MARGIN = 10;
const VOXEL = 0.07;
const MAX_POINTS = 18000;

function sample(img, u, v) {
  const x = Math.round(u);
  const y = Math.round(v);
  if (x < 1 || y < 1 || x >= img.w - 1 || y >= img.h - 1) return null;
  const i = (y * img.w + x) * 3;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

function colorDiff(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function pickKeyframes(frames) {
  if (frames.length <= MAX_KEYFRAMES) return frames;
  const out = [];
  const step = frames.length / MAX_KEYFRAMES;
  for (let i = 0; i < MAX_KEYFRAMES; i++) {
    out.push(frames[Math.min(frames.length - 1, Math.round(i * step))]);
  }
  return out;
}

function findPartners(frames, i) {
  const a = frames[i];
  const partners = [];
  for (let j = i + 1; j < frames.length && partners.length < 2; j++) {
    const d = cameraDistance(a.pose, frames[j].pose);
    if (d >= 0.18 && d <= 1.1) partners.push(frames[j]);
  }
  if (!partners.length && i + 1 < frames.length) partners.push(frames[i + 1]);
  return partners;
}

async function loadImage(frame) {
  const { data, info } = await sharp(frame.buffer)
    .rotate()
    .resize({ width: RESIZE_W, withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const intr = scaleIntrinsics(frame.intrinsics, info.width, info.height);
  return { data, w: info.width, h: info.height, pose: frame.pose, intr };
}

function contrastAt(img, u, v) {
  const c0 = sample(img, u, v);
  const c1 = sample(img, u + 2, v);
  const c2 = sample(img, u, v + 2);
  if (!c0 || !c1 || !c2) return 0;
  return Math.max(colorDiff(c0, c1), colorDiff(c0, c2));
}

function nearPath(world, cameras, maxD) {
  for (const c of cameras) {
    const d = cameraDistance({ tx: world[0], ty: world[1], tz: world[2] }, c);
    if (d <= maxD) return true;
  }
  return false;
}

function sweepPixel(ref, others, u, v) {
  if (contrastAt(ref, u, v) < 22) return null;
  const c0 = sample(ref, u, v);
  if (!c0) return null;
  let bestD = 0;
  let bestErr = 1e9;
  let second = 1e9;
  for (const d of DEPTHS) {
    const world = unproject(ref.pose, ref.intr, u, v, d);
    let err = 0;
    let hits = 0;
    for (const other of others) {
      const pix = project(other.pose, other.intr, world);
      if (!pix) continue;
      const c1 = sample(other, pix.u, pix.v);
      if (!c1) continue;
      err += colorDiff(c0, c1);
      hits += 1;
    }
    if (!hits) continue;
    err /= hits;
    if (err < bestErr) {
      second = bestErr;
      bestErr = err;
      bestD = d;
    } else if (err < second) {
      second = err;
    }
  }
  if (!bestD || bestErr > MAX_COLOR || second - bestErr < MIN_MARGIN) return null;
  const world = unproject(ref.pose, ref.intr, u, v, bestD);
  return { world, color: c0 };
}

function voxelize(points) {
  const map = new Map();
  for (const p of points) {
    const i = Math.round(p.world[0] / VOXEL);
    const j = Math.round(p.world[1] / VOXEL);
    const k = Math.round(p.world[2] / VOXEL);
    const key = `${i},${j},${k}`;
    let cell = map.get(key);
    if (!cell) {
      cell = { i, j, k, r: 0, g: 0, b: 0, n: 0 };
      map.set(key, cell);
    }
    cell.r += p.color[0];
    cell.g += p.color[1];
    cell.b += p.color[2];
    cell.n += 1;
  }
  const cells = [];
  for (const c of map.values()) {
    if (c.n < 2) continue;
    cells.push({
      x: c.i * VOXEL,
      y: c.j * VOXEL,
      z: c.k * VOXEL,
      r: Math.round(c.r / c.n),
      g: Math.round(c.g / c.n),
      b: Math.round(c.b / c.n)
    });
  }
  return cells;
}

function packPoints(points) {
  const step = Math.max(1, Math.ceil(points.length / MAX_POINTS));
  const out = [];
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    out.push(
      +p.world[0].toFixed(3),
      +p.world[1].toFixed(3),
      +p.world[2].toFixed(3),
      p.color[0],
      p.color[1],
      p.color[2]
    );
  }
  return out;
}

function packVoxels(cells) {
  const out = [];
  for (const c of cells) {
    out.push(+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3), c.r, c.g, c.b);
  }
  return out;
}

/**
 * Suelda fotos con poses conocidas: plane-sweep stereo → nube + vóxeles.
 * @param {Array<{ buffer: Buffer, pose: object, intrinsics: object }>} frames
 */
export async function weldPhotos(frames, { displayDeg = 90 } = {}) {
  const usable = (frames || []).filter((f) => f?.buffer?.length && f.pose && f.intrinsics);
  if (usable.length < 3) {
    return { ok: false, reason: 'TOO_FEW_FRAMES', points: [], voxels: [], voxelSize: VOXEL };
  }
  const keys = pickKeyframes(usable);
  const images = [];
  for (const f of keys) {
    images.push(await loadImage(f));
  }
  const rawPoints = [];
  for (let i = 0; i < images.length; i++) {
    const others = findPartners(keys, i).map((k) => {
      const idx = keys.indexOf(k);
      return idx >= 0 ? images[idx] : null;
    }).filter(Boolean);
    if (!others.length) continue;
    const ref = images[i];
    for (let v = STEP; v < ref.h - STEP; v += STEP) {
      for (let u = STEP; u < ref.w - STEP; u += STEP) {
        const hit = sweepPixel(ref, others, u, v);
        if (hit) rawPoints.push(hit);
      }
    }
  }
  const cameras = keys.map((f) => f.pose);
  const cleaned = rawPoints.filter((p) => nearPath(p.world, cameras, PATH_RADIUS));
  const voxels = voxelize(cleaned);
  const room = buildPhotoRoom(
    usable.map((f, i) => ({
      index: f.index || i + 1,
      pose: f.pose,
      intrinsics: f.intrinsics
    })),
    { displayDeg }
  );
  const ok = room.ok || cleaned.length >= 80;
  return {
    ok,
    reason: ok ? 'OK' : 'SPARSE',
    kind: room.ok ? 'photo_room' : 'photo_mesh',
    voxelSize: VOXEL,
    pointCount: cleaned.length,
    voxelCount: voxels.length,
    points: packPoints(cleaned),
    voxels: packVoxels(voxels),
    room
  };
}

export function weldStats(weld) {
  return {
    ok: Boolean(weld?.ok),
    pointCount: num(weld?.pointCount),
    voxelCount: num(weld?.voxelCount),
    roomGroups: Array.isArray(weld?.room?.groups) ? weld.room.groups.length : 0,
    reason: weld?.reason || ''
  };
}

export { VOXEL, DEPTHS };
