/** Cámara ARCore: +X derecha, +Y arriba, mira −Z. Píxel (0,0) arriba-izquierda. */

export function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function quatToMat(q) {
  const x = num(q.qx);
  const y = num(q.qy);
  const z = num(q.qz);
  const w = num(q.qw, 1);
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y)
  ];
}

export function matT(R) {
  return [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
}

export function mulMatVec(R, v) {
  return [
    R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
    R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
    R[6] * v[0] + R[7] * v[1] + R[8] * v[2]
  ];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function len(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

export function norm(v) {
  const n = len(v) || 1;
  return scale(v, 1 / n);
}

export function poseT(pose) {
  return [num(pose.tx), num(pose.ty), num(pose.tz)];
}

/** P_world = R * P_cam + t */
export function camToWorld(pose, pCam) {
  return add(mulMatVec(quatToMat(pose), pCam), poseT(pose));
}

export function worldToCam(pose, pWorld) {
  return mulMatVec(matT(quatToMat(pose)), sub(pWorld, poseT(pose)));
}

export function scaleIntrinsics(intr, newW, newH) {
  const w = num(intr.width, 1);
  const h = num(intr.height, 1);
  const sx = newW / w;
  const sy = newH / h;
  return {
    fx: num(intr.fx) * sx,
    fy: num(intr.fy) * sy,
    cx: num(intr.cx) * sx,
    cy: num(intr.cy) * sy,
    width: newW,
    height: newH
  };
}

export function rotateIntrinsics(intr, deg) {
  const d = ((num(deg) % 360) + 360) % 360;
  const fx = num(intr.fx);
  const fy = num(intr.fy);
  const cx = num(intr.cx);
  const cy = num(intr.cy);
  const w = num(intr.width);
  const h = num(intr.height);
  if (d === 90) return { fx: fy, fy: fx, cx: cy, cy: w - 1 - cx, width: h, height: w };
  if (d === 180) return { fx, fy, cx: w - 1 - cx, cy: h - 1 - cy, width: w, height: h };
  if (d === 270) return { fx: fy, fy: fx, cx: h - 1 - cy, cy: cx, width: h, height: w };
  return { fx, fy, cx, cy, width: w, height: h };
}

/** Profundidad óptica d > 0 (metros) → punto mundo. */
export function unproject(pose, intr, u, v, depth) {
  const x = (u - num(intr.cx)) / num(intr.fx, 1);
  const y = -((v - num(intr.cy)) / num(intr.fy, 1));
  return camToWorld(pose, [x * depth, y * depth, -depth]);
}

export function project(pose, intr, pWorld) {
  const p = worldToCam(pose, pWorld);
  const z = -p[2];
  if (z < 0.05) return null;
  return {
    u: num(intr.fx) * (p[0] / z) + num(intr.cx),
    v: num(intr.fy) * (-p[1] / z) + num(intr.cy),
    z
  };
}

export function cameraDistance(a, b) {
  return len(sub(poseT(a), poseT(b)));
}
