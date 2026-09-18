import os
import sys
import json
import shutil
import subprocess
from pathlib import Path
from google.cloud import storage
import trimesh

def env(key):
    return os.environ.get(key)

def log(msg):
    print(f"[MESHING] {msg}", flush=True)

class Gcs:
    def __init__(self, bucket_name):
        self.client = storage.Client()
        self.bucket = self.client.bucket(bucket_name)

    def download_dir(self, prefix, local_dir):
        blobs = self.bucket.list_blobs(prefix=prefix)
        count = 0
        for blob in blobs:
            if blob.name.endswith('/'):
                continue
            rel_path = blob.name[len(prefix):].lstrip('/')
            local_path = Path(local_dir) / rel_path
            local_path.parent.mkdir(parents=True, exist_ok=True)
            blob.download_to_filename(str(local_path))
            count += 1
        return count

    def upload_file(self, local_path, blob_name):
        blob = self.bucket.blob(blob_name)
        blob.upload_from_filename(str(local_path))
        
    def upload_json(self, blob_name, data):
        blob = self.bucket.blob(blob_name)
        blob.upload_from_string(json.dumps(data), content_type="application/json")

def run_cmd(cmd, cwd=None):
    log(f"Running: {' '.join(cmd)}")
    try:
        subprocess.run(cmd, cwd=cwd, check=True)
    except subprocess.CalledProcessError as e:
        log(f"Error command: {e}")
        raise

def main():
    bucket_name = env("GCS_BUCKET")
    org_id = env("ORG_ID")
    scan_id = env("SCAN_ID")
    
    if not bucket_name or not org_id or not scan_id:
        raise SystemExit("Faltan GCS_BUCKET, ORG_ID o SCAN_ID")

    prefix = f"scans/{org_id}/{scan_id}"
    colmap_prefix = f"{prefix}/recon/colmap"
    status_key = f"{prefix}/meshing_status.json"

    gcs = Gcs(bucket_name)
    
    def status(progress, step):
        gcs.upload_json(status_key, {"status": "TRAINING", "progress": progress, "step": step})
        log(f"status {progress} {step}")

    WORK = Path("/tmp/work")
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True)
    
    colmap_dir = WORK / "colmap"
    mvs_dir = WORK / "mvs"
    mvs_dir.mkdir(parents=True)
    
    status(10, "downloading_colmap_data")
    count = gcs.download_dir(colmap_prefix, colmap_dir)
    log(f"Descargados {count} archivos de COLMAP")
    
    if count == 0:
        raise RuntimeError("No se encontraron datos de COLMAP en GCS")

    # OpenMVS InterfaceCOLMAP expects the workspace folder to contain 'images' and 'sparse'
    # The colmap_dir from GCS should have 'images' and 'sparse/0'
    if not (colmap_dir / "sparse" / "cameras.txt").exists():
        if (colmap_dir / "sparse" / "0" / "cameras.txt").exists():
            for f in ["cameras.txt", "images.txt", "points3D.txt"]:
                if (colmap_dir / "sparse" / "0" / f).exists():
                    shutil.copy(colmap_dir / "sparse" / "0" / f, colmap_dir / "sparse" / f)
        else:
            raise RuntimeError("No se encontró cameras.txt en los datos de COLMAP")

    status(30, "converting_to_mvs")
    run_cmd([
        "InterfaceCOLMAP",
        "-i", str(colmap_dir),
        "-o", str(mvs_dir / "scene.mvs")
    ], cwd=str(mvs_dir))

    status(40, "densifying_point_cloud")
    # Los frames de ARCore son de 480x640, y --min-resolution ya vale 640, así que pedir
    # nivel 1 no submuestreaba nada: el clamp lo anulaba. Se pide nivel 0 para que la
    # intención quede explícita. Los valores van por env para calibrar sin redeployar.
    run_cmd([
        "DensifyPointCloud",
        "scene.mvs",
        "--resolution-level", env("MVS_RESOLUTION_LEVEL") or "0",
        "--number-views-fuse", env("MVS_VIEWS_FUSE") or "2"
    ], cwd=str(mvs_dir))

    status(60, "reconstructing_mesh")
    # La malla salía en islas flotantes por los defaults del paso de limpieza:
    # --max-edge-scale 2 borraba ~30k caras de arista larga, justo las que puentean las
    # zonas con pocos puntos, y --min-point-distance 1.5 descartaba puntos densos antes de
    # triangular. --free-space-support usa la visibilidad de las cámaras para vaciar el
    # interior, que es lo que cierra superficies poco representadas en escenas indoor.
    run_cmd([
        "ReconstructMesh",
        "scene_dense.mvs",
        "--free-space-support", env("MVS_FREE_SPACE") or "1",
        "--min-point-distance", env("MVS_MIN_POINT_DIST") or "0",
        "--max-edge-scale", env("MVS_MAX_EDGE_SCALE") or "6",
        "--close-holes", env("MVS_CLOSE_HOLES") or "100",
        "--thickness-factor", "2"
    ], cwd=str(mvs_dir))

    status(80, "texturing_mesh")
    run_cmd([
        "TextureMesh",
        "scene_dense.mvs",
        "--mesh-file", "scene_dense_mesh.ply",
        "--export-type", "obj"
    ], cwd=str(mvs_dir))

    status(90, "converting_to_glb")
    obj_file = mvs_dir / "scene_dense_texture.obj"
    glb_file = mvs_dir / "model.glb"
    
    if not obj_file.exists():
        raise RuntimeError(f"No se generó el archivo OBJ en {obj_file}")
        
    log("Loading OBJ with trimesh...")
    scene = trimesh.load(str(obj_file))
    log("Exporting to GLB...")
    scene.export(str(glb_file))

    status(95, "uploading_model")
    gcs.upload_file(glb_file, f"{prefix}/model.glb")
    
    # Actualizar el resultado principal
    result_key = f"{prefix}/recon/result.json"
    blob = gcs.bucket.blob(result_key)
    if blob.exists():
        result_data = json.loads(blob.download_as_string())
        result_data["modelType"] = "GLB"
        result_data["modelKey"] = f"{prefix}/model.glb"
        gcs.upload_json(result_key, result_data)
    
    status(100, "done")
    log("Meshing completado exitosamente")

if __name__ == "__main__":
    main()