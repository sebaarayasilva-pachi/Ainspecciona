/** ARCore (OpenGL, cam→world) → COLMAP (OpenCV, world→cam). */

export function quatToMat3(q) {
  const x = Number(q.qx) || 0;
  const y = Number(q.qy) || 0;
  const z = Number(q.qz) || 0;
  const w = Number.isFinite(Number(q.qw)) ? Number(q.qw) : 1;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]
  ];
}

function mul(a, b) {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
}

function transpose(r) {
  return [
    [r[0][0], r[1][0], r[2][0]],
    [r[0][1], r[1][1], r[2][1]],
    [r[0][2], r[1][2], r[2][2]]
  ];
}

function mulVec(r, v) {
  return [
    r[0][0] * v[0] + r[0][1] * v[1] + r[0][2] * v[2],
    r[1][0] * v[0] + r[1][1] * v[1] + r[1][2] * v[2],
    r[2][0] * v[0] + r[2][1] * v[1] + r[2][2] * v[2]
  ];
}

export function matToQuat(r) {
  const m00 = r[0][0];
  const m01 = r[0][1];
  const m02 = r[0][2];
  const m10 = r[1][0];
  const m11 = r[1][1];
  const m12 = r[1][2];
  const m20 = r[2][0];
  const m21 = r[2][1];
  const m22 = r[2][2];
  const tr = m00 + m11 + m22;
  let qw;
  let qx;
  let qy;
  let qz;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    qw = 0.25 * s;
    qx = (m21 - m12) / s;
    qy = (m02 - m20) / s;
    qz = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  let n = Math.hypot(qw, qx, qy, qz) || 1;
  if (qw < 0) n = -n;
  return { qw: qw / n, qx: qx / n, qy: qy / n, qz: qz / n };
}

const S = [
  [1, 0, 0],
  [0, -1, 0],
  [0, 0, -1]
];

/** @returns {{ qw, qx, qy, qz, tx, ty, tz }} COLMAP images.txt pose */
export function arcoreToColmap(pose) {
  const Rgl = quatToMat3(pose || {});
  const t = [Number(pose?.tx) || 0, Number(pose?.ty) || 0, Number(pose?.tz) || 0];
  const Rc2w = mul(Rgl, S);
  const Rw2c = transpose(Rc2w);
  const tw2c = mulVec(Rw2c, [-t[0], -t[1], -t[2]]);
  const q = matToQuat(Rw2c);
  return { ...q, tx: tw2c[0], ty: tw2c[1], tz: tw2c[2] };
}

export function reconObjectKeys(orgId, scanId) {
  const prefix = `scans/${orgId}/${scanId}`;
  return {
    prefix,
    status: `${prefix}/recon/status.json`,
    result: `${prefix}/recon/result.json`,
    model: `${prefix}/model.glb`,
    packageZip: `${prefix}/package.zip`
  };
}

export function gcsObjectKey(path, bucket) {
  if (!path) return '';
  const p = String(path);
  if (p.startsWith('gs://')) {
    const rest = p.slice(5);
    const i = rest.indexOf('/');
    return i >= 0 ? rest.slice(i + 1) : '';
  }
  if (bucket) {
    const prefix = `https://storage.googleapis.com/${bucket}/`;
    if (p.startsWith(prefix)) return decodeURIComponent(p.slice(prefix.length));
  }
  return p.replace(/^[/\\]+/, '');
}
