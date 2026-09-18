"""Smoke test de la imagen de reconstruccion y volcado de las opciones de OpenMVS.

Sirve para confirmar que los binarios estan en el PATH y para leer los valores por
defecto reales antes de calibrar el mallado, en vez de adivinarlos.

    python -B -m modal run scan-recon/test_openmvs.py::dump_help
"""
import modal
import subprocess

app = modal.App("test-colmap-openmvs")

image = modal.Image.from_dockerfile("scan-recon/Dockerfile.openmvs", add_python="3.10")


@app.function(image=image, gpu="any")
def dump_help():
    subprocess.run(["colmap", "help"], check=False)
    for binary in ("DensifyPointCloud", "ReconstructMesh", "TextureMesh"):
        print(f"\n{'=' * 70}\n{binary}\n{'=' * 70}", flush=True)
        res = subprocess.run([binary, "--help"], capture_output=True, text=True)
        print(res.stdout or res.stderr, flush=True)
    return True
