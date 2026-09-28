import os
import sys
import json
import shutil
import subprocess
from pathlib import Path
from google.cloud import storage
import trimesh

# Debe coincidir con COLMAP_DONE_PROGRESS de run_recon.py: es el punto de la barra donde
# COLMAP termina y arranca este mallado.
COLMAP_DONE_PROGRESS = 60


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
    # El mismo status.json que consulta la web. run_recon.py lo dejo en PROCESSING al
    # terminar COLMAP, y el tramo que queda hasta 100 es este mallado.
    status_key = f"{prefix}/recon/status.json"
    result_key = f"{prefix}/recon/result.json"

    gcs = Gcs(bucket_name)

    def status(progress, step):
        scaled = COLMAP_DONE_PROGRESS + round(progress * (99 - COLMAP_DONE_PROGRESS) / 100)
        gcs.upload_json(status_key, {"status": "PROCESSING", "progress": scaled, "step": step})
        log(f"status {scaled} {step}")

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
    # Los frames son de 1080x1920 y --max-resolution vale 2560, así que el nivel 0
    # trabaja a resolución completa. Los valores van por env para calibrar sin redeployar.
    #
    # Las capturas de una pasada dejan ~3 vistas por punto (la mitad con solo 2), y con
    # tan pocas la fusión por defecto descarta el 98% de las profundidades. Los dos flags
    # de abajo son los que OpenMVS documenta para ese caso:
    #   postprocess-dmaps 3 cambia el adjust-confidence de GPU, que poda, por
    #     remove-speckles + fill-gaps, que rellena.
    #   fusion-recycle-dropped devuelve al pool los píxeles que la regla de descarte tiró.
    # Ambos cambian precisión por completitud; los outliers extra los limpia ReconstructMesh.
    run_cmd([
        "DensifyPointCloud",
        "scene.mvs",
        "--resolution-level", env("MVS_RESOLUTION_LEVEL") or "0", # 0 es resolucion completa (maximo detalle)
        "--number-views", "0", # Usar todas las vistas posibles
        "--number-views-fuse", env("MVS_VIEWS_FUSE") or "2",
        "--postprocess-dmaps", env("MVS_POSTPROCESS_DMAPS") or "3",
        "--fusion-recycle-dropped", env("MVS_RECYCLE_DROPPED") or "1",
        "--filter-point-cloud", "0", # Desactivar filtro agresivo de nube de puntos para retener mas datos
        "--estimate-normals", "1"
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
        "--max-edge-scale", env("MVS_MAX_EDGE_SCALE") or "5.0", # Aumentado para permitir puentes entre huecos 
grandes
        "--close-holes", env("MVS_CLOSE_HOLES") or "150", # Aumentado drásticamente para forzar el relleno de huecos
        "--thickness-factor", "2",
        "--smooth", "3",
        "--decimate", "0.25" # Aumentamos un poco la calidad (25% de polígonos)
    ], cwd=str(mvs_dir))

    status(75, "filling_holes")
    try:
        log("Rellenando huecos en la malla con trimesh...")
        mesh_path = mvs_dir / "scene_dense_mesh.ply"
        if mesh_path.exists():
            mesh = trimesh.load(str(mesh_path))
            if not mesh.is_watertight:
                log(f"Malla no es watertight. Rellenando huecos... (caras antes: {len(mesh.faces)})")
                mesh.fill_holes()
                log(f"Caras despues de rellenar: {len(mesh.faces)}")
                mesh.export(str(mesh_path))
            else:
                log("La malla ya es watertight.")
    except Exception as e:
        log(f"Advertencia: fallo al rellenar huecos con trimesh: {e}")

    status(80, "texturing_mesh")
    run_cmd([
        "TextureMesh",
        "scene_dense.mvs",
        "--mesh-file", "scene_dense_mesh.ply",
        "--export-type", "obj",
        "--resolution-level", env("MVS_TEXTURE_RESOLUTION") or "1" # 1 = mitad de resolucion (4x mas rapido, evita timeouts)
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

    # trimesh.load devuelve una Scene o una Trimesh segun el OBJ, asi que hay que cubrir
    # los dos casos para reportar el conteo real en result.json.
    if isinstance(scene, trimesh.Scene):
        mesh_faces = sum(len(g.faces) for g in scene.geometry.values())
    else:
        mesh_faces = len(scene.faces)
    log(f"malla exportada: {mesh_faces} caras")

    status(95, "uploading_model")
    gcs.upload_file(glb_file, f"{prefix}/model.glb")

    # El READY lo publica este paso, no COLMAP: hasta aca el model.glb era la nube de
    # puntos dispersa y recien ahora quedo sobrescrito por la malla texturizada.
    blob = gcs.bucket.blob(result_key)
    result_data = json.loads(blob.download_as_string()) if blob.exists() else {}
    result_data.update({
        "status": "READY",
        "progress": 100,
        "modelType": "GLB",
        "modelKey": f"{prefix}/model.glb",
        "kind": "openmvs_mesh",
        "faceCount": int(mesh_faces),
    })
    gcs.upload_json(result_key, result_data)
    gcs.upload_json(status_key, {"status": "READY", "progress": 100, "step": "done"})
    log(f"READY faces={mesh_faces}")

if __name__ == "__main__":
    main()