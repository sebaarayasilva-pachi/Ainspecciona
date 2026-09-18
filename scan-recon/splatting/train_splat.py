import os
import sys
import json
import shutil
import subprocess
from pathlib import Path
from google.cloud import storage

def env(key):
    return os.environ.get(key)

def log(msg):
    print(f"[SPLAT] {msg}", flush=True)

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
            # Remove prefix to get relative path
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

def main():
    bucket_name = env("GCS_BUCKET")
    org_id = env("ORG_ID")
    scan_id = env("SCAN_ID")
    
    if not bucket_name or not org_id or not scan_id:
        raise SystemExit("Faltan GCS_BUCKET, ORG_ID o SCAN_ID")

    prefix = f"scans/{org_id}/{scan_id}"
    colmap_prefix = f"{prefix}/recon/colmap" # Asumimos que guardaremos los datos de colmap aquí
    splat_key = f"{prefix}/model.splat"
    status_key = f"{prefix}/splat_status.json"

    gcs = Gcs(bucket_name)
    
    def status(progress, step):
        gcs.upload_json(status_key, {"status": "TRAINING", "progress": progress, "step": step})
        log(f"status {progress} {step}")

    WORK = Path("/tmp/work")
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True)
    
    colmap_dir = WORK / "colmap"
    output_dir = WORK / "output"
    
    status(10, "downloading_colmap_data")
    count = gcs.download_dir(colmap_prefix, colmap_dir)
    log(f"Descargados {count} archivos de COLMAP")
    
    if count == 0:
        raise RuntimeError("No se encontraron datos de COLMAP en GCS")

    # Verificar que existen los archivos necesarios
    if not (colmap_dir / "sparse" / "0" / "cameras.txt").exists():
        # A veces colmap lo guarda en sparse/ directamente
        if (colmap_dir / "sparse" / "cameras.txt").exists():
            (colmap_dir / "sparse" / "0").mkdir(exist_ok=True)
            for f in ["cameras.txt", "images.txt", "points3D.txt"]:
                if (colmap_dir / "sparse" / f).exists():
                    shutil.copy(colmap_dir / "sparse" / f, colmap_dir / "sparse" / "0" / f)
        else:
            raise RuntimeError("No se encontró cameras.txt en los datos de COLMAP")

    status(30, "training_gaussian_splatting")
    log("Iniciando entrenamiento (esto tomará tiempo)...")
    
    # Ejecutar el script de entrenamiento de gaussian-splatting
    # Usamos 1000 iteraciones para un modelo muy ligero y rápido
    train_cmd = [
        "python", "/workspace/gaussian-splatting/train.py",
        "-s", str(colmap_dir),
        "-m", str(output_dir),
        "--iterations", "1000",
        "--port", "6009" # Evitar conflictos de puerto
    ]
    
    try:
        subprocess.run(train_cmd, check=True)
    except subprocess.CalledProcessError as e:
        log(f"Error en el entrenamiento: {e}")
        gcs.upload_json(status_key, {"status": "FAILED", "error": str(e)})
        raise

    status(90, "converting_to_splat")
    ply_path = output_dir / "point_cloud" / "iteration_1000" / "point_cloud.ply"
    
    if not ply_path.exists():
        raise RuntimeError(f"No se generó el archivo PLY en {ply_path}")
        
    # Aquí necesitaríamos un script para convertir .ply a .splat (formato web)
    # Por ahora, subiremos el .ply directamente o usaremos una herramienta de conversión
    # Para simplificar este MVP, subiremos el PLY. El visor web puede cargar PLY también.
    
    status(95, "uploading_model")
    gcs.upload_file(ply_path, f"{prefix}/model.ply")
    
    # Actualizar el resultado principal para que apunte al nuevo modelo
    result_key = f"{prefix}/recon/result.json"
    blob = gcs.bucket.blob(result_key)
    if blob.exists():
        result_data = json.loads(blob.download_as_string())
        result_data["modelType"] = "SPLAT_PLY"
        result_data["modelKey"] = f"{prefix}/model.ply"
        gcs.upload_json(result_key, result_data)
    
    status(100, "done")
    log("Entrenamiento completado exitosamente")

if __name__ == "__main__":
    main()