import modal
import subprocess
import os

app = modal.App("test-colmap-openmvs")

image = (
    modal.Image.from_dockerfile("scan-recon/Dockerfile.openmvs", add_python="3.10")
)

@app.function(image=image, gpu="any")
def test_openmvs():
    res = subprocess.run(["DensifyPointCloud", "--help"], capture_output=True, text=True)
    print("DensifyPointCloud stdout:", res.stdout[:100])
    
    res2 = subprocess.run(["colmap", "help"], capture_output=True, text=True)
    print("COLMAP stdout:", res2.stdout[:100])
    
    return True
