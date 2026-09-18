#!/usr/bin/env python3
"""Cloud Run Job: package.zip + poses ARCore → COLMAP → model.glb en GCS."""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import traceback
import zipfile
from io import BytesIO
from pathlib import Path

from google.cloud import storage
from PIL import Image

from colmap_poses import arcore_to_colmap
from ply_to_glb import ply_to_glb_bytes

WORK = Path(os.environ.get("WORK_DIR", "/tmp/scan-recon"))
COLMAP = os.environ.get("COLMAP_BIN", "colmap")
MAX_FRAMES = int(os.environ.get("MAX_FRAMES", "160"))


def log(msg):
    print(msg, flush=True)


def env(name, default=""):
    return str(os.environ.get(name) or default).strip()


def gcs_key(path, bucket):
    if not path:
        return ""
    p = str(path)
    if p.startswith("gs://"):
        rest = p[5:]
        i = rest.find("/")
        return rest[i + 1 :] if i >= 0 else ""
    prefix = f"https://storage.googleapis.com/{bucket}/"
    if bucket and p.startswith(prefix):
        from urllib.parse import unquote

        return unquote(p[len(prefix) :])
    return p.lstrip("/\\")


def num(v, fallback=0.0):
    try:
        n = float(v)
        return n if n == n else fallback
    except (TypeError, ValueError):
        return fallback


class Gcs:
    def __init__(self, bucket_name):
        self.client = storage.Client()
        self.bucket = self.client.bucket(bucket_name)

    def download(self, key, dest: Path):
        dest.parent.mkdir(parents=True, exist_ok=True)
        self.bucket.blob(key).download_to_filename(str(dest))

    def upload_bytes(self, key, data, content_type):
        blob = self.bucket.blob(key)
        blob.cache_control = "no-store"
        blob.upload_from_string(data, content_type=content_type)

    def upload_file(self, local_path, key, content_type=None):
        blob = self.bucket.blob(key)
        blob.cache_control = "no-store"
        if content_type:
            blob.upload_from_filename(str(local_path), content_type=content_type)
        else:
            blob.upload_from_filename(str(local_path))

    def upload_json(self, key, obj):
        self.upload_bytes(key, json.dumps(obj).encode("utf-8"), "application/json")


def image_rotation_deg(manifest, frame):
    if manifest.get("imagesUpright") or frame.get("upright"):
        return 0
    explicit = frame.get("rotationDeg", manifest.get("imageRotationDeg"))
    try:
        if explicit is not None and float(explicit) != 0:
            return int(float(explicit)) % 360
    except (TypeError, ValueError):
        pass
    display = manifest.get("displayRotation")
    if display is None:
        display = (manifest.get("capture") or {}).get("displayRotation")
    try:
        display_deg = int(float(display)) if display is not None else 0
    except (TypeError, ValueError):
        display_deg = 0
    return (90 - display_deg + 360) % 360


def rotate_cw(im: Image.Image, deg):
    d = int(deg) % 360
    if not d:
        return im
    # Ubuntu 22.04: python3-pil no tiene Image.Transpose
    return im.rotate(-d, expand=True)


def rotate_intrinsics_cw(cam, deg):
    d = int(deg) % 360
    fx, fy, cx, cy = cam["fx"], cam["fy"], cam["cx"], cam["cy"]
    w, h = cam["width"], cam["height"]
    if d == 0:
        return dict(cam)
    if d == 90:
        return {"fx": fy, "fy": fx, "cx": h - cy, "cy": cx, "width": h, "height": w}
    if d == 180:
        return {"fx": fx, "fy": fy, "cx": w - cx, "cy": h - cy, "width": w, "height": h}
    if d == 270:
        return {"fx": fy, "fy": fx, "cx": cy, "cy": w - cx, "width": h, "height": w}
    raise RuntimeError(f"UNSUPPORTED_ROTATION {deg}")


