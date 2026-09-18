"""Malla texturizada: Delaunay 2D por foto sobre puntos COLMAP → GLB."""

from __future__ import annotations

import json
import math
import struct
from collections import defaultdict
from io import BytesIO
from pathlib import Path



def _pad4(n):
    return (4 - (n % 4)) % 4


def _num(v, fallback=0.0):
    try:
        n = float(v)
        return n if math.isfinite(n) else fallback
    except (TypeError, ValueError):
        return fallback


def parse_points3d(path: Path):
    pts = {}
    if not path.is_file():
        return pts
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        p = line.split()
        if len(p) < 7:
            continue
        pid = int(p[0])
        pts[pid] = (_num(p[1]), _num(p[2]), _num(p[3]))
    return pts


def parse_images_with_obs(path: Path):
    """[(name, [(u, v, point3d_id), ...]), ...]"""
    out = []
    if not path.is_file():
        return out
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        i += 1
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 10:
            continue
        name = parts[9]
        obs = []
        if i < len(lines):
            pts2 = lines[i].split()
            i += 1
            for k in range(0, len(pts2) - 2, 3):
                pid = int(float(pts2[k + 2]))
                if pid < 0:
                    continue
                obs.append((_num(pts2[k]), _num(pts2[k + 1]), pid))
        out.append((name, obs))
    return out


def _circumscribed(ax, ay, bx, by, cx, cy):
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-12:
        return None
    ax2, ay2 = ax * ax + ay * ay, ay
    bx2 = bx * bx + by * by
    cx2 = cx * cx + cy * cy
    ux = (ax2 * (by - cy) + bx2 * (cy - ay) + cx2 * (ay - by)) / d
    uy = (ax2 * (cx - bx) + bx2 * (ax - cx) + cx2 * (bx - ax)) / d
    r2 = (ux - ax) ** 2 + (uy - ay) ** 2
    return ux, uy, r2


def delaunay2d(pts):
    """pts: [(x, y, key), ...] → triangles as (i, j, k) índices en pts."""
    n = len(pts)
    if n < 3:
        return []
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    dx = max(maxx - minx, 1.0)
    dy = max(maxy - miny, 1.0)
    cx = (minx + maxx) / 2
    cy = (miny + maxy) / 2
    d = max(dx, dy) * 10
    super_pts = [
        (cx - d, cy - d, None),
        (cx + d, cy - d, None),
        (cx, cy + d, None),
    ]
    all_pts = list(pts) + super_pts
    si = n
    tris = [(si, si + 1, si + 2)]

    for i in range(n):
        px, py = all_pts[i][0], all_pts[i][1]
        bad = []
        for t in tris:
            circ = _circumscribed(
                all_pts[t[0]][0],
                all_pts[t[0]][1],
                all_pts[t[1]][0],
                all_pts[t[1]][1],
                all_pts[t[2]][0],
                all_pts[t[2]][1],
            )
            if circ and (px - circ[0]) ** 2 + (py - circ[1]) ** 2 <= circ[2] + 1e-9:
                bad.append(t)
        edges = []
        for t in bad:
            for e in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                a, b = (e if e[0] < e[1] else (e[1], e[0]))
                edges.append((a, b))
        tris = [t for t in tris if t not in bad]
        counts = defaultdict(int)
        for e in edges:
            counts[e] += 1
        for a, b in counts:
            if counts[(a, b)] == 1:
                tris.append((a, b, i))

    keep = []
    super_set = {n, n + 1, n + 2}
    for t in tris:
        if t[0] in super_set or t[1] in super_set or t[2] in super_set:
            continue
        keep.append(t)
    return keep


def _dist3(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def frame_index(name):
    stem = Path(name).stem
    return int(stem) if stem.isdigit() else 10**9


def pick_in_order(images, max_images=32, min_obs=6):
    """Keyframe en orden de captura, no por cantidad de puntos."""
    usable = [(n, o) for n, o in images if len(o) >= min_obs]
    usable.sort(key=lambda x: frame_index(x[0]))
    if not usable:
        return []
    if len(usable) <= max_images:
        return usable
    out = []
    last = None
    for i in range(max_images):
        idx = round(i * (len(usable) - 1) / max(max_images - 1, 1))
        if last == idx:
            continue
        out.append(usable[idx])
        last = idx
    return out


def _obs_ids(obs):
    return {pid for _u, _v, pid in obs}


def _tri_ok_2d(pa, pb, pc, max_edge_px):
    d01 = math.hypot(pb[0] - pa[0], pb[1] - pa[1])
    d12 = math.hypot(pc[0] - pb[0], pc[1] - pb[1])
    d20 = math.hypot(pa[0] - pc[0], pa[1] - pc[1])
    if max(d01, d12, d20) > max_edge_px:
        return False
    area = abs((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1])) * 0.5
    return area >= 28


