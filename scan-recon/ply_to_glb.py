"""PLY (ASCII o binary LE) → GLB con POINTS o TRIANGLES. Sin dependencias."""

from __future__ import annotations

import json
import struct
from pathlib import Path


def _pad4(n):
    return (4 - (n % 4)) % 4


def parse_ply(path):
    raw = Path(path).read_bytes()
    if raw[:3] != b"ply":
        raise ValueError("NOT_PLY")
    header_end = raw.find(b"end_header")
    if header_end < 0:
        raise ValueError("NO_HEADER")
    header_end = raw.find(b"\n", header_end) + 1
    header = raw[:header_end].decode("ascii", errors="replace").splitlines()
    fmt = "ascii"
    n_verts = 0
    n_faces = 0
    props = []
    section = None
    for line in header:
        p = line.strip().split()
        if not p:
            continue
        if p[0] == "format":
            fmt = p[1]
        elif p[0] == "element" and p[1] == "vertex":
            section = "vertex"
            n_verts = int(p[2])
            props = []
        elif p[0] == "element" and p[1] == "face":
            section = "face"
            n_faces = int(p[2])
        elif p[0] == "property" and section == "vertex":
            props.append((p[1], p[2]))
    body = raw[header_end:]
    verts = []
    faces = []
    if fmt == "ascii":
        lines = body.decode("utf-8", errors="replace").splitlines()
        i = 0
        for _ in range(n_verts):
            while i < len(lines) and not lines[i].strip():
                i += 1
            if i >= len(lines):
                break
            parts = lines[i].split()
            i += 1
            rec = {}
            for k, (typ, name) in enumerate(props):
                if k >= len(parts):
                    break
                rec[name] = float(parts[k]) if typ.startswith("float") or typ == "double" else int(float(parts[k]))
            verts.append(rec)
        for _ in range(n_faces):
            while i < len(lines) and not lines[i].strip():
                i += 1
            if i >= len(lines):
                break
            parts = lines[i].split()
            i += 1
            n = int(parts[0])
            faces.append([int(x) for x in parts[1 : 1 + n]])
    elif fmt in ("binary_little_endian", "binary"):
        off = 0
        sizes = {
            "float": 4,
            "float32": 4,
            "double": 8,
            "float64": 8,
            "uchar": 1,
            "uint8": 1,
            "char": 1,
            "int": 4,
            "int32": 4,
            "uint": 4,
            "uint32": 4,
            "ushort": 2,
            "uint16": 2,
        }
        packs = {
            "float": "<f",
            "float32": "<f",
            "double": "<d",
            "float64": "<d",
            "uchar": "<B",
            "uint8": "<B",
            "char": "<b",
            "int": "<i",
            "int32": "<i",
            "uint": "<I",
            "uint32": "<I",
            "ushort": "<H",
            "uint16": "<H",
        }
        for _ in range(n_verts):
            rec = {}
            for typ, name in props:
                n = sizes[typ]
                rec[name] = struct.unpack(packs[typ], body[off : off + n])[0]
                off += n
            verts.append(rec)
        for _ in range(n_faces):
            n = body[off]
            off += 1
            idx = struct.unpack("<" + "I" * n, body[off : off + 4 * n])
            off += 4 * n
            faces.append(list(idx))
    else:
        raise ValueError(f"PLY_FORMAT {fmt}")
    return verts, faces


def ply_to_glb_bytes(path):
    verts, faces = parse_ply(path)
    if not verts:
        raise ValueError("EMPTY_PLY")
    pos = []
    col = []
    for v in verts:
        pos.extend((float(v.get("x", 0)), float(v.get("y", 0)), float(v.get("z", 0))))
        r = v.get("red", v.get("r", 200))
        g = v.get("green", v.get("g", 200))
        b = v.get("blue", v.get("b", 200))
        col.extend((float(r) / 255.0, float(g) / 255.0, float(b) / 255.0))
    pos_b = struct.pack("<" + "f" * len(pos), *pos)
    col_b = struct.pack("<" + "f" * len(col), *col)
    have_faces = any(len(f) >= 3 for f in faces)
    idx_b = b""
    if have_faces:
        idx = []
        for f in faces:
            if len(f) == 3:
                idx.extend(f)
            elif len(f) == 4:
                idx.extend((f[0], f[1], f[2], f[0], f[2], f[3]))
        idx_b = struct.pack("<" + "I" * len(idx), *idx)
    bin_blob = pos_b + col_b + idx_b
    bin_blob += b"\x00" * _pad4(len(bin_blob))

    xs = pos[0::3]
    ys = pos[1::3]
    zs = pos[2::3]
    min_p = [min(xs), min(ys), min(zs)]
    max_p = [max(xs), max(ys), max(zs)]
    views = [
        {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_b), "target": 34962},
        {"buffer": 0, "byteOffset": len(pos_b), "byteLength": len(col_b), "target": 34962},
    ]
    accessors = [
        {
            "bufferView": 0,
            "componentType": 5126,
            "count": len(verts),
            "type": "VEC3",
            "min": min_p,
            "max": max_p,
        },
        {"bufferView": 1, "componentType": 5126, "count": len(verts), "type": "VEC3"},
    ]
    prim = {
        "attributes": {"POSITION": 0, "COLOR_0": 1},
        "mode": 4 if have_faces else 0,
    }
    if have_faces:
        views.append({"buffer": 0, "byteOffset": len(pos_b) + len(col_b), "byteLength": len(idx_b), "target": 34963})
        accessors.append({"bufferView": 2, "componentType": 5125, "count": len(idx_b) // 4, "type": "SCALAR"})
        prim["indices"] = 2
    gltf = {
        "asset": {"version": "2.0", "generator": "ainspecciona-scan-recon"},
        "buffers": [{"byteLength": len(bin_blob)}],
        "bufferViews": views,
        "accessors": accessors,
        "meshes": [{"primitives": [prim]}],
        "nodes": [{"mesh": 0}],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
    }
    json_b = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_b += b" " * _pad4(len(json_b))
    total = 12 + 8 + len(json_b) + 8 + len(bin_blob)
    header = struct.pack("<4sII", b"glTF", 2, total)
    jchunk = struct.pack("<I4s", len(json_b), b"JSON") + json_b
    bchunk = struct.pack("<I4s", len(bin_blob), b"BIN\x00") + bin_blob
    return header + jchunk + bchunk, {
        "vertexCount": len(verts),
        "faceCount": len(faces),
        "kind": "colmap_mesh" if have_faces else "colmap_cloud",
    }