def align_intrinsics_to_image(cam, img_w, img_h, manifest):
    """La app guarda los JPEG ya rotados a vertical pero declara los intrinsics en
    orientación de sensor. Sin alinearlos, point_triangulator aborta porque las
    dimensiones de cameras.txt no coinciden con las del archivo."""
    if (round(cam["width"]), round(cam["height"])) == (img_w, img_h):
        return cam
    display = num(manifest.get("displayRotation"))
    preferred = (90 - int(display) + 360) % 360
    for deg in (preferred, 90, 270, 180):
        cand = rotate_intrinsics_cw(cam, deg)
        if (round(cand["width"]), round(cand["height"])) == (img_w, img_h):
            log(f"intrinsics rotados {deg}deg para coincidir con el JPEG {img_w}x{img_h}")
            return cand
    raise RuntimeError(
        f"INTRINSICS_MISMATCH manifest={cam['width']}x{cam['height']} jpeg={img_w}x{img_h}"
    )


def zip_file(zf: zipfile.ZipFile, rel):
    rel = str(rel or "").replace("\\", "/").lstrip("/")
    if not rel:
        return None
    names = zf.namelist()
    if rel in names:
        return rel
    base = rel.split("/")[-1]
    for n in names:
        if n.replace("\\", "/").endswith("/" + base) or n.replace("\\", "/").endswith(base):
            if n.replace("\\", "/").split("/")[-1] == base:
                return n
    return None


def run(cmd, timeout=2400):
    log("+ " + " ".join(cmd))
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=timeout)
    if p.stdout:
        log(p.stdout[-8000:])
    if p.returncode != 0:
        raise RuntimeError(f"CMD_FAILED {' '.join(cmd[:4])} exit={p.returncode}")
    return p


def run_colmap(args, extra_flags=None, timeout=2400):
    cmd = [COLMAP, *args]
    if extra_flags:
        cmd.extend(extra_flags)
    try:
        return run(cmd, timeout=timeout)
    except RuntimeError:
        if extra_flags:
            log("retry without extra flags")
            return run([COLMAP, *args], timeout=timeout)
        raise


