import {
  cameraDistance,
  mulMatVec,
  num,
  quatToMat,
  unproject
} from './geometry.js';

const PHONE_H = 1.42;
const CEIL_H = 2.52;
const LOOK_DEPTHS = [1.5, 2.2];

function median(vals) {
  const s = vals.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function uniqueXZ(pts) {
  const seen = new Set();
  const out = [];
  for (const p of pts) {
    const k = `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

export function convexHullXZ(points) {
  const pts = uniqueXZ(points).sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function lookDir(pose) {
  return mulMatVec(quatToMat(pose), [0, 0, -1]);
}

function toDisplayUv(pix, intr, displayDeg) {
  const w = num(intr.width, 640);
  const h = num(intr.height, 480);
  const d = ((num(displayDeg) % 360) + 360) % 360;
  let x = pix.u;
  let y = pix.v;
  let dw = w;
  let dh = h;
  if (d === 90) {
    x = pix.v;
    y = w - 1 - pix.u;
    dw = h;
    dh = w;
  } else if (d === 180) {
    x = w - 1 - pix.u;
    y = h - 1 - pix.v;
  } else if (d === 270) {
    x = h - 1 - pix.v;
    y = pix.u;
    dw = h;
    dh = w;
  }
  return { u: x / dw, v: 1 - y / dh };
}

function pushTri(g, a, b, c, uvA, uvB, uvC) {
  g.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  if (uvA) g.uvs.push(uvA[0], uvA[1], uvB[0], uvB[1], uvC[0], uvC[1]);
}

function addSolidTri(groups, a, b, c, color) {
  let g = groups.get(color);
  if (!g) {
    g = { frameIndex: null, color, positions: [], uvs: [] };
    groups.set(color, g);
  }
  pushTri(g, a, b, c);
}

function addSolidQuad(groups, a, b, c, d, color) {
  addSolidTri(groups, a, b, c, color);
  addSolidTri(groups, a, c, d, color);
}

function pickPanels(frames, minDist = 0.22) {
  const out = [];
  for (const f of frames) {
    if (!out.length || cameraDistance(out[out.length - 1].pose, f.pose) >= minDist) out.push(f);
    if (out.length >= 12) break;
  }
  if (out.length < 6 && frames.length >= 6) {
    const step = Math.max(1, Math.floor(frames.length / 10));
    return frames.filter((_, i) => i % step === 0).slice(0, 12);
  }
  return out;
}

function addPhotoPanel(groups, frame, depth) {
  const look = lookDir(frame.pose);
  const flatLen = Math.hypot(look[0], look[2]) || 1;
  const fwd = [look[0] / flatLen, 0, look[2] / flatLen];
  const right = [-fwd[2], 0, fwd[0]];
  const fx = num(frame.intrinsics.fx, 460);
  const fy = num(frame.intrinsics.fy, 460);
  const w = num(frame.intrinsics.width, 640);
  const h = num(frame.intrinsics.height, 480);
  const halfW = depth * (Math.min(w, h) / 2) / fx;
  const halfH = depth * (Math.max(w, h) / 2) / fy;
  const cx = num(frame.pose.tx) + fwd[0] * depth;
  const cy = num(frame.pose.ty);
  const cz = num(frame.pose.tz) + fwd[2] * depth;
  const tl = [cx - right[0] * halfW, cy + halfH, cz - right[2] * halfW];
  const tr = [cx + right[0] * halfW, cy + halfH, cz + right[2] * halfW];
  const br = [cx + right[0] * halfW, cy - halfH, cz + right[2] * halfW];
  const bl = [cx - right[0] * halfW, cy - halfH, cz - right[2] * halfW];
  let g = groups.get(frame.index);
  if (!g) {
    g = { frameIndex: frame.index, positions: [], uvs: [] };
    groups.set(frame.index, g);
  }
  pushTri(g, bl, br, tr, [0, 0], [1, 0], [1, 1]);
  pushTri(g, bl, tr, tl, [0, 0], [1, 1], [0, 1]);
}

/**
 * Recinto (piso/techo/paredes) con fotos proyectadas.
 * frames: { index, pose, intrinsics }[]
 */
export function buildPhotoRoom(frames, { displayDeg = 90 } = {}) {
  const usable = (frames || []).filter((f) => f?.pose && f.intrinsics);
  if (usable.length < 3) return { ok: false, groups: [] };

  const ys = usable.map((f) => num(f.pose.ty));
  const floorY = median(ys) - PHONE_H;
  const ceilY = floorY + CEIL_H;
  const footprint = [];
  for (const f of usable) {
    footprint.push({ x: num(f.pose.tx), y: num(f.pose.tz) });
    const intr = f.intrinsics;
    for (const d of LOOK_DEPTHS) {
      const p = unproject(f.pose, intr, num(intr.cx), num(intr.cy), d);
      footprint.push({ x: p[0], y: p[2] });
      const left = unproject(f.pose, intr, num(intr.cx) - num(intr.width) * 0.28, num(intr.cy), d);
      const right = unproject(f.pose, intr, num(intr.cx) + num(intr.width) * 0.28, num(intr.cy), d);
      footprint.push({ x: left[0], y: left[2] }, { x: right[0], y: right[2] });
    }
  }
  let hull = convexHullXZ(footprint);
  if (hull.length < 3) {
    const xs = footprint.map((p) => p.x);
    const zs = footprint.map((p) => p.y);
    const pad = 1.2;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minZ = Math.min(...zs) - pad;
    const maxZ = Math.max(...zs) + pad;
    hull = [
      { x: minX, y: minZ },
      { x: maxX, y: minZ },
      { x: maxX, y: maxZ },
      { x: minX, y: maxZ }
    ];
  }

  const groups = new Map();
  const ring = hull.length;
  for (let i = 1; i < ring - 1; i++) {
    addSolidTri(
      groups,
      [hull[0].x, floorY, hull[0].y],
      [hull[i].x, floorY, hull[i].y],
      [hull[i + 1].x, floorY, hull[i + 1].y],
      '#3a3128'
    );
    addSolidTri(
      groups,
      [hull[0].x, ceilY, hull[0].y],
      [hull[i + 1].x, ceilY, hull[i + 1].y],
      [hull[i].x, ceilY, hull[i].y],
      '#1a222c'
    );
  }
  for (let i = 0; i < ring; i++) {
    const nxt = hull[(i + 1) % ring];
    const p = hull[i];
    addSolidQuad(
      groups,
      [p.x, floorY, p.y],
      [nxt.x, floorY, nxt.y],
      [nxt.x, ceilY, nxt.y],
      [p.x, ceilY, p.y],
      '#243041'
    );
  }
  for (const f of pickPanels(usable)) {
    addPhotoPanel(groups, f, 1.55);
  }

  const first = usable[0].pose;
  const fwd = lookDir(first);
  return {
    ok: groups.size > 0,
    kind: 'photo_room',
    floorY,
    ceilY,
    start: {
      x: num(first.tx),
      y: num(first.ty),
      z: num(first.tz),
      tx: num(first.tx) + fwd[0] * 1.4,
      ty: num(first.ty) + fwd[1] * 1.4,
      tz: num(first.tz) + fwd[2] * 1.4
    },
    groups: [...groups.values()].map((g) => ({
      frameIndex: g.frameIndex,
      color: g.color || null,
      positions: g.positions.map((v) => +Number(v).toFixed(3)),
      uvs: g.uvs
    }))
  };
}

export function attachRoomToWeld(weld, frames, opts) {
  const room = buildPhotoRoom(frames, opts);
  if (!weld) return { ok: room.ok, points: [], voxels: [], room };
  weld.room = room;
  if (room.ok) weld.ok = true;
  return weld;
}