def build_textured_glb(sparse_txt: Path, images_dir: Path, max_images=32, max_edge_m=0.42):
    points = parse_points3d(sparse_txt / "points3D.txt")
    images = parse_images_with_obs(sparse_txt / "images.txt")
    if not points or not images:
        raise ValueError("NO_COLMAP_TXT")

    picked = pick_in_order(images, max_images=max_images)
    if not picked:
        raise ValueError("NO_IMAGE_OBS")

    bin_parts = []
    views = []
    accessors = []
    images_gltf = []
    textures = []
    materials = []
    primitives = []
    face_count = 0
    vert_count = 0
    claimed = set()

    def add_blob(data, target=None):
        off = sum(len(p) for p in bin_parts)
        pad = b"\x00" * _pad4(len(data))
        bin_parts.append(data + pad)
        view = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target is not None:
            view["target"] = target
        views.append(view)
        return len(views) - 1

    for i, (name, obs) in enumerate(picked):
        jpg = images_dir / name
        if not jpg.is_file():
            continue
        neigh = set()
        if i:
            neigh |= _obs_ids(picked[i - 1][1])
        if i + 1 < len(picked):
            neigh |= _obs_ids(picked[i + 1][1])
        seq = [(u, v, pid) for u, v, pid in obs if pid in neigh and pid not in claimed]
        if len(seq) < 8:
            seq = [(u, v, pid) for u, v, pid in obs if pid not in claimed]
        unique = {}
        pts2 = []
        for u, v, pid in seq:
            if pid not in points or pid in unique:
                continue
            unique[pid] = len(pts2)
            pts2.append((u, v, pid))
        if len(pts2) < 8:
            continue
        from PIL import Image

        im = Image.open(jpg).convert("RGB")
        w, h = im.size
        max_edge_px = max(w, h) * 0.32
        tris = delaunay2d(pts2)
        good = []
        for a, b, c in tris:
            pa, pb, pc = points[pts2[a][2]], points[pts2[b][2]], points[pts2[c][2]]
            if max(_dist3(pa, pb), _dist3(pb, pc), _dist3(pc, pa)) > max_edge_m:
                continue
            if not _tri_ok_2d(pts2[a], pts2[b], pts2[c], max_edge_px):
                continue
            good.append((a, b, c))
        if len(good) < 3:
            continue
        for a, b, c in good:
            claimed.add(pts2[a][2])
            claimed.add(pts2[b][2])
            claimed.add(pts2[c][2])

        bio = BytesIO()
        im.save(bio, format="JPEG", quality=80)
        jpeg_bytes = bio.getvalue()

        pos = []
        uvs = []
        remap = {}
        idx = []
        for a, b, c in good:
            for src in (a, b, c):
                if src not in remap:
                    remap[src] = len(remap)
                    xyz = points[pts2[src][2]]
                    pos.extend(xyz)
                    uvs.extend((pts2[src][0] / max(w, 1), pts2[src][1] / max(h, 1)))
                idx.append(remap[src])

        pos_b = struct.pack("<" + "f" * len(pos), *pos)
        uv_b = struct.pack("<" + "f" * len(uvs), *uvs)
        idx_b = struct.pack("<" + "H" * len(idx), *idx)
        pv = add_blob(pos_b, 34962)
        uvv = add_blob(uv_b, 34962)
        iv = add_blob(idx_b, 34963)
        xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
        accessors.append(
            {
                "bufferView": pv,
                "componentType": 5126,
                "count": len(pos) // 3,
                "type": "VEC3",
                "min": [min(xs), min(ys), min(zs)],
                "max": [max(xs), max(ys), max(zs)],
            }
        )
        accessors.append({"bufferView": uvv, "componentType": 5126, "count": len(uvs) // 2, "type": "VEC2"})
        accessors.append({"bufferView": iv, "componentType": 5123, "count": len(idx), "type": "SCALAR"})
        ai = len(accessors)
        img_view = add_blob(jpeg_bytes)
        img_i = len(images_gltf)
        images_gltf.append({"bufferView": img_view, "mimeType": "image/jpeg"})
        textures.append({"source": img_i})
        mat_i = len(materials)
        materials.append(
            {
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": img_i},
                    "metallicFactor": 0,
                    "roughnessFactor": 1,
                },
                "doubleSided": True,
            }
        )
        primitives.append(
            {
                "attributes": {"POSITION": ai - 3, "TEXCOORD_0": ai - 2},
                "indices": ai - 1,
                "material": mat_i,
                "mode": 4,
            }
        )
        face_count += len(good)
        vert_count += len(pos) // 3

    if not primitives:
        raise ValueError("NO_TEXTURED_TRIS")

    bin_blob = b"".join(bin_parts)
    gltf = {
        "asset": {"version": "2.0", "generator": "ainspecciona-scan-recon"},
        "buffers": [{"byteLength": len(bin_blob)}],
        "bufferViews": views,
        "accessors": accessors,
        "images": images_gltf,
        "textures": textures,
        "materials": materials,
        "meshes": [{"primitives": primitives}],
        "nodes": [{"mesh": 0}],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
    }
    json_b = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_b += b" " * _pad4(len(json_b))
    total = 12 + 8 + len(json_b) + 8 + len(bin_blob)
    header = struct.pack("<4sII", b"glTF", 2, total)
    return header + struct.pack("<I4s", len(json_b), b"JSON") + json_b + struct.pack("<I4s", len(bin_blob), b"BIN\x00") + bin_blob, {
        "vertexCount": vert_count,
        "faceCount": face_count,
        "kind": "colmap_textured",
        "imageCount": len(primitives),
    }