def write_known_model(db_path: Path, out_dir: Path, poses_by_name, camera):
    out_dir.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(db_path))
    cams = con.execute("SELECT camera_id FROM cameras").fetchall()
    imgs = con.execute("SELECT image_id, name, camera_id FROM images ORDER BY image_id").fetchall()
    con.close()
    if not imgs:
        raise RuntimeError("NO_FEATURES")
    cam_id = cams[0][0] if cams else 1
    fx, fy, cx, cy = camera["fx"], camera["fy"], camera["cx"], camera["cy"]
    w, h = int(camera["width"]), int(camera["height"])
    (out_dir / "cameras.txt").write_text(
        "# CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]\n"
        f"{cam_id} PINHOLE {w} {h} {fx} {fy} {cx} {cy}\n",
        encoding="utf-8",
    )
    lines = ["# IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME"]
    missing = []
    for image_id, name, cid in imgs:
        pose = poses_by_name.get(name)
        if not pose:
            missing.append(name)
            continue
        qw, qx, qy, qz, tx, ty, tz = arcore_to_colmap(pose)
        lines.append(f"{image_id} {qw} {qx} {qy} {qz} {tx} {ty} {tz} {cid or cam_id} {name}")
        lines.append("")
    if missing:
        raise RuntimeError("POSE_MISMATCH " + ",".join(missing[:8]))
    (out_dir / "images.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out_dir / "points3D.txt").write_text("# empty\n", encoding="utf-8")
    return len(imgs)


def convert_model_to_txt(sparse_dir: Path):
    if (sparse_dir / "images.bin").is_file():
        run_colmap(
            [
                "model_converter",
                "--input_path",
                str(sparse_dir),
                "--output_path",
                str(sparse_dir),
                "--output_type",
                "TXT",
            ]
        )

def parse_colmap_sparse(sparse_dir: Path):
    convert_model_to_txt(sparse_dir)
    images_txt = sparse_dir / "images.txt"
    points_txt = sparse_dir / "points3D.txt"
    
    registered_images = set()
    mean_error = 0.0
    
    if images_txt.is_file():
        lines = images_txt.read_text(encoding="utf-8", errors="replace").splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if not line or line.startswith("#"):
                i += 1
                continue
            parts = line.split()
            if len(parts) >= 10:
                name = parts[9]
                i += 1
                if i < len(lines):
                    pts_line = lines[i].strip()
                    pts_parts = pts_line.split()
                    has_3d = False
                    for j in range(2, len(pts_parts), 3):
                        if pts_parts[j] != "-1":
                            has_3d = True
                            break
                    if has_3d:
                        registered_images.add(name)
                    i += 1
            else:
                i += 1
            
    sparse_points = 0
    total_error = 0.0
    point_coords = []
    
    if points_txt.is_file():
        lines = points_txt.read_text(encoding="utf-8", errors="replace").splitlines()
        for line in lines:
            if not line.strip() or line.startswith("#"): continue
            sparse_points += 1
            parts = line.split()
            if len(parts) >= 8:
                # X, Y, Z are at indices 1, 2, 3
                point_coords.append([float(parts[1]), float(parts[2]), float(parts[3])])
                total_error += float(parts[7])
            
    if sparse_points > 0:
        mean_error = total_error / sparse_points
        
    return registered_images, sparse_points, mean_error, point_coords


def count_points3d(sparse: Path):
    txt = sparse / "points3D.txt"
    if txt.is_file():
        n = 0
        for line in txt.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.strip() and not line.startswith("#"):
                n += 1
        return n
    return 0


def main():
    bucket = env("GCS_BUCKET")
    org_id = env("ORG_ID")
    scan_id = env("SCAN_ID")
    package_path = env("PACKAGE_PATH")
    if not bucket or not org_id or not scan_id:
        raise SystemExit("Faltan GCS_BUCKET, ORG_ID o SCAN_ID")

    prefix = f"scans/{org_id}/{scan_id}"
    status_key = f"{prefix}/recon/status.json"
    result_key = f"{prefix}/recon/result.json"
    model_key = f"{prefix}/model.glb"
    pkg_key = gcs_key(package_path, bucket) or f"{prefix}/package.zip"

    gcs = Gcs(bucket)
    frames_meta = []

    def status(progress, step, **extra):
        payload = {"status": "PROCESSING", "progress": progress, "step": step, **extra}
        gcs.upload_json(status_key, payload)
        log(f"status {progress} {step}")

    try:
        WORK.mkdir(parents=True, exist_ok=True)
        images_dir = WORK / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        zip_path = WORK / "package.zip"
        status(8, "download")
        gcs.download(pkg_key, zip_path)

        status(15, "extract")
        with zipfile.ZipFile(zip_path) as zf:
            man_name = next((n for n in zf.namelist() if n.lower().endswith("manifest.json")), None)
            if not man_name:
                raise RuntimeError("NO_MANIFEST")
            manifest = json.loads(zf.read(man_name))
            raw_frames = list(manifest.get("frames") or [])[:MAX_FRAMES]
            if not raw_frames:
                raise RuntimeError("NO_FRAMES")
            poses_by_name = {}
            camera = None
            for f in raw_frames:
                rel = zip_file(zf, f.get("image") or f.get("imagePath") or "")
                if not rel:
                    continue
                idx = int(f.get("index") or (len(poses_by_name) + 1))
                name = f"{idx:06d}.jpg"
                data = zf.read(rel)
                (images_dir / name).write_bytes(data)
                pose = f.get("pose") or {}
                poses_by_name[name] = pose
                if camera is None:
                    inn = f.get("intrinsics") or {}
                    camera = {
                        "fx": num(inn.get("fx"), 500),
                        "fy": num(inn.get("fy"), 500),
                        "cx": num(inn.get("cx"), 320),
                        "cy": num(inn.get("cy"), 240),
                        "width": num(inn.get("width"), 640),
                        "height": num(inn.get("height"), 480),
                    }
                    img_w, img_h = Image.open(BytesIO(data)).size
                    camera = align_intrinsics_to_image(camera, img_w, img_h, manifest)
                deg = image_rotation_deg(manifest, f)
                im = Image.open(BytesIO(data)).convert("RGB")
                im = rotate_cw(im, deg)
                buf = BytesIO()
                im.save(buf, format="JPEG", quality=82)
                frame_key = f"{prefix}/frames/{name}"
                gcs.upload_bytes(frame_key, buf.getvalue(), "image/jpeg")
                frames_meta.append(
                    {
                        "index": idx,
                        "storageKey": frame_key,
                        "pose": {
                            "tx": num(pose.get("tx")),
                            "ty": num(pose.get("ty")),
                            "tz": num(pose.get("tz")),
                            "qx": num(pose.get("qx")),
                            "qy": num(pose.get("qy")),
                            "qz": num(pose.get("qz")),
                            "qw": num(pose.get("qw"), 1),
                        },
                        "upright": True,
                    }
                )

        if not poses_by_name or not camera:
            raise RuntimeError("NO_IMAGES")

        db = WORK / "database.db"
        if db.exists():
            db.unlink()
        params = f"{camera['fx']},{camera['fy']},{camera['cx']},{camera['cy']}"
        status(30, "features", frames=len(poses_by_name))
        run_colmap(
            [
                "feature_extractor",
                "--database_path",
                str(db),
                "--image_path",
                str(images_dir),
                "--ImageReader.single_camera",
                "1",
                "--ImageReader.camera_model",
                "PINHOLE",
                "--ImageReader.camera_params",
                params,
            ],
            extra_flags=["--SiftExtraction.use_gpu", "0", "--SiftExtraction.first_octave", "0"],
        )

        status(50, "match")
        # Recorrido continuo: sequential escala mejor que exhaustive (160 fotos).
        run_colmap(
            ["sequential_matcher", "--database_path", str(db)],
            extra_flags=[
                "--SiftMatching.use_gpu",
                "0",
                "--SequentialMatching.overlap",
                "16",
                "--SequentialMatching.quadratic_overlap",
                "1",
            ],
        )

        known = WORK / "sparse_known"
        sparse = WORK / "sparse"
        sparse.mkdir(parents=True, exist_ok=True)
        n_img = write_known_model(db, known, poses_by_name, camera)
        status(65, "triangulate", images=n_img)
        
        # Try point_triangulator first (using ARCore poses)
        try:
            run_colmap(
                [
                    "point_triangulator",
                    "--database_path",
                    str(db),
                    "--image_path",
                    str(images_dir),
                    "--input_path",
                    str(known),
                    "--output_path",
                    str(sparse),
                    "--Mapper.tri_ignore_two_view_tracks",
                    "0",
                ]
            )
            
            # Check if triangulation actually registered any images
            registered, _, _, _ = parse_colmap_sparse(sparse)
            if len(registered) == 0:
                raise RuntimeError("Triangulation failed to register any images")
                
        except Exception as e:
            log(f"Triangulation with ARCore poses failed or registered 0 images: {e}")
            log("Falling back to full mapper (ignoring ARCore poses)...")
            
            # Fallback to full mapper which estimates poses from scratch
            run_colmap(
                [
                    "mapper",
                    "--database_path",
                    str(db),
                    "--image_path",
                    str(images_dir),
                    "--output_path",
                    str(sparse)
                ]
            )
            
            # Mapper creates subdirectories (0, 1, etc.) for each sub-model
            # We need to find the largest one and use it as our sparse model
            sub_models = [d for d in sparse.iterdir() if d.is_dir() and d.name.isdigit()]
            if sub_models:
                # Sort by number of images (roughly estimated by size or just take '0' which is usually largest)
                best_model = sorted(sub_models, key=lambda d: len(list(d.glob("*"))), reverse=True)[0]
                log(f"Using sub-model {best_model.name} from mapper")
                # Move files from best_model to sparse
                for f in best_model.glob("*"):
                    f.rename(sparse / f.name)

        ply = WORK / "cloud.ply"
        status(80, "export")
        run_colmap(
            [
                "model_converter",
                "--input_path",
                str(sparse),
                "--output_path",
                str(ply),
                "--output_type",
                "PLY",
            ]
        )
        if not ply.is_file():
            # algunas builds escriben cloud.ply dentro del dir
            cand = next(sparse.glob("*.ply"), None)
            if cand:
                ply = cand
        if not ply.is_file():
            raise RuntimeError("NO_PLY")

        status(86, "build_cloud")
        glb, meta = ply_to_glb_bytes(ply)
        gcs.upload_bytes(model_key, glb, "model/gltf-binary")
        
        registered_images, sparse_points, mean_error, point_coords = parse_colmap_sparse(sparse)

        # Subir los archivos de COLMAP a GCS para que el job de Splatting los pueda usar
        status(88, "upload_colmap_data")
        colmap_prefix = f"scans/{org_id}/{scan_id}/recon/colmap"
        
        # Subir imágenes
        for img_file in images_dir.glob("*.jpg"):
            gcs.upload_file(img_file, f"{colmap_prefix}/images/{img_file.name}", "image/jpeg")
            
        # Subir sparse model (cameras.txt, images.txt, points3D.txt)
        for txt_file in sparse.glob("*.txt"):
            gcs.upload_file(txt_file, f"{colmap_prefix}/sparse/0/{txt_file.name}", "text/plain")
        
        for f in frames_meta:
            name = f"{f['index']:06d}.jpg"
            f["registered"] = name in registered_images

        # Plane detection using RANSAC
        detected_planes = []
        if len(point_coords) > 10:
            try:
                import numpy as np
                from plane_detection import detect_planes_ransac, classify_plane
                
                points_np = np.array(point_coords)
                # Detect up to 6 planes (floor, ceiling, 4 walls)
                planes, _ = detect_planes_ransac(points_np, distance_threshold=0.1, num_planes=6)
                
                # Up vector in COLMAP is usually -Y or +Y depending on how we fed the poses
                # ARCore gravity is -Y, but we mapped it. Let's assume +Y is up for now based on our alignment
                up_vector = np.array([0, 1, 0])
                
                for p in planes:
                    eq = p['equation']
                    normal = eq[:3]
                    classification = classify_plane(normal, up_vector)
                    
                    # Calculate coverage / size of the plane
                    inliers = np.array(p['inliers'])
                    inlier_points = points_np[inliers]
                    
                    # Simple bounding box for the plane
                    min_bounds = np.min(inlier_points, axis=0).tolist()
                    max_bounds = np.max(inlier_points, axis=0).tolist()
                    
                    # Calculate approximate area (bounding box on the plane)
                    centroid = np.mean(inlier_points, axis=0)
                    centered = inlier_points - centroid
                    _, _, vh = np.linalg.svd(centered)
                    proj_2d = np.dot(centered, vh[:2].T)
                    min_2d = np.min(proj_2d, axis=0)
                    max_2d = np.max(proj_2d, axis=0)
                    area = float((max_2d[0] - min_2d[0]) * (max_2d[1] - min_2d[1]))
                    
                    detected_planes.append({
                        "equation": eq,
                        "classification": classification,
                        "inlierCount": len(inliers),
                        "minBounds": min_bounds,
                        "maxBounds": max_bounds,
                        "area": area
                    })
            except Exception as e:
                log(f"Plane detection failed: {e}")

        point_count = meta["vertexCount"] or count_points3d(sparse)
        
        diagnostic = {
            "totalFrames": len(manifest.get("frames") or []) if 'manifest' in locals() else len(frames_meta),
            "acceptedFrames": len(poses_by_name),
            "registeredFrames": min(len(registered_images), len(poses_by_name)),
            "registrationRatio": min(len(registered_images), len(poses_by_name)) / len(poses_by_name) if len(poses_by_name) > 0 else 0,
            "meanReprojectionError": mean_error,
            "sparsePoints": sparse_points,
            "planes": detected_planes
        }

        result = {
            "status": "READY",
            "progress": 100,
            "modelType": "GLB",
            "modelKey": model_key,
            "kind": meta["kind"],
            "pointCount": point_count,
            "faceCount": meta.get("faceCount") or 0,
            "frames": frames_meta,
            "alignment": {"up": {"x": 0, "y": 1, "z": 0}},
            "diagnostic": diagnostic,
        }
        gcs.upload_json(result_key, result)
        gcs.upload_json(status_key, {"status": "READY", "progress": 100, "step": "done", "pointCount": point_count})
        log(f"READY points={point_count} kind={meta['kind']}")
    except Exception as exc:
        err = str(exc)[:400]
        log("FAILED " + err)
        traceback.print_exc()
        fail = {
            "status": "FAILED",
            "progress": 0,
            "step": "error",
            "error": err,
            "frames": frames_meta,
        }
        try:
            gcs.upload_json(status_key, fail)
            gcs.upload_json(result_key, fail)
        except Exception:
            log("could not write fail status")
        sys.exit(1)


if __name__ == "__main__":
    main()
