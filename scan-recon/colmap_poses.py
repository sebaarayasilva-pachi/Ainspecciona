"""ARCore (OpenGL, cam→world) → COLMAP (OpenCV, world→cam)."""

from __future__ import annotations

import math


def _num(v, fallback=0.0):
    try:
        n = float(v)
        return n if math.isfinite(n) else fallback
    except (TypeError, ValueError):
        return fallback


def quat_to_mat(qx, qy, qz, qw):
    x, y, z, w = qx, qy, qz, qw
    return (
        (
            1 - 2 * (y * y + z * z),
            2 * (x * y - z * w),
            2 * (x * z + y * w),
        ),
        (
            2 * (x * y + z * w),
            1 - 2 * (x * x + z * z),
            2 * (y * z - x * w),
        ),
        (
            2 * (x * z - y * w),
            2 * (y * z + x * w),
            1 - 2 * (x * x + y * y),
        ),
    )


def mat_mul(a, b):
    return tuple(
        tuple(a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j] for j in range(3))
        for i in range(3)
    )


def mat_t(r):
    return (
        (r[0][0], r[1][0], r[2][0]),
        (r[0][1], r[1][1], r[2][1]),
        (r[0][2], r[1][2], r[2][2]),
    )


def mat_vec(r, v):
    return (
        r[0][0] * v[0] + r[0][1] * v[1] + r[0][2] * v[2],
        r[1][0] * v[0] + r[1][1] * v[1] + r[1][2] * v[2],
        r[2][0] * v[0] + r[2][1] * v[1] + r[2][2] * v[2],
    )


def mat_to_quat(r):
    m00, m01, m02 = r[0]
    m10, m11, m12 = r[1]
    m20, m21, m22 = r[2]
    tr = m00 + m11 + m22
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        qw = 0.25 * s
        qx = (m21 - m12) / s
        qy = (m02 - m20) / s
        qz = (m10 - m01) / s
    elif m00 > m11 and m00 > m22:
        s = math.sqrt(1.0 + m00 - m11 - m22) * 2
        qw = (m21 - m12) / s
        qx = 0.25 * s
        qy = (m01 + m10) / s
        qz = (m02 + m20) / s
    elif m11 > m22:
        s = math.sqrt(1.0 + m11 - m00 - m22) * 2
        qw = (m02 - m20) / s
        qx = (m01 + m10) / s
        qy = 0.25 * s
        qz = (m12 + m21) / s
    else:
        s = math.sqrt(1.0 + m22 - m00 - m11) * 2
        qw = (m10 - m01) / s
        qx = (m02 + m20) / s
        qy = (m12 + m21) / s
        qz = 0.25 * s
    n = math.sqrt(qw * qw + qx * qx + qy * qy + qz * qz) or 1.0
    if qw < 0:
        n = -n
    return qw / n, qx / n, qy / n, qz / n


# OpenGL cam (Y up, −Z forward) → COLMAP cam (Y down, +Z forward)
_S = ((1.0, 0.0, 0.0), (0.0, -1.0, 0.0), (0.0, 0.0, -1.0))


def arcore_to_colmap(pose):
    """Return (qw, qx, qy, qz, tx, ty, tz) world-to-camera for COLMAP images.txt."""
    R_gl = quat_to_mat(
        _num(pose.get("qx")),
        _num(pose.get("qy")),
        _num(pose.get("qz")),
        _num(pose.get("qw"), 1.0),
    )
    t_gl = (_num(pose.get("tx")), _num(pose.get("ty")), _num(pose.get("tz")))
    R_c2w = mat_mul(R_gl, _S)
    R_w2c = mat_t(R_c2w)
    t_w2c = mat_vec(R_w2c, (-t_gl[0], -t_gl[1], -t_gl[2]))
    qw, qx, qy, qz = mat_to_quat(R_w2c)
    return qw, qx, qy, qz, t_w2c[0], t_w2c[1], t_w2c[2]
