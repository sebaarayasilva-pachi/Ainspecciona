import JSZip from 'jszip';
import sharp from 'sharp';
import { rotateIntrinsics } from './geometry.js';
import { weldPhotos } from './weldPhotos.js';

const MAX_FRAMES = 160;

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function poseOf(frame) {
  const p = frame?.pose || {};
  return {
    tx: num(p.tx),
    ty: num(p.ty),
    tz: num(p.tz),
    qx: num(p.qx),
    qy: num(p.qy),
    qz: num(p.qz),
    qw: num(p.qw, 1)
  };
}

/** JPEG del sensor ARCore (acostado) → vertical de uso. */
export function imageRotationDeg(manifest, frame) {
  if (manifest?.imagesUpright || frame?.upright) return 0;
  const explicit = Number(frame?.rotationDeg ?? manifest?.imageRotationDeg);
  if (Number.isFinite(explicit) && explicit !== 0) return ((explicit % 360) + 360) % 360;
  const display = Number(manifest?.displayRotation ?? manifest?.capture?.displayRotation);
  const displayDeg = Number.isFinite(display) ? display : 0;
  return (90 - displayDeg + 360) % 360;
}

function zipName(entry) {
  return String(entry || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function intrOf(frame) {
  const i = frame?.intrinsics || {};
  return {
    fx: num(i.fx),
    fy: num(i.fy),
    cx: num(i.cx),
    cy: num(i.cy),
    width: num(i.width, 640),
    height: num(i.height, 480)
  };
}

/**
 * Lee package.zip (manifest + JPEGs), sube frames y arma un tour por poses.
 * includeWeld=false: no arma recinto/paneles (el 3D lo hace COLMAP).
 */
export async function buildTourFromPackage(storage, scan, { includeWeld = false } = {}) {
  if (!storage?.readBuffer || !scan?.packagePath) return null;
  let zipBuf;
  try {
    zipBuf = await storage.readBuffer(scan.packagePath);
  } catch {
    return null;
  }
  if (!zipBuf?.length) return null;

  const zip = await JSZip.loadAsync(zipBuf);
  const manifestFile = zip.file(/manifest\.json$/i)[0];
  if (!manifestFile) return null;
  const manifest = JSON.parse(await manifestFile.async('string'));
  const rawFrames = Array.isArray(manifest.frames) ? manifest.frames : [];
  if (!rawFrames.length) return null;

  const picked = rawFrames.slice(0, MAX_FRAMES);
  const prefix = `scans/${scan.orgId}/${scan.id}/frames`;
  const out = [];
  const weldFrames = [];

  for (const f of picked) {
    const rel = zipName(f.image || f.imagePath || '');
    if (!rel) continue;
    const basename = rel.split('/').pop();
    const file =
      zip.file(rel) ||
      zip.file(`frames/${basename}`) ||
      zip.file(new RegExp(`(?:^|/)${basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))[0];
    if (!file) continue;
    const raw = await file.async('nodebuffer');
    const pose = poseOf(f);
    const deg = imageRotationDeg(manifest, f);
    const sensorIntr = intrOf(f);
    const displayRot = (90 - num(manifest.displayRotation ?? manifest.capture?.displayRotation, 0) + 360) % 360;
    const index = Number(f.index) || out.length + 1;
    weldFrames.push({
      index,
      buffer: raw,
      pose,
      intrinsics: manifest.imagesUpright && displayRot
        ? rotateIntrinsics(sensorIntr, displayRot)
        : sensorIntr
    });
    let jpeg = raw;
    try {
      let pipeline = sharp(raw).rotate();
      if (deg) pipeline = pipeline.rotate(deg);
      jpeg = await pipeline
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch {
      /* usar el jpeg original */
    }
    const name = `${String(index).padStart(6, '0')}.jpg`;
    const key = `${prefix}/${name}`;
    const saved = await storage.saveBuffer({
      buffer: jpeg,
      contentType: 'image/jpeg',
      storageKey: key
    });
    out.push({
      index,
      storageKey: saved.objectPath || key,
      pose,
      upright: true
    });
  }

  if (!out.length) return null;
  let weld = null;
  if (includeWeld) {
    try {
      const lastDeg = imageRotationDeg(manifest, picked[picked.length - 1] || {});
      weld = await weldPhotos(weldFrames, {
        displayDeg: manifest.imagesUpright ? 0 : lastDeg
      });
    } catch {
      weld = null;
    }
  }
  return {
    kind: weld?.ok ? 'photo_mesh' : 'photo_path',
    frames: out,
    captureMode: manifest.captureMode || scan.captureMode,
    weld
  };
}

export function planFromTour(tour, title) {
  const frames = tour?.frames || [];
  const path = frames.map((f) => ({ x: f.pose.tx, y: f.pose.tz }));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of path) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!path.length || !Number.isFinite(minX)) {
    return {
      version: 1,
      kind: 'path_floorplan',
      title,
      units: 'meters',
      path: [],
      rooms: [],
      note: 'Sin recorrido suficiente para dibujar el plano.'
    };
  }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  return {
    version: 1,
    kind: 'path_floorplan',
    title,
    units: 'meters',
    path: path.map((p) => ({ x: p.x - minX, y: p.y - minY })),
    span,
    rooms: [],
    note: 'Trazado del recorrido (poses de cámara). No es plano certificado.'
  };
}
