#!/usr/bin/env python3
"""Cloud Run Job: package.zip -> Luma AI -> model.splat en GCS."""

import json
import os
import sys
import time
import traceback
import zipfile
from pathlib import Path

import requests
from google.cloud import storage

WORK = Path(os.environ.get("WORK_DIR", "/tmp/scan-recon"))

def log(msg):
    print(f"[LUMA] {msg}", flush=True)

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

class Gcs:
    def __init__(self, bucket_name):
        self.client = storage.Client()
        self.bucket = self.client.bucket(bucket_name)

    def download(self, key, dest: Path):
        dest.parent.mkdir(parents=True, exist_ok=True)
        self.bucket.blob(key).download_to_filename(str(dest))

    def upload_file(self, local_path, key, content_type=None):
        blob = self.bucket.blob(key)
        blob.cache_control = "no-store"
        if content_type:
            blob.upload_from_filename(str(local_path), content_type=content_type)
        else:
            blob.upload_from_filename(str(local_path))

    def upload_json(self, key, obj):
        blob = self.bucket.blob(key)
        blob.cache_control = "no-store"
        blob.upload_from_string(json.dumps(obj).encode("utf-8"), content_type="application/json")

def main():
    scan_id = env("SCAN_ID")
    org_id = env("ORG_ID")
    pkg_path = env("PACKAGE_PATH")
    bucket_name = env("GCS_BUCKET")
    luma_key = env("LUMA_API_KEY")

    if not all([scan_id, org_id, pkg_path, bucket_name, luma_key]):
        log("Faltan variables de entorno requeridas (SCAN_ID, ORG_ID, PACKAGE_PATH, GCS_BUCKET, LUMA_API_KEY)")
        sys.exit(1)

    gcs = Gcs(bucket_name)
    pkg_key = gcs_key(pkg_path, bucket_name)
    
    prefix = f"scans/{org_id}/{scan_id}"
    status_key = f"{prefix}/recon/status.json"
    result_key = f"{prefix}/recon/result.json"

    def status(progress, step, extra=None):
        data = {"status": "PROCESSING", "progress": progress, "step": step}
        if extra:
            data.update(extra)
        gcs.upload_json(status_key, data)
        log(f"status {progress} {step}")

    try:
        WORK.mkdir(parents=True, exist_ok=True)
        zip_path = WORK / "package.zip"
        
        status(5, "download_package")
        gcs.download(pkg_key, zip_path)
        
        # 1. Create capture in Luma
        status(10, "luma_create_capture")
        
        # Si la key ya empieza con 'luma-api-key=', no lo duplicamos
        auth_val = luma_key if luma_key.startswith("luma-api-key=") else f"luma-api-key={luma_key}"
        if auth_val.startswith("LUMA_API_Key="):
            auth_val = auth_val.replace("LUMA_API_Key=", "luma-api-key=")
            
        headers = {
            "Authorization": auth_val
        }
        res = requests.post(
            "https://webapp.engineeringlumalabs.com/api/v2/capture",
            headers=headers,
            data={"title": f"Scan {scan_id}"}
        )
        res.raise_for_status()
        capture_data = res.json()
        upload_url = capture_data["signedUrls"]["source"]
        slug = capture_data["capture"]["slug"]
        
        log(f"Luma capture created: {slug}")
        status(15, "luma_uploading", {"luma_slug": slug})
        
        # 2. Upload zip
        with open(zip_path, "rb") as f:
            upload_res = requests.put(upload_url, data=f, headers={"Content-Type": "text/plain"})
            upload_res.raise_for_status()
            
        # 3. Trigger processing
        status(30, "luma_processing", {"luma_slug": slug})
        trigger_res = requests.post(f"https://webapp.engineeringlumalabs.com/api/v2/capture/{slug}", headers=headers)
        trigger_res.raise_for_status()
        
        # 4. Poll for completion
        log("Waiting for Luma processing to complete...")
        while True:
            time.sleep(15)
            poll_res = requests.get(f"https://webapp.engineeringlumalabs.com/api/v2/capture/{slug}", headers=headers)
            poll_res.raise_for_status()
            poll_data = poll_res.json()
            
            run_status = poll_data.get("latest_run", {}).get("status", "unknown")
            run_progress = poll_data.get("latest_run", {}).get("progress", 0)
            
            log(f"Luma status: {run_status} ({run_progress}%)")
            
            # Update our status (map Luma's 0-100 to our 30-90)
            mapped_progress = 30 + int((run_progress / 100.0) * 60)
            status(mapped_progress, "luma_processing", {"luma_slug": slug, "luma_status": run_status})
            
            if run_status == "finished":
                break
            elif run_status == "failed":
                raise RuntimeError(f"Luma processing failed for slug {slug}")
                
        # 5. Download artifact (SPLAT)
        status(92, "downloading_model")
        artifacts = poll_data["latest_run"]["artifacts"]
        
        # Luma provides multiple formats. Let's try to get splat, then ply, then gltf
        model_url = None
        model_ext = None
        
        for art in artifacts:
            if art["type"] == "splat":
                model_url = art["url"]
                model_ext = "splat"
                break
                
        if not model_url:
            for art in artifacts:
                if art["type"] == "ply":
                    model_url = art["url"]
                    model_ext = "ply"
                    break
                    
        if not model_url:
            for art in artifacts:
                if art["type"] == "gltf":
                    model_url = art["url"]
                    model_ext = "glb"
                    break
                    
        if not model_url:
            raise RuntimeError(f"No suitable artifact found in Luma response: {artifacts}")
            
        log(f"Downloading {model_ext} from Luma...")
        model_res = requests.get(model_url, stream=True)
        model_res.raise_for_status()
        
        model_path = WORK / f"model.{model_ext}"
        with open(model_path, "wb") as f:
            for chunk in model_res.iter_content(chunk_size=8192):
                f.write(chunk)
                
        # 6. Upload to GCS
        status(95, "uploading_model")
        model_key = f"{prefix}/model.{model_ext}"
        gcs.upload_file(model_path, model_key)
        
        # 7. Write result.json
        status(98, "writing_result")
        
        # Determine model type for frontend
        model_type = "SPLAT"
        if model_ext == "ply":
            model_type = "SPLAT_PLY"
        elif model_ext == "glb":
            model_type = "GLB"
            
        result_data = {
            "status": "READY",
            "modelType": model_type,
            "modelKey": model_key,
            "lumaSlug": slug,
            "kind": "luma_splat"
        }
        
        # Extract cameras if available
        try:
            for art in artifacts:
                if art["type"] == "cameras":
                    cam_res = requests.get(art["url"])
                    cam_res.raise_for_status()
                    result_data["lumaCameras"] = cam_res.json()
                    break
        except Exception as e:
            log(f"Failed to fetch cameras: {e}")
            
        gcs.upload_json(result_key, result_data)
        status(100, "done")
        log("Luma pipeline completed successfully!")

    except Exception as e:
        traceback.print_exc()
        gcs.upload_json(status_key, {"status": "FAILED", "error": str(e)})
        sys.exit(1)

if __name__ == "__main__":
    main()