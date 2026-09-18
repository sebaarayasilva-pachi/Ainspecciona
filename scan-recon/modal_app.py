import modal
import os
import subprocess
import sys
from pathlib import Path

app = modal.App("ainspecta-recon-splat")

# Definimos la imagen con CUDA, dependencias de sistema y Python
image = (
    modal.Image.from_dockerfile(Path(__file__).parent / "Dockerfile.openmvs", add_python="3.10")
    .pip_install("google-cloud-storage==2.19.0", "Pillow==10.4.0", "numpy==1.26.4", "tqdm", "trimesh")
    .add_local_dir(Path(__file__).parent, remote_path="/app/scan-recon")
)

@app.function(
    image=image,
    gpu="A10G", # 24GB VRAM, ideal para splatting de alta calidad (30k iteraciones)
    timeout=3600, # 1 hora max
    secrets=[modal.Secret.from_name("gcp-credentials")] # Secreto que crearemos en Modal
)
def process_scan_bg(scan_id: str, org_id: str, pkg_path: str, bucket_name: str):
    # Configuramos variables de entorno para los scripts
    os.environ["SCAN_ID"] = scan_id
    os.environ["ORG_ID"] = org_id
    os.environ["PACKAGE_PATH"] = pkg_path
    os.environ["GCS_BUCKET"] = bucket_name
    os.environ["WORK_DIR"] = "/tmp/work"
    
    # Write GCS credentials from Modal secret to a temporary file
    # Modal mounts the secret content to the env var with the exact name of the secret key
    # In this case, the secret might just be injecting GOOGLE_APPLICATION_CREDENTIALS directly
    # Let's check if we have the JSON string in an env var
    cred_env_var = None
    for k in os.environ:
        if "gcp" in k.lower() or "cred" in k.lower():
            print(f"Found potential secret env var: {k}")
            
    # The secret is probably named exactly as the key in the Modal UI
    # If the key is 'gcp-credentials.json' or similar, it might be in os.environ["gcp-credentials.json"]
    # Let's just create a new file with the content of the secret if it exists
    # Force clear GOOGLE_APPLICATION_CREDENTIALS if it exists
    if "GOOGLE_APPLICATION_CREDENTIALS" in os.environ:
        print(f"WARNING: Clearing GOOGLE_APPLICATION_CREDENTIALS: {os.environ['GOOGLE_APPLICATION_CREDENTIALS']}")
        del os.environ["GOOGLE_APPLICATION_CREDENTIALS"]
        
    # We recreated the secret correctly! It now injects GOOGLE_APPLICATION_CREDENTIALS_JSON
    if "GOOGLE_APPLICATION_CREDENTIALS_JSON" in os.environ:
        print("Found GOOGLE_APPLICATION_CREDENTIALS_JSON secret!")
        gcp_credentials_path = Path("/tmp/gcp_credentials.json")
        gcp_credentials_path.write_text(os.environ["GOOGLE_APPLICATION_CREDENTIALS_JSON"])
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(gcp_credentials_path)
    else:
        print("CRITICAL: Could not find GOOGLE_APPLICATION_CREDENTIALS_JSON in environment variables!")
        return {"ok": False, "error": "MISSING_GCP_CREDENTIALS"}
        # Let's try to use default credentials if running in GCP, but we are in Modal.
        # We MUST have the secret correctly configured in Modal.
        # Let's read the secret file if it exists in the default Modal secret mount path
        # Modal mounts secrets to /var/run/secrets/modal/
        # Wait, if the secret was created as a file, it might be in the env var!
        # Let's check the value of the env var again. We cleared it because it had "C:\\".
        # If it had "C:\\", it means the secret was created INCORRECTLY in Modal.
        # The user uploaded the path string instead of the file content!
        print("ERROR: The secret 'gcp-credentials' in Modal contains a Windows file path, NOT the JSON content.")
        print("ERROR: Please go to Modal dashboard -> Secrets -> gcp-credentials.")
        print("ERROR: Delete it and recreate it. Make sure to paste the CONTENT of the JSON file, not the path.")
        
        # As a temporary hack for testing, I will hardcode the credentials if I can find them locally,
        # but I can't do that securely. The user MUST fix the secret.
        return {"ok": False, "error": "INVALID_GCP_CREDENTIALS_SECRET"}
    
    print(f"--- Iniciando COLMAP Recon para {scan_id} ---")
    recon_res = subprocess.run([sys.executable, "/app/scan-recon/run_recon.py"])
    if recon_res.returncode != 0:
        print("Error en COLMAP Recon!")
        return {"ok": False, "error": "COLMAP_FAILED"}
        
    print(f"--- Iniciando Meshing (OpenMVS) para {scan_id} ---")
    mesh_res = subprocess.run([sys.executable, "/app/scan-recon/meshing/run_meshing.py"])
    if mesh_res.returncode != 0:
        print("Error en Meshing!")
        return {"ok": False, "error": "MESHING_FAILED"}
        
    print("--- Pipeline completado exitosamente ---")
    return {"ok": True}

@app.function(
    image=modal.Image.debian_slim().pip_install("fastapi[standard]"), # Webhook ligero
    secrets=[modal.Secret.from_name("gcp-credentials")]
)
@modal.fastapi_endpoint(method="POST")
def webhook(item: dict):
    scan_id = item.get("scan_id")
    org_id = item.get("org_id")
    pkg_path = item.get("pkg_path")
    bucket_name = item.get("bucket_name")
    
    if not all([scan_id, org_id, pkg_path, bucket_name]):
        return {"ok": False, "error": "Missing parameters"}
        
    # Lanzamos el proceso pesado en background (GPU)
    process_scan_bg.spawn(scan_id, org_id, pkg_path, bucket_name)
    return {"ok": True, "message": "Job started in Modal"}
